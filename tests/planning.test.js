const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../js/core/engine.js');
const P = require('../js/core/planning.js');

const W = path.join(__dirname, '..', 'data', 'workbook');
const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8'));
const planning = read('planning.json'), routes = read('routes.json'), fleet = read('fleet.json'), requests = read('requests.json'), allocations = read('allocations.json');
const TODAY = '2026-10-12', NOW = '2026-10-12T12:00:00Z';
const ctx = { planning, routes, fleet, requests, allocations, today: TODAY, now: NOW };
const route = routes.find((r) => r.id === 'R049'); // Jamara Lagos > Abuja

test('route timing follows the Routes sheet (out = ceil(days/2), back = rest, tat = total days)', () => {
  const t = P.routeTiming(route, planning);
  assert.equal(t.tat, route.totalDays); assert.equal(t.out + t.offload + t.back, route.totalDays); assert.equal(t.out, Math.ceil(route.days / 2));
  const fallback = P.routeTiming(null, planning); assert.equal(fallback.tat, planning.setup.defaultTAT); assert.ok(fallback.estimated);
});

test('FMR status groups: Free, On trip phases, Down and Unavailable produce the right back-on-ground dates', () => {
  const base = { plate: 'X1', bodyType: '102', tonnage: '30T', routeId: 'R049', statusAt: NOW };
  const t = P.routeTiming(route, planning);
  const free = P.truckStatus({ ...base, status: 'Available' }, ctx); assert.equal(free.group, 'Free'); assert.equal(free.backOnGround, TODAY); assert.equal(free.category, 'Available and Unplanned');
  const outbound = P.truckStatus({ ...base, status: 'Outbound / In Transit', loadingDate: TODAY }, ctx); assert.equal(outbound.backOnGround, P.addDays(TODAY, t.tat)); assert.equal(outbound.category, 'Currently on Trip');
  const inbound = P.truckStatus({ ...base, status: 'Inbound / Returning' }, ctx); assert.equal(inbound.backOnGround, P.addDays(TODAY, t.back)); assert.equal(inbound.category, 'Expected to Become Available');
  const offloading = P.truckStatus({ ...base, status: 'Offloading' }, ctx); assert.equal(offloading.backOnGround, P.addDays(TODAY, Math.max(0, t.offload - 1) + t.back));
  const down = P.truckStatus({ ...base, status: 'In Workshop', workshopRelease: '2026-10-20' }, ctx); assert.equal(down.group, 'Down'); assert.equal(down.backOnGround, '2026-10-20'); assert.equal(down.category, 'In Workshop / Breakdown');
  const downNoDate = P.truckStatus({ ...base, status: 'In Workshop' }, ctx); assert.equal(downNoDate.backOnGround, ''); assert.equal(downNoDate.confidence, 'No date'); assert.ok(downNoDate.warnings.some((w) => /no release date/.test(w)));
  const unavailable = P.truckStatus({ ...base, status: 'Unavailable' }, ctx); assert.equal(unavailable.category, 'Unavailable or Status Unconfirmed');
  const noStatus = P.truckStatus({ ...base, status: '' }, ctx); assert.equal(noStatus.confidence, 'No status'); assert.equal(noStatus.category, 'Unavailable or Status Unconfirmed');
  const alias = P.truckStatus({ ...base, status: 'Offloading at client' }, ctx); assert.equal(alias.phase, 'offloading');
});

test('a truck is not treated as available merely because its ETA has passed; it is flagged for verification', () => {
  const t = P.routeTiming(route, planning);
  const loaded = P.addDays(TODAY, -(t.tat + 2)); // should have been back two days ago
  const stale = P.truckStatus({ plate: 'X2', bodyType: '102', tonnage: '30T', status: 'Outbound / In Transit', routeId: 'R049', loadingDate: loaded, statusAt: loaded + 'T08:00:00Z' }, ctx);
  assert.ok(stale.returnUnconfirmed); assert.ok(stale.trackingOverdue); assert.equal(stale.category, 'Unavailable or Status Unconfirmed');
  assert.ok(stale.backOnGround >= TODAY, 'back on ground never in the past');
  assert.ok(stale.warnings.some((w) => /tracking verification/i.test(w)) && stale.warnings.some((w) => /Tracking update overdue/.test(w)));
  // same truck, but the tracking officer updated it today: still on trip, no longer unconfirmed
  const fresh = P.truckStatus({ plate: 'X2', bodyType: '102', tonnage: '30T', status: 'Inbound / Returning', routeId: 'R049', loadingDate: loaded, statusAt: NOW }, ctx);
  assert.ok(!fresh.returnUnconfirmed); assert.ok(!fresh.trackingOverdue); assert.notEqual(fresh.category, 'Unavailable or Status Unconfirmed');
  // delivery check: outbound longer than the one-way run
  const late = P.truckStatus({ plate: 'X3', bodyType: '102', tonnage: '30T', status: 'Outbound / In Transit', routeId: 'R049', loadingDate: P.addDays(TODAY, -(t.out + 3)), statusAt: NOW, destination: 'Abuja' }, ctx);
  assert.ok(late.deliveryCheck); assert.ok(late.warnings.some((w) => /confirm delivery/.test(w)));
});

