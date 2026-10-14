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
const P = require('../js/core/planning.js');
const G = require('../js/core/geo.js');
const D = require('../js/core/dispatch.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const DB_PATH = process.env.DB || path.join(ROOT, 'data', 'haulage.db');
const SECURE_COOKIE = process.env.SECURE_COOKIE === '1';
const COLLECTIONS = ['clients', 'assets', 'rates', 'invoices', 'payments', 'users', 'settings', 'meta', 'fleet', 'routes', 'requests', 'allocations', 'waybilldocs', 'lostsales', 'distances', 'dieselreqs', 'roadslips', 'extraexpenses', 'contractors', 'quotes'];
const COLLECTION_ACTION = { clients: 'client.manage', assets: 'asset.manage', rates: 'rate.manage', invoices: 'invoice.manage', payments: 'payment.manage', users: 'user.manage', settings: 'settings.manage', meta: 'settings.manage', fleet: 'fmr.update', routes: 'route.manage', requests: 'request.manage', allocations: 'allocation.manage', waybilldocs: 'trip.edit', lostsales: 'lostsales.manage', distances: 'distance.manage', dieselreqs: 'dispatch.prepare', roadslips: 'dispatch.prepare', extraexpenses: 'expense.request', contractors: 'tpl.manage', quotes: 'tpl.manage' };
// roles that may also write a collection for their own stage (mirrors js/store/common.js)
const COLLECTION_ALSO = { invoices: ['invoice.override.ops', 'invoice.override.finance'], requests: ['plan.approve', 'allocation.release', 'tpl.approve', 'tpl.pay'], allocations: ['plan.approve', 'allocation.release', 'request.cancel', 'trip.fromPlanning'], extraexpenses: ['expense.approve', 'expense.pay'], dieselreqs: ['dispatch.approve', 'dispatch.finance', 'dispatch.issue'], roadslips: ['dispatch.approve', 'dispatch.finance', 'dispatch.issue'], quotes: ['tpl.approve'], meta: ['fmr.import'] };
const DISTANCE_ROUTER = process.env.OSRM_URL || ''; // e.g. https://router.project-osrm.org — road-distance service used by the Route Distance Master

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
  CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, next INTEGER NOT NULL);
