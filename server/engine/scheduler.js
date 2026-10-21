/*
 * scheduler.js — finite-capacity, day-by-day simulation.
 *
 * Model
 *  - Every work centre offers 1.0 "resource-day" per working day (× capacity factor × calendar minutes/480).
 *    An operation producing q units at a rate of R units/day consumes q/R resource-days, so different
 *    models sharing a department are never double counted.
 *  - Optional machine detail (Punch 1 / Punch 2 / Plasma) is expressed in minutes per unit against each
 *    machine's minutes per day; the slowest machine limits the operation.
 *  - Operation inputs: op 1 of an order waits for its child orders (component availability, in transfer
 *    batches), later ops wait for the previous op of the same order. Partial transfers are therefore
 *    natural: the next section starts as soon as the first batch is through.
 *  - Orders are processed in priority order every day; existing orders can be passed in with their
 *    completed quantities so a new plan competes for the capacity that is really left.
 */
'use strict';
const EPS = 1e-6;

/**
 * @param {object} p
 * @param {string} p.startDate ISO date; scheduling starts on the first working day >= startDate
 * @param {object} p.calendar from calendar.makeCalendar()
 * @param {object} p.resources { [wc]: { capacityFactor } }
 * @param {object} p.machines { [machine]: { minutesPerDay } }
 * @param {Array} p.orders [{ id, planId, code, qty, priority, level, children:[{id, perUnit}], opening,
 *                            ops:[{ id, seq, wc, rate, machineMinutes:{m:minPerUnit}|null, completed }] }]
 * @param {object} p.options { transferBatch, horizonDays, useMachines }
 */
