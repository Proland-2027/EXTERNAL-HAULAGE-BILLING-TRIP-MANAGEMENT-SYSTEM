// Planning engine tests: workbook reader, BOM explosion, costing, scheduler. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../server/lib/xlsx.js');
const W = require('../server/import/workbook.js');
const { buildTree, explode, costProduct } = require('../server/engine/bom.js');
const { simulate } = require('../server/engine/scheduler.js');
const { makeCalendar } = require('../server/engine/calendar.js');
const { ClassResolver, bandFromTypeCode } = require('../server/engine/classes.js');

const WB = path.join(__dirname, '..', 'data', 'source', 'Prodction Data.xlsx');
const haveWb = fs.existsSync(WB);
let interp = null;
function getInterp() { if (!interp) interp = W.interpretWorkbook(fs.readFileSync(WB)); return interp; }

test('xlsx reader parses every worksheet of the production workbook', { skip: !haveWb }, () => {
  const wb = X.parseWorkbook(fs.readFileSync(WB));
  assert.deepEqual(wb.sheetNames, ['Canopy Assembly', 'Genset Assembly', 'Capacity S1', 'Capacity S2', 'CapacityS3', 'CapacityS4', 'Capacity200', 'Capacity500', 'BOM', 'Finished Product', 'Cutting Capacity']);
  const bom = X.sheetByName(wb, 'BOM');
  assert.equal(bom.rows.length, 26674);
  assert.equal(bom.rows[0][0], 'Item number');
  assert.equal(bom.rows[1][23], '2021-02-17'); // date cell converted
  assert.equal(typeof bom.rows[1][15], 'number');
});

test('workbook interpreter: 41 finished codes, 112 trees, routings and productivity mapped', { skip: !haveWb }, () => {
  const r = getInterp();
  assert.equal(r.finishedList.length, 41);
  assert.equal(r.products.length, 112);
  assert.equal(r.bomLines.length, 26673);
  assert.ok(r.productivity.length > 400);
  assert.ok(r.cuttingSummary.length === 8);
  assert.equal(r.exceptions.filter((e) => e.type === 'BOM_PARENT_MISMATCH').length, 0, 'ERP export nests cleanly');
  assert.ok(r.exceptions.some((e) => e.type === 'COST_ROLLUP_MISMATCH'));
  assert.ok(r.exceptions.some((e) => e.type === 'CUTTING_CAPACITY_DISCREPANCY'));
  const p110 = r.products.find((p) => p.code === 'MSPGP110');
  assert.equal(p110.pnum, 110); assert.equal(p110.kva, 100); assert.equal(p110.inFinishedList, 1);
});

test('BOM explosion aggregates sub-assemblies without double counting and derives routings', { skip: !haveWb }, () => {
  const r = getInterp();
  const lines = r.bomLines.filter((l) => l.productCode === 'MSPGP110').map(toDbLine);
  const tree = buildTree(lines);
  const ex = explode(tree, 20, { opMap: r.operationMap.map((m, i) => ({ cost_group_prefix: m.costGroup, family: m.family, work_centre_code: m.workCentre, process: m.process, seq: i })) });
  assert.equal(ex.rootOrder.code, 'MSPGP110');
  assert.equal(ex.rootOrder.requiredQty, 20);
  const enclosure = ex.orders.find((o) => o.code === 'SF-SPF-S3-OPT');
  assert.equal(enclosure.requiredQty, 20);
  assert.deepEqual(enclosure.ops.map((o) => o.workCentre), ['GB-CANOPY-CUT', 'GB-CANOPY-WELD', 'GB-CANOPY-GRIND', 'GB-CANOPY-PWC']);
  assert.ok(Math.abs(enclosure.ops[0].hoursPerUnit - 7.48) < 0.01, 'cutting + bending labour hours merged');
  // a material used by several sub-assemblies is aggregated once
  const sanding = ex.materials.find((m) => m.code === 'SND500001');
  assert.ok(sanding.usedBy.size >= 2);
  assert.ok(Math.abs(sanding.qtyPerProduct - [...sanding.usedBy.values()].reduce((a, b) => a + b, 0)) < 1e-9);
  // status items (−1/+1 phantom pairs) are excluded
  assert.ok(!ex.materials.find((m) => m.code === 'S-SF-SPF-S3-OPT'));
  const codes = ex.orders.map((o) => o.code);
  assert.equal(new Set(codes).size, codes.length, 'one order per sub-assembly code');
});

