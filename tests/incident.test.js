/* Brief 8: Trip ID formats, CRM origin / rate mapping and GM commercial approval, FMR Free-anywhere position and filters,
 * incident & breakdown workflow (roles, order, closure), FMR breakdown status, incident expenses (no diesel, spare parts via
 * job card, roles), incident cost without double counting, TAT / OTD impact, dashboard, assistant and the Trip P&L component. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../js/core/engine.js');
const P = require('../js/core/planning.js');
const D = require('../js/core/dispatch.js');
const WS = require('../js/core/workshop.js');
const F = require('../js/core/finance.js');
const A = require('../js/core/audit.js');
const G = require('../js/core/geo.js');
const IN = require('../js/core/incident.js');

const W = path.join(__dirname, '..', 'data', 'workbook');
const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8'));
const assets = read('assets.json'), rates = read('rates.json'), clients = read('clients.json'), zones = read('zones.json'), routes = read('routes.json'), planning = read('planning.json'), ratecard = read('ratecard.json'), costcenters = read('costcenters.json'), turnaround = read('turnaround.json'), auditpolicy = read('auditpolicy.json'), fleet = read('fleet.json'), requests = read('requests.json'), lm = read('locationmaster.json'), incidentcats = read('incidentcats.json'), accounts = read('accounts.json'), suppliers = read('suppliers.json');
const stateOf = (n) => G.standardize(n, lm).state;
const NOW = '2026-10-21T12:00:00Z';
const baseCtx = () => ({ assets, rates, clients, zones, routes, planning, ratecard, costcenters, turnaround, auditpolicy, fleet, requests, allocations: [], trips: [], settings: { vatRate: 0.075 }, invoices: [], dieselreqs: [], roadslips: [], extraexpenses: [], jobcards: [], stockmoves: [], rateexceptions: [], auditfindings: [], incidents: [], incidentcats, accounts, suppliers, stateOf, today: '2026-10-21', now: NOW, setup: P.setupOf(planning) });

test('Trip IDs: internal Trip-200601…, 3PL TRP-3PL2001…, generated only, legacy IDs valid, never reused, fixed casing', () => {
  assert.equal(E.formatTripId('internal', E.nextTripSeq([], 'internal')), 'Trip-200601');
  assert.equal(E.formatTripId('tpl', E.nextTripSeq([], 'tpl')), 'TRP-3PL2001');
  const trips = [{ journeyPlanId: 'Trip-200605', cancelledAt: 'x' }, { journeyPlanId: 'Trip-2090' }, { journeyPlanId: 'TRIP-202602031353' }, { journeyPlanId: 'TRP-3PL2003' }, { journeyPlanId: 'JMG-TRP-2026-000007' }];
  assert.equal(E.nextTripSeq(trips, 'internal'), 200606, 'a cancelled trip keeps its number out of circulation; historical Trip-2090 style IDs are not counted');
  assert.equal(E.nextTripSeq(trips, 'tpl'), 2004); assert.equal(E.maxTripSeq(trips, 2026), 7, 'the earlier JMG-TRP format still counts per year');
  assert.ok(E.TRIP_ID_RE.test('Trip-200601') && E.TRIP_ID_RE.test('TRP-3PL2001') && E.TRIP_ID_RE.test('JMG-TRP-2026-000001')); assert.ok(!E.TRIP_ID_RE.test('Trip-2090') && !E.TRIP_ID_RE.test('TRP4384'));
  assert.equal(E.normalizeTripId('trip-200601'), 'Trip-200601'); assert.equal(E.normalizeTripId('trp-3pl2001'), 'TRP-3PL2001'); assert.equal(E.normalizeTripId('trp4384'), 'TRP4384');
  assert.equal(E.tripIdKind('Trip-200601'), 'internal'); assert.equal(E.tripIdKind('TRP-3PL2001'), 'tpl'); assert.equal(E.tripIdKind('JMG-TRP-2026-000001'), 'legacy'); assert.equal(E.tripIdKind('TRP4384'), '');
  assert.ok(E.tripIdValid('Trip-200601', '^NEVER$') && E.tripIdValid('TRP-3PL2001', '^NEVER$'), 'generated formats are always valid');
  const gen = { id: 'g', client: 'A', plate: 'X', dateDispatched: '2026-10-01', journeyPlanId: 'Trip-200601' };
  assert.ok(E.validateTrip({ ...gen, journeyPlanId: 'Trip-200602' }, { trips: [gen], current: gen }).some((e) => /cannot be overwritten/.test(e)), 'a generated Trip ID is never overwritten');
  assert.ok(E.findDuplicateTripId('trip-200601', [gen], 'other'), 'duplicates are refused case-insensitively');
});

test('roles: General Manager approves commercial exceptions; incident reporting, review and expense duties are separated', () => {
  assert.ok(E.ROLES.includes('gm')); assert.equal(E.ROLE_LABELS.gm, 'General Manager');
  assert.ok(E.can('gm', 'commercial.gmapprove') && E.can('gm', 'exception.approve') && E.can('gm', 'commercial.view'));
  for (const r of ['operations', 'crm', 'planning', 'management', 'finance']) assert.ok(!E.can(r, 'commercial.gmapprove'), r + ' cannot give GM approval');
  for (const r of ['tracking', 'stationsup', 'operations']) assert.ok(E.can(r, 'incident.report'), r + ' reports incidents');
  assert.ok(!E.can('finance', 'incident.report') && !E.can('billing', 'incident.report'));
  assert.ok(E.can('operations', 'incident.review') && !E.can('tracking', 'incident.review') && !E.can('workshop', 'incident.review'));
  assert.ok(E.can('planning', 'expense.request') && E.can('stationsup', 'expense.request') && !E.can('tracking', 'expense.request'));
  assert.ok(E.can('operations', 'expense.approve') && !E.can('planning', 'expense.approve') && !E.can('finance', 'expense.approve'));
  assert.ok(E.can('finance', 'expense.pay') && !E.can('operations', 'expense.pay'));
  assert.ok(E.ROLES.every((r) => E.can(r, 'incident.view')));
});

test('CRM: default loading origin (city + state) and approved rate come from the Client Price List only; missing mappings are flagged', () => {
  const ctx = baseCtx();
  const giv = D.clientOrigins('GIVANAS', ctx); assert.equal(giv[0].city, 'Lagos'); assert.equal(giv[0].state, 'Lagos'); assert.equal(giv[0].label, 'Lagos / Lagos State');
  const jub = D.clientOrigins('JUBAILI AGROTEC', ctx); assert.equal(jub[0].city, 'Ibadan'); assert.equal(jub[0].state, 'Oyo'); assert.equal(jub[0].label, 'Ibadan / Oyo State');
  assert.deepEqual(D.clientOrigins('No Such Client', ctx), []);
  const lane = D.clientLaneRates({ client: 'GIVANAS', loadingFrom: 'Lagos', destination: 'Onitsha', vehicleType: 'JUMBO', tonnage: '45T', loadingDate: '2026-10-21' }, ctx);
  assert.equal(lane.approvedRate, 2000000); assert.equal(lane.missingMapping, false); assert.equal(lane.selected.priceBasis, 'exclusive'); assert.ok(lane.rows.length >= 1);
  const miss = D.clientLaneRates({ client: 'GIVANAS', loadingFrom: 'Lagos', destination: 'Nowhere Town', tonnage: '45T' }, ctx);
  assert.equal(miss.approvedRate, null); assert.equal(miss.missingMapping, true); assert.match(miss.message, /rate mapping missing/i);
  const rr = D.requestRate({ client: 'GIVANAS', loadingFrom: 'Lagos', destination: 'Onitsha', tonnage: '45T', loadingDate: '2026-10-21', routeId: 'R046' }, ctx);
  assert.equal(rr.source, 'price list'); assert.equal(rr.approvedRate, 2000000); assert.equal(rr.routePrice, 2000000, 'the Route Master price is reported separately');
  const noRate = D.requestRate({ client: 'GIVANAS', loadingFrom: 'Lagos', destination: 'Nowhere Town', routeId: 'R046' }, ctx);
  assert.equal(noRate.approvedRate, null); assert.equal(noRate.missingMapping, true); assert.equal(noRate.source, 'route register');
});

test('commercial approval: below-cost / below-rate requests need the General Manager; approval records date, approver, remarks, price; a material change clears it', () => {
  const ctx = baseCtx(); const comp = A.comparison(ctx.trips, ctx);
  const req = { id: 'GIV-900', client: 'GIVANAS', serviceType: 'Internal Fleet', loadingFrom: 'Lagos', destination: 'Onitsha', routeId: 'R046', routeMasterId: 'R046', vehicleType: 'JUMBO', tonnage: '45T', trucks: 1, loadingDate: '2026-10-25', expectedSellingPrice: 100 };
  const cr = A.commercialReview(req, ctx, comp);
  assert.equal(cr.approvedRate, 2000000); assert.equal(cr.belowRate, true); assert.equal(cr.requiresGm, true); assert.equal(cr.status, 'Awaiting GM approval'); assert.ok(cr.reasons.length >= 1); assert.ok(cr.expectedProfit < 0 || cr.costingRate === null);
  const ok = A.commercialReview(Object.assign({}, req, { expectedSellingPrice: 2100000 }), ctx, comp); assert.equal(ok.requiresGm, false); assert.equal(ok.belowRate, false);
  // plan approval is blocked while the GM approval is missing (requestAudit blockers / commercial snapshot)
  const snap = A.commercialSnapshot(req, null, ctx, comp, NOW); assert.equal(snap.requiresGm, true); assert.equal(snap.termsHash, cr.termsHash); assert.ok(!snap.gmApprovedAt);
  // only the GM decides, with remarks and an approved price
  const approved = Object.assign({}, req, { commercial: Object.assign({}, snap, { gmApprovedAt: NOW, gmApprovedBy: 'gm', gmRemarks: 'Backload from Onitsha', approvedPrice: 100 }) });
  assert.match(A.gmDecisionError(approved, Object.assign({}, req, { commercial: snap }), 'operations'), /Only the General Manager/);
  assert.equal(A.gmDecisionError(approved, Object.assign({}, req, { commercial: snap }), 'gm'), '');
  assert.match(A.gmDecisionError(Object.assign({}, req, { commercial: Object.assign({}, snap, { gmApprovedAt: NOW, gmApprovedBy: 'gm', approvedPrice: 100 }) }), Object.assign({}, req, { commercial: snap }), 'gm'), /remarks/);
  const after = A.commercialReview(approved, ctx, comp); assert.equal(after.gmApproved, true); assert.equal(after.status, 'GM approved');
  const ra = A.requestAudit(approved, ctx, comp); assert.deepEqual(ra.blockers, [], 'a GM approval authorises the job like an approved exception'); assert.ok(ra.gmApproval);
  // request status
  assert.equal(P.requestStatus(Object.assign({}, req, { submittedAt: NOW, commercial: snap }), { requested: 1, allocated: 0, deployed: 0, completed: 0, outstanding: 1 }, { routes }), 'Awaiting Commercial Approval');
  assert.equal(P.requestStatus(approved, { requested: 1, allocated: 0, deployed: 0, completed: 0, outstanding: 1 }, { routes }), 'Awaiting Planning');
  // material change (price) clears the approval and records it
  const changed = Object.assign({}, approved, { expectedSellingPrice: 150 }); const snap2 = A.commercialSnapshot(changed, approved, ctx, comp, '2026-10-22T00:00:00Z');
  assert.ok(!snap2.gmApprovedAt && !snap2.approvedPrice, 'approval cleared'); assert.equal(snap2.history.slice(-1)[0].action, 'Re-approval required'); assert.equal(snap2.history.slice(-1)[0].previous.gmApprovedBy, 'gm');
  const same = A.commercialSnapshot(Object.assign({}, approved, { remarks: 'note only' }), approved, ctx, comp, NOW); assert.equal(same.gmApprovedAt, NOW, 'a non-material change keeps the approval');
});

test('FMR: a Free truck anywhere is eligible for planning; returning empty counts as Free; filters by state, returning empty and backloading', () => {
  const ctx = baseCtx(); const base = fleet[0];
  const freeKano = Object.assign({}, base, { status: 'Available', statusAt: NOW, currentLocation: 'Kano', currentState: '', destination: '', client: '', routeId: '', movementDirection: '' });
  const pos = P.fleetPosition(freeKano, ctx); assert.equal(pos.operationalStatus, 'Free'); assert.equal(pos.planningEligible, true); assert.equal(pos.currentState, 'Kano'); assert.equal(pos.movementDirection, 'Stationary'); assert.equal(pos.awayFromBase, true); assert.equal(pos.backloadCandidate, true);
  const returning = Object.assign({}, base, { status: 'Inbound / Returning', statusAt: NOW, currentLocation: 'Ibadan', movementDirection: 'Returning Empty' });
  const p2 = P.fleetPosition(returning, ctx); assert.equal(p2.operationalStatus, 'Free (returning empty)'); assert.equal(p2.planningEligible, true); assert.equal(p2.returningEmpty, true); assert.equal(p2.currentState, 'Oyo');
  const loaded = Object.assign({}, returning, { movementDirection: 'Returning Loaded' }); assert.equal(P.fleetPosition(loaded, ctx).planningEligible, false);
  const outbound = Object.assign({}, base, { status: 'Outbound / In Transit', statusAt: NOW, destination: 'Kano' }); const p3 = P.fleetPosition(outbound, ctx); assert.equal(p3.operationalStatus, 'On Trip'); assert.equal(p3.planningEligible, false); assert.equal(p3.movementDirection, 'Outbound');
  const down = Object.assign({}, base, { status: IN.BREAKDOWN_FMR_STATUS, statusAt: NOW }); assert.equal(P.fleetPosition(down, ctx).operationalStatus, 'Breakdown'); assert.equal(P.fleetPosition(down, ctx).planningEligible, false);
  const rows = [freeKano, returning, loaded, outbound, down].map((t) => ({ truck: t, pos: P.fleetPosition(t, ctx) }));
  assert.equal(P.freeFilter(rows, 'free').length, 2); assert.equal(P.freeFilter(rows, 'free-state', 'Kano').length, 1); assert.equal(P.freeFilter(rows, 'free-state', 'Oyo').length, 1); assert.equal(P.freeFilter(rows, 'free-returning').length, 1); assert.equal(P.freeFilter(rows, 'free-backload').length, 2); assert.equal(P.freeFilter(rows, '').length, 5);
  assert.equal(P.canonicalStatus('Free', planning), 'Available'); assert.equal(P.canonicalStatus('Returning empty', planning), 'Inbound / Returning');
  // planning: the Free truck in Kano is ranked for a Lagos request with an ETA at the bay and notes; the returning-empty truck is flagged for verification
  const req = requests.find((r) => r.routeId === 'R051') || requests[0]; const plan = P.planForRequest(Object.assign({}, req, { loadingDate: '2026-10-30' }), Object.assign({}, ctx, { fleet: [freeKano, returning], allocations: [] }));
  const rk = plan.rows.find((x) => x.truck.plate === freeKano.plate); assert.ok(rk && rk.canLoad, 'a Free truck outside Lagos is offered with its ETA at the loading point'); assert.ok(rk.notes.some((n) => /Free in Kano/.test(n)));
  const chk = P.allocationChecks(freeKano, Object.assign({}, rk, { bay: plan.bay }), ctx); assert.ok(chk.checks.find((c) => c.key === 'eta').ok && chk.checks.find((c) => c.key === 'eligible').ok);
});

// ---------------------------------------------------------------- incidents
const trip = { id: 't-inc-1', journeyPlanId: 'Trip-200601', plate: fleet[0].plate, assetCode: fleet[0].assetCode, driver: 'Test Driver', client: 'Jamara', loadingFrom: 'Lagos', loadingTo: 'Abuja', routeMasterId: 'R049', costCenter: 'CC046', lob: 'Haulage', dateDispatched: '2026-10-18', opsStatus: 'Open', tatTargetDays: 7, otdTargetHours: 72, allocationId: 'ALC-1', milestones: { allocatedAt: '2026-10-18T06:00:00Z', loadedAt: '2026-10-18T10:00:00Z' }, events: [] };
const incCtx = () => Object.assign(baseCtx(), { trips: [trip], fleet: [Object.assign({}, fleet[0], { status: 'Outbound / In Transit', currentLocation: 'Lokoja', currentState: 'Kogi' })] });
const user = (role) => ({ username: role, role });

test('incident: created from the Trip ID with truck, driver, route, client, asset, cost center and LOB retrieved; mandatory fields; only authorised roles', () => {
  const ctx = incCtx(); const inc = IN.fromTrip(trip, { category: 'Engine Failure', description: 'Engine stalled at Lokoja', severity: 'High', truckImmobilized: true }, ctx, user('tracking'), '2026-10-19T08:00:00Z');
  assert.match(inc.id, /^INC-261019-\d{2}$/); assert.equal(inc.tripLogId, trip.id); assert.equal(inc.tripId, 'Trip-200601'); assert.equal(inc.plate, trip.plate); assert.equal(inc.driver, 'Test Driver'); assert.equal(inc.client, 'Jamara'); assert.equal(inc.route, 'Lagos → Abuja'); assert.equal(inc.costCenter, 'CC046'); assert.equal(inc.lob, 'Haulage'); assert.equal(inc.assetCode, fleet[0].assetCode); assert.equal(inc.currentLocation, 'Lokoja'); assert.equal(inc.state, 'Kogi'); assert.equal(inc.status, 'Reported'); assert.equal(inc.history.length, 1);
  assert.equal(IN.incidentError(inc, null, 'tracking', ctx), ''); assert.equal(IN.incidentError(inc, null, 'stationsup', ctx), ''); assert.match(IN.incidentError(inc, null, 'finance', ctx), /cannot report/); assert.match(IN.incidentError(inc, null, 'billing', ctx), /cannot report/);
  assert.match(IN.incidentError(Object.assign({}, inc, { category: '' }), null, 'tracking', ctx), /category/); assert.match(IN.incidentError(Object.assign({}, inc, { tripLogId: '' }), null, 'tracking', ctx), /Trip ID/); assert.match(IN.incidentError(Object.assign({}, inc, { status: 'Closed' }), null, 'tracking', ctx), /starts as Reported/);
  assert.equal(IN.nextIncidentNo('2026-10-19', [inc]), inc.id.replace(/\d{2}$/, (n) => String(Number(n) + 1).padStart(2, '0')));
  assert.equal(IN.categories(ctx).length, 16); assert.ok(IN.isMechanical('Engine Failure', ctx) && !IN.isMechanical('Cargo Damage', ctx));
});

test('incident workflow: ordered stages, role per stage, immutable history, closure needs release and no pending expenses, controlled post-closure', () => {
  const ctx = incCtx(); let inc = IN.fromTrip(trip, { category: 'Engine Failure', description: 'x', severity: 'High', truckImmobilized: true }, ctx, user('tracking'), '2026-10-19T08:00:00Z');
  const move = (to, role, extra) => { const next = Object.assign({ id: inc.id, status: to }, extra || {}); const why = IN.incidentError(Object.assign({}, inc, next), inc, role, ctx); if (why) return why; inc = Object.assign({}, inc, IN.stamp(Object.assign({}, inc, next), inc, user(role), '2026-10-19T09:00:00Z')); return ''; };
  assert.match(move('Operations Review', 'tracking'), /Operations Manager reviews/); assert.equal(move('Operations Review', 'operations'), ''); assert.equal(inc.reviewedBy, 'operations');
  assert.match(move('Workshop Assessment', 'tracking'), /Workshop Manager or Operations/); assert.equal(move('Workshop Assessment', 'workshop'), '');
  assert.match(move('Expense Requests', 'tracking'), /planners, station supervisors or operations/); assert.equal(move('Expense Requests', 'stationsup'), '');
  assert.equal(move('Awaiting Approval', 'planning'), '');
  assert.match(move('Reported', 'operations'), /does not move back/);
  assert.match(IN.incidentError(Object.assign({}, inc, { history: [] }), inc, 'operations', ctx), /history is immutable/);
  assert.match(move('Closed', 'operations'), /Record the truck release/, 'an immobilised truck must be released before closure');
  assert.equal(move('Repair / Recovery', 'workshop'), ''); assert.equal(inc.repairStartAt, '2026-10-19T09:00:00Z');
  ctx.extraexpenses = [{ id: 'AEX-1', incidentId: inc.id, status: 'Pending Approval', amountRequested: 1000 }];
  assert.equal(move('Truck Released', 'tracking'), '', 'the tracking team may record the release'); assert.ok(inc.releasedAt && inc.repairEndAt);
  assert.match(move('Closed', 'operations'), /awaiting the Operations Manager/, 'pending expense requests block closure');
  ctx.extraexpenses[0].status = 'Approved'; assert.match(move('Closed', 'tracking'), /Only the Operations Manager closes/); assert.equal(move('Closed', 'operations'), ''); assert.equal(inc.closedBy, 'operations');
  assert.match(IN.incidentError(Object.assign({}, inc, { category: 'Accident' }), inc, 'operations', ctx), /cannot be changed/, 'closed incidents are not silently reopened or edited');
  assert.equal(IN.incidentError(Object.assign({}, inc, { remarks: 'post-closure note', history: [...inc.history, { at: 'x', action: 'Post-closure adjustment' }] }), inc, 'operations', ctx), '', 'a recorded post-closure adjustment is allowed');
  assert.equal(inc.history.length, 8); assert.deepEqual(inc.history.map((x) => x.status).slice(0, 3), ['Reported', 'Operations Review', 'Workshop Assessment']);
  assert.equal(IN.incidentError(Object.assign({}, IN.fromTrip(trip, { category: 'Accident', description: 'x', severity: 'Low' }, ctx, user('tracking')), { status: 'Cancelled' }), IN.fromTrip(trip, { category: 'Accident', description: 'x', severity: 'Low' }, ctx, user('tracking')), 'operations', ctx), '', 'the Operations Manager cancels a false report');
});

test('incident expenses: planner / station supervisor request, categories, no diesel (diesel workflow), spare parts via job card, Ops Manager approves, Finance pays; costs never double counted', () => {
  const ctx = incCtx(); const inc = IN.fromTrip(trip, { category: 'Tyre Burst or Tyre Damage', description: 'x', severity: 'Medium', truckImmobilized: true }, ctx, user('tracking'), '2026-10-19T08:00:00Z');
  const req = { category: 'Towing and Recovery', amountRequested: 150000, reason: 'Tow to Lokoja workshop' };
  assert.equal(IN.expenseError(inc, trip, req, 'planning'), ''); assert.equal(IN.expenseError(inc, trip, req, 'stationsup'), '');
  assert.match(IN.expenseError(inc, trip, req, 'tracking'), /Only the Planner or the Station Supervisor/); assert.match(IN.expenseError(inc, trip, req, 'operations'), /Only the Planner/);
  assert.match(IN.expenseError(inc, trip, Object.assign({}, req, { category: 'Additional Diesel' }), 'planning'), /Diesel Request Form/);
  assert.match(IN.expenseError(inc, trip, Object.assign({}, req, { category: 'Spare Parts' }), 'planning'), /job card/); assert.equal(IN.expenseError(inc, trip, Object.assign({}, req, { category: 'Spare Parts', jobcardId: 'jc-1' }), 'planning'), '');
  assert.match(IN.expenseError(inc, trip, Object.assign({}, req, { category: 'Fuel' }), 'planning'), /category/); assert.match(IN.expenseError(Object.assign({}, inc, { status: 'Closed' }), trip, req, 'planning'), /no new expense/);
  assert.equal(IN.EXPENSE_CATEGORIES.length, 11); assert.ok(IN.EXPENSE_CATEGORIES.includes('Driver Accommodation') && IN.EXPENSE_CATEGORIES.includes('Cargo Recovery'));
  // the existing additional-expense rules still apply: only the Operations Manager decides, only Finance pays, only on an open trip
  const pending = { id: 'AEX-9', tripLogId: trip.id, incidentId: inc.id, category: 'Towing and Recovery', amountRequested: 150000, reason: 'tow', status: 'Pending Approval' };
  assert.equal(D.expenseRequestError(trip, [], pending), ''); assert.match(D.expenseRequestError(Object.assign({}, trip, { closedAt: 'x' }), [], pending), /operationally Open/);
  assert.match(D.expenseTransitionError(pending, Object.assign({}, pending, { status: 'Approved', approvedAmount: 150000 }), 'planning'), /Only the Operations Manager/);
  assert.equal(D.expenseTransitionError(pending, Object.assign({}, pending, { status: 'Approved', approvedAmount: 150000 }), 'operations'), '');
  const approved = Object.assign({}, pending, { status: 'Approved', approvedAmount: 150000 }); assert.match(D.expenseTransitionError(approved, Object.assign({}, approved, { status: 'Paid' }), 'operations'), /finance/); assert.equal(D.expenseTransitionError(approved, Object.assign({}, approved, { status: 'Paid' }), 'finance'), '');
  // cost roll-up: paid expenses + linked job card, counted once
  const job = Object.assign(IN.jobCardFromIncident(inc, trip, WS, ctx, user('workshop'), '2026-10-19T10:00:00Z'), { labourCost: 20000, externalRepairCost: 30000 });
  assert.equal(job.incidentId, inc.id); assert.equal(job.tripLogId, trip.id); assert.equal(job.plate, inc.plate); assert.equal(job.breakdownCategory, 'Tyres'); assert.match(job.defect, /Tyre Burst/); assert.equal(job.status, 'Defect Reported'); assert.match(job.number, /^JC-/);
  ctx.extraexpenses = [Object.assign({}, approved, { status: 'Paid' }), { id: 'AEX-10', tripLogId: trip.id, incidentId: inc.id, category: 'Driver Feeding', amountRequested: 5000, approvedAmount: 5000, status: 'Approved' }, { id: 'AEX-11', tripLogId: trip.id, incidentId: inc.id, category: 'Other Incident Expenses', amountRequested: 9999, status: 'Rejected' }, { id: 'AEX-12', tripLogId: trip.id, category: 'Toll / levy', amountRequested: 7000, approvedAmount: 7000, status: 'Paid' }];
  ctx.jobcards = [job]; ctx.incidents = [Object.assign({}, inc, { jobcardId: job.id })];
  const c = IN.costs(ctx.incidents[0], ctx, WS); assert.equal(c.requested, 155000); assert.equal(c.approved, 155000); assert.equal(c.paid, 150000); assert.equal(c.outstanding, 5000); assert.equal(c.repairCost, 50000); assert.equal(c.total, 200000); assert.equal(c.awaitingPayment, 1);
  // Trip P&L: incident cost shown separately, excluded from additional expenses and repairs, never counted twice
  const pnl = F.tripPnl(E.computeTrip(trip, ctx), ctx);
  assert.equal(pnl.direct.incident, 200000); assert.equal(pnl.direct.extras, 7000, 'non-incident additional expenses stay under additional'); assert.equal(pnl.direct.repairsOnTrip, 0, 'the incident job card is not also counted as a repair'); assert.equal(pnl.incidentTotal, 200000); assert.equal(pnl.incidentCount, 1); assert.equal(pnl.directTotal, 207000);
  assert.equal(pnl.unprofitableDueToIncident, false, 'not invoiced: no revenue, so no profitability verdict');
  const invoiced = Object.assign({}, trip, { sellingPrice: 150000, invoiceId: 'inv1' }); const ctx2 = Object.assign({}, ctx, { invoices: [{ id: 'inv1', issuedAt: 'x', status: 'Issued', subtotal: 150000, tripIds: [trip.id] }] });
  const p2 = F.tripPnl(E.computeTrip(invoiced, ctx2), ctx2); assert.ok(p2.operatingProfit < 0 && p2.unprofitableDueToIncident, 'a trip that would be profitable without the incident is identified');
  const summary = F.pnlSummary([E.computeTrip(invoiced, ctx2)], ctx2, (t) => t.client); assert.equal(summary[0].incident, 200000); assert.equal(summary[0].unprofitableDueToIncident, 1);
});

test('breakdown time and TAT / OTD impact: breakdown hours to release, repair hours, trip delay separated from the normal turnaround, revised ETA, OTD failure caused by the incident', () => {
  const ctx = incCtx(); const inc = Object.assign(IN.fromTrip(trip, { category: 'Engine Failure', description: 'x', severity: 'High', truckImmobilized: true }, ctx, user('tracking'), '2026-10-19T08:00:00Z'), { repairStartAt: '2026-10-19T12:00:00Z', repairEndAt: '2026-10-20T06:00:00Z', releasedAt: '2026-10-20T08:00:00Z', status: 'Truck Released' });
  const t = IN.timing(inc, NOW); assert.equal(t.breakdownHours, 24); assert.equal(t.repairHours, 18); assert.equal(t.tripDelayHours, 24); assert.equal(t.ongoing, false);
  const ongoing = IN.timing(Object.assign({}, inc, { releasedAt: '', repairEndAt: '', status: 'Repair / Recovery' }), '2026-10-19T20:00:00Z'); assert.equal(ongoing.breakdownHours, 12); assert.equal(ongoing.ongoing, true);
  assert.equal(IN.timing(Object.assign({}, inc, { truckImmobilized: false, estimatedDelayHours: 3 }), NOW).tripDelayHours, 3, 'a non-immobilising incident carries its estimated delay');
  const done = Object.assign({}, trip, { milestones: { allocatedAt: '2026-10-18T06:00:00Z', loadedAt: '2026-10-18T10:00:00Z', arrivedClientAt: '2026-10-21T22:00:00Z', offloadedAt: '2026-10-22T04:00:00Z', leftClientAt: '2026-10-22T06:00:00Z', arrivedBackAt: '2026-10-24T06:00:00Z' } });
  const tat = P.tatCalc(done, 5, NOW); assert.equal(tat.status, 'Completed Late'); assert.equal(tat.otdStatus, 'Late', '84 h loading → client against a 72 h band');
  const imp = IN.tatImpact(done, tat, [inc], NOW); assert.equal(imp.hours, 24); assert.equal(imp.totalHoursExcludingIncidents, 120); assert.equal(imp.varianceExcludingIncidents, 0); assert.equal(imp.otdStatusExcludingIncidents, 'On Time'); assert.equal(imp.otdFailureCausedByIncident, true); assert.ok(imp.revisedEta);
  assert.equal(IN.tripDelay(trip, [inc, Object.assign({}, inc, { id: 'INC-x', status: 'Cancelled' })], NOW).hours, 24, 'cancelled incidents are ignored');
  assert.match(IN.closureFlag(trip, [Object.assign({}, inc, { status: 'Repair / Recovery' })]), /unresolved incident/); assert.equal(IN.closureFlag(trip, [inc]), '', 'a released incident does not flag closure');
});

test('dashboard KPIs, cost by truck / route / client / category, repeat vehicles, OTD failures; assistant answers from recorded data only', () => {
  const ctx = incCtx(); const mk = (id, plate, cat, at, extra) => Object.assign(IN.fromTrip(Object.assign({}, trip, { plate }), { category: cat, description: 'x', severity: 'High', truckImmobilized: true }, ctx, user('tracking'), at), { id }, extra || {});
  ctx.incidents = [mk('INC-1', 'AAA111XX', 'Engine Failure', '2026-10-10T08:00:00Z', { releasedAt: '2026-10-11T08:00:00Z', status: 'Closed', closedAt: '2026-10-11T09:00:00Z' }), mk('INC-2', 'AAA111XX', 'Tyre Burst or Tyre Damage', '2026-10-15T08:00:00Z', { releasedAt: '2026-10-15T14:00:00Z', status: 'Truck Released' }), mk('INC-3', 'BBB222YY', 'Accident', '2026-10-19T08:00:00Z', { status: 'Repair / Recovery' }), mk('INC-4', 'AAA111XX', 'Tyre Burst or Tyre Damage', '2026-10-20T08:00:00Z', { releasedAt: '2026-10-20T10:00:00Z', status: 'Truck Released' }), mk('INC-5', 'CCC3ZZ', 'Cargo Damage', '2026-10-20T08:00:00Z', { status: 'Cancelled' })];
  ctx.extraexpenses = [{ id: 'A1', tripLogId: trip.id, incidentId: 'INC-1', category: 'Towing and Recovery', amountRequested: 100000, approvedAmount: 100000, status: 'Paid' }, { id: 'A2', tripLogId: trip.id, incidentId: 'INC-3', category: 'Security Expenses', amountRequested: 40000, status: 'Pending Approval' }, { id: 'A3', tripLogId: trip.id, incidentId: 'INC-2', category: 'Tyre Replacement', amountRequested: 60000, approvedAmount: 60000, status: 'Approved' }];
  const d = IN.dashboard(ctx, WS, NOW);
  assert.equal(d.total, 4); assert.equal(d.open, 3); assert.equal(d.breakdowns, 3); assert.equal(d.accidents, 1); assert.equal(d.immobilized, 1); assert.equal(d.awaitingApproval, 1); assert.equal(d.totalExpenses, 100000); assert.equal(d.awaitingPayment, 60000);
  assert.equal(d.byTruck[0].key, 'AAA111XX'); assert.equal(d.byTruck[0].incidents, 3); assert.equal(d.byCategory.find((x) => x.key === 'Towing and Recovery'), undefined); assert.equal(d.byCategory.find((x) => x.key === 'Engine Failure').cost, 100000);
  assert.equal(d.repeatVehicles.length, 1); assert.equal(d.repeatVehicles[0].plate, 'AAA111XX'); assert.ok(d.avgBreakdownHours > 0); assert.ok(d.totalBreakdownDays > 0);
  const a1 = IN.assistant('Which trucks have the highest breakdown frequency?', ctx, WS); assert.equal(a1.rows[0].key, 'AAA111XX'); assert.match(a1.answer, /AAA111XX/);
  const a2 = IN.assistant('Which trucks have repeated tyre failures?', ctx, WS); assert.equal(a2.rows.length, 1); assert.equal(a2.rows[0].tyreIncidents, 2);
  const a3 = IN.assistant('What is the total incident cost this month?', ctx, WS); assert.match(a3.answer, /nothing is estimated/i); assert.ok(a3.rows.length >= 3);
  const a4 = IN.assistant('Which incident categories create the highest expenses?', ctx, WS); assert.equal(a4.rows[0].key, 'Engine Failure');
  const a5 = IN.assistant('Which vehicles require maintenance review?', ctx, WS); assert.equal(a5.rows[0].plate, 'AAA111XX');
  assert.ok(IN.assistant('Which routes experience the most incidents?', ctx, WS).rows.length >= 1); assert.ok(IN.assistant('How many deliveries were delayed because of breakdowns?', ctx, WS));
  assert.equal(IN.assistant('what is the weather', ctx, WS), null);
  assert.equal(IN.QUESTIONS.length, 7);
});

test('3PL suppliers: only Supplier Master entries classified Third-Party Logistics with the equipment capability are offered; equipment list per brief', () => {
  const tpl = suppliers.filter((s) => s.is3pl); assert.ok(tpl.length >= 20); assert.ok(suppliers.some((s) => !s.is3pl), 'non-3PL suppliers exist and are excluded');
  assert.ok(tpl.every((s) => /3rd|third/i.test(s.division || '') || s.is3pl)); assert.ok(tpl.some((s) => s.capabilities && s.capabilities.lowbed)); assert.ok(tpl.some((s) => s.capabilities && s.capabilities['40FT']));
  for (const eq of ['Lowbed', 'Flatbed', 'Crane-100T', 'Crane-150T', 'Crane-80T', '20FT', '25FT', '40FT', 'Hiab']) assert.ok(P.TPL_EQUIPMENT.includes(eq), eq);
});
