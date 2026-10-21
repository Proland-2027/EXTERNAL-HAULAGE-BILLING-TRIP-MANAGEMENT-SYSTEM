/*
 * planner.js — glue between the database, the BOM engine and the scheduler.
 * Builds a proposal for a sales request, persists it, and re-schedules open plans after progress.
 */
'use strict';
const { buildTree, explode, costProduct } = require('./bom.js');
const { ClassResolver } = require('./classes.js');
const { simulate } = require('./scheduler.js');
const { makeCalendar, today } = require('./calendar.js');
const { nowIso } = require('../db.js');

function loadContext(db) {
  const workCentres = db.all('SELECT * FROM work_centres');
  const sections = db.all('SELECT * FROM sections ORDER BY seq');
  const resolver = new ClassResolver({ modelClasses: db.all('SELECT * FROM model_classes'), productivity: db.all('SELECT * FROM productivity WHERE active = 1'), workCentres, cuttingSummary: db.all('SELECT * FROM cutting_summary') });
  const opMap = db.all('SELECT * FROM operation_map ORDER BY seq');
  const wcByCode = new Map(workCentres.map((w) => [w.code, w]));
  const machines = db.all('SELECT * FROM machines WHERE active = 1');
  const settings = { workingWeekdays: db.setting('working_weekdays', [1, 2, 3, 4, 5]), minutesPerDay: db.setting('minutes_per_day', 480), transferBatch: db.setting('transfer_batch', 1), useMachines: db.setting('use_machine_capacity', true), costPolicy: db.setting('cost_policy', 'approved'), driftPct: db.setting('cost_drift_pct', 10), defaultStaff: db.setting('fallback_staff', 1), ratePolicy: db.setting('rate_policy', 'master'), transferLagDays: db.setting('transfer_lag_days', 1) };
  const overrides = new Map(db.all('SELECT * FROM calendar').map((r) => [r.date, r]));
  const calendar = makeCalendar({ overrides, workingWeekdays: settings.workingWeekdays, minutesPerDay: settings.minutesPerDay });
  return { workCentres, wcByCode, sections, resolver, opMap, machines, settings, calendar };
}

function productTree(db, code) {
  const lines = db.all('SELECT * FROM bom_lines WHERE product_code = ? ORDER BY line_no', code);
  if (!lines.length) return null;
  return buildTree(lines);
}

function unitCostChooser(db, ctx) {
  const items = new Map(db.all('SELECT code, std_unit_cost, current_unit_cost, approved_unit_cost, cost_flags FROM items').map((r) => [r.code, r]));
  const policy = ctx.settings.costPolicy; const drift = ctx.settings.driftPct / 100;
  return (code, { std, current }) => {
    const it = items.get(code) || {};
    const flags = [];
    const approved = it.approved_unit_cost;
    const cur = current || it.current_unit_cost || null;
    let cost = std; let source = 'standard';
    if (policy === 'approved' && approved) { cost = approved; source = 'approved'; }
    else if ((policy === 'approved' || policy === 'current') && cur) { cost = cur; source = 'current'; }
    if (!std) flags.push('ZERO_STANDARD');
    if (!cur && !approved) flags.push('NO_CURRENT_PRICE');
    if (std && cur && Math.abs(cur - std) / std > drift) flags.push(cur > std ? 'PRICE_UP' : 'PRICE_DOWN');
    if (source === 'standard' && !approved) flags.push('STD_2021');
    return { cost: cost || 0, source, flags };
  };
}

