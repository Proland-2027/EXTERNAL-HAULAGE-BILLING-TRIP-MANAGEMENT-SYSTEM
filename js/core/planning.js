/*
 * Fleet planning engine — a port of the Truck Planning Management workbook (Fleet (FMR), Routes, Setup, Requests,
 * Committed trips, Allocation planner, Runway) into database-backed rules. Pure functions; shared by browser,
 * server and tests. Dates are ISO strings (YYYY-MM-DD); timestamps are ISO date-times.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else { root.HB = root.HB || {}; root.HB.planning = factory(root.HB.engine); }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const norm = E.norm, clean = E.clean, num = E.num, locKey = E.locKey;

  // ------------------------------------------------------------ catalogues
  /** Operational statuses (configurable in Settings → Planning). group drives every availability date. */
  const DEFAULT_STATUSES = [
    { status: 'Available', group: 'Free' },
    { status: 'Allocated / Planned', group: 'Free' },
    { status: 'At Loading Point', group: 'On trip', phase: 'loading' },
    { status: 'Loading', group: 'On trip', phase: 'loading' },
    { status: 'Loaded', group: 'On trip', phase: 'outbound' },
    { status: 'Outbound / In Transit', group: 'On trip', phase: 'outbound' },
    { status: 'At Destination', group: 'On trip', phase: 'destination' },
    { status: 'Offloading', group: 'On trip', phase: 'offloading' },
    { status: 'Inbound / Returning', group: 'On trip', phase: 'inbound' },
    { status: 'In Workshop', group: 'Down' },
    { status: 'Breakdown in Transit', group: 'Down' },
    { status: 'Awaiting Workshop Release', group: 'Down' },
    { status: 'Unavailable', group: 'Unavailable' },
  ];
  /** Workbook spellings map onto the configured list. */
  const STATUS_ALIASES = { 'available': 'Available', 'on standby / held': 'Allocated / Planned', 'loading at bay': 'Loading', 'laden': 'Loaded', 'outbound': 'Outbound / In Transit', 'in transit': 'Outbound / In Transit', 'at client destination': 'At Destination', 'offloading at client': 'Offloading', 'inbound (returning)': 'Inbound / Returning', 'in workshop': 'In Workshop', 'transit breakdown (offsite)': 'Breakdown in Transit', 'breakdown': 'Breakdown in Transit' };
  const DEFAULT_SETUP = { defaultTAT: 7, buffer: 0, idleDays: 3, repoDefault: 3, repoSame: 0, runwayDays: 92, trackingOverdueHours: 48, returnSoonDays: 3, tripIdPattern: E.DEFAULT_TRIP_ID_PATTERN, waybillVerification: true, dieselPrice: 1100 };
  const REQUEST_STATUSES = ['New Request', 'Under Planning', 'Partially Allocated', 'Fully Allocated', 'In Progress', 'Completed', 'Cancelled'];
  const ALLOCATION_STATUSES = ['Planned', 'Deployed', 'Loaded', 'Completed', 'Cancelled'];
  const PRIORITIES = ['Urgent', 'Normal', 'Fill-in'];
  const WAYBILL_STATUSES = E.WAYBILL_STATUSES;
  const INVOICE_STATUS_AUTO = E.INVOICE_STATUSES;
  const INVOICE_DOC_STATUSES = E.INVOICE_DOC_STATUSES;
  const CHAIN_STAGES = ['Allocated', 'Linked to Trip Log', 'Trip ID Assigned', 'Invoiced', 'Invoice Sent', 'Paid'];
  const AVAILABILITY_CATEGORIES = ['Available and Unplanned', 'Available but Already Allocated', 'Expected to Become Available', 'Currently on Trip', 'In Workshop / Breakdown', 'Unavailable or Status Unconfirmed'];
  /** Body type → contract sizes it can run (Setup "Which contracts each body can run"). */
  const DEFAULT_BODY_RUNS = { '102': 'JUMBO', 'FLAT': 'FLATBED;FLATBED-local', 'FLAT-CONTAINER': 'CONTAINARIZED', 'Pallatized Body': 'JUMBO', 'SIDED': 'JUMBO', 'Free Head': '' };

  // ------------------------------------------------------------- helpers
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const addDays = (iso, n) => E.addDays(iso, n);
  const diffDays = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
  const maxDate = (...ds) => ds.filter(Boolean).sort().pop() || '';
  const plateKey = (p) => norm(p).replace(/[^a-z0-9]/g, '');
  const hoursSince = (iso, now) => (iso ? (Date.parse(now || new Date().toISOString()) - Date.parse(iso)) / 3600000 : Infinity);
  const setupOf = (planning) => Object.assign({}, DEFAULT_SETUP, (planning && planning.setup) || {});
  const statusList = (planning) => (planning && Array.isArray(planning.statuses) && planning.statuses.length ? planning.statuses : DEFAULT_STATUSES);
  function statusInfo(status, planning) {
    const list = statusList(planning); const n = norm(status);
    return list.find((s) => norm(s.status) === n) || list.find((s) => norm(s.status) === norm(STATUS_ALIASES[n] || '')) || (n ? { status, group: 'Unavailable' } : null);
  }
  function canonicalStatus(status, planning) { const i = statusInfo(status, planning); return i ? i.status : ''; }
  /** Days to reposition an empty truck from its drop point to a loading bay (Setup repositioning rules). */
  function repoDays(from, to, planning) {
    const s = setupOf(planning); const rules = (planning && planning.repo) || [];
    if (!from) return s.repoDefault; const f = locKey(from), t = locKey(to);
    if (f === t) return s.repoSame;
    const hit = rules.find((r) => locKey(r.from) === f && locKey(r.to) === t) || rules.find((r) => locKey(r.from) === t && locKey(r.to) === f);
    return hit ? Number(hit.days) : s.repoDefault;
  }
  /** Route turnaround from the route register (Routes sheet): daysOut = ceil(days/2), back = days − out, tat = total days. */
  function routeTiming(route, planning) {
    const s = setupOf(planning);
    if (!route) return { out: Math.max(1, Math.round(s.defaultTAT * 0.45)), offload: s.defaultTAT >= 4 ? 1 : 0, back: Math.max(1, s.defaultTAT - Math.max(1, Math.round(s.defaultTAT * 0.45)) - (s.defaultTAT >= 4 ? 1 : 0)), tat: s.defaultTAT, estimated: true };
    const days = num(route.days) || 0, offload = num(route.offloading) || 0, total = num(route.totalDays) || 0;
    const out = Math.max(1, Math.ceil(days / 2)), back = Math.max(1, days - out), tat = total > 0 ? total : out + offload + back;
    return { out, offload, back, tat, estimated: false };
  }
  function routeLabel(r) { return r ? `${r.id}  ${r.client} ${r.tonnage || ''} ${r.size || ''}  ${r.loadingPoint} > ${r.destination}`.replace(/\s+/g, ' ') : ''; }
  function findRoute(routes, id) { return (routes || []).find((r) => r.id === id) || null; }
  function routeCost(route, planning) { const diesel = num(planning && planning.setup && planning.setup.dieselPrice) || 1100; const cost = (num(route.diesel) || 0) * diesel + (num(route.roadExpenses) || 0) + (num(route.contingency) || 0) + (num(route.additional) || 0); const price = num(route.price) || 0; const t = routeTiming(route, planning); return { cost: E.round2(cost), margin: E.round2(price - cost), marginPct: price ? E.round2(((price - cost) / price) * 100) : 0, perTruckDay: E.round2((price - cost) / Math.max(0.5, t.tat)) }; }
  /** Can this truck run the route's contract size/tonnage? ("Fits" on the Allocation planner) */
  function fits(truck, route, planning) {
    if (!route) return 'Yes';
    const runs = String(truck.runsContracts || bodyRuns(truck.bodyType, planning) || '');
    if (!truck.bodyType || !truck.tonnage) return 'Not set';
    const okSize = !route.size || runs.split(';').map(norm).includes(norm(route.size));
    const okTon = !route.tonnage || E.normContract(truck.tonnage) === E.normContract(route.tonnage);
    return okSize && okTon ? 'Yes' : 'No';
  }
  function bodyRuns(bodyType, planning) { const map = (planning && planning.bodyRuns) || DEFAULT_BODY_RUNS; const k = Object.keys(map).find((x) => norm(x) === norm(bodyType)); return k ? map[k] : ''; }

  // ------------------------------------------------------ availability (FMR)
  /**
   * Compute the FMR derived columns for one truck. allocations = this truck's allocations (any status).
   * Mirrors FMR columns N..AA: group, TAT/out/offload/back, back on ground, committed until, free from, days until free,
   * confidence, warnings, delivery check, double booked; plus tracking-overdue and the availability category.
   */
  function truckStatus(truck, ctx) {
    ctx = ctx || {}; const planning = ctx.planning || {}; const s = setupOf(planning); const today = ctx.today || todayISO(); const now = ctx.now || new Date().toISOString();
    const info = statusInfo(truck.status, planning); const group = info ? info.group : ''; const phase = info ? info.phase : '';
    const route = truck.routeId ? findRoute(ctx.routes, truck.routeId) : null;
    const t = routeTiming(route, planning);
    const statusDate = (truck.statusAt || '').slice(0, 10); const loadDate = truck.loadingDate || '';
    const anchor = statusDate || loadDate || today;
    let back = '';
    if (!truck.status) back = '';
    else if (group === 'Free') back = today;
    else if (group === 'Down') { if (truck.workshopRelease) back = addDays(truck.workshopRelease, s.buffer); else if (num(truck.daysDown) !== null) back = maxDate(today, addDays(anchor, num(truck.daysDown))); else back = ''; }
    else if (group === 'Unavailable') back = '';
    else if (phase === 'inbound') back = addDays(maxDate(today, addDays(anchor, t.back)), s.buffer);
    else if (phase === 'offloading') back = addDays(maxDate(today, addDays(anchor, Math.max(0, t.offload - 1) + t.back)), s.buffer);
    else if (phase === 'destination') back = addDays(maxDate(today, addDays(anchor, t.offload + t.back)), s.buffer);
    else if (phase === 'loading') back = addDays(maxDate(today, addDays(anchor, t.out + t.offload + t.back)), s.buffer);
    else back = addDays(maxDate(today, addDays(loadDate || statusDate || today, t.out + t.offload + t.back)), s.buffer); // outbound
    // explicit tracking estimates override the formula when supplied
    const estimates = [truck.etaReturn, truck.etaOffloadDone ? addDays(truck.etaOffloadDone, t.back) : '', truck.etaDelivery && phase && phase !== 'inbound' ? addDays(truck.etaDelivery, t.offload + t.back) : ''].filter(Boolean);
    if (group === 'On trip' && estimates.length) back = addDays(maxDate(today, estimates.sort()[0]), s.buffer);
    const active = (ctx.allocations || []).filter((a) => plateKey(a.plate) === plateKey(truck.plate) && !['Cancelled', 'Completed'].includes(a.status));
    const committedUntil = active.map((a) => a.backOnGround || '').filter(Boolean).sort().pop() || '';
    const freeFrom = back ? maxDate(back, committedUntil) : '';
    const daysUntilFree = freeFrom ? Math.max(0, diffDays(freeFrom, today)) : null;
    const confidence = !truck.status ? 'No status' : !back ? 'No date' : group === 'On trip' && (!route || (!loadDate && !statusDate)) ? 'Estimate' : 'Firm';
    const warnings = [];
    const overdueHours = hoursSince(truck.statusAt, now);
    const trackingOverdue = overdueHours > s.trackingOverdueHours;
    if (trackingOverdue) warnings.push(truck.statusAt ? `Tracking update overdue: last update ${Math.floor(overdueHours / 24)} day(s) ago` : 'Tracking update overdue: never updated');
    const outboundAnchor = loadDate || statusDate;
    const deliveryCheck = group === 'On trip' && (phase === 'outbound') && outboundAnchor && diffDays(today, addDays(outboundAnchor, t.out)) > 0;
    if (deliveryCheck) warnings.push(`Outbound ${diffDays(today, addDays(outboundAnchor, t.out))} day(s) past the ${t.out}-day run to ${truck.destination || 'the client'}. Tracking officer to confirm delivery`);
    const overlap = overlappingAllocations(active);
    if (overlap.length) warnings.push('Double booked: promised to more than one request over the same days');
    if (!truck.bodyType) warnings.push('Body type not set, so it cannot be matched to a contract');
    else if (!bodyRuns(truck.bodyType, planning) && !truck.runsContracts) warnings.push('This body type has no contract type against it in Settings');
    if (!truck.tonnage) warnings.push('Tonnage not set');
    if (!truck.status) warnings.push('No status yet');
    if (group === 'Down' && !back) warnings.push('Down with no release date and no days down');
    if (group === 'Down' && !truck.workshopRelease && num(truck.daysDown) !== null && diffDays(addDays(anchor, num(truck.daysDown)), today) < 0) warnings.push(`The ${truck.daysDown} days down ran out on ${addDays(anchor, num(truck.daysDown))}. Confirm it is back or extend`);
    if (group === 'On trip' && !route && !truck.etaReturn) warnings.push('On a trip with no route, so the return date is a guess');
    const pastReturn = group === 'On trip' && back && diffDays(today, back) > 0 && !truck.actualDelivery;
    // A truck is never treated as back just because its estimated return has passed: when the estimate is in the past and
    // nobody has updated the tracking record since, it stays "unconfirmed" until the tracking officer verifies it.
    const estReturn = truck.etaReturn || (loadDate ? addDays(loadDate, t.tat) : '');
    const returnUnconfirmed = group === 'On trip' && !!estReturn && diffDays(today, estReturn) > 0 && (!statusDate || statusDate <= estReturn);
    if (returnUnconfirmed) warnings.push('Past its estimated return and completion is unconfirmed. Needs tracking verification before it counts as available');
    if (group === 'Free' && statusDate && diffDays(today, statusDate) >= s.idleDays && !active.length) warnings.push(`Free for ${diffDays(today, statusDate)} days with nothing planned`);
    if (group === 'On trip' && !truck.etaDelivery && !route) warnings.push('Estimated delivery date missing');
    // availability category
    let category;
    if (!truck.status || group === 'Unavailable' || trackingOverdue && group !== 'Down' || (group === 'On trip' && returnUnconfirmed)) category = AVAILABILITY_CATEGORIES[5];
    else if (group === 'Down') category = AVAILABILITY_CATEGORIES[4];
    else if (group === 'Free') category = active.length ? AVAILABILITY_CATEGORIES[1] : AVAILABILITY_CATEGORIES[0];
    else if (freeFrom && diffDays(freeFrom, today) <= s.returnSoonDays) category = AVAILABILITY_CATEGORIES[2];
    else category = AVAILABILITY_CATEGORIES[3];
    const nextAlloc = active.filter((a) => a.plannedLoadingDate).sort((a, b) => a.plannedLoadingDate.localeCompare(b.plannedLoadingDate))[0] || null;
    return { group, phase, tat: t, backOnGround: back, committedUntil, freeFrom, daysUntilFree, confidence, warnings, deliveryCheck, doubleBooked: overlap.length > 0, trackingOverdue, returnUnconfirmed, category, activeAllocations: active, nextClient: nextAlloc ? nextAlloc.client : '', nextLoadingDate: nextAlloc ? nextAlloc.plannedLoadingDate : '', expectedAvailable: freeFrom, route };
  }
  function overlappingAllocations(allocs) {
    const out = [];
    for (let i = 0; i < allocs.length; i++) for (let j = i + 1; j < allocs.length; j++) { const a = allocs[i], b = allocs[j]; if (a.plannedLoadingDate && b.plannedLoadingDate && a.backOnGround && b.backOnGround && a.plannedLoadingDate <= b.backOnGround && b.plannedLoadingDate <= a.backOnGround) out.push([a, b]); }
    return out;
  }

  // --------------------------------------------------------------- planner
  /** Allocation dates for a truck/route/load date (Committed trips G/H). */
  function allocationDates(route, loadDate, planning) { const t = routeTiming(route, planning); const s = setupOf(planning); return { reachesClient: loadDate ? addDays(loadDate, t.out) : '', backOnGround: loadDate ? addDays(loadDate, t.tat + s.buffer) : '', tat: t.tat }; }
  /** Double-booking test for a proposed allocation against the truck's existing active allocations. */
  function bookingConflicts(plate, loadDate, backOnGround, allocations, excludeId) {
    return (allocations || []).filter((a) => a.id !== excludeId && plateKey(a.plate) === plateKey(plate) && !['Cancelled', 'Completed'].includes(a.status) && a.plannedLoadingDate && a.backOnGround && a.plannedLoadingDate <= backOnGround && a.backOnGround >= loadDate);
  }
  /** Rank every truck for a request (Allocation planner rows). */
  function planForRequest(request, ctx) {
    const planning = ctx.planning || {}; const s = setupOf(planning); const today = ctx.today || todayISO();
    const route = request.routeId ? findRoute(ctx.routes, request.routeId) : null;
    const bay = request.loadingFrom || (route && route.loadingPoint) || '';
    const timing = routeTiming(route, planning);
    const want = request.loadingDate || today;
    const rows = (ctx.fleet || []).filter((t) => t.active !== false).map((truck) => {
      const st = truckStatus(truck, ctx);
      const dropAt = truck.destination || truck.currentLocation || truck.homeStation || '';
      const moveDays = st.freeFrom ? repoDays(dropAt, bay, planning) : null;
      const atBay = st.freeFrom && moveDays !== null ? addDays(st.freeFrom, moveDays) : '';
      const canLoad = atBay ? maxDate(atBay, want) : '';
      const reaches = canLoad ? addDays(canLoad, timing.out) : '';
      const back = canLoad ? addDays(canLoad, timing.tat + s.buffer) : '';
      const daysLate = canLoad ? Math.max(0, diffDays(canLoad, want)) : null;
      const fit = fits(truck, route, planning);
      const booked = canLoad ? bookingConflicts(truck.plate, canLoad, back, ctx.allocations) : [];
      const promised = (ctx.allocations || []).filter((a) => plateKey(a.plate) === plateKey(truck.plate) && !['Cancelled', 'Completed'].includes(a.status)).length;
      const sortKey = canLoad ? Date.parse(canLoad) / 86400000 + (fit === 'Yes' ? 0 : fit === 'Not set' ? 5000 : 10000) + (booked.length ? 20000 : 0) + (st.category === AVAILABILITY_CATEGORIES[5] ? 2500 : 0) : Infinity;
      const notes = [];
      if (booked.length) notes.push('Already booked over these days. Allocating it again promises one truck to two jobs');
      else if (promised) notes.push(`Has ${promised} trip${promised > 1 ? 's' : ''} planned already. Check the sequence`);
      if (daysLate) notes.push(`Cannot reach ${bay || 'the bay'} until ${canLoad}, ${daysLate} day(s) after the requested date`);
      if (fit === 'No') notes.push('Wrong truck size or tonnage for this contract');
      if (fit === 'Not set') notes.push('Body type or tonnage not set');
      if (st.category === AVAILABILITY_CATEGORIES[5]) notes.push('Status unconfirmed: ' + (st.warnings[0] || 'needs tracking verification'));
      return { truck, status: st, dropAt, moveDays, atBay, canLoad, reaches, back, daysLate, fit, booked, promised, sortKey, notes, canMakeDate: !!canLoad && daysLate === 0 && fit === 'Yes' && !booked.length };
    });
    rows.sort((a, b) => a.sortKey - b.sortKey || plateKey(a.truck.plate).localeCompare(plateKey(b.truck.plate)));
    rows.forEach((r, i) => { r.rank = i + 1; });
    return { route, bay, timing, want, rows, canMakeDate: rows.filter((r) => r.canMakeDate).length, rightKind: rows.filter((r) => r.fit === 'Yes').length };
  }

  // ------------------------------------------------------------- requests
  function requestCounts(request, allocations, trips) {
    const mine = (allocations || []).filter((a) => a.requestId === request.id);
    const valid = mine.filter((a) => a.status !== 'Cancelled');
    const deployed = valid.filter((a) => ['Deployed', 'Loaded', 'Completed'].includes(a.status) || (a.tripLogId && (trips || []).some((t) => t.id === a.tripLogId)));
    const requested = Number(request.trucks) || 0;
    const completed = valid.filter((a) => a.status === 'Completed');
    return { requested, allocated: valid.length, deployed: deployed.length, completed: completed.length, outstanding: Math.max(0, requested - valid.length), lastLoad: valid.map((a) => a.plannedLoadingDate || '').filter(Boolean).sort().pop() || '' };
  }
  /** Request status: manual Cancelled/Completed win; otherwise derived from allocations. */
  function requestStatus(request, counts) {
    if (request.status === 'Cancelled') return 'Cancelled';
    if (request.status === 'Completed' || (counts.requested > 0 && counts.completed >= counts.requested)) return 'Completed';
    if (counts.deployed > 0) return 'In Progress';
    if (counts.allocated === 0) return request.status === 'Under Planning' ? 'Under Planning' : 'New Request';
    if (counts.outstanding > 0) return 'Partially Allocated';
    return 'Fully Allocated';
  }
  function nextRequestId(clientCode, requests) { const code = String(clientCode || 'REQ').toUpperCase(); const used = new Set((requests || []).map((r) => r.id)); let n = (requests || []).filter((r) => String(r.id).startsWith(code + '-')).length + 1; while (used.has(`${code}-${String(n).padStart(3, '0')}`)) n++; return `${code}-${String(n).padStart(3, '0')}`; }
  function nextAllocationId(date, allocations) { const d = (date || todayISO()).replace(/-/g, '').slice(2); const used = new Set((allocations || []).map((a) => a.id)); let n = 1; while (used.has(`ALC-${d}-${String(n).padStart(2, '0')}`)) n++; return `ALC-${d}-${String(n).padStart(2, '0')}`; }
  /** Allocation chain (operational + financial stages shown together, kept separate internally). */
  function allocationChain(alloc, trip, invoice) {
    const stages = [{ key: 'allocated', label: 'Allocated', done: alloc.status !== 'Cancelled', at: alloc.createdAt, by: alloc.createdBy }];
    stages.push({ key: 'linked', label: 'Linked to Trip Log', done: !!trip, at: trip ? trip.createdAt : '', by: trip ? trip.createdBy : '' });
    stages.push({ key: 'tripId', label: 'Trip ID Assigned', done: !!((trip && trip.journeyPlanId) || alloc.tripId), at: alloc.tripIdAt || '', by: alloc.tripIdBy || '' });
    stages.push({ key: 'invoiced', label: 'Invoiced', done: !!(invoice && invoice.status !== 'Void'), at: invoice ? invoice.issuedAt || invoice.createdAt : '', by: invoice ? invoice.issuedBy || invoice.createdBy : '' });
    stages.push({ key: 'sent', label: 'Invoice Sent', done: !!(invoice && invoice.sentAt), at: invoice ? invoice.sentAt : '', by: invoice ? invoice.sentBy : '' });
    stages.push({ key: 'paid', label: 'Paid', done: !!(trip && trip.paymentStatus === 'Paid'), at: trip && trip.paymentStatus === 'Paid' ? trip.updatedAt : '', by: '' });
    return stages;
  }

  // -------------------------------------------------------- waybill/invoice (rules live in engine.js; re-exported here)
  const waybillStatus = E.waybillStatus, invoiceAutoStatus = E.invoiceAutoStatus, paymentLabel = E.paymentLabel;
  function tripIdValid(id, setup) { return E.tripIdValid(id, setupOf({ setup }).tripIdPattern); }
  /**
   * The Trip Log entry for an allocation: every operational field comes from the allocation (and its request), nothing is
   * re-typed. Billing fields stay empty; the Trip ID is carried over when Power Apps has already issued it.
   */
  function tripFromAllocation(alloc, request, opts) {
    opts = opts || {}; const r = request || {};
    return { dateDispatched: opts.dateDispatched || alloc.plannedDeploymentDate || alloc.plannedLoadingDate || todayISO(), dateDelivered: '', plate: alloc.plate, assetCode: alloc.assetCode || '', client: alloc.client, contractType: alloc.tonnage || r.tonnage || '', loadingFrom: alloc.loadingFrom || r.loadingFrom || '', loadingTo: alloc.destination || r.destination || '',
      journeyPlanId: alloc.tripId || '', tripIdSource: alloc.tripId ? (alloc.tripIdBy === 'powerapps' ? 'powerapps' : 'allocation') : '', waybill: '', returnWaybill: '', invoiceStatus: 'Not Invoiced', sellingPrice: null, vatTreatment: 'exclusive', quoteNo: '', soNo: '', manualInvoiceNo: '', paymentStatus: 'Not Paid', advance: null, note: opts.note || '',
      allocationId: alloc.id, requestId: alloc.requestId || r.id || '', requestReference: alloc.requestReference || r.reference || '', truckBatch: alloc.truckBatch || '', source: 'fleet-planning' };
  }
  /** One allocation → one trip. Returns the reason the link is refused, or '' when it is allowed. */
  function allocationLinkError(alloc, tripId, opts) {
    opts = opts || {};
    if (!alloc) return 'Allocation not found.';
    if (alloc.status === 'Cancelled') return `Allocation ${alloc.id} is cancelled.`;
    if (alloc.tripLogId && alloc.tripLogId !== tripId) return opts.split ? '' : `Allocation ${alloc.id} is already linked to a Trip Log entry (${alloc.tripLogId}). Open that trip instead, or split the allocation through the authorised workflow.`;
    return '';
  }
  /** Chain stage of one allocation (the furthest stage reached), for lists and KPIs. */
  function chainStage(alloc, trip, invoice) {
    if (alloc.status === 'Cancelled') return 'Cancelled';
    const st = allocationChain(alloc, trip, invoice); let last = 'Allocated';
    for (const s of st) { if (s.done) last = s.label; else break; }
    return last;
  }
  /** Billing position of a request across its trips: Not Invoiced / Partially Invoiced / Fully Invoiced / Internal Client. */
  function requestBilling(request, allocations, trips, invoices) {
    const byInv = new Map((invoices || []).map((i) => [i.id, i]));
    const mine = (trips || []).filter((t) => t.requestId === request.id || (allocations || []).some((a) => a.requestId === request.id && a.tripLogId === t.id));
    if (!mine.length) return { label: 'Not Invoiced', trips: 0, invoiced: 0 };
    const invoiced = mine.filter((t) => { const s = E.invoiceAutoStatus(t, t.invoiceId ? byInv.get(t.invoiceId) : null); return ['Invoice Issued', 'Invoice Sent', 'Internal Client'].includes(s); }).length;
    return { label: invoiced === 0 ? 'Not Invoiced' : invoiced < mine.length ? 'Partially Invoiced' : mine.every((t) => t.internalClient) ? 'Internal Client' : 'Fully Invoiced', trips: mine.length, invoiced };
  }

  // ----------------------------------------------------------------- runway
  /** Day-by-day state code per truck for the window: F free, P planned, T on trip, D down, ? unknown (Runway sheet). */
  function runway(ctx, days) {
    const today = ctx.today || todayISO(); const n = days || setupOf(ctx.planning).runwayDays; const dates = []; for (let i = 0; i < n; i++) dates.push(addDays(today, i));
    const rows = (ctx.fleet || []).filter((t) => t.active !== false).map((truck) => {
      const st = truckStatus(truck, ctx);
      const codes = dates.map((d) => {
        const planned = st.activeAllocations.some((a) => a.plannedLoadingDate && a.backOnGround && a.plannedLoadingDate <= d && a.backOnGround >= d);
        if (planned) return 'P';
        if (!truck.status || !st.backOnGround) return '?';
        if (d < st.backOnGround) return st.group === 'Down' ? 'D' : 'T';
        return 'F';
      });
      return { truck, status: st, codes };
    });
    const freeByDay = dates.map((d) => rows.filter((r) => r.status.freeFrom === d).length);
    const freeCountByDay = dates.map((d, i) => rows.filter((r) => r.codes[i] === 'F').length);
    const weeks = []; for (let i = 0; i < n; i += 7) weeks.push({ from: dates[i], to: dates[Math.min(n - 1, i + 6)], comingFree: freeByDay.slice(i, i + 7).reduce((a, b) => a + b, 0) });
    return { dates, rows, freeByDay, freeCountByDay, weeks };
  }

  // ------------------------------------------------------------------- KPIs
  function fleetKpis(ctx) {
    const today = ctx.today || todayISO(); const tomorrow = addDays(today, 1);
    const statuses = (ctx.fleet || []).filter((t) => t.active !== false).map((t) => ({ truck: t, st: truckStatus(t, ctx) }));
    const cat = (c) => statuses.filter((x) => x.st.category === c).length;
    const requests = (ctx.requests || []).map((r) => Object.assign({}, r, { counts: requestCounts(r, ctx.allocations, ctx.trips) })).map((r) => Object.assign(r, { liveStatus: requestStatus(r, r.counts) }));
    const open = requests.filter((r) => !['Completed', 'Cancelled'].includes(r.liveStatus));
    const activeAllocs = (ctx.allocations || []).filter((a) => !['Cancelled', 'Completed'].includes(a.status));
    const delayed = activeAllocs.filter((a) => a.status === 'Planned' && a.plannedLoadingDate && a.plannedLoadingDate < today).length;
    return {
      totalFleet: statuses.length,
      available: statuses.filter((x) => x.st.group === 'Free').length,
      availableUnplanned: cat(AVAILABILITY_CATEGORIES[0]),
      allocated: new Set(activeAllocs.map((a) => plateKey(a.plate))).size,
      onTrip: statuses.filter((x) => x.st.group === 'On trip').length,
      backToday: statuses.filter((x) => x.st.group === 'On trip' && x.st.backOnGround === today).length,
      backTomorrow: statuses.filter((x) => x.st.group === 'On trip' && x.st.backOnGround === tomorrow).length,
      inWorkshop: statuses.filter((x) => /workshop/i.test(x.truck.status || '')).length,
      breakdown: statuses.filter((x) => /breakdown/i.test(x.truck.status || '')).length,
      unconfirmed: cat(AVAILABILITY_CATEGORIES[5]),
      openRequests: open.length, trucksRequested: open.reduce((s, r) => s + r.counts.requested, 0), trucksAllocated: open.reduce((s, r) => s + r.counts.allocated, 0), outstandingTrucks: open.reduce((s, r) => s + r.counts.outstanding, 0),
      delayedDeployments: delayed, trackingOverdue: statuses.filter((x) => x.st.trackingOverdue).length,
      doubleBooked: statuses.filter((x) => x.st.doubleBooked).length, deliveryChecks: statuses.filter((x) => x.st.deliveryCheck).length,
      byCategory: AVAILABILITY_CATEGORIES.map((c) => ({ category: c, count: cat(c) })),
      statuses, requests: open,
    };
  }
  function billingKpis(ctx) {
    const trips = ctx.trips || []; const invoices = ctx.invoices || []; const allocs = ctx.allocations || [];
    const byInv = new Map(invoices.map((i) => [i.id, i]));
    const live = (t) => invoiceAutoStatus(t, t.invoiceId ? byInv.get(t.invoiceId) : null);
    const active = allocs.filter((a) => !['Cancelled', 'Completed'].includes(a.status));
    return {
      allocatedNotInTripLog: active.filter((a) => !a.tripLogId).length,
      allocatedAwaitingTripId: active.filter((a) => !a.tripId && !(a.tripLogId && trips.some((t) => t.id === a.tripLogId && t.journeyPlanId))).length,
      tripsAwaitingWaybill: trips.filter((t) => waybillStatus(t, ctx.setup) === 'Awaiting Waybill').length,
      tripsAwaitingWaybillDoc: trips.filter((t) => ['Waybill Number Entered', 'Waybill Verification Pending'].includes(waybillStatus(t, ctx.setup))).length,
      waybillVerificationPending: trips.filter((t) => waybillStatus(t, ctx.setup) === 'Waybill Verification Pending').length,
      notInvoiced: trips.filter((t) => live(t) === 'Not Invoiced').length,
      completedNotInvoiced: trips.filter((t) => live(t) === 'Not Invoiced' && (t.dateDelivered || t.dateDispatched < (ctx.today || todayISO()))).length,
      draftInvoices: invoices.filter((i) => i.status === 'Draft').length,
      invoicesIssued: invoices.filter((i) => i.issuedAt && i.status !== 'Void').length,
      issuedNotSent: invoices.filter((i) => i.issuedAt && !i.sentAt && i.status !== 'Void').length,
      invoicesSent: invoices.filter((i) => i.sentAt && i.status !== 'Void').length,
      sentAwaitingPayment: invoices.filter((i) => i.sentAt && i.status !== 'Void' && trips.some((t) => t.invoiceId === i.id && t.paymentStatus !== 'Paid')).length,
    };
  }

  return {
    DEFAULT_STATUSES, STATUS_ALIASES, DEFAULT_SETUP, REQUEST_STATUSES, ALLOCATION_STATUSES, PRIORITIES, WAYBILL_STATUSES, INVOICE_STATUS_AUTO, INVOICE_DOC_STATUSES, AVAILABILITY_CATEGORIES, DEFAULT_BODY_RUNS, CHAIN_STAGES, chainStage, requestBilling, tripFromAllocation, allocationLinkError,
    todayISO, addDays, diffDays, maxDate, plateKey, setupOf, statusList, statusInfo, canonicalStatus, repoDays, routeTiming, routeLabel, findRoute, routeCost, fits, bodyRuns,
    truckStatus, overlappingAllocations, allocationDates, bookingConflicts, planForRequest, requestCounts, requestStatus, nextRequestId, nextAllocationId, allocationChain,
    waybillStatus, invoiceAutoStatus, paymentLabel, tripIdValid, runway, fleetKpis, billingKpis,
  };
});