`);
// Trip IDs: a dedicated column with a UNIQUE index on the generated format gives database-level uniqueness; the counter table gives
// safe concurrent numbering inside the write transaction. Historical workbook Journey Plan IDs are free text and stay outside the index.
try { db.exec('ALTER TABLE trips ADD COLUMN trip_id TEXT'); } catch (e) { /* column exists */ }
db.exec("UPDATE trips SET trip_id = json_extract(json, '$.journeyPlanId') WHERE trip_id IS NULL; CREATE UNIQUE INDEX IF NOT EXISTS trips_trip_id ON trips(trip_id) WHERE trip_id LIKE 'JMG-TRP-%';");
const q = {
  getDoc: db.prepare('SELECT json, version FROM docs WHERE collection = ? AND id = ?'),
  listDocs: db.prepare('SELECT json FROM docs WHERE collection = ? ORDER BY id'),
  putDoc: db.prepare('INSERT INTO docs (collection, id, version, updated_at, json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at, json = excluded.json'),
  delDoc: db.prepare('DELETE FROM docs WHERE collection = ? AND id = ?'),
  getTrip: db.prepare('SELECT json, version FROM trips WHERE id = ?'),
  listTrips: db.prepare('SELECT json FROM trips ORDER BY date_dispatched, id'),
  putTrip: db.prepare('INSERT INTO trips (id, date_dispatched, client, plate, payment_status, invoice_id, version, updated_at, json, trip_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date_dispatched = excluded.date_dispatched, client = excluded.client, plate = excluded.plate, payment_status = excluded.payment_status, invoice_id = excluded.invoice_id, version = excluded.version, updated_at = excluded.updated_at, json = excluded.json, trip_id = excluded.trip_id'),
  getCounter: db.prepare('SELECT next FROM counters WHERE name = ?'), putCounter: db.prepare('INSERT INTO counters (name, next) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET next = excluded.next'), maxTripSeq: db.prepare("SELECT MAX(CAST(substr(trip_id, 14) AS INTEGER)) AS n FROM trips WHERE trip_id LIKE ?"),
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
const num = E.num;
const nowISO = () => new Date().toISOString();

const store = {
  doc(collection, id) { return parse(q.getDoc.get(collection, id)); },
  list(collection) { return q.listDocs.all(collection).map(parse); },
  putDoc(collection, doc) { q.putDoc.run(collection, doc.id, doc.version || 1, doc.updatedAt || nowISO(), JSON.stringify(doc)); q.change.run(nowISO(), collection, doc.id, 0); return doc; },
  delDoc(collection, id) { q.delDoc.run(collection, id); q.change.run(nowISO(), collection, id, 1); },
  trip(id) { return parse(q.getTrip.get(id)); },
  trips() { return q.listTrips.all().map(parse); },
  putTrip(t) { q.putTrip.run(t.id, t.dateDispatched || '', t.client || '', t.plate || '', t.paymentStatus || '', t.invoiceId || '', t.version || 1, t.updatedAt || nowISO(), JSON.stringify(t), t.journeyPlanId || ''); q.change.run(nowISO(), 'trips', t.id, 0); return t; },
  /** Next Trip ID for a year (call inside a transaction): counter table seeded from the highest existing sequence. */
  nextTripId(year) { const name = 'tripseq-' + year; const row = q.getCounter.get(name); let n = row ? Number(row.next) : 0; if (!row) { const mx = q.maxTripSeq.get('JMG-TRP-' + year + '-%'); n = (mx && mx.n ? Number(mx.n) : 0) + 1; } q.putCounter.run(name, n + 1); return E.formatTripId(year, n); },
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
const requireCollection = (user, c) => { if (!E.can(user.role, COLLECTION_ACTION[c]) && !(COLLECTION_ALSO[c] || []).some((a) => E.can(user.role, a))) throw new HttpError(403, `Your role (${E.ROLE_LABELS[user.role]}) cannot change ${c}.`, { code: 'forbidden' }); };
const invalid = (msg, code) => new HttpError(400, msg, { code: code || 'invalid' });

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
    const user = requireUser(req); const out = { user, settings: store.settings(), trips: store.trips(), seq: q.maxSeq.get().seq, locations: ((store.doc('meta', 'locations') || {}).list) || [], zones: ((store.doc('meta', 'zones') || {}).map) || {}, planning: store.doc('meta', 'planning') || {}, locationMaster: (() => { const m = Object.assign({}, store.doc('meta', 'locationmaster') || {}); delete m.id; return m; })() };
    for (const c of ['clients', 'assets', 'rates', 'invoices', 'payments', 'fleet', 'routes', 'requests', 'allocations', 'waybilldocs', 'lostsales', 'distances', 'dieselreqs', 'roadslips', 'extraexpenses', 'contractors', 'quotes']) out[c] = store.list(c);
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
    const user = requireUser(req); const current = store.trip(params.id);
    if (!current) requireAction(user, 'trip.create'); else if (!E.can(user.role, 'trip.edit') && !(E.ROLE_FIELDS[user.role] || []).length) requireAction(user, 'trip.edit');
    const expected = req.headers['if-match']; if (current && expected !== undefined && Number(expected) !== Number(current.version)) throw new HttpError(409, 'This record was changed by someone else.', { code: 'conflict', current });
    const incoming = Object.assign({}, body || {}, { id: params.id });
    // field-level permission: a role may only change the fields it owns
    const allowed = new Set(E.ROLE_FIELDS[user.role] || []);
    const protectedKeys = ['dateDispatched', 'dateDelivered', 'plate', 'contractType', 'client', 'loadingFrom', 'loadingTo', 'journeyPlanId', 'waybill', 'returnWaybill', 'invoiceStatus', 'sellingPrice', 'vatTreatment', 'quoteNo', 'soNo', 'manualInvoiceNo', 'invoiceNo', 'invoiceId', 'paymentStatus', 'advance', 'note', 'agreedRateId', 'amountPaidOverride',
      'allocationId', 'requestId', 'waybillEnteredAt', 'waybillReceivedAt', 'waybillReceivedBy', 'waybillDocId', 'waybillDocName', 'waybillVerifiedAt', 'waybillVerifiedBy', 'internalClient', 'tripIdSource',
      'serviceType', 'contractorId', 'contractorName', 'contractorPlate', 'contractorCost', 'driver', 'routeMasterId', 'tatTargetDays', 'opsStatus', 'closedAt', 'closedBy', 'cancelledAt', 'cancelReason', 'milestones', 'events', 'podReceivedAt', 'podReceivedBy', 'podVerifiedAt', 'podVerifiedBy', 'podDocId', 'podDocName', 'deliveryConfirmedAt', 'deliveryConfirmedBy', 'otherDocs'];
    // a generated Trip ID is never overwritten by a user; it is set by the from-allocation route only
    if (incoming.journeyPlanId !== undefined && current && E.TRIP_ID_RE.test(String(current.journeyPlanId || '')) && E.norm(incoming.journeyPlanId) !== E.norm(current.journeyPlanId)) throw new HttpError(400, `Trip ID ${current.journeyPlanId} is system generated and cannot be overwritten.`, { code: 'invalid' });
    if (incoming.journeyPlanId !== undefined && !current && E.TRIP_ID_RE.test(String(incoming.journeyPlanId || ''))) throw new HttpError(400, 'Trip IDs in the JMG-TRP format are generated by the system, not typed.', { code: 'invalid' });
    if (incoming.milestones !== undefined && current) { const prev = current.milestones || {}; for (const [k, v] of Object.entries(incoming.milestones || {})) { if (prev[k] === v) continue; const why = P.milestoneError(Object.assign({}, prev, incoming.milestones), k, v); if (why) throw new HttpError(400, why, { code: 'invalid' }); } }
    const next = Object.assign({}, current || {}, { id: params.id });
    for (const k of protectedKeys) {
      if (incoming[k] === undefined) continue; // absent keys are left unchanged (partial updates allowed)
      const defaults = { invoiceStatus: 'Not Invoiced', paymentStatus: 'Not Paid', returnWaybill: '', vatTreatment: 'exclusive', internalClient: false };
      const before = current ? current[k] : defaults[k], after = incoming[k];
      const changed = JSON.stringify(before === undefined || before === null ? '' : before) !== JSON.stringify(after === undefined || after === null ? '' : after);
      if (changed && !allowed.has(k) && user.role !== 'admin') throw new HttpError(403, `Your role cannot change "${k}".`, { code: 'forbidden' });
      if (incoming[k] !== undefined) next[k] = incoming[k];
    }
    for (const k of ['source', 'xlRow', 'invoiceStatusRaw']) if (incoming[k] !== undefined && next[k] === undefined) next[k] = incoming[k];
    next.sellingPrice = E.num(next.sellingPrice); next.advance = E.num(next.advance);
    const asset = E.assetFor(next.plate, store.list('assets')); if (asset) { next.assetCode = asset.assetCode; next.vehicleType = asset.vehicleType; next.vehicleCategory = asset.vehicleCategory; next.costCenter = asset.costCenter; }
    if (!current || current.plate !== next.plate || current.dateDispatched !== next.dateDispatched || !next.truckBatch) next.truckBatch = E.batchOn(asset, next.dateDispatched);
    if (!next.vatTreatment) next.vatTreatment = 'exclusive';
    if (next.journeyPlanId) next.journeyPlanId = E.clean(next.journeyPlanId).toUpperCase();
    if (E.clean(next.waybill) && !next.waybillEnteredAt) next.waybillEnteredAt = nowISO(); if (!E.clean(next.waybill)) next.waybillEnteredAt = '';
    if (next.allocationId && (!current || current.allocationId !== next.allocationId)) { const a = store.doc('allocations', next.allocationId); const why = P.allocationLinkError(a, next.id, { split: a && a.split }); if (why && a) throw new HttpError(409, why, { code: 'linked', tripLogId: a.tripLogId }); }
    const tripIdChanged = !!next.journeyPlanId && !(current && E.norm(current.journeyPlanId) === E.norm(next.journeyPlanId));
    const errors = E.validateTrip(next, { assets: store.list('assets'), trips: tripIdChanged ? store.trips() : [], planning: store.doc('meta', 'planning') || {}, current }); if (errors.length) throw new HttpError(400, errors.join(' '), { code: 'invalid', errors });
    const ts = nowISO(); if (!current) { next.createdAt = ts; next.createdBy = user.username; } next.updatedAt = ts; next.updatedBy = user.username; next.version = Number(current ? current.version : 0) + 1;
    const changes = diff(current, next); next.history = [...(current && current.history || []), { ts, user: user.name, changes }].slice(-40);
    const label = `${next.client} · ${next.plate} · ${next.dateDispatched}`;
    db.exec('BEGIN'); try {
      store.putTrip(next); store.audit(auditEntry(user, current ? 'update' : 'create', 'trip', next.id, label, changes));
      // allocation chain: the trip created from an allocation marks it Deployed and carries the Trip ID back
      if (next.allocationId) { const a = store.doc('allocations', next.allocationId); if (a && (a.tripLogId !== next.id || (next.journeyPlanId && a.tripId !== next.journeyPlanId))) { const na = Object.assign({}, a, { tripLogId: next.id, status: a.status === 'Planned' ? 'Deployed' : a.status, updatedAt: ts, updatedBy: user.username, version: Number(a.version || 1) + 1 }); if (next.journeyPlanId && a.tripId !== next.journeyPlanId) { na.tripId = next.journeyPlanId; na.tripIdAt = ts; na.tripIdBy = user.username; } store.putDoc('allocations', na); store.audit(auditEntry(user, 'update', 'allocations', na.id, `${na.id} linked to trip`, diff(a, na))); } }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return next;
  },
  /** Convert an approved allocation into a trip: the trip is built here from the allocation record (no re-keying) and the Trip ID is generated inside the transaction. */
  'POST /api/trips/from-allocation': (req, res, body) => {
    const user = requireUser(req); requireAction(user, 'trip.fromPlanning');
    const a = store.doc('allocations', String((body && body.allocationId) || '')); const split = !!(body && body.split);
    const why = P.allocationLinkError(a, null, { split }); if (why) throw new HttpError(a ? 409 : 404, why, { code: 'linked', tripLogId: a && a.tripLogId });
    if (split) { requireAction(user, 'allocation.split'); if (!E.clean(body.reason)) throw new HttpError(400, 'A reason is required to split an allocation.', { code: 'invalid' }); }
    const request = store.doc('requests', a.requestId || '') || null; const ts = nowISO(); const routes = store.list('routes'); const planning = store.doc('meta', 'planning') || {};
    if (request) { const rv = P.routeValidation(request, routes); if (!rv.ok) throw new HttpError(409, rv.message + ' No Trip ID can be generated until the route is approved.', { code: 'route' }); if (!P.isTpl(request) && !(request.plan && request.plan.approvedAt)) throw new HttpError(409, `Request ${request.id} has no approved fleet plan; the allocation cannot become a trip.`, { code: 'plan' }); }
    const route = P.findRoute(routes, a.routeId) || (request ? P.routeFor(request, routes) : null); const truck = store.list('fleet').find((x) => P.plateKey(x.plate) === P.plateKey(a.plate)) || null;
    const dateDispatched = (body && body.dateDispatched) || a.plannedDeploymentDate || a.plannedLoadingDate || ts.slice(0, 10);
    db.exec('BEGIN');
    const tripId = store.nextTripId(dateDispatched.slice(0, 4));
    const next = P.tripFromAllocation(Object.assign({}, a, { driver: a.driver || (truck ? truck.driver : '') }), request, { dateDispatched, split, note: split ? `Split from ${a.id}: ${E.clean(body.reason)}` : '', tripId, route, planning, now: ts });
    next.id = 't-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'); if (split) next.allocationSplit = true;
    const asset = E.assetFor(next.plate, store.list('assets')); if (asset) { next.assetCode = asset.assetCode; next.vehicleType = asset.vehicleType; next.vehicleCategory = asset.vehicleCategory; next.costCenter = asset.costCenter; } if (!next.truckBatch) next.truckBatch = E.batchOn(asset, next.dateDispatched);
    const errors = E.validateTrip(next, { assets: store.list('assets'), trips: store.trips(), planning }); if (errors.length) { db.exec('ROLLBACK'); throw new HttpError(400, errors.join(' '), { code: 'invalid', errors }); }
    next.createdAt = ts; next.createdBy = user.username; next.updatedAt = ts; next.updatedBy = user.username; next.version = 1; next.history = [{ ts, user: user.name, changes: [{ field: 'source', from: '', to: `Fleet Planning ${a.id}` }, { field: 'journeyPlanId', from: '', to: tripId }] }];
    try {
      store.putTrip(next); store.audit(auditEntry(user, 'create', 'trip', next.id, `${next.client} · ${next.plate} · ${next.dateDispatched} (from ${a.id}, Trip ID ${tripId})`, diff(null, next)));
      const na = Object.assign({}, a, { updatedAt: ts, updatedBy: user.username, version: Number(a.version || 1) + 1 });
      if (split) { na.split = true; na.splitTripIds = [...(a.splitTripIds || []), next.id]; na.splitReason = E.clean(body.reason); na.splitBy = user.username; na.splitAt = ts; } else { na.tripLogId = next.id; na.tripId = tripId; na.tripIdAt = ts; na.tripIdBy = 'system'; if (na.status === 'Planned') na.status = 'Deployed'; }
      store.putDoc('allocations', na); store.audit(auditEntry(user, 'update', 'allocations', na.id, split ? `${na.id} split: second trip ${next.id}` : `${na.id} linked to trip ${next.id}`, diff(a, na)));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return next;
  },
  /** 3PL assignment: one trip per unit with generated Trip IDs; selling price and approved contractor cost from the request. */
  'POST /api/trips/tpl': (req, res, body) => {
    const user = requireUser(req); requireAction(user, 'tpl.manage');
    const r = store.doc('requests', String((body && body.requestId) || '')); const t = (r && r.tpl) || {}; const routes = store.list('routes'); const planning = store.doc('meta', 'planning') || {};
    if (!r || !P.isTpl(r)) throw new HttpError(404, '3PL request not found');
    const rv = P.routeValidation(r, routes); if (!rv.ok) throw new HttpError(409, rv.message + ' No Trip ID can be generated until the route is approved.', { code: 'route' });
    if (!t.costApprovedAt || !t.contractorId) throw new HttpError(409, 'The Operations Manager must approve the contractor cost before trips are created.', { code: 'plan' });
    if (store.trips().some((x) => x.requestId === r.id && !x.cancelledAt)) throw new HttpError(409, `Request ${r.id} already has trips.`, { code: 'linked' });
    const n = Math.max(1, Number(r.trucks) || 1); const ts = nowISO(); const date = (body && body.dateDispatched) || r.loadingDate || ts.slice(0, 10); const target = rv.route ? P.routeTiming(rv.route, planning).tat : null; const assets = store.list('assets'); const asset = assets.find((a) => /third/i.test(a.plate)) || null; const out = [];
    db.exec('BEGIN'); try {
      for (let i = 0; i < n; i++) {
        const tripId = store.nextTripId(date.slice(0, 4)); const plate = (body && body.plates && E.clean(body.plates[i])) || (asset ? asset.plate : 'THIRD-PARTY');
        const trip = { id: 't-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), dateDispatched: date, dateDelivered: '', plate, client: r.client, contractType: t.equipmentType || r.vehicleType || '', loadingFrom: r.loadingFrom, loadingTo: r.destination, journeyPlanId: tripId, tripIdSource: 'generated', waybill: '', returnWaybill: '', invoiceStatus: 'Not Invoiced', sellingPrice: E.num(t.sellingPrice), vatTreatment: 'exclusive', quoteNo: '', soNo: '', manualInvoiceNo: '', paymentStatus: 'Not Paid', advance: null, note: `3PL · ${t.contractorName} · ${t.equipmentType || ''}`, requestId: r.id, requestReference: r.reference || '', serviceType: '3rd Party Contractor', contractorId: t.contractorId, contractorName: t.contractorName, contractorPlate: plate, contractorCost: E.num(t.approvedCost), routeMasterId: rv.route ? rv.route.id : '', tatTargetDays: target, opsStatus: 'Open', milestones: { allocatedAt: ts }, events: [], source: '3pl', truckBatch: '3rd Party', createdAt: ts, createdBy: user.username, updatedAt: ts, updatedBy: user.username, version: 1 };
        const a = E.assetFor(plate, assets); if (a) { trip.assetCode = a.assetCode; trip.vehicleType = a.vehicleType; trip.vehicleCategory = a.vehicleCategory; trip.costCenter = a.costCenter; }
        trip.history = [{ ts, user: user.name, changes: [{ field: 'source', from: '', to: `3PL ${r.id}` }, { field: 'journeyPlanId', from: '', to: tripId }] }];
        store.putTrip(trip); store.audit(auditEntry(user, 'create', 'trip', trip.id, `${trip.client} · ${plate} · ${date} (3PL ${r.id}, Trip ID ${tripId})`, diff(null, trip))); out.push(trip);
      }
      const nr = Object.assign({}, r, { tpl: Object.assign({}, t, { assignmentStatus: 'Assigned', assignedAt: ts, assignedBy: user.username, tripIds: out.map((x) => x.journeyPlanId) }), updatedAt: ts, updatedBy: user.username, version: Number(r.version || 1) + 1 });
      store.putDoc('requests', nr); store.audit(auditEntry(user, 'update', 'requests', r.id, `${r.id} assigned to ${t.contractorName}: ${out.map((x) => x.journeyPlanId).join(', ')}`, diff(r, nr)));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { trips: out };
  },
  /** Credit note: billing's authorised correction. The trips' payment position is adjusted here, atomically, so the finance-only field rule does not apply. */
  'POST /api/invoices/:id/credit-note': (req, res, body, url, params) => {
    const user = requireUser(req); requireAction(user, 'invoice.manage');
    const inv = store.doc('invoices', params.id); const amount = E.round2(E.num(body && body.amount) || 0); const reason = E.clean(body && body.reason);
    if (!inv || inv.type === 'credit') throw new HttpError(404, 'Invoice not found'); if (inv.status === 'Void' || inv.status === 'Draft') throw new HttpError(400, 'Credit notes apply to issued or sent invoices; void a draft instead.', { code: 'invalid' }); if (!reason) throw new HttpError(400, 'A reason is required.', { code: 'invalid' });
    const settings = store.settings(); const invoices = store.list('invoices'); const assets = store.list('assets');
    const computed = store.trips().filter((t) => t.invoiceId === inv.id).map((t) => E.computeTrip(t, { settings, assets, rates: [], invoices }));
    const alloc = E.creditNoteAllocation(inv, computed, amount);
    if (!(amount > 0) || amount > alloc.balance + 0.005) throw new HttpError(400, `Enter an amount between 0.01 and the invoice balance (${alloc.balance}).`, { code: 'invalid' });
    const rate = inv.vatRate || E.vatRateOf(settings); const sp = E.vatSplit(amount, rate, 'inclusive'); const ts = nowISO();
    const number = 'CN-' + inv.number + '-' + String(invoices.filter((i) => i.type === 'credit' && i.againstId === inv.id).length + 1).padStart(2, '0');
    const cn = { id: 'cn-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), type: 'credit', number, againstId: inv.id, againstNumber: inv.number, client: inv.client, invoiceDate: ts.slice(0, 10), amount, net: sp.net, vatAmount: sp.vat, vatRate: rate, reason, issuedAt: ts, issuedBy: user.username, status: 'Issued', tripIds: alloc.touched.map((x) => x.trip.id), createdAt: ts, createdBy: user.username, updatedAt: ts, updatedBy: user.username, version: 1 };
    const payment = { id: 'pay-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), kind: 'credit', client: inv.client, invoiceId: inv.id, amount, date: ts.slice(0, 10), method: 'Credit note', reference: number, notes: reason, tripIds: cn.tripIds, recordedBy: user.username, createdAt: ts, createdBy: user.username, updatedAt: ts, updatedBy: user.username, version: 1 };
    db.exec('BEGIN'); try {
      store.putDoc('invoices', cn); store.audit(auditEntry(user, 'create', 'invoices', cn.id, `${number} · credit ${amount} against ${inv.number} · ${reason}`, diff(null, cn)));
      for (const x of alloc.touched) { const cur = store.trip(x.trip.id); const next = Object.assign({}, cur, x.patch, { updatedAt: ts, updatedBy: user.username, version: Number(cur.version || 1) + 1 }); const ch = diff(cur, next); next.history = [...(cur.history || []), { ts, user: user.name, changes: ch }].slice(-40); store.putTrip(next); store.audit(auditEntry(user, 'update', 'trip', next.id, `${next.client} · ${next.plate} · ${next.dateDispatched} (credit note ${number})`, ch)); }
      store.putDoc('payments', payment); store.audit(auditEntry(user, 'create', 'payments', payment.id, `${number} applied to ${inv.number}`, diff(null, payment)));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { creditNote: cn, payment, applied: alloc.applied };
  },
  /** Road distance between two points from the routing service (when configured); the administrator still approves it. */
  'GET /api/routing/distance': async (req, res, body, url) => {
    const user = requireUser(req); requireAction(user, 'distance.manage');
    if (!DISTANCE_ROUTER) throw new HttpError(404, 'No routing service configured on this server (set OSRM_URL).', { code: 'unavailable' });
    const from = url.searchParams.get('from'), to = url.searchParams.get('to'); const pt = (s) => { const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(s || ''); return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null; };
    const a = pt(from), b = pt(to); if (!a || !b) throw new HttpError(400, 'from and to must be lat,lng');
    const r = await fetch(`${DISTANCE_ROUTER}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new HttpError(502, 'Routing service error ' + r.status);
    const j = await r.json(); const m = j.routes && j.routes[0]; if (!m) throw new HttpError(502, 'No route found');
    return { km: Math.round(m.distance / 1000), minutes: Math.round(m.duration / 60), source: DISTANCE_ROUTER };
  },
  'DELETE /api/trips/:id': (req, res, body, url, params) => { const user = requireUser(req); requireAction(user, 'trip.delete'); const cur = store.trip(params.id); if (!cur) throw new HttpError(404, 'Trip not found'); db.exec('BEGIN'); try { store.delTrip(params.id); store.audit(auditEntry(user, 'delete', 'trip', params.id, `${cur.client} · ${cur.plate} · ${cur.dateDispatched}`, [])); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return { ok: true }; },
  'POST /api/trips/bulk': (req, res, body) => {
    const user = requireUser(req); requireAction(user, 'trip.import'); const trips = (body && body.trips) || []; if (!Array.isArray(trips) || trips.length > 20000) throw new HttpError(400, 'Invalid import');
    const assets = store.list('assets'); const out = []; const ts = nowISO();
    db.exec('BEGIN'); try {
      for (const raw of trips) { const t = Object.assign({}, raw); t.id = t.id || 'imp-' + crypto.randomBytes(6).toString('hex'); const a = E.assetFor(t.plate, assets); if (a) { t.assetCode = a.assetCode; t.vehicleType = a.vehicleType; t.vehicleCategory = a.vehicleCategory; t.costCenter = a.costCenter; } t.truckBatch = E.batchOn(a, t.dateDispatched); if (!t.vatTreatment) t.vatTreatment = 'exclusive'; t.sellingPrice = E.num(t.sellingPrice); t.advance = E.num(t.advance); const errors = E.validateTrip(t, {}); if (errors.length) continue; t.version = 1; t.createdAt = t.createdAt || ts; t.createdBy = user.username; t.updatedAt = ts; t.updatedBy = user.username; t.source = t.source || 'import'; store.putTrip(t); out.push(t); }
      store.audit(auditEntry(user, 'import', 'trip', 'bulk', `${out.length} trips imported`, [])); db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { trips: out };
  },
  'PUT /api/:collection/:id': (req, res, body, url, params) => {
    const user = requireUser(req); const c = params.collection; if (!COLLECTIONS.includes(c)) throw new HttpError(404, 'Unknown collection');
    requireCollection(user, c);
    const current = store.doc(c, params.id); const incoming = Object.assign({}, body || {}, { id: params.id }); const ts0 = nowISO();
    if (current && incoming.version !== undefined && Number(incoming.version) !== Number(current.version) + 1 && Number(incoming.version) !== Number(current.version)) throw new HttpError(409, 'This record was changed by someone else.', { code: 'conflict', current });
    const next = Object.assign({}, current || {}, incoming);
    if (c === 'users') { if (current) { next.hash = current.hash; next.salt = current.salt; } else { if (!incoming.hash || !incoming.salt) throw new HttpError(400, 'New users need a password'); } if (current && current.username === user.username && next.active === false) throw new HttpError(400, 'You cannot disable your own account.'); }
    if (c === 'allocations' && next.status !== 'Cancelled' && next.plannedLoadingDate && next.backOnGround) { const clash = P.bookingConflicts(next.plate, next.plannedLoadingDate, next.backOnGround, store.list('allocations'), next.id); if (clash.length && !incoming.allowDoubleBooking) throw new HttpError(409, `${next.plate} is already allocated to ${clash[0].client} (${clash[0].id}) over these days.`, { code: 'double_booking', conflicts: clash.map((x) => x.id) }); }
    if (c === 'allocations' && next.tripId && (!current || current.tripId !== next.tripId)) { next.tripId = E.clean(next.tripId).toUpperCase(); const other = store.list('allocations').find((a) => a.id !== next.id && a.tripId && a.tripId.toUpperCase() === next.tripId); const dupTrip = E.findDuplicateTripId(next.tripId, store.trips(), next.tripLogId || null); if (other || dupTrip) throw new HttpError(409, `Trip ID ${next.tripId} is already in use.`, { code: 'duplicate' }); }
    if (c === 'fleet' && current && incoming.status !== undefined && incoming.status !== current.status) { next.statusAt = incoming.statusAt || ts0; next.statusBy = user.username; }
    const blank = (v) => (v === undefined || v === null || v === '' ? '' : v); const changedF = (k) => JSON.stringify(blank(current ? current[k] : undefined)) !== JSON.stringify(blank(next[k]));
    // diesel requests and road expense slips: approvals and issues are role-checked field by field
    if (c === 'dieselreqs' || c === 'roadslips') {
      if (!current) { requireAction(user, 'dispatch.prepare'); if ((next.issues || []).length) throw invalid('A new document cannot carry issues or payments.'); }
      else {
        if (changedF('opsApprovedAt') || changedF('rejectedAt') || changedF('approvedQty') || changedF('supplementary')) requireAction(user, 'dispatch.approve');
        if (changedF('financeApprovedAt')) requireAction(user, 'dispatch.finance');
        if (changedF('issues') || changedF('actualConsumed') || changedF('closedAt')) requireAction(user, 'dispatch.issue');
        const prev = current.issues || []; const now = next.issues || []; if (now.length > prev.length) { if (now.length - prev.length > 1) throw invalid('Record one issue at a time.'); const x = now[prev.length]; const why = D.slipIssueError(Object.assign({}, current, { issues: prev }), x.qty, x.supplementaryId); if (why) throw new HttpError(409, why, { code: 'issue_refused' }); }
        if (changedF('approvedQty') && num(current.approvedQty) !== num(next.approvedQty) && num(next.budgetQty) !== num(next.approvedQty) && !E.clean(next.adjustmentReason)) throw invalid('An adjustment to the calculated allowance needs a reason.');
      }
    }
    // additional trip expenses: planner / station supervisor raise on an open trip; only the Operations Manager decides; finance pays
    if (c === 'extraexpenses') {
      if (!current) { requireAction(user, 'expense.request'); const trip = store.trip(next.tripLogId); const why = D.expenseRequestError(trip, store.list('extraexpenses'), next); if (why) throw new HttpError(409, why, { code: 'invalid' }); if (next.status !== 'Pending Approval') throw invalid('A new request starts as Pending Approval.'); }
      else { const why = D.expenseTransitionError(current, next, user.role); if (why) throw new HttpError(403, why, { code: 'forbidden' }); }
    }
    // client requests: route validation gates submission and planning approval; stage owners
    if (c === 'requests') {
      if (!current || changedF('client') || changedF('loadingFrom') || changedF('destination') || changedF('trucks') || changedF('serviceType') || changedF('loadingDate')) requireAction(user, 'request.manage');
      if (changedF('plan')) requireAction(user, 'plan.approve');
      if (changedF('cancellationApprovedAt')) requireAction(user, 'allocation.release');
      if (next.tpl && current && current.tpl && (JSON.stringify(current.tpl.approvedCost) !== JSON.stringify(next.tpl.approvedCost) || current.tpl.costApprovedAt !== next.tpl.costApprovedAt)) requireAction(user, 'tpl.approve');
      const rv = P.routeValidation(next, store.list('routes'));
      if (!rv.ok && next.submittedAt && !(current && current.submittedAt) && !incoming.allowUnmapped) throw new HttpError(409, rv.message + ' The request is kept as Pending Route Mapping.', { code: 'route' });
      if (!rv.ok && next.plan && next.plan.approvedAt && !(current && current.plan && current.plan.approvedAt)) throw new HttpError(409, rv.message + ' Planning approval is blocked until the route is approved.', { code: 'route' });
      next.routeApproved = rv.ok; if (rv.route && !next.routeMasterId) next.routeMasterId = rv.route.id;
    }
    // allocations (stage 3): within the approved plan, right category, approved route; generated Trip IDs never overwritten
    if (c === 'allocations') {
      if (!current && !incoming.system) { const request = store.doc('requests', next.requestId || '') || null; const routes = store.list('routes'); const route = P.findRoute(routes, next.routeId); const truck = store.list('fleet').find((x) => P.plateKey(x.plate) === P.plateKey(next.plate)) || null; const ctx = { planning: store.doc('meta', 'planning') || {}, routes, allocations: store.list('allocations'), trips: store.trips() }; const why = P.allocationGuard(request, truck, route, ctx, { override: !!incoming.override && E.can(user.role, 'plan.override'), adding: 1 }); if (why) throw new HttpError(409, why, { code: 'plan' }); }
      if (current && !incoming.system && (P.plateKey(next.plate) !== P.plateKey(current.plate) || E.norm(next.vehicleType || '') !== E.norm(current.vehicleType || ''))) { const request = store.doc('requests', next.requestId || '') || null; const routes = store.list('routes'); const why = P.allocationSubstitutionError(next, request, store.list('fleet').find((x) => P.plateKey(x.plate) === P.plateKey(next.plate)) || null, P.findRoute(routes, next.routeId), { planning: store.doc('meta', 'planning') || {} }, { override: !!incoming.override && E.can(user.role, 'plan.override') }); if (why) throw new HttpError(409, why, { code: 'plan' }); }
      if (current && next.tripId && current.tripId && next.tripId !== current.tripId && E.TRIP_ID_RE.test(current.tripId)) throw invalid(`Trip ID ${current.tripId} is system generated and cannot be overwritten.`);
      delete next.system; delete next.override;
    }
    if (c === 'invoices' && current && next.type !== 'credit') {
      const ov = next.docOverride || {}, cov = current.docOverride || {}; const changedOv = JSON.stringify(ov) !== JSON.stringify(cov);
      if (changedOv) { if (ov.opsAt !== cov.opsAt) requireAction(user, 'invoice.override.ops'); if (ov.financeAt !== cov.financeAt) requireAction(user, 'invoice.override.finance'); for (const k of Object.keys(incoming)) if (!['id', 'docOverride', 'version', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'].includes(k) && JSON.stringify(incoming[k]) !== JSON.stringify(current[k])) requireAction(user, 'invoice.manage'); }
      else requireAction(user, 'invoice.manage');
      if (next.status === 'Issued' && current.status !== 'Issued') { const settings = store.settings(); const planning = store.doc('meta', 'planning') || {}; const clients = store.list('clients'); const trips = store.trips().filter((t) => t.invoiceId === current.id); const notReady = trips.filter((t) => !E.billingReadiness(t, { setup: Object.assign({}, P.setupOf(planning), { requireDeliveryConfirmation: !!settings.requireDeliveryConfirmation }), client: clients.find((x) => E.norm(x.name) === E.norm(t.client)) || null }).ready); if (notReady.length && !(ov.opsAt && ov.financeAt)) throw new HttpError(409, `${notReady.length} trip(s) on ${current.number} lack mandatory billing documents. Issue is blocked without the Operations Manager + Finance override.`, { code: 'documents' }); }
    }
    if (c === 'routes' && next.status === 'Approved' && !(current && current.status === 'Approved')) { requireAction(user, 'route.manage'); next.approvedAt = next.approvedAt || ts0; next.approvedBy = user.username; }
    if (c === 'meta' && params.id === 'planning' && !E.can(user.role, 'settings.manage')) { const allowed = ['lastFmrUpdate', 'lastFmrUpdateBy', 'lastFmrUpdateRows', 'lastFmrUpdateFile', 'version', 'id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy']; for (const k of Object.keys(incoming)) if (!allowed.includes(k) && JSON.stringify(incoming[k]) !== JSON.stringify(current ? current[k] : undefined)) throw new HttpError(403, 'Only administrators change planning settings; the tracking team may only stamp the FMR update.', { code: 'forbidden' }); }
    if (c === 'distances' && next.verified && !(current && current.verified)) { next.verifiedBy = user.username; next.verifiedAt = ts0; }
    if (c === 'waybilldocs' && typeof next.data === 'string' && next.data.length > 700000) throw new HttpError(413, 'Waybill file too large (limit ~500 KB).');
    const ts = ts0; if (!current) { next.createdAt = next.createdAt || ts; next.createdBy = user.username; } next.updatedAt = ts; next.updatedBy = user.username; next.version = Number(current ? current.version : 0) + 1;
    db.exec('BEGIN'); try { store.putDoc(c, next); if (c !== 'meta' || params.id === 'planning') store.audit(auditEntry(user, current ? 'update' : 'create', c, next.id, next.name || next.number || next.plate || next.id, diff(current, next))); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    return c === 'users' ? Object.assign({}, next, { hash: undefined, salt: undefined }) : next;
  },
  'DELETE /api/:collection/:id': (req, res, body, url, params) => { const user = requireUser(req); const c = params.collection; if (!COLLECTIONS.includes(c)) throw new HttpError(404, 'Unknown collection'); if (c === 'requests') throw new HttpError(400, 'Client requests are never deleted; cancel them instead.', { code: 'invalid' }); requireCollection(user, c); const cur = store.doc(c, params.id); db.exec('BEGIN'); try { store.delDoc(c, params.id); store.audit(auditEntry(user, 'delete', c, params.id, cur ? cur.name || cur.number || cur.plate || params.id : params.id, [])); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return { ok: true }; },
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
