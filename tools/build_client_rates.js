#!/usr/bin/env node
/* Client Contracts And Rate Cards (cleaned) → the approved Client Rate Card, Route Master prices and the Location Master.
 *   node tools/build_client_rates.js <rates_extract.json>
 * Rules (nothing is invented; every decision is written to data/workbook/client_rates_report.json):
 *   - a lane whose price equals the rate already on the card keeps its record (same id, confirmed by the contract card);
 *   - a lane whose price differs gets a new record effective from the import date and the old record expires the day
 *     before (rate-card version control; history stays comparable for earlier trips);
 *   - a lane the card did not have yet is added with effective date 2026-01-01 (ASSUMPTION: the contract card carries no
 *     dates; the year start lets the commercial audit compare this year's trips — change EFFECTIVE_NEW if the client
 *     contracts say otherwise);
 *   - rows without a price are listed and skipped; duplicate lanes with different prices are kept (the Trip Log asks the
 *     user to pick) and listed;
 *   - Route Master lanes without an approved price receive the card price; priced lanes that differ are updated with the
 *     previous price kept in priceHistory; lanes the Route Master does not have are added as Pending Approval with the
 *     card's kilometres marked as not road-routed;
 *   - the Name Changes sheet feeds the Location Master (standardised destination → state, approved). */
const fs = require('fs'); const path = require('path');
const E = require('../js/core/engine.js');
const ROOT = path.join(__dirname, '..'); const W = path.join(ROOT, 'data', 'workbook');
const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8'));
const x = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const crc = x['Client Route And Contracts'].data, dsl = x['NEW-DSL JMR'].data, names = x['Name Changes'] || [];
const rates = read('rates.json'), routes = read('routes.json'), clients = read('clients.json'), zones = read('zones.json'), locationmaster = read('locationmaster.json');
const SOURCE = 'Client_Contracts_And_Rate_Cards_cleaned_3.xlsx'; const IMPORTED = '2026-10-20'; const EFFECTIVE_CHANGED = '2026-10-20', EXPIRE_OLD = '2026-10-19', EFFECTIVE_NEW = '2026-01-01';
const STAMP = { createdAt: IMPORTED + 'T00:00:00Z', createdBy: 'contract-card-import', updatedAt: IMPORTED + 'T00:00:00Z', updatedBy: 'contract-card-import', source: SOURCE };
// client names on the card → client master (ASSUMPTION flagged in the report: ABBA SALEH is the ABBA ABASS account (Ogere ↔ Nasarawa lanes))
const ALIASES = { JAMARA: 'Jamara', 'Mega Manu': 'MEGA MANU', 'Mega Manu-Local': 'MEGA MANU', JAT: 'JUBAILI AGROTEC', Interstyle: 'INTERSTYLE', VANDERA: 'VENDARA', Givanas: 'GIVANAS', Orca: 'ORCA DECO LIMITED', 'NIGER BISCUIT': 'NIGER BISCUITS', 'WALTER & Hiffy': 'WALTER & HIFY RESOURCES', Lebruni: 'LEBRUNI AGRO LTD', 'ABBA SALEH': 'ABBA ABASS' };
const clientName = (raw) => { const r = String(raw || '').trim(); if (ALIASES[r]) return ALIASES[r]; const k = E.clientKey(r, clients); const c = clients.find((c) => E.norm(c.name) === k); return c ? c.name : r; };
const ton = (t) => { const v = String(t || '').trim().toUpperCase(); return v ? (/T$/.test(v) ? v : v + 'T') : ''; };
const vehicleTypeOf = (division, size) => { const d = E.norm(division), s = E.norm(size); if (/canter|closed/.test(d)) return 'Closed Body Logistics'; if (/hiab/.test(d)) return 'Hiabs Logistics'; if (/flat/.test(s)) return 'Flat Trucks Logistics'; return 'HAULAGE'; };
const area = (name) => zones[E.locKey(name)] || String(name || '').trim();
// destinations keep their own name (the Lagos zone groups dozens of distinct delivery points); city aliases such as PHC → Port Harcourt still apply
const destKey = (to) => { const z = zones[E.locKey(to)]; return E.locKey(z && z !== 'Lagos' ? z : to); };
const laneKey = (client, from, to, tonnage, size) => [E.norm(client), E.locKey(area(from)), destKey(to), E.normContract(tonnage), size === undefined ? '' : E.norm(size)].join('|');
const r2 = (v) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 100) / 100);

