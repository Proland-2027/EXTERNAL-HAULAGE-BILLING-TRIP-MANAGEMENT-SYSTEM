/* planning.js — sales requests, plan proposals/approval, planning board, scenarios. */
'use strict';
const { HttpError } = require('../http.js');
const { can } = require('../auth.js');
const { proposePlan, reschedulePlan, nextNumber, loadContext } = require('../engine/planner.js');
const { serializeOrder, serializeMaterial } = require('./masters.js');
const { nowIso } = require('../db.js');
const { today } = require('../engine/calendar.js');

const need = (user, perm) => { if (!can(user, perm)) throw new HttpError(403, 'Not permitted for your role'); };
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

module.exports = function register(r, { db }) {
  // ---- sales requests
  r.get('/api/sales-requests', ({ query }) => {
    const status = query.get('status');
    return db.all(`SELECT sr.*, p.expected_finish, p.baseline_finish, p.status plan_status FROM sales_requests sr LEFT JOIN plans p ON p.id = sr.plan_id ${status ? 'WHERE sr.status = ?' : ''} ORDER BY sr.id DESC`, ...(status ? [status] : []));
  });
  r.post('/api/sales-requests', async ({ body, user }) => {
    need(user, 'sales.write');
    const product = db.get('SELECT * FROM products WHERE code = ? AND in_finished_list = 1', body.product_code);
    if (!product) throw new HttpError(400, 'Finished product code must come from the Finished Product list');
    const qty = Number(body.qty); if (!(qty > 0)) throw new HttpError(400, 'Quantity must be greater than zero');
    if (!body.customer || !String(body.customer).trim()) throw new HttpError(400, 'Customer name is required');
    if (body.delivery_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.delivery_date)) throw new HttpError(400, 'Bad delivery date');
    const number = nextNumber(db, 'SR', 'sales_requests', 'number');
    const family = body.family || (product.family === 'GENSET' ? 'Genset' : 'Canopy');
    const id = db.run('INSERT INTO sales_requests(number,order_ref,customer,product_code,product_name,family,qty,delivery_date,priority,remarks,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', number, body.order_ref || null, String(body.customer).trim(), product.code, product.name, family, qty, body.delivery_date || null, PRIORITIES.includes(body.priority) ? body.priority : 'NORMAL', body.remarks || null, 'SUBMITTED', user.username, nowIso()).lastInsertRowid;
    db.audit(user, 'SALES_REQUEST_CREATED', 'sales_request', id, { number, product: product.code, qty });
    // automatically prepare a proposed plan so the planning queue shows the material and date picture immediately
    let plan = null; let planError = null;
    try { plan = proposePlan(db, product.code, qty, { startDate: body.start_date || today(), useInventory: !!body.use_inventory, priority: body.priority, persist: true, salesRequestId: id, user }); } catch (e) { planError = e.message; }
    return { ...db.get('SELECT * FROM sales_requests WHERE id = ?', id), planId: plan?.planId || null, expectedFinish: plan?.expectedFinish || null, planError };
  });
  r.get('/api/sales-requests/:id', ({ params }) => {
    const sr = db.get('SELECT * FROM sales_requests WHERE id = ?', params.id); if (!sr) throw new HttpError(404, 'Not found');
    return { ...sr, plans: db.all('SELECT id, version, status, start_date, expected_finish, baseline_finish, revised_finish, created_at, approved_at, approved_by FROM plans WHERE sales_request_id = ? ORDER BY version DESC', sr.id) };
  });
  r.put('/api/sales-requests/:id', async ({ params, body, user }) => {
    need(user, 'sales.write');
    const sr = db.get('SELECT * FROM sales_requests WHERE id = ?', params.id); if (!sr) throw new HttpError(404, 'Not found');
    if (body.status === 'CANCELLED') {
      if (!['SUBMITTED', 'PLANNED'].includes(sr.status) && !can(user, 'plan.approve')) throw new HttpError(400, 'Only unapproved requests can be cancelled by Sales');
      db.run("UPDATE sales_requests SET status = 'CANCELLED', updated_at = ? WHERE id = ?", nowIso(), sr.id);
      db.run("UPDATE plans SET status = 'CANCELLED' WHERE sales_request_id = ? AND status IN ('PROPOSED','APPROVED','IN_PROGRESS')", sr.id);
      db.run("UPDATE production_orders SET status = 'CANCELLED' WHERE plan_id IN (SELECT id FROM plans WHERE sales_request_id = ?) AND status NOT IN ('COMPLETED')", sr.id);
      db.audit(user, 'SALES_REQUEST_CANCELLED', 'sales_request', sr.id, {});
      return db.get('SELECT * FROM sales_requests WHERE id = ?', sr.id);
    }
    if (!['SUBMITTED', 'PLANNED'].includes(sr.status)) throw new HttpError(400, 'Approved requests cannot be edited; cancel and re-enter');
    db.run('UPDATE sales_requests SET order_ref = ?, customer = ?, delivery_date = ?, priority = ?, remarks = ?, updated_at = ? WHERE id = ?', body.order_ref ?? sr.order_ref, body.customer ?? sr.customer, body.delivery_date ?? sr.delivery_date, PRIORITIES.includes(body.priority) ? body.priority : sr.priority, body.remarks ?? sr.remarks, nowIso(), sr.id);
    db.audit(user, 'SALES_REQUEST_UPDATED', 'sales_request', sr.id, body);
    return db.get('SELECT * FROM sales_requests WHERE id = ?', sr.id);
  });
  r.post('/api/sales-requests/:id/plan', async ({ params, body, user }) => {
    need(user, 'plan.write');
    const sr = db.get('SELECT * FROM sales_requests WHERE id = ?', params.id); if (!sr) throw new HttpError(404, 'Not found');
    if (!['SUBMITTED', 'PLANNED'].includes(sr.status)) throw new HttpError(400, 'Request already approved');
    db.run("UPDATE plans SET status = 'SUPERSEDED' WHERE sales_request_id = ? AND status = 'PROPOSED'", sr.id);
    const plan = proposePlan(db, sr.product_code, sr.qty, { startDate: body.start_date || today(), useInventory: !!body.use_inventory, priority: body.priority || sr.priority, transferBatch: body.transfer_batch != null ? Number(body.transfer_batch) : undefined, useMachines: body.use_machines, persist: true, salesRequestId: sr.id, user });
    return { planId: plan.planId, expectedFinish: plan.expectedFinish, summary: plan.summary, warnings: plan.warnings };
  });

  // ---- plans
  r.post('/api/plans/preview', async ({ body, user }) => {
    need(user, 'plan.write');
    const qty = Number(body.qty); if (!(qty > 0)) throw new HttpError(400, 'Quantity must be > 0');
    const res = proposePlan(db, body.product_code, qty, { startDate: body.start_date || today(), useInventory: !!body.use_inventory, priority: body.priority, transferBatch: body.transfer_batch != null ? Number(body.transfer_batch) : undefined, useMachines: body.use_machines, transferLagDays: body.transfer_lag_days != null ? Number(body.transfer_lag_days) : undefined, ignoreExisting: !!body.ignore_existing, persist: false });
    return serializeProposal(res);
  });
  r.get('/api/plans', ({ query }) => {
    const status = query.get('status');
    return db.all(`SELECT p.*, sr.number sales_number, sr.customer, sr.delivery_date, sr.priority FROM plans p LEFT JOIN sales_requests sr ON sr.id = p.sales_request_id ${status ? 'WHERE p.status = ?' : ''} ORDER BY p.id DESC LIMIT 500`, ...(status ? [status] : [])).map((p) => ({ ...p, summary: JSON.parse(p.summary || 'null'), options: JSON.parse(p.options || 'null'), bottleneck: JSON.parse(p.bottleneck || 'null'), critical_path: undefined, warnings: undefined }));
  });
  r.get('/api/plans/:id', ({ params }) => planDetail(db, params.id));
  r.post('/api/plans/:id/approve', async ({ params, user }) => {
    need(user, 'plan.approve');
    const plan = db.get('SELECT * FROM plans WHERE id = ?', params.id); if (!plan) throw new HttpError(404, 'Plan not found');
    if (plan.status !== 'PROPOSED') throw new HttpError(400, `Plan is ${plan.status}`);
    db.tx(() => {
      db.run("UPDATE plans SET status = 'APPROVED', approved_by = ?, approved_at = ?, baseline_finish = expected_finish WHERE id = ?", user.username, nowIso(), plan.id);
      db.run("UPDATE production_orders SET baseline_start = planned_start, baseline_finish = planned_finish, status = CASE WHEN status = 'COVERED' THEN status ELSE 'RELEASED' END WHERE plan_id = ?", plan.id);
      db.run("UPDATE po_operations SET baseline_start = planned_start, baseline_finish = planned_finish, status = CASE WHEN status = 'UNSCHEDULED' THEN status ELSE 'RELEASED' END WHERE plan_id = ?", plan.id);
      if (plan.sales_request_id) db.run("UPDATE sales_requests SET status = 'APPROVED', plan_id = ?, updated_at = ? WHERE id = ?", plan.id, nowIso(), plan.sales_request_id);
      db.audit(user, 'PLAN_APPROVED', 'plan', plan.id, { expectedFinish: plan.expected_finish });
    });
    return planDetail(db, plan.id);
  });
  r.post('/api/plans/:id/reschedule', async ({ params, body, user }) => {
    need(user, 'plan.write');
    const plan = db.get('SELECT * FROM plans WHERE id = ?', params.id); if (!plan) throw new HttpError(404, 'Plan not found');
    if (!['APPROVED', 'IN_PROGRESS'].includes(plan.status)) throw new HttpError(400, 'Only approved plans can be rescheduled');
    reschedulePlan(db, plan.id, { fromDate: body.from_date || today(), user });
    return planDetail(db, plan.id);
  });
  r.post('/api/plans/:id/cancel', async ({ params, user }) => {
    need(user, 'plan.approve');
    const plan = db.get('SELECT * FROM plans WHERE id = ?', params.id); if (!plan) throw new HttpError(404, 'Plan not found');
    db.tx(() => {
      db.run("UPDATE plans SET status = 'CANCELLED' WHERE id = ?", plan.id);
      db.run("UPDATE production_orders SET status = 'CANCELLED' WHERE plan_id = ? AND status != 'COMPLETED'", plan.id);
      if (plan.sales_request_id) db.run("UPDATE sales_requests SET status = 'SUBMITTED', plan_id = NULL, updated_at = ? WHERE id = ? AND plan_id = ?", nowIso(), plan.sales_request_id, plan.id);
      db.audit(user, 'PLAN_CANCELLED', 'plan', plan.id, {});
    });
    return { ok: true };
  });
  r.put('/api/production-orders/:id', async ({ params, body, user }) => {
    need(user, 'plan.write');
    const po = db.get('SELECT * FROM production_orders WHERE id = ?', params.id); if (!po) throw new HttpError(404, 'Order not found');
    const prio = body.priority != null ? Number(body.priority) : po.priority;
    if (!(prio >= 1 && prio <= 9)) throw new HttpError(400, 'Priority 1 (highest) to 9');
    db.run('UPDATE production_orders SET priority = ? WHERE plan_id = ?', prio, po.plan_id); // priority is a plan-level attribute in the scheduler
    db.audit(user, 'ORDER_PRIORITY', 'production_order', po.id, { from: po.priority, to: prio });
    if (['APPROVED', 'IN_PROGRESS'].includes(db.get('SELECT status FROM plans WHERE id = ?', po.plan_id).status)) reschedulePlan(db, po.plan_id, { fromDate: today(), user });
    return db.get('SELECT * FROM production_orders WHERE id = ?', po.id);
  });

  // ---- planning board
  r.get('/api/board', ({ query }) => {
    const from = query.get('from') || today(); const to = query.get('to') || addDaysIso(from, 60);
    const ctx = loadContext(db);
    const ops = db.all(`SELECT op.*, po.number po_number, po.item_code, po.item_name, po.net_qty, po.plan_id, po.priority, po.level, po.status po_status, p.product_code, p.expected_finish plan_expected_finish, p.baseline_finish plan_baseline_finish, p.status plan_status, sr.number sales_number, sr.customer, sr.delivery_date
      FROM po_operations op JOIN production_orders po ON po.id = op.production_order_id JOIN plans p ON p.id = op.plan_id LEFT JOIN sales_requests sr ON sr.id = p.sales_request_id
      WHERE p.status IN ('PROPOSED','APPROVED','IN_PROGRESS') AND op.status NOT IN ('CANCELLED') ORDER BY p.id, po.level DESC, op.seq`);
    const ids = ops.map((o) => o.id);
    const days = ids.length ? db.all(`SELECT po_operation_id, date, planned_qty FROM po_schedule_days WHERE is_baseline = 0 AND date BETWEEN ? AND ? AND po_operation_id IN (${ids.map(() => '?').join(',')})`, from, to, ...ids) : [];
    const byOp = new Map(); for (const d of days) { if (!byOp.has(d.po_operation_id)) byOp.set(d.po_operation_id, []); byOp.get(d.po_operation_id).push(d); }
    const wcNames = new Map(ctx.workCentres.map((w) => [w.code, w]));
    // utilisation per wc per day (resource-days used / available)
    const util = {};
    for (const o of ops) for (const d of byOp.get(o.id) || []) { if (!(o.rate_per_day > 0)) continue; util[o.work_centre_code] = util[o.work_centre_code] || {}; util[o.work_centre_code][d.date] = (util[o.work_centre_code][d.date] || 0) + d.planned_qty / o.rate_per_day; }
    const conflicts = [];
    for (const [wc, dd] of Object.entries(util)) for (const [date, u] of Object.entries(dd)) { const cap = (wcNames.get(wc)?.capacity_factor || 1) * (ctx.calendar.minutes(date) / 480); if (u > cap + 0.01) conflicts.push({ wc, name: wcNames.get(wc)?.name, date, load: u, capacity: cap }); }
    const machineLoad = {};
    for (const o of ops) { if (!o.machine_minutes) continue; const mm = JSON.parse(o.machine_minutes); for (const d of byOp.get(o.id) || []) for (const [m, mpu] of Object.entries(mm)) { machineLoad[m] = machineLoad[m] || {}; machineLoad[m][d.date] = (machineLoad[m][d.date] || 0) + d.planned_qty * mpu; } }
    const delayed = db.all(`SELECT p.id, p.product_code, p.qty, p.baseline_finish, p.expected_finish, sr.number sales_number, sr.customer, sr.delivery_date FROM plans p LEFT JOIN sales_requests sr ON sr.id = p.sales_request_id WHERE p.status IN ('APPROVED','IN_PROGRESS') AND ((p.expected_finish > p.baseline_finish) OR (sr.delivery_date IS NOT NULL AND p.expected_finish > sr.delivery_date))`);
    return { from, to, ops: ops.map((o) => ({ ...o, days: byOp.get(o.id) || [], wc_name: wcNames.get(o.work_centre_code)?.name, machine_minutes: o.machine_minutes ? JSON.parse(o.machine_minutes) : null, resources: JSON.parse(o.resources || '[]') })), utilisation: util, conflicts, machineLoad, delayed, workCentres: ctx.workCentres.map((w) => ({ code: w.code, name: w.name, section: w.section_code, site: w.site, capacity_factor: w.capacity_factor })), sections: ctx.sections, calendar: { workingWeekdays: ctx.settings.workingWeekdays } };
  });
  // what-if: re-simulate open plans with capacity / priority overrides (no persistence)
  r.post('/api/board/scenario', async ({ body, user }) => {
    need(user, 'plan.write');
    const { simulate } = require('../engine/scheduler.js');
    const { loadOpenOrders } = require('../engine/planner.js');
    const ctx = loadContext(db);
    const orders = loadOpenOrders(db, -1);
    const planIds = [...new Set(orders.map((o) => o.planId))];
    const plansMeta = planIds.length ? db.all(`SELECT id, product_code, qty, expected_finish, baseline_finish FROM plans WHERE id IN (${planIds.map(() => '?').join(',')})`, ...planIds) : [];
    const roots = new Set(db.all("SELECT id FROM production_orders WHERE level = 0").map((x) => `po:${x.id}`));
    const prioOv = body.priorities || {}; const capOv = body.capacity || {};
    for (const o of orders) { if (prioOv[o.planId] != null) o.priority = Number(prioOv[o.planId]); o.isRoot = roots.has(o.id); }
    const resources = Object.fromEntries(ctx.workCentres.map((w) => [w.code, { capacityFactor: capOv[w.code] != null ? Number(capOv[w.code]) : (w.capacity_factor || 1) }]));
    const machines = Object.fromEntries(ctx.machines.map((m) => [m.code, { minutesPerDay: (body.machines?.[m.code] ?? m.minutes_per_day ?? 480) * (m.count || 1) }]));
    const sim = simulate({ startDate: body.from_date || today(), calendar: ctx.calendar, resources, machines, orders, options: { transferBatch: ctx.settings.transferBatch, useMachines: ctx.settings.useMachines, transferLagDays: ctx.settings.transferLagDays, horizonDays: 500 } });
    const finishByPlan = {};
    for (const o of orders) if (o.isRoot) { const s = sim.orders.find((x) => x.id === o.id); finishByPlan[o.planId] = s?.finish === 'done' ? null : s?.finish || null; }
    const warnings = sim.utilisation.filter((u) => u.peakUtil > 1.001).map((u) => ({ wc: u.wc, name: ctx.wcByCode.get(u.wc)?.name, peakUtil: u.peakUtil, message: `${ctx.wcByCode.get(u.wc)?.name} would be loaded above capacity (${(u.peakUtil * 100).toFixed(0)}%)` }));
    return { plans: plansMeta.map((p) => ({ ...p, scenario_finish: finishByPlan[p.id] ?? null })), utilisation: sim.utilisation.map((u) => ({ ...u, name: ctx.wcByCode.get(u.wc)?.name })), warnings, bottleneck: sim.bottleneck ? { ...sim.bottleneck, name: ctx.wcByCode.get(sim.bottleneck.wc)?.name } : null };
  });
  r.post('/api/board/apply-scenario', async ({ body, user }) => {
    need(user, 'plan.approve');
    db.tx(() => {
      for (const [wc, f] of Object.entries(body.capacity || {})) { db.run('UPDATE work_centres SET capacity_factor = ? WHERE code = ?', Number(f), wc); }
      for (const [planId, p] of Object.entries(body.priorities || {})) db.run('UPDATE production_orders SET priority = ? WHERE plan_id = ?', Number(p), Number(planId));
      db.audit(user, 'SCENARIO_APPLIED', 'board', null, body);
    });
    for (const p of db.all("SELECT id FROM plans WHERE status IN ('APPROVED','IN_PROGRESS') ORDER BY id")) reschedulePlan(db, p.id, { fromDate: today(), user });
    return { ok: true };
  });
};

