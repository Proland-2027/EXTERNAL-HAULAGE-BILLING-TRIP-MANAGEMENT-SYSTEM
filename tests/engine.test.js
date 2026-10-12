const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../js/core/engine.js');

const trips = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'workbook', 'trips.json'), 'utf8'));
const assets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'workbook', 'assets.json'), 'utf8'));
const clients = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'workbook', 'clients.json'), 'utf8'));
const validation = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'workbook', 'validation.json'), 'utf8'));
const settings = { vatRate: 0.075, paymentTermsDays: 7 };
const computed = trips.map((t) => E.computeTrip(t, { settings, assets, rates: [] }));
const close = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('VAT and billing formulas reproduce the workbook totals', () => {
  close(E.sum(computed, 'sellingPrice'), 4926148230.457258, 0.05);
  close(E.sum(computed, 'billing'), 5295609348.557259, 0.05);
  close(E.sum(computed, 'amountPaid'), 5124464393.379816, 0.05);
  close(E.sum(computed, 'balance'), 171144955.1774418, 0.05);
});

test('Statement sheet per-client cached values match', () => {
  const s = E.clientSummary(computed, clients);
  for (const row of validation.statement) {
    const [name, n, selling, vat, billing, paid, balance] = row;
    if (!n || name === 'GRAND TOTAL') continue;
    const r = s.rows.find((x) => E.norm(x.client) === E.norm(name));
    assert.ok(r, 'missing ' + name);
    assert.equal(r.trips, n, name + ' trips');
    close(r.sellingPrice, selling, 0.05); close(r.vat, vat, 0.05); close(r.billing, billing, 0.05); close(r.paid, paid, 0.05); close(r.balance, balance, 0.05);
  }
});

test('single trip formulas (row 2 of the workbook)', () => {
  const t = E.computeTrip({ client: 'X', plate: 'T-1678LA', sellingPrice: 116279.069767441, paymentStatus: 'Paid', advance: 0, dateDispatched: '2024-01-02' }, { settings, assets, rates: [] });
  assert.equal(t.vat, 8720.93); close(t.billing, 125000.0, 0.01); close(t.amountPaid, 125000.0, 0.01); assert.equal(t.balance, 0);
  assert.equal(t.assetCode, 'MVEH-000287'); assert.equal(t.vehicleType, 'Closed Body Logistics'); assert.equal(t.costCenter, 'CC047'); assert.equal(t.vehicleCategory, 'CANTER');
  assert.equal(t.tripStatus, 'Closed');
});

test('amount paid follows Payment Status (Paid / Advance / Not Paid)', () => {
  const base = { client: 'C', plate: 'T8117LA', sellingPrice: 1000000, dateDispatched: '2026-09-01' };
  assert.equal(E.computeTrip({ ...base, paymentStatus: 'Advance', advance: 250000 }, { settings }).amountPaid, 250000);
  assert.equal(E.computeTrip({ ...base, paymentStatus: 'Advance', advance: 250000 }, { settings }).balance, 825000);
  assert.equal(E.computeTrip({ ...base, paymentStatus: 'Not Paid', advance: 250000 }, { settings }).amountPaid, 0);
  assert.equal(E.computeTrip({ ...base, paymentStatus: 'Paid', advance: 250000 }, { settings }).amountPaid, 1075000);
});

test('trip status rules', () => {
  assert.equal(E.tripStatus({ invoiceStatus: 'Internal Client', paymentStatus: 'Paid' }), 'Internal Client');
  assert.equal(E.tripStatus({ invoiceStatus: 'Invoice Sent', paymentStatus: 'Paid' }), 'Closed');
  assert.equal(E.tripStatus({ invoiceStatus: 'Invoice Sent', paymentStatus: 'Advance', advance: 10 }), 'Part Paid - Balance Due');
  assert.equal(E.tripStatus({ invoiceStatus: 'Invoice Sent', paymentStatus: 'Not Paid' }), 'Awaiting Payment');
  assert.equal(E.tripStatus({ invoiceStatus: 'Invoice Not Sent', paymentStatus: 'Not Paid' }), 'Invoice Not Sent');
});

