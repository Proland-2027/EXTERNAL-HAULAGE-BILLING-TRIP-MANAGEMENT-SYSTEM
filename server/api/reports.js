/* reports.js — management dashboard KPIs, monthly reports, CSV exports. */
'use strict';
const { HttpError, csv } = require('../http.js');
const { loadContext } = require('../engine/planner.js');
const { today } = require('../engine/calendar.js');

module.exports = function register(r, { db }) {
  r.get('/api/dashboard', ({ query }) => dashboard(db, query));
  r.get('/api/export/:name', ({ params, query, user }) => {
    const name = params.name.replace(/\.csv$/, '');
    let rows; let cols;
    switch (name) {
      case 'plans': rows = db.all('SELECT p.id, sr.number sales_number, sr.customer, p.product_code, p.qty, p.status, p.start_date, p.baseline_finish, p.expected_finish, p.approved_by, p.approved_at FROM plans p LEFT JOIN sales_requests sr ON sr.id = p.sales_request_id ORDER BY p.id DESC'); break;
      case 'production-orders': rows = db.all('SELECT po.number, po.plan_id, po.product_code, po.item_code, po.item_name, po.family, po.level, po.kind, po.required_qty, po.inventory_used, po.net_qty, po.completed_qty, po.status, po.planned_start, po.planned_finish, po.baseline_finish FROM production_orders po ORDER BY po.id DESC'); break;
      case 'operations': rows = db.all('SELECT po.number po_number, po.item_code, op.seq, op.section_code, op.work_centre_code, op.process, op.rate_per_day, op.rate_source, op.required_qty, op.completed_qty, op.rejected_qty, op.rework_qty, op.planned_start, op.planned_finish, op.baseline_start, op.baseline_finish, op.status, op.on_critical_path FROM po_operations op JOIN production_orders po ON po.id = op.production_order_id ORDER BY op.plan_id DESC, po.id, op.seq'); break;
      case 'daily-reports': rows = db.all('SELECT d.date, po.number po_number, po.item_code, d.section_code, d.work_centre_code, d.planned_qty, d.actual_qty, d.rejected_qty, d.rework_qty, d.downtime_min, d.delay_reason, d.remarks, d.username FROM daily_reports d JOIN production_orders po ON po.id = d.production_order_id ORDER BY d.date DESC, d.id DESC'); break;
      case 'materials': { const pid = Number(query.get('plan')); if (!pid) throw new HttpError(400, 'plan required'); rows = db.all('SELECT item_code, name, unit, cost_group, warehouse, qty_per_unit, total_qty, inventory_available, net_qty, std_unit_cost, current_unit_cost, unit_cost_used, ext_cost, cost_flags FROM material_requirements WHERE plan_id = ? ORDER BY ext_cost DESC', pid); break; }
      case 'inventory': rows = db.all("SELECT m.item_code, i.name, m.category, SUM(CASE WHEN m.type IN ('OPENING','RECEIPT','RETURN','ADJUST') THEN m.qty WHEN m.type = 'ISSUE' THEN -m.qty ELSE 0 END) available FROM inventory_movements m LEFT JOIN items i ON i.code = m.item_code GROUP BY m.item_code, m.category ORDER BY m.category, m.item_code"); break;
      case 'bom': { const code = query.get('product'); if (!code) throw new HttpError(400, 'product required'); rows = db.all('SELECT line_no, level, parent_code, item_code, name, calc_type, consumption, unit, cost_per_lot, lot_size, cost_per_unit, cost_group, operation, unit_cost, total_cost, warehouse, type1 FROM bom_lines WHERE product_code = ? ORDER BY line_no', code); break; }
      case 'items': rows = db.all('SELECT code, name, kind, unit, cost_group, std_unit_cost, current_unit_cost, approved_unit_cost, approved_by, approved_at, cost_flags, inventory_category, supplier_lead_days, used_in FROM items ORDER BY kind, code'); break;
      case 'exceptions': rows = db.all('SELECT id, type, severity, entity, message, status, reviewed_by, reviewed_at, review_note FROM import_exceptions ORDER BY id'); break;
      case 'audit': rows = db.all('SELECT ts, username, action, entity, entity_id, details FROM audit_log ORDER BY id DESC LIMIT 5000'); break;
      case 'dashboard': { const d = dashboard(db, query); rows = d.monthly; break; }
      default: throw new HttpError(404, 'Unknown export');
    }
    return { raw: csv(rows, cols), contentType: 'text/csv; charset=utf-8', filename: `${name}-${today()}.csv` };
  });
};