/** Assign rates / classes to the routing of every order. */
function rateOperations(ctx, orders, product) {
  const warnings = [];
  for (const o of orders) {
    for (const op of o.ops) {
      if (!op.workCentre) { op.ratePerDay = 0; op.rateSource = 'unmapped'; continue; }
      const wc = ctx.wcByCode.get(op.workCentre);
      op.sectionCode = wc ? wc.section_code : null;
      const r = ctx.resolver.findRate(op.workCentre, { code: o.code, pnum: product.pnum });
      let rate = r.rate; let source = r.source; let classCode = r.row ? r.row.type_code : null;
      if (!(rate > 0)) {
        const hrs = op.hoursPerUnit || op.machineHoursPerUnit;
        const staff = r.row?.staffs || ctx.settings.defaultStaff || 1;
        if (hrs > 0) { rate = (8 / hrs) * staff; source = `bom_hours(${hrs.toFixed(2)}h×${staff}staff)`; }
        else { rate = 0; source = 'none'; }
        warnings.push({ type: 'RATE_FALLBACK', order: o.code, workCentre: op.workCentre, message: `No productivity for ${o.code} at ${wc?.name || op.workCentre}; using ${source}` });
      } else if (source === 'master:nearest') warnings.push({ type: 'RATE_NEAREST', order: o.code, workCentre: op.workCentre, message: `${wc?.name}: using nearest class "${classCode}" for ${o.code}` });
      // sanity check: does the master rate imply more staff than the sheet shows for the BOM labour hours?
      const hpu = op.hoursPerUnit || 0;
      if (hpu > 0 && rate > 0 && source.startsWith('master')) {
        const impliedStaff = (rate * hpu) / 8; const staffAvail = r.row?.total_staff || r.row?.staffs || null;
        const bomRate = (8 / hpu) * (staffAvail || ctx.settings.defaultStaff || 1);
        if (staffAvail && impliedStaff > staffAvail * 1.5) warnings.push({ type: 'RATE_VS_BOM_HOURS', order: o.code, workCentre: op.workCentre, message: `${wc?.name}: master rate ${rate.toFixed(1)}/day for ${o.code} implies ${impliedStaff.toFixed(0)} staff at ${hpu.toFixed(2)} BOM hours/unit, sheet shows ${staffAvail}; BOM-hours rate would be ${bomRate.toFixed(1)}/day`, data: { master: rate, bomRate, impliedStaff, staffAvail } });
        if (ctx.settings.ratePolicy === 'bom_hours') { rate = bomRate; source = `bom_hours(${hpu.toFixed(2)}h×${staffAvail || 1}staff)`; }
        else if (ctx.settings.ratePolicy === 'min' && bomRate < rate) { rate = bomRate; source = `min:bom_hours(${hpu.toFixed(2)}h×${staffAvail || 1}staff)`; }
      }
      op.ratePerDay = rate * ((wc?.capacity_factor) || 1);
      op.rateSource = source; op.classCode = classCode;
      op.machineMinutes = null;
      if (op.workCentre === 'GB-CANOPY-CUT' && o.family === 'CANOPY') {
        const cm = ctx.resolver.cuttingMinutes({ code: o.code, pnum: product.pnum });
        if (cm) {
          op.machineMinutes = { PUNCH1: cm.minutes['Punch 1'] || 0, PUNCH2: cm.minutes['Punch 2'] || 0, PLASMA: cm.minutes['Plasma'] || 0 };
          op.cuttingClass = cm.classCode;
          const machineLimit = Math.min(...Object.values(cm.minutes).filter((v) => v > 0).map((v) => 480 / v));
          if (Number.isFinite(machineLimit) && op.ratePerDay && Math.abs(machineLimit - op.ratePerDay) / op.ratePerDay > 0.05) warnings.push({ type: 'CUTTING_DISCREPANCY', order: o.code, workCentre: op.workCentre, message: `Canopy cutting ${o.code}: productivity master ${op.ratePerDay.toFixed(1)}/day vs machine time limit ${machineLimit.toFixed(1)}/day (class ${cm.classCode}, recorded ${cm.recordedPerShift ?? '-'}/shift)`, data: { master: op.ratePerDay, machineLimit, recorded: cm.recordedPerShift, minutes: cm.minutes } });
        }
      }
    }
  }
  return warnings;
}

