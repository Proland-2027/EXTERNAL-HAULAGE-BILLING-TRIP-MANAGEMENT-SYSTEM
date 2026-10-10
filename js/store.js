/*
 * store.js — Persistence (browser localStorage) + id helpers + import/export.
 * The whole dataset is one JSON document; Data → Export gives you a backup you can re-import.
 */
(function (root) {
  'use strict';
  const KEY = 'ehb.billing.v1';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) { console.warn('Could not read saved data, starting fresh', e); }
    const fresh = root.Seed.build();
    save(fresh);
    return fresh;
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.error('Could not save data', e); }
  }
  function migrate(db) {
    db.version = db.version || 1;
    db.settings = db.settings || {};
    ['routes', 'contractors', 'priceLists', 'trips', 'billings'].forEach((k) => { if (!Array.isArray(db[k])) db[k] = []; });
    return db;
  }
  function reset() {
    localStorage.removeItem(KEY);
    return load();
  }
  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  }
  function exportJson(db) {
    return JSON.stringify(db, null, 2);
  }
  function importJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.trips)) throw new Error('Not a valid export file');
    const db = migrate(parsed);
    save(db);
    return db;
  }
  root.Store = { KEY, load, save, reset, uid, exportJson, importJson };
})(typeof self !== 'undefined' ? self : this);