const report = { source: SOURCE, importedAt: IMPORTED, rows: crc.length, skippedNoPrice: [], clientMapping: ALIASES, assumptions: [`Prices on the card are excl. VAT (120 lanes match the June price list to the naira, which is VAT-exclusive).`, `Changed lanes: the new price is effective ${EFFECTIVE_CHANGED} and the previous rate expires ${EXPIRE_OLD}; lanes new to the card are effective ${EFFECTIVE_NEW} because the card carries no contract dates.`, `"ABBA SALEH" is read as the ABBA ABASS account (its Ogere → Lafia lane matches that client's Nasarawa ↔ Ogere trips) — confirm.`, `Vehicle type from the Division / Truck Size columns: NBL-DSL → HAULAGE (FLATBED size → Flat Trucks Logistics), CANTER → Closed Body Logistics, Hiabs Logistics → Hiabs Logistics.`, `Route Master kilometres are kept (road-routed in the Setup_Haulage import); the card's KM is stored on each rate as contractKm and listed where it differs by more than 5 km.`], unchanged: 0, changed: [], added: 0, expired: 0, duplicateLanes: [], kmDifferences: [], routesPriced: 0, routePriceChanges: [], routesAdded: 0, routeKmDifferences: 0, dslDifferences: [], contractorPrices: 0, locationsAdded: 0 };

// ------------------------------------------------------------------ 1. the Client Rate Card
const existingByLane = new Map(); for (const r of rates) { if (r.expiryDate && r.expiryDate < IMPORTED) continue; const k = laneKey(r.client, r.loadingFrom, r.loadingTo, r.contractType); existingByLane.set(k, (existingByLane.get(k) || []).concat(r)); }
report.vehicleTypeMismatch = [];
const seen = new Map(); const out = rates.slice(); const touched = new Set();
for (const row of crc) {
  const price = Number(row.Price); const client = clientName(row.Client); const from = String(row['Loading Point'] || '').trim(), to = String(row.Destination || '').trim(); const tonnage = ton(row['Truck Tonnage']); const size = String(row['Truck Size'] || '').trim();
  if (!(price > 0)) { report.skippedNoPrice.push({ client, from, to, tonnage, size, price: row.Price === undefined ? null : row.Price }); continue; }
  const k = laneKey(client, from, to, tonnage); const dk = k + '|' + E.norm(size);
  if (seen.has(dk)) { const prev = seen.get(dk); if (Math.abs(prev - price) < 1) continue; report.duplicateLanes.push({ client, from, to, tonnage, size, prices: [prev, price] }); } else seen.set(dk, price);
  const base = { client, loadingFrom: from, loadingTo: to, vehicleType: vehicleTypeOf(row.Divison, size), contractType: tonnage, truckSize: size, division: String(row.Divison || '').trim(), contractName: `${client}-${tonnage}-${String(row.Divison || '').trim()}-${size}`.toUpperCase(), price: r2(price), priceBasis: 'exclusive', priceIncl: null, destinationState: String(row.State || '').trim(), contractKm: r2(row.KM), contractTotalKm: r2(row['Total KM']), contractDieselLitres: r2(row['Diesel Issuance']), contractRoadExpenses: r2(row['Road Expenses']), supervisor: String(row.Supervisor || '').trim(), remarks: `Client contract card · ${size} · ${String(row.State || '').trim()}` };
  const allExisting = (existingByLane.get(k) || []).filter((r) => !touched.has(r.id)); const existing = allExisting.filter((r) => !r.vehicleType || E.norm(r.vehicleType) === E.norm(base.vehicleType));
  for (const r of allExisting.filter((r) => r.vehicleType && E.norm(r.vehicleType) !== E.norm(base.vehicleType))) report.vehicleTypeMismatch.push({ client, from, to, tonnage, cardVehicleType: base.vehicleType, cardPrice: price, existingRate: r.id, existingVehicleType: r.vehicleType, existingPrice: r.price });
  const same = existing.find((r) => Math.abs(Number(r.price) - price) < 1 && (r.priceBasis || 'exclusive') === 'exclusive');
  if (same) { touched.add(same.id); Object.assign(same, { truckSize: same.truckSize || size, contractKm: base.contractKm, contractTotalKm: base.contractTotalKm, contractDieselLitres: base.contractDieselLitres, contractRoadExpenses: base.contractRoadExpenses, destinationState: base.destinationState, confirmedBy: SOURCE, confirmedAt: IMPORTED }); report.unchanged++; if (same.contractKm !== null) kmCheck(client, from, to, tonnage, base.contractKm, size); continue; }
  const id = 'rate-' + [E.norm(client), E.locKey(from), E.locKey(to), E.normContract(tonnage), E.norm(size), price, 'exclusive'].join('|').replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 120);
  if (out.some((r) => r.id === id)) continue;
  const old = existing.filter((r) => Math.abs(Number(r.price) - price) >= 1);
  if (old.length) { for (const o of old) { if (!o.expiryDate || o.expiryDate > EXPIRE_OLD) { o.expiryDate = EXPIRE_OLD; o.supersededBy = id; o.updatedAt = STAMP.updatedAt; o.updatedBy = STAMP.updatedBy; report.expired++; } touched.add(o.id); } report.changed.push({ client, from, to, tonnage, size, before: old.map((o) => o.price), after: price, changePct: r2(((price - old[0].price) / old[0].price) * 100) }); out.push(Object.assign({ id, effectiveDate: EFFECTIVE_CHANGED, expiryDate: '', supersedes: old.map((o) => o.id), version: 1 }, base, STAMP)); }
  else { out.push(Object.assign({ id, effectiveDate: EFFECTIVE_NEW, effectiveAssumed: true, expiryDate: '', version: 1 }, base, STAMP)); report.added++; }
  kmCheck(client, from, to, tonnage, base.contractKm, size);
}
function kmCheck(client, from, to, tonnage, km, size) { if (km === null) return; const route = routeFor(client, from, to, tonnage, size); if (route && route.kmOneWay && Math.abs(route.kmOneWay - km) > 5) report.kmDifferences.push({ route: route.id, client, from, to, tonnage, routeMasterKm: route.kmOneWay, cardKm: km }); }
function routeFor(client, from, to, tonnage, size) { const k = laneKey(client, from, to, tonnage, size || ''); const exact = size ? routes.find((r) => laneKey(r.client, r.loadingPoint, r.destination, r.tonnage, r.size || '') === k) : null; if (exact) return exact; const loose = laneKey(client, from, to, tonnage); return routes.filter((r) => laneKey(r.client, r.loadingPoint, r.destination, r.tonnage) === loose).find((r) => !size || !r.size || E.norm(r.size) === E.norm(size)) || null; }
report.ratesTotal = out.length; report.ratesActive = out.filter((r) => !r.expiryDate || r.expiryDate >= IMPORTED).length;

