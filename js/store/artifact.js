/* Artifact store: the claude.ai shared database (`db` capability). Trips are grouped into one document per dispatch
 * month (`tripchunks/YYYY-MM`, field `trips.{id}`) and written with merge updates so two people editing different
 * trips in the same month never overwrite each other. Audit entries use the same pattern per day. */
(function () {
  'use strict';
  const U = HB.U;

  class ArtifactStore extends HB.BaseStore {
    constructor(db, user, downloads) { super(); this.mode = 'shared'; this.db = db; this.viewer = user; this.downloads = downloads; this.known = new Set(); this.unsubs = []; }
    static async detect() {
      if (!window.claude || typeof window.claude.use !== 'function') return null;
      const db = await window.claude.use('db'); if (!db) return null;
      const [user, downloads] = await Promise.all([window.claude.use('user'), window.claude.use('downloads')]);
      return new ArtifactStore(db, user, downloads);
    }
    async init(progress) {
      progress && progress('Loading shared records…');
      const names = ['settings', 'meta', 'clients', 'assets', 'rates', 'invoices', 'payments', 'users', 'fleet', 'routes', 'requests', 'allocations', 'waybilldocs', 'tripchunks'];
      // The route register (524 workbook routes) ships as a static file; routes edited in the app are saved as documents and override it by id.
      try { const r = await fetch('data/workbook/routes.json'); if (r.ok) this.state.routes = await r.json(); } catch (e) { /* offline */ }
      const snaps = await Promise.all(names.map((n) => this.db.collection(n).limit(1000).get()));
      names.forEach((n, i) => { for (const d of snaps[i].docs) { this.known.add(n + '/' + d.id); this.applyDoc(n, d.id, d.data()); } });
      if (this.viewer) { try { this.viewerId = await this.viewer.id(); this.canWrite = await this.viewer.can('data.write'); } catch (e) { /* ignore */ } }
      if (this.downloads) U.downloadHook = (blob, filename) => this.downloads.save({ filename, data: blob });
      this.live = true;
      // live updates: one subscription per collection
      for (const n of names) {
        const unsub = this.db.collection(n).onSnapshot((snap) => {
          let changed = 0;
          for (const ch of snap.docChanges()) {
            if (ch.type === 'removed') { if (n === 'tripchunks') { for (const tid of Object.keys((ch.doc.data() || {}).trips || {})) this.state.trips.delete(tid); } else this.removeFromState(n, ch.doc.id); this.known.delete(n + '/' + ch.doc.id); }
            else { this.known.add(n + '/' + ch.doc.id); this.applyDoc(n, ch.doc.id, ch.doc.data()); }
            changed++;
          }
          if (changed) this.emit({ type: 'remote', collection: n });
        }, (err) => { console.warn('subscription ended', n, err); if (err && err.code === 'revoked') { this.live = false; this.emit({ type: 'revoked' }); } });
        this.unsubs.push(unsub);
      }
    }
    async login(username, password) { const u = await this.verifyLogin(username, password); if (!u) throw new Error('Wrong username or password.'); this.user = this.publicUser(u); U.storage.set('hb_session', { username: u.username }); return this.user; }
    async resume() { const s = U.storage.get('hb_session'); if (!s) return null; const u = this.state.users.find((x) => x.username === s.username && x.active !== false); this.user = this.publicUser(u); return this.user; }
    async logout() { this.user = null; U.storage.del('hb_session'); }

    async _merge(collection, id, patch) {
      const ref = this.db.doc(collection + '/' + id);
      if (this.known.has(collection + '/' + id)) { try { await ref.update(patch); return; } catch (e) { if (!e || e.code !== 'invalid_argument') throw this._wrap(e); } }
      await ref.set(patch); this.known.add(collection + '/' + id);
    }
    _wrap(e) {
      if (!e) return new Error('Unknown error');
      if (e.code === 'invalid_argument') { const err = new Error('The shared database refused this write. Your claude.ai access to this artifact may be view-only.'); err.code = 'forbidden'; return err; }
      if (e.code === 'quota_exceeded') { const err = new Error('The shared database is full. Ask an administrator to archive old records.'); err.code = 'quota'; return err; }
      if (e.code === 'resource_exhausted') { const err = new Error('Too many writes at once. Wait a moment and try again.'); err.code = 'busy'; return err; }
      return e instanceof Error ? e : new Error(e.message || String(e));
    }
    chunkOf(trip) { return 'tripchunks/' + ((trip.dateDispatched || '').slice(0, 7) || 'undated'); }
    async writeTrip(trip, current) {
      const month = (trip.dateDispatched || '').slice(0, 7) || 'undated';
      const copy = Object.assign({}, trip); delete copy.history; copy.history = (trip.history || []).slice(-12); // keep chunks small
      await this._merge('tripchunks', month, { trips: { [trip.id]: copy } });
      if (current && (current.dateDispatched || '').slice(0, 7) !== month && current.dateDispatched) await this._merge('tripchunks', current.dateDispatched.slice(0, 7), { trips: { [trip.id]: { id: trip.id, _del: true } } });
      this.state.trips.set(trip.id, copy); this.emit({ type: 'trip', id: trip.id });
    }
    async removeTrip(id, current) {
      const month = (current.dateDispatched || '').slice(0, 7) || 'undated';
      await this._merge('tripchunks', month, { trips: { [id]: { id, _del: true, deletedAt: U.nowISO(), deletedBy: this.user && this.user.username } } });
      this.state.trips.delete(id); this.emit({ type: 'trip', id });
    }
    async writeDoc(collection, id, data) {
      const ref = this.db.doc(collection + '/' + id);
      try { await ref.set(data); } catch (e) { throw this._wrap(e); }
      this.known.add(collection + '/' + id); this.applyDoc(collection, id, data); this.emit({ type: collection, id });
    }
    async removeDoc(collection, id) { try { await this.db.doc(collection + '/' + id).delete(); } catch (e) { throw this._wrap(e); } this.known.delete(collection + '/' + id); this.removeFromState(collection, id); this.emit({ type: collection, id }); }
    async writeAudit(entry) {
      entry.viewerId = this.viewerId || '';
      const day = entry.ts.slice(0, 10);
      try { await this._merge('audit', day, { day, entries: { [entry.id]: entry } }); } catch (e) { console.warn('audit write failed', e); }
    }
    async fetchAudit(limit) {
      const snap = await this.db.collection('audit').orderBy('day', 'desc').limit(14).get().catch(() => this.db.collection('audit').limit(60).get());
      const entries = [];
      for (const d of snap.docs) for (const e of Object.values((d.data() || {}).entries || {})) entries.push(e);
      return entries.sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, limit || 300);
    }
    async bulkWriteTrips(trips) {
      const byMonth = new Map();
      for (const t of trips) { const m = (t.dateDispatched || '').slice(0, 7) || 'undated'; if (!byMonth.has(m)) byMonth.set(m, {}); byMonth.get(m)[t.id] = t; }
      for (const [m, obj] of byMonth) { await this._merge('tripchunks', m, { trips: obj }); for (const t of Object.values(obj)) this.state.trips.set(t.id, t); }
      this.emit({ type: 'trips' });
    }
  }
  HB.ArtifactStore = ArtifactStore;
})();