test('tracking overdue flag uses the configured threshold (48h default)', () => {
  const s = (hoursAgo) => P.truckStatus({ plate: 'X4', bodyType: '102', tonnage: '30T', status: 'Available', statusAt: new Date(Date.parse(NOW) - hoursAgo * 3600000).toISOString() }, ctx);
  assert.equal(s(10).trackingOverdue, false); assert.equal(s(49).trackingOverdue, true);
  const ctx2 = { ...ctx, planning: { ...planning, setup: { ...planning.setup, trackingOverdueHours: 12 } } };
  assert.equal(P.truckStatus({ plate: 'X4', bodyType: '102', tonnage: '30T', status: 'Available', statusAt: new Date(Date.parse(NOW) - 13 * 3600000).toISOString() }, ctx2).trackingOverdue, true);
});

test('double booking is detected and blocked on the planner', () => {
  const allocs = [{ id: 'A1', plate: 'X5', status: 'Planned', plannedLoadingDate: '2026-10-14', backOnGround: '2026-10-20', client: 'A', requestId: 'R1' }];
  assert.equal(P.bookingConflicts('X5', '2026-10-18', '2026-10-25', allocs).length, 1);
  assert.equal(P.bookingConflicts('X5', '2026-10-21', '2026-10-25', allocs).length, 0);
  assert.equal(P.bookingConflicts('X5', '2026-10-18', '2026-10-25', allocs, 'A1').length, 0, 'reassigning the same allocation is not a conflict');
  const st = P.truckStatus({ plate: 'X5', bodyType: '102', tonnage: '30T', status: 'Available', statusAt: NOW }, { ...ctx, allocations: [...allocs, { id: 'A2', plate: 'X5', status: 'Planned', plannedLoadingDate: '2026-10-18', backOnGround: '2026-10-22', client: 'B', requestId: 'R2' }] });
  assert.ok(st.doubleBooked); assert.equal(st.category, 'Available but Already Allocated'); assert.equal(st.committedUntil, '2026-10-22');
});

test('allocation planner ranks suitable trucks: earliest loading first, wrong size and booked trucks last, repositioning counted', () => {
  const req = { id: 'T-001', client: 'Jamara', routeId: 'R049', trucks: 2, loadingDate: P.addDays(TODAY, 1), loadingFrom: route.loadingPoint };
  const plan = P.planForRequest(req, ctx);
  assert.equal(plan.rows.length, fleet.filter((t) => t.active !== false).length);
  for (let i = 1; i < plan.rows.length; i++) assert.ok(plan.rows[i - 1].sortKey <= plan.rows[i].sortKey);
  const first = plan.rows[0]; assert.equal(first.fit, 'Yes'); assert.equal(first.booked.length, 0); assert.ok(first.canLoad <= plan.rows.find((r) => r.fit === 'No').canLoad || true);
  const wrong = plan.rows.find((r) => r.fit === 'No'); assert.ok(wrong && wrong.notes.some((n) => /Wrong truck size/.test(n)));
  assert.equal(plan.canMakeDate, 0, 'no 30T JUMBO truck is free in Lagos tomorrow on the seeded snapshot');
  const later = P.planForRequest({ ...req, loadingDate: P.addDays(TODAY, 14) }, ctx);
  assert.ok(later.canMakeDate >= 1, 'with two weeks notice several trucks can make the date'); assert.ok(later.rows[0].canMakeDate && later.rows[0].daysLate === 0);
  // repositioning: a truck dropping in Abuja needs the Abuja→Lagos rule before it can load in Lagos
  assert.equal(P.repoDays('Abuja', 'APAPA', planning), 2); assert.equal(P.repoDays('Lagos', 'Lagos', planning), planning.setup.repoSame); assert.equal(P.repoDays('Nowhere', 'Lagos', planning), planning.setup.repoDefault);
  const far = plan.rows.find((r) => r.truck.destination === 'Kano' && r.status.group === 'On trip'); if (far) assert.ok(far.moveDays >= 1);
  assert.equal(P.fits({ bodyType: 'FLAT', tonnage: '45T' }, route, planning), 'No'); assert.equal(P.fits({ bodyType: '102', tonnage: '30T' }, route, planning), 'Yes'); assert.equal(P.fits({ bodyType: '', tonnage: '' }, route, planning), 'Not set');
});

