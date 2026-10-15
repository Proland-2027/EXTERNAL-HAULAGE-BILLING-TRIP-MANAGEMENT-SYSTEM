#!/usr/bin/env node
/* Sample transactions for the Setup brief demo: LOB on every open allocation (default from the truck's cost center),
 * three workshop job cards at different stages, stock receipts for the parts they need and the parts issued to the
 * released job. Masters are never invented here; only demo transactions are added. */
const fs = require('fs'); const path = require('path');
const E = require('../js/core/engine.js'); const WS = require('../js/core/workshop.js');
const W = path.join(__dirname, '..', 'data', 'workbook'); const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8')); const write = (n, v) => fs.writeFileSync(path.join(W, n), JSON.stringify(v));
const DAY = process.env.IMPORT_DATE || '2026-10-15'; const T = (d, h) => `${d}T${String(h).padStart(2, '0')}:00:00Z`; const stamp = (o, by) => Object.assign({ version: 1, createdAt: T(DAY, 8), createdBy: by || 'seed', updatedAt: T(DAY, 8), updatedBy: by || 'seed' }, o);
const assets = read('assets.json'), costcenters = read('costcenters.json'), items = read('items.json'), fleet = read('fleet.json');
// 1. LOB on allocations
const allocations = read('allocations.json'); let lobSet = 0;
for (const a of allocations) { if (!a.lob) { const asset = E.assetFor(a.plate, assets); a.lob = E.lobFor({}, asset, costcenters) || 'Haulage'; a.costCenter = a.costCenter || (asset && asset.costCenter) || ''; lobSet++; } }
write('allocations.json', allocations);
// 2. workshop sample: pick trucks in the FMR with a workshop status, else any
const pick = (pred) => fleet.find(pred) || fleet[0];
const inWs = fleet.filter((t) => /workshop|breakdown/i.test(t.status || ''));
const t1 = inWs[0] || pick((t) => t.status === 'Available'), t2 = inWs[1] || pick((t) => t.status === 'Available' && t.plate !== t1.plate), t3 = pick((t) => t.status === 'Available' && ![t1.plate, t2.plate].includes(t.plate));
const asset = (t) => E.assetFor(t.plate, assets) || {};
const byCat = (re) => items.find((i) => re.test(i.description) && i.unitCost > 0) || items.find((i) => i.unitCost > 0);
const pad = byCat(/brake pad|brake lining|brake shoe/i), filter = byCat(/oil filter|fuel filter/i), tyre = items.find((i) => /tyre/i.test(i.itemClass) && i.unitCost > 0) || byCat(/tyre/i), comp = byCat(/air compressor/i);
const d1 = '2026-10-08', d2 = '2026-10-13', d3 = DAY;
const jobcards = [
  stamp({ id: 'jc-seed-1', number: `JC-${d1.slice(2).replace(/-/g, '')}-01`, plate: t1.plate, assetCode: asset(t1).assetCode || t1.assetCode || '', costCenter: asset(t1).costCenter || '', lob: '', defect: 'Brakes pulling to the left; grinding noise on the front axle', breakdownCategory: 'Brakes / Air Brake System', maintenanceType: 'Breakdown repair', technician: 'ADAH Joseph', enteredAt: T(d1, 9), inspection: 'Front brake pads worn to the metal; filters due', requiredParts: [{ itemId: pad.id, description: pad.description, qty: 2 }, { itemId: filter.id, description: filter.description, qty: 1 }], labourCost: 35000, externalRepairCost: 0, estimatedCost: 35000 + 2 * pad.unitCost + filter.unitCost, approvedCost: 35000 + 2 * pad.unitCost + filter.unitCost, approvedAt: T(d1, 12), approvedBy: 'workshop', status: 'Released', qualityCheckedBy: 'workshop', qualityCheckedAt: T('2026-10-10', 15), qualityResult: 'Road test passed', completedAt: T('2026-10-10', 15), releasedAt: T('2026-10-10', 16), releasedBy: 'workshop', reportedBy: 'tracking', history: [{ at: T(d1, 9), by: 'tracking', action: 'Defect reported' }, { at: T(d1, 12), by: 'workshop', action: 'Approved for repair' }, { at: T('2026-10-10', 16), by: 'workshop', action: 'Quality inspection passed; vehicle released' }] }, 'workshop'),
  stamp({ id: 'jc-seed-2', number: `JC-${d2.slice(2).replace(/-/g, '')}-01`, plate: t2.plate, assetCode: asset(t2).assetCode || t2.assetCode || '', costCenter: asset(t2).costCenter || '', lob: '', defect: 'Air compressor not building pressure', breakdownCategory: 'Brakes / Air Brake System', maintenanceType: 'Breakdown repair', technician: 'ADAH Joseph', enteredAt: T(d2, 8), inspection: 'Compressor assembly failed', requiredParts: [{ itemId: comp.id, description: comp.description, qty: 1 }], labourCost: 45000, externalRepairCost: 0, estimatedCost: 45000 + comp.unitCost, approvedCost: 45000 + comp.unitCost, approvedAt: T(d2, 11), approvedBy: 'workshop', status: 'Under Repair', repairStartedAt: T('2026-10-14', 9), reportedBy: 'tracking', history: [{ at: T(d2, 8), by: 'tracking', action: 'Defect reported' }, { at: T(d2, 11), by: 'workshop', action: 'Approved for repair' }, { at: T('2026-10-14', 9), by: 'workshop', action: 'Parts issued; repair started' }] }, 'workshop'),
  stamp({ id: 'jc-seed-3', number: `JC-${d3.slice(2).replace(/-/g, '')}-01`, plate: t3.plate, assetCode: asset(t3).assetCode || t3.assetCode || '', costCenter: asset(t3).costCenter || '', lob: '', defect: 'Two rear tyres below legal tread depth', breakdownCategory: 'Tyres & Wheels', maintenanceType: 'Tyre replacement', technician: 'ADAH Joseph', enteredAt: T(d3, 7), requiredParts: [{ itemId: tyre.id, description: tyre.description, qty: 2 }], labourCost: 8000, externalRepairCost: 0, estimatedCost: 8000 + 2 * tyre.unitCost, status: 'Awaiting Approval', reportedBy: 'tracking', history: [{ at: T(d3, 7), by: 'tracking', action: 'Defect reported' }, { at: T(d3, 8), by: 'workshop', action: 'Parts requirement submitted for approval' }] }, 'workshop'),
];
const mv = (n, o) => stamp(Object.assign({ id: 'mv-seed-' + n, by: 'storekeeper', voidedAt: '' }, o), 'storekeeper');
const stockmoves = [
  mv(1, { number: 'GRN-261007-01', type: 'receipt', itemId: pad.id, qty: 10, unitCost: pad.unitCost, at: T('2026-10-07', 10), requestRef: 'GRN seed', supplierId: '' }),
  mv(2, { number: 'GRN-261007-02', type: 'receipt', itemId: filter.id, qty: 6, unitCost: filter.unitCost, at: T('2026-10-07', 10), requestRef: 'GRN seed' }),
  mv(3, { number: 'GRN-261007-03', type: 'receipt', itemId: comp.id, qty: 2, unitCost: comp.unitCost, at: T('2026-10-07', 10), requestRef: 'GRN seed' }),
  mv(4, { number: 'GRN-261007-04', type: 'receipt', itemId: tyre.id, qty: 8, unitCost: tyre.unitCost, at: T('2026-10-07', 10), requestRef: 'GRN seed' }),
  mv(5, { number: 'PIS-261009-01', type: 'issue', itemId: pad.id, qty: 2, unitCost: pad.unitCost, jobCardId: 'jc-seed-1', jobCardNo: jobcards[0].number, plate: t1.plate, costCenter: jobcards[0].costCenter, at: T('2026-10-09', 9), requestRef: 'REQ-1' }),
  mv(6, { number: 'PIS-261009-02', type: 'issue', itemId: filter.id, qty: 1, unitCost: filter.unitCost, jobCardId: 'jc-seed-1', jobCardNo: jobcards[0].number, plate: t1.plate, costCenter: jobcards[0].costCenter, at: T('2026-10-09', 9), requestRef: 'REQ-1' }),
  mv(7, { number: 'PIS-261014-01', type: 'issue', itemId: comp.id, qty: 1, unitCost: comp.unitCost, jobCardId: 'jc-seed-2', jobCardNo: jobcards[1].number, plate: t2.plate, costCenter: jobcards[1].costCenter, at: T('2026-10-14', 9), requestRef: 'REQ-2' }),
];
write('jobcards.json', jobcards); write('stockmoves.json', stockmoves);
console.log({ allocationsWithLob: lobSet, jobcards: jobcards.map((j) => `${j.number} ${j.plate} ${j.status}`), stockmoves: stockmoves.length, parts: [pad.id, filter.id, comp.id, tyre.id], costs: jobcards.map((j) => WS.jobCosts(j, stockmoves).total) });
