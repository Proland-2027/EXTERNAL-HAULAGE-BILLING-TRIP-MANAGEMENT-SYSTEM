/*
 * Haulage billing engine — pure functions shared by the browser app, the Node
 * server and the test-suite. Every rule here mirrors a formula or a documented
 * decision in docs/WORKBOOK_ANALYSIS.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.HB = root.HB || {}; root.HB.engine = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  const INVOICE_STATUSES = ['Invoice Not Sent', 'Invoice Sent', 'Internal Client'];
  const PAYMENT_STATUSES = ['Not Paid', 'Advance', 'Paid'];
  const RETURN_WAYBILL = ['', 'Received', 'Not Received'];
  const TRIP_STATUSES = ['Invoice Not Sent', 'Awaiting Payment', 'Part Paid - Balance Due', 'Closed', 'Internal Client'];
  const INVOICE_DOC_STATUSES = ['Draft', 'Sent', 'Paid', 'Void'];
  const ROLES = ['admin', 'operations', 'billing', 'finance', 'management'];
  const ROLE_LABELS = { admin: 'Administrator', operations: 'Operations Team', billing: 'Billing Team', finance: 'Finance Team', management: 'Management' };

  // Field groups on a trip. Each role may edit the groups listed in ROLE_FIELDS.
  const FIELD_GROUPS = {
    operations: ['dateDispatched', 'dateDelivered', 'plate', 'contractType', 'client', 'loadingFrom', 'loadingTo', 'journeyPlanId', 'waybill', 'returnWaybill', 'note', 'agreedRateId'],
    billing: ['sellingPrice', 'quoteNo', 'soNo', 'manualInvoiceNo', 'invoiceStatus', 'invoiceNo', 'invoiceId', 'agreedRateId'],
    finance: ['paymentStatus', 'advance', 'invoiceStatus', 'note'],
  };
  const ROLE_FIELDS = {
    admin: [...FIELD_GROUPS.operations, ...FIELD_GROUPS.billing, ...FIELD_GROUPS.finance],
    operations: FIELD_GROUPS.operations,
    billing: FIELD_GROUPS.billing,
    finance: FIELD_GROUPS.finance,
    management: [],
  };
  // Coarse actions.
  const ROLE_ACTIONS = {
    admin: ['trip.create', 'trip.edit', 'trip.delete', 'trip.import', 'rate.manage', 'invoice.manage', 'payment.manage', 'client.manage', 'asset.manage', 'user.manage', 'settings.manage', 'report.view', 'variance.review', 'audit.view', 'export'],
    operations: ['trip.create', 'trip.edit', 'trip.import', 'report.view', 'export'],
    billing: ['trip.edit', 'invoice.manage', 'report.view', 'export', 'rate.view'],
    finance: ['trip.edit', 'payment.manage', 'report.view', 'export'],
    management: ['report.view', 'variance.review', 'export', 'audit.view', 'rate.view'],
  };

  const TRIP_FIELDS = [
    { key: 'dateDispatched', label: 'Date Dispatched', type: 'date', excel: 'A' },
    { key: 'dateDelivered', label: 'Date Delivered', type: 'date', excel: 'B' },
    { key: 'plate', label: 'Plate Number', type: 'asset', excel: 'C' },
    { key: 'assetCode', label: 'Asset Code', type: 'derived', excel: 'D' },
    { key: 'vehicleType', label: 'Vehicle Type', type: 'derived', excel: 'E' },
    { key: 'vehicleCategory', label: 'Vehicle Category', type: 'derived', excel: 'F' },
    { key: 'costCenter', label: 'Cost Center', type: 'derived', excel: 'G' },
    { key: 'contractType', label: 'Contract Type', type: 'text', excel: 'H' },
    { key: 'client', label: 'Client Name', type: 'client', excel: 'I' },
    { key: 'loadingFrom', label: 'Loading From', type: 'location', excel: 'J' },
    { key: 'loadingTo', label: 'Loading To', type: 'location', excel: 'K' },
    { key: 'journeyPlanId', label: 'Journey Plan ID', type: 'text', excel: 'L' },
    { key: 'waybill', label: 'Client Waybill Number', type: 'text', excel: 'M' },
    { key: 'returnWaybill', label: 'Return Waybill Received', type: 'enum', options: RETURN_WAYBILL, excel: 'N' },
    { key: 'invoiceStatus', label: 'Invoice Status', type: 'enum', options: INVOICE_STATUSES, excel: 'O' },
    { key: 'agreedPrice', label: 'Agreed Client Price (₦)', type: 'computed-money' },
    { key: 'sellingPrice', label: 'Selling Price (₦)', type: 'money', excel: 'P' },
    { key: 'variance', label: 'Price Variance (₦)', type: 'computed-money' },
    { key: 'variancePct', label: 'Price Variance (%)', type: 'computed-pct' },
    { key: 'vat', label: 'VAT (₦)', type: 'computed-money', excel: 'Q' },
    { key: 'billing', label: 'Billing After VAT (₦)', type: 'computed-money', excel: 'R' },
    { key: 'quoteNo', label: 'Quote Number', type: 'text', excel: 'S' },
    { key: 'soNo', label: 'Sales Order Number', type: 'text', excel: 'T' },
    { key: 'manualInvoiceNo', label: 'Manual Invoice Number', type: 'text', excel: 'U' },
    { key: 'invoiceNo', label: 'Generated Invoice Number', type: 'derived', excel: 'V' },
    { key: 'paymentStatus', label: 'Payment Status', type: 'enum', options: PAYMENT_STATUSES, excel: 'W' },
    { key: 'advance', label: 'Advance (₦)', type: 'money', excel: 'X' },
    { key: 'amountPaid', label: 'Amount Paid (₦)', type: 'computed-money', excel: 'Y' },
    { key: 'balance', label: 'Outstanding Balance (₦)', type: 'computed-money', excel: 'Z' },
    { key: 'tripStatus', label: 'Trip Status', type: 'computed-status' },
    { key: 'note', label: 'Notes', type: 'text', excel: 'AF' },
  ];

  // ------------------------------------------------------------------ helpers
  // Excel-compatible ROUND(x,2): work on 15 significant digits, round half away from zero.
  const round2 = (n) => { n = Number(n); if (!Number.isFinite(n)) return n; const s = n < 0 ? -1 : 1; return s * Math.round(Number(Math.abs(n).toPrecision(15) + 'e2')) / 100; };
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const num = (v) => { if (v === '' || v === null || v === undefined) return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₦\s]/g, '')); return Number.isFinite(n) ? n : null; };
  const norm = (s) => String(s == null ? '' : s).replace(/[‎‏‪-‮ ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const clean = (s) => String(s == null ? '' : s).replace(/[‎‏‪-‮ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const monthKey = (d) => (d && d.length >= 7 ? d.slice(0, 7) : '');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthLabel = (ym) => { if (!ym) return ''; const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const addDays = (iso, days) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(days || 0)); return d.toISOString().slice(0, 10); };
  const endOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

  // ---------------------------------------------------------------- assets
  function assetFor(plate, assets) {
    if (!plate) return null;
    const key = norm(plate);
    return (assets || []).find((a) => norm(a.plate) === key) || null;
  }
  // Settings!$B$6 drives VAT; default 7.5 %.
  function vatRateOf(settings) { const r = settings && num(settings.vatRate); return isNum(r) ? r : 0.075; }

  // ---------------------------------------------------------- agreed rates
  function rateStatus(rate, today) {
    today = today || todayISO();
    if (rate.effectiveDate && rate.effectiveDate > today) return 'Future';
    if (rate.expiryDate && rate.expiryDate < today) return 'Expired';
    return 'Active';
  }
  /**
   * Find the agreed price for a trip. Documented priority rule:
   *  1. client, loading from, loading to and vehicle type must all match (case/space-insensitive);
   *  2. the rate must be in force on the dispatch date (effectiveDate <= date <= expiryDate);
   *  3. a rate whose contractType equals the trip's contract type beats a rate with no contract type;
   *     a rate with a *different* contract type never matches;
   *  4. among the remaining, the latest effectiveDate wins;
   *  5. still tied → status "multiple" and the user must pick (agreedRateId).
   */
  function lookupAgreedRate(trip, rates) {
    const date = trip.dateDispatched || todayISO();
    const c = norm(trip.client), f = norm(trip.loadingFrom), t = norm(trip.loadingTo), v = norm(trip.vehicleType), ct = norm(trip.contractType);
    if (!c || !f || !t) return { status: 'none', rate: null, candidates: [] };
    const cands = (rates || []).filter((r) => norm(r.client) === c && norm(r.loadingFrom) === f && norm(r.loadingTo) === t
      && (!v || !norm(r.vehicleType) || norm(r.vehicleType) === v)
      && (!r.effectiveDate || r.effectiveDate <= date) && (!r.expiryDate || r.expiryDate >= date)
      && (!norm(r.contractType) || norm(r.contractType) === ct));
    if (!cands.length) return { status: 'none', rate: null, candidates: [] };
    if (trip.agreedRateId) { const pick = cands.find((r) => r.id === trip.agreedRateId); if (pick) return { status: 'found', rate: pick, candidates: cands, picked: true }; }
    const score = (r) => (norm(r.contractType) && norm(r.contractType) === ct ? 2 : 0) + (norm(r.vehicleType) && norm(r.vehicleType) === v ? 1 : 0);
    let best = [...cands].sort((a, b) => score(b) - score(a) || String(b.effectiveDate || '').localeCompare(String(a.effectiveDate || '')));
    const top = best.filter((r) => score(r) === score(best[0]) && (r.effectiveDate || '') === (best[0].effectiveDate || ''));
    if (top.length > 1 && new Set(top.map((r) => num(r.price))).size > 1) return { status: 'multiple', rate: null, candidates: top };
    return { status: 'found', rate: top[0], candidates: cands };
  }

  function variance(selling, agreed) {
    if (!isNum(selling) || !isNum(agreed)) return { variance: null, variancePct: null, direction: 'na' };
    const v = round2(selling - agreed);
    const pct = agreed === 0 ? null : round2((v / agreed) * 100);
    return { variance: v, variancePct: pct, direction: v > 0 ? 'above' : v < 0 ? 'below' : 'equal' };
  }

  // ------------------------------------------------------------- trip math
  function tripStatus(t) {
    if (t.invoiceStatus === 'Internal Client') return 'Internal Client';
    if (t.paymentStatus === 'Paid') return 'Closed';
    if (t.paymentStatus === 'Advance' && num(t.advance) > 0) return 'Part Paid - Balance Due';
    if (t.invoiceStatus === 'Invoice Sent') return 'Awaiting Payment';
    return 'Invoice Not Sent';
  }

  /** Returns a new object: the trip plus every computed column. Selling price is never touched. */
  function computeTrip(trip, ctx) {
    ctx = ctx || {};
    const t = Object.assign({}, trip);
    const asset = assetFor(t.plate, ctx.assets);
    if (asset) { t.assetCode = asset.assetCode; t.vehicleType = asset.vehicleType; t.vehicleCategory = asset.vehicleCategory; t.costCenter = asset.costCenter; }
    const rate = vatRateOf(ctx.settings);
    const p = num(t.sellingPrice);
    t.sellingPrice = p;
    t.vat = p === null ? null : round2(p * rate);                // Q
    t.billing = p === null ? null : p + t.vat;                   // R (workbook does not round)
    const adv = num(t.advance);
    // Y — five workbook rows had the formula typed over; those keep their value in amountPaidOverride.
    t.amountPaid = isNum(num(t.amountPaidOverride)) ? num(t.amountPaidOverride) : !t.client ? null : t.paymentStatus === 'Paid' ? (t.billing || 0) : t.paymentStatus === 'Advance' ? (adv || 0) : 0;
    t.balance = !t.client || t.billing === null ? null : t.billing - t.amountPaid; // Z
    t.total = t.billing;                                           // AA
    t.month = monthKey(t.dateDispatched);                          // AB
    t.tripStatus = tripStatus(t);
    const lk = lookupAgreedRate(t, ctx.rates);
    t.agreedStatus = lk.status;
    t.agreedRate = lk.rate;
    t.agreedPrice = lk.rate ? num(lk.rate.price) : null;
    t.agreedCandidates = lk.candidates;
    Object.assign(t, variance(p, t.agreedPrice));
    return t;
  }

  function validateTrip(t, ctx) {
    const errors = [];
    if (!t.dateDispatched) errors.push('Date Dispatched is required.');
    if (t.dateDelivered && t.dateDispatched && t.dateDelivered < t.dateDispatched) errors.push('Date Delivered cannot be before Date Dispatched.');
    if (!clean(t.client)) errors.push('Client Name is required.');
    if (!clean(t.plate)) errors.push('Plate Number is required.');
    if (t.sellingPrice !== null && t.sellingPrice !== undefined && t.sellingPrice !== '' && num(t.sellingPrice) === null) errors.push('Selling Price must be a number.');
    if (num(t.sellingPrice) !== null && num(t.sellingPrice) < 0) errors.push('Selling Price cannot be negative.');
    if (t.paymentStatus && !PAYMENT_STATUSES.includes(t.paymentStatus)) errors.push('Payment Status is invalid.');
    if (t.invoiceStatus && !INVOICE_STATUSES.includes(t.invoiceStatus)) errors.push('Invoice Status is invalid.');
    if (t.paymentStatus === 'Advance' && !(num(t.advance) > 0)) errors.push('Advance amount is required when Payment Status is Advance.');
    if (ctx && ctx.assets && ctx.assets.length && t.plate && !assetFor(t.plate, ctx.assets)) errors.push(`Plate ${t.plate} is not in the Asset List.`);
    return errors;
  }

  // ---------------------------------------------------------- permissions
  function can(role, action) { return (ROLE_ACTIONS[role] || []).includes(action); }
  function canEditField(role, field) { return (ROLE_FIELDS[role] || []).includes(field); }
  function editableFields(role) { return ROLE_FIELDS[role] || []; }

  // ---------------------------------------------------------------- invoices
  function clientCode(name, clients) {
    const c = (clients || []).find((x) => norm(x.name) === norm(name));
    if (c && c.code) return String(c.code).toUpperCase();
    const letters = clean(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean);
    if (!letters.length) return 'CLI';
    if (letters.length >= 2) return (letters[0][0] + letters[1][0] + (letters[2] ? letters[2][0] : letters[1][1] || 'X')).slice(0, 3);
    return letters[0].slice(0, 3).padEnd(3, 'X');
  }
  /** `<CODE>-<YYMMDD>-<NN>`: client code + trip date, NN = next free sequence for that prefix. */
  function generateInvoiceNumber(client, tripDate, existingNumbers, clients) {
    const code = clientCode(client, clients);
    const d = (tripDate || todayISO()).replace(/-/g, '').slice(2);
    const prefix = `${code}-${d}-`;
    const taken = new Set((existingNumbers || []).map((n) => String(n || '').toUpperCase()));
    let n = 1;
    while (taken.has(`${prefix}${String(n).padStart(2, '0')}`)) n++;
    return `${prefix}${String(n).padStart(2, '0')}`;
  }
  /** Workbook rule: a trip is invoice-eligible when it is the client's, dispatched inside the month range, not Paid and not already on an invoice. */
  function eligibleTrips(trips, client, fromMonth, toMonth, opts) {
    opts = opts || {};
    const from = fromMonth ? `${fromMonth}-01` : '0000-00-00';
    const to = toMonth ? endOfMonth(toMonth) : '9999-12-31';
    return (trips || []).filter((t) => norm(t.client) === norm(client) && t.dateDispatched >= from && t.dateDispatched <= to
      && t.paymentStatus !== 'Paid' && (opts.includeInvoiced || !t.invoiceId) && t.invoiceStatus !== 'Internal Client');
  }
  function invoiceTotals(trips, vatRate) {
    const rate = isNum(vatRate) ? vatRate : 0.075;
    let subtotal = 0, vat = 0, total = 0;
    for (const t of trips) { const p = num(t.sellingPrice) || 0; const v = round2(p * rate); subtotal += p; vat += v; total += round2(p + v); }
    return { subtotal: round2(subtotal), vat: round2(vat), total: round2(total), count: trips.length };
  }
  function invoiceDocStatus(inv, trips) {
    if (inv.status === 'Void') return 'Void';
    const mine = trips.filter((t) => t.invoiceId === inv.id);
    if (mine.length && mine.every((t) => t.paymentStatus === 'Paid')) return 'Paid';
    return inv.status === 'Sent' || inv.sentAt ? 'Sent' : 'Draft';
  }
  function findDuplicateInvoiceNumber(number, invoices, excludeId) {
    const key = norm(number);
    if (!key) return null;
    return (invoices || []).find((i) => i.id !== excludeId && (norm(i.number) === key || norm(i.manualNumber) === key)) || null;
  }

  // ----------------------------------------------------------------- reports
  function sum(arr, f) { let s = 0; for (const x of arr) { const v = typeof f === 'function' ? f(x) : x[f]; if (isNum(v)) s += v; } return round2(s); }

  function filterTrips(trips, f) {
    f = f || {};
    return trips.filter((t) => (!f.from || t.dateDispatched >= f.from) && (!f.to || t.dateDispatched <= f.to)
      && (!f.month || t.month === f.month)
      && (!f.client || norm(t.client) === norm(f.client))
      && (!f.vehicleType || t.vehicleType === f.vehicleType)
      && (!f.vehicleCategory || t.vehicleCategory === f.vehicleCategory)
      && (!f.costCenter || t.costCenter === f.costCenter)
      && (!f.paymentStatus || t.paymentStatus === f.paymentStatus)
      && (!f.invoiceStatus || t.invoiceStatus === f.invoiceStatus)
      && (!f.tripStatus || t.tripStatus === f.tripStatus)
      && (!f.plate || norm(t.plate) === norm(f.plate))
      && (!f.search || tripMatches(t, f.search)));
  }
  function tripMatches(t, q) {
    const s = norm(q); if (!s) return true;
    return ['client', 'plate', 'loadingFrom', 'loadingTo', 'journeyPlanId', 'waybill', 'quoteNo', 'soNo', 'manualInvoiceNo', 'invoiceNo', 'assetCode', 'contractType', 'note'].some((k) => norm(t[k]).includes(s));
  }

  /** Client Summary / Statement sheets. */
  function clientSummary(trips, clients) {
    const names = new Map();
    for (const c of clients || []) names.set(norm(c.name), clean(c.name));
    for (const t of trips) if (!names.has(norm(t.client))) names.set(norm(t.client), clean(t.client));
    const rows = [];
    for (const [key, name] of names) {
      const mine = trips.filter((t) => norm(t.client) === key);
      if (!mine.length) continue;
      const billing = sum(mine, 'billing'), paid = sum(mine, 'amountPaid');
      rows.push({ client: name, trips: mine.length, sellingPrice: sum(mine, 'sellingPrice'), vat: sum(mine, 'vat'), billing, paid, balance: round2(billing - paid),
        unpaidTrips: mine.filter((t) => t.paymentStatus !== 'Paid' && t.invoiceStatus !== 'Internal Client').length });
    }
    rows.sort((a, b) => b.billing - a.billing);
    const total = { client: 'GRAND TOTAL', trips: sum(rows, 'trips'), sellingPrice: sum(rows, 'sellingPrice'), vat: sum(rows, 'vat'), billing: sum(rows, 'billing'), paid: sum(rows, 'paid'), balance: sum(rows, 'balance'), unpaidTrips: sum(rows, 'unpaidTrips') };
    return { rows, total };
  }
  /** Pivot: measure by `rowKey` × month (Summary / Summary Sales by Vehicle sheets). */
  function pivotByMonth(trips, rowKey, measure) {
    measure = measure || 'billing';
    const months = [...new Set(trips.map((t) => t.month).filter(Boolean))].sort();
    const rowsMap = new Map();
    for (const t of trips) {
      const k = (typeof rowKey === 'function' ? rowKey(t) : t[rowKey]) || '(blank)';
      if (!rowsMap.has(k)) rowsMap.set(k, { key: k, byMonth: {}, total: 0, trips: 0 });
      const r = rowsMap.get(k); const v = num(t[measure]) || 0;
      r.byMonth[t.month] = round2((r.byMonth[t.month] || 0) + v); r.total = round2(r.total + v); r.trips++;
    }
    const rows = [...rowsMap.values()].sort((a, b) => b.total - a.total);
    const totals = { byMonth: {}, total: 0, trips: 0 };
    for (const r of rows) { for (const m of months) totals.byMonth[m] = round2((totals.byMonth[m] || 0) + (r.byMonth[m] || 0)); totals.total = round2(totals.total + r.total); totals.trips += r.trips; }
    return { months, rows, totals };
  }
  function dashboard(trips) {
    const billing = sum(trips, 'billing'), paid = sum(trips, 'amountPaid');
    const unpaid = trips.filter((t) => t.paymentStatus !== 'Paid' && t.invoiceStatus !== 'Internal Client');
    const withAgreed = trips.filter((t) => isNum(t.agreedPrice) && isNum(t.sellingPrice));
    return {
      trips: trips.length, sellingPrice: sum(trips, 'sellingPrice'), vat: sum(trips, 'vat'), billing, paid, balance: round2(billing - paid),
      unpaidTrips: unpaid.length, unpaidBilling: sum(unpaid, 'balance'),
      invoiceNotSent: trips.filter((t) => t.tripStatus === 'Invoice Not Sent').length,
      awaiting: trips.filter((t) => t.tripStatus === 'Awaiting Payment').length,
      partPaid: trips.filter((t) => t.tripStatus === 'Part Paid - Balance Due').length,
      closed: trips.filter((t) => t.tripStatus === 'Closed').length,
      belowAgreed: withAgreed.filter((t) => t.direction === 'below').length,
      aboveAgreed: withAgreed.filter((t) => t.direction === 'above').length,
      varianceTotal: sum(withAgreed, 'variance'),
      byClient: pivotByMonth(trips, 'client').rows.slice(0, 10),
      byVehicleType: pivotByMonth(trips, 'vehicleType').rows,
      byMonth: pivotByMonth(trips, () => 'all'),
    };
  }

  // ----------------------------------------------------------------- import
  const HEADER_ALIASES = {
    dateDispatched: ['date dispatched', 'dispatch date', 'date'], dateDelivered: ['date delivered', 'delivery date'], plate: ['plate number', 'plate', 'vehicle number', 'truck'],
    assetCode: ['asset code'], vehicleType: ['type of vehicle', 'vehicle type'], vehicleCategory: ['type', 'vehicle category'], costCenter: ['cost center', 'cost centre'],
    contractType: ['contract type'], client: ['client name', 'client', 'customer'], loadingFrom: ['loading from', 'origin', 'from'], loadingTo: ['loading to', 'destination', 'to'],
    journeyPlanId: ['journey plan id', 'trip number', 'journey plan'], waybill: ['client waybill number', 'waybill number', 'waybill'], returnWaybill: ['return waybill received?', 'return waybill received', 'return waybill'],
    invoiceStatus: ['invoice status'], sellingPrice: ['selling price (₦)', 'selling price', 'selling price (n)', 'amount'], quoteNo: ['quote number', 'quote no'], soNo: ['so number', 'sales order number', 'so no'],
    manualInvoiceNo: ['manual invoice number', 'manual invoice ref.', 'manual invoice'], invoiceNo: ['invoice number'], paymentStatus: ['payment status'], advance: ['advance (₦)', 'advance'], note: ['note', 'notes', 'remarks'],
  };
  function mapHeaders(headers) {
    const map = {};
    headers.forEach((h, i) => { const k = norm(h); for (const [field, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(k) && map[field] === undefined) map[field] = i; });
    return map;
  }
  function normalizeInvoiceStatus(raw, paymentStatus) {
    const r = norm(raw);
    if (r === 'internal client' || r === 'internal') return 'Internal Client';
    if (r.startsWith('invoice sent') || r === 'closed' || r === 'sent') return 'Invoice Sent';
    if (r === 'invoice not sent' || r === 'not sent') return 'Invoice Not Sent';
    if (!r) return paymentStatus === 'Paid' || paymentStatus === 'Advance' ? 'Invoice Sent' : 'Invoice Not Sent';
    return 'Invoice Not Sent';
  }
  function normalizePaymentStatus(raw) { const r = norm(raw); if (r === 'paid') return 'Paid'; if (r.startsWith('advance') || r === 'special payment') return 'Advance'; return 'Not Paid'; }
  function normalizeReturnWaybill(raw) { const r = norm(raw); if (r === 'received' || r === 'yes') return 'Received'; if (r === 'not received' || r === 'no') return 'Not Received'; return ''; }
  function excelDateToISO(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return d.toISOString().slice(0, 10); }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    const d = new Date(s); return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  /** Build a trip from a raw imported row (array) using a header map. */
  function rowToTrip(row, map) {
    const g = (k) => (map[k] === undefined ? undefined : row[map[k]]);
    const paymentStatus = normalizePaymentStatus(g('paymentStatus'));
    return {
      dateDispatched: excelDateToISO(g('dateDispatched')), dateDelivered: excelDateToISO(g('dateDelivered')),
      plate: clean(g('plate')), contractType: clean(g('contractType')), client: clean(g('client')), loadingFrom: clean(g('loadingFrom')), loadingTo: clean(g('loadingTo')),
      journeyPlanId: clean(g('journeyPlanId')), waybill: clean(g('waybill')), returnWaybill: normalizeReturnWaybill(g('returnWaybill')),
      invoiceStatusRaw: clean(g('invoiceStatus')), invoiceStatus: normalizeInvoiceStatus(g('invoiceStatus'), paymentStatus),
      sellingPrice: num(g('sellingPrice')), quoteNo: clean(g('quoteNo')), soNo: clean(g('soNo')), manualInvoiceNo: clean(g('manualInvoiceNo')), invoiceNo: clean(g('invoiceNo')),
      paymentStatus, advance: num(g('advance')), note: clean(g('note')),
    };
  }
  /** Duplicate key: a trip is the same trip when date, plate, client, waybill, journey plan and selling price all match. */
  function dupKey(t) { return [t.dateDispatched, norm(t.plate), norm(t.client), norm(t.waybill), norm(t.journeyPlanId), num(t.sellingPrice)].join('|'); }

  return {
    INVOICE_STATUSES, PAYMENT_STATUSES, RETURN_WAYBILL, TRIP_STATUSES, INVOICE_DOC_STATUSES, ROLES, ROLE_LABELS, ROLE_FIELDS, ROLE_ACTIONS, TRIP_FIELDS, MONTHS,
    round2, isNum, num, norm, clean, monthKey, monthLabel, todayISO, addDays, endOfMonth,
    assetFor, vatRateOf, rateStatus, lookupAgreedRate, variance, tripStatus, computeTrip, validateTrip,
    can, canEditField, editableFields,
    clientCode, generateInvoiceNumber, eligibleTrips, invoiceTotals, invoiceDocStatus, findDuplicateInvoiceNumber,
    sum, filterTrips, tripMatches, clientSummary, pivotByMonth, dashboard,
    HEADER_ALIASES, mapHeaders, normalizeInvoiceStatus, normalizePaymentStatus, normalizeReturnWaybill, excelDateToISO, rowToTrip, dupKey,
  };
});