/** Open operations of other plans, as scheduler orders, so capacity is shared. */
function loadOpenOrders(db, excludePlanId) {
  const pos = db.all(`SELECT po.*, p.status plan_status FROM production_orders po JOIN plans p ON p.id = po.plan_id WHERE p.status IN ('APPROVED','IN_PROGRESS') AND po.status NOT IN ('COMPLETED','CANCELLED') AND po.plan_id != ?`, excludePlanId ?? -1);
  if (!pos.length) return [];
  const ops = db.all(`SELECT * FROM po_operations WHERE production_order_id IN (${pos.map(() => '?').join(',')}) ORDER BY seq`, ...pos.map((p) => p.id));
  const byPo = new Map();
  for (const op of ops) { if (!byPo.has(op.production_order_id)) byPo.set(op.production_order_id, []); byPo.get(op.production_order_id).push(op); }
  return pos.map((po) => ({ id: `po:${po.id}`, dbId: po.id, planId: po.plan_id, planSeq: po.plan_id, code: po.item_code, qty: po.net_qty, priority: po.priority, level: po.level, opening: po.inventory_used, availableFrom: po.kind !== 'MAKE' ? po.planned_finish : null,
    children: JSON.parse(po.child_codes || '[]').map((c) => ({ id: `po:${c.poId}`, perUnit: c.perUnit })).filter((c) => c.id !== 'po:undefined'),
    ops: (byPo.get(po.id) || []).map((op) => ({ id: `op:${op.id}`, dbId: op.id, seq: op.seq, wc: op.work_centre_code, rate: op.rate_per_day || 0, machineMinutes: op.machine_minutes ? JSON.parse(op.machine_minutes) : null, completed: op.completed_qty })) }));
}

function inventoryAvailable(db) {
  const rows = db.all(`SELECT item_code, SUM(CASE WHEN type IN ('RECEIPT','OPENING','ADJUST','RETURN') THEN qty WHEN type = 'ISSUE' THEN -qty ELSE 0 END) bal FROM inventory_movements GROUP BY item_code`);
  return new Map(rows.map((r) => [r.item_code, r.bal]));
}

/**
 * Build (and optionally persist) a plan proposal.
 * options: { startDate, useInventory, priority, transferBatch, useMachines, persist, salesRequestId, user }
 */
