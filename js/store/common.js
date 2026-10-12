/* Base store: in-memory state, computed trips, auditing and conflict checks. Adapters implement the primitive I/O. */
(function () {
  'use strict';
  const E = HB.engine, U = HB.U;

  const COLLECTIONS = ['clients', 'assets', 'rates', 'invoices', 'payments', 'users'];
  const DEMO_USERS = [
    { username: 'admin', name: 'Adaeze Okonkwo', role: 'admin', password: 'Admin@2026' },
    { username: 'ops', name: 'Musa Bello', role: 'operations', password: 'Ops@2026' },
    { username: 'billing', name: 'Funke Adeyemi', role: 'billing', password: 'Billing@2026' },
    { username: 'finance', name: 'Chidi Nwosu', role: 'finance', password: 'Finance@2026' },
    { username: 'manager', name: 'Ibrahim Lawal', role: 'management', password: 'Manager@2026' },
  ];
  const DEFAULT_SETTINGS = { company: 'JMG Limited', companyShort: 'JMG', address: '', phone: '', email: '', website: '', tin: '', rcNumber: '', logo: '', vatRate: 0.075, paymentTermsDays: 7, bankName: '', accountName: '', accountNumber: '', invoiceNote: 'Thank you for your business.', currency: 'NGN' };

  class BaseStore {
    constructor() {
      this.mode = 'base'; this.live = false; this.user = null; this.listeners = new Set();
      this.state = { settings: Object.assign({}, DEFAULT_SETTINGS), clients: [], assets: [], rates: [], trips: new Map(), invoices: [], payments: [], users: [], locations: [], zones: {}, audit: [] };
      this._computed = null;
    }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(evt) { this._computed = null; for (const fn of this.listeners) { try { fn(evt || {}); } catch (e) { console.error(e); } } }

    // ---------- derived data
    ctx() { return { settings: this.state.settings, assets: this.state.assets, rates: this.state.rates, zones: this.state.zones, clients: this.state.clients }; }
    trips() {
      if (!this._computed) { const ctx = this.ctx(); this._computed = [...this.state.trips.values()].filter((t) => !t._del).map((t) => E.computeTrip(t, ctx)); }
      return this._computed;
    }
    trip(id) { const t = this.state.trips.get(id); return t && !t._del ? E.computeTrip(t, this.ctx()) : null; }
    raw(id) { return this.state.trips.get(id) || null; }
    clientNames() { return this.state.clients.filter((c) => c.active !== false).map((c) => c.name).sort((a, b) => a.localeCompare(b)); }
    locationNames() { const set = new Set(this.state.locations); for (const t of this.state.trips.values()) { if (t.loadingFrom) set.add(t.loadingFrom); if (t.loadingTo) set.add(t.loadingTo); } return [...set].sort((a, b) => a.localeCompare(b)); }

    // ---------- auth helpers (client-side verification for local/artifact modes)
    async verifyLogin(username, password) {
      const u = this.state.users.find((x) => x.username.toLowerCase() === String(username).trim().toLowerCase());
      if (!u || u.active === false) return null;
      const hash = await U.hashPassword(password, u.salt);
      return hash === u.hash ? u : null;
    }
    publicUser(u) { return u ? { id: u.id || u.username, username: u.username, name: u.name, role: u.role } : null; }
    async makeUser({ username, name, role, password, active }) {
      const salt = U.randomSalt(); const hash = await U.hashPassword(password, salt);
      return { id: username.toLowerCase(), username: username.toLowerCase(), name, role, salt, hash, active: active !== false, createdAt: U.nowISO() };
    }
    async ensureDemoUsers() {
      if (this.state.users.length) return false;
      for (const d of DEMO_USERS) { const u = await this.makeUser(d); await this.writeDoc('users', u.id, u); }
      return true;
    }

    // ---------- auditing
    diff(before, after, fields) {
      const changes = [];
      const keys = fields || [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((k) => !['version', 'updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'history', 'agreedCandidates', 'agreedRate', '_del'].includes(k));
      for (const k of keys) {
        const a = before ? before[k] : undefined, b = after ? after[k] : undefined;
        const na = a === undefined || a === null ? '' : a, nb = b === undefined || b === null ? '' : b;
        if (JSON.stringify(na) !== JSON.stringify(nb)) changes.push({ field: k, from: na, to: nb });
      }
      return changes;
    }
    auditEntry({ action, entity, entityId, label, changes }) {
      return { id: U.id('a'), ts: U.nowISO(), user: this.user ? this.user.username : 'system', userName: this.user ? this.user.name : 'System', role: this.user ? this.user.role : '', action, entity, entityId, label: label || '', changes: changes || [] };
    }
    checkConflict(current, expectedVersion) {
      if (current && expectedVersion !== undefined && expectedVersion !== null && Number(current.version || 0) !== Number(expectedVersion)) {
        const err = new Error('This record was changed by someone else while you were editing.'); err.code = 'conflict'; err.current = current; throw err;
      }
    }
    stamp(obj, isNew) {
      const now = U.nowISO(), who = this.user ? this.user.username : 'system';
      if (isNew) { obj.createdAt = obj.createdAt || now; obj.createdBy = obj.createdBy || who; }
      obj.updatedAt = now; obj.updatedBy = who; obj.version = Number(obj.version || 0) + 1;
      return obj;
    }

    // ---------- high-level operations (adapters provide writeTrip / writeDoc / removeTrip / removeDoc / writeAudit)
    async saveTrip(input, opts) {
      opts = opts || {};
      const current = input.id ? this.state.trips.get(input.id) : null;
      this.checkConflict(current, opts.expectedVersion);
      const trip = Object.assign({}, current || {}, input);
      if (!trip.id) trip.id = U.id('t');
      for (const k of ['vat', 'billing', 'amountPaid', 'balance', 'total', 'month', 'tripStatus', 'agreedStatus', 'agreedRate', 'agreedPrice', 'agreedCandidates', 'variance', 'variancePct', 'direction']) delete trip[k];
      trip.sellingPrice = E.num(trip.sellingPrice); trip.advance = E.num(trip.advance);
      const asset = E.assetFor(trip.plate, this.state.assets);
      if (asset) { trip.assetCode = asset.assetCode; trip.vehicleType = asset.vehicleType; trip.vehicleCategory = asset.vehicleCategory; trip.costCenter = asset.costCenter; }
      // Truck Batch is snapshotted on the trip so history stays accurate if the vehicle is reclassified later.
      if (!current || current.plate !== trip.plate || current.dateDispatched !== trip.dateDispatched || !trip.truckBatch) trip.truckBatch = E.batchOn(asset, trip.dateDispatched);
      if (!trip.vatTreatment) trip.vatTreatment = 'exclusive';
      const errors = E.validateTrip(trip, this.ctx()); if (errors.length && !opts.force) { const err = new Error(errors.join(' ')); err.code = 'invalid'; err.errors = errors; throw err; }
      this.stamp(trip, !current);
      const changes = this.diff(current, trip);
      const entry = this.auditEntry({ action: current ? 'update' : 'create', entity: 'trip', entityId: trip.id, label: `${trip.client} · ${trip.plate} · ${trip.dateDispatched}`, changes });
      trip.history = [...(current && current.history || []), { ts: entry.ts, user: entry.userName, changes }].slice(-40);
      await this.writeTrip(trip, current);
      await this.writeAudit(entry);
      return trip;
    }
    async deleteTrip(id) {
      const current = this.state.trips.get(id); if (!current) return;
      await this.removeTrip(id, current);
      await this.writeAudit(this.auditEntry({ action: 'delete', entity: 'trip', entityId: id, label: `${current.client} · ${current.plate} · ${current.dateDispatched}`, changes: [] }));
    }
    async saveDoc(collection, doc, opts) {
      opts = opts || {};
      const list = this.state[collection]; const current = list ? list.find((x) => x.id === doc.id) : null;
      this.checkConflict(current, opts.expectedVersion);
      const next = Object.assign({}, current || {}, doc); if (!next.id) next.id = U.id(collection.slice(0, 2));
      this.stamp(next, !current);
      await this.writeDoc(collection, next.id, next);
      if (!opts.silent) await this.writeAudit(this.auditEntry({ action: current ? 'update' : 'create', entity: collection, entityId: next.id, label: opts.label || next.name || next.number || next.id, changes: this.diff(current, next).filter((c) => !['hash', 'salt'].includes(c.field)) }));
      return next;
    }
    async deleteDoc(collection, id, label) {
      await this.removeDoc(collection, id);
      await this.writeAudit(this.auditEntry({ action: 'delete', entity: collection, entityId: id, label: label || id, changes: [] }));
    }
    async saveSettings(settings) {
      const before = this.state.settings; const next = Object.assign({}, before, settings); this.stamp(next, !before.version);
      await this.writeDoc('settings', 'main', next);
      await this.writeAudit(this.auditEntry({ action: 'update', entity: 'settings', entityId: 'main', label: 'Settings', changes: this.diff(before, next) }));
      return next;
    }
    async saveLocations(list) { await this.writeDoc('meta', 'locations', { list }); }
    async saveZones(map) { await this.writeDoc('meta', 'zones', { map }); await this.writeAudit(this.auditEntry({ action: 'update', entity: 'settings', entityId: 'zones', label: 'Location zones', changes: [{ field: 'zones', from: '', to: Object.keys(map).length + ' entries' }] })); }

    // apply a document coming from storage into state
    applyDoc(collection, id, data) {
      if (collection === 'settings') { this.state.settings = Object.assign({}, DEFAULT_SETTINGS, data || {}); return; }
      if (collection === 'meta') { if (id === 'locations') this.state.locations = (data && data.list) || []; if (id === 'zones') this.state.zones = (data && data.map) || {}; return; }
      if (collection === 'tripchunks') { for (const [tid, t] of Object.entries((data && data.trips) || {})) { if (t && t._del) this.state.trips.delete(tid); else if (t) this.state.trips.set(tid, t); } return; }
      if (collection === 'trips') { if (!data || data._del) this.state.trips.delete(id); else this.state.trips.set(id, data); return; }
      if (!this.state[collection]) return;
      const list = this.state[collection]; const i = list.findIndex((x) => x.id === id);
      if (!data) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = data; else list.push(data);
    }
    removeFromState(collection, id) { if (collection === 'trips') this.state.trips.delete(id); else if (this.state[collection]) { const i = this.state[collection].findIndex((x) => x.id === id); if (i >= 0) this.state[collection].splice(i, 1); } }
  }

  HB.BaseStore = BaseStore; HB.COLLECTIONS = COLLECTIONS; HB.DEMO_USERS = DEMO_USERS; HB.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})();