function simulate(p) {
  const { startDate, calendar, resources = {}, machines = {}, orders, options = {} } = p;
  const transferBatch = options.transferBatch ?? 1;
  const horizon = options.horizonDays ?? 400;
  const useMachines = options.useMachines !== false;
  const byId = new Map(orders.map((o) => [o.id, o]));
  const allOps = [];
  for (const o of orders) {
    o.ops = (o.ops || []).slice().sort((a, b) => a.seq - b.seq);
    o.ops.forEach((op, i) => {
      op.order = o; op.index = i; op.cum = op.completed || 0; op.days = []; op.start = null; op.finish = null;
      op.waitInput = 0; op.waitCapacity = 0; op.blockedBy = {}; op.startedBefore = op.cum > 0;
      if (op.cum >= o.qty - EPS) op.finish = 'done';
      allOps.push(op);
    });
    o.finish = o.ops.length ? (o.ops.every((op) => op.finish === 'done') ? 'done' : null) : (o.availableFrom || 'done');
  }
  // Priority: lower number first, deeper levels first (components before assemblies), then op seq.
  orders.forEach((o, i) => { if (o.planSeq == null) o.planSeq = i; });
  allOps.sort((a, b) => (a.order.priority - b.order.priority) || ((b.order.level || 0) - (a.order.level || 0)) || (a.order.planSeq - b.order.planSeq) || (a.seq - b.seq));
  const utilisation = new Map(); // wc -> { date -> used }
  const machineUse = new Map();
  const dates = [];
  const transferLag = options.transferLagDays ?? 1;
  const cumOf = (op) => (transferLag > 0 ? op.cumPrev : op.cum);
  let day = calendar.nextWorking(startDate);
  const availableInput = (op) => {
    const o = op.order;
    if (op.index > 0) return cumOf(o.ops[op.index - 1]);
    let avail = (o.opening || 0) + o.qty; // if no children, unconstrained by inputs
    if (!o.children || !o.children.length) return avail;
    let lim = Infinity;
    for (const ch of o.children) {
      const c = byId.get(ch.id);
      if (!c) continue;
      const last = c.ops.length ? c.ops[c.ops.length - 1] : null;
      const supplied = !last ? (c.availableFrom && day < c.availableFrom ? 0 : c.qty) : null; // SUPPLY orders arrive on availableFrom
      const made = last ? cumOf(last) : supplied;
      const doneAll = last ? cumOf(last) >= c.qty - EPS : supplied >= c.qty - EPS;
      const usable = doneAll ? made : Math.floor(made / Math.max(transferBatch * ch.perUnit, EPS)) * transferBatch * ch.perUnit;
      lim = Math.min(lim, usable / ch.perUnit);
    }
    return Math.min(avail, (o.opening || 0) + lim);
  };
  let n = 0;
  const pending = () => allOps.some((op) => op.finish !== 'done' && op.finish == null);
  for (const op of allOps) op.cumPrev = op.cum;
  while (n < horizon && pending()) {
    const dayFactor = calendar.minutes(day) / 480;
    dates.push(day);
    for (const op of allOps) op.cumPrev = op.cum;
    const capLeft = {}; const minLeft = {};
    for (const op of allOps) {
      if (op.finish) continue;
      if (capLeft[op.wc] === undefined) capLeft[op.wc] = ((resources[op.wc]?.capacityFactor) ?? 1) * dayFactor;
      if (useMachines && op.machineMinutes) for (const m of Object.keys(op.machineMinutes)) if (minLeft[m] === undefined) minLeft[m] = ((machines[m]?.minutesPerDay) ?? 480) * dayFactor;
    }
    for (const op of allOps) {
      if (op.finish) continue;
      const o = op.order;
      const remaining = o.qty - op.cum;
      const input = availableInput(op);
      const allowed = Math.min(remaining, input - op.cum);
      if (allowed <= EPS) { op.waitInput++; continue; }
      let maxQ = allowed;
      if (op.rate > 0) maxQ = Math.min(maxQ, capLeft[op.wc] * op.rate);
      else if (!(useMachines && op.machineMinutes)) { op.unschedulable = true; continue; }
      if (useMachines && op.machineMinutes) {
        for (const [m, mpu] of Object.entries(op.machineMinutes)) if (mpu > 0) maxQ = Math.min(maxQ, minLeft[m] / mpu);
      }
      if (maxQ <= EPS) { op.waitCapacity++; op.blockedBy[op.wc] = (op.blockedBy[op.wc] || 0) + 1; continue; }
      const q = Math.min(allowed, maxQ);
      op.cum += q;
      if (op.rate > 0) { capLeft[op.wc] -= q / op.rate; if (!utilisation.has(op.wc)) utilisation.set(op.wc, {}); const u = utilisation.get(op.wc); u[day] = (u[day] || 0) + q / op.rate; }
      if (useMachines && op.machineMinutes) for (const [m, mpu] of Object.entries(op.machineMinutes)) { minLeft[m] -= q * mpu; if (!machineUse.has(m)) machineUse.set(m, {}); const u = machineUse.get(m); u[day] = (u[day] || 0) + q * mpu; }
      op.days.push({ date: day, qty: q });
      if (!op.start) op.start = day;
      if (op.cum >= o.qty - EPS) { op.finish = day; if (op.index === o.ops.length - 1) o.finish = day; }
    }
    day = calendar.nextWorking(addDays(day, 1));
    n++;
  }
  const unfinished = allOps.filter((op) => !op.finish);
  // --- critical path: walk back from the top-level order's last op through the binding constraint
  const top = orders.find((o) => o.isRoot) || orders[0];
  const path = []; const seen = new Set();
  let cursor = top && top.ops.length ? top.ops[top.ops.length - 1] : null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const o = cursor.order;
    const capacityBound = cursor.waitCapacity > 0 && cursor.waitCapacity >= cursor.waitInput;
    path.push({ orderId: o.id, code: o.code, opId: cursor.id, seq: cursor.seq, wc: cursor.wc, start: cursor.start, finish: cursor.finish, constraint: capacityBound ? 'capacity' : (cursor.waitInput > 0 ? 'input' : 'flow') });
    let next = null;
    if (cursor.index > 0) next = o.ops[cursor.index - 1];
    else if (o.children && o.children.length) {
      // child whose last op finished latest
      let latest = null;
      for (const ch of o.children) { const c = byId.get(ch.id); if (!c || !c.ops.length) continue; const last = c.ops[c.ops.length - 1]; if (!latest || (last.finish || '9999') > (latest.finish || '9999') || (last.finish === latest.finish && (c.level || 0) < (latest.order.level || 0))) latest = last; }
      next = latest;
    }
    cursor = next;
  }
  // --- bottleneck: highest average utilisation across the planning window, tie-break by capacity waits
  const windowDays = dates.length || 1;
  const util = [...utilisation].map(([wc, u]) => { const used = Object.values(u).reduce((a, b) => a + b, 0); const busyDays = Object.keys(u).length; return { wc, used, busyDays, avgUtil: used / windowDays, peakUtil: Math.max(...Object.values(u)), waits: allOps.filter((op) => op.wc === wc).reduce((a, op) => a + op.waitCapacity, 0) }; });
  util.sort((a, b) => (b.waits - a.waits) || (b.used - a.used));
  const bottleneck = util[0] || null;
  return {
    startDate: dates[0] || calendar.nextWorking(startDate), endDate: dates[dates.length - 1] || null, dates, finish: top ? top.finish : null,
    orders: orders.map((o) => ({ id: o.id, code: o.code, finish: o.finish, start: o.ops.length ? o.ops.map((x) => x.start).filter(Boolean).sort()[0] || null : null })),
    ops: allOps.map((op) => ({ id: op.id, orderId: op.order.id, seq: op.seq, wc: op.wc, start: op.start, finish: op.finish, days: op.days, waitInput: op.waitInput, waitCapacity: op.waitCapacity, unschedulable: !!op.unschedulable, cum: op.cum })),
    criticalPath: path.reverse(), bottleneck, utilisation: util, machineUse: [...machineUse].map(([m, u]) => ({ machine: m, minutes: u })),
    unfinished: unfinished.map((op) => ({ orderId: op.order.id, code: op.order.code, opId: op.id, wc: op.wc, rate: op.rate, reason: op.unschedulable ? 'no rate' : 'horizon' })),
    utilisationByDay: Object.fromEntries([...utilisation].map(([wc, u]) => [wc, u])),
  };
}

function addDays(s, n) { const [y, m, d] = s.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d + n)); return dt.toISOString().slice(0, 10); }

module.exports = { simulate };
