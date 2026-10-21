/*
 * store.js — Persistence for the Trip Log.
 *  - Connected mode: the dataset is one JSON document stored on the server (`/api/haulage/state`) and shared by every
 *    signed-in user; saves carry a version number so two people cannot overwrite each other silently.
 *  - Offline / static mode (opened from GitHub Pages or a file): browser localStorage, exactly as before.
 */
(function (root) {
  'use strict';
  const KEY = 'ehb.billing.v1';
  const API = String(root.PP_API_BASE || '/api').replace(/\/+$/, '');
  const sync = { mode: 'local', version: 0, user: null, perms: [], lastError: null, savedAt: null };

  async function api(method, path, body) {
    const res = await fetch(API + path, { method, headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let data = null; try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) { const err = new Error((data && data.error) || `HTTP ${res.status}`); err.status = res.status; err.details = data && data.details; throw err; }
    return data;
  }

  /** Try the shared server first; fall back to local storage. Returns the dataset. */
  async function loadAsync() {
    try {
      const me = await api('GET', '/auth/me');
      if (me && me.user) {
        sync.user = me.user; sync.perms = me.user.perms || [];
        const r = await api('GET', '/haulage/state');
        sync.mode = 'server'; sync.version = r.version || 0;
        if (r.state) return migrate(r.state);
        const fresh = migrate(root.Seed.build());
        await saveAsync(fresh, { action: 'SEED', id: null });
        return fresh;
      }
      if (me && !me.user) { sync.mode = 'login-required'; }
    } catch (e) { sync.mode = 'local'; sync.lastError = e.message; }
    return load();
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { console.warn('Could not read saved data, starting fresh', e); }
    const fresh = migrate(root.Seed.build());
    save(fresh);
    return fresh;
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.error('Could not save data', e); }
  }
  /** Save to the server (connected mode) and mirror locally. audit = {action, id, ...} is written to the server audit trail. */
  async function saveAsync(db, audit) {
    save(db);
    if (sync.mode !== 'server') return { mode: sync.mode };
    try {
      const r = await api('PUT', '/haulage/state', { state: db, version: sync.version, audit });
      sync.version = r.version; sync.savedAt = new Date().toISOString(); sync.lastError = null;
      return { mode: 'server', version: r.version };
    } catch (e) {
      sync.lastError = e.message;
      if (e.status === 409) { const err = new Error('Another user changed the Trip Log. Reloading the latest data…'); err.conflict = true; throw err; }
      throw e;
    }
  }
  function migrate(db) {
    db.version = db.version || 1;
    db.settings = db.settings || {};
    ['routes', 'contractors', 'priceLists', 'trips', 'billings', 'customers', 'clientRateCards'].forEach((k) => { if (!Array.isArray(db[k])) db[k] = []; });
    if (db.version < 2) {
      // upgrade older datasets: add the demo customers / rate cards so the agreed-price comparison has something to work with
      const demo = root.Seed.build();
      if (!db.customers.length) db.customers = demo.customers;
      if (!db.clientRateCards.length) db.clientRateCards = demo.clientRateCards;
      db.version = 2;
    }
    return db;
  }
  function reset() {
    localStorage.removeItem(KEY);
    return migrate(root.Seed.build());
  }
  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  }
  function exportJson(db) { return JSON.stringify(db, null, 2); }
  function importJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.trips)) throw new Error('Not a valid export file');
    const db = migrate(parsed);
    save(db);
    return db;
  }
  const can = (perm) => sync.mode !== 'server' || sync.perms.includes(perm);
  root.Store = { KEY, sync, load, loadAsync, save, saveAsync, reset, uid, exportJson, importJson, can };
})(typeof self !== 'undefined' ? self : this);
