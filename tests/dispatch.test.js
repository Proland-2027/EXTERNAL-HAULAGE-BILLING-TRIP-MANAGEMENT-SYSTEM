const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../js/core/engine.js');
const P = require('../js/core/planning.js');
const G = require('../js/core/geo.js');
const D = require('../js/core/dispatch.js');

const W = path.join(__dirname, '..', 'data', 'workbook');
const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8'));
const planning = read('planning.json'), distances = read('distances.json'), fleet = read('fleet.json'), assets = read('assets.json'), allocations = read('allocations.json'), requests = read('requests.json'), routes = read('routes.json'), rates = read('rates.json'), zones = read('zones.json'), clients = read('clients.json'), locationMaster = read('locationmaster.json');
const TODAY = '2026-10-12';
const ctx = { planning, distances, fleet, assets, allocations, requests, routes, rates, zones, clients, trips: [], dispatches: [], lostsales: [], locationMaster, today: TODAY, now: TODAY + 'T12:00:00Z' };

test('location standardisation follows the brief examples and preserves the original text', () => {
  for (const [from, to] of [['Apapa', 'Lagos'], ['Gbagada', 'Lagos'], ['GBD', 'Lagos'], ['Ikotun', 'Lagos'], ['Ikeja', 'Lagos'], ['Lekki', 'Lagos'], ['Kano City', 'Kano'], ['Fagge', 'Kano'], ['Ilesa', 'Osun'], ['Osogbo', 'Osun'], ['Ibadan', 'Oyo'], ['Port Harcourt', 'Rivers'], ['Onitsha', 'Anambra'], ['Benin City', 'Edo'], ['Abuja', 'FCT'], ['PHC', 'Rivers'], ['ABUJJA', 'FCT'], ['Kastina', 'Katsina'], ['VI-Lekki-AJAH', 'Lagos'], ['Ibadan depot', 'Oyo'], ['Ajaokuta', 'Kogi']]) assert.equal(G.standardize(from).state, to, from);
  const amb = G.standardize('Ejigbo'); assert.equal(amb.confidence, 'ambiguous'); assert.deepEqual(amb.candidates.sort(), ['Lagos', 'Osun']);
  assert.equal(G.standardize('IBADAN/ILORIN').confidence, 'ambiguous', 'a zone list spanning two states needs confirmation');
  assert.equal(G.standardize('NGB4').confidence, 'unknown');
  const approved = G.standardize('NGB4', { ngb4: { state: 'Kaduna', status: 'approved' } }); assert.equal(approved.state, 'Kaduna'); assert.equal(approved.confidence, 'approved');
  const corrected = G.standardize('Ejigbo', { ejigbo: { state: 'Osun', status: 'approved' } }); assert.equal(corrected.state, 'Osun', 'an approved mapping overrides the ambiguity');
  const m = G.suggestMaster(['Apapa', 'Ejigbo', 'Xyzabc'], {}); assert.equal(m.apapa.status, 'approved'); assert.equal(m.ejigbo.status, 'suggested'); assert.equal(m.xyzabc.confidence, 'unknown');
});

test('seeded Location Master covers the data: every exact match approved, the rest flagged for confirmation', () => {
  const vals = Object.values(locationMaster); assert.ok(vals.length > 400);
  assert.ok(vals.filter((v) => v.status === 'approved').length / vals.length > 0.9);
  assert.ok(vals.every((v) => v.status !== 'approved' || v.state));
});

