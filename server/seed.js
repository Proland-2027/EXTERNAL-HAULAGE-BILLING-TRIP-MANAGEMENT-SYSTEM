#!/usr/bin/env node
/* Seeds the server database with the workbook data (trips, assets, clients, locations), the demo accounts and the
 * illustrative price list. Safe to re-run: existing records are kept unless --reset is given. */
'use strict';
const fs = require('fs');
const path = require('path');
const { store, db, makeUser } = require('./server.js');
const sampleRates = require('../js/core/sample_rates.js');
const fs2 = require('fs');
const ROOT = path.join(__dirname, '..');
const read = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'workbook', n), 'utf8'));
const reset = process.argv.includes('--reset');

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
const exists = (n) => fs2.existsSync(path.join(ROOT, 'data', 'workbook', n));

db.exec('BEGIN');
try {
  if (reset) { db.exec('DELETE FROM docs; DELETE FROM trips; DELETE FROM audit; DELETE FROM changes; DELETE FROM sessions;'); }
  let n = 0;
  if (!store.trips().length) { for (const t of read('trips.json')) { store.putTrip(t); n++; } }
  console.log(`trips: ${n} inserted (${store.trips().length} total)`);
  if (!store.list('assets').length) for (const a of read('assets.json')) store.putDoc('assets', Object.assign({ id: a.plate.replace(/[^A-Za-z0-9_-]+/g, '-'), version: 1 }, a));
  if (!store.list('clients').length) for (const c of read('clients.json')) store.putDoc('clients', Object.assign({ version: 1 }, c));
  if (!store.doc('meta', 'locations')) store.putDoc('meta', { id: 'locations', list: read('locations.json'), version: 1 });
  if (!store.doc('settings', 'main')) store.putDoc('settings', { id: 'main', company: 'JMG Limited', companyShort: 'JMG', address: '', phone: '', email: '', website: '', tin: '', rcNumber: '', logo: '', vatRate: 0.075, paymentTermsDays: 7, bankName: '', accountName: '', accountNumber: '', invoiceNote: 'Thank you for your business.', version: 1 });
  if (!store.list('rates').length) { const real = fs2.existsSync(path.join(ROOT, 'data', 'workbook', 'rates.json')) ? read('rates.json') : sampleRates(); for (const r of real) store.putDoc('rates', r); }
  if (!store.doc('meta', 'zones') && fs2.existsSync(path.join(ROOT, 'data', 'workbook', 'zones.json'))) store.putDoc('meta', { id: 'zones', map: read('zones.json'), version: 1 });
  if (!store.list('users').length) for (const u of DEMO_USERS) store.putDoc('users', makeUser(u));
  for (const u of DEMO_USERS) if (!store.doc('users', u.username)) store.putDoc('users', makeUser(u)); // accounts added in later releases
  // fleet planning (Truck Planning Management workbook)
  for (const c of ['fleet', 'routes', 'requests', 'allocations', 'distances', 'contractors', 'quotes', 'staff', 'costcenters', 'lob', 'accounts', 'items', 'suppliers', 'ratecard', 'tplrates']) if (!store.list(c).length && exists(c + '.json')) for (const d of read(c + '.json')) store.putDoc(c, Object.assign({ version: 1 }, d));
  if (!store.doc('meta', 'locationmaster') && exists('locationmaster.json')) store.putDoc('meta', Object.assign({ version: 1 }, read('locationmaster.json'), { id: 'locationmaster' }));
  if (!store.doc('meta', 'planning') && exists('planning.json')) store.putDoc('meta', Object.assign({ version: 1 }, read('planning.json'), { id: 'planning' }));
  for (const m of ['accountmap', 'routezones']) if (!store.doc('meta', m) && exists(m + '.json')) store.putDoc('meta', Object.assign({ version: 1 }, read(m + '.json'), { id: m }));
  store.audit({ id: 'a-seed-' + Date.now().toString(36), ts: new Date().toISOString(), user: 'system', userName: 'Seed script', role: '', action: 'import', entity: 'workbook', entityId: 'Haulage_Billing_Sheet_September_R2', label: 'Workbook data loaded', changes: [] });
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
console.log(`assets ${store.list('assets').length}, clients ${store.list('clients').length}, rates ${store.list('rates').length}, users ${store.list('users').length}, fleet ${store.list('fleet').length}, routes ${store.list('routes').length}, requests ${store.list('requests').length}, allocations ${store.list('allocations').length}`);
console.log('Demo accounts: ' + DEMO_USERS.map((u) => `${u.username}/${u.password}`).join('  '));
