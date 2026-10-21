/* production.js — section dashboards, daily production reporting, inventory. */
'use strict';
const { HttpError } = require('../http.js');
const { can } = require('../auth.js');
const { reschedulePlan, loadContext } = require('../engine/planner.js');
const { nowIso } = require('../db.js');
const { today } = require('../engine/calendar.js');

const need = (user, perm) => { if (!can(user, perm)) throw new HttpError(403, 'Not permitted for your role'); };
const CATEGORIES = ['Raw Materials', 'Cut Parts', 'Welded Parts', 'Powder-Coated Parts', 'Base Frames', 'Panels', 'Other Semi-Finished Components', 'Finished Goods'];

module.exports = function register(r, { db }) {
  r.get('/api/sections/:code/dashboard', ({ params, query }) => sectionDashboard(db, params.code === 'ALL' ? null : params.code, query));
  r.get('/api/operations/:id', ({ params }) => {
    const op = db.get(`SELECT op.*, po.number po_number, po.item_code, po.item_name, po.net_qty, po.plan_id, p.product_code, w.name wc_name FROM po_operations op JOIN production_orders po ON po.id = op.production_order_id JOIN plans p ON p.id = op.plan_id JOIN work_centres w ON w.code = op.work_centre_code WHERE op.id = ?`, params.id);
    if (!op) throw new HttpError(404, 'Operation not found');
    return { ...op, resources: JSON.parse(op.resources || '[]'), days: db.all('SELECT date, planned_qty, is_baseline FROM po_schedule_days WHERE po_operation_id = ? ORDER BY date', op.id), reports: db.all('SELECT * FROM daily_reports WHERE po_operation_id = ? ORDER BY date DESC, id DESC', op.id) };
  });
  r.get('/api/daily-reports', ({ query }) => {
    const where = []; const args = [];
    if (query.get('from')) { where.push('d.date >= ?'); args.push(query.get('from')); }
    if (query.get('to')) { where.push('d.date <= ?'); args.push(query.get('to')); }
    if (query.get('section')) { where.push('d.section_code = ?'); args.push(query.get('section')); }
    if (query.get('plan')) { where.push('d.plan_id = ?'); args.push(Number(query.get('plan'))); }
    return db.all(`SELECT d.*, po.number po_number, po.item_name, w.name wc_name, p.product_code FROM daily_reports d JOIN production_orders po ON po.id = d.production_order_id JOIN work_centres w ON w.code = d.work_centre_code JOIN plans p ON p.id = d.plan_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.date DESC, d.id DESC LIMIT 1000`, ...args);
  });
  r.post('/api/daily-reports', async ({ body, user }) => {
    need(user, 'production.report');
    const op = db.get('SELECT op.*, po.net_qty, po.status po_status, p.status plan_status FROM po_operations op JOIN production_orders po ON po.id = op.production_order_id JOIN plans p ON p.id = op.plan_id WHERE op.id = ?', body.po_operation_id);
    if (!op) throw new HttpError(404, 'Operation not found');
    if (!['APPROVED', 'IN_PROGRESS'].includes(op.plan_status)) throw new HttpError(400, 'Production can only be reported against an approved plan');
    if (user.role === 'SUPERVISOR' && user.sections.length && !user.sections.includes(op.section_code)) throw new HttpError(403, 'You can only report for your own section');
    const date = body.date || today(); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Bad date');
    const actual = Number(body.actual_qty || 0); const rejected = Number(body.rejected_qty || 0); const rework = Number(body.rework_qty || 0); const downtime = Number(body.downtime_min || 0);
    if ([actual, rejected, rework, downtime].some((v) => !(v >= 0))) throw new HttpError(400, 'Quantities must be zero or positive');
    const remaining = op.required_qty - op.completed_qty;
    if (actual > remaining + 1e-6) throw new HttpError(400, `Accepted quantity ${actual} exceeds remaining ${remaining.toFixed(2)} on this operation`);
    // input check: cannot exceed what the previous operation / child orders have completed
    const avail = availableForOp(db, op);
    if (avail != null && actual > avail - op.completed_qty + 1e-6) throw new HttpError(400, `Only ${(avail - op.completed_qty).toFixed(2)} units have been received from the previous operation/components`);
    const planned = db.get('SELECT SUM(planned_qty) q FROM po_schedule_days WHERE po_operation_id = ? AND date = ? AND is_baseline = 0', op.id, date)?.q || 0;
    const id = db.tx(() => {
      const rid = db.run('INSERT INTO daily_reports(date,po_operation_id,production_order_id,plan_id,section_code,work_centre_code,item_code,planned_qty,actual_qty,rejected_qty,rework_qty,downtime_min,delay_reason,remarks,user_id,username,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        date, op.id, op.production_order_id, op.plan_id, op.section_code, op.work_centre_code, body.item_code || null, planned, actual, rejected, rework, downtime, body.delay_reason || null, body.remarks || null, user.id, user.username, nowIso()).lastInsertRowid;
      const newCompleted = op.completed_qty + actual;
      db.run("UPDATE po_operations SET completed_qty = ?, rejected_qty = rejected_qty + ?, rework_qty = rework_qty + ?, status = CASE WHEN ? >= required_qty - 1e-6 THEN 'COMPLETED' ELSE 'IN_PROGRESS' END WHERE id = ?", newCompleted, rejected, rework, newCompleted, op.id);
      // the order's completed quantity = output of its last operation
      const last = db.get('SELECT id, completed_qty, required_qty FROM po_operations WHERE production_order_id = ? ORDER BY seq DESC LIMIT 1', op.production_order_id);
      const allDone = !db.get('SELECT 1 FROM po_operations WHERE production_order_id = ? AND completed_qty < required_qty - 1e-6', op.production_order_id);
      db.run("UPDATE production_orders SET completed_qty = ?, status = CASE WHEN ? THEN 'COMPLETED' ELSE 'IN_PROGRESS' END WHERE id = ?", last.completed_qty, allDone ? 1 : 0, op.production_order_id);
      if (last.id === op.id && actual > 0) {
        // semi-finished / finished output goes to stock as WIP receipt linked to the order
        const po = db.get('SELECT po.item_code, po.level, i.inventory_category FROM production_orders po LEFT JOIN items i ON i.code = po.item_code WHERE po.id = ?', op.production_order_id);
        db.run('INSERT INTO inventory_movements(ts,date,item_code,category,type,qty,production_order_id,plan_id,reference,remarks,user_id,username) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', nowIso(), date, po.item_code, po.level === 0 ? 'Finished Goods' : (po.inventory_category || 'Other Semi-Finished Components'), 'RECEIPT', actual, op.production_order_id, op.plan_id, `Daily report #${rid}`, 'Production output', user.id, user.username);
      }
      if (rejected > 0) { const po = db.get('SELECT po.item_code, i.inventory_category FROM production_orders po LEFT JOIN items i ON i.code = po.item_code WHERE po.id = ?', op.production_order_id); db.run('INSERT INTO inventory_movements(ts,date,item_code,category,type,qty,production_order_id,plan_id,reference,remarks,user_id,username) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', nowIso(), date, po.item_code, po.inventory_category || 'Other Semi-Finished Components', 'REJECT', rejected, op.production_order_id, op.plan_id, `Daily report #${rid}`, body.delay_reason || 'Rejected at ' + op.work_centre_code, user.id, user.username); }
      db.run("UPDATE plans SET status = 'IN_PROGRESS' WHERE id = ? AND status = 'APPROVED'", op.plan_id);
      db.run("UPDATE sales_requests SET status = 'IN_PROGRESS', updated_at = ? WHERE plan_id = ? AND status = 'APPROVED'", nowIso(), op.plan_id);
      db.audit(user, 'DAILY_REPORT', 'po_operation', op.id, { date, actual, rejected, rework, downtime, reason: body.delay_reason });
      return rid;
    });
    // recalculate the remaining schedule and expected finish from the next working day
    const ctx = loadContext(db);
    const plan = reschedulePlan(db, op.plan_id, { fromDate: ctx.calendar.nextWorking(addDaysIso(date, 1)) > today() ? ctx.calendar.nextWorking(addDaysIso(date, 1)) : today(), user });
    const rep = db.get('SELECT * FROM daily_reports WHERE id = ?', id);
    return { report: rep, achievementPct: planned > 0 ? (actual / planned) * 100 : null, plan: { id: plan.id, expected_finish: plan.expected_finish, baseline_finish: plan.baseline_finish, delay_days: ctx.calendar.workingDaysBetween(plan.baseline_finish, plan.expected_finish) } };
  });
  r.del('/api/daily-reports/:id', async ({ params, user }) => {
    need(user, 'plan.approve');
    const rep = db.get('SELECT * FROM daily_reports WHERE id = ?', params.id); if (!rep) throw new HttpError(404, 'Report not found');
    db.tx(() => {
      db.run('DELETE FROM daily_reports WHERE id = ?', rep.id);
      db.run('DELETE FROM inventory_movements WHERE reference = ?', `Daily report #${rep.id}`);
      db.run("UPDATE po_operations SET completed_qty = MAX(0, completed_qty - ?), rejected_qty = MAX(0, rejected_qty - ?), rework_qty = MAX(0, rework_qty - ?), status = CASE WHEN completed_qty - ? <= 1e-6 THEN 'RELEASED' ELSE 'IN_PROGRESS' END WHERE id = ?", rep.actual_qty, rep.rejected_qty, rep.rework_qty, rep.actual_qty, rep.po_operation_id);
      const last = db.get('SELECT completed_qty FROM po_operations WHERE production_order_id = ? ORDER BY seq DESC LIMIT 1', rep.production_order_id);
      db.run("UPDATE production_orders SET completed_qty = ?, status = CASE WHEN ? > 0 THEN 'IN_PROGRESS' ELSE 'RELEASED' END WHERE id = ?", last.completed_qty, last.completed_qty, rep.production_order_id);
      db.audit(user, 'DAILY_REPORT_DELETED', 'daily_report', rep.id, rep);
    });
    reschedulePlan(db, rep.plan_id, { fromDate: today(), user });
    return { ok: true };
  });

  // ---- inventory
  r.get('/api/inventory', ({ query }) => {
    const cat = query.get('category'); const q = (query.get('q') || '').trim();
    const rows = db.all(`SELECT m.item_code, COALESCE(i.name, po.item_name, m.item_code) name, COALESCE(i.unit,'PCS') unit, m.category,
        SUM(CASE WHEN m.type='OPENING' THEN m.qty ELSE 0 END) opening, SUM(CASE WHEN m.type='RECEIPT' THEN m.qty ELSE 0 END) receipts, SUM(CASE WHEN m.type='ISSUE' THEN m.qty ELSE 0 END) issues,
        SUM(CASE WHEN m.type='RETURN' THEN m.qty ELSE 0 END) returns, SUM(CASE WHEN m.type='REJECT' THEN m.qty ELSE 0 END) rejected, SUM(CASE WHEN m.type='ADJUST' THEN m.qty ELSE 0 END) adjustments,
        SUM(CASE WHEN m.type IN ('OPENING','RECEIPT','RETURN','ADJUST') THEN m.qty WHEN m.type = 'ISSUE' THEN -m.qty ELSE 0 END) available
      FROM inventory_movements m LEFT JOIN items i ON i.code = m.item_code LEFT JOIN production_orders po ON po.id = m.production_order_id
      ${cat || q ? 'WHERE ' : ''}${cat ? 'm.category = ?' : ''}${cat && q ? ' AND ' : ''}${q ? '(m.item_code LIKE ? OR i.name LIKE ?)' : ''}
      GROUP BY m.item_code, m.category ORDER BY m.category, m.item_code`, ...(cat ? [cat] : []), ...(q ? [`%${q}%`, `%${q}%`] : []));
    const wip = db.all(`SELECT po.item_code, po.item_name, SUM(op.completed_qty) in_process FROM production_orders po JOIN po_operations op ON op.production_order_id = po.id WHERE po.status IN ('RELEASED','IN_PROGRESS') AND op.seq < (SELECT MAX(seq) FROM po_operations WHERE production_order_id = po.id) GROUP BY po.item_code`);
    const byCat = {};
    for (const r2 of rows) { byCat[r2.category] = byCat[r2.category] || { category: r2.category, items: 0, available: 0, rejected: 0 }; byCat[r2.category].items++; byCat[r2.category].available += r2.available; byCat[r2.category].rejected += r2.rejected; }
    return { rows, wip, categories: CATEGORIES, summary: CATEGORIES.map((c) => byCat[c] || { category: c, items: 0, available: 0, rejected: 0 }) };
  });
  r.get('/api/inventory/movements', ({ query }) => {
    const where = []; const args = [];
    if (query.get('item')) { where.push('m.item_code = ?'); args.push(query.get('item')); }
    if (query.get('po')) { where.push('m.production_order_id = ?'); args.push(Number(query.get('po'))); }
    if (query.get('plan')) { where.push('m.plan_id = ?'); args.push(Number(query.get('plan'))); }
    return db.all(`SELECT m.*, po.number po_number FROM inventory_movements m LEFT JOIN production_orders po ON po.id = m.production_order_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT 1000`, ...args);
  });
  r.post('/api/inventory/movements', async ({ body, user }) => {
    need(user, 'inventory.write');
    const type = String(body.type || '').toUpperCase();
    if (!['OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'REJECT', 'ADJUST'].includes(type)) throw new HttpError(400, 'Movement type must be OPENING, RECEIPT, ISSUE, RETURN, REJECT or ADJUST');
    const qty = Number(body.qty); if (!(qty > 0) && type !== 'ADJUST') throw new HttpError(400, 'Quantity must be > 0');
    if (!body.item_code) throw new HttpError(400, 'Item code required');
    const item = db.get('SELECT * FROM items WHERE code = ?', body.item_code);
    const category = body.category || item?.inventory_category || 'Raw Materials';
    if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Unknown inventory category');
    let poId = body.production_order_id ? Number(body.production_order_id) : null; let planId = null;
    if (poId) { const po = db.get('SELECT id, plan_id FROM production_orders WHERE id = ?', poId); if (!po) throw new HttpError(404, 'Production order not found'); planId = po.plan_id; }
    if (type === 'ISSUE') {
      const bal = db.get("SELECT SUM(CASE WHEN type IN ('OPENING','RECEIPT','RETURN','ADJUST') THEN qty WHEN type = 'ISSUE' THEN -qty ELSE 0 END) b FROM inventory_movements WHERE item_code = ?", body.item_code)?.b || 0;
      if (qty > bal + 1e-6 && !body.allow_negative) throw new HttpError(400, `Only ${bal} available for ${body.item_code}`);
    }
    const id = db.run('INSERT INTO inventory_movements(ts,date,item_code,category,type,qty,production_order_id,plan_id,reference,remarks,user_id,username) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', nowIso(), body.date || today(), body.item_code, category, type, qty, poId, planId, body.reference || null, body.remarks || null, user.id, user.username).lastInsertRowid;
    db.audit(user, 'INVENTORY_MOVEMENT', 'inventory', id, { type, item: body.item_code, qty, po: poId });
    return db.get('SELECT * FROM inventory_movements WHERE id = ?', id);
  });
  r.get('/api/inventory/categories', () => CATEGORIES);
};

function availableForOp(db, op) {
  if (op.seq > 1) { const prev = db.get('SELECT completed_qty FROM po_operations WHERE production_order_id = ? AND seq = ?', op.production_order_id, op.seq - 1); return prev ? prev.completed_qty : null; }
  const po = db.get('SELECT child_codes, inventory_used FROM production_orders WHERE id = ?', op.production_order_id);
  const kids = JSON.parse(po.child_codes || '[]').filter((c) => c.poId);
  if (!kids.length) return null;
  let lim = Infinity;
  for (const k of kids) { const c = db.get('SELECT kind, completed_qty, net_qty, status FROM production_orders WHERE id = ?', k.poId); if (!c) continue; const made = c.kind !== 'MAKE' || c.status === 'COVERED' ? c.net_qty : c.completed_qty; lim = Math.min(lim, made / (k.perUnit || 1)); }
  return Number.isFinite(lim) ? lim + (po.inventory_used || 0) : null;
}

function sectionDashboard(db, sectionCode, query) {
  const ctx = loadContext(db);
  const from = query.get('from') || today(); const to = query.get('to') || addDaysIso(from, 30);
  const ops = db.all(`SELECT op.*, po.number po_number, po.item_code, po.item_name, po.net_qty, po.status po_status, po.family, po.level, p.product_code, p.status plan_status, p.expected_finish, sr.number sales_number, sr.customer, sr.delivery_date, sr.priority
      FROM po_operations op JOIN production_orders po ON po.id = op.production_order_id JOIN plans p ON p.id = op.plan_id LEFT JOIN sales_requests sr ON sr.id = p.sales_request_id
      WHERE p.status IN ('APPROVED','IN_PROGRESS') AND op.status NOT IN ('CANCELLED') ${sectionCode ? 'AND op.section_code = ?' : ''} ORDER BY op.planned_start, p.id, op.seq`, ...(sectionCode ? [sectionCode] : []));
  const ids = ops.map((o) => o.id);
  const days = ids.length ? db.all(`SELECT po_operation_id, date, planned_qty FROM po_schedule_days WHERE is_baseline = 0 AND po_operation_id IN (${ids.map(() => '?').join(',')}) ORDER BY date`, ...ids) : [];
  const acts = ids.length ? db.all(`SELECT po_operation_id, date, SUM(actual_qty) actual, SUM(rejected_qty) rejected, SUM(rework_qty) rework, SUM(downtime_min) downtime FROM daily_reports WHERE po_operation_id IN (${ids.map(() => '?').join(',')}) GROUP BY po_operation_id, date`, ...ids) : [];
  const dayMap = new Map(); for (const d of days) { if (!dayMap.has(d.po_operation_id)) dayMap.set(d.po_operation_id, []); dayMap.get(d.po_operation_id).push(d); }
  const actMap = new Map(); for (const a of acts) { if (!actMap.has(a.po_operation_id)) actMap.set(a.po_operation_id, []); actMap.get(a.po_operation_id).push(a); }
  const wcs = new Map(ctx.workCentres.map((w) => [w.code, w]));
  const out = ops.map((o) => {
    const prevDone = (() => { if (o.seq > 1) { const p = ops.find((x) => x.production_order_id === o.production_order_id && x.seq === o.seq - 1); return p ? p.completed_qty : null; } return null; })();
    const received = o.seq > 1 ? (prevDone ?? availableForOp(db, o)) : availableForOp(db, o);
    const todayPlan = (dayMap.get(o.id) || []).find((d) => d.date === today())?.planned_qty || 0;
    return { ...o, resources: JSON.parse(o.resources || '[]'), machine_minutes: o.machine_minutes ? JSON.parse(o.machine_minutes) : null, wc_name: wcs.get(o.work_centre_code)?.name, site: wcs.get(o.work_centre_code)?.site, days: dayMap.get(o.id) || [], actuals: actMap.get(o.id) || [], remaining_qty: Math.max(0, o.required_qty - o.completed_qty), received_qty: received, awaiting_qty: received == null ? null : Math.max(0, received - o.completed_qty), today_target: todayPlan, delay_days: o.baseline_finish && o.planned_finish ? ctx.calendar.workingDaysBetween(o.baseline_finish, o.planned_finish) : 0 };
  });
  // daily plan vs actual series for the section
  const series = {};
  for (const o of out) { for (const d of o.days) { series[d.date] = series[d.date] || { date: d.date, planned: 0, actual: 0, rejected: 0 }; series[d.date].planned += d.planned_qty; } for (const a of o.actuals) { series[a.date] = series[a.date] || { date: a.date, planned: 0, actual: 0, rejected: 0 }; series[a.date].actual += a.actual; series[a.date].rejected += a.rejected; } }
  const kpi = { operations: out.length, open: out.filter((o) => o.status !== 'COMPLETED').length, completed: out.filter((o) => o.status === 'COMPLETED').length, delayed: out.filter((o) => o.delay_days > 0).length, requiredQty: out.reduce((a, o) => a + o.required_qty, 0), completedQty: out.reduce((a, o) => a + o.completed_qty, 0), rejectedQty: out.reduce((a, o) => a + o.rejected_qty, 0), todayTarget: out.reduce((a, o) => a + o.today_target, 0), critical: out.filter((o) => o.on_critical_path).length };
  const section = sectionCode ? ctx.sections.find((s) => s.code === sectionCode) : { code: 'ALL', name: 'All sections' };
  const byWc = {};
  for (const o of out) { byWc[o.work_centre_code] = byWc[o.work_centre_code] || { code: o.work_centre_code, name: o.wc_name, site: o.site, required: 0, completed: 0, open: 0 }; byWc[o.work_centre_code].required += o.required_qty; byWc[o.work_centre_code].completed += o.completed_qty; if (o.status !== 'COMPLETED') byWc[o.work_centre_code].open++; }
  return { section, from, to, ops: out, series: Object.values(series).sort((a, b) => a.date.localeCompare(b.date)), kpi, workCentres: Object.values(byWc), sections: ctx.sections, delayReasons: db.setting('delay_reasons', ['Material shortage', 'Machine breakdown', 'Power failure', 'Manpower shortage', 'Quality rework', 'Waiting for previous section', 'Other']) };
}
function addDaysIso(s, n) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
module.exports.CATEGORIES = CATEGORIES;
