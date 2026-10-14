// Spare parts sourcing engine tests.  Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../spare-parts/js/spares.js');

const rates = { USD: 1, RMB: 0.14, NGN: 0.00065 };
const sup = (id, name, rating, currency = 'USD') => ({ id, name, rating, currency, contact: 'Li', paymentTerms: '30% deposit, 70% before shipment' });
const req = (over = {}) => ({ id: 'DARCO-SP-00001', date: '2026-10-01', requestedBy: 'J. Okafor', department: 'Workshop A', truckReg: 'LAG-123-XY', truckMake: 'SINOTRUK', truckModel: 'HOWO 371', chassis: 'LZZ5EXSB9MA123456', category: 'Brake System', description: 'Brake drum rear', partNo: 'WG9231342006', qty: 2, unit: 'PCS', urgency: 'URGENT', photos: ['p1', 'p2', 'p3'], status: 'NEW', ...over });

test('request numbers are sequential and zero padded', () => {
  assert.equal(S.nextNumber([], 'DARCO-SP-'), 'DARCO-SP-00001');
  assert.equal(S.nextNumber([{ id: 'DARCO-SP-00007' }, { id: 'DARCO-SP-00003' }, { id: 'OTHER-1' }], 'DARCO-SP-'), 'DARCO-SP-00008');
  assert.equal(S.nextNumber([{ number: 'DARCO-PO-00012' }], 'DARCO-PO-', 'number'), 'DARCO-PO-00013');
});

test('validation lists every missing required field and the three mandatory photos', () => {
  assert.deepEqual(S.validateRequest(req()), []);
  const errs = S.validateRequest(req({ description: '', qty: 0, photos: ['p1'] }));
  assert.ok(errs.some((e) => /description is required/i.test(e)));
  assert.ok(errs.some((e) => /quantity must be greater/i.test(e)));
  assert.ok(errs.some((e) => /Photo 2/.test(e)) && errs.some((e) => /Photo 3/.test(e)));
  assert.ok(!errs.some((e) => /Photo 1/.test(e)));
  assert.deepEqual(S.validateRequest(req({ photos: [] }), { photosRequired: false }), []);
});

test('part numbers match regardless of spaces, dashes and case', () => {
  assert.equal(S.normalizePartNo(' wg-9231 342.006 '), 'WG9231342006');
  assert.equal(S.normalizeReg('lag 123 xy'), 'LAG123XY');
});

test('duplicate detection blocks the same part on the same truck while open, flags part-number matches elsewhere', () => {
  const existing = [req({ id: 'DARCO-SP-00001' }), req({ id: 'DARCO-SP-00002', truckReg: 'ABJ-999-AA', status: 'RECEIVED' })];
  const same = S.findDuplicates(req({ id: '', partNo: 'wg-9231-342-006' }), existing);
  assert.equal(same.blocked, true);
  assert.deepEqual(same.exact.map((x) => x.id), ['DARCO-SP-00001']);
  assert.deepEqual(same.matchingPartNo.map((x) => x.id).sort(), ['DARCO-SP-00001', 'DARCO-SP-00002']);
  const otherTruck = S.findDuplicates(req({ id: '', truckReg: 'KJA-1-AB' }), existing);
  assert.equal(otherTruck.blocked, false);
  assert.equal(otherTruck.matchingPartNo.length, 2);
  const closed = S.findDuplicates(req({ id: '', truckReg: 'ABJ-999-AA' }), existing);
  assert.equal(closed.blocked, false, 'a received request does not block a re-order');
  const noPn = S.findDuplicates(req({ id: '', partNo: '' }), [req({ partNo: '' })]);
  assert.equal(noPn.similar.length, 1); assert.equal(noPn.blocked, false);
  assert.equal(S.findDuplicates(req(), existing, { excludeId: 'DARCO-SP-00001' }).blocked, false, 'editing a request ignores itself');
});

