// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/pricing.js');
const Seed = require('../js/seed.js');

const route = { id: 'R1', origin: 'Tema', destination: 'Kumasi', distanceKm: 250 };
const contractorList = {
  id: 'PL-C', partyId: 'C1', currency: 'GHS', status: 'ACTIVE', validFrom: '2026-01-01', validTo: '2026-12-31',
  lines: [
    { id: 'L1', routeId: 'R1', vehicleClass: 'ANY', unit: 'TONNE', moq: 30, ratePerUnit: 170 },
    { id: 'L2', routeId: 'R1', vehicleClass: 'Rigid 10T', unit: 'TRIP', moq: 0, ratePerUnit: 2000 },
  ],
};
const internalList = {
  id: 'PL-I', partyId: P.INTERNAL, currency: 'GHS', status: 'ACTIVE', dieselPricePerLitre: 15,
  lines: [{ id: 'L1', routeId: 'R1', vehicleClass: 'Articulated 30T', unit: 'TONNE', moq: 30, fixedCost: 1500, variableCostPerKm: 3.2, fixedVariableCost: 450, dieselLitres: 125 }],
};

test('MOQ tops up a short load to the minimum quantity', () => {
  const q = P.applyMoq(26.5, 30);
  assert.equal(q.billableQty, 30);
  assert.equal(q.moqApplied, true);
  assert.equal(q.moqTopUp, 3.5);
  const full = P.applyMoq(31, 30);
  assert.equal(full.billableQty, 31);
  assert.equal(full.moqApplied, false);
});

test('contractor per-tonne pricing bills at MOQ when under, at actual when over', () => {
  const under = P.priceTrip({ id: 'T1', routeId: 'R1', vehicleClass: 'Articulated 30T', qty: 26.5 }, contractorList, route);
  assert.equal(under.amount, 30 * 170);
  assert.equal(under.moqTopUpValue, 3.5 * 170);
  const over = P.priceTrip({ id: 'T2', routeId: 'R1', vehicleClass: 'Articulated 30T', qty: 31 }, contractorList, route);
  assert.equal(over.amount, 31 * 170);
  assert.equal(over.moqTopUpValue, 0);
});

test('contractor flat per-trip line ignores quantity and MOQ', () => {
  const l = P.priceTrip({ id: 'T3', routeId: 'R1', vehicleClass: 'Rigid 10T', qty: 4 }, contractorList, route);
  assert.equal(l.unit, 'TRIP');
  assert.equal(l.amount, 2000);
  assert.equal(l.billableQty, 1);
});

test('exact vehicle-class line wins over the ANY line', () => {
  assert.equal(P.resolveLine(contractorList, 'R1', 'Rigid 10T').id, 'L2');
  assert.equal(P.resolveLine(contractorList, 'R1', 'Articulated 30T').id, 'L1');
  assert.equal(P.resolveLine(contractorList, 'R9', 'Articulated 30T'), null);
});

test('internal cost = fixed + variable×km + fixed-variable + diesel litres × price', () => {
  const l = P.priceTrip({ id: 'T4', routeId: 'R1', vehicleClass: 'Articulated 30T', qty: 28, dieselLitres: 130 }, internalList, route);
  assert.deepEqual(l.components, { fixed: 1500, variable: 800, fixedVariable: 450, diesel: 1950 });
  assert.equal(l.amount, 4700);
  assert.equal(l.billableQty, 30);           // MOQ applied for the per-tonne view
  assert.equal(l.costPerUnit, 156.67);
  assert.equal(l.dieselVarianceLitres, 5);   // 130 actual vs 125 standard
  const std = P.priceTrip({ id: 'T5', routeId: 'R1', vehicleClass: 'Articulated 30T', qty: 30 }, internalList, route);
  assert.equal(std.components.diesel, 125 * 15); // falls back to standard litres
});

