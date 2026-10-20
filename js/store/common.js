/* Base store: in-memory state, computed trips, auditing and conflict checks. Adapters implement the primitive I/O. */
(function () {
  'use strict';
  const E = HB.engine, P = HB.planning, U = HB.U; const clean = E.clean;

  const COLLECTIONS = ['clients', 'assets', 'rates', 'invoices', 'payments', 'users', 'fleet', 'routes', 'requests', 'allocations', 'waybilldocs', 'lostsales', 'distances', 'dieselreqs', 'roadslips', 'extraexpenses', 'contractors', 'quotes', 'staff', 'costcenters', 'lob', 'accounts', 'items', 'suppliers', 'ratecard', 'tplrates', 'jobcards', 'stockmoves', 'postings', 'rateexceptions', 'auditfindings'];
  // who may write each collection (the server applies the same table); field-level rules follow in saveDoc
  const COLLECTION_ACTION = { clients: 'client.manage', assets: 'asset.manage', rates: 'rate.manage', invoices: 'invoice.manage', payments: 'payment.manage', users: 'user.manage', fleet: 'fmr.update', routes: 'route.manage', requests: 'request.manage', allocations: 'allocation.manage', waybilldocs: 'trip.edit', lostsales: 'lostsales.manage', distances: 'distance.manage', dieselreqs: 'dispatch.prepare', roadslips: 'dispatch.prepare', extraexpenses: 'expense.request', contractors: 'tpl.manage', quotes: 'tpl.manage', staff: 'master.manage', costcenters: 'master.manage', lob: 'master.manage', accounts: 'master.manage', items: 'inventory.manage', suppliers: 'master.manage', ratecard: 'master.manage', tplrates: 'master.manage', jobcards: 'workshop.manage', stockmoves: 'inventory.manage', postings: 'finance.post', rateexceptions: 'exception.raise', auditfindings: 'commercial.manage' };
  // roles that may also write a collection for their own stage (e.g. the Operations Manager approves a plan on a request, billing attaches a POD)
  const COLLECTION_ALSO = { invoices: ['invoice.override.ops', 'invoice.override.finance'], requests: ['plan.approve', 'allocation.release', 'tpl.approve', 'tpl.pay'], allocations: ['plan.approve', 'allocation.release', 'request.cancel', 'trip.fromPlanning'], extraexpenses: ['expense.approve', 'expense.pay'], dieselreqs: ['dispatch.approve', 'dispatch.finance', 'dispatch.issue'], roadslips: ['dispatch.approve', 'dispatch.finance', 'dispatch.issue'], quotes: ['tpl.approve'], costcenters: ['finance.post'], accounts: ['finance.post'], tplrates: ['tpl.rate'], items: ['workshop.manage'], jobcards: ['workshop.approve', 'inventory.manage'], stockmoves: ['workshop.manage'], rateexceptions: ['exception.review', 'exception.approve'], auditfindings: ['commercial.view'] };
  const DEMO_USERS = [
    { username: 'admin', name: 'Adaeze Okonkwo', role: 'admin', password: 'Admin@2026' },
    { username: 'ops', name: 'Musa Bello', role: 'operations', password: 'Ops@2026' },
    { username: 'billing', name: 'Funke Adeyemi', role: 'billing', password: 'Billing@2026' },
    { username: 'finance', name: 'Chidi Nwosu', role: 'finance', password: 'Finance@2026' },
    { username: 'manager', name: 'Ibrahim Lawal', role: 'management', password: 'Manager@2026' },
    { username: 'tracking', name: 'Ngozi Eze', role: 'tracking', password: 'Tracking@2026' },
    { username: 'planner', name: 'Tunde Bakare', role: 'planning', password: 'Planner@2026' },
    { username: 'crm', name: 'Amaka Obi', role: 'crm', password: 'Crm@2026' },
    { username: 'station', name: 'Yusuf Danjuma', role: 'station', password: 'Station@2026' }, { username: 'supervisor', name: 'Bola Adeyinka', role: 'stationsup', password: 'Supervisor@2026' }, { username: 'tplcoord', name: 'Ngozi Eze', role: 'tplcoord', password: 'Tpl@2026' }, { username: 'workshop', name: 'Ghassan El Saifi', role: 'workshop', password: 'Workshop@2026' }, { username: 'storekeeper', name: 'Ibrahim Sule', role: 'storekeeper', password: 'Store@2026' },
  ];
  const DEFAULT_SETTINGS = { requireDeliveryConfirmation: false, company: 'JMG Limited', companyShort: 'JMG', address: '', phone: '', email: '', website: '', tin: '', rcNumber: '', logo: '', vatRate: 0.075, paymentTermsDays: 7, bankName: '', accountName: '', accountNumber: '', invoiceNote: 'Thank you for your business.', currency: 'NGN' };

  class BaseStore {
    constructor() {
      this.mode = 'base'; this.live = false; this.user = null; this.listeners = new Set();
      this.state = { settings: Object.assign({}, DEFAULT_SETTINGS), clients: [], assets: [], rates: [], trips: new Map(), invoices: [], payments: [], users: [], locations: [], zones: {}, audit: [], fleet: [], routes: [], requests: [], allocations: [], waybilldocs: [], lostsales: [], distances: [], dieselreqs: [], roadslips: [], extraexpenses: [], contractors: [], quotes: [], staff: [], costcenters: [], lob: [], accounts: [], items: [], suppliers: [], ratecard: [], tplrates: [], jobcards: [], stockmoves: [], postings: [], rateexceptions: [], auditfindings: [], turnaround: {}, auditpolicy: {}, ratecomparison: null, triplogReconciliation: null, planning: {}, locationMaster: {}, accountmap: {}, routezones: {} };
      this._computed = null;
    }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(evt) { this._computed = null; for (const fn of this.listeners) { try { fn(evt || {}); } catch (e) { console.error(e); } } }

    // ---------- derived data
    ctx() { const self = this; return { settings: this.state.settings, assets: this.state.assets, rates: this.state.rates, zones: this.state.zones, clients: this.state.clients, invoices: this.state.invoices, planning: this.state.planning, costcenters: this.state.costcenters, stateOf: HB.geo ? (n) => self.stateOf(n) : null }; }
    /** Context for the fleet-planning engine (FMR, planner, runway, KPIs). */
    planningCtx() { return { planning: this.state.planning, routes: this.state.routes, fleet: this.state.fleet, requests: this.state.requests, allocations: this.state.allocations, trips: this.trips(), invoices: this.state.invoices, quotes: this.state.quotes, contractors: this.state.contractors, setup: P ? P.setupOf(this.state.planning) : {}, today: U.todayISO(), now: U.nowISO() }; }
    planningSetup() { return P ? P.setupOf(this.state.planning) : {}; }
    /** Context for the dispatch engine (distances, consumption matrix, dispatch records, lost sales, location master). */
    dispatchCtx() { return Object.assign(this.planningCtx(), { assets: this.state.assets, rates: this.state.rates, zones: this.state.zones, clients: this.state.clients, distances: this.state.distances, dieselreqs: this.state.dieselreqs, roadslips: this.state.roadslips, extraexpenses: this.state.extraexpenses, lostsales: this.state.lostsales, locationMaster: this.state.locationMaster, settings: this.state.settings, payments: this.state.payments, staff: this.state.staff, costcenters: this.state.costcenters, lob: this.state.lob, accounts: this.state.accounts, accountmap: this.state.accountmap, items: this.state.items, suppliers: this.state.suppliers, ratecard: this.state.ratecard, tplrates: this.state.tplrates, jobcards: this.state.jobcards, stockmoves: this.state.stockmoves, postings: this.state.postings, routezones: this.state.routezones }); }
    /** Finance / workshop context (everything the dispatch context has, plus the ledger sources). */
    financeCtx() { return this.dispatchCtx(); }
    /** Everything the commercial audit needs: finance context plus the turnaround table, the control policy, the workbook baseline, exceptions and the register. */
    auditCtx() { return Object.assign(this.financeCtx(), { turnaround: this.state.turnaround, auditpolicy: this.state.auditpolicy, ratecomparison: this.state.ratecomparison, triplogReconciliation: this.state.triplogReconciliation, rateexceptions: this.state.rateexceptions, auditfindings: this.state.auditfindings, users: this.state.users }); }
    /** Billing readiness of a computed trip (mandatory documents) with the client's own document requirements. */
    readiness(trip) { const client = this.state.clients.find((c) => E.norm(c.name) === E.norm(trip.client)) || null; return E.billingReadiness(trip, { setup: Object.assign({}, this.planningSetup(), { requireDeliveryConfirmation: !!this.state.settings.requireDeliveryConfirmation }), client }); }
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
      if (current && trip.finStatus === 'Closed' && current.finStatus !== 'Closed' && HB.finance && !opts.system) { const why = HB.finance.finClosureError(this.trip(current.id), { reason: trip.finNote, extraexpenses: this.state.extraexpenses }, this.user ? this.user.role : ''); if (why) { const err = new Error(why); err.code = 'forbidden'; throw err; } trip.finClosedAt = trip.finClosedAt || U.nowISO(); trip.finClosedBy = this.user ? this.user.username : 'system'; }
      if (current && current.finStatus === 'Closed' && trip.finStatus !== 'Closed' && !opts.system && !E.can(this.user ? this.user.role : '', 'finance.close')) { const err = new Error('Only Finance reopens a financially closed trip.'); err.code = 'forbidden'; throw err; }
      const errors = E.validateTrip(trip, Object.assign(this.ctx(), { trips: [...this.state.trips.values()], current })); if (errors.length && !opts.force) { const err = new Error(errors.join(' ')); err.code = 'invalid'; err.errors = errors; throw err; }
      this.stamp(trip, !current);
      const changes = this.diff(current, trip);
      const entry = this.auditEntry({ action: current ? 'update' : 'create', entity: 'trip', entityId: trip.id, label: `${trip.client} · ${trip.plate} · ${trip.dateDispatched}`, changes });
      trip.history = [...(current && current.history || []), { ts: entry.ts, user: entry.userName, changes }].slice(-40);
      await this.writeTrip(trip, current);
      await this.writeAudit(entry);
      // keep the allocation chain in step: a trip created from an allocation marks it Deployed and carries the Trip ID back
      // a split second leg never takes over the allocation link or its Trip ID; the first trip keeps them
      if (trip.allocationId && !trip.allocationSplit && this.state.allocations && !this.serverLinksAllocations) { const a = this.state.allocations.find((x) => x.id === trip.allocationId); if (a && (!a.tripLogId || a.tripLogId === trip.id) && (a.tripLogId !== trip.id || (trip.journeyPlanId && a.tripId !== trip.journeyPlanId))) { const patch = { id: a.id, tripLogId: trip.id }; if (a.status === 'Planned') patch.status = 'Deployed'; if (trip.journeyPlanId && a.tripId !== trip.journeyPlanId) { patch.tripId = trip.journeyPlanId; patch.tripIdAt = U.nowISO(); patch.tripIdBy = 'system'; } try { await this.saveDoc('allocations', patch, { expectedVersion: a.version, system: true, label: `${a.id} linked to trip` }); } catch (e) { console.warn('allocation link failed', e); } } }
      return trip;
    }
    /**
     * Automatic Trip ID: JMG-TRP-<year>-<sequence>, never typed, never reused. The base implementation derives the next sequence
     * from the Trip Log; adapters with a central counter (server, shared database) override it. One ID per truck movement.
     */
    async nextTripId(year) {
      year = year || new Date().getUTCFullYear(); const n = E.maxTripSeq([...this.state.trips.values()], year) + 1 + (this._tripIdOffset || 0); this._tripIdOffset = (this._tripIdOffset || 0) + 1; setTimeout(() => { this._tripIdOffset = 0; }, 0);
      return E.formatTripId(year, n);
    }
    /**
     * Convert an approved allocation into a Trip Log entry: every operational field comes from the allocation and its
     * request (no re-keying), the Trip ID is generated, the allocation is linked and marked Deployed. split = authorised
     * second trip for one allocation (allocation.split right, reason recorded) with its own Trip ID.
     */
    async createTripFromAllocation(allocationId, opts) {
      opts = opts || {}; const a = this.state.allocations.find((x) => x.id === allocationId);
      if (!this.user || !E.can(this.user.role, 'trip.fromPlanning')) { const err = new Error('Your role cannot convert allocations into trips.'); err.code = 'forbidden'; throw err; }
      const why = P.allocationLinkError(a || null, null, { split: opts.split }); if (why) { const err = new Error(why); err.code = 'linked'; err.tripLogId = a && a.tripLogId; throw err; }
      if (opts.split) { if (!E.can(this.user.role, 'allocation.split')) { const err = new Error('Splitting an allocation needs the operations or administrator role.'); err.code = 'forbidden'; throw err; } if (!E.clean(opts.reason)) { const err = new Error('A reason is required to split an allocation.'); err.code = 'invalid'; throw err; } }
      const request = this.state.requests.find((r) => r.id === a.requestId) || null;
      if (request) { const rv = P.routeValidation(request, this.state.routes); if (!rv.ok) { const err = new Error(rv.message + ' No Trip ID can be generated until the route is approved.'); err.code = 'route'; throw err; } if (!P.isTpl(request) && !(request.plan && request.plan.approvedAt)) { const err = new Error(`Request ${request.id} has no approved fleet plan; the allocation cannot become a trip.`); err.code = 'plan'; throw err; } }
      const lobWhy = P.allocationLobError(Object.assign({}, a, { lob: opts.lob || a.lob }), this.state.lob); if (lobWhy) { const err = new Error(lobWhy); err.code = 'lob'; throw err; }
      const route = P.findRoute(this.state.routes, a.routeId) || (request ? P.routeFor(request, this.state.routes) : null);
      const truck = this.state.fleet.find((x) => P.plateKey(x.plate) === P.plateKey(a.plate)) || null;
      const tripId = await this.nextTripId((opts.dateDispatched || a.plannedLoadingDate || U.todayISO()).slice(0, 4));
      const draft = P.tripFromAllocation(Object.assign({}, a, { driver: a.driver || (truck ? truck.driver : ''), lob: opts.lob || a.lob }), request, { dateDispatched: opts.dateDispatched, split: !!opts.split, note: opts.split ? `Split from ${a.id}: ${E.clean(opts.reason)}` : '', tripId, route, planning: this.state.planning, now: U.nowISO() });
      if (opts.split) { draft.allocationSplit = true; }
      const trip = await this.saveTrip(draft, { split: !!opts.split, system: true });
      if (opts.split) await this.saveDoc('allocations', { id: a.id, split: true, splitTripIds: [...(a.splitTripIds || []), trip.id], splitReason: E.clean(opts.reason), splitBy: this.user.username, splitAt: U.nowISO() }, { expectedVersion: this.state.allocations.find((x) => x.id === a.id).version, system: true, label: `${a.id} split: second trip ${trip.id}` });
      return trip;
    }
    /**
     * 3PL assignment: one Trip Log entry per unit for a third-party request whose contractor cost the Operations Manager
     * approved. Each trip gets its own generated Trip ID; selling price and contractor cost come from the request; no JMG
     * diesel or road allowance applies. The request moves to Assigned.
     */
    async createTplTrips(requestId, opts) {
      opts = opts || {}; const r = this.state.requests.find((x) => x.id === requestId); const t = (r && r.tpl) || {};
      if (!this.user || !E.can(this.user.role, 'tpl.manage')) { const err = new Error('Your role cannot assign contractors.'); err.code = 'forbidden'; throw err; }
      if (!r || !P.isTpl(r)) { const err = new Error('3PL request not found.'); err.code = 'invalid'; throw err; }
      const rv = P.routeValidation(r, this.state.routes); if (!rv.ok) { const err = new Error(rv.message + ' No Trip ID can be generated until the route is approved.'); err.code = 'route'; throw err; }
      if (!t.costApprovedAt || !t.contractorId) { const err = new Error('The Operations Manager must approve the contractor cost before trips are created.'); err.code = 'plan'; throw err; }
      if (this.trips().some((x) => x.requestId === r.id && !x.cancelledAt)) { const err = new Error(`Request ${r.id} already has trips.`); err.code = 'linked'; throw err; }
      const n = Math.max(1, Number(r.trucks) || 1); const date = opts.dateDispatched || r.loadingDate || U.todayISO(); const route = rv.route; const target = route ? P.routeTiming(route, this.state.planning).tat : null; const out = [];
      const asset = this.state.assets.find((a) => /third/i.test(a.plate)) || null;
      for (let i = 0; i < n; i++) {
        const tripId = await this.nextTripId(date.slice(0, 4));
        const plate = (opts.plates && E.clean(opts.plates[i])) || (asset ? asset.plate : 'THIRD-PARTY');
        const trip = await this.saveTrip({ dateDispatched: date, dateDelivered: '', plate, client: r.client, contractType: t.equipmentType || r.vehicleType || '', loadingFrom: r.loadingFrom, loadingTo: r.destination, journeyPlanId: tripId, tripIdSource: 'generated', waybill: '', returnWaybill: '', invoiceStatus: 'Not Invoiced', sellingPrice: E.num(t.sellingPrice), vatTreatment: 'exclusive', quoteNo: '', soNo: '', manualInvoiceNo: '', paymentStatus: 'Not Paid', advance: null, note: `3PL · ${t.contractorName} · ${t.equipmentType || ''}`, requestId: r.id, requestReference: r.reference || '', lob: E.LOB_DEFAULT_3PL, finStatus: 'Open', serviceType: '3rd Party Contractor', contractorId: t.contractorId, contractorName: t.contractorName, contractorPlate: plate, contractorCost: E.num(t.approvedCost), routeMasterId: route ? route.id : '', tatTargetDays: target, opsStatus: 'Open', milestones: { allocatedAt: U.nowISO() }, events: [], source: '3pl' }, { system: true });
        out.push(trip);
      }
      await this.saveDoc('requests', { id: r.id, tpl: Object.assign({}, t, { assignmentStatus: 'Assigned', assignedAt: U.nowISO(), assignedBy: this.user.username, tripIds: out.map((x) => x.journeyPlanId) }) }, { expectedVersion: this.state.requests.find((x) => x.id === r.id).version, label: `${r.id} assigned to ${t.contractorName}: ${out.map((x) => x.journeyPlanId).join(', ')}` });
      return out;
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
      await this.saveDoc('payments', { id: U.id('pay'), kind: 'credit', client: inv.client, invoiceId: inv.id, amount, date: U.todayISO(), method: 'Credit note', reference: cn.number, notes: reason, tripIds: cn.tripIds, recordedBy: this.user.username }, { system: true, label: `${cn.number} applied to ${inv.number}` });
      return cn;
    }
    /** Planning settings (statuses, repositioning rules, thresholds) live in meta/planning. */
    /** Save a meta document (account mapping, route zones) and apply it to the state. */
    async saveMeta(id, doc, label) {
      if (!E.can(this.user ? this.user.role : '', 'settings.manage') && !(id === 'accountmap' && E.can(this.user ? this.user.role : '', 'finance.post')) && !(id === 'turnaround' && E.can(this.user ? this.user.role : '', 'commercial.manage'))) { const err = new Error('Only administrators (or Finance for the account mapping) change this setting.'); err.code = 'forbidden'; throw err; }
      const before = this.state[id] || {}; const next = Object.assign({}, doc, { id }); this.stamp(next, !before.version);
      await this.writeDoc('meta', id, next); this.applyDoc('meta', id, next);
      await this.writeAudit(this.auditEntry({ action: 'update', entity: 'settings', entityId: id, label: label || id, changes: this.diff(before, next) }));
      return next;
    }
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
      if (!opts.system && this.user && COLLECTION_ACTION[collection] && !E.can(this.user.role, COLLECTION_ACTION[collection]) && !(COLLECTION_ALSO[collection] || []).some((a) => E.can(this.user.role, a))) { const err = new Error(`Your role (${E.ROLE_LABELS[this.user.role] || this.user.role}) cannot change ${collection}.`); err.code = 'forbidden'; throw err; }
      this.checkConflict(current, opts.expectedVersion);
      const next = Object.assign({}, current || {}, doc); if (!next.id) next.id = U.id(collection.slice(0, 2));
      // a truck is never promised to two requests over the same days (the server applies the same rule)
      if (collection === 'allocations' && P && next.status !== 'Cancelled' && next.plannedLoadingDate && next.backOnGround && !opts.allowDoubleBooking) { const clash = P.bookingConflicts(next.plate, next.plannedLoadingDate, next.backOnGround, this.state.allocations, next.id); if (clash.length) { const err = new Error(`${next.plate} is already allocated to ${clash[0].client} (${clash[0].id}) over these days.`); err.code = 'double_booking'; err.conflicts = clash.map((x) => x.id); throw err; } }
      if ((collection === 'dieselreqs' || collection === 'roadslips') && HB.dispatch) this.slipGuard(current, next);
      if (collection === 'extraexpenses' && HB.dispatch) this.expenseGuard(current, next);
      if (collection === 'requests' && P) this.requestGuard(current, next, opts);
      // commercial audit before fleet allocation: blocked jobs need an approved exception; flagged jobs need the Operations Manager's recorded review
      if (collection === 'requests' && HB.audit && next.status === 'Plan Approved' && (!current || current.status !== 'Plan Approved') && !opts.system) { const actx = this.auditCtx(); const ra = HB.audit.requestAudit(next, actx, HB.audit.comparison(actx.trips, actx)); if (ra.blockers.length) { const err = new Error(ra.blockers.join(' ')); err.code = 'commercial'; err.audit = ra; throw err; } if (ra.flagged && !(next.plan && next.plan.commercialReviewedAt)) { const err = new Error('Commercial Alert: ' + ra.warnings[0] + ' Confirm the commercial review before approving the plan.'); err.code = 'commercial'; err.audit = ra; throw err; } }
      if (collection === 'rateexceptions' && HB.audit) { const role = this.user ? this.user.role : ''; const why = HB.audit.exceptionError(next, current, role, this.user ? this.user.username : '', this.state.auditpolicy); if (why) { const err = new Error(why); err.code = 'forbidden'; throw err; } Object.assign(next, HB.audit.exceptionStamp(next, current, this.user || { username: 'system', role: '' }, U.nowISO())); }
      if (collection === 'auditfindings' && HB.audit) { const why = HB.audit.findingError(next, current, this.user ? this.user.role : ''); if (why) { const err = new Error(why); err.code = 'forbidden'; throw err; } }
      if (collection === 'jobcards' && HB.workshop) { const why = HB.workshop.jobTransitionError(current, next, this.user ? this.user.role : ''); if (why) { const err = new Error(why); err.code = 'forbidden'; throw err; } if (next.status === 'Approved' && !(current && current.status === 'Approved')) { next.approvedAt = next.approvedAt || U.nowISO(); next.approvedBy = this.user ? this.user.username : 'system'; } if (next.status === 'Released' && !(current && current.status === 'Released')) { next.releasedAt = next.releasedAt || U.nowISO(); next.releasedBy = this.user ? this.user.username : 'system'; } }
      if (collection === 'stockmoves' && HB.workshop) { if (current && !opts.system) { const changed = Object.keys(next).filter((k) => !['voidedAt', 'voidedBy', 'voidReason', 'version', 'updatedAt', 'updatedBy'].includes(k) && JSON.stringify(next[k]) !== JSON.stringify(current[k])); if (changed.length) { const err = new Error('Stock movements are not edited; void the movement and record a new one.'); err.code = 'invalid'; throw err; } } else if (!current) { const item = this.state.items.find((i) => i.id === next.itemId) || null; const role = this.user ? this.user.role : ''; let why = HB.workshop.moveError(next, item, this.state.stockmoves, role); if (!why && next.type === 'issue') { const job = this.state.jobcards.find((j) => j.id === next.jobCardId) || null; why = HB.workshop.partsIssueError(job, item, next.qty, this.state.stockmoves, { allowNegative: !!next.negativeAuthorisedBy, allowDuplicate: !!next.separateIssue, requestRef: next.requestRef, now: next.at }); } if (why) { const err = new Error(why); err.code = 'invalid'; throw err; } if (item && (next.unitCost === undefined || next.unitCost === null)) next.unitCost = item.unitCost || 0; } }
      if (collection === 'postings') { if (current) { const err = new Error('Posted ledger entries are immutable; post a reversal instead.'); err.code = 'invalid'; throw err; } if (!E.can(this.user ? this.user.role : '', 'finance.post')) { const err = new Error('Only Finance posts to the ledger.'); err.code = 'forbidden'; throw err; } if (!next.glAccount || !next.costCenter) { const err = new Error('A posting needs a GL account and a cost center.'); err.code = 'invalid'; throw err; } if (this.state.postings.some((p) => p.lineId === next.lineId)) { const err = new Error(`${next.lineId} is already posted.`); err.code = 'invalid'; throw err; } }
      if (collection === 'allocations' && P) this.allocationStageGuard(current, next, opts);
      if (collection === 'invoices' && current && next.status === 'Issued' && current.status !== 'Issued' && next.type !== 'credit') { const trips = this.trips().filter((t) => t.invoiceId === current.id); const notReady = trips.filter((t) => !this.readiness(t).ready); const ov = next.docOverride || {}; if (notReady.length && !(ov.opsAt && ov.financeAt)) { const err = new Error(`${notReady.length} trip(s) on ${current.number} lack mandatory billing documents (${[...new Set(notReady.flatMap((t) => this.readiness(t).missing))].join(', ')}). Issue is blocked without the Operations Manager + Finance override.`); err.code = 'documents'; throw err; } }
      // commercial control: a price below the approved client rate (or below cost, per policy) needs a documented, approved exception before the invoice is issued
      if (collection === 'invoices' && current && next.status === 'Issued' && current.status !== 'Issued' && next.type !== 'credit' && HB.audit && !opts.system) { const actx = this.auditCtx(); const comp = HB.audit.comparison(actx.trips, actx); const covered = HB.audit.coveredByException({ invoiceId: current.id }, actx.rateexceptions); const blocked = covered ? [] : this.trips().filter((t) => t.invoiceId === current.id).map((t) => HB.audit.tripAudit(t, actx, comp)).filter((a) => a.blocksInvoice); if (blocked.length) { const err = new Error(`${blocked.length} trip(s) on ${current.number} need an approved commercial exception before issue: ${blocked.map((b) => `${b.tripId || b.tripLogId} (${b.status})`).join(', ')}. Raise the exception in Audit & Control.`); err.code = 'commercial'; err.audits = blocked; throw err; } }
      if (collection === 'invoices' && current && next.docOverride && JSON.stringify(next.docOverride) !== JSON.stringify(current.docOverride || {})) { const ov = next.docOverride, cur = current.docOverride || {}; const role = this.user ? this.user.role : ''; if (ov.opsAt !== cur.opsAt && !E.can(role, 'invoice.override.ops')) { const err = new Error('Only the Operations Manager approves the document override.'); err.code = 'forbidden'; throw err; } if (ov.financeAt !== cur.financeAt && !E.can(role, 'invoice.override.finance')) { const err = new Error('Only finance co-approves the document override.'); err.code = 'forbidden'; throw err; } }
      if (collection === 'routes' && P) { if (next.status === 'Approved' && !(current && current.status === 'Approved')) { if (!E.can(this.user ? this.user.role : '', 'route.manage')) { const err = new Error('Only the Operations Manager or an administrator approves routes.'); err.code = 'forbidden'; throw err; } next.approvedAt = next.approvedAt || U.nowISO(); next.approvedBy = this.user ? this.user.username : 'system'; } }
      if (collection === 'distances' && next.verified && !(current && current.verified)) { next.verifiedBy = this.user ? this.user.username : 'system'; next.verifiedAt = U.nowISO(); }
      this.stamp(next, !current);
      await this.writeDoc(collection, next.id, next);
      if (!opts.silent) await this.writeAudit(this.auditEntry({ action: current ? 'update' : 'create', entity: collection, entityId: next.id, label: opts.label || next.name || next.number || next.id, changes: this.diff(current, next).filter((c) => !['hash', 'salt'].includes(c.field)) }));
      return next;
    }
    /** Diesel requests and road expense slips: approvals and issues are role-checked field by field (the server applies the same rules). */
    slipGuard(current, next) {
      const D = HB.dispatch; const role = this.user ? this.user.role : ''; const blank = (v) => (v === undefined || v === null || v === '' ? '' : v); const changed = (k) => JSON.stringify(blank(current ? current[k] : undefined)) !== JSON.stringify(blank(next[k]));
      const need = (action, msg) => { if (!E.can(role, action)) { const err = new Error(msg); err.code = 'forbidden'; throw err; } };
      if (!current) { need('dispatch.prepare', 'Your role cannot prepare diesel requests or road expense slips.'); if ((next.issues || []).length) { const err = new Error('A new document cannot carry issues or payments.'); err.code = 'invalid'; throw err; } return; }
      if (changed('opsApprovedAt') || changed('rejectedAt') || changed('approvedQty') || changed('supplementary')) need('dispatch.approve', 'Only the Operations Manager or an administrator can approve, reject or adjust this document.');
      if (changed('financeApprovedAt')) need('dispatch.finance', 'Finance approval needs the finance or administrator role.');
      if (changed('issues') || changed('actualConsumed') || changed('closedAt')) need('dispatch.issue', `Recording ${next.kind === 'diesel' ? 'diesel issued' : 'road expense payments'} needs the operations, finance or administrator role.`);
      const prev = current.issues || []; const now = next.issues || [];
      if (now.length > prev.length) { if (now.length - prev.length > 1) { const err = new Error('Record one issue at a time.'); err.code = 'invalid'; throw err; } const x = now[prev.length]; const why = D.slipIssueError(Object.assign({}, current, { issues: prev }), x.qty, x.supplementaryId); if (why) { const err = new Error(why); err.code = 'issue_refused'; throw err; } }
      if (changed('approvedQty') && Number(current.approvedQty) !== Number(next.approvedQty) && Number(next.budgetQty) !== Number(next.approvedQty) && !clean(next.adjustmentReason)) { const err = new Error('An adjustment to the calculated allowance needs a reason.'); err.code = 'invalid'; throw err; }
    }
    /** Additional trip expenses: only the Operations Manager approves; only finance pays; only on an open trip. */
    expenseGuard(current, next) {
      const D = HB.dispatch; const role = this.user ? this.user.role : '';
      if (!current) { if (!E.can(role, 'expense.request')) { const err = new Error('Only a planner or station supervisor can raise additional trip expense requests.'); err.code = 'forbidden'; throw err; } const trip = this.state.trips.get(next.tripLogId); const why = D.expenseRequestError(trip || null, this.state.extraexpenses, next); if (why) { const err = new Error(why); err.code = 'invalid'; throw err; } if (next.status !== 'Pending Approval') { const err = new Error('A new request starts as Pending Approval.'); err.code = 'invalid'; throw err; } return; }
      const why = D.expenseTransitionError(current, next, role); if (why) { const err = new Error(why); err.code = 'forbidden'; throw err; }
    }
    /** Client requests: route validation gates submission; plan approval, truck release and 3PL approvals are owned by their roles. */
    requestGuard(current, next, opts) {
      const role = this.user ? this.user.role : ''; const blank = (v) => (v === undefined || v === null || v === '' ? '' : v); const changed = (k) => JSON.stringify(blank(current ? current[k] : undefined)) !== JSON.stringify(blank(next[k]));
      const need = (action, msg) => { if (!E.can(role, action)) { const err = new Error(msg); err.code = 'forbidden'; throw err; } };
      if (!current || changed('client') || changed('loadingFrom') || changed('destination') || changed('trucks') || changed('serviceType') || changed('loadingDate')) need('request.manage', 'Only CRM (or the Operations Manager) can create or change client requests.');
      if (changed('plan')) need('plan.approve', 'Only the Operations Manager approves fleet plans.');
      if (changed('cancellationApprovedAt')) need('allocation.release', 'Only the Operations Manager can approve the release of allocated trucks.');
      if (next.tpl && current && current.tpl && (JSON.stringify(current.tpl.approvedCost) !== JSON.stringify(next.tpl.approvedCost) || current.tpl.costApprovedAt !== next.tpl.costApprovedAt)) need('tpl.approve', 'Only the Operations Manager approves contractor costs.');
      // route validation: an unmapped route can be saved as Draft / Pending Route Mapping but never submitted for operational planning
      const rv = P.routeValidation(next, this.state.routes);
      if (!rv.ok && (next.submittedAt && !(current && current.submittedAt)) && !opts.allowUnmapped) { const err = new Error(rv.message + ' The request is kept as Pending Route Mapping.'); err.code = 'route'; throw err; }
      if (!rv.ok && next.plan && next.plan.approvedAt && !(current && current.plan && current.plan.approvedAt)) { const err = new Error(rv.message + ' Planning approval is blocked until the route is approved.'); err.code = 'route'; throw err; }
      next.routeApproved = rv.ok; if (rv.route && !next.routeMasterId) next.routeMasterId = rv.route.id;
    }
    /** Allocations (stage 3): within the approved plan quantity and vehicle category, against an approved route, by the station / operations. */
    allocationStageGuard(current, next, opts) {
      const role = this.user ? this.user.role : '';
      if (!current && !opts.system) { const request = this.state.requests.find((r) => r.id === next.requestId) || null; const route = P.findRoute(this.state.routes, next.routeId); const truck = this.state.fleet.find((x) => P.plateKey(x.plate) === P.plateKey(next.plate)) || null; const why = P.allocationGuard(request, truck, route, this.planningCtx(), { override: !!opts.override && E.can(role, 'plan.override'), adding: 1 }); if (why) { const err = new Error(why); err.code = 'plan'; throw err; } }
      if (current && next.tripId && current.tripId && next.tripId !== current.tripId && E.TRIP_ID_RE.test(current.tripId)) { const err = new Error(`Trip ID ${current.tripId} is system generated and cannot be overwritten.`); err.code = 'invalid'; throw err; }
      if (current && !opts.system && (P.plateKey(next.plate) !== P.plateKey(current.plate) || E.norm(next.vehicleType || '') !== E.norm(current.vehicleType || ''))) { const why = P.allocationSubstitutionError(next, this.state.requests.find((r) => r.id === next.requestId) || null, this.state.fleet.find((x) => P.plateKey(x.plate) === P.plateKey(next.plate)) || null, P.findRoute(this.state.routes, next.routeId), this.planningCtx(), { override: !!opts.override && E.can(role, 'plan.override') }); if (why) { const err = new Error(why); err.code = 'plan'; throw err; } }
    }
    /**
     * CRM cancellation of one or more requests. Requests are never deleted. When a request still has allocated trucks the
     * trucks are released only after the Operations Manager approves (allocation.release); CRM's cancellation is recorded as
     * Cancellation Requested until then.
     */
    async cancelRequest(id, reason, opts) {
      opts = opts || {}; const r = this.state.requests.find((x) => x.id === id); if (!r) throw new Error('Request not found.');
      const live = this.state.allocations.filter((a) => a.requestId === id && !['Cancelled', 'Completed'].includes(a.status));
      const now = U.nowISO(); const who = this.user ? this.user.username : 'system'; const canRelease = E.can(this.user ? this.user.role : '', 'allocation.release');
      if (live.length && !(canRelease && opts.release)) {
        await this.saveDoc('requests', { id, cancellationRequestedAt: now, cancellationRequestedBy: who, cancelReason: reason, cancelRemarks: E.clean(opts.remarks || ''), lostSalesKind: opts.kind || '' }, { expectedVersion: r.version, label: `${id} cancellation requested: ${reason} (${live.length} allocated truck${live.length > 1 ? 's' : ''} await Operations Manager release)` });
        return { released: false, pending: true, allocations: live.map((a) => a.id) };
      }
      if (live.length) for (const a of live) await this.saveDoc('allocations', { id: a.id, status: 'Cancelled', cancelledAt: now, cancelledBy: who, cancelReason: `Request cancelled: ${reason}` }, { expectedVersion: a.version, label: `${a.id} released (request ${id} cancelled)` });
      await this.saveDoc('requests', { id, status: 'Cancelled', cancelledAt: now, cancelledBy: who, cancelReason: reason, cancelRemarks: E.clean(opts.remarks || ''), lostSalesKind: opts.kind || '', cancellationApprovedAt: live.length ? now : (r.cancellationRequestedAt ? now : ''), cancellationApprovedBy: live.length || r.cancellationRequestedAt ? who : '' }, { expectedVersion: this.state.requests.find((x) => x.id === id).version, label: `${id} cancelled: ${reason}` });
      return { released: live.length > 0, pending: false, allocations: live.map((a) => a.id) };
    }
    async deleteDoc(collection, id, label) {
      if (collection === 'requests') { const err = new Error('Client requests are never deleted; cancel the request instead so the history is kept.'); err.code = 'forbidden'; throw err; }
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
      if (collection === 'meta') { if (id === 'locations') this.state.locations = (data && data.list) || []; if (id === 'zones') this.state.zones = (data && data.map) || {}; if (id === 'planning') this.state.planning = data || {}; if (id === 'tripseq') this.state.tripseq = Object.assign({}, data || {}); if (id === 'accountmap') this.state.accountmap = Object.assign({}, data || {}); if (id === 'routezones') this.state.routezones = Object.assign({}, data || {}); if (id === 'turnaround') this.state.turnaround = Object.assign({}, data || {}); if (id === 'auditpolicy') this.state.auditpolicy = Object.assign({}, data || {}); if (id === 'locationmaster') { const m = Object.assign({}, data || {}); delete m.id; this.state.locationMaster = m; } return; }
      if (collection === 'tripchunks') { for (const [tid, t] of Object.entries((data && data.trips) || {})) { if (t && t._del) this.state.trips.delete(tid); else if (t) this.state.trips.set(tid, t); } return; }
      if (collection === 'trips') { if (!data || data._del) this.state.trips.delete(id); else this.state.trips.set(id, data); return; }
      if (!this.state[collection]) return;
      const list = this.state[collection]; const i = list.findIndex((x) => x.id === id);
      if (!data) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = data; else list.push(data);
      if (collection === 'clients' || collection === 'rates') this.state[collection] = list.slice(); // new identity: lookup caches rebuild
    }
    removeFromState(collection, id) { if (collection === 'trips') this.state.trips.delete(id); else if (this.state[collection]) { const i = this.state[collection].findIndex((x) => x.id === id); if (i >= 0) this.state[collection].splice(i, 1); if (collection === 'clients' || collection === 'rates') this.state[collection] = this.state[collection].slice(); } }
  }

  HB.BaseStore = BaseStore; HB.COLLECTIONS = COLLECTIONS; HB.COLLECTION_ACTION = COLLECTION_ACTION; HB.COLLECTION_ALSO = COLLECTION_ALSO; HB.DEMO_USERS = DEMO_USERS; HB.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})();
