/*
 * store.js — Persistence for the Trip Log.
 * Default: browser localStorage (open index.html directly, as before).
 * Optional: when the page is served by a host that exposes GET/PUT /api/triplog/state (and /api/me for the
 * signed-in user), the same document is shared live between all users of that host.
 */
(function (root) {
  'use strict';
  const KEY = 'ehb.billing.v1';
  const api = { online: false, version: 0, user: null, canWrite: true, canApprove: true, lastError: null };

  function migrate(db) {
    db.version = db.version || 1;
    db.settings = db.settings || {};
    ['routes', 'contractors', 'clients', 'clientRateCards', 'priceLists', 'trips', 'billings'].forEach((k) => { if (!Array.isArray(db[k])) db[k] = []; });
    return db;
  }
  function readLocal() { try { const raw = localStorage.getItem(KEY); return raw ? migrate(JSON.parse(raw)) : null; } catch (e) { return null; } }
  function writeLocal(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* quota / private mode */ } }

  /** Synchronous load (static/offline use). */
  function load() { const local = readLocal(); if (local) return local; const fresh = root.Seed.build(); writeLocal(fresh); return fresh; }

  /** Preferred: load from the server; falls back to local storage. Resolves { db, online }. */
  async function loadAsync() {
    try {
      const me = await fetch('/api/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null));
      if (me && me.user) { api.user = me.user; api.canWrite = !!(me.permissions && me.permissions['triplog.write']); api.canApprove = !!(me.permissions && me.permissions['triplog.approve']); }
      else if (me) { api.user = null; return { db: load(), online: false, needLogin: true }; }
      const r = await fetch('/api/triplog/state', { credentials: 'same-origin' });
      if (r.status === 401) return { db: load(), online: false, needLogin: true };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      api.online = true; api.version = data.version || 0;
      let db = data.state ? migrate(data.state) : null;
      if (!db) { db = root.Seed.build(); await save(db); }
      writeLocal(db);
      return { db, online: true };
    } catch (e) { api.lastError = e.message; return { db: load(), online: false }; }
  }
  let pending = null;
  async function save(db) {
    writeLocal(db);
    if (!api.online) return;
    // serialize saves; keep the latest document
    pending = db;
    if (save.inflight) return;
    save.inflight = true;
    try {
      while (pending) {
        const doc = pending; pending = null;
        const r = await fetch('/api/triplog/state', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: doc, version: api.version }) });
        if (r.status === 409) { const j = await r.json().catch(() => ({})); api.conflict = true; if (root.onStoreConflict) root.onStoreConflict(j); return; }
        if (!r.ok) { const j = await r.json().catch(() => ({})); api.lastError = j.error || `HTTP ${r.status}`; if (root.onStoreError) root.onStoreError(api.lastError); return; }
        const j = await r.json(); api.version = j.version;
      }
    } finally { save.inflight = false; }
  }
  function reset() { localStorage.removeItem(KEY); const fresh = root.Seed.build(); save(fresh); return fresh; }
  function uid(prefix) { return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase(); }
  function exportJson(db) { return JSON.stringify(db, null, 2); }
  function importJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.trips)) throw new Error('Not a valid export file');
    const db = migrate(parsed); save(db); return db;
  }
  root.Store = { KEY, api, load, loadAsync, save, reset, uid, exportJson, importJson, migrate };
})(typeof self !== 'undefined' ? self : this);