test('request status follows RFQs and purchase orders unless set manually', () => {
  const r = req();
  assert.equal(S.deriveStatus(r), 'NEW');
  const rfqs = [{ id: 'Q1', requestId: r.id, supplierId: 'S1', status: 'SENT' }];
  assert.equal(S.deriveStatus(r, { rfqs }), 'RFQ_SENT');
  rfqs[0].status = 'QUOTED';
  assert.equal(S.deriveStatus(r, { rfqs }), 'QUOTED');
  const po = { status: 'SENT', lines: [{ requestId: r.id }] };
  assert.equal(S.deriveStatus(r, { rfqs, purchaseOrders: [po] }), 'ORDERED');
  po.status = 'SHIPPED'; assert.equal(S.deriveStatus(r, { rfqs, purchaseOrders: [po] }), 'SHIPPED');
  po.status = 'RECEIVED'; assert.equal(S.deriveStatus(r, { rfqs, purchaseOrders: [po] }), 'RECEIVED');
  po.status = 'CANCELLED'; assert.equal(S.deriveStatus(r, { rfqs, purchaseOrders: [po] }), 'QUOTED');
  assert.equal(S.deriveStatus(req({ status: 'ON_HOLD' }), { rfqs, purchaseOrders: [po] }), 'ON_HOLD');
});

test('currency conversion goes through the base currency', () => {
  assert.equal(S.round2(S.convert(100, 'RMB', 'USD', rates)), 14);
  assert.equal(S.round2(S.convert(14, 'USD', 'RMB', rates)), 100);
  assert.equal(S.round2(S.convert(10, 'USD', 'NGN', rates)), 15384.62);
  assert.equal(S.convert(5, 'USD', 'USD', {}), 5);
  assert.ok(Number.isNaN(S.convert(5, 'XXX', 'USD', rates)));
});

test('quotation totals apply the supplier MOQ and shipping', () => {
  const t = S.quoteTotal({ unitPrice: 120, moq: 4, shippingCost: 35 }, 2);
  assert.deepEqual(t, { qty: 4, moqApplied: true, goods: 480, shipping: 35, total: 515 });
  assert.equal(S.quoteTotal({ unitPrice: 120 }, 2).total, 240);
});

test('quotation comparison ranks in base currency and flags lowest, fastest and best', () => {
  const r = req();
  const suppliers = [sup('S1', 'Jinan Parts', 5), sup('S2', 'Shandong Truck', 3, 'RMB'), sup('S3', 'Silent Co', 4)];
  const rfqs = [
    { id: 'Q1', requestId: r.id, supplierId: 'S1', status: 'QUOTED', quote: { unitPrice: 150, currency: 'USD', leadTimeDays: 20, shippingCost: 0 } },
    { id: 'Q2', requestId: r.id, supplierId: 'S2', status: 'QUOTED', quote: { unitPrice: 900, currency: 'RMB', leadTimeDays: 7, shippingCost: 100 } }, // 2×900+100 = 1900 RMB = 266 USD
    { id: 'Q3', requestId: r.id, supplierId: 'S3', status: 'SENT' },
    { id: 'Q4', requestId: 'OTHER', supplierId: 'S1', status: 'QUOTED', quote: { unitPrice: 1 } },
  ];
  const c = S.compareQuotes(r, rfqs, suppliers, { rates });
  assert.equal(c.rows.length, 2);
  const s1 = c.rows.find((x) => x.supplierId === 'S1'), s2 = c.rows.find((x) => x.supplierId === 'S2');
  assert.equal(s1.totalBase, 300); assert.equal(s2.totalBase, 266);
  assert.equal(s2.unitPriceBase, 126);
  assert.equal(c.lowest.supplierId, 'S2'); assert.equal(c.fastest.supplierId, 'S2'); assert.equal(c.best.supplierId, 'S2');
  assert.equal(s1.vsLowestPct, 12.78);
  assert.equal(c.spread, 34);
  assert.equal(c.rows[0].best, true); assert.equal(c.rows[1].best, false);
  assert.equal(S.compareQuotes(r, [], suppliers).rows.length, 0);
});

