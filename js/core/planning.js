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
  const STATUS_ALIASES = { 'available': 'Available', 'on standby / held': 'Allocated / Planned', 'loading at bay': 'Loading', 'laden': 'Loaded', 'outbound': 'Outbound / In Transit', 'in transit': 'Outbound / In Transit', 'at client destination': 'At Destination', 'offloading at client': 'Offloading', 'inbound (returning)': 'Inbound / Returning', 'in workshop': 'In Workshop', 'transit breakdown (offsite)': 'Breakdown in Transit', 'breakdown': 'Breakdown in Transit',
    // Setup brief status names
    'available but unplanned': 'Available', 'allocated': 'Allocated / Planned', 'at loading point': 'At Loading Point', 'in transit': 'Outbound / In Transit', 'at destination': 'At Destination', 'offloading': 'Offloading', 'returning': 'Inbound / Returning', 'workshop': 'In Workshop', 'unavailable': 'Unavailable', 'loading': 'Loading', 'loaded': 'Loaded' };
  /** Journey-planning and on-time-delivery KPIs (Setup_Haulage KPI sheet + delivery-time bands); overridable in meta/planning.kpi. */
  const DEFAULT_KPI = { drivingKmPerDay: 300, loadingDays: 1, offloadingDays: 1, localIncludesHandlingKm: 100, otdBands: [{ maxKm: 100, hours: 24 }, { maxKm: 250, hours: 36 }, { maxKm: 500, hours: 48 }, { maxKm: 1000, hours: 72 }, { maxKm: 1500, hours: 96 }] };
  const kpiOf = (planning) => Object.assign({}, DEFAULT_KPI, (planning && planning.kpi) || {});
  /** A. Contractual / management OTD target from the approved distance band (one-way km). Above the last band no target is assumed. */
  function otdTarget(oneWayKm, kpi, route) {
    kpi = kpiOf(kpi && kpi.otdBands ? { kpi } : kpi); const km = num(oneWayKm);
    if (route && num(route.approvedOtdHours) !== null) return { hours: num(route.approvedOtdHours), band: 'Route-specific approved KPI', approved: true, localIncludesHandling: km !== null && km <= kpi.localIncludesHandlingKm };
    if (km === null) return { hours: null, band: 'No approved distance', approved: false, localIncludesHandling: false };
    const band = kpi.otdBands.find((b) => km <= b.maxKm);
    if (!band) return { hours: null, band: `Above ${kpi.otdBands[kpi.otdBands.length - 1].maxKm} km — specific approved KPI required`, approved: false, localIncludesHandling: false };
    const lo = kpi.otdBands[kpi.otdBands.indexOf(band) - 1]; return { hours: band.hours, band: `${lo ? lo.maxKm + 1 : 0}–${band.maxKm} km → ${band.hours} h`, approved: true, localIncludesHandling: km <= kpi.localIncludesHandlingKm };
  }
  /** B. Operational journey-planning duration: 300 km per driver day each way plus the loading and offloading allowances; local (≤ 100 km) deliveries are one 24-hour window that already includes handling. */
  function journeyPlan(oneWayKm, kpi, returnKm) {
    kpi = kpiOf(kpi && kpi.otdBands ? { kpi } : kpi); const km = num(oneWayKm); if (km === null) return { local: false, drivingDaysOut: null, drivingDaysBack: null, loadingDays: kpi.loadingDays, offloadingDays: kpi.offloadingDays, totalDays: null, deliveryHours: null, totalHours: null };
    const back = num(returnKm) === null ? km : num(returnKm);
    if (km <= kpi.localIncludesHandlingKm) return { local: true, drivingDaysOut: 0, drivingDaysBack: 0, loadingDays: 0, offloadingDays: 0, totalDays: 1, deliveryHours: 24, totalHours: 24, note: `Local delivery (≤ ${kpi.localIncludesHandlingKm} km): the 24-hour window covers driving, loading and offloading; allowances are not added again` };
    const out = Math.max(1, Math.ceil(km / kpi.drivingKmPerDay)), ret = Math.max(1, Math.ceil(back / kpi.drivingKmPerDay));
    const totalDays = out + ret + kpi.loadingDays + kpi.offloadingDays; const deliveryHours = out * 24; // delivery leg from loading completion to arrival; the loading allowance is before departure
    return { local: false, drivingDaysOut: out, drivingDaysBack: ret, loadingDays: kpi.loadingDays, offloadingDays: kpi.offloadingDays, totalDays, deliveryHours, totalHours: totalDays * 24, note: `${kpi.drivingKmPerDay} km per driver day: ${out} day${out > 1 ? 's' : ''} out + ${ret} back + ${kpi.loadingDays} loading + ${kpi.offloadingDays} offloading` };
  }
  /** The two values side by side; a scheduling conflict is flagged when the operational delivery duration exceeds the OTD target (Operations Manager review). */
  function routeKpi(route, planning) {
    const kpi = kpiOf(planning); const km = route ? num(route.kmOneWay) : null; const otd = otdTarget(km, kpi, route); const plan = journeyPlan(km, kpi, route ? route.kmReturn : null);
    const conflict = otd.hours !== null && plan.deliveryHours !== null && plan.deliveryHours > otd.hours;
    return { oneWayKm: km, otd, plan, conflict, conflictNote: conflict ? `Operational delivery duration ${plan.deliveryHours} h exceeds the approved OTD target of ${otd.hours} h — Operations Manager review required` : '' };
  }
  const DEFAULT_SETUP = { defaultTAT: 7, buffer: 0, idleDays: 3, repoDefault: 3, repoSame: 0, runwayDays: 92, trackingOverdueHours: 48, returnSoonDays: 3, tripIdPattern: E.DEFAULT_TRIP_ID_PATTERN, waybillVerification: true, dieselPrice: 1100 };
  // Request lifecycle. Stage 1 (CRM): Draft → Pending Route Mapping / Submitted. Stage 2 (Operations Manager): Awaiting Planning →
  // Plan Approved. Stage 3 (Station Manager): Partially / Fully Allocated → In Progress → Completed. 3rd-party requests follow the
  // 3PL stages instead. Cancellation Requested = CRM cancelled a request that still had allocated trucks; the Operations Manager
  // approves the release.
  const REQUEST_STATUSES = ['Draft', 'Pending Route Mapping', 'Awaiting Planning', 'Plan Approved', 'Partially Allocated', 'Fully Allocated', 'In Progress', 'Completed', 'Cancellation Requested', 'Cancelled'];
  const TPL_STATUSES = ['Pending Route Mapping', '3PL Planning', 'Quotation', 'Cost Approved', 'Assigned', 'In Execution', 'Completed', 'Cancellation Requested', 'Cancelled'];
  const LEGACY_REQUEST_STATUS = { 'New Request': 'Awaiting Planning', 'Under Planning': 'Awaiting Planning' };
  const ROUTE_STATUSES = ['Approved', 'Pending Approval', 'Retired'];
  const TPL_EQUIPMENT = ['Lowbed', 'Flatbed', 'Crane-100T', 'Crane-150T', 'Crane-80T', '20FT', '25FT', '40FT', 'Hiab'];
  const MILESTONES = [
    { key: 'allocatedAt', label: 'Truck Allocated' }, { key: 'loadedAt', label: 'Truck Loaded' }, { key: 'arrivedClientAt', label: 'Truck Arrived at Client' },
    { key: 'offloadedAt', label: 'Truck Offloaded' }, { key: 'leftClientAt', label: 'Truck Left Client Location' }, { key: 'arrivedBackAt', label: 'Truck Arrived Back' },
  ];
  const EXTRA_EVENTS = ['Departed loading point', 'Breakdown', 'Delay', 'Returned to home station', 'Diversion', 'Other'];
  const DELAY_REASONS = ['Loading delay at client', 'Offloading delay at client', 'Traffic / road condition', 'Breakdown', 'Security / checkpoint', 'Driver', 'Weather', 'Documentation', 'Other'];
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
    if (isTpl(request)) { const mine = (trips || []).filter((t) => t.requestId === request.id && !t.cancelledAt); const done = mine.filter((t) => E.opsStatus(t) === 'Closed'); return { requested, allocated: mine.length, deployed: mine.length, completed: done.length, outstanding: Math.max(0, requested - mine.length), lastLoad: mine.map((t) => t.dateDispatched).sort().pop() || '' }; }
    return { requested, allocated: valid.length, deployed: deployed.length, completed: completed.length, outstanding: Math.max(0, requested - valid.length), lastLoad: valid.map((a) => a.plannedLoadingDate || '').filter(Boolean).sort().pop() || '' };
  }
  const isTpl = (request) => request && /3rd|third/i.test(String(request.serviceType || ''));
  /**
   * Request status: Cancelled / Completed win; a request whose route is not approved stays in Pending Route Mapping; an internal
   * request needs the Operations Manager's plan approval before any allocation; the rest is derived from the allocations.
   * ctx.routes lets the status reflect the Route Master; without it the saved routeApproved flag is used.
   */
  function requestStatus(request, counts, ctx) {
    if (request.status === 'Cancelled') return 'Cancelled';
    if (request.cancellationRequestedAt) return 'Cancellation Requested';
    if (request.status === 'Completed' || (counts.requested > 0 && counts.completed >= counts.requested)) return 'Completed';
    if (request.status === 'Draft' && !request.submittedAt) return 'Draft';
    const rv = routeValidation(request, ctx && ctx.routes); if (!rv.ok) return 'Pending Route Mapping';
    if (isTpl(request)) { const t = request.tpl || {}; if (counts.deployed > 0 || t.assignmentStatus === 'In Execution') return 'In Execution'; if (t.assignmentStatus === 'Assigned' || t.assignedAt) return 'Assigned'; if (t.approvedCost !== null && t.approvedCost !== undefined && t.approvedCost !== '' && t.costApprovedAt) return 'Cost Approved'; if (t.quotesRequestedAt || (ctx && ctx.quotes && ctx.quotes.some((q) => q.requestId === request.id))) return 'Quotation'; return '3PL Planning'; }
    if (!(request.plan && request.plan.approvedAt)) return 'Awaiting Planning';
    if (counts.deployed > 0) return 'In Progress';
    if (counts.allocated === 0) return 'Plan Approved';
    if (counts.outstanding > 0) return 'Partially Allocated';
    return 'Fully Allocated';
  }
  const normRequestStatus = (st) => LEGACY_REQUEST_STATUS[st] || st;

  // ---------------------------------------------------------- Route Master validation
  /** The approved Route Master entry for a request (explicit routeMasterId, then client + loading point + destination, then any client). */
  function routeFor(request, routes) {
    routes = routes || []; if (!request) return null;
    if (request.routeMasterId || request.routeId) { const r = routes.find((x) => x.id === (request.routeMasterId || request.routeId)); if (r) return r; }
    const from = locKey(request.loadingFrom), to = locKey(request.destination); if (!from || !to) return null;
    const same = routes.filter((r) => locKey(r.loadingPoint) === from && locKey(r.destination) === to && routeStatus(r) === 'Approved');
    return same.find((r) => norm(r.client) === norm(request.client)) || same[0] || null;
  }
  function routeStatus(route) { if (!route) return 'Missing'; if (route.status) return route.status; return route.approvedAt || route.createdBy === 'planning-import' ? 'Approved' : 'Pending Approval'; }
  /**
   * Mandatory route validation (brief §5): the request's route must exist in the Route Master and be approved before it can be
   * submitted for planning, planned, allocated or given a Trip ID. Returns { ok, route, status, message }.
   */
  function routeValidation(request, routes) {
    if (routes === undefined || routes === null) { const ok = request.routeApproved !== false && (request.routeApproved === true || !!request.routeMasterId || !!request.routeId); return { ok, route: null, status: ok ? 'Approved' : 'Missing', message: ok ? '' : 'Route Not Mapped — Route Approval Required.' }; }
    const route = routeFor(request, routes); const status = routeStatus(route);
    if (!route) return { ok: false, route: null, status: 'Missing', message: 'Route Not Mapped — Route Approval Required.' };
    if (status !== 'Approved') return { ok: false, route, status, message: `Route Not Mapped — Route Approval Required. ${route.id} is ${status.toLowerCase()}.` };
    return { ok: true, route, status, message: '' };
  }
  /** Route Master record fields (standardised states, detailed points, approved km, TAT) with defaults derived from the register columns. */
  function routeMaster(route, stateOf) {
    if (!route) return null; const st = stateOf || (() => '');
    const out = num(route.kmOneWay), ret = num(route.kmReturn) === null ? out : num(route.kmReturn);
    return Object.assign({}, route, { originState: route.originState || st(route.loadingPoint) || '', destState: route.destState || route.state || st(route.destination) || '', kmOneWay: out, kmReturn: ret, totalKm: out === null ? null : E.round2(out + (ret || 0)), tatDays: routeTiming(route, null).tat, status: routeStatus(route) });
  }

  // ---------------------------------------------------------- plan approval and allocation guard (stages 2 and 3)
  /** Why an allocation cannot be made against this request ('' when allowed). opts.override = authorised category substitution. */
  function allocationGuard(request, truck, route, ctx, opts) {
    opts = opts || {}; ctx = ctx || {};
    if (!request) return 'Request not found.';
    if (request.status === 'Cancelled' || request.cancellationRequestedAt) return `Request ${request.id} is cancelled or awaiting cancellation approval.`;
    const rv = routeValidation(request, ctx.routes); if (!rv.ok) return rv.message;
    if (isTpl(request)) return 'Third-party requests are handled in the 3PL module, not by fleet allocation.';
    const plan = request.plan || {}; if (!plan.approvedAt) return `Request ${request.id} has no approved fleet plan yet. The Operations Manager approves the plan before the station allocates trucks.`;
    const counts = requestCounts(request, ctx.allocations, ctx.trips); const cap = Number(plan.approvedQty || request.trucks || 0);
    if (counts.allocated + (opts.adding || 1) > cap) return `The approved plan for ${request.id} covers ${cap} truck${cap === 1 ? '' : 's'}; ${counts.allocated} already allocated. Allocating more needs a revised plan approval.`;
    if (truck && !opts.override) { const want = plan.vehicleType || request.vehicleType; const fit = fits(truck, Object.assign({}, route || {}, { size: want || (route && route.size) || '', tonnage: plan.tonnage || request.tonnage || (route && route.tonnage) || '' }), ctx.planning); if (fit === 'No') return `${truck.plate} (${truck.bodyType || 'body not set'} ${truck.tonnage || ''}) is not the approved vehicle category ${want || ''} ${plan.tonnage || request.tonnage || ''}. Substituting a category needs Operations Manager authorisation.`; }
    return '';
  }

  /** Changing the truck or the vehicle category of an existing allocation is a substitution: it must still fit the approved plan unless the Operations Manager authorises it. */
  function allocationSubstitutionError(next, request, truck, route, ctx, opts) {
    opts = opts || {}; if (!request || opts.override) return '';
    const plan = request.plan || {}; const want = plan.vehicleType || request.vehicleType || '';
    if (want && next.vehicleType && norm(next.vehicleType) !== norm(want)) return `Allocation ${next.id} is approved for ${want}; substituting ${next.vehicleType} needs Operations Manager authorisation.`;
    if (truck) { const fit = fits(truck, Object.assign({}, route || {}, { size: want || (route && route.size) || '', tonnage: plan.tonnage || request.tonnage || (route && route.tonnage) || '' }), ctx && ctx.planning); if (fit === 'No') return `${truck.plate} (${truck.bodyType || 'body not set'} ${truck.tonnage || ''}) is not the approved vehicle category ${want} ${plan.tonnage || request.tonnage || ''}. Substituting a category needs Operations Manager authorisation.`; }
    return '';
  }

  // ---------------------------------------------------------- Trip Turnaround Time (TAT)
  const hoursBetween = (a, b) => (a && b ? E.round2((Date.parse(b) - Date.parse(a)) / 3600000) : null);
  /** Durations between milestones, total TAT, variance against the approved route target and the status label. */
  function tatCalc(trip, targetDays, now) {
    const m = (trip && trip.milestones) || {}; now = now || new Date().toISOString();
    const start = m.allocatedAt || (trip.allocatedAt) || (trip.dateDispatched ? trip.dateDispatched + 'T08:00:00Z' : '');
    const segs = [
      { key: 'allocToLoad', label: 'Allocation to Loading', hours: hoursBetween(start, m.loadedAt) },
      { key: 'loadToClient', label: 'Loading to Client Arrival', hours: hoursBetween(m.loadedAt, m.arrivedClientAt) },
      { key: 'clientToOffload', label: 'Client Arrival to Offloading', hours: hoursBetween(m.arrivedClientAt, m.offloadedAt) },
      { key: 'offloadToDepart', label: 'Offloading to Client Departure', hours: hoursBetween(m.offloadedAt, m.leftClientAt) },
      { key: 'departToReturn', label: 'Client Departure to Return', hours: hoursBetween(m.leftClientAt, m.arrivedBackAt) },
    ];
    const targetHours = targetDays ? Number(targetDays) * 24 : null;
    const done = !!m.arrivedBackAt; const cancelled = E.opsStatus(trip) === 'Cancelled';
    const totalHours = done ? hoursBetween(start, m.arrivedBackAt) : null;
    const elapsedHours = start && !done ? hoursBetween(start, now) : null;
    const variance = done && targetHours !== null && totalHours !== null ? E.round2(totalHours - targetHours) : null;
    const remaining = !done && targetHours !== null && elapsedHours !== null ? E.round2(targetHours - elapsedHours) : null;
    let status;
    if (cancelled) status = 'Cancelled';
    else if (done) status = targetHours === null ? 'Completed' : variance > 0 ? 'Completed Late' : 'Completed Within Target';
    else if (targetHours === null || elapsedHours === null) status = 'In Progress';
    else if (elapsedHours > targetHours) status = 'Overdue';
    else if (elapsedHours >= targetHours * 0.8) status = 'Approaching Target';
    else status = 'Within Target';
    const nextKey = MILESTONES.find((x) => !m[x.key]);
    // On-time delivery (contractual band): local trips measure allocation → offloaded (handling included), others loading → arrival at client
    const otdHours = num(trip.otdTargetHours); const local = !!trip.otdLocal; const deliveryHours = local ? hoursBetween(start, m.offloadedAt) : hoursBetween(m.loadedAt, m.arrivedClientAt);
    const otdStatus = otdHours === null ? 'No approved OTD KPI' : deliveryHours === null ? (cancelled ? 'Cancelled' : 'Delivery pending') : deliveryHours <= otdHours ? 'On Time' : 'Late';
    return { start, segments: segs, otdTargetHours: otdHours, deliveryHours, otdVarianceHours: otdHours !== null && deliveryHours !== null ? E.round2(deliveryHours - otdHours) : null, otdStatus, totalHours, totalDays: totalHours === null ? null : E.round2(totalHours / 24), elapsedHours, elapsedDays: elapsedHours === null ? null : E.round2(elapsedHours / 24), targetHours, targetDays: targetDays ? Number(targetDays) : null, variance, varianceDays: variance === null ? null : E.round2(variance / 24), remainingHours: remaining, status, done, next: nextKey ? nextKey.label : '', delays: (trip.events || []).filter((e) => /delay|breakdown/i.test(e.type || '')) };
  }
  /** Milestone order rule: every milestone must be at or after the previous one. Returns an error string or ''. */
  function milestoneError(milestones, key, at) {
    if (!at) return 'Enter the date and time.';
    const i = MILESTONES.findIndex((x) => x.key === key); if (i < 0) return 'Unknown milestone.';
    for (let j = 0; j < i; j++) { const prev = milestones[MILESTONES[j].key]; if (prev && prev > at) return `${MILESTONES[i].label} cannot be before ${MILESTONES[j].label} (${prev.slice(0, 16).replace('T', ' ')}).`; }
    for (let j = i + 1; j < MILESTONES.length; j++) { const nx = milestones[MILESTONES[j].key]; if (nx && nx < at) return `${MILESTONES[i].label} cannot be after ${MILESTONES[j].label}.`; }
    if (Date.parse(at) > Date.now() + 5 * 60000) return 'A milestone cannot be in the future.';
    return '';
  }
  /** TAT dashboard: averages by route, truck and client; delayed trucks; loading / offloading / return delays; compliance %. */
  function tatDashboard(trips, routes, now) {
    const rows = (trips || []).filter((t) => t.serviceType !== '3rd Party Contractor' || true).filter((t) => t.allocationId || (t.milestones && Object.keys(t.milestones).length)).map((t) => { const r = routes ? (routes.find((x) => x.id === (t.routeMasterId || t.routeId)) || null) : null; const target = t.tatTargetDays || (r ? routeTiming(r, null).tat : null); return { trip: t, tat: tatCalc(t, target, now), route: r }; });
    const avg = (list, f) => { const xs = list.map(f).filter((x) => x !== null && x !== undefined); return xs.length ? E.round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null; };
    const group = (keyFn) => { const m = new Map(); for (const x of rows) { const k = keyFn(x) || '(unknown)'; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return [...m.entries()].map(([k, list]) => ({ key: k, trips: list.length, completed: list.filter((x) => x.tat.done).length, avgDays: avg(list.filter((x) => x.tat.done), (x) => x.tat.totalDays), avgTargetDays: avg(list, (x) => x.tat.targetDays), late: list.filter((x) => ['Completed Late', 'Overdue'].includes(x.tat.status)).length })).sort((a, b) => (b.avgDays || 0) - (a.avgDays || 0)); };
    const completed = rows.filter((x) => x.tat.done && x.tat.targetHours !== null);
    const segAvg = (key) => avg(rows, (x) => { const sgm = x.tat.segments.find((g) => g.key === key); return sgm ? sgm.hours : null; });
    const segLate = (key, thresholdH) => rows.filter((x) => { const sgm = x.tat.segments.find((g) => g.key === key); return sgm && sgm.hours !== null && sgm.hours > thresholdH; }).length;
    return {
      rows, active: rows.filter((x) => !x.tat.done && x.tat.status !== 'Cancelled').length, overdue: rows.filter((x) => x.tat.status === 'Overdue').length, approaching: rows.filter((x) => x.tat.status === 'Approaching Target').length, completedLate: rows.filter((x) => x.tat.status === 'Completed Late').length,
      otdPct: (() => { const d = rows.filter((x) => ['On Time', 'Late'].includes(x.tat.otdStatus)); return d.length ? E.round2((d.filter((x) => x.tat.otdStatus === 'On Time').length / d.length) * 100) : null; })(), otdLate: rows.filter((x) => x.tat.otdStatus === 'Late').length, otdOnTime: rows.filter((x) => x.tat.otdStatus === 'On Time').length,
      exceedingRouteDays: rows.filter((x) => ['Overdue', 'Completed Late'].includes(x.tat.status)).length, compliancePct: completed.length ? E.round2((completed.filter((x) => x.tat.variance <= 0).length / completed.length) * 100) : null,
      byRoute: group((x) => (x.route ? `${x.route.loadingPoint} → ${x.route.destination}` : `${x.trip.loadingFrom} → ${x.trip.loadingTo}`)), byTruck: group((x) => x.trip.plate), byClient: group((x) => x.trip.client),
      loadingDelays: segLate('allocToLoad', 24), offloadingDelays: segLate('clientToOffload', 24), returnDelays: rows.filter((x) => x.tat.status === 'Overdue' && x.trip.milestones && x.trip.milestones.leftClientAt).length,
      avgLoadingHours: segAvg('allocToLoad'), avgOffloadingHours: segAvg('clientToOffload'), avgReturnHours: segAvg('departToReturn'),
      delayed: rows.filter((x) => ['Overdue', 'Approaching Target'].includes(x.tat.status)).sort((a, b) => (b.tat.elapsedHours || 0) - (a.tat.elapsedHours || 0)),
    };
  }
  function nextRequestId(clientCode, requests) { const code = String(clientCode || 'REQ').toUpperCase(); const used = new Set((requests || []).map((r) => r.id)); let n = (requests || []).filter((r) => String(r.id).startsWith(code + '-')).length + 1; while (used.has(`${code}-${String(n).padStart(3, '0')}`)) n++; return `${code}-${String(n).padStart(3, '0')}`; }
  function nextAllocationId(date, allocations) { const d = (date || todayISO()).replace(/-/g, '').slice(2); const used = new Set((allocations || []).map((a) => a.id)); let n = 1; while (used.has(`ALC-${d}-${String(n).padStart(2, '0')}`)) n++; return `ALC-${d}-${String(n).padStart(2, '0')}`; }
  /** Allocation chain (operational + financial stages shown together, kept separate internally). */
  function allocationChain(alloc, trip, invoice) {
    const stages = [{ key: 'allocated', label: 'Allocated', done: alloc.status !== 'Cancelled', at: alloc.createdAt, by: alloc.createdBy }];
    stages.push({ key: 'linked', label: 'Linked to Trip Log', done: !!trip, at: trip ? trip.createdAt : '', by: trip ? trip.createdBy : '' });
    stages.push({ key: 'tripId', label: 'Trip ID Assigned', done: !!((trip && trip.journeyPlanId) || alloc.tripId), at: alloc.tripIdAt || (trip ? trip.createdAt : ''), by: alloc.tripIdBy || 'system' });
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
    const route = opts.route || null; const target = route ? routeTiming(route, opts.planning).tat : (r.tatTargetDays || null);
    return { dateDispatched: opts.dateDispatched || alloc.plannedDeploymentDate || alloc.plannedLoadingDate || todayISO(), dateDelivered: '', plate: alloc.plate, assetCode: alloc.assetCode || '', client: alloc.client, contractType: alloc.tonnage || r.tonnage || '', loadingFrom: alloc.loadingFrom || r.loadingFrom || '', loadingTo: alloc.destination || r.destination || '',
      // the Trip ID is generated by the system when the allocation is converted (opts.tripId); a split second leg gets its own
      journeyPlanId: opts.tripId || '', tripIdSource: opts.tripId ? 'generated' : '', waybill: '', returnWaybill: '', invoiceStatus: 'Not Invoiced', sellingPrice: null, vatTreatment: 'exclusive', quoteNo: '', soNo: '', manualInvoiceNo: '', paymentStatus: 'Not Paid', advance: null, note: opts.note || '',
      allocationId: alloc.id, requestId: alloc.requestId || r.id || '', requestReference: alloc.requestReference || r.reference || '', truckBatch: alloc.truckBatch || '', source: 'fleet-planning', serviceType: 'Internal Fleet', driver: alloc.driver || '', lob: alloc.lob || opts.lob || '', routeMasterId: alloc.routeId || r.routeMasterId || r.routeId || '', tatTargetDays: target, otdTargetHours: route ? otdTarget(route.kmOneWay, kpiOf(opts.planning), route).hours : null, opsStatus: 'Open', finStatus: 'Open', milestones: { allocatedAt: alloc.createdAt || opts.now || new Date().toISOString() }, events: [] };
  }
  /** LOB is mandatory before an allocation becomes a trip (chosen by the planner / station on the allocation). */
  function allocationLobError(alloc, lobs) { const v = alloc && String(alloc.lob || '').trim(); if (!v) return `Allocation ${alloc ? alloc.id : ''} has no Line of Business; the planner must select the LOB before the trip is created.`; if (lobs && lobs.length && !lobs.some((l) => (l.active !== false) && norm(l.name) === norm(v))) return `LOB "${v}" is not in the LOB master.`; return ''; }
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
    const requests = (ctx.requests || []).map((r) => Object.assign({}, r, { counts: requestCounts(r, ctx.allocations, ctx.trips) })).map((r) => Object.assign(r, { liveStatus: requestStatus(r, r.counts, ctx) }));
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
    DEFAULT_STATUSES, STATUS_ALIASES, DEFAULT_SETUP, REQUEST_STATUSES, TPL_STATUSES, LEGACY_REQUEST_STATUS, ROUTE_STATUSES, TPL_EQUIPMENT, MILESTONES, EXTRA_EVENTS, DELAY_REASONS, ALLOCATION_STATUSES, PRIORITIES, WAYBILL_STATUSES, INVOICE_STATUS_AUTO, INVOICE_DOC_STATUSES, AVAILABILITY_CATEGORIES, DEFAULT_BODY_RUNS, CHAIN_STAGES, chainStage, requestBilling, tripFromAllocation, allocationLinkError,
    isTpl, normRequestStatus, routeFor, routeStatus, routeValidation, routeMaster, allocationGuard, allocationSubstitutionError, allocationLobError, tatCalc, milestoneError, tatDashboard, DEFAULT_KPI, kpiOf, otdTarget, journeyPlan, routeKpi,
    todayISO, addDays, diffDays, maxDate, plateKey, setupOf, statusList, statusInfo, canonicalStatus, repoDays, routeTiming, routeLabel, findRoute, routeCost, fits, bodyRuns,
    truckStatus, overlappingAllocations, allocationDates, bookingConflicts, planForRequest, requestCounts, requestStatus, nextRequestId, nextAllocationId, allocationChain,
    waybillStatus, invoiceAutoStatus, paymentLabel, tripIdValid, runway, fleetKpis, billingKpis,
  };
});
