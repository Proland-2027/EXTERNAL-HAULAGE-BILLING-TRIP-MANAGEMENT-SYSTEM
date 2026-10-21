/*
 * bom.js — multi-level BOM tree, explosion, routing derivation and costing. Pure functions over the
 * imported bom_lines rows (one tree per finished product, exactly as the ERP exported it).
 */
'use strict';

const FAMILY_BY_TYPE1 = { CANOPY: 'CANOPY', BASE: 'BASE', PANEL: 'PANEL', ASSEMBLY: 'ASSEMBLY', EXH: 'EXH', DTK: 'DTK' };

/** Build the tree for one product from its bom_lines (sorted by line_no). */
function buildTree(lines) {
  const rows = [...lines].sort((a, b) => a.line_no - b.line_no);
  const root = { line: null, code: null, children: [], processes: [], rates: [], items: [], misc: [] };
  const stack = [];
  let top = null;
  for (const l of rows) {
    const node = { line: l, code: l.item_code, name: l.name, level: l.level, calcType: l.calc_type, children: [], processes: [], rates: [], items: [], misc: [] };
    while (stack.length && stack[stack.length - 1].level >= l.level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : null;
    if (!parent) { top = node; }
    else {
      if (l.calc_type === 'BOM' || l.calc_type === 'Production') parent.children.push(node);
      else if (l.calc_type === 'Item') parent.items.push(node);
      else if (l.calc_type === 'Process') parent.processes.push(node);
      else if (l.calc_type === 'Rate' || l.calc_type === 'Output unit based') parent.rates.push(node);
      else parent.misc.push(node);
    }
    if (l.calc_type === 'BOM' || l.calc_type === 'Production') stack.push(node);
  }
  return top || root;
}

function perUnit(line) { const lot = line.lot_size && line.lot_size > 0 ? line.lot_size : 1; return (line.consumption || 0) / lot; }

/** Component family of a sub-assembly node (which plant line makes it). */
function familyOf(node) {
  const code = (node.code || '').toUpperCase(); const name = (node.name || '').toUpperCase();
  if (/^(SF-SPF|SPF-|OPT-SF-SPF|SFP-SPF)/.test(code) || /ENCLOSURE|CANOPY/.test(name)) return 'CANOPY';
  if (/^(BASE|OPT-BASE|BASEHOOK)/.test(code) || /BASE TANK|BASE FRAME|BASE HOOK/.test(name)) return 'BASE';
  if (/CPNL|RELAY|^BB-|^RB-|^CBB|BRKR|BREAKER/.test(code) || /CONTROL PANEL|RELAY BOX|BREAKER BOX/.test(name)) return 'PANEL';
  if (/^(SFP-FGW|SFP-EY|OPT-SFP|BSC-|SFP-)/.test(code) || /GENSET/.test(name)) return 'GENSET';
  const counts = {};
  for (const it of node.items) { const f = FAMILY_BY_TYPE1[(it.line.type1 || '').toUpperCase().trim()]; if (f) counts[f] = (counts[f] || 0) + 1; }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 'ASSEMBLY';
}

/** Map a process cost group to a work centre using the operation_map rows. */
function mapOperation(costGroup, family, opMap) {
  const cg = (costGroup || '').toUpperCase();
  const cands = opMap.filter((m) => cg.startsWith(m.cost_group_prefix.toUpperCase()));
  if (!cands.length) return null;
  return cands.find((m) => m.family === family) || cands.find((m) => m.family === '*') || cands[0];
}

/** Derive the routing of a sub-assembly node: consecutive processes on the same work centre merge into one operation. */
function routingOf(node, opMap, family) {
  const ops = [];
  for (const p of node.processes) {
    const l = p.line;
    const m = mapOperation(l.cost_group, family, opMap);
    const isMachine = /-M\d?$/.test((l.cost_group || '').toUpperCase()) || /MCH/.test((l.type3 || '').toUpperCase());
    const hrs = perUnit(l);
    const rate = l.consumption ? (l.cost_per_lot || 0) / l.consumption : 0; // cost per hour in the ERP standard
    const last = ops[ops.length - 1];
    if (last && m && last.workCentre === m.work_centre_code) {
      last.resources.push(l.item_code);
      if (isMachine) last.machineHoursPerUnit += hrs; else last.hoursPerUnit += hrs;
      last.stdCostPerUnit += hrs * rate;
      last.processes.push(m.process);
    } else {
      ops.push({ seq: ops.length + 1, workCentre: m ? m.work_centre_code : null, process: m ? m.process : null, costGroup: l.cost_group, operationLabel: l.operation || null,
        resources: [l.item_code], hoursPerUnit: isMachine ? 0 : hrs, machineHoursPerUnit: isMachine ? hrs : 0, stdCostPerUnit: hrs * rate, processes: [m ? m.process : null], unmapped: !m });
    }
  }
  return ops;
}

/**
 * Explode a product tree for `qty` finished units.
 * Returns { orders: [...], materials: [...], rootOrder, unmapped: [...] } where each order is a
 * sub-assembly (aggregated by code across the tree) with its routing and children.
 */
function explode(tree, qty, { opMap = [], includeKits = true } = {}) {
  const orders = new Map();
  const materials = new Map();
  const unmapped = [];
  function visit(node, mult, parentCode, depth) {
    const code = node.code;
    let o = orders.get(code);
    if (!o) {
      const family = node.calcType === 'Production' ? 'GENSET' : familyOf(node);
      const ops = routingOf(node, opMap, family);
      for (const op of ops) if (op.unmapped) unmapped.push({ code, costGroup: op.costGroup, resources: op.resources });
      o = { code, name: node.name, family, level: node.level, calcType: node.calcType, type1: node.line?.type1 || null, warehouse: node.line?.warehouse || null, costGroup: node.line?.cost_group || null,
        qtyPerProduct: 0, requiredQty: 0, parents: new Map(), children: new Map(), ops, kind: ops.length ? 'MAKE' : (node.children.length || node.items.length ? 'SUPPLY' : 'SUPPLY'), occurrences: 0, stdCostPerLot: node.line?.cost_per_lot ?? null, unit: node.line?.unit || 'PCS' };
      orders.set(code, o);
    }
    o.occurrences++;
    o.qtyPerProduct += mult;
    o.requiredQty = o.qtyPerProduct * qty;
    if (parentCode) o.parents.set(parentCode, (o.parents.get(parentCode) || 0) + perUnit(node.line));
    for (const c of node.children) {
      const pu = perUnit(c.line);
      if (pu <= 0) continue;
      o.children.set(c.code, (o.children.get(c.code) || 0) + pu);
      visit(c, mult * pu, code, depth + 1);
    }
    for (const it of node.items) {
      const l = it.line;
      if (l.is_status_item) continue;
      const pu = perUnit(l);
      if (pu <= 0) continue;
      let mat = materials.get(l.item_code);
      if (!mat) { mat = { code: l.item_code, name: l.name, unit: l.unit, costGroup: l.cost_group, warehouse: l.warehouse, qtyPerProduct: 0, totalQty: 0, usedBy: new Map(), stdUnitCost: perUnit(l) > 0 && l.cost_per_lot != null ? l.cost_per_lot / pu : (l.cost_per_unit || 0), currentUnitCost: l.unit_cost || null, type1: l.type1 }; materials.set(l.item_code, mat); }
      mat.qtyPerProduct += mult * pu;
      mat.totalQty = mat.qtyPerProduct * qty;
      mat.usedBy.set(code, (mat.usedBy.get(code) || 0) + mult * pu);
    }
  }
  visit(tree, 1, null, 0);
  return { orders: [...orders.values()], materials: [...materials.values()], rootOrder: orders.get(tree.code), unmapped };
}

/**
 * Costing for one product tree. unitCostFor(itemCode, line) decides which price to use
 * (standard / current / approved). Returns per-component rows plus roll-ups.
 */
function costProduct(tree, qty, { unitCostFor, opMap = [], sectionOf = () => null, labourRateOverride = null, overheadRateOverride = null } = {}) {
  const rows = [];
  const byGroup = new Map(); const bySection = new Map(); const bySub = new Map();
  const tot = { material: 0, materialStd: 0, labour: 0, machine: 0, mfgOverhead: 0, labourOverhead: 0, materialOverhead: 0 };
  const flags = [];
  function add(map, k, v) { map.set(k, (map.get(k) || 0) + v); }
  function visit(node, mult, path) {
    const family = node.calcType === 'Production' ? 'GENSET' : familyOf(node);
    for (const it of node.items) {
      const l = it.line; if (l.is_status_item) continue; const pu = perUnit(l); if (pu <= 0) continue;
      const qpu = mult * pu;
      const std = l.cost_per_lot != null ? l.cost_per_lot / pu : (l.cost_per_unit || 0);
      const chosen = unitCostFor ? unitCostFor(l.item_code, { std, current: l.unit_cost || null }) : { cost: std, source: 'standard', flags: [] };
      const ext = qpu * chosen.cost;
      rows.push({ kind: 'MATERIAL', subAssembly: node.code, subAssemblyName: node.name, path, itemCode: l.item_code, name: l.name, unit: l.unit, costGroup: l.cost_group, qtyPerUnit: qpu, qtyTotal: qpu * qty, stdUnitCost: std, currentUnitCost: l.unit_cost || null, unitCost: chosen.cost, costSource: chosen.source, extPerUnit: ext, extTotal: ext * qty, flags: chosen.flags.join(',') });
      tot.material += ext; tot.materialStd += qpu * std;
      add(byGroup, l.cost_group || 'UNGROUPED', ext); add(bySub, node.code, ext);
      for (const f of chosen.flags) flags.push({ item: l.item_code, name: l.name, flag: f, std, current: l.unit_cost || null });
    }
    for (const p of node.processes) {
      const l = p.line; const hrs = mult * perUnit(l); const isMachine = /-M\d?$/.test((l.cost_group || '').toUpperCase()) || /MCH/.test((l.type3 || '').toUpperCase());
      const stdRate = l.consumption ? (l.cost_per_lot || 0) / l.consumption : 0;
      const m = mapOperation(l.cost_group, family, opMap);
      const wc = m ? m.work_centre_code : null; const sec = sectionOf(wc);
      const rate = isMachine ? (overheadRateOverride?.(wc) ?? stdRate) : (labourRateOverride?.(wc) ?? stdRate);
      const ext = hrs * rate;
      rows.push({ kind: isMachine ? 'MACHINE' : 'LABOUR', subAssembly: node.code, subAssemblyName: node.name, path, itemCode: l.item_code, name: l.name, unit: 'HR', costGroup: l.cost_group, workCentre: wc, section: sec, qtyPerUnit: hrs, qtyTotal: hrs * qty, stdUnitCost: stdRate, unitCost: rate, costSource: rate === stdRate ? 'standard' : 'configured', extPerUnit: ext, extTotal: ext * qty, flags: '' });
      if (isMachine) tot.machine += ext; else tot.labour += ext;
      if (sec) add(bySection, sec, ext);
    }
    for (const r of node.rates) {
      const l = r.line; const units = mult * perUnit(l); const stdRate = l.consumption ? (l.cost_per_lot || 0) / l.consumption : 0; const ext = units * stdRate;
      const cg = (l.cost_group || '').toUpperCase();
      const kind = cg === 'MFGOVH' ? 'MFG_OVERHEAD' : cg === 'LBROVH' ? 'LABOUR_OVERHEAD' : 'MATERIAL_OVERHEAD';
      rows.push({ kind, subAssembly: node.code, subAssemblyName: node.name, path, itemCode: l.item_code, name: l.name, unit: l.unit || 'HR', costGroup: l.cost_group, qtyPerUnit: units, qtyTotal: units * qty, stdUnitCost: stdRate, unitCost: stdRate, costSource: 'standard', extPerUnit: ext, extTotal: ext * qty, flags: '' });
      if (kind === 'MFG_OVERHEAD') tot.mfgOverhead += ext; else if (kind === 'LABOUR_OVERHEAD') tot.labourOverhead += ext; else tot.materialOverhead += ext;
    }
    for (const c of node.children) { const pu = perUnit(c.line); if (pu > 0) visit(c, mult * pu, [...path, c.code]); }
  }
  visit(tree, 1, [tree.code]);
  const perUnitTotals = { ...tot, fullManufacturing: tot.material + tot.labour + tot.machine + tot.mfgOverhead + tot.labourOverhead + tot.materialOverhead };
  const scale = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * qty]));
  return { rows, perUnit: perUnitTotals, total: scale(perUnitTotals), byCostGroup: [...byGroup].map(([k, v]) => ({ costGroup: k, perUnit: v, total: v * qty })).sort((a, b) => b.perUnit - a.perUnit),
    bySection: [...bySection].map(([k, v]) => ({ section: k, perUnit: v, total: v * qty })), bySubAssembly: [...bySub].map(([k, v]) => ({ code: k, perUnit: v, total: v * qty })).sort((a, b) => b.perUnit - a.perUnit), flags, erpStdCost: tree.line?.cost_per_lot ?? null };
}

module.exports = { buildTree, explode, costProduct, routingOf, familyOf, mapOperation, perUnit };