test('trips with no tariff line are flagged, not silently zero-priced', () => {
  const l = P.priceTrip({ id: 'T6', routeId: 'R9', qty: 30 }, contractorList, route);
  assert.equal(l.amount, 0);
  assert.match(l.errors[0], /No tariff line/);
  const none = P.priceTrip({ id: 'T7', routeId: 'R1', qty: 30 }, null, route);
  assert.match(none.errors[0], /No price list/);
});

test('buildBilling totals, levies and VAT', () => {
  const trips = [
    { id: 'T1', date: '2026-09-02', routeId: 'R1', vehicleClass: 'Articulated 30T', qty: 26.5, partyId: 'C1' },
    { id: 'T2', date: '2026-09-03', routeId: 'R1', vehicleClass: 'Articulated 30T', qty: 31, partyId: 'C1' },
  ];
  const b = P.buildBilling({ partyId: 'C1', period: '2026-09', priceList: contractorList, trips, routes: [route], settings: { vatRate: 15, levyRate: 6 }, number: 'BILL-1' });
  assert.equal(b.summary.subtotal, 30 * 170 + 31 * 170);          // 10370
  assert.equal(b.summary.levyAmount, 622.2);
  assert.equal(b.summary.vatAmount, P.round2((10370 + 622.2) * 0.15));
  assert.equal(b.summary.total, P.round2(10370 + 622.2 + (10370 + 622.2) * 0.15));
  assert.equal(b.summary.moqTrips, 1);
  assert.equal(b.summary.moqTopUp, 3.5);
  assert.equal(b.summary.billableQty, 61);
  assert.equal(b.summary.actualQty, 57.5);
});

test('internal billing is a cost recharge: no tax when taxInternal is false', () => {
  const trips = [{ id: 'T1', date: '2026-09-02', routeId: 'R1', vehicleClass: 'Articulated 30T', qty: 30, dieselLitres: 125, partyId: P.INTERNAL }];
  const b = P.buildBilling({ partyId: P.INTERNAL, period: '2026-09', priceList: internalList, trips, routes: [route], settings: { vatRate: 15, levyRate: 6, taxInternal: false } });
  assert.equal(b.summary.subtotal, 1500 + 800 + 450 + 1875);
  assert.equal(b.summary.vatAmount, 0);
  assert.equal(b.summary.total, b.summary.subtotal);
  assert.deepEqual(b.summary.components, { fixed: 1500, variable: 800, fixedVariable: 450, diesel: 1875 });
});

test('selectTrips picks completed trips of the period not yet billed elsewhere', () => {
  const trips = [
    { id: 'a', partyId: 'C1', date: '2026-09-01', status: 'COMPLETED' },
    { id: 'b', partyId: 'C1', date: '2026-09-02', status: 'CANCELLED' },
    { id: 'c', partyId: 'C1', date: '2026-08-31', status: 'COMPLETED' },
    { id: 'd', partyId: 'C1', date: '2026-09-05', status: 'COMPLETED', billingId: 'B-OTHER' },
    { id: 'e', partyId: 'C1', date: '2026-09-06', status: 'COMPLETED', billingId: 'B-ME' },
  ];
  assert.deepEqual(P.selectTrips(trips, 'C1', '2026-09').map((t) => t.id), ['a']);
  assert.deepEqual(P.selectTrips(trips, 'C1', '2026-09', { billingId: 'B-ME' }).map((t) => t.id), ['a', 'e']);
});

test('billing numbers increment per party and period', () => {
  const existing = [{ number: 'BILL-2026-09-INT-001' }, { number: 'BILL-2026-09-INT-003' }, { number: 'BILL-2026-08-INT-009' }];
  assert.equal(P.nextBillingNumber(existing, 'INT', '2026-09'), 'BILL-2026-09-INT-004');
  assert.equal(P.nextBillingNumber(existing, 'KHL', '2026-09'), 'BILL-2026-09-KHL-001');
});