test('agreed rate lookup: date window, contract-type priority, multiple-match detection, blank when none', () => {
  const rates = [
    { id: 'r1', client: 'Jamara', loadingFrom: 'GBAGADA', loadingTo: 'Ibadan', vehicleType: 'HAULAGE', price: 650000, effectiveDate: '2026-01-01', expiryDate: '2026-06-30' },
    { id: 'r2', client: 'Jamara', loadingFrom: 'Gbagada', loadingTo: 'IBADAN', vehicleType: 'HAULAGE', price: 700000, effectiveDate: '2026-07-01' },
    { id: 'r3', client: 'Jamara', loadingFrom: 'Gbagada', loadingTo: 'IBADAN', vehicleType: 'HAULAGE', contractType: 'JAMARA', price: 720000, effectiveDate: '2026-07-01' },
    { id: 'r4', client: 'Jamara', loadingFrom: 'Gbagada', loadingTo: 'IBADAN', vehicleType: 'HAULAGE', price: 710000, effectiveDate: '2026-07-01' },
  ];
  const trip = { client: 'Jamara ', loadingFrom: 'GBAGADA', loadingTo: 'IBADAN', vehicleType: 'HAULAGE', dateDispatched: '2026-03-15' };
  assert.equal(E.lookupAgreedRate(trip, rates).rate.id, 'r1');
  const t2 = { ...trip, dateDispatched: '2026-09-11', contractType: 'JAMARA' };
  assert.equal(E.lookupAgreedRate(t2, rates).rate.id, 'r3');            // contract match beats wildcard
  const t3 = { ...trip, dateDispatched: '2026-09-11', contractType: '' };
  assert.equal(E.lookupAgreedRate(t3, rates).status, 'multiple');       // r2 vs r4 tie with different prices
  assert.equal(E.lookupAgreedRate({ ...t3, agreedRateId: 'r4' }, rates).rate.id, 'r4');
  assert.equal(E.lookupAgreedRate({ ...trip, loadingTo: 'KANO' }, rates).status, 'none');
  const c = E.computeTrip({ ...t2, plate: 'T33405LA', sellingPrice: 680000 }, { settings, assets, rates });
  assert.equal(c.agreedPrice, 720000); assert.equal(c.variance, -40000); close(c.variancePct, -5.56, 0.01); assert.equal(c.direction, 'below');
  assert.equal(c.sellingPrice, 680000, 'selling price is never overwritten by the agreed rate');
  const none = E.computeTrip({ ...trip, loadingTo: 'KANO', plate: 'T33405LA', sellingPrice: 500 }, { settings, assets, rates });
  assert.equal(none.agreedPrice, null); assert.equal(none.direction, 'na');
});

test('variance sign and equality', () => {
  assert.deepEqual(E.variance(2600000, 2500000), { variance: 100000, variancePct: 4, direction: 'above' });
  assert.deepEqual(E.variance(4200000, 4450000), { variance: -250000, variancePct: -5.62, direction: 'below' });
  assert.deepEqual(E.variance(1800000, 1800000), { variance: 0, variancePct: 0, direction: 'equal' });
});

test('invoice numbering uses client code and trip date, avoids duplicates', () => {
  const n1 = E.generateInvoiceNumber('MAMUDA BEVERAGES CO. LTD', '2026-09-30', [], clients);
  assert.equal(n1, 'MAM-260930-01');
  assert.equal(E.generateInvoiceNumber('MAMUDA BEVERAGES CO. LTD', '2026-09-30', [n1], clients), 'MAM-260930-02');
  assert.equal(E.clientCode('Some New Customer Ltd', []), 'SNC');
  const dup = E.findDuplicateInvoiceNumber('mam-260930-01', [{ id: 'a', number: 'MAM-260930-01' }], 'b');
  assert.equal(dup.id, 'a');
});

test('invoice eligibility mirrors the Invoice Generator (client, month range, not Paid, not yet invoiced)', () => {
  const el = E.eligibleTrips(computed, 'Jamara', '2026-09', '2026-10');
  assert.ok(el.length > 0);
  assert.ok(el.every((t) => t.paymentStatus !== 'Paid' && t.dateDispatched >= '2026-09-01' && t.dateDispatched <= '2026-10-31'));
  const tot = E.invoiceTotals(el, 0.075);
  close(tot.total, E.sum(el, 'billing'), 0.05);
});

test('permissions matrix', () => {
  assert.ok(E.canEditField('billing', 'sellingPrice')); assert.ok(!E.canEditField('operations', 'sellingPrice'));
  assert.ok(E.canEditField('finance', 'paymentStatus')); assert.ok(!E.canEditField('billing', 'paymentStatus'));
  assert.ok(!E.canEditField('management', 'client')); assert.ok(E.can('management', 'variance.review'));
  assert.ok(E.can('admin', 'user.manage')); assert.ok(!E.can('finance', 'user.manage'));
});

test('import mapping and duplicate key', () => {
  const headers = ['Date Dispatched', 'Date Delivered', 'Plate Number', 'CLIENT NAME', 'Loading From', 'Loading To', 'Invoice Status ', 'Selling Price (₦)', 'Payment Status', 'Advance (₦)'];
  const map = E.mapHeaders(headers);
  const t = E.rowToTrip(['2026-09-11', 45911, 'T33405LA', 'Jamara ', 'GBAGADA', 'IBADAN', 'Invoice Sent Awaiting Payment', '680,000', 'advance', 100000], map);
  assert.equal(t.dateDelivered, '2025-09-11'); assert.equal(t.client, 'Jamara'); assert.equal(t.sellingPrice, 680000); assert.equal(t.invoiceStatus, 'Invoice Sent'); assert.equal(t.paymentStatus, 'Advance');
  assert.equal(E.dupKey(t), E.dupKey({ ...t, note: 'x' }));
  assert.equal(E.normalizeInvoiceStatus('Closed', 'Paid'), 'Invoice Sent');
  assert.equal(E.normalizeInvoiceStatus('', 'Not Paid'), 'Invoice Not Sent');
});