test('vehicle category and consumption matrix', () => {
  const s = D.setupOf(planning);
  assert.equal(D.vehicleCategory({ vehicleType: 'HAULAGE' }, { bodyType: '102', tonnage: '45T' }), 'Haulage 45T');
  assert.equal(D.vehicleCategory({ vehicleType: 'HAULAGE' }, { bodyType: '102', tonnage: '30T' }), 'Jumbo 30T / 102 CBM');
  assert.equal(D.vehicleCategory({ vehicleType: 'Flat Trucks Logistics' }, { bodyType: 'FLAT', tonnage: '30T' }), 'Flatbed');
  assert.equal(D.vehicleCategory({ vehicleType: 'HAULAGE' }, { bodyType: 'FLAT-CONTAINER', tonnage: '' }), 'Flatbed');
  assert.equal(D.vehicleCategory({ vehicleType: 'Closed Body Logistics' }, { bodyType: 'Pallatized Body', tonnage: '' }), 'Other');
  assert.equal(D.consumptionRate('Haulage 45T', s), 0.5); assert.equal(D.consumptionRate('Jumbo 30T / 102 CBM', s), 0.45); assert.equal(D.consumptionRate('Flatbed', s), 0.42);
  assert.equal(D.consumptionRate('Haulage 45T', D.setupOf({ dispatch: { dieselRates: { 'Haulage 45T': 0.55 } } })), 0.55, 'administrator can change a rate');
});

test('brief example: Lagos to Kano and return, 2,200 km approved two-leg distance', () => {
  const c = Object.assign({}, ctx, { distances: [{ id: 'lk', originState: 'Lagos', destState: 'Kano', oneWayKm: 1100, returnKm: 1100, verified: true }] });
  const calc = (truck) => D.dispatchCalc({ plate: truck.plate, loadingFrom: 'Gbagada', loadingTo: 'Kano City' }, Object.assign({}, c, { fleet: [truck], assets: [{ plate: truck.plate, vehicleType: 'HAULAGE' }] }));
  const h = calc({ plate: 'A1', bodyType: '102', tonnage: '45T' }); assert.equal(h.category, 'Haulage 45T'); assert.equal(h.distance.totalKm, 2200); assert.equal(h.diesel, 1100); assert.equal(h.road, 55000); assert.equal(h.dieselOut, 550); assert.equal(h.dieselReturn, 550); assert.equal(h.distance.source, 'approved'); assert.ok(h.ready); assert.ok(h.financeRequired);
  const j = calc({ plate: 'A2', bodyType: '102', tonnage: '30T' }); assert.equal(j.diesel, 990); assert.equal(j.road, 55000);
  const f = calc({ plate: 'A3', bodyType: 'FLAT', tonnage: '30T' }); assert.equal(f.diesel, 924); assert.equal(f.road, 55000);
  // return along another approved route may differ
  const alt = D.resolveDistance({ originState: 'Lagos', destState: 'Kano' }, Object.assign({}, c, { distances: [{ id: 'lk2', originState: 'Lagos', destState: 'Kano', oneWayKm: 1100, returnKm: 1250, verified: true }] })); assert.equal(alt.totalKm, 2350);
});

test('distance resolution: approved master → unverified suggestion → route register → within state → missing', () => {
  const sug = D.resolveDistance({ originState: 'Lagos', destState: 'Kano' }, ctx); assert.equal(sug.source, 'suggested'); assert.equal(sug.verified, false); assert.equal(sug.oneWayKm, 990);
  const reg = D.resolveDistance({ originState: 'Oyo', destState: 'Kano', routeId: 'R001' }, Object.assign({}, ctx, { distances: [] })); assert.equal(reg.source, 'route register'); assert.equal(reg.oneWayKm, 952);
  const within = D.resolveDistance({ originState: 'Lagos', destState: 'Lagos' }, Object.assign({}, ctx, { distances: [] })); assert.equal(within.source, 'within state');
  const miss = D.resolveDistance({ originState: 'Oyo', destState: 'Kano' }, Object.assign({}, ctx, { distances: [] })); assert.equal(miss.source, 'missing'); assert.equal(miss.totalKm, null);
  const calc = D.dispatchCalc({ plate: 'T31702LA', loadingFrom: 'Ibadan', loadingTo: 'Kano' }, Object.assign({}, ctx, { distances: [] })); assert.ok(calc.issues.some((i) => /No approved route distance/.test(i))); assert.equal(calc.diesel, null); assert.ok(!calc.ready);
  const fromOtherStation = D.dispatchCalc({ plate: 'T31702LA', loadingFrom: 'Ibadan', loadingTo: 'Kano' }, ctx); assert.equal(fromOtherStation.originState, 'Oyo', 'a trip starting elsewhere does not default to Lagos');
});

