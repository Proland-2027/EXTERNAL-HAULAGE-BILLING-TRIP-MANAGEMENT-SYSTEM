#!/usr/bin/env node
/* Builds data/workbook/*.json from the openpyxl extract (tools/extract_workbook.py output). */
const fs = require('fs');
const path = require('path');
const E = require('../js/core/engine.js');
const src = process.argv[2];
if (!src) { console.error('usage: node tools/build_seed.js <workbook_data.json>'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const out = path.join(__dirname, '..', 'data', 'workbook');

const assets = raw.assets.map((a) => ({ plate: E.clean(a.plate), assetCode: E.clean(a.assetCode), vehicleType: E.clean(a.vehicleType), costCenter: E.clean(a.costCenter), vehicleCategory: E.clean(a.type), active: true }));

const trips = raw.trips.map((r) => {
  const paymentStatus = E.normalizePaymentStatus(r.paymentStatus);
  const t = {
    id: 'wb-' + String(r.xlRow).padStart(4, '0'),
    dateDispatched: r.dateDispatched || '', dateDelivered: r.dateDelivered || '',
    plate: E.clean(r.plate), contractType: r.contractType == null ? '' : E.clean(r.contractType),
    client: E.clean(r.client), loadingFrom: E.clean(r.loadingFrom), loadingTo: E.clean(r.loadingTo),
    journeyPlanId: r.journeyPlanId == null ? '' : E.clean(r.journeyPlanId), waybill: r.waybill == null ? '' : E.clean(r.waybill),
    returnWaybill: E.normalizeReturnWaybill(r.returnWaybill),
    invoiceStatusRaw: E.clean(r.invoiceStatus), invoiceStatus: E.normalizeInvoiceStatus(r.invoiceStatus, paymentStatus),
    sellingPrice: E.num(r.sellingPrice), quoteNo: r.quoteNo == null || r.quoteNo === 0 ? '' : E.clean(r.quoteNo), soNo: r.soNo == null || r.soNo === 0 ? '' : E.clean(r.soNo),
    manualInvoiceNo: r.manualInvoiceNo == null || r.manualInvoiceNo === 0 ? '' : E.clean(r.manualInvoiceNo), invoiceNo: '', invoiceId: '',
    paymentStatus, advance: E.num(r.advance), note: r.note == null ? '' : E.clean(r.note),
    source: 'workbook', xlRow: r.xlRow, version: 1, createdAt: '2026-10-12T00:00:00Z', createdBy: 'workbook-import', updatedAt: '2026-10-12T00:00:00Z', updatedBy: 'workbook-import',
  };
  // Asset columns typed on old rows: keep as history but the asset master wins in computeTrip.
  const a = E.assetFor(t.plate, assets);
  t.assetCode = a ? a.assetCode : E.clean(r.assetCode); t.vehicleType = a ? a.vehicleType : E.clean(r.vehicleType); t.vehicleCategory = a ? a.vehicleCategory : ''; t.costCenter = a ? a.costCenter : E.clean(r.costCenter);
  // Preserve typed-over Amount Paid cells (formula replaced by a value in the workbook).
  if (typeof r.sellingPrice === 'number' && t.client) {
    const vat = E.round2(r.sellingPrice * 0.075); const R = r.sellingPrice + vat;
    const Y = paymentStatus === 'Paid' ? R : paymentStatus === 'Advance' ? (E.num(r.advance) || 0) : 0;
    if (typeof r.amountPaid === 'number' && Math.abs(Y - r.amountPaid) > 0.01) t.amountPaidOverride = r.amountPaid;
  }
  return t;
});

// Client master: Settings list first, then any client seen on trips; codes from the most common manual-invoice prefix.
const prefixByClient = new Map();
for (const t of trips) {
  const m = String(t.manualInvoiceNo || '').match(/^([A-Z]{2,5})-/i);
  if (!m) continue;
  const k = E.norm(t.client); if (!prefixByClient.has(k)) prefixByClient.set(k, new Map());
  const c = prefixByClient.get(k); const p = m[1].toUpperCase(); c.set(p, (c.get(p) || 0) + 1);
}
const names = new Map();
for (const n of raw.clients) names.set(E.norm(n), E.clean(n));
for (const t of trips) if (t.client && !names.has(E.norm(t.client))) names.set(E.norm(t.client), t.client);
const usedCodes = new Set();
const clients = [...names.values()].map((name) => {
  const pm = prefixByClient.get(E.norm(name));
  let code = pm ? [...pm.entries()].sort((a, b) => b[1] - a[1])[0][0] : E.clientCode(name, []);
  let base = code, n = 2; while (usedCodes.has(code)) code = base + n++;
  usedCodes.add(code);
  const mine = trips.filter((t) => E.norm(t.client) === E.norm(name));
  const ct = mine.map((t) => t.contractType).filter(Boolean);
  const contractType = ct.length ? ct.sort((a, b) => ct.filter((v) => v === b).length - ct.filter((v) => v === a).length)[0] : '';
  return { id: code.toLowerCase(), name, code, contractType, active: true, trips: mine.length };
});

const locations = [...new Set(trips.flatMap((t) => [t.loadingFrom, t.loadingTo]).filter(Boolean))].sort((a, b) => a.localeCompare(b));

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'trips.json'), JSON.stringify(trips));
fs.writeFileSync(path.join(out, 'assets.json'), JSON.stringify(assets, null, 1));
fs.writeFileSync(path.join(out, 'clients.json'), JSON.stringify(clients, null, 1));
fs.writeFileSync(path.join(out, 'locations.json'), JSON.stringify(locations, null, 1));
fs.writeFileSync(path.join(out, 'validation.json'), JSON.stringify({ statement: raw.statement, clientSummary: raw.clientSummary }, null, 1));
console.log(`trips ${trips.length}, assets ${assets.length}, clients ${clients.length}, locations ${locations.length}`);
console.log(clients.slice(0, 12).map((c) => `${c.code}=${c.name}`).join(', '));
