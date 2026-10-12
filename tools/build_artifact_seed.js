#!/usr/bin/env node
/* Writes the documents that seed the shared (claude.ai artifact) database into <outdir>/<collection>/<id>.json
 * so they can be uploaded with the ArtifactData tool. Mirrors server/seed.js. */
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const sampleRates = require('../js/core/sample_rates.js');
const ROOT = path.join(__dirname, '..'); const out = process.argv[2] || path.join(ROOT, 'data', 'artifact-seed');
const read = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'workbook', n), 'utf8'));
const write = (c, id, data) => { fs.mkdirSync(path.join(out, c), { recursive: true }); fs.writeFileSync(path.join(out, c, id + '.json'), JSON.stringify(data)); return { collection: c, doc_id: id, file: path.join(out, c, id + '.json'), bytes: Buffer.byteLength(JSON.stringify(data)) }; };
const hashPassword = (password, salt) => crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
const DEMO_USERS = [
  { username: 'admin', name: 'Adaeze Okonkwo', role: 'admin', password: 'Admin@2026' }, { username: 'ops', name: 'Musa Bello', role: 'operations', password: 'Ops@2026' },
  { username: 'billing', name: 'Funke Adeyemi', role: 'billing', password: 'Billing@2026' }, { username: 'finance', name: 'Chidi Nwosu', role: 'finance', password: 'Finance@2026' }, { username: 'manager', name: 'Ibrahim Lawal', role: 'management', password: 'Manager@2026' },
];
fs.rmSync(out, { recursive: true, force: true });
const manifest = [];
const chunks = new Map();
for (const t of read('trips.json')) { const m = (t.dateDispatched || '').slice(0, 7) || 'undated'; if (!chunks.has(m)) chunks.set(m, {}); const c = { ...t }; delete c.history; chunks.get(m)[t.id] = c; }
for (const [m, trips] of chunks) manifest.push(write('tripchunks', m, { month: m, trips }));
for (const a of read('assets.json')) { const tb = a.vehicleCategory === 'New Batch' ? 'New Batch' : a.vehicleCategory === '3rd Party' ? '3rd Party' : 'Old Batch'; manifest.push(write('assets', a.plate.replace(/[^A-Za-z0-9_-]+/g, '-'), { id: a.plate.replace(/[^A-Za-z0-9_-]+/g, '-'), version: 1, ...a, truckBatch: tb, batchHistory: [{ batch: tb, effectiveDate: '2024-01-01' }] })); }
for (const c of read('clients.json')) manifest.push(write('clients', c.id, { version: 1, ...c }));
manifest.push(write('meta', 'locations', { list: read('locations.json') }));
manifest.push(write('meta', 'zones', { map: read('zones.json') }));
manifest.push(write('settings', 'main', { company: 'JMG Limited', companyShort: 'JMG', address: '', phone: '', email: '', website: '', tin: '', rcNumber: '', logo: '', vatRate: 0.075, paymentTermsDays: 7, bankName: '', accountName: '', accountNumber: '', invoiceNote: 'Thank you for your business.', version: 1 }));
for (const r of (fs.existsSync(path.join(ROOT, 'data', 'workbook', 'rates.json')) ? read('rates.json') : sampleRates())) manifest.push(write('rates', r.id, r));
for (const u of DEMO_USERS) { const salt = crypto.randomBytes(16).toString('hex'); manifest.push(write('users', u.username, { id: u.username, username: u.username, name: u.name, role: u.role, salt, hash: hashPassword(u.password, salt), active: true, createdAt: new Date().toISOString(), version: 1 })); }
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
const big = manifest.filter((m) => m.bytes > 200 * 1024);
console.log(`${manifest.length} documents → ${out}; largest ${Math.max(...manifest.map((m) => m.bytes))} bytes; over 200KiB: ${big.map((b) => b.doc_id).join(', ') || 'none'}`);
console.log('tripchunks:', [...chunks.keys()].length, 'total bytes', manifest.filter((m) => m.collection === 'tripchunks').reduce((s, m) => s + m.bytes, 0));
