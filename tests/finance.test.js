/* Setup brief: LOB and cost centers, OTD bands vs journey planning, KPI diesel categories, expense account mapping and
 * the derived ledger, posting validation, rate-card costing, trip P&L, financial closure, workshop job cards and stock. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../js/core/engine.js');
const P = require('../js/core/planning.js');
const D = require('../js/core/dispatch.js');
const WS = require('../js/core/workshop.js');
const F = require('../js/core/finance.js');

const W = path.join(__dirname, '..', 'data', 'workbook');
const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8'));
const assets = read('assets.json'), costcenters = read('costcenters.json'), lob = read('lob.json'), accounts = read('accounts.json'), accountmap = read('accountmap.json'), ratecard = read('ratecard.json'), routes = read('routes.json'), planning = read('planning.json'), items = read('items.json'), staff = read('staff.json');
const baseCtx = () => ({ assets, costcenters, lob, accounts, accountmap, ratecard, routes, planning, items, trips: [], dieselreqs: [], roadslips: [], extraexpenses: [], requests: [], invoices: [], payments: [], jobcards: [], stockmoves: [], postings: [], today: '2026-10-15', now: '2026-10-15T12:00:00Z' });

test('masters: every asset has a cost center in the master; staff and LOB imported; unclassified batches flagged, nothing invented', () => {
  const ccIds = new Set(costcenters.map((c) => c.id));
  assert.ok(assets.length >= 124); assert.ok(assets.filter((a) => a.setupMaster).every((a) => ccIds.has(a.costCenter)));
  assert.equal(lob.length, 6); assert.ok(lob.some((l) => l.name === 'Haulage') && lob.some((l) => l.name === '3PL'));
  assert.equal(staff.length, 131); assert.ok(staff.every((s) => /^\d{6}$/.test(s.id) && s.costCenter));
  assert.ok(assets.filter((a) => a.batchUnclassified).length > 0, 'batch not invented for vehicles without a classification');
  assert.ok(items.every((i) => i.stockQty === 0 && i.stockSupplied === false), 'stock quantities were not supplied');
  assert.equal(read('tplrates.json').filter((l) => Object.values(l.rates).some((v) => v !== null)).length, 0, '3PL rate card stays blank');
});

test('LOB: default from the asset cost center, 3PL trips default to 3PL, allocation must carry a LOB before the trip is created', () => {
  const flat = assets.find((a) => a.costCenter === 'CC046'); const hiab = assets.find((a) => a.costCenter === 'CC039');
  assert.equal(E.lobFor({}, flat, costcenters), 'Haulage'); assert.equal(E.lobFor({}, hiab, costcenters), 'Hiab'); assert.equal(E.lobFor({ serviceType: '3rd Party Contractor' }, null, costcenters), '3PL');
  const t = E.computeTrip({ plate: flat.plate, client: 'X', dateDispatched: '2026-10-15', sellingPrice: 100 }, { assets, costcenters, settings: {} }); assert.equal(t.lob, 'Haulage'); assert.equal(t.lobSource, 'cost center default'); assert.equal(t.finStatus, 'Open'); assert.equal(t.costCenter, 'CC046');
  const t2 = E.computeTrip({ plate: flat.plate, client: 'X', dateDispatched: '2026-10-15', lob: 'Port Operations' }, { assets, costcenters, settings: {} }); assert.equal(t2.lob, 'Port Operations'); assert.equal(t2.lobSource, 'allocation');
  assert.match(P.allocationLobError({ id: 'ALC-1' }, lob), /no Line of Business/); assert.match(P.allocationLobError({ id: 'ALC-1', lob: 'Space' }, lob), /not in the LOB master/); assert.equal(P.allocationLobError({ id: 'ALC-1', lob: 'Haulage' }, lob), '');
  const trip = P.tripFromAllocation({ id: 'ALC-1', plate: flat.plate, client: 'X', lob: 'Haulage', plannedLoadingDate: '2026-10-20' }, { id: 'R1' }, { tripId: 'JMG-TRP-2026-000009', route: routes.find((r) => r.id === 'R001'), planning }); assert.equal(trip.lob, 'Haulage'); assert.equal(trip.finStatus, 'Open'); assert.equal(trip.otdTargetHours, 72);
});

test('OTD bands and operational journey planning are kept apart; conflicts flagged; above 1,500 km needs an approved KPI', () => {
  assert.equal(P.otdTarget(60).hours, 24); assert.equal(P.otdTarget(101).hours, 36); assert.equal(P.otdTarget(500).hours, 48); assert.equal(P.otdTarget(876).hours, 72); assert.equal(P.otdTarget(1500).hours, 96); assert.equal(P.otdTarget(1600).hours, null); assert.equal(P.otdTarget(1600, null, { approvedOtdHours: 120 }).hours, 120);
  const local = P.journeyPlan(60); assert.ok(local.local); assert.equal(local.totalDays, 1); assert.equal(local.deliveryHours, 24, 'loading and offloading are not added again for local deliveries');
  const far = P.journeyPlan(876, null, 876); assert.equal(far.drivingDaysOut, 3); assert.equal(far.drivingDaysBack, 3); assert.equal(far.totalDays, 8); assert.equal(far.deliveryHours, 72, 'delivery leg = driving days out; allowances are in the total, not double counted');
  assert.equal(P.routeKpi({ kmOneWay: 876, kmReturn: 876 }, planning).conflict, false, '3 driving days = 72 h meets the 72 h band');
  const k = P.routeKpi({ kmOneWay: 950, kmReturn: 950 }, planning); assert.ok(k.conflict, '4 driving days = 96 h exceeds the 72 h band'); assert.match(k.conflictNote, /Operations Manager review/);
  assert.equal(P.routeKpi({ kmOneWay: 120 }, planning).conflict, false);
});

test('TAT: delivery leg measured against the OTD target; local trips include handling', () => {
  const t = { milestones: { allocatedAt: '2026-10-10T06:00:00Z', loadedAt: '2026-10-10T10:00:00Z', arrivedClientAt: '2026-10-12T08:00:00Z', offloadedAt: '2026-10-12T14:00:00Z', leftClientAt: '2026-10-12T15:00:00Z', arrivedBackAt: '2026-10-14T18:00:00Z' }, otdTargetHours: 72, tatTargetDays: 8 };
  const c = P.tatCalc(t, 8, '2026-10-15T00:00:00Z'); assert.equal(c.deliveryHours, 46); assert.equal(c.otdStatus, 'On Time'); assert.equal(c.status, 'Completed Within Target');
  const late = P.tatCalc(Object.assign({}, t, { otdTargetHours: 36 }), 8, '2026-10-15T00:00:00Z'); assert.equal(late.otdStatus, 'Late'); assert.equal(late.otdVarianceHours, 10);
  const loc = P.tatCalc(Object.assign({}, t, { otdTargetHours: 24, otdLocal: true }), 1, '2026-10-15T00:00:00Z'); assert.equal(loc.deliveryHours, 56); assert.equal(loc.otdStatus, 'Late');
  const dash = P.tatDashboard([Object.assign({ id: 'a', allocationId: 'x', plate: 'P', client: 'C', opsStatus: 'Open' }, t)], routes, '2026-10-15T00:00:00Z'); assert.equal(dash.otdPct, 100); assert.equal(dash.otdOnTime, 1);
});

test('expense accounts: category → GL account, diesel by vehicle class, pending accounts flagged, revenue accounts missing', () => {
  const ctx = baseCtx();
  assert.equal(F.accountFor('road', {}, ctx).number, '6101027'); assert.equal(F.accountFor('diesel', {}, ctx).number, '6103009'); assert.equal(F.accountFor('diesel', { isHiab: true }, ctx).number, '6103008');
  assert.equal(F.accountFor('extra', { category: 'Toll / levy' }, ctx).number, '6105047'); assert.equal(F.accountFor('extra', { category: 'Towing' }, ctx).number, '6105040'); assert.equal(F.accountFor('tpl', { equipment: 'Crane-100T' }, ctx).number, '6105002'); assert.equal(F.accountFor('maintenance', { itemClass: 'Tyre' }, ctx).number, '6102028');
  const cng = F.accountFor('diesel', { isCng: true }, ctx); assert.ok(cng.pending); assert.match(cng.missing, /pending a GL number/);
  const rev = F.accountFor('revenue', { lob: 'Haulage' }, ctx); assert.equal(rev.id, null); assert.match(rev.missing, /revenue accounts not supplied/);
  assert.equal(F.costCenterOf({ plate: assets[0].plate }, ctx).valid, true); assert.match(F.costCenterOf({ plate: 'ZZZ-1' }, ctx).missing, /No cost center/);
});

test('ledger: requested / approved / paid stages from the documents; postings need the mappings and only paid amounts post once', () => {
  const ctx = baseCtx(); const flat = assets.find((a) => a.costCenter === 'CC046');
  const trip = E.computeTrip({ id: 't1', plate: flat.plate, client: 'Jamara', dateDispatched: '2026-10-15', journeyPlanId: 'JMG-TRP-2026-000001', lob: 'Haulage', sellingPrice: 500000 }, { assets, costcenters, settings: {} }); ctx.trips = [trip];
  ctx.dieselreqs = [{ id: 'd1', number: 'DSL-1', tripLogId: 't1', plate: flat.plate, client: 'Jamara', category: 'Flatbed', approvedQty: 100, submittedAt: '2026-10-15T08:00:00Z', opsApprovedAt: '2026-10-15T09:00:00Z', opsApprovedBy: 'ops', issues: [{ id: 'i1', qty: 100, type: 'initial', at: '2026-10-15T10:00:00Z', by: 'finance', station: 'Ibafo' }], supplementary: [] }];
  ctx.extraexpenses = [{ id: 'AEX-1', tripLogId: 't1', plate: flat.plate, client: 'Jamara', category: 'Toll / levy', amountRequested: 15000, approvedAmount: 15000, status: 'Paid', requestedAt: '2026-10-15T08:00:00Z', decidedAt: '2026-10-15T09:00:00Z', decidedBy: 'ops', paidAt: '2026-10-15', paidBy: 'finance', paymentRef: 'PV-1' }];
  const lines = F.ledgerLines(ctx);
  const diesel = lines.filter((l) => l.kind === 'diesel'); assert.deepEqual(diesel.map((l) => l.stage).sort(), ['approved', 'paid', 'requested']); const paid = diesel.find((l) => l.stage === 'paid'); assert.equal(paid.amount, 100 * planning.setup.dieselPrice); assert.equal(paid.glAccount, '6103009'); assert.equal(paid.costCenter, 'CC046'); assert.equal(paid.lob, 'Haulage'); assert.ok(paid.ready);
  const toll = lines.find((l) => l.kind === 'extra' && l.stage === 'paid'); assert.equal(toll.glAccount, '6105047'); assert.equal(toll.amount, 15000);
  assert.match(F.postingError(diesel.find((l) => l.stage === 'approved'), 'finance'), /Only paid/); assert.match(F.postingError(paid, 'billing'), /Only Finance/); assert.equal(F.postingError(paid, 'finance'), '');
  const unmapped = F.ledgerLines(Object.assign({}, ctx, { accountmap: Object.assign({}, accountmap, { categoryAccounts: {} }) })).find((l) => l.kind === 'extra' && l.stage === 'paid'); assert.ok(!unmapped.ready); assert.match(F.postingError(unmapped, 'finance'), /Mandatory financial mapping missing/);
  const posting = F.postingFrom(paid, 'finance', '2026-10-15T11:00:00Z', []); assert.equal(posting.debitCredit, 'debit'); assert.match(posting.number, /^PST-261015-001$/);
  const after = F.ledgerLines(Object.assign({}, ctx, { postings: [posting] })).find((l) => l.id === paid.id); assert.ok(after.posted); assert.match(F.postingError(after, 'finance'), /already posted/);
  const sum = F.ledgerSummary(lines, (l) => l.costCenter); assert.equal(sum[0].key, 'CC046');
});

test('costing from the rate card and trip P&L: actual recorded costs, allocations labelled, selling price never overwritten', () => {
  const ctx = baseCtx(); const rc = ratecard.find((r) => assets.some((a) => a.assetCode === r.assetCode && a.costCenter === 'CC046')); const asset = assets.find((a) => a.assetCode === rc.assetCode);
  const route = routes.find((r) => r.kmOneWay && r.status === 'Approved' && r.client === 'Jamara');
  const trip = E.computeTrip({ id: 't1', plate: asset.plate, client: route.client, loadingFrom: route.loadingPoint, loadingTo: route.destination, routeMasterId: route.id, dateDispatched: '2026-10-15', journeyPlanId: 'JMG-TRP-2026-000002', lob: 'Haulage', sellingPrice: 2000000, invoiceId: 'inv1' }, { assets, costcenters, settings: {}, invoices: [{ id: 'inv1', issuedAt: '2026-10-16T00:00:00Z', status: 'Issued', subtotal: 2000000, tripIds: ['t1'] }] });
  ctx.trips = [trip]; ctx.invoices = [{ id: 'inv1', issuedAt: '2026-10-16T00:00:00Z', status: 'Issued', subtotal: 2000000, tripIds: ['t1'] }];
  const c = F.tripCosting(trip, ctx); assert.ok(c.available, c.reason); assert.equal(c.km.totalKm, route.totalKm); assert.equal(c.components.length, 5); assert.equal(c.sellingPrice, 2000000, 'selling price untouched'); assert.ok(c.total > 0); assert.equal(c.expectedMargin, E.round2(2000000 - c.total));
  const dieselComp = c.components.find((x) => x.key === 'diesel'); assert.equal(dieselComp.amount, E.round2(E.round2(route.totalKm * rc.consumptionLPerKm) * planning.setup.dieselPrice));
  const p0 = F.tripPnl(trip, ctx); assert.equal(p0.revenue, 2000000); assert.equal(p0.direct.diesel, 0, 'approved allowances are not costs until issued'); assert.equal(p0.allocatedTotal, E.round2(c.components.find((x) => x.key === 'mtc').amount + c.components.find((x) => x.key === 'tyre').amount + c.components.find((x) => x.key === 'fixed').amount)); assert.ok(p0.notes.some((n) => /Allocated costs from the rate card/.test(n)));
  ctx.dieselreqs = [{ id: 'd1', number: 'DSL-1', tripLogId: 't1', plate: asset.plate, approvedQty: 300, opsApprovedAt: 'x', issues: [{ id: 'i1', qty: 280, type: 'initial', at: '2026-10-15T10:00:00Z', by: 'ops' }], supplementary: [] }];
  ctx.roadslips = [{ id: 'r1', number: 'RXP-1', tripLogId: 't1', plate: asset.plate, approvedQty: 50000, opsApprovedAt: 'x', issues: [{ id: 'p1', qty: 50000, type: 'initial', at: '2026-10-15T10:00:00Z', by: 'finance' }], supplementary: [] }];
  ctx.invoices.push({ id: 'cn1', type: 'credit', againstId: 'inv1', amount: 100000, net: 100000 });
  const p = F.tripPnl(trip, ctx); assert.equal(p.revenue, 1900000); assert.equal(p.direct.diesel, 280 * planning.setup.dieselPrice); assert.equal(p.direct.road, 50000); assert.equal(p.contribution, E.round2(1900000 - p.directTotal)); assert.equal(p.operatingProfit, E.round2(p.contribution - p.allocatedTotal)); assert.ok(p.grossMarginPct > p.operatingMarginPct);
  const notInv = F.tripPnl(E.computeTrip({ id: 't2', plate: asset.plate, client: 'X', dateDispatched: '2026-10-15', sellingPrice: 100 }, { assets, costcenters, settings: {} }), ctx); assert.equal(notInv.revenue, null); assert.equal(notInv.contribution, null);
  const tpl = F.tripCosting({ serviceType: '3rd Party Contractor', contractorCost: 7200000, sellingPrice: 9000000, plate: 'KJA-1' }, ctx); assert.equal(tpl.expectedMargin, 1800000); assert.equal(tpl.marginPct, 20);
  const summary = F.pnlSummary([trip], ctx, (t) => t.lob); assert.equal(summary[0].key, 'Haulage'); assert.equal(summary[0].revenue, 1900000);
});

test('financial closure is separate from operational closure and belongs to Finance', () => {
  const t = { id: 't1', journeyPlanId: 'JMG-TRP-2026-000003', invoiceStatus: 'Not Invoiced', balance: null, opsStatus: 'Closed', finStatus: 'Open' };
  assert.match(F.finClosureError(t, {}, 'operations'), /Only Finance/); assert.match(F.finClosureError(t, {}, 'finance'), /still not invoiced/); assert.equal(F.finClosureError(t, { reason: 'No billing: internal move' }, 'finance'), '');
  assert.equal(F.finClosureError({ id: 't2', invoiceStatus: 'Invoice Sent', balance: 0, paymentStatus: 'Paid' }, {}, 'finance'), ''); assert.match(F.finClosureError({ id: 't3', invoiceStatus: 'Invoice Sent', balance: 5000 }, {}, 'finance'), /balance ₦5000 outstanding/);
  assert.match(F.finClosureError({ id: 't4', finStatus: 'Closed' }, {}, 'finance'), /already financially closed/);
});

test('workshop: job card workflow, approval right, parts issue rules (approved job, duplicates, negative stock) and costs', () => {
  const job = { id: 'j1', number: 'JC-261015-01', plate: 'T-2404LA', status: 'Job Card Open', requiredParts: [] };
  assert.equal(WS.jobTransitionError(null, { status: 'Defect Reported' }, 'workshop'), ''); assert.match(WS.jobTransitionError(null, { status: 'Defect Reported' }, 'billing'), /workshop team/);
  assert.match(WS.jobTransitionError(job, Object.assign({}, job, { status: 'Approved' }), 'workshop'), /Approve only after/); assert.match(WS.jobTransitionError(job, Object.assign({}, job, { status: 'Approved', labourCost: 20000 }), 'storekeeper'), /Workshop Manager/); assert.equal(WS.jobTransitionError(job, Object.assign({}, job, { status: 'Approved', labourCost: 20000 }), 'workshop'), '');
  assert.match(WS.jobTransitionError(job, Object.assign({}, job, { status: 'Parts Issued' }), 'workshop'), /must be approved/); assert.match(WS.jobTransitionError(Object.assign({}, job, { status: 'Under Repair' }), Object.assign({}, job, { status: 'Released' }), 'workshop'), /quality inspection/);
  assert.equal(WS.jobTransitionError(Object.assign({}, job, { status: 'Quality Inspection' }), Object.assign({}, job, { status: 'Released', qualityCheckedBy: 'ws' }), 'workshop'), '');
  const item = Object.assign({}, items[0], { stockQty: 2, unitCost: 320000 }); const approved = Object.assign({}, job, { status: 'Approved' });
  assert.match(WS.partsIssueError(job, item, 1, []), /approved job card/); assert.match(WS.partsIssueError(approved, item, 3, []), /negative/); assert.equal(WS.partsIssueError(approved, item, 3, [], { allowNegative: true }), '');
  const moves = [{ id: 'm1', number: 'PIS-1', type: 'issue', jobCardId: 'j1', itemId: item.id, qty: 1, unitCost: 320000, at: '2026-10-15T10:00:00Z' }];
  assert.equal(WS.stockLevel(item, moves), 1); assert.match(WS.partsIssueError(approved, item, 1, moves, { now: '2026-10-15T10:05:00Z' }), /already issued/); assert.equal(WS.partsIssueError(approved, item, 1, moves, { now: '2026-10-15T10:05:00Z', allowDuplicate: true }), '');
  assert.deepEqual(WS.jobCosts(Object.assign({}, job, { labourCost: 25000, externalRepairCost: 0 }), moves), { labour: 25000, parts: 320000, external: 0, total: 345000 });
  const rep = WS.workshopReports({ jobcards: [Object.assign({}, job, { status: 'Under Repair', enteredAt: '2026-10-13T08:00:00Z', breakdownCategory: 'Engine', labourCost: 25000, costCenter: 'CC046' })], stockmoves: moves, items: [item], fleet: [{ plate: 'T-2404LA' }, { plate: 'T-2486LA' }], now: '2026-10-15T08:00:00Z' });
  assert.equal(rep.trucksInWorkshop, 1); assert.equal(rep.availabilityPct, 50); assert.equal(rep.costByTruck[0].cost, 345000); assert.equal(rep.partsByCategory[0].cost, 320000); assert.equal(rep.inWorkshop[0].downtimeDays, 2);
  assert.equal(WS.repeatRepairs([{ plate: 'A', breakdownCategory: 'Engine', number: '1', enteredAt: '2026-09-01', releasedAt: '2026-09-03' }, { plate: 'A', breakdownCategory: 'Engine', number: '2', enteredAt: '2026-09-20' }]).length, 1);
  assert.match(WS.moveError({ type: 'adjustment', qty: -1 }, item, [], 'storekeeper'), /needs a reason/); assert.match(WS.moveError({ type: 'receipt', qty: 5 }, item, [], 'workshop'), /Storekeeper/);
});

test('assistant answers the finance / workshop questions from records and says when data is missing', () => {
  const ctx = baseCtx(); const flat = assets.find((a) => a.costCenter === 'CC046');
  ctx.trips = [E.computeTrip({ id: 't1', plate: flat.plate, client: 'Jamara', dateDispatched: '2026-10-01', dateDelivered: '2026-10-05', journeyPlanId: 'JMG-TRP-2026-000004', lob: 'Haulage', sellingPrice: 500000, invoiceId: 'inv1', paymentStatus: 'Not Paid' }, { assets, costcenters, settings: {}, invoices: [{ id: 'inv1', issuedAt: '2026-10-06T00:00:00Z', status: 'Issued', subtotal: 500000, tripIds: ['t1'] }] }), E.computeTrip({ id: 't2', plate: flat.plate, client: 'SASO', dateDispatched: '2026-10-02', dateDelivered: '2026-10-04', journeyPlanId: 'JMG-TRP-2026-000005', sellingPrice: 300000 }, { assets, costcenters, settings: {} })];
  ctx.invoices = [{ id: 'inv1', issuedAt: '2026-10-06T00:00:00Z', status: 'Issued', subtotal: 500000, tripIds: ['t1'] }];
  const out = F.assistant('Which clients have the highest outstanding invoices?', ctx); assert.equal(out.rows[0].client, 'Jamara'); assert.ok(out.rows[0].outstanding > 500000);
  const pod = F.assistant('Which trips have not been invoiced due to missing PODs?', ctx); assert.equal(pod.rows.length, 1); assert.equal(pod.rows[0].client, 'SASO');
  const bud = F.assistant('Which cost centers are exceeding budget?', ctx); assert.match(bud.answer, /No cost center has a budget yet/);
  const lobQ = F.assistant('Which LOB is generating the highest profit?', ctx); assert.equal(lobQ.rows[0].key, 'Haulage');
  assert.equal(F.assistant('What is the meaning of life?', ctx), null);
  assert.equal(F.QUESTIONS.length, 8); assert.equal(D.QUESTIONS.length, 9);
});
