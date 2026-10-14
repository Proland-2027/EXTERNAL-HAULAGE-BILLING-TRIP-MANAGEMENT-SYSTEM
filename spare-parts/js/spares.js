/*
 * spares.js — DARCO JMG spare parts sourcing engine (pure functions, no DOM).
 * Runs in the browser (window.Spares) and in Node (require) so the rules can be unit-tested.
 *
 * Covers: document numbering, request validation, duplicate detection, request status workflow,
 * currency conversion, quotation comparison, purchase-order totals, supplier performance,
 * procurement history / price statistics and the Excel/CSV bulk-import mapping.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Spares = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ constants
  const URGENCIES = ['NORMAL', 'URGENT', 'CRITICAL'];
  const REQUEST_STATUSES = ['NEW', 'RFQ_SENT', 'QUOTED', 'ORDERED', 'SHIPPED', 'RECEIVED', 'CLOSED', 'ON_HOLD', 'CANCELLED'];
  const MANUAL_STATUSES = ['ON_HOLD', 'CANCELLED', 'CLOSED'];
  const RFQ_STATUSES = ['SENT', 'QUOTED', 'DECLINED', 'NO_RESPONSE'];
  const PO_STATUSES = ['DRAFT', 'SENT', 'CONFIRMED', 'PAID', 'SHIPPED', 'ARRIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'];
  const SHIP_METHODS = ['AIR', 'SEA_LCL', 'SEA_FCL', 'COURIER', 'RAIL', 'OTHER'];
  const CUSTOMS_STATUSES = ['NOT_STARTED', 'DOCS_SUBMITTED', 'UNDER_CLEARANCE', 'CLEARED', 'ON_HOLD'];
  const CHANNELS = ['WHATSAPP', 'WECHAT', 'EMAIL', 'OTHER'];
  const CURRENCIES = ['USD', 'RMB', 'NGN', 'EUR'];
  const DEFAULT_CATEGORIES = ['Engine', 'Gearbox / Transmission', 'Clutch', 'Axle / Differential', 'Brake System', 'Suspension', 'Steering', 'Cooling System', 'Fuel System', 'Electrical', 'Cabin / Body', 'Hydraulics / Tipper', 'Tyres & Wheels', 'Filters & Consumables', 'Other'];
  const DEFAULT_UNITS = ['PCS', 'SET', 'PAIR', 'KIT', 'LTR', 'KG', 'MTR', 'ROLL', 'BOX'];
  const DEFAULT_MAKES = ['SINOTRUK', 'HOWO', 'SHACMAN', 'FAW', 'DONGFENG', 'FOTON', 'BEIBEN', 'OTHER'];

  // ------------------------------------------------------------------ small helpers
  const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
  const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
  const clean = (v) => String(v == null ? '' : v).trim();
  const periodOf = (date) => clean(date).slice(0, 7);
  const daysBetween = (a, b) => { if (!a || !b) return null; const ms = new Date(b) - new Date(a); return Number.isFinite(ms) ? Math.round(ms / 86400000) : null; };
  const addDays = (date, d) => { const x = new Date(date); x.setDate(x.getDate() + num(d)); return x.toISOString().slice(0, 10); };

  /** Part numbers are compared without spaces, dashes, dots or slashes, case-insensitive. */
  function normalizePartNo(s) { return clean(s).toUpperCase().replace(/[\s\-._/\\]/g, ''); }
  function normalizeReg(s) { return clean(s).toUpperCase().replace(/[\s\-]/g, ''); }

  /** Sequential document numbers: DARCO-SP-00001, DARCO-PO-00001. Never re-uses a number. */
  function nextNumber(items, prefix, field = 'id', width = 5) {
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
    const max = items.reduce((m, it) => { const mt = re.exec(clean(it[field])); return mt ? Math.max(m, parseInt(mt[1], 10)) : m; }, 0);
    return prefix + String(max + 1).padStart(width, '0');
  }

  // ------------------------------------------------------------------ requests
  const REQUIRED_FIELDS = [
    ['requestedBy', 'Requested by'], ['department', 'Department / Workshop'], ['truckReg', 'Truck registration number'],
    ['truckMake', 'Truck make'], ['truckModel', 'Truck model'], ['category', 'Part category'],
    ['description', 'Spare part description'], ['qty', 'Required quantity'], ['unit', 'Unit of measurement'], ['urgency', 'Urgency'],
  ];
  const PHOTO_LABELS = ['Full spare part photograph', 'Photograph from a different angle', 'Close-up of part number / markings'];

  /** Returns a list of human-readable problems; empty when the request can be saved. */
  function validateRequest(r, { photosRequired = true } = {}) {
    const errors = [];
    REQUIRED_FIELDS.forEach(([k, label]) => { if (!clean(r[k])) errors.push(`${label} is required`); });
    if (clean(r.qty) && !(num(r.qty) > 0)) errors.push('Required quantity must be greater than zero');
    if (clean(r.urgency) && !URGENCIES.includes(clean(r.urgency).toUpperCase())) errors.push('Urgency must be Normal, Urgent or Critical');
    if (r.date && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) errors.push('Request date must be YYYY-MM-DD');
    if (photosRequired) {
      const photos = Array.isArray(r.photos) ? r.photos : [];
      PHOTO_LABELS.forEach((label, i) => { if (!photos[i]) errors.push(`Photo ${i + 1} (${label}) is required`); });
    }
    return errors;
  }

  /**
   * Duplicate rules:
   *  - exact: same normalised part number AND same truck registration, on a request that is still open → blocks saving.
   *  - matchingPartNo: any other request (open or closed) with the same normalised part number → flagged, not blocked.
   *  - similar: no part number, but same truck + same description (case-insensitive) still open → flagged.
   */
  function findDuplicates(r, requests, { excludeId = null } = {}) {
    const pn = normalizePartNo(r.partNo), reg = normalizeReg(r.truckReg), desc = clean(r.description).toLowerCase();
    const others = requests.filter((x) => x.id !== excludeId && x.id !== r.id);
    const open = (x) => !['CLOSED', 'CANCELLED', 'RECEIVED'].includes(x.status);
    const matchingPartNo = pn ? others.filter((x) => normalizePartNo(x.partNo) === pn) : [];
    const exact = matchingPartNo.filter((x) => open(x) && normalizeReg(x.truckReg) === reg);
    const similar = !pn && desc ? others.filter((x) => open(x) && normalizeReg(x.truckReg) === reg && clean(x.description).toLowerCase() === desc) : [];
    return { exact, matchingPartNo, similar, blocked: exact.length > 0 };
  }

  /**
   * Request status is derived from what has happened to it, unless it was manually put ON_HOLD / CANCELLED / CLOSED.
   */
  function deriveStatus(request, { rfqs = [], purchaseOrders = [] } = {}) {
    if (MANUAL_STATUSES.includes(request.status)) return request.status;
    const myRfqs = rfqs.filter((q) => q.requestId === request.id);
    const pos = purchaseOrders.filter((po) => po.status !== 'CANCELLED' && (po.lines || []).some((l) => l.requestId === request.id));
    if (pos.length) {
      const rank = (s) => PO_STATUSES.indexOf(s);
      const best = pos.map((p) => p.status).sort((a, b) => rank(b) - rank(a))[0];
      if (best === 'CLOSED' || best === 'RECEIVED') return 'RECEIVED';
      if (best === 'SHIPPED' || best === 'ARRIVED') return 'SHIPPED';
      return 'ORDERED';
    }
    if (myRfqs.some((q) => q.status === 'QUOTED')) return 'QUOTED';
    if (myRfqs.length) return 'RFQ_SENT';
    return 'NEW';
  }

  // ------------------------------------------------------------------ currencies & quotations
  /** rates: units of base currency per 1 unit of currency, e.g. { USD: 1, RMB: 0.1389, NGN: 0.00065 } with base USD. */
  function convert(amount, from, to, rates) {
    const a = num(amount); if (!a) return 0;
    const rf = num((rates || {})[from]) || (from === to ? 1 : 0), rt = num((rates || {})[to]) || (from === to ? 1 : 0);
    if (!rf || !rt) return from === to ? a : NaN;
    return a * rf / rt;
  }

  /** Total a quotation for the quantity requested: unit price × max(qty, MOQ) + shipping (all in the quote currency). */
  function quoteTotal(quote, qty) {
    const q = Math.max(num(qty), num(quote.moq) || 0);
    const goods = round2(num(quote.unitPrice) * q);
    return { qty: q, moqApplied: q > num(qty), goods, shipping: round2(quote.shippingCost), total: round2(goods + num(quote.shippingCost)) };
  }

  /**
   * Compare all quotations received for one request, in the base currency. Each row carries the
   * landed estimate (goods + shipping) and flags for the lowest price, fastest delivery and the best
   * overall score. Score = price rank weighted 60 %, lead time 25 %, supplier rating 15 %.
   */
  function compareQuotes(request, rfqs, suppliers, { rates = { USD: 1 }, baseCurrency = 'USD' } = {}) {
    const rows = rfqs.filter((q) => q.requestId === request.id && q.status === 'QUOTED' && q.quote).map((q) => {
      const s = suppliers.find((x) => x.id === q.supplierId) || { name: q.supplierId, rating: 0 };
      const t = quoteTotal(q.quote, request.qty);
      const cur = q.quote.currency || s.currency || baseCurrency;
      const unitBase = convert(q.quote.unitPrice, cur, baseCurrency, rates);
      const totalBase = convert(t.total, cur, baseCurrency, rates);
      return { rfqId: q.id, supplierId: q.supplierId, supplierName: s.name, rating: num(s.rating), brand: q.quote.brand || '', currency: cur,
        unitPrice: num(q.quote.unitPrice), unitPriceBase: round2(unitBase), qty: t.qty, moqApplied: t.moqApplied, goods: t.goods, shipping: t.shipping, total: t.total,
        totalBase: round2(totalBase), leadTimeDays: q.quote.leadTimeDays == null || q.quote.leadTimeDays === '' ? null : num(q.quote.leadTimeDays),
        availability: q.quote.availability || '', warranty: q.quote.warranty || '', validUntil: q.quote.validUntil || '', remarks: q.quote.remarks || '', selected: !!q.selected,
        lowestPrice: false, fastest: false, best: false, score: 0 };
    });
    if (!rows.length) return { baseCurrency, rows, lowest: null, fastest: null, best: null, spread: 0 };
    const priced = rows.filter((r) => Number.isFinite(r.totalBase) && r.totalBase > 0);
    const minTotal = Math.min(...priced.map((r) => r.totalBase)), maxTotal = Math.max(...priced.map((r) => r.totalBase));
    const leads = rows.filter((r) => r.leadTimeDays != null).map((r) => r.leadTimeDays);
    const minLead = leads.length ? Math.min(...leads) : null, maxLead = leads.length ? Math.max(...leads) : null;
    rows.forEach((r) => {
      const priceScore = priced.length && Number.isFinite(r.totalBase) && r.totalBase > 0 ? (maxTotal === minTotal ? 1 : 1 - (r.totalBase - minTotal) / (maxTotal - minTotal)) : 0;
      const leadScore = r.leadTimeDays == null ? 0.5 : (maxLead === minLead ? 1 : 1 - (r.leadTimeDays - minLead) / (maxLead - minLead));
      const ratingScore = Math.min(5, Math.max(0, r.rating)) / 5;
      r.score = round2(100 * (0.6 * priceScore + 0.25 * leadScore + 0.15 * ratingScore));
      r.lowestPrice = priced.length > 0 && r.totalBase === minTotal;
      r.fastest = minLead != null && r.leadTimeDays === minLead;
      r.vsLowestPct = priced.length && minTotal > 0 && Number.isFinite(r.totalBase) ? round2(((r.totalBase - minTotal) / minTotal) * 100) : null;
    });
    rows.sort((a, b) => b.score - a.score || a.totalBase - b.totalBase);
    rows[0].best = true;
    return { baseCurrency, rows, lowest: rows.find((r) => r.lowestPrice) || null, fastest: rows.find((r) => r.fastest) || null, best: rows[0], spread: round2(maxTotal - minTotal) };
  }

  // ------------------------------------------------------------------ purchase orders
  function poLineFromQuote(request, rfq, supplier) {
    const t = quoteTotal(rfq.quote, request.qty);
    return { id: `${rfq.id}-L`, requestId: request.id, rfqId: rfq.id, partNo: request.partNo || '', description: request.description, brand: rfq.quote.brand || '',
      truckReg: request.truckReg, qty: t.qty, unit: request.unit, unitPrice: num(rfq.quote.unitPrice), amount: t.goods, leadTimeDays: rfq.quote.leadTimeDays == null ? null : num(rfq.quote.leadTimeDays), warranty: rfq.quote.warranty || '' };
  }

  /** Recomputes line amounts and totals in place and returns the PO. */
  function totalPo(po) {
    po.lines = (po.lines || []).map((l) => Object.assign(l, { qty: num(l.qty), unitPrice: num(l.unitPrice), amount: round2(num(l.qty) * num(l.unitPrice)) }));
    po.subtotal = round2(po.lines.reduce((s, l) => s + l.amount, 0));
    po.shippingCost = round2(po.shippingCost); po.otherCost = round2(po.otherCost); po.discount = round2(po.discount);
    po.total = round2(po.subtotal + po.shippingCost + po.otherCost - po.discount);
    po.items = po.lines.length; po.totalQty = round2(po.lines.reduce((s, l) => s + l.qty, 0));
    return po;
  }

  function buildPo({ number, supplier, request_lines, date, currency, paymentTerms, shippingCost = 0, otherCost = 0, discount = 0, notes = '', deliveryTo = '' }) {
    const po = { id: `PO-${number}`, number, supplierId: supplier.id, supplierName: supplier.name, date, currency: currency || supplier.currency || 'USD', paymentTerms: paymentTerms || supplier.paymentTerms || '',
      status: 'DRAFT', lines: request_lines, shippingCost, otherCost, discount, notes, deliveryTo, createdAt: new Date().toISOString(),
      shipment: { method: '', forwarder: '', trackingNo: '', originPort: '', destinationPort: '', etd: '', eta: '', shippedAt: '', arrivedAt: '', customsStatus: 'NOT_STARTED', receivedAt: '', receivedBy: '', receivedQtyOk: true, remarks: '' },
      history: [{ at: new Date().toISOString(), status: 'DRAFT', note: 'Created' }] };
    return totalPo(po);
  }

  /** Expected lead time for a PO = the longest quoted lead time of its lines (days). */
  function poLeadTimeDays(po) { const l = (po.lines || []).map((x) => x.leadTimeDays).filter((x) => x != null && Number.isFinite(num(x))); return l.length ? Math.max(...l.map(num)) : null; }

  // ------------------------------------------------------------------ suppliers
  /** Orders, spend, on-time deliveries and average lead time per supplier, from the purchase orders. */
  function supplierStats(supplierId, purchaseOrders, rfqs = [], { rates = { USD: 1 }, baseCurrency = 'USD' } = {}) {
    const pos = purchaseOrders.filter((p) => p.supplierId === supplierId && p.status !== 'CANCELLED');
    const received = pos.filter((p) => p.shipment && p.shipment.receivedAt);
    const onTime = received.filter((p) => !p.shipment.eta || p.shipment.receivedAt <= p.shipment.eta).length;
    const leadDays = received.map((p) => daysBetween(p.date, p.shipment.receivedAt)).filter((d) => d != null);
    const spend = pos.reduce((s, p) => s + convert(p.total, p.currency, baseCurrency, rates), 0);
    const myRfqs = rfqs.filter((q) => q.supplierId === supplierId);
    const quoted = myRfqs.filter((q) => q.status === 'QUOTED').length;
    const won = myRfqs.filter((q) => q.selected).length;
    return { orders: pos.length, open: pos.filter((p) => !['RECEIVED', 'CLOSED'].includes(p.status)).length, received: received.length, onTime,
      onTimePct: received.length ? round2((onTime / received.length) * 100) : null, avgLeadDays: leadDays.length ? Math.round(leadDays.reduce((a, b) => a + b, 0) / leadDays.length) : null,
      spendBase: round2(spend), rfqs: myRfqs.length, quoted, responseRatePct: myRfqs.length ? round2((quoted / myRfqs.length) * 100) : null, won, lastOrder: pos.map((p) => p.date).sort().reverse()[0] || '' };
  }

  // ------------------------------------------------------------------ procurement history
  /** Every PO line, flattened with the PO header, newest first. Filter by part number, truck or supplier. */
  function historyLines(purchaseOrders, { partNo = '', truckReg = '', supplierId = '', requestId = '' } = {}) {
    const pn = normalizePartNo(partNo), reg = normalizeReg(truckReg);
    const out = [];
    purchaseOrders.forEach((po) => (po.lines || []).forEach((l) => {
      if (pn && normalizePartNo(l.partNo) !== pn) return;
      if (reg && normalizeReg(l.truckReg) !== reg) return;
      if (supplierId && po.supplierId !== supplierId) return;
      if (requestId && l.requestId !== requestId) return;
      out.push({ poId: po.id, poNumber: po.number, date: po.date, supplierId: po.supplierId, supplierName: po.supplierName, currency: po.currency, poStatus: po.status, receivedAt: (po.shipment || {}).receivedAt || '', ...l });
    }));
    return out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.poNumber.localeCompare(a.poNumber));
  }

  /** Price statistics for a part number across all purchase orders, in base currency. */
  function priceStats(partNo, purchaseOrders, { rates = { USD: 1 }, baseCurrency = 'USD' } = {}) {
    const lines = historyLines(purchaseOrders, { partNo }).filter((l) => l.poStatus !== 'CANCELLED');
    const prices = lines.map((l) => convert(l.unitPrice, l.currency, baseCurrency, rates)).filter((p) => Number.isFinite(p) && p > 0);
    if (!prices.length) return { partNo, count: 0, last: null, min: null, max: null, avg: null, lastSupplier: '', lastDate: '' };
    return { partNo, count: prices.length, last: round2(prices[0]), min: round2(Math.min(...prices)), max: round2(Math.max(...prices)), avg: round2(prices.reduce((a, b) => a + b, 0) / prices.length), lastSupplier: lines[0].supplierName, lastDate: lines[0].date, baseCurrency };
  }

  // ------------------------------------------------------------------ bulk import (Excel / CSV)
  /** Header aliases → request field. Matching ignores case, spaces and punctuation. */
  const IMPORT_COLUMNS = {
    id: ['request id', 'requestid', 'id', 'ref', 'reference', 'request no', 'request number'],
    date: ['request date', 'date'], requestedBy: ['requested by', 'requester', 'requestedby', 'raised by'],
    department: ['department', 'workshop', 'department / workshop', 'dept'], truckReg: ['truck registration number', 'truck reg', 'registration', 'reg no', 'plate', 'plate number', 'vehicle'],
    truckMake: ['truck make', 'make', 'brand'], truckModel: ['truck model', 'model'], chassis: ['chassis', 'vin', 'chassis/vin', 'chassis vin number', 'chassis no', 'vin number'],
    engineModel: ['engine model', 'engine'], category: ['part category', 'category'], description: ['spare part description', 'description', 'part description', 'part name', 'item'],
    partNo: ['oem part number', 'oem / manufacturer part number', 'part number', 'part no', 'oem', 'oem no', 'manufacturer part number', 'pn'],
    qty: ['required quantity', 'quantity', 'qty'], unit: ['unit of measurement', 'unit', 'uom'], urgency: ['urgency', 'priority'],
    size: ['size / specification', 'size', 'specification', 'spec'], remarks: ['additional remarks', 'remarks', 'notes', 'comment'], status: ['status'],
  };
  const IMPORT_TEMPLATE_HEADERS = ['Request ID', 'Request Date', 'Requested By', 'Department / Workshop', 'Truck Registration Number', 'Truck Make', 'Truck Model', 'Chassis/VIN Number', 'Engine Model', 'Part Category', 'Spare Part Description', 'OEM Part Number', 'Required Quantity', 'Unit of Measurement', 'Urgency', 'Size / Specification', 'Additional Remarks', 'Status'];
  const normHeader = (h) => clean(h).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function mapHeaders(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const nh = normHeader(h); if (!nh) return;
      for (const [field, aliases] of Object.entries(IMPORT_COLUMNS)) { if (aliases.some((a) => normHeader(a) === nh) && map[field] == null) { map[field] = i; return; } }
    });
    return map;
  }

  /** Tiny RFC-4180 CSV parser (quotes, embedded commas / newlines). Returns rows of strings. */
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => clean(c) !== ''));
  }

  function excelDate(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return isNaN(d) ? '' : d.toISOString().slice(0, 10); }
    const s = clean(v);
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // dd/mm/yyyy
    const d = new Date(s); return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }

  /**
   * rows: array-of-arrays (first row = headers). Returns { requests, errors, skipped, headerMap }.
   * Rows with an id already in `existing` are skipped (unless overwrite). Missing ids are assigned sequentially.
   * Duplicates (same part no + truck, open) are flagged on the row but still imported when `allowDuplicates`.
   */
  function importRequests(rows, { existing = [], prefix = 'DARCO-SP-', today = new Date().toISOString().slice(0, 10), allowDuplicates = true, defaults = {} } = {}) {
    const out = { requests: [], errors: [], skipped: [], headerMap: {} };
    if (!rows || rows.length < 2) { out.errors.push({ row: 0, message: 'No data rows found (first row must be the column headers)' }); return out; }
    const map = mapHeaders(rows[0]); out.headerMap = map;
    if (map.description == null) { out.errors.push({ row: 1, message: 'Could not find a "Spare Part Description" column' }); return out; }
    const all = existing.slice();
    const get = (r, f) => (map[f] == null ? '' : r[map[f]]);
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r || !r.some((c) => clean(c))) continue;
      const rowNo = i + 1;
      const req = {
        id: clean(get(r, 'id')), date: excelDate(get(r, 'date')) || today, requestedBy: clean(get(r, 'requestedBy')) || defaults.requestedBy || '', department: clean(get(r, 'department')) || defaults.department || '',
        truckReg: clean(get(r, 'truckReg')).toUpperCase(), truckMake: clean(get(r, 'truckMake')).toUpperCase(), truckModel: clean(get(r, 'truckModel')), chassis: clean(get(r, 'chassis')).toUpperCase(), engineModel: clean(get(r, 'engineModel')),
        category: clean(get(r, 'category')) || defaults.category || 'Other', description: clean(get(r, 'description')), partNo: clean(get(r, 'partNo')).toUpperCase(), qty: num(get(r, 'qty')) || 1,
        unit: (clean(get(r, 'unit')) || defaults.unit || 'PCS').toUpperCase(), urgency: (clean(get(r, 'urgency')) || 'NORMAL').toUpperCase(), size: clean(get(r, 'size')), remarks: clean(get(r, 'remarks')),
        status: (clean(get(r, 'status')) || 'NEW').toUpperCase().replace(/[\s-]+/g, '_'), photos: [], imported: true, importedAt: today,
      };
      if (!URGENCIES.includes(req.urgency)) req.urgency = 'NORMAL';
      if (!REQUEST_STATUSES.includes(req.status)) req.status = 'NEW';
      if (req.id && all.some((x) => x.id === req.id)) { out.skipped.push({ row: rowNo, id: req.id, message: 'Request ID already exists' }); continue; }
      const errs = validateRequest(req, { photosRequired: false });
      if (errs.length) { out.errors.push({ row: rowNo, id: req.id, message: errs.join('; ') }); continue; }
      const dup = findDuplicates(req, all);
      req.duplicateOf = dup.exact.map((x) => x.id);
      req.matchingPartNo = dup.matchingPartNo.map((x) => x.id);
      if (dup.blocked && !allowDuplicates) { out.skipped.push({ row: rowNo, id: req.id, message: `Duplicate of ${dup.exact.map((x) => x.id).join(', ')}` }); continue; }
      if (!req.id) req.id = nextNumber(all, prefix);
      all.push(req); out.requests.push(req);
    }
    return out;
  }

  /** Rows for the Excel export of requests (and the import template, which uses the same headers). */
  function requestRows(requests) {
    return [IMPORT_TEMPLATE_HEADERS.slice(0, 18).concat(['Photos']), ...requests.map((r) => [r.id, r.date, r.requestedBy, r.department, r.truckReg, r.truckMake, r.truckModel, r.chassis, r.engineModel, r.category, r.description, r.partNo, r.qty, r.unit, r.urgency, r.size, r.remarks, r.status, (r.photos || []).filter(Boolean).length])];
  }

  // ------------------------------------------------------------------ messages
  /** WhatsApp text that accompanies the RFQ PDF. Plain, short English for Chinese suppliers. */
  function rfqMessage(request, settings = {}, supplier = {}) {
    const company = settings.company || 'DARCO JMG';
    const hi = supplier.contact ? `Hello ${supplier.contact},` : 'Hello,';
    return [`${hi}`, `${company} (${settings.country || 'Nigeria'}) requests a quotation for one spare part:`, '',
      `Ref: ${request.id}`, `Part: ${request.description}`, request.partNo ? `OEM / Part No: ${request.partNo}` : null, `Truck: ${[request.truckMake, request.truckModel].filter(Boolean).join(' ')}${request.engineModel ? ` (engine ${request.engineModel})` : ''}`,
      `Quantity: ${num(request.qty)} ${request.unit}`, request.size ? `Spec: ${request.size}` : null, '',
      'Please see the attached PDF with 3 photos and reply with: brand, unit price (USD or RMB), availability / lead time and warranty.',
      `Destination: ${settings.destination || 'Lagos, Nigeria'}.`, settings.procurementContact ? `Contact: ${settings.procurementContact}${settings.procurementPhone ? ' ' + settings.procurementPhone : ''}` : null, 'Thank you.'].filter((l) => l != null).join('\n');
  }
  function whatsappUrl(number, text) {
    const n = clean(number).replace(/[^\d]/g, '');
    return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
  }

  return { URGENCIES, REQUEST_STATUSES, MANUAL_STATUSES, RFQ_STATUSES, PO_STATUSES, SHIP_METHODS, CUSTOMS_STATUSES, CHANNELS, CURRENCIES, DEFAULT_CATEGORIES, DEFAULT_UNITS, DEFAULT_MAKES, PHOTO_LABELS, REQUIRED_FIELDS, IMPORT_TEMPLATE_HEADERS, IMPORT_COLUMNS,
    num, round2, clean, periodOf, daysBetween, addDays, normalizePartNo, normalizeReg, nextNumber, validateRequest, findDuplicates, deriveStatus, convert, quoteTotal, compareQuotes, poLineFromQuote, totalPo, buildPo, poLeadTimeDays,
    supplierStats, historyLines, priceStats, mapHeaders, parseCsv, excelDate, importRequests, requestRows, rfqMessage, whatsappUrl };
});