test('costing: standard material + conversion equals the ERP rolled cost of the product', { skip: !haveWb }, () => {
  const r = getInterp();
  const lines = r.bomLines.filter((l) => l.productCode === 'MSPGP110').map(toDbLine);
  const tree = buildTree(lines);
  const c = costProduct(tree, 20, { unitCostFor: (code, { std }) => ({ cost: std, source: 'standard', flags: [] }) });
  const full = c.perUnit.materialStd + c.perUnit.labour + c.perUnit.machine + c.perUnit.mfgOverhead + c.perUnit.labourOverhead + c.perUnit.materialOverhead;
  assert.ok(Math.abs(full - 4699816.21) < 5, `full standard cost ${full} vs ERP 4699816.21`);
  assert.ok(Math.abs(c.total.material - c.perUnit.material * 20) < 1e-6);
  assert.ok(c.byCostGroup.length > 5);
});

test('class resolver reads kVA bands from productivity type codes', () => {
  const classes = [{ family: 'BASE', code: 'S2', kva_min: 50, kva_max: 97, aliases: '["s2"]' }];
  assert.deepEqual(bandFromTypeCode('SF-C&B-BT-S2', classes.map((c) => ({ ...c, aliases: JSON.parse(c.aliases) }))).code, 'S2');
  assert.deepEqual(bandFromTypeCode('P50-88', []), { min: 50, max: 88, code: 'P50-88', via: 'pnum' });
  assert.deepEqual(bandFromTypeCode('SFP-BTP200/P250', []), { min: 200, max: 250, code: 'SFP-BTP200/P250', via: 'pnum' });
  assert.deepEqual(bandFromTypeCode('spgP13.5', []), { min: 13.5, max: 13.5, code: 'spgP13.5', via: 'pnum' });
  const res = new ClassResolver({ modelClasses: [{ family: 'CANOPY', code: 'P110', kva_min: 110, kva_max: 138, aliases: '["s3"]' }, { family: 'CANOPY', code: 'P50-88', kva_min: 50, kva_max: 97, aliases: '["s2"]' }], productivity: [{ work_centre_code: 'WC', type_code: 'P110', rate_per_day: 25 }, { work_centre_code: 'WC', type_code: 'P50-88', rate_per_day: 28 }], workCentres: [{ code: 'WC', classify: 'CANOPY' }], cuttingSummary: [] });
  assert.equal(res.findRate('WC', { code: 'SF-SPF-S3-OPT', pnum: 110 }).rate, 25);
  assert.equal(res.findRate('WC', { code: 'SPF-S2-P88-OPT', pnum: 88 }).rate, 28);
  assert.equal(res.findRate('WC', { code: 'X', pnum: 120 }).rate, 25, 'band match');
  assert.equal(res.findRate('WC', { code: 'X', pnum: 100 }).source, 'master:nearest');
});

