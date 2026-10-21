#!/usr/bin/env node
/* Audit & Control brief: builds the commercial reference data from the two supplied workbooks.
 *   node tools/build_audit_data.js <ratecomparison_extract.json> <triplog_rows.json>
 * Writes to data/workbook/:
 *   ratecomparison.json          the Client Rate Comparison 2026 results as a frozen reference baseline (values as cached in the workbook)
 *   turnaround.json              the Turnaround Table (one-leg days per drop point → loading bay) and the planner parameters
 *   auditpolicy.json             default commercial-control policy (thresholds, approval matrix) — editable in the app
 *   triplog_reconciliation.json  how the Setup_Haulage TripLog sheet reconciles to the trips already in the application
 *   triplog_new_trips.json       the TripLog rows that are not in the application yet (appended to trips.json as history)
 * Nothing is invented: every value comes from a workbook cell; differences are listed, not resolved. */
const fs = require('fs');
const path = require('path');
const E = require('../js/core/engine.js');
const ROOT = path.join(__dirname, '..'); const W = path.join(ROOT, 'data', 'workbook');
const read = (n) => JSON.parse(fs.readFileSync(path.join(W, n), 'utf8'));
const write = (n, d) => fs.writeFileSync(path.join(W, n), JSON.stringify(d, null, 0));
const extract = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const triplog = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const v = (x) => (x && typeof x === 'object' && 'v' in x ? x.v : x);
const rows = (sheet) => extract[sheet].map((r) => r.map(v));
const num = (x) => { if (x === null || x === undefined || x === '') return null; if (typeof x === 'number') return x; const n = Number(String(x).replace(/[₦,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);

// ------------------------------------------------------------------ 1. reference baseline
const avb = rows('Achieved vs Best Rate');
const byClient = []; let i = 11; while (avb[i] && avb[i][0] && avb[i][0] !== 'Total') { const r = avb[i]; byClient.push({ client: r[0], trips: r[1], revenue: r2(r[2]), diffAtHighest: r2(r[4]), diffAtBestClientAvg: r2(r[7]) }); i++; }
const byMonth = []; i = 44; while (avb[i] && avb[i][0] && avb[i][0] !== 'Total') { const r = avb[i]; byMonth.push({ month: r[0], trips: r[1], revenue: r2(r[2]), diffAtHighest: r2(r[4]), diffAtBestClientAvg: r2(r[7]) }); i++; }
const achieved = r2(byClient.reduce((s, c) => s + c.revenue, 0)); const atHighest = r2(byClient.reduce((s, c) => s + c.diffAtHighest, 0)); const atBestAvg = r2(byClient.reduce((s, c) => s + c.diffAtBestClientAvg, 0));
const rk = rows('Client Rate Ranking'); const ranking = [];
for (let j = 4; j < rk.length; j++) { const r = rk[j]; if (!r[1] || r[1] === 'Total') continue; ranking.push({ rank: r[0], client: r[1], rateLevel: r2(r[2] * 100), verdict: r[3], revenueLost: r2(r[4]), lostAtHighest: r2(r[6]), tripsCompared: r[7], revenueCompared: r2(r[8]), revenue2026: r2(r[9]), routesWithGaps: r[10] || '' }); }
const rg = rows('Rate Gaps by Route'); const routeGaps = [];
for (let j = 3; j < rg.length; j++) { const r = rg[j]; if (!r[0] || r[3] === 'Total') continue; routeGaps.push({ quarter: r[0], route: r[1], vehicle: r[2], client: r[3], trips: r[4], avgRate: r2(r[5]), bestClient: r[6], bestClientTrips: r[7], bestAvgRate: r2(r[8]), rateLevel: r2((r[5] / r[8]) * 100), revenueLost: r2(Math.max(0, r[8] - r[5]) * r[4]), highestRate: r2(r[11]), lostAtHighest: r2(r[12]) }); }
const rp = rows('Route Prices'); const routePrices = [];
for (let j = 4; j < rp.length; j++) { const r = rp[j]; if (!r[0]) continue; routePrices.push({ key: r[0], route: r[1], trips2026: r[2], avgPrice2026: r2(r[3]), tripsJulSep: r[4], avgPriceJulSep: r2(r[5]), highestJulSep: r2(r[6]) }); }
const tr = rows('Truck Requirement'); const ownTrucksUsed = tr.find((r) => String(r[0] || '').startsWith('Own haulage/flat trucks actually used'));
const trq = rows('Truck Req by Route'); const truckReqByRoute = [];
for (let j = 4; j < trq.length; j++) { const r = trq[j]; if (!r[0]) continue; truckReqByRoute.push({ client: r[0], vehicle: r[1], area: r[2], destination: r[3], key: r[4], how: r[5], overrideDays: r[7], trips: [12, 13, 14, 15, 16, 17, 18, 19, 20].map((k) => r[k] || 0) }); }
const summary = rows('Summary').map((r) => r[0]).filter(Boolean);
write('ratecomparison.json', {
  source: 'Client_Rate_Comparison_2026 (9).xlsx', importedAt: '2026-10-20', scope: { from: '2026-01-02', to: '2026-09-30', basis: 'selling price excl. VAT', vehicles: 'haulage and flat trucks treated as one; closed-body / canter and Hiab excluded; 3rd-party trucks included', period: 'quarter', rule: 'only routes where 2+ clients ran trips in the same quarter are compared' },
  methodology: ['Best rate = the highest rate any client paid on the same route and quarter', 'Best client average = the average rate of the best-paying client (by average) on that route and quarter', 'Rate level = client average ÷ best client average', 'Revenue lost = MAX(0, best client average − client average) × client trips (the "estimated rate opportunity" of the brief)', 'Lost if at highest = (highest rate on route − client average) × trips (the aggressive benchmark)', 'Turnaround: trips one truck can do per month = MAX(1, INT(operating days ÷ round-trip days)); round trip = 2 × one-leg days; trucks needed = trips ÷ trips per truck, rounded up per client'],
  headline: { achieved, atHighest: r2(achieved + atHighest), diffAtHighest: atHighest, atBestClientAvg: r2(achieved + atBestAvg), diffAtBestClientAvg: atBestAvg, trips: byClient.reduce((s, c) => s + c.trips, 0) },
  summaryText: summary, byClient, byMonth, ranking, routeGaps, routePrices, truckReqByRoute, ownTrucksUsedByMonth: ownTrucksUsed ? ownTrucksUsed.slice(1, 10) : [],
});

// ------------------------------------------------------------------ 2. turnaround table
const tt = rows('Turnaround Table'); const turn = [];
for (let j = 4; j < tt.length; j++) { const r = tt[j]; if (!r[0] || !r[1]) continue; const days = num(r[2]); if (days === null) continue; turn.push({ from: String(r[0]).trim(), to: String(r[1]).trim(), days, key: `${String(r[0]).trim().toUpperCase()}>${String(r[1]).trim().toUpperCase()}` }); }
write('turnaround.json', { id: 'turnaround', source: 'Client_Rate_Comparison_2026 (9).xlsx · Turnaround Table', operatingDaysPerMonth: 26, defaultOneLegDays: 2, bays: ['Lagos', 'Ibadan', 'Apapa', 'Abuja', 'Keffi', 'Ogere', 'Benin'], rows: turn });

// ------------------------------------------------------------------ 3. default policy
write('auditpolicy.json', {
  id: 'auditpolicy', version: 1,
  comparison: { period: 'quarter', vehicleGrouping: 'workbook', minTripsForBenchmark: 3, minClientsPerGroup: 2, excludeExceptional: true, scopeFrom: '2026-01-02', scopeTo: '' },
  thresholds: { belowApprovedTolerancePct: 0.5, materialBelowBenchmarkPct: 10, thinBenchmarkTrips: 3, lowMarginPct: 5 },
  blocking: { invoice: { belowApproved: true, belowCost: true, missingRate: false, override: true }, allocation: { belowCost: true, missingRate: false, belowBenchmark: false } },
  approvalMatrix: { belowApproved: { review: ['operations'], approve: ['management', 'finance'] }, belowCost: { review: ['operations'], approve: ['management'] }, missingRate: { review: ['operations'], approve: ['management', 'finance'] }, override: { review: ['operations'], approve: ['management', 'finance'] }, exceptional: { review: ['operations'], approve: ['management'] } },
  truckDays: { operatingDaysPerMonth: 26, defaultOneLegDays: 2, basis: 'planned' },
  notes: ['Missing-rate blocking is off by default: 93% of the historical Trip Log has no Client Rate Card entry, so blocking would stop billing; those trips are flagged "Approved Rate Missing" for commercial review instead.', 'A below-benchmark warning never rejects a job; the Operations Manager confirms the review before approving the plan.'],
});

// ------------------------------------------------------------------ 4. TripLog reconciliation
const trips = read('trips.json'); const assets = read('assets.json');
const d = (x) => String(x || '').slice(0, 10); const n = (x) => String(x || '').trim().toUpperCase();
const key = (t) => [d(t.dateDispatched), n(t.plate), n(t.client), n(t.loadingFrom), n(t.loadingTo), Math.round(num(t.sellingPrice) || 0)].join('|');
const key2 = (t) => [d(t.dateDispatched), n(t.plate), n(t.client)].join('|');
const idx = new Map(), idx2 = new Map(); for (const t of trips) { idx.set(key(t), (idx.get(key(t)) || []).concat(t)); idx2.set(key2(t), (idx2.get(key2(t)) || []).concat(t)); }
const used = new Set(); const rec = { source: 'Setup_Haulage (1).xlsx · TripLog sheet (1,788 rows, 2 Jan – 20 Oct 2026)', rows: triplog.length, matchedExact: 0, matchedByDatePlateClient: 0, newTrips: 0, differences: { loadingFromFlattened: 0, loadingTo: [], sellingPrice: [], waybill: 0 }, appTripsAbsentFromTripLog: 0, note: 'Historical records are matched to the trips already in the application; nothing is duplicated. Selling prices are never changed by the import (differences are listed for management review). The TripLog flattens NBL depot loading points (Ama, Kudenda, Ota, Ijebu Ode, Aba …) to "IBADAN"; the application keeps the original depot so route comparisons stay precise.' };
const fresh = [];
const asTrip = (r) => ({ dateDispatched: d(r['Date Dispatched']), dateDelivered: d(r['Date Delivered']), plate: E.clean(r['Plate Number']), client: E.clean(r['CLIENT NAME']), loadingFrom: E.clean(r['Loading From']), loadingTo: E.clean(r['Loading To']), sellingPrice: num(r['Selling Price (₦)']), waybill: r['Client Waybill Number'] == null ? '' : E.clean(r['Client Waybill Number']), journeyPlanId: r['Journey Plan ID'] == null ? '' : E.clean(r['Journey Plan ID']), quoteNo: r['Quote Number'] == null ? '' : E.clean(r['Quote Number']), soNo: r['SO Number'] == null ? '' : E.clean(r['SO Number']), manualInvoiceNo: r['Manual Invoice Number'] == null ? '' : E.clean(r['Manual Invoice Number']), invoiceStatusRaw: E.clean(r['Invoice Status ']), paymentStatus: E.normalizePaymentStatus(r['Payment Status']), advance: num(r['Advance (₦)']), returnWaybill: E.normalizeReturnWaybill(r['Return Waybill Received?']) });
triplog.forEach((r, i) => {
  const t = asTrip(r); const k = key(t); const c = (idx.get(k) || []).find((x) => !used.has(x.id));
  if (c) { used.add(c.id); rec.matchedExact++; return; }
  const c2 = (idx2.get(key2(t)) || []).find((x) => !used.has(x.id));
  if (c2) {
    used.add(c2.id); rec.matchedByDatePlateClient++;
    if (n(c2.loadingFrom) !== n(t.loadingFrom)) rec.differences.loadingFromFlattened++;
    if (n(c2.loadingTo) !== n(t.loadingTo)) rec.differences.loadingTo.push({ tripLogId: c2.id, date: t.dateDispatched, plate: t.plate, client: t.client, application: c2.loadingTo, tripLogSheet: t.loadingTo });
    if (Math.round(num(c2.sellingPrice) || 0) !== Math.round(t.sellingPrice || 0)) rec.differences.sellingPrice.push({ tripLogId: c2.id, date: t.dateDispatched, plate: t.plate, client: t.client, application: num(c2.sellingPrice), tripLogSheet: t.sellingPrice });
    if (n(c2.waybill) !== n(t.waybill)) rec.differences.waybill++;
    return;
  }
  rec.newTrips++;
  const a = E.assetFor(t.plate, assets);
  fresh.push(Object.assign({ id: 'tl-' + String(i + 2).padStart(4, '0') }, t, { contractType: '', invoiceStatus: E.normalizeInvoiceStatus(r['Invoice Status '], t.paymentStatus), invoiceNo: '', invoiceId: '', note: '', source: 'setup-triplog', xlRow: i + 2, version: 1, createdAt: '2026-10-20T00:00:00Z', createdBy: 'triplog-import', updatedAt: '2026-10-20T00:00:00Z', updatedBy: 'triplog-import', assetCode: a ? a.assetCode : E.clean(r['Asset Code']), vehicleType: a ? a.vehicleType : E.clean(r['Type of Vehicle']), vehicleCategory: a ? a.vehicleCategory : E.clean(r['Type']), costCenter: a ? a.costCenter : E.clean(r['Cost Center']) }));
});
rec.appTripsAbsentFromTripLog = trips.filter((t) => d(t.dateDispatched) >= '2026-01-01' && !used.has(t.id)).length;
rec.newTripsRange = fresh.length ? [fresh.map((t) => t.dateDispatched).sort()[0], fresh.map((t) => t.dateDispatched).sort().slice(-1)[0]] : [];
rec.newTripsByVehicleType = fresh.reduce((m, t) => { m[t.vehicleType || '?'] = (m[t.vehicleType || '?'] || 0) + 1; return m; }, {});
write('triplog_reconciliation.json', rec); write('triplog_new_trips.json', fresh);
const existingIds = new Set(trips.map((t) => t.id)); const add = fresh.filter((t) => !existingIds.has(t.id));
if (add.length) { write('trips.json', trips.concat(add)); }
console.log(JSON.stringify({ baseline: { clients: byClient.length, months: byMonth.length, ranking: ranking.length, routeGaps: routeGaps.length, routePrices: routePrices.length, truckReqRows: truckReqByRoute.length, achieved, atBestAvg }, turnaround: turn.length, reconciliation: Object.assign({}, rec, { differences: { loadingFromFlattened: rec.differences.loadingFromFlattened, loadingTo: rec.differences.loadingTo.length, sellingPrice: rec.differences.sellingPrice.length, waybill: rec.differences.waybill } }), tripsAppended: add.length, tripsTotal: trips.length + add.length }, null, 1));
