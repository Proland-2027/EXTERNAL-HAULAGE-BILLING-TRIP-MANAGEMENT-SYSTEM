#!/usr/bin/env node
/* Builds the application masters from the Setup_Haulage workbook extract (tools/extract_setup.py → data/workbook/setup_extract.json):
 *   assets.json      merged with the Asset Code sheet (cost centers, tonnage, body, type, driver mapping)
 *   fleet.json       driver / station officer from the driver mapping; driver-mapped vehicles missing from the FMR are added without a status
 *   staff.json, costcenters.json, lob.json, accounts.json, items.json, suppliers.json, ratecard.json, tplrates.json, routezones.json
 *   routes.json      the "All Routes" sheet becomes the authoritative Route Master: existing routes are matched by contract + lane and
 *                    their kilometres updated (previous values kept in kmHistory), new lanes are added, unmatched legacy routes are kept
 *   planning.json    diesel KPI matrix, journey-planning KPIs (300 km/day, 1 + 1 days), OTD bands, port expense table
 * Nothing is invented: values the workbook does not carry stay null and are listed in the report (data/workbook/setup_report.json). */
const fs = require('fs'); const path = require('path');
const W = path.join(__dirname, '..', 'data', 'workbook');
const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8'));
const write = (n, v) => fs.writeFileSync(path.join(W, n), JSON.stringify(v));
const exists = (n) => fs.existsSync(path.join(W, n));
const X = read('setup_extract.json');
const IMPORT_DATE = process.env.IMPORT_DATE || '2026-10-15';
const AT = IMPORT_DATE + 'T00:00:00Z'; const BY = 'setup-import';
const stamp = (o) => Object.assign({ version: 1, createdAt: AT, createdBy: BY, updatedAt: AT, updatedBy: BY }, o);
const norm = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const key = (s) => norm(s).replace(/\s+/g, '');
const plateKey = (p) => String(p || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const report = { source: X.source, importDate: IMPORT_DATE, missing: [], conflicts: [], assumptions: [], counts: {} };

// ------------------------------------------------------------------ cost centers and LOB
const LOB = X.lob.map((n) => ({ id: key(n), name: n.trim(), active: true }));
const CC_LOB = { CC059: 'Haulage', CC046: 'Haulage', CC039: 'Hiab', CC047: 'Vans' };
report.assumptions.push('Default LOB per cost center: CC059 Haulage and CC046 Flat Trucks → Haulage, CC039 Hiabs → Hiab, CC047 Closed Body → Vans; overhead, workshop and stores cost centers carry no LOB. The planner can change the LOB on every allocation.');
const ccMap = new Map();
const addCc = (code, name, kind) => { if (!code) return; const c = ccMap.get(code) || { id: code, name: name || code, kind, active: true, defaultLob: CC_LOB[code] || '', budgetMonthly: null, assets: 0, staff: 0 }; if (name && (!c.name || c.name === code)) c.name = name; if (kind === 'fleet') c.kind = 'fleet'; ccMap.set(code, c); return c; };
for (const r of X.assets.rows) addCc(r['Cost Center'], r['Cost Center Name'], 'fleet').assets++;
for (const r of X.staff.rows) addCc(r.costcenter, r['CC Name'], /workshop/i.test(r['CC Name'] || '') ? 'workshop' : /store/i.test(r['CC Name'] || '') ? 'stores' : 'overhead').staff++;
const cc039 = X.assets.rows.filter((r) => r['Cost Center'] === 'CC039' && !/hiab/i.test(r['Cost Center Name'] || ''));
if (cc039.length) report.conflicts.push(`Asset Code sheet: ${cc039.map((r) => r['Plate Number']).join(', ')} carr${cc039.length === 1 ? 'ies' : 'y'} cost center CC039 with the name "${cc039[0]['Cost Center Name']}" while CC039 is Hiabs Logistics elsewhere; CC039 = Hiabs Logistics is kept and the asset keeps its code.`);
const costcenters = [...ccMap.values()].sort((a, b) => a.id.localeCompare(b.id)).map(stamp);
report.missing.push('Cost center budgets are not in the workbook (budgetMonthly is null); the "cost centers exceeding budget" question answers "no budget set" until Finance enters budgets.');

// ------------------------------------------------------------------ assets (merge)
const oldAssets = exists('assets.json') ? read('assets.json') : [];
const byPlate = new Map(oldAssets.map((a) => [plateKey(a.plate), a])); const byCode = new Map(oldAssets.map((a) => [a.assetCode, a]));
const drivers = new Map(X.driverMapping.rows.map((r) => [r['Asset code'], r]));
const displayPlate = (p) => { const s = String(p || '').trim().toUpperCase(); const m = s.match(/^T(\d{4,5})LA$/); return m ? `T-${m[1]}LA` : s; };
const vehicleTypeFor = (r) => { const cc = r['Cost Center Name'] || ''; if (/flat/i.test(cc)) return 'FLATBED'; if (/hiab/i.test(cc)) return 'HIAB'; if (/closed/i.test(cc)) return 'Closed Body Logistics'; if (/haulage/i.test(cc)) return 'HAULAGE'; return r.Type || ''; };
const assets = []; const seen = new Set(); let merged = 0, added = 0;
for (const r of X.assets.rows) {
  const cur = byPlate.get(plateKey(r['Plate Number'])) || byCode.get(r['Asset code']) || null; const d = drivers.get(r['Asset code']);
  const a = Object.assign({}, cur || { id: displayPlate(r['Plate Number']).replace(/[^A-Za-z0-9_-]+/g, '-'), plate: displayPlate(r['Plate Number']), vehicleType: vehicleTypeFor(r), vehicleCategory: 'Unclassified', active: true, batchHistory: [] }, {
    assetCode: r['Asset code'], assetName: r['Asset Name'] || '', tonnage: r.Tonnage || '', bodySize: r['Body Size'] || '', assetType: r.Type || '', costCenter: r['Cost Center'] || (cur && cur.costCenter) || '', costCenterName: r['Cost Center Name'] || '',
    homeStation: (cur && cur.homeStation) || (d && d['Station Officer'] ? 'Lagos' : ''), inFmr: !!(cur || d), setupMaster: true,
  });
  if (cur && cur.costCenter && cur.costCenter !== a.costCenter) { a.costCenterHistory = [...(cur.costCenterHistory || []), { from: cur.costCenter, to: a.costCenter, at: AT, source: X.source }]; }
  if (d) Object.assign(a, { driver: (d['HR Registered name'] || '').trim(), driverShortName: (d['Camanda Driver Name'] || '').trim(), driverStaffId: d['Staff ID no'] ? String(d['Staff ID no']).padStart(6, '0') : '', stationOfficer: (d['Station Officer'] || '').trim(), operationsManager: (d['Operation Manager'] || '').trim() });
  if (!a.vehicleCategory || a.vehicleCategory === 'Unclassified') a.batchUnclassified = true;
  if (cur) merged++; else added++;
  seen.add(plateKey(a.plate)); assets.push(a);
}
for (const a of oldAssets) if (!seen.has(plateKey(a.plate))) { assets.push(Object.assign({}, a, { notInSetupMaster: true })); report.conflicts.push(`Asset ${a.plate} (${a.assetCode}) is in the Haulage Billing asset list but not in the Setup_Haulage Asset Code sheet; kept and flagged.`); }
report.counts.assets = { setup: X.assets.rows.length, merged, added, keptLegacy: assets.length - merged - added, unclassifiedBatch: assets.filter((a) => a.batchUnclassified).length };
report.missing.push(`${assets.filter((a) => a.batchUnclassified).length} vehicles from the Asset Code sheet have no New Batch / Old Batch classification in any workbook (shown as "Unclassified" until an administrator sets it).`);
report.missing.push('Acquisition information (purchase date, cost) is not in the workbook; the asset master carries the fields empty.');
write('assets.json', assets);

// ------------------------------------------------------------------ fleet (driver mapping, missing operational trucks)
const fleet = exists('fleet.json') ? read('fleet.json') : []; const fleetBy = new Map(fleet.map((t) => [plateKey(t.plate), t])); let fleetDrivers = 0, fleetAdded = 0;
for (const r of X.driverMapping.rows) {
  const t = fleetBy.get(plateKey(r['Plate Number'])); const hr = (r['HR Registered name'] || '').trim();
  if (t) { if (hr && t.driver !== hr) { t.driverHistory = [...(t.driverHistory || []), { from: t.driver || '', to: hr, at: AT, source: 'Driver mapping sheet' }]; t.driver = hr; fleetDrivers++; } t.driverStaffId = r['Staff ID no'] ? String(r['Staff ID no']).padStart(6, '0') : ''; t.stationOfficer = (r['Station Officer'] || '').trim(); t.operationsManager = (r['Operation Manager'] || '').trim(); t.assetCode = t.assetCode || r['Asset code']; continue; }
  const a = assets.find((x) => x.assetCode === r['Asset code']);
  fleet.push(stamp({ id: a ? a.plate : displayPlate(r['Plate Number']), plate: a ? a.plate : displayPlate(r['Plate Number']), assetCode: r['Asset code'], bodyType: /flat/i.test(r['Body Size'] || '') ? 'FLAT' : /102/.test(r['Body Size'] || '') ? '102' : (r['Body Size'] || ''), tonnage: r.Tonnage || '', runsContracts: '', driver: hr, driverStaffId: r['Staff ID no'] ? String(r['Staff ID no']).padStart(6, '0') : '', stationOfficer: (r['Station Officer'] || '').trim(), operationsManager: (r['Operation Manager'] || '').trim(), homeStation: 'Lagos', currentLocation: '', status: '', statusAt: '', updatedBy: BY, client: '', tripId: '', routeId: '', loadingFrom: '', destination: '', loadingDate: '', etaDelivery: '', actualDelivery: '', etaOffloadDone: '', etaReturn: '', workshopRelease: '', daysDown: null, remarks: 'Added from the Setup_Haulage driver mapping; no tracking status reported yet', active: true }));
  fleetAdded++;
}
report.counts.fleet = { trucks: fleet.length, driversUpdated: fleetDrivers, addedWithoutStatus: fleetAdded };
if (fleetAdded) report.missing.push(`${fleetAdded} driver-mapped vehicles were not on the Truck Planning FMR; they are added without an operational status (shown as status unconfirmed until the tracking team updates them).`);
write('fleet.json', fleet);

// ------------------------------------------------------------------ staff
const staff = X.staff.rows.map((r) => stamp({ id: String(r['Employee staff number']).padStart(6, '0'), name: (r.NAME || '').trim(), position: (r['Position Name'] || '').trim(), company: r.Company || '', joinedAt: r['JOINING DATE'] || '', category: r['Employee category'] || '', staffGroup: r['Staff Group (Local/Expatriate/3rd Party'] || '', branchCode: r['Branch Code'] || '', branchName: r['Branch Name'] || '', costCenter: r.costcenter || '', costCenterName: r['CC Name'] || '', deptCode: r['Dept Code'] || '', deptName: r['Dept Name'] || '', type: r.Type || '', jobFunction: r['Job Function'] || '', division: r.Division || '', businessUnit: r['Business Unit'] || '', intercompany: r['Intercompany functions'] || '', withinJmg: r['Within JMG function'] || '', manager: r["Reporting line Manager's Name"] || '', section: r.Section || '', country: r['Country of Resident'] || '', status: 'Active' }));
report.counts.staff = staff.length; write('staff.json', staff);
write('lob.json', LOB.map(stamp)); write('costcenters.json', costcenters);

// ------------------------------------------------------------------ chart of accounts (expense accounts)
const MODULE_OF = { 6101027: 'road', 6103008: 'diesel', 6103009: 'diesel', 6103013: 'extra', 6105047: 'extra', 6105051: 'port', 6102028: 'maintenance', 6102010: 'maintenance', 6102009: 'maintenance', 6101030: 'extra', 6105061: 'extra', 6105040: 'extra', 6105001: 'tpl', 6105002: 'tpl', 6105003: 'tpl' };
let lastType = ''; let newN = 0; const accounts = [];
for (const r of X.accounts.rows) {
  if (r.Type) lastType = r.Type.trim(); const name = (r['Account Name'] || '').trim(); if (!name) continue;
  const n = num(r['Account number']); const pending = n === null; const id = pending ? 'NEW-' + key(name).toUpperCase().slice(0, 12) + '-' + (++newN) : String(n);
  const mod = pending ? (/cng/i.test(name) ? 'diesel' : /tracking/i.test(name) ? 'asset' : 'nonoperational') : MODULE_OF[n] || 'other';
  accounts.push(stamp({ id, accountNumber: pending ? '' : String(n), pendingAccountNumber: pending, name, type: lastType, expenseType: (r['Expense Type'] || '').trim(), kpiRule: (r.KPI || '').trim(), module: lastType === 'Non-Operational Expenses' ? 'nonoperational' : mod, active: true }));
}
report.counts.accounts = accounts.length;
report.missing.push(`Expense accounts without a general-ledger number in the workbook: ${accounts.filter((a) => a.pendingAccountNumber).map((a) => a.name).join(', ')}. They are listed as pending; postings to them are held as "account number pending" until Finance supplies the number.`);
report.missing.push('No revenue (sales) account numbers were supplied; revenue postings carry the LOB and cost center but an empty GL account until Finance adds revenue accounts to the Chart of Accounts.');
// category → account suggestions (editable in the Chart of Accounts screen)
const CATEGORY_ACCOUNTS = { 'Extra diesel': '6103013', 'Road expenses': '6101027', 'Loading / offloading labour': '6101030', 'Police / checkpoint': '6105061', 'Toll / levy': '6105047', 'Repairs on the road': '6102010', 'Accommodation / feeding': '6101027', 'Towing': '6105040', 'Demurrage': '6105047', 'Other': '6105047', 'Manual pushing': '6101030', 'Community settlement': '6105061', 'Tickets and stickers': '6105047', 'Port expenses': '6105051', 'CNG allowance': 'NEW-CNGEXPENSE-1' };
report.assumptions.push('Suggested expense account per additional-expense category (editable): extra diesel → 6103013, road / accommodation → 6101027, labour and pushing → 6101030, police / community → 6105061, tolls, tickets, demurrage, other → 6105047, repairs on the road → 6102010, towing → 6105040, port expenses → 6105051.');
write('accounts.json', accounts); write('accountmap.json', { id: 'accountmap', categoryAccounts: CATEGORY_ACCOUNTS, dieselAccounts: { default: '6103009', hiab: '6103008', cng: accounts.find((a) => /cng/i.test(a.name)).id }, roadAccount: '6101027', tplAccounts: { default: '6105001', crane: '6105002', staff: '6105003' }, maintenanceAccounts: { default: '6102010', hiab: '6102009', tyre: '6102028' }, revenueAccounts: {}, version: 1 });

// ------------------------------------------------------------------ items (spare parts)
const items = X.items.rows.map((r) => stamp({ id: String(r['Item Number']).trim(), description: (r['Part Name'] || '').trim(), originalDescription: r['Original Description'] || '', vehicleModel: r['Vehicle Model'] === '—' ? '' : (r['Vehicle Model'] || ''), vehicleType: r['Vehicle Type'] || '', make: r.Make || '', originalCategory: r['Original Category'] || '', category: r.Category || '', group: r.Group || '', subgroup: r.Subgroup || '', itemClass: r['Suggested Class'] || '', unit: 'EA', partNumber: '', compatibleVehicle: r['Vehicle Model'] === '—' ? '' : (r['Vehicle Model'] || ''), unitCost: num(r.Cost) || 0, costSupplied: num(r.Cost) !== null && num(r.Cost) > 0, stockQty: 0, stockSupplied: false, reorderLevel: null, inventoryAccount: '', expenseAccount: /tyre/i.test(r['Suggested Class'] || '') ? '6102028' : '6102010', active: true }));
report.counts.items = { items: items.length, withCost: items.filter((i) => i.costSupplied).length, duplicateIds: items.length - new Set(items.map((i) => i.id)).size };
report.missing.push(`Item list: stock quantities, units of measure, part numbers, reorder levels and inventory accounts are not in the workbook (unit defaults to EA, stock starts at 0 and is flagged "stock not supplied", ${items.length - items.filter((i) => i.costSupplied).length} items have no unit cost). Expense account defaults: tyres → 6102028, everything else → 6102010 (Hiab jobs post to 6102009 by the job card's vehicle).`);
write('items.json', items);

// ------------------------------------------------------------------ suppliers
const CAP = { HAIB: 'hiab', Crane: 'crane', FLATBED: 'flatbed', 'Low-bed': 'lowbed', '20FT': '20FT', '25FT': '25FT', '40FT': '40FT', Upcountry: 'upcountry', Local: 'local', Forklift: 'forklift', Trucks: 'sellTrucks', Trailers: 'sellTrailers', 'Spare Parts': 'spareParts', 'External Workshop': 'externalWorkshop', 'Tracking Company': 'tracking', 'Diesel Supplier': 'diesel', 'Tyre Supplier': 'tyre' };
const suppliers = X.suppliers.rows.map((r) => { const caps = {}; for (const [col, k] of Object.entries(CAP)) caps[k] = /^y/i.test(String(r[col] || '')); return stamp({ id: String(r['Supplier account']).trim(), name: (r.Name || '').trim(), onHold: /^y/i.test(String(r['Supplier hold'] || '')), paymentTerms: r.Proposed || '', expenseType: (r['Type Of Expenses'] || '').trim(), division: (r['Used by Division'] || '').trim(), capabilities: caps, is3pl: /3rd party logistics/i.test(r['Used by Division'] || '') || caps.hiab || caps.crane || caps.flatbed || caps.lowbed || caps['20FT'] || caps['25FT'] || caps['40FT'], active: true }); });
report.counts.suppliers = { suppliers: suppliers.length, tpl: suppliers.filter((s) => s.is3pl).length };
write('suppliers.json', suppliers);

// ------------------------------------------------------------------ rate card (costing)
const ratecard = X.ratecard.rows.map((r) => stamp({ id: String(r['ASSET ID']).trim(), assetCode: String(r['ASSET ID']).trim(), division: (r.DIVISION || '').trim(), oldPlate: r['OLD PLATE NO'] || '', plate: displayPlate(r['NEW PLATE NO'] || r['OLD PLATE NO']), consumptionLPerKm: num(r.Consumption), maintenanceBudgetMonthly: num(r['Mentaiance Budget']), tripsPerMonth: num(r['Montly Trip']), kmPerMonth: num(r.KM), projectedDays: num(r['Project Number of Day']), plannedDays: num(r.Planned), fixedCostPerDay: num(r['Actual Fixed Cost']), mtcCostPerKm: num(r['MTC Cost Per KM']), tyreCostPerKm: num(r['Tyre Cost Per KM']), roadExpensePerKm: num(r['Road Expenses Per KM']), sellingFixedPerDay: num(r['Selling Fixed']) }));
report.counts.ratecard = ratecard.length;
report.assumptions.push('Rate Card for costing: "Actual Fixed Cost" and "Selling Fixed" are read as amounts per planned working day (the sheet gives Project Number of Day / Planned days per asset), "KM" as planned kilometres per month; MTC, tyre and road costs are per km as given. Diesel cost in costing uses the diesel price in Settings (₦ per litre, editable) because the workbook has no diesel price.');
report.conflicts.push(`Rate Card road expense per km differs by division (${[...new Set(ratecard.map((r) => r.roadExpensePerKm))].sort((a, b) => a - b).join(' / ')} ₦/km) while the Expense Account sheet fixes the driver road allowance at ₦25/km; the payment slip keeps ₦25/km (operational standard) and costing uses the rate card value.`);
write('ratecard.json', ratecard);
const unmatchedRc = ratecard.filter((r) => !assets.some((a) => a.assetCode === r.assetCode)); if (unmatchedRc.length) report.conflicts.push(`Rate card assets not in the Asset Code sheet: ${unmatchedRc.map((r) => r.assetCode + ' ' + r.plate).join(', ')}.`);

// ------------------------------------------------------------------ 3PL rate card (blank by instruction)
const EQ = ['20FT', '25FT', '40FT', 'Crane', 'Hiab', 'Flatbed', 'Forklift'];
const rateCols = (r) => Object.fromEntries(EQ.map((e) => [e, num(r[`${e} - Rate per Trip (NGN)`])]));
const tplrates = [...X.tplRateInternal.rows.map((r, i) => stamp({ id: `TPLZ-${String(i + 1).padStart(3, '0')}`, kind: 'internal', state: r.State, loadingPoint: r.Depot, zone: r['Zone (Route)'], description: r['Route Description'], destination: r['Zone (Route)'] + ' zone', destState: r.State, roundTripKm: num(r['Round Trip KM (zone centre)']), rates: rateCols(r), status: 'Rates pending management approval' })),
  ...X.tplRateInterstate.rows.map((r, i) => stamp({ id: `TPLL-${String(i + 1).padStart(3, '0')}`, kind: 'interstate', state: r['Loading State'], loadingPoint: r['Loading Point'], destination: r.Destination, destState: r['Destination State'], region: r.Region, kmOneWay: num(r['Outbound KM']), kmReturn: num(r['Return KM']), roundTripKm: num(r['Round Trip KM']), rates: rateCols(r), status: 'Rates pending management approval' }))];
report.counts.tplrates = { lanes: tplrates.length, withRates: tplrates.filter((l) => Object.values(l.rates).some((v) => v !== null)).length };
report.missing.push('3PL rate cards (internal zones and interstate lanes) are imported with every rate blank, as instructed; Station Supervisors enter contractor rates per request until management finalises the card.');
write('tplrates.json', tplrates);

// ------------------------------------------------------------------ route zones (internal deliveries)
const routezones = { id: 'routezones', zones: X.internalZones.rows.map((r) => ({ state: r.State, depot: r.Depot, zone: r['Zone (Route)'], description: r['Route Description'], areas: num(r['No. of Areas']), centre: r['Zone Centre'], centreKmOut: num(r['Centre - Outbound KM']), centreKmReturn: num(r['Centre - Return KM']), centreKmRound: num(r['Centre - Round Trip KM']), farEnd: r['Far End of Zone'], farKmOut: num(r['Far End - Outbound KM']), farKmReturn: num(r['Far End - Return KM']), farKmRound: num(r['Far End - Round Trip KM']), kmSource: r['KM Source'] })), areas: X.zoneAreas.rows.map((r) => ({ state: r.State, zone: r['Zone (Route)'], area: r.Area, description: r['Route Description'] })), spelling: Object.fromEntries(X.spelling.rows.map((r) => [r['As written in your list'], r['Corrected to']])), method: X.method, version: 1 };
write('routezones.json', routezones);

// ------------------------------------------------------------------ Route Master merge
const spelling = new Map(X.spelling.rows.map((r) => [key(r['As written in your list']), r['Corrected to']]));
const fixName = (s) => { const c = spelling.get(key(s)); return c || String(s || '').trim(); };
const LOADING_ALIASES = { lagos: 'jmggbagada', gbagada: 'jmggbagada', jmggbagadalagos: 'jmggbagada', ibadanoyo: 'ibadan', portharcourt: 'portharcourt', ph: 'portharcourt', abujafct: 'abuja' };
const lp = (s) => { const k = key(fixName(s)); return LOADING_ALIASES[k] || k; };
const dest = (s) => key(fixName(s)).replace(/(city|town)$/, '');
const routes = exists('routes.json') ? read('routes.json') : [];
const clientName = new Map(); for (const r of routes) if (r.clientRaw && r.client) clientName.set(key(r.clientRaw), r.client);
clientName.set(key('JMG'), 'JMG'); clientName.set(key('Jamara'), 'Jamara'); clientName.set(key('Orca'), 'ORCA DECO LIMITED');
const laneKey = (contract, from, to) => `${key(contract)}|${lp(from)}|${dest(to)}`;
const byLane = new Map(); for (const r of routes) { const k = laneKey(r.contractName, r.loadingPoint, r.destination); if (!byLane.has(k)) byLane.set(k, r); }
const byContractDest = new Map(); for (const r of routes) { const k = `${key(r.contractName)}|${dest(r.destination)}`; if (!byContractDest.has(k)) byContractDest.set(k, []); byContractDest.get(k).push(r); }
let matched = 0, newLanes = 0, pendingLanes = 0, kmChanged = 0; const usedOld = new Set(); let seq = 0; const seenLanes = new Map(); let dupLanes = 0;
for (const r of X.allRoutes.rows) {
  const from = r['Loading Point'], to = r['Destination (corrected)']; const one = num(r['Leg 1 - Outbound KM']), ret = num(r['Leg 2 - Return KM']);
  const notFound = /not recognised|could not be located/i.test(r.Notes || '') || one === null;
  let cur = byLane.get(laneKey(r['Contract Name'], from, to)); if (cur && usedOld.has(cur.id)) cur = null; if (!cur) { const list = byContractDest.get(`${key(r['Contract Name'])}|${dest(to)}`) || []; cur = list.find((c) => !usedOld.has(c.id)) || null; }
  const lk = laneKey(r['Contract Name'], from, to); const dupOf = seenLanes.get(lk); if (dupOf) dupLanes++; else seenLanes.set(lk, r['Contract Name'] + ' ' + from + ' > ' + to);
  const master = { duplicateLane: !!dupOf, contractName: r['Contract Name'], size: r['Truck Size'], division: r.Division, tonnage: r['Truck Tonnage'], clientRaw: r.Client, clientMainLocation: r['Client Main Location'] || '', loadingPoint: from, originState: r['Loading State'], destination: to, destState: r['Destination State'], state: r['Destination State'], region: r['Region (geopolitical zone)'] || '', deliveryType: r['Delivery Type'] || '', internalZone: r['Internal Zone'] || '', stops: r['Stops (in drive order)'] || '', legBreakdown: r['Leg Breakdown (km)'] || '', kmOneWay: one, kmReturn: ret === null ? one : ret, totalKm: one === null ? null : (num(r['Total Round Trip KM']) !== null ? num(r['Total Round Trip KM']) : one + (ret === null ? one : ret)), kmSource: r['KM Source'] || '', routeMasterNotes: r.Notes || '', loadingAllowanceDays: 1, offloadingAllowanceDays: 1, effectiveDate: IMPORT_DATE, routeMasterSource: X.source };
  if (cur) {
    usedOld.add(cur.id); matched++;
    const before = { kmOneWay: cur.kmOneWay, kmReturn: cur.kmReturn, totalKm: cur.totalKm, loadingPoint: cur.loadingPoint, destination: cur.destination, originState: cur.originState, destState: cur.destState };
    if (before.kmOneWay !== master.kmOneWay || before.kmReturn !== master.kmReturn) kmChanged++;
    Object.assign(cur, master, { client: cur.client || clientName.get(key(r.Client)) || r.Client, status: notFound ? 'Pending Approval' : 'Approved', approvedAt: notFound ? '' : AT, approvedBy: notFound ? '' : 'admin (Setup_Haulage Route Master import)', kmHistory: [...(cur.kmHistory || []), { at: AT, source: X.source, before, after: { kmOneWay: master.kmOneWay, kmReturn: master.kmReturn, totalKm: master.totalKm, loadingPoint: master.loadingPoint, destination: master.destination, originState: master.originState, destState: master.destState } }], mappingNote: `Mapped to the Setup_Haulage Route Master on ${IMPORT_DATE}${before.destination !== master.destination ? ` (destination "${before.destination}" standardised to "${master.destination}")` : ''}`, updatedAt: AT, updatedBy: BY, version: Number(cur.version || 1) + 1 });
    if (notFound) pendingLanes++;
  } else {
    seq++; const id = `RM-${String(seq).padStart(4, '0')}`;
    routes.push(stamp(Object.assign({ id, client: clientName.get(key(r.Client)) || r.Client, days: null, offloading: 1, totalDays: null, tatDays: null, diesel: null, roadExpenses: null, contingency: 0, additional: 0, price: null, priceSupplied: false, status: notFound ? 'Pending Approval' : 'Approved', approvedAt: notFound ? '' : AT, approvedBy: notFound ? '' : 'admin (Setup_Haulage Route Master import)', mappingNote: notFound ? 'Place not recognised in the Route Master workbook; distance to be confirmed' : 'Imported from the Setup_Haulage Route Master (no client price in the workbook)' }, master)));
    newLanes++; if (notFound) pendingLanes++;
  }
}
const legacy = routes.filter((r) => !usedOld.has(r.id) && !/^RM-/.test(r.id)); for (const r of legacy) { r.legacy = true; r.mappingNote = (r.mappingNote ? r.mappingNote + '; ' : '') + 'not in the Setup_Haulage Route Master — register distance retained, review recommended'; }
report.counts.routes = { setupLanes: X.allRoutes.rows.length, matchedExisting: matched, kmChanged, newLanes, pendingApproval: pendingLanes, legacyUnmatched: legacy.length, duplicateLanesInMaster: dupLanes, total: routes.length };
if (dupLanes) report.conflicts.push(`${dupLanes} Route Master rows repeat a contract + loading point + destination already listed (different stop sequences or duplicated entries); both are kept and flagged duplicateLane for the administrator to retire one.`);
const legacyContracts = {}; for (const r of legacy) legacyContracts[r.contractName] = (legacyContracts[r.contractName] || 0) + 1; report.conflicts.push('Contracts in the Truck Planning route register that the Setup_Haulage Route Master does not list (kept as legacy routes): ' + Object.entries(legacyContracts).map(([k, v]) => `${k} (${v})`).join(', ') + '.');
report.conflicts.push(`${kmChanged} existing routes had different kilometres in the Truck Planning register than in the Route Master; the Route Master values are now operational and the previous values are kept in each route's kmHistory.`);
report.missing.push(`${newLanes} Route Master lanes have no approved client price in any workbook (price null); the price list and request pricing fall back to the client price list.`);
write('routes.json', routes);

// ------------------------------------------------------------------ planning KPIs (diesel matrix, journey planning, OTD, port expenses)
const planning = read('planning.json'); planning.dispatch = planning.dispatch || {};
const kpi = {}; for (const row of X.kpi) if (row[0] && row[1] !== null && row[1] !== undefined && !/^(KPI|Logistics Port)/i.test(String(row[0]))) kpi[String(row[0]).trim()] = row[1];
const rate = (label) => { const k = Object.keys(kpi).find((x) => new RegExp(label, 'i').test(x)); return k ? num(kpi[k]) : null; };
const dieselRates = { 'Haulage 45T / 102 CBM': rate('45T'), 'Haulage 30T / 102 CBM': rate('30T'), 'Flatbed': rate('Flat'), 'Hiab': rate('Hiab'), 'CNG Truck': rate('CNG'), '16 CBM Truck': rate('16CBM'), '30 CBM Truck': rate('30CBM') };
// legacy category names keep working
dieselRates['Haulage 45T'] = dieselRates['Haulage 45T / 102 CBM']; dieselRates['Jumbo 30T / 102 CBM'] = dieselRates['Haulage 30T / 102 CBM']; dieselRates.Other = dieselRates['Haulage 30T / 102 CBM'];
planning.dispatch.dieselRates = dieselRates; planning.dispatch.dieselRatesSource = `${X.source} KPI sheet (approved KPI master overrides the initial assumptions)`;
report.conflicts.push(`Diesel KPI: the brief's initial assumption for Jumbo 30T / 102 CBM is 0.45 L/km but the supplied KPI master says ${dieselRates['Haulage 30T / 102 CBM']} L/km; the KPI master overrides, as instructed (the matrix stays editable in Settings).`);
planning.kpi = { drivingKmPerDay: 300, loadingDays: 1, offloadingDays: 1, otdBands: [{ maxKm: 100, hours: 24 }, { maxKm: 250, hours: 36 }, { maxKm: 500, hours: 48 }, { maxKm: 1000, hours: 72 }, { maxKm: 1500, hours: 96 }], localIncludesHandlingKm: 100, source: `${X.source} KPI sheet + brief delivery-time bands` };
const portIdx = X.kpi.findIndex((r) => /Logistics Port Expenses/i.test(String(r[0] || ''))); const portHeader = portIdx >= 0 ? X.kpi[portIdx] : null;
planning.portExpenses = portHeader ? X.kpi.slice(portIdx + 1).filter((r) => r[0]).map((r) => ({ lane: String(r[0]).trim(), portExpenses: num(r[0] && r[1]), driverRoadExpenses: num(r[2]), additionalDiesel: num(r[3]), passingTruckExpress: num(r[3]) === null ? null : num(r[3]), droppingEmpty: num(r[4]) })) : [];
if (portHeader) { planning.portExpenses = X.kpi.slice(portIdx + 1).filter((r) => r[0]).map((r) => ({ lane: String(r[0]).trim(), portExpenses: num(r[1]), driverRoadExpenses: num(r[2]), additionalDiesel: num(r[3]), droppingEmpty: num(r[4]) })); report.assumptions.push('Port operations KPI table (APMT / ESS-Libra / Ikorodu lanes): the sheet header lists five columns for four value columns ("Additional Diesel" and "Passing Truck Express" share one column); values are kept as Port expenses, Driver road expenses, Additional diesel / passing truck, Dropping empty, pending confirmation.'); }
planning.updatedAt = AT; planning.updatedBy = BY; planning.version = Number(planning.version || 1) + 1;
write('planning.json', planning);

fs.writeFileSync(path.join(W, 'setup_report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.counts, null, 1)); console.log('missing', report.missing.length, 'conflicts', report.conflicts.length, 'assumptions', report.assumptions.length);