test('purchase order is built from selected quotes and totals correctly', () => {
  const r1 = req(), r2 = req({ id: 'DARCO-SP-00002', description: 'Brake lining kit', partNo: 'WG9100440027', qty: 6 });
  const supplier = sup('S1', 'Jinan Parts', 5);
  const q1 = { id: 'Q1', requestId: r1.id, supplierId: 'S1', status: 'QUOTED', quote: { unitPrice: 150, currency: 'USD', leadTimeDays: 20, brand: 'SINOTRUK OEM' } };
  const q2 = { id: 'Q2', requestId: r2.id, supplierId: 'S1', status: 'QUOTED', quote: { unitPrice: 22.5, moq: 10, leadTimeDays: 15 } };
  const po = S.buildPo({ number: 'DARCO-PO-00001', supplier, request_lines: [S.poLineFromQuote(r1, q1, supplier), S.poLineFromQuote(r2, q2, supplier)], date: '2026-10-05', shippingCost: 80, otherCost: 0, discount: 5 });
  assert.equal(po.id, 'PO-DARCO-PO-00001');
  assert.equal(po.lines[1].qty, 10, 'MOQ lifts the ordered quantity');
  assert.equal(po.subtotal, 300 + 225);
  assert.equal(po.total, 525 + 80 - 5);
  assert.equal(po.status, 'DRAFT');
  assert.equal(S.poLeadTimeDays(po), 20);
  assert.equal(po.paymentTerms, supplier.paymentTerms);
  po.lines[0].qty = 3; S.totalPo(po);
  assert.equal(po.subtotal, 450 + 225);
});

test('supplier statistics: orders, on-time deliveries, lead time, spend and response rate', () => {
  const pos = [
    { supplierId: 'S1', status: 'RECEIVED', date: '2026-08-01', total: 1000, currency: 'USD', shipment: { eta: '2026-09-01', receivedAt: '2026-08-28' } },
    { supplierId: 'S1', status: 'RECEIVED', date: '2026-08-10', total: 7000, currency: 'RMB', shipment: { eta: '2026-09-01', receivedAt: '2026-09-09' } },
    { supplierId: 'S1', status: 'SENT', date: '2026-10-01', total: 200, currency: 'USD', shipment: {} },
    { supplierId: 'S1', status: 'CANCELLED', date: '2026-10-02', total: 999, currency: 'USD', shipment: {} },
    { supplierId: 'S2', status: 'RECEIVED', date: '2026-08-01', total: 50, currency: 'USD', shipment: { receivedAt: '2026-08-20' } },
  ];
  const rfqs = [{ supplierId: 'S1', status: 'QUOTED', selected: true }, { supplierId: 'S1', status: 'NO_RESPONSE' }, { supplierId: 'S2', status: 'QUOTED' }];
  const st = S.supplierStats('S1', pos, rfqs, { rates });
  assert.equal(st.orders, 3); assert.equal(st.open, 1); assert.equal(st.received, 2); assert.equal(st.onTime, 1); assert.equal(st.onTimePct, 50);
  assert.equal(st.avgLeadDays, Math.round((27 + 30) / 2));
  assert.equal(st.spendBase, 1000 + 980 + 200);
  assert.equal(st.responseRatePct, 50); assert.equal(st.won, 1); assert.equal(st.lastOrder, '2026-10-01');
});

test('procurement history and price statistics per part number', () => {
  const pos = [
    { id: 'A', number: 'DARCO-PO-00001', date: '2026-06-01', supplierId: 'S1', supplierName: 'Jinan', currency: 'USD', status: 'RECEIVED', shipment: { receivedAt: '2026-07-01' }, lines: [{ partNo: 'WG-9231342006', description: 'Brake drum', truckReg: 'LAG-123-XY', qty: 2, unitPrice: 140, amount: 280, requestId: 'R1' }] },
    { id: 'B', number: 'DARCO-PO-00002', date: '2026-09-01', supplierId: 'S2', supplierName: 'Shandong', currency: 'RMB', status: 'SHIPPED', shipment: {}, lines: [{ partNo: 'WG9231342006', description: 'Brake drum', truckReg: 'ABJ-1-AA', qty: 4, unitPrice: 1100, amount: 4400, requestId: 'R2' }, { partNo: 'X1', description: 'Filter', truckReg: 'ABJ-1-AA', qty: 1, unitPrice: 5, amount: 5, requestId: 'R3' }] },
  ];
  const h = S.historyLines(pos, { partNo: 'wg9231342006' });
  assert.equal(h.length, 2); assert.equal(h[0].poNumber, 'DARCO-PO-00002', 'newest first');
  assert.equal(S.historyLines(pos, { truckReg: 'abj 1 aa' }).length, 2);
  assert.equal(S.historyLines(pos, { supplierId: 'S1' }).length, 1);
  const ps = S.priceStats('WG9231342006', pos, { rates });
  assert.equal(ps.count, 2); assert.equal(ps.last, 154); assert.equal(ps.min, 140); assert.equal(ps.max, 154); assert.equal(ps.avg, 147); assert.equal(ps.lastSupplier, 'Shandong');
  assert.equal(S.priceStats('NOPE', pos).count, 0);
});

