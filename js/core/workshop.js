/*
 * Workshop and inventory engine: defect reports → inspection → job card → parts requirement → approval → parts issue →
 * repair → quality inspection → release; spare-parts stock (opening quantity + receipts − issues + returns ± adjustments),
 * duplicate-issue and negative-stock prevention, job costs (labour + parts + external) per truck cost center, and the
 * workshop reports. Pure functions shared by browser, server and tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else { root.HB = root.HB || {}; root.HB.workshop = factory(root.HB.engine); }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const num = E.num, norm = E.norm, clean = E.clean, round2 = E.round2;

  const JOB_STATUSES = ['Defect Reported', 'Under Inspection', 'Job Card Open', 'Parts Required', 'Awaiting Approval', 'Approved', 'Parts Issued', 'Under Repair', 'Quality Inspection', 'Released', 'Cancelled'];
  const MAINTENANCE_TYPES = ['Breakdown repair', 'Preventive maintenance', 'Scheduled service', 'Tyre replacement', 'Accident repair', 'Inspection only'];
  const BREAKDOWN_CATEGORIES = ['Engine', 'Transmission & Drivetrain', 'Brakes / Air Brake System', 'Electrical', 'Suspension', 'Steering', 'Tyres & Wheels', 'Body & Cab', 'Hydraulics / Hiab', 'Cooling System', 'Fuel System', 'Other'];
  const STOCK_MOVE_TYPES = ['receipt', 'issue', 'return', 'adjustment'];
  /** Stage order used by the transition rule: a job moves forward one or more stages, back only to the previous one, and can be cancelled before parts are issued. */
  const ORDER = JOB_STATUSES.filter((s) => s !== 'Cancelled');

  function nextJobNo(dateISO, jobs) {
    const d = (dateISO || E.todayISO()).slice(2, 10).replace(/-/g, ''); const prefix = `JC-${d}-`;
    const n = (jobs || []).filter((j) => (j.number || '').startsWith(prefix)).length + 1; return prefix + String(n).padStart(2, '0');
  }
  function nextMoveNo(type, dateISO, moves) {
    const p = { receipt: 'GRN', issue: 'PIS', return: 'PRT', adjustment: 'ADJ' }[type] || 'STK'; const d = (dateISO || E.todayISO()).slice(2, 10).replace(/-/g, ''); const prefix = `${p}-${d}-`;
    return prefix + String((moves || []).filter((m) => (m.number || '').startsWith(prefix)).length + 1).padStart(2, '0');
  }

  /** Why a status change is refused ('' when allowed). Approval is a separate right; release needs the quality inspection stage first. */
  function jobTransitionError(current, next, role) {
    if (!current) return E.can(role, 'workshop.manage') ? '' : 'Only the workshop team opens defect reports and job cards.';
    if (!next || next.status === current.status) return '';
    if (current.status === 'Released') return `Job card ${current.number} is released and closed; open a new job card for further work.`;
    if (current.status === 'Cancelled') return `Job card ${current.number} is cancelled.`;
    if (next.status === 'Cancelled') { if (ORDER.indexOf(current.status) >= ORDER.indexOf('Parts Issued')) return 'A job card with parts issued cannot be cancelled; return the parts first.'; return E.can(role, 'workshop.manage') ? '' : 'Only the workshop team cancels job cards.'; }
    const from = ORDER.indexOf(current.status), to = ORDER.indexOf(next.status); if (to < 0) return `Unknown job status "${next.status}".`;
    if (to < from - 1) return `Job card ${current.number} cannot go back from ${current.status} to ${next.status}.`;
    if (next.status === 'Approved') { if (!E.can(role, 'workshop.approve')) return 'Only the Workshop Manager (or the Operations Manager) approves job cards for repair.'; if (!(next.requiredParts || []).length && num(next.labourCost) === null && num(next.externalRepairCost) === null) return 'Approve only after the parts requirement, labour or external repair cost is entered.'; }
    if (next.status === 'Released') { if (current.status !== 'Quality Inspection' && from < ORDER.indexOf('Quality Inspection')) return 'A vehicle is released only after the quality inspection.'; if (!next.qualityCheckedBy && !current.qualityCheckedBy) return 'Record who passed the quality inspection before releasing the vehicle.'; }
    if (['Parts Issued', 'Under Repair', 'Quality Inspection', 'Released'].includes(next.status) && from < ORDER.indexOf('Approved') && to > ORDER.indexOf('Approved')) return 'The job card must be approved before parts are issued or repairs start.';
    return E.can(role, 'workshop.manage') || (E.can(role, 'inventory.manage') && next.status === 'Parts Issued') ? '' : 'Only the workshop team updates job cards.';
  }

  // ------------------------------------------------------------- stock
  const signed = (m) => { const q = num(m.qty) || 0; return m.type === 'issue' ? -Math.abs(q) : m.type === 'return' || m.type === 'receipt' ? Math.abs(q) : q; };
  function stockLevel(item, moves) { return round2((num(item && item.openingStock) || num(item && item.stockQty) || 0) + (moves || []).filter((m) => m.itemId === (item && item.id) && !m.voidedAt).reduce((s, m) => s + signed(m), 0)); }
  function stockLevels(items, moves) { const map = new Map(); for (const i of items || []) map.set(i.id, stockLevel(i, moves)); return map; }
  /** Why a parts issue is refused ('' when allowed): job stage, quantity, duplicate issue, negative stock unless explicitly authorised. */
  function partsIssueError(job, item, qty, moves, opts) {
    opts = opts || {}; const q = num(qty);
    if (!job) return 'Choose the job card.'; if (!item) return 'Choose the item.';
    if (!['Approved', 'Parts Issued', 'Under Repair'].includes(job.status)) return `Parts can only be issued to an approved job card (${job.number} is ${job.status}).`;
    if (!(q > 0)) return 'Enter the quantity issued.';
    const dup = (moves || []).find((m) => m.type === 'issue' && m.jobCardId === job.id && m.itemId === item.id && !m.voidedAt && Math.abs((num(m.qty) || 0) - q) < 0.0005 && (!opts.requestRef || m.requestRef === opts.requestRef) && (opts.now ? Math.abs(Date.parse(m.at) - Date.parse(opts.now)) < 10 * 60000 : true));
    if (dup && !opts.allowDuplicate) return `${q} × ${item.id} was already issued to ${job.number} (${dup.number}); tick "this is a separate issue" if more of the same part is really needed.`;
    const level = stockLevel(item, moves);
    if (level - q < -0.0005 && !opts.allowNegative) return `Stock of ${item.id} ${item.description || ''} is ${level}; issuing ${q} would make it negative. Receive stock first or get the Storekeeper's authorisation for a negative issue.`;
    return '';
  }
  function moveError(move, item, moves, role) {
    if (!move || !STOCK_MOVE_TYPES.includes(move.type)) return 'Unknown stock movement type.';
    if (!item) return 'Unknown item.'; if (!(Math.abs(num(move.qty) || 0) > 0)) return 'Enter the quantity.';
    if (move.type === 'issue' && !E.can(role, 'inventory.manage') && !E.can(role, 'workshop.manage')) return 'Only the Storekeeper issues parts.';
    if (move.type !== 'issue' && !E.can(role, 'inventory.manage')) return 'Only the Storekeeper receives, returns or adjusts stock.';
    if (move.type === 'adjustment' && !clean(move.reason)) return 'An adjustment needs a reason.';
    if (move.type === 'return' && !move.jobCardId) return 'A return must name the job card the parts came back from.';
    if (move.type !== 'issue' && move.type !== 'adjustment' && num(move.qty) < 0) return 'Receipts and returns are positive quantities.';
    return '';
  }

  // ------------------------------------------------------------- costs
  function jobCosts(job, moves) {
    const parts = (moves || []).filter((m) => m.jobCardId === job.id && !m.voidedAt && (m.type === 'issue' || m.type === 'return')).reduce((s, m) => s + (m.type === 'issue' ? 1 : -1) * Math.abs(num(m.qty) || 0) * (num(m.unitCost) || 0), 0);
    const labour = num(job.labourCost) || 0, external = num(job.externalRepairCost) || 0;
    return { labour, parts: round2(parts), external, total: round2(labour + parts + external) };
  }
  const days = (a, b) => (a && b ? Math.max(0, round2((Date.parse(b) - Date.parse(a)) / 86400000)) : null);
  function downtimeDays(job, now) { return days(job.enteredAt || job.createdAt, job.releasedAt || (job.status === 'Cancelled' ? job.updatedAt : now || new Date().toISOString())); }
  /** Repeat repairs: the same truck back for the same breakdown category within `windowDays` of a previous release. */
  function repeatRepairs(jobs, windowDays) {
    const w = (windowDays || 30) * 86400000; const out = []; const by = new Map();
    for (const j of jobs || []) { const k = `${E.norm(j.plate)}|${norm(j.breakdownCategory || '')}`; if (!by.has(k)) by.set(k, []); by.get(k).push(j); }
    for (const list of by.values()) { const s = list.slice().sort((a, b) => String(a.enteredAt || a.createdAt).localeCompare(String(b.enteredAt || b.createdAt))); for (let i = 1; i < s.length; i++) { const prev = s[i - 1]; const gap = Date.parse(s[i].enteredAt || s[i].createdAt) - Date.parse(prev.releasedAt || prev.enteredAt || prev.createdAt); if (gap >= 0 && gap <= w) out.push({ plate: s[i].plate, category: s[i].breakdownCategory, first: prev.number, repeat: s[i].number, daysBetween: round2(gap / 86400000) }); } }
    return out;
  }
  function workshopReports(ctx) {
    const jobs = ctx.jobcards || [], moves = ctx.stockmoves || [], items = ctx.items || [], fleet = ctx.fleet || []; const now = ctx.now || new Date().toISOString();
    const open = jobs.filter((j) => !['Released', 'Cancelled'].includes(j.status));
    const costOf = (j) => jobCosts(j, moves).total;
    const group = (list, keyFn) => { const m = new Map(); for (const x of list) { const k = keyFn(x) || '(unknown)'; m.set(k, (m.get(k) || []).concat(x)); } return m; };
    const costByTruck = [...group(jobs, (j) => j.plate)].map(([plate, list]) => ({ plate, jobs: list.length, cost: round2(list.reduce((s, j) => s + costOf(j), 0)), downtimeDays: round2(list.reduce((s, j) => s + (downtimeDays(j, now) || 0), 0)), costCenter: list[0].costCenter || '' })).sort((a, b) => b.cost - a.cost);
    const issues = moves.filter((m) => m.type === 'issue' && !m.voidedAt); const itemBy = new Map(items.map((i) => [i.id, i]));
    const partsByCategory = [...group(issues, (m) => (itemBy.get(m.itemId) || {}).category || m.category)].map(([category, list]) => ({ category, lines: list.length, qty: round2(list.reduce((s, m) => s + Math.abs(num(m.qty) || 0), 0)), cost: round2(list.reduce((s, m) => s + Math.abs(num(m.qty) || 0) * (num(m.unitCost) || 0), 0)) })).sort((a, b) => b.cost - a.cost);
    const breakdownTypes = [...group(jobs.filter((j) => /breakdown|accident/i.test(j.maintenanceType || '') || !j.maintenanceType), (j) => j.breakdownCategory)].map(([category, list]) => ({ category, jobs: list.length, cost: round2(list.reduce((s, j) => s + costOf(j), 0)) })).sort((a, b) => b.jobs - a.jobs);
    const preventive = jobs.filter((j) => /preventive|scheduled/i.test(j.maintenanceType || '')).length;
    const inWorkshop = open.map((j) => ({ job: j, downtimeDays: downtimeDays(j, now), cost: costOf(j) }));
    const down = new Set(open.map((j) => E.norm(j.plate))); const active = fleet.filter((t) => t.active !== false);
    return { jobs: jobs.length, open: open.length, released: jobs.filter((j) => j.status === 'Released').length, inWorkshop, trucksInWorkshop: down.size, availabilityPct: active.length ? round2(((active.length - active.filter((t) => down.has(E.norm(t.plate))).length) / active.length) * 100) : null,
      totalDowntimeDays: round2(jobs.reduce((s, j) => s + (downtimeDays(j, now) || 0), 0)), repeatRepairs: repeatRepairs(jobs, 30), pmCompliance: { preventive, breakdown: jobs.length - preventive, pct: jobs.length ? round2((preventive / jobs.length) * 100) : null },
      costByTruck, partsByCategory, breakdownTypes, warrantyReturns: moves.filter((m) => m.type === 'return' && m.warranty && !m.voidedAt).length, totalCost: round2(jobs.reduce((s, j) => s + costOf(j), 0)), partsCost: round2(partsByCategory.reduce((s, x) => s + x.cost, 0)), stockValue: round2(items.reduce((s, i) => s + stockLevel(i, moves) * (num(i.unitCost) || 0), 0)), belowReorder: items.filter((i) => num(i.reorderLevel) !== null && stockLevel(i, moves) < num(i.reorderLevel)).length };
  }

  return { JOB_STATUSES, MAINTENANCE_TYPES, BREAKDOWN_CATEGORIES, STOCK_MOVE_TYPES, ORDER, nextJobNo, nextMoveNo, jobTransitionError, stockLevel, stockLevels, partsIssueError, moveError, jobCosts, downtimeDays, repeatRepairs, workshopReports };
});
