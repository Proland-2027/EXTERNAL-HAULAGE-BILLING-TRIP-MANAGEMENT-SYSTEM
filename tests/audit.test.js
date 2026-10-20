/* Audit & Control brief: comparison groups and rate opportunity (checked against the Client Rate Comparison 2026 workbook),
 * client ranking and verdicts, rate gaps by route, the three independent trip prices and audit statuses, truck-days and
 * revenue per truck-day, truck requirement, the rate-exception workflow (separation of duties, immutable history, the
 * Client Rate Card untouched), invoice / allocation controls, recommendations with calculations and the assistant. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../js/core/engine.js');
const A = require('../js/core/audit.js');

const W = path.join(__dirname, '..', 'data', 'workbook');
const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8'));
const raw = read('trips.json'), assets = read('assets.json'), rates = read('rates.json'), clients = read('clients.json'), zones = read('zones.json'), routes = read('routes.json'), planning = read('planning.json'), ratecard = read('ratecard.json'), costcenters = read('costcenters.json'), turnaround = read('turnaround.json'), auditpolicy = read('auditpolicy.json'), ratecomparison = read('ratecomparison.json'), fleet = read('fleet.json'), requests = read('requests.json');
const baseCtx = () => { const ctx = { assets, rates, clients, zones, routes, planning, ratecard, costcenters, turnaround, auditpolicy, ratecomparison, fleet, requests, settings: { vatRate: 0.075 }, invoices: [], dieselreqs: [], roadslips: [], extraexpenses: [], jobcards: [], stockmoves: [], rateexceptions: [], auditfindings: [], triplogReconciliation: read('triplog_reconciliation.json'), today: '2026-10-20', now: '2026-10-20T12:00:00Z' }; ctx.trips = raw.map((t) => E.computeTrip(t, ctx)); return ctx; };
const ctx = baseCtx(); const trips = ctx.trips;
const comp = A.comparison(trips, ctx, { to: '2026-09-30' });

test('comparison follows the workbook: scope, quarter groups shared by 2+ clients, best client average, highest rate, opportunity formulas', () => {
  assert.equal(comp.scope.from, '2026-01-02'); assert.ok(comp.comparableGroups.length >= 25);
  for (const g of comp.comparableGroups) { assert.ok(g.clientStats.length >= 2); assert.equal(g.bestAvg, Math.max(...g.clientStats.map((c) => c.avg))); for (const c of g.clientStats) { assert.equal(c.opportunity, E.round2(Math.max(0, g.bestAvg - c.avg) * c.trips)); assert.ok(g.highest >= c.max); } }
  // only haulage and flat trucks; closed-body and Hiab trips are excluded from the workbook grouping
  assert.ok(comp.groups.every((g) => g.vehicleClass === 'Haulage & Flat'));
  assert.ok(trips.filter((t) => /closed|hiab/i.test(t.vehicleType) && t.dateDispatched >= '2026-01-02' && t.dateDispatched <= '2026-09-30').every((t) => !comp.byTrip.has(t.id)));
  // achieved revenue is the workbook total plus the September trips added after its snapshot (listed in the reconciliation)
  assert.ok(comp.headline.achieved > ratecomparison.headline.achieved); assert.ok(comp.headline.achieved - ratecomparison.headline.achieved < 40e6);
  assert.ok(comp.headline.opportunityHighest > comp.headline.opportunityBestClientAvg, 'the highest-rate benchmark is the more aggressive one');
});

test('client ranking reproduces the workbook ranking within the snapshot difference and separates a rate gap from a loss', () => {
  const rk = A.clientRanking(comp, trips, ctx); const by = (n) => rk.find((r) => E.norm(r.client) === E.norm(n));
  const lac = by('Lacasera'), jam = by('Jamara'), saso = by('SASO');
  assert.equal(lac.rateLevel, 64.56); assert.equal(Math.round(lac.opportunity), 14209890); // identical to the workbook (Q1 Lagos → Benin)
  assert.ok(Math.abs(jam.rateLevel - 88.86) < 1.5); assert.equal(jam.routesWithGaps.split(',')[0].trim(), 'Lagos → Abuja');
  assert.ok(saso.rateLevel > 99 && ['Strong Rate', 'Competitive'].includes(saso.verdict));
  assert.equal(lac.verdict, 'Below Comparable Peers'); assert.equal(A.workbookVerdict(lac.rateLevel), 'Well below peers'); assert.equal(A.workbookVerdict(jam.rateLevel), 'Below peers');
  assert.ok(rk.every((r) => r.verdict !== 'Below Cost' || r.expectedMarginPct < 0), 'Below Cost only when the costed margin is negative');
  assert.ok(rk.some((r) => r.verdict === 'Below Comparable Peers' && r.expectedMarginPct > 0), 'a client can pay a lower rate and still be profitable');
  assert.ok(rk.filter((r) => r.tripsCompared < 3).every((r) => r.verdict === 'Insufficient Comparison Data' || r.verdict === 'Below Cost'));
});

test('rate gaps by route list every client against the best-paying client, flag thin benchmarks and keep approved rates / cost estimates separate', () => {
  const gaps = A.routeGaps(comp, ctx, { onlyGaps: true }); assert.ok(gaps.length >= 50);
  const top = gaps[0]; assert.equal(top.route, 'Lagos → Benin'); assert.equal(top.client, 'Lacasera'); assert.equal(top.bestClient, 'NBL'); assert.equal(Math.round(top.opportunity), 14209890); assert.ok(top.thinBenchmark, 'NBL rate rests on 2 trips');
  assert.ok(gaps.every((g) => g.gap === E.round2(Math.max(0, g.benchmarkRate - g.avgRate)))); assert.ok(gaps.some((g) => g.costEstimate !== null) && gaps.some((g) => g.costEstimate === null));
  const all = A.routeGaps(comp, ctx); assert.ok(all.some((g) => g.isBest && g.gap === 0));
});

test('trip audit keeps approved rate, selling price and costing apart and assigns the statuses of the brief', () => {
  const au = A.auditTrips(trips, ctx, comp); const st = new Set(au.rows.map((r) => r.status));
  for (const s of ['Compliant', 'Above Approved Rate', 'Below Approved Rate', 'Approved Rate Missing', 'Selling Price Below Cost']) assert.ok(st.has(s), s);
  const below = au.rows.find((r) => r.status === 'Below Approved Rate'); assert.ok(below.sellingPrice < below.approvedRate && below.varianceApproved < 0 && below.requiresApproval && below.blocksInvoice && below.exceptionType === 'belowApproved');
  const cost = au.rows.find((r) => r.status === 'Selling Price Below Cost'); assert.ok(cost.sellingPrice < cost.costingRate && cost.expectedMargin < 0 && cost.severity === 'High');
  const missing = au.rows.find((r) => r.status === 'Approved Rate Missing'); assert.equal(missing.approvedRate, null); assert.equal(missing.blocksInvoice, false, 'missing-rate blocking is off by policy default; the trip is flagged for review');
  const ok = au.rows.find((r) => r.status === 'Compliant'); assert.equal(ok.exceptionType, null); assert.equal(ok.blocksInvoice, false);
  assert.ok(au.rows.every((r) => r.sellingPrice === null || r.approvedRate === null || r.varianceApproved === E.round2(r.sellingPrice - r.approvedRate)));
  // nothing is overwritten: the trip keeps its own three values
  const t = trips.find((x) => x.id === below.tripLogId); assert.equal(t.sellingPrice, below.sellingPrice); assert.equal(t.agreedPrice, below.approvedRate);
  // an approved exception covers the trip
  const covered = A.tripAudit(t, Object.assign({}, ctx, { rateexceptions: [{ id: 'EXC-1', status: 'Approved', tripLogId: t.id, type: 'belowApproved' }] }), comp); assert.ok(covered.exception && !covered.blocksInvoice);
  // a stricter policy blocks missing rates too
  const strict = A.tripAudit(trips.find((x) => x.id === missing.tripLogId), Object.assign({}, ctx, { auditpolicy: Object.assign({}, auditpolicy, { blocking: { invoice: { missingRate: true } } }) }), comp); assert.equal(strict.blocksInvoice, true);
});

test('truck-days: Route Master or Turnaround Table, trips per truck per month, revenue and contribution per truck-day, truck requirement and utilisation', () => {
  const kano = trips.find((t) => /kano/i.test(t.loadingTo) && /lagos|gbagada|apapa/i.test(t.loadingFrom) && t.dateDispatched > '2026-06' && !/kano/i.test(t.loadingFrom));
  const td = A.truckDays(kano, ctx); assert.ok(td.planned >= 8, 'Kano from Lagos is a 4-day leg in the table (8-day round trip)'); assert.equal(A.tripsPerTruckPerMonth(8, ctx), 3); assert.equal(A.tripsPerTruckPerMonth(2, ctx), 13); assert.equal(A.tripsPerTruckPerMonth(6, ctx), 4);
  assert.equal(A.turnaroundLookup('Lagos', 'Abuja', ctx).oneLegDays, 3); assert.equal(A.turnaroundLookup('Lagos', 'Abuja', ctx).how, 'Exact'); assert.equal(A.turnaroundLookup('Ilesa', 'Yola', ctx).how, 'Exact'); assert.ok(/default/i.test(A.turnaroundLookup('Lagos', 'Nowhere Special', ctx).how));
  const scoped = trips.filter((t) => A.inScope(t, comp.policy, comp.scope) && A.vehicleClass(t, comp.policy, assets));
  const byRoute = A.truckDayStats(scoped, ctx, (t) => A.compRoute(t).key); const lk = byRoute.find((r) => r.key === 'Lagos → Kano'); assert.ok(lk.revenuePerTruckDay === E.round2(lk.revenue / lk.truckDays)); assert.ok(lk.contributionPerTruckDay !== null && lk.contributionPerTruckDay < lk.revenuePerTruckDay);
  const tr = A.truckRequirement(scoped, ctx); assert.equal(tr.months[0], '2026-01'); assert.ok(tr.shared.every((m) => m.trucks <= m.perClient), 'sharing trucks across clients never needs more than per-client rounding'); assert.ok(tr.utilization.every((u) => u.utilizationPct === null || u.utilizationPct >= 0));
  assert.ok(tr.clients.find((c) => c.client === 'NBL').peakTrucks >= 1);
});

test('rate exceptions: raised by CRM / planner / billing, reviewed by Operations, approved by management or finance, never self-approved, history immutable, rate card untouched', () => {
  const policy = auditpolicy; const t = trips.find((x) => x.agreedPrice !== null && x.sellingPrice < x.agreedPrice);
  const draft = { id: A.nextExceptionNo('2026-10-20', []), type: 'belowApproved', tripLogId: t.id, client: t.client, justification: 'Volume discount agreed for Q4', status: 'Pending Operations Review' };
  assert.equal(draft.id, 'EXC-261020-01'); assert.equal(A.nextExceptionNo('2026-10-20', [{ id: 'EXC-261020-07' }]), 'EXC-261020-08');
  assert.equal(A.exceptionError(draft, null, 'crm', 'crm', policy), ''); assert.match(A.exceptionError(draft, null, 'tracking', 'tracking', policy), /cannot raise/); assert.match(A.exceptionError(Object.assign({}, draft, { justification: '' }), null, 'billing', 'billing', policy), /justification/);
  assert.match(A.exceptionError(Object.assign({}, draft, { status: 'Approved' }), null, 'operations', 'ops', policy), /starts as Pending/); assert.match(A.exceptionError(draft, null, 'management', 'manager', policy), /cannot raise/);
  const raised = A.exceptionStamp(draft, null, { username: 'crm', role: 'crm' }, '2026-10-20T09:00:00Z'); assert.equal(raised.raisedBy, 'crm'); assert.equal(raised.history.length, 1);
  // review
  assert.match(A.exceptionError(Object.assign({}, raised, { status: 'Approved' }), raised, 'management', 'manager', policy), /Commercial Approval or is rejected/);
  assert.match(A.exceptionError(Object.assign({}, raised, { status: 'Pending Commercial Approval' }), raised, 'crm', 'crm', policy), /Operations Manager reviews/);
  assert.match(A.exceptionError(Object.assign({}, raised, { status: 'Pending Commercial Approval' }), raised, 'operations', 'crm', policy), /own exception/);
  assert.equal(A.exceptionError(Object.assign({}, raised, { status: 'Pending Commercial Approval', opsNote: 'Margin still positive' }), raised, 'operations', 'ops', policy), '');
  const reviewed = A.exceptionStamp(Object.assign({}, raised, { status: 'Pending Commercial Approval', opsNote: 'Margin still positive' }), raised, { username: 'ops', role: 'operations' }, '2026-10-20T10:00:00Z'); assert.equal(reviewed.reviewedBy, 'ops'); assert.equal(reviewed.history.length, 2);
  // approval
  assert.match(A.exceptionError(Object.assign({}, reviewed, { status: 'Approved', approvalNote: 'ok' }), reviewed, 'operations', 'ops', policy), /approve this exception type/);
  assert.match(A.exceptionError(Object.assign({}, reviewed, { status: 'Approved', approvalNote: 'ok' }), reviewed, 'billing', 'billing', policy), /approve this exception type/);
  assert.equal(A.exceptionError(Object.assign({}, reviewed, { status: 'Approved', approvalNote: 'Strategic account' }), reviewed, 'management', 'manager', policy), '');
  assert.equal(A.exceptionError(Object.assign({}, reviewed, { status: 'Approved', approvalNote: 'Strategic account' }), reviewed, 'finance', 'finance', policy), '');
  assert.match(A.exceptionError(Object.assign({}, reviewed, { status: 'Approved' }), Object.assign({}, reviewed, { raisedBy: 'manager' }), 'management', 'manager', policy), /own exception/);
  // below-cost exceptions need management, not finance
  const bc = Object.assign({}, reviewed, { type: 'belowCost' }); assert.match(A.exceptionError(Object.assign({}, bc, { status: 'Approved', approvalNote: 'x' }), bc, 'finance', 'finance', policy), /Management/);
  const approved = A.exceptionStamp(Object.assign({}, reviewed, { status: 'Approved', approvalNote: 'Strategic account' }), reviewed, { username: 'manager', role: 'management' }, '2026-10-20T11:00:00Z'); assert.equal(approved.approvedBy, 'manager'); assert.equal(approved.history.length, 3);
  // closed = immutable (comments allowed), history append-only
  assert.match(A.exceptionError(Object.assign({}, approved, { justification: 'changed' }), approved, 'admin', 'admin', policy), /cannot be changed/);
  assert.equal(A.exceptionError(Object.assign({}, approved, { comments: [{ by: 'finance', text: 'noted' }] }), approved, 'finance', 'finance', policy), '');
  assert.match(A.exceptionError(Object.assign({}, reviewed, { history: [] }), reviewed, 'operations', 'ops', policy), /immutable/);
  // the rate card is not touched by the approval: the trip still compares against the same approved rate
  const after = A.tripAudit(t, Object.assign({}, ctx, { rateexceptions: [approved] }), comp); assert.equal(after.approvedRate, t.agreedPrice); assert.equal(after.status, 'Below Approved Rate'); assert.ok(after.exception && !after.blocksInvoice);
  assert.equal(E.lookupAgreedRate(t, rates, zones, clients).rate.price, t.agreedRate.price);
});

test('commercial audit before allocation: approved rate, expected price, estimated cost, margin, benchmark, truck-days and the warning that does not reject', () => {
  const req = requests.find((r) => r.id === 'JAT-001'); const ra = A.requestAudit(req, ctx, comp);
  assert.equal(ra.approvedRate, 2648648.65); assert.equal(ra.expectedSellingPrice, ra.approvedRate); assert.ok(ra.estimatedCost > 0 && ra.expectedMargin > 0); assert.ok(/Median rate card/.test(ra.costBasis)); assert.equal(ra.truckDaysRequired, ra.truckDaysPerTrip * ra.trucks);
  assert.equal(ra.blockers.length, 0);
  // a cheap expected price → warning + below-cost blocker (policy), cleared by an approved exception
  const cheap = A.requestAudit(Object.assign({}, req, { expectedSellingPrice: 500000 }), ctx, comp); assert.ok(cheap.expectedMargin < 0 && cheap.flagged && cheap.blockers.length === 1);
  const cleared = A.requestAudit(Object.assign({}, req, { expectedSellingPrice: 500000 }), Object.assign({}, ctx, { rateexceptions: [{ id: 'EXC-x', status: 'Approved', requestId: req.id, type: 'belowCost' }] }), comp); assert.equal(cleared.blockers.length, 0); assert.ok(cleared.flagged, 'the warning stays visible');
  // below benchmark warns but never blocks by default
  const jam = requests.find((r) => /jamara/i.test(r.client) && r.routeMasterId) || req; const bb = A.requestAudit(Object.assign({}, jam, { expectedSellingPrice: 2000000, destination: 'Abuja', loadingFrom: 'GBAGADA', routeMasterId: '', routeId: '' }), ctx, comp);
  if (bb.rateLevel !== null && bb.rateLevel < 90) { assert.ok(bb.warnings.some((w) => /Commercial Alert/.test(w))); assert.ok(bb.blockers.every((b) => !/benchmark/.test(b))); }
});

test('recommendations show their data and calculation; the assistant answers the brief\'s questions from live data and never acts', () => {
  const recs = A.recommendations(trips, ctx, comp); assert.ok(recs.length >= 5);
  for (const r of recs) { assert.ok(['Review Client Rate', 'Negotiate Rate Increase', 'Improve Backloading', 'Reduce Truck Turnaround', 'Review Diesel Cost', 'Review Road Expense Cost', 'Prioritize Higher-Contribution Demand', 'Investigate Negative-Margin Trips'].includes(r.type)); assert.ok(r.evidence.length && r.calculation); }
  assert.ok(recs.some((r) => r.type === 'Negotiate Rate Increase' && r.subject === 'Lacasera'));
  for (const q of A.QUESTIONS) { const a = A.assistant(q, ctx); assert.ok(a && a.answer && Array.isArray(a.rows), q); }
  const low = A.assistant('Which client is paying the lowest rate on Lagos → Kano for the same truck category?', ctx); assert.ok(/Lagos → Kano/.test(low.title) && low.rows.length >= 2);
  assert.equal(A.assistant('Approve the exception for Jamara', ctx), null);
  assert.equal(Object.keys(A).filter((k) => /approve|allocate|issue|modify/i.test(k) && typeof A[k] === 'function' && !/Error|can/.test(k)).length, 0, 'the module exposes no mutating action');
});

test('baseline reconciliation shows the workbook result next to the web result with explanations', () => {
  const rb = A.reconcileBaseline(trips, ctx); assert.equal(rb.headline.find((h) => h.measure === 'achieved').baseline, 2391115141.52);
  assert.ok(rb.headline.find((h) => h.measure === 'trips').difference > 0); assert.ok(rb.explanations.some((e) => /added to the Trip Log after the workbook snapshot/.test(e)));
  const lac = rb.byClient.find((c) => c.client === 'Lacasera'); assert.equal(Math.round(lac.webOpportunity), Math.round(lac.baselineOpportunity));
});

test('TripLog import: historical rows matched to existing trips, nothing duplicated, price differences listed not applied', () => {
  const rec = read('triplog_reconciliation.json'); assert.equal(rec.rows, 1788); assert.equal(rec.matchedExact + rec.matchedByDatePlateClient + rec.newTrips, 1788); assert.equal(rec.appTripsAbsentFromTripLog, 0);
  const fresh = read('triplog_new_trips.json'); assert.equal(fresh.length, rec.newTrips); assert.ok(fresh.every((t) => t.source === 'setup-triplog' && t.dateDispatched >= '2026-10-01'));
  const ids = raw.map((t) => t.id); assert.equal(new Set(ids).size, ids.length, 'no duplicate trip ids');
  const key = (t) => [t.dateDispatched, E.norm(t.plate), E.norm(t.client), E.norm(t.loadingFrom), E.norm(t.loadingTo), Math.round(t.sellingPrice || 0)].join('|'); const keys = raw.filter((t) => t.source === 'setup-triplog').map(key); assert.ok(keys.every((k) => raw.filter((t) => key(t) === k).length === 1), 'imported rows do not duplicate workbook rows');
  for (const d of rec.differences.sellingPrice) { const t = raw.find((x) => x.id === d.tripLogId); assert.equal(t.sellingPrice, d.application, 'application selling price unchanged'); }
  assert.ok(requests.every((r) => r.source !== 'setup-triplog'), 'historical rows never become CRM requests');
});
