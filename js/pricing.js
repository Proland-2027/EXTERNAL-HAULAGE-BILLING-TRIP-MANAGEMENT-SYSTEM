/*
 * pricing.js — Billing engine for the External Haulage Billing & Trip Management System.
 *
 * Pure functions, no DOM. Works in the browser (global `Pricing`) and in Node (module.exports)
 * so the same code that prices a bill in the UI is what the test-suite exercises.
 *
 * Concepts
 * --------
 * Party        : who is billed / who hauled. Either the built-in "INTERNAL" fleet or a contractor id.
 * Price list   : a dated, versioned tariff for ONE party (e.g. "Billing Price List 2026" for INTERNAL,
 *                "Kwame Haulage 2026" for a contractor). Each line is keyed by route + vehicle class.
 * MOQ          : Minimum Order Quantity per trip. If a trip carries less than the MOQ the trip is still
 *                billed at the MOQ quantity (billableQty = max(actualQty, MOQ)).
 * Contractor   : amount = billableQty × ratePerUnit            (unit TONNE / LITRE / PALLET / CBM)
 *                amount = ratePerUnit                           (unit TRIP — flat rate, MOQ not applied)
 * Internal     : amount = Fixed + Variable + Fixed-Variable + Diesel
 *                  Fixed           = fixedCost                      (per trip: driver wages, insurance, depreciation)
 *                  Variable        = variableCostPerKm × km         (per km: tyres, lubricants, wear)
 *                  Fixed-Variable  = fixedVariableCost              (semi-variable per trip: tolls, maintenance, allowances)
 *                  Diesel          = dieselLitres × dieselPricePerLitre
 *                  dieselLitres    = trip.dieselLitres (actual) if logged, else the line's standard litres
 *                  km              = trip.distanceKm if logged, else the route's distance
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pricing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INTERNAL = 'INTERNAL';
  const ANY_CLASS = 'ANY';
  const COMPONENTS = ['fixed', 'variable', 'fixedVariable', 'diesel'];
  const COMPONENT_LABELS = {
    fixed: 'Fixed cost',
    variable: 'Variable cost',
    fixedVariable: 'Fixed-variable cost',
    diesel: 'Diesel',
  };

  const num = (v, d = 0) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : d;
  };
  const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const round3 = (v) => Math.round((num(v) + Number.EPSILON) * 1000) / 1000;

  /** Period helpers: period is "YYYY-MM". */
  function periodOf(dateStr) {
    return String(dateStr || '').slice(0, 7);
  }
  function previousPeriod(period) {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  function periodLabel(period) {
    if (!period) return '';
    const [y, m] = period.split('-').map(Number);
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[m - 1]} ${y}`;
  }

  /** Is a price list valid for a given date (inclusive bounds; blank = open)? */
  function listCoversDate(list, dateStr) {
    if (list.validFrom && dateStr < list.validFrom) return false;
    if (list.validTo && dateStr > list.validTo) return false;
    return true;
  }

  /**
   * Pick the price list for a party and a period. Prefers ACTIVE lists that cover the first day of
   * the period; falls back to the newest ACTIVE list for the party; then any list for the party.
   */
  function pickPriceList(priceLists, partyId, period) {
    const mine = (priceLists || []).filter((l) => l.partyId === partyId);
    if (!mine.length) return null;
    const firstDay = `${period}-01`;
    const active = mine.filter((l) => (l.status || 'ACTIVE') === 'ACTIVE');
    const covering = active.filter((l) => listCoversDate(l, firstDay));
    const byNewest = (a, b) => String(b.validFrom || '').localeCompare(String(a.validFrom || ''));
    if (covering.length) return covering.sort(byNewest)[0];
    if (active.length) return active.sort(byNewest)[0];
    return mine.sort(byNewest)[0];
  }

  /** Find the tariff line for a route + vehicle class. Exact class match wins, then the ANY line. */
  function resolveLine(priceList, routeId, vehicleClass) {
    if (!priceList || !Array.isArray(priceList.lines)) return null;
    const lines = priceList.lines.filter((l) => l.routeId === routeId);
    const exact = lines.find((l) => l.vehicleClass && l.vehicleClass !== ANY_CLASS && l.vehicleClass === vehicleClass);
    if (exact) return exact;
    return lines.find((l) => !l.vehicleClass || l.vehicleClass === ANY_CLASS) || null;
  }

  /** MOQ logic: the billable quantity can never be below the MOQ. */
  function applyMoq(actualQty, moq) {
    const qty = Math.max(0, num(actualQty));
    const m = Math.max(0, num(moq));
    const billable = Math.max(qty, m);
    return {
      actualQty: round3(qty),
      moq: round3(m),
      billableQty: round3(billable),
      moqApplied: m > 0 && qty < m,
      moqTopUp: round3(billable - qty),
    };
  }

  /**
   * Price a single trip against a price list.
   * Returns a fully resolved line (a snapshot — safe to store on a billing).
   */
  function priceTrip(trip, priceList, route, opts = {}) {
    const line = resolveLine(priceList, trip.routeId, trip.vehicleClass);
    const base = {
      tripId: trip.id,
      date: trip.date,
      waybill: trip.waybill || '',
      vehicleNo: trip.vehicleNo || '',
      vehicleClass: trip.vehicleClass || '',
      driver: trip.driver || '',
      routeId: trip.routeId,
      routeName: route ? routeName(route) : trip.routeId,
      product: trip.product || '',
      unit: (line && line.unit) || trip.unit || 'TONNE',
      priceListId: priceList ? priceList.id : null,
      priceListLineId: line ? line.id : null,
      errors: [],
    };
    if (!priceList) return { ...base, ...applyMoq(trip.qty, 0), amount: 0, errors: ['No price list for this party'] };
    if (!line) return { ...base, ...applyMoq(trip.qty, 0), amount: 0, errors: ['No tariff line for route/vehicle class'] };

    const isInternal = priceList.partyId === INTERNAL;
    const km = num(trip.distanceKm) > 0 ? num(trip.distanceKm) : num(route && route.distanceKm);
    const moq = line.unit === 'TRIP' ? 0 : line.moq;
    const q = applyMoq(line.unit === 'TRIP' ? 1 : trip.qty, moq);

    if (!isInternal) {
      const rate = num(line.ratePerUnit);
      const amount = round2(line.unit === 'TRIP' ? rate : q.billableQty * rate);
      return {
        ...base,
        ...q,
        distanceKm: km,
        rate,
        amount,
        moqTopUpValue: round2(line.unit === 'TRIP' ? 0 : q.moqTopUp * rate),
        costPerUnit: q.billableQty ? round2(amount / q.billableQty) : 0,
      };
    }

    const dieselPrice = num(opts.dieselPricePerLitre, num(priceList.dieselPricePerLitre));
    const dieselLitres = num(trip.dieselLitres) > 0 ? num(trip.dieselLitres) : num(line.dieselLitres);
    const components = {
      fixed: round2(line.fixedCost),
      variable: round2(num(line.variableCostPerKm) * km),
      fixedVariable: round2(line.fixedVariableCost),
      diesel: round2(dieselLitres * dieselPrice),
    };
    const amount = round2(COMPONENTS.reduce((s, k) => s + components[k], 0));
    return {
      ...base,
      ...q,
      distanceKm: km,
      dieselLitres: round2(dieselLitres),
      dieselPricePerLitre: dieselPrice,
      dieselStandardLitres: num(line.dieselLitres),
      dieselVarianceLitres: round2(dieselLitres - num(line.dieselLitres)),
      components,
      rate: null,
      amount,
      moqTopUpValue: 0,
      costPerUnit: q.billableQty ? round2(amount / q.billableQty) : 0,
      costPerKm: km ? round2(amount / km) : 0,
    };
  }

  function routeName(route) {
    if (!route) return '';
    return route.name || `${route.origin} → ${route.destination}`;
  }

  /** Billable trips for a party in a period (completed, not yet attached to another billing). */
  function selectTrips(trips, partyId, period, { excludeBilled = true, billingId = null } = {}) {
    return (trips || [])
      .filter((t) => t.partyId === partyId)
      .filter((t) => periodOf(t.date) === period)
      .filter((t) => (t.status || 'COMPLETED') === 'COMPLETED')
      .filter((t) => !excludeBilled || !t.billingId || t.billingId === billingId)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.waybill).localeCompare(String(b.waybill)));
  }

  /**
   * Build a complete billing (the "Billing format") for one party and one period.
   * Totals, taxes, MOQ summary and component breakdown are all computed here.
   */
  function buildBilling({ partyId, period, priceList, trips, routes, settings = {}, number = '', notes = '' }) {
    const routeById = Object.fromEntries((routes || []).map((r) => [r.id, r]));
    const lines = (trips || []).map((t) => priceTrip(t, priceList, routeById[t.routeId]));
    const isInternal = partyId === INTERNAL;

    const subtotal = round2(lines.reduce((s, l) => s + num(l.amount), 0));
    const vatRate = num(settings.vatRate);
    const levyRate = num(settings.levyRate);
    const taxable = isInternal && settings.taxInternal === false ? 0 : subtotal;
    const levyAmount = round2(taxable * levyRate / 100);
    const vatAmount = round2((taxable + levyAmount) * vatRate / 100);
    const total = round2(subtotal + levyAmount + vatAmount);

    const components = COMPONENTS.reduce((acc, k) => {
      acc[k] = round2(lines.reduce((s, l) => s + (l.components ? num(l.components[k]) : 0), 0));
      return acc;
    }, {});

    const actualQty = round3(lines.reduce((s, l) => s + num(l.actualQty), 0));
    const billableQty = round3(lines.reduce((s, l) => s + num(l.billableQty), 0));
    const distanceKm = round2(lines.reduce((s, l) => s + num(l.distanceKm), 0));
    const dieselLitres = round2(lines.reduce((s, l) => s + num(l.dieselLitres), 0));
    const moqTrips = lines.filter((l) => l.moqApplied).length;
    const moqTopUp = round3(lines.reduce((s, l) => s + num(l.moqTopUp), 0));
    const moqTopUpValue = round2(lines.reduce((s, l) => s + num(l.moqTopUpValue), 0));

    return {
      number,
      partyId,
      period,
      priceListId: priceList ? priceList.id : null,
      priceListName: priceList ? priceList.name : '',
      currency: (priceList && priceList.currency) || settings.currency || 'GHS',
      status: 'DRAFT',
      notes,
      lines,
      summary: {
        trips: lines.length,
        tripsWithErrors: lines.filter((l) => l.errors && l.errors.length).length,
        actualQty,
        billableQty,
        distanceKm,
        dieselLitres,
        moqTrips,
        moqTopUp,
        moqTopUpValue,
        components,
        subtotal,
        levyRate,
        levyAmount,
        vatRate,
        vatAmount,
        total,
        costPerUnit: billableQty ? round2(subtotal / billableQty) : 0,
        costPerTrip: lines.length ? round2(subtotal / lines.length) : 0,
        costPerKm: distanceKm ? round2(subtotal / distanceKm) : 0,
      },
    };
  }

  /** Generate a billing number like BILL-2026-09-INT-001 or BILL-2026-09-KHL-002. */
  function nextBillingNumber(existing, partyCode, period) {
    const prefix = `BILL-${period}-${partyCode}-`;
    const seq = (existing || [])
      .map((b) => b.number)
      .filter((n) => n && n.startsWith(prefix))
      .map((n) => parseInt(n.slice(prefix.length), 10) || 0)
      .reduce((m, n) => Math.max(m, n), 0);
    return `${prefix}${String(seq + 1).padStart(3, '0')}`;
  }

  // ---------------------------------------------------------------------------------------------
  // Monthly comparison / In-house analysis
  // ---------------------------------------------------------------------------------------------

  function emptyAgg() {
    return {
      trips: 0, actualQty: 0, billableQty: 0, distanceKm: 0, dieselLitres: 0, amount: 0,
      moqTrips: 0, moqTopUp: 0, moqTopUpValue: 0,
      components: { fixed: 0, variable: 0, fixedVariable: 0, diesel: 0 },
    };
  }
  function addLine(agg, l) {
    agg.trips += 1;
    agg.actualQty += num(l.actualQty);
    agg.billableQty += num(l.billableQty);
    agg.distanceKm += num(l.distanceKm);
    agg.dieselLitres += num(l.dieselLitres);
    agg.amount += num(l.amount);
    if (l.moqApplied) agg.moqTrips += 1;
    agg.moqTopUp += num(l.moqTopUp);
    agg.moqTopUpValue += num(l.moqTopUpValue);
    if (l.components) COMPONENTS.forEach((k) => (agg.components[k] += num(l.components[k])));
  }
  function finishAgg(agg) {
    const out = { ...agg, components: { ...agg.components } };
    ['actualQty', 'billableQty', 'distanceKm', 'dieselLitres', 'amount', 'moqTopUp', 'moqTopUpValue'].forEach((k) => (out[k] = round2(out[k])));
    COMPONENTS.forEach((k) => (out.components[k] = round2(out.components[k])));
    out.costPerUnit = out.billableQty ? round2(out.amount / out.billableQty) : 0;
    out.costPerTrip = out.trips ? round2(out.amount / out.trips) : 0;
    out.costPerKm = out.distanceKm ? round2(out.amount / out.distanceKm) : 0;
    return out;
  }

  /**
   * Lines for a party in a period: taken from LOGGED billings when they exist (status not VOID),
   * otherwise priced on the fly against the party's price list and flagged `estimated`.
   */
  function periodLines({ partyId, period, billings, trips, priceLists, routes }) {
    const logged = (billings || []).filter((b) => b.partyId === partyId && b.period === period && b.status !== 'VOID');
    if (logged.length) {
      return { lines: logged.flatMap((b) => b.lines || []), source: 'LOGGED', billings: logged, estimated: false };
    }
    const list = pickPriceList(priceLists, partyId, period);
    const routeById = Object.fromEntries((routes || []).map((r) => [r.id, r]));
    const sel = selectTrips(trips, partyId, period, { excludeBilled: false });
    return { lines: sel.map((t) => priceTrip(t, list, routeById[t.routeId])), source: sel.length ? 'ESTIMATED' : 'NONE', billings: [], estimated: true, priceList: list };
  }

  /**
   * The monthly comparison report ("In-house Analysis").
   *
   * For a period it compares, per route and in total:
   *   • Contractor actuals (all contractors, or one when `contractorId` given) vs Internal actuals.
   *   • Benchmarks: internal trips re-priced at the contractor tariff ("what the contractor would have
   *     charged") and contractor trips re-priced at the internal tariff ("what in-house would have cost").
   *   • Month-over-month movement versus the previous period.
   */
  function buildComparison({ period, trips, billings, priceLists, routes, contractors, contractorId = null }) {
    const routeById = Object.fromEntries((routes || []).map((r) => [r.id, r]));
    const contractorIds = (contractors || []).map((c) => c.id).filter((id) => !contractorId || id === contractorId);
    const internalList = pickPriceList(priceLists, INTERNAL, period);
    const contractorListFor = (id) => pickPriceList(priceLists, id, period);
    const benchmarkContractorList = contractorId ? contractorListFor(contractorId) : (contractorIds.map(contractorListFor).find(Boolean) || null);

    const internal = periodLines({ partyId: INTERNAL, period, billings, trips, priceLists, routes });
    const contractorSets = contractorIds.map((id) => ({ id, ...periodLines({ partyId: id, period, billings, trips, priceLists, routes }) }));
    const contractorLines = contractorSets.flatMap((s) => s.lines.map((l) => ({ ...l, partyId: s.id })));

    const tripById = Object.fromEntries((trips || []).map((t) => [t.id, t]));
    const byRoute = {};
    const ensure = (routeId) => {
      if (!byRoute[routeId]) {
        byRoute[routeId] = {
          routeId,
          routeName: routeName(routeById[routeId]) || routeId,
          distanceKm: num(routeById[routeId] && routeById[routeId].distanceKm),
          internal: emptyAgg(),
          contractor: emptyAgg(),
          internalAtContractorRate: 0,
          contractorAtInternalCost: 0,
        };
      }
      return byRoute[routeId];
    };

    internal.lines.forEach((l) => {
      const r = ensure(l.routeId);
      addLine(r.internal, l);
      const t = tripById[l.tripId] || { ...l, qty: l.actualQty };
      const bench = priceTrip({ ...t, qty: t.qty != null ? t.qty : l.actualQty }, benchmarkContractorList, routeById[l.routeId]);
      r.internalAtContractorRate += num(bench.amount);
    });
    contractorLines.forEach((l) => {
      const r = ensure(l.routeId);
      addLine(r.contractor, l);
      const t = tripById[l.tripId] || { ...l, qty: l.actualQty };
      const bench = priceTrip({ ...t, qty: t.qty != null ? t.qty : l.actualQty, dieselLitres: 0 }, internalList, routeById[l.routeId]);
      r.contractorAtInternalCost += num(bench.amount);
    });

    const rows = Object.values(byRoute).map((r) => {
      const internalAgg = finishAgg(r.internal);
      const contractorAgg = finishAgg(r.contractor);
      const internalAtContractorRate = round2(r.internalAtContractorRate);
      const contractorAtInternalCost = round2(r.contractorAtInternalCost);
      return {
        routeId: r.routeId,
        routeName: r.routeName,
        distanceKm: r.distanceKm,
        internal: internalAgg,
        contractor: contractorAgg,
        internalAtContractorRate,
        inhouseSaving: round2(internalAtContractorRate - internalAgg.amount),
        contractorAtInternalCost,
        outsourcingPremium: round2(contractorAgg.amount - contractorAtInternalCost),
        costPerUnitVariance: round2(contractorAgg.costPerUnit - internalAgg.costPerUnit),
        costPerUnitVariancePct: internalAgg.costPerUnit ? round2(((contractorAgg.costPerUnit - internalAgg.costPerUnit) / internalAgg.costPerUnit) * 100) : 0,
      };
    }).sort((a, b) => a.routeName.localeCompare(b.routeName));

    const totals = {
      internal: finishAgg(rows.reduce((acc, r) => { addAgg(acc, r.internal); return acc; }, emptyAgg())),
      contractor: finishAgg(rows.reduce((acc, r) => { addAgg(acc, r.contractor); return acc; }, emptyAgg())),
      internalAtContractorRate: round2(rows.reduce((s, r) => s + r.internalAtContractorRate, 0)),
      contractorAtInternalCost: round2(rows.reduce((s, r) => s + r.contractorAtInternalCost, 0)),
    };
    totals.inhouseSaving = round2(totals.internalAtContractorRate - totals.internal.amount);
    totals.outsourcingPremium = round2(totals.contractor.amount - totals.contractorAtInternalCost);
    totals.combinedAmount = round2(totals.internal.amount + totals.contractor.amount);
    totals.combinedQty = round2(totals.internal.billableQty + totals.contractor.billableQty);
    totals.internalShareQty = totals.combinedQty ? round2((totals.internal.billableQty / totals.combinedQty) * 100) : 0;
    totals.costPerUnitVariance = round2(totals.contractor.costPerUnit - totals.internal.costPerUnit);
    totals.costPerUnitVariancePct = totals.internal.costPerUnit ? round2((totals.costPerUnitVariance / totals.internal.costPerUnit) * 100) : 0;

    return {
      period,
      periodLabel: periodLabel(period),
      contractorId,
      sources: {
        internal: internal.source,
        contractor: contractorSets.length ? (contractorSets.every((s) => s.source === 'NONE') ? 'NONE' : contractorSets.some((s) => s.source === 'ESTIMATED' && s.lines.length) ? 'ESTIMATED' : 'LOGGED') : 'NONE',
      },
      priceLists: { internal: internalList ? internalList.name : null, contractor: benchmarkContractorList ? benchmarkContractorList.name : null },
      rows,
      totals,
    };
  }
  function addAgg(acc, agg) {
    acc.trips += agg.trips; acc.actualQty += agg.actualQty; acc.billableQty += agg.billableQty;
    acc.distanceKm += agg.distanceKm; acc.dieselLitres += agg.dieselLitres; acc.amount += agg.amount;
    acc.moqTrips += agg.moqTrips; acc.moqTopUp += agg.moqTopUp; acc.moqTopUpValue += agg.moqTopUpValue;
    COMPONENTS.forEach((k) => (acc.components[k] += agg.components[k]));
  }

  /** Current period vs previous period, with deltas on the headline metrics. */
  function buildMonthlyComparison(args) {
    const current = buildComparison(args);
    const previous = buildComparison({ ...args, period: previousPeriod(args.period) });
    const pick = (c) => ({
      internalAmount: c.totals.internal.amount,
      contractorAmount: c.totals.contractor.amount,
      combinedAmount: c.totals.combinedAmount,
      internalTrips: c.totals.internal.trips,
      contractorTrips: c.totals.contractor.trips,
      internalQty: c.totals.internal.billableQty,
      contractorQty: c.totals.contractor.billableQty,
      internalCostPerUnit: c.totals.internal.costPerUnit,
      contractorCostPerUnit: c.totals.contractor.costPerUnit,
      internalCostPerKm: c.totals.internal.costPerKm,
      dieselLitres: c.totals.internal.dieselLitres,
      dieselCost: c.totals.internal.components.diesel,
      inhouseSaving: c.totals.inhouseSaving,
      moqTopUpValue: c.totals.contractor.moqTopUpValue,
    });
    const cur = pick(current), prev = pick(previous);
    const deltas = {};
    Object.keys(cur).forEach((k) => {
      deltas[k] = { current: cur[k], previous: prev[k], change: round2(cur[k] - prev[k]), changePct: prev[k] ? round2(((cur[k] - prev[k]) / Math.abs(prev[k])) * 100) : null };
    });
    return { current, previous, deltas };
  }

  return {
    INTERNAL, ANY_CLASS, COMPONENTS, COMPONENT_LABELS,
    num, round2, round3, periodOf, previousPeriod, periodLabel, routeName,
    listCoversDate, pickPriceList, resolveLine, applyMoq, priceTrip, selectTrips,
    buildBilling, nextBillingNumber, periodLines, buildComparison, buildMonthlyComparison,
  };
});