function monthKey(d) { return d.slice(0, 7); }
function weekKey(d) { const dt = new Date(d + 'T00:00:00Z'); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day); return dt.toISOString().slice(0, 10); }

function dashboard(db, query) {
  const ctx = loadContext(db);
  const to = query.get('to') || today();
  const from = query.get('from') || (to.slice(0, 7) + '-01');
  const product = query.get('product') || null; const section = query.get('section') || null; const planId = query.get('plan') ? Number(query.get('plan')) : null;
  const pw = []; const pa = [];
  if (product) { pw.push('p.product_code = ?'); pa.push(product); }
  if (planId) { pw.push('p.id = ?'); pa.push(planId); }
  const planFilter = pw.length ? 'AND ' + pw.join(' AND ') : '';
  // finished products: planned = root operations' schedule days in range; actual = root order outputs (last op) by report date
  const plannedFg = db.all(`SELECT d.date, SUM(d.planned_qty) qty FROM po_schedule_days d JOIN po_operations op ON op.id = d.po_operation_id JOIN production_orders po ON po.id = op.production_order_id JOIN plans p ON p.id = d.plan_id
      WHERE d.is_baseline = 0 AND po.level = 0 AND op.seq = (SELECT MAX(seq) FROM po_operations WHERE production_order_id = po.id) AND p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND d.date BETWEEN ? AND ? ${planFilter} GROUP BY d.date`, from, to, ...pa);
  const actualFg = db.all(`SELECT r.date, SUM(r.actual_qty) qty FROM daily_reports r JOIN po_operations op ON op.id = r.po_operation_id JOIN production_orders po ON po.id = op.production_order_id JOIN plans p ON p.id = r.plan_id
      WHERE po.level = 0 AND op.seq = (SELECT MAX(seq) FROM po_operations WHERE production_order_id = po.id) AND r.date BETWEEN ? AND ? ${planFilter} GROUP BY r.date`, from, to, ...pa);
  const sw = section ? 'AND op.section_code = ?' : ''; const sa = section ? [section] : [];
  const plannedOps = db.all(`SELECT d.date, op.section_code, SUM(d.planned_qty) qty FROM po_schedule_days d JOIN po_operations op ON op.id = d.po_operation_id JOIN plans p ON p.id = d.plan_id WHERE d.is_baseline = 0 AND p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND d.date BETWEEN ? AND ? ${planFilter} ${sw} GROUP BY d.date, op.section_code`, from, to, ...pa, ...sa);
  const actualOps = db.all(`SELECT r.date, op.section_code, SUM(r.actual_qty) qty, SUM(r.rejected_qty) rejected, SUM(r.rework_qty) rework, SUM(r.downtime_min) downtime, SUM(r.planned_qty) planned_at_report FROM daily_reports r JOIN po_operations op ON op.id = r.po_operation_id JOIN plans p ON p.id = r.plan_id WHERE r.date BETWEEN ? AND ? ${planFilter} ${sw} GROUP BY r.date, op.section_code`, from, to, ...pa, ...sa);
  const wo = db.get(`SELECT COUNT(*) total, SUM(CASE WHEN po.status='COMPLETED' THEN 1 ELSE 0 END) completed, SUM(CASE WHEN po.status NOT IN ('COMPLETED','CANCELLED','COVERED') AND po.planned_finish > po.baseline_finish THEN 1 ELSE 0 END) delayed, SUM(CASE WHEN po.status IN ('RELEASED','IN_PROGRESS') THEN 1 ELSE 0 END) open
      FROM production_orders po JOIN plans p ON p.id = po.plan_id WHERE p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND po.kind = 'MAKE' AND (po.planned_start <= ? AND COALESCE(po.planned_finish, ?) >= ?) ${planFilter}`, to, from, from, ...pa);
  const leadTimes = db.all(`SELECT p.id, p.start_date, p.expected_finish, p.baseline_finish, p.status, p.product_code, p.qty FROM plans p WHERE p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND p.expected_finish BETWEEN ? AND ? ${planFilter}`, from, to, ...pa);
  const avgLead = leadTimes.length ? leadTimes.reduce((a, p) => a + (ctx.calendar.workingDaysBetween(p.start_date, p.expected_finish) + 1), 0) / leadTimes.length : null;
  const wip = db.all(`SELECT po.item_code, po.item_name, po.family, SUM(op.completed_qty) qty FROM production_orders po JOIN po_operations op ON op.production_order_id = po.id JOIN plans p ON p.id = po.plan_id WHERE po.status IN ('RELEASED','IN_PROGRESS') ${planFilter} GROUP BY po.item_code`, ...pa);
  // section productivity = actual / planned at report time
  const sections = ctx.sections.map((s) => { const a = actualOps.filter((x) => x.section_code === s.code); const pl = plannedOps.filter((x) => x.section_code === s.code); const actual = a.reduce((x, y) => x + y.qty, 0); const plannedAtReport = a.reduce((x, y) => x + (y.planned_at_report || 0), 0); const planned = pl.reduce((x, y) => x + y.qty, 0); return { code: s.code, name: s.name, planned, actual, rejected: a.reduce((x, y) => x + y.rejected, 0), rework: a.reduce((x, y) => x + y.rework, 0), downtime: a.reduce((x, y) => x + y.downtime, 0), achievementPct: plannedAtReport > 0 ? (actual / plannedAtReport) * 100 : (planned > 0 ? (actual / planned) * 100 : null) }; });
  // costing KPIs
  const plansInRange = db.all(`SELECT p.id, p.product_code, p.qty, p.summary FROM plans p WHERE p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND p.start_date <= ? AND COALESCE(p.expected_finish, p.start_date) >= ? ${planFilter}`, to, from, ...pa);
  const pids = plansInRange.map((p) => p.id);
  const plannedCost = pids.length ? db.get(`SELECT SUM(ext_cost) c FROM material_requirements WHERE plan_id IN (${pids.map(() => '?').join(',')})`, ...pids)?.c || 0 : 0;
  const plannedUnits = plansInRange.reduce((a, p) => a + p.qty, 0);
  const issued = pids.length ? db.all(`SELECT m.plan_id, m.item_code, SUM(CASE WHEN m.type='ISSUE' THEN m.qty WHEN m.type='RETURN' THEN -m.qty ELSE 0 END) qty FROM inventory_movements m WHERE m.plan_id IN (${pids.map(() => '?').join(',')}) AND m.type IN ('ISSUE','RETURN') AND m.date BETWEEN ? AND ? GROUP BY m.plan_id, m.item_code`, ...pids, from, to) : [];
  let actualCost = 0;
  for (const i of issued) { const mr = db.get('SELECT unit_cost_used FROM material_requirements WHERE plan_id = ? AND item_code = ?', i.plan_id, i.item_code); const it = mr?.unit_cost_used ?? db.get('SELECT COALESCE(approved_unit_cost, current_unit_cost, std_unit_cost) c FROM items WHERE code = ?', i.item_code)?.c ?? 0; actualCost += i.qty * it; }
  const costByModel = plansInRange.map((p) => { const s = JSON.parse(p.summary || '{}'); return { product: p.product_code, qty: p.qty, materialCostTotal: s.materialCostTotal || 0, materialCostPerUnit: s.materialCostPerUnit || 0, fullCostPerUnit: s.fullCostPerUnit || 0 }; });
  const byModel = Object.values(costByModel.reduce((acc, x) => { const a = acc[x.product] || { product: x.product, qty: 0, materialCostTotal: 0 }; a.qty += x.qty; a.materialCostTotal += x.materialCostTotal; a.materialCostPerUnit = a.materialCostTotal / a.qty; acc[x.product] = a; return acc; }, {}));
  // series: daily / weekly / monthly
  const daily = {};
  for (const x of plannedFg) { daily[x.date] = daily[x.date] || { date: x.date, plannedFg: 0, actualFg: 0, plannedOps: 0, actualOps: 0 }; daily[x.date].plannedFg += x.qty; }
  for (const x of actualFg) { daily[x.date] = daily[x.date] || { date: x.date, plannedFg: 0, actualFg: 0, plannedOps: 0, actualOps: 0 }; daily[x.date].actualFg += x.qty; }
  for (const x of plannedOps) { daily[x.date] = daily[x.date] || { date: x.date, plannedFg: 0, actualFg: 0, plannedOps: 0, actualOps: 0 }; daily[x.date].plannedOps += x.qty; }
  for (const x of actualOps) { daily[x.date] = daily[x.date] || { date: x.date, plannedFg: 0, actualFg: 0, plannedOps: 0, actualOps: 0 }; daily[x.date].actualOps += x.qty; }
  const dailyArr = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));
  const roll = (keyFn) => { const m = {}; for (const d of dailyArr) { const k = keyFn(d.date); m[k] = m[k] || { period: k, plannedFg: 0, actualFg: 0, plannedOps: 0, actualOps: 0 }; for (const f of ['plannedFg', 'actualFg', 'plannedOps', 'actualOps']) m[k][f] += d[f]; } return Object.values(m); };
  const delayedPlans = db.all(`SELECT p.id, p.product_code, p.qty, p.baseline_finish, p.expected_finish, p.status, sr.number sales_number, sr.customer, sr.delivery_date FROM plans p LEFT JOIN sales_requests sr ON sr.id = p.sales_request_id WHERE p.status IN ('APPROVED','IN_PROGRESS') AND (p.expected_finish > p.baseline_finish OR (sr.delivery_date IS NOT NULL AND p.expected_finish > sr.delivery_date)) ${planFilter} ORDER BY p.expected_finish`, ...pa).map((p) => ({ ...p, delay_days: ctx.calendar.workingDaysBetween(p.baseline_finish, p.expected_finish) }));
  const totalPlannedFg = plannedFg.reduce((a, x) => a + x.qty, 0); const totalActualFg = actualFg.reduce((a, x) => a + x.qty, 0);
  return { from, to, filters: { product, section, plan: planId },
    kpi: { plannedFg: totalPlannedFg, actualFg: totalActualFg, achievementPct: totalPlannedFg > 0 ? (totalActualFg / totalPlannedFg) * 100 : null, workOrders: wo?.total || 0, workOrdersCompleted: wo?.completed || 0, workOrdersDelayed: wo?.delayed || 0, workOrdersOpen: wo?.open || 0, avgLeadTimeDays: avgLead, wipUnits: wip.reduce((a, x) => a + x.qty, 0),
      plannedBomCost: plannedCost, bomCostPerUnit: plannedUnits ? plannedCost / plannedUnits : null, actualMaterialCost: actualCost, materialVariance: actualCost - plannedCost, plannedUnits },
    sections, wip, byModel, daily: dailyArr, weekly: roll(weekKey), monthly: roll(monthKey), delayedPlans, plans: plansInRange.map((p) => ({ id: p.id, product: p.product_code, qty: p.qty })), currency: db.setting('currency', 'NGN') };
}
module.exports.dashboard = dashboard;
