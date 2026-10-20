/* Commercial audit, client rate control and revenue optimisation (Audit & Control brief).
 * Pure functions shared by the browser views, the Node server and the tests:
 *   - comparison groups (route × period × vehicle class) following the Client Rate Comparison 2026 workbook,
 *     best comparable client average, highest observed rate, rate level, estimated rate opportunity;
 *   - client ranking with commercial verdicts (rate gap is kept apart from an actual loss);
 *   - the three independent prices of every trip (approved client rate / actual selling price / calculated costing) and
 *     the audit status, severity and exception requirement; the same check for a CRM request before allocation;
 *   - truck-days (planned from the Route Master or the Turnaround Table, actual from tracked milestones), revenue and
 *     contribution per truck-day, trips per truck per month, truck requirement and utilisation;
 *   - rate-exception workflow rules (raise / review / approve by different people, immutable history, never touches
 *     the Client Rate Card), audit register rules, recommendations with their supporting calculation, the assistant,
 *     and the reconciliation of the web results against the frozen workbook baseline. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./planning.js'), require('./dispatch.js'), require('./finance.js'), require('./geo.js'));
  else { root.HB = root.HB || {}; root.HB.audit = factory(root.HB.engine, root.HB.planning, root.HB.dispatch, root.HB.finance, root.HB.geo); }
})(typeof self !== 'undefined' ? self : this, function (E, P, D, F, G) {
  'use strict';
  const num = E.num, round2 = E.round2, norm = E.norm, clean = E.clean;
  const r0 = (x) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Math.round(Number(x)));
  const pct = (a, b) => (b ? round2((a / b) * 100) : null);
  const title = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

  const DEFAULT_POLICY = {
    comparison: { period: 'quarter', vehicleGrouping: 'workbook', minTripsForBenchmark: 3, minClientsPerGroup: 2, excludeExceptional: true, scopeFrom: '2026-01-02', scopeTo: '' },
    thresholds: { belowApprovedTolerancePct: 0.5, materialBelowBenchmarkPct: 10, thinBenchmarkTrips: 3, lowMarginPct: 5 },
    blocking: { invoice: { belowApproved: true, belowCost: true, missingRate: false, override: true }, allocation: { belowCost: true, missingRate: false, belowBenchmark: false } },
    approvalMatrix: { belowApproved: { review: ['operations'], approve: ['management', 'finance'] }, belowCost: { review: ['operations'], approve: ['management'] }, missingRate: { review: ['operations'], approve: ['management', 'finance'] }, override: { review: ['operations'], approve: ['management', 'finance'] }, exceptional: { review: ['operations'], approve: ['management'] } },
    truckDays: { operatingDaysPerMonth: 26, defaultOneLegDays: 2, basis: 'planned' },
  };
  function policyOf(ctx) {
    const p = (ctx && ctx.auditpolicy) || {}; const out = {};
    for (const k of Object.keys(DEFAULT_POLICY)) out[k] = Object.assign({}, DEFAULT_POLICY[k], p[k] || {});
    out.blocking = { invoice: Object.assign({}, DEFAULT_POLICY.blocking.invoice, (p.blocking || {}).invoice || {}), allocation: Object.assign({}, DEFAULT_POLICY.blocking.allocation, (p.blocking || {}).allocation || {}) };
    out.approvalMatrix = Object.assign({}, DEFAULT_POLICY.approvalMatrix, p.approvalMatrix || {});
    return out;
  }

  // ------------------------------------------------------------- comparable route (loading area → destination)
  const LOADING_AREAS = [
    [/karame|kamameh|berger|gbagada|\bogba\b|apapa|amuwo|mile ?-? ?2|isolo|ikorodu|kirik?iri|ikeja|isheri|^vi$|ikotun|oshodi|ojota|ibeju|lekki|ajah|^lagos$|nbl lagos|idimu|^nbl ?-? ?depot|festac|alaba|ojo\b|agege|ipaja|ikotun|surulere|ilupeju|mushin|okota|orile|iganmu|tincan|ijora/i, 'Lagos'],
    [/ibadan|^nbl$|^nbl ?-? ?ibadan|apata/i, 'Ibadan'], [/ilesa|inbev/i, 'Ilesa'], [/nas+ar+awa|lafia/i, 'Nasarawa'], [/^ph[cg]?$|port ?harcourt/i, 'Port Harcourt'],
    [/\bama\b/i, 'Ama'], [/kudena?da/i, 'Kaduna (Kudenda)'], [/ijebu/i, 'Ijebu Ode'], [/\bota\b/i, 'Ota'], [/\baba\b/i, 'Aba'], [/^n[gb][gb]\w*$/i, (s) => title(s)], [/kano/i, 'Kano'], [/abuja/i, 'Abuja'], [/kaduna/i, 'Kaduna'], [/ogere/i, 'Ogere'], [/gwagwalada/i, 'Gwagwalada'], [/agbara/i, 'Agbara'], [/akure/i, 'Akure'], [/ilorin/i, 'Ilorin'], [/yola/i, 'Yola'], [/makurdi/i, 'Makurdi'], [/\bjos\b/i, 'Jos'], [/jalingo/i, 'Jalingo'], [/okigwe/i, 'Okigwe'], [/\bore\b/i, 'Ore'], [/otukp/i, 'Otukpa'],
  ];
  function loadingArea(raw) {
    const s = String(raw || '').trim(); if (!s) return '';
    for (const [re, name] of LOADING_AREAS) if (re.test(s)) return typeof name === 'function' ? name(s) : name;
    return title(s.replace(/\b(depot|brewery|dep|plant)\b/gi, '').replace(/[-–]+/g, ' ').replace(/\s+/g, ' ').trim());
  }
  const DEST_ALIASES = { PHC: 'Port Harcourt', PHG: 'Port Harcourt', PH: 'Port Harcourt', 'PORT HARCOURT': 'Port Harcourt', 'PORT-HARCOURT': 'Port Harcourt', 'BENIN CITY': 'Benin', BENIN: 'Benin', FCT: 'Abuja', 'ABUJA FCT': 'Abuja', 'IBADAN OYO': 'Ibadan', 'ILE IFE': 'Ile-Ife', 'ILE-IFE': 'Ile-Ife', 'ANYIGBA': 'Anyigba', AYANGBA: 'Anyigba', AYINGBA: 'Anyigba', OSHOGBO: 'Osogbo', OSOGBO: 'Osogbo', 'IJEBU ODE': 'Ijebu Ode', 'IJEBU-ODE': 'Ijebu Ode', JOS: 'Jos', ABA: 'Aba', VI: 'VI', 'VICTORIA ISLAND': 'VI', KUDENDA: 'Kaduna (Kudenda)', 'KADUNA (KUDENDA)': 'Kaduna (Kudenda)' };
  function destName(raw) {
    let s = String(raw || '').trim().replace(/\s+/g, ' '); if (!s) return '';
    const up = s.toUpperCase().replace(/\.$/, '');
    if (DEST_ALIASES[up]) return DEST_ALIASES[up];
    // "Afikpo-Ebonyi", "Abuja (FCT)", "Kano, Kano State": drop a trailing state or qualifier
    const parts = up.split(/\s*[-–,/(]\s*/).map((x) => x.replace(/[)]/g, '').trim()).filter(Boolean);
    if (parts.length > 1) { const states = (G && G.STATE_NAMES) || []; const first = parts[0]; const rest = parts.slice(1); if (rest.every((p) => states.some((st) => norm(st) === norm(p) || norm(p) === norm(st) + ' state') || /STATE|CITY|TOWN|FCT/.test(p))) s = first; }
    const k = s.toUpperCase().replace(/\b(CITY|TOWN)\b/g, '').trim();
    return DEST_ALIASES[k] || title(k);
  }
  function compRoute(trip) { const area = loadingArea(trip.loadingFrom); const dest = destName(trip.loadingTo || trip.destination); return { area, dest, key: area && dest ? `${area} → ${dest}` : '' }; }
  function periodOf(dateISO, period) {
    const d = String(dateISO || '').slice(0, 10); if (!d) return ''; const y = d.slice(0, 4), m = Number(d.slice(5, 7));
    if (period === 'month') return d.slice(0, 7); if (period === 'year') return y; return `${y}-Q${Math.ceil(m / 3)}`;
  }
  const periodLabel = (p) => (/-Q\d$/.test(p) ? `${p.slice(5)} ${p.slice(0, 4)}` : /^\d{4}-\d{2}$/.test(p) ? p : p);
  /** Comparison class: the workbook treats haulage and flat trucks as one and excludes closed-body / Hiab; the strict mode separates tonnage classes. */
  function vehicleClass(trip, policy, assets) {
    const vt = norm(trip.vehicleType); const grouping = (policy && policy.comparison.vehicleGrouping) || 'workbook';
    const haul = vt === 'haulage', flat = /flat/.test(vt), hiab = /hiab/.test(vt), closed = /closed|canter|van/.test(vt);
    if (grouping === 'workbook') return haul || flat ? 'Haulage & Flat' : null;
    const asset = E.assetFor(trip.plate, assets || []); const ton = clean((asset && asset.tonnage) || E.normContract(trip.contractType) || '');
    if (haul) return ton ? `Haulage ${/T$/i.test(ton) ? ton : ton + 'T'}` : 'Haulage (tonnage not recorded)';
    if (flat) return 'Flatbed'; if (hiab) return 'Hiab'; if (closed) return 'Closed Body'; return vt ? title(vt) : null;
  }
  function inScope(trip, policy, opts) {
    opts = opts || {}; const d = String(trip.dateDispatched || '').slice(0, 10); if (!d) return false;
    const from = opts.from || policy.comparison.scopeFrom || ''; const to = opts.to || policy.comparison.scopeTo || '';
    if (from && d < from) return false; if (to && d > to) return false;
    if (policy.comparison.excludeExceptional && trip.commercialExceptional) return false;
    if (!(num(trip.netSales) > 0)) return false;
    return true;
  }

  // ------------------------------------------------------------- comparison groups
  /** Groups in-scope trips by comparable route × period × vehicle class and computes the benchmark of every group.
   *  Returns { groups, byTrip, headline, scope }. */
  function comparison(trips, ctx, opts) {
    opts = opts || {}; const policy = policyOf(ctx); const period = opts.period || policy.comparison.period; const assets = ctx.assets || [];
    const minClients = policy.comparison.minClientsPerGroup || 2, thin = policy.thresholds.thinBenchmarkTrips || 3;
    const groups = new Map(); let achieved = 0, inScopeTrips = 0;
    for (const t of trips || []) {
      if (!inScope(t, policy, opts)) continue; const vc = vehicleClass(t, policy, assets); if (!vc) continue;
      const rt = compRoute(t); if (!rt.key) continue; inScopeTrips++; achieved += num(t.netSales);
      const per = periodOf(t.dateDispatched, period); const key = `${rt.key}|${per}|${vc}`;
      let g = groups.get(key); if (!g) { g = { key, route: rt.key, area: rt.area, dest: rt.dest, period: per, periodLabel: periodLabel(per), vehicleClass: vc, clients: new Map(), trips: [] }; groups.set(key, g); }
      const ck = E.clientKey(t.client, ctx.clients) || norm(t.client); let c = g.clients.get(ck); if (!c) { c = { key: ck, client: t.client, trips: [], revenue: 0 }; g.clients.set(ck, c); }
      c.trips.push(t); c.revenue += num(t.netSales); g.trips.push(t);
    }
    const byTrip = new Map(); let oppBestAvg = 0, oppHighest = 0, comparableTrips = 0;
    for (const g of groups.values()) {
      g.clientStats = [...g.clients.values()].map((c) => ({ key: c.key, client: c.client, trips: c.trips.length, tripList: c.trips, revenue: round2(c.revenue), avg: round2(c.revenue / c.trips.length), min: round2(Math.min(...c.trips.map((t) => num(t.netSales)))), max: round2(Math.max(...c.trips.map((t) => num(t.netSales)))), approvedAvg: avgOf(c.trips.map((t) => num(t.agreedPrice)).filter((x) => x !== null)) })).sort((a, b) => b.avg - a.avg);
      g.comparable = g.clientStats.length >= minClients; g.best = g.clientStats[0]; g.bestAvg = g.best ? g.best.avg : null; g.bestClient = g.best ? g.best.client : ''; g.bestClientTrips = g.best ? g.best.trips : 0;
      const hi = g.trips.reduce((m, t) => (num(t.netSales) > (m ? num(m.netSales) : -1) ? t : m), null); g.highest = hi ? round2(num(hi.netSales)) : null; g.highestClient = hi ? hi.client : ''; g.highestTripId = hi ? hi.id : '';
      g.thin = g.comparable && g.bestClientTrips < thin; g.tripsTotal = g.trips.length;
      if (!g.comparable) continue;
      for (const c of g.clientStats) { c.rateLevel = pct(c.avg, g.bestAvg); c.gap = round2(Math.max(0, g.bestAvg - c.avg)); c.opportunity = round2(c.gap * c.trips); c.gapHighest = round2(Math.max(0, g.highest - c.avg)); c.opportunityHighest = round2(c.gapHighest * c.trips); oppBestAvg += c.opportunity; oppHighest += c.opportunityHighest; comparableTrips += c.trips; for (const t of c.tripList) byTrip.set(t.id, { group: g, clientAvg: c.avg, bestAvg: g.bestAvg, bestClient: g.bestClient, highest: g.highest, rateLevel: c.rateLevel, gap: c.gap, gapHighest: c.gapHighest, thin: g.thin, bestClientTrips: g.bestClientTrips }); }
    }
    const list = [...groups.values()].sort((a, b) => b.tripsTotal - a.tripsTotal);
    return { policy, period, groups: list, comparableGroups: list.filter((g) => g.comparable), byTrip, scope: { from: opts.from || policy.comparison.scopeFrom || '', to: opts.to || policy.comparison.scopeTo || '', trips: inScopeTrips, comparableTrips }, headline: { achieved: round2(achieved), atBestClientAvg: round2(achieved + oppBestAvg), opportunityBestClientAvg: round2(oppBestAvg), atHighest: round2(achieved + oppHighest), opportunityHighest: round2(oppHighest), opportunityPct: pct(oppBestAvg, achieved), opportunityHighestPct: pct(oppHighest, achieved) } };
  }
  function avgOf(list) { return list.length ? round2(list.reduce((s, x) => s + x, 0) / list.length) : null; }

  const VERDICTS = ['Strong Rate', 'Competitive', 'Below Comparable Peers', 'Below Cost', 'Insufficient Comparison Data'];
  function workbookVerdict(level) { return level === null ? '—' : level >= 99.9 ? 'At top rate' : level >= 95 ? 'Close to top' : level >= 80 ? 'Below peers' : 'Well below peers'; }
  /** Client ranking by comparable rate competitiveness. Rate gap ≠ loss: the margin column comes from the costing engine. */
  function clientRanking(comp, trips, ctx) {
    const policy = comp.policy; const material = policy.thresholds.materialBelowBenchmarkPct; const rows = new Map();
    const scoped = (trips || []).filter((t) => inScope(t, policy, comp.scope) && vehicleClass(t, policy, ctx.assets));
    for (const t of scoped) { const ck = E.clientKey(t.client, ctx.clients) || norm(t.client); let r = rows.get(ck); if (!r) { r = { key: ck, client: t.client, totalTrips: 0, revenue: 0, tripsCompared: 0, revenueCompared: 0, benchRevenue: 0, opportunity: 0, opportunityHighest: 0, routes: new Map(), truckDays: 0, costed: 0, marginSum: 0, costSum: 0, negativeMarginTrips: 0 }; rows.set(ck, r); }
      r.totalTrips++; r.revenue += num(t.netSales);
      const b = comp.byTrip.get(t.id); if (b) { r.tripsCompared++; r.revenueCompared += num(t.netSales); r.benchRevenue += b.bestAvg; r.opportunity += b.gap; r.opportunityHighest += b.gapHighest; const rr = r.routes.get(b.group.route) || { route: b.group.route, trips: 0, opportunity: 0 }; rr.trips++; rr.opportunity += b.gap; r.routes.set(b.group.route, rr); }
      const td = truckDays(t, ctx); if (td.planned) r.truckDays += td.planned;
      const c = costingOf(t, ctx); if (c && c.available && c.total !== null) { r.costed++; r.costSum += c.total; r.marginSum += num(t.netSales) - c.total; if (num(t.netSales) - c.total < 0) r.negativeMarginTrips++; }
    }
    return [...rows.values()].map((r) => {
      const level = r.tripsCompared ? pct(r.revenueCompared, r.benchRevenue) : null; const marginPct = r.costed ? pct(r.marginSum, r.marginSum + r.costSum) : null;
      let verdict = 'Insufficient Comparison Data';
      if (r.tripsCompared >= (policy.thresholds.thinBenchmarkTrips || 3)) verdict = marginPct !== null && marginPct < 0 ? 'Below Cost' : level >= 99.5 ? 'Strong Rate' : level >= 100 - material ? 'Competitive' : 'Below Comparable Peers';
      else if (marginPct !== null && marginPct < 0) verdict = 'Below Cost';
      const routesSorted = [...r.routes.values()].sort((a, b) => b.opportunity - a.opportunity);
      return { client: r.client, comparableRoutes: r.routes.size, routesWithGaps: routesSorted.filter((x) => x.opportunity > 0).slice(0, 3).map((x) => x.route).join(', ') || '—', totalTrips: r.totalTrips, tripsCompared: r.tripsCompared, revenue: round2(r.revenue), revenueCompared: round2(r.revenueCompared), avgRate: round2(r.revenue / r.totalTrips), bestComparableRate: r.tripsCompared ? round2(r.benchRevenue / r.tripsCompared) : null, rateLevel: level, workbookVerdict: workbookVerdict(level), opportunity: round2(r.opportunity), opportunityHighest: round2(r.opportunityHighest), expectedMarginPct: marginPct, costedTrips: r.costed, negativeMarginTrips: r.negativeMarginTrips, revenuePerTruckDay: r.truckDays ? round2(r.revenue / r.truckDays) : null, truckDays: round2(r.truckDays), verdict, lossNote: marginPct === null ? 'No costing available for this client\'s trucks' : marginPct < 0 ? 'Actual operating loss expected on costed trips' : 'Profitable on costed trips: a lower rate is a commercial gap, not a loss' };
    }).sort((a, b) => b.opportunity - a.opportunity || b.revenue - a.revenue).map((r, i) => Object.assign(r, { rank: i + 1 }));
  }
  /** Rate gaps by route: every client on every comparable route / period, against the best-paying client. */
  function routeGaps(comp, ctx, opts) {
    const rows = []; const thin = comp.policy.thresholds.thinBenchmarkTrips;
    for (const g of comp.comparableGroups) for (const c of g.clientStats) {
      if (opts && opts.onlyGaps && !(c.gap > 0)) continue;
      const costs = c.tripList.map((t) => costingOf(t, ctx)).filter((x) => x && x.available && x.total !== null).map((x) => x.total);
      rows.push({ groupKey: g.key, period: g.periodLabel, periodKey: g.period, route: g.route, vehicleClass: g.vehicleClass, client: c.client, trips: c.tripList, tripCount: c.tripList.length, avgRate: c.avg, minRate: c.min, maxRate: c.max, approvedRate: c.approvedAvg, bestClient: g.bestClient, bestClientTrips: g.bestClientTrips, benchmarkRate: g.bestAvg, rateLevel: c.rateLevel, gap: c.gap, opportunity: c.opportunity, highestRate: g.highest, highestClient: g.highestClient, gapHighest: c.gapHighest, opportunityHighest: c.opportunityHighest, thinBenchmark: g.thin || g.bestClientTrips < thin, costEstimate: avgOf(costs), costedTrips: costs.length, isBest: c.client === g.bestClient, flags: [g.thin ? `benchmark rests on ${g.bestClientTrips} trip${g.bestClientTrips === 1 ? '' : 's'}` : '', c.tripList.length < thin ? `only ${c.tripList.length} comparable trip${c.tripList.length === 1 ? '' : 's'}` : ''].filter(Boolean) });
    }
    return rows.sort((a, b) => b.opportunity - a.opportunity);
  }

  // ------------------------------------------------------------- costing / truck-days (cached per trip)
  const costCache = { key: '', map: new Map() };
  function ctxKey(ctx) { return [(ctx.routes || []).length, (ctx.ratecard || []).length, (ctx.assets || []).length, ctx.planning && (ctx.planning.updatedAt || ''), F.dieselPriceOf(ctx.planning)].join('|'); }
  function costingOf(trip, ctx) {
    if (!F || !trip) return null; const k = ctxKey(ctx); if (costCache.key !== k) { costCache.key = k; costCache.map.clear(); }
    const tk = `${trip.id}|${trip.version}|${trip.sellingPrice}|${trip.plate}|${trip.loadingFrom}|${trip.loadingTo}|${trip.contractorCost}`; let c = costCache.map.get(tk);
    if (!c) { try { c = F.tripCosting(trip, ctx); } catch (e) { c = { available: false, reason: e.message, total: null }; } costCache.map.set(tk, c); }
    return c;
  }
  const LAGOS_BAY = /^(lagos|agbara|ota|ogere|ikorodu|sagamu|mowe|ibeju|lekki)$/i, IBADAN_BAY = /^(ibadan|ilesa|ijebu ode|akure|ife|ile-ife|osogbo|oyo|ogbomosho|iseyin)$/i;
  function bayFor(area) { if (LAGOS_BAY.test(area)) return 'LAGOS'; if (IBADAN_BAY.test(area)) return 'IBADAN'; return String(area || '').toUpperCase(); }
  function turnaroundLookup(area, dest, ctx) {
    const tt = (ctx.turnaround && ctx.turnaround.rows) || []; const policy = policyOf(ctx); const def = num(ctx.turnaround && ctx.turnaround.defaultOneLegDays) || policy.truckDays.defaultOneLegDays || 2;
    const D_ = String(dest || '').toUpperCase(), A_ = String(area || '').toUpperCase(), bay = bayFor(area);
    const find = (from, to) => tt.find((r) => norm(r.from) === norm(from) && norm(r.to) === norm(to)) || tt.find((r) => norm(r.from).replace(/[^a-z]/g, '') === norm(from).replace(/[^a-z]/g, '') && norm(r.to) === norm(to));
    let row = find(D_, bay); if (row) return { oneLegDays: row.days, how: 'Exact', key: row.key };
    row = find(A_, D_); if (row) return { oneLegDays: row.days, how: 'Reverse', key: row.key };
    row = find(D_, bay === 'LAGOS' ? 'IBADAN' : 'LAGOS'); if (row) return { oneLegDays: row.days, how: `Nearest bay (${bay === 'LAGOS' ? 'Ibadan' : 'Lagos'})`, key: row.key };
    row = tt.find((r) => norm(r.to) === norm(bay) && (norm(D_).startsWith(norm(r.from)) || norm(r.from).startsWith(norm(D_)))); if (row) return { oneLegDays: row.days, how: 'Similar name', key: row.key };
    return { oneLegDays: def, how: 'Not in table (default)', key: `${D_}>${bay}` };
  }
  /** Truck-days committed to a trip: planned from the approved Route Master turnaround, else the Turnaround Table (2 × one-leg days); actual from tracked milestones. */
  function truckDays(trip, ctx) {
    const c = costingOf(trip, ctx); const route = c && c.km && c.km.route; const rt = compRoute(trip);
    let planned = null, source = '', oneLeg = null;
    if (route && (num(route.tatDays) || num(route.totalDays))) { planned = num(route.tatDays) || num(route.totalDays); source = `Route Master ${route.id} (${planned}-day turnaround)`; oneLeg = round2(planned / 2); }
    else { const tl = turnaroundLookup(rt.area, rt.dest, ctx); oneLeg = tl.oneLegDays; planned = tl.oneLegDays * 2; source = `Turnaround Table ${tl.key} · ${tl.how}`; }
    const tat = P.tatCalc(trip, planned, ctx.now); const actual = tat.totalHours !== null ? round2(tat.totalHours / 24) : null;
    let deliveryDays = null; if (trip.dateDispatched && trip.dateDelivered) deliveryDays = Math.max(0, Math.round((Date.parse(trip.dateDelivered) - Date.parse(trip.dateDispatched)) / 86400000));
    return { planned, actual, oneLegDays: oneLeg, roundTripDays: planned, source, actualSource: actual !== null ? 'tracked milestones' : deliveryDays !== null ? 'delivery date only (return leg not tracked)' : 'not tracked', deliveryDays, variance: actual !== null && planned ? round2(actual - planned) : null };
  }
  function tripsPerTruckPerMonth(roundTripDays, ctx) { const od = num(ctx.turnaround && ctx.turnaround.operatingDaysPerMonth) || policyOf(ctx).truckDays.operatingDaysPerMonth || 26; return Math.max(1, Math.floor(od / Math.max(1, roundTripDays || 1))); }
  /** Revenue and contribution per truck-day by any key (client, route, client × route, truck, LOB). */
  function truckDayStats(trips, ctx, keyFn, opts) {
    opts = opts || {}; const m = new Map(); const od = num(ctx.turnaround && ctx.turnaround.operatingDaysPerMonth) || 26;
    for (const t of trips || []) { if (!(num(t.netSales) > 0) && !opts.includeUnpriced) continue; const k = keyFn(t) || '(unspecified)'; let r = m.get(k); if (!r) { r = { key: k, trips: 0, revenue: 0, plannedDays: 0, actualDays: 0, actualTrips: 0, contribution: 0, contributionDays: 0, costed: 0, months: new Map(), roundTrips: [] }; m.set(k, r); }
      const td = truckDays(t, ctx); const c = costingOf(t, ctx); r.trips++; r.revenue += num(t.netSales) || 0; r.plannedDays += td.planned || 0; r.roundTrips.push(td.planned || 0); if (td.actual !== null) { r.actualDays += td.actual; r.actualTrips++; }
      if (c && c.available && c.total !== null) { const variable = num(c.variable) !== null ? c.variable : c.total; r.contribution += (num(t.netSales) || 0) - variable; r.contributionDays += td.planned || 0; r.costed++; }
      const mo = String(t.dateDispatched || '').slice(0, 7); const mm = r.months.get(mo) || { month: mo, trips: 0, truckUse: 0 }; mm.trips++; mm.truckUse += 1 / tripsPerTruckPerMonth(td.planned, ctx); r.months.set(mo, mm); }
    return [...m.values()].map((r) => { const avgRT = r.trips ? round2(r.plannedDays / r.trips) : null; const months = [...r.months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((x) => Object.assign(x, { trucksNeeded: Math.ceil(x.truckUse - 1e-9) })); return { key: r.key, trips: r.trips, revenue: round2(r.revenue), revenuePerTrip: round2(r.revenue / r.trips), truckDays: round2(r.plannedDays), revenuePerTruckDay: r.plannedDays ? round2(r.revenue / r.plannedDays) : null, contribution: r.costed ? round2(r.contribution) : null, contributionPerTruckDay: r.contributionDays ? round2(r.contribution / r.contributionDays) : null, costedTrips: r.costed, plannedTat: avgRT, actualTat: r.actualTrips ? round2(r.actualDays / r.actualTrips) : null, trackedTrips: r.actualTrips, tripsPerTruckPerMonth: avgRT ? tripsPerTruckPerMonth(avgRT, ctx) : null, months, peakTrucks: months.length ? Math.max(...months.map((x) => x.trucksNeeded)) : 0, avgTrucks: months.length ? round2(months.reduce((s, x) => s + x.truckUse, 0) / months.length) : 0, operatingDays: od }; }).sort((a, b) => (b.revenuePerTruckDay || 0) - (a.revenuePerTruckDay || 0));
  }
  /** Truck requirement per client and month (trucks rotate on their routes; rounded up per client) and fleet utilisation. */
  function truckRequirement(trips, ctx) {
    const byClientRoute = truckDayStats(trips, ctx, (t) => `${t.client}|${compRoute(t).key}`, {}); const clients = new Map(); const months = new Set();
    for (const r of byClientRoute) { const [client] = r.key.split('|'); const c = clients.get(client) || { client, months: new Map(), trips: 0, revenue: 0 }; c.trips += r.trips; c.revenue += r.revenue; for (const m of r.months) { months.add(m.month); const cm = c.months.get(m.month) || { trips: 0, truckUse: 0 }; cm.trips += m.trips; cm.truckUse += m.truckUse; c.months.set(m.month, cm); } clients.set(client, c); }
    const monthList = [...months].sort(); const rows = [...clients.values()].map((c) => { const perMonth = monthList.map((m) => { const x = c.months.get(m); return x ? { month: m, trips: x.trips, truckUse: round2(x.truckUse), trucks: Math.ceil(x.truckUse - 1e-9) } : { month: m, trips: 0, truckUse: 0, trucks: 0 }; }); const active = perMonth.filter((x) => x.trips); return { client: c.client, trips: c.trips, revenue: round2(c.revenue), perMonth, monthsWithTrips: active.length, avgTripsPerMonth: active.length ? round2(c.trips / active.length) : 0, typicalTrucks: active.length ? round2(active.reduce((s, x) => s + x.truckUse, 0) / active.length) : 0, peakTrucks: Math.max(0, ...perMonth.map((x) => x.trucks)) }; }).sort((a, b) => b.trips - a.trips);
    const shared = monthList.map((m) => ({ month: m, trucks: Math.ceil(rows.reduce((s, r) => s + (r.perMonth.find((x) => x.month === m) || {}).truckUse || 0, 0) - 1e-9), perClient: rows.reduce((s, r) => s + ((r.perMonth.find((x) => x.month === m) || {}).trucks || 0), 0), trucksUsed: new Set(trips.filter((t) => String(t.dateDispatched || '').slice(0, 7) === m && t.serviceType !== '3rd Party Contractor' && !/third|3rd/i.test(t.plate)).map((t) => P.plateKey(t.plate))).size }));
    const own = (ctx.assets || []).filter((a) => a.active !== false && /haulage|flat/i.test(a.vehicleType || '') && !/3rd|third/i.test(a.vehicleCategory || '') && !/third/i.test(a.plate || '')).length;
    const od = num(ctx.turnaround && ctx.turnaround.operatingDaysPerMonth) || 26;
    const util = monthList.map((m) => { const days = trips.filter((t) => String(t.dateDispatched || '').slice(0, 7) === m).reduce((s, t) => s + (truckDays(t, ctx).planned || 0), 0); return { month: m, truckDays: round2(days), capacityDays: own * od, utilizationPct: own ? pct(days, own * od) : null }; });
    return { months: monthList, clients: rows, shared, ownTrucks: own, operatingDays: od, utilization: util };
  }

  // ------------------------------------------------------------- trip audit (three independent prices)
  const STATUSES = ['Compliant', 'Above Approved Rate', 'Below Approved Rate', 'Approved Rate Missing', 'Costing Below Selling Price', 'Selling Price Below Cost', 'Requires Review'];
  const EXCEPTION_TYPES = { belowApproved: 'Selling price below the approved client rate', belowCost: 'Selling price below the estimated trip cost', missingRate: 'No valid Client Rate Card entry', override: 'Manually selected / overridden rate', exceptional: 'Exceptional commercial arrangement' };
  const SEVERITIES = ['High', 'Medium', 'Low', 'None'];
  function coveredByException(obj, exceptions) {
    const list = (exceptions || []).filter((x) => x.status === 'Approved' && (!x.expiresOn || x.expiresOn >= String(obj.dateDispatched || obj.loadingDate || '').slice(0, 10)));
    return list.find((x) => (obj.id && x.tripLogId === obj.id) || (obj.requestId && x.requestId && x.requestId === obj.requestId) || (obj.invoiceId && x.invoiceId && x.invoiceId === obj.invoiceId) || (obj.scopeRequest && x.requestId === obj.scopeRequest)) || null;
  }
  function tripAudit(trip, ctx, comp) {
    const policy = policyOf(ctx); const tol = policy.thresholds.belowApprovedTolerancePct / 100, material = policy.thresholds.materialBelowBenchmarkPct;
    const selling = num(trip.sellingPrice), approved = num(trip.agreedPrice), approvedStatus = trip.agreedStatus || 'none';
    const c = costingOf(trip, ctx); const cost = c && c.available ? num(c.total) : null;
    const b = comp && comp.byTrip ? comp.byTrip.get(trip.id) : null;
    const flags = []; let approvedFlag, costFlag, benchFlag;
    if (approvedStatus === 'multiple') approvedFlag = 'Multiple approved rates — selection required';
    else if (approved === null) approvedFlag = 'Approved Rate Missing';
    else if (selling === null) approvedFlag = 'Selling price not entered';
    else if (selling < approved * (1 - tol)) approvedFlag = 'Below Approved Rate'; else if (selling > approved * (1 + tol)) approvedFlag = 'Above Approved Rate'; else approvedFlag = 'Compliant';
    if (cost === null) costFlag = 'Costing unavailable' + (c && c.reason ? ` (${c.reason})` : ''); else if (selling === null) costFlag = 'Costing available, no selling price'; else costFlag = selling < cost ? 'Selling Price Below Cost' : 'Costing Below Selling Price';
    if (!b) benchFlag = 'No comparison group'; else if (b.rateLevel !== null && b.rateLevel < 100 - material) benchFlag = `Below comparable peers (${b.rateLevel}% of ${b.bestClient})`; else benchFlag = 'At comparable benchmark';
    if (b && b.thin) flags.push(`Thin benchmark (${b.bestClientTrips} trip${b.bestClientTrips === 1 ? '' : 's'})`);
    if (trip.agreedRateId) flags.push('Manual rate selection'); if (trip.commercialExceptional) flags.push('Exceptional job (excluded from benchmarks)');
    const varianceApproved = selling !== null && approved !== null ? round2(selling - approved) : null; const varianceApprovedPct = varianceApproved !== null && approved ? pct(varianceApproved, approved) : null;
    const expectedMargin = selling !== null && cost !== null ? round2(selling - cost) : null; const marginPct = expectedMargin !== null && selling ? pct(expectedMargin, selling) : null;
    let status, exceptionType = null;
    if (costFlag === 'Selling Price Below Cost') { status = 'Selling Price Below Cost'; exceptionType = 'belowCost'; }
    if (approvedFlag === 'Below Approved Rate') { status = status || 'Below Approved Rate'; exceptionType = 'belowApproved'; }
    if (!status && approvedFlag === 'Approved Rate Missing' && selling !== null) { status = 'Approved Rate Missing'; exceptionType = 'missingRate'; }
    if (!status && (approvedStatus === 'multiple' || trip.commercialExceptional)) { status = 'Requires Review'; exceptionType = trip.commercialExceptional ? 'exceptional' : 'override'; }
    if (!status && trip.agreedRateId) { status = approvedFlag === 'Compliant' ? 'Compliant' : 'Requires Review'; if (status === 'Requires Review') exceptionType = 'override'; }
    if (!status) status = approvedFlag === 'Above Approved Rate' ? 'Above Approved Rate' : approvedFlag === 'Compliant' ? 'Compliant' : selling === null ? 'Requires Review' : 'Approved Rate Missing';
    if (status === 'Approved Rate Missing' && !exceptionType) exceptionType = 'missingRate';
    const severity = status === 'Selling Price Below Cost' ? 'High' : status === 'Below Approved Rate' ? (varianceApprovedPct !== null && -varianceApprovedPct >= material ? 'High' : 'Medium') : status === 'Approved Rate Missing' ? 'Medium' : status === 'Requires Review' ? 'Medium' : benchFlag.startsWith('Below comparable') ? 'Low' : status === 'Above Approved Rate' ? 'Low' : 'None';
    const exception = coveredByException(trip, ctx.rateexceptions); const pendingException = (ctx.rateexceptions || []).find((x) => x.tripLogId === trip.id && /Pending/.test(x.status)) || null;
    const invoiceRule = exceptionType ? policy.blocking.invoice[exceptionType] : false;
    const blocksInvoice = !!(invoiceRule && !exception && !trip.internalClient);
    const requiresApproval = !!exceptionType && exceptionType !== 'missingRate' ? !exception : !!(exceptionType && policy.blocking.invoice.missingRate && !exception);
    return { tripLogId: trip.id, tripId: trip.journeyPlanId || '', date: trip.dateDispatched, client: trip.client, requestId: trip.requestId || '', invoiceId: trip.invoiceId || '', route: compRoute(trip).key, routeMasterId: (c && c.km && c.km.route && c.km.route.id) || trip.routeMasterId || '', plate: trip.plate, vehicleType: trip.vehicleType, vehicleClass: vehicleClass(trip, policy, ctx.assets), truckBatch: trip.truckBatch, lob: trip.lob, costCenter: trip.costCenter,
      approvedRate: approved, approvedStatus, approvedSource: trip.agreedRate ? (trip.agreedRate.remarks || 'Client Rate Card') : '', sellingPrice: selling, costingRate: cost, costingReason: c ? c.reason || '' : 'costing module unavailable', bestComparableRate: b ? b.bestAvg : null, bestComparableClient: b ? b.bestClient : '', highestRate: b ? b.highest : null, rateLevel: b ? b.rateLevel : null, comparisonGroup: b ? `${b.group.route} · ${b.group.periodLabel} · ${b.group.vehicleClass}` : '',
      varianceApproved, varianceApprovedPct, expectedMargin, marginPct, approvedFlag, costFlag, benchFlag, flags, status, severity, exceptionType, exceptionLabel: exceptionType ? EXCEPTION_TYPES[exceptionType] : '', requiresApproval, blocksInvoice, exception, pendingException, invoiced: !!trip.invoiceId, paymentStatus: trip.paymentStatus || '' };
  }
  function actualMargin(trip, ctx) { if (!trip.invoiceId || !F) return null; try { const p = F.tripPnl(trip, ctx); return { revenue: p.revenue, directTotal: p.directTotal, contribution: p.contribution, operatingProfit: p.operatingProfit, marginPct: p.operatingMarginPct }; } catch (e) { return null; } }
  /** Audit of every trip plus the summary tiles of the brief. */
  function auditTrips(trips, ctx, comp) {
    comp = comp || comparison(trips, ctx); const rows = (trips || []).map((t) => tripAudit(t, ctx, comp));
    const s = { trips: rows.length, achieved: round2(rows.reduce((a, r) => a + (num(r.sellingPrice) || 0), 0)), belowApproved: rows.filter((r) => r.approvedFlag === 'Below Approved Rate'), aboveApproved: rows.filter((r) => r.approvedFlag === 'Above Approved Rate'), compliant: rows.filter((r) => r.approvedFlag === 'Compliant'), missingRate: rows.filter((r) => r.approvedFlag === 'Approved Rate Missing' && r.sellingPrice !== null), belowCost: rows.filter((r) => r.costFlag === 'Selling Price Below Cost'), negativeMargin: rows.filter((r) => r.expectedMargin !== null && r.expectedMargin < 0), awaitingApproval: rows.filter((r) => r.requiresApproval && !r.exception), pending: rows.filter((r) => r.pendingException), covered: rows.filter((r) => r.exception) };
    s.revenueBelowApproved = round2(s.belowApproved.reduce((a, r) => a + Math.abs(r.varianceApproved || 0), 0)); s.revenueBelowCost = round2(s.belowCost.reduce((a, r) => a + Math.abs(r.expectedMargin || 0), 0));
    return { rows, summary: s, comparison: comp };
  }
  /** Commercial check of a CRM request before the fleet plan is approved. */
  function requestAudit(request, ctx, comp) {
    const policy = policyOf(ctx); const material = policy.thresholds.materialBelowBenchmarkPct; const plan = request.plan || {};
    const route = P.routeFor(request, ctx.routes || []); const vehicleType = plan.vehicleType || request.vehicleType || (route && route.size) || ''; const tonnage = plan.tonnage || request.tonnage || (route && route.tonnage) || '';
    const rr = D.requestRate(request, ctx); const approvedRate = rr.source === 'price list' || rr.source.startsWith('client agreed') ? rr.rate : null; const routePrice = rr.source === 'route register' ? rr.rate : (route && num(route.price)) || null;
    const expected = num(request.expectedSellingPrice) !== null ? num(request.expectedSellingPrice) : approvedRate !== null ? approvedRate : routePrice;
    const expectedSource = num(request.expectedSellingPrice) !== null ? 'CRM expected selling price' : approvedRate !== null ? 'approved client rate' : routePrice !== null ? 'Route Master price (no client rate card entry)' : 'none';
    const est = estimateCost(route, vehicleType, tonnage, ctx); const cost = est.total;
    const rt = compRoute({ loadingFrom: request.loadingFrom || (route && route.loadingPoint), loadingTo: request.destination || (route && route.destination) }); const vc = vehicleClass({ vehicleType: /flat/i.test(vehicleType) ? 'Flat Trucks Logistics' : /hiab/i.test(vehicleType) ? 'Hiabs Logistics' : /canter|van|closed/i.test(vehicleType) ? 'Closed Body Logistics' : 'HAULAGE', contractType: tonnage, plate: '' }, policy, ctx.assets);
    const groups = comp ? comp.comparableGroups.filter((g) => g.route === rt.key && g.vehicleClass === vc).sort((a, b) => b.period.localeCompare(a.period)) : []; const g = groups[0] || null;
    const rateLevel = g && expected !== null ? pct(expected, g.bestAvg) : null;
    const td = route && (num(route.tatDays) || num(route.totalDays)) ? num(route.tatDays) || num(route.totalDays) : turnaroundLookup(rt.area, rt.dest, ctx).oneLegDays * 2;
    const trucks = Number(plan.approvedQty || request.trucks || 1); const warnings = [], blockers = [], notes = [];
    const expectedMargin = expected !== null && cost !== null ? round2(expected - cost) : null;
    if (approvedRate === null && !P.isTpl(request)) (policy.blocking.allocation.missingRate ? warnings : notes).push('No approved Client Rate Card entry for this client, route and vehicle: the trip will be flagged "Approved Rate Missing" for commercial review before invoicing.');
    if (expectedMargin !== null && expectedMargin < 0) warnings.push(`Expected selling price is below the estimated trip cost (margin ₦${expectedMargin.toLocaleString('en-NG')}).`);
    if (rateLevel !== null && rateLevel < 100 - material) warnings.push(`Commercial Alert: this client pays below the comparable route benchmark (${rateLevel}% of ${g.bestClient}'s average on ${g.route}, ${g.periodLabel}). Review expected margin and alternative fleet demand before allocation.`);
    const exception = coveredByException({ requestId: request.id, loadingDate: request.loadingDate }, ctx.rateexceptions);
    if (!exception) { if (expectedMargin !== null && expectedMargin < 0 && policy.blocking.allocation.belowCost) blockers.push('Negative-margin job: an approved commercial exception is required before the plan can be approved.'); if (approvedRate === null && !P.isTpl(request) && policy.blocking.allocation.missingRate) blockers.push('No approved client rate: an approved commercial exception is required before the plan can be approved.'); if (rateLevel !== null && rateLevel < 100 - material && policy.blocking.allocation.belowBenchmark) blockers.push('Below-benchmark rate: an approved commercial exception is required (policy).'); }
    return { requestId: request.id, client: request.client, route: rt.key, routeMasterId: route ? route.id : '', vehicleType, tonnage, approvedRate, approvedSource: approvedRate !== null ? rr.source : 'none', expectedSellingPrice: expected, expectedSource, estimatedCost: cost, costBasis: est.basis, costComponents: est.components, expectedMargin, marginPct: expectedMargin !== null && expected ? pct(expectedMargin, expected) : null, bestComparableRate: g ? g.bestAvg : null, bestComparableClient: g ? g.bestClient : '', comparisonPeriod: g ? g.periodLabel : '', rateLevel, competitiveness: rateLevel === null ? 'No comparable trips on this route' : rateLevel >= 99.5 ? 'Strong Rate' : rateLevel >= 100 - material ? 'Competitive' : 'Below Comparable Peers', truckDaysPerTrip: td, truckDaysRequired: round2(td * trucks), trucks, warnings, notes, blockers, flagged: warnings.length > 0, exception };
  }
  /** Estimated cost of a job before a truck is known: the median rate-card parameters of the matching vehicle class on the route's distance. */
  function estimateCost(route, vehicleType, tonnage, ctx) {
    const rc = ctx.ratecard || []; const assets = ctx.assets || []; if (!rc.length) return { total: null, basis: 'No rate card loaded', components: [] };
    const want = /flat/i.test(vehicleType) ? 'flat' : /hiab/i.test(vehicleType) ? 'hiab' : /canter|van|closed/i.test(vehicleType) ? 'closed' : 'haulage';
    const ton = E.normContract(tonnage || '');
    let pool = rc.filter((r) => { const a = assets.find((x) => x.assetCode === r.assetCode) || E.assetFor(r.plate, assets); if (!a) return false; const vt = norm(a.vehicleType); const ok = want === 'flat' ? /flat/.test(vt) : want === 'hiab' ? /hiab/.test(vt) : want === 'closed' ? /closed/.test(vt) : vt === 'haulage'; if (!ok) return false; if (ton && a.tonnage && E.normContract(a.tonnage) !== ton) return false; return true; });
    if (!pool.length) pool = rc.filter((r) => { const a = assets.find((x) => x.assetCode === r.assetCode) || E.assetFor(r.plate, assets); return a && norm(a.vehicleType) === 'haulage'; });
    if (!pool.length) return { total: null, basis: 'No rate card entry for this vehicle class', components: [] };
    const med = (k) => { const v = pool.map((r) => num(r[k])).filter((x) => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
    const km = route ? { oneWay: num(route.kmOneWay), total: num(route.totalKm) !== null ? num(route.totalKm) : num(route.kmOneWay) !== null ? round2(num(route.kmOneWay) + (num(route.kmReturn) === null ? num(route.kmOneWay) : num(route.kmReturn))) : null } : { oneWay: null, total: null };
    if (km.total === null) return { total: null, basis: route ? 'Route Master has no distance for this lane' : 'No approved route', components: [] };
    const days = (route && (num(route.tatDays) || num(route.totalDays))) || P.journeyPlan(km.oneWay, ctx.planning, num(route.kmReturn)).totalDays || 1; const price = F.dieselPriceOf(ctx.planning);
    const litres = round2(km.total * med('consumptionLPerKm'));
    const comps = [{ label: `Fixed truck cost (${days} days × ₦${med('fixedCostPerDay')})`, amount: round2(med('fixedCostPerDay') * days) }, { label: `Diesel (${litres} L × ₦${price === null ? '?' : price})`, amount: price === null ? null : round2(litres * price) }, { label: `Road expenses (${km.total} km)`, amount: round2(km.total * med('roadExpensePerKm')) }, { label: `Maintenance (${km.total} km)`, amount: round2(km.total * med('mtcCostPerKm')) }, { label: `Tyres (${km.total} km)`, amount: round2(km.total * med('tyreCostPerKm')) }];
    const total = comps.some((c) => c.amount === null) ? null : round2(comps.reduce((s, c) => s + c.amount, 0));
    return { total, basis: `Median rate card of ${pool.length} ${want} truck${pool.length > 1 ? 's' : ''}${ton ? ' (' + ton + ')' : ''} on ${km.total} km, ${days} planned days`, components: comps, days, km };
  }

  // ------------------------------------------------------------- rate exceptions & register (workflow rules)
  const EXCEPTION_STATUSES = ['Pending Operations Review', 'Pending Commercial Approval', 'Approved', 'Rejected', 'Withdrawn'];
  const FINDING_STATUSES = ['Open', 'Under Review', 'Action Agreed', 'Closed'];
  function nextNo(prefix, dateISO, list, field) { const d = String(dateISO || E.todayISO()).slice(2, 10).replace(/-/g, ''); const pre = `${prefix}-${d}-`; const n = (list || []).map((x) => String(x[field || 'id'] || '')).filter((x) => x.startsWith(pre)).map((x) => Number(x.slice(pre.length)) || 0); return pre + String((n.length ? Math.max(...n) : 0) + 1).padStart(2, '0'); }
  const nextExceptionNo = (dateISO, list) => nextNo('EXC', dateISO, list); const nextFindingNo = (dateISO, list) => nextNo('AUD', dateISO, list);
  function canReview(role, type, policy) { const m = policyOf({ auditpolicy: policy }).approvalMatrix[type] || DEFAULT_POLICY.approvalMatrix.belowApproved; return role === 'admin' || (m.review || []).includes(role); }
  function canApprove(role, type, policy) { const m = policyOf({ auditpolicy: policy }).approvalMatrix[type] || DEFAULT_POLICY.approvalMatrix.belowApproved; return role === 'admin' || (m.approve || []).includes(role); }
  /** Why a rate-exception write is refused ('' when allowed). Raise / review / approve are separated by role and by person; closed exceptions are immutable except for comments. */
  function exceptionError(next, current, role, username, policy) {
    if (!next) return 'Nothing to save.';
    if (!current) {
      if (!E.can(role, 'exception.raise')) return 'Your role cannot raise commercial exceptions.';
      if (!EXCEPTION_TYPES[next.type]) return 'Exception type is required.'; if (!clean(next.justification)) return 'A justification is required.';
      if (!next.tripLogId && !next.requestId && !next.invoiceId) return 'Link the exception to a trip, a request or an invoice.';
      if (!clean(next.client)) return 'Client is required.';
      if (next.status !== 'Pending Operations Review' && next.status !== 'Pending Commercial Approval') return 'A new exception starts as Pending Operations Review.';
      if (next.status === 'Pending Commercial Approval' && ((policyOf({ auditpolicy: policy }).approvalMatrix[next.type] || {}).review || []).length) return 'Operations review comes first for this exception type.';
      return '';
    }
    const closed = ['Approved', 'Rejected', 'Withdrawn'].includes(current.status);
    const changed = Object.keys(next).filter((k) => !['version', 'updatedAt', 'updatedBy', 'comments', 'history', 'documents'].includes(k) && JSON.stringify(next[k]) !== JSON.stringify(current[k]));
    if (closed && changed.length) return `Exception ${current.id} is ${current.status} and cannot be changed (comments may still be added).`;
    const h0 = JSON.stringify(current.history || []); const h1 = JSON.stringify((next.history || []).slice(0, (current.history || []).length)); if (h1 !== h0) return 'The approval history is immutable.';
    if (next.status !== current.status) {
      const t = current.type;
      if (next.status === 'Withdrawn') { if (current.raisedBy !== username && role !== 'admin') return 'Only the person who raised the exception can withdraw it.'; return ''; }
      if (current.status === 'Pending Operations Review') { if (!['Pending Commercial Approval', 'Rejected'].includes(next.status)) return 'From Operations review an exception moves to Commercial Approval or is rejected.'; if (!canReview(role, t, policy)) return 'Only the Operations Manager reviews commercial exceptions.'; if (current.raisedBy === username) return 'You cannot review your own exception request.'; return ''; }
      if (current.status === 'Pending Commercial Approval') { if (!['Approved', 'Rejected'].includes(next.status)) return 'From Commercial Approval an exception is approved or rejected.'; if (!canApprove(role, t, policy)) return `Only ${(policyOf({ auditpolicy: policy }).approvalMatrix[t] || {}).approve.map((r) => E.ROLE_LABELS[r] || r).join(' or ')} approve this exception type.`; if (current.raisedBy === username) return 'You cannot approve your own exception request.'; if (next.status === 'Approved' && !clean(next.approvalNote) && !clean(next.justification)) return 'Record the basis of the approval.'; return ''; }
      return `Exception ${current.id} cannot change from ${current.status} to ${next.status}.`;
    }
    if (changed.some((k) => !['status', 'opsNote', 'approvalNote', 'assignedTo', 'expiresOn', 'reviewedBy', 'reviewedAt', 'approvedBy', 'approvedAt', 'rejectedBy', 'rejectedAt', 'withdrawnAt'].includes(k)) && current.raisedBy !== username && role !== 'admin') return 'Only the person who raised the exception edits its details while it is pending.';
    return '';
  }
  /** Stamps the transition (who / when) and appends to the immutable history. */
  function exceptionStamp(next, current, user, now) {
    now = now || E.todayISO() + 'T00:00:00Z'; const out = Object.assign({}, next); const hist = (current && current.history ? current.history : []).slice();
    if (!current) { out.raisedBy = out.raisedBy || user.username; out.raisedAt = out.raisedAt || now; hist.push({ at: now, by: user.username, role: user.role, action: 'Raised', status: out.status, note: out.justification }); }
    else if (out.status !== current.status) {
      if (out.status === 'Pending Commercial Approval') { out.reviewedBy = user.username; out.reviewedAt = now; } if (out.status === 'Approved') { out.approvedBy = user.username; out.approvedAt = now; } if (out.status === 'Rejected') { out.rejectedBy = user.username; out.rejectedAt = now; } if (out.status === 'Withdrawn') out.withdrawnAt = now;
      hist.push({ at: now, by: user.username, role: user.role, action: out.status, status: out.status, note: out.status === 'Pending Commercial Approval' ? out.opsNote || '' : out.approvalNote || out.opsNote || '' });
    }
    out.history = hist; return out;
  }
  /** Audit register entries: reviewer, corrective action, approval status, closure; comments and documents append only. */
  function findingError(next, current, role) {
    if (!E.can(role, 'commercial.manage') && !(current && E.can(role, 'commercial.view') && Object.keys(next).every((k) => ['id', 'version', 'comments', 'updatedAt', 'updatedBy'].includes(k) || JSON.stringify(next[k]) === JSON.stringify(current[k])))) return 'Your role cannot change the audit register (comments only).';
    if (!next.tripLogId && !next.requestId) return 'A finding is linked to a trip or a request.';
    if (next.status && !FINDING_STATUSES.includes(next.status)) return 'Unknown finding status.';
    if (next.status === 'Closed' && !clean(next.correctiveAction)) return 'Record the corrective action before closing the finding.';
    if (current && (current.comments || []).length > (next.comments || []).length) return 'Comments cannot be removed.';
    if (current && JSON.stringify((next.comments || []).slice(0, (current.comments || []).length)) !== JSON.stringify(current.comments || [])) return 'Existing comments are immutable.';
    return '';
  }

  // ------------------------------------------------------------- recommendations and assistant
  function recommendations(trips, ctx, comp, audits) {
    comp = comp || comparison(trips, ctx); audits = audits || auditTrips(trips, ctx, comp); const policy = comp.policy; const out = []; const money = (n) => '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
    const ranking = clientRanking(comp, trips, ctx);
    for (const r of ranking.filter((x) => x.verdict === 'Below Comparable Peers' && x.opportunity > 0).slice(0, 8)) out.push({ type: r.rateLevel < 85 ? 'Negotiate Rate Increase' : 'Review Client Rate', subject: r.client, priority: r.opportunity > 10e6 ? 'High' : 'Medium', value: r.opportunity, evidence: [`Rate level ${r.rateLevel}% of the best comparable client average across ${r.comparableRoutes} route${r.comparableRoutes === 1 ? '' : 's'} (${r.tripsCompared} comparable trips)`, `Biggest gaps: ${r.routesWithGaps}`, r.lossNote], calculation: `Estimated rate opportunity = Σ over comparison groups of (best comparable client average − ${r.client} average) × ${r.client} trips = ${money(r.opportunity)} (aggressive benchmark at the highest observed rate: ${money(r.opportunityHighest)})` });
    const neg = new Map(); for (const a of audits.rows.filter((x) => x.expectedMargin !== null && x.expectedMargin < 0)) { const m = neg.get(a.client) || { client: a.client, trips: 0, loss: 0, ids: [] }; m.trips++; m.loss += a.expectedMargin; m.ids.push(a.tripId || a.tripLogId); neg.set(a.client, m); }
    for (const m of [...neg.values()].sort((a, b) => a.loss - b.loss).slice(0, 6)) out.push({ type: 'Investigate Negative-Margin Trips', subject: m.client, priority: 'High', value: round2(-m.loss), evidence: [`${m.trips} trip${m.trips === 1 ? '' : 's'} sold below the rate-card costing`, `Trip IDs: ${m.ids.slice(0, 6).join(', ')}${m.ids.length > 6 ? ' …' : ''}`], calculation: `Expected loss = Σ (selling price − calculated costing) = ${money(m.loss)}; costing = fixed cost × planned days + diesel + road + maintenance + tyres from the Rate Card for costing` });
    const td = truckDayStats(trips.filter((t) => inScope(t, policy, comp.scope) && vehicleClass(t, policy, ctx.assets)), ctx, (t) => `${t.client} · ${compRoute(t).key}`).filter((x) => x.contributionPerTruckDay !== null && x.trips >= 3);
    if (td.length >= 2) { const best = td.slice().sort((a, b) => b.contributionPerTruckDay - a.contributionPerTruckDay)[0]; for (const w of td.slice().sort((a, b) => a.contributionPerTruckDay - b.contributionPerTruckDay).slice(0, 4)) if (w.key !== best.key && w.truckDays > 20) out.push({ type: 'Prioritize Higher-Contribution Demand', subject: w.key, priority: 'Medium', value: round2(w.truckDays * (best.contributionPerTruckDay - w.contributionPerTruckDay)), evidence: [`${w.trips} trips tie up ${w.truckDays} truck-days at ${money(w.contributionPerTruckDay)} contribution per truck-day`, `Best use of a truck-day in the same period: ${best.key} at ${money(best.contributionPerTruckDay)} per truck-day`], calculation: `Potential = truck-days (${w.truckDays}) × (best contribution per truck-day − this contribution per truck-day) = ${money(w.truckDays * (best.contributionPerTruckDay - w.contributionPerTruckDay))}, if that capacity could be re-sold at the best rate (demand permitting)` }); }
    for (const r of td.filter((x) => x.actualTat !== null && x.plannedTat && x.actualTat > x.plannedTat * 1.2).slice(0, 4)) out.push({ type: 'Reduce Truck Turnaround', subject: r.key, priority: 'Medium', value: round2((r.actualTat - r.plannedTat) * r.trackedTrips * (r.revenuePerTruckDay || 0)), evidence: [`Tracked turnaround ${r.actualTat} days against ${r.plannedTat} planned on ${r.trackedTrips} tracked trip${r.trackedTrips === 1 ? '' : 's'}`], calculation: `Truck-days lost = (actual − planned TAT) × tracked trips = ${round2((r.actualTat - r.plannedTat) * r.trackedTrips)} days × revenue per truck-day ${money(r.revenuePerTruckDay)}` });
    for (const r of td.filter((x) => x.plannedTat >= 6 && x.revenuePerTruckDay !== null).sort((a, b) => a.revenuePerTruckDay - b.revenuePerTruckDay).slice(0, 3)) out.push({ type: 'Improve Backloading', subject: r.key, priority: 'Low', value: null, evidence: [`${r.plannedTat}-day round trip earns ${money(r.revenuePerTruckDay)} per truck-day; the return leg carries no revenue`], calculation: `Revenue per truck-day = net freight revenue ÷ round-trip days = ${money(r.revenue)} ÷ ${r.truckDays} truck-days` });
    const dieselOver = []; const roadOver = []; const price = F.dieselPriceOf(ctx.planning);
    for (const t of trips) { const c = costingOf(t, ctx); if (!c || !c.available) continue; const issued = (ctx.dieselreqs || []).filter((d) => d.tripLogId === t.id && !d.rejectedAt).reduce((s, d) => s + D.slipTotals(d).issued, 0); if (issued && c.litres && issued > c.litres * 1.1) dieselOver.push({ trip: t, issued, planned: c.litres }); const road = (ctx.roadslips || []).filter((r) => r.tripLogId === t.id && !r.rejectedAt).reduce((s, r) => s + D.slipTotals(r).issued, 0); const roadComp = (c.components || []).find((x) => x.key === 'road'); if (road && roadComp && road > roadComp.amount * 1.1) roadOver.push({ trip: t, road, planned: roadComp.amount }); }
    if (dieselOver.length) out.push({ type: 'Review Diesel Cost', subject: `${dieselOver.length} trip${dieselOver.length === 1 ? '' : 's'}`, priority: 'Medium', value: price === null ? null : round2(dieselOver.reduce((s, x) => s + (x.issued - x.planned) * price, 0)), evidence: dieselOver.slice(0, 5).map((x) => `${x.trip.journeyPlanId || x.trip.id}: ${x.issued} L issued vs ${x.planned} L at the KPI consumption`), calculation: 'Excess = (litres issued − route km × approved L/km) × Settings diesel price' });
    if (roadOver.length) out.push({ type: 'Review Road Expense Cost', subject: `${roadOver.length} trip${roadOver.length === 1 ? '' : 's'}`, priority: 'Medium', value: round2(roadOver.reduce((s, x) => s + x.road - x.planned, 0)), evidence: roadOver.slice(0, 5).map((x) => `${x.trip.journeyPlanId || x.trip.id}: ₦${x.road.toLocaleString('en-NG')} paid vs ₦${x.planned.toLocaleString('en-NG')} at the rate-card ₦/km`), calculation: 'Excess = road expenses paid − route km × rate-card road expense per km' });
    return out.sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.priority] - { High: 0, Medium: 1, Low: 2 }[b.priority]) || (b.value || 0) - (a.value || 0));
  }
  const QUESTIONS = ['Which client is paying the lowest rate on Lagos → Kano for the same truck category?', 'Which clients have the largest rate gaps?', 'Which routes have the best contribution per truck-day?', 'Which clients are below approved contractual rates?', 'Which trips are being invoiced below the costing rate?', 'Which clients should be prioritized for rate negotiation?', 'What additional revenue could be achieved by revising Jamara\'s rate?', 'Which contracts occupy the most trucks for the lowest contribution?', 'Which routes have too few comparable trips for a reliable rate benchmark?'];
  function assistant(question, ctx) {
    const q = norm(question); const trips = ctx.trips || []; if (!/rate|gap|benchmark|truck-?day|contribution|cost|margin|negotiat|revenue|price|approved|contract|comparab|peer|client|route/.test(q)) return null;
    const money = (n) => '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 }); const comp = comparison(trips, ctx);
    const routeAsked = (() => { const m = question.match(/on\s+([A-Za-z .()-]+?)\s*(?:→|->|–|-|to)\s*([A-Za-z .()-]+?)(?:\s+for|\s+with|\?|$)/i); return m ? `${loadingArea(m[1].trim())} → ${destName(m[2].trim())}` : ''; })();
    if (/lowest|cheapest|least/.test(q) && /rate|price/.test(q) && routeAsked) { const gs = comp.comparableGroups.filter((g) => norm(g.route) === norm(routeAsked)).sort((a, b) => b.period.localeCompare(a.period)); if (!gs.length) return { title: `Rates on ${routeAsked}`, answer: `No comparable trips (2+ clients in the same ${comp.period}) on ${routeAsked} in the comparison scope.`, columns: [], rows: [] }; const g = gs[0]; const rows = g.clientStats.slice().sort((a, b) => a.avg - b.avg).map((c) => ({ client: c.client, trips: c.trips, avgRate: c.avg, rateLevel: c.rateLevel, gapPerTrip: c.gap, vehicleClass: g.vehicleClass })); return { title: `${g.route} · ${g.periodLabel} · ${g.vehicleClass}`, answer: `${rows[0].client} pays the lowest average rate on ${g.route} (${money(rows[0].avgRate)}, ${rows[0].rateLevel}% of ${g.bestClient}'s ${money(g.bestAvg)}); highest single rate ${money(g.highest)} (${g.highestClient}). Same truck category: ${g.vehicleClass}.`, columns: ['client', 'trips', 'avgRate', 'rateLevel', 'gapPerTrip'], rows }; }
    if (/largest|biggest|highest/.test(q) && /gap/.test(q)) { const rows = clientRanking(comp, trips, ctx).filter((r) => r.opportunity > 0).slice(0, 15); return { title: 'Clients ranked by estimated rate opportunity', answer: rows.length ? `${rows[0].client} has the largest gap: ${money(rows[0].opportunity)} across ${rows[0].tripsCompared} comparable trips (rate level ${rows[0].rateLevel}%). These are commercial opportunity estimates, not realised losses.` : 'No rate gaps in the current scope.', columns: ['rank', 'client', 'rateLevel', 'tripsCompared', 'opportunity', 'opportunityHighest', 'verdict'], rows }; }
    if (/contribution|revenue/.test(q) && /truck-?day/.test(q) && /route|best|highest/.test(q)) { const rows = truckDayStats(trips.filter((t) => inScope(t, comp.policy, comp.scope)), ctx, (t) => compRoute(t).key).filter((r) => r.trips >= 3).sort((a, b) => (b.contributionPerTruckDay || -1e12) - (a.contributionPerTruckDay || -1e12)).slice(0, 15); return { title: 'Contribution per truck-day by route (planned truck-days)', answer: rows.length ? `${rows[0].key} gives the best contribution per truck-day (${money(rows[0].contributionPerTruckDay)} on ${rows[0].trips} trips, ${rows[0].plannedTat}-day planned turnaround).` : 'No costed routes yet.', columns: ['key', 'trips', 'revenuePerTruckDay', 'contributionPerTruckDay', 'plannedTat', 'actualTat', 'tripsPerTruckPerMonth'], rows }; }
    if (/below/.test(q) && /approved|contract/.test(q) && /client/.test(q)) { const a = auditTrips(trips, ctx, comp); const m = new Map(); for (const r of a.summary.belowApproved) { const x = m.get(r.client) || { client: r.client, trips: 0, shortfall: 0, awaitingApproval: 0 }; x.trips++; x.shortfall += Math.abs(r.varianceApproved); if (r.requiresApproval) x.awaitingApproval++; m.set(r.client, x); } const rows = [...m.values()].sort((a1, b) => b.shortfall - a1.shortfall); return { title: 'Clients invoiced below their approved contractual rate', answer: rows.length ? `${rows.length} client${rows.length === 1 ? '' : 's'} have trips priced below the approved Client Rate Card; total shortfall ${money(rows.reduce((s, r) => s + r.shortfall, 0))}. Trips without an approved exception cannot be invoiced.` : 'No trip is priced below its approved client rate.', columns: ['client', 'trips', 'shortfall', 'awaitingApproval'], rows }; }
    if (/below/.test(q) && /cost/.test(q)) { const a = auditTrips(trips, ctx, comp); const rows = a.summary.belowCost.map((r) => ({ tripId: r.tripId || r.tripLogId, client: r.client, route: r.route, sellingPrice: r.sellingPrice, costingRate: r.costingRate, expectedMargin: r.expectedMargin, invoiced: r.invoiced ? 'yes' : 'no', exception: r.exception ? r.exception.id : r.pendingException ? 'pending' : '' })).sort((a1, b) => a1.expectedMargin - b.expectedMargin).slice(0, 40); return { title: 'Trips priced below the calculated costing rate', answer: rows.length ? `${a.summary.belowCost.length} trip${a.summary.belowCost.length === 1 ? '' : 's'} sell below the rate-card costing (expected loss ${money(a.summary.revenueBelowCost)}); ${a.summary.belowCost.filter((r) => r.invoiced).length} already invoiced.` : 'No trip sells below its calculated costing.', columns: ['tripId', 'client', 'route', 'sellingPrice', 'costingRate', 'expectedMargin', 'invoiced', 'exception'], rows }; }
    if (/negotiat|prioriti[sz]e/.test(q)) { const rows = clientRanking(comp, trips, ctx).filter((r) => r.verdict === 'Below Comparable Peers' || r.verdict === 'Below Cost').slice(0, 10); return { title: 'Rate negotiation priorities', answer: rows.length ? `Start with ${rows.slice(0, 3).map((r) => r.client).join(', ')}: ${money(rows.slice(0, 3).reduce((s, r) => s + r.opportunity, 0))} of the ${money(rows.reduce((s, r) => s + r.opportunity, 0))} total opportunity. Reference the best-paying clients on the same routes (${[...new Set(comp.comparableGroups.map((g) => g.bestClient))].slice(0, 4).join(', ')}).` : 'No client is below comparable peers.', columns: ['rank', 'client', 'rateLevel', 'opportunity', 'expectedMarginPct', 'routesWithGaps', 'verdict'], rows }; }
    if (/additional revenue|could be achieved|revis/.test(q)) { const name = (question.match(/revising\s+(.+?)'?s?\s+rate/i) || question.match(/for\s+(.+?)\?/i) || [])[1]; const rk = clientRanking(comp, trips, ctx); const r = name ? rk.find((x) => norm(x.client).includes(norm(name).replace(/'s$/, ''))) : rk[0]; if (!r) return { title: 'Revenue from revising a rate', answer: `No comparable data for ${name || 'that client'}.`, columns: [], rows: [] }; const gaps = routeGaps(comp, ctx).filter((g) => g.client === r.client && g.gap > 0); return { title: `Revenue opportunity · ${r.client}`, answer: `Pricing ${r.client} at the best comparable client average on its ${gaps.length} gap route-quarters would have added ${money(r.opportunity)} (${r.tripsCompared} trips; rate level ${r.rateLevel}%). At the highest observed rate on each route: ${money(r.opportunityHighest)} (aggressive benchmark).`, columns: ['period', 'route', 'tripCount', 'avgRate', 'bestClient', 'benchmarkRate', 'gap', 'opportunity', 'thinBenchmark'], rows: gaps }; }
    if (/occup|tie|most trucks|lowest contribution/.test(q)) { const rows = truckDayStats(trips.filter((t) => inScope(t, comp.policy, comp.scope)), ctx, (t) => t.client).filter((r) => r.trips >= 3).sort((a, b) => b.truckDays - a.truckDays).slice(0, 15); const worst = rows.slice().filter((r) => r.contributionPerTruckDay !== null).sort((a, b) => a.contributionPerTruckDay - b.contributionPerTruckDay)[0]; return { title: 'Truck-days by client vs contribution per truck-day', answer: worst ? `${rows[0].key} occupies the most truck-days (${rows[0].truckDays}); ${worst.key} gives the lowest contribution per truck-day (${money(worst.contributionPerTruckDay)}) over ${worst.truckDays} truck-days.` : 'No costed trips.', columns: ['key', 'trips', 'truckDays', 'revenuePerTruckDay', 'contributionPerTruckDay', 'avgTrucks', 'peakTrucks'], rows }; }
    if (/few|thin|reliable|insufficient/.test(q)) { const rows = comp.comparableGroups.filter((g) => g.thin).map((g) => ({ route: g.route, period: g.periodLabel, vehicleClass: g.vehicleClass, bestClient: g.bestClient, bestClientTrips: g.bestClientTrips, clients: g.clientStats.length, trips: g.tripsTotal, benchmarkRate: g.bestAvg })); return { title: 'Benchmarks resting on very few trips', answer: `${rows.length} comparison group${rows.length === 1 ? '' : 's'} have a best-paying client with fewer than ${comp.policy.thresholds.thinBenchmarkTrips} trips; treat their benchmark rates as indicative only.`, columns: ['route', 'period', 'vehicleClass', 'bestClient', 'bestClientTrips', 'clients', 'trips', 'benchmarkRate'], rows }; }
    return null;
  }

  // ------------------------------------------------------------- baseline reconciliation
  function reconcileBaseline(trips, ctx) {
    const base = ctx.ratecomparison; if (!base) return null;
    const comp = comparison(trips, ctx, { period: 'quarter', from: base.scope.from, to: base.scope.to }); const rk = clientRanking(comp, trips, ctx);
    const web = { achieved: comp.headline.achieved, atBestClientAvg: comp.headline.atBestClientAvg, diffAtBestClientAvg: comp.headline.opportunityBestClientAvg, atHighest: comp.headline.atHighest, diffAtHighest: comp.headline.opportunityHighest, trips: comp.scope.trips };
    const headline = ['achieved', 'atBestClientAvg', 'diffAtBestClientAvg', 'atHighest', 'diffAtHighest', 'trips'].map((k) => ({ measure: k, baseline: base.headline[k], web: web[k], difference: round2((web[k] || 0) - (base.headline[k] || 0)) }));
    const byClient = base.byClient.map((b) => { const w = rk.find((r) => norm(r.client) === norm(b.client)); const wTrips = trips.filter((t) => inScope(t, comp.policy, comp.scope) && vehicleClass(t, comp.policy, ctx.assets) && norm(t.client) === norm(b.client)); return { client: b.client, baselineTrips: b.trips, webTrips: wTrips.length, baselineRevenue: b.revenue, webRevenue: round2(wTrips.reduce((s, t) => s + num(t.netSales), 0)), baselineOpportunity: b.diffAtBestClientAvg, webOpportunity: w ? w.opportunity : 0, baselineRateLevel: (base.ranking.find((x) => norm(x.client) === norm(b.client)) || {}).rateLevel || null, webRateLevel: w ? w.rateLevel : null }; });
    const monthsWeb = new Map(); for (const t of trips) if (inScope(t, comp.policy, comp.scope) && vehicleClass(t, comp.policy, ctx.assets)) { const m = String(t.dateDispatched).slice(0, 7); monthsWeb.set(m, (monthsWeb.get(m) || 0) + 1); }
    const byMonth = base.byMonth.map((b) => { const key = monthKeyOf(b.month); return { month: b.month, baselineTrips: b.trips, webTrips: monthsWeb.get(key) || 0, baselineRevenue: b.revenue }; });
    const extraTrips = byMonth.reduce((s, m) => s + Math.max(0, m.webTrips - m.baselineTrips), 0);
    const explanations = [
      `Scope reproduced from the workbook: trips ${base.scope.from} – ${base.scope.to}, selling price excl. VAT, haulage and flat trucks as one class, closed-body and Hiab excluded, quarters, only routes shared by 2+ clients.`,
      extraTrips ? `${extraTrips} trip${extraTrips === 1 ? '' : 's'} were added to the Trip Log after the workbook snapshot (${byMonth.filter((m) => m.webTrips !== m.baselineTrips).map((m) => `${m.month}: ${m.baselineTrips} → ${m.webTrips}`).join('; ')}); they change achieved revenue and the Q3 benchmarks.` : 'Trip counts per month match the workbook snapshot.',
      'Routes are grouped by the application\'s loading-area and destination normalisation (Location Master and alias tables) instead of the workbook\'s manual grouping, so a few route keys differ (e.g. depot-level NBL loading points are kept apart from "Ibadan").',
      (ctx.triplogReconciliation && ctx.triplogReconciliation.differences && ctx.triplogReconciliation.differences.sellingPrice.length) ? `${ctx.triplogReconciliation.differences.sellingPrice.length} selling prices differ between the Setup_Haulage TripLog sheet and the application (listed in the reconciliation); the application values are used and were not changed.` : 'No selling-price differences between the TripLog sheet and the application.',
      'Opportunity figures use the same formulas as the workbook (MAX(0, best client average − client average) × trips; highest rate variant labelled aggressive). Benchmarks resting on fewer than ' + comp.policy.thresholds.thinBenchmarkTrips + ' trips are flagged in the app but were not flagged in the workbook.',
    ];
    return { baseline: base, comp, headline, byClient, byMonth, explanations, webRanking: rk };
  }
  function monthKeyOf(label) { const m = String(label || '').match(/^([A-Za-z]{3})\w*\s+(\d{4})$/); if (!m) return label; const i = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase()); return i < 0 ? label : `${m[2]}-${String(i + 1).padStart(2, '0')}`; }

  // ------------------------------------------------------------- filters shared by the views
  function filterTrips(trips, f, ctx) {
    f = f || {}; const fleet = (ctx && ctx.fleet) || [];
    return (trips || []).filter((t) => {
      const d = String(t.dateDispatched || '').slice(0, 10);
      if (f.from && d < f.from) return false; if (f.to && d > f.to) return false; if (f.month && d.slice(0, 7) !== f.month) return false; if (f.quarter && periodOf(d, 'quarter') !== f.quarter) return false;
      if (f.client && norm(t.client) !== norm(f.client)) return false; if (f.route && compRoute(t).key !== f.route) return false; if (f.plate && P.plateKey(t.plate) !== P.plateKey(f.plate)) return false;
      if (f.vehicleCategory && t.vehicleCategory !== f.vehicleCategory && t.truckBatch !== f.vehicleCategory) return false; if (f.vehicleType && norm(t.vehicleType) !== norm(f.vehicleType)) return false;
      if (f.costCenter && t.costCenter !== f.costCenter) return false; if (f.lob && norm(t.lob) !== norm(f.lob)) return false; if (f.serviceType && t.serviceType !== f.serviceType) return false;
      if (f.station) { const truck = fleet.find((x) => P.plateKey(x.plate) === P.plateKey(t.plate)); const st = (truck && truck.homeStation) || t.loadingState || ''; if (norm(st) !== norm(f.station)) return false; }
      return true;
    });
  }

  return { DEFAULT_POLICY, policyOf, LOADING_AREAS, loadingArea, destName, compRoute, periodOf, periodLabel, vehicleClass, inScope, comparison, clientRanking, workbookVerdict, routeGaps, costingOf, truckDays, turnaroundLookup, tripsPerTruckPerMonth, truckDayStats, truckRequirement, STATUSES, SEVERITIES, VERDICTS, EXCEPTION_TYPES, EXCEPTION_STATUSES, FINDING_STATUSES, coveredByException, tripAudit, actualMargin, auditTrips, requestAudit, estimateCost, nextExceptionNo, nextFindingNo, canReview, canApprove, exceptionError, exceptionStamp, findingError, recommendations, QUESTIONS, assistant, reconcileBaseline, filterTrips };
});
