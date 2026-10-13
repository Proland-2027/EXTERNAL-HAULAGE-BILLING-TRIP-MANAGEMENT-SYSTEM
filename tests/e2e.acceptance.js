/* Browser acceptance run (not part of `npm test`): drives the app against a local server with Playwright.
 *   MOCK_ARTIFACT=1 runs the same scenarios through the shared-database store (js/store/artifact.js) with an in-page mock of the claude.ai runtime.
 *   node server/seed.js && PORT=8099 node server/server.js &
 *   BASE=http://localhost:8099 node tests/e2e.acceptance.js
 * Covers the 18 acceptance scenarios of the fleet-planning brief at UI level where practical and via the store API otherwise. */
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const results = []; const errors = [];
let lastToast = '';
const step = async (name, fn) => { try { if (typeof closeModals === 'function') await closeModals(); await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ' — ' + (e.message || e).toString().split('\n')[0] + (lastToast ? ' [last toast: ' + lastToast + ']' : '')]); } };
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route(/cdnjs|googleapis|gstatic/, (r) => r.abort());
  if (process.env.MOCK_ARTIFACT) { await page.addInitScript({ path: path.join(__dirname, 'mock_artifact_runtime.js') }); console.log('shared-database mode (mock artifact runtime)'); }
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); await page.exposeFunction('__toast', (t) => { lastToast = t; }); await page.addInitScript(() => { const orig = window.setTimeout; document.addEventListener('DOMContentLoaded', () => { const t = document.getElementById('toast'); if (t) new MutationObserver(() => { if (t.textContent) window.__toast(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true }); }); }); page.on('crash', () => errors.push('PAGE CRASHED')); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const login = async (u, p) => { await page.goto(BASE + '/?t=' + Date.now() + '#dashboard', { waitUntil: 'domcontentloaded' }); await page.waitForSelector('#login-user, .shell', { timeout: 15000 }); if (await page.$('#login-user')) { await page.fill('#login-user', u); await page.fill('#login-pass', p); await page.click('button[type=submit]'); } await page.waitForSelector('.shell', { timeout: 40000, state: 'attached' }); await page.waitForTimeout(600); };
  const logout = async () => { await page.evaluate(async () => { await HB.app.store.logout(); }); };
  const closeModals = async () => { await page.evaluate(() => { for (const o of document.querySelectorAll('.overlay')) o.remove(); }); };
  const nav = async (v, params) => { await page.evaluate(([v, p]) => HB.app.nav ? HB.app.nav(v, p) : (location.hash = '#' + v), [v, params || {}]); await page.waitForTimeout(350); };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  await login('admin', 'Admin@2026');
  const HB_MODE = await ev(() => HB.app.store.mode);
  // every view renders without errors
  for (const v of ['dashboard', 'fleet', 'planning', 'fleetdash', 'trips', 'rates', 'invoices', 'payments', 'reports', 'audit', 'clients', 'assets', 'users', 'settings']) await step(`view ${v} renders`, async () => { await page.evaluate((v) => { location.hash = '#' + v; }, v); await page.waitForTimeout(500); const title = await page.textContent('#view-title'); if (!title) throw new Error('no title'); const bad = await page.$('.notice.bad'); if (bad && /failed to render/.test(await bad.textContent())) throw new Error(await bad.textContent()); });

  // S1 FMR: update a truck status, FMR recalculates
  await step('S1 FMR status update recalculates availability', async () => {
    await page.evaluate(() => { location.hash = '#fleet'; }); await page.waitForTimeout(400);
    const r = await ev(async () => { const s = HB.app.store; const P = HB.planning; const t = s.state.fleet.find((x) => x.status === 'Available'); const before = P.truckStatus(t, s.planningCtx()); await s.saveDoc('fleet', { id: t.id, status: 'In Workshop', workshopRelease: P.addDays(s.planningCtx().today, 5), statusAt: new Date().toISOString() }, { expectedVersion: t.version }); const after = P.truckStatus(s.state.fleet.find((x) => x.id === t.id), s.planningCtx()); await s.saveDoc('fleet', { id: t.id, status: 'Available', workshopRelease: '', statusAt: new Date().toISOString() }, { expectedVersion: s.state.fleet.find((x) => x.id === t.id).version }); return { before: before.category, after: after.category, back: after.backOnGround }; });
    if (r.before !== 'Available and Unplanned' && r.before !== 'Available but Already Allocated') throw new Error('before ' + r.before); if (r.after !== 'In Workshop / Breakdown') throw new Error('after ' + r.after);
    const txt = await page.textContent('#fmr'); if (!/Tracking update overdue/.test(txt)) throw new Error('FMR tiles missing');
  });
  // S2 tracking overdue flag
  await step('S2 truck not updated within threshold is flagged Tracking Update Overdue', async () => {
    const r = await ev(() => { const s = HB.app.store; const P = HB.planning; const t = Object.assign({}, s.state.fleet.find((x) => x.status), { statusAt: new Date(Date.now() - 72 * 3600000).toISOString() }); return P.truckStatus(t, s.planningCtx()).trackingOverdue; }); if (!r) throw new Error('not flagged');
  });
  // S3 ETA passed -> not available, flagged for verification
  await step('S3 truck past ETA is not shown available; flagged for verification', async () => {
    const r = await ev(() => { const s = HB.app.store; const P = HB.planning; const ctx = s.planningCtx(); const t = Object.assign({}, s.state.fleet.find((x) => x.status === 'Outbound / In Transit' && x.routeId), { loadingDate: P.addDays(ctx.today, -30), statusAt: P.addDays(ctx.today, -30) + 'T08:00:00Z' }); const st = P.truckStatus(t, ctx); return { cat: st.category, unc: st.returnUnconfirmed, group: st.group }; }); if (r.cat !== 'Unavailable or Status Unconfirmed' || !r.unc) throw new Error(JSON.stringify(r));
  });
  // S4 new client request with unique ID; S5 counts
  let reqId;
  await step('S4 client request gets a unique Request ID and appears with Trucks Still Required', async () => {
    await page.evaluate(() => { location.hash = '#planning'; }); await page.waitForTimeout(400);
    await page.click('button:has-text("New request")'); await page.waitForSelector('.modal');
    await page.selectOption('.modal select', { label: 'Jamara' }); await page.waitForTimeout(100);
    const sel = (await page.$$('.modal select'))[1]; const opts = await sel.$$eval('option', (o) => o.map((x) => x.value).filter(Boolean)); await sel.selectOption(opts[0]);
    await page.fill('.modal input[type=number]', '3'); const d = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10); await page.fill('.modal input[type=date]', d);
    await page.click('.modal button:has-text("Log request")'); await page.waitForTimeout(600);
    reqId = await ev(() => { const r = HB.app.store.state.requests.filter((x) => x.client === 'Jamara').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]; return r && r.id; }); if (!/^JAM-\d{3}$/.test(reqId)) throw new Error('id ' + reqId);
    const dup = await ev(() => { const ids = HB.app.store.state.requests.map((r) => r.id); return ids.length !== new Set(ids).size; }); if (dup) throw new Error('duplicate ids');
    const c = await ev((id) => { const s = HB.app.store; const r = s.state.requests.find((x) => x.id === id); return HB.planning.requestCounts(r, s.state.allocations, s.trips()); }, reqId); if (c.requested !== 3 || c.outstanding !== 3) throw new Error(JSON.stringify(c));
  });
  // S6 planner suitability + S7 allocate + S8 double booking prevented
  let allocId;
  await step('S6/S7 planner lists suitable trucks ranked; allocation reduces Trucks Still Required', async () => {
    if (await page.$('.modal')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    await page.evaluate(() => { location.hash = '#planning'; }); await page.waitForTimeout(400);
    await ev((id) => HB.views.planning.planRequest(HB.views.planning.ctx, id), reqId); await page.waitForSelector('#planner-table');
    const n = await page.evaluate(() => { const cb = document.querySelector('#planner-table tbody tr input[type=checkbox]:not([disabled])'); if (!cb) return 0; cb.click(); return 1; }); if (!n) throw new Error('no suitable truck enabled'); await page.waitForTimeout(250);
    await page.click('.modal-foot button.primary'); await page.waitForTimeout(700);
    const c = await ev((id) => { const s = HB.app.store; const r = s.state.requests.find((x) => x.id === id); const a = s.state.allocations.filter((x) => x.requestId === id); return { counts: HB.planning.requestCounts(r, s.state.allocations, s.trips()), alloc: a[0] && a[0].id, status: HB.planning.requestStatus(r, HB.planning.requestCounts(r, s.state.allocations, s.trips())) }; }, reqId);
    if (c.counts.allocated !== 1 || c.counts.outstanding !== 2 || c.status !== 'Partially Allocated') throw new Error(JSON.stringify(c)); allocId = c.alloc; if (!/^ALC-\d{6}-\d{2}$/.test(allocId)) throw new Error('alloc id ' + allocId);
  });
  await step('S8 double allocation of the same truck over the same days is blocked', async () => {
    const r = await ev(async (id) => { const s = HB.app.store; const a = s.state.allocations.find((x) => x.id === id); const clash = HB.planning.bookingConflicts(a.plate, a.plannedLoadingDate, a.backOnGround, s.state.allocations); try { await s.saveDoc('allocations', Object.assign({}, a, { id: 'ALC-TEST-99', requestId: 'X', version: undefined }), {}); return { saved: true, clash: clash.length }; } catch (e) { return { saved: false, code: e.code, clash: clash.length, msg: e.message }; } }, allocId);
    if (r.clash < 1) throw new Error('engine did not detect the clash');
    if (r.saved) { await ev(async () => { await HB.app.store.deleteDoc('allocations', 'ALC-TEST-99'); }); throw new Error('server accepted a double booking'); }
  });
  // S9 cannot reach loading point in time -> warning
  await step('S9 planner warns when a truck cannot reach the loading point in time', async () => {
    const r = await ev((id) => { const s = HB.app.store; const r = s.state.requests.find((x) => x.id === id); const plan = HB.planning.planForRequest(Object.assign({}, r, { loadingDate: s.planningCtx().today }), s.planningCtx()); return plan.rows.filter((x) => x.daysLate > 0 && x.notes.some((n) => /Cannot reach/.test(n))).length; }, reqId); if (!r) throw new Error('no late warnings');
  });
  // S10 Select from Fleet Planning creates the trip, Trip ID pending
  let tripId;
  await step('S10 Select from Fleet Planning creates a Trip Log entry linked to the allocation (Trip ID pending)', async () => {
    await page.evaluate(() => { location.hash = '#trips'; }); await page.waitForTimeout(500);
    await page.click('#btn-from-planning'); await page.waitForSelector('.modal .check-list');
    await ev((id) => { const lab = [...document.querySelectorAll('.modal .check-list label')].find((l) => l.textContent.includes(id)); lab.querySelector('input[type=checkbox]').click(); }, allocId); await page.waitForTimeout(200);
    await page.click('.modal-foot button.primary'); await page.waitForTimeout(900);
    const r = await ev((id) => { const s = HB.app.store; const t = s.trips().find((x) => x.allocationId === id); const a = s.state.allocations.find((x) => x.id === id); return t ? { id: t.id, jp: t.journeyPlanId, inv: t.invoiceStatus, wb: t.waybillStatus, alloc: a.status, link: a.tripLogId, sp: t.sellingPrice } : null; }, allocId);
    if (!r) throw new Error('trip not created'); if (r.jp) throw new Error('trip id should be pending'); if (r.inv !== 'Not Invoiced' || r.wb !== 'Awaiting Waybill') throw new Error(JSON.stringify(r)); if (r.alloc !== 'Deployed' || r.link !== r.id) throw new Error('allocation not linked: ' + JSON.stringify(r)); if (r.sp !== null) throw new Error('selling price must stay empty'); tripId = r.id;
  });
  // S11 Trip ID validation + uniqueness
  await step('S11 Trip ID must match the Power Apps format and be unique; never generated', async () => {
    const r = await ev(async (id) => { const s = HB.app.store; const out = {}; const t = s.raw(id); try { await s.saveTrip({ id, journeyPlanId: 'not a trip id' }, { expectedVersion: t.version }); out.bad = 'accepted'; } catch (e) { out.bad = e.code; } const other = s.trips().find((x) => x.journeyPlanId && x.id !== id); try { await s.saveTrip({ id, journeyPlanId: other.journeyPlanId }, { expectedVersion: s.raw(id).version }); out.dup = 'accepted'; } catch (e) { out.dup = e.code; } await s.saveTrip({ id, journeyPlanId: 'TRP-' + Date.now().toString().slice(-6) }, { expectedVersion: s.raw(id).version }); const a = s.state.allocations.find((x) => x.tripLogId === id); return Object.assign(out, { set: s.raw(id).journeyPlanId, allocTripId: a.tripId }); }, tripId);
    if (r.bad === 'accepted' || r.dup === 'accepted') throw new Error(JSON.stringify(r)); if (!r.set || r.allocTripId !== r.set) throw new Error('trip id not carried to allocation ' + JSON.stringify(r));
  });
  // S12 waybill later -> statuses
  await step('S12 waybill can be added later; status moves Awaiting → Entered → Verification Pending → Verified', async () => {
    const r = await ev(async (id) => { const s = HB.app.store; const seq = []; seq.push(s.trip(id).waybillStatus); await s.saveTrip({ id, waybill: 'WB-' + Date.now().toString().slice(-5) }, { expectedVersion: s.raw(id).version }); seq.push(s.trip(id).waybillStatus); await s.saveTrip({ id, waybillReceivedAt: [s.planningCtx().today, s.raw(id).dateDispatched].sort().pop(), waybillReceivedBy: 'ops' }, { expectedVersion: s.raw(id).version }); seq.push(s.trip(id).waybillStatus); await s.saveTrip({ id, waybillVerifiedAt: new Date().toISOString(), waybillVerifiedBy: 'billing' }, { expectedVersion: s.raw(id).version }); seq.push(s.trip(id).waybillStatus); return seq; }, tripId);
    if (r.join('>') !== 'Awaiting Waybill>Waybill Number Entered>Waybill Verification Pending>Waybill Verified') throw new Error(r.join(' > '));
  });
  // S13 invoice status automation: Draft → Issued → Sent, no manual selection; S14 duplicate billing prevented
  let invId;
  await step('S13 invoice status is automatic through Draft → Issued → Sent with separate dates', async () => {
    const r = await ev(async (id) => { const s = HB.app.store; const E = HB.engine; await s.saveTrip({ id, sellingPrice: 1500000 }, { expectedVersion: s.raw(id).version }); const t = s.trip(id); const inv = { id: 'inv-e2e-' + Date.now(), number: E.generateInvoiceNumber(t.client, t.dateDispatched, s.state.invoices.map((i) => i.number), s.state.clients), client: t.client, invoiceDate: s.planningCtx().today, dueDate: E.addDays(s.planningCtx().today, 7), fromMonth: t.month, toMonth: t.month, priceType: 'exclusive', vatRate: 0.075, tripIds: [id], lines: [], subtotal: 1500000, vat: 112500, total: 1612500, status: 'Draft' }; await s.saveDoc('invoices', inv); await s.saveTrip({ id, invoiceId: inv.id, invoiceNo: inv.number, invoiceStatus: 'Draft Invoice' }, { expectedVersion: s.raw(id).version }); const seq = [s.trip(id).invoiceStatus]; await s.saveDoc('invoices', { id: inv.id, status: 'Issued', issuedAt: new Date().toISOString(), issuedBy: 'billing' }, { expectedVersion: s.state.invoices.find((i) => i.id === inv.id).version }); seq.push(s.trip(id).invoiceStatus); await s.saveDoc('invoices', { id: inv.id, status: 'Sent', sentAt: new Date().toISOString(), sentBy: 'billing', sentChannel: 'Email' }, { expectedVersion: s.state.invoices.find((i) => i.id === inv.id).version }); seq.push(s.trip(id).invoiceStatus); const tt = s.trip(id); return { seq, issued: tt.invoiceIssuedAt, sent: tt.invoiceSentAt, tripStatus: tt.tripStatus, inv: inv.id, eligible: E.eligibleTrips(s.trips(), tt.client, tt.month, tt.month).some((x) => x.id === id) }; }, tripId);
    if (r.seq.join('>') !== 'Draft Invoice>Invoice Issued>Invoice Sent') throw new Error(r.seq.join('>')); if (!r.issued || !r.sent || r.issued === r.sent) throw new Error('dates'); if (r.tripStatus !== 'Awaiting Payment') throw new Error(r.tripStatus); if (r.eligible) throw new Error('invoiced trip still eligible for another invoice'); invId = r.inv;
  });
  await step('S14 payment status is separate: part payment keeps the trip open, full settlement closes it', async () => {
    const r = await ev(async (id) => { const s = HB.app.store; const seq = []; await s.saveTrip({ id, paymentStatus: 'Advance', advance: 500000 }, { expectedVersion: s.raw(id).version }); seq.push(s.trip(id).tripStatus + '|' + s.trip(id).paymentLabel + '|' + s.trip(id).invoiceStatus); await s.saveTrip({ id, paymentStatus: 'Paid' }, { expectedVersion: s.raw(id).version }); seq.push(s.trip(id).tripStatus + '|' + s.trip(id).paymentLabel); const a = s.state.allocations.find((x) => x.tripLogId === id); const inv = s.state.invoices.find((i) => i.id === s.raw(id).invoiceId); return { seq, stage: HB.planning.chainStage(a, s.trip(id), inv) }; }, tripId);
    if (r.seq[0] !== 'Part Paid - Balance Due|Part Paid|Invoice Sent' || r.seq[1] !== 'Closed|Paid') throw new Error(JSON.stringify(r)); if (r.stage !== 'Paid') throw new Error('chain stage ' + r.stage);
  });
  // S15 dashboards show the KPIs
  await step('S15 management dashboard shows the four sections and new KPIs', async () => {
    await page.evaluate(() => { location.hash = '#dashboard'; }); await page.waitForTimeout(700); const txt = await page.textContent('#dash');
    for (const k of ['Fleet Operations', 'Fleet Planning', 'Billing & Documentation', 'Financial Performance', 'Allocated, not yet in Trip Log', 'Allocated, awaiting Trip ID', 'Trips awaiting waybill', 'Completed trips not invoiced', 'Invoices issued but not sent', 'Invoices sent, awaiting payment', 'Sales Performance by Truck Batch']) if (!txt.includes(k)) throw new Error('missing ' + k);
    await page.evaluate(() => { location.hash = '#fleetdash'; }); await page.waitForTimeout(700); const t2 = await page.textContent('#fleet-dash'); for (const k of ['Fleet Availability Runway', 'Trucks still required', 'Coming free this week']) if (!t2.includes(k)) throw new Error('missing ' + k);
  });
  // S16 role restrictions
  await step('S16 tracking officer can update FMR but cannot allocate or edit trips', async () => {
    await logout(); await login('tracking', 'Tracking@2026');
    const r = await ev(async () => { const s = HB.app.store; const E = HB.engine; const out = { fmr: E.can('tracking', 'fmr.update'), plan: E.can('tracking', 'planning.manage'), trip: E.can('tracking', 'trip.edit') }; const t = s.state.fleet.find((x) => x.status); try { await s.saveDoc('fleet', { id: t.id, remarks: 'tracking note ' + Date.now() }, { expectedVersion: t.version }); out.fleetWrite = true; } catch (e) { out.fleetWrite = e.message; } const a = s.state.allocations[0]; try { await s.saveDoc('allocations', { id: a.id, remarks: 'x' }, { expectedVersion: a.version }); out.allocWrite = true; } catch (e) { out.allocWrite = e.code; } return out; });
    if (!r.fmr || r.plan || r.trip || r.fleetWrite !== true) throw new Error(JSON.stringify(r)); if (r.allocWrite === true && HB_MODE === 'server') throw new Error('server let tracking write allocations');
    const btn = await page.$('#btn-from-planning'); if (btn) throw new Error('tracking sees Select from Fleet Planning');
  });
  await step('S17 billing cannot change the FMR; management is read-only', async () => {
    await logout(); await login('billing', 'Billing@2026');
    const r = await ev(async () => { const s = HB.app.store; const t = s.state.fleet.find((x) => x.status); try { await s.saveDoc('fleet', { id: t.id, remarks: 'billing note' }, { expectedVersion: t.version }); return 'accepted'; } catch (e) { return e.code; } });
    if (r === 'accepted' && HB_MODE === 'server') throw new Error('billing wrote to the FMR');
    await logout(); await login('manager', 'Manager@2026'); await page.evaluate(() => { location.hash = '#fleet'; }); await page.waitForTimeout(500); if (await page.$('button:has-text("Add truck to FMR")')) throw new Error('management sees FMR edit controls');
  });
  // S18 Power Apps endpoint (server only)
  await step('S18 Power Apps webhook assigns a Trip ID to an allocation and rejects duplicates / bad format', async () => {
    if (HB_MODE !== 'server') return;
    const alloc = await ev(() => HB.app.store.state.allocations.find((a) => !a.tripId && !a.tripLogId && a.status === 'Planned')); if (!alloc) throw new Error('no free allocation');
    const post = async (body, key) => { const res = await fetch(BASE + '/api/integrations/powerapps/trip-id', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': key || 'test-key' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
    const tid = 'TRP-' + Date.now().toString().slice(-6);
    const ok = await post({ allocationId: alloc.id, tripId: tid }); if (ok.status !== 200) throw new Error('ok ' + JSON.stringify(ok));
    const bad = await post({ allocationId: alloc.id, tripId: 'nope!' }); if (bad.status !== 400) throw new Error('bad format accepted');
    const dup = await post({ tripLogId: tripId, tripId: (await ev((id) => HB.app.store.raw(id).journeyPlanId, tripId)) }); if (dup.status !== 409) throw new Error('duplicate accepted ' + JSON.stringify(dup));
    const noKey = await post({ allocationId: alloc.id, tripId: 'TRP-999999' }, 'wrong'); if (noKey.status !== 401) throw new Error('key not checked');
  });
  // S19-S22 continuous workflow: billing selects allocations, duplicate links refused, authorised split, credit note
  let billTrip;
  await step('S19 Billing Team creates the Trip Log entry from Fleet Planning with a searchable list; nothing re-typed, no invoice issued', async () => {
    await logout(); await login('billing', 'Billing@2026');
    await page.evaluate(() => { location.hash = '#trips'; }); await page.waitForTimeout(500);
    const before = await ev(() => HB.app.store.state.invoices.length);
    await page.click('#btn-from-planning'); await page.waitForSelector('#sfp-search');
    const target = await ev(() => { const a = HB.views.planning.allocationRows(HB.app.store).find((x) => !x.trip && !x.tripLogId && x.status === 'Planned'); return a && { id: a.id, plate: a.plate, client: a.client }; }); if (!target) throw new Error('no unlinked allocation left');
    await page.fill('#sfp-search', target.plate); await page.waitForTimeout(400);
    const rows = await page.$$eval('#sfp-list label', (ls) => ls.map((l) => l.textContent)); if (!rows.some((r) => r.includes(target.id))) throw new Error('search did not find ' + target.id);
    await ev((id) => { const lab = [...document.querySelectorAll('#sfp-list label')].find((l) => l.textContent.includes(id)); lab.querySelector('input[type=checkbox]').click(); }, target.id); await page.waitForTimeout(200);
    await page.click('#sfp-create'); await page.waitForTimeout(1200);
    const r = await ev((id) => { const s = HB.app.store; const t = s.trips().find((x) => x.allocationId === id); const a = s.state.allocations.find((x) => x.id === id); return t ? { id: t.id, plate: t.plate, client: t.client, from: t.loadingFrom, to: t.loadingTo, batch: t.truckBatch, req: t.requestId, sp: t.sellingPrice, inv: t.invoiceStatus, allocStatus: a.status, link: a.tripLogId, createdBy: t.createdBy } : null; }, target.id);
    if (!r) throw new Error('trip not created'); if (r.plate !== target.plate || r.client !== target.client || !r.from || !r.to || !r.req) throw new Error('fields not carried: ' + JSON.stringify(r));
    if (r.sp !== null || r.inv !== 'Not Invoiced' || r.link !== r.id || r.allocStatus !== 'Deployed' || r.createdBy !== 'billing') throw new Error(JSON.stringify(r));
    const after = await ev(() => HB.app.store.state.invoices.length); if (after !== before) throw new Error('an invoice was created'); billTrip = r.id;
    await page.click('#btn-from-planning'); await page.waitForSelector('#sfp-search'); await page.fill('#sfp-search', target.id); await page.waitForTimeout(400);
    if (await page.$('#sfp-list')) throw new Error('linked allocation still offered as unlinked');
    await page.check('.modal input[type=checkbox]'); await page.waitForTimeout(300); const txt = await page.textContent('.modal'); if (!txt.includes('Open trip')) throw new Error('linked allocation cannot be reopened from the list');
  });
  await step('S20 a linked allocation cannot be linked to a second trip (client and server), unless split by an authorised role with a reason', async () => {
    const r = await ev(async (id) => { const s = HB.app.store; const out = {}; try { await s.createTripFromAllocation(id, {}); out.dup = 'accepted'; } catch (e) { out.dup = e.code; } try { await s.createTripFromAllocation(id, { split: true, reason: 'x' }); out.split = 'accepted'; } catch (e) { out.split = e.code; } const t = s.trips().find((x) => x.allocationId === id); try { await s.saveTrip({ dateDispatched: t.dateDispatched, plate: t.plate, client: t.client, allocationId: id }, {}); out.raw = 'accepted'; } catch (e) { out.raw = e.code; } return out; }, (await ev((tid) => HB.app.store.raw(tid).allocationId, billTrip)));
    if (r.dup !== 'linked' || r.split !== 'forbidden' || r.raw === 'accepted') throw new Error(JSON.stringify(r));
    const srv = await fetch(BASE + '/api/trips/from-allocation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allocationId: 'x' }) }); if (srv.status !== 401 && srv.status !== 404) throw new Error('server route unauthenticated status ' + srv.status);
  });
  await step('S21 Fleet Planner can split an allocation with a reason; the second trip is linked and audited', async () => {
    await logout(); await login('planner', 'Planner@2026');
    const r = await ev(async (tid) => { const s = HB.app.store; const id = s.raw(tid).allocationId; try { await s.createTripFromAllocation(id, { split: true, reason: '' }); return { noReason: 'accepted' }; } catch (e) { if (e.code !== 'invalid') return { noReason: e.code }; } const t2 = await s.createTripFromAllocation(id, { split: true, reason: 'Load carried in two legs' }); await new Promise((r) => setTimeout(r, 300)); const a = s.state.allocations.find((x) => x.id === id); return { t2: t2.id, split: a.split, splitTrips: a.splitTripIds, linked: a.tripLogId, note: t2.note }; }, billTrip);
    if (!r.t2 || !r.split || !(r.splitTrips || []).includes(r.t2) || r.linked !== billTrip || !/two legs/.test(r.note)) throw new Error(JSON.stringify(r));
  });
  await step('S22 credit note reduces the client balance on a sent invoice without altering the invoice; invoice stays issued/sent', async () => {
    await logout(); await login('billing', 'Billing@2026');
    const r = await ev(async (tid) => { const s = HB.app.store; const E = HB.engine; await s.saveTrip({ id: tid, sellingPrice: 1000000 }, { expectedVersion: s.raw(tid).version }); const t = s.trip(tid); const inv = { id: 'inv-cn-' + Date.now(), number: E.generateInvoiceNumber(t.client, t.dateDispatched, s.state.invoices.map((i) => i.number), s.state.clients), client: t.client, invoiceDate: s.planningCtx().today, dueDate: E.addDays(s.planningCtx().today, 7), fromMonth: t.month, toMonth: t.month, priceType: 'exclusive', vatRate: 0.075, tripIds: [tid], lines: [], subtotal: 1000000, vat: 75000, total: 1075000, status: 'Draft' }; await s.saveDoc('invoices', inv); await s.saveTrip({ id: tid, invoiceId: inv.id, invoiceNo: inv.number, invoiceStatus: 'Draft Invoice' }, { expectedVersion: s.raw(tid).version }); await s.saveDoc('invoices', { id: inv.id, status: 'Sent', issuedAt: new Date().toISOString(), sentAt: new Date().toISOString() }, { expectedVersion: s.state.invoices.find((i) => i.id === inv.id).version }); await s.saveTrip({ id: tid, invoiceStatus: 'Invoice Sent' }, { expectedVersion: s.raw(tid).version }); return { inv: inv.id, balance: s.trip(tid).balance }; }, billTrip);
    await page.evaluate(() => { location.hash = '#invoices'; }); await page.waitForTimeout(600); await ev((id) => HB.views.invoices.openInvoice(HB.views.invoices.ctx, id), r.inv); await page.waitForSelector('.modal-foot');
    await page.click('.modal-foot button:has-text("Issue credit note")'); const top = '#modal-root .overlay:last-child '; await page.waitForSelector(top + '.modal input[type=number]'); await page.fill(top + '.modal input[type=number]', '75000'); await page.fill(top + '.modal input[type=text]', 'Rate correction agreed'); await page.click(top + '.modal-foot button:has-text("Issue credit note")'); await page.waitForTimeout(1200);
    const out = await ev((p) => { const s = HB.app.store; const t = s.trip(p.tid); const inv = s.state.invoices.find((i) => i.id === p.inv); const cn = s.state.invoices.find((i) => i.type === 'credit' && i.againstId === p.inv); const pay = s.state.payments.find((x) => x.kind === 'credit' && x.invoiceId === p.inv); return { balance: t.balance, pay: t.paymentLabel, invStatus: inv.status, invTotal: inv.total, cn: cn && cn.number, cnAmount: cn && cn.amount, ledger: !!pay, tripInv: t.invoiceStatus }; }, { tid: billTrip, inv: r.inv });
    if (Math.abs(out.balance - (r.balance - 75000)) > 0.01 || out.pay !== 'Part Paid' || out.invStatus !== 'Sent' || out.invTotal !== 1075000 || !/^CN-/.test(out.cn || '') || out.cnAmount !== 75000 || !out.ledger || out.tripInv !== 'Invoice Sent') throw new Error(JSON.stringify(out));
  });
  // S23-S30 dispatch, diesel, lost sales, location and distance masters (fourth brief)
  await step('S23 Settings shows the consumption matrix, Route Distance Master and Location Master; admin verifies a distance', async () => {
    await logout(); await login('admin', 'Admin@2026'); await page.evaluate(() => { location.hash = '#settings'; }); await page.waitForTimeout(900);
    const txt = await page.textContent('#content'); for (const k of ['Diesel consumption matrix', 'Route Distance Master', 'Location Master']) if (!txt.includes(k)) throw new Error('missing ' + k);
    const r = await ev(async () => { const s = HB.app.store; const d = s.state.distances.find((x) => x.destState === 'Kano'); await s.saveDoc('distances', { id: d.id, verified: true, verifiedBy: s.user.username, verifiedAt: new Date().toISOString(), oneWayKm: 1000, returnKm: 1000, totalKm: 2000 }, { expectedVersion: d.version }); const nd = s.state.distances.find((x) => x.id === d.id); const calc = HB.dispatch.resolveDistance({ originState: 'Lagos', destState: 'Kano' }, s.dispatchCtx()); return { verified: nd.verified, by: nd.verifiedBy, src: calc.source, km: calc.totalKm }; });
    if (!r.verified || r.src !== 'approved' || r.km !== 2000) throw new Error(JSON.stringify(r));
  });
  await step('S24 Location Master: an ambiguous location is confirmed by the administrator and reused everywhere', async () => {
    const r = await ev(async () => { const s = HB.app.store; const G = HB.geo; const before = G.standardize('Ejigbo', s.state.locationMaster); const m = Object.assign({}, s.state.locationMaster); m[G.key('Ejigbo')] = Object.assign({}, m[G.key('Ejigbo')] || { name: 'Ejigbo' }, { state: 'Lagos', status: 'approved', source: 'corrected by administrator' }); await s.saveLocationMaster(m, 'Ejigbo → Lagos'); return { before: before.confidence, after: s.stateOf('Ejigbo'), orig: 'Ejigbo', trip: HB.engine.computeTrip({ client: 'A', plate: 'T-1678LA', loadingFrom: 'Apapa', loadingTo: 'Ejigbo', dateDispatched: '2026-10-01' }, s.ctx()) }; });
    if (r.before !== 'ambiguous' || r.after !== 'Lagos' || r.trip.loadingState !== 'Lagos' || r.trip.deliveryState !== 'Lagos' || r.trip.loadingTo !== 'Ejigbo') throw new Error(JSON.stringify({ before: r.before, after: r.after, ls: r.trip.loadingState, ds: r.trip.deliveryState, to: r.trip.loadingTo }));
  });
  let dspId;
  await step('S25 dispatch form: planner prepares it from the linked trip with diesel and road expenses calculated from the approved distance and matrix', async () => {
    await logout(); await login('planner', 'Planner@2026');
    const r = await ev(async () => { const s = HB.app.store; const D = HB.dispatch; const t = s.trips().find((x) => x.allocationId && !s.state.dispatches.some((d) => d.tripLogId === x.id)); const calc = D.dispatchCalc(t, s.dispatchCtx()); return { tripId: t.id, cat: calc.category, rate: calc.rate, km: calc.distance.totalKm, src: calc.distance.source, diesel: calc.diesel, road: calc.road, ready: calc.ready, issues: calc.issues }; });
    if (r.diesel === null || r.road === null) throw new Error(JSON.stringify(r));
    if (Math.abs(r.diesel - r.km * r.rate) > 0.02 || Math.abs(r.road - r.km * 25) > 0.02) throw new Error('formula ' + JSON.stringify(r));
    await page.evaluate(() => { location.hash = '#dispatch'; }); await page.waitForTimeout(600); await ev((id) => HB.views.dispatch.openForTrip(HB.views.dispatch.ctx, id), r.tripId); await page.waitForSelector('.modal-foot');
    const txt = await page.textContent('.modal'); for (const k of ['Outbound diesel', 'Return diesel', 'Total diesel allowance', 'Road expense rate', 'Total road expense allowance']) if (!txt.includes(k)) throw new Error('missing ' + k);
    const btn = await page.$('.modal-foot button:has-text("Submit for approval")'); const draft = await page.$('.modal-foot button:has-text("Save as draft")'); if (!btn && !draft) throw new Error('no save buttons');
    if (btn && !(await btn.isDisabled())) await btn.click(); else await draft.click(); await page.waitForTimeout(900);
    const d = await ev((id) => { const s = HB.app.store; const d = s.state.dispatches.find((x) => x.tripLogId === id); return d && { id: d.id, number: d.number, status: HB.dispatch.dispatchStatus(d), budget: d.budgetDiesel, approved: d.approvedDiesel, road: d.approvedRoad, fin: d.financeRequired }; }, r.tripId);
    if (!d || !/^DSP-\d{6}-\d{2}$/.test(d.number) || d.approved !== d.budget) throw new Error(JSON.stringify(d)); dspId = d.id;
    if (d.status === 'Draft') await ev(async (id) => { const s = HB.app.store; const d = s.state.dispatches.find((x) => x.id === id); await s.saveDoc('dispatches', { id, submittedAt: new Date().toISOString() }, { expectedVersion: d.version }); }, dspId);
  });
  await step('S26 approval workflow: planner cannot approve; operations manager approves; finance approves when required; nothing counts as issued yet', async () => {
    const no = await ev(async (id) => { const s = HB.app.store; const d = s.state.dispatches.find((x) => x.id === id); try { await s.saveDoc('dispatches', { id, opsApprovedAt: new Date().toISOString(), opsApprovedBy: 'planner' }, { expectedVersion: d.version }); return 'accepted'; } catch (e) { return e.code; } }, dspId);
    if (no === 'accepted' && HB_MODE === 'server') throw new Error('planner approved a dispatch');
    await logout(); await login('ops', 'Ops@2026'); await page.evaluate(() => { location.hash = '#dispatch'; }); await page.waitForTimeout(600); await ev((id) => HB.views.dispatch.openDispatch(HB.views.dispatch.ctx, id), dspId); await page.waitForSelector('.modal-foot');
    const approve = await page.$('.modal-foot button:has-text("Approve dispatch (Operations)")'); if (!approve) throw new Error('no operations approval button'); await approve.click(); await page.waitForTimeout(900);
    let st = await ev((id) => HB.dispatch.dispatchStatus(HB.app.store.state.dispatches.find((x) => x.id === id)), dspId);
    if (st === 'Awaiting Finance') { await logout(); await login('finance', 'Finance@2026'); await ev(async (id) => { const s = HB.app.store; const d = s.state.dispatches.find((x) => x.id === id); await s.saveDoc('dispatches', { id, financeApprovedAt: new Date().toISOString(), financeApprovedBy: s.user.username }, { expectedVersion: d.version }); }, dspId); st = await ev((id) => HB.dispatch.dispatchStatus(HB.app.store.state.dispatches.find((x) => x.id === id)), dspId); }
    if (st !== 'Approved') throw new Error('status ' + st);
    const t = await ev((id) => HB.dispatch.approvedTotals(HB.app.store.state.dispatches.find((x) => x.id === id)), dspId); if (t.dieselIssued !== 0 || t.roadPaid !== 0) throw new Error('issued before recording');
  });
  await step('S27 issuance: diesel and road expenses recorded separately; over-issue and duplicate issue refused; supplementary needs approval', async () => {
    await logout(); await login('ops', 'Ops@2026');
    const r = await ev(async (id) => { const s = HB.app.store; const out = {}; const get = () => s.state.dispatches.find((x) => x.id === id); let d = get();
      const issue = async (kind, qty, suppId) => { const cur = get(); const why = HB.dispatch.issueError(cur, kind, qty, suppId); if (why) return why; const list = kind === 'diesel' ? 'dieselIssues' : 'expensePayments'; const entry = { id: 'x' + Date.now() + Math.random(), [kind === 'diesel' ? 'litres' : 'amount']: qty, type: suppId ? 'supplementary' : 'initial', supplementaryId: suppId || '', by: s.user.username, at: new Date().toISOString(), ref: 'REF-' + kind }; try { await s.saveDoc('dispatches', { id, [list]: [...(cur[list] || []), entry] }, { expectedVersion: cur.version }); return ''; } catch (e) { return e.message; } };
      out.over = await issue('diesel', d.approvedDiesel + 100); out.ok = await issue('diesel', d.approvedDiesel); out.dup = await issue('diesel', 10); out.statusAfterDiesel = HB.dispatch.dispatchStatus(get());
      out.road = await issue('road', get().approvedRoad); out.status = HB.dispatch.dispatchStatus(get());
      d = get(); await s.saveDoc('dispatches', { id, supplementary: [{ id: 'sup1', kind: 'diesel', qty: 40, reason: 'Diversion', requestedBy: s.user.username, requestedAt: new Date().toISOString(), status: 'Pending' }] }, { expectedVersion: d.version });
      out.suppPending = await issue('diesel', 40, 'sup1');
      d = get(); await s.saveDoc('dispatches', { id, supplementary: [Object.assign({}, d.supplementary[0], { status: 'Approved', decidedBy: s.user.username, decidedAt: new Date().toISOString() })] }, { expectedVersion: d.version });
      out.suppOk = await issue('diesel', 40, 'sup1'); out.suppDup = await issue('diesel', 40, 'sup1'); const c = HB.dispatch.expenseControl(get()); out.control = { issued: c.dieselIssued, approved: c.approvedDiesel, supp: c.supplementaryDiesel, variance: c.dieselVariance }; return out; }, dspId);
    if (!/exceeds/.test(r.over) || r.ok !== '' || !/already/.test(r.dup) || r.statusAfterDiesel !== 'Partly Dispatched' || r.road !== '' || r.status !== 'Dispatched' || !/not approved/.test(r.suppPending) || r.suppOk !== '' || !/already/.test(r.suppDup) || r.control.supp !== 40 || r.control.variance !== 0) throw new Error(JSON.stringify(r));
  });
  await step('S28 expense control, dispatch dashboard, assistant and PDF button', async () => {
    await page.evaluate(() => { location.hash = '#dispatch'; }); await page.waitForTimeout(600);
    await page.click('button:has-text("Trip expense control")'); await page.waitForTimeout(500); let txt = await page.textContent('#dsp-view'); for (const k of ['Budget diesel', 'Approved', 'Issued', 'Variance', 'Supplementary diesel issued']) if (!txt.includes(k)) throw new Error('control missing ' + k);
    await page.click('button:has-text("Dashboard")'); await page.waitForTimeout(500); txt = await page.textContent('#dsp-view'); for (const k of ['Total planned trips', 'Awaiting dispatch approval', 'Approved, awaiting diesel', 'Diesel required (planned trips)', 'Diesel issued', 'Road expenses required', 'Road expenses paid', 'Additional diesel requests', 'Available trucks not planned', 'Confirmed lost sales', 'Diesel variance by truck', 'Diesel by vehicle category', 'Diesel by route']) if (!txt.includes(k)) throw new Error('dashboard missing ' + k);
    await page.click('button:has-text("Assistant & checks")'); await page.waitForTimeout(400); await page.fill('#asst-q', 'Which trucks have received diesel above the approved allowance?'); await page.keyboard.press('Enter'); await page.waitForTimeout(400); txt = await page.textContent('#asst-out'); if (!/answered from live records/.test(txt)) throw new Error('assistant did not answer');
    const n = await ev(() => HB.dispatch.QUESTIONS.filter((q) => HB.dispatch.assistant(q, HB.app.store.dispatchCtx())).length); if (n !== 9) throw new Error('assistant answered ' + n + ' of 9');
    await page.click('button:has-text("Dispatch forms")'); await page.waitForTimeout(500); if (!(await page.$('#dsp-table button:has-text("PDF")'))) throw new Error('no PDF button');
  });
  await step('S29 bulk cancellation of client requests with reason, truck release and lost-sales records', async () => {
    await logout(); await login('planner', 'Planner@2026'); await page.evaluate(() => { location.hash = '#planning'; }); await page.waitForTimeout(600);
    const pick = await ev(() => { const s = HB.app.store; const rows = HB.views.planning.requestRows(s).filter((r) => !['Completed', 'Cancelled'].includes(r.liveStatus) && r.counts.outstanding > 0).slice(0, 2); return rows.map((r) => r.id); }); if (pick.length < 2) throw new Error('need two open requests');
    for (const id of pick) await ev((id) => { const row = [...document.querySelectorAll('#req-table tbody tr')].find((tr) => tr.textContent.includes(id)); row.querySelector('input.req-pick').click(); }, id); await page.waitForTimeout(300);
    await page.click('#btn-cancel-selected'); await page.waitForSelector('#btn-confirm-cancel'); await page.click('#btn-confirm-cancel'); await page.waitForTimeout(600);
    const confirm = await page.$('.overlay:last-child .modal-foot button:has-text("Release trucks")'); if (confirm) { await confirm.click(); await page.waitForTimeout(1500); } else await page.waitForTimeout(1200);
    const r = await ev((ids) => { const s = HB.app.store; return ids.map((id) => { const req = s.state.requests.find((x) => x.id === id); const ls = s.state.lostsales.find((x) => x.requestId === id); const live = s.state.allocations.filter((a) => a.requestId === id && !['Cancelled', 'Completed'].includes(a.status)).length; return { id, status: req.status, reason: req.cancelReason, by: req.cancelledBy, ls: ls && { kind: ls.kind, trucks: ls.unfulfilledTrucks, lost: ls.estimatedLost, rate: ls.agreedRate }, live, exists: !!req }; }); }, pick);
    for (const x of r) { if (!x.exists || x.status !== 'Cancelled' || !x.reason || !x.by || !x.ls || x.ls.kind !== 'Confirmed lost sale' || x.live) throw new Error(JSON.stringify(x)); if (x.ls.rate && Math.abs(x.ls.lost - x.ls.trucks * x.ls.rate) > 0.01) throw new Error('lost sales formula ' + JSON.stringify(x.ls)); }
    await page.evaluate(() => { location.hash = '#lostsales'; }); await page.waitForTimeout(600); const txt = await page.textContent('#ls-view'); if (!txt.includes('Confirmed lost sales') || !txt.includes(pick[0])) throw new Error('lost sales view'); await page.click('button:has-text("Reports")'); await page.waitForTimeout(400); if (!(await page.textContent('#ls-view')).includes('Confirmed lost sales by client')) throw new Error('reports tab');
  });
  await step('S30 tracking officer and management are read-only on dispatch, requests and masters', async () => {
    await logout(); await login('manager', 'Manager@2026'); await page.evaluate(() => { location.hash = '#dispatch'; }); await page.waitForTimeout(600);
    const r = await ev(() => { const E = HB.engine; return { prep: E.can('management', 'dispatch.prepare'), appr: E.can('management', 'dispatch.approve'), dist: E.can('management', 'distance.manage'), loc: E.can('tracking', 'location.manage'), req: E.can('tracking', 'request.manage'), fin: E.can('finance', 'dispatch.finance'), opsFin: E.can('operations', 'dispatch.finance') }; });
    if (r.prep || r.appr || r.dist || r.loc || r.req || !r.fin || r.opsFin) throw new Error(JSON.stringify(r));
    if (await page.$('#req-bulk')) throw new Error('management sees bulk cancel');
  });

  await browser.close();
  for (const [s, n] of results) console.log(s, n);
  const fails = results.filter((r) => r[0] === 'FAIL').length; console.log(`\n${results.length - fails}/${results.length} passed`);
  if (errors.length) { console.log('\nBrowser errors:'); for (const e of [...new Set(errors)].slice(0, 20)) console.log(' -', e); }
  process.exit(fails || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
