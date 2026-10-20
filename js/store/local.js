/* Local store: everything lives in this browser's localStorage. Used when the page is opened without a server or the
 * shared database. Seeds itself from data/workbook/*.json when those files can be fetched. */
(function () {
  'use strict';
  const U = HB.U;
  const KEY = 'hb_local_v1';

  class LocalStore extends HB.BaseStore {
    constructor() { super(); this.mode = 'local'; this.live = false; }
    async init(progress) {
      const saved = U.storage.get(KEY, null);
      if (saved) { this._load(saved); return; }
      progress && progress('Loading the workbook data…');
      try {
        const OBJ = ['zones', 'planning', 'locationmaster', 'accountmap', 'routezones'];
        const [trips, assets, clients, locations, rates, zones, fleet, routes, requests, allocations, planning, distances, locationmaster, contractors, quotes, staff, costcenters, lob, accounts, items, suppliers, ratecard, tplrates, accountmap, routezones] = await Promise.all(['trips', 'assets', 'clients', 'locations', 'rates', 'zones', 'fleet', 'routes', 'requests', 'allocations', 'planning', 'distances', 'locationmaster', 'contractors', 'quotes', 'staff', 'costcenters', 'lob', 'accounts', 'items', 'suppliers', 'ratecard', 'tplrates', 'accountmap', 'routezones'].map((n) => fetch(`data/workbook/${n}.json`).then((r) => (r.ok ? r.json() : (OBJ.includes(n) ? {} : []))).catch(() => (OBJ.includes(n) ? {} : []))));
        this.state.distances = distances || []; this.state.locationMaster = locationmaster || {}; this.state.contractors = contractors || []; this.state.quotes = quotes || []; this.state.staff = staff || []; this.state.costcenters = costcenters || []; this.state.lob = lob || []; this.state.accounts = accounts || []; this.state.items = items || []; this.state.suppliers = suppliers || []; this.state.ratecard = ratecard || []; this.state.tplrates = tplrates || []; this.state.accountmap = accountmap || {}; this.state.routezones = routezones || {};
        for (const [n, key] of [['turnaround', 'turnaround'], ['auditpolicy', 'auditpolicy'], ['ratecomparison', 'ratecomparison'], ['triplog_reconciliation', 'triplogReconciliation']]) { try { const r = await fetch(`data/workbook/${n}.json`); if (r.ok) this.state[key] = await r.json(); } catch (e) { /* offline */ } }
        for (const t of trips) this.state.trips.set(t.id, t);
        this.state.assets = assets.map((a) => Object.assign({ id: a.plate }, a));
        this.state.clients = clients; this.state.locations = locations; this.state.zones = zones || {};
        this.state.fleet = fleet || []; this.state.routes = routes || []; this.state.requests = requests || []; this.state.allocations = allocations || []; this.state.planning = planning || {};
        this.state.rates = rates.length ? rates : (HB.sampleRates ? HB.sampleRates() : []);
      } catch (e) { console.warn('seed data not available', e); }
      await this.ensureDemoUsers();
      this._persist();
    }
    _load(s) {
      this.state.settings = Object.assign({}, HB.DEFAULT_SETTINGS, s.settings || {});
      for (const c of HB.COLLECTIONS) this.state[c] = s[c] || [];
      this.state.locations = s.locations || []; this.state.zones = s.zones || {}; this.state.audit = s.audit || []; this.state.planning = s.planning || {}; this.state.locationMaster = s.locationMaster || {};
      this.state.trips = new Map((s.trips || []).map((t) => [t.id, t]));
    }
    _persist() {
      const s = { settings: this.state.settings, locations: this.state.locations, zones: this.state.zones, planning: this.state.planning, locationMaster: this.state.locationMaster, audit: this.state.audit.slice(-2000), trips: [...this.state.trips.values()] };
      for (const c of HB.COLLECTIONS) s[c] = this.state[c];
      U.storage.set(KEY, s);
    }
    async login(username, password) { const u = await this.verifyLogin(username, password); if (!u) throw new Error('Wrong username or password.'); this.user = this.publicUser(u); U.storage.set('hb_session', { username: u.username }); return this.user; }
    async resume() { const s = U.storage.get('hb_session'); if (!s) return null; const u = this.state.users.find((x) => x.username === s.username && x.active !== false); this.user = this.publicUser(u); return this.user; }
    async logout() { this.user = null; U.storage.del('hb_session'); }
    async writeTrip(trip) { this.state.trips.set(trip.id, trip); this._persist(); this.emit({ type: 'trip', id: trip.id }); }
    async removeTrip(id) { this.state.trips.delete(id); this._persist(); this.emit({ type: 'trip', id }); }
    async writeDoc(collection, id, data) { this.applyDoc(collection, id, data); this._persist(); this.emit({ type: collection, id }); }
    async removeDoc(collection, id) { this.removeFromState(collection, id); this._persist(); this.emit({ type: collection, id }); }
    async writeAudit(entry) { this.state.audit.push(entry); this._persist(); }
    async fetchAudit(limit) { return this.state.audit.slice(-(limit || 300)).reverse(); }
    async bulkWriteTrips(trips) { for (const t of trips) this.state.trips.set(t.id, t); this._persist(); this.emit({ type: 'trips' }); }
    async resetAll() { U.storage.del(KEY); }
  }
  HB.LocalStore = LocalStore;

})();