// ------------------------------------------------------------------ 2. Route Master prices and new lanes
let seq = Math.max(0, ...routes.filter((r) => /^RM-\d+$/.test(r.id)).map((r) => Number(r.id.slice(3)))); const addedLanes = new Set();
for (const row of crc) {
  const price = Number(row.Price); if (!(price > 0)) continue; const client = clientName(row.Client); const from = String(row['Loading Point'] || '').trim(), to = String(row.Destination || '').trim(); const tonnage = ton(row['Truck Tonnage']);
  const size = String(row['Truck Size'] || '').trim(); const route = routeFor(client, from, to, tonnage, size);
  if (route) {
    if (!(Number(route.price) > 0)) { route.price = r2(price); route.priceSupplied = true; route.priceSource = SOURCE; route.priceHistory = (route.priceHistory || []).concat([{ at: STAMP.updatedAt, source: SOURCE, before: null, after: r2(price) }]); route.updatedAt = STAMP.updatedAt; route.updatedBy = STAMP.updatedBy; report.routesPriced++; }
    else if (Math.abs(Number(route.price) - price) >= 1 && !(route.priceHistory || []).some((h) => h.source === SOURCE)) { report.routePriceChanges.push({ route: route.id, client, from, to, tonnage, before: route.price, after: r2(price) }); route.priceHistory = (route.priceHistory || []).concat([{ at: STAMP.updatedAt, source: SOURCE, before: route.price, after: r2(price) }]); route.price = r2(price); route.priceSource = SOURCE; route.updatedAt = STAMP.updatedAt; route.updatedBy = STAMP.updatedBy; }
    if (route.kmOneWay && row.KM && Math.abs(route.kmOneWay - Number(row.KM)) > 5) report.routeKmDifferences++;
    continue;
  }
  const lk = laneKey(client, from, to, tonnage, size); if (addedLanes.has(lk)) continue; addedLanes.add(lk);
  seq++; const id = `RM-${String(seq).padStart(4, '0')}`; const km = r2(row.KM); const totalKm = r2(row['Total KM']) !== null ? r2(row['Total KM']) : km === null ? null : r2(km * 2);
  routes.push({ id, contractName: `${client}-${tonnage}-${String(row.Divison || '').trim()}-${String(row['Truck Size'] || '').trim()}`.toUpperCase(), size: String(row['Truck Size'] || '').trim(), division: String(row.Divison || '').trim(), tonnage, client, clientRaw: String(row.Client || '').trim(), loadingPoint: from, destination: to, state: String(row.State || '').trim(), destState: String(row.State || '').trim(), originState: zones[E.locKey(from)] === 'Lagos' ? 'Lagos' : /ibadan/i.test(from) ? 'Oyo' : /abuja/i.test(from) ? 'FCT' : /harcourt/i.test(from) ? 'Rivers' : /keffi/i.test(from) ? 'Nasarawa' : /ogere/i.test(from) ? 'Ogun' : '', region: '', kmOneWay: km, kmReturn: km, totalKm, kmSource: 'Client contract card (not road-routed)', days: null, offloading: 1, totalDays: null, tatDays: null, diesel: r2(row['Diesel Issuance']), roadExpenses: r2(row['Road Expenses']), contingency: 0, additional: 0, price: r2(price), priceSupplied: true, priceSource: SOURCE, status: 'Pending Approval', mappingNote: `Added from the client contract card on ${IMPORTED}; distance not road-routed — Route Master approval required`, routeMasterSource: SOURCE, effectiveDate: IMPORTED, duplicateLane: false, stops: to, legBreakdown: '', loadingAllowanceDays: 1, offloadingAllowanceDays: 1, version: 1, createdAt: STAMP.createdAt, createdBy: STAMP.createdBy, updatedAt: STAMP.updatedAt, updatedBy: STAMP.updatedBy });
  report.routesAdded++;
}

