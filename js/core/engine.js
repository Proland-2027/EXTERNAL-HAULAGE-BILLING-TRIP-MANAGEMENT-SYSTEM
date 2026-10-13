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
  // Invoice status is derived from the invoice record, never chosen by hand (Draft → Issued → Sent; Void). Legacy workbook
  // values are mapped on read: 'Invoice Not Sent' → 'Not Invoiced'.
  const INVOICE_STATUSES = ['Not Invoiced', 'Draft Invoice', 'Invoice Issued', 'Invoice Sent', 'Partially Invoiced', 'Invoice Voided', 'Internal Client'];
  const LEGACY_INVOICE_STATUS = { 'Invoice Not Sent': 'Not Invoiced', 'Not Sent': 'Not Invoiced' };
  const WAYBILL_STATUSES = ['Awaiting Waybill', 'Waybill Number Entered', 'Waybill Received', 'Waybill Verification Pending', 'Waybill Verified'];
  const PAYMENT_LABELS = { 'Not Paid': 'Unpaid', Advance: 'Part Paid', Paid: 'Paid' };
  const DEFAULT_TRIP_ID_PATTERN = '^[A-Za-z]{2,6}-?\\d{3,8}$';
  const PAYMENT_STATUSES = ['Not Paid', 'Advance', 'Paid'];
  const RETURN_WAYBILL = ['', 'Received', 'Not Received'];
  const TRIP_STATUSES = ['Invoice Not Sent', 'Awaiting Payment', 'Part Paid - Balance Due', 'Closed', 'Internal Client'];
  const INVOICE_DOC_STATUSES = ['Draft', 'Issued', 'Sent', 'Paid', 'Void'];
  const VAT_TREATMENTS = ['exclusive', 'inclusive'];
  const VAT_TREATMENT_LABELS = { exclusive: 'Price Excluding VAT', inclusive: 'Price Including VAT' };
  const TRUCK_BATCHES = ['New Batch', 'Old Batch'];
  const ROLES = ['admin', 'operations', 'tracking', 'planning', 'billing', 'finance', 'management'];
  const ROLE_LABELS = { admin: 'Administrator', operations: 'Operations Team', tracking: 'Tracking Officer', planning: 'Fleet Planner', billing: 'Billing Team', finance: 'Finance Team', management: 'Management' };

  // Field groups on a trip. Each role may edit the groups listed in ROLE_FIELDS.
  const FIELD_GROUPS = {
    operations: ['dateDispatched', 'dateDelivered', 'plate', 'contractType', 'client', 'loadingFrom', 'loadingTo', 'journeyPlanId', 'waybill', 'returnWaybill', 'note', 'agreedRateId',
      'allocationId', 'requestId', 'waybillEnteredAt', 'waybillReceivedAt', 'waybillReceivedBy', 'waybillDocId', 'waybillDocName', 'tripIdSource'],
    // invoiceStatus / invoiceId / invoiceNo are written by the invoice workflow only (no manual selection in the UI).
    billing: ['sellingPrice', 'vatTreatment', 'quoteNo', 'soNo', 'manualInvoiceNo', 'invoiceStatus', 'invoiceNo', 'invoiceId', 'agreedRateId', 'internalClient', 'waybillVerifiedAt', 'waybillVerifiedBy', 'waybillReceivedAt', 'waybillReceivedBy', 'waybillDocId', 'waybillDocName', 'waybill', 'journeyPlanId'],
    finance: ['paymentStatus', 'advance', 'note'],
  };
  const ROLE_FIELDS = {
    admin: [...new Set([...FIELD_GROUPS.operations, ...FIELD_GROUPS.billing, ...FIELD_GROUPS.finance])],
    operations: FIELD_GROUPS.operations,
    tracking: [],
    planning: FIELD_GROUPS.operations,
    billing: FIELD_GROUPS.billing,
    finance: FIELD_GROUPS.finance,
    management: [],
  };
  // Coarse actions.
  const ROLE_ACTIONS = {
    admin: ['trip.create', 'trip.edit', 'trip.delete', 'trip.import', 'rate.manage', 'invoice.manage', 'payment.manage', 'client.manage', 'asset.manage', 'user.manage', 'settings.manage', 'report.view', 'variance.review', 'audit.view', 'export', 'fmr.update', 'planning.manage', 'request.manage', 'waybill.verify', 'tripid.assign', 'trip.fromPlanning', 'allocation.split'],
    operations: ['trip.create', 'trip.edit', 'trip.import', 'report.view', 'export', 'fmr.update', 'planning.manage', 'request.manage', 'tripid.assign', 'trip.fromPlanning', 'allocation.split'],
    tracking: ['fmr.update', 'report.view', 'export'],
    planning: ['trip.create', 'trip.edit', 'report.view', 'export', 'fmr.update', 'planning.manage', 'request.manage', 'tripid.assign', 'trip.fromPlanning', 'allocation.split'],
    // billing creates Trip Log entries only from fleet allocations (trip.fromPlanning), never by typing operational data
    billing: ['trip.edit', 'invoice.manage', 'report.view', 'export', 'rate.view', 'waybill.verify', 'trip.fromPlanning'],
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
    { key: 'truckBatch', label: 'Truck Batch', type: 'derived' },
    { key: 'contractType', label: 'Contract Type', type: 'text', excel: 'H' },
    { key: 'client', label: 'Client Name', type: 'client', excel: 'I' },
    { key: 'loadingFrom', label: 'Loading From', type: 'location', excel: 'J' },
    { key: 'loadingTo', label: 'Loading To', type: 'location', excel: 'K' },
    { key: 'journeyPlanId', label: 'Trip ID (Power Apps / Journey Plan)', type: 'text', excel: 'L' },
    { key: 'requestId', label: 'Request ID', type: 'text' },
    { key: 'allocationId', label: 'Allocation ID', type: 'text' },
    { key: 'waybill', label: 'Client Waybill Number', type: 'text', excel: 'M' },
    { key: 'returnWaybill', label: 'Return Waybill Received', type: 'enum', options: RETURN_WAYBILL, excel: 'N' },
    { key: 'waybillStatus', label: 'Waybill Status', type: 'computed-status' },
    { key: 'invoiceStatus', label: 'Invoice Status (automatic)', type: 'computed-status', excel: 'O' },
    { key: 'agreedPrice', label: 'Agreed Client Price (₦)', type: 'computed-money' },
    { key: 'sellingPrice', label: 'Selling Price (₦)', type: 'money', excel: 'P' },
    { key: 'variance', label: 'Price Variance (₦)', type: 'computed-money' },
    { key: 'variancePct', label: 'Price Variance (%)', type: 'computed-pct' },
    { key: 'vatTreatment', label: 'VAT Treatment', type: 'enum', options: VAT_TREATMENTS },
    { key: 'netSales', label: 'Net Sales excl. VAT (₦)', type: 'computed-money' },
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

  // ---------------------------------------------------------- matching helpers
  /** "45T" → "45", "30T-LCL" → "30-lcl", "45" → "45": tonnage contracts compare without the T. */
  const normContract = (s) => norm(s).replace(/\s+/g, '').replace(/(\d)t(?=$|[^a-z0-9])/g, '$1');
  const locKey = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
  /** Tokens of a zone-style location such as "VI-Lekki-AJAH" or "FESTAC-MILE2 --AMOWO-OKOTA". */
  const locTokens = (s) => String(s == null ? '' : s).split(/\s*(?:--|[-\/,;&]|\bor\b)\s*/i).map(locKey).filter(Boolean);
  /** Zone lookup: zones = { "gbagada": "Lagos", ... } keyed by locKey. */
  const zoneOf = (loc, zones) => { if (!zones) return ''; const k = locKey(loc); const z = zones[k] !== undefined ? zones[k] : zones[norm(loc)]; return z ? locKey(z) : ''; };
  /** 3 = exact, 2 = same zone, 1 = the rate's zone list contains the trip location, 0 = no match. */
  function locMatch(tripLoc, rateLoc, zones) {
    const a = locKey(tripLoc), b = locKey(rateLoc); if (!a || !b) return 0;
    if (a === b) return 3;
    const za = zoneOf(tripLoc, zones), zb = zoneOf(rateLoc, zones) || b;
    if (za && za === zb) return 2;
    const tokens = locTokens(rateLoc); if (tokens.length > 1 && (tokens.includes(a) || (za && tokens.includes(za)))) return 1;
    const stripped = b.replace(/\s*\d+\s*tons?$/, ''); if (stripped !== b && (stripped === a || stripped === za)) return 2;
    return 0;
  }
  /** VAT arithmetic for one price. exclusive: VAT added on top (workbook rule); inclusive: VAT extracted from the price. */
  function vatSplit(price, rate, treatment) {
    const p = num(price); if (p === null) return { net: null, vat: null, gross: null };
    if (treatment === 'inclusive') { const net = round2(p / (1 + rate)); const vat = round2(p - net); return { net, vat, gross: p }; }
    const vat = round2(p * rate); return { net: p, vat, gross: p + vat };
  }
  /** Truck Batch in force on a date: batchHistory [{batch, effectiveDate}] wins, then truckBatch, then the workbook's Type column. */
  function batchOn(asset, date) {
    if (!asset) return '';
    const hist = Array.isArray(asset.batchHistory) ? [...asset.batchHistory].filter((h) => h && h.batch).sort((x, y) => String(x.effectiveDate || '').localeCompare(String(y.effectiveDate || ''))) : [];
    let found = '';
    for (const h of hist) if (!h.effectiveDate || !date || h.effectiveDate <= date) found = h.batch;
    if (found) return found;
    if (asset.truckBatch) return asset.truckBatch;
    const c = norm(asset.vehicleCategory);
    if (c === 'new batch') return 'New Batch';
    if (c === '3rd party' || c === 'third party') return '3rd Party';
    return c ? 'Old Batch' : '';
  }

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
   *  1. client must match (name, code or alias); loading origin and destination must match exactly, by zone
   *     (Settings → Location zones, e.g. GBAGADA → Lagos) or as a member of a zone list such as "VI-Lekki-AJAH";
   *  2. the rate must be in force on the dispatch date (effectiveDate <= date <= expiryDate);
   *  3. a rate whose vehicle type / division matches scores higher; a rate with a different vehicle type never matches;
   *  4. a rate whose contract type (tonnage) equals the trip's contract type ("45" = "45T") scores highest;
   *  5. exact location matches beat zone matches, then the latest effectiveDate wins;
   *  6. still tied with different prices → status "multiple" and the user must pick (agreedRateId).
   */
  function lookupAgreedRate(trip, rates, zones, clients) {
    const date = trip.dateDispatched || todayISO();
    const c = clientKey(trip.client, clients), v = norm(trip.vehicleType), ct = normContract(trip.contractType);
    if (!c || !trip.loadingFrom || !trip.loadingTo) return { status: 'none', rate: null, candidates: [] };
    const scored = [];
    for (const r of rates || []) {
      const rk = rateKeys(r, clients); if (rk.ck !== c) continue;
      if ((r.effectiveDate && r.effectiveDate > date) || (r.expiryDate && r.expiryDate < date)) continue;
      if (v && rk.v && rk.v !== v) continue;
      const f = locMatch(trip.loadingFrom, r.loadingFrom, zones), t = locMatch(trip.loadingTo, r.loadingTo, zones);
      if (!f || !t) continue;
      const rc = rk.ct;
      const score = (rc && rc === ct ? 40 : 0) + (rk.v && rk.v === v ? 4 : 0) + f * 3 + t * 3;
      scored.push({ r, score });
    }
    if (!scored.length) return { status: 'none', rate: null, candidates: [] };
    scored.sort((a, b) => b.score - a.score || String(b.r.effectiveDate || '').localeCompare(String(a.r.effectiveDate || '')));
    const cands = scored.map((x) => x.r);
    if (trip.agreedRateId) { const pick = cands.find((r) => r.id === trip.agreedRateId); if (pick) return { status: 'found', rate: pick, candidates: cands, picked: true }; }
    const top = scored.filter((x) => x.score === scored[0].score && (x.r.effectiveDate || '') === (scored[0].r.effectiveDate || '')).map((x) => x.r);
    if (top.length > 1 && new Set(top.map((r) => num(r.price))).size > 1) return { status: 'multiple', rate: null, candidates: cands };
    return { status: 'found', rate: top[0], candidates: cands };
  }
  /** Client identity: matches the master list by name, code or alias (e.g. "Mega Manu-Local" → MEGA MANU). */
  // The client index is built once per client list (name, code and aliases → canonical name) and reused for every
  // trip and rate; the store replaces the client array whenever a client changes, so the cache is never stale.
  const clientIndexCache = new WeakMap();
  function clientIndex(clients) {
    if (!Array.isArray(clients)) return null;
    let entry = clientIndexCache.get(clients);
    if (!entry || entry.n !== clients.length) {
      const map = new Map();
      for (const c of clients) { const key = norm(c.name); for (const alias of [c.name, c.code, ...(Array.isArray(c.aliases) ? c.aliases : [])]) { const a = norm(alias); if (a && !map.has(a)) map.set(a, key); } }
      entry = { n: clients.length, map }; clientIndexCache.set(clients, entry);
    }
    return entry.map;
  }
  function clientKey(name, clients) {
    const n = norm(name); if (!n) return '';
    const idx = clientIndex(clients); if (idx) return idx.get(n) || n;
    return n;
  }
  // Per-rate normalised fields are cached on the rate object (rates are replaced, never mutated, by the stores).
  function rateKeys(r, clients) {
    if (!r._k || r._k.client !== r.client || r._k.clients !== clients) r._k = { client: r.client, clients, ck: clientKey(r.client, clients), v: norm(r.vehicleType), ct: normContract(r.contractType) };
    return r._k;
  }

  function convertBasis(price, from, to, rate) { if (from === to) return price; return to === 'inclusive' ? round2(price * (1 + rate)) : round2(price / (1 + rate)); }
  function variance(selling, agreed) {
    if (!isNum(selling) || !isNum(agreed)) return { variance: null, variancePct: null, direction: 'na' };
    const v = round2(selling - agreed);
    const pct = agreed === 0 ? null : round2((v / agreed) * 100);
    return { variance: v, variancePct: pct, direction: v > 0 ? 'above' : v < 0 ? 'below' : 'equal' };
  }

  // ------------------------------------------------------------- trip math
  const normalizeStoredInvoiceStatus = (v) => (LEGACY_INVOICE_STATUS[v] || v || 'Not Invoiced');
  /** Workbook "Trip Status" column (payment-centric): closure only on full settlement. */
  function tripStatus(t) {
    const inv = normalizeStoredInvoiceStatus(t.invoiceStatus);
    if (inv === 'Internal Client' || t.internalClient) return 'Internal Client';
    if (t.paymentStatus === 'Paid') return 'Closed';
    if (t.paymentStatus === 'Advance' && num(t.advance) > 0) return 'Part Paid - Balance Due';
    if (inv === 'Invoice Sent') return 'Awaiting Payment';
    return 'Invoice Not Sent';
  }
  /**
   * Automated invoice status: derived from the invoice record the trip sits on (no manual selection).
   * Draft → Draft Invoice; issued (issuedAt) → Invoice Issued; sent (sentAt) → Invoice Sent; Void → Invoice Voided.
   * Internal Client is a billing flag on the trip. Trips billed before the app existed keep the workbook's 'Invoice Sent'.
   */
  function invoiceAutoStatus(trip, invoice) {
    if (trip.internalClient || trip.invoiceStatus === 'Internal Client') return 'Internal Client';
    if (invoice) {
      if (invoice.status === 'Void') return 'Invoice Voided';
      if (invoice.sentAt || invoice.status === 'Sent' || invoice.status === 'Paid') return 'Invoice Sent';
      if (invoice.issuedAt || invoice.status === 'Issued') return 'Invoice Issued';
      return 'Draft Invoice';
    }
    const legacy = normalizeStoredInvoiceStatus(trip.invoiceStatus);
    if (!trip.invoiceId && legacy === 'Invoice Sent') return 'Invoice Sent';
    if (trip.invoiceId && ['Invoice Sent', 'Invoice Issued', 'Draft Invoice'].includes(legacy)) return legacy; // invoice list not loaded
    return 'Not Invoiced';
  }
  /** Automated waybill status from the waybill fields (number, physical receipt, verification). */
  function waybillStatus(trip, opts) {
    const verify = !opts || opts.waybillVerification !== false;
    if (trip.waybillVerifiedAt) return 'Waybill Verified';
    if (trip.waybillReceivedAt || trip.returnWaybill === 'Received') return verify ? 'Waybill Verification Pending' : 'Waybill Received';
    if (clean(trip.waybill)) return 'Waybill Number Entered';
    return 'Awaiting Waybill';
  }
  const paymentLabel = (paymentStatus) => PAYMENT_LABELS[paymentStatus] || 'Unpaid';
  /** Power Apps Trip IDs are entered, never generated: validate the format and reject duplicates. */
  function tripIdValid(id, pattern) { const v = clean(id); if (!v) return true; try { return new RegExp(pattern || DEFAULT_TRIP_ID_PATTERN, 'i').test(v); } catch (e) { return true; } }
  function findDuplicateTripId(id, trips, excludeId) { const k = norm(id); if (!k) return null; return (trips || []).find((t) => t.id !== excludeId && !t._del && norm(t.journeyPlanId) === k) || null; }

  /** Returns a new object: the trip plus every computed column. Selling price is never touched. */
  function computeTrip(trip, ctx) {
    ctx = ctx || {};
    const t = Object.assign({}, trip);
    const asset = assetFor(t.plate, ctx.assets);
    if (asset) { t.assetCode = asset.assetCode; t.vehicleType = asset.vehicleType; t.vehicleCategory = asset.vehicleCategory; t.costCenter = asset.costCenter; }
    const rate = vatRateOf(ctx.settings);
    const p = num(t.sellingPrice);
    t.sellingPrice = p;
    t.vatTreatment = t.vatTreatment === 'inclusive' ? 'inclusive' : 'exclusive';
    if (t.vatTreatment === 'inclusive') { const sp = vatSplit(p, rate, 'inclusive'); t.vat = sp.vat; t.billing = sp.gross; t.netSales = sp.net; }
    else { t.vat = p === null ? null : round2(p * rate); t.billing = p === null ? null : p + t.vat; t.netSales = p; } // Q, R (workbook does not round R)
    t.truckBatch = t.truckBatch || batchOn(asset, t.dateDispatched);
    const adv = num(t.advance);
    // Y — five workbook rows had the formula typed over; those keep their value in amountPaidOverride.
    t.amountPaid = isNum(num(t.amountPaidOverride)) ? num(t.amountPaidOverride) : !t.client ? null : t.paymentStatus === 'Paid' ? (t.billing || 0) : t.paymentStatus === 'Advance' ? (adv || 0) : 0;
    t.balance = !t.client || t.billing === null ? null : t.billing - t.amountPaid; // Z
    t.total = t.billing;                                           // AA
    t.month = monthKey(t.dateDispatched);                          // AB
    // automated statuses (invoice status comes from the invoice record when the list is supplied)
    const inv = t.invoiceId && ctx.invoices ? (ctx.invoices.find ? ctx.invoices.find((i) => i.id === t.invoiceId) : ctx.invoices.get(t.invoiceId)) : null;
    t.invoiceStatus = invoiceAutoStatus(t, inv || null);
    t.invoiceIssuedAt = inv ? inv.issuedAt || '' : t.invoiceIssuedAt || '';
    t.invoiceSentAt = inv ? inv.sentAt || '' : t.invoiceSentAt || '';
    t.waybillStatus = waybillStatus(t, ctx.planning && ctx.planning.setup);
    t.paymentLabel = paymentLabel(t.paymentStatus);
    t.tripStatus = tripStatus(t);
    const lk = lookupAgreedRate(t, ctx.rates, ctx.zones, ctx.clients);
    t.agreedStatus = lk.status;
    t.agreedRate = lk.rate;
    t.agreedPriceListed = lk.rate ? num(lk.rate.price) : null;
    // Compare like with like: the agreed price is shown on the trip's VAT basis.
    t.agreedPrice = t.agreedPriceListed === null ? null : convertBasis(t.agreedPriceListed, lk.rate.priceBasis === 'inclusive' ? 'inclusive' : 'exclusive', t.vatTreatment, rate);
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
    if (t.invoiceStatus && !INVOICE_STATUSES.includes(t.invoiceStatus) && !LEGACY_INVOICE_STATUS[t.invoiceStatus]) errors.push('Invoice Status is invalid.');
    // Trip ID format and uniqueness apply to IDs being entered or changed now. Values already on the record (the
    // workbook history holds free-text Journey Plan entries and repeats) are left as they are.
    const pattern = ctx && ctx.planning && ctx.planning.setup && ctx.planning.setup.tripIdPattern;
    const tripIdChanged = clean(t.journeyPlanId) && !(ctx && ctx.current && norm(ctx.current.journeyPlanId) === norm(t.journeyPlanId));
    if (tripIdChanged && !tripIdValid(t.journeyPlanId, pattern)) errors.push(`Trip ID "${clean(t.journeyPlanId)}" does not match the Power Apps format.`);
    if (tripIdChanged && ctx && ctx.trips) { const dup = findDuplicateTripId(t.journeyPlanId, ctx.trips, t.id); if (dup) errors.push(`Trip ID ${clean(t.journeyPlanId)} is already on the trip of ${dup.client} dispatched ${dup.dateDispatched}.`); }
    if (t.waybillReceivedAt && t.waybillEnteredAt && t.waybillReceivedAt.slice(0, 10) < (t.dateDispatched || '')) errors.push('Waybill received date cannot be before the dispatch date.');
    if (t.vatTreatment && !VAT_TREATMENTS.includes(t.vatTreatment)) errors.push('VAT treatment is invalid.');
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
      && t.paymentStatus !== 'Paid' && (opts.includeInvoiced || !t.invoiceId) && t.invoiceStatus !== 'Internal Client' && !t.internalClient);
  }
  /** Invoice totals. priceType 'inclusive' extracts VAT from each selling price; 'exclusive' adds it (default). */
  function invoiceTotals(trips, vatRate, priceType) {
    const rate = isNum(vatRate) ? vatRate : 0.075;
    let subtotal = 0, vat = 0, total = 0;
    for (const t of trips) { const sp = vatSplit(t.sellingPrice, rate, priceType || t.vatTreatment || 'exclusive'); if (sp.net === null) continue; subtotal += sp.net; vat += sp.vat; total += sp.gross; }
    return { subtotal: round2(subtotal), vat: round2(vat), total: round2(total), count: trips.length };
  }
  /** Invoice document status: Draft → Issued → Sent → Paid (every trip settled); Void is terminal. */
  function invoiceDocStatus(inv, trips) {
    if (inv.status === 'Void') return 'Void';
    const mine = trips.filter((t) => t.invoiceId === inv.id);
    if (mine.length && mine.every((t) => t.paymentStatus === 'Paid')) return 'Paid';
    if (inv.status === 'Sent' || inv.sentAt) return 'Sent';
    return inv.status === 'Issued' || inv.issuedAt ? 'Issued' : 'Draft';
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
      && (!f.invoiceStatus || t.invoiceStatus === f.invoiceStatus || LEGACY_INVOICE_STATUS[f.invoiceStatus] === t.invoiceStatus)
      && (!f.waybillStatus || t.waybillStatus === f.waybillStatus)
      && (!f.requestId || t.requestId === f.requestId)
      && (!f.tripStatus || t.tripStatus === f.tripStatus)
      && (!f.plate || norm(t.plate) === norm(f.plate))
      && (!f.truckBatch || t.truckBatch === f.truckBatch)
      && (!f.contractType || normContract(t.contractType) === normContract(f.contractType))
      && (!f.vatTreatment || t.vatTreatment === f.vatTreatment)
      && (!f.search || tripMatches(t, f.search)));
  }
  function tripMatches(t, q) {
    const s = norm(q); if (!s) return true;
    return ['client', 'plate', 'loadingFrom', 'loadingTo', 'journeyPlanId', 'waybill', 'quoteNo', 'soNo', 'manualInvoiceNo', 'invoiceNo', 'assetCode', 'contractType', 'note', 'requestId', 'allocationId'].some((k) => norm(t[k]).includes(s));
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

  /** Sales Performance by Truck Batch. basis: 'net' (excl. VAT) or 'gross' (invoiced incl. VAT). */
  function batchPerformance(trips, basis) {
    const key = basis === 'gross' ? 'billing' : 'netSales';
    const groups = { 'New Batch': [], 'Old Batch': [], Other: [] };
    for (const t of trips) (groups[t.truckBatch] || groups.Other).push(t);
    const kpi = (list) => { const trucks = new Set(list.map((t) => norm(t.plate)).filter(Boolean)).size; const sales = sum(list, key); const paid = sum(list, 'amountPaid'); return { sales, trips: list.length, trucks, perTruck: trucks ? round2(sales / trucks) : 0, perTrip: list.length ? round2(sales / list.length) : 0, paid, outstanding: round2(sum(list, 'billing') - paid), gross: sum(list, 'billing'), net: sum(list, 'netSales') }; };
    const out = { basis: key === 'billing' ? 'gross' : 'net', newBatch: kpi(groups['New Batch']), oldBatch: kpi(groups['Old Batch']), other: kpi(groups.Other), total: kpi(trips) };
    const months = [...new Set(trips.map((t) => t.month).filter(Boolean))].sort();
    out.months = months;
    out.monthly = { 'New Batch': months.map((m) => sum(groups['New Batch'].filter((t) => t.month === m), key)), 'Old Batch': months.map((m) => sum(groups['Old Batch'].filter((t) => t.month === m), key)) };
    const share = out.total.sales || 1;
    out.share = { 'New Batch': round2((out.newBatch.sales / share) * 100), 'Old Batch': round2((out.oldBatch.sales / share) * 100), Other: round2((out.other.sales / share) * 100) };
    out.topTrucks = { 'New Batch': pivotByMonth(groups['New Batch'], 'plate', key).rows.slice(0, 8), 'Old Batch': pivotByMonth(groups['Old Batch'], 'plate', key).rows.slice(0, 8) };
    return out;
  }

  // ----------------------------------------------------------------- import
  const HEADER_ALIASES = {
    dateDispatched: ['date dispatched', 'dispatch date', 'date'], dateDelivered: ['date delivered', 'delivery date'], plate: ['plate number', 'plate', 'vehicle number', 'truck'],
    assetCode: ['asset code'], vehicleType: ['type of vehicle', 'vehicle type'], vehicleCategory: ['type', 'vehicle category'], costCenter: ['cost center', 'cost centre'],
    contractType: ['contract type'], client: ['client name', 'client', 'customer'], loadingFrom: ['loading from', 'origin', 'from'], loadingTo: ['loading to', 'destination', 'to'],
    journeyPlanId: ['journey plan id', 'trip number', 'journey plan'], waybill: ['client waybill number', 'waybill number', 'waybill'], returnWaybill: ['return waybill received?', 'return waybill received', 'return waybill'],
    invoiceStatus: ['invoice status'], sellingPrice: ['selling price (₦)', 'selling price', 'selling price (n)', 'amount'], quoteNo: ['quote number', 'quote no'], soNo: ['so number', 'sales order number', 'so no'],
    manualInvoiceNo: ['manual invoice number', 'manual invoice ref.', 'manual invoice'], invoiceNo: ['invoice number'], paymentStatus: ['payment status'], advance: ['advance (₦)', 'advance'], note: ['note', 'notes', 'remarks'],
    vatTreatment: ['vat treatment', 'vat basis', 'invoice price type', 'price type'],
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
    if (r === 'invoice not sent' || r === 'not sent' || r === 'not invoiced') return 'Not Invoiced';
    if (!r) return paymentStatus === 'Paid' || paymentStatus === 'Advance' ? 'Invoice Sent' : 'Not Invoiced';
    return 'Not Invoiced';
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
      vatTreatment: /incl/i.test(String(g('vatTreatment') || '')) ? 'inclusive' : 'exclusive',
    };
  }
  /** Maps a price-list sheet (June list layout or the app's own export) to rate objects. */
  const RATE_HEADERS = { client: ['client', 'client name'], loadingFrom: ['loading point', 'loading from', 'loading origin', 'origin', 'from'], loadingTo: ['destination', 'delivery destination', 'loading to', 'to'], vehicleType: ['divison', 'division', 'vehicle type', 'type of vehicle'], contractType: ['truck tonnage', 'tonnage', 'contract type', 'contract'], contractName: ['contract name'], truckSize: ['truck size'], state: ['state'], region: ['region'], product: ['product type', 'product'],
    priceExcl: ['plist exl vat', 'plist excl vat', 'price excl vat', 'agreed price (₦) excl vat', 'jmg plist', 'plist', 'plsit', 'pl', 'plist bf vat', 'approved client price', 'agreed price', 'agreed price (₦)', 'price', 'rate', 'agreed client price (₦)'], priceIncl: ['plist inl vat', 'plist incl vat', 'plist vat incl', 'price incl vat', 'pl with vat', 'agreed price (₦) incl vat'], priceRevised: ['price august', 'revised price'], status: ['status', 'approval', 'approval status'],
    effectiveDate: ['effective date', 'effective'], expiryDate: ['expiry date', 'expiry'], remarks: ['remarks', 'notes'], priceBasis: ['price basis', 'basis'] };
  function mapRateHeaders(headers) { const map = {}; headers.forEach((h, i) => { const k = norm(h); for (const [f, al] of Object.entries(RATE_HEADERS)) if (al.includes(k) && map[f] === undefined) map[f] = i; }); return map; }
  function rowToRate(row, map, defaults) {
    defaults = defaults || {}; const g = (k) => (map[k] === undefined ? undefined : row[map[k]]);
    const client = clean(g('client')); const from = clean(g('loadingFrom')); const to = clean(g('loadingTo'));
    const excl = num(g('priceExcl')), incl = num(g('priceIncl'));
    const basisCol = norm(g('priceBasis'));
    let price = excl, priceBasis = 'exclusive';
    if (price === null && incl !== null) { price = incl; priceBasis = 'inclusive'; }
    if (basisCol.startsWith('incl')) priceBasis = 'inclusive';
    if (map.priceExcl !== undefined && /incl/.test(norm(defaults.headerText || ''))) priceBasis = 'inclusive';
    if (!client || !from || !to || price === null) return null;
    const status = clean(g('status'));
    const division = clean(g('vehicleType'));
    const remarks = [clean(g('contractName')), clean(g('truckSize')), division && norm(division) !== 'haulage' ? 'Division ' + division : '', clean(g('state')) ? 'State ' + clean(g('state')) : '', clean(g('region')) ? 'Region ' + clean(g('region')) : '', clean(g('product')), status, clean(g('remarks'))].filter(Boolean).join(' · ');
    return { client, loadingFrom: from, loadingTo: to, vehicleType: norm(division) === 'haulage' ? 'HAULAGE' : '', contractType: clean(g('contractType')), price: round2(price), priceBasis, priceIncl: incl === null ? null : round2(incl), priceRevised: num(g('priceRevised')), approved: !/not approved/i.test(status),
      effectiveDate: excelDateToISO(g('effectiveDate')) || defaults.effectiveDate || todayISO(), expiryDate: excelDateToISO(g('expiryDate')) || '', remarks };
  }
  /** Duplicate key: a trip is the same trip when date, plate, client, waybill, journey plan and selling price all match. */
  function dupKey(t) { return [t.dateDispatched, norm(t.plate), norm(t.client), norm(t.waybill), norm(t.journeyPlanId), num(t.sellingPrice)].join('|'); }

  return {
    INVOICE_STATUSES, LEGACY_INVOICE_STATUS, WAYBILL_STATUSES, PAYMENT_LABELS, DEFAULT_TRIP_ID_PATTERN, PAYMENT_STATUSES, RETURN_WAYBILL, TRIP_STATUSES, INVOICE_DOC_STATUSES, VAT_TREATMENTS, VAT_TREATMENT_LABELS, TRUCK_BATCHES, ROLES, ROLE_LABELS, ROLE_FIELDS, ROLE_ACTIONS, TRIP_FIELDS, MONTHS,
    invoiceAutoStatus, waybillStatus, paymentLabel, tripIdValid, findDuplicateTripId, normalizeStoredInvoiceStatus,
    round2, isNum, num, norm, clean, monthKey, monthLabel, todayISO, addDays, endOfMonth,
    assetFor, vatRateOf, rateStatus, lookupAgreedRate, clientKey, variance, tripStatus, computeTrip, validateTrip,
    normContract, locKey, locTokens, zoneOf, locMatch, vatSplit, batchOn, convertBasis, batchPerformance, RATE_HEADERS, mapRateHeaders, rowToRate,
    can, canEditField, editableFields,
    clientCode, generateInvoiceNumber, eligibleTrips, invoiceTotals, invoiceDocStatus, findDuplicateInvoiceNumber,
    sum, filterTrips, tripMatches, clientSummary, pivotByMonth, dashboard,
    HEADER_ALIASES, mapHeaders, normalizeInvoiceStatus, normalizePaymentStatus, normalizeReturnWaybill, excelDateToISO, rowToTrip, dupKey,
  };
});
