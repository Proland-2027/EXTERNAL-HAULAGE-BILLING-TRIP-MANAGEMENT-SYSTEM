#!/usr/bin/env node
/*
 * index.js — application entry point.
 *   node server/index.js            start (PORT, DATA_DIR, ADMIN_PASSWORD, WP_SSO_SECRET, COOKIE_SECURE env vars)
 *   node server/index.js import <file.xlsx>   (re)import the production workbook
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { http, HttpError, createRouter, readBody, readJson, parseCookies, send, serveStatic, URL } = require('./http.js');
const { DB } = require('./db.js');
const auth = require('./auth.js');
const { interpretWorkbook } = require('./import/workbook.js');
const { loadWorkbook } = require('./import/load.js');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const cfg = {
  version: pkg.version, port: Number(process.env.PORT || 8080), host: process.env.HOST || '0.0.0.0',
  dbFile: process.env.DB_FILE || path.join(DATA_DIR, 'ppm.sqlite'), backupDir: path.join(DATA_DIR, 'backups'), uploadDir: path.join(DATA_DIR, 'uploads'),
  sourceWorkbook: process.env.SOURCE_WORKBOOK || path.join(ROOT, 'data', 'source', 'Prodction Data.xlsx'),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== '0' : process.env.NODE_ENV === 'production', ssoSecret: process.env.WP_SSO_SECRET || null,
  publicDir: path.join(ROOT, 'public'), demoUsers: process.env.SEED_DEMO_USERS !== '0',
};

function boot() {
  const db = new DB(cfg.dbFile);
  const imported = db.get("SELECT value FROM meta WHERE key='last_import'");
  if (!imported) {
    if (fs.existsSync(cfg.sourceWorkbook)) {
      console.log(`[boot] importing workbook ${cfg.sourceWorkbook} …`);
      const res = loadWorkbook(db, interpretWorkbook(fs.readFileSync(cfg.sourceWorkbook)), { filename: path.basename(cfg.sourceWorkbook) });
      console.log('[boot] imported', res.summary);
    } else console.warn('[boot] no source workbook found; import one from Admin → Data import');
  }
  const created = auth.seedUsers(db, { adminPassword: process.env.ADMIN_PASSWORD, demo: cfg.demoUsers });
  if (created.length) console.log('[boot] created users:', created.join(', '));
  auth.purgeSessions(db);
  return db;
}

function startServer(db) {
  const router = createRouter();
  const ctx = { db, cfg };
  // auth routes
  router.post('/api/login', async ({ body, req }) => {
    const u = db.get('SELECT * FROM users WHERE username = ? AND active = 1', String(body.username || '').trim().toLowerCase());
    if (!u || !auth.verifyPassword(body.password || '', u.password_hash)) { await new Promise((r) => setTimeout(r, 300)); throw new HttpError(401, 'Invalid username or password'); }
    const s = auth.createSession(db, u, req);
    db.audit({ id: u.id, username: u.username }, 'LOGIN', 'user', u.id, {});
    return { user: publicUser(u), setCookie: cookie('sid', s.id, s.exp) };
  });
  router.post('/api/logout', ({ sid, user }) => { auth.destroySession(db, sid); if (user) db.audit(user, 'LOGOUT', 'user', user.id, {}); return { ok: true, setCookie: cookie('sid', '', new Date(0).toISOString()) }; });
  router.get('/api/me', ({ user }) => ({ user: user ? publicUser(user) : null, permissions: user ? Object.fromEntries(Object.keys(auth.PERMS).map((p) => [p, auth.can(user, p)])) : {}, company: db.setting('company', 'JMG'), currency: db.setting('currency', 'NGN'), tripLogUrl: db.setting('triplog_url', '') || null, sso: !!cfg.ssoSecret }));
  require('./api/index.js')(router, ctx);

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      // WordPress single sign-on landing
      if (pathname === '/sso' && req.method === 'GET') {
        const payload = auth.verifySsoToken(url.searchParams.get('token'), cfg.ssoSecret);
        if (!payload) return send(res, 401, 'Invalid or expired single sign-on token', { 'Content-Type': 'text/plain' });
        let u = db.get('SELECT * FROM users WHERE username = ?', payload.username.toLowerCase());
        if (!u) { db.run('INSERT INTO users(username,password_hash,name,email,role,active,created_at,wp_user_id) VALUES(?,?,?,?,?,1,?,?)', payload.username.toLowerCase(), null, payload.name || payload.username, payload.email || null, payload.role, new Date().toISOString(), payload.wp_user_id || null); u = db.get('SELECT * FROM users WHERE username = ?', payload.username.toLowerCase()); }
        else if (u.role !== payload.role && payload.sync_role) { db.run('UPDATE users SET role = ? WHERE id = ?', payload.role, u.id); u.role = payload.role; }
        if (!u.active) return send(res, 403, 'Account disabled', { 'Content-Type': 'text/plain' });
        const s = auth.createSession(db, u, req);
        db.audit({ id: u.id, username: u.username }, 'LOGIN_SSO', 'user', u.id, { wp: payload.wp_user_id });
        res.writeHead(302, { Location: payload.redirect && payload.redirect.startsWith('/') ? payload.redirect : '/', 'Set-Cookie': cookie('sid', s.id, s.exp) }); return res.end();
      }
      if (pathname.startsWith('/api/')) {
        const match = router.match(req.method, pathname);
        if (!match) return send(res, 404, { error: 'Not found' });
        const cookies = parseCookies(req);
        const user = auth.userFromSession(db, cookies.sid);
        const open = pathname === '/api/login' || pathname === '/api/me';
        if (!user && !open) return send(res, 401, { error: 'Please sign in' });
        let body = {}; let raw = null;
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
          const ct = req.headers['content-type'] || '';
          if (ct.includes('application/json')) body = await readJson(req);
          else if (pathname === '/api/import') raw = await readBody(req, 100 * 1024 * 1024);
          else if (req.headers['content-length'] && Number(req.headers['content-length']) > 0) return send(res, 415, { error: 'Send application/json' });
          // CSRF: state-changing requests must come from our own origin
          const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);
          const hostOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
          if (origin && origin !== hostOrigin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return send(res, 403, { error: 'Cross-site request blocked' });
        }
        const result = await match.handler({ req, res, params: match.params, query: url.searchParams, body, raw, user, sid: cookies.sid, headers: req.headers });
        if (result && result.raw !== undefined) { return send(res, 200, result.raw, { 'Content-Type': result.contentType || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${result.filename || 'download'}"` }); }
        const headers = {};
        if (result && result.setCookie) { headers['Set-Cookie'] = result.setCookie; delete result.setCookie; }
        return send(res, 200, result === undefined ? { ok: true } : result, headers);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });
      if (pathname === '/healthz') return send(res, 200, { ok: true, version: cfg.version });
      if (pathname.startsWith('/docs/') && pathname.endsWith('.md')) return serveStatic(path.join(ROOT, 'docs'), pathname.slice(5), res) || send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      if (serveStatic(cfg.publicDir, pathname, res)) return;
      // SPA fallback
      if (!path.extname(pathname)) return serveStatic(cfg.publicDir, '/index.html', res) || send(res, 404, 'Not found');
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) console.error(`[error] ${req.method} ${req.url}`, e);
      send(res, status, { error: e.message || 'Server error', ...(e.extra || {}) });
    } finally {
      if (process.env.LOG_REQUESTS) console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
  server.listen(cfg.port, cfg.host, () => console.log(`[ready] ${db.setting('company', 'JMG')} Production Planning v${cfg.version} on http://${cfg.host}:${cfg.port} (db: ${cfg.dbFile})`));
  // scheduled backups + session purge
  let lastBackupDay = null;
  setInterval(() => {
    try {
      const now = new Date();
      const hour = db.setting('backup_hour', 2);
      const day = now.toISOString().slice(0, 10);
      if (now.getHours() === hour && lastBackupDay !== day) { lastBackupDay = day; const b = db.backup(cfg.backupDir, 'scheduled', db.setting('backup_keep', 14)); console.log('[backup]', b.file, b.bytes, 'bytes'); }
      auth.purgeSessions(db);
    } catch (e) { console.error('[backup] failed', e); }
  }, 60 * 1000).unref();
  if (!fs.existsSync(cfg.backupDir) || !fs.readdirSync(cfg.backupDir).length) { try { db.backup(cfg.backupDir, 'initial', 14); } catch (e) { console.warn('[backup] initial backup failed', e.message); } }
  return server;
}

function cookie(name, value, expIso) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expIso).toUTCString()}${cfg.cookieSecure ? '; Secure' : ''}`; }
function publicUser(u) { return { id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, roleLabel: auth.ROLE_LABELS[u.role], sections: u.sections || (u.section_codes ? JSON.parse(u.section_codes) : []) }; }

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'import') {
    const file = arg || cfg.sourceWorkbook;
    const db = new DB(cfg.dbFile);
    const res = loadWorkbook(db, interpretWorkbook(fs.readFileSync(file)), { filename: path.basename(file) });
    console.log('imported', res.summary); process.exit(0);
  } else if (cmd === 'backup') {
    const db = new DB(cfg.dbFile); console.log(db.backup(cfg.backupDir, 'manual')); process.exit(0);
  } else {
    const db = boot();
    startServer(db);
  }
}
module.exports = { boot, startServer, cfg };
