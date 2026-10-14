#!/usr/bin/env node
/* Upgrades the workbook seed for the workflow brief (CRM → route validation → operations planning → station allocation →
 * automatic Trip IDs → 3PL): Route Master fields and approval on the register routes, service type / stage fields on
 * requests, a contractor register with quotations and one third-party request. Idempotent: re-running keeps the values. */
const fs = require('fs'); const path = require('path');
const E = require('../js/core/engine.js'); const P = require('../js/core/planning.js'); const G = require('../js/core/geo.js');
const W = path.join(__dirname, '..', 'data', 'workbook');
const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8'));
const write = (n, v, pretty) => fs.writeFileSync(path.join(W, n), pretty ? JSON.stringify(v, null, 1) : JSON.stringify(v));
const IMPORT_DATE = process.env.IMPORT_DATE || (read('planning.json').importDate) || new Date().toISOString().slice(0, 10);
const master = fs.existsSync(path.join(W, 'locationmaster.json')) ? read('locationmaster.json') : {};
const stateOf = (n) => G.standardize(n, master).state || '';

// Route Master: the company's own route register is approved on import (administrator), with standardised states and return km.
const routes = read('routes.json').map((r) => Object.assign({}, r, {
  originState: r.originState || stateOf(r.loadingPoint) || 'Lagos', destState: r.destState || stateOf(r.destination) || stateOf(r.state) || '',
  kmReturn: r.kmReturn === undefined || r.kmReturn === null ? r.kmOneWay : r.kmReturn, totalKm: r.kmOneWay === null || r.kmOneWay === undefined ? null : E.round2(Number(r.kmOneWay) + Number(r.kmReturn === undefined || r.kmReturn === null ? r.kmOneWay : r.kmReturn)),
  tatDays: r.tatDays || P.routeTiming(r, null).tat, status: r.status || 'Approved', approvedAt: r.approvedAt || IMPORT_DATE + 'T00:00:00Z', approvedBy: r.approvedBy || 'admin', mappingNote: r.mappingNote || 'Approved from the Truck Planning workbook route register',
}));
write('routes.json', routes);

// Requests: service type, stage fields; requests that already have allocations get an approved plan (Operations Manager).
const allocations = read('allocations.json');
const requests = read('requests.json').map((r) => {
  const o = Object.assign({ serviceType: 'Internal Fleet', submittedAt: r.requestedAt, submittedBy: r.requestedBy || 'crm', requestedBy: r.requestedBy || 'crm', routeMasterId: r.routeId || '' }, r);
  if (o.status === 'New Request' || o.status === 'Under Planning') o.status = 'Awaiting Planning';
  const mine = allocations.filter((a) => a.requestId === r.id && a.status !== 'Cancelled');
  if ((mine.length || o.status === 'Completed') && !o.plan) o.plan = { approvedQty: Math.max(o.trucks || 1, mine.length), vehicleType: o.vehicleType, tonnage: o.tonnage, station: 'Lagos', notes: 'Plan approved on import (workbook committed trips)', preparedBy: 'planner', preparedAt: o.requestedAt, approvedBy: 'ops', approvedAt: o.requestedAt };
  return o;
});
// one third-party request for the 3PL demo
if (!requests.some((r) => P.isTpl(r))) {
  requests.push({ id: 'ORC-3PL-001', requestedAt: IMPORT_DATE + 'T10:00:00Z', requestedBy: 'crm', submittedAt: IMPORT_DATE + 'T10:05:00Z', submittedBy: 'crm', client: 'ORCA DECO LIMITED', reference: 'PO-77812', serviceType: '3rd Party Contractor', routeId: '', routeMasterId: 'R3PL-001', loadingFrom: 'Apapa', destination: 'Abuja', vehicleType: 'Lowbed', tonnage: '', trucks: 1, loadingDate: P.addDays(IMPORT_DATE, 4), deliveryDate: P.addDays(IMPORT_DATE, 7), priority: 'Normal', contact: 'Site engineer', instructions: 'Crane required on site for offloading', remarks: '', status: 'Awaiting Planning',
    tpl: { equipmentType: 'Lowbed', jobDescription: 'Move a 60-tonne transformer from Apapa port to the Abuja site', cargoDescription: 'Power transformer, crated', cargoWeight: '60 t', cargoDimensions: '7.2 m × 2.8 m × 3.4 m', specialHandling: 'Police escort, route survey for bridges', sellingPrice: 9500000, contractorId: '', contractorName: '', contractorQuote: null, approvedCost: null, assignmentStatus: 'Quotation Requested', quotesRequestedAt: IMPORT_DATE + 'T11:00:00Z' } });
}
write('requests.json', requests, true);
// Route Master entry for the 3PL lane (approved so the request can proceed)
if (!routes.some((r) => r.id === 'R3PL-001')) { routes.push({ id: 'R3PL-001', contractName: 'ORCA-3PL-LOWBED', size: 'Lowbed', division: '3PL', tonnage: '', client: 'ORCA DECO LIMITED', loadingPoint: 'Apapa', destination: 'Abuja', state: 'FCT', region: 'North', originState: 'Lagos', destState: 'FCT', kmOneWay: 760, kmReturn: 760, totalKm: 1520, days: 5, offloading: 1, totalDays: 6, tatDays: 6, diesel: null, roadExpenses: null, contingency: 0, additional: 0, price: 9500000, status: 'Approved', approvedAt: IMPORT_DATE + 'T00:00:00Z', approvedBy: 'admin', mappingNote: 'Third-party lane mapped for the ORCA transformer job', version: 1, createdAt: IMPORT_DATE + 'T00:00:00Z', createdBy: 'ops', updatedAt: IMPORT_DATE + 'T00:00:00Z', updatedBy: 'ops' }); write('routes.json', routes); }

