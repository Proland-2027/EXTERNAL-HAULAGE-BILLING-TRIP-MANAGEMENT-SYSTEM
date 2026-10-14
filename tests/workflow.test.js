/* Workflow brief: request stages, route validation, plan approval and allocation guard, automatic Trip IDs, TAT,
 * separate diesel / road documents, additional expenses, document readiness for invoicing, 3PL margins and KPIs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../js/core/engine.js');
const P = require('../js/core/planning.js');
const D = require('../js/core/dispatch.js');

const W = path.join(__dirname, '..', 'data', 'workbook');
const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8'));
const routes = read('routes.json'), requests = read('requests.json'), allocations = read('allocations.json'), fleet = read('fleet.json'), planning = read('planning.json'), contractors = read('contractors.json'), quotes = read('quotes.json');
const ctx = { planning, routes, fleet, allocations, requests, trips: [], quotes, contractors, today: '2026-10-14', now: '2026-10-14T12:00:00Z' };

test('Trip IDs: JMG-TRP-YYYY-NNNNNN, sequential per year, one per truck movement, never reused or overwritten', () => {
  assert.equal(E.formatTripId(2026, 1), 'JMG-TRP-2026-000001');
  assert.ok(E.TRIP_ID_RE.test('JMG-TRP-2026-000123')); assert.ok(!E.TRIP_ID_RE.test('TRP-00123'));
  const trips = [{ journeyPlanId: 'JMG-TRP-2026-000007' }, { journeyPlanId: 'JMG-TRP-2025-000900' }, { journeyPlanId: 'TRP4384' }];
  assert.equal(E.maxTripSeq(trips, 2026), 7); assert.equal(E.maxTripSeq(trips, 2027), 0);
  const cancelled = { id: 'c', client: 'A', plate: 'X', dateDispatched: '2026-10-01', journeyPlanId: 'JMG-TRP-2026-000007', cancelledAt: 'x' };
  assert.equal(E.opsStatus(cancelled), 'Cancelled'); assert.equal(cancelled.journeyPlanId, 'JMG-TRP-2026-000007', 'a cancelled trip keeps its Trip ID');
  assert.ok(E.findDuplicateTripId('jmg-trp-2026-000007', [cancelled], 'other'), 'a cancelled trip still blocks reuse of its ID');
});

test('route validation blocks an unmapped route from submission, planning, allocation and Trip ID generation', () => {
  const mapped = requests.find((r) => r.id === 'JAM-008'); const unmapped = requests.find((r) => r.id === 'LEB-001');
  assert.equal(P.routeValidation(mapped, routes).ok, true);
  const rv = P.routeValidation(unmapped, routes); assert.equal(rv.ok, false); assert.match(rv.message, /Route Not Mapped — Route Approval Required/);
  assert.equal(P.requestStatus(unmapped, P.requestCounts(unmapped, allocations, []), ctx), 'Pending Route Mapping');
  assert.match(P.allocationGuard(unmapped, null, null, ctx), /Route Not Mapped/);
  const pending = routes.map((r) => (r.id === mapped.routeId ? Object.assign({}, r, { status: 'Pending Approval' }) : r));
  assert.equal(P.routeValidation(mapped, pending).ok, false, 'a route that exists but is not approved does not pass');
  const rm = P.routeMaster(routes.find((r) => r.id === 'R001'), () => 'Oyo'); assert.equal(rm.originState, 'Oyo'); assert.equal(rm.destState, 'Kano'); assert.equal(rm.totalKm, 1904); assert.equal(rm.tatDays, 8); assert.equal(rm.status, 'Approved');
});

test('three stages: CRM request → Operations Manager plan approval → Station Manager allocation within the approved quantity and category', () => {
  const r = { id: 'Q-9', client: 'Jamara', loadingFrom: 'Lagos', destination: 'Ibadan', vehicleType: 'JUMBO', tonnage: '30T', trucks: 2, routeApproved: true, serviceType: 'Internal Fleet' };
  const c = Object.assign({}, ctx, { routes: undefined });
  assert.equal(P.requestStatus(r, P.requestCounts(r, [], [])), 'Awaiting Planning');
  assert.match(P.allocationGuard(r, null, null, c), /no approved fleet plan/);
  r.plan = { approvedQty: 2, vehicleType: 'JUMBO', tonnage: '30T', approvedBy: 'ops', approvedAt: 'x' };
  assert.equal(P.requestStatus(r, P.requestCounts(r, [], [])), 'Plan Approved');
  const jumbo = { plate: 'J1', bodyType: '102', tonnage: '30T' }, flat = { plate: 'F1', bodyType: 'FLAT', tonnage: '30T' };
  assert.equal(P.allocationGuard(r, jumbo, null, c), '');
  assert.match(P.allocationGuard(r, flat, null, c), /not the approved vehicle category/);
  assert.equal(P.allocationGuard(r, flat, null, c, { override: true }), '', 'an authorised override may substitute the category');
  const two = [{ id: 'a1', requestId: 'Q-9', status: 'Planned' }, { id: 'a2', requestId: 'Q-9', status: 'Planned' }];
  assert.match(P.allocationGuard(r, jumbo, null, Object.assign({}, c, { allocations: two })), /covers 2 trucks; 2 already allocated/);
  assert.equal(P.requestStatus(r, P.requestCounts(r, two.slice(0, 1), [])), 'Partially Allocated', 'a request may be partially allocated and stay open');
  assert.equal(P.requestStatus(r, P.requestCounts(r, two, [])), 'Fully Allocated');
  assert.ok(E.can('crm', 'request.manage') && !E.can('crm', 'plan.approve') && !E.can('crm', 'allocation.manage'));
  assert.ok(E.can('operations', 'plan.approve') && !E.can('station', 'plan.approve') && E.can('station', 'allocation.manage') && !E.can('planning', 'allocation.manage'));
});

test('3rd-party requests follow the 3PL stages and never receive internal fleet allocations', () => {
  const r = requests.find((x) => P.isTpl(x)); assert.ok(r, 'seed holds a 3PL request');
  assert.equal(P.requestStatus(r, P.requestCounts(r, allocations, []), ctx), 'Quotation');
  assert.match(P.allocationGuard(r, null, null, ctx), /3PL module/);
  const approved = Object.assign({}, r, { tpl: Object.assign({}, r.tpl, { approvedCost: 7200000, costApprovedAt: 'x' }) }); assert.equal(P.requestStatus(approved, P.requestCounts(approved, [], []), ctx), 'Cost Approved');
  const assigned = Object.assign({}, approved, { tpl: Object.assign({}, approved.tpl, { assignmentStatus: 'Assigned', assignedAt: 'x' }) }); assert.equal(P.requestStatus(assigned, P.requestCounts(assigned, [], []), ctx), 'Assigned');
  const trip = { id: 't1', requestId: r.id, serviceType: '3rd Party Contractor', sellingPrice: 9500000, netSales: 9500000, contractorCost: 7200000, contractorName: 'HeavyLift Logistics Ltd' };
  assert.equal(P.requestStatus(assigned, P.requestCounts(assigned, [], [trip]), ctx), 'In Execution');
  const m = D.tplMargin(approved.tpl, 1); assert.equal(m.revenue, 9500000); assert.equal(m.cost, 7200000); assert.equal(m.margin, 2300000);
  const p = D.tplProfitability([trip]); assert.equal(p.margin, 2300000); assert.equal(p.byContractor[0].key, 'HeavyLift Logistics Ltd');
  assert.ok(D.dispatchCalc(Object.assign({ plate: 'THIRD-PARTYHAULAGE', loadingFrom: 'Apapa', loadingTo: 'Abuja' }, trip), Object.assign({}, ctx, { assets: [], distances: [], locationMaster: {} })).issues.some((i) => /Third-party/.test(i)), 'JMG allowances are not applied to contractors');
  assert.deepEqual(E.validateTrip({ dateDispatched: '2026-10-20', client: 'ORCA DECO LIMITED', plate: 'HEAVYLIFT-01', serviceType: '3rd Party Contractor' }, { assets: [{ plate: 'X' }] }), [], 'a contractor truck is not in the JMG asset list');
});

test('TAT: milestone durations, total turnaround, variance against the route target and status', () => {
  const m = { allocatedAt: '2026-10-01T08:00:00Z', loadedAt: '2026-10-02T08:00:00Z', arrivedClientAt: '2026-10-04T08:00:00Z', offloadedAt: '2026-10-04T20:00:00Z', leftClientAt: '2026-10-05T06:00:00Z', arrivedBackAt: '2026-10-07T08:00:00Z' };
  const t = P.tatCalc({ milestones: m }, 5);
  assert.equal(t.totalHours, 144); assert.equal(t.totalDays, 6); assert.equal(t.variance, 24); assert.equal(t.varianceDays, 1); assert.equal(t.status, 'Completed Late');
  assert.deepEqual(t.segments.map((s) => s.hours), [24, 48, 12, 10, 50]);
  assert.equal(P.tatCalc({ milestones: m }, 7).status, 'Completed Within Target');
  const active = { milestones: { allocatedAt: '2026-10-01T08:00:00Z', loadedAt: '2026-10-02T08:00:00Z' } };
  assert.equal(P.tatCalc(active, 5, '2026-10-03T08:00:00Z').status, 'Within Target');
  assert.equal(P.tatCalc(active, 5, '2026-10-05T12:00:00Z').status, 'Approaching Target');
  const overdue = P.tatCalc(active, 5, '2026-10-09T08:00:00Z'); assert.equal(overdue.status, 'Overdue'); assert.equal(overdue.done, false, 'an incomplete trip is never completed merely because its target passed'); assert.ok(overdue.remainingHours < 0);
  assert.equal(P.milestoneError(active.milestones, 'arrivedClientAt', '2026-10-01T09:00:00Z') !== '', true, 'milestones must be in order');
  assert.equal(P.milestoneError(active.milestones, 'arrivedClientAt', '2026-10-02T10:00:00Z'), '');
  const dash = P.tatDashboard([{ id: 'a', plate: 'T1', client: 'C', allocationId: 'x', tatTargetDays: 5, milestones: m, loadingFrom: 'L', loadingTo: 'K' }, { id: 'b', plate: 'T2', client: 'C', allocationId: 'y', tatTargetDays: 5, milestones: active.milestones, loadingFrom: 'L', loadingTo: 'K' }], [], '2026-10-09T08:00:00Z');
  assert.equal(dash.active, 1); assert.equal(dash.overdue, 1); assert.equal(dash.completedLate, 1); assert.equal(dash.compliancePct, 0); assert.equal(dash.byTruck.length, 2);
});

test('additional trip expenses: planner / station raise on open trips only, duplicates refused, only the Operations Manager approves, finance pays', () => {
  const open = { id: 't1', journeyPlanId: 'JMG-TRP-2026-000001', opsStatus: 'Open' }; const closed = Object.assign({}, open, { closedAt: 'x' });
  const req = { tripLogId: 't1', category: 'Toll / levy', amountRequested: 15000, reason: 'Diversion via Abeokuta' };
  assert.equal(D.expenseRequestError(open, [], req), '');
  assert.match(D.expenseRequestError(closed, [], req), /Closed; additional expense requests can only be raised while the trip is operationally Open/);
  assert.match(D.expenseRequestError(open, [Object.assign({ id: 'AEX-1', status: 'Pending Approval' }, req)], req), /already exists/);
  assert.match(D.expenseRequestError(open, [], Object.assign({}, req, { reason: '' })), /reason/);
  const cur = Object.assign({ id: 'AEX-1', status: 'Pending Approval' }, req);
  assert.equal(D.expenseTransitionError(cur, Object.assign({}, cur, { status: 'Approved', approvedAmount: 15000 }), 'operations'), '');
  for (const role of ['planning', 'station', 'finance', 'admin', 'management']) assert.match(D.expenseTransitionError(cur, Object.assign({}, cur, { status: 'Approved', approvedAmount: 15000 }), role), /Only the Operations Manager/, role + ' cannot approve');
  const approved = Object.assign({}, cur, { status: 'Approved', approvedAmount: 15000 });
  assert.equal(D.expenseTransitionError(approved, Object.assign({}, approved, { status: 'Paid' }), 'finance'), '');
  assert.match(D.expenseTransitionError(approved, Object.assign({}, approved, { status: 'Paid' }), 'operations'), /finance/);
  assert.match(D.expenseTransitionError(cur, Object.assign({}, cur, { status: 'Paid' }), 'finance'), /Only approved/);
  assert.equal(D.nextExpenseId('2026-10-14', [{ id: 'AEX-261014-01' }]), 'AEX-261014-02');
  assert.ok(E.can('planning', 'expense.request') && E.can('station', 'expense.request') && !E.can('billing', 'expense.request'));
  assert.ok(E.can('operations', 'expense.approve') && !E.can('admin', 'expense.approve') && E.can('finance', 'expense.pay'));
});

test('billing readiness: mandatory waybill and POD before normal invoicing; pending documents listed', () => {
  const base = { id: 't', client: 'C', dateDelivered: '2026-10-05', waybill: 'WB-1' };
  let r = E.billingReadiness(base); assert.equal(r.ready, false); assert.deepEqual(r.missing, ['Waybill copy', 'POD (proof of delivery)']); assert.equal(r.category, 'pending');
  r = E.billingReadiness(Object.assign({}, base, { waybillReceivedAt: 'x', podReceivedAt: 'x' })); assert.deepEqual(r.missing, ['Waybill verification', 'POD verification']);
  r = E.billingReadiness(Object.assign({}, base, { waybillVerifiedAt: 'x', podVerifiedAt: 'x' })); assert.equal(r.ready, true); assert.equal(r.category, 'ready');
  r = E.billingReadiness(Object.assign({}, base, { waybillVerifiedAt: 'x', podVerifiedAt: 'x' }), { client: { requireDeliveryConfirmation: true, requiredDocs: ['Gate pass'] } }); assert.deepEqual(r.missing, ['Signed delivery confirmation', 'Gate pass']);
  r = E.billingReadiness(Object.assign({}, base, { dateDelivered: '', waybillVerifiedAt: 'x', podVerifiedAt: 'x' })); assert.match(r.missing[0], /Trip completion/);
  r = E.billingReadiness(Object.assign({}, base, { waybillVerifiedAt: 'x', podVerifiedAt: 'x', invoiceId: 'i', invoiceStatus: 'Draft Invoice' })); assert.equal(r.category, 'draft');
  r = E.billingReadiness(Object.assign({}, base, { invoiceId: 'i', invoiceStatus: 'Invoice Sent' })); assert.equal(r.category, 'issued');
  assert.equal(E.podStatus({ podReceivedAt: 'x' }), 'POD Received'); assert.equal(E.podStatus({}), 'POD Pending');
  assert.ok(E.can('operations', 'invoice.override.ops') && E.can('finance', 'invoice.override.finance') && !E.can('billing', 'invoice.override.ops'), 'the exceptional override needs both approvals');
});

test('management KPIs for the workflow are computed from live records', () => {
  const trips = [{ id: 't1', client: 'Jamara', plate: 'T1', allocationId: 'a', journeyPlanId: 'JMG-TRP-2026-000001', dateDelivered: '2026-10-10', waybillVerifiedAt: 'x', podVerifiedAt: 'x', sellingPrice: 100, netSales: 100, serviceType: 'Internal Fleet', opsStatus: 'Open', milestones: { allocatedAt: '2026-10-01T08:00:00Z' }, tatTargetDays: 2, waybillStatus: 'Waybill Verified', podStatus: 'POD Verified' }, { id: 't2', client: 'ORCA DECO LIMITED', plate: 'X', serviceType: '3rd Party Contractor', sellingPrice: 900, netSales: 900, contractorCost: 700, dateDelivered: '2026-10-10', waybillStatus: 'Awaiting Waybill', podStatus: 'POD Pending', opsStatus: 'Open' }];
  const k = D.managementKpis(Object.assign({}, ctx, { trips, invoices: [], clients: [], dieselreqs: [{ kind: 'diesel', submittedAt: 'x', issues: [], supplementary: [] }, { kind: 'diesel', submittedAt: 'x', opsApprovedAt: 'x', approvedQty: 10, issues: [], supplementary: [] }], roadslips: [{ kind: 'road', submittedAt: 'x', opsApprovedAt: 'x', approvedQty: 100, issues: [], supplementary: [] }], extraexpenses: [{ status: 'Pending Approval' }], lostsales: [] }));
  assert.equal(k.openRequests, requests.filter((r) => !['Completed', 'Cancelled'].includes(P.requestStatus(r, P.requestCounts(r, allocations, trips), ctx))).length);
  assert.equal(k.awaitingRouteMapping, 1); assert.ok(k.awaitingPlanning > 0); assert.equal(k.dieselPendingApproval, 1); assert.equal(k.dieselApprovedNotIssued, 1); assert.equal(k.roadPendingPayment, 1); assert.equal(k.extrasPending, 1);
  assert.equal(k.readyForInvoicing, 1); assert.equal(k.awaitingPod, 1); assert.equal(k.awaitingWaybill, 1); assert.equal(k.exceedingTat, 1); assert.equal(k.activeTrips, 2);
  assert.equal(k.internalRevenue, 100); assert.equal(k.tplRevenue, 900); assert.equal(k.tplMargin, 200);
});