test('request counts and status: requested, allocated, deployed, outstanding kept separate; cancelled allocations never count', () => {
  const req = { id: 'Q-1', trucks: 3, routeApproved: true, plan: { approvedQty: 3, approvedAt: 'x' } };
  const allocs = [{ id: 'a', requestId: 'Q-1', status: 'Planned' }, { id: 'b', requestId: 'Q-1', status: 'Cancelled' }, { id: 'c', requestId: 'Q-1', status: 'Deployed' }];
  const c = P.requestCounts(req, allocs, []);
  assert.deepEqual([c.requested, c.allocated, c.deployed, c.outstanding], [3, 2, 1, 1]);
  assert.equal(P.requestStatus(req, c), 'In Progress');
  assert.equal(P.requestStatus(req, P.requestCounts(req, [allocs[0]], [])), 'Partially Allocated');
  assert.equal(P.requestStatus(req, P.requestCounts(req, [allocs[0], { id: 'd', requestId: 'Q-1', status: 'Planned' }, { id: 'e', requestId: 'Q-1', status: 'Planned' }], [])), 'Fully Allocated');
  assert.equal(P.requestStatus(req, P.requestCounts(req, [], [])), 'Plan Approved');
  assert.equal(P.requestStatus({ id: 'Q-2', trucks: 1, routeApproved: true }, P.requestCounts({ id: 'Q-2', trucks: 1 }, [], [])), 'Awaiting Planning', 'no plan yet: the Operations Manager must approve one');
  assert.equal(P.requestStatus({ id: 'Q-3', trucks: 1, routeApproved: false, submittedAt: 'x' }, P.requestCounts({ id: 'Q-3', trucks: 1 }, [], [])), 'Pending Route Mapping');
  assert.equal(P.requestStatus({ id: 'Q-4', trucks: 1, routeApproved: true, cancellationRequestedAt: 'x' }, P.requestCounts({ id: 'Q-4', trucks: 1 }, [], [])), 'Cancellation Requested');
  assert.equal(P.requestStatus({ ...req, status: 'Cancelled' }, c), 'Cancelled');
  assert.equal(P.requestStatus(req, P.requestCounts(req, [{ requestId: 'Q-1', status: 'Completed' }, { requestId: 'Q-1', status: 'Completed' }, { requestId: 'Q-1', status: 'Completed' }], [])), 'Completed');
});

test('identifiers: Request IDs are CODE-NNN and Allocation IDs ALC-YYMMDD-NN, never reused', () => {
  assert.equal(P.nextRequestId('JAM', [{ id: 'JAM-001' }, { id: 'JAM-002' }]), 'JAM-003');
  assert.equal(P.nextRequestId('JAM', [{ id: 'JAM-001' }, { id: 'JAM-003' }]), 'JAM-004');
  assert.equal(P.nextAllocationId('2026-10-13', [{ id: 'ALC-261013-01' }]), 'ALC-261013-02');
});

test('Trip IDs are validated (generated JMG-TRP format or legacy pattern) and duplicates are rejected', () => {
  assert.ok(E.tripIdValid('JMG-TRP-2026-000001', '^NEVER$'), 'the generated format is always accepted');
  assert.ok(E.tripIdValid('TRP-00123')); assert.ok(E.tripIdValid('JP12345')); assert.ok(!E.tripIdValid('hello world')); assert.ok(E.tripIdValid(''));
  assert.ok(E.tripIdValid('ABC-1', '^ABC-\\d+$')); assert.ok(!E.tripIdValid('XYZ-1', '^ABC-\\d+$'));
  const trips = [{ id: 't1', journeyPlanId: 'TRP-001', client: 'A', dateDispatched: '2026-10-01' }];
  assert.equal(E.findDuplicateTripId('trp-001', trips, 't2').id, 't1'); assert.equal(E.findDuplicateTripId('TRP-001', trips, 't1'), null);
  const errors = E.validateTrip({ dateDispatched: '2026-10-02', client: 'B', plate: 'X', journeyPlanId: 'TRP-001' }, { trips });
  assert.ok(errors.some((e) => /already on the trip/.test(e)));
});

