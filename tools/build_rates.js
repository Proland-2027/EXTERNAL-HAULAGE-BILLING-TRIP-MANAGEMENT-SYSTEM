#!/usr/bin/env node
/* Builds data/workbook/rates.json (agreed client price list), client aliases and the location-zone map from the
 * extracted price list. Every sheet may repeat its header row (the Mega Manu sheet does, per tonnage block). */
const fs = require('fs'); const path = require('path');
const E = require('../js/core/engine.js');
const ROOT = path.join(__dirname, '..');
const sheets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'workbook', 'pricelist_extract.json'), 'utf8'));
const clients = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'workbook', 'clients.json'), 'utf8'));
const EFFECTIVE = '2026-06-01';           // "June Price List"
const ALIASES = { 'ILERA AGRO': 'Illera Agro', 'K&D': 'KD & SONS', 'VANDERA': 'VENDARA', 'JAMARA': 'Jamara', 'Mega Manu': 'MEGA MANU', 'Mega Manu-Local': 'MEGA MANU', 'SASO': 'SASO', 'NATURAL BEAUTY': 'NATURAL BEAUTY', 'Interstyle': 'INTERSTYLE', 'JAT': 'JUBAILI AGROTEC', 'Lacasera': 'Lacasera', 'JMG': 'JMG', "I'HS": "I'HS" };
if (!clients.some((c) => E.norm(c.name) === "i'hs")) clients.push({ id: 'ihs', name: "I'HS", code: 'IHS', contractType: '', active: true, trips: 0, aliases: ['IHS'] });
const rates = []; const seen = new Map();
for (const sh of sheets) {
  let map = null, headerText = '';
  if (sh.sheet === 'Lacasera Jumbo') continue; // per-case tariff (35cl / 60cl) duplicating the Palatized 45T lane prices
  for (const row of sh.rows) {
    const cells = row.map((v) => (v === null || v === undefined ? '' : String(v)));
    if (cells.filter(Boolean).length < 4) continue;
    const m = E.mapRateHeaders(cells);
    if (m.client !== undefined && m.loadingFrom !== undefined && m.loadingTo !== undefined) { map = m; headerText = cells.join(' '); continue; } // header (repeats per block)
    if (!map) continue;
    const r = E.rowToRate(row, map, { effectiveDate: EFFECTIVE, headerText });
    if (!r || !(r.price > 0)) continue;
    if (r.approved === false) continue; // "Price Not Approved" rows are not agreed rates
    delete r.approved;
    r.client = ALIASES[r.client] || r.client;
    r.remarks = `${sh.sheet} sheet · ${r.remarks}`.replace(/ · $/, '');
    const key = [E.norm(r.client), E.locKey(r.loadingFrom), E.locKey(r.loadingTo), E.normContract(r.contractType), r.price, r.priceBasis].join('|');
    if (seen.has(key)) continue; // identical repeated rows (Jamara LCL zones)
    seen.set(key, true);
    r.id = 'rate-' + key.replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 120);
    r.version = 1; r.createdAt = '2026-10-12T00:00:00Z'; r.createdBy = 'price-list-import'; r.updatedAt = r.createdAt; r.updatedBy = 'price-list-import';
    r.source = 'June_Price_List.xlsx';
    // Natural Beauty: August revision supersedes the June price for the same lane.
    if (r.priceRevised && r.priceRevised !== r.price) {
      const aug = Object.assign({}, r, { id: r.id + '-aug', price: r.priceRevised, effectiveDate: '2026-08-01', remarks: r.remarks + ' · August revision' });
      r.expiryDate = '2026-07-31'; delete aug.priceRevised; rates.push(aug);
    }
    delete r.priceRevised;
    rates.push(r);
  }
}
// client aliases + zones
for (const c of clients) { c.aliases = Object.entries(ALIASES).filter(([a, n]) => E.norm(n) === E.norm(c.name) && E.norm(a) !== E.norm(c.name)).map(([a]) => a); }
const LAGOS = ['GBAGADA', 'OGBA', 'APAPA', 'KARAME CITY', 'KARAMEH CITY', 'KAMAMEH CITY', 'MILE-2', 'MILE 2', 'MILE2', 'AMUWO ODOFIN', 'AMUWO-ODOFIN', 'AMUWO -ODOFIN', 'AMUWO', 'ISOLO', 'OSHODI', 'IKEJA', 'KIRIKIRI', 'KIRKIRI', 'IKORODU', 'AGBARA', 'IKOTUN', 'VI', 'TINCAN', 'TIN CAN', 'NBL LAGOS', 'LAGOS', 'MEDLOG', 'BERGER', 'LEKKI', 'AJAH', 'FESTAC', 'OJOTA', 'ILUPEJU', 'MUSHIN', 'SURULERE', 'YABA', 'IKOYI', 'MARINA', 'ALABA', "ALABA INT'L", 'ALABA INTL', 'OKOTA', 'AJAO ESTATE', 'MATORI', 'DOPEMU', 'AGEGE', 'MAGODO', 'KETU', 'EGBEDA', 'IPAJA', 'AYOBO', 'OKOKOMAIKO', 'ABULE EGBA', 'EBUTE META', 'OYINGBO', 'LAGOS ISLAND', 'IKORODU ELEPE', 'OJO', 'BADAGRY', 'ORILE', 'ILASA', 'ILASAMAJA', 'IJORA', 'ABULE ADO'];
const zones = {};
for (const l of LAGOS) zones[E.locKey(l)] = 'Lagos';
Object.assign(zones, { phc: 'Port Harcourt', phg: 'Port Harcourt', ph: 'Port Harcourt', 'port harcourt': 'Port Harcourt', 'benin city': 'Benin', benin: 'Benin', illorin: 'Ilorin', ilorin: 'Ilorin', oshogbo: 'Osun', osogbo: 'Osun', osun: 'Osun', 'ibadan sumal': 'Ibadan', 'nbl ibadan': 'Ibadan', ibadan: 'Ibadan', 'ibadan 45tons': 'Ibadan', 'alaba int l': 'Alaba', 'alaba intl': 'Alaba', abuja: 'Abuja', fct: 'Abuja', 'sango otta': 'Sango Otta', 'sango ota': 'Sango Otta', sango: 'Sango Otta', ekiti: 'Ekite', ekite: 'Ekite', 'ado ekiti': 'Ekite', maiduguri: 'Maidugri', maidugri: 'Maidugri' });
fs.writeFileSync(path.join(ROOT, 'data', 'workbook', 'rates.json'), JSON.stringify(rates, null, 1));
fs.writeFileSync(path.join(ROOT, 'data', 'workbook', 'clients.json'), JSON.stringify(clients, null, 1));
fs.writeFileSync(path.join(ROOT, 'data', 'workbook', 'zones.json'), JSON.stringify(zones, null, 1));
console.log(`rates ${rates.length}; per client:`, Object.entries(rates.reduce((m, r) => (m[r.client] = (m[r.client] || 0) + 1, m), {})).map(([k, v]) => k + '=' + v).join(', '));
console.log('basis:', rates.reduce((m, r) => (m[r.priceBasis] = (m[r.priceBasis] || 0) + 1, m), {}));
// coverage check against the trip log
const trips = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'workbook', 'trips.json'), 'utf8'));
const assets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'workbook', 'assets.json'), 'utf8'));
const ctx = { settings: { vatRate: 0.075 }, assets, rates, zones, clients };
const stat = {};
for (const t of trips.filter((x) => x.dateDispatched >= '2026-06-01')) { const c = E.computeTrip(t, ctx); const k = c.client + ' → ' + c.agreedStatus; stat[k] = (stat[k] || 0) + 1; }
console.log('June–Oct 2026 lookup coverage:'); for (const [k, v] of Object.entries(stat).sort()) if (/found|multiple/.test(k) || v > 10) console.log('  ', k, v);
