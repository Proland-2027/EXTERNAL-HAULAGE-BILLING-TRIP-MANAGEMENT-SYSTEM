/* masters.js — products, BOM browsing, work centres, productivity, cutting capacity, calendar, settings, exceptions, items. */
'use strict';
const { HttpError } = require('../http.js');
const { can } = require('../auth.js');
const { buildTree, explode, costProduct } = require('../engine/bom.js');
const { loadContext, productTree, unitCostChooser } = require('../engine/planner.js');
const { nowIso } = require('../db.js');

const need = (user, perm) => { if (!can(user, perm)) throw new HttpError(403, 'Not permitted for your role'); };

module.exports = function register(r, { db }) {
  r.get('/api/products', ({ query }) => {
    const all = query.get('all') === '1';
    const rows = db.all(`SELECT * FROM products WHERE active = 1 ${all ? '' : 'AND in_finished_list = 1'} ORDER BY in_finished_list DESC, family, pnum, code`);
    return rows;
  });
  r.get('/api/products/:code/bom', ({ params, query }) => {
    const product = db.get('SELECT * FROM products WHERE code = ?', params.code);
    if (!product) throw new HttpError(404, 'Product not found');
    const ctx = loadContext(db);
    const tree = productTree(db, params.code);
    const qty = Number(query.get('qty') || 1);
    const ex = explode(tree, qty, { opMap: ctx.opMap });
    const lines = db.all('SELECT line_no, level, parent_code, item_code, name, calc_type, consumption, unit, cost_per_lot, lot_size, cost_per_unit, cost_group, operation, unit_cost, total_cost, warehouse, type1, is_status_item FROM bom_lines WHERE product_code = ? ORDER BY line_no', params.code);
    return { product, lines, orders: ex.orders.map(serializeOrder), materials: ex.materials.map(serializeMaterial), unmapped: ex.unmapped, sections: ctx.sections, workCentres: ctx.workCentres.map((w) => ({ code: w.code, name: w.name, section: w.section_code, site: w.site })) };
  });
  r.get('/api/sections', () => db.all('SELECT * FROM sections ORDER BY seq'));
  r.get('/api/work-centres', () => {
    const wcs = db.all('SELECT w.*, s.name section_name FROM work_centres w JOIN sections s ON s.code = w.section_code ORDER BY s.seq, w.site, w.name');
    const prod = db.all('SELECT * FROM productivity ORDER BY work_centre_code, source_row');
    const machines = db.all('SELECT * FROM machines');
    const byWc = new Map();
    for (const p of prod) { if (!byWc.has(p.work_centre_code)) byWc.set(p.work_centre_code, []); byWc.get(p.work_centre_code).push({ ...p, week_plan: undefined }); }
    return wcs.map((w) => ({ ...w, productivity: byWc.get(w.code) || [], machines: machines.filter((m) => m.work_centre_code === w.code) }));
  });
  r.put('/api/work-centres/:code', async ({ params, body, user }) => {
    need(user, 'masters.write');
    const wc = db.get('SELECT * FROM work_centres WHERE code = ?', params.code); if (!wc) throw new HttpError(404, 'Work centre not found');
    const cf = body.capacity_factor != null ? Number(body.capacity_factor) : wc.capacity_factor;
    if (!(cf >= 0 && cf <= 10)) throw new HttpError(400, 'Capacity factor must be between 0 and 10');
    db.run('UPDATE work_centres SET capacity_factor = ?, labour_rate_per_hour = ?, overhead_rate_per_hour = ?, notes = ?, active = ? WHERE code = ?', cf, body.labour_rate_per_hour ?? wc.labour_rate_per_hour, body.overhead_rate_per_hour ?? wc.overhead_rate_per_hour, body.notes ?? wc.notes, body.active != null ? (body.active ? 1 : 0) : wc.active, params.code);
    db.audit(user, 'WORK_CENTRE_UPDATED', 'work_centre', params.code, body);
    return db.get('SELECT * FROM work_centres WHERE code = ?', params.code);
  });
  r.put('/api/productivity/:id', async ({ params, body, user }) => {
    need(user, 'masters.write');
    const row = db.get('SELECT * FROM productivity WHERE id = ?', params.id); if (!row) throw new HttpError(404, 'Row not found');
    const ov = body.override_rate == null || body.override_rate === '' ? null : Number(body.override_rate);
    if (ov != null && !(ov >= 0)) throw new HttpError(400, 'Rate must be >= 0');
    db.run('UPDATE productivity SET override_rate = ?, active = ? WHERE id = ?', ov, body.active != null ? (body.active ? 1 : 0) : row.active, params.id);
    db.audit(user, 'PRODUCTIVITY_UPDATED', 'productivity', params.id, { from: row.override_rate, to: ov, typeCode: row.type_code, wc: row.work_centre_code });
    return db.get('SELECT * FROM productivity WHERE id = ?', params.id);
  });
  r.put('/api/machines/:code', async ({ params, body, user }) => {
    need(user, 'masters.write');
    const m = db.get('SELECT * FROM machines WHERE code = ?', params.code); if (!m) throw new HttpError(404, 'Machine not found');
    db.run('UPDATE machines SET minutes_per_day = ?, count = ?, active = ? WHERE code = ?', Number(body.minutes_per_day ?? m.minutes_per_day), Number(body.count ?? m.count), body.active != null ? (body.active ? 1 : 0) : m.active, params.code);
    db.audit(user, 'MACHINE_UPDATED', 'machine', params.code, body);
    return db.get('SELECT * FROM machines WHERE code = ?', params.code);
  });
  r.get('/api/cutting', () => {
    const summary = db.all('SELECT * FROM cutting_summary ORDER BY source_row, machine');
    const files = db.all('SELECT * FROM cutting_files ORDER BY class_code, machine, source_row');
    const classes = [...new Set(summary.map((s) => s.class_code))];
    const rows = classes.map((c) => {
      const s = summary.filter((x) => x.class_code === c);
      const f = files.filter((x) => x.class_code === c);
      const perMachine = {};
      for (const m of ['Punch 1', 'Punch 2', 'Plasma']) {
        const sm = s.find((x) => x.machine === m); const fm = f.filter((x) => x.machine === m);
        perMachine[m] = { summaryMinutes: sm?.minutes_per_canopy ?? null, detailMinutes: fm.length ? fm.reduce((a, x) => a + (x.minutes || 0), 0) : null, perShiftCalc: sm?.per_shift_calc ?? null, pctConsumed: sm?.pct_consumed ?? null, files: fm };
      }
      const limits = Object.values(perMachine).map((x) => x.perShiftCalc).filter((v) => v != null);
      return { classCode: c, recordedPerShift: s[0]?.qty_per_shift_recorded ?? null, timePerCanopy: s[0]?.time_per_canopy ?? null, machineLimit: limits.length ? Math.min(...limits) : null, bottleneck: Object.entries(perMachine).sort((a, b) => (a[1].perShiftCalc ?? 1e9) - (b[1].perShiftCalc ?? 1e9))[0]?.[0], perMachine };
    });
    return { rows, machines: db.all('SELECT * FROM machines') };
  });
  r.get('/api/calendar', ({ query }) => {
    const from = query.get('from') || nowIso().slice(0, 7) + '-01';
    const to = query.get('to') || '2099-12-31';
    return { overrides: db.all('SELECT * FROM calendar WHERE date BETWEEN ? AND ? ORDER BY date', from, to), workingWeekdays: db.setting('working_weekdays', [1, 2, 3, 4, 5]), minutesPerDay: db.setting('minutes_per_day', 480) };
  });
  r.put('/api/calendar/:date', async ({ params, body, user }) => {
    need(user, 'masters.write');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) throw new HttpError(400, 'Bad date');
    if (body.remove) db.run('DELETE FROM calendar WHERE date = ?', params.date);
    else db.run('INSERT INTO calendar(date,working,minutes,note) VALUES(?,?,?,?) ON CONFLICT(date) DO UPDATE SET working=excluded.working, minutes=excluded.minutes, note=excluded.note', params.date, body.working ? 1 : 0, Number(body.minutes || 480), body.note || null);
    db.audit(user, 'CALENDAR_UPDATED', 'calendar', params.date, body);
    return { ok: true };
  });
  r.get('/api/settings', () => {
    const rows = db.all('SELECT key, value, updated_at, updated_by FROM settings');
    const out = Object.fromEntries(rows.map((x) => [x.key, JSON.parse(x.value)]));
    return { ...DEFAULT_SETTINGS, ...out };
  });
  r.put('/api/settings', async ({ body, user }) => {
    need(user, 'masters.write');
    const costKeys = ['cost_policy', 'cost_drift_pct', 'labour_rate_per_hour', 'overhead_rate_per_hour', 'currency'];
    for (const [k, v] of Object.entries(body)) {
      if (!(k in DEFAULT_SETTINGS)) throw new HttpError(400, `Unknown setting ${k}`);
      if (costKeys.includes(k) && !can(user, 'cost.write') && !can(user, 'admin')) throw new HttpError(403, `${k} can only be changed by the Cost Accountant or an Administrator`);
      db.setSetting(k, v, user.username);
    }
    db.audit(user, 'SETTINGS_UPDATED', 'settings', null, body);
    return { ok: true };
  });
  r.get('/api/exceptions', ({ query }) => {
    const status = query.get('status') || 'OPEN';
    const type = query.get('type');
    const rows = db.all(`SELECT * FROM import_exceptions WHERE (? = 'ALL' OR status = ?) ${type ? 'AND type = ?' : ''} ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, type, id LIMIT 2000`, ...(type ? [status, status, type] : [status, status]));
    const summary = db.all('SELECT type, severity, status, COUNT(*) n FROM import_exceptions GROUP BY type, severity, status ORDER BY 2, 1');
    return { rows, summary, lastImport: JSON.parse(db.get("SELECT value FROM meta WHERE key='last_import'")?.value || 'null') };
  });
  r.put('/api/exceptions/:id', async ({ params, body, user }) => {
    need(user, 'exceptions.review');
    const st = ['OPEN', 'REVIEWED', 'ACCEPTED', 'FIXED'].includes(body.status) ? body.status : 'REVIEWED';
    db.run('UPDATE import_exceptions SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?', st, user.username, nowIso(), body.note || null, params.id);
    db.audit(user, 'EXCEPTION_REVIEWED', 'import_exception', params.id, { status: st, note: body.note });
    return db.get('SELECT * FROM import_exceptions WHERE id = ?', params.id);
  });
  r.get('/api/items', ({ query }) => {
    const q = (query.get('q') || '').trim(); const kind = query.get('kind'); const flag = query.get('flag'); const limit = Math.min(Number(query.get('limit') || 500), 5000);
    const where = []; const args = [];
    if (q) { where.push('(code LIKE ? OR name LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    if (kind) { where.push('kind = ?'); args.push(kind); }
    if (flag) { where.push('cost_flags LIKE ?'); args.push(`%${flag}%`); }
    return db.all(`SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY kind, code LIMIT ${limit}`, ...args);
  });
  r.put('/api/items/:code', async ({ params, body, user }) => {
    const it = db.get('SELECT * FROM items WHERE code = ?', params.code); if (!it) throw new HttpError(404, 'Item not found');
    if (body.approved_unit_cost !== undefined) {
      need(user, 'cost.write');
      const v = body.approved_unit_cost === null || body.approved_unit_cost === '' ? null : Number(body.approved_unit_cost);
      if (v != null && !(v >= 0)) throw new HttpError(400, 'Cost must be >= 0');
      db.run('UPDATE items SET approved_unit_cost = ?, approved_at = ?, approved_by = ? WHERE code = ?', v, nowIso(), user.username, params.code);
      if (v != null) db.run('INSERT INTO item_cost_history(item_code,unit_cost,effective_from,approved_by,note,created_at) VALUES(?,?,?,?,?,?)', params.code, v, body.effective_from || nowIso().slice(0, 10), user.username, body.note || null, nowIso());
      db.audit(user, 'ITEM_COST_APPROVED', 'item', params.code, { from: it.approved_unit_cost, to: v, note: body.note });
    }
    if (body.inventory_category !== undefined || body.supplier_lead_days !== undefined) {
      need(user, 'masters.write');
      db.run('UPDATE items SET inventory_category = ?, supplier_lead_days = ? WHERE code = ?', body.inventory_category ?? it.inventory_category, Number(body.supplier_lead_days ?? it.supplier_lead_days), params.code);
      db.audit(user, 'ITEM_UPDATED', 'item', params.code, body);
    }
    return db.get('SELECT * FROM items WHERE code = ?', params.code);
  });
  r.get('/api/items/:code/history', ({ params }) => db.all('SELECT * FROM item_cost_history WHERE item_code = ? ORDER BY id DESC', params.code));
  r.get('/api/items/:code/where-used', ({ params }) => db.all('SELECT product_code, COUNT(*) n, SUM(consumption) qty FROM bom_lines WHERE item_code = ? GROUP BY product_code ORDER BY product_code', params.code));

  // costing screen
  r.get('/api/costing/:code', ({ params, query }) => {
    const product = db.get('SELECT * FROM products WHERE code = ?', params.code); if (!product) throw new HttpError(404, 'Product not found');
    const qty = Math.max(Number(query.get('qty') || 1), 0.0001);
    const ctx = loadContext(db);
    if (query.get('policy')) ctx.settings.costPolicy = query.get('policy');
    const tree = productTree(db, params.code);
    const wcRates = new Map(ctx.workCentres.map((w) => [w.code, w]));
    const labourDefault = db.setting('labour_rate_per_hour', null); const ovhDefault = db.setting('overhead_rate_per_hour', null);
    const costing = costProduct(tree, qty, { unitCostFor: unitCostChooser(db, ctx), opMap: ctx.opMap, sectionOf: (wc) => wcRates.get(wc)?.section_code || null,
      labourRateOverride: (wc) => wcRates.get(wc)?.labour_rate_per_hour ?? (labourDefault || null) ?? undefined, overheadRateOverride: (wc) => wcRates.get(wc)?.overhead_rate_per_hour ?? (ovhDefault || null) ?? undefined });
    // component-level aggregation
    const comp = new Map();
    for (const row of costing.rows) {
      if (row.kind !== 'MATERIAL') continue;
      const c = comp.get(row.itemCode) || { itemCode: row.itemCode, name: row.name, unit: row.unit, costGroup: row.costGroup, qtyPerUnit: 0, qtyTotal: 0, unitCost: row.unitCost, stdUnitCost: row.stdUnitCost, currentUnitCost: row.currentUnitCost, costSource: row.costSource, extPerUnit: 0, extTotal: 0, flags: row.flags, usedBy: new Set() };
      c.qtyPerUnit += row.qtyPerUnit; c.qtyTotal += row.qtyTotal; c.extPerUnit += row.extPerUnit; c.extTotal += row.extTotal; c.usedBy.add(row.subAssembly); comp.set(row.itemCode, c);
    }
    const components = [...comp.values()].map((c) => ({ ...c, usedBy: [...c.usedBy] })).sort((a, b) => b.extPerUnit - a.extPerUnit);
    const sectionNames = Object.fromEntries(ctx.sections.map((s) => [s.code, s.name]));
    return { product, qty, policy: ctx.settings.costPolicy, components, bySubAssembly: costing.bySubAssembly.map((s) => ({ ...s, name: costing.rows.find((x) => x.subAssembly === s.code)?.subAssemblyName })), byCostGroup: costing.byCostGroup, bySection: costing.bySection.map((s) => ({ ...s, name: sectionNames[s.section] })), perUnit: costing.perUnit, total: costing.total, erpStdCost: costing.erpStdCost, flags: dedupeFlags(costing.flags), conversionRows: costing.rows.filter((x) => x.kind !== 'MATERIAL'), rates: { labourDefault, ovhDefault } };
  });
};

const DEFAULT_SETTINGS = { company: 'Proland Manufacturing', currency: 'NGN', triplog_url: '', working_weekdays: [1, 2, 3, 4, 5], minutes_per_day: 480, shift_start: '08:00', shift_end: '17:00', break_minutes: 60, transfer_batch: 1, transfer_lag_days: 1, use_machine_capacity: true, cost_policy: 'approved', cost_drift_pct: 10, fallback_staff: 1, rate_policy: 'master', labour_rate_per_hour: null, overhead_rate_per_hour: null, backup_hour: 2, backup_keep: 14 };

function dedupeFlags(flags) { const seen = new Map(); for (const f of flags) { const k = `${f.item}|${f.flag}`; if (!seen.has(k)) seen.set(k, f); } return [...seen.values()]; }
function serializeOrder(o) { return { code: o.code, name: o.name, family: o.family, level: o.level, kind: o.kind, type1: o.type1, warehouse: o.warehouse, qtyPerProduct: o.qtyPerProduct, requiredQty: o.requiredQty, netQty: o.netQty ?? o.requiredQty, inventoryUsed: o.inventoryUsed || 0, occurrences: o.occurrences, parents: [...o.parents].map(([c, q]) => ({ code: c, perParent: q })), children: [...o.children].map(([c, q]) => ({ code: c, perUnit: q })), ops: o.ops.map((op) => ({ ...op, processes: undefined, days: undefined })), plannedStart: o.plannedStart || null, plannedFinish: o.plannedFinish || null, leadDays: o.leadDays || 0, unit: o.unit }; }
function serializeMaterial(m) { return { code: m.code, name: m.name, unit: m.unit, costGroup: m.costGroup, warehouse: m.warehouse, qtyPerProduct: m.qtyPerProduct, totalQty: m.totalQty, stdUnitCost: m.stdUnitCost, currentUnitCost: m.currentUnitCost, usedBy: [...m.usedBy].map(([c, q]) => ({ code: c, qty: q })), inventoryAvailable: m.inventoryAvailable || 0, netQty: m.netQty ?? m.totalQty }; }
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
module.exports.serializeOrder = serializeOrder;
module.exports.serializeMaterial = serializeMaterial;