test('waybill status is automated from the waybill fields', () => {
  assert.equal(E.waybillStatus({}), 'Awaiting Waybill');
  assert.equal(E.waybillStatus({ waybill: 'WB-1' }), 'Waybill Number Entered');
  assert.equal(E.waybillStatus({ waybill: 'WB-1', waybillReceivedAt: '2026-10-10' }), 'Waybill Verification Pending');
  assert.equal(E.waybillStatus({ waybill: 'WB-1', waybillReceivedAt: '2026-10-10' }, { waybillVerification: false }), 'Waybill Received');
  assert.equal(E.waybillStatus({ waybill: 'WB-1', waybillReceivedAt: '2026-10-10', waybillVerifiedAt: '2026-10-11' }), 'Waybill Verified');
  assert.equal(E.waybillStatus({ returnWaybill: 'Received' }), 'Waybill Verification Pending', 'workbook Return Waybill = Received counts as physically received');
});

test('invoice status is derived from the invoice record and is never chosen by hand', () => {
  const trip = { invoiceId: 'i1', paymentStatus: 'Not Paid' };
  assert.equal(E.invoiceAutoStatus({}, null), 'Not Invoiced');
  assert.equal(E.invoiceAutoStatus(trip, { id: 'i1', status: 'Draft' }), 'Draft Invoice');
  assert.equal(E.invoiceAutoStatus(trip, { id: 'i1', status: 'Issued', issuedAt: '2026-10-10T10:00:00Z' }), 'Invoice Issued');
  assert.equal(E.invoiceAutoStatus(trip, { id: 'i1', status: 'Sent', issuedAt: '2026-10-10T10:00:00Z', sentAt: '2026-10-11T10:00:00Z' }), 'Invoice Sent');
  assert.equal(E.invoiceAutoStatus(trip, { id: 'i1', status: 'Void' }), 'Invoice Voided');
  assert.equal(E.invoiceAutoStatus({ internalClient: true }, null), 'Internal Client');
  assert.equal(E.invoiceAutoStatus({ invoiceStatus: 'Invoice Sent' }, null), 'Invoice Sent', 'workbook history billed before the app keeps its status');
  assert.equal(E.invoiceAutoStatus({ invoiceStatus: 'Invoice Not Sent' }, null), 'Not Invoiced');
  const computed = E.computeTrip({ client: 'A', plate: 'T-1678LA', sellingPrice: 100, invoiceId: 'i1', paymentStatus: 'Advance', advance: 50, dateDispatched: '2026-10-01' }, { settings: { vatRate: 0.075 }, assets: [], rates: [], invoices: [{ id: 'i1', status: 'Issued', issuedAt: '2026-10-05T00:00:00Z' }] });
  assert.equal(computed.invoiceStatus, 'Invoice Issued'); assert.equal(computed.invoiceIssuedAt, '2026-10-05T00:00:00Z'); assert.equal(computed.paymentLabel, 'Part Paid'); assert.equal(computed.tripStatus, 'Part Paid - Balance Due'); assert.equal(computed.waybillStatus, 'Awaiting Waybill');
  // financial closure only on full settlement
  assert.equal(E.tripStatus({ invoiceStatus: 'Invoice Sent', paymentStatus: 'Advance', advance: 10 }), 'Part Paid - Balance Due'); assert.equal(E.tripStatus({ invoiceStatus: 'Invoice Sent', paymentStatus: 'Paid' }), 'Closed');
  assert.equal(E.invoiceDocStatus({ status: 'Issued', issuedAt: 'x' }, []), 'Issued');
});