function addDaysIso(s, n) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }

function serializeProposal(res) {
  return { product: res.product, qty: res.qty, startDate: res.startDate, expectedFinish: res.expectedFinish, summary: res.summary, warnings: res.warnings, criticalPath: res.criticalPath, bottleneck: res.bottleneck, utilisation: res.utilisation,
    orders: res.orders.map((o) => ({ ...serializeOrder(o), ops: o.ops.map((op) => ({ seq: op.seq, workCentre: op.workCentre, sectionCode: op.sectionCode, process: op.processes?.filter(Boolean).join('+') || op.process, resources: op.resources, hoursPerUnit: op.hoursPerUnit, machineHoursPerUnit: op.machineHoursPerUnit, ratePerDay: op.ratePerDay, rateSource: op.rateSource, classCode: op.classCode, machineMinutes: op.machineMinutes, plannedStart: op.plannedStart, plannedFinish: op.plannedFinish, days: op.days, onCriticalPath: op.onCriticalPath, waitInput: op.waitInput, waitCapacity: op.waitCapacity, unschedulable: !!op.unschedulable })) })),
    materials: res.materials.map(serializeMaterial), costing: { perUnit: res.costing.perUnit, total: res.costing.total, byCostGroup: res.costing.byCostGroup, bySection: res.costing.bySection, flags: res.costing.flags.slice(0, 200), erpStdCost: res.costing.erpStdCost } };
}

