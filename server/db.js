/*
 * db.js — SQLite persistence (node:sqlite, bundled with Node 22+). Schema, migrations, helpers, backups.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT, updated_by TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT, name TEXT, email TEXT,
  role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, section_codes TEXT, created_at TEXT NOT NULL, last_login TEXT, wp_user_id TEXT);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, agent TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id INTEGER, username TEXT, action TEXT NOT NULL,
  entity TEXT, entity_id TEXT, details TEXT);
CREATE INDEX IF NOT EXISTS ix_audit_ts ON audit_log(ts);

-- master data ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  code TEXT PRIMARY KEY, name TEXT, family TEXT, kva REAL, pnum REAL, engine TEXT, soundproof INTEGER, mobile INTEGER,
  model TEXT, cost_group TEXT, std_cost REAL, line_count INTEGER, in_finished_list INTEGER NOT NULL DEFAULT 0, bom_date TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS items (
  code TEXT PRIMARY KEY, name TEXT, kind TEXT, unit TEXT, cost_group TEXT, type1 TEXT, warehouse TEXT,
  std_unit_cost REAL, current_unit_cost REAL, approved_unit_cost REAL, approved_at TEXT, approved_by TEXT,
  cost_flags TEXT, bom_date TEXT, used_in INTEGER, inventory_category TEXT, supplier_lead_days INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS item_cost_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_code TEXT NOT NULL, unit_cost REAL NOT NULL, effective_from TEXT NOT NULL,
  approved_by TEXT, note TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bom_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_code TEXT NOT NULL, row_no INTEGER, line_no INTEGER NOT NULL, level INTEGER NOT NULL,
  parent_code TEXT, item_code TEXT NOT NULL, name TEXT, calc_type TEXT, consumption REAL, unit TEXT, cost_per_lot REAL, lot_size REAL,
  cost_per_unit REAL, warehouse TEXT, site TEXT, cost_group TEXT, operation TEXT, bom_date TEXT, unit_cost REAL, total_cost REAL,
  total_hike REAL, unit_cost2 REAL, active TEXT, type1 TEXT, type2 TEXT, type3 TEXT, model TEXT, finished_code TEXT, status TEXT,
  is_status_item INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_bom_product ON bom_lines(product_code, line_no);
CREATE INDEX IF NOT EXISTS ix_bom_item ON bom_lines(item_code);

CREATE TABLE IF NOT EXISTS sections (code TEXT PRIMARY KEY, name TEXT NOT NULL, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_centres (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, site TEXT, section_code TEXT NOT NULL, sheet TEXT, classify TEXT,
  capacity_factor REAL NOT NULL DEFAULT 1.0, labour_rate_per_hour REAL, overhead_rate_per_hour REAL, active INTEGER NOT NULL DEFAULT 1, notes TEXT);
CREATE TABLE IF NOT EXISTS productivity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, work_centre_code TEXT NOT NULL, type_code TEXT NOT NULL, class_family TEXT,
  sheet TEXT, source_row INTEGER, department TEXT, section_label TEXT, warehouse TEXT, per_unit_basis TEXT, per_unit REAL, staffs REAL,
  productivity_basis TEXT, productivity REAL, lines REAL, total_productivity REAL, total_staff REAL, staff_keep REAL, staff_idle REAL,
  new_staff REAL, lines_kept REAL, new_productivity REAL, rate_per_day REAL NOT NULL DEFAULT 0, rate_basis TEXT, week_plan TEXT, override_rate REAL, active INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS ix_prod_wc ON productivity(work_centre_code);
CREATE TABLE IF NOT EXISTS model_classes (id INTEGER PRIMARY KEY AUTOINCREMENT, family TEXT NOT NULL, code TEXT NOT NULL, kva_min REAL, kva_max REAL, aliases TEXT);
CREATE TABLE IF NOT EXISTS operation_map (id INTEGER PRIMARY KEY AUTOINCREMENT, cost_group_prefix TEXT NOT NULL, family TEXT NOT NULL DEFAULT '*', work_centre_code TEXT NOT NULL, process TEXT, seq INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cutting_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT, class_code TEXT NOT NULL, machine TEXT NOT NULL, minutes_per_canopy REAL, per_shift_calc REAL,
  per_shift_rounded REAL, pct_consumed REAL, qty_per_shift_recorded REAL, time_per_canopy REAL, source_row INTEGER);
CREATE TABLE IF NOT EXISTS cutting_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT, class_code TEXT NOT NULL, machine TEXT NOT NULL, file_no TEXT, description TEXT, minutes REAL, plate TEXT, time_text TEXT, sheet TEXT, source_row INTEGER);
CREATE TABLE IF NOT EXISTS machines (code TEXT PRIMARY KEY, name TEXT NOT NULL, work_centre_code TEXT NOT NULL, minutes_per_day REAL NOT NULL DEFAULT 480, count INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS calendar (date TEXT PRIMARY KEY, working INTEGER NOT NULL, minutes INTEGER NOT NULL DEFAULT 480, note TEXT);
CREATE TABLE IF NOT EXISTS import_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, import_id INTEGER, type TEXT NOT NULL, severity TEXT NOT NULL, entity TEXT, message TEXT, data TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN', reviewed_by TEXT, reviewed_at TEXT, review_note TEXT);
CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, filename TEXT, user TEXT, summary TEXT);

-- transactions --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE NOT NULL, order_ref TEXT, customer TEXT NOT NULL, product_code TEXT NOT NULL,
  product_name TEXT, family TEXT, qty REAL NOT NULL, delivery_date TEXT, priority TEXT NOT NULL DEFAULT 'NORMAL', remarks TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT, plan_id INTEGER);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sales_request_id INTEGER, product_code TEXT NOT NULL, qty REAL NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PROPOSED', options TEXT, start_date TEXT NOT NULL, expected_finish TEXT, baseline_finish TEXT, revised_finish TEXT,
  critical_path TEXT, bottleneck TEXT, summary TEXT, warnings TEXT, created_by TEXT, created_at TEXT NOT NULL, approved_by TEXT, approved_at TEXT, last_rescheduled_at TEXT);
CREATE TABLE IF NOT EXISTS production_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE NOT NULL, plan_id INTEGER NOT NULL, product_code TEXT NOT NULL, item_code TEXT NOT NULL,
  item_name TEXT, family TEXT, class_codes TEXT, level INTEGER, kind TEXT NOT NULL, required_qty REAL NOT NULL, inventory_used REAL NOT NULL DEFAULT 0,
  net_qty REAL NOT NULL, parent_codes TEXT, child_codes TEXT, status TEXT NOT NULL DEFAULT 'PLANNED', completed_qty REAL NOT NULL DEFAULT 0,
  planned_start TEXT, planned_finish TEXT, baseline_start TEXT, baseline_finish TEXT, priority INTEGER NOT NULL DEFAULT 5, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_po_plan ON production_orders(plan_id);
CREATE TABLE IF NOT EXISTS po_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, production_order_id INTEGER NOT NULL, plan_id INTEGER NOT NULL, seq INTEGER NOT NULL,
  work_centre_code TEXT NOT NULL, section_code TEXT NOT NULL, process TEXT, resources TEXT, hours_per_unit REAL, machine_hours_per_unit REAL,
  rate_per_day REAL, rate_source TEXT, class_code TEXT, machine_minutes TEXT, required_qty REAL NOT NULL, completed_qty REAL NOT NULL DEFAULT 0,
  rejected_qty REAL NOT NULL DEFAULT 0, rework_qty REAL NOT NULL DEFAULT 0, planned_start TEXT, planned_finish TEXT, baseline_start TEXT,
  baseline_finish TEXT, status TEXT NOT NULL DEFAULT 'PLANNED', on_critical_path INTEGER NOT NULL DEFAULT 0, wait_reason TEXT);
CREATE INDEX IF NOT EXISTS ix_pop_po ON po_operations(production_order_id);
CREATE INDEX IF NOT EXISTS ix_pop_wc ON po_operations(work_centre_code, status);
CREATE TABLE IF NOT EXISTS po_schedule_days (id INTEGER PRIMARY KEY AUTOINCREMENT, po_operation_id INTEGER NOT NULL, plan_id INTEGER NOT NULL, date TEXT NOT NULL, planned_qty REAL NOT NULL, is_baseline INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_psd_op ON po_schedule_days(po_operation_id, is_baseline, date);
CREATE INDEX IF NOT EXISTS ix_psd_date ON po_schedule_days(date);
CREATE TABLE IF NOT EXISTS material_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL, item_code TEXT NOT NULL, name TEXT, unit TEXT, cost_group TEXT, warehouse TEXT,
  qty_per_unit REAL NOT NULL, total_qty REAL NOT NULL, std_unit_cost REAL, current_unit_cost REAL, unit_cost_used REAL, ext_cost REAL, cost_flags TEXT,
  used_by TEXT, inventory_available REAL NOT NULL DEFAULT 0, net_qty REAL);
CREATE INDEX IF NOT EXISTS ix_mr_plan ON material_requirements(plan_id);
CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, po_operation_id INTEGER NOT NULL, production_order_id INTEGER NOT NULL, plan_id INTEGER NOT NULL,
  section_code TEXT NOT NULL, work_centre_code TEXT NOT NULL, item_code TEXT, planned_qty REAL, actual_qty REAL NOT NULL DEFAULT 0, rejected_qty REAL NOT NULL DEFAULT 0,
  rework_qty REAL NOT NULL DEFAULT 0, downtime_min REAL NOT NULL DEFAULT 0, delay_reason TEXT, remarks TEXT, user_id INTEGER, username TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_dr_date ON daily_reports(date);
CREATE INDEX IF NOT EXISTS ix_dr_op ON daily_reports(po_operation_id);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, date TEXT NOT NULL, item_code TEXT NOT NULL, category TEXT NOT NULL, type TEXT NOT NULL,
  qty REAL NOT NULL, production_order_id INTEGER, plan_id INTEGER, reference TEXT, remarks TEXT, user_id INTEGER, username TEXT);
CREATE INDEX IF NOT EXISTS ix_inv_item ON inventory_movements(item_code);
CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, filename TEXT NOT NULL, bytes INTEGER, kind TEXT);
`;

function nowIso() { return new Date().toISOString(); }

class DB {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this._stmts = new Map();
  }
  prep(sql) {
    let s = this._stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); this._stmts.set(sql, s); }
    return s;
  }
  run(sql, ...p) { return this.prep(sql).run(...p); }
  get(sql, ...p) { return this.prep(sql).get(...p); }
  all(sql, ...p) { return this.prep(sql).all(...p); }
  exec(sql) { return this.db.exec(sql); }
  tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { try { this.db.exec('ROLLBACK'); } catch (_) { /* ignore */ } throw e; }
  }
  setting(key, def) {
    const r = this.get('SELECT value FROM settings WHERE key = ?', key);
    if (!r) return def;
    try { return JSON.parse(r.value); } catch { return def; }
  }
  setSetting(key, value, by) { this.run('INSERT INTO settings(key,value,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by', key, JSON.stringify(value), nowIso(), by || null); }
  audit(user, action, entity, entityId, details) {
    this.run('INSERT INTO audit_log(ts,user_id,username,action,entity,entity_id,details) VALUES(?,?,?,?,?,?,?)', nowIso(), user?.id ?? null, user?.username ?? 'system', action, entity ?? null, entityId == null ? null : String(entityId), details == null ? null : JSON.stringify(details));
  }
  backup(dir, kind = 'manual', keep = 14) {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const file = path.join(dir, `ppm-backup-${stamp}.sqlite`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const bytes = fs.statSync(file).size;
    this.run('INSERT INTO backups(ts,filename,bytes,kind) VALUES(?,?,?,?)', nowIso(), path.basename(file), bytes, kind);
    // retention
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('ppm-backup-') && f.endsWith('.sqlite')).sort();
    while (files.length > keep) { const f = files.shift(); try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* ignore */ } }
    return { file, bytes };
  }
  close() { this.db.close(); }
}

module.exports = { DB, nowIso };