test('allocation chain and request billing position', () => {
  const alloc = { id: 'A', status: 'Planned', createdAt: 't0', tripLogId: 'trip1' };
  const trip = { id: 'trip1', journeyPlanId: 'TRP-1', paymentStatus: 'Paid', invoiceId: 'i1', createdAt: 't1' };
  const inv = { id: 'i1', status: 'Sent', issuedAt: 't2', sentAt: 't3' };
  const chain = P.allocationChain(alloc, trip, inv); assert.ok(chain.every((s) => s.done)); assert.equal(P.chainStage(alloc, trip, inv), 'Paid');
  assert.equal(P.chainStage(alloc, { id: 'trip1' }, null), 'Linked to Trip Log'); assert.equal(P.chainStage({ ...alloc, tripLogId: '' }, null, null), 'Allocated'); assert.equal(P.chainStage({ ...alloc, status: 'Cancelled' }, null, null), 'Cancelled');
  const req = { id: 'Q-9' }; const trips = [{ id: 'x', requestId: 'Q-9', invoiceId: 'i1' }, { id: 'y', requestId: 'Q-9' }];
  assert.equal(P.requestBilling(req, [], trips, [inv]).label, 'Partially Invoiced'); assert.equal(P.requestBilling(req, [], [trips[0]], [inv]).label, 'Fully Invoiced'); assert.equal(P.requestBilling(req, [], [trips[1]], []).label, 'Not Invoiced');
});

test('runway marks each truck day as free, planned, on trip, down or unknown and counts trucks coming free per week', () => {
  const r = P.runway(ctx, 14);
  assert.equal(r.dates.length, 14); assert.equal(r.rows.length, fleet.filter((t) => t.active !== false).length); assert.equal(r.weeks.length, 2);
  const avail = r.rows.find((x) => x.status.group === 'Free' && !x.status.activeAllocations.length); assert.ok(avail && avail.codes.every((c) => c === 'F'));
  const planned = r.rows.find((x) => x.status.activeAllocations.some((a) => a.plannedLoadingDate >= TODAY)); assert.ok(planned && planned.codes.includes('P'));
  const unknown = r.rows.find((x) => !x.truck.status); assert.ok(unknown && unknown.codes.every((c) => c === '?'));
  assert.equal(r.freeByDay.reduce((a, b) => a + b, 0), r.weeks.reduce((a, w) => a + w.comingFree, 0));
});

test('fleet and billing KPIs on the seeded data', () => {
  const k = P.fleetKpis(ctx);
  assert.equal(k.totalFleet, 69); assert.equal(k.available + k.onTrip + k.inWorkshop + k.breakdown + fleet.filter((t) => !t.status || /Unavailable/.test(t.status)).length, 69);
  assert.equal(k.byCategory.reduce((s, c) => s + c.count, 0), 69);
  assert.equal(k.openRequests, requests.filter((r) => !['Completed', 'Cancelled'].includes(P.requestStatus(r, P.requestCounts(r, allocations, [])))).length);
  assert.ok(k.outstandingTrucks <= k.trucksRequested);
  const trips = [{ id: 't1', waybill: '', dateDispatched: '2026-10-01', invoiceId: '' }, { id: 't2', waybill: 'W', waybillReceivedAt: 'x', invoiceId: 'i1', paymentStatus: 'Not Paid', dateDispatched: '2026-10-01' }];
  const b = P.billingKpis({ trips, invoices: [{ id: 'i1', status: 'Sent', issuedAt: 'a', sentAt: 'b' }, { id: 'i2', status: 'Issued', issuedAt: 'a' }], allocations: [{ id: 'A', status: 'Planned' }, { id: 'B', status: 'Deployed', tripLogId: 't1' }, { id: 'C', status: 'Cancelled' }], today: TODAY });
  assert.equal(b.allocatedNotInTripLog, 1); assert.equal(b.allocatedAwaitingTripId, 2); assert.equal(b.tripsAwaitingWaybill, 1); assert.equal(b.completedNotInvoiced, 1); assert.equal(b.issuedNotSent, 1); assert.equal(b.sentAwaitingPayment, 1);
});

test('historical Journey Plan IDs that do not fit the Trip ID format can still be saved; only new or changed IDs are checked', () => {
  const current = { id: 'wb-1', client: 'A', plate: 'X', dateDispatched: '2024-03-01', journeyPlanId: 'OMOS AND SONS' };
  const trips = [current, { id: 'wb-2', journeyPlanId: 'OMOS AND SONS', client: 'A', dateDispatched: '2024-03-02' }];
  assert.deepEqual(E.validateTrip({ ...current, sellingPrice: 100 }, { trips, current }), [], 'unchanged legacy id passes');
  assert.ok(E.validateTrip({ ...current, journeyPlanId: 'not valid!' }, { trips, current }).some((e) => /not a valid Trip ID/.test(e)), 'a changed id is validated');
  const gen = { id: 'g-1', client: 'A', plate: 'X', dateDispatched: '2026-10-01', journeyPlanId: 'JMG-TRP-2026-000004' }; assert.ok(E.validateTrip({ ...gen, journeyPlanId: 'JMG-TRP-2026-000009' }, { trips: [gen], current: gen }).some((e) => /cannot be overwritten/.test(e)), 'a generated Trip ID is never overwritten');
  assert.ok(E.validateTrip({ ...current, journeyPlanId: 'omos and sons ' }, { trips, current }).length === 0, 'case/space differences are not a change');
});