test('pickPriceList prefers the active list covering the period', () => {
  const lists = [
    { id: 'old', partyId: 'C1', status: 'ACTIVE', validFrom: '2025-01-01', validTo: '2025-12-31' },
    { id: 'new', partyId: 'C1', status: 'ACTIVE', validFrom: '2026-01-01', validTo: '2026-12-31' },
    { id: 'draft', partyId: 'C1', status: 'DRAFT', validFrom: '2027-01-01' },
  ];
  assert.equal(P.pickPriceList(lists, 'C1', '2026-09').id, 'new');
  assert.equal(P.pickPriceList(lists, 'C1', '2025-03').id, 'old');
  assert.equal(P.pickPriceList(lists, 'C1', '2028-01').id, 'new'); // newest active fallback
  assert.equal(P.pickPriceList(lists, 'C2', '2026-09'), null);
  assert.equal(P.previousPeriod('2026-01'), '2025-12');
  assert.equal(P.periodLabel('2026-09'), 'Sep 2026');
});

test('seed dataset builds and prices every trip without errors', () => {
  const db = Seed.build();
  assert.ok(db.trips.length > 80);
  assert.equal(db.billings.length, 5);
  db.billings.forEach((b) => assert.equal(b.summary.tripsWithErrors, 0, `${b.number} has pricing errors`));
  const sep = db.billings.filter((b) => b.period === '2026-09');
  assert.deepEqual(sep.map((b) => b.partyId).sort(), ['C-KHL', 'INTERNAL']);
});

test('comparison report uses logged billings and benchmarks each side at the other tariff', () => {
  const db = Seed.build();
  const rep = P.buildComparison({ period: '2026-09', trips: db.trips, billings: db.billings, priceLists: db.priceLists, routes: db.routes, contractors: db.contractors });
  assert.equal(rep.sources.internal, 'LOGGED');
  assert.equal(rep.sources.contractor, 'ESTIMATED'); // Northern Star Sep not logged → estimated on the fly
  const kum = rep.rows.find((r) => r.routeId === 'R-TEM-KUM');
  assert.ok(kum.internal.trips >= 11);
  assert.ok(kum.contractor.trips >= 8);
  assert.equal(P.round2(kum.internalAtContractorRate - kum.internal.amount), kum.inhouseSaving);
  assert.equal(P.round2(rep.totals.internal.amount + rep.totals.contractor.amount), rep.totals.combinedAmount);
  const comps = rep.totals.internal.components;
  assert.equal(P.round2(comps.fixed + comps.variable + comps.fixedVariable + comps.diesel), rep.totals.internal.amount);

  // Single-contractor filter and month-over-month deltas.
  const khl = P.buildComparison({ period: '2026-09', trips: db.trips, billings: db.billings, priceLists: db.priceLists, routes: db.routes, contractors: db.contractors, contractorId: 'C-KHL' });
  assert.equal(khl.sources.contractor, 'LOGGED');
  const mom = P.buildMonthlyComparison({ period: '2026-09', trips: db.trips, billings: db.billings, priceLists: db.priceLists, routes: db.routes, contractors: db.contractors });
  assert.equal(mom.previous.period, '2026-08');
  assert.equal(mom.deltas.internalAmount.change, P.round2(mom.current.totals.internal.amount - mom.previous.totals.internal.amount));
});

// ------------------------------------------------------------------ client agreed price vs manual selling price
const rateCards = [
  { id: 'CR1', customerId: 'K1', name: 'Card 2026', status: 'ACTIVE', validFrom: '2026-01-01', validTo: '2026-12-31', lines: [
    { id: 'C1', routeId: 'R1', vehicleClass: 'ANY', unit: 'TONNE', moq: 30, ratePerUnit: 200 },
    { id: 'C2', routeId: 'R1', vehicleClass: 'Rigid 10T', unit: 'TRIP', moq: 0, ratePerUnit: 2500 },
  ] },
  { id: 'CR0', customerId: 'K2', name: 'Old card 2025', status: 'ACTIVE', validFrom: '2025-01-01', validTo: '2025-12-31', lines: [{ id: 'C3', routeId: 'R1', vehicleClass: 'ANY', unit: 'TONNE', moq: 30, ratePerUnit: 180 }] },
];

