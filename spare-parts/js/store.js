/*
 * store.js — persistence for the spare parts system.
 * Structured data (requests, suppliers, RFQs, purchase orders, settings) is one JSON document in
 * localStorage. Photographs are large, so they live in IndexedDB (see photos.js).
 * Data → Export backup bundles both into one JSON file that Import backup restores.
 */
(function (root) {
  'use strict';
  const KEY = 'darco.spares.v1';
  const S = root.Spares;

  function defaults() {
    return {
      company: 'DARCO JMG', companyAddress: 'Lagos, Nigeria', country: 'Nigeria', destination: 'Lagos, Nigeria',
      procurementContact: 'Procurement Department', procurementPhone: '', procurementEmail: '', procurementWhatsApp: '',
      baseCurrency: 'USD', localCurrency: 'NGN', rates: { USD: 1, RMB: 0.14, NGN: 0.00065, EUR: 1.08 },
      requestPrefix: 'DARCO-SP-', poPrefix: 'DARCO-PO-', pdfNote: 'Please confirm compatibility, best price, availability and delivery time. Please attach a photo of the offered part.',
      categories: S.DEFAULT_CATEGORIES.slice(), units: S.DEFAULT_UNITS.slice(), truckMakes: S.DEFAULT_MAKES.slice(), departments: ['Workshop A', 'Workshop B', 'Tipper Fleet', 'Tanker Fleet'],
      requesters: [],
    };
  }
  function migrate(db) {
    db.version = db.version || 1;
    db.settings = Object.assign(defaults(), db.settings || {});
    db.settings.rates = Object.assign({ USD: 1 }, db.settings.rates || {});
    ['trucks', 'requests', 'suppliers', 'rfqs', 'purchaseOrders'].forEach((k) => { if (!Array.isArray(db[k])) db[k] = []; });
    db.requests.forEach((r) => { r.photos = Array.isArray(r.photos) ? r.photos : []; r.status = r.status || 'NEW'; });
    db.purchaseOrders.forEach((po) => { po.shipment = po.shipment || {}; po.history = po.history || []; po.lines = po.lines || []; });
    db.rfqs.forEach((q) => { q.status = q.status || 'SENT'; });
    return db;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) { console.warn('Could not read saved data, starting fresh', e); }
    const fresh = migrate(root.Seed.build());
    save(fresh);
    return fresh;
  }
  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch (e) { console.error('Could not save data', e); return false; }
  }
  function reset() { localStorage.removeItem(KEY); return load(); }
  function uid(prefix) { return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase(); }
  /** Backup = data + every photo (as data URLs). */
  async function exportJson(db) {
    const photos = await root.Photos.all();
    return JSON.stringify({ app: 'darco-spare-parts', exportedAt: new Date().toISOString(), data: db, photos }, null, 1);
  }
  async function importJson(text) {
    const parsed = JSON.parse(text);
    const data = parsed && parsed.app === 'darco-spare-parts' ? parsed.data : parsed;
    if (!data || typeof data !== 'object' || !Array.isArray(data.requests)) throw new Error('Not a valid spare parts backup file');
    const db = migrate(data);
    if (parsed.photos && typeof parsed.photos === 'object') await root.Photos.putMany(parsed.photos);
    save(db);
    return db;
  }
  root.Store = { KEY, defaults, load, save, reset, uid, exportJson, importJson, migrate };
})(typeof self !== 'undefined' ? self : this);