function proposePlan(db, productCode, qty, options = {}) {
  const ctx = loadContext(db);
  const product = db.get('SELECT * FROM products WHERE code = ?', productCode);
  if (!product) throw new Error(`Unknown product ${productCode}`);
  const tree = productTree(db, productCode);
  if (!tree) throw new Error(`No BOM for ${productCode}`);
  const startDate = options.startDate || today();
  const { orders, materials, rootOrder, unmapped } = explode(tree, qty, { opMap: ctx.opMap });
  const warnings = rateOperations(ctx, orders, product);
  for (const u of unmapped) warnings.push({ type: 'UNMAPPED_PROCESS', order: u.code, message: `Process cost group ${u.costGroup} (${u.resources.join(', ')}) is not mapped to a work centre; excluded from schedule` });
  // net requirements against inventory
  const inv = options.useInventory ? inventoryAvailable(db) : new Map();
  const used = new Map();
  for (const o of orders) {
    const avail = Math.max(0, (inv.get(o.code) || 0) - (used.get(o.code) || 0));
    o.inventoryUsed = Math.min(avail, o.requiredQty);
    if (o.inventoryUsed > 0) used.set(o.code, (used.get(o.code) || 0) + o.inventoryUsed);
    o.netQty = o.requiredQty - o.inventoryUsed;
  }
  for (const m of materials) { const avail = Math.max(0, (inv.get(m.code) || 0) - (used.get(m.code) || 0)); m.inventoryAvailable = Math.min(avail, m.totalQty); m.netQty = m.totalQty - m.inventoryAvailable; if (m.inventoryAvailable > 0) used.set(m.code, (used.get(m.code) || 0) + m.inventoryAvailable); }
  const prio = options.priority === 'URGENT' ? 1 : options.priority === 'HIGH' ? 3 : options.priority === 'LOW' ? 7 : 5;
  const idOf = (code) => `new:${code}`;
  const leadDays = new Map(db.all('SELECT code, supplier_lead_days FROM items WHERE supplier_lead_days > 0').map((r) => [r.code, r.supplier_lead_days]));
  for (const o of orders) if (o.kind !== 'MAKE') { const ld = leadDays.get(o.code) || 0; o.availableFrom = ld > 0 ? ctx.calendar.addWorking(startDate, ld) : null; o.leadDays = ld; }
  const simOrders = orders.map((o) => ({ id: idOf(o.code), code: o.code, planSeq: 1e9, qty: Math.max(o.netQty, 0), priority: prio, level: o.level, opening: 0, isRoot: o === rootOrder, availableFrom: o.availableFrom || null,
    children: [...o.children].map(([c, pu]) => ({ id: idOf(c), perUnit: pu })),
    ops: o.kind === 'MAKE' ? o.ops.filter((op) => op.workCentre).map((op) => ({ id: `new:${o.code}#${op.seq}`, seq: op.seq, wc: op.workCentre, rate: op.ratePerDay, machineMinutes: op.machineMinutes, completed: 0 })) : [] }));
  // orders fully covered by inventory need nothing
  for (const so of simOrders) if (so.qty <= 0) so.ops = [];
  const existing = options.ignoreExisting ? [] : loadOpenOrders(db, options.excludePlanId);
  const resources = Object.fromEntries(ctx.workCentres.map((w) => [w.code, { capacityFactor: w.capacity_factor || 1 }]));
  const machines = Object.fromEntries(ctx.machines.map((m) => [m.code, { minutesPerDay: (m.minutes_per_day || 480) * (m.count || 1) }]));
  const sim = simulate({ startDate, calendar: ctx.calendar, resources, machines, orders: [...existing, ...simOrders], options: { transferBatch: options.transferBatch ?? ctx.settings.transferBatch, useMachines: options.useMachines ?? ctx.settings.useMachines, transferLagDays: options.transferLagDays ?? ctx.settings.transferLagDays, horizonDays: 500 } });
  const simOps = new Map(sim.ops.map((o) => [o.id, o]));
  const simOrd = new Map(sim.orders.map((o) => [o.id, o]));
  for (const o of orders) {
    const so = simOrd.get(idOf(o.code));
    o.plannedStart = so?.start || (o.kind !== 'MAKE' ? sim.startDate : null); o.plannedFinish = so?.finish === 'done' ? (o.kind !== 'MAKE' ? sim.startDate : null) : so?.finish || null;
    for (const op of o.ops) { const s = simOps.get(`new:${o.code}#${op.seq}`); if (s) { op.plannedStart = s.start; op.plannedFinish = s.finish; op.days = s.days; op.waitInput = s.waitInput; op.waitCapacity = s.waitCapacity; op.unschedulable = s.unschedulable; } }
  }
  const critical = sim.criticalPath.filter((c) => String(c.orderId).startsWith('new:'));
  const criticalSet = new Set(critical.map((c) => c.opId));
  for (const o of orders) for (const op of o.ops) op.onCriticalPath = criticalSet.has(`new:${o.code}#${op.seq}`);
  const unfinished = sim.unfinished.filter((u) => String(u.orderId).startsWith('new:'));
  for (const u of unfinished) warnings.push({ type: 'UNSCHEDULED', order: u.code, workCentre: u.wc, message: `${u.code} at ${ctx.wcByCode.get(u.wc)?.name || u.wc}: ${u.reason === 'no rate' ? 'no production rate available' : 'not finished within the planning horizon'}` });
  // costing snapshot
  const costing = costProduct(tree, qty, { unitCostFor: unitCostChooser(db, ctx), opMap: ctx.opMap, sectionOf: (wc) => ctx.wcByCode.get(wc)?.section_code || null });
  let expectedFinish = sim.finish && sim.finish !== 'done' ? sim.finish : null;
  if (!expectedFinish) {
    // top level has no routing in the BOM (e.g. kit products): finished when the last component order is complete
    const fins = orders.map((o) => o.plannedFinish).filter(Boolean).sort();
    expectedFinish = fins.length ? fins[fins.length - 1] : sim.startDate;
    if (!rootOrder.ops.length) warnings.push({ type: 'NO_FINAL_ROUTING', order: rootOrder.code, message: `${rootOrder.code} has no final assembly operations in the BOM; expected date is when the last component order completes` });
  }
  const summary = {
    product: { code: product.code, name: product.name, family: product.family, kva: product.kva, pnum: product.pnum }, qty, startDate: sim.startDate, expectedFinish,
    workingDays: expectedFinish ? ctx.calendar.workingDaysBetween(sim.startDate, expectedFinish) + 1 : null,
    orders: orders.length, makeOrders: orders.filter((o) => o.kind === 'MAKE' && o.netQty > 0).length, supplyOrders: orders.filter((o) => o.kind !== 'MAKE').length, materials: materials.length,
    materialCostPerUnit: costing.perUnit.material, materialCostTotal: costing.total.material, fullCostPerUnit: costing.perUnit.fullManufacturing, fullCostTotal: costing.total.fullManufacturing, erpStdCost: costing.erpStdCost,
    bottleneck: sim.bottleneck ? { ...sim.bottleneck, name: ctx.wcByCode.get(sim.bottleneck.wc)?.name } : null,
    bySection: sectionSummary(ctx, orders),
  };
  const result = { product, qty, startDate: sim.startDate, expectedFinish, orders, materials, warnings, criticalPath: critical.map((c) => ({ ...c, name: ctx.wcByCode.get(c.wc)?.name })), bottleneck: summary.bottleneck, utilisation: sim.utilisation.map((u) => ({ ...u, name: ctx.wcByCode.get(u.wc)?.name })), utilisationByDay: sim.utilisationByDay, machineUse: sim.machineUse, costing, summary, ctx };
  if (options.persist) return persistPlan(db, result, options);
  return result;
}