test('CSV parser handles quotes, embedded commas and newlines', () => {
  const rows = S.parseCsv('a,b,c\r\n1,"x, y","multi\nline"\n"q""uote",,\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', 'multi\nline'], ['q"uote', '', '']]);
});

test('Excel dates in serial, ISO and dd/mm/yyyy forms are normalised', () => {
  assert.equal(S.excelDate(46000), '2025-12-09');
  assert.equal(S.excelDate('2026-3-7'), '2026-03-07');
  assert.equal(S.excelDate('07/03/2026'), '2026-03-07');
  assert.equal(S.excelDate(''), '');
});

test('bulk import maps flexible headers, assigns ids, skips existing ids and reports bad rows', () => {
  const rows = [
    ['Request No', 'Date', 'Requested By', 'Dept', 'Reg No', 'Make', 'Model', 'VIN', 'Category', 'Part Name', 'Part No', 'Qty', 'UOM', 'Priority', 'Remarks', 'Status'],
    ['', '12/09/2026', 'Ade', 'Workshop A', 'lag-123-xy', 'Sinotruk', 'HOWO 371', 'LZZ1', 'Brake System', 'Brake drum rear', 'wg9231342006', '2', 'pcs', 'urgent', 'rear axle', 'quoted'],
    ['DARCO-SP-00001', '2026-09-01', 'Ade', 'Workshop A', 'LAG-123-XY', 'SINOTRUK', 'HOWO 371', '', 'Engine', 'Oil filter', 'VG61000070005', '10', 'PCS', '', '', ''],
    ['', '2026-09-02', '', 'Workshop A', 'LAG-123-XY', 'SINOTRUK', 'HOWO 371', '', 'Engine', '', 'XX', '1', 'PCS', 'NORMAL', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const existing = [req({ id: 'DARCO-SP-00001' }), req({ id: 'DARCO-SP-00009', status: 'RECEIVED' })];
  const res = S.importRequests(rows, { existing, today: '2026-10-14' });
  assert.equal(res.headerMap.partNo, 10);
  assert.equal(res.requests.length, 1);
  const r = res.requests[0];
  assert.equal(r.id, 'DARCO-SP-00010', 'next number after the highest existing id');
  assert.equal(r.date, '2026-09-12'); assert.equal(r.truckReg, 'LAG-123-XY'); assert.equal(r.truckMake, 'SINOTRUK'); assert.equal(r.partNo, 'WG9231342006');
  assert.equal(r.unit, 'PCS'); assert.equal(r.urgency, 'URGENT'); assert.equal(r.status, 'QUOTED'); assert.equal(r.imported, true);
  assert.deepEqual(r.duplicateOf, ['DARCO-SP-00001'], 'same part on the same truck is flagged');
  assert.equal(res.skipped.length, 1); assert.equal(res.skipped[0].id, 'DARCO-SP-00001');
  assert.equal(res.errors.length, 1); assert.equal(res.errors[0].row, 4);
  const strict = S.importRequests(rows, { existing, today: '2026-10-14', allowDuplicates: false });
  assert.equal(strict.requests.length, 0); assert.equal(strict.skipped.length, 2);
  assert.ok(S.importRequests([['Nothing', 'useful'], ['a', 'b']]).errors[0].message.includes('Spare Part Description'));
  assert.equal(S.requestRows(res.requests)[1][0], 'DARCO-SP-00010');
});

test('WhatsApp message and link are built from the request', () => {
  const msg = S.rfqMessage(req(), { company: 'DARCO JMG', country: 'Nigeria', destination: 'Lagos, Nigeria', procurementContact: 'Procurement', procurementPhone: '+234 800 000 0000' }, { contact: 'Mr Li' });
  assert.ok(msg.startsWith('Hello Mr Li,'));
  assert.ok(msg.includes('Ref: DARCO-SP-00001') && msg.includes('OEM / Part No: WG9231342006') && msg.includes('Quantity: 2 PCS') && msg.includes('Destination: Lagos, Nigeria.'));
  const url = S.whatsappUrl('+86 138-0000-0000', 'Hi & bye');
  assert.equal(url, 'https://wa.me/8613800000000?text=Hi%20%26%20bye');
});
