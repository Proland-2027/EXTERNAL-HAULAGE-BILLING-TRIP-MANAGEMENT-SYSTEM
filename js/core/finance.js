/*
 * Finance engine: chart-of-accounts mapping (expense type → GL account), cost-center validation, the derived ledger of
 * requested / approved / paid amounts from every operational document, posting validation (no posting without the
 * mandatory mappings), rate-card trip costing, trip profit & loss (actual costs where recorded, allocations shown as such),
 * profitability summaries, the financial-closure rule and the finance / workshop questions of the management assistant.
 * Pure functions shared by browser, server and tests. Nothing here approves, pays or posts by itself.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./planning.js'), require('./dispatch.js'), require('./workshop.js'));
  else { root.HB = root.HB || {}; root.HB.finance = factory(root.HB.engine, root.HB.planning, root.HB.dispatch, root.HB.workshop); }
})(typeof self !== 'undefined' ? self : this, function (E, P, D, WS) {
  'use strict';
  const num = E.num, norm = E.norm, clean = E.clean, round2 = E.round2;

  const DEFAULT_ACCOUNTMAP = { categoryAccounts: {}, dieselAccounts: { default: '6103009', hiab: '6103008' }, roadAccount: '6101027', tplAccounts: { default: '6105001', crane: '6105002', staff: '6105003' }, maintenanceAccounts: { default: '6102010', hiab: '6102009', tyre: '6102028' }, revenueAccounts: {} };
  const LINE_KINDS = ['diesel', 'road', 'extra', 'tpl', 'maintenance', 'revenue'];
  const STAGES = ['requested', 'approved', 'paid', 'posted'];
  const mapOf = (ctx) => Object.assign({}, DEFAULT_ACCOUNTMAP, (ctx && ctx.accountmap) || {});
  /** Diesel price per litre lives in the fleet-planning setup (Settings → Fleet planning); null when not set. */
  const dieselPriceOf = (planning) => num((P.setupOf(planning) || {}).dieselPrice);
  const isHiab = (x) => /hiab/i.test([x && x.vehicleType, x && x.costCenterName, x && x.assetType, x && x.bodySize, x && x.lob].filter(Boolean).join(' '));

  /** GL account for an expense kind. Returns { id, number, name, pending, missing } — missing when nothing is mapped. */
  function accountFor(kind, opts, ctx) {
    opts = opts || {}; const m = mapOf(ctx); const accounts = (ctx && ctx.accounts) || [];
    let id = null;
    if (kind === 'diesel') id = opts.isCng ? m.dieselAccounts.cng : opts.isHiab ? m.dieselAccounts.hiab : m.dieselAccounts.default;
    else if (kind === 'road') id = m.roadAccount;
    else if (kind === 'extra') id = m.categoryAccounts[opts.category] || Object.entries(m.categoryAccounts).find(([k]) => norm(k) === norm(opts.category || ''))?.[1] || null;
    else if (kind === 'tpl') id = /crane|heavy/i.test(opts.equipment || '') ? m.tplAccounts.crane : opts.staff ? m.tplAccounts.staff : m.tplAccounts.default;
    else if (kind === 'maintenance') id = /tyre/i.test(opts.itemClass || '') ? m.maintenanceAccounts.tyre : opts.isHiab ? m.maintenanceAccounts.hiab : m.maintenanceAccounts.default;
    else if (kind === 'revenue') id = m.revenueAccounts[opts.lob] || m.revenueAccounts.default || null;
    const acc = id ? accounts.find((a) => a.id === id || a.accountNumber === id) : null;
    if (!id) return { id: null, number: '', name: '', pending: false, missing: `No general-ledger account mapped for ${kind}${opts.category ? ' / ' + opts.category : ''}${kind === 'revenue' ? ' (revenue accounts not supplied)' : ''}` };
    if (!acc) return { id, number: /^\d+$/.test(id) ? id : '', name: '', pending: !/^\d+$/.test(id), missing: /^\d+$/.test(id) ? '' : `Account "${id}" has no GL number yet` };
    return { id: acc.id, number: acc.accountNumber || '', name: acc.name, pending: !!acc.pendingAccountNumber, missing: acc.pendingAccountNumber ? `Account "${acc.name}" is pending a GL number` : acc.active === false ? `Account ${acc.accountNumber} is inactive` : '' };
  }
  /** Cost center of a trip (asset master) validated against the cost center master. */
  function costCenterOf(trip, ctx) {
    const asset = E.assetFor(trip && trip.plate, (ctx && ctx.assets) || []); const id = (trip && trip.costCenter) || (asset && asset.costCenter) || '';
    const cc = (ctx && ctx.costcenters || []).find((c) => c.id === id) || null;
    return { id, name: cc ? cc.name : (asset && asset.costCenterName) || '', valid: !!cc && cc.active !== false, missing: !id ? 'No cost center on the vehicle' : !cc ? `Cost center ${id} is not in the master` : cc.active === false ? `Cost center ${id} is inactive` : '' };
  }

  // ------------------------------------------------------------- derived ledger
  const tripOf = (ctx, id) => (ctx.trips || []).find((t) => t.id === id) || null;
  function line(ctx, base) {
    const trip = base.tripLogId ? tripOf(ctx, base.tripLogId) : null; const asset = E.assetFor(base.plate || (trip && trip.plate), ctx.assets || []);
    const cc = trip ? costCenterOf(trip, ctx) : { id: base.costCenter || (asset && asset.costCenter) || '', valid: !!(ctx.costcenters || []).find((c) => c.id === (base.costCenter || (asset && asset.costCenter))), missing: base.costCenter || (asset && asset.costCenter) ? '' : 'No cost center' };
    const lob = base.lob || (trip && trip.lob) || '';
    const acc = base.account || accountFor(base.kind, Object.assign({ isHiab: isHiab(asset) || isHiab(trip), lob }, base.accountOpts || {}), ctx);
    const missing = []; if (!acc.id || acc.missing) missing.push(acc.missing || 'GL account'); if (!cc.id || cc.missing) missing.push(cc.missing || 'Cost center'); if (!lob && base.kind !== 'maintenance') missing.push('LOB');
    const id = `${base.kind}:${base.sourceId}:${base.stage}${base.sub ? ':' + base.sub : ''}`; const posted = (ctx.postings || []).find((p) => p.lineId === id) || null;
    return Object.assign({ id, glAccount: acc.number || '', accountId: acc.id || '', accountName: acc.name || '', costCenter: cc.id, costCenterName: cc.name, lob, tripId: trip ? trip.journeyPlanId : base.tripId || '', plate: base.plate || (trip && trip.plate) || '', assetCode: asset ? asset.assetCode : (trip && trip.assetCode) || '', client: base.client || (trip && trip.client) || '', missing, ready: !missing.length, posted: !!posted, posting: posted }, base);
  }
  /** Every financial amount with its stage: requested / approved / paid (issued) for expenses, issued for revenue. */
  function ledgerLines(ctx) {
    ctx = ctx || {}; const out = []; const price = dieselPriceOf(ctx.planning);
    for (const d of ctx.dieselreqs || []) { if (d.rejectedAt) continue; const t = D.slipTotals(d); const trip = tripOf(ctx, d.tripLogId); const cng = /cng/i.test((trip && trip.vehicleCategory) || '') || /^nbl/i.test(d.plate || '') && /cng/i.test(d.category || '');
      const base = { kind: 'diesel', sourceCollection: 'dieselreqs', sourceId: d.id, sourceNo: d.number, tripLogId: d.tripLogId, plate: d.plate, client: d.client, accountOpts: { isCng: cng, isHiab: /hiab/i.test(d.category || '') }, unit: 'L' };
      if (d.submittedAt) out.push(line(ctx, Object.assign({}, base, { stage: 'requested', date: (d.submittedAt || d.preparedAt || '').slice(0, 10), qty: num(d.approvedQty) || 0, amount: price === null ? null : round2((num(d.approvedQty) || 0) * price), note: price === null ? 'Diesel price not set in Settings' : `${num(d.approvedQty) || 0} L × ₦${price}` })));
      if (d.opsApprovedAt) out.push(line(ctx, Object.assign({}, base, { stage: 'approved', date: d.opsApprovedAt.slice(0, 10), qty: t.approved, amount: price === null ? null : round2(t.approved * price), approvalRef: `${d.number} ops ${d.opsApprovedBy}` })));
      for (const i of d.issues || []) out.push(line(ctx, Object.assign({}, base, { stage: 'paid', sub: i.id, date: (i.at || '').slice(0, 10), qty: num(i.qty) || 0, amount: price === null ? null : round2((num(i.qty) || 0) * price), approvalRef: `${d.number}${i.ref ? ' · ' + i.ref : ''}`, note: `${i.qty} L issued at ${i.station || d.station || 'station'} by ${i.by}` })));
    }
    for (const r of ctx.roadslips || []) { if (r.rejectedAt) continue; const t = D.slipTotals(r); const base = { kind: 'road', sourceCollection: 'roadslips', sourceId: r.id, sourceNo: r.number, tripLogId: r.tripLogId, plate: r.plate, client: r.client };
      if (r.submittedAt) out.push(line(ctx, Object.assign({}, base, { stage: 'requested', date: (r.submittedAt || r.preparedAt || '').slice(0, 10), amount: num(r.approvedQty) || 0 })));
      if (r.opsApprovedAt && (!r.financeRequired || r.financeApprovedAt)) out.push(line(ctx, Object.assign({}, base, { stage: 'approved', date: (r.financeApprovedAt || r.opsApprovedAt).slice(0, 10), amount: t.approved, approvalRef: `${r.number} ops ${r.opsApprovedBy}${r.financeApprovedBy ? ' · finance ' + r.financeApprovedBy : ''}` })));
      for (const i of r.issues || []) out.push(line(ctx, Object.assign({}, base, { stage: 'paid', sub: i.id, date: (i.at || '').slice(0, 10), amount: num(i.qty) || 0, approvalRef: `${r.number}${i.ref ? ' · ' + i.ref : ''}`, note: `${i.method || ''} by ${i.by}` })));
    }
    for (const x of ctx.extraexpenses || []) { const base = { kind: 'extra', sourceCollection: 'extraexpenses', sourceId: x.id, sourceNo: x.id, tripLogId: x.tripLogId, plate: x.plate, client: x.client, category: x.category, incidentId: x.incidentId || '', accountOpts: { category: x.category }, account: x.glAccount ? { id: x.glAccount, number: /^\d+$/.test(x.glAccount) ? x.glAccount : '', name: x.glAccountName || '', pending: !/^\d+$/.test(x.glAccount), missing: '' } : null };
      out.push(line(ctx, Object.assign({}, base, { stage: 'requested', date: (x.requestedAt || '').slice(0, 10), amount: num(x.amountRequested) || 0 })));
      if (['Approved', 'Paid'].includes(x.status)) out.push(line(ctx, Object.assign({}, base, { stage: 'approved', date: (x.decidedAt || '').slice(0, 10), amount: num(x.approvedAmount) || 0, approvalRef: `${x.id} ${x.decidedBy}` })));
      if (x.status === 'Paid') out.push(line(ctx, Object.assign({}, base, { stage: 'paid', date: (x.paidAt || '').slice(0, 10), amount: num(x.approvedAmount) || 0, approvalRef: `${x.id} ${x.decidedBy}${x.paymentRef ? ' · ' + x.paymentRef : ''}`, note: `${x.paymentMethod || ''} by ${x.paidBy}` })));
    }
    for (const r of ctx.requests || []) { const t = r.tpl; if (!t || !t.contractorName) continue; const trips = (ctx.trips || []).filter((x) => x.requestId === r.id); const equipment = t.equipmentType || r.vehicleType;
      for (const trip of trips) { const base = { kind: 'tpl', sourceCollection: 'requests', sourceId: `${r.id}:${trip.id}`, sourceNo: r.id, tripLogId: trip.id, plate: trip.plate, client: r.client, lob: trip.lob || E.LOB_DEFAULT_3PL, accountOpts: { equipment }, costCenter: trip.costCenter || '' };
        if (num(t.contractorQuote) !== null) out.push(line(ctx, Object.assign({}, base, { stage: 'requested', date: (t.quotesRequestedAt || r.submittedAt || '').slice(0, 10), amount: num(t.contractorQuote) })));
        if (t.costApprovedAt) out.push(line(ctx, Object.assign({}, base, { stage: 'approved', date: t.costApprovedAt.slice(0, 10), amount: num(t.approvedCost) || 0, approvalRef: `${r.id} cost approved by ${t.costApprovedBy}` })));
        if (t.contractorPaidAt && trips.length) out.push(line(ctx, Object.assign({}, base, { stage: 'paid', date: t.contractorPaidAt.slice(0, 10), amount: round2((num(t.contractorPaidAmount) || 0) / trips.length), approvalRef: `${r.id} · ${t.contractorInvoiceNo || 'contractor invoice'}${t.contractorPaidRef ? ' · ' + t.contractorPaidRef : ''}`, note: trips.length > 1 ? `Contractor payment ${t.contractorPaidAmount} split over ${trips.length} trips` : '' })));
      } }
    for (const j of ctx.jobcards || []) { const asset = E.assetFor(j.plate, ctx.assets || []); const costs = WS ? WS.jobCosts(j, ctx.stockmoves || []) : { labour: 0, parts: 0, external: 0, total: 0 };
      const base = { kind: 'maintenance', sourceCollection: 'jobcards', sourceId: j.id, sourceNo: j.number, tripLogId: j.tripLogId || '', plate: j.plate, costCenter: j.costCenter || (asset && asset.costCenter) || '', lob: j.lob || '', accountOpts: { isHiab: isHiab(asset) || /hiab/i.test(j.breakdownCategory || '') } };
      if (['Awaiting Approval', 'Approved', 'Parts Issued', 'Under Repair', 'Quality Inspection', 'Released'].includes(j.status) && (num(j.estimatedCost) !== null)) out.push(line(ctx, Object.assign({}, base, { stage: 'requested', date: (j.enteredAt || j.createdAt || '').slice(0, 10), amount: num(j.estimatedCost) })));
      if (j.approvedAt) out.push(line(ctx, Object.assign({}, base, { stage: 'approved', date: j.approvedAt.slice(0, 10), amount: num(j.approvedCost) !== null ? num(j.approvedCost) : num(j.estimatedCost) || 0, approvalRef: `${j.number} approved by ${j.approvedBy}` })));
      for (const m of (ctx.stockmoves || []).filter((x) => x.jobCardId === j.id && x.type === 'issue' && !x.voidedAt)) { const item = (ctx.items || []).find((i) => i.id === m.itemId); out.push(line(ctx, Object.assign({}, base, { stage: 'paid', sub: m.id, date: (m.at || '').slice(0, 10), amount: round2(Math.abs(num(m.qty) || 0) * (num(m.unitCost) || 0)), accountOpts: Object.assign({}, base.accountOpts, { itemClass: item ? item.itemClass : '' }), approvalRef: `${j.number} · ${m.number}`, note: `${m.qty} × ${m.itemId}${item ? ' ' + item.description : ''}` }))); }
      if (j.status === 'Released' && (costs.labour || costs.external)) out.push(line(ctx, Object.assign({}, base, { stage: 'paid', sub: 'labour', date: (j.releasedAt || '').slice(0, 10), amount: round2(costs.labour + costs.external), approvalRef: `${j.number} released by ${j.releasedBy}`, note: `Labour ${costs.labour} + external ${costs.external}` })));
    }
    for (const inv of ctx.invoices || []) { if (inv.type === 'credit' || !inv.issuedAt || inv.status === 'Void') continue; const mine = (ctx.trips || []).filter((t) => t.invoiceId === inv.id);
      for (const t of mine) out.push(line(ctx, { kind: 'revenue', stage: 'paid', sourceCollection: 'invoices', sourceId: `${inv.id}:${t.id}`, sourceNo: inv.number, tripLogId: t.id, plate: t.plate, client: t.client, lob: t.lob, accountOpts: { lob: t.lob }, date: inv.issuedAt.slice(0, 10), amount: num(t.netSales) || 0, approvalRef: `Invoice ${inv.number} issued by ${inv.issuedBy || ''}`, note: 'Net sales excluding VAT' })); }
    return out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
  }
  /** Why a ledger line cannot be posted ('' when it can). */
  function postingError(lineObj, role) {
    if (!lineObj) return 'Line not found.';
    if (!E.can(role, 'finance.post')) return 'Only Finance posts to the ledger.';
    if (lineObj.posted) return `${lineObj.id} is already posted (${lineObj.posting && lineObj.posting.number}).`;
    if (lineObj.stage !== 'paid') return 'Only paid / issued amounts are posted; requested and approved amounts stay as commitments.';
    if (lineObj.amount === null || lineObj.amount === undefined) return 'The amount cannot be determined (set the diesel price in Settings).';
    if (lineObj.missing && lineObj.missing.length) return `Mandatory financial mapping missing: ${lineObj.missing.join(', ')}.`;
    return '';
  }
  function nextPostingNo(dateISO, postings) { const d = (dateISO || E.todayISO()).slice(2, 10).replace(/-/g, ''); const prefix = `PST-${d}-`; return prefix + String((postings || []).filter((p) => (p.number || '').startsWith(prefix)).length + 1).padStart(3, '0'); }
  function postingFrom(lineObj, user, now, postings) {
    return { id: 'pst-' + lineObj.id.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase(), number: nextPostingNo(now, postings), lineId: lineObj.id, kind: lineObj.kind, glAccount: lineObj.glAccount, accountName: lineObj.accountName, costCenter: lineObj.costCenter, lob: lineObj.lob, tripLogId: lineObj.tripLogId || '', tripId: lineObj.tripId || '', assetCode: lineObj.assetCode || '', plate: lineObj.plate || '', client: lineObj.client || '', date: lineObj.date, amount: lineObj.amount, debitCredit: lineObj.kind === 'revenue' ? 'credit' : 'debit', sourceCollection: lineObj.sourceCollection, sourceId: lineObj.sourceId, sourceNo: lineObj.sourceNo, approvalRef: lineObj.approvalRef || '', postedAt: now, postedBy: user, status: 'Posted' };
  }
  /** Totals per stage, kind and dimension. */
  function ledgerSummary(lines, keyFn) {
    const m = new Map(); for (const l of lines) { const k = keyFn(l) || '(unmapped)'; const r = m.get(k) || { key: k, requested: 0, approved: 0, paid: 0, posted: 0, lines: 0, unmapped: 0 }; r.lines++; if (l.amount !== null) r[l.stage] = round2(r[l.stage] + l.amount); if (l.posted && l.amount !== null) r.posted = round2(r.posted + l.amount); if (!l.ready) r.unmapped++; m.set(k, r); }
    return [...m.values()].sort((a, b) => b.paid - a.paid);
  }

  // ------------------------------------------------------------- costing (rate card)
  function rateCardFor(trip, ctx) { const asset = E.assetFor(trip && trip.plate, ctx.assets || []); const code = (asset && asset.assetCode) || (trip && trip.assetCode); return (ctx.ratecard || []).find((r) => r.assetCode === code) || (ctx.ratecard || []).find((r) => P.plateKey(r.plate) === P.plateKey(trip && trip.plate)) || null; }
  function tripKm(trip, ctx) {
    const route = (ctx.routes || []).find((r) => r.id === (trip.routeMasterId || trip.routeId)) || P.routeFor({ client: trip.client, loadingFrom: trip.loadingFrom, destination: trip.loadingTo }, ctx.routes || []);
    if (route && num(route.kmOneWay) !== null) return { oneWayKm: num(route.kmOneWay), returnKm: num(route.kmReturn) === null ? num(route.kmOneWay) : num(route.kmReturn), totalKm: num(route.totalKm) !== null ? num(route.totalKm) : round2(num(route.kmOneWay) + (num(route.kmReturn) === null ? num(route.kmOneWay) : num(route.kmReturn))), route, source: P.routeStatus(route) === 'Approved' ? 'Route Master (approved)' : 'Route Master (' + P.routeStatus(route) + ')' };
    return { oneWayKm: null, returnKm: null, totalKm: null, route: route || null, source: 'No route distance' };
  }
  /** Calculated costing of a trip from the Rate Card (fixed cost per planned day, maintenance / tyre / road per km, diesel at the Settings price). */
  function tripCosting(trip, ctx) {
    const rc = rateCardFor(trip, ctx); const km = tripKm(trip, ctx); const price = dieselPriceOf(ctx.planning);
    if (trip.serviceType === '3rd Party Contractor') { const cost = num(trip.contractorCost); return { available: cost !== null, reason: cost === null ? 'Contractor cost not approved yet' : '', kind: '3PL', total: cost, components: [{ label: 'Approved contractor cost', amount: cost, basis: 'actual approval' }], km, sellingPrice: num(trip.sellingPrice), approvedPrice: num(trip.agreedPrice), expectedMargin: cost === null || num(trip.sellingPrice) === null ? null : round2(num(trip.sellingPrice) - cost), marginPct: cost === null || !num(trip.sellingPrice) ? null : round2(((num(trip.sellingPrice) - cost) / num(trip.sellingPrice)) * 100) }; }
    if (!rc) return { available: false, reason: `No rate card entry for ${trip.plate}${trip.assetCode ? ' (' + trip.assetCode + ')' : ''}`, km, components: [], total: null, sellingPrice: num(trip.sellingPrice), approvedPrice: num(trip.agreedPrice), expectedMargin: null, marginPct: null };
    if (km.totalKm === null) return { available: false, reason: 'No approved route distance for this lane', km, rateCard: rc, components: [], total: null, sellingPrice: num(trip.sellingPrice), approvedPrice: num(trip.agreedPrice), expectedMargin: null, marginPct: null };
    const plan = P.journeyPlan(km.oneWayKm, ctx.planning, km.returnKm); const days = (km.route && num(km.route.tatDays)) || plan.totalDays || 1;
    const litres = num(rc.consumptionLPerKm) === null ? null : round2(km.totalKm * rc.consumptionLPerKm);
    const comps = [
      { key: 'fixed', label: `Fixed truck cost (${days} planned day${days > 1 ? 's' : ''} × ₦${round2(rc.fixedCostPerDay || 0)})`, amount: round2((rc.fixedCostPerDay || 0) * days), basis: 'rate card allocation' },
      { key: 'diesel', label: `Diesel (${litres} L × ₦${price === null ? '?' : price})`, amount: litres === null || price === null ? null : round2(litres * price), basis: price === null ? 'diesel price not set' : 'rate card consumption × Settings diesel price' },
      { key: 'road', label: `Road expenses (${km.totalKm} km × ₦${rc.roadExpensePerKm || 0})`, amount: round2(km.totalKm * (rc.roadExpensePerKm || 0)), basis: 'rate card' },
      { key: 'mtc', label: `Maintenance (${km.totalKm} km × ₦${round2(rc.mtcCostPerKm || 0)})`, amount: round2(km.totalKm * (rc.mtcCostPerKm || 0)), basis: 'rate card allocation' },
      { key: 'tyre', label: `Tyres (${km.totalKm} km × ₦${round2(rc.tyreCostPerKm || 0)})`, amount: round2(km.totalKm * (rc.tyreCostPerKm || 0)), basis: 'rate card allocation' },
    ];
    const total = comps.some((c) => c.amount === null) ? null : round2(comps.reduce((s, c) => s + c.amount, 0));
    const variable = round2(comps.filter((c) => c.key !== 'fixed' && c.amount !== null).reduce((s, c) => s + c.amount, 0));
    const suggested = rc.sellingFixedPerDay === null || rc.sellingFixedPerDay === undefined ? null : round2(rc.sellingFixedPerDay * days + variable);
    const sp = num(trip.sellingPrice);
    return { available: total !== null, reason: total === null ? 'Diesel price not set in Settings' : '', kind: 'Internal Fleet', rateCard: rc, km, days, litres, dieselPrice: price, components: comps, total, variable, suggestedSellingPrice: suggested, suggestedBasis: 'Rate card selling fixed per day × planned days + variable costs', sellingPrice: sp, approvedPrice: num(trip.agreedPrice), priceVariance: sp === null || num(trip.agreedPrice) === null ? null : round2(sp - num(trip.agreedPrice)), expectedMargin: total === null || sp === null ? null : round2(sp - total), marginPct: total === null || !sp ? null : round2(((sp - total) / sp) * 100) };
  }

  // ------------------------------------------------------------- trip profit & loss
  function tripPnl(trip, ctx) {
    const price = dieselPriceOf(ctx.planning); const notes = [];
    const inv = trip.invoiceId ? (ctx.invoices || []).find((i) => i.id === trip.invoiceId) : null; const invoiced = !!(inv && inv.issuedAt && inv.status !== 'Void');
    let revenue = invoiced ? num(trip.netSales) || 0 : null; let credits = 0;
    if (invoiced) { const cns = (ctx.invoices || []).filter((i) => i.type === 'credit' && i.againstId === inv.id); const share = inv.subtotal ? (num(trip.netSales) || 0) / inv.subtotal : 1 / Math.max(1, (inv.tripIds || []).length); credits = round2(cns.reduce((s, c) => s + (num(c.net) || num(c.amount) || 0), 0) * share); revenue = round2(revenue - credits); if (credits) notes.push(`Credit notes of ₦${credits} apportioned to this trip`); }
    else notes.push(trip.sellingPrice !== null && trip.sellingPrice !== undefined ? 'Not invoiced yet: revenue shown as null (selling price ₦' + trip.sellingPrice + ' pending invoice)' : 'Not invoiced and no selling price');
    const diesel = (ctx.dieselreqs || []).filter((d) => d.tripLogId === trip.id && !d.rejectedAt); const litres = round2(diesel.reduce((s, d) => s + D.slipTotals(d).issued, 0));
    const dieselCost = litres ? (price === null ? null : round2(litres * price)) : 0; if (litres && price === null) notes.push('Diesel issued but no diesel price in Settings');
    if (litres && price !== null) notes.push(`Diesel ${litres} L issued × ₦${price} (Settings price)`);
    const road = round2((ctx.roadslips || []).filter((r) => r.tripLogId === trip.id && !r.rejectedAt).reduce((s, r) => s + D.slipTotals(r).issued, 0));
    const paidExtras = (ctx.extraexpenses || []).filter((x) => x.tripLogId === trip.id && x.status === 'Paid');
    const extras = round2(paidExtras.filter((x) => !x.incidentId).reduce((s, x) => s + (num(x.approvedAmount) || 0), 0));
    const incidentExtras = round2(paidExtras.filter((x) => x.incidentId).reduce((s, x) => s + (num(x.approvedAmount) || 0), 0));
    const extrasApproved = round2((ctx.extraexpenses || []).filter((x) => x.tripLogId === trip.id && x.status === 'Approved').reduce((s, x) => s + (num(x.approvedAmount) || 0), 0)); if (extrasApproved) notes.push(`₦${extrasApproved} of approved additional expenses not yet paid (excluded)`);
    let contractor = 0; if (trip.serviceType === '3rd Party Contractor') { const req = (ctx.requests || []).find((r) => r.id === trip.requestId); const t = req && req.tpl; const siblings = (ctx.trips || []).filter((x) => x.requestId === trip.requestId).length || 1; contractor = t && num(t.contractorPaidAmount) !== null ? round2(num(t.contractorPaidAmount) / siblings) : num(trip.contractorCost) || 0; notes.push(t && num(t.contractorPaidAmount) !== null ? 'Contractor cost = actual payment share' : 'Contractor cost = approved cost (payment not recorded yet)'); }
    const incidents = (ctx.incidents || []).filter((i) => i.tripLogId === trip.id && i.status !== 'Cancelled'); const incidentJobIds = new Set(incidents.map((i) => i.jobcardId).filter(Boolean));
    const jobsAll = (ctx.jobcards || []).filter((j) => j.tripLogId === trip.id || j.incidentId && incidents.some((i) => i.id === j.incidentId) || incidentJobIds.has(j.id)); const jobCostOf = (j) => (WS ? WS.jobCosts(j, ctx.stockmoves || []).total : 0);
    const jobs = jobsAll.filter((j) => !j.incidentId && !incidentJobIds.has(j.id)); const jobCost = round2(jobs.reduce((s, j) => s + jobCostOf(j), 0));
    // incident cost = actual paid incident expenses + repair / recovery job cards created from the incident (counted once, here, not under repairs)
    const incidentJobCost = round2(jobsAll.filter((j) => j.incidentId || incidentJobIds.has(j.id)).reduce((s, j) => s + jobCostOf(j), 0)); const incident = round2(incidentExtras + incidentJobCost);
    if (incidents.length) notes.push(`${incidents.length} incident${incidents.length > 1 ? 's' : ''} on this trip: ₦${incident} actual incident cost (paid incident expenses ₦${incidentExtras} + incident repair / recovery ₦${incidentJobCost}), shown separately`);
    const direct = { diesel: dieselCost, road, extras, contractor, driver: 0, repairsOnTrip: jobCost, incident }; notes.push('Driver expenses are paid through the road expense slip and additional expenses (no separate payroll allocation)');
    const directTotal = Object.values(direct).some((v) => v === null) ? null : round2(Object.values(direct).reduce((s, v) => s + v, 0));
    const costing = tripCosting(trip, ctx); const rc = costing.rateCard; const km = costing.km;
    const allocated = { maintenance: rc && km.totalKm !== null && !jobCost && !incidentJobCost ? round2(km.totalKm * ((rc.mtcCostPerKm || 0) + (rc.tyreCostPerKm || 0))) : 0, fixed: rc && costing.days ? round2((rc.fixedCostPerDay || 0) * costing.days) : 0 };
    if (rc) notes.push(`Allocated costs from the rate card: maintenance + tyres ₦${allocated.maintenance} (${km.totalKm} km), fixed truck cost ₦${allocated.fixed} (${costing.days} planned days)`); else if (trip.serviceType !== '3rd Party Contractor') notes.push('No rate card for this vehicle: allocated costs not available');
    const allocatedTotal = round2(allocated.maintenance + allocated.fixed);
    const contribution = revenue === null || directTotal === null ? null : round2(revenue - directTotal);
    const operating = contribution === null ? null : round2(contribution - allocatedTotal);
    return { tripLogId: trip.id, tripId: trip.journeyPlanId, client: trip.client, route: `${trip.loadingFrom} → ${trip.loadingTo}`, plate: trip.plate, costCenter: trip.costCenter || '', lob: trip.lob || '', serviceType: trip.serviceType, truckBatch: trip.truckBatch, invoiced, revenue, credits, direct, directTotal, allocated, allocatedTotal, contribution, operatingProfit: operating, incidentTotal: incident, incidentCount: incidents.length, incidentIds: incidents.map((i) => i.id), unprofitableDueToIncident: incident > 0 && ((operating !== null && operating < 0 && round2(operating + incident) >= 0) || (contribution !== null && contribution < 0 && round2(contribution + incident) >= 0)), grossMarginPct: contribution === null || !revenue ? null : round2((contribution / revenue) * 100), operatingMarginPct: operating === null || !revenue ? null : round2((operating / revenue) * 100), notes, litres, finStatus: trip.finStatus || 'Open', opsStatus: trip.opsStatus };
  }
  function pnlSummary(trips, ctx, keyFn) {
    const m = new Map();
    for (const t of trips || []) { const p = tripPnl(t, ctx); const k = keyFn(t, p) || '(unspecified)'; const r = m.get(k) || { key: k, trips: 0, invoiced: 0, revenue: 0, direct: 0, allocated: 0, contribution: 0, operatingProfit: 0, incident: 0, incidentTrips: 0, unprofitableDueToIncident: 0 }; r.trips++; r.incident = round2(r.incident + (p.incidentTotal || 0)); if (p.incidentCount) r.incidentTrips++; if (p.unprofitableDueToIncident) r.unprofitableDueToIncident++; if (p.invoiced) r.invoiced++; r.revenue = round2(r.revenue + (p.revenue || 0)); r.direct = round2(r.direct + (p.directTotal || 0)); r.allocated = round2(r.allocated + p.allocatedTotal); r.contribution = round2(r.contribution + (p.contribution || 0)); r.operatingProfit = round2(r.operatingProfit + (p.operatingProfit || 0)); m.set(k, r); }
    return [...m.values()].map((r) => Object.assign(r, { grossMarginPct: r.revenue ? round2((r.contribution / r.revenue) * 100) : null, operatingMarginPct: r.revenue ? round2((r.operatingProfit / r.revenue) * 100) : null, avgProfitPerTrip: r.trips ? round2(r.operatingProfit / r.trips) : null })).sort((a, b) => b.revenue - a.revenue);
  }

  // ------------------------------------------------------------- financial closure
  /** Finance closes a trip financially only when billing is settled, or with a written reason (write-off / no billing). Operational closure never closes finances. */
  function finClosureError(trip, opts, role) {
    opts = opts || {};
    if (!E.can(role, 'finance.close')) return 'Only Finance closes a trip financially.';
    if (!trip) return 'Trip not found.';
    if (trip.finStatus === 'Closed') return `Trip ${trip.journeyPlanId || trip.id} is already financially closed.`;
    const open = []; if (trip.internalClient || trip.invoiceStatus === 'Internal Client') { /* nothing to bill */ } else { if (['Not Invoiced', 'Draft Invoice'].includes(trip.invoiceStatus)) open.push('not invoiced'); if ((num(trip.balance) || 0) > 0.005) open.push(`balance ₦${trip.balance} outstanding`); }
    const pend = (opts.extraexpenses || []).filter((x) => x.tripLogId === trip.id && ['Pending Approval', 'Approved'].includes(x.status)).length; if (pend) open.push(`${pend} additional expense${pend > 1 ? 's' : ''} not yet paid`);
    if (open.length && !clean(opts.reason)) return `Trip ${trip.journeyPlanId || trip.id} is still ${open.join(', ')}. Enter the reason (write-off, no billing, adjustment) to close it anyway.`;
    return '';
  }

  // ------------------------------------------------------------- assistant (finance / workshop / profitability questions)
  const QUESTIONS = ['Which clients have the highest outstanding invoices?', 'Which trucks have the highest maintenance costs?', 'Which LOB is generating the highest profit?', 'Which routes are unprofitable?', 'Which trips have not been invoiced due to missing PODs?', 'Which cost centers are exceeding budget?', 'Which vehicles have repeated workshop repairs?', 'Which trips are exceeding their approved TAT?'];
  function assistant(question, ctx) {
    const q = norm(question); const trips = ctx.trips || [];
    const money = (n) => '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
    if (/outstanding|receivable|owe/.test(q) && /invoice|client/.test(q)) { const m = new Map(); for (const t of trips) if (t.invoiceId && (num(t.balance) || 0) > 0.005) { const r = m.get(t.client) || { client: t.client, trips: 0, invoices: new Set(), outstanding: 0 }; r.trips++; r.invoices.add(t.invoiceId); r.outstanding = round2(r.outstanding + t.balance); m.set(t.client, r); } const rows = [...m.values()].map((r) => Object.assign(r, { invoices: r.invoices.size })).sort((a, b) => b.outstanding - a.outstanding); return { title: 'Outstanding invoices by client', answer: `${rows.length} client${rows.length === 1 ? '' : 's'} owe ${money(rows.reduce((s, r) => s + r.outstanding, 0))} on issued invoices (gross, from the Trip Log balances).`, columns: ['client', 'invoices', 'trips', 'outstanding'], rows }; }
    if (/maintenance|repair|workshop/.test(q) && /cost|expensive|highest/.test(q) && !/repeat/.test(q)) { const rep = WS.workshopReports(ctx); const rows = rep.costByTruck.slice(0, 20); return { title: 'Maintenance cost by truck', answer: rows.length ? `${rows[0].plate} has the highest workshop cost (${money(rows[0].cost)} over ${rows[0].jobs} job card${rows[0].jobs > 1 ? 's' : ''}); ${money(rep.totalCost)} across ${rep.jobs} job cards (labour + parts issued + external repairs).` : 'No job cards recorded yet.', columns: ['plate', 'costCenter', 'jobs', 'cost', 'downtimeDays'], rows }; }
    if (/repeat/.test(q) || (/repeated|again/.test(q) && /repair|workshop|breakdown/.test(q))) { const rows = WS.repeatRepairs(ctx.jobcards || [], 30); return { title: 'Repeated workshop repairs (same truck, same category within 30 days)', answer: rows.length ? `${rows.length} repeat repair${rows.length > 1 ? 's' : ''} found.` : 'No repeat repairs within 30 days.', columns: ['plate', 'category', 'first', 'repeat', 'daysBetween'], rows }; }
    if (/lob|line of business/.test(q) && /profit|margin|highest/.test(q)) { const rows = pnlSummary(trips.filter((t) => t.invoiceId), ctx, (t) => t.lob || '(no LOB)'); const best = rows.slice().sort((a, b) => b.operatingProfit - a.operatingProfit)[0]; return { title: 'Profit by Line of Business (invoiced trips)', answer: best ? `${best.key} generates the highest operating profit (${money(best.operatingProfit)} on ${money(best.revenue)} revenue, ${best.operatingMarginPct}% margin). Revenue is net of VAT and credit notes; costs are recorded diesel, road, additional, contractor payments plus rate-card allocations.` : 'No invoiced trips yet.', columns: ['key', 'trips', 'revenue', 'direct', 'allocated', 'contribution', 'operatingProfit', 'operatingMarginPct'], rows }; }
    if (/unprofitable|loss|losing|negative/.test(q) && /route|lane/.test(q)) { const rows = pnlSummary(trips.filter((t) => t.invoiceId), ctx, (t) => `${t.loadingFrom} → ${t.loadingTo}`).filter((r) => r.operatingProfit < 0).sort((a, b) => a.operatingProfit - b.operatingProfit); return { title: 'Unprofitable routes (invoiced trips)', answer: rows.length ? `${rows.length} route${rows.length > 1 ? 's' : ''} show an operating loss after allocated costs; ${rows[0].key} is the worst at ${money(rows[0].operatingProfit)}.` : 'No invoiced route shows an operating loss.', columns: ['key', 'trips', 'revenue', 'direct', 'allocated', 'operatingProfit', 'operatingMarginPct'], rows }; }
    if (/pod|proof of delivery/.test(q) && /invoice|billed/.test(q)) { const rows = trips.filter((t) => !t.invoiceId && !t.internalClient && (t.dateDelivered || t.opsStatus === 'Closed') && t.podStatus !== 'POD Verified').map((t) => ({ tripId: t.journeyPlanId, client: t.client, route: `${t.loadingFrom} → ${t.loadingTo}`, delivered: t.dateDelivered, podStatus: t.podStatus, sellingPrice: t.sellingPrice })); return { title: 'Completed trips not invoiced for want of a verified POD', answer: `${rows.length} completed trip${rows.length === 1 ? '' : 's'} (${money(rows.reduce((s, r) => s + (r.sellingPrice || 0), 0))} of selling price) wait for the POD before billing.`, columns: ['tripId', 'client', 'route', 'delivered', 'podStatus', 'sellingPrice'], rows }; }
    if (/cost cent/.test(q) && /budget|exceed|over/.test(q)) { const lines = ledgerLines(ctx).filter((l) => l.stage === 'paid' && l.kind !== 'revenue' && l.amount !== null); const month = (ctx.today || E.todayISO()).slice(0, 7); const rows = (ctx.costcenters || []).map((c) => { const spent = round2(lines.filter((l) => l.costCenter === c.id && String(l.date).slice(0, 7) === month).reduce((s, l) => s + l.amount, 0)); return { costCenter: c.id, name: c.name, budgetMonthly: c.budgetMonthly, spentThisMonth: spent, variance: num(c.budgetMonthly) === null ? null : round2(spent - c.budgetMonthly), status: num(c.budgetMonthly) === null ? 'No budget set' : spent > c.budgetMonthly ? 'Over budget' : 'Within budget' }; }).sort((a, b) => (b.variance || 0) - (a.variance || 0)); const over = rows.filter((r) => r.status === 'Over budget'); return { title: `Cost centers vs monthly budget (${month})`, answer: rows.every((r) => r.status === 'No budget set') ? 'No cost center has a budget yet; Finance enters monthly budgets in the Cost Center master. Spending this month is shown from paid / issued amounts.' : `${over.length} cost center${over.length === 1 ? '' : 's'} over budget this month.`, columns: ['costCenter', 'name', 'budgetMonthly', 'spentThisMonth', 'variance', 'status'], rows }; }
    if (/tat|turnaround|exceed/.test(q) && /trip|truck/.test(q)) { const d = P.tatDashboard(trips.filter((t) => t.opsStatus === 'Open'), ctx.routes, ctx.now); const rows = d.rows.filter((x) => ['Overdue', 'Approaching Target'].includes(x.tat.status)).map((x) => ({ tripId: x.trip.journeyPlanId, plate: x.trip.plate, client: x.trip.client, route: x.route ? `${x.route.loadingPoint} → ${x.route.destination}` : `${x.trip.loadingFrom} → ${x.trip.loadingTo}`, elapsedDays: x.tat.elapsedDays, targetDays: x.tat.targetDays, status: x.tat.status, otd: x.tat.otdStatus })); return { title: 'Open trips exceeding or approaching their approved TAT', answer: `${d.overdue} trip${d.overdue === 1 ? '' : 's'} overdue and ${d.approaching} approaching the route target; OTD so far ${d.otdPct === null ? 'n/a' : d.otdPct + '%'}.`, columns: ['tripId', 'plate', 'client', 'route', 'elapsedDays', 'targetDays', 'status', 'otd'], rows }; }
    return null;
  }

  return { DEFAULT_ACCOUNTMAP, LINE_KINDS, STAGES, QUESTIONS, mapOf, dieselPriceOf, accountFor, costCenterOf, ledgerLines, ledgerSummary, postingError, postingFrom, nextPostingNo, rateCardFor, tripKm, tripCosting, tripPnl, pnlSummary, finClosureError, assistant };
});
