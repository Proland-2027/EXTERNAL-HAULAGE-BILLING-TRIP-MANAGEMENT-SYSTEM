/* REST store: talks to server/server.js (Node + SQLite). Permissions are enforced server-side; the client polls for changes. */
(function () {
  'use strict';
  const U = HB.U;

  class ApiStore extends HB.BaseStore {
    constructor(base) { super(); this.mode = 'server'; this.base = base || ''; this.seq = 0; this.timer = null; this.serverLinksAllocations = true; } // the server links allocations to trips itself
    async req(method, path, body, headers) {
      const res = await fetch(this.base + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
      let data = null; try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) { const err = new Error((data && data.error) || res.statusText); err.code = (data && data.code) || (res.status === 409 ? 'conflict' : res.status === 401 ? 'auth' : res.status === 403 ? 'forbidden' : 'http'); err.status = res.status; err.current = data && data.current; throw err; }
      return data;
    }
    async init() { /* data loads after login (the API needs a session) */ }
    async resume() { try { const me = await this.req('GET', '/api/me'); if (me && me.user) { this.user = me.user; await this.bootstrap(); return this.user; } } catch (e) { /* not signed in */ } return null; }
    async login(username, password) { const r = await this.req('POST', '/api/login', { username, password }); this.user = r.user; await this.bootstrap(); return this.user; }
    async logout() { try { await this.req('POST', '/api/logout'); } catch (e) { /* ignore */ } this.user = null; this.stopPolling(); }
    async bootstrap() {
      const d = await this.req('GET', '/api/bootstrap');
      this.state.settings = Object.assign({}, HB.DEFAULT_SETTINGS, d.settings || {});
      for (const c of HB.COLLECTIONS) this.state[c] = d[c] || [];
      this.state.locations = d.locations || []; this.state.zones = d.zones || {}; this.state.planning = d.planning || {}; this.state.locationMaster = d.locationMaster || {}; this.state.trips = new Map((d.trips || []).map((t) => [t.id, t])); this.seq = d.seq || 0;
      this.live = true; this.emit({ type: 'bootstrap' }); this.startPolling();
    }
    startPolling() { this.stopPolling(); this.timer = setInterval(() => this.poll().catch(() => {}), 4000); }
    stopPolling() { if (this.timer) clearInterval(this.timer); this.timer = null; }
    async poll() {
      const d = await this.req('GET', '/api/changes?since=' + this.seq);
      if (!d.changes || !d.changes.length) return;
      for (const ch of d.changes) { this.applyDoc(ch.collection, ch.id, ch.deleted ? null : ch.data); this.seq = Math.max(this.seq, ch.seq); }
      this.emit({ type: 'remote', count: d.changes.length });
    }
    async writeTrip(trip, current) {
      const saved = await this.req('PUT', '/api/trips/' + encodeURIComponent(trip.id), trip, { 'If-Match': String(current ? current.version : 0) });
      this.state.trips.set(saved.id, saved); if (saved.allocationId) await this.poll().catch(() => {}); this.emit({ type: 'trip', id: saved.id });
    }
    async removeTrip(id) { await this.req('DELETE', '/api/trips/' + encodeURIComponent(id)); this.state.trips.delete(id); this.emit({ type: 'trip', id }); }
    async writeDoc(collection, id, data) { const saved = await this.req('PUT', `/api/${collection}/${encodeURIComponent(id)}`, data); this.applyDoc(collection, id, saved); this.emit({ type: collection, id }); }
    async removeDoc(collection, id) { await this.req('DELETE', `/api/${collection}/${encodeURIComponent(id)}`); this.removeFromState(collection, id); this.emit({ type: collection, id }); }
    async writeAudit() { /* the server records the audit trail itself */ }
    async fetchAudit(limit) { const d = await this.req('GET', '/api/audit?limit=' + (limit || 300)); return d.audit || []; }
    async bulkWriteTrips(trips) { const d = await this.req('POST', '/api/trips/bulk', { trips }); for (const t of d.trips || []) this.state.trips.set(t.id, t); this.emit({ type: 'trips' }); }
    async issueCreditNote(invoiceId, amount, reason) { const d = await this.req('POST', '/api/invoices/' + encodeURIComponent(invoiceId) + '/credit-note', { amount, reason }); await this.poll().catch(() => {}); this.emit({ type: 'invoices', id: d.creditNote.id }); return d.creditNote; }
    async createTripFromAllocation(allocationId, opts) { const saved = await this.req('POST', '/api/trips/from-allocation', Object.assign({ allocationId }, opts || {})); this.state.trips.set(saved.id, saved); await this.poll().catch(() => {}); this.emit({ type: 'trip', id: saved.id }); return saved; }
    async changePassword(username, password) { await this.req('POST', '/api/users/' + encodeURIComponent(username) + '/password', { password }); }
  }
  HB.ApiStore = ApiStore;
})();