function sectionSummary(ctx, orders) {
  const m = new Map();
  for (const o of orders) for (const op of o.ops) {
    if (!op.sectionCode) continue;
    const s = m.get(op.sectionCode) || { section: op.sectionCode, name: ctx.sections.find((x) => x.code === op.sectionCode)?.name, operations: 0, qty: 0, hours: 0, start: null, finish: null };
    s.operations++; s.qty += o.netQty ?? o.requiredQty; s.hours += ((op.hoursPerUnit || 0) + (op.machineHoursPerUnit || 0)) * (o.netQty ?? o.requiredQty);
    if (op.plannedStart && (!s.start || op.plannedStart < s.start)) s.start = op.plannedStart;
    if (op.plannedFinish && (!s.finish || op.plannedFinish > s.finish)) s.finish = op.plannedFinish;
    m.set(op.sectionCode, s);
  }
  return [...m.values()].sort((a, b) => (ctx.sections.findIndex((x) => x.code === a.section)) - (ctx.sections.findIndex((x) => x.code === b.section)));
}

function nextNumber(db, prefix, table, col) {
  const y = new Date().getFullYear();
  const row = db.get(`SELECT ${col} n FROM ${table} WHERE ${col} LIKE ? ORDER BY id DESC LIMIT 1`, `${prefix}-${y}-%`);
  const last = row ? Number(row.n.split('-').pop()) : 0;
  return `${prefix}-${y}-${String(last + 1).padStart(4, '0')}`;
}

