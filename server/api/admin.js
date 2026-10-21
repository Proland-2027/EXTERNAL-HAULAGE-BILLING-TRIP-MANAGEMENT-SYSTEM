/* admin.js — users, audit trail, workbook import, backups. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('../http.js');
const { can, ROLES, ROLE_LABELS, hashPassword, verifyPassword } = require('../auth.js');
const { interpretWorkbook } = require('../import/workbook.js');
const { loadWorkbook } = require('../import/load.js');
const { nowIso } = require('../db.js');

const need = (user, perm) => { if (!can(user, perm)) throw new HttpError(403, 'Not permitted for your role'); };

module.exports = function register(r, { db, cfg }) {
  r.get('/api/users', ({ user }) => { need(user, 'admin'); return db.all('SELECT id, username, name, email, role, active, section_codes, created_at, last_login, wp_user_id FROM users ORDER BY id').map((u) => ({ ...u, sections: u.section_codes ? JSON.parse(u.section_codes) : [] })); });
  r.get('/api/roles', () => ROLES.map((r2) => ({ code: r2, label: ROLE_LABELS[r2] })));
  r.post('/api/users', async ({ body, user }) => {
    need(user, 'admin');
    if (!body.username || !/^[a-zA-Z0-9._-]{3,40}$/.test(body.username)) throw new HttpError(400, 'Username: 3–40 letters, digits, dot, dash or underscore');
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'Unknown role');
    if (!body.password || String(body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (db.get('SELECT 1 FROM users WHERE username = ?', body.username)) throw new HttpError(409, 'Username already exists');
    const id = db.run('INSERT INTO users(username,password_hash,name,email,role,active,section_codes,created_at) VALUES(?,?,?,?,?,1,?,?)', body.username, hashPassword(body.password), body.name || body.username, body.email || null, body.role, body.sections ? JSON.stringify(body.sections) : null, nowIso()).lastInsertRowid;
    db.audit(user, 'USER_CREATED', 'user', id, { username: body.username, role: body.role });
    return db.get('SELECT id, username, name, email, role, active, section_codes FROM users WHERE id = ?', id);
  });
  r.put('/api/users/:id', async ({ params, body, user }) => {
    need(user, 'admin');
    const u = db.get('SELECT * FROM users WHERE id = ?', params.id); if (!u) throw new HttpError(404, 'User not found');
    if (body.role && !ROLES.includes(body.role)) throw new HttpError(400, 'Unknown role');
    if (u.id === user.id && body.active === false) throw new HttpError(400, 'You cannot deactivate yourself');
    db.run('UPDATE users SET name = ?, email = ?, role = ?, active = ?, section_codes = ? WHERE id = ?', body.name ?? u.name, body.email ?? u.email, body.role ?? u.role, body.active != null ? (body.active ? 1 : 0) : u.active, body.sections ? JSON.stringify(body.sections) : u.section_codes, u.id);
    if (body.password) { if (String(body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters'); db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.password), u.id); db.run('DELETE FROM sessions WHERE user_id = ?', u.id); }
    db.audit(user, 'USER_UPDATED', 'user', u.id, { ...body, password: body.password ? '(changed)' : undefined });
    return db.get('SELECT id, username, name, email, role, active, section_codes FROM users WHERE id = ?', u.id);
  });
  r.post('/api/me/password', async ({ body, user }) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', user.id);
    if (!verifyPassword(body.current_password, u.password_hash)) throw new HttpError(400, 'Current password is incorrect');
    if (!body.new_password || String(body.new_password).length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(body.new_password), u.id);
    db.audit(user, 'PASSWORD_CHANGED', 'user', u.id, {});
    return { ok: true };
  });
  r.get('/api/audit', ({ query, user }) => {
    if (!can(user, 'admin') && !['MANAGEMENT', 'PRODUCTION_MANAGER', 'COST_ACCOUNTANT'].includes(user.role)) throw new HttpError(403, 'Not permitted');
    const where = []; const args = [];
    if (query.get('entity')) { where.push('entity = ?'); args.push(query.get('entity')); }
    if (query.get('entity_id')) { where.push('entity_id = ?'); args.push(query.get('entity_id')); }
    if (query.get('user')) { where.push('username = ?'); args.push(query.get('user')); }
    if (query.get('q')) { where.push('(action LIKE ? OR details LIKE ?)'); args.push(`%${query.get('q')}%`, `%${query.get('q')}%`); }
    return db.all(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(Number(query.get('limit') || 300), 5000)}`, ...args);
  });
  r.post('/api/import', async ({ raw, user, headers }) => {
    need(user, 'admin');
    if (!raw || raw.length < 100) throw new HttpError(400, 'Upload the .xlsx workbook as the request body');
    const filename = decodeURIComponent(headers['x-filename'] || 'upload.xlsx');
    let interp;
    try { interp = interpretWorkbook(raw); } catch (e) { throw new HttpError(400, `Workbook could not be read: ${e.message}`); }
    const open = db.get("SELECT COUNT(*) n FROM plans WHERE status IN ('APPROVED','IN_PROGRESS')").n;
    const res = loadWorkbook(db, interp, { filename, user });
    fs.mkdirSync(cfg.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(cfg.uploadDir, `import-${res.importId}-${filename.replace(/[^\w.-]/g, '_')}`), raw);
    db.audit(user, 'WORKBOOK_IMPORTED', 'import', res.importId, { filename, ...res.summary, openPlansAtImport: open });
    return { ...res, note: open ? `${open} approved plan(s) keep their original schedule and cost snapshot; re-plan them if master data changed.` : null };
  });
  r.get('/api/imports', ({ user }) => { need(user, 'admin'); return db.all('SELECT * FROM imports ORDER BY id DESC').map((i) => ({ ...i, summary: JSON.parse(i.summary || 'null') })); });
  r.get('/api/backups', ({ user }) => { need(user, 'admin'); const files = fs.existsSync(cfg.backupDir) ? fs.readdirSync(cfg.backupDir).filter((f) => f.endsWith('.sqlite')).sort().reverse().map((f) => ({ filename: f, bytes: fs.statSync(path.join(cfg.backupDir, f)).size, mtime: fs.statSync(path.join(cfg.backupDir, f)).mtime.toISOString() })) : []; return { files, dir: cfg.backupDir, schedule: `daily at ${db.setting('backup_hour', 2)}:00 server time, keeping ${db.setting('backup_keep', 14)} copies` }; });
  r.post('/api/backups', async ({ user }) => { need(user, 'admin'); const b = db.backup(cfg.backupDir, 'manual', db.setting('backup_keep', 14)); db.audit(user, 'BACKUP_CREATED', 'backup', path.basename(b.file), { bytes: b.bytes }); return { filename: path.basename(b.file), bytes: b.bytes }; });
  r.get('/api/backups/:file', ({ params, user }) => {
    need(user, 'admin');
    if (!/^ppm-backup-[\w-]+\.sqlite$/.test(params.file)) throw new HttpError(400, 'Bad filename');
    const p = path.join(cfg.backupDir, params.file); if (!fs.existsSync(p)) throw new HttpError(404, 'Not found');
    return { raw: fs.readFileSync(p), contentType: 'application/octet-stream', filename: params.file };
  });
  r.get('/api/system', ({ user }) => ({ version: cfg.version, node: process.version, dbFile: can(user, 'admin') ? cfg.dbFile : undefined, lastImport: JSON.parse(db.get("SELECT value FROM meta WHERE key='last_import'")?.value || 'null'), counts: { products: db.get('SELECT COUNT(*) n FROM products').n, finished: db.get('SELECT COUNT(*) n FROM products WHERE in_finished_list = 1').n, bomLines: db.get('SELECT COUNT(*) n FROM bom_lines').n, items: db.get('SELECT COUNT(*) n FROM items').n, plans: db.get('SELECT COUNT(*) n FROM plans').n, users: db.get('SELECT COUNT(*) n FROM users').n }, uptimeSec: Math.round(process.uptime()) }));
};
