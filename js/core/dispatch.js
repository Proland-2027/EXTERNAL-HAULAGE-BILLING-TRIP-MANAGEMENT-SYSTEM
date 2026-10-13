/*
 * Dispatch planning engine: vehicle consumption matrix, approved route distances, diesel and road-expense allowances,
 * dispatch authorisation forms and their status, trip expense control, lost sales, the management assistant and the
 * anomaly checks. Pure functions shared by browser, server and tests. Calculated allowances are never actual issues
 * or payments: those are the recorded issuance / payment entries on the dispatch record.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./planning.js'), require('./geo.js'));
  else { root.HB = root.HB || {}; root.HB.dispatch = factory(root.HB.engine, root.HB.planning, root.HB.geo); }
})(typeof self !== 'undefined' ? self : this, function (E, P, G) {
  'use strict';
  const num = E.num, norm = E.norm, clean = E.clean, round2 = E.round2;
  const r1 = (n) => Math.round(Number(n) * 10) / 10;

  // ------------------------------------------------------------- settings
  const CATEGORIES = ['Haulage 45T', 'Jumbo 30T / 102 CBM', 'Flatbed', 'Other'];
  const DEFAULT_DISPATCH = {
    dieselRates: { 'Haulage 45T': 0.5, 'Jumbo 30T / 102 CBM': 0.45, 'Flatbed': 0.42, 'Other': 0.45 },
    roadRatePerKm: 25, financeApprovalAbove: 50000, withinStateKm: 40, highDistanceKm: 1700, originStation: 'JMG Gbagada, Lagos', originState: 'Lagos',
  };
  const setupOf = (planning) => Object.assign({}, DEFAULT_DISPATCH, (planning && planning.dispatch) || {}, { dieselRates: Object.assign({}, DEFAULT_DISPATCH.dieselRates, (planning && planning.dispatch && planning.dispatch.dieselRates) || {}) });
  const DISPATCH_STATUSES = ['Draft', 'Awaiting Approval', 'Awaiting Finance', 'Approved', 'Partly Dispatched', 'Dispatched', 'Closed', 'Rejected'];
  const LOST_KINDS = ['Confirmed lost sale', 'At risk', 'Not a lost sale'];
  /** Cancellation reasons and the lost-sales classification they imply (the user can override). */
  const CANCEL_REASONS = [
    ['No truck available', 'Confirmed lost sale'], ['Truck not available on the requested date', 'Confirmed lost sale'], ['Rate not agreed', 'Confirmed lost sale'], ['Client gave the job to another transporter', 'Confirmed lost sale'],
    ['Client postponed', 'At risk'], ['Client cancelled the order', 'Not a lost sale'], ['Duplicate request', 'Not a lost sale'], ['Entered in error', 'Not a lost sale'], ['Other', 'At risk'],
  ];

  // ------------------------------------------------------- vehicle category
  /** Consumption category from the asset master and the FMR truck record (body type / tonnage). */
  function vehicleCategory(asset, truck) {
    const body = norm((truck && truck.bodyType) || ''); const ton = E.normContract((truck && truck.tonnage) || ''); const vt = norm((asset && asset.vehicleType) || '');
    if (/flat/.test(body) || /flat/.test(vt)) return 'Flatbed';
    if (ton === '45' || /sided/.test(body) && ton !== '30') return 'Haulage 45T';
    if (body === '102' || ton === '30' || /jumbo|102/.test(body)) return 'Jumbo 30T / 102 CBM';
    if (/haulage/.test(vt)) return 'Haulage 45T';
    return 'Other';
  }
  const consumptionRate = (category, setup) => { const s = setup || DEFAULT_DISPATCH; const v = num(s.dieselRates && s.dieselRates[category]); return v === null ? null : v; };

  // ---------------------------------------------------------- distances
  const distanceId = (originState, destState, originStation) => `${G.key(originStation || originState)}__${G.key(destState)}`.replace(/\s+/g, '-');
  /**
   * The distance to use for a journey between two states. Order: approved master entry → unverified master entry
   * (AI / reference suggestion) → route register kilometres → within-state default → missing.
   */
  function resolveDistance(q, ctx) {
    const setup = setupOf(ctx.planning); const distances = ctx.distances || [];
    const from = q.originState || setup.originState, to = q.destState; const station = q.originStation || setup.originStation;
    const hit = (pred) => distances.find(pred);
    let d = hit((x) => x.originState === from && x.destState === to && G.key(x.originStation || '') === G.key(station)) || hit((x) => x.originState === from && x.destState === to);
    if (!d) { const rev = hit((x) => x.originState === to && x.destState === from); if (rev) d = Object.assign({}, rev, { reversed: true }); }
    if (d && num(d.oneWayKm) !== null) { const one = num(d.oneWayKm), ret = num(d.returnKm) === null ? one : num(d.returnKm); return { oneWayKm: one, returnKm: ret, totalKm: round2(one + ret), source: d.verified ? 'approved' : 'suggested', verified: !!d.verified, distanceId: d.id, routeName: d.routeName || `${from} → ${to}`, reference: d.referenceLocation || '', via: d.verified ? 'Route Distance Master (approved)' : `Route Distance Master (${d.source || 'suggested'}, not yet verified)` }; }
    const route = q.routeId ? (ctx.routes || []).find((r) => r.id === q.routeId) : null;
    if (route && num(route.kmOneWay) !== null) { const one = num(route.kmOneWay); return { oneWayKm: one, returnKm: one, totalKm: round2(one * 2), source: 'route register', verified: false, distanceId: '', routeName: `${route.loadingPoint} → ${route.destination}`, reference: route.destination, via: `Route register ${route.id} (not verified in the Distance Master)` }; }
    if (from && to && from === to) return { oneWayKm: setup.withinStateKm, returnKm: setup.withinStateKm, totalKm: round2(setup.withinStateKm * 2), source: 'within state', verified: false, distanceId: '', routeName: `${from} (within state)`, reference: '', via: `Within-state default of ${setup.withinStateKm} km each way` };
    return { oneWayKm: null, returnKm: null, totalKm: null, source: 'missing', verified: false, distanceId: '', routeName: from && to ? `${from} → ${to}` : '', reference: '', via: 'No approved distance for this route' };
  }

  // ------------------------------------------------------------ dispatch calc
  /**
   * Full allowance calculation for a trip (or an allocation): states, category, consumption rate, distance, diesel and
   * road expenses, with every intermediate figure and the issues that block an approval.
   */
  function dispatchCalc(trip, ctx) {
    const setup = setupOf(ctx.planning); const master = ctx.locationMaster || {};
    const originName = trip.loadingFrom || '', destName = trip.loadingTo || trip.destination || '';
    const o = G.standardize(originName, master), d = G.standardize(destName, master);
    const asset = E.assetFor(trip.plate, ctx.assets); const truck = (ctx.fleet || []).find((t) => P.plateKey(t.plate) === P.plateKey(trip.plate)) || null;
    const category = vehicleCategory(asset, truck); const rate = consumptionRate(category, setup);
    const originState = o.state || (truck && truck.homeStation ? G.standardize(truck.homeStation, master).state : '') || setup.originState;
    const dist = resolveDistance({ originState, destState: d.state, originStation: originName, routeId: trip.routeId }, ctx);
    const dieselOut = dist.oneWayKm === null || rate === null ? null : round2(dist.oneWayKm * rate);
    const dieselReturn = dist.returnKm === null || rate === null ? null : round2(dist.returnKm * rate);
    const diesel = dieselOut === null ? null : round2(dieselOut + dieselReturn);
    const road = dist.totalKm === null ? null : round2(dist.totalKm * setup.roadRatePerKm);
    const issues = [];
    if (!o.state) issues.push(`Loading location "${originName}" is not mapped to a state (${o.confidence === 'ambiguous' ? 'ambiguous: ' + o.candidates.join(' / ') : 'unknown'}). Confirm it in the Location Master.`);
    if (!d.state) issues.push(`Delivery location "${destName}" is not mapped to a state (${d.confidence === 'ambiguous' ? 'ambiguous: ' + d.candidates.join(' / ') : 'unknown'}). Confirm it in the Location Master.`);
    if (o.confidence === 'likely') issues.push(`Loading location "${originName}" was matched by spelling only (${o.via}); confirm it.`);
    if (d.confidence === 'likely') issues.push(`Delivery location "${destName}" was matched by spelling only (${d.via}); confirm it.`);
    if (dist.source === 'missing') issues.push('No approved route distance; add or verify it in the Route Distance Master.');
    else if (!dist.verified) issues.push(`Distance is ${dist.source === 'route register' ? 'from the route register' : 'a suggestion'} and not yet verified by an administrator.`);
    if (category === 'Other') issues.push('Vehicle category could not be determined from the body type / tonnage; check the truck on the FMR.');
    if (rate === null) issues.push(`No diesel consumption rate configured for ${category}.`);
    if (dist.oneWayKm !== null && dist.oneWayKm > setup.highDistanceKm) issues.push(`One-way distance of ${dist.oneWayKm} km is unusually high; verify the route.`);
    return { originName, destName, originState, originConfidence: o.confidence, destState: d.state, destConfidence: d.confidence, category, rate, distance: dist, dieselOut, dieselReturn, diesel, roadRate: setup.roadRatePerKm, road, financeRequired: road !== null && road > setup.financeApprovalAbove, issues, ready: issues.filter((i) => !/matched by spelling|not yet verified/.test(i)).length === 0 };
  }

  // --------------------------------------------------------- dispatch record
  function nextDispatchNumber(date, dispatches) { const d = String(date || E.todayISO()).replace(/-/g, '').slice(2); const used = new Set((dispatches || []).map((x) => x.number)); let n = 1; while (used.has(`DSP-${d}-${String(n).padStart(2, '0')}`)) n++; return `DSP-${d}-${String(n).padStart(2, '0')}`; }
  const sum = (list, f) => round2((list || []).reduce((s, x) => s + (num(x[f]) || 0), 0));
  /** Approved allowances = initial approved figures + approved supplementary requests. */
  function approvedTotals(d) {
    const supp = (d.supplementary || []).filter((s) => s.status === 'Approved');
    return { diesel: round2((num(d.approvedDiesel) || 0) + sum(supp.filter((s) => s.kind === 'diesel'), 'qty')), road: round2((num(d.approvedRoad) || 0) + sum(supp.filter((s) => s.kind === 'road'), 'qty')), dieselIssued: sum(d.dieselIssues, 'litres'), roadPaid: sum(d.expensePayments, 'amount') };
  }
  function dispatchStatus(d) {
    if (!d) return 'Draft';
    if (d.rejectedAt) return 'Rejected';
    if (d.closedAt) return 'Closed';
    if (!d.opsApprovedAt) return d.submittedAt ? 'Awaiting Approval' : 'Draft';
    if (d.financeRequired && !d.financeApprovedAt) return 'Awaiting Finance';
    const t = approvedTotals(d);
    const dieselDone = t.diesel <= 0 || t.dieselIssued >= t.diesel - 0.005, roadDone = t.road <= 0 || t.roadPaid >= t.road - 0.005;
    if (dieselDone && roadDone && (t.dieselIssued > 0 || t.roadPaid > 0)) return 'Dispatched';
    if (t.dieselIssued > 0 || t.roadPaid > 0) return 'Partly Dispatched';
    return 'Approved';
  }
  /** Why a diesel issue / road payment cannot be recorded ('' when it can). Prevents duplicates and over-issue. */
  function issueError(d, kind, qty, supplementaryId) {
    const st = dispatchStatus(d); if (!['Approved', 'Partly Dispatched'].includes(st)) return `Dispatch ${d.number} is ${st}; diesel and road expenses are issued only on an approved dispatch.`;
    qty = num(qty); if (!(qty > 0)) return 'Enter the quantity issued.';
    const t = approvedTotals(d); const list = kind === 'diesel' ? d.dieselIssues || [] : d.expensePayments || [];
    if (supplementaryId) { const s = (d.supplementary || []).find((x) => x.id === supplementaryId); if (!s || s.kind !== kind) return 'Supplementary request not found.'; if (s.status !== 'Approved') return 'That supplementary request is not approved.'; if (list.some((x) => x.supplementaryId === supplementaryId)) return 'That supplementary request has already been issued.'; if (qty > num(s.qty) + 0.005) return `Issue cannot exceed the approved supplementary ${kind === 'diesel' ? s.qty + ' L' : '₦' + s.qty}.`; return ''; }
    if (list.some((x) => x.type === 'initial')) return `The initial ${kind === 'diesel' ? 'diesel' : 'road expense'} for ${d.number} has already been ${kind === 'diesel' ? 'issued' : 'paid'}; use an authorised supplementary request for more.`;
    const approved = kind === 'diesel' ? num(d.approvedDiesel) || 0 : num(d.approvedRoad) || 0;
    if (qty > approved + 0.005) return `${kind === 'diesel' ? qty + ' L exceeds the approved ' + approved + ' L' : '₦' + qty + ' exceeds the approved ₦' + approved}. Issue the approved amount and raise a supplementary request for the rest.`;
    void t; return '';
  }
  /** Expense control row for one dispatch. */
  function expenseControl(d) {
    const t = approvedTotals(d); const budgetD = num(d.budgetDiesel) || 0, budgetR = num(d.budgetRoad) || 0;
    const suppIssued = sum((d.dieselIssues || []).filter((x) => x.type === 'supplementary'), 'litres');
    const consumed = num(d.actualDieselConsumed);
    const dieselVar = round2(t.dieselIssued - t.diesel), roadVar = round2(t.roadPaid - t.road);
    const ex = [];
    if (t.dieselIssued > t.diesel + 0.005) ex.push('Diesel issued above the approved allowance');
    if (t.roadPaid > t.road + 0.005) ex.push('Road expenses paid above the approved allowance');
    if (budgetD && Math.abs(num(d.approvedDiesel) - budgetD) > 0.005) ex.push('Approved diesel differs from the calculated budget');
    if (consumed !== null && consumed > t.dieselIssued + 0.005) ex.push('Consumption reported above the diesel issued');
    if (suppIssued > 0) ex.push('Supplementary diesel issued');
    if (!d.distanceVerified) ex.push('Distance not verified');
    return { number: d.number, status: dispatchStatus(d), budgetDiesel: budgetD, approvedDiesel: t.diesel, dieselIssued: t.dieselIssued, supplementaryDiesel: suppIssued, consumed, dieselVariance: dieselVar, dieselVariancePct: t.diesel ? round2((dieselVar / t.diesel) * 100) : null, budgetRoad: budgetR, approvedRoad: t.road, roadPaid: t.roadPaid, roadVariance: roadVar, exceptions: ex };
  }

  // -------------------------------------------------------------- lost sales
  function lostSalesKindFor(reason) { const hit = CANCEL_REASONS.find(([r]) => norm(r) === norm(reason)); return hit ? hit[1] : 'At risk'; }
  /** Agreed rate for a request: the price list (client + origin + destination + type/tonnage) first, then the route's approved price. */
  function requestRate(request, ctx) {
    const probe = { client: request.client, loadingFrom: request.loadingFrom, loadingTo: request.destination, vehicleType: '', contractType: request.tonnage || '', dateDispatched: request.loadingDate || E.todayISO() };
    const lk = E.lookupAgreedRate(probe, ctx.rates || [], ctx.zones || {}, ctx.clients || []);
    if (lk.rate) return { rate: num(lk.rate.price), source: 'price list' };
    const route = (ctx.routes || []).find((r) => r.id === request.routeId); if (route && num(route.price)) return { rate: num(route.price), source: 'route register' };
    return { rate: null, source: 'none' };
  }
  /** Lost Sales = unfulfilled trucks × agreed client rate. */
  function lostSales(request, counts, rate) { const unfulfilled = Math.max(0, (counts.requested || 0) - (counts.allocated || 0)); return { unfulfilled, rate: num(rate), lost: num(rate) === null ? null : round2(unfulfilled * num(rate)) }; }
  function lostSalesSummary(records, keyFn) { const map = new Map(); for (const r of records) { const k = keyFn(r) || '(unspecified)'; const m = map.get(k) || { key: k, records: 0, trucks: 0, confirmed: 0, atRisk: 0, notLost: 0 }; m.records++; m.trucks += r.unfulfilledTrucks || 0; const v = num(r.estimatedLost) || 0; if (r.kind === 'Confirmed lost sale') m.confirmed = round2(m.confirmed + v); else if (r.kind === 'At risk') m.atRisk = round2(m.atRisk + v); else m.notLost = round2(m.notLost + v); map.set(k, m); } return [...map.values()].sort((a, b) => b.confirmed - a.confirmed || b.atRisk - a.atRisk); }

  // ------------------------------------------------------------- assistant
  const planned = (ctx) => (ctx.allocations || []).filter((a) => !['Cancelled', 'Completed'].includes(a.status));
  const allocCalc = (a, ctx) => dispatchCalc({ plate: a.plate, loadingFrom: a.loadingFrom, loadingTo: a.destination, routeId: a.routeId }, ctx);
  const money = (n) => '₦' + (Number(n) || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
  const litres = (n) => (Number(n) || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 }) + ' L';
  /** Management questions answered from live records. Returns { title, answer, rows, columns } or null when not understood. */
  function assistant(question, ctx) {
    const q = norm(question); const today = ctx.today || E.todayISO(); const dispatches = ctx.dispatches || [];
    const byTrip = new Map(dispatches.map((d) => [d.tripLogId, d]));
    const stateIn = (s) => G.STATE_NAMES.find((st) => new RegExp('\\b' + norm(st) + '\\b').test(s)) || (G.standardize(s.replace(/.*\b(?:to|for)\b/, ''), ctx.locationMaster).state || '');
    const upcoming = (days) => planned(ctx).filter((a) => a.plannedLoadingDate && a.plannedLoadingDate >= today && a.plannedLoadingDate <= P.addDays(today, days));
    if (/awaiting diesel|waiting for diesel|not yet issued diesel|awaiting dispatch/.test(q)) {
      const rows = dispatches.filter((d) => { const s = dispatchStatus(d); return s === 'Approved' || (s === 'Partly Dispatched' && approvedTotals(d).dieselIssued <= 0); }).map((d) => ({ dispatch: d.number, plate: d.plate, client: d.client, route: d.routeName, approvedDiesel: num(d.approvedDiesel) || 0, status: dispatchStatus(d) }));
      const awaitingApproval = dispatches.filter((d) => dispatchStatus(d) === 'Awaiting Approval').length;
      return { title: 'Trips awaiting diesel dispatch', answer: `${rows.length} approved dispatch${rows.length === 1 ? '' : 'es'} still waiting for diesel (${litres(rows.reduce((s, r) => s + r.approvedDiesel, 0))}); ${awaitingApproval} more waiting for approval.`, columns: ['dispatch', 'plate', 'client', 'route', 'approvedDiesel', 'status'], rows };
    }
    if (/diesel/.test(q) && /tomorrow/.test(q)) { const tomorrow = P.addDays(today, 1); const rows = planned(ctx).filter((a) => a.plannedLoadingDate === tomorrow).map((a) => { const c = allocCalc(a, ctx); return { allocation: a.id, plate: a.plate, client: a.client, route: `${a.loadingFrom} → ${a.destination}`, category: c.category, totalKm: c.distance.totalKm, diesel: c.diesel }; }); const tot = rows.reduce((s, r) => s + (r.diesel || 0), 0); const miss = rows.filter((r) => r.diesel === null).length; return { title: `Diesel required for ${tomorrow}`, answer: `${rows.length} planned trip${rows.length === 1 ? '' : 's'} tomorrow need ${litres(tot)}${miss ? ` (${miss} without an approved distance, not included)` : ''}.`, columns: ['allocation', 'plate', 'client', 'route', 'category', 'totalKm', 'diesel'], rows }; }
    if (/road expense/.test(q) && /(seven|7)\s*days|week/.test(q)) { const rows = upcoming(7).map((a) => { const c = allocCalc(a, ctx); return { allocation: a.id, date: a.plannedLoadingDate, plate: a.plate, client: a.client, route: `${a.loadingFrom} → ${a.destination}`, totalKm: c.distance.totalKm, road: c.road }; }); const tot = rows.reduce((s, r) => s + (r.road || 0), 0); return { title: 'Road expenses for the next 7 days', answer: `${rows.length} planned trip${rows.length === 1 ? '' : 's'} in the next seven days need ${money(tot)} in road expenses at ₦${setupOf(ctx.planning).roadRatePerKm}/km.`, columns: ['allocation', 'date', 'plate', 'client', 'route', 'totalKm', 'road'], rows }; }
    if (/route/.test(q) && /most diesel|consume|consumption/.test(q)) { const map = new Map(); for (const d of dispatches) { const k = d.routeName || `${d.originState} → ${d.destState}`; const m = map.get(k) || { route: k, dispatches: 0, approvedDiesel: 0, dieselIssued: 0 }; m.dispatches++; m.approvedDiesel = round2(m.approvedDiesel + approvedTotals(d).diesel); m.dieselIssued = round2(m.dieselIssued + approvedTotals(d).dieselIssued); map.set(k, m); } const rows = [...map.values()].sort((a, b) => b.dieselIssued - a.dieselIssued || b.approvedDiesel - a.approvedDiesel); return { title: 'Diesel by route', answer: rows.length ? `${rows[0].route} consumes the most diesel (${litres(rows[0].dieselIssued || rows[0].approvedDiesel)} across ${rows[0].dispatches} dispatch${rows[0].dispatches === 1 ? '' : 'es'}).` : 'No dispatches yet.', columns: ['route', 'dispatches', 'approvedDiesel', 'dieselIssued'], rows }; }
    if (/above|exceed|over/.test(q) && /diesel|allowance/.test(q)) { const rows = dispatches.map((d) => ({ d, c: expenseControl(d) })).filter((x) => x.c.dieselIssued > x.c.approvedDiesel + 0.005).map((x) => ({ dispatch: x.d.number, plate: x.d.plate, client: x.d.client, approvedDiesel: x.c.approvedDiesel, dieselIssued: x.c.dieselIssued, variance: x.c.dieselVariance })); return { title: 'Trucks issued diesel above the approved allowance', answer: rows.length ? `${rows.length} dispatch${rows.length === 1 ? '' : 'es'} issued more diesel than approved.` : 'No truck has received diesel above its approved allowance.', columns: ['dispatch', 'plate', 'client', 'approvedDiesel', 'dieselIssued', 'variance'], rows }; }
    if (/variance/.test(q)) { const rows = dispatches.map((d) => ({ d, c: expenseControl(d) })).filter((x) => x.c.dieselIssued > 0).sort((a, b) => Math.abs(b.c.dieselVariance) - Math.abs(a.c.dieselVariance)).slice(0, 15).map((x) => ({ dispatch: x.d.number, plate: x.d.plate, route: x.d.routeName, approvedDiesel: x.c.approvedDiesel, dieselIssued: x.c.dieselIssued, variance: x.c.dieselVariance, variancePct: x.c.dieselVariancePct })); return { title: 'Highest diesel variance', answer: rows.length ? `${rows[0].dispatch} (${rows[0].plate}) has the largest variance: ${rows[0].variance > 0 ? '+' : ''}${rows[0].variance} L against approved.` : 'No diesel has been issued yet.', columns: ['dispatch', 'plate', 'route', 'approvedDiesel', 'dieselIssued', 'variance', 'variancePct'], rows }; }
    if (/diesel/.test(q) && /planned|all/.test(q)) { const st = stateIn(q); const rows = planned(ctx).map((a) => ({ a, c: allocCalc(a, ctx) })).filter((x) => !st || x.c.destState === st).map((x) => ({ allocation: x.a.id, date: x.a.plannedLoadingDate, plate: x.a.plate, client: x.a.client, destination: x.a.destination, state: x.c.destState, category: x.c.category, totalKm: x.c.distance.totalKm, diesel: x.c.diesel })); const tot = rows.reduce((s, r) => s + (r.diesel || 0), 0); return { title: `Diesel for planned ${st || ''} trips`, answer: `${rows.length} planned trip${rows.length === 1 ? '' : 's'}${st ? ' to ' + st : ''} need ${litres(tot)} in total.`, columns: ['allocation', 'date', 'plate', 'client', 'destination', 'state', 'category', 'totalKm', 'diesel'], rows }; }
    if (/available/.test(q) && /not (allocated|planned)|unallocated|unplanned/.test(q)) { const k = P.fleetKpis(ctx); const rows = k.statuses.filter((x) => x.st.category === P.AVAILABILITY_CATEGORIES[0]).map((x) => ({ plate: x.truck.plate, body: [x.truck.bodyType, x.truck.tonnage].filter(Boolean).join(' '), location: x.truck.currentLocation || x.truck.homeStation, since: (x.truck.statusAt || '').slice(0, 10) })); return { title: 'Available trucks not allocated', answer: `${rows.length} truck${rows.length === 1 ? ' is' : 's are'} available and unplanned.`, columns: ['plate', 'body', 'location', 'since'], rows }; }
    if (/lost sale|shortage|unfulfilled/.test(q)) { const rows = (ctx.requests || []).map((r) => ({ r, c: P.requestCounts(r, ctx.allocations, ctx.trips) })).filter((x) => x.c.outstanding > 0 && !['Cancelled', 'Completed'].includes(P.requestStatus(x.r, x.c))).map((x) => { const rate = requestRate(x.r, ctx); const ls = lostSales(x.r, x.c, rate.rate); return { request: x.r.id, client: x.r.client, loadingDate: x.r.loadingDate, requested: x.c.requested, allocated: x.c.allocated, outstanding: x.c.outstanding, rate: rate.rate, atRisk: ls.lost, daysLeft: x.r.loadingDate ? P.diffDays(x.r.loadingDate, today) : null }; }).sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)); const tot = rows.reduce((s, r) => s + (r.atRisk || 0), 0); return { title: 'Requests at risk of becoming lost sales', answer: `${rows.length} open request${rows.length === 1 ? '' : 's'} still lack trucks: ${money(tot)} of revenue at risk.`, columns: ['request', 'client', 'loadingDate', 'daysLeft', 'requested', 'allocated', 'outstanding', 'rate', 'atRisk'], rows }; }
    return null;
  }
  const QUESTIONS = ['Which trips are awaiting diesel dispatch?', "How much diesel is required for tomorrow's planned trips?", 'What are the total road expense requirements for the next seven days?', 'Which routes consume the most diesel?', 'Which trucks have received diesel above the approved allowance?', 'Which trips have the highest diesel variance?', 'How much diesel is required for all planned Kano trips?', 'Which trucks are available but not allocated?', 'Which client requests may become lost sales due to truck shortages?'];

  // -------------------------------------------------------------- anomalies
  function anomalies(ctx) {
    const out = []; const setup = setupOf(ctx.planning); const master = ctx.locationMaster || {};
    const names = new Map();
    for (const r of ctx.routes || []) { const k = norm(`${r.client} ${r.loadingPoint} ${r.destination} ${r.size} ${r.tonnage}`); names.set(k, (names.get(k) || []).concat(r.id)); }
    for (const [k, ids] of names) if (ids.length > 1) out.push({ kind: 'Duplicate route', severity: 'warn', message: `Routes ${ids.join(', ')} describe the same lane`, ref: ids[0] });
    const dn = new Map(); for (const d of ctx.distances || []) { const k = norm(d.routeName || ''); if (!k) continue; dn.set(k, (dn.get(k) || []).concat(d.id)); } for (const [k, ids] of dn) if (ids.length > 1) out.push({ kind: 'Duplicate route name', severity: 'warn', message: `Distance master entries ${ids.join(', ')} share the name "${k}"`, ref: ids[0] });
    const locs = new Set(); for (const t of ctx.trips || []) { if (t.loadingFrom) locs.add(t.loadingFrom); if (t.loadingTo) locs.add(t.loadingTo); } for (const a of ctx.allocations || []) { if (a.loadingFrom) locs.add(a.loadingFrom); if (a.destination) locs.add(a.destination); }
    const bad = [...locs].map((n) => ({ n, r: G.standardize(n, master) })).filter((x) => !x.r.state);
    for (const x of bad.slice(0, 50)) out.push({ kind: 'Inconsistent state name', severity: 'warn', message: `"${x.n}" is ${x.r.confidence === 'ambiguous' ? 'ambiguous (' + x.r.candidates.join(' / ') + ')' : 'not mapped to a state'}`, ref: x.n });
    if (bad.length > 50) out.push({ kind: 'Inconsistent state name', severity: 'warn', message: `${bad.length - 50} more locations are unmapped`, ref: '' });
    for (const d of ctx.distances || []) { if (num(d.oneWayKm) > setup.highDistanceKm) out.push({ kind: 'Unusually high distance', severity: 'bad', message: `${d.routeName || d.id}: ${d.oneWayKm} km one way`, ref: d.id }); const si = G.stateInfo(d.destState), so = G.stateInfo(d.originState); if (si && so && num(d.oneWayKm) !== null) { const air = G.haversineKm(so, si); if (air > 50 && num(d.oneWayKm) < air * 0.95) out.push({ kind: 'Unusually low distance', severity: 'bad', message: `${d.routeName || d.id}: ${d.oneWayKm} km is below the straight-line distance (${air} km)`, ref: d.id }); } }
    for (const t of ctx.fleet || []) { const asset = E.assetFor(t.plate, ctx.assets); if (t.active !== false && vehicleCategory(asset, t) === 'Other') out.push({ kind: 'Vehicle consumption category', severity: 'warn', message: `${t.plate}: body "${t.bodyType || '—'}" / ${t.tonnage || 'no tonnage'} does not map to a consumption category`, ref: t.plate }); }
    for (const d of ctx.dispatches || []) {
      const initial = (d.dieselIssues || []).filter((x) => x.type === 'initial'); if (initial.length > 1) out.push({ kind: 'Duplicate diesel issue', severity: 'bad', message: `${d.number} has ${initial.length} initial diesel issues`, ref: d.number });
      const refs = new Map(); for (const x of d.dieselIssues || []) if (x.ref) { refs.set(x.ref, (refs.get(x.ref) || 0) + 1); } for (const [ref, n] of refs) if (n > 1) out.push({ kind: 'Duplicate diesel request', severity: 'bad', message: `${d.number}: reference ${ref} used ${n} times`, ref: d.number });
      const c = expenseControl(d); if (c.dieselIssued > c.approvedDiesel + 0.005) out.push({ kind: 'Diesel above approved', severity: 'bad', message: `${d.number} (${d.plate}): ${c.dieselIssued} L issued vs ${c.approvedDiesel} L approved`, ref: d.number });
      if (!d.distanceVerified && dispatchStatus(d) !== 'Rejected') out.push({ kind: 'Missing approved distance', severity: 'warn', message: `${d.number} (${d.routeName || d.originState + ' → ' + d.destState}) uses an unverified distance`, ref: d.number });
    }
    for (const a of planned(ctx)) { const c = allocCalc(a, ctx); if (c.distance.source === 'missing') out.push({ kind: 'Missing approved distance', severity: 'warn', message: `Allocation ${a.id} ${a.loadingFrom} → ${a.destination}: no route distance`, ref: a.id }); }
    return out;
  }

  // --------------------------------------------------------------- dashboard
  function dashboard(ctx) {
    const today = ctx.today || E.todayISO(); const dispatches = ctx.dispatches || []; const byStatus = (s) => dispatches.filter((d) => dispatchStatus(d) === s);
    const plannedAllocs = planned(ctx); const calcs = plannedAllocs.map((a) => ({ a, c: allocCalc(a, ctx) }));
    const totals = dispatches.map((d) => ({ d, t: approvedTotals(d), c: expenseControl(d) }));
    const k = P.fleetKpis(ctx);
    const byCat = {}; const byRoute = {}; const byTruck = [];
    for (const { d, t, c } of totals) { const cat = d.category || 'Other'; byCat[cat] = round2((byCat[cat] || 0) + (t.dieselIssued || t.diesel)); const rk = d.routeName || `${d.originState} → ${d.destState}`; byRoute[rk] = round2((byRoute[rk] || 0) + (t.dieselIssued || t.diesel)); if (t.dieselIssued > 0) byTruck.push({ plate: d.plate, dispatch: d.number, approved: t.diesel, issued: t.dieselIssued, variance: c.dieselVariance }); }
    return {
      plannedTrips: plannedAllocs.length, awaitingApproval: byStatus('Awaiting Approval').length + byStatus('Awaiting Finance').length, approvedAwaitingDiesel: totals.filter((x) => ['Approved', 'Partly Dispatched'].includes(dispatchStatus(x.d)) && x.t.dieselIssued <= 0).length,
      dieselRequiredPlanned: round2(calcs.reduce((s, x) => s + (x.c.diesel || 0), 0)), dieselIssued: round2(totals.reduce((s, x) => s + x.t.dieselIssued, 0)), roadRequiredPlanned: round2(calcs.reduce((s, x) => s + (x.c.road || 0), 0)), roadPaid: round2(totals.reduce((s, x) => s + x.t.roadPaid, 0)),
      supplementaryRequests: dispatches.reduce((s, d) => s + (d.supplementary || []).length, 0), supplementaryPending: dispatches.reduce((s, d) => s + (d.supplementary || []).filter((x) => x.status === 'Pending').length, 0),
      varianceByTruck: byTruck.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)), byCategory: Object.entries(byCat).map(([k, v]) => ({ category: k, diesel: v })), byRoute: Object.entries(byRoute).map(([k, v]) => ({ route: k, diesel: v })).sort((a, b) => b.diesel - a.diesel).slice(0, 12),
      availableNotPlanned: k.availableUnplanned, confirmedLostSales: round2((ctx.lostsales || []).filter((l) => l.kind === 'Confirmed lost sale').reduce((s, l) => s + (num(l.estimatedLost) || 0), 0)), plannedMissingDistance: calcs.filter((x) => x.c.distance.source === 'missing').length, today,
    };
  }

  return { CATEGORIES, DEFAULT_DISPATCH, DISPATCH_STATUSES, LOST_KINDS, CANCEL_REASONS, QUESTIONS, setupOf, vehicleCategory, consumptionRate, distanceId, resolveDistance, dispatchCalc, nextDispatchNumber, approvedTotals, dispatchStatus, issueError, expenseControl, lostSalesKindFor, requestRate, lostSales, lostSalesSummary, assistant, anomalies, dashboard };
});