test('client agreed price is rate × max(qty, MOQ) and the manual selling price is compared, never replaced', () => {
  const below = P.compareSellingPrice({ customerId: 'K1', routeId: 'R1', vehicleClass: 'Articulated 30T', qty: 28, date: '2026-03-05', sellingPrice: 5500 }, rateCards);
  assert.equal(below.agreedPrice, 6000);             // 200 × MOQ 30
  assert.equal(below.sellingPrice, 5500);            // untouched
  assert.equal(below.variance, -500);
  assert.deepEqual(below.flags, ['BELOW_AGREED']);
  assert.equal(below.needsReview, true);
  const above = P.compareSellingPrice({ customerId: 'K1', routeId: 'R1', vehicleClass: 'Articulated 30T', qty: 31, date: '2026-03-05', sellingPrice: 6400 }, rateCards);
  assert.equal(above.agreedPrice, 6200);
  assert.equal(above.variance, 200);
  assert.deepEqual(above.flags, []);
});

test('equipment-class specific flat per-trip rate wins over the ANY line', () => {
  const r = P.compareSellingPrice({ customerId: 'K1', routeId: 'R1', vehicleClass: 'Rigid 10T', qty: 8, date: '2026-06-01', sellingPrice: 2500 }, rateCards);
  assert.equal(r.unit, 'TRIP');
  assert.equal(r.agreedPrice, 2500);
  assert.equal(r.variance, 0);
});

test('missing and expired client rates are flagged for review', () => {
  const missing = P.compareSellingPrice({ customerId: 'K1', routeId: 'R9', vehicleClass: 'ANY', qty: 30, date: '2026-03-05', sellingPrice: 100 }, rateCards);
  assert.equal(missing.agreedPrice, null);
  assert.deepEqual(missing.flags, ['RATE_MISSING']);
  const expired = P.compareSellingPrice({ customerId: 'K2', routeId: 'R1', vehicleClass: 'ANY', qty: 30, date: '2026-03-05', sellingPrice: 5400 }, rateCards);
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(expired.agreedPrice, 5400);           // last known rate still shown for reference
  assert.ok(expired.flags.includes('RATE_EXPIRED'));
  assert.equal(expired.needsReview, true);
  const noPrice = P.compareSellingPrice({ customerId: 'K1', routeId: 'R1', vehicleClass: 'ANY', qty: 30, date: '2026-03-05' }, rateCards);
  assert.ok(noPrice.flags.includes('NO_SELLING_PRICE'));
});

test('pricing exceptions list only the trips needing management review', () => {
  const trips = [
    { id: 'A', customerId: 'K1', routeId: 'R1', vehicleClass: 'ANY', qty: 30, date: '2026-03-05', sellingPrice: 6000 },
    { id: 'B', customerId: 'K1', routeId: 'R1', vehicleClass: 'ANY', qty: 30, date: '2026-03-06', sellingPrice: 5000, pricingException: { status: 'APPROVED', by: 'mgmt' } },
    { id: 'C', customerId: 'K2', routeId: 'R1', vehicleClass: 'ANY', qty: 30, date: '2026-03-07', sellingPrice: 5400 },
  ];
  const ex = P.pricingExceptions(trips, rateCards);
  assert.deepEqual(ex.map((x) => x.trip.id), ['C', 'B']);
  assert.equal(ex[1].exception.status, 'APPROVED');
});

test('seed dataset carries customers, rate cards and selling prices on every trip', () => {
  const db = Seed.build();
  assert.ok(db.customers.length >= 3 && db.clientRateCards.length >= 3);
  assert.ok(db.trips.every((t) => t.customerId && t.sellingPrice != null && t.sellingPriceBy));
  assert.ok(P.pricingExceptions(db.trips, db.clientRateCards).length > 0);
});
