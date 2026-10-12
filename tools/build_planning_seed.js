#!/usr/bin/env node
/* Builds the fleet-planning seed (routes, fleet/FMR, planning setup, requests, allocations) from the extracted
 * Truck Planning workbook, joined to the asset master. */
const fs = require('fs'); const path = require('path');
const E = require('../js/core/engine.js'); const P = require('../js/core/planning.js');
const ROOT = path.join(__dirname, '..'); const W = path.join(ROOT, 'data', 'workbook');
const x = JSON.parse(fs.readFileSync(path.join(W, 'planning_extract.json'), 'utf8'));
const assets = JSON.parse(fs.readFileSync(path.join(W, 'assets.json'), 'utf8'));
const clients = JSON.parse(fs.readFileSync(path.join(W, 'clients.json'), 'utf8'));
// The workbook is a snapshot: its FMR statuses were dated 2026-10-02. The seed re-dates that snapshot to the import
// date so the demo opens on a live-looking fleet (every operational date moves by the same number of days). Documented
// in docs/WORKBOOK_ANALYSIS.md; a production import would keep the dates as entered.
const IMPORT_DATE = process.env.IMPORT_DATE || new Date().toISOString().slice(0, 10);
const snapshotDate = x.fleet.map((r) => r['Date of this status']).filter(Boolean).sort().pop() || IMPORT_DATE;
const OFFSET = P.diffDays(IMPORT_DATE, snapshotDate);
const shift = (d) => (d ? P.addDays(d, OFFSET) : '');
const stamp = { version: 1, createdAt: IMPORT_DATE + 'T00:00:00Z', createdBy: 'planning-import', updatedAt: IMPORT_DATE + 'T00:00:00Z', updatedBy: 'planning-import' };
const CLIENT_ALIAS = { 'jat': 'JUBAILI AGROTEC', 'abba saleh': 'ABBA ABASS', 'givanas': 'GIVANAS', 'jamara': 'Jamara', 'jmg': 'JMG', 'interstyle': 'INTERSTYLE', 'mega manu': 'MEGA MANU', 'mega manu-local': 'MEGA MANU', 'vandera': 'VENDARA', 'lacasera': 'Lacasera', 'natural beauty': 'NATURAL BEAUTY', 'saso': 'SASO', "i'hs": "I'HS", 'orca': 'ORCA DECO LIMITED', 'niger biscuit': 'NIGER BISCUITS', 'walter & hiffy': 'WALTER & HIFY RESOURCES', 'lebruni': 'LEBRUNI AGRO LTD' };
const clientName = (n) => { const k = E.norm(n); if (CLIENT_ALIAS[k]) return CLIENT_ALIAS[k]; const c = clients.find((c) => E.norm(c.name) === k || E.norm(c.code) === k); return c ? c.name : E.clean(n); };
// clients that exist only in the planning workbook are added to the client master (code = initials)
const NEW_CLIENT_CODES = { 'BAJAJ': 'BAJ', 'ATLANTIC PVC': 'APVC' };
let clientsChanged = false;
for (const raw of [...new Set(x.routes.map((r) => r['Client']).filter(Boolean))]) {
  const name = clientName(raw); if (clients.some((c) => E.norm(c.name) === E.norm(name))) continue;
  const code = NEW_CLIENT_CODES[name.toUpperCase()] || name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 4);
  clients.push({ id: code.toLowerCase(), name, code, contractType: '', active: true, trips: 0, aliases: [], source: 'planning-workbook' }); clientsChanged = true;
}
if (clientsChanged) fs.writeFileSync(path.join(W, 'clients.json'), JSON.stringify(clients, null, 1));
// routes
const routes = x.routes.map((r, i) => ({ id: 'R' + String(i + 1).padStart(3, '0'), contractName: r['Contract name'], size: r['Truck size'], division: r['Division'], tonnage: r['Tonnage'], client: clientName(r['Client']), clientRaw: r['Client'], loadingPoint: E.clean(r['Loading point']), destination: E.clean(r['Destination']), state: r['State'], region: r['Region'], kmOneWay: E.num(r['KM one way']), totalKm: E.num(r['Total KM']), days: E.num(r['Days']), offloading: E.num(r['Offloading']), totalDays: E.num(r['Total days']), diesel: E.num(r['Diesel issuance (L)']), roadExpenses: E.num(r['Road expenses']), contingency: E.num(r['Contingency']), additional: E.num(r['Additional road expenses']), price: E.num(r['Approved client price']), ...stamp }));
// planning setup
const planning = { id: 'planning', importedFrom: 'Truck_Planning_Managment_Rev1.xlsx', snapshotDate, importDate: IMPORT_DATE, dateShiftDays: OFFSET, setup: Object.assign({}, P.DEFAULT_SETUP, { dieselPrice: x.setup['Diesel price per litre'], defaultTAT: x.setup['Fallback turnaround (days)'], buffer: x.setup['Buffer added to every return (days)'], idleDays: x.setup['Flag a truck idle after (days)'], repoDefault: x.setup['Default repositioning (days)'], repoSame: x.setup['Dropping at the same place (days)'], runwayDays: x.setup['Runway window (days)'] }), repo: x.repo.map((r) => ({ from: E.clean(r.from), to: E.clean(r.to), days: Number(r.days) })), statuses: P.DEFAULT_STATUSES, bodyRuns: P.DEFAULT_BODY_RUNS, sizeTon: [['JUMBO', '30T'], ['FLATBED', '45T'], ['JUMBO', '40T'], ['FLATBED-local', ''], ['CONTAINARIZED', '']], ...stamp };
// fleet (FMR) joined to assets
const routeByLabel = new Map(routes.map((r) => [E.norm(P.routeLabel(r)), r]));
const byPlate = new Map(assets.map((a) => [P.plateKey(a.plate), a]));
const fleet = []; const seen = new Set();
for (const f of x.fleet) {
  const key = P.plateKey(f['Truck / reg']); const a = byPlate.get(key); seen.add(key);
  const routeLabel = f['Route it is running'] || ''; const route = routeByLabel.get(E.norm(routeLabel)) || routes.find((r) => E.norm(routeLabel).includes(E.norm(r.id)));
  const status = P.canonicalStatus(f['Status'], planning);
  fleet.push({ id: a ? a.id || a.plate.replace(/[^A-Za-z0-9_-]+/g, '-') : f['Truck / reg'].replace(/[^A-Za-z0-9_-]+/g, '-'), plate: a ? a.plate : f['Truck / reg'], assetCode: a ? a.assetCode : '', bodyType: f['Body type'] || '', tonnage: f['Tonnage'] || '', runsContracts: P.bodyRuns(f['Body type'], planning), driver: f['Driver'] || '', homeStation: f['Home station'] || 'Lagos', currentLocation: f['Where it will drop'] && status && /At Destination|Offloading|Inbound/.test(status) ? f['Where it will drop'] : (status === 'Available' ? 'Lagos' : ''), status, statusAt: f['Date of this status'] ? shift(f['Date of this status']) + 'T08:00:00Z' : '', updatedBy: 'tracking', client: route ? route.client : '', tripId: '', routeId: route ? route.id : '', loadingFrom: route ? route.loadingPoint : '', destination: f['Where it will drop'] || (route ? route.destination : ''), loadingDate: shift(f['Date loaded']), etaDelivery: '', actualDelivery: '', etaOffloadDone: '', etaReturn: '', workshopRelease: shift(f['Workshop release date']), daysDown: E.num(f['Days down']), remarks: '', active: true, ...stamp });
}
for (const a of assets) { const key = P.plateKey(a.plate); if (seen.has(key) || a.plate === 'THIRD-PARTYHAULAGE') continue; fleet.push({ id: a.id || a.plate.replace(/[^A-Za-z0-9_-]+/g, '-'), plate: a.plate, assetCode: a.assetCode, bodyType: a.vehicleType === 'HAULAGE' ? '102' : a.vehicleType === 'Flat Trucks Logistics' ? 'FLAT' : a.vehicleType === 'Closed Body Logistics' ? 'Pallatized Body' : 'Free Head', tonnage: a.vehicleType === 'HAULAGE' ? '45T' : '', runsContracts: '', driver: '', homeStation: 'Lagos', currentLocation: '', status: '', statusAt: '', updatedBy: '', client: '', tripId: '', routeId: '', loadingFrom: '', destination: '', loadingDate: '', etaDelivery: '', actualDelivery: '', etaOffloadDone: '', etaReturn: '', workshopRelease: '', daysDown: null, remarks: 'Not on the FMR sheet; status to be set by tracking', active: true, ...stamp }); }
for (const f of fleet) f.runsContracts = P.bodyRuns(f.bodyType, planning);
// requests
const requests = x.requests.map((r) => { const route = routeByLabel.get(E.norm(r.route)) || routes.find((rt) => E.norm(r.route).startsWith(E.norm(rt.id))); return { id: r.id, requestedAt: shift(r.date || '2026-09-01') + 'T09:00:00Z', client: clientName(r.client), reference: '', routeId: route ? route.id : '', loadingFrom: route ? route.loadingPoint : '', destination: route ? route.destination : '', vehicleType: route ? route.size : '', tonnage: route ? route.tonnage : '', trucks: Number(r.trucks) || 1, loadingDate: shift(r.date), deliveryDate: '', priority: r.priority || 'Normal', contact: '', instructions: '', remarks: r.notes || '', status: r.status === 'Closed' ? 'Completed' : 'New Request', ...stamp }; });
// allocations (committed trips)
const allocations = x.committed.map((c, i) => { const route = routeByLabel.get(E.norm(c.route)) || routes.find((rt) => E.norm(c.route).startsWith(E.norm(rt.id))); const a = byPlate.get(P.plateKey(c.truck)); const load = shift(c.load); const d = P.allocationDates(route, load, planning); return { id: 'ALC-' + String(load || '260901').replace(/-/g, '').slice(2) + '-' + String(i + 1).padStart(2, '0'), requestId: c.request, client: clientName(c.client), plate: a ? a.plate : c.truck, assetCode: a ? a.assetCode : '', truckBatch: a ? (a.vehicleCategory === 'New Batch' ? 'New Batch' : 'Old Batch') : '', routeId: route ? route.id : '', loadingFrom: route ? route.loadingPoint : '', destination: route ? route.destination : '', vehicleType: route ? route.size : '', tonnage: route ? route.tonnage : '', plannedLoadingDate: load, plannedDeploymentDate: load, reachesClient: d.reachesClient, backOnGround: d.backOnGround, status: c.stage === 'Cancelled' ? 'Cancelled' : c.stage === 'Completed' ? 'Completed' : c.stage === 'Loaded' ? 'Loaded' : 'Planned', tripId: '', tripLogId: '', ...stamp }; });
// Committed trips whose return date is already behind the import date are history: mark them Completed.
for (const a of allocations) if (a.status === 'Planned' && a.backOnGround && a.backOnGround < IMPORT_DATE) { a.status = 'Completed'; a.completedAt = a.backOnGround + 'T18:00:00Z'; a.remarks = 'Completed before the planning module went live (workbook committed trip)'; }
// Demo: plan the first open requests with the best-ranked trucks so the Fleet Planning screens have live allocations.
{
  const ctx0 = { planning, routes, fleet, allocations, requests, today: IMPORT_DATE };
  const open = requests.filter((r) => r.status !== 'Completed' && r.status !== 'Cancelled').slice(0, 3);
  for (const r of open) {
    const plan = P.planForRequest(Object.assign({}, r, { loadingDate: P.addDays(IMPORT_DATE, 1) }), ctx0);
    const picks = plan.rows.filter((x) => x.fit === 'Yes' && !x.booked.length && x.canLoad && x.status.category !== P.AVAILABILITY_CATEGORIES[5]).slice(0, Math.min(2, Math.max(1, (r.trucks || 1) - 0)));
    for (const p of picks) {
      const d = P.allocationDates(plan.route, p.canLoad, planning);
      allocations.push({ id: P.nextAllocationId(p.canLoad, allocations), requestId: r.id, client: r.client, plate: p.truck.plate, assetCode: p.truck.assetCode, truckBatch: (byPlate.get(P.plateKey(p.truck.plate)) || {}).vehicleCategory === 'New Batch' ? 'New Batch' : 'Old Batch', routeId: r.routeId, loadingFrom: r.loadingFrom, destination: r.destination, vehicleType: r.vehicleType, tonnage: r.tonnage, plannedLoadingDate: p.canLoad, plannedDeploymentDate: p.canLoad, reachesClient: d.reachesClient, backOnGround: d.backOnGround, status: 'Planned', tripId: '', tripLogId: '', remarks: 'Seeded demo allocation', ...stamp });
    }
  }
}
fs.writeFileSync(path.join(W, 'routes.json'), JSON.stringify(routes));
fs.writeFileSync(path.join(W, 'planning.json'), JSON.stringify(planning));
fs.writeFileSync(path.join(W, 'fleet.json'), JSON.stringify(fleet, null, 1));
fs.writeFileSync(path.join(W, 'requests.json'), JSON.stringify(requests, null, 1));
fs.writeFileSync(path.join(W, 'allocations.json'), JSON.stringify(allocations, null, 1));
console.log(`routes ${routes.length}, fleet ${fleet.length} (${fleet.filter((f) => f.status).length} with status), repo ${planning.repo.length}, requests ${requests.length}, allocations ${allocations.length}`);
console.log('unmatched route clients:', [...new Set(routes.map((r) => r.client).filter((c) => !clients.some((k) => E.norm(k.name) === E.norm(c))))].join(', ') || 'none');
console.log('fleet statuses:', [...new Set(fleet.map((f) => f.status))].join(' | '));
const ctx = { planning, routes, fleet, allocations, requests, today: IMPORT_DATE };
console.log(`snapshot ${snapshotDate} re-dated to ${IMPORT_DATE} (+${OFFSET} days)`);
const k = P.fleetKpis(ctx); console.log('KPIs:', JSON.stringify({ totalFleet: k.totalFleet, available: k.available, availableUnplanned: k.availableUnplanned, onTrip: k.onTrip, inWorkshop: k.inWorkshop, unconfirmed: k.unconfirmed, openRequests: k.openRequests, outstanding: k.outstandingTrucks, trackingOverdue: k.trackingOverdue }));
console.log('categories:', k.byCategory.map((c) => c.category + '=' + c.count).join(', '));
