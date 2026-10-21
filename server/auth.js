/* auth.js — scrypt password hashing, DB-backed sessions, role permissions, WordPress SSO tokens. */
'use strict';
const crypto = require('node:crypto');
const { nowIso } = require('./db.js');

const ROLES = ['SALES', 'PLANNER', 'PRODUCTION_MANAGER', 'SUPERVISOR', 'STORE', 'COST_ACCOUNTANT', 'MANAGEMENT', 'ADMIN'];
const ROLE_LABELS = { SALES: 'Sales', PLANNER: 'Production Planner', PRODUCTION_MANAGER: 'Production Manager', SUPERVISOR: 'Section Supervisor', STORE: 'Store Officer', COST_ACCOUNTANT: 'Cost Accountant', MANAGEMENT: 'Management', ADMIN: 'Administrator' };

const PERMS = {
  'sales.write': ['SALES', 'PLANNER', 'ADMIN'],
  'plan.write': ['PLANNER', 'PRODUCTION_MANAGER', 'ADMIN'],
  'plan.approve': ['PLANNER', 'PRODUCTION_MANAGER', 'ADMIN'],
  'production.report': ['SUPERVISOR', 'PRODUCTION_MANAGER', 'PLANNER', 'ADMIN'],
  'inventory.write': ['STORE', 'PRODUCTION_MANAGER', 'ADMIN'],
  'cost.write': ['COST_ACCOUNTANT', 'ADMIN'],
  'masters.write': ['PLANNER', 'PRODUCTION_MANAGER', 'ADMIN'],
  'exceptions.review': ['PLANNER', 'PRODUCTION_MANAGER', 'COST_ACCOUNTANT', 'ADMIN'],
  'admin': ['ADMIN'],
  'reports.export': ROLES,
};
function can(user, perm) { if (!user) return false; const allowed = PERMS[perm]; return !!allowed && allowed.includes(user.role); }

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const h = crypto.scryptSync(String(pw), salt, 64);
  const a = Buffer.from(hash, 'hex');
  return a.length === h.length && crypto.timingSafeEqual(a, h);
}

const SESSION_DAYS = 14;
function createSession(db, user, req) {
  const id = crypto.randomBytes(32).toString('base64url');
  const exp = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.run('INSERT INTO sessions(id,user_id,created_at,expires_at,ip,agent) VALUES(?,?,?,?,?,?)', id, user.id, nowIso(), exp, req?.socket?.remoteAddress || null, (req?.headers?.['user-agent'] || '').slice(0, 200));
  db.run('UPDATE users SET last_login = ? WHERE id = ?', nowIso(), user.id);
  return { id, exp };
}
function userFromSession(db, sid) {
  if (!sid) return null;
  const row = db.get('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.active = 1', sid, nowIso());
  if (!row) return null;
  delete row.password_hash;
  row.sections = row.section_codes ? JSON.parse(row.section_codes) : [];
  return row;
}
function destroySession(db, sid) { if (sid) db.run('DELETE FROM sessions WHERE id = ?', sid); }
function purgeSessions(db) { db.run('DELETE FROM sessions WHERE expires_at <= ?', nowIso()); }

/* WordPress SSO: token = base64url(json).base64url(hmac-sha256(json)) with a shared secret. */
function verifySsoToken(token, secret) {
  if (!token || !secret) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (!payload.username || !ROLES.includes(payload.role)) return null;
    return payload;
  } catch { return null; }
}
function makeSsoToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const DEMO_USERS = [
  { username: 'admin', password: 'Admin@2026', name: 'System Administrator', role: 'ADMIN' },
  { username: 'sales', password: 'Sales@2026', name: 'Sales Desk', role: 'SALES' },
  { username: 'planner', password: 'Planner@2026', name: 'Production Planner', role: 'PLANNER' },
  { username: 'prodmgr', password: 'Prodmgr@2026', name: 'Production Manager', role: 'PRODUCTION_MANAGER' },
  { username: 'cutting', password: 'Cutting@2026', name: 'Cutting Supervisor', role: 'SUPERVISOR', sections: ['CUT'] },
  { username: 'welding', password: 'Welding@2026', name: 'Welding Supervisor', role: 'SUPERVISOR', sections: ['WELD'] },
  { username: 'coating', password: 'Coating@2026', name: 'Powder Coating Supervisor', role: 'SUPERVISOR', sections: ['PWC'] },
  { username: 'assembly', password: 'Assembly@2026', name: 'Assembly Supervisor', role: 'SUPERVISOR', sections: ['BASE', 'PANEL', 'CANOPY', 'GENSET', 'QC'] },
  { username: 'stores', password: 'Stores@2026', name: 'Store Officer', role: 'STORE' },
  { username: 'costing', password: 'Costing@2026', name: 'Cost Accountant', role: 'COST_ACCOUNTANT' },
  { username: 'management', password: 'Manage@2026', name: 'Management', role: 'MANAGEMENT' },
];
function seedUsers(db, { adminPassword, demo = true } = {}) {
  const created = [];
  for (const u of DEMO_USERS) {
    if (u.role !== 'ADMIN' && !demo) continue;
    if (db.get('SELECT 1 FROM users WHERE username = ?', u.username)) continue;
    const pw = u.role === 'ADMIN' && adminPassword ? adminPassword : u.password;
    db.run('INSERT INTO users(username,password_hash,name,role,active,section_codes,created_at) VALUES(?,?,?,?,1,?,?)', u.username, hashPassword(pw), u.name, u.role, u.sections ? JSON.stringify(u.sections) : null, nowIso());
    created.push(u.username);
  }
  return created;
}

module.exports = { ROLES, ROLE_LABELS, PERMS, can, hashPassword, verifyPassword, createSession, userFromSession, destroySession, purgeSessions, verifySsoToken, makeSsoToken, seedUsers, DEMO_USERS };