// ------------------------------------------------------------------ 3. NEW-DSL approved prices (cross-check only) and contractor prices (not imported)
const dslByLane = new Map(); for (const r of dsl) { if (Number(r['Approved Client Price']) > 0) dslByLane.set(laneKey(clientName(r.Client), r['Loading Point'], r.Destination, ton(r['Truck Tonnage'])), Number(r['Approved Client Price'])); if (Number(r.Contractor) > 0) report.contractorPrices++; }
for (const row of crc) { const price = Number(row.Price); if (!(price > 0)) continue; const k = laneKey(clientName(row.Client), row['Loading Point'], row.Destination, ton(row['Truck Tonnage'])); if (dslByLane.has(k) && Math.abs(dslByLane.get(k) - price) >= 1) report.dslDifferences.push({ client: clientName(row.Client), from: row['Loading Point'], to: row.Destination, tonnage: ton(row['Truck Tonnage']), size: row['Truck Size'], cardPrice: r2(price), dslApprovedPrice: r2(dslByLane.get(k)) }); }

// ------------------------------------------------------------------ 4. Location Master from the Name Changes sheet
for (const nc of names) { if (!nc['Standardised Name'] || !nc.State) continue; const key = E.locKey(nc['Standardised Name']); const cur = locationmaster[key]; if (cur && cur.status === 'approved' && cur.state) continue; locationmaster[key] = Object.assign({}, cur || {}, { name: String(nc['Standardised Name']).trim(), state: String(nc.State).trim(), candidates: [String(nc.State).trim()], confidence: 'approved', via: SOURCE, status: 'approved', source: SOURCE, updatedAt: STAMP.updatedAt, updatedBy: STAMP.updatedBy }); report.locationsAdded++; const orig = E.locKey(nc['Original Name']); if (orig && orig !== key && !(locationmaster[orig] && locationmaster[orig].status === 'approved')) { locationmaster[orig] = Object.assign({}, locationmaster[orig] || {}, { name: String(nc['Original Name']).trim(), state: String(nc.State).trim(), candidates: [String(nc.State).trim()], confidence: 'approved', via: SOURCE + ' (spelling of ' + String(nc['Standardised Name']).trim() + ')', status: 'approved', source: SOURCE, updatedAt: STAMP.updatedAt, updatedBy: STAMP.updatedBy }); report.locationsAdded++; } }

fs.writeFileSync(path.join(W, 'rates.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(W, 'routes.json'), JSON.stringify(routes, null, 0));
fs.writeFileSync(path.join(W, 'locationmaster.json'), JSON.stringify(locationmaster, null, 0));
fs.writeFileSync(path.join(W, 'client_rates_report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(Object.assign({}, report, { skippedNoPrice: report.skippedNoPrice.length, changed: report.changed.length, duplicateLanes: report.duplicateLanes.length, kmDifferences: report.kmDifferences.length, routePriceChanges: report.routePriceChanges.length, dslDifferences: report.dslDifferences.length, assumptions: report.assumptions.length, clientMapping: Object.keys(report.clientMapping).length, routesTotal: routes.length }), null, 1));