test('dispatch status, approved totals, duplicate / over-issue prevention and supplementary requests', () => {
  const d = { number: 'DSP-261013-01', budgetDiesel: 990, budgetRoad: 49500, approvedDiesel: 990, approvedRoad: 49500, financeRequired: false, dieselIssues: [], expensePayments: [], supplementary: [] };
  assert.equal(D.dispatchStatus(d), 'Draft'); d.submittedAt = 'x'; assert.equal(D.dispatchStatus(d), 'Awaiting Approval');
  assert.ok(/not approved|is Awaiting/.test(D.issueError(d, 'diesel', 100)) || D.issueError(d, 'diesel', 100));
  d.opsApprovedAt = 'x'; assert.equal(D.dispatchStatus(d), 'Approved');
  assert.ok(/exceeds the approved/.test(D.issueError(d, 'diesel', 1000)));
  assert.equal(D.issueError(d, 'diesel', 990), '');
  d.dieselIssues.push({ id: 'i1', litres: 990, type: 'initial' }); assert.equal(D.dispatchStatus(d), 'Partly Dispatched');
  assert.ok(/already been issued/.test(D.issueError(d, 'diesel', 10)), 'a second initial issue is a duplicate');
  d.supplementary.push({ id: 's1', kind: 'diesel', qty: 50, status: 'Pending' }); assert.ok(/not approved/.test(D.issueError(d, 'diesel', 50, 's1')));
  d.supplementary[0].status = 'Approved'; assert.equal(D.approvedTotals(d).diesel, 1040); assert.equal(D.issueError(d, 'diesel', 50, 's1'), ''); assert.ok(/cannot exceed/.test(D.issueError(d, 'diesel', 60, 's1')));
  d.dieselIssues.push({ id: 'i2', litres: 50, type: 'supplementary', supplementaryId: 's1' }); assert.ok(/already been issued/.test(D.issueError(d, 'diesel', 10, 's1')));
  d.expensePayments.push({ id: 'p1', amount: 49500, type: 'initial' }); assert.equal(D.dispatchStatus(d), 'Dispatched');
  const c = D.expenseControl(d); assert.equal(c.dieselIssued, 1040); assert.equal(c.approvedDiesel, 1040); assert.equal(c.dieselVariance, 0); assert.equal(c.supplementaryDiesel, 50); assert.ok(c.exceptions.includes('Supplementary diesel issued'));
  const fin = { ...d, financeRequired: true, financeApprovedAt: '' }; assert.equal(D.dispatchStatus(fin), 'Awaiting Finance');
  assert.equal(D.nextDispatchNumber('2026-10-13', [{ number: 'DSP-261013-01' }]), 'DSP-261013-02');
});

test('lost sales = unfulfilled trucks × agreed client rate, classified by reason', () => {
  const req = requests.find((r) => r.client === 'Jamara' && r.routeId); const rate = D.requestRate(req, ctx); assert.ok(rate.rate > 0, 'rate found via ' + rate.source);
  const ls = D.lostSales({ trucks: 4 }, { requested: 4, allocated: 1 }, 2500000); assert.equal(ls.unfulfilled, 3); assert.equal(ls.lost, 7500000);
  assert.equal(D.lostSalesKindFor('No truck available'), 'Confirmed lost sale'); assert.equal(D.lostSalesKindFor('Client cancelled the order'), 'Not a lost sale'); assert.equal(D.lostSalesKindFor('Client postponed'), 'At risk');
  const sum = D.lostSalesSummary([{ client: 'A', kind: 'Confirmed lost sale', estimatedLost: 100, unfulfilledTrucks: 1 }, { client: 'A', kind: 'At risk', estimatedLost: 50, unfulfilledTrucks: 1 }, { client: 'B', kind: 'Not a lost sale', estimatedLost: 70, unfulfilledTrucks: 2 }], (r) => r.client);
  assert.deepEqual(sum.map((s) => [s.key, s.confirmed, s.atRisk, s.notLost]), [['A', 100, 50, 0], ['B', 0, 0, 70]]);
});

