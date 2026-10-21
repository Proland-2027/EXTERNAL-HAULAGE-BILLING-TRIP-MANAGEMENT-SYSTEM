/* Production Planning - planning engine (browser port of the WordPress plugin classes).
   Masters (products, BOM, prices, sections, capacities, machines, series, stage map) come from
   data/masters.json + data/bom.json; operational state lives in the shared store (see server.js). */
window.JMG = (function () {
  'use strict';
  const E = {};
  const M = { products: {}, productList: [], bom: {}, prices: {}, priceRows: [], sections: {}, caps: {}, capById: {}, machines: {}, series: [], stageMap: {}, issues: [], cutting: [], stageRows: [], importInfo: null };
  E.M = M;
  /* mutable operational state, filled by the store */
  const S = { settings: {}, calendar: {}, priceEdits: {}, capEdits: {}, sectionEdits: {}, overrides: {}, requests: {}, orders: {}, logs: {}, alerts: {}, audit: [] };
  E.S = S;

  E.DEFAULTS = { work_start: '08:00', work_end: '17:00', break_minutes: 60, net_minutes: 480, shifts_per_day: 1, working_days: [1, 2, 3, 4, 5], transfer_rule: 'next_day', capacity_basis: 'current', inventory_enabled: 1, backflush_enabled: 1, allow_negative_stock: 0, default_warehouse: 'MAIN', currency: 'NGN', include_overheads: 1, cost_basis: 'unit_cost', horizon_days: 400, company_name: '', plan_lead_days: 1 };
  E.setting = (k) => (S.settings && S.settings[k] != null ? S.settings[k] : E.DEFAULTS[k]);

  E.loadMasters = function (masters, bom) {
    masters.products.forEach((p) => { const o = { code: p[0], description: p[1], item_type: p[2], category: p[3], model_kva: p[4], series_key: p[5], is_finished: p[6], unit: p[7], cost_group: p[8] }; M.products[o.code] = o; if (o.is_finished) { M.productList.push(o); } });
    M.productList.sort((a, b) => (b.item_type === 'FINISHED') - (a.item_type === 'FINISHED') || a.code.localeCompare(b.code));
    Object.keys(bom).forEach((fc) => { M.bom[fc] = bom[fc].map((r) => ({ parent_code: r[0], component_code: r[1], description: r[2], level: r[3], line_no: r[4], qty: r[5], unit: r[6], calc_type: r[7], type1: r[8], type3: r[9], cost_group: r[10], erp_cost_per_unit: r[11], unit_cost: r[12], line_cost: r[13], rate: r[14] })); });
    masters.prices.forEach((p) => { const o = { code: p[0], description: p[1], price_type: p[2], unit: p[3], cost_group: p[4], unit_cost: p[5], source: p[6], conflict_note: p[7] }; M.prices[o.code] = o; M.priceRows.push(o); });
    masters.sections.forEach((s) => { M.sections[s.id] = Object.assign({}, s, { id: Number(s.id), excel_shifts: Number(s.excel_shifts), minutes_per_day: Number(s.minutes_per_day), machines: Number(s.machines), is_active: Number(s.is_active) }); });
    masters.capacities.forEach((c) => { const o = Object.assign({}, c, { id: Number(c.id), section_id: Number(c.section_id), kva_min: c.kva_min == null ? null : Number(c.kva_min), kva_max: c.kva_max == null ? null : Number(c.kva_max), productivity_per_shift: c.productivity_per_shift == null ? null : Number(c.productivity_per_shift), new_productivity: c.new_productivity == null ? null : Number(c.new_productivity), manual_override: c.manual_override == null ? null : Number(c.manual_override) }); (M.caps[o.section_id] = M.caps[o.section_id] || []).push(o); M.capById[o.id] = o; });
    masters.machine_times.forEach((m) => { (M.machines[m.canopy_series] = M.machines[m.canopy_series] || {})[m.machine] = Number(m.minutes_per_canopy); });
    M.machineRows = masters.machine_times; M.cutting = masters.cutting_files;
    M.series = masters.series.map((s) => Object.assign({}, s, { kva_min: s.kva_min == null ? null : Number(s.kva_min), kva_max: s.kva_max == null ? null : Number(s.kva_max) }));
    masters.stage_map.forEach((m) => { M.stageMap[m.op_prefix + '|' + m.family] = Object.assign({}, m, { sequence: Number(m.sequence), is_scheduled: Number(m.is_scheduled), section_id: m.section_id == null ? null : Number(m.section_id) }); });
    M.stageRows = masters.stage_map; M.issues = masters.data_issues; M.importInfo = masters.import;
  };

  /* ------------------------------------------------------------ helpers */
  const clean = (v) => String(v == null ? '' : v).replace(/ /g, ' ').trim();
  E.today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  E.now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  E.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  E.kvaFromCode = function (code) {
    const c = clean(code).toUpperCase();
    let m = c.match(/(?:P|EY|EM|M|SPG|GP)(\d{2,4}(?:\.\d)?)(?![0-9])/);
    if (m) { const n = parseFloat(m[1]); if (n >= 13 && n <= 2500) { return n; } }
    m = c.match(/(?<![0-9])(\d{2,4}(?:\.\d)?)(?![0-9])/);
    if (m) { const n = parseFloat(m[1]); if (n >= 13 && n <= 2500 && !c.includes('400SRS')) { return n; } }
    return null;
  };
  E.kvaFromComponentCode = function (code) {
    const m = clean(code).toUpperCase().match(/(?<![A-Z0-9])(?:P|EY|EM)(\d{2,4}(?:\.\d)?)(?![0-9])/);
    if (m) { const n = parseFloat(m[1]); if (n >= 13 && n <= 2500) { return n; } }
    return null;
  };
  E.seriesFromCode = function (code) {
    const c = clean(code).toUpperCase();
    if (/400\s*-?\s*S(?:ERIES|RS?)/.test(c)) { return '400SRS'; }
    if (/1300SRS/.test(c)) { return 'P200/P250'; }
    if (/(?<![A-Z0-9])LST|LISTER/.test(c)) { return 'LST'; }
    let m = c.match(/(?<![A-Z0-9])S([1-4])(?:\/S([1-4]))?(?![0-9])/); if (m) { return m[2] ? 'S' + m[1] + ',S' + m[2] : 'S' + m[1]; }
    m = c.match(/(?<![A-Z0-9])F([12])(?![0-9])/); if (m) { return 'S' + m[1]; }
    if (/EM16-20|EY18-22/.test(c)) { return '400SRS'; }
    return '';
  };
  E.family = function (code, cg) {
    const c = code.toUpperCase();
    if (cg === 'SF-BASE') { return 'base'; } if (cg === 'SF-PANEL') { return 'panel'; } if (cg === 'SF-CANOPY') { return 'canopy'; } if (cg === 'SF-EXH') { return 'exhaust'; }
    if (/^(OPT-)?(SFP|BSC)-|^SPG|^MSPG/.test(c)) { return 'genset'; }
    if (/BASE|^BT-|HOOK/.test(c)) { return 'base'; } if (/PNL|RELAY|CBB/.test(c)) { return 'panel'; }
    return 'any';
  };
  E.opPrefix = function (code) { const p = code.toUpperCase().trim().split('-'); return p.length >= 2 ? p[0] + '-' + p[1] : p[0]; };

  /* ------------------------------------------------------------ calendar */
  const Cal = E.Cal = {
    isWorking(d) { const ov = S.calendar[d]; if (ov) { return !!ov.is_working; } const dow = new Date(d + 'T12:00:00Z').getUTCDay(); const iso = dow === 0 ? 7 : dow; return (E.setting('working_days') || [1, 2, 3, 4, 5]).map(Number).includes(iso); },
    addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); },
    nextWorking(d) { let g = 0; while (!Cal.isWorking(d) && g++ < 400) { d = Cal.addDays(d, 1); } return d; },
    addWorkingDays(d, n) { d = Cal.nextWorking(d); while (n > 0) { d = Cal.nextWorking(Cal.addDays(d, 1)); n--; } return d; },
    workingDaysBetween(a, b) { if (!a || !b || b < a) { return 0; } let n = 0, d = a, g = 0; while (d <= b && g++ < 2000) { if (Cal.isWorking(d)) { n++; } d = Cal.addDays(d, 1); } return n; },
  };

  /* ------------------------------------------------------------ prices */
  E.priceOf = function (code) {
    if (S.priceEdits[code] !== undefined) { return S.priceEdits[code] === null ? null : Number(S.priceEdits[code]); }
    const p = M.prices[code]; return p && p.unit_cost != null ? Number(p.unit_cost) : null;
  };

  /* ------------------------------------------------------------ BOM */
  const BOM = E.BOM = {
    rowsByParent(fc) { const by = {}; (M.bom[fc] || []).forEach((r) => { if (r.level === 0) { return; } (by[r.parent_code] = by[r.parent_code] || []).push(r); }); return by; },
    root(fc) { return (M.bom[fc] || []).find((r) => r.level === 0) || null; },
    explode(fc, qty, inventory) {
      qty = Number(qty) || 1; inventory = inventory || {};
      const by = BOM.rowsByParent(fc); const root = BOM.root(fc); const product = M.products[fc] || null;
      const issues = []; const components = []; const visited = {};
      if (!root || !by[fc]) { issues.push('No BOM rows found for ' + fc + '.'); }
      const tree = BOM.walk(fc, fc, 1, 0, by, components, issues, visited, qty, inventory);
      Object.assign(tree, { code: fc, description: product ? product.description : (root ? root.description : ''), kind: 'finished', qty_per_unit: 1, total_qty: qty, qty_to_make: qty, level: 0, family: 'genset', cost_group: root ? root.cost_group : '', unit: root ? root.unit : 'PCS' });
      return { root: tree, product, components, issues };
    },
    walk(fin, parent, mult, level, by, components, issues, visited, qty, inventory) {
      const node = { children: [], ops: [], materials: [], overheads: [] };
      if (!by[parent]) { return node; }
      if (level > 12) { issues.push('BOM deeper than 12 levels at ' + parent); return node; }
      by[parent].forEach((r) => {
        const calc = r.calc_type, code = r.component_code, q = Number(r.qty) || 0;
        if (r.type1 === 'STATUS ITEM') { return; }
        if (calc === 'Process') { node.ops.push({ code, prefix: E.opPrefix(code), hours: q, type3: r.type3, description: r.description, rate: r.rate, cost_group: r.cost_group }); return; }
        if (calc === 'Rate' || calc === 'Output unit based') { node.overheads.push({ code, qty: q, type3: r.type3, rate: r.rate, line_cost: r.line_cost, description: r.description, calc }); return; }
        const per = mult * q;
        const child = { code, description: r.description, parent, level: r.level, qty_per_parent: q, qty_per_unit: per, total_qty: per * qty, unit: r.unit, cost_group: r.cost_group, family: E.family(code, r.cost_group), unit_cost: r.unit_cost, erp_cost: r.erp_cost_per_unit, kind: 'material', children: [], ops: [], materials: [], overheads: [] };
        if (calc === 'BOM') {
          const key = parent + '>' + code; if (visited[key]) { return; } visited[key] = true;
          // stock allocated to the sub-assembly needs neither materials nor operations: explode the balance only
          const avail = Number(inventory[code] || 0); const inv = Math.min(avail, child.total_qty); if (inv > 0) { inventory[code] = avail - inv; }
          child.inventory_qty = inv; child.qty_to_make = Math.max(0, child.total_qty - inv);
          const subQty = child.total_qty > 0 ? qty * child.qty_to_make / child.total_qty : qty;
          const sub = BOM.walk(fin, code, per, level + 1, by, components, issues, visited, subQty, inventory);
          Object.assign(child, { children: sub.children, ops: sub.ops, materials: sub.materials, overheads: sub.overheads });
          if (!by[code]) { child.kind = 'purchased_assembly'; child.bom_incomplete = 1; issues.push('Sub-assembly ' + code + ' (' + r.description + ') has no component rows in the BOM; treated as a purchased/kitted item and flagged for the administrator.'); }
          else { child.kind = sub.ops.length ? 'assembly' : 'purchased_assembly'; }
          components.push(BOM.strip(child)); node.children.push(child);
        } else { node.materials.push(child); components.push(BOM.strip(child)); }
      });
      return node;
    },
    strip(n) { const o = Object.assign({}, n); delete o.children; delete o.materials; delete o.overheads; delete o.ops; o.has_ops = n.ops.length > 0; o.op_count = n.ops.length; return o; },
    costRollup(fc, qty) {
      qty = Number(qty) || 1;
      const ex = BOM.explode(fc, 1); const inc = Number(E.setting('include_overheads')); const basis = E.setting('cost_basis');
      const tot = { material: 0, labor: 0, machine: 0, overhead: 0, pending_items: [], lines: [], assemblies: [], basis };
      BOM.costNode(ex.root, 1, tot, inc, basis);
      tot.total = tot.material + tot.labor + tot.machine + (inc ? tot.overhead : 0);
      tot.pending_items = [...new Set(tot.pending_items)]; tot.pending_count = tot.pending_items.length;
      tot.cost_status = tot.pending_count ? 'Cost Pending' : 'Costed';
      const root = BOM.root(fc); tot.erp_total = root ? Number(root.erp_cost_per_unit) : null; tot.qty = qty; tot.order_total = tot.total * qty; tot.issues = ex.issues;
      return tot;
    },
    costNode(node, mult, tot, inc, basis) {
      const asm = { code: node.code, description: node.description || '', level: node.level || 0, parent: node.parent || '', qty_per_unit: mult, material: 0, labor: 0, machine: 0, overhead: 0, pending: 0, kind: node.kind || 'assembly' };
      node.materials.forEach((m) => {
        let price = E.priceOf(m.code);
        if (basis === 'erp') { price = (m.erp_cost != null && m.qty_per_parent > 0) ? Number(m.erp_cost) / m.qty_per_parent : null; }
        const line = { code: m.code, description: m.description, parent: m.parent, level: m.level, qty_per_parent: m.qty_per_parent, qty_per_unit: m.qty_per_unit, unit: m.unit, unit_cost: price, ext_cost: null, kind: 'material', cost_group: m.cost_group };
        if (price == null) { tot.pending_items.push(m.code); asm.pending++; } else { line.ext_cost = m.qty_per_unit * price; tot.material += line.ext_cost; asm.material += line.ext_cost; }
        tot.lines.push(line);
      });
      node.ops.forEach((op) => {
        const hours = op.hours * mult; let rate = E.priceOf(op.code); if (rate == null && op.rate != null) { rate = Number(op.rate); }
        const kind = op.type3 === 'MCH OVH' ? 'machine' : 'labor';
        const line = { code: op.code, description: op.description, parent: node.code, level: (node.level || 0) + 1, qty_per_parent: op.hours, qty_per_unit: hours, unit: 'HR', unit_cost: rate, ext_cost: null, kind, cost_group: op.cost_group };
        if (rate == null) { tot.pending_items.push(op.code); asm.pending++; } else { line.ext_cost = hours * rate; tot[kind] += line.ext_cost; asm[kind] += line.ext_cost; }
        tot.lines.push(line);
      });
      node.overheads.forEach((oh) => {
        let amt;
        if (oh.calc === 'Output unit based') { amt = (oh.line_cost != null ? Number(oh.line_cost) : 0) * mult; }
        else { let rate = E.priceOf(oh.code); if (rate == null) { rate = oh.rate != null ? Number(oh.rate) : 0; } amt = oh.qty * mult * rate; }
        tot.overhead += amt; asm.overhead += amt;
        tot.lines.push({ code: oh.code, description: oh.description, parent: node.code, level: (node.level || 0) + 1, qty_per_parent: oh.qty, qty_per_unit: oh.qty * mult, unit: oh.calc === 'Output unit based' ? 'UNIT' : 'HR', unit_cost: null, ext_cost: amt, kind: 'overhead', cost_group: oh.type3 });
      });
      node.children.forEach((ch) => { const sub = BOM.costNode(ch, ch.qty_per_unit, tot, inc, basis); asm.material += sub.material; asm.labor += sub.labor; asm.machine += sub.machine; asm.overhead += sub.overhead; asm.pending += sub.pending; });
      asm.total = asm.material + asm.labor + asm.machine + (inc ? asm.overhead : 0);
      tot.assemblies.push(asm);
      return asm;
    },
    slimTree(n) {
      const out = { code: n.code || '', description: n.description || '', kind: n.kind || '', qty_per_parent: n.qty_per_parent == null ? 1 : n.qty_per_parent, qty_per_unit: n.qty_per_unit == null ? 1 : n.qty_per_unit, total_qty: n.total_qty, unit: n.unit || '', cost_group: n.cost_group || '', level: n.level || 0, family: n.family || '', bom_incomplete: n.bom_incomplete || 0, materials: [], ops: [], children: [] };
      n.materials.forEach((m) => out.materials.push({ code: m.code, description: m.description, qty_per_parent: m.qty_per_parent, qty_per_unit: m.qty_per_unit, total_qty: m.total_qty, unit: m.unit, cost_group: m.cost_group, unit_cost: m.unit_cost }));
      n.ops.forEach((o) => out.ops.push({ code: o.code, description: o.description, hours: o.hours, type3: o.type3, rate: o.rate }));
      n.children.forEach((c) => out.children.push(BOM.slimTree(c)));
      return out;
    },
  };

  /* ------------------------------------------------------------ routing */
  const R = E.Routing = {
    section(id) { const s = M.sections[id]; if (!s) { return null; } return Object.assign({}, s, S.sectionEdits[id] || {}); },
    sectionsAll() { return Object.keys(M.sections).map((id) => R.section(Number(id))); },
    cap(c) { return Object.assign({}, c, S.capEdits[c.id] || {}); },
    seriesForKva(kva) { if (kva == null) { return null; } return M.series.find((s) => s.kva_min != null && s.kva_max != null && kva >= s.kva_min && kva <= s.kva_max) || null; },
    seriesForToken(token) {
      if (!token) { return null; }
      for (const t of token.split(',')) { const tt = t.trim(); const direct = M.series.find((s) => s.series_key === tt); if (direct) { return direct; } for (const s of M.series) { if (s.aliases.toUpperCase().split(',').map((x) => x.trim()).includes(tt.toUpperCase())) { return s; } } }
      return null;
    },
    seriesOverlap(a, b) {
      const aa = a.toUpperCase().split(',').map((x) => x.trim()), bb = b.toUpperCase().split(',').map((x) => x.trim());
      for (const x of aa) { if (!x) { continue; } if (bb.includes(x)) { return true; } const rec = R.seriesForToken(x); if (rec) { const al = rec.aliases.toUpperCase().split(',').map((y) => y.trim()); for (const y of bb) { if (al.includes(y) || y === rec.series_key.toUpperCase()) { return true; } } } }
      return false;
    },
    productivity(cap) {
      if (cap.manual_override != null && cap.manual_override > 0) { return cap.manual_override; }
      const basis = E.setting('capacity_basis'); const cur = cap.productivity_per_shift, nw = cap.new_productivity;
      if (basis === 'new') { return (nw != null && nw > 0) ? nw : cur; }
      return (cur != null && cur > 0) ? cur : null;
    },
    resourceMinutesPerDay(key) {
      const shifts = Math.max(1, Number(E.setting('shifts_per_day')) || 1);
      if (key.startsWith('section:')) { const s = R.section(Number(key.slice(8))); if (!s) { return 0; } return Number(s.minutes_per_day) * Math.max(1, Number(s.machines) || 1) * shifts; }
      return (Number(E.setting('net_minutes')) || 480) * shifts;
    },
    build(ex, qty) {
      const product = ex.product; const kva = product && product.model_kva != null ? Number(product.model_kva) : E.kvaFromCode(ex.root.code);
      const ops = [], warnings = [];
      R.buildNode(ex.root, kva, qty, ops, warnings, true);
      ops.sort((a, b) => (b.level - a.level) || a.component_code.localeCompare(b.component_code) || (a.sequence - b.sequence));
      return { ops, warnings };
    },
    buildNode(node, kva, qty, ops, warnings, isRoot) {
      let childLast = [];
      node.children.forEach((ch) => { if (ch.kind !== 'assembly') { return; } const last = R.buildNode(ch, kva, qty, ops, warnings, false); last.forEach((l) => childLast.push({ uid: l, ratio: Number(ch.qty_per_parent) })); });
      if (!node.ops.length) { return childLast; }
      const family = isRoot ? 'genset' : node.family; const code = node.code;
      const compKva = isRoot ? kva : (E.kvaFromComponentCode(code) || kva); const compSeries = E.seriesFromCode(code);
      const stages = {};
      node.ops.forEach((op) => {
        const map = M.stageMap[op.prefix + '|' + family] || M.stageMap[op.prefix + '|any'];
        if (!map) { warnings.push('No workflow stage mapped for operation ' + op.code + ' on ' + code + '; operation not scheduled.'); return; }
        const k = map.stage_key; if (!stages[k]) { stages[k] = { map, labor_hours: 0, machine_hours: 0, codes: [] }; }
        if (op.type3 === 'MCH OVH') { stages[k].machine_hours += op.hours; } else { stages[k].labor_hours += op.hours; }
        stages[k].codes.push(op.code);
      });
      const list = Object.entries(stages).sort((a, b) => a[1].map.sequence - b[1].map.sequence);
      const q = Number(node.qty_to_make != null ? node.qty_to_make : node.total_qty);
      let prev = null, first = true;
      list.forEach(([skey, st]) => {
        const map = st.map; const uid = ops.length + 1;
        const res = R.resolveCapacity(map, code, compSeries, compKva, kva);
        const op = { uid, component_code: code, component_desc: node.description || '', level: node.level || 0, stage_key: skey, stage_name: map.stage_name, workflow_group: map.workflow_group, department: map.department, sequence: map.sequence, qty_planned: q, qty_completed: 0, bom_hours_per_unit: Math.round(st.labor_hours * 1e4) / 1e4, op_codes: st.codes, section_id: res.section_id, section_name: res.section_name, capacity_id: res.capacity_id, capacity_match: res.match, capacity_note: res.note, minutes_per_unit: res.minutes_per_unit, machines: res.machines, is_scheduled: !!map.is_scheduled && res.minutes_per_unit != null, predecessors: [], site: res.site };
        if (!map.is_scheduled) { op.capacity_match = 'unscheduled'; op.capacity_note = 'No productivity figures in the workbook for this operation; it is listed for information and does not consume capacity.'; }
        else if (res.minutes_per_unit == null) { warnings.push(code + ' / ' + map.stage_name + ': ' + res.note); }
        else if (res.match === 'approx') { warnings.push(code + ' / ' + map.stage_name + ': ' + res.note); }
        if (first) { childLast.forEach((cl) => op.predecessors.push(cl)); first = false; } else if (prev != null) { op.predecessors.push({ uid: prev, ratio: 1 }); }
        ops.push(op); if (op.is_scheduled) { prev = uid; }
      });
      if (prev == null) { return childLast; }
      return [prev];
    },
    resolveCapacity(map, code, compSeries, compKva, productKva) {
      const out = { section_id: null, section_name: '', capacity_id: null, match: 'missing', note: '', minutes_per_unit: null, machines: [], site: '' };
      const stageKey = map.stage_key;
      const candidates = [];
      if (map.section_id && M.sections[map.section_id]) { candidates.push(map.section_id); }
      R.sectionsAll().forEach((s) => { if (s.stage_key === stageKey && !candidates.includes(s.id)) { candidates.push(s.id); } });
      if (!candidates.length) { out.note = 'No production section in the workbook is mapped to stage "' + map.stage_name + '".'; return out; }
      const ov = S.overrides[code + '|' + stageKey] || null;
      let best = null; const productSeries = R.seriesForKva(productKva); const compSeriesRec = R.seriesForToken(compSeries);
      candidates.forEach((sid) => {
        const section = R.section(sid); if (!section || !Number(section.is_active)) { return; }
        (M.caps[sid] || []).forEach((c0) => {
          const cap = R.cap(c0); let score = null, how = '';
          if (ov && ov.capacity_id && Number(ov.capacity_id) === cap.id) { score = 100; how = 'override'; }
          else if (compSeries && cap.series_key && R.seriesOverlap(compSeries, cap.series_key)) { score = 90; how = 'series'; }
          else if (compKva != null && cap.kva_min != null && compKva >= cap.kva_min && compKva <= cap.kva_max) { score = 80; how = 'kva'; }
          else if (productSeries && cap.series_key && R.seriesOverlap(productSeries.series_key, cap.series_key)) { score = 70; how = 'product series'; }
          else if (compSeriesRec && cap.kva_min != null && compSeriesRec.kva_min != null && cap.kva_max >= compSeriesRec.kva_min && cap.kva_min <= compSeriesRec.kva_max) { score = 60; how = 'series kVA band'; }
          else if (productKva != null && cap.kva_min != null && productKva >= cap.kva_min && productKva <= cap.kva_max) { score = 50; how = 'product kVA'; }
          if (score != null && (!best || score > best[0])) { best = [score, cap, section, how]; }
        });
      });
      let approx = false;
      if (!best) {
        const kv = compKva != null ? compKva : productKva;
        if (kv != null) {
          let nearest = null;
          candidates.forEach((sid) => { (M.caps[sid] || []).forEach((c0) => { const cap = R.cap(c0); if (cap.kva_min == null) { return; } const d = cap.kva_min >= kv ? cap.kva_min - kv : 10000 + (kv - cap.kva_max); if (!nearest || d < nearest[0]) { nearest = [d, cap, R.section(sid)]; } }); });
          if (nearest) { best = [10, nearest[1], nearest[2], 'nearest size class']; approx = true; }
        }
      }
      if (!best) { const s = R.section(candidates[0]); out.section_id = s.id; out.section_name = s.section_name; out.site = s.site; out.note = 'Section "' + s.section_name + '" has no productivity row for ' + code + (compKva != null ? ' (' + compKva + ' kVA)' : '') + '. Add a capacity row or an override.'; return out; }
      const [, cap, section, how] = best;
      out.section_id = section.id; out.section_name = section.section_name; out.capacity_id = cap.id; out.site = section.site;
      out.match = approx ? 'approx' : (how === 'override' ? 'override' : 'exact');
      const prod = R.productivity(cap); let mpu = null;
      if (ov && ov.minutes_per_unit != null && Number(ov.minutes_per_unit) > 0) { mpu = Number(ov.minutes_per_unit); out.match = 'override'; out.note = 'Manual override: ' + mpu + ' min/unit.'; }
      else if (prod == null || prod <= 0) { out.note = 'Workbook productivity for ' + cap.type_code + ' in "' + section.section_name + '" is 0/blank; enter a value in Masters > Capacities.'; out.match = 'missing'; }
      else {
        const perShift = prod / Math.max(1, Number(section.excel_shifts)); mpu = Number(section.minutes_per_day) / perShift;
        out.note = section.sheet_source + ' row "' + cap.type_code + '": ' + (Math.round(prod * 100) / 100) + '/' + (Number(section.excel_shifts) > 1 ? section.excel_shifts + ' shifts' : 'shift') + (E.setting('capacity_basis') === 'new' ? ' (new productivity)' : '') + ' -> ' + mpu.toFixed(1) + ' min per unit (matched by ' + how + ').';
        if (approx) { out.note = 'ASSUMPTION - ' + out.note + ' No exact size class for ' + code + '; nearest class used. Add an override to correct.'; }
      }
      out.minutes_per_unit = mpu == null ? null : Math.round(mpu * 1e4) / 1e4;
      if (map.machine_group && mpu != null) {
        const ser = compSeriesRec || productSeries; const cut = ser ? ser.canopy_cut_series : '';
        if (cut && M.machines[cut]) { Object.entries(M.machines[cut]).forEach(([machine, mins]) => out.machines.push({ resource_key: 'machine:' + machine, name: machine, minutes_per_unit: mins, series: cut })); }
        else { out.note += ' No machine cutting times (Punch 1 / Punch 2 / Plasma) in the Cutting Capacity sheet for this canopy series; machine constraint not applied.'; }
      }
      return out;
    },
  };

  /* ------------------------------------------------------------ scheduler */
  const Sched = E.Sched = {
    resourceName(key) { if (key.startsWith('section:')) { const s = R.section(Number(key.slice(8))); return s ? s.section_name + ' (' + s.site + ')' : 'Section #' + key.slice(8); } return key.replace('machine:', '') + ' (cutting machine)'; },
    loadCommitted(excludeId, from) {
      const loads = {};
      Object.values(S.orders).forEach((o) => {
        if (o.id === excludeId || !['CONFIRMED', 'IN_PROGRESS'].includes(o.status) || !o.loads) { return; }
        Object.entries(o.loads).forEach(([k, days]) => { Object.entries(days).forEach(([d, m]) => { if (d < from) { return; } (loads[k] = loads[k] || {})[d] = (loads[k][d] || 0) + m; }); });
      });
      return loads;
    },
    schedule(opsIn, startDate, loads, opts) {
      opts = opts || {};
      const transfer = opts.transfer_rule || E.setting('transfer_rule'); const horizon = Number(opts.horizon_days || E.setting('horizon_days'));
      const ops = opsIn.slice().sort((a, b) => a.uid - b.uid); const byUid = {}; ops.forEach((op, i) => { byUid[op.uid] = i; });
      const remaining = [], cum = [], alloc = [], limited = {}, own = {};
      ops.forEach((op, i) => {
        const done = Number(op.qty_completed || 0); cum[i] = done;
        remaining[i] = op.is_scheduled ? Math.max(0, Number(op.qty_planned) - done) : 0; alloc[i] = {};
        op.planned_start = null; op.planned_end = null;
        if (!op.is_scheduled) { op.status = 'UNSCHEDULED'; } else if (remaining[i] <= 0.0005) { op.status = 'COMPLETED'; remaining[i] = 0; } else { op.status = done > 0 ? 'IN_PROGRESS' : 'PENDING'; }
      });
      let day = Cal.nextWorking(startDate); const endLimit = Cal.addDays(startDate, horizon); const allocations = []; let guard = 0;
      const sum = () => remaining.reduce((a, b) => a + b, 0);
      while (sum() > 0.0005 && day <= endLimit && guard++ < 5000) {
        if (!Cal.isWorking(day)) { day = Cal.addDays(day, 1); continue; }
        const snapshot = cum.slice(), snapRem = remaining.slice(); const free = {};
        ops.forEach((op, i) => {
          if (remaining[i] <= 0.0005) { return; }
          if (op.earliest_start && day < op.earliest_start) { return; }
          let avail = remaining[i];
          op.predecessors.forEach((p) => {
            const pi = byUid[p.uid]; if (pi == null) { return; } const ratio = Number(p.ratio) > 0 ? Number(p.ratio) : 1; let predCum;
            if (transfer === 'full_lot') { predCum = snapRem[pi] <= 0.0005 ? snapshot[pi] : 0; } else if (transfer === 'same_day') { predCum = cum[pi]; } else { predCum = snapshot[pi]; }
            avail = Math.min(avail, predCum / ratio - cum[i]);
          });
          if (avail <= 0.0005) { return; }
          const resources = [{ resource_key: 'section:' + op.section_id, minutes_per_unit: Number(op.minutes_per_unit) }].concat((op.machines || []).map((m) => ({ resource_key: m.resource_key, minutes_per_unit: Number(m.minutes_per_unit) })));
          let cap = avail, binding = null;
          resources.forEach((r) => { const k = r.resource_key; if (free[k] == null) { free[k] = R.resourceMinutesPerDay(k) - ((loads[k] && loads[k][day]) || 0); } const mpu = r.minutes_per_unit; if (mpu <= 0) { return; } const c = Math.max(0, free[k]) / mpu; if (c < cap) { cap = c; binding = k; } });
          const q = Math.floor(Math.min(avail, cap, remaining[i]) * 1000) / 1000;
          if (q < 0.001) { if (binding && avail > 0.001) { limited[binding] = (limited[binding] || 0) + 1; } return; }
          if (binding && q < Math.min(avail, remaining[i]) - 0.0005) { limited[binding] = (limited[binding] || 0) + 1; }
          resources.forEach((r) => { const k = r.resource_key; const mins = q * r.minutes_per_unit; free[k] -= mins; (loads[k] = loads[k] || {})[day] = (loads[k][day] || 0) + mins; own[k] = (own[k] || 0) + mins; allocations.push({ op_uid: op.uid, resource_key: k, section_id: k.startsWith('section:') ? op.section_id : null, sched_date: day, qty: k.startsWith('section:') ? q : 0, minutes: Math.round(mins * 1000) / 1000 }); });
          alloc[i][day] = q; cum[i] += q; remaining[i] -= q;
          if (op.planned_start == null) { op.planned_start = day; } op.planned_end = day;
        });
        day = Cal.addDays(day, 1);
      }
      const warnings = [], unfinished = [];
      ops.forEach((op, i) => { op.daily = alloc[i]; if (remaining[i] > 0.0005) { unfinished.push(op.component_code + ' / ' + op.stage_name); } if (op.is_scheduled && op.status !== 'COMPLETED' && op.planned_start == null && remaining[i] > 0.0005) { op.status = 'BLOCKED'; } });
      if (unfinished.length) { warnings.push('Horizon of ' + horizon + ' days exceeded; not fully scheduled: ' + unfinished.slice(0, 6).join(', ') + (unfinished.length > 6 ? ' ...' : '')); }
      let end = null, start = null;
      ops.forEach((op) => { if (op.planned_end && (!end || op.planned_end > end)) { end = op.planned_end; } if (op.planned_start && (!start || op.planned_start < start)) { start = op.planned_start; } });
      let bottleneck = null; const lim = Object.entries(limited).sort((a, b) => b[1] - a[1]);
      if (lim.length) { const [k, days] = lim[0]; bottleneck = { resource_key: k, name: Sched.resourceName(k), limited_days: days, minutes: Math.round(own[k] || 0), daily_capacity: R.resourceMinutesPerDay(k) }; }
      const span = (start && end) ? Cal.workingDaysBetween(start, end) : 0;
      const util = Object.entries(own).map(([k, mins]) => { const capd = R.resourceMinutesPerDay(k); return { resource_key: k, name: Sched.resourceName(k), minutes: Math.round(mins), daily_capacity: capd, span_days: span, utilisation_pct: capd > 0 && span > 0 ? Math.round(1000 * mins / (capd * span)) / 10 : null, limited_days: limited[k] || 0 }; });
      util.sort((a, b) => (b.limited_days - a.limited_days) || (b.minutes - a.minutes));
      return { ops, allocations, start, end, bottleneck, utilisation: util, warnings, lead_time_days: span };
    },
  };
  return E;
})();
