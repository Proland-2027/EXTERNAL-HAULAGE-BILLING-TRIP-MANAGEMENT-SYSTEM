// RFQ sheet and purchase-order PDF layouts.  Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../spare-parts/js/documents.js');
const Seed = require('../spare-parts/js/seed.js');

const fakeJpeg = (w, h) => new Uint8Array([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0xFF, 0xD9]);
const text = (b) => Array.from(b, (x) => String.fromCharCode(x)).join('');

test('request PDF is a single A4 page with the request fields and three photo slots', () => {
  const db = Seed.build();
  const r = db.requests[0];
  const pdf = D.requestPdf(r, db.settings, [fakeJpeg(800, 600), fakeJpeg(600, 800), null]);
  const s = text(pdf);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.includes('/Count 1'), 'one page');
  assert.ok(s.includes('/MediaBox [0 0 595.276 841.89]'), 'A4 portrait');
  assert.ok(s.includes('(Request No: DARCO-SP-00001)'));
  assert.ok(s.includes('(SPARE PARTS REQUEST  |  ONE ITEM)'));
  assert.ok(s.includes('(Rear brake drum)') && s.includes('(WG9231342006)') && s.includes('(2 PCS)'));
  assert.ok(s.includes('(PHOTO 1 - MAIN PART)') && s.includes('(NO PHOTO)'), 'missing third photo is shown as an empty slot');
  assert.equal((s.match(/\/Subtype \/Image/g) || []).length, 2);
  assert.ok(s.includes('Destination: Lagos, Nigeria'));
  assert.ok(s.includes('(SUPPLIER QUOTATION \\(TO BE COMPLETED\\))'));
});

test('request PDF copes with an imported request that has no photos and no optional fields', () => {
  const pdf = D.requestPdf({ id: 'DARCO-SP-00099', date: '2026-10-14', description: 'Mirror arm', qty: 1, unit: 'PCS', urgency: 'NORMAL' }, {}, []);
  const s = text(pdf);
  assert.equal((s.match(/\(NO PHOTO\)/g) || []).length, 3);
  assert.ok(s.includes('(DARCO JMG)'));
});

test('purchase order PDF lists every line, totals and supplier; long orders flow onto more pages', () => {
  const db = Seed.build();
  const po = db.purchaseOrders[0]; const sup = db.suppliers.find((x) => x.id === po.supplierId);
  const s = text(D.purchaseOrderPdf(po, sup, db.settings));
  assert.ok(s.includes('(PO No: DARCO-PO-00001)') && s.includes('(Jinan Huatong Truck Parts Co.)'));
  assert.ok(s.includes('(USD 652.00)') && s.includes('(USD 442.00)') && s.includes('(USD 210.00)'));
  assert.ok(s.includes('(WG9231342006)') && s.includes('(WG9100440027)'));
  assert.ok(s.includes('/Count 1'));
  const big = JSON.parse(JSON.stringify(po));
  big.lines = Array.from({ length: 45 }, (_, i) => ({ ...po.lines[0], id: `L${i}`, description: `Line ${i} with a fairly long description that wraps onto two lines in the table` }));
  const s2 = text(D.purchaseOrderPdf(big, sup, db.settings));
  assert.ok(/\/Count [2-9]/.test(s2), 'multiple pages');
});
