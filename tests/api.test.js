// End-to-end API test: boots the real server on a random port with a throw-away database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WB = path.join(__dirname, '..', 'data', 'source', 'Prodction Data.xlsx');
const haveWb = fs.existsSync(WB);
let server; let base; let dir;
const jars = {};
async function call(user, method, url, body, extra = {}) {
  const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jars[user] ? { Cookie: jars[user] } : {}), ...extra };
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) jars[user] = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
}
const login = (u, p) => call(u, 'POST', '/api/login', { username: u, password: p });

test.before(async () => {
  if (!haveWb) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-test-'));
  process.env.DATA_DIR = dir; process.env.PORT = '0'; process.env.COOKIE_SECURE = '0';
  const { boot, startServer } = require('../server/index.js');
  const db = boot();
  server = startServer(db);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { if (server) server.close(); });

test('login, roles and permissions', { skip: !haveWb }, async () => {
  assert.equal((await login('nobody', 'x')).status, 401);
  assert.equal((await login('sales', 'Sales@2026')).status, 200);
  const me = await call('sales', 'GET', '/api/me');
  assert.equal(me.data.user.role, 'SALES');
  assert.equal(me.data.permissions['plan.approve'], false);
  assert.equal((await call('anon', 'GET', '/api/plans')).status, 401);
});

test('Demo 1–3: sales request → BOM explosion → plan → approve → daily report → delay', { skip: !haveWb }, async () => {
  await login('sales', 'Sales@2026'); await login('planner', 'Planner@2026'); await login('cutting', 'Cutting@2026'); await login('welding', 'Welding@2026');
  const sr = await call('sales', 'POST', '/api/sales-requests', { customer: 'Test Co', product_code: 'MSPGP110', qty: 20, delivery_date: '2026-12-15', start_date: '2026-10-26' });
  assert.equal(sr.status, 200); assert.match(sr.data.number, /^SR-\d{4}-\d{4}$/); assert.ok(sr.data.planId);
  const plan = (await call('planner', 'GET', `/api/plans/${sr.data.planId}`)).data;
  assert.equal(plan.status, 'PROPOSED'); assert.equal(plan.product_code, 'MSPGP110'); assert.equal(plan.qty, 20);
  assert.ok(plan.expected_finish > plan.start_date);
  assert.equal(plan.orders.length, 15); assert.equal(plan.materials.length, 185);
  assert.ok(plan.critical_path.length > 3); assert.ok(plan.bottleneck);
  const enclosure = plan.orders.find((o) => o.item_code === 'SF-SPF-S3-OPT');
  assert.equal(enclosure.ops.length, 4); assert.equal(enclosure.ops[0].section_code, 'CUT');
  assert.ok(enclosure.ops[0].days.length >= 2, 'cutting is spread over days by machine capacity');
  assert.ok(plan.summary.materialCostPerUnit > 4e6);
  // sales cannot approve, planner can
  assert.equal((await call('sales', 'POST', `/api/plans/${plan.id}/approve`)).status, 403);
  const ap = await call('planner', 'POST', `/api/plans/${plan.id}/approve`);
  assert.equal(ap.data.status, 'APPROVED'); assert.equal(ap.data.baseline_finish, plan.expected_finish);
  // section dashboard shows released work
  const dash = (await call('cutting', 'GET', '/api/sections/CUT/dashboard')).data;
  assert.ok(dash.kpi.operations >= 3);
  const cutOp = dash.ops.find((o) => o.work_centre_code === 'GB-CANOPY-CUT');
  assert.ok(cutOp);
  // welding supervisor may not report cutting
  assert.equal((await call('welding', 'POST', '/api/daily-reports', { po_operation_id: cutOp.id, date: '2026-10-26', actual_qty: 1 })).status, 403);
  // over-reporting is rejected
  assert.equal((await call('cutting', 'POST', '/api/daily-reports', { po_operation_id: cutOp.id, date: '2026-10-26', actual_qty: 99 })).status, 400);
  // Demo 3: cutting delivers 8 instead of 15 on day 1
  const rep = await call('cutting', 'POST', '/api/daily-reports', { po_operation_id: cutOp.id, date: '2026-10-26', actual_qty: 8, rejected_qty: 1, downtime_min: 120, delay_reason: 'Machine breakdown' });
  assert.equal(rep.status, 200);
  assert.ok(Math.abs(rep.data.achievementPct - (8 / 15) * 100) < 0.01);
  assert.ok(rep.data.plan.expected_finish > rep.data.plan.baseline_finish, 'finished goods date slips');
  assert.equal(rep.data.plan.delay_days, 1);
  const after = (await call('planner', 'GET', `/api/plans/${plan.id}`)).data;
  assert.equal(after.status, 'IN_PROGRESS'); assert.equal(after.baseline_finish, plan.expected_finish);
  const op = after.orders.find((o) => o.item_code === 'SF-SPF-S3-OPT').ops[0];
  assert.equal(op.completed_qty, 8); assert.equal(op.remaining_qty, 12);
  // dashboard KPIs and board
  await login('management', 'Manage@2026');
  const kpi = (await call('management', 'GET', '/api/dashboard?from=2026-10-01&to=2026-12-31')).data;
  assert.equal(kpi.kpi.plannedFg, 20); assert.ok(kpi.sections.find((s) => s.code === 'CUT').actual === 8);
  const board = (await call('management', 'GET', '/api/board?from=2026-10-20&to=2026-12-20')).data;
  assert.ok(board.ops.length > 20); assert.equal(board.delayed.length, 1);
});

test('Demo 4: BOM costing per unit and for 20 units, flags and no double counting', { skip: !haveWb }, async () => {
  await login('costing', 'Costing@2026');
  const c = (await call('costing', 'GET', '/api/costing/MSPGP110?qty=20&policy=standard')).data;
  assert.ok(Math.abs(c.perUnit.fullManufacturing - 4699816.21) < 5);
  assert.ok(Math.abs(c.total.material - c.perUnit.material * 20) < 1e-3);
  assert.equal(c.components.length, 185);
  assert.ok(c.flags.length > 0);
  // approve a cost: new costing uses it, existing plan snapshot unchanged
  const item = c.components.find((x) => x.itemCode === 'MSH120001-H');
  const before = (await call('costing', 'GET', '/api/plans/1')).data.materials.find((m) => m.item_code === 'MSH120001-H').unit_cost_used;
  assert.equal((await call('costing', 'PUT', '/api/items/MSH120001-H', { approved_unit_cost: 20000, note: 'test' })).status, 200);
  const c2 = (await call('costing', 'GET', '/api/costing/MSPGP110?qty=1&policy=approved')).data;
  assert.equal(c2.components.find((x) => x.itemCode === 'MSH120001-H').unitCost, 20000);
  const afterSnap = (await call('costing', 'GET', '/api/plans/1')).data.materials.find((m) => m.item_code === 'MSH120001-H').unit_cost_used;
  assert.equal(before, afterSnap, 'historical snapshot untouched');
  assert.ok(item);
  // sales may not approve costs
  await login('sales', 'Sales@2026');
  assert.equal((await call('sales', 'PUT', '/api/items/MSH120001-H', { approved_unit_cost: 1 })).status, 403);
});

test('inventory: opening stock reduces net production requirement', { skip: !haveWb }, async () => {
  await login('stores', 'Stores@2026'); await login('planner', 'Planner@2026');
  assert.equal((await call('stores', 'POST', '/api/inventory/movements', { type: 'OPENING', item_code: 'OPT-CPNL-S2', qty: 12, category: 'Panels' })).status, 200);
  const pv = (await call('planner', 'POST', '/api/plans/preview', { product_code: 'MSPGP110', qty: 20, start_date: '2026-11-02', use_inventory: true, ignore_existing: true })).data;
  const panel = pv.orders.find((o) => o.code === 'OPT-CPNL-S2');
  assert.equal(panel.inventoryUsed, 12); assert.equal(panel.netQty, 8);
  const pv0 = (await call('planner', 'POST', '/api/plans/preview', { product_code: 'MSPGP110', qty: 20, start_date: '2026-11-02', use_inventory: false, ignore_existing: true })).data;
  assert.equal(pv0.orders.find((o) => o.code === 'OPT-CPNL-S2').netQty, 20);
  assert.equal((await call('stores', 'POST', '/api/inventory/movements', { type: 'ISSUE', item_code: 'OPT-CPNL-S2', qty: 50 })).status, 400, 'cannot issue more than available');
});

test('admin: users, audit, backups, exceptions', { skip: !haveWb }, async () => {
  await login('admin', 'Admin@2026');
  const u = await call('admin', 'POST', '/api/users', { username: 'qa.user', password: 'Qa@12345678', role: 'SUPERVISOR', sections: ['WELD'] });
  assert.equal(u.status, 200);
  assert.equal((await call('admin', 'POST', '/api/users', { username: 'bad', password: 'short', role: 'SALES' })).status, 400);
  const audit = (await call('admin', 'GET', '/api/audit?limit=50')).data;
  assert.ok(audit.some((a) => a.action === 'PLAN_APPROVED') && audit.some((a) => a.action === 'DAILY_REPORT'));
  const bk = await call('admin', 'POST', '/api/backups');
  assert.equal(bk.status, 200); assert.ok(bk.data.bytes > 100000);
  const ex = (await call('admin', 'GET', '/api/exceptions')).data;
  assert.ok(ex.rows.length > 100);
  assert.equal((await call('admin', 'PUT', `/api/exceptions/${ex.rows[0].id}`, { status: 'ACCEPTED', note: 'ok' })).data.status, 'ACCEPTED');
  const csv = await call('admin', 'GET', '/api/export/operations.csv');
  assert.equal(csv.status, 200); assert.match(csv.data, /po_number,item_code/);
});
