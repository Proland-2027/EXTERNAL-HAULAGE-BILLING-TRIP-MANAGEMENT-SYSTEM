#!/usr/bin/env node
/* Builds the Location Master seed (data/workbook/locationmaster.json): every location name used on trips, routes,
 * requests, allocations and the FMR, with its standardised state. Exact gazetteer matches are approved; spelling
 * matches, ambiguous zone lists and unknown names stay "suggested" until an administrator confirms them. */
const fs = require('fs'); const path = require('path');
const G = require('../js/core/geo.js');
const W = path.join(__dirname, '..', 'data', 'workbook'); const read = (n) => (fs.existsSync(path.join(W, n)) ? JSON.parse(fs.readFileSync(path.join(W, n), 'utf8')) : []);
const names = new Set();
for (const t of read('trips.json')) { if (t.loadingFrom) names.add(t.loadingFrom); if (t.loadingTo) names.add(t.loadingTo); }
for (const r of read('routes.json')) { names.add(r.loadingPoint); names.add(r.destination); }
for (const r of read('requests.json')) { names.add(r.loadingFrom); names.add(r.destination); }
for (const a of read('allocations.json')) { names.add(a.loadingFrom); names.add(a.destination); }
for (const f of read('fleet.json')) { if (f.homeStation) names.add(f.homeStation); if (f.destination) names.add(f.destination); if (f.currentLocation) names.add(f.currentLocation); }
for (const l of read('locations.json')) names.add(l);
const master = G.suggestMaster([...names].map((n) => String(n).trim()).filter(Boolean), {});
for (const v of Object.values(master)) { v.updatedAt = (process.env.IMPORT_DATE || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'; v.updatedBy = 'location-import'; }
fs.writeFileSync(path.join(W, 'locationmaster.json'), JSON.stringify(master, null, 1));
const by = {}; for (const v of Object.values(master)) by[v.status + '/' + v.confidence] = (by[v.status + '/' + v.confidence] || 0) + 1;
console.log(Object.keys(master).length, 'locations →', by);
