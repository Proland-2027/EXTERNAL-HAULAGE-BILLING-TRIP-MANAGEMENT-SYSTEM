/* Incident & Breakdown Management: incident categories, incident records linked to a Trip ID, the review → workshop →
 * expense → approval → repair → release → closure workflow, FMR breakdown status, incident expenses (through the
 * existing additional-expense approval: planner / station supervisor request, Operations Manager approves, Finance pays),
 * breakdown and repair hours with the TAT / OTD impact, the workshop job-card link, incident cost for the Trip P&L
 * (never double-counted with a job card), the management dashboard and the incident assistant.
 * Shared by the browser, the Node server and the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./planning.js'));
  else { root.HB = root.HB || {}; root.HB.incident = factory(root.HB.engine, root.HB.planning); }
})(typeof self !== 'undefined' ? self : this, function (E, P) {
  'use strict';
  const num = E.num, round2 = E.round2, clean = E.clean, norm = E.norm;
  const DEFAULT_CATEGORIES = ['Breakdown in Transit', 'Engine Failure', 'Gearbox or Transmission Failure', 'Tyre Burst or Tyre Damage', 'Electrical Failure', 'Brake Failure', 'Accident', 'Road Traffic Incident', 'Vehicle Recovery or Towing', 'Cargo Damage', 'Cargo Shortage or Loss', 'Security Incident', 'Road Blockage or Detention', 'Loading Incident', 'Offloading Incident', 'Other Operational Incident'];
  const MECHANICAL = ['Breakdown in Transit', 'Engine Failure', 'Gearbox or Transmission Failure', 'Tyre Burst or Tyre Damage', 'Electrical Failure', 'Brake Failure', 'Accident', 'Vehicle Recovery or Towing'];
  const WORKSHOP_CATEGORY = { 'Engine Failure': 'Engine', 'Gearbox or Transmission Failure': 'Transmission', 'Tyre Burst or Tyre Damage': 'Tyres', 'Electrical Failure': 'Electrical', 'Brake Failure': 'Brakes', Accident: 'Body / accident', 'Breakdown in Transit': 'Engine', 'Vehicle Recovery or Towing': 'Other' };
  const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
  const STATUSES = ['Reported', 'Operations Review', 'Workshop Assessment', 'Expense Requests', 'Awaiting Approval', 'Repair / Recovery', 'Truck Released', 'Closed', 'Cancelled'];
  const ORDER = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
  const EXPENSE_CATEGORIES = ['Towing and Recovery', 'Emergency Repair', 'Spare Parts', 'Tyre Replacement', 'Mechanic Transport', 'Driver Accommodation', 'Driver Feeding', 'Security Expenses', 'Additional Diesel', 'Cargo Recovery', 'Other Incident Expenses'];
  const EXPENSE_ACCOUNT_HINT = { 'Towing and Recovery': '6102010', 'Emergency Repair': '6102010', 'Spare Parts': '6102010', 'Tyre Replacement': '6102028', 'Mechanic Transport': '6101027', 'Driver Accommodation': '6101027', 'Driver Feeding': '6101027', 'Security Expenses': '6105061', 'Additional Diesel': '6103009', 'Cargo Recovery': '6101030', 'Other Incident Expenses': '6101027' };
  const BREAKDOWN_FMR_STATUS = 'Breakdown in Transit';

  function categories(ctx) { const m = ctx && ctx.incidentcats; const list = m && Array.isArray(m.list) && m.list.length ? m.list : DEFAULT_CATEGORIES.map((name) => ({ name, active: true, mechanical: MECHANICAL.includes(name) })); return list.filter((c) => c.active !== false); }
  function isMechanical(category, ctx) { const c = categories(ctx).find((x) => norm(x.name) === norm(category)); return c ? !!c.mechanical : MECHANICAL.includes(category); }
  function nextIncidentNo(dateISO, list) { const d = String(dateISO || E.todayISO()).slice(2, 10).replace(/-/g, ''); const pre = `INC-${d}-`; const n = (list || []).map((x) => String(x.id || '')).filter((x) => x.startsWith(pre)).map((x) => Number(x.slice(pre.length)) || 0); return pre + String((n.length ? Math.max(...n) : 0) + 1).padStart(2, '0'); }

  /** Build an incident from a trip: truck, driver, route, client, asset code, cost center and LOB are copied from the Trip Log. */
  function fromTrip(trip, input, ctx, user, now) {
    now = now || new Date().toISOString(); const truck = (ctx.fleet || []).find((f) => P.plateKey(f.plate) === P.plateKey(trip.plate)) || null;
    return Object.assign({ id: nextIncidentNo(now.slice(0, 10), ctx.incidents || []), tripLogId: trip.id, tripId: trip.journeyPlanId || '', occurredAt: now, reportedAt: now, reportedBy: user ? user.username : '', plate: trip.plate, assetCode: trip.assetCode || '', driver: trip.driver || (truck ? truck.driver : ''), client: trip.client, route: `${trip.loadingFrom} → ${trip.loadingTo}`, routeMasterId: trip.routeMasterId || trip.routeId || '', costCenter: trip.costCenter || '', lob: trip.lob || '', currentLocation: truck ? truck.currentLocation || '' : '', state: truck ? truck.currentState || '' : '', category: '', description: '', severity: 'Medium', truckImmobilized: false, cargoAffected: false, estimatedDelayHours: null, estimatedRepairCost: null, status: 'Reported', photos: [], documents: [], remarks: '', fmrStatusBefore: truck ? truck.status || '' : '', jobcardId: '', repairStartAt: '', repairEndAt: '', releasedAt: '', closedAt: '', history: [{ at: now, by: user ? user.username : '', role: user ? user.role : '', action: 'Reported', status: 'Reported', note: '' }] }, input || {});
  }
  /** Why an incident write is refused ('' when allowed): roles per stage, mandatory fields, ordered workflow, closure conditions. */
  function incidentError(next, current, role, ctx) {
    ctx = ctx || {};
    if (!next) return 'Nothing to save.';
    if (!current) {
      if (!E.can(role, 'incident.report')) return 'Your role cannot report incidents (tracking officers, station supervisors and operations do).';
      if (!next.tripLogId) return 'An incident must be linked to an existing Trip ID.';
      if (!clean(next.category)) return 'Choose the incident category.'; if (!clean(next.description)) return 'Describe the incident.'; if (!SEVERITIES.includes(next.severity)) return 'Choose the severity.';
      if (next.status && next.status !== 'Reported') return 'A new incident starts as Reported.';
      return '';
    }
    if (['Closed', 'Cancelled'].includes(current.status) && Object.keys(next).some((k) => !['id', 'version', 'updatedAt', 'updatedBy', 'remarks', 'documents', 'photos', 'history'].includes(k) && JSON.stringify(next[k]) !== JSON.stringify(current[k]))) return `Incident ${current.id} is ${current.status} and cannot be changed.`;
    const h0 = JSON.stringify(current.history || []); if (JSON.stringify((next.history || []).slice(0, (current.history || []).length)) !== h0) return 'The incident history is immutable.';
    if (next.status && next.status !== current.status) {
      const from = current.status, to = next.status;
      if (to === 'Cancelled') { if (!E.can(role, 'incident.review')) return 'Only the Operations Manager cancels an incident.'; return ''; }
      if (!(to in ORDER)) return `Unknown incident status ${to}.`;
      if (to === 'Operations Review' && !E.can(role, 'incident.review')) return 'Only the Operations Manager reviews incidents.';
      if (to === 'Workshop Assessment' && !E.can(role, 'incident.review') && !E.can(role, 'workshop.manage')) return 'Workshop assessment is recorded by the Workshop Manager or Operations.';
      if (to === 'Expense Requests' && !E.can(role, 'expense.request') && !E.can(role, 'incident.review')) return 'Only planners, station supervisors or operations move an incident to expense requests.';
      if (to === 'Awaiting Approval' && !E.can(role, 'expense.request') && !E.can(role, 'incident.review')) return 'Only planners, station supervisors or operations submit incident expenses for approval.';
      if (to === 'Repair / Recovery' && !E.can(role, 'incident.review') && !E.can(role, 'workshop.manage')) return 'Repair / recovery is recorded by the Workshop Manager or Operations.';
      if (to === 'Truck Released' && !E.can(role, 'incident.review') && !E.can(role, 'workshop.manage') && !E.can(role, 'tat.update')) return 'The truck is released by the Workshop Manager, Operations or the tracking team.';
      if (to === 'Closed') { if (!E.can(role, 'incident.review')) return 'Only the Operations Manager closes an incident.'; if (current.truckImmobilized && !next.releasedAt && !current.releasedAt) return 'Record the truck release before closing the incident.'; const pending = (ctx.extraexpenses || []).filter((x) => x.incidentId === current.id && x.status === 'Pending Approval'); if (pending.length) return `${pending.length} incident expense request${pending.length > 1 ? 's are' : ' is'} still awaiting the Operations Manager's decision.`; }
      if (ORDER[to] < ORDER[from] && to !== 'Operations Review') return `An incident does not move back from ${from} to ${to}.`;
    }
    return '';
  }
  /** Stamp a transition (who, when, timestamps) and append to the immutable history. */
  function stamp(next, current, user, now) {
    now = now || new Date().toISOString(); const out = Object.assign({}, next); const hist = (current && current.history ? current.history : []).slice();
    if (current && out.status && out.status !== current.status) {
      if (out.status === 'Operations Review') { out.reviewedAt = out.reviewedAt || now; out.reviewedBy = user.username; }
      if (out.status === 'Repair / Recovery' && !out.repairStartAt && !current.repairStartAt) out.repairStartAt = now;
      if (out.status === 'Truck Released') { if (!out.repairEndAt && !current.repairEndAt) out.repairEndAt = now; if (!out.releasedAt && !current.releasedAt) out.releasedAt = now; out.releasedBy = user.username; }
      if (out.status === 'Closed') { out.closedAt = now; out.closedBy = user.username; }
      hist.push({ at: now, by: user.username, role: user.role, action: out.status, status: out.status, note: out.transitionNote || '' });
    }
    delete out.transitionNote; out.history = hist; return out;
  }

  // ------------------------------------------------------------- hours, delay, TAT / OTD impact
  const hoursBetween = (a, b) => (a && b ? round2((Date.parse(b) - Date.parse(a)) / 3600000) : null);
  function timing(inc, now) {
    now = now || new Date().toISOString(); const end = inc.releasedAt || (['Closed', 'Cancelled'].includes(inc.status) ? inc.closedAt || inc.releasedAt : '') || '';
    const breakdownHours = inc.truckImmobilized ? hoursBetween(inc.occurredAt || inc.reportedAt, end || now) : 0;
    const repairHours = inc.repairStartAt ? hoursBetween(inc.repairStartAt, inc.repairEndAt || inc.releasedAt || now) : null;
    return { breakdownStart: inc.truckImmobilized ? inc.occurredAt || inc.reportedAt : '', repairStart: inc.repairStartAt || '', repairEnd: inc.repairEndAt || '', released: inc.releasedAt || '', breakdownHours: breakdownHours === null ? null : Math.max(0, breakdownHours), repairHours: repairHours === null ? null : Math.max(0, repairHours), ongoing: inc.truckImmobilized && !end, tripDelayHours: inc.truckImmobilized ? Math.max(0, breakdownHours || 0) : num(inc.estimatedDelayHours) || 0 };
  }
  /** Incident delay on a trip: the hours its trucks were immobilised (released − occurred), summed over the trip's incidents. */
  function tripDelay(trip, incidents, now) {
    const list = (incidents || []).filter((i) => i.tripLogId === trip.id && i.status !== 'Cancelled'); const items = list.map((i) => Object.assign({ id: i.id, category: i.category, status: i.status }, timing(i, now)));
    return { incidents: items, hours: round2(items.reduce((s, x) => s + (x.tripDelayHours || 0), 0)), open: list.filter((i) => !['Closed', 'Cancelled'].includes(i.status)).length, immobilized: list.some((i) => i.truckImmobilized && !i.releasedAt && !['Closed', 'Cancelled'].includes(i.status)) };
  }
  /** TAT / OTD figures with the incident delay separated from the normal route turnaround. */
  function tatImpact(trip, tat, incidents, now) {
    const d = tripDelay(trip, incidents, now); const target = tat.targetHours;
    const totalEx = tat.totalHours === null ? null : round2(Math.max(0, tat.totalHours - d.hours)); const varianceEx = totalEx !== null && target !== null && target !== undefined ? round2(totalEx - target) : null;
    const deliveryEx = tat.deliveryHours === null || tat.deliveryHours === undefined ? null : round2(Math.max(0, tat.deliveryHours - d.hours));
    const otdEx = deliveryEx === null || !tat.otdTargetHours ? tat.otdStatus : deliveryEx <= tat.otdTargetHours ? 'On Time' : 'Late';
    const revisedEta = trip.etaDelivery || (trip.milestones && trip.milestones.loadedAt && tat.otdTargetHours ? new Date(Date.parse(trip.milestones.loadedAt) + (tat.otdTargetHours + d.hours) * 3600000).toISOString() : '');
    return Object.assign({}, d, { totalHoursExcludingIncidents: totalEx, varianceExcludingIncidents: varianceEx, otdStatusExcludingIncidents: otdEx, otdFailureCausedByIncident: tat.otdStatus === 'Late' && otdEx === 'On Time', revisedEta, incidentCaused: tat.status === 'Overdue' && varianceEx !== null && varianceEx <= 0 });
  }

  // ------------------------------------------------------------- expenses and costs
  /** Why an incident expense request is refused ('' when allowed). Diesel goes through the diesel issuance workflow; spare parts link to the workshop. */
  function expenseError(inc, trip, req, role) {
    if (!inc) return 'Incident not found.'; if (['Closed', 'Cancelled'].includes(inc.status)) return `Incident ${inc.id} is ${inc.status}; no new expense requests.`;
    if (!E.can(role, 'expense.request')) return 'Only the Planner or the Station Supervisor submits incident expense requests (tracking officers report the incident).';
    if (!EXPENSE_CATEGORIES.includes(req.category)) return 'Choose an incident expense category.';
    if (req.category === 'Additional Diesel') return 'Additional diesel is not paid as an expense: raise an additional request on the trip\'s Diesel Request Form so the stock issuance is recorded.';
    if (req.category === 'Spare Parts' && !req.jobcardId) return 'Spare parts are issued against a workshop job card: create the job card from the incident and record the parts there (the cost reaches the incident through the job card).';
    if (!(num(req.amountRequested) > 0)) return 'Enter the amount requested.'; if (!clean(req.reason || req.description)) return 'Describe the expense.';
    return '';
  }
  /** Incident cost roll-up: expenses (requested / approved / paid / outstanding) plus linked job-card costs, without double counting. */
  function costs(inc, ctx, WS) {
    const ex = (ctx.extraexpenses || []).filter((x) => x.incidentId === inc.id && x.status !== 'Rejected' && x.status !== 'Cancelled');
    const requested = round2(ex.reduce((s, x) => s + (num(x.amountRequested) || 0), 0)); const approved = round2(ex.filter((x) => ['Approved', 'Paid'].includes(x.status)).reduce((s, x) => s + (num(x.approvedAmount) || 0), 0)); const paid = round2(ex.filter((x) => x.status === 'Paid').reduce((s, x) => s + (num(x.approvedAmount) || 0), 0));
    const jobs = (ctx.jobcards || []).filter((j) => j.incidentId === inc.id || (inc.jobcardId && j.id === inc.jobcardId)); const repair = round2(jobs.reduce((s, j) => s + (WS ? WS.jobCosts(j, ctx.stockmoves || []).total : (num(j.labourCost) || 0) + (num(j.externalRepairCost) || 0)), 0));
    return { expenses: ex, requested, approved, paid, outstanding: round2(approved - paid), pending: ex.filter((x) => x.status === 'Pending Approval').length, awaitingPayment: ex.filter((x) => x.status === 'Approved').length, jobcards: jobs, repairCost: repair, total: round2(paid + repair), totalCommitted: round2(approved + repair) };
  }

  // ------------------------------------------------------------- reporting
  function dashboard(ctx, WS, now) {
    now = now || ctx.now || new Date().toISOString(); const list = (ctx.incidents || []).filter((i) => i.status !== 'Cancelled'); const open = list.filter((i) => !['Closed'].includes(i.status));
    const byKey = (fn, valueFn) => { const m = new Map(); for (const i of list) { const k = fn(i) || '(unspecified)'; const r = m.get(k) || { key: k, incidents: 0, cost: 0, breakdownHours: 0 }; r.incidents++; r.cost = round2(r.cost + (valueFn ? valueFn(i) : costs(i, ctx, WS).total)); r.breakdownHours = round2(r.breakdownHours + (timing(i, now).breakdownHours || 0)); m.set(k, r); } return [...m.values()].sort((a, b) => b.cost - a.cost || b.incidents - a.incidents); };
    const costOf = (i) => costs(i, ctx, WS).total; const t = list.map((i) => timing(i, now));
    const trips = ctx.trips || []; let otdFailures = 0; for (const trip of trips) { if (!list.some((i) => i.tripLogId === trip.id)) continue; const tat = P.tatCalc(trip, trip.tatTargetDays, now); const imp = tatImpact(trip, tat, list, now); if (imp.otdFailureCausedByIncident) otdFailures++; }
    const repeat = new Map(); for (const i of list) { const k = P.plateKey(i.plate); repeat.set(k, (repeat.get(k) || []).concat(i)); } const repeatVehicles = [...repeat.values()].filter((l) => l.length >= 2).map((l) => ({ plate: l[0].plate, incidents: l.length, categories: [...new Set(l.map((i) => i.category))], lastAt: l.map((i) => i.occurredAt).sort().pop(), cost: round2(l.reduce((s, i) => s + costOf(i), 0)) })).sort((a, b) => b.incidents - a.incidents);
    const breakdownHours = t.filter((x) => x.breakdownHours !== null).map((x) => x.breakdownHours);
    return { total: list.length, open: open.length, breakdowns: list.filter((i) => isMechanical(i.category, ctx) && i.category !== 'Accident').length, accidents: list.filter((i) => /accident|traffic/i.test(i.category)).length, immobilized: open.filter((i) => i.truckImmobilized && !i.releasedAt).length, awaitingApproval: list.filter((i) => costs(i, ctx, WS).pending > 0).length, totalExpenses: round2(list.reduce((s, i) => s + costOf(i), 0)), awaitingPayment: round2(list.reduce((s, i) => s + costs(i, ctx, WS).outstanding, 0)), avgBreakdownHours: breakdownHours.length ? round2(breakdownHours.reduce((s, x) => s + x, 0) / breakdownHours.length) : null, totalBreakdownDays: round2(breakdownHours.reduce((s, x) => s + x, 0) / 24), byTruck: byKey((i) => i.plate, costOf), byRoute: byKey((i) => i.route, costOf), byClient: byKey((i) => i.client, costOf), byCategory: byKey((i) => i.category, costOf), otdFailures, repeatVehicles, list };
  }
  const QUESTIONS = ['Which trucks have the highest breakdown frequency?', 'Which routes experience the most incidents?', 'What is the total incident cost this month?', 'Which trucks have repeated tyre failures?', 'How many deliveries were delayed because of breakdowns?', 'Which incident categories create the highest expenses?', 'Which vehicles require maintenance review?'];
  function assistant(question, ctx, WS) {
    const q = norm(question); if (!/incident|breakdown|accident|tyre|delay|maintenance|repair|immobil|towing|recovery/.test(q)) return null;
    const d = dashboard(ctx, WS); const money = (n) => '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
    if (/frequen|most breakdown|highest breakdown/.test(q) && /truck|vehicle/.test(q)) { const rows = d.byTruck.map((r) => Object.assign({}, r, { incidents: r.incidents })).sort((a, b) => b.incidents - a.incidents).slice(0, 15); return { title: 'Breakdown frequency by truck', answer: rows.length ? `${rows[0].key} has the most recorded incidents (${rows[0].incidents}); ${d.repeatVehicles.length} truck${d.repeatVehicles.length === 1 ? '' : 's'} have repeat incidents.` : 'No incidents recorded.', columns: ['key', 'incidents', 'breakdownHours', 'cost'], rows }; }
    if (/route/.test(q)) { const rows = d.byRoute.slice().sort((a, b) => b.incidents - a.incidents).slice(0, 15); return { title: 'Incidents by route', answer: rows.length ? `${rows[0].key} has the most incidents (${rows[0].incidents}, ${money(rows[0].cost)} recorded cost).` : 'No incidents recorded.', columns: ['key', 'incidents', 'breakdownHours', 'cost'], rows }; }
    if (/total.*cost|cost.*(month|total)/.test(q)) { const month = (ctx.today || E.todayISO()).slice(0, 7); const rows = d.list.filter((i) => String(i.occurredAt || '').slice(0, 7) === month).map((i) => { const c = costs(i, ctx, WS); return { id: i.id, tripId: i.tripId, plate: i.plate, category: i.category, paidExpenses: c.paid, repairCost: c.repairCost, total: c.total, outstanding: c.outstanding }; }); return { title: `Incident cost · ${month}`, answer: `${rows.length} incident${rows.length === 1 ? '' : 's'} this month; recorded cost ${money(rows.reduce((s, r) => s + r.total, 0))} (paid expenses + workshop repair costs), ${money(rows.reduce((s, r) => s + r.outstanding, 0))} approved and awaiting payment. Only recorded amounts are counted; nothing is estimated.`, columns: ['id', 'tripId', 'plate', 'category', 'paidExpenses', 'repairCost', 'total', 'outstanding'], rows }; }
    if (/tyre/.test(q)) { const m = new Map(); for (const i of d.list.filter((x) => /tyre/i.test(x.category))) { const r = m.get(i.plate) || { plate: i.plate, tyreIncidents: 0, cost: 0, lastAt: '' }; r.tyreIncidents++; r.cost = round2(r.cost + costs(i, ctx, WS).total); r.lastAt = [r.lastAt, i.occurredAt].sort().pop(); m.set(i.plate, r); } const rows = [...m.values()].filter((r) => r.tyreIncidents >= 2).sort((a, b) => b.tyreIncidents - a.tyreIncidents); return { title: 'Repeated tyre failures', answer: rows.length ? `${rows.length} truck${rows.length === 1 ? '' : 's'} with two or more tyre incidents; ${rows[0].plate} leads with ${rows[0].tyreIncidents}.` : 'No truck has more than one tyre incident on record.', columns: ['plate', 'tyreIncidents', 'cost', 'lastAt'], rows }; }
    if (/delay|late|otd|deliver/.test(q)) { const rows = []; for (const trip of ctx.trips || []) { if (!d.list.some((i) => i.tripLogId === trip.id)) continue; const tat = P.tatCalc(trip, trip.tatTargetDays, ctx.now); const imp = tatImpact(trip, tat, d.list, ctx.now); if (imp.hours > 0) rows.push({ tripId: trip.journeyPlanId || trip.id, client: trip.client, route: `${trip.loadingFrom} → ${trip.loadingTo}`, incidentDelayHours: imp.hours, otdStatus: tat.otdStatus, otdWithoutIncident: imp.otdStatusExcludingIncidents, causedByIncident: imp.otdFailureCausedByIncident ? 'yes' : 'no' }); } return { title: 'Deliveries delayed by incidents', answer: `${rows.length} trip${rows.length === 1 ? '' : 's'} carry incident delay; ${rows.filter((r) => r.causedByIncident === 'yes').length} missed the OTD target only because of the incident.`, columns: ['tripId', 'client', 'route', 'incidentDelayHours', 'otdStatus', 'otdWithoutIncident', 'causedByIncident'], rows }; }
    if (/categor/.test(q)) { const rows = d.byCategory; return { title: 'Incident cost by category', answer: rows.length ? `${rows[0].key} creates the highest recorded expenses (${money(rows[0].cost)} over ${rows[0].incidents} incident${rows[0].incidents === 1 ? '' : 's'}).` : 'No incidents recorded.', columns: ['key', 'incidents', 'cost', 'breakdownHours'], rows }; }
    if (/maintenance|review|repeat/.test(q)) { const rows = d.repeatVehicles.map((r) => Object.assign({}, r, { categories: r.categories.join(', ') })); return { title: 'Vehicles for maintenance review (repeat incidents)', answer: rows.length ? `${rows.length} truck${rows.length === 1 ? '' : 's'} have two or more recorded incidents and should be reviewed with the workshop: ${rows.slice(0, 5).map((r) => r.plate).join(', ')}. The assistant reports recorded incidents only and does not infer causes.` : 'No truck has repeat incidents on record.', columns: ['plate', 'incidents', 'categories', 'cost', 'lastAt'], rows }; }
    return null;
  }
  /** Why a trip cannot be closed operationally without acknowledging its incidents ('' when none are open). */
  function closureFlag(trip, incidents) { const open = (incidents || []).filter((i) => i.tripLogId === trip.id && !['Closed', 'Cancelled', 'Truck Released'].includes(i.status)); return open.length ? `${open.length} unresolved incident${open.length > 1 ? 's' : ''} on this trip (${open.map((i) => i.id + ' · ' + i.status).join(', ')}).` : ''; }
  /** Job card prefilled from an incident (Create Workshop Job Card). */
  function jobCardFromIncident(inc, trip, WS, ctx, user, now) {
    now = now || new Date().toISOString();
    return { id: 'jc-' + inc.id.toLowerCase().replace(/[^a-z0-9]+/g, '-'), number: WS.nextJobNo(now.slice(0, 10), ctx.jobcards || []), plate: inc.plate, assetCode: inc.assetCode, costCenter: inc.costCenter, lob: inc.lob, defect: `${inc.category}: ${inc.description}`, breakdownCategory: WORKSHOP_CATEGORY[inc.category] || 'Other', maintenanceType: 'Breakdown repair', technician: '', enteredAt: now, tripLogId: inc.tripLogId, tripId: inc.tripId, incidentId: inc.id, location: inc.currentLocation, odometer: null, requiredParts: [], labourCost: null, externalRepairCost: null, estimatedCost: num(inc.estimatedRepairCost), notes: `Created from incident ${inc.id} (${inc.severity}) at ${inc.currentLocation || 'unknown location'}`, status: 'Defect Reported', reportedBy: user ? user.username : inc.reportedBy, history: [{ at: now, by: user ? user.username : '', action: 'Defect Reported', status: 'Defect Reported', note: `From incident ${inc.id}` }] };
  }

  return { DEFAULT_CATEGORIES, MECHANICAL, WORKSHOP_CATEGORY, SEVERITIES, STATUSES, ORDER, EXPENSE_CATEGORIES, EXPENSE_ACCOUNT_HINT, BREAKDOWN_FMR_STATUS, categories, isMechanical, nextIncidentNo, fromTrip, incidentError, stamp, timing, tripDelay, tatImpact, expenseError, costs, dashboard, QUESTIONS, assistant, closureFlag, jobCardFromIncident };
});
