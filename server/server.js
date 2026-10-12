#!/usr/bin/env node
/*
 * Haulage Billing Desk — application server.
 * Node 22+, no dependencies: node:http serves the static app, node:sqlite holds the central database.
 * Every write is checked against the user's role on the server, versioned (optimistic concurrency, 409 on conflict),
 * audited, and published on a change feed that connected browsers poll.
 *
 *   node server/server.js            # http://localhost:8080
 *   PORT=3000 DB=./data/haulage.db node server/server.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const E = require('../js/core/engine.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const DB_PATH = process.env.DB || path.join(ROOT, 'data', 'haulage.db');
const SECURE_COOKIE = process.env.SECURE_COOKIE === '1';
const COLLECTIONS = ['clients', 'assets', 'rates', 'invoices', 'payments', 'users', 'settings', 'meta'];
const COLLECTION_ACTION = { clients: 'client.manage', assets: 'asset.manage', rates: 'rate.manage', invoices: 'invoice.manage', payments: 'payment.manage', users: 'user.manage', settings: 'settings.manage', meta: 'settings.manage' };

// ------------------------------------------------------------------ database
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS docs (collection TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT, json TEXT NOT NULL, PRIMARY KEY (collection, id));
  CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, date_dispatched TEXT, client TEXT, plate TEXT, payment_status TEXT, invoice_id TEXT, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT, json TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS trips_date ON trips(date_dispatched);
  CREATE INDEX IF NOT EXISTS trips_client ON trips(client);
  CREATE INDEX IF NOT EXISTS trips_invoice ON trips(invoice_id);
  CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, ts TEXT NOT NULL, user TEXT, user_name TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, label TEXT, changes TEXT);
  CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts);
  CREATE TABLE IF NOT EXISTS changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT);
`);
const q = {
  getDoc: db.prepare('SELECT json, version FROM docs WHERE collection = ? AND id = ?'),
  listDocs: db.prepare('SELECT json FROM docs WHERE collection = ? ORDER BY id'),
  putDoc: db.prepare('INSERT INTO docs (collection, id, version, updated_at, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, json = excluded.json'),
  delDoc: db.prepare('DELETE FROM docs WHERE collection = ? AND id = ?'),
  getTrip: db.prepare('SELECT json, version FROM trips WHERE id = ?'),
  listTrips: db.prepare('SELECT json FROM trips ORDER BY date_dispatched, id'),
  putTrip: db.prepare('INSERT INTO trips (id, date_dispatched, client, plate, payment_status, invoice_id, version, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date_dispatched = excluded.date_dispatched, client = excluded.client, plate = excluded.plate, payment_status = excluded.payment_status, invoice_id = excluded.invoice_id, version = excluded.version, updated_at = excluded.updated_at, json = excluded.json'),
  delTrip: db.prepare('DELETE FROM trips WHERE id = ?'),
  audit: db.prepare('INSERT INTO audit (id, ts, user, user_name, role, action, entity, entity_id, label, changes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  listAudit: db.prepare('SELECT * FROM audit ORDER BY ts DESC LIMIT ?'),
  change: db.prepare('INSERT INTO changes (ts, collection, id, deleted) VALUES (?, ?, ?, ?)'),
  changesSince: db.prepare('SELECT seq, collection, id, deleted FROM changes WHERE seq > ? ORDER BY seq LIMIT 2000'),
  maxSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM changes'),
  getSession: db.prepare('SELECT username, expires_at FROM sessions WHERE token = ?'),
  putSession: db.prepare('INSERT INTO sessions (token, username, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)'),
  delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
};
const parse = (row) => (row ? JSON.parse(row.json) : null);
const nowISO = () => new Date().toISOString();

const store = {
  doc(collection, id) { return parse(q.getDoc.get(collection, id)); },
  list(collection) { return q.listDocs.all(collection).map(parse); },
  putDoc(collection, doc) { q.putDoc.run(collection, doc.id, doc.version || 1, doc.updatedAt || nowISO(), JSON.stringify(doc)); q.change.run(nowISO(), collection, doc.id, 0); return doc; },
  delDoc(collection, id) { q.delDoc.run(collection, id); q.change.run(nowISO(), collection, id, 1); },
  trip(id) { return parse(q.getTrip.get(id)); },
  trips() { return q.listTrips.all().map(parse); },
  putTrip(t) { q.putTrip.run(t.id, t.dateDispatched || '', t.client || '', t.plate || '', t.paymentStatus || '', t.invoiceId || '', t.version || 1, t.updatedAt || nowISO(), JSON.stringify(t)); q.change.run(nowISO(), 'trips', t.id, 0); return t; },
  delTrip(id) { q.delTrip.run(id); q.change.run(nowISO(), 'trips', id, 1); },
  audit(e) { q.audit.run(e.id, e.ts, e.user, e.userName, e.role, e.action, e.entity, e.entityId, e.label, JSON.stringify(e.changes || [])); },
  settings() { return Object.assign({ company: 'JMG Haulage Services', vatRate: 0.075, paymentTermsDays: 7, bankName: '', accountName: '', accountNumber: '', invoiceNote: 'Thank you for your business.' }, this.doc('settings', 'main') || {}); },
};

// ------------------------------------------------------------------ auth
const hashPassword = (password, salt) => crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
function makeUser({ username, name, role, password, active }) { const salt = crypto.randomBytes(16).toString('hex'); return { id: username.toLowerCase(), username: username.toLowerCase(), name, role, salt, hash: hashPassword(password, salt), active: active !== false, createdAt: nowISO(), version: 1 }; }
function publicUser(u) { return { id: u.id, username: u.username, name: u.name, role: u.role }; }
function cookieToken(req) { const m = /(?:^|;\s*)hb_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || ''); return m ? m[1] : null; }
function currentUser(req) {
  const token = cookieToken(req); if (!token) return null;
  const s = q.getSession.get(token); if (!s || s.expires_at < nowISO()) return null;
  const u = store.doc('users', s.username); if (!u || u.active === false) return null;
  return publicUser(u);
}
const diff = (before, after) => { const changes = []; const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((k) => !['version', 'updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'history', 'hash', 'salt'].includes(k)); for (const k of keys) { const a = before ? before[k] : undefined, b = after ? after[k] : undefined; const na = a === undefined || a === null ? '' : a, nb = b === undefined || b === null ? '' : b; if (JSON.stringify(na) !== JSON.stringify(nb)) changes.push({ field: k, from: na, to: nb }); } return changes; };
const auditEntry = (user, action, entity, entityId, label, changes) => ({ id: 'a-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), ts: nowISO(), user: user ? user.username : 'system', userName: user ? user.name : 'System', role: user ? user.role : '', action, entity, entityId, label, changes });

// ------------------------------------------------------------------ http helpers
class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
function send(res, status, body, headers) { const data = JSON.stringify(body); res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) }, headers || {})); res.end(data); }
function readBody(req) { return new Promise((resolve, reject) => { let size = 0; const chunks = []; req.on('data', (c) => { size += c.length; if (size > 50 * 1024 * 1024) { reject(new HttpError(413, 'Request too large')); req.destroy(); } chunks.push(c); }); req.on('end', () => { if (!chunks.length) return resolve(null); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new HttpError(400, 'Invalid JSON')); } }); req.on('error', reject); }); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.md': 'text/markdown; charset=utf-8' };
function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]); if (p === '/' || p === '') p = '/index.html';
  if (p.startsWith('/server/') || p.startsWith('/data/haulage') || p.includes('..')) return send(res, 404, { error: 'Not found' });
  const file = path.join(ROOT, p); if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'Not found' });
  const ext = path.extname(file).toLowerCase(); let body = fs.readFileSync(file);
  if (p === '/index.html') body = Buffer.from('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<style>[hidden]{display:none!important}</style>\n</head>\n<body>\n' + body.toString('utf8') + '\n</body>\n</html>\n');
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' });
  res.end(body);
}

// ------------------------------------------------------------------ API
const requireUser = (req) => { const u = currentUser(req); if (!u) throw new HttpError(401, 'Sign in required', { code: 'auth' }); return u; };
const requireAction = (user, action) => { if (!E.can(user.role, action)) throw new HttpError(403, `Your role (${E.ROLE_LABELS[user.role]}) cannot do this.`, { code: 'forbidden' }); };

const routes = {
  'GET /api/ping': () => ({ ok: true, name: 'Haulage Billing Desk', time: nowISO() }),
  'POST /api/login': async (req, res, body) => {
    const username = String((body && body.username) || '').trim().toLowerCase(), password = String((body && body.password) || '');
    const u = store.doc('users', username);
    if (!u || u.active === false || hashPassword(password, u.salt) !== u.hash) { await new Promise((r) => setTimeout(r, 400)); throw new HttpError(401, 'Wrong username or password.', { code: 'auth' }); }
    const token = crypto.randomBytes(32).toString('base64url'); const exp = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
    q.purgeSessions.run(nowISO()); q.putSession.run(token, u.username, nowISO(), exp, req.socket.remoteAddress || '');
    store.audit(auditEntry(publicUser(u), 'login', 'session', u.username, 'Signed in', []));
    res.setHeader('Set-Cookie', `hb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${SECURE_COOKIE ? '; Secure' : ''}`);
    return { user: publicUser(u) };
  },
  'POST /api/logout': (req, res) => { const t = cookieToken(req); if (t) q.delSession.run(t); res.setHeader('Set-Cookie', 'hb_session=; Path=/; HttpOnly; Max-Age=0'); return { ok: true }; },
  'GET /api/me': (req) => ({ user: currentUser(req) }),
  'GET /api/bootstrap': (req) => {
    const user = requireUser(req); const out = { user, settings: store.settings(), trips: store.trips(), seq: q.maxSeq.get().seq, locations: ((store.doc('meta', 'locations') || {}).list) || [] };
    for (const c of ['clients', 'assets', 'rates', 'invoices', 'payments']) out[c] = store.list(c);
    out.users = store.list('users').map((u) => (E.can(user.role, 'user.manage') ? Object.assign({}, u, { hash: undefined, salt: undefined }) : publicUser(u)));
    return out;
  },
  'GET /api/changes': (req, res, body, url) => {
    requireUser(req); const since = Number(url.searchParams.get('since') || 0);
    const rows = q.changesSince.all(since);
    return { changes: rows.map((r) => ({ seq: r.seq, collection: r.collection, id: r.id, deleted: !!r.deleted, data: r.deleted ? null : r.collection === 'trips' ? store.trip(r.id) : r.collection === 'users' ? (() => { const u = store.doc('users', r.id); return u ? Object.assign({}, u, { hash: undefined, salt: undefined }) : null; })() : store.doc(r.collection, r.id) })) };
  },
  'GET /api/audit': (req, res, body, url) => { const user = requireUser(req); requireAction(user, 'audit.view'); const limit = Math.min(2000, Number(url.searchParams.get('limit') || 300)); return { audit: q.listAudit.all(limit).map((r) => ({ id: r.id, ts: r.ts, user: r.user, userName: r.user_name, role: r.role, action: r.action, entity: r.entity, entityId: r.entity_id, label: r.label, changes: JSON.parse(r.changes || '[]') })) }; },
  'PUT /api/trips/:id': (req, res, body, url, params) => {
    const user = requireUser(req); requireAction(user, 'trip.edit');
    const current = store.trip(params.id);
    if (!current) requireAction(user, 'trip.create');
    const expected = req.headers['if-match']; if (current && expected !== undefined && Number(expected) !== Number(current.version)) throw new HttpError(409, 'This record was changed by someone else.', { code: 'conflict', current });
    const incoming = Object.assign({}, body || {}, { id: params.id });
    // field-level permission: a role may only change the fields it owns
    const allowed = new Set(E.ROLE_FIELDS[user.role] || []);
    const protectedKeys = ['dateDispatched', 'dateDelivered', 'plate', 'contractType', 'client', 'loadingFrom', 'loadingTo', 'journeyPlanId', 'waybill', 'returnWaybill', 'invoiceStatus', 'sellingPrice', 'quoteNo', 'soNo', 'manualInvoiceNo', 'invoiceNo', 'invoiceId', 'paymentStatus', 'advance', 'note', 'agreedRateId', 'amountPaidOverride'];
    const next = Object.assign({}, current || {}, { id: params.id });
    for (const k of protectedKeys) {
      if (incoming[k] === undefined) continue; // absent keys are left unchanged (partial updates allowed)
      const defaults = { invoiceStatus: 'Invoice Not Sent', paymentStatus: 'Not Paid', returnWaybill: '' };
      const before = current ? current[k] : defaults[k], after = incoming[k];
      const changed = JSON.stringify(before === undefined || before === null ? '' : before) !== JSON.stringify(after === undefined || after === null ? '' : after);
      if (changed && !allowed.has(k) && user.role !== 'admin') throw new HttpError(403, `Your role cannot change "${k}".`, { code: 'forbidden' });
      if (incoming[k] !== undefined) next[k] = incoming[k];
    }
    for (const k of ['source', 'xlRow', 'invoiceStatusRaw']) if (incoming[k] !== undefined && next[k] === undefined) next[k] = incoming[k];
    next.sellingPrice = E.num(next.sellingPrice); next.advance = E.num(next.advance);
    const asset = E.assetFor(next.plate, store.list('assets')); if (asset) { next.assetCode = asset.assetCode; next.vehicleType = asset.vehicleType; next.vehicleCategory = asset.vehicleCategory; next.costCenter = asset.costCenter; }
    const errors = E.validateTrip(next, { assets: store.list('assets') }); if (errors.length) throw new HttpError(400, errors.join(' '), { code: 'invalid', errors });
    const ts = nowISO(); if (!current) { next.createdAt = ts; next.createdBy = user.username; } next.updatedAt = ts; next.updatedBy = user.username; next.version = Number(current ? current.version : 0) + 1;
    const changes = diff(current, next); next.history = [...(current && current.history || []), { ts, user: user.name, changes }].slice(-40);
    const label = `${next.client} · ${next.plate} · ${next.dateDispatched}`;
    db.exec('BEGIN'); try { store.putTrip(next); store.audit(auditEntry(user, current ? 'update' : 'create', 'trip', next.id, label, changes)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    return next;
  },
  'DELETE /api/trips/:id': (req, res, body, url, params) => { const user = requireUser(req); requireAction(user, 'trip.delete'); const cur = store.trip(params.id); if (!cur) throw new HttpError(404, 'Trip not found'); db.exec('BEGIN'); try { store.delTrip(params.id); store.audit(auditEntry(user, 'delete', 'trip', params.id, `${cur.client} · ${cur.plate} · ${cur.dateDispatched}`, [])); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return { ok: true }; },
  'POST /api/trips/bulk': (req, res, body) => {
    const user = requireUser(req); requireAction(user, 'trip.import'); const trips = (body && body.trips) || []; if (!Array.isArray(trips) || trips.length > 20000) throw new HttpError(400, 'Invalid import');
    const assets = store.list('assets'); const out = []; const ts = nowISO();
    db.exec('BEGIN'); try {
      for (const raw of trips) { const t = Object.assign({}, raw); t.id = t.id || 'imp-' + crypto.randomBytes(6).toString('hex'); const a = E.assetFor(t.plate, assets); if (a) { t.assetCode = a.assetCode; t.vehicleType = a.vehicleType; t.vehicleCategory = a.vehicleCategory; t.costCenter = a.costCenter; } t.sellingPrice = E.num(t.sellingPrice); t.advance = E.num(t.advance); const errors = E.validateTrip(t, {}); if (errors.length) continue; t.version = 1; t.createdAt = t.createdAt || ts; t.createdBy = user.username; t.updatedAt = ts; t.updatedBy = user.username; t.source = t.source || 'import'; store.putTrip(t); out.push(t); }
      store.audit(auditEntry(user, 'import', 'trip', 'bulk', `${out.length} trips imported`, [])); db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { trips: out };
  },
  'PUT /api/:collection/:id': (req, res, body, url, params) => {
    const user = requireUser(req); const c = params.collection; if (!COLLECTIONS.includes(c)) throw new HttpError(404, 'Unknown collection');
    requireAction(user, COLLECTION_ACTION[c]);
    const current = store.doc(c, params.id); const incoming = Object.assign({}, body || {}, { id: params.id });
    if (current && incoming.version !== undefined && Number(incoming.version) !== Number(current.version) + 1 && Number(incoming.version) !== Number(current.version)) throw new HttpError(409, 'This record was changed by someone else.', { code: 'conflict', current });
    const next = Object.assign({}, current || {}, incoming);
    if (c === 'users') { if (current) { next.hash = current.hash; next.salt = current.salt; } else { if (!incoming.hash || !incoming.salt) throw new HttpError(400, 'New users need a password'); } if (current && current.username === user.username && next.active === false) throw new HttpError(400, 'You cannot disable your own account.'); }
    const ts = nowISO(); if (!current) { next.createdAt = next.createdAt || ts; next.createdBy = user.username; } next.updatedAt = ts; next.updatedBy = user.username; next.version = Number(current ? current.version : 0) + 1;
    db.exec('BEGIN'); try { store.putDoc(c, next); if (c !== 'meta') store.audit(auditEntry(user, current ? 'update' : 'create', c, next.id, next.name || next.number || next.plate || next.id, diff(current, next))); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    return c === 'users' ? Object.assign({}, next, { hash: undefined, salt: undefined }) : next;
  },
  'DELETE /api/:collection/:id': (req, res, body, url, params) => { const user = requireUser(req); const c = params.collection; if (!COLLECTIONS.includes(c)) throw new HttpError(404, 'Unknown collection'); requireAction(user, COLLECTION_ACTION[c]); const cur = store.doc(c, params.id); db.exec('BEGIN'); try { store.delDoc(c, params.id); store.audit(auditEntry(user, 'delete', c, params.id, cur ? cur.name || cur.number || cur.plate || params.id : params.id, [])); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return { ok: true }; },
  'POST /api/users/:id/password': (req, res, body, url, params) => { const user = requireUser(req); if (user.username !== params.id) requireAction(user, 'user.manage'); const u = store.doc('users', params.id); if (!u) throw new HttpError(404, 'User not found'); const pw = String((body && body.password) || ''); if (pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.'); u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hashPassword(pw, u.salt); u.version = Number(u.version || 1) + 1; u.updatedAt = nowISO(); store.putDoc('users', u); store.audit(auditEntry(user, 'update', 'users', u.id, `${u.username} password reset`, [])); return { ok: true }; },
};
function match(method, pathname) {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(' '); if (m !== method) continue;
    const pp = pattern.split('/'), aa = pathname.split('/'); if (pp.length !== aa.length) continue;
    const params = {}; let ok = true;
    for (let i = 0; i < pp.length; i++) { if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(aa[i]); else if (pp[i] !== aa[i]) { ok = false; break; } }
    if (ok) return { handler, params };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const r = match(req.method, url.pathname); if (!r) throw new HttpError(404, 'Not found');
      if (req.method !== 'GET') { const origin = req.headers.origin; const host = req.headers.host; if (origin && host && !origin.endsWith('//' + host)) throw new HttpError(403, 'Cross-site request blocked'); }
      const body = req.method === 'GET' ? null : await readBody(req);
      const out = await r.handler(req, res, body, url, r.params);
      return send(res, 200, out);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, Object.assign({ error: e.message }, e.extra || {}));
    console.error(e); return send(res, 500, { error: 'Server error' });
  }
});

module.exports = { server, store, db, makeUser, hashPassword };
if (require.main === module) {
  if (!store.list('users').length) console.log('No users yet — run `node server/seed.js` to load the workbook data and demo accounts.');
  server.listen(PORT, () => console.log(`Haulage Billing Desk on http://localhost:${PORT}  (database: ${DB_PATH})`));
}
