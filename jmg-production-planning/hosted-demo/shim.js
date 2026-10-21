/* Local test shim for the claude.ai runtime: in-memory store persisted to localStorage, fake viewer. */
(function () {
  const KEY = 'jmg-shim-db';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const subs = {};
  const emit = (coll) => { (subs[coll] || []).forEach((fn) => fn()); };
  const db = {
    collection(name) {
      return {
        doc(id) { return { id, set: async (data) => { const d = load(); (d[name] = d[name] || {})[id] = data; save(d); emit(name); }, delete: async () => { const d = load(); if (d[name]) { delete d[name][id]; } save(d); emit(name); }, get: async () => { const d = load(); const v = (d[name] || {})[id]; return { id, exists: !!v, data: () => v }; } }; },
        onSnapshot(next) { const fn = () => { const d = load(); const docs = Object.entries(d[name] || {}).map(([id, v]) => ({ id, exists: true, data: () => Object.freeze(v) })); next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }); }; (subs[name] = subs[name] || []).push(fn); setTimeout(fn, 0); return () => {}; },
      };
    },
    doc(path) { const [c, id] = path.split('/'); return this.collection(c).doc(id); },
  };
  const user = { me: async () => ({ id: 'u_testowner', name: 'Test Owner', isOwner: true, canEdit: true }), can: async () => true, isOwner: async () => true, canEdit: async () => true };
  window.claude = { use: async (name) => (name === 'db' ? db : name === 'user' ? user : null) };
})();
