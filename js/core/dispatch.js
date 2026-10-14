/*
 * Dispatch planning engine: vehicle consumption matrix, approved route distances, the two independent trip expense
 * documents (Diesel Request Form and Road Expense Payment Slip, each linked to the same Trip ID with its own numbering,
 * status and approval history), additional trip expense requests, trip expense control, lost sales, the 3PL margin
 * helpers, the management assistant, the anomaly checks and the workflow KPIs. Pure functions shared by browser, server
 * and tests. Calculated allowances are never actual issues or payments: those are the recorded entries on each document.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./planning.js'), require('./geo.js'));
  else { root.HB = root.HB || {}; root.HB.dispatch = factory(root.HB.engine, root.HB.planning, root.HB.geo); }
})(typeof self !== 'undefined' ? self : this, function (E, P, G) {
  'use strict';
  const num = E.num, norm = E.norm, clean = E.clean, round2 = E.round2;

  // ------------------------------------------------------------- settings
  const CATEGORIES = ['Haulage 45T', 'Jumbo 30T / 102 CBM', 'Flatbed', 'Other'];
  const DEFAULT_DISPATCH = {
    dieselRates: { 'Haulage 45T': 0.5, 'Jumbo 30T / 102 CBM': 0.45, 'Flatbed': 0.42, 'Other': 0.45 },
    roadRatePerKm: 25, financeApprovalAbove: 50000, withinStateKm: 40, highDistanceKm: 1700, originStation: 'JMG Gbagada, Lagos', originState: 'Lagos',
  };
  const setupOf = (planning) => Object.assign({}, DEFAULT_DISPATCH, (planning && planning.dispatch) || {}, { dieselRates: Object.assign({}, DEFAULT_DISPATCH.dieselRates, (planning && planning.dispatch && planning.dispatch.dieselRates) || {}) });
  /** Status of a diesel request or road expense slip. */
  const SLIP_STATUSES = ['Draft', 'Awaiting Approval', 'Awaiting Finance', 'Approved', 'Partly Issued', 'Issued', 'Closed', 'Rejected'];
  const SLIP_KINDS = { diesel: { collection: 'dieselreqs', prefix: 'DSL', title: 'Diesel Request Form', unit: 'L', qtyField: 'litres', issuedWord: 'issued', paidWord: 'Issued' }, road: { collection: 'roadslips', prefix: 'RXP', title: 'Road Expense Payment Slip', unit: '₦', qtyField: 'amount', issuedWord: 'paid', paidWord: 'Paid' } };
  const EXPENSE_CATEGORIES = ['Extra diesel', 'Road expenses', 'Loading / offloading labour', 'Police / checkpoint', 'Toll / levy', 'Repairs on the road', 'Accommodation / feeding', 'Towing', 'Demurrage', 'Other'];
  const EXPENSE_STATUSES = ['Pending Approval', 'Approved', 'Rejected', 'Paid'];
  const PAYMENT_METHODS = ['Cash', 'Bank transfer', 'Mobile money', 'Fuel card', 'Driver float'];
  const LOST_KINDS = ['Confirmed lost sale', 'At risk', 'Not a lost sale'];
  /** Cancellation reasons and the lost-sales classification they imply (the user can override). */
  const CANCEL_REASONS = [
    ['No truck available', 'Confirmed lost sale'], ['Truck not available on the requested date', 'Confirmed lost sale'], ['Rate not agreed', 'Confirmed lost sale'], ['Client gave the job to another transporter', 'Confirmed lost sale'],
    ['Client postponed', 'At risk'], ['Client cancelled the order', 'Not a lost sale'], ['Duplicate request', 'Not a lost sale'], ['Entered in error', 'Not a lost sale'], ['Other', 'At risk'],
  ];
  const TPL_ASSIGNMENT = ['Not Assigned', 'Quotation Requested', 'Quoted', 'Cost Approved', 'Assigned', 'In Execution', 'Completed'];
  const QUOTE_STATUSES = ['Requested', 'Quoted', 'Selected', 'Rejected', 'Withdrawn'];

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
   * The distance to use for a journey. Order: the request's approved Route Master entry (approved outbound / return km) →
   * approved state distance → unverified suggestion → route register kilometres → within-state default → missing.
   */
  function resolveDistance(q, ctx) {
    const setup = setupOf(ctx.planning); const distances = ctx.distances || [];
    const from = q.originState || setup.originState, to = q.destState; const station = q.originStation || setup.originStation;
    const route = q.routeId ? (ctx.routes || []).find((r) => r.id === q.routeId) : null;
    if (route && num(route.kmOneWay) !== null && P.routeStatus(route) === 'Approved' && (route.approvedAt || route.kmApproved)) { const one = num(route.kmOneWay), ret = num(route.kmReturn) === null ? one : num(route.kmReturn); return { oneWayKm: one, returnKm: ret, totalKm: round2(one + ret), source: 'route master', verified: true, distanceId: route.id, routeName: `${route.loadingPoint} → ${route.destination}`, reference: route.destination, via: `Route Master ${route.id} (approved ${(route.approvedAt || '').slice(0, 10)})` }; }
    const hit = (pred) => distances.find(pred);
    let d = hit((x) => x.originState === from && x.destState === to && G.key(x.originStation || '') === G.key(station)) || hit((x) => x.originState === from && x.destState === to);
    if (!d) { const rev = hit((x) => x.originState === to && x.destState === from); if (rev) d = Object.assign({}, rev, { reversed: true }); }
    if (d && num(d.oneWayKm) !== null) { const one = num(d.oneWayKm), ret = num(d.returnKm) === null ? one : num(d.returnKm); return { oneWayKm: one, returnKm: ret, totalKm: round2(one + ret), source: d.verified ? 'approved' : 'suggested', verified: !!d.verified, distanceId: d.id, routeName: d.routeName || `${from} → ${to}`, reference: d.referenceLocation || '', via: d.verified ? 'Route Distance Master (approved)' : `Route Distance Master (${d.source || 'suggested'}, not yet verified)` }; }
    if (route && num(route.kmOneWay) !== null) { const one = num(route.kmOneWay); return { oneWayKm: one, returnKm: num(route.kmReturn) === null ? one : num(route.kmReturn), totalKm: round2(one + (num(route.kmReturn) === null ? one : num(route.kmReturn))), source: 'route register', verified: false, distanceId: '', routeName: `${route.loadingPoint} → ${route.destination}`, reference: route.destination, via: `Route register ${route.id} (kilometres not yet approved)` }; }
    if (from && to && from === to) return { oneWayKm: setup.withinStateKm, returnKm: setup.withinStateKm, totalKm: round2(setup.withinStateKm * 2), source: 'within state', verified: false, distanceId: '', routeName: `${from} (within state)`, reference: '', via: `Within-state default of ${setup.withinStateKm} km each way` };
    return { oneWayKm: null, returnKm: null, totalKm: null, source: 'missing', verified: false, distanceId: '', routeName: from && to ? `${from} → ${to}` : '', reference: '', via: 'No approved distance for this route' };
  }

  // ------------------------------------------------------------ dispatch calc
  /** Full allowance calculation for a trip (or an allocation): states, category, consumption rate, distance, diesel and road expenses. */
  function dispatchCalc(trip, ctx) {
    const setup = setupOf(ctx.planning); const master = ctx.locationMaster || {};
    const originName = trip.loadingFrom || '', destName = trip.loadingTo || trip.destination || '';
    const o = G.standardize(originName, master), d = G.standardize(destName, master);
    const asset = E.assetFor(trip.plate, ctx.assets); const truck = (ctx.fleet || []).find((t) => P.plateKey(t.plate) === P.plateKey(trip.plate)) || null;
    const category = vehicleCategory(asset, truck); const rate = consumptionRate(category, setup);
    const originState = o.state || (truck && truck.homeStation ? G.standardize(truck.homeStation, master).state : '') || setup.originState;
    const dist = resolveDistance({ originState, destState: d.state, originStation: originName, routeId: trip.routeMasterId || trip.routeId }, ctx);
    const dieselOut = dist.oneWayKm === null || rate === null ? null : round2(dist.oneWayKm * rate);
    const dieselReturn = dist.returnKm === null || rate === null ? null : round2(dist.returnKm * rate);
    const diesel = dieselOut === null ? null : round2(dieselOut + dieselReturn);
    const road = dist.totalKm === null ? null : round2(dist.totalKm * setup.roadRatePerKm);
    const issues = [];
    if (trip.serviceType === '3rd Party Contractor') issues.push('Third-party contractor trip: JMG diesel and road allowances do not apply.');
    if (!o.state) issues.push(`Loading location "${originName}" is not mapped to a state (${o.confidence === 'ambiguous' ? 'ambiguous: ' + o.candidates.join(' / ') : 'unknown'}). Confirm it in the Location Master.`);
    if (!d.state) issues.push(`Delivery location "${destName}" is not mapped to a state (${d.confidence === 'ambiguous' ? 'ambiguous: ' + d.candidates.join(' / ') : 'unknown'}). Confirm it in the Location Master.`);
    if (o.confidence === 'likely') issues.push(`Loading location "${originName}" was matched by spelling only (${o.via}); confirm it.`);
    if (d.confidence === 'likely') issues.push(`Delivery location "${destName}" was matched by spelling only (${d.via}); confirm it.`);
    if (dist.source === 'missing') issues.push('No approved route distance; map and approve the route in the Route Master.');
    else if (!dist.verified) issues.push(`Distance is ${dist.source === 'route register' ? 'from the route register' : 'a suggestion'} and not yet approved.`);
    if (category === 'Other') issues.push('Vehicle category could not be determined from the body type / tonnage; check the truck on the FMR.');
    if (rate === null) issues.push(`No diesel consumption rate configured for ${category}.`);
    if (dist.oneWayKm !== null && dist.oneWayKm > setup.highDistanceKm) issues.push(`One-way distance of ${dist.oneWayKm} km is unusually high; verify the route.`);
    return { originName, destName, originState, originConfidence: o.confidence, destState: d.state, destConfidence: d.confidence, category, rate, distance: dist, dieselOut, dieselReturn, diesel, roadRate: setup.roadRatePerKm, road, financeRequired: road !== null && road > setup.financeApprovalAbove, issues, ready: issues.filter((i) => !/matched by spelling|not yet approved/.test(i)).length === 0 };
  }

  // ------------------------------------------------------------ slips (diesel request / road expense payment slip)
  function nextSlipNumber(kind, date, list) { const k = SLIP_KINDS[kind]; const d = String(date || E.todayISO()).replace(/-/g, '').slice(2); const used = new Set((list || []).map((x) => x.number)); let n = 1; while (used.has(`${k.prefix}-${d}-${String(n).padStart(2, '0')}`)) n++; return `${k.prefix}-${d}-${String(n).padStart(2, '0')}`; }
  const sum = (list, f) => round2((list || []).reduce((s, x) => s + (num(x[f]) || 0), 0));
  /** Approved quantity = approved allowance + approved additional requests; issued = recorded issues / payments. */
  function slipTotals(d) {
    const supp = (d.supplementary || []).filter((s) => s.status === 'Approved');
    return { approved: round2((num(d.approvedQty) || 0) + sum(supp, 'qty')), issued: sum(d.issues, 'qty'), supplementaryApproved: sum(supp, 'qty'), supplementaryIssued: sum((d.issues || []).filter((x) => x.type === 'supplementary'), 'qty') };
  }
  function slipStatus(d) {
    if (!d) return 'Draft';
    if (d.rejectedAt) return 'Rejected';
    if (d.closedAt) return 'Closed';
    if (!d.opsApprovedAt) return d.submittedAt ? 'Awaiting Approval' : 'Draft';
    if (d.financeRequired && !d.financeApprovedAt) return 'Awaiting Finance';
    const t = slipTotals(d);
    if (t.approved > 0 && t.issued >= t.approved - 0.005) return 'Issued';
    if (t.issued > 0) return 'Partly Issued';
    return 'Approved';
  }
  /** Why an issue / payment cannot be recorded on a slip ('' when it can). Prevents duplicates and over-issue. */
  function slipIssueError(d, qty, supplementaryId) {
    const k = SLIP_KINDS[d.kind] || SLIP_KINDS.diesel; const st = slipStatus(d);
    if (!['Approved', 'Partly Issued', 'Issued'].includes(st)) return `${d.number} is ${st}; ${d.kind === 'diesel' ? 'diesel is issued' : 'road expenses are paid'} only on an approved document.`;
    qty = num(qty); if (!(qty > 0)) return `Enter the ${d.kind === 'diesel' ? 'litres issued' : 'amount paid'}.`;
    const list = d.issues || [];
    if (supplementaryId) { const s = (d.supplementary || []).find((x) => x.id === supplementaryId); if (!s) return 'Additional request not found.'; if (s.status !== 'Approved') return 'That additional request is not approved.'; if (list.some((x) => x.supplementaryId === supplementaryId)) return `That additional request has already been ${k.issuedWord}.`; if (qty > num(s.qty) + 0.005) return `Cannot exceed the approved additional ${d.kind === 'diesel' ? s.qty + ' L' : '₦' + s.qty}.`; return ''; }
    if (list.some((x) => x.type === 'initial')) return `The approved ${d.kind === 'diesel' ? 'diesel' : 'road expense'} for ${d.number} has already been ${k.issuedWord}; raise an additional request for more.`;
    const approved = num(d.approvedQty) || 0;
    if (qty > approved + 0.005) return `${d.kind === 'diesel' ? qty + ' L exceeds the approved ' + approved + ' L' : '₦' + qty + ' exceeds the approved ₦' + approved}. ${k.paidWord === 'Paid' ? 'Pay' : 'Issue'} the approved amount and raise an additional request for the rest.`;
    return '';
  }
  /** Build a new slip from a trip's calculation. kind = 'diesel' | 'road'. */
  function slipFromCalc(kind, trip, calc, opts) {
    opts = opts || {}; const now = opts.now || new Date().toISOString(); const k = SLIP_KINDS[kind];
    const budget = kind === 'diesel' ? calc.diesel : calc.road; const approved = opts.approvedQty === undefined || opts.approvedQty === null ? budget : opts.approvedQty;
    const base = { id: opts.id || `${k.prefix.toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, kind, number: nextSlipNumber(kind, (now || '').slice(0, 10), opts.existing), tripLogId: trip.id, tripId: trip.journeyPlanId || '', allocationId: trip.allocationId || '', requestId: trip.requestId || '', client: trip.client, plate: trip.plate, assetCode: trip.assetCode || '', driver: opts.driver || trip.driver || '', category: calc.category, truckBatch: trip.truckBatch || '', loadingFrom: trip.loadingFrom, loadingTo: trip.loadingTo, originState: calc.originState, destState: calc.destState, routeName: calc.distance.routeName, oneWayKm: calc.distance.oneWayKm, returnKm: calc.distance.returnKm, totalKm: calc.distance.totalKm, distanceSource: calc.distance.source, distanceVerified: calc.distance.verified,
      budgetQty: budget, approvedQty: approved, alreadyIssued: num(opts.alreadyIssued) || 0, adjustmentReason: clean(opts.reason || ''), preparedBy: opts.by || '', preparedAt: now, submittedAt: opts.submit ? now : '', issues: [], supplementary: [], history: [{ at: now, by: opts.by || '', action: opts.submit ? 'Prepared and submitted' : 'Prepared (draft)' }] };
    if (kind === 'diesel') Object.assign(base, { consumptionRate: calc.rate, budgetOut: calc.dieselOut, budgetReturn: calc.dieselReturn, financeRequired: false, station: opts.station || '' });
    else Object.assign(base, { roadRate: calc.roadRate, financeRequired: !!calc.financeRequired, paymentMethod: opts.paymentMethod || '' });
    return base;
  }
  /** Expense control row for one trip: the diesel request and the road slip side by side plus approved additional expenses. */
  function tripExpenseControl(trip, diesel, road, extras) {
    const dt = diesel ? slipTotals(diesel) : { approved: 0, issued: 0, supplementaryIssued: 0 }; const rt = road ? slipTotals(road) : { approved: 0, issued: 0, supplementaryIssued: 0 };
    const consumed = diesel ? num(diesel.actualConsumed) : null;
    const dVar = round2(dt.issued - dt.approved), rVar = round2(rt.issued - rt.approved);
    const ex = [];
    if (dt.issued > dt.approved + 0.005) ex.push('Diesel issued above the approved allowance');
    if (rt.issued > rt.approved + 0.005) ex.push('Road expenses paid above the approved allowance');
    if (diesel && num(diesel.budgetQty) && Math.abs((num(diesel.approvedQty) || 0) - num(diesel.budgetQty)) > 0.005) ex.push('Approved diesel differs from the calculated budget');
    if (consumed !== null && consumed > dt.issued + 0.005) ex.push('Consumption reported above the diesel issued');
    if (dt.supplementaryIssued > 0) ex.push('Additional diesel issued');
    if ((diesel && !diesel.distanceVerified) || (road && !road.distanceVerified)) ex.push('Distance not approved');
    const approvedExtras = (extras || []).filter((x) => ['Approved', 'Paid'].includes(x.status)); const paidExtras = approvedExtras.filter((x) => x.status === 'Paid');
    return { tripLogId: trip.id, tripId: trip.journeyPlanId, plate: trip.plate, client: trip.client, route: `${trip.loadingFrom} → ${trip.loadingTo}`, dieselNumber: diesel ? diesel.number : '', roadNumber: road ? road.number : '', dieselStatus: diesel ? slipStatus(diesel) : 'None', roadStatus: road ? slipStatus(road) : 'None',
      budgetDiesel: diesel ? num(diesel.budgetQty) || 0 : 0, approvedDiesel: dt.approved, dieselIssued: dt.issued, supplementaryDiesel: dt.supplementaryIssued, consumed, dieselVariance: dVar, dieselVariancePct: dt.approved ? round2((dVar / dt.approved) * 100) : null,
      budgetRoad: road ? num(road.budgetQty) || 0 : 0, approvedRoad: rt.approved, roadPaid: rt.issued, roadVariance: rVar, extrasApproved: sum(approvedExtras, 'approvedAmount'), extrasPaid: sum(paidExtras, 'approvedAmount'), extrasPending: (extras || []).filter((x) => x.status === 'Pending Approval').length, exceptions: ex, totalCost: round2(rt.issued + sum(paidExtras, 'approvedAmount')) };
  }

  // ------------------------------------------------------------ additional trip expenses
  function nextExpenseId(date, list) { const d = String(date || E.todayISO()).replace(/-/g, '').slice(2); const used = new Set((list || []).map((x) => x.id)); let n = 1; while (used.has(`AEX-${d}-${String(n).padStart(2, '0')}`)) n++; return `AEX-${d}-${String(n).padStart(2, '0')}`; }
  /**
   * Why an additional expense request cannot be created ('' when it can): the trip must be operationally Open, the amount and
   * reason are required, and the same category + amount must not already be pending or approved on the trip (duplicate).
   */
  function expenseRequestError(trip, existing, req) {
    if (!trip) return 'Trip not found.';
    const st = E.opsStatus(trip); if (st !== 'Open') return `Trip ${trip.journeyPlanId || trip.id} is ${st}; additional expense requests can only be raised while the trip is operationally Open.`;
    if (!(num(req.amountRequested) > 0)) return 'Enter the amount requested.';
    if (!clean(req.category)) return 'Choose the expense category.';
    if (!clean(req.reason)) return 'Give the reason for the request.';
    const dup = (existing || []).find((x) => x.tripLogId === trip.id && x.id !== req.id && norm(x.category) === norm(req.category) && Math.abs((num(x.amountRequested) || 0) - num(req.amountRequested)) < 0.005 && ['Pending Approval', 'Approved', 'Paid'].includes(x.status));
    if (dup) return `A ${req.category} request for ₦${req.amountRequested} already exists on this trip (${dup.id}, ${dup.status}).`;
    return '';
  }
  /** Role rule: only the Operations Manager decides on additional expenses; only finance pays approved ones. */
  function expenseTransitionError(current, next, role) {
    if (!current) return '';
    const changed = (k) => JSON.stringify(current[k]) !== JSON.stringify(next[k]);
    if (changed('status') && ['Approved', 'Rejected'].includes(next.status) && current.status === 'Pending Approval' && !E.can(role, 'expense.approve')) return 'Only the Operations Manager can approve or reject additional trip expenses.';
    if (changed('approvedAmount') && !E.can(role, 'expense.approve')) return 'Only the Operations Manager can set the approved amount.';
    if (changed('status') && next.status === 'Paid') { if (current.status !== 'Approved') return 'Only approved requests can be paid.'; if (!E.can(role, 'expense.pay')) return 'Only finance records the payment of an approved expense.'; }
    if (changed('status') && next.status === 'Pending Approval' && current.status !== 'Pending Approval') return 'A decided request cannot be reopened; raise a new request.';
    return '';
  }

  // -------------------------------------------------------------- lost sales
  function lostSalesKindFor(reason) { const hit = CANCEL_REASONS.find(([r]) => norm(r) === norm(reason)); return hit ? hit[1] : 'At risk'; }
  /** Agreed rate for a request: the price list (client + origin + destination + type/tonnage) first, then the route's approved price, then a 3PL selling price. */
  function requestRate(request, ctx) {
    if (P.isTpl(request) && request.tpl && num(request.tpl.sellingPrice) !== null) return { rate: num(request.tpl.sellingPrice), source: 'client agreed selling price (3PL)' };
    const probe = { client: request.client, loadingFrom: request.loadingFrom, loadingTo: request.destination, vehicleType: '', contractType: request.tonnage || '', dateDispatched: request.loadingDate || E.todayISO() };
    const lk = E.lookupAgreedRate(probe, ctx.rates || [], ctx.zones || {}, ctx.clients || []);
    if (lk.rate) return { rate: num(lk.rate.price), source: 'price list' };
    const route = (ctx.routes || []).find((r) => r.id === (request.routeMasterId || request.routeId)); if (route && num(route.price)) return { rate: num(route.price), source: 'route register' };
    return { rate: null, source: 'none' };
  }
  /** Lost Sales = unfulfilled trucks × agreed client rate. */
  function lostSales(request, counts, rate) { const unfulfilled = Math.max(0, (counts.requested || 0) - (counts.allocated || 0)); return { unfulfilled, rate: num(rate), lost: num(rate) === null ? null : round2(unfulfilled * num(rate)) }; }
  function lostSalesSummary(records, keyFn) { const map = new Map(); for (const r of records) { const k = keyFn(r) || '(unspecified)'; const m = map.get(k) || { key: k, records: 0, trucks: 0, confirmed: 0, atRisk: 0, notLost: 0 }; m.records++; m.trucks += r.unfulfilledTrucks || 0; const v = num(r.estimatedLost) || 0; if (r.kind === 'Confirmed lost sale') m.confirmed = round2(m.confirmed + v); else if (r.kind === 'At risk') m.atRisk = round2(m.atRisk + v); else m.notLost = round2(m.notLost + v); map.set(k, m); } return [...map.values()].sort((a, b) => b.confirmed - a.confirmed || b.atRisk - a.atRisk); }

  // -------------------------------------------------------------- 3PL
  /** Gross margin on a third-party job: client agreed selling price × quantity − approved contractor cost × quantity. */
  function tplMargin(tpl, qty) {
    const sell = num(tpl && tpl.sellingPrice), cost = num(tpl && (tpl.approvedCost !== undefined && tpl.approvedCost !== null && tpl.approvedCost !== '' ? tpl.approvedCost : tpl.contractorQuote)); const n = Math.max(1, Number(qty) || 1);
    if (sell === null) return { revenue: null, cost: cost === null ? null : round2(cost * n), margin: null, marginPct: null };
    const revenue = round2(sell * n); const c = cost === null ? null : round2(cost * n);
    return { revenue, cost: c, margin: c === null ? null : round2(revenue - c), marginPct: c === null || !revenue ? null : round2(((revenue - c) / revenue) * 100) };
  }
  /** Profitability per 3PL trip from the Trip Log (selling price vs contractor cost). */
  function tplProfitability(trips) {
    const rows = (trips || []).filter((t) => t.serviceType === '3rd Party Contractor').map((t) => { const cost = num(t.contractorCost); const rev = num(t.netSales !== undefined ? t.netSales : t.sellingPrice); return { trip: t, revenue: rev, cost, margin: rev === null || cost === null ? null : round2(rev - cost), marginPct: rev && cost !== null ? round2(((rev - cost) / rev) * 100) : null, contractor: t.contractorName || '', paid: !!t.contractorPaidAt }; });
    const rev = sum(rows, 'revenue'), cost = sum(rows, 'cost');
    return { rows, revenue: rev, cost, margin: round2(rev - cost), marginPct: rev ? round2(((rev - cost) / rev) * 100) : null, byContractor: lostSalesSummary([], () => '') && (() => { const m = new Map(); for (const r of rows) { const k = r.contractor || '(unassigned)'; const x = m.get(k) || { key: k, trips: 0, revenue: 0, cost: 0 }; x.trips++; x.revenue = round2(x.revenue + (r.revenue || 0)); x.cost = round2(x.cost + (r.cost || 0)); m.set(k, x); } return [...m.values()].map((x) => Object.assign(x, { margin: round2(x.revenue - x.cost) })).sort((a, b) => b.margin - a.margin); })() };
  }

  // ------------------------------------------------------------- assistant
  const planned = (ctx) => (ctx.allocations || []).filter((a) => !['Cancelled', 'Completed'].includes(a.status));
  const allocCalc = (a, ctx) => dispatchCalc({ plate: a.plate, loadingFrom: a.loadingFrom, loadingTo: a.destination, routeId: a.routeId }, ctx);
  const money = (n) => '₦' + (Number(n) || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
  const litres = (n) => (Number(n) || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 }) + ' L';
  /** Management questions answered from live records. Returns { title, answer, rows, columns } or null when not understood. */
  function assistant(question, ctx) {
    const q = norm(question); const today = ctx.today || E.todayISO(); const diesel = ctx.dieselreqs || []; const roads = ctx.roadslips || [];
    const stateIn = (s) => G.STATE_NAMES.find((st) => new RegExp('\\b' + norm(st) + '\\b').test(s)) || (G.standardize(s.replace(/.*\b(?:to|for)\b/, ''), ctx.locationMaster).state || '');
    const upcoming = (days) => planned(ctx).filter((a) => a.plannedLoadingDate && a.plannedLoadingDate >= today && a.plannedLoadingDate <= P.addDays(today, days));
    if (/awaiting diesel|waiting for diesel|not yet issued diesel|awaiting dispatch/.test(q)) {
      const rows = diesel.filter((d) => slipStatus(d) === 'Approved').map((d) => ({ request: d.number, plate: d.plate, client: d.client, route: d.routeName, approvedDiesel: num(d.approvedQty) || 0, status: slipStatus(d) }));
      const awaitingApproval = diesel.filter((d) => slipStatus(d) === 'Awaiting Approval').length;
      return { title: 'Trips awaiting diesel', answer: `${rows.length} approved diesel request${rows.length === 1 ? '' : 's'} still waiting for issue (${litres(rows.reduce((s, r) => s + r.approvedDiesel, 0))}); ${awaitingApproval} more waiting for approval.`, columns: ['request', 'plate', 'client', 'route', 'approvedDiesel', 'status'], rows };
    }
    if (/diesel/.test(q) && /tomorrow/.test(q)) { const tomorrow = P.addDays(today, 1); const rows = planned(ctx).filter((a) => a.plannedLoadingDate === tomorrow).map((a) => { const c = allocCalc(a, ctx); return { allocation: a.id, plate: a.plate, client: a.client, route: `${a.loadingFrom} → ${a.destination}`, category: c.category, totalKm: c.distance.totalKm, diesel: c.diesel }; }); const tot = rows.reduce((s, r) => s + (r.diesel || 0), 0); const miss = rows.filter((r) => r.diesel === null).length; return { title: `Diesel required for ${tomorrow}`, answer: `${rows.length} planned trip${rows.length === 1 ? '' : 's'} tomorrow need ${litres(tot)}${miss ? ` (${miss} without an approved distance, not included)` : ''}.`, columns: ['allocation', 'plate', 'client', 'route', 'category', 'totalKm', 'diesel'], rows }; }
    if (/road expense/.test(q) && /(seven|7)\s*days|week/.test(q)) { const rows = upcoming(7).map((a) => { const c = allocCalc(a, ctx); return { allocation: a.id, date: a.plannedLoadingDate, plate: a.plate, client: a.client, route: `${a.loadingFrom} → ${a.destination}`, totalKm: c.distance.totalKm, road: c.road }; }); const tot = rows.reduce((s, r) => s + (r.road || 0), 0); return { title: 'Road expenses for the next 7 days', answer: `${rows.length} planned trip${rows.length === 1 ? '' : 's'} in the next seven days need ${money(tot)} in road expenses at ₦${setupOf(ctx.planning).roadRatePerKm}/km.`, columns: ['allocation', 'date', 'plate', 'client', 'route', 'totalKm', 'road'], rows }; }
    if (/route/.test(q) && /most diesel|consume|consumption/.test(q)) { const map = new Map(); for (const d of diesel) { const k = d.routeName || `${d.originState} → ${d.destState}`; const m = map.get(k) || { route: k, requests: 0, approvedDiesel: 0, dieselIssued: 0 }; const t = slipTotals(d); m.requests++; m.approvedDiesel = round2(m.approvedDiesel + t.approved); m.dieselIssued = round2(m.dieselIssued + t.issued); map.set(k, m); } const rows = [...map.values()].sort((a, b) => b.dieselIssued - a.dieselIssued || b.approvedDiesel - a.approvedDiesel); return { title: 'Diesel by route', answer: rows.length ? `${rows[0].route} consumes the most diesel (${litres(rows[0].dieselIssued || rows[0].approvedDiesel)} across ${rows[0].requests} request${rows[0].requests === 1 ? '' : 's'}).` : 'No diesel requests yet.', columns: ['route', 'requests', 'approvedDiesel', 'dieselIssued'], rows }; }
    if (/above|exceed|over/.test(q) && /diesel|allowance/.test(q)) { const rows = diesel.map((d) => ({ d, t: slipTotals(d) })).filter((x) => x.t.issued > x.t.approved + 0.005).map((x) => ({ request: x.d.number, plate: x.d.plate, client: x.d.client, approvedDiesel: x.t.approved, dieselIssued: x.t.issued, variance: round2(x.t.issued - x.t.approved) })); return { title: 'Trucks issued diesel above the approved allowance', answer: rows.length ? `${rows.length} diesel request${rows.length === 1 ? '' : 's'} issued more than approved.` : 'No truck has received diesel above its approved allowance.', columns: ['request', 'plate', 'client', 'approvedDiesel', 'dieselIssued', 'variance'], rows }; }
    if (/variance/.test(q)) { const rows = diesel.map((d) => ({ d, t: slipTotals(d) })).filter((x) => x.t.issued > 0).map((x) => ({ request: x.d.number, plate: x.d.plate, route: x.d.routeName, approvedDiesel: x.t.approved, dieselIssued: x.t.issued, variance: round2(x.t.issued - x.t.approved), variancePct: x.t.approved ? round2(((x.t.issued - x.t.approved) / x.t.approved) * 100) : null })).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)).slice(0, 15); return { title: 'Highest diesel variance', answer: rows.length ? `${rows[0].request} (${rows[0].plate}) has the largest variance: ${rows[0].variance > 0 ? '+' : ''}${rows[0].variance} L against approved.` : 'No diesel has been issued yet.', columns: ['request', 'plate', 'route', 'approvedDiesel', 'dieselIssued', 'variance', 'variancePct'], rows }; }
    if (/diesel/.test(q) && /planned|all/.test(q)) { const st = stateIn(q); const rows = planned(ctx).map((a) => ({ a, c: allocCalc(a, ctx) })).filter((x) => !st || x.c.destState === st).map((x) => ({ allocation: x.a.id, date: x.a.plannedLoadingDate, plate: x.a.plate, client: x.a.client, destination: x.a.destination, state: x.c.destState, category: x.c.category, totalKm: x.c.distance.totalKm, diesel: x.c.diesel })); const tot = rows.reduce((s, r) => s + (r.diesel || 0), 0); return { title: `Diesel for planned ${st || ''} trips`, answer: `${rows.length} planned trip${rows.length === 1 ? '' : 's'}${st ? ' to ' + st : ''} need ${litres(tot)} in total.`, columns: ['allocation', 'date', 'plate', 'client', 'destination', 'state', 'category', 'totalKm', 'diesel'], rows }; }
    if (/available/.test(q) && /not (allocated|planned)|unallocated|unplanned/.test(q)) { const k = P.fleetKpis(ctx); const rows = k.statuses.filter((x) => x.st.category === P.AVAILABILITY_CATEGORIES[0]).map((x) => ({ plate: x.truck.plate, body: [x.truck.bodyType, x.truck.tonnage].filter(Boolean).join(' '), location: x.truck.currentLocation || x.truck.homeStation, since: (x.truck.statusAt || '').slice(0, 10) })); return { title: 'Available trucks not allocated', answer: `${rows.length} truck${rows.length === 1 ? ' is' : 's are'} available and unplanned.`, columns: ['plate', 'body', 'location', 'since'], rows }; }
    if (/lost sale|shortage|unfulfilled/.test(q)) { const rows = (ctx.requests || []).map((r) => ({ r, c: P.requestCounts(r, ctx.allocations, ctx.trips) })).filter((x) => x.c.outstanding > 0 && !['Cancelled', 'Completed'].includes(P.requestStatus(x.r, x.c, ctx))).map((x) => { const rate = requestRate(x.r, ctx); const ls = lostSales(x.r, x.c, rate.rate); return { request: x.r.id, client: x.r.client, loadingDate: x.r.loadingDate, requested: x.c.requested, allocated: x.c.allocated, outstanding: x.c.outstanding, rate: rate.rate, atRisk: ls.lost, daysLeft: x.r.loadingDate ? P.diffDays(x.r.loadingDate, today) : null }; }).sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)); const tot = rows.reduce((s, r) => s + (r.atRisk || 0), 0); return { title: 'Requests at risk of becoming lost sales', answer: `${rows.length} open request${rows.length === 1 ? '' : 's'} still lack trucks: ${money(tot)} of revenue at risk.`, columns: ['request', 'client', 'loadingDate', 'daysLeft', 'requested', 'allocated', 'outstanding', 'rate', 'atRisk'], rows }; }
    if (/road/.test(q) && /(pending|unpaid|not paid|awaiting)/.test(q)) { const rows = roads.filter((d) => ['Approved', 'Partly Issued'].includes(slipStatus(d))).map((d) => ({ slip: d.number, plate: d.plate, client: d.client, approved: slipTotals(d).approved, paid: slipTotals(d).issued, status: slipStatus(d) })); return { title: 'Road expense slips pending payment', answer: `${rows.length} approved slip${rows.length === 1 ? '' : 's'} not yet fully paid (${money(rows.reduce((s, r) => s + r.approved - r.paid, 0))} outstanding).`, columns: ['slip', 'plate', 'client', 'approved', 'paid', 'status'], rows }; }
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
    for (const d of ctx.dieselreqs || []) {
      const initial = (d.issues || []).filter((x) => x.type === 'initial'); if (initial.length > 1) out.push({ kind: 'Duplicate diesel issue', severity: 'bad', message: `${d.number} has ${initial.length} initial diesel issues`, ref: d.number });
      const refs = new Map(); for (const x of d.issues || []) if (x.ref) { refs.set(x.ref, (refs.get(x.ref) || 0) + 1); } for (const [ref, n] of refs) if (n > 1) out.push({ kind: 'Duplicate diesel voucher', severity: 'bad', message: `${d.number}: reference ${ref} used ${n} times`, ref: d.number });
      const t = slipTotals(d); if (t.issued > t.approved + 0.005) out.push({ kind: 'Diesel above approved', severity: 'bad', message: `${d.number} (${d.plate}): ${t.issued} L issued vs ${t.approved} L approved`, ref: d.number });
      if (!d.distanceVerified && slipStatus(d) !== 'Rejected') out.push({ kind: 'Missing approved distance', severity: 'warn', message: `${d.number} (${d.routeName || d.originState + ' → ' + d.destState}) uses an unapproved distance`, ref: d.number });
    }
    const byTrip = new Map(); for (const d of ctx.dieselreqs || []) { if (slipStatus(d) === 'Rejected') continue; byTrip.set(d.tripLogId, (byTrip.get(d.tripLogId) || 0) + 1); } for (const [tid, n] of byTrip) if (n > 1) out.push({ kind: 'Duplicate diesel request', severity: 'bad', message: `Trip ${tid} has ${n} live diesel request forms`, ref: tid });
    for (const a of planned(ctx)) { const c = allocCalc(a, ctx); if (c.distance.source === 'missing') out.push({ kind: 'Missing approved distance', severity: 'warn', message: `Allocation ${a.id} ${a.loadingFrom} → ${a.destination}: no route distance`, ref: a.id }); }
    const ids = new Map(); for (const t of ctx.trips || []) { const id = norm(t.journeyPlanId); if (!id) continue; ids.set(id, (ids.get(id) || 0) + 1); } for (const [id, n] of ids) if (n > 1) out.push({ kind: 'Duplicate Trip ID', severity: 'bad', message: `Trip ID ${id.toUpperCase()} appears on ${n} trips`, ref: id });
    return out;
  }

  // --------------------------------------------------------------- dashboards
  /** Dispatch & diesel planning dashboard from the two slip collections. */
  function dashboard(ctx) {
    const today = ctx.today || E.todayISO(); const diesel = ctx.dieselreqs || []; const roads = ctx.roadslips || [];
    const plannedAllocs = planned(ctx); const calcs = plannedAllocs.map((a) => ({ a, c: allocCalc(a, ctx) }));
    const dt = diesel.map((d) => ({ d, t: slipTotals(d), s: slipStatus(d) })); const rt = roads.map((d) => ({ d, t: slipTotals(d), s: slipStatus(d) }));
    const k = P.fleetKpis(ctx);
    const byCat = {}; const byRoute = {}; const byTruck = [];
    for (const { d, t } of dt) { const cat = d.category || 'Other'; byCat[cat] = round2((byCat[cat] || 0) + (t.issued || t.approved)); const rk = d.routeName || `${d.originState} → ${d.destState}`; byRoute[rk] = round2((byRoute[rk] || 0) + (t.issued || t.approved)); if (t.issued > 0) byTruck.push({ plate: d.plate, request: d.number, approved: t.approved, issued: t.issued, variance: round2(t.issued - t.approved) }); }
    return {
      plannedTrips: plannedAllocs.length, awaitingApproval: dt.filter((x) => x.s === 'Awaiting Approval').length + rt.filter((x) => ['Awaiting Approval', 'Awaiting Finance'].includes(x.s)).length, dieselAwaitingApproval: dt.filter((x) => x.s === 'Awaiting Approval').length, approvedAwaitingDiesel: dt.filter((x) => x.s === 'Approved').length, roadPendingPayment: rt.filter((x) => ['Approved', 'Partly Issued'].includes(x.s)).length,
      dieselRequiredPlanned: round2(calcs.reduce((s, x) => s + (x.c.diesel || 0), 0)), dieselIssued: round2(dt.reduce((s, x) => s + x.t.issued, 0)), roadRequiredPlanned: round2(calcs.reduce((s, x) => s + (x.c.road || 0), 0)), roadPaid: round2(rt.reduce((s, x) => s + x.t.issued, 0)),
      supplementaryRequests: diesel.reduce((s, d) => s + (d.supplementary || []).length, 0) + roads.reduce((s, d) => s + (d.supplementary || []).length, 0), supplementaryPending: diesel.reduce((s, d) => s + (d.supplementary || []).filter((x) => x.status === 'Pending').length, 0) + roads.reduce((s, d) => s + (d.supplementary || []).filter((x) => x.status === 'Pending').length, 0),
      extrasPending: (ctx.extraexpenses || []).filter((x) => x.status === 'Pending Approval').length, extrasApproved: (ctx.extraexpenses || []).filter((x) => x.status === 'Approved').length,
      varianceByTruck: byTruck.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)), byCategory: Object.entries(byCat).map(([kk, v]) => ({ category: kk, diesel: v })), byRoute: Object.entries(byRoute).map(([kk, v]) => ({ route: kk, diesel: v })).sort((a, b) => b.diesel - a.diesel).slice(0, 12),
      availableNotPlanned: k.availableUnplanned, confirmedLostSales: round2((ctx.lostsales || []).filter((l) => l.kind === 'Confirmed lost sale').reduce((s, l) => s + (num(l.estimatedLost) || 0), 0)), plannedMissingDistance: calcs.filter((x) => x.c.distance.source === 'missing').length, today,
    };
  }
  /** Management dashboard KPIs for the end-to-end workflow (brief §12). */
  function managementKpis(ctx) {
    const trips = ctx.trips || []; const invoices = ctx.invoices || []; const byInv = new Map(invoices.map((i) => [i.id, i]));
    const reqs = (ctx.requests || []).map((r) => { const c = P.requestCounts(r, ctx.allocations, trips); return { r, c, s: P.requestStatus(r, c, ctx) }; });
    const open = reqs.filter((x) => !['Completed', 'Cancelled'].includes(x.s));
    const dash = dashboard(ctx); const tat = P.tatDashboard(trips.filter((t) => E.opsStatus(t) === 'Open'), ctx.routes, ctx.now);
    const ready = trips.map((t) => ({ t, r: E.billingReadiness(t, { setup: ctx.setup, client: (ctx.clients || []).find((c) => norm(c.name) === norm(t.client)) }) }));
    const live = (t) => E.invoiceAutoStatus(t, t.invoiceId ? byInv.get(t.invoiceId) : null);
    const internal = trips.filter((t) => t.serviceType !== '3rd Party Contractor' && !t.internalClient && t.invoiceStatus !== 'Internal Client'); const tpl = tplProfitability(trips);
    return {
      openRequests: open.length, awaitingRouteMapping: reqs.filter((x) => x.s === 'Pending Route Mapping').length, awaitingPlanning: reqs.filter((x) => x.s === 'Awaiting Planning').length, awaitingAllocation: reqs.filter((x) => ['Plan Approved', 'Partially Allocated'].includes(x.s)).length, cancellationRequested: reqs.filter((x) => x.s === 'Cancellation Requested').length,
      availableUnplanned: dash.availableNotPlanned, activeTrips: trips.filter((t) => E.opsStatus(t) === 'Open' && (t.allocationId || t.serviceType === '3rd Party Contractor')).length, exceedingTat: tat.overdue,
      dieselPendingApproval: dash.dieselAwaitingApproval, dieselApprovedNotIssued: dash.approvedAwaitingDiesel, roadPendingPayment: dash.roadPendingPayment, extrasPending: dash.extrasPending,
      readyForInvoicing: ready.filter((x) => x.r.category === 'ready').length, awaitingPod: trips.filter((t) => t.podStatus !== 'POD Verified' && !t.invoiceId && !t.internalClient && (t.dateDelivered || E.opsStatus(t) === 'Closed')).length, awaitingWaybill: trips.filter((t) => t.waybillStatus === 'Awaiting Waybill' && !t.invoiceId && !t.internalClient && (t.dateDelivered || E.opsStatus(t) === 'Closed')).length,
      draftInvoices: invoices.filter((i) => i.status === 'Draft').length, issuedNotSent: invoices.filter((i) => i.issuedAt && !i.sentAt && i.status !== 'Void' && i.type !== 'credit').length,
      confirmedLostSales: dash.confirmedLostSales, atRiskSales: round2(open.filter((x) => x.c.outstanding > 0).reduce((s, x) => { const rate = requestRate(x.r, ctx); return s + (lostSales(x.r, x.c, rate.rate).lost || 0); }, 0)),
      internalRevenue: round2(internal.reduce((s, t) => s + (num(t.netSales !== undefined ? t.netSales : t.sellingPrice) || 0), 0)), tplRevenue: tpl.revenue, tplCost: tpl.cost, tplMargin: tpl.margin, tplMarginPct: tpl.marginPct, tat,
      notInvoicedCompleted: trips.filter((t) => live(t) === 'Not Invoiced' && (t.dateDelivered || E.opsStatus(t) === 'Closed')).length,
    };
  }

  return { CATEGORIES, DEFAULT_DISPATCH, SLIP_STATUSES, SLIP_KINDS, EXPENSE_CATEGORIES, EXPENSE_STATUSES, PAYMENT_METHODS, LOST_KINDS, CANCEL_REASONS, TPL_ASSIGNMENT, QUOTE_STATUSES, QUESTIONS, setupOf, vehicleCategory, consumptionRate, distanceId, resolveDistance, dispatchCalc, nextSlipNumber, slipTotals, slipStatus, slipIssueError, slipFromCalc, tripExpenseControl, nextExpenseId, expenseRequestError, expenseTransitionError, lostSalesKindFor, requestRate, lostSales, lostSalesSummary, tplMargin, tplProfitability, assistant, anomalies, dashboard, managementKpis };
});
