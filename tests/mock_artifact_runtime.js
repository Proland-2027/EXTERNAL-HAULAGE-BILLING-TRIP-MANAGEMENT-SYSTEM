/* In-page mock of the claude.ai artifact runtime (`window.claude.use('db' | 'user' | 'downloads')`) so the shared-database
 * code path (js/store/artifact.js) can be exercised with Playwright. Injected with page.addInitScript before the app loads.
 * Documents are seeded from data/workbook/*.json exactly as tools/build_artifact_seed.js lays them out. */
(() => {
  const subs = new Map(); // collection -> Set(cb)
  const cols = new Map(); // collection -> Map(id -> data)
  const col = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  // the real runtime hands the page frozen documents: freeze deeply so any write onto a document throws here too
  const freeze = (v) => { if (v && typeof v === 'object') { for (const k of Object.keys(v)) freeze(v[k]); Object.freeze(v); } return v; };
  const deepMerge = (base, patch) => { const out = Object.assign({}, base || {}); for (const [k, v] of Object.entries(patch || {})) { if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v); else if (v && typeof v === 'object' && v.__delete__) delete out[k]; else out[k] = clone(v); } return out; };
  // writes are journaled in sessionStorage and replayed after the seed, so the mock survives page reloads (sign-out / sign-in)
  const journal = (() => { try { return JSON.parse(sessionStorage.getItem('__mockDbOps') || '[]'); } catch (e) { return []; } })();
  const record = (op) => { journal.push(op); try { sessionStorage.setItem('__mockDbOps', JSON.stringify(journal)); } catch (e) { /* full */ } };
  const apply = (op) => { const c = col(op.n); if (op.t === 'set') c.set(op.id, clone(op.data)); else if (op.t === 'update') c.set(op.id, deepMerge(c.get(op.id), op.patch)); else c.delete(op.id); };
  const notify = (n, type, id) => { const data = col(n).get(id); for (const cb of subs.get(n) || []) setTimeout(() => cb({ docChanges: () => [{ type, doc: { id, data: () => (data === undefined ? undefined : freeze(clone(data))) } }] }), 0); };
  const docRef = (path) => { const [n, id] = path.split('/'); return {
    async set(data) { const exists = col(n).has(id); record({ t: 'set', n, id, data }); col(n).set(id, clone(data)); notify(n, exists ? 'modified' : 'added', id); },
    async update(patch) { if (!col(n).has(id)) { const e = new Error('No document to update'); e.code = 'invalid_argument'; throw e; } record({ t: 'update', n, id, patch }); col(n).set(id, deepMerge(col(n).get(id), patch)); notify(n, 'modified', id); },
    async delete() { record({ t: 'delete', n, id }); col(n).delete(id); notify(n, 'removed', id); },
  }; };
  let seeded = null;
  async function seed() {
    const get = async (f) => { const r = await fetch('data/workbook/' + f); return r.ok ? r.json() : null; };
    const [trips, assets, clients, locations, rates, zones, fleet, routes, requests, allocations, planning, distances, locationmaster, contractors, quotes] = await Promise.all(['trips', 'assets', 'clients', 'locations', 'rates', 'zones', 'fleet', 'routes', 'requests', 'allocations', 'planning', 'distances', 'locationmaster', 'contractors', 'quotes'].map((n) => get(n + '.json')));
    const [jobcards, stockmoves, accountmap, routezones] = await Promise.all(['jobcards', 'stockmoves', 'accountmap', 'routezones'].map((n) => get(n + '.json'))); for (const d of jobcards || []) col('jobcards').set(d.id, Object.assign({ version: 1 }, d)); for (const d of stockmoves || []) col('stockmoves').set(d.id, Object.assign({ version: 1 }, d)); if (accountmap) col('meta').set('accountmap', Object.assign({ version: 1 }, accountmap, { id: 'accountmap' })); if (routezones) col('meta').set('routezones', Object.assign({ version: 1 }, routezones, { id: 'routezones' }));
    for (const d of distances || []) col('distances').set(d.id, d); if (locationmaster) col('meta').set('locationmaster', Object.assign({ version: 1 }, locationmaster, { id: 'locationmaster' }));
    const chunks = {}; for (const t of trips || []) { const m = (t.dateDispatched || '').slice(0, 7) || 'undated'; (chunks[m] = chunks[m] || {})[t.id] = t; }
    for (const [m, ts] of Object.entries(chunks)) col('tripchunks').set(m, { month: m, trips: ts });
    for (const a of assets || []) { const id = a.plate.replace(/[^A-Za-z0-9_-]+/g, '-'); const tb = a.vehicleCategory === 'New Batch' ? 'New Batch' : a.vehicleCategory === '3rd Party' ? '3rd Party' : 'Old Batch'; col('assets').set(id, Object.assign({ id, version: 1 }, a, { truckBatch: tb, batchHistory: [{ batch: tb, effectiveDate: '2024-01-01' }] })); }
    for (const c of clients || []) col('clients').set(c.id, Object.assign({ version: 1 }, c));
    col('meta').set('locations', { list: locations || [] }); col('meta').set('zones', { map: zones || {} });
    if (planning) col('meta').set('planning', Object.assign({ version: 1 }, planning, { id: 'planning' }));
    col('settings').set('main', { company: 'JMG Limited', companyShort: 'JMG', vatRate: 0.075, paymentTermsDays: 7, invoiceNote: 'Thank you for your business.', version: 1 });
    for (const r of rates || []) col('rates').set(r.id, r);
    for (const [n, list] of [['fleet', fleet], ['requests', requests], ['allocations', allocations], ['contractors', contractors], ['quotes', quotes]]) for (const d of list || []) col(n).set(d.id, Object.assign({ version: 1 }, d));
    // routes stay a static file in the artifact (see js/store/artifact.js); the collection starts empty
    for (const op of journal) apply(op);
  }
  const db = {
    collection(n) { const q = { _n: n, _limit: 1000, _order: null, limit(k) { q._limit = k; return q; }, orderBy(f, dir) { q._order = [f, dir]; return q; },
      async get() { if (!seeded) seeded = seed(); await seeded; let docs = [...col(n).entries()].map(([id, data]) => ({ id, data: () => freeze(clone(data)) })); if (q._order) { const [f, dir] = q._order; docs.sort((a, b) => (String(a.data()[f]) < String(b.data()[f]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); } return { docs: docs.slice(0, q._limit) }; },
      onSnapshot(cb) { if (!subs.has(n)) subs.set(n, new Set()); subs.get(n).add(cb); return () => subs.get(n).delete(cb); } }; return q; },
    doc: docRef,
  };
  window.__mockDb = { cols, reset: () => cols.clear() };
  window.claude = { use: async (cap) => (cap === 'db' ? db : cap === 'user' ? { id: async () => 'u_mock', can: async () => true } : cap === 'downloads' ? { save: async () => true } : null) };
})();
