// Trip Log: client agreed rate vs manual selling price
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/pricing.js');
const Seed = require('../js/seed.js');

const cards = [
  { id: 'RC1', clientId: 'K1', name: 'Card 2026', validFrom: '2026-01-01', validTo: '2026-12-31', status: 'ACTIVE', lines: [{ id: 'L1', routeId: 'R1', vehicleClass: 'ANY', unit: 'TONNE', moq: 30, ratePerUnit: 200 }, { id: 'L2', routeId: 'R1', vehicleClass: 'Rigid 10T', unit: 'TRIP', moq: 0, ratePerUnit: 2500 }] },
  { id: 'RC0', clientId: 'K1', name: 'Card 2025', validFrom: '2025-01-01', validTo: '2025-12-31', status: 'ACTIVE', lines: [{ id: 'L3', routeId: 'R2', vehicleClass: 'ANY', unit: 'TONNE', moq: 30, ratePerUnit: 150 }] },
];

test('client agreed price = rate × billable qty with MOQ; variance = selling − agreed', () => {
  const c = P.compareSellingPrice({ clientId: 'K1', routeId: 'R1', vehicleClass: 'Articulated 30T', date: '2026-05-01', qty: 27, sellingPrice: 5800 }, cards);
  assert.equal(c.status, 'OK'); assert.equal(c.agreedPrice, 6000); assert.equal(c.variance, -200); assert.deepEqual(c.flags, ['BELOW_AGREED']); assert.equal(c.needsApproval, true);
  const ok = P.compareSellingPrice({ clientId: 'K1', routeId: 'R1', vehicleClass: 'Articulated 30T', date: '2026-05-01', qty: 32, sellingPrice: 6500 }, cards);
  assert.equal(ok.agreedPrice, 6400); assert.equal(ok.variance, 100); assert.deepEqual(ok.flags, []); assert.equal(ok.needsApproval, false);
});
test('equipment-specific line and flat trip rates', () => {
  const c = P.compareSellingPrice({ clientId: 'K1', routeId: 'R1', vehicleClass: 'Rigid 10T', date: '2026-05-01', qty: 9, sellingPrice: 2500 }, cards);
  assert.equal(c.unit, 'TRIP'); assert.equal(c.agreedPrice, 2500); assert.equal(c.variance, 0);
});
test('expired and missing rates are flagged, never silently used; selling price is kept', () => {
  const ex = P.compareSellingPrice({ clientId: 'K1', routeId: 'R2', vehicleClass: 'Articulated 30T', date: '2026-05-01', qty: 30, sellingPrice: 4000 }, cards);
  assert.equal(ex.status, 'EXPIRED'); assert.ok(ex.flags.includes('EXPIRED_RATE')); assert.equal(ex.sellingPrice, 4000); assert.equal(ex.agreedPrice, 4500);
  const mi = P.compareSellingPrice({ clientId: 'K1', routeId: 'R9', vehicleClass: 'ANY', date: '2026-05-01', qty: 30, sellingPrice: 4000 }, cards);
  assert.equal(mi.status, 'MISSING'); assert.deepEqual(mi.flags, ['MISSING_RATE']); assert.equal(mi.agreedPrice, null);
  const nc = P.compareSellingPrice({ routeId: 'R1', vehicleClass: 'ANY', date: '2026-05-01', qty: 30 }, cards);
  assert.ok(nc.flags.includes('NO_CLIENT') && nc.flags.includes('NO_SELLING_PRICE'));
});
test('exception report lists pending and decided items', () => {
  const trips = [
    { id: 'a', clientId: 'K1', routeId: 'R1', vehicleClass: 'ANY', date: '2026-05-01', qty: 30, sellingPrice: 5000 },
    { id: 'b', clientId: 'K1', routeId: 'R1', vehicleClass: 'ANY', date: '2026-05-01', qty: 30, sellingPrice: 7000 },
    { id: 'c', clientId: 'K1', routeId: 'R1', vehicleClass: 'ANY', date: '2026-05-01', qty: 30, sellingPrice: 5500, pricingApproval: { decision: 'APPROVED', by: 'mgmt', at: 'x' } },
  ];
  const ex = P.pricingExceptions(trips, cards);
  assert.deepEqual(ex.map((e) => [e.trip.id, e.state]), [['a', 'PENDING'], ['c', 'APPROVED']]);
});
test('seed dataset carries clients, rate cards and manual selling prices', () => {
  const db = Seed.build();
  assert.equal(db.clients.length, 3); assert.ok(db.clientRateCards.length >= 4);
  assert.ok(db.trips.every((t) => t.clientId && t.sellingPrice != null && t.sellingPriceBy));
  const ex = P.pricingExceptions(db.trips, db.clientRateCards);
  assert.ok(ex.length > 5 && ex.length < 40);
});