function planDetail(db, id) {
  const plan = db.get('SELECT p.*, sr.number sales_number, sr.customer, sr.delivery_date, sr.priority sr_priority, sr.order_ref FROM plans p LEFT JOIN sales_requests sr ON sr.id = p.sales_request_id WHERE p.id = ?', id);
  if (!plan) throw new HttpError(404, 'Plan not found');
  const ctx = loadContext(db);
  const orders = db.all('SELECT * FROM production_orders WHERE plan_id = ? ORDER BY level, id', id);
  const ops = db.all('SELECT * FROM po_operations WHERE plan_id = ? ORDER BY production_order_id, seq', id);
  const days = db.all('SELECT po_operation_id, date, planned_qty, is_baseline FROM po_schedule_days WHERE plan_id = ? ORDER BY date', id);
  const actuals = db.all('SELECT po_operation_id, date, SUM(actual_qty) actual, SUM(rejected_qty) rejected, SUM(rework_qty) rework FROM daily_reports WHERE plan_id = ? GROUP BY po_operation_id, date', id);
  const materials = db.all('SELECT * FROM material_requirements WHERE plan_id = ? ORDER BY ext_cost DESC', id);
  const issued = db.all("SELECT item_code, SUM(CASE WHEN type='ISSUE' THEN qty ELSE 0 END) issued, SUM(CASE WHEN type='RETURN' THEN qty ELSE 0 END) returned FROM inventory_movements WHERE plan_id = ? GROUP BY item_code", id);
  const issuedMap = new Map(issued.map((x) => [x.item_code, x]));
  const byOp = new Map(); for (const d of days) { const k = `${d.po_operation_id}|${d.is_baseline}`; if (!byOp.has(k)) byOp.set(k, []); byOp.get(k).push({ date: d.date, qty: d.planned_qty }); }
  const actByOp = new Map(); for (const a of actuals) { if (!actByOp.has(a.po_operation_id)) actByOp.set(a.po_operation_id, []); actByOp.get(a.po_operation_id).push(a); }
  const wc = new Map(ctx.workCentres.map((w) => [w.code, w]));
  const sections = Object.fromEntries(ctx.sections.map((s) => [s.code, s.name]));
  const opsOut = ops.map((o) => ({ ...o, resources: JSON.parse(o.resources || '[]'), machine_minutes: o.machine_minutes ? JSON.parse(o.machine_minutes) : null, wc_name: wc.get(o.work_centre_code)?.name, section_name: sections[o.section_code], days: byOp.get(`${o.id}|0`) || [], baselineDays: byOp.get(`${o.id}|1`) || [], actuals: actByOp.get(o.id) || [], remaining_qty: Math.max(0, o.required_qty - o.completed_qty), delay_days: o.baseline_finish && o.planned_finish ? ctx.calendar.workingDaysBetween(o.baseline_finish, o.planned_finish) : 0 }));
  const ordersOut = orders.map((o) => ({ ...o, parent_codes: JSON.parse(o.parent_codes || '[]'), child_codes: JSON.parse(o.child_codes || '[]'), class_codes: JSON.parse(o.class_codes || '[]'), ops: opsOut.filter((x) => x.production_order_id === o.id), remaining_qty: Math.max(0, o.net_qty - o.completed_qty), delay_days: o.baseline_finish && o.planned_finish ? ctx.calendar.workingDaysBetween(o.baseline_finish, o.planned_finish) : 0 }));
  const matOut = materials.map((m) => ({ ...m, used_by: JSON.parse(m.used_by || '[]'), issued_qty: issuedMap.get(m.item_code)?.issued || 0, returned_qty: issuedMap.get(m.item_code)?.returned || 0 }));
  const actualMaterialCost = matOut.reduce((a, m) => a + ((m.issued_qty - m.returned_qty) * (m.unit_cost_used || 0)), 0);
  return { ...plan, summary: JSON.parse(plan.summary || 'null'), options: JSON.parse(plan.options || 'null'), critical_path: JSON.parse(plan.critical_path || '[]'), bottleneck: JSON.parse(plan.bottleneck || 'null'), warnings: JSON.parse(plan.warnings || '[]'), orders: ordersOut, materials: matOut,
    delay_days: plan.baseline_finish && plan.expected_finish ? ctx.calendar.workingDaysBetween(plan.baseline_finish, plan.expected_finish) : 0, sections: ctx.sections, costSnapshot: { materialTotal: materials.reduce((a, m) => a + (m.ext_cost || 0), 0), actualMaterialCost }, workCentres: ctx.workCentres.map((w) => ({ code: w.code, name: w.name, section: w.section_code })) };
}
module.exports.planDetail = planDetail;