test('scheduler: finite capacity, next-day transfer, dependencies, critical path and bottleneck', () => {
  const cal = makeCalendar({ workingWeekdays: [1, 2, 3, 4, 5] });
  // component A (10/day) feeds assembly B (5/day); 20 units
  const mk = () => [
    { id: 'A', code: 'A', qty: 20, priority: 5, level: 1, children: [], ops: [{ id: 'A1', seq: 1, wc: 'CUT', rate: 10 }, { id: 'A2', seq: 2, wc: 'WELD', rate: 10 }] },
    { id: 'B', code: 'B', qty: 20, priority: 5, level: 0, isRoot: true, children: [{ id: 'A', perUnit: 1 }], ops: [{ id: 'B1', seq: 1, wc: 'ASSY', rate: 5 }] },
  ];
  const r = simulate({ startDate: '2026-10-19', calendar: cal, resources: {}, machines: {}, orders: mk(), options: { transferLagDays: 1, transferBatch: 1 } });
  const op = (id) => r.ops.find((o) => o.id === id);
  assert.equal(op('A1').start, '2026-10-19'); assert.equal(op('A1').finish, '2026-10-20');
  assert.equal(op('A2').start, '2026-10-20', 'welding starts the day after the first cut batch');
  assert.equal(op('A2').finish, '2026-10-21');
  assert.equal(op('B1').start, '2026-10-21', 'assembly starts when the first welded parts arrive');
  assert.equal(r.finish, '2026-10-26', '20 units at 5/day from Wed 21st → Mon 26th (weekend skipped)');
  assert.equal(r.criticalPath[r.criticalPath.length - 1].opId, 'B1');
  assert.equal(r.bottleneck.wc, 'ASSY');
  // capacity is shared: a second order on ASSY with higher priority pushes B out
  const orders2 = mk().concat([{ id: 'C', code: 'C', qty: 30, priority: 1, level: 0, children: [], ops: [{ id: 'C1', seq: 1, wc: 'ASSY', rate: 5 }] }]);
  const r2 = simulate({ startDate: '2026-10-19', calendar: cal, resources: {}, machines: {}, orders: orders2, options: { transferLagDays: 1 } });
  assert.ok(r2.orders.find((o) => o.id === 'B').finish > '2026-10-26');
  const util = r2.utilisationByDay.ASSY;
  for (const v of Object.values(util)) assert.ok(v <= 1.0001, 'never more than one resource-day per day');
  // machine minutes limit output
  const r3 = simulate({ startDate: '2026-10-19', calendar: cal, resources: {}, machines: { P1: { minutesPerDay: 480 } }, orders: [{ id: 'M', code: 'M', qty: 30, priority: 5, level: 0, isRoot: true, children: [], ops: [{ id: 'M1', seq: 1, wc: 'CUT', rate: 25, machineMinutes: { P1: 32 } }] }], options: {} });
  assert.deepEqual(r3.ops[0].days.map((d) => d.qty), [15, 15], 'Punch 1 at 32 min/unit limits cutting to 15/day');
  // rescheduling from actuals: completed quantities shorten the remaining work
  const r4 = simulate({ startDate: '2026-10-21', calendar: cal, resources: {}, machines: {}, orders: [{ id: 'A', code: 'A', qty: 20, priority: 5, level: 0, isRoot: true, children: [], ops: [{ id: 'A1', seq: 1, wc: 'CUT', rate: 10, completed: 8 }, { id: 'A2', seq: 2, wc: 'WELD', rate: 10, completed: 0 }] }], options: { transferLagDays: 1 } });
  assert.equal(r4.ops[0].days.reduce((a, d) => a + d.qty, 0), 12);
  assert.equal(r4.ops[1].days[0].qty, 8, 'welding can start on the 8 already cut');
});

test('calendar: working days and holidays', () => {
  const cal = makeCalendar({ overrides: new Map([['2026-10-21', { working: 0 }]]), workingWeekdays: [1, 2, 3, 4, 5] });
  assert.equal(cal.isWorking('2026-10-24'), false); // Saturday
  assert.equal(cal.isWorking('2026-10-21'), false); // holiday
  assert.equal(cal.nextWorking('2026-10-24'), '2026-10-26');
  assert.equal(cal.addWorking('2026-10-20', 2), '2026-10-23');
  assert.equal(cal.workingDaysBetween('2026-10-20', '2026-10-27'), 4);
});

function toDbLine(l) { return { product_code: l.productCode, line_no: l.lineNo, level: l.level, parent_code: l.parentCode, item_code: l.itemCode, name: l.name, calc_type: l.calcType, consumption: l.consumption, unit: l.unit, cost_per_lot: l.costPerLot, lot_size: l.lotSize, cost_per_unit: l.costPerUnit, cost_group: l.costGroup, operation: l.operation, unit_cost: l.unitCost, type1: l.type1, type3: l.type3, warehouse: l.warehouse, is_status_item: l.isStatusItem ? 1 : 0 }; }