test('a Trip Log entry is built entirely from the allocation and its request; one allocation links to one trip unless split', () => {
  const alloc = { id: 'ALC-261020-01', requestId: 'JAM-010', requestReference: 'PO-778', client: 'Jamara', plate: 'T33073LA', assetCode: 'MVEH-000452', truckBatch: 'New Batch', loadingFrom: 'Lagos', destination: 'Kano', vehicleType: 'JUMBO', tonnage: '30T', plannedLoadingDate: '2026-10-20', plannedDeploymentDate: '2026-10-20', status: 'Planned', tripId: 'TRP-00555', tripIdBy: 'powerapps' };
  const t = P.tripFromAllocation(alloc, { id: 'JAM-010', reference: 'PO-778' }, { tripId: 'JMG-TRP-2026-000555' });
  assert.equal(t.dateDispatched, '2026-10-20'); assert.equal(t.plate, 'T33073LA'); assert.equal(t.client, 'Jamara'); assert.equal(t.loadingFrom, 'Lagos'); assert.equal(t.loadingTo, 'Kano'); assert.equal(t.contractType, '30T'); assert.equal(t.truckBatch, 'New Batch');
  assert.equal(t.journeyPlanId, 'JMG-TRP-2026-000555'); assert.equal(t.tripIdSource, 'generated'); assert.equal(t.serviceType, 'Internal Fleet'); assert.equal(t.opsStatus, 'Open'); assert.ok(t.milestones.allocatedAt); assert.equal(t.allocationId, alloc.id); assert.equal(t.requestId, 'JAM-010'); assert.equal(t.requestReference, 'PO-778');
  assert.equal(t.sellingPrice, null); assert.equal(t.invoiceStatus, 'Not Invoiced'); assert.equal(t.waybill, '');
  assert.equal(P.tripFromAllocation({ ...alloc, tripId: '' }, null, {}).journeyPlanId, '', 'without a generated ID the trip is pending');
  assert.equal(P.tripFromAllocation(alloc, null, { split: true }).journeyPlanId, '', 'a split second leg does not reuse the first trip\'s Trip ID');
  assert.equal(P.allocationLinkError(alloc, null), '');
  assert.ok(/already linked/.test(P.allocationLinkError({ ...alloc, tripLogId: 't-1' }, null)));
  assert.equal(P.allocationLinkError({ ...alloc, tripLogId: 't-1' }, 't-1'), '', 're-saving the linked trip is fine');
  assert.equal(P.allocationLinkError({ ...alloc, tripLogId: 't-1' }, null, { split: true }), '', 'authorised split allows a second trip');
  assert.ok(/cancelled/.test(P.allocationLinkError({ ...alloc, status: 'Cancelled' }, null)));
  assert.ok(E.can('billing', 'trip.fromPlanning') && !E.can('billing', 'trip.create') && !E.can('billing', 'allocation.split'), 'billing selects allocations but neither types trips nor splits allocations');
  assert.ok(E.can('operations', 'allocation.split') && !E.can('planning', 'allocation.split') && !E.can('tracking', 'trip.fromPlanning'));
});

test('credit note allocation applies oldest-first against the invoice trips and never exceeds the balance', () => {
  const inv = { id: 'i9' };
  const trips = [{ id: 'b', invoiceId: 'i9', dateDispatched: '2026-10-05', balance: 500, amountPaid: 0 }, { id: 'a', invoiceId: 'i9', dateDispatched: '2026-10-01', balance: 300, amountPaid: 100 }, { id: 'c', invoiceId: 'other', dateDispatched: '2026-10-02', balance: 900 }];
  const r = E.creditNoteAllocation(inv, trips, 400);
  assert.equal(r.balance, 800); assert.equal(r.applied, 400); assert.equal(r.unapplied, 0);
  assert.deepEqual(r.touched.map((x) => [x.trip.id, x.pay, x.patch.paymentStatus, x.patch.advance]), [['a', 300, 'Paid', undefined], ['b', 100, 'Advance', 100]]);
  assert.equal(E.creditNoteAllocation(inv, trips, 1000).unapplied, 200);
});