test('assistant answers every management question in the brief from live records', () => {
  const dispatches = [{ number: 'DSP-1', tripLogId: 't1', plate: 'T1', client: 'C', routeName: 'Lagos → Kano', category: 'Haulage 45T', budgetDiesel: 990, approvedDiesel: 990, approvedRoad: 49500, opsApprovedAt: 'x', dieselIssues: [], expensePayments: [], supplementary: [] }, { number: 'DSP-2', tripLogId: 't2', plate: 'T2', client: 'C', routeName: 'Lagos → Kano', category: 'Haulage 45T', budgetDiesel: 990, approvedDiesel: 990, approvedRoad: 49500, opsApprovedAt: 'x', dieselIssues: [{ id: 'a', litres: 1100, type: 'initial' }], expensePayments: [], supplementary: [] }];
  const c = Object.assign({}, ctx, { dispatches });
  for (const q of D.QUESTIONS) { const a = D.assistant(q, c); assert.ok(a && a.answer && Array.isArray(a.rows), q); }
  assert.equal(D.assistant('Which trips are awaiting diesel dispatch?', c).rows.length, 1);
  assert.equal(D.assistant('Which trucks have received diesel above the approved allowance?', c).rows[0].dispatch, 'DSP-2');
  assert.ok(/Kano/.test(D.assistant('How much diesel is required for all planned Kano trips?', c).title));
  assert.equal(D.assistant('what is the meaning of life', c), null);
});

test('anomaly checks: duplicate routes, unmapped locations, implausible distances, bad categories, duplicate / over issues, missing distances', () => {
  const dispatches = [{ number: 'DSP-9', plate: 'T1', routeName: 'Lagos → Kano', originState: 'Lagos', destState: 'Kano', approvedDiesel: 100, approvedRoad: 0, opsApprovedAt: 'x', distanceVerified: false, dieselIssues: [{ id: 'a', litres: 80, type: 'initial', ref: 'R1' }, { id: 'b', litres: 80, type: 'initial', ref: 'R1' }], expensePayments: [], supplementary: [] }];
  const a = D.anomalies(Object.assign({}, ctx, { dispatches, distances: ctx.distances.concat([{ id: 'bad', routeName: 'Lagos (JMG Gbagada) → Kano', originState: 'Lagos', destState: 'Kano', oneWayKm: 2500 }, { id: 'low', routeName: 'x', originState: 'Lagos', destState: 'Borno', oneWayKm: 200 }]) }));
  const kinds = new Set(a.map((x) => x.kind));
  for (const k of ['Duplicate route', 'Duplicate route name', 'Unusually high distance', 'Unusually low distance', 'Vehicle consumption category', 'Duplicate diesel issue', 'Duplicate diesel request', 'Diesel above approved', 'Missing approved distance']) assert.ok(kinds.has(k), k);
});

test('dispatch dashboard figures come from live records', () => {
  const d = D.dashboard(ctx); assert.equal(d.plannedTrips, allocations.filter((a) => !['Cancelled', 'Completed'].includes(a.status)).length); assert.ok(d.dieselRequiredPlanned > 0); assert.ok(d.roadRequiredPlanned > 0); assert.equal(d.dieselIssued, 0); assert.equal(d.availableNotPlanned, P.fleetKpis(ctx).availableUnplanned);
});