// Contractor register and quotations
const stamp = { version: 1, createdAt: IMPORT_DATE + 'T00:00:00Z', createdBy: 'crm', updatedAt: IMPORT_DATE + 'T00:00:00Z', updatedBy: 'crm' };
const contractors = fs.existsSync(path.join(W, 'contractors.json')) ? read('contractors.json') : [
  Object.assign({ id: 'ctr-heavylift', name: 'HeavyLift Logistics Ltd', contact: 'Emeka Udo', phone: '0803 000 1101', email: 'ops@heavylift.example', equipment: ['Lowbed', 'Crane-100T', 'Crane-150T'], rating: 4, active: true, notes: 'Lowbed and crane specialist, Lagos / Abuja' }, stamp),
  Object.assign({ id: 'ctr-northstar', name: 'Northstar Haulage', contact: 'Bala Musa', phone: '0805 000 2202', email: 'dispatch@northstar.example', equipment: ['Flatbed', '40FT', '20FT', '25FT'], rating: 3, active: true, notes: 'Container and flatbed trucks, Kano based' }, stamp),
  Object.assign({ id: 'ctr-hiabworks', name: 'Hiab Works Nigeria', contact: 'Grace Peters', phone: '0807 000 3303', email: 'hello@hiabworks.example', equipment: ['Hiab', 'Crane-80T', 'Flatbed'], rating: 4, active: true, notes: 'Self-loading trucks for site deliveries' }, stamp),
];
write('contractors.json', contractors, true);
const quotes = fs.existsSync(path.join(W, 'quotes.json')) ? read('quotes.json') : [
  Object.assign({ id: 'q-orc-001-heavylift', requestId: 'ORC-3PL-001', contractorId: 'ctr-heavylift', contractorName: 'HeavyLift Logistics Ltd', equipmentType: 'Lowbed', quantity: 1, price: 7200000, availability: 'Available from ' + P.addDays(IMPORT_DATE, 3), validUntil: P.addDays(IMPORT_DATE, 10), status: 'Quoted', quotedAt: IMPORT_DATE + 'T14:00:00Z', notes: 'Includes escort and permits' }, stamp),
  Object.assign({ id: 'q-orc-001-hiab', requestId: 'ORC-3PL-001', contractorId: 'ctr-hiabworks', contractorName: 'Hiab Works Nigeria', equipmentType: 'Lowbed', quantity: 1, price: 7950000, availability: 'Subcontracted lowbed, ' + P.addDays(IMPORT_DATE, 5), validUntil: P.addDays(IMPORT_DATE, 10), status: 'Quoted', quotedAt: IMPORT_DATE + 'T15:30:00Z', notes: '' }, stamp),
];
write('quotes.json', quotes, true);
console.log(`routes ${routes.length} (approved ${routes.filter((r) => r.status === 'Approved').length}), requests ${requests.length} (3PL ${requests.filter((r) => P.isTpl(r)).length}, planned ${requests.filter((r) => r.plan).length}), contractors ${contractors.length}, quotes ${quotes.length}`);
