/* Browser acceptance run (not part of `npm test`): drives the app against a local server with Playwright.
 *   node server/seed.js && PORT=8099 node server/server.js &
 *   BASE=http://localhost:8099 node tests/e2e.acceptance.js
 * Covers the 18 acceptance scenarios of the fleet-planning brief at UI level where practical and via the store API otherwise. */
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');
const BASE = process.env.BASE || 'http://localhost:8099';
const results = []; const errors = [];
const step = async (name, fn) => { try { if (typeof closeModals === 'function') await closeModals(); await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name + ' — ' + (e.message || e).toString().split('\n')[0]]); } };
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route(/cdnjs|googleapis|gstatic/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('crash', () => errors.push('PAGE CRASHED')); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
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
  await browser.close();
  for (const [s, n] of results) console.log(s, n);
  const fails = results.filter((r) => r[0] === 'FAIL').length; console.log(`\n${results.length - fails}/${results.length} passed`);
  if (errors.length) { console.log('\nBrowser errors:'); for (const e of [...new Set(errors)].slice(0, 20)) console.log(' -', e); }
  process.exit(fails || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
