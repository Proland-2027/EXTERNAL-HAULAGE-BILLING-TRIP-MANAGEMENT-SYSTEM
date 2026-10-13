/* Base store: in-memory state, computed trips, auditing and conflict checks. Adapters implement the primitive I/O. */
(function () {
  'use strict';
  const E = HB.engine, P = HB.planning, U = HB.U; const clean = E.clean;

  const COLLECTIONS = ['clients', 'assets', 'rates', 'invoices', 'payments', 'users', 'fleet', 'routes', 'requests', 'allocations', 'waybilldocs', 'lostsales', 'distances', 'dispatches'];
  const DEMO_USERS = [
    { username: 'admin', name: 'Adaeze Okonkwo', role: 'admin', password: 'Admin@2026' },
    { username: 'ops', name: 'Musa Bello', role: 'operations', password: 'Ops@2026' },
    { username: 'billing', name: 'Funke Adeyemi', role: 'billing', password: 'Billing@2026' },
    { username: 'finance', name: 'Chidi Nwosu', role: 'finance', password: 'Finance@2026' },
    { username: 'manager', name: 'Ibrahim Lawal', role: 'management', password: 'Manager@2026' },
    { username: 'tracking', name: 'Ngozi Eze', role: 'tracking', password: 'Tracking@2026' },
    { username: 'planner', name: 'Tunde Bakare', role: 'planning', password: 'Planner@2026' },
  ];
  const DEFAULT_SETTINGS = { company: 'JMG Limited', companyShort: 'JMG', address: '', phone: '', email: '', website: '', tin: '', rcNumber: '', logo: '', vatRate: 0.075, paymentTermsDays: 7, bankName: '', accountName: '', accountNumber: '', invoiceNote: 'Thank you for your business.', currency: 'NGN' };

  class BaseStore {
    constructor() {
      this.mode = 'base'; this.live = false; this.user = null; this.listeners = new Set();
      this.state = { settings: Object.assign({}, DEFAULT_SETTINGS), clients: [], assets: [], rates: [], trips: new Map(), invoices: [], payments: [], users: [], locations: [], zones: {}, audit: [], fleet: [], routes: [], requests: [], allocations: [], waybilldocs: [], lostsales: [], distances: [], dispatches: [], planning: {}, locationMaster: {} };
      this._computed = null;
    }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(evt) { this._computed = null; for (const fn of this.listeners) { try { fn(evt || {}); } catch (e) { console.error(e); } } }

    // ---------- derived data
    ctx() { const self = this; return { settings: this.state.settings, assets: this.state.assets, rates: this.state.rates, zones: this.state.zones, clients: this.state.clients, invoices: this.state.invoices, planning: this.state.planning, stateOf: HB.geo ? (n) => self.stateOf(n) : null }; }
    /** Context for the fleet-planning engine (FMR, planner, runway, KPIs). */
    planningCtx() { return { planning: this.state.planning, routes: this.state.routes, fleet: this.state.fleet, requests: this.state.requests, allocations: this.state.allocations, trips: this.trips(), invoices: this.state.invoices, setup: P ? P.setupOf(this.state.planning) : {}, today: U.todayISO(), now: U.nowISO() }; }
    planningSetup() { return P ? P.setupOf(this.state.planning) : {}; }
    /** Context for the dispatch engine (distances, consumption matrix, dispatch records, lost sales, location master). */
    dispatchCtx() { return Object.assign(this.planningCtx(), { assets: this.state.assets, rates: this.state.rates, zones: this.state.zones, clients: this.state.clients, distances: this.state.distances, dispatches: this.state.dispatches, lostsales: this.state.lostsales, locationMaster: this.state.locationMaster, settings: this.state.settings }); }
    dispatchSetup() { return HB.dispatch ? HB.dispatch.setupOf(this.state.planning) : {}; }
    /** Standardised state for a location name (Location Master first, then the gazetteer). */
    stateOf(name) { return HB.geo ? HB.geo.standardize(name, this.state.locationMaster).state : ''; }
    async saveLocationMaster(map, label) {
      const before = this.state.locationMaster || {}; const next = Object.assign({}, map, { id: 'locationmaster' }); const n = Object.keys(next).filter((k) => k !== 'id').length;
      await this.writeDoc('meta', 'locationmaster', next);
      await this.writeAudit(this.auditEntry({ action: 'update', entity: 'settings', entityId: 'locationmaster', label: label || 'Location Master', changes: [{ field: 'entries', from: Object.keys(before).length, to: n }] }));
      return next;
    }
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
      if (trip.journeyPlanId) trip.journeyPlanId = E.clean(trip.journeyPlanId).toUpperCase();
      if (clean(trip.waybill) && !trip.waybillEnteredAt) trip.waybillEnteredAt = U.nowISO();
      if (!clean(trip.waybill)) trip.waybillEnteredAt = '';
      // one allocation → one trip (unless split through the authorised workflow)
      if (trip.allocationId && this.state.allocations && (!current || current.allocationId !== trip.allocationId)) { const a = this.state.allocations.find((x) => x.id === trip.allocationId); const why = P ? P.allocationLinkError(a || null, trip.id, { split: opts.split || (a && a.split) }) : ''; if (why && a) { const err = new Error(why); err.code = 'linked'; err.tripLogId = a.tripLogId; throw err; } }
      // Trip IDs come from Power Apps: validate the format and reject duplicates across the Trip Log
      const errors = E.validateTrip(trip, Object.assign(this.ctx(), { trips: [...this.state.trips.values()], current })); if (errors.length && !opts.force) { const err = new Error(errors.join(' ')); err.code = 'invalid'; err.errors = errors; throw err; }
      this.stamp(trip, !current);
      const changes = this.diff(current, trip);
      const entry = this.auditEntry({ action: current ? 'update' : 'create', entity: 'trip', entityId: trip.id, label: `${trip.client} · ${trip.plate} · ${trip.dateDispatched}`, changes });
      trip.history = [...(current && current.history || []), { ts: entry.ts, user: entry.userName, changes }].slice(-40);
      await this.writeTrip(trip, current);
      await this.writeAudit(entry);
      // keep the allocation chain in step: a trip created from an allocation marks it Deployed and carries the Trip ID back
      // a split second leg never takes over the allocation link or its Trip ID; the first trip keeps them
      if (trip.allocationId && !trip.allocationSplit && this.state.allocations && !this.serverLinksAllocations) { const a = this.state.allocations.find((x) => x.id === trip.allocationId); if (a && (!a.tripLogId || a.tripLogId === trip.id) && (a.tripLogId !== trip.id || (trip.journeyPlanId && a.tripId !== trip.journeyPlanId))) { const patch = { id: a.id, tripLogId: trip.id }; if (a.status === 'Planned') patch.status = 'Deployed'; if (trip.journeyPlanId && a.tripId !== trip.journeyPlanId) { patch.tripId = trip.journeyPlanId; patch.tripIdAt = U.nowISO(); patch.tripIdBy = this.user ? this.user.username : 'system'; } try { await this.saveDoc('allocations', patch, { expectedVersion: a.version, label: `${a.id} linked to trip` }); } catch (e) { console.warn('allocation link failed', e); } } }
      return trip;
    }
    /**
     * Select from Fleet Planning: build the Trip Log entry from the allocation (no re-keying), link it, mark the
     * allocation Deployed. split = authorised second trip for one allocation (allocation.split right, reason recorded).
     */
    async createTripFromAllocation(allocationId, opts) {
      opts = opts || {}; const a = this.state.allocations.find((x) => x.id === allocationId);
      if (!this.user || !E.can(this.user.role, 'trip.fromPlanning')) { const err = new Error('Your role cannot create trips from Fleet Planning.'); err.code = 'forbidden'; throw err; }
      const why = P.allocationLinkError(a || null, null, { split: opts.split }); if (why) { const err = new Error(why); err.code = 'linked'; err.tripLogId = a && a.tripLogId; throw err; }
      if (opts.split) { if (!E.can(this.user.role, 'allocation.split')) { const err = new Error('Splitting an allocation needs the planning or administrator role.'); err.code = 'forbidden'; throw err; } if (!E.clean(opts.reason)) { const err = new Error('A reason is required to split an allocation.'); err.code = 'invalid'; throw err; } }
      const request = this.state.requests.find((r) => r.id === a.requestId) || null;
      const draft = P.tripFromAllocation(a, request, { dateDispatched: opts.dateDispatched, split: !!opts.split, note: opts.split ? `Split from ${a.id}: ${E.clean(opts.reason)}` : '' });
      if (opts.split) { draft.allocationSplit = true; }
      const trip = await this.saveTrip(draft, { split: !!opts.split });
      if (opts.split) await this.saveDoc('allocations', { id: a.id, split: true, splitTripIds: [...(a.splitTripIds || []), trip.id], splitReason: E.clean(opts.reason), splitBy: this.user.username, splitAt: U.nowISO() }, { expectedVersion: this.state.allocations.find((x) => x.id === a.id).version, label: `${a.id} split: second trip ${trip.id}` });
      return trip;
    }
    /** Credit note (authorised correction): numbered CN-…, applied to the invoice's trips, recorded in the ledger. */
    async issueCreditNote(invoiceId, amount, reason) {
      if (!this.user || !E.can(this.user.role, 'invoice.manage')) { const err = new Error('Only the billing team or an administrator can issue credit notes.'); err.code = 'forbidden'; throw err; }
      const inv = this.state.invoices.find((i) => i.id === invoiceId); amount = E.round2(E.num(amount) || 0); reason = E.clean(reason);
      if (!inv || inv.type === 'credit') { const err = new Error('Invoice not found.'); err.code = 'invalid'; throw err; }
      if (inv.status === 'Void' || inv.status === 'Draft') { const err = new Error('Credit notes apply to issued or sent invoices; void a draft instead.'); err.code = 'invalid'; throw err; }
      if (!reason) { const err = new Error('A reason is required.'); err.code = 'invalid'; throw err; }
      const alloc = E.creditNoteAllocation(inv, this.trips(), amount);
      if (!(amount > 0) || amount > alloc.balance + 0.005) { const err = new Error(`Enter an amount between ₦0.01 and the invoice balance (${alloc.balance}).`); err.code = 'invalid'; throw err; }
      const rate = inv.vatRate || E.vatRateOf(this.state.settings); const sp = E.vatSplit(amount, rate, 'inclusive'); const now = U.nowISO();
      const number = 'CN-' + inv.number + '-' + String(this.state.invoices.filter((i) => i.type === 'credit' && i.againstId === inv.id).length + 1).padStart(2, '0');
      const cn = { id: U.id('cn'), type: 'credit', number, againstId: inv.id, againstNumber: inv.number, client: inv.client, invoiceDate: U.todayISO(), amount, net: sp.net, vatAmount: sp.vat, vatRate: rate, reason, issuedAt: now, issuedBy: this.user.username, status: 'Issued', tripIds: alloc.touched.map((x) => x.trip.id) };
      await this.saveDoc('invoices', cn, { label: `${cn.number} · credit ${amount} against ${inv.number} · ${reason}` });
      for (const x of alloc.touched) await this.saveTrip(Object.assign({ id: x.trip.id }, x.patch), { expectedVersion: this.raw(x.trip.id).version, force: true });
      await this.saveDoc('payments', { id: U.id('pay'), kind: 'credit', client: inv.client, invoiceId: inv.id, amount, date: U.todayISO(), method: 'Credit note', reference: cn.number, notes: reason, tripIds: cn.tripIds, recordedBy: this.user.username }, { label: `${cn.number} applied to ${inv.number}` });
      return cn;
    }
    /** Planning settings (statuses, repositioning rules, thresholds) live in meta/planning. */
    async savePlanning(patch) {
      const before = this.state.planning || {}; const next = Object.assign({}, before, patch, { id: 'planning' }); this.stamp(next, !before.version);
      await this.writeDoc('meta', 'planning', next);
      await this.writeAudit(this.auditEntry({ action: 'update', entity: 'settings', entityId: 'planning', label: 'Fleet planning settings', changes: this.diff(before, next) }));
      return next;
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
      // a truck is never promised to two requests over the same days (the server applies the same rule)
      if (collection === 'allocations' && P && next.status !== 'Cancelled' && next.plannedLoadingDate && next.backOnGround && !opts.allowDoubleBooking) { const clash = P.bookingConflicts(next.plate, next.plannedLoadingDate, next.backOnGround, this.state.allocations, next.id); if (clash.length) { const err = new Error(`${next.plate} is already allocated to ${clash[0].client} (${clash[0].id}) over these days.`); err.code = 'double_booking'; err.conflicts = clash.map((x) => x.id); throw err; } }
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
      if (collection === 'meta') { if (id === 'locations') this.state.locations = (data && data.list) || []; if (id === 'zones') this.state.zones = (data && data.map) || {}; if (id === 'planning') this.state.planning = data || {}; if (id === 'locationmaster') { const m = Object.assign({}, data || {}); delete m.id; this.state.locationMaster = m; } return; }
      if (collection === 'tripchunks') { for (const [tid, t] of Object.entries((data && data.trips) || {})) { if (t && t._del) this.state.trips.delete(tid); else if (t) this.state.trips.set(tid, t); } return; }
      if (collection === 'trips') { if (!data || data._del) this.state.trips.delete(id); else this.state.trips.set(id, data); return; }
      if (!this.state[collection]) return;
      const list = this.state[collection]; const i = list.findIndex((x) => x.id === id);
      if (!data) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = data; else list.push(data);
      if (collection === 'clients' || collection === 'rates') this.state[collection] = list.slice(); // new identity: lookup caches rebuild
    }
    removeFromState(collection, id) { if (collection === 'trips') this.state.trips.delete(id); else if (this.state[collection]) { const i = this.state[collection].findIndex((x) => x.id === id); if (i >= 0) this.state[collection].splice(i, 1); if (collection === 'clients' || collection === 'rates') this.state[collection] = this.state[collection].slice(); } }
  }

  HB.BaseStore = BaseStore; HB.COLLECTIONS = COLLECTIONS; HB.DEMO_USERS = DEMO_USERS; HB.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})();