function persistPlan(db, r, options) {
  const user = options.user || null;
  return db.tx(() => {
    const version = options.salesRequestId ? (db.get('SELECT COALESCE(MAX(version),0) v FROM plans WHERE sales_request_id = ?', options.salesRequestId).v + 1) : 1;
    const planId = db.run(`INSERT INTO plans(sales_request_id,product_code,qty,version,status,options,start_date,expected_finish,baseline_finish,critical_path,bottleneck,summary,warnings,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, options.salesRequestId || null, r.product.code, r.qty, version, 'PROPOSED', JSON.stringify({ startDate: r.startDate, useInventory: !!options.useInventory, priority: options.priority || 'NORMAL', transferBatch: options.transferBatch ?? null, useMachines: options.useMachines ?? null }),
      r.startDate, r.expectedFinish, r.expectedFinish, JSON.stringify(r.criticalPath), JSON.stringify(r.bottleneck), JSON.stringify(r.summary), JSON.stringify(r.warnings), user?.username || null, nowIso()).lastInsertRowid;
    const poIds = new Map();
    const insPo = db.prep(`INSERT INTO production_orders(number,plan_id,product_code,item_code,item_name,family,class_codes,level,kind,required_qty,inventory_used,net_qty,parent_codes,child_codes,status,planned_start,planned_finish,baseline_start,baseline_finish,priority,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const prio = options.priority === 'URGENT' ? 1 : options.priority === 'HIGH' ? 3 : options.priority === 'LOW' ? 7 : 5;
    for (const o of r.orders) {
      const number = nextNumber(db, 'PO', 'production_orders', 'number');
      const id = insPo.run(number, planId, r.product.code, o.code, o.name, o.family, JSON.stringify([...new Set(o.ops.map((x) => x.classCode).filter(Boolean))]), o.level, o.kind, o.requiredQty, o.inventoryUsed || 0, o.netQty, JSON.stringify([...o.parents.keys()]), '[]', o.netQty <= 0 ? 'COVERED' : 'PLANNED', o.plannedStart, o.plannedFinish, o.plannedStart, o.plannedFinish, prio, nowIso()).lastInsertRowid;
      poIds.set(o.code, id);
    }
    const updChildren = db.prep('UPDATE production_orders SET child_codes = ? WHERE id = ?');
    for (const o of r.orders) updChildren.run(JSON.stringify([...o.children].map(([c, pu]) => ({ code: c, perUnit: pu, poId: poIds.get(c) }))), poIds.get(o.code));
    const insOp = db.prep(`INSERT INTO po_operations(production_order_id,plan_id,seq,work_centre_code,section_code,process,resources,hours_per_unit,machine_hours_per_unit,rate_per_day,rate_source,class_code,machine_minutes,required_qty,planned_start,planned_finish,baseline_start,baseline_finish,status,on_critical_path,wait_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insDay = db.prep('INSERT INTO po_schedule_days(po_operation_id,plan_id,date,planned_qty,is_baseline) VALUES(?,?,?,?,?)');
    for (const o of r.orders) {
      if (o.kind !== 'MAKE' || o.netQty <= 0) continue;
      for (const op of o.ops) {
        if (!op.workCentre) continue;
        const opId = insOp.run(poIds.get(o.code), planId, op.seq, op.workCentre, op.sectionCode, op.processes.filter(Boolean).join('+') || op.process, JSON.stringify(op.resources), op.hoursPerUnit, op.machineHoursPerUnit, op.ratePerDay, op.rateSource, op.classCode, op.machineMinutes ? JSON.stringify(op.machineMinutes) : null, o.netQty, op.plannedStart, op.plannedFinish, op.plannedStart, op.plannedFinish, op.unschedulable ? 'UNSCHEDULED' : 'PLANNED', op.onCriticalPath ? 1 : 0, op.unschedulable ? 'no rate' : null).lastInsertRowid;
        for (const d of op.days || []) { insDay.run(opId, planId, d.date, d.qty, 0); insDay.run(opId, planId, d.date, d.qty, 1); }
      }
    }
    const insMr = db.prep('INSERT INTO material_requirements(plan_id,item_code,name,unit,cost_group,warehouse,qty_per_unit,total_qty,std_unit_cost,current_unit_cost,unit_cost_used,ext_cost,cost_flags,used_by,inventory_available,net_qty) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const costRows = new Map(r.costing.rows.filter((x) => x.kind === 'MATERIAL').map((x) => [x.itemCode, x]));
    // aggregate costing rows per item (same item used by several sub-assemblies)
    const agg = new Map();
    for (const x of r.costing.rows) if (x.kind === 'MATERIAL') { const a = agg.get(x.itemCode) || { unitCost: x.unitCost, source: x.costSource, flags: x.flags, ext: 0 }; a.ext += x.extTotal; agg.set(x.itemCode, a); }
    for (const m of r.materials) { const c = agg.get(m.code) || { unitCost: m.stdUnitCost, flags: '', ext: m.totalQty * (m.stdUnitCost || 0) }; insMr.run(planId, m.code, m.name, m.unit, m.costGroup, m.warehouse, m.qtyPerProduct, m.totalQty, m.stdUnitCost, m.currentUnitCost, c.unitCost, c.ext, c.flags || null, JSON.stringify([...m.usedBy.keys()]), m.inventoryAvailable || 0, m.netQty ?? m.totalQty); }
    void costRows;
    if (options.salesRequestId) db.run('UPDATE sales_requests SET status = ?, plan_id = ?, updated_at = ? WHERE id = ?', 'PLANNED', planId, nowIso(), options.salesRequestId);
    db.audit(user, 'PLAN_PROPOSED', 'plan', planId, { product: r.product.code, qty: r.qty, expectedFinish: r.expectedFinish });
    return { planId, ...r, ctx: undefined };
  });
}

/** Re-simulate an approved plan from `fromDate` using actual completed quantities. Keeps the baseline. */
function reschedulePlan(db, planId, { fromDate, user } = {}) {
  const plan = db.get('SELECT * FROM plans WHERE id = ?', planId);
  if (!plan) throw new Error('Plan not found');
  const ctx = loadContext(db);
  const pos = db.all('SELECT * FROM production_orders WHERE plan_id = ? ORDER BY id', planId);
  const ops = db.all('SELECT * FROM po_operations WHERE plan_id = ? ORDER BY production_order_id, seq', planId);
  const byPo = new Map(); for (const op of ops) { if (!byPo.has(op.production_order_id)) byPo.set(op.production_order_id, []); byPo.get(op.production_order_id).push(op); }
  const root = pos.find((p) => p.level === 0) || pos[0];
  const start = fromDate || today();
  const orders = pos.map((po) => ({ id: `po:${po.id}`, dbId: po.id, planSeq: planId, code: po.item_code, qty: po.net_qty, priority: po.priority, level: po.level, opening: po.inventory_used, isRoot: po.id === root.id, availableFrom: po.kind !== 'MAKE' ? po.planned_finish : null,
    children: JSON.parse(po.child_codes || '[]').filter((c) => c.poId).map((c) => ({ id: `po:${c.poId}`, perUnit: c.perUnit })),
    ops: (byPo.get(po.id) || []).map((op) => ({ id: `op:${op.id}`, dbId: op.id, seq: op.seq, wc: op.work_centre_code, rate: op.rate_per_day || 0, machineMinutes: op.machine_minutes ? JSON.parse(op.machine_minutes) : null, completed: op.completed_qty })) }));
  const existing = loadOpenOrders(db, planId).filter((o) => o.planId < planId); // earlier plans keep precedence
  const resources = Object.fromEntries(ctx.workCentres.map((w) => [w.code, { capacityFactor: w.capacity_factor || 1 }]));
  const machines = Object.fromEntries(ctx.machines.map((m) => [m.code, { minutesPerDay: (m.minutes_per_day || 480) * (m.count || 1) }]));
  const sim = simulate({ startDate: start, calendar: ctx.calendar, resources, machines, orders: [...existing, ...orders], options: { transferBatch: ctx.settings.transferBatch, useMachines: ctx.settings.useMachines, transferLagDays: ctx.settings.transferLagDays, horizonDays: 500 } });
  const simOps = new Map(sim.ops.map((o) => [o.id, o])); const simOrd = new Map(sim.orders.map((o) => [o.id, o]));
  const critical = new Set(sim.criticalPath.filter((c) => String(c.orderId).startsWith('po:')).map((c) => c.opId));
  db.tx(() => {
    db.run('DELETE FROM po_schedule_days WHERE plan_id = ? AND is_baseline = 0 AND date >= ?', planId, sim.startDate);
    const insDay = db.prep('INSERT INTO po_schedule_days(po_operation_id,plan_id,date,planned_qty,is_baseline) VALUES(?,?,?,?,0)');
    for (const o of orders) {
      const so = simOrd.get(o.id);
      const finish = so?.finish === 'done' ? null : so?.finish || null;
      const po = pos.find((p) => p.id === o.dbId);
      const done = po.status === 'COMPLETED' || (o.ops.length && o.ops.every((x) => (x.completed || 0) >= o.qty - 1e-6));
      db.run('UPDATE production_orders SET planned_finish = COALESCE(?, planned_finish), planned_start = COALESCE(planned_start, ?), status = CASE WHEN status IN (\'COMPLETED\',\'CANCELLED\',\'COVERED\') THEN status WHEN ? THEN \'COMPLETED\' WHEN completed_qty > 0 THEN \'IN_PROGRESS\' ELSE status END WHERE id = ?', finish, so?.start || null, done ? 1 : 0, o.dbId);
      for (const op of o.ops) {
        const s = simOps.get(op.id);
        if (!s) continue;
        const fin = s.finish === 'done' ? null : s.finish;
        db.run('UPDATE po_operations SET planned_finish = COALESCE(?, planned_finish), planned_start = COALESCE(planned_start, ?), on_critical_path = ?, wait_reason = ?, status = CASE WHEN status IN (\'COMPLETED\',\'CANCELLED\') THEN status WHEN completed_qty >= required_qty - 1e-6 THEN \'COMPLETED\' WHEN completed_qty > 0 THEN \'IN_PROGRESS\' WHEN ? THEN \'UNSCHEDULED\' ELSE \'PLANNED\' END WHERE id = ?', fin, s.start, critical.has(op.id) ? 1 : 0, s.unschedulable ? 'no rate' : (s.waitCapacity > s.waitInput ? 'capacity' : (s.waitInput > 0 ? 'waiting for input' : null)), s.unschedulable ? 1 : 0, op.dbId);
        for (const d of s.days) insDay.run(op.dbId, planId, d.date, d.qty);
      }
    }
    const rootSim = simOrd.get(`po:${root.id}`);
    let revised = rootSim?.finish && rootSim.finish !== 'done' ? rootSim.finish : null;
    if (!revised) { const fins = orders.map((o) => { const so = simOrd.get(o.id); return so && so.finish !== 'done' ? so.finish : null; }).filter(Boolean).sort(); revised = fins.length ? fins[fins.length - 1] : (db.get('SELECT MAX(date) d FROM daily_reports WHERE plan_id = ?', planId)?.d || plan.expected_finish); }
    const bottleneck = sim.bottleneck ? { ...sim.bottleneck, name: ctx.wcByCode.get(sim.bottleneck.wc)?.name } : null;
    const cp = sim.criticalPath.filter((c) => String(c.orderId).startsWith('po:')).map((c) => ({ ...c, code: c.code, name: ctx.wcByCode.get(c.wc)?.name }));
    const allDone = orders.every((o) => !o.ops.length || o.ops.every((x) => (x.completed || 0) >= o.qty - 1e-6));
    db.run('UPDATE plans SET revised_finish = ?, expected_finish = ?, critical_path = ?, bottleneck = ?, last_rescheduled_at = ?, status = CASE WHEN ? AND status IN (\'APPROVED\',\'IN_PROGRESS\') THEN \'COMPLETED\' WHEN status = \'APPROVED\' AND EXISTS(SELECT 1 FROM daily_reports WHERE plan_id = plans.id) THEN \'IN_PROGRESS\' ELSE status END WHERE id = ?', revised, revised, JSON.stringify(cp), JSON.stringify(bottleneck), nowIso(), allDone ? 1 : 0, planId);
    if (allDone) db.run('UPDATE sales_requests SET status = \'COMPLETED\', updated_at = ? WHERE plan_id = ?', nowIso(), planId);
    db.audit(user, 'PLAN_RESCHEDULED', 'plan', planId, { revisedFinish: revised, baseline: plan.baseline_finish });
  });
  return db.get('SELECT * FROM plans WHERE id = ?', planId);
}

module.exports = { loadContext, productTree, proposePlan, reschedulePlan, unitCostChooser, nextNumber, inventoryAvailable, loadOpenOrders };
