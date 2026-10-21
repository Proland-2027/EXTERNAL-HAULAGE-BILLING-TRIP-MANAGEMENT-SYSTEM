/* Production Planning - in-browser service layer: orders, tracking, reports, store sync and the
   request router that replaces the WordPress REST API in the hosted demo. */
window.JMG_SERVER = (function () {
  'use strict';
  const E = window.JMG; const S = E.S; const M = E.M; const Cal = E.Cal; const BOM = E.BOM; const R = E.Routing; const Sched = E.Sched;
  const Srv = { ready: false, user: { id: null, name: '', isOwner: false, canWrite: null }, role: 'jmg_planner', listeners: [] };
  const ROLES = {
    administrator: { name: 'Administrator', caps: ['jmg_view', 'jmg_sales', 'jmg_plan', 'jmg_track', 'jmg_manage', 'jmg_cost', 'jmg_stock', 'jmg_admin'] },
    jmg_sales: { name: 'Sales', caps: ['jmg_view', 'jmg_sales'] },
    jmg_planner: { name: 'Production Planner', caps: ['jmg_view', 'jmg_sales', 'jmg_plan', 'jmg_track', 'jmg_stock'] },
    jmg_supervisor: { name: 'Section Supervisor', caps: ['jmg_view', 'jmg_track'] },
    jmg_manager: { name: 'Production Manager', caps: ['jmg_view', 'jmg_plan', 'jmg_track', 'jmg_manage', 'jmg_stock'] },
    jmg_costing: { name: 'Costing / Finance', caps: ['jmg_view', 'jmg_cost'] },
    jmg_store: { name: 'Store Keeper', caps: ['jmg_view', 'jmg_stock'] },
  };
  Srv.ROLES = ROLES;
  const err = (msg, code) => { const e = new Error(msg); e.code = code || 'jmg_error'; return e; };

  /* ------------------------------------------------------------ store (db capability or local fallback) */
  const store = { db: null, local: false };
  const LS_KEY = 'jmg-pp-demo-store';
  function localLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; } }
  function localSave(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } }
  const COLLECTIONS = ['requests', 'orders', 'logs', 'alerts', 'roles', 'stock'];
  const SETTING_DOCS = ['main', 'calendar', 'prices', 'capacities', 'sections', 'overrides', 'counters'];
  function applySettingDoc(id, data) {
    data = data || {};
    if (id === 'main') { S.settings = data; } else if (id === 'calendar') { S.calendar = data.overrides || {}; } else if (id === 'prices') { S.priceEdits = data.edits || {}; }
    else if (id === 'capacities') { S.capEdits = data.edits || {}; } else if (id === 'sections') { S.sectionEdits = data.edits || {}; } else if (id === 'overrides') { S.overrides = data.items || {}; } else if (id === 'counters') { S.counters = data; }
  }
  function notify() { Srv.listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } }); }
  Srv.onChange = (fn) => { Srv.listeners.push(fn); };

  async function writeDoc(coll, id, data) {
    if (store.db) { await store.db.collection(coll).doc(id).set(JSON.parse(JSON.stringify(data))); }
    else { const d = localLoad(); (d[coll] = d[coll] || {})[id] = JSON.parse(JSON.stringify(data)); localSave(d); }
  }
  async function deleteDoc(coll, id) {
    if (store.db) { await store.db.collection(coll).doc(id).delete(); }
    else { const d = localLoad(); if (d[coll]) { delete d[coll][id]; } localSave(d); }
  }
  async function saveSetting(id) {
    const data = id === 'main' ? S.settings : id === 'calendar' ? { overrides: S.calendar } : id === 'prices' ? { edits: S.priceEdits } : id === 'capacities' ? { edits: S.capEdits } : id === 'sections' ? { edits: S.sectionEdits } : id === 'overrides' ? { items: S.overrides } : S.counters || {};
    await writeDoc('settings', id, data);
  }
  const saveRequest = (r) => { S.requests[r.id] = r; return writeDoc('requests', r.id, r); };
  const saveOrder = (o) => { S.orders[o.id] = o; return writeDoc('orders', o.id, o); };
  const saveLog = (l) => { S.logs[l.id] = l; return writeDoc('logs', l.id, l); };
  const saveAlert = (a) => { S.alerts[a.id] = a; return writeDoc('alerts', a.id, a); };

  Srv.init = async function () {
    let db = null, user = null;
    try { if (window.claude && window.claude.use) { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); } } catch (e) { db = null; }
    if (user) { try { const me = await user.me(); Srv.user = { id: me.id, name: me.name || '', isOwner: me.isOwner, canWrite: await user.can('data.write') }; } catch (e) { /* ignore */ } }
    store.db = db; store.local = !db;
    if (db) {
      await new Promise((resolve) => {
        let pending = COLLECTIONS.length + 1; const done = () => { if (--pending === 0) { resolve(); } };
        const errFn = (e) => { console.warn('db subscription error', e); done(); };
        db.collection('settings').onSnapshot((snap) => { SETTING_DOCS.forEach((id) => applySettingDoc(id, {})); snap.docs.forEach((d) => applySettingDoc(d.id, d.data())); if (pending > 0) { done(); } notify(); }, errFn);
        COLLECTIONS.forEach((c) => {
          db.collection(c).onSnapshot((snap) => { S[c] = {}; snap.docs.forEach((d) => { S[c][d.id] = d.data(); }); if (pending > 0) { done(); } notify(); }, errFn);
        });
        setTimeout(() => { if (pending > 0) { pending = 0; resolve(); } }, 12000);
      });
    } else {
      const d = localLoad();
      SETTING_DOCS.forEach((id) => applySettingDoc(id, (d.settings || {})[id] || {}));
      COLLECTIONS.forEach((c) => { S[c] = d[c] || {}; });
    }
    S.roles = S.roles || {};
    // role: owner is administrator; an assigned role wins; otherwise the viewer's own choice (demo mode)
    let saved = null; try { saved = localStorage.getItem('jmg-pp-role'); } catch (e) { /* ignore */ }
    const assigned = Srv.user.id && S.roles[Srv.user.id] ? S.roles[Srv.user.id].role : null;
    Srv.role = assigned || (Srv.user.isOwner ? 'administrator' : (saved && ROLES[saved] ? saved : 'jmg_planner'));
    Srv.roleAssigned = !!assigned;
    Srv.ready = true;
  };
  Srv.setRole = function (role) { if (!ROLES[role]) { return; } Srv.role = role; try { localStorage.setItem('jmg-pp-role', role); } catch (e) { /* ignore */ } };
  const caps = () => ROLES[Srv.role].caps;
  const can = (c) => caps().includes(c);
  const need = (c) => { if (!can(c)) { throw err('Your current role (' + ROLES[Srv.role].name + ') cannot do this.', 'jmg_forbidden'); } };
  function audit(action, entity, entityId, details) {
    const a = { id: E.uid(), user_login: Srv.user.name || (Srv.user.isOwner ? 'owner' : 'viewer'), role: Srv.role, action, entity, entity_id: String(entityId == null ? '' : entityId), details: details == null ? '' : JSON.stringify(details).slice(0, 500), created_at: E.now() };
    S.audit = S.audit || []; S.audit.unshift(a);
    const log = S.alerts; void log; // audit entries are kept in the settings/audit document (bounded)
    S.auditDoc = (S.auditDoc || []).concat([a]).slice(-400);
    writeDoc('settings', 'audit', { items: S.auditDoc }).catch(() => {});
  }

  /* ------------------------------------------------------------ inventory (stock ledger in the shared store)
     Every movement is a transaction row; rows are stored in small batch documents (one per manual posting,
     one per daily log for backflush) so a production log never needs dozens of store writes. */
  const INV_TYPES = ['RECEIPT', 'ISSUE', 'PRODUCTION', 'ADJUSTMENT', 'COUNT', 'TRANSFER', 'RETURN'];
  const r4 = (v) => Math.round(Number(v) * 10000) / 10000;
  const fmtQ = (v) => String(Math.round(Number(v) * 100) / 100);
  const Inv = {
    defaultWarehouse: () => String(E.setting('default_warehouse') || 'MAIN'),
    itemWarehouse: (code) => { const p = M.products[code]; return (p && p.warehouse) || Inv.defaultWarehouse(); },
    txns() { const out = []; Object.values(S.stock || {}).forEach((b) => { (b.txns || []).forEach((t) => out.push(t)); }); return out; },
    warehouses() { const set = new Set([Inv.defaultWarehouse()]); Inv.txns().forEach((t) => { if (t.warehouse) { set.add(t.warehouse); } }); return [...set].sort(); },
    onHandMap() { const m = {}; Inv.txns().forEach((t) => { const w = m[t.item_code] = m[t.item_code] || {}; w[t.warehouse] = r4((w[t.warehouse] || 0) + Number(t.qty)); }); return m; },
    onHand(code, wh) { let s = 0; Inv.txns().forEach((t) => { if (t.item_code === code && (!wh || t.warehouse === wh)) { s += Number(t.qty); } }); return r4(s); },
    sumWh: (whs) => r4(Object.values(whs || {}).reduce((a, b) => a + Number(b), 0)),
    /** quantity claimed by other open orders: external allocation + own production received, less what was issued */
    reservedMap(excludeOrderId) {
      const m = {};
      Object.values(S.orders).forEach((o) => { if (!['CONFIRMED', 'IN_PROGRESS'].includes(o.status) || o.id === excludeOrderId) { return; } (o.components || []).forEach((c) => { const claim = Number(c.inventory_qty || 0) + Number(c.qty_received || 0) - Number(c.qty_issued || 0); if (claim > 0) { m[c.component_code] = r4((m[c.component_code] || 0) + claim); } }); });
      return m;
    },
    availabilityMap(excludeOrderId) {
      const oh = Inv.onHandMap(); const res = Inv.reservedMap(excludeOrderId); const out = {};
      Object.entries(oh).forEach(([code, whs]) => { const a = Inv.sumWh(whs) - (res[code] || 0); if (a > 0.0005) { out[code] = r4(a); } });
      return out;
    },
    balances(f) {
      f = f || {}; const oh = Inv.onHandMap(); const res = Inv.reservedMap(null);
      const codes = new Set(Object.keys(oh)); Object.keys(res).forEach((c) => codes.add(c));
      const out = [];
      [...codes].sort().forEach((code) => {
        const whs = oh[code] || {}; const tot = Inv.sumWh(whs); const p = M.products[code] || { description: '', item_type: '', unit: '', cost_group: '' }; const price = E.priceOf(code);
        const row = { code, description: p.description, item_type: p.item_type, unit: p.unit, cost_group: p.cost_group, warehouses: whs, on_hand: tot, reserved: res[code] || 0, available: r4(tot - (res[code] || 0)), unit_cost: price, value: price == null ? null : Math.round(tot * price * 100) / 100 };
        if (f.q && !(code + ' ' + p.description + ' ' + p.cost_group).toLowerCase().includes(String(f.q).toLowerCase())) { return; }
        if (f.warehouse && whs[f.warehouse] === undefined) { return; }
        if (f.type && p.item_type !== f.type) { return; }
        if (f.negative && row.available >= 0) { return; }
        out.push(row);
      });
      return out;
    },
    ledger(f) {
      f = f || {}; let list = Inv.txns();
      if (f.item) { list = list.filter((t) => t.item_code === f.item); }
      if (f.warehouse) { list = list.filter((t) => t.warehouse === f.warehouse); }
      if (f.type) { list = list.filter((t) => t.txn_type === f.type); }
      if (f.order_id) { list = list.filter((t) => t.order_id === f.order_id); }
      if (f.from) { list = list.filter((t) => t.txn_date >= f.from); } if (f.to) { list = list.filter((t) => t.txn_date <= f.to); }
      if (f.q) { const q = String(f.q).toLowerCase(); list = list.filter((t) => (t.item_code + ' ' + t.description + ' ' + t.reference).toLowerCase().includes(q)); }
      return list.sort((a, b) => b.txn_date.localeCompare(a.txn_date) || b.created_at.localeCompare(a.created_at) || (b.seq - a.seq)).slice(0, Number(f.limit) || 500);
    },
    /** Build (and validate) the transaction rows of a posting without writing them. */
    build(d, system) {
      const type = String(d.txn_type || '').trim().toUpperCase();
      if (!INV_TYPES.includes(type)) { throw err('Unknown transaction type ' + type); }
      const code = String(d.item_code || '').replace(/ /g, ' ').trim();
      if (!code) { throw err('Item code is required.'); }
      const product = M.products[code] || null;
      if (!product && !system) { throw err('Unknown item code ' + code + '. Add it to the product master first.'); }
      const wh = String(d.warehouse || '').trim() || Inv.itemWarehouse(code);
      const date = d.txn_date || E.today(); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { throw err('Invalid date.'); }
      let qty = Number(d.qty) || 0;
      if (type === 'COUNT') { qty = r4((Number(d.counted_qty) || 0) - Inv.onHand(code, wh)); if (Math.abs(qty) < 0.00005) { throw err('Counted quantity equals stock on hand; nothing to adjust.'); } }
      else if (type === 'ADJUSTMENT') { if (!qty) { throw err('Quantity is required (positive to add, negative to remove).'); } }
      else { if (qty <= 0) { throw err('Quantity must be greater than zero.'); } if (type === 'ISSUE' || type === 'TRANSFER') { qty = -qty; } }
      if ((type === 'ISSUE' || type === 'TRANSFER') && !system && !Number(E.setting('allow_negative_stock'))) { const oh = Inv.onHand(code, wh); if (oh + qty < -0.00005) { throw err('Only ' + fmtQ(oh) + ' of ' + code + ' on hand in ' + wh + '; cannot issue ' + fmtQ(-qty) + '. Enable negative stock in Settings or receive stock first.'); } }
      const unitCost = (d.unit_cost !== undefined && d.unit_cost !== '' && d.unit_cost !== null) ? Number(d.unit_cost) : E.priceOf(code);
      const row = { id: E.uid(), txn_date: date, item_code: code, description: product ? product.description : String(d.description || ''), warehouse: wh, txn_type: type, qty: r4(qty), unit: product ? product.unit : String(d.unit || ''), unit_cost: unitCost == null ? null : unitCost, reference: String(d.reference || '').slice(0, 120), order_id: d.order_id || null, order_no: d.order_no || '', op_id: d.op_id || null, log_id: d.log_id || null, reason: String(d.reason || '').slice(0, 255), is_system: system ? 1 : 0, created_by: Srv.user.name || (Srv.user.isOwner ? 'owner' : 'viewer'), created_at: E.now() };
      const rows = [row];
      if (type === 'TRANSFER') { const to = String(d.to_warehouse || '').trim(); if (!to || to === wh) { throw err('A different destination warehouse is required for a transfer.'); } rows.push(Object.assign({}, row, { id: E.uid(), warehouse: to, qty: r4(-qty), reason: ('Transfer from ' + wh + '. ' + row.reason).trim() })); row.to_warehouse = to; }
      return rows;
    },
    async writeBatch(rows, extra) {
      const id = E.uid(); let seq = 0; rows.forEach((r) => { r.batch_id = id; r.seq = ++seq; });
      const doc = Object.assign({ id, txns: rows, created_at: E.now() }, extra || {});
      S.stock = S.stock || {}; S.stock[id] = doc; await writeDoc('stock', id, doc); return doc;
    },
    async post(d, system) {
      if (!system) { need('jmg_stock'); }
      const rows = Inv.build(d, system); await Inv.writeBatch(rows, {});
      if (!system) { audit('stock_' + rows[0].txn_type.toLowerCase(), 'stock', rows[0].item_code, { qty: rows[0].qty, warehouse: rows[0].warehouse, reference: rows[0].reference }); }
      return rows[0];
    },
    async reverse(id) {
      need('jmg_stock'); const t = Inv.txns().find((x) => x.id === id); if (!t) { throw err('Transaction not found', 'jmg_404'); }
      if (t.is_system) { throw err('Movements generated by production tracking are reversed by undoing the daily log.'); }
      const rev = Object.assign({}, t, { id: E.uid(), qty: r4(-t.qty), reason: ('Reversal of ' + t.txn_type + ' ' + t.txn_date + '. ' + t.reason).trim(), created_at: E.now(), created_by: Srv.user.name || 'viewer' }); delete rev.batch_id; delete rev.seq;
      await Inv.writeBatch([rev], {}); audit('stock_reverse', 'stock', t.item_code, { txn: id }); return { id: rev.id };
    },
    /** Backflush for a daily log: at the component's final scheduled stage, receive the good units and issue what they consumed. */
    async backflush(order, op, good, rejected, date, logId) {
      if (!Number(E.setting('inventory_enabled')) || !Number(E.setting('backflush_enabled'))) { return []; }
      let last = null; (order.ops || []).forEach((x) => { if (x.component_code === op.component_code && x.is_scheduled) { last = last == null ? x.sequence : Math.max(last, x.sequence); } });
      if (last == null || Number(op.sequence) !== Number(last)) { return []; }
      const rows = []; const consumed = good + rejected; const ref = 'Log ' + logId.slice(0, 6) + ' ' + op.stage_name; const comps = order.components || [];
      if (good > 0) {
        rows.push(...Inv.build({ txn_type: 'PRODUCTION', item_code: op.component_code, qty: good, txn_date: date, reference: ref, order_id: order.id, order_no: order.order_no, op_id: op.id, log_id: logId, reason: 'Completed at ' + op.section_name }, true));
        comps.forEach((c) => { if (c.component_code === op.component_code) { c.qty_received = r4(Number(c.qty_received || 0) + good); } });
      }
      if (consumed > 0) {
        (BOM.rowsByParent(order.product_code)[op.component_code] || []).forEach((b) => {
          if (!['Item', 'BOM'].includes(b.calc_type) || b.type1 === 'STATUS ITEM') { return; }
          const q = r4(Number(b.qty) * consumed); if (q <= 0) { return; }
          rows.push(...Inv.build({ txn_type: 'ISSUE', item_code: b.component_code, qty: q, txn_date: date, reference: ref, order_id: order.id, order_no: order.order_no, op_id: op.id, log_id: logId, reason: 'Backflush for ' + op.component_code, description: b.description, unit: b.unit }, true));
          comps.forEach((c) => { if (c.component_code === b.component_code && c.parent_code === op.component_code) { c.qty_issued = r4(Number(c.qty_issued || 0) + q); } });
        });
      }
      if (rows.length) { await Inv.writeBatch(rows, { log_id: logId, order_id: order.id }); }
      return rows;
    },
    async reverseLog(logId, order) {
      let n = 0;
      for (const b of Object.values(S.stock || {})) {
        if (b.log_id !== logId) { continue; }
        (b.txns || []).forEach((t) => { n++; (order && order.components || []).forEach((c) => { if (c.component_code !== t.item_code) { return; } if (t.txn_type === 'PRODUCTION') { c.qty_received = Math.max(0, r4(Number(c.qty_received || 0) - t.qty)); } else if (t.txn_type === 'ISSUE') { c.qty_issued = Math.max(0, r4(Number(c.qty_issued || 0) + t.qty)); } }); });
        delete S.stock[b.id]; await deleteDoc('stock', b.id);
      }
      return n;
    },
    shortages(f) {
      f = f || {}; const oh = Inv.onHandMap(); const items = {};
      Object.values(S.orders).filter((o) => ['CONFIRMED', 'IN_PROGRESS'].includes(o.status)).sort((a, b) => String(a.planned_start || '').localeCompare(String(b.planned_start || ''))).forEach((o) => {
        (o.components || []).forEach((c) => {
          if (!['material', 'purchased_assembly'].includes(c.comp_kind)) { return; }
          const code = c.component_code; const it = items[code] = items[code] || { code, description: c.description, unit: c.unit, cost_group: c.cost_group, required: 0, allocated: 0, issued: 0, shortage: 0, on_hand: Inv.sumWh(oh[code]), unit_cost: c.unit_cost, orders: [], needed_by: null };
          const short = Math.max(0, r4(Number(c.total_qty) - Number(c.inventory_qty || 0)));
          it.required = r4(it.required + Number(c.total_qty)); it.allocated = r4(it.allocated + Number(c.inventory_qty || 0)); it.issued = r4(it.issued + Number(c.qty_issued || 0)); it.shortage = r4(it.shortage + short);
          it.orders.push({ order_no: o.order_no, order_id: o.id, required: Number(c.total_qty), allocated: Number(c.inventory_qty || 0), issued: Number(c.qty_issued || 0), shortage: short, needed_by: o.planned_start });
          if (short > 0 && (it.needed_by == null || (o.planned_start && o.planned_start < it.needed_by))) { it.needed_by = o.planned_start; }
        });
      });
      let out = Object.values(items).map((it) => Object.assign(it, { purchase_value: it.unit_cost == null ? null : Math.round(it.shortage * it.unit_cost * 100) / 100 }));
      if (f.shortage_only) { out = out.filter((i) => i.shortage > 0.0005); }
      return out.sort((a, b) => (b.shortage - a.shortage) || a.code.localeCompare(b.code));
    },
    valuation() {
      const rows = Inv.balances({}); const by = {}; let total = 0, pending = 0;
      rows.forEach((r) => { const k = r.item_type || 'OTHER'; const t = by[k] = by[k] || { item_type: k, items: 0, qty: 0, value: 0, unpriced: 0 }; t.items++; t.qty = r4(t.qty + r.on_hand); if (r.value == null) { t.unpriced++; pending++; } else { t.value = Math.round((t.value + r.value) * 100) / 100; total += r.value; } });
      return { total_value: Math.round(total * 100) / 100, unpriced_items: pending, by_type: Object.values(by), items: rows.length };
    },
    item(code) {
      const oh = Inv.onHandMap(); const res = Inv.reservedMap(null); const p = M.products[code] || null;
      const usedIn = []; Object.values(S.orders).filter((o) => ['CONFIRMED', 'IN_PROGRESS', 'DRAFT'].includes(o.status)).sort((a, b) => b.created_at.localeCompare(a.created_at)).forEach((o) => { (o.components || []).forEach((c) => { if (c.component_code === code) { usedIn.push({ order_id: o.id, order_no: o.order_no, status: o.status, total_qty: c.total_qty, inventory_qty: c.inventory_qty || 0, qty_issued: c.qty_issued || 0, qty_received: c.qty_received || 0 }); } }); });
      return { product: p ? Object.assign({ warehouse: Inv.itemWarehouse(code) }, p) : null, warehouses: oh[code] || {}, on_hand: Inv.sumWh(oh[code]), reserved: res[code] || 0, ledger: Inv.ledger({ item: code, limit: 300 }), used_in: usedIn.slice(0, 50) };
    },
  };
  Srv.Inv = Inv;

  /* ------------------------------------------------------------ numbering */
  function nextNumber(prefix) {
    const year = E.today().slice(0, 4); const coll = prefix === 'SR' ? S.requests : S.orders; const key = prefix === 'SR' ? 'request_no' : 'order_no';
    let max = 0; Object.values(coll).forEach((x) => { const v = x[key] || ''; if (v.startsWith(prefix + '-' + year + '-')) { max = Math.max(max, parseInt(v.slice(v.lastIndexOf('-') + 1), 10) || 0); } });
    return prefix + '-' + year + '-' + String(max + 1).padStart(4, '0');
  }
  const PRIO = { Critical: 0, Urgent: 1, Normal: 2 };

  /* ------------------------------------------------------------ requests */
  async function createRequest(d) {
    need('jmg_sales');
    const p = M.products[d.product_code]; if (!p) { throw err('Unknown product code ' + d.product_code); }
    const r = { id: E.uid(), request_no: nextNumber('SR'), sales_ref: d.sales_ref || '', customer: d.customer || '', product_code: p.code, description: p.description, category: p.category || 'Genset', qty: Math.max(0.01, Number(d.qty) || 1), requested_date: d.requested_date || null, priority: ['Normal', 'Urgent', 'Critical'].includes(d.priority) ? d.priority : 'Normal', status: 'NEW', instructions: d.instructions || '', requested_by: d.requested_by || Srv.user.name || 'Sales', created_by: Srv.user.id, created_at: E.now(), updated_at: E.now() };
    await saveRequest(r); audit('request_create', 'request', r.request_no, { product: r.product_code, qty: r.qty });
    return r;
  }
  async function updateRequest(id, d) {
    need('jmg_sales'); const r = S.requests[id]; if (!r) { throw err('Request not found', 'jmg_404'); }
    ['sales_ref', 'customer', 'instructions', 'requested_by'].forEach((k) => { if (d[k] !== undefined) { r[k] = d[k]; } });
    if (d.requested_date !== undefined) { r.requested_date = d.requested_date || null; }
    if (['Normal', 'Urgent', 'Critical'].includes(d.priority)) { r.priority = d.priority; }
    if (['NEW', 'PLANNED'].includes(r.status)) { if (d.qty !== undefined) { r.qty = Math.max(0.01, Number(d.qty)); } if (d.product_code && M.products[d.product_code]) { const p = M.products[d.product_code]; r.product_code = p.code; r.description = p.description; r.category = p.category; } }
    if (['CANCELLED', 'REJECTED'].includes(d.status) && can('jmg_plan')) { r.status = d.status; }
    r.updated_at = E.now(); await saveRequest(r); audit('request_update', 'request', r.request_no, d); return r;
  }
  function listRequests(f) {
    f = f || {};
    let list = Object.values(S.requests);
    if (f.status) { list = list.filter((r) => r.status === f.status); }
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter((r) => [r.request_no, r.customer, r.product_code, r.sales_ref].join(' ').toLowerCase().includes(q)); }
    list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return list.map((r) => { const o = Object.values(S.orders).filter((x) => x.request_id === r.id && x.status !== 'CANCELLED').sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]; return Object.assign({}, r, { order_no: o ? o.order_no : null, order_id: o ? o.id : null, planned_end: o ? o.planned_end : null, forecast_end: o ? o.forecast_end : null, order_status: o ? o.status : null }); });
  }

  /* ------------------------------------------------------------ orders */
  function isDelayed(o) { if (['CANCELLED', 'DRAFT'].includes(o.status)) { return false; } const end = o.actual_end || o.forecast_end; if (!end) { return false; } if (o.baseline_end && end > o.baseline_end) { return true; } if (o.requested_date && end > o.requested_date) { return true; } return false; }
  async function addAlert(order, type, severity, audience, message) {
    if (Object.values(S.alerts).some((a) => a.order_id === order.id && a.alert_type === type && a.message === message && !a.is_ack)) { return; }
    for (const a of Object.values(S.alerts)) { if (a.order_id === order.id && a.alert_type === type && !a.is_ack) { a.is_ack = 1; a.ack_by = 'superseded'; await saveAlert(a); } }
    await saveAlert({ id: E.uid(), order_id: order.id, order_no: order.order_no, alert_type: type, severity, audience, message, is_ack: 0, ack_by: null, created_at: E.now() });
  }
  async function checkDelayAlerts(o) {
    if (!o || !o.forecast_end) { return; }
    if (o.baseline_end && o.forecast_end > o.baseline_end) { const days = Cal.workingDaysBetween(o.baseline_end, o.forecast_end) - 1; await addAlert(o, 'delay', 'serious', 'planning,management', 'Forecast completion ' + o.forecast_end + ' is ' + days + ' working day(s) later than the confirmed baseline ' + o.baseline_end + '.'); }
    if (o.requested_date && o.forecast_end > o.requested_date) { await addAlert(o, 'delivery_risk', 'warning', 'sales,planning', 'Forecast completion ' + o.forecast_end + ' is later than the Sales requested delivery date ' + o.requested_date + '.'); }
  }
  async function generate(args) {
    need('jmg_plan');
    let req = null;
    if (args.request_id) {
      req = S.requests[args.request_id]; if (!req) { throw err('Request not found', 'jmg_404'); }
      if (!['NEW', 'PLANNED'].includes(req.status)) { throw err('Request ' + req.request_no + ' is already ' + req.status); }
      for (const o of Object.values(S.orders)) { if (o.request_id === req.id && o.status === 'DRAFT') { await deleteOrder(o.id); } }
    }
    const code = req ? req.product_code : args.product_code; const p = M.products[code]; if (!p) { throw err('Unknown product ' + code); }
    const qty = req ? Number(req.qty) : Math.max(0.01, Number(args.qty) || 1);
    const start = args.plan_start || Cal.addWorkingDays(E.today(), Number(E.setting('plan_lead_days')) || 1);
    const o = { id: E.uid(), order_no: nextNumber('PO'), request_id: req ? req.id : null, product_code: p.code, description: p.description, category: p.category || 'Genset', qty, priority: req ? req.priority : (args.priority || 'Normal'), status: 'DRAFT', requested_date: req ? req.requested_date : (args.requested_date || null), plan_start: start, transfer_rule: args.transfer_rule || '', customer: req ? req.customer : (args.customer || ''), sales_ref: req ? req.sales_ref : (args.sales_ref || ''), notes: args.notes || (req ? req.instructions : ''), created_by: Srv.user.id, created_at: E.now(), updated_at: E.now(), qty_completed: 0, ops: [], components: [], loads: {} };
    S.orders[o.id] = o;
    if (req) { req.status = 'PLANNED'; req.updated_at = E.now(); await saveRequest(req); }
    audit('order_generate', 'order', o.order_no, { product: o.product_code, qty });
    planOrder(o, {});
    await saveOrder(o);
    return getOrder(o.id);
  }
  async function deleteOrder(id) {
    const o = S.orders[id]; if (!o) { return; }
    for (const l of Object.values(S.logs)) { if (l.order_id === id) { await deleteDoc('logs', l.id); delete S.logs[l.id]; } }
    for (const a of Object.values(S.alerts)) { if (a.order_id === id) { await deleteDoc('alerts', a.id); delete S.alerts[a.id]; } }
    for (const b of Object.values(S.stock || {})) { if (b.order_id === id) { await deleteDoc('stock', b.id); delete S.stock[b.id]; } }
    delete S.orders[id]; await deleteDoc('orders', id);
  }
  /** (Re)plan an order in memory (caller saves). */
  function planOrder(o, opts) {
    opts = opts || {};
    const qty = Number(o.qty); const invOn = Number(E.setting('inventory_enabled')); let inventory = {};
    // previous allocations consumed by production are kept across re-plans
    const prev = {}; (o.components || []).forEach((c) => { prev[c.component_code + '|' + c.parent_code] = c; });
    if (invOn) {
      inventory = Inv.availabilityMap(o.id);
      // units this order produced itself are in stock for its own parent stages: exclude them from external
      // allocation, and never allocate more external stock than is still to be produced
      const totals = {}; BOM.explode(o.product_code, qty).components.forEach((c0) => { if (c0.kind === 'assembly') { totals[c0.code] = (totals[c0.code] || 0) + Number(c0.total_qty); } });
      Object.values(prev).forEach((pc) => { const code = pc.component_code; const own = Math.max(0, Number(pc.qty_received || 0) - Number(pc.qty_issued || 0)); if (own > 0 && inventory[code] != null) { inventory[code] = Math.max(0, inventory[code] - own); } if (totals[code] != null && inventory[code] != null) { inventory[code] = Math.min(inventory[code], Math.max(0, totals[code] - Number(pc.qty_received || 0))); } });
    }
    const ex = BOM.explode(o.product_code, qty, inventory); const built = R.build(ex, qty); let warnings = ex.issues.concat(built.warnings);
    const existing = {}; (o.ops || []).forEach((e) => { existing[e.component_code + '|' + e.stage_key] = e; });
    const ops = built.ops;
    ops.forEach((op) => {
      const e = existing[op.component_code + '|' + op.stage_key]; if (!e) { return; }
      Object.assign(op, { id: e.id, qty_completed: Number(e.qty_completed || 0), qty_rejected: Number(e.qty_rejected || 0), qty_rework: Number(e.qty_rework || 0), actual_start: e.actual_start || null, actual_end: e.actual_end || null, baseline_start: e.baseline_start || null, baseline_end: e.baseline_end || null, earliest_start: e.earliest_start || null, manual_minutes: e.manual_minutes == null ? null : e.manual_minutes, manual_section_id: e.manual_section_id || null });
      if (e.manual_minutes != null && Number(e.manual_minutes) > 0) { op.minutes_per_unit = Number(e.manual_minutes); op.is_scheduled = true; op.capacity_match = 'manual'; op.capacity_note = 'Planner override: ' + Number(e.manual_minutes) + ' minutes per unit.'; }
      if (e.manual_section_id) { const sec = R.section(Number(e.manual_section_id)); if (sec) { op.section_id = sec.id; op.section_name = sec.section_name; op.site = sec.site; op.capacity_note += ' Section reassigned by planner.'; } }
    });
    let start = o.plan_start || E.today();
    if (opts.from && opts.from > start) { start = opts.from; }
    const confirmed = ['CONFIRMED', 'IN_PROGRESS'].includes(o.status);
    if (confirmed) {
      let lastLog = null; Object.values(S.logs).forEach((l) => { if (l.order_id === o.id && (!lastLog || l.log_date > lastLog)) { lastLog = l.log_date; } });
      const today = E.today();
      if (lastLog && Cal.addDays(lastLog, 1) > start) { start = Cal.addDays(lastLog, 1); }
      if (today > start) { start = today; }
    }
    const loads = Sched.loadCommitted(o.id, start);
    const sopts = {}; if (o.transfer_rule) { sopts.transfer_rule = o.transfer_rule; }
    const res = Sched.schedule(ops, start, loads, sopts); warnings = warnings.concat(res.warnings);
    // components
    const opsByComp = {}; res.ops.forEach((op) => { (opsByComp[op.component_code] = opsByComp[op.component_code] || []).push(op); });
    o.components = ex.components.map((c) => {
      const price = E.priceOf(c.code); const d = {}; (opsByComp[c.code] || []).forEach((x) => { if (x.section_name) { d[x.section_name] = 1; } });
      const pc = prev[c.code + '|' + c.parent]; const issued = pc ? Number(pc.qty_issued || 0) : 0; const received = pc ? Number(pc.qty_received || 0) : 0;
      let invQty, toMake;
      if (c.kind === 'material' || c.kind === 'purchased_assembly') {
        // allocate available stock to purchased items (issued quantities are already out of stock); the balance is to purchase
        const needQ = Math.max(0, Number(c.total_qty) - issued); const avail = Number(inventory[c.code] || 0); const alloc = invOn ? Math.min(avail, needQ) : 0;
        if (alloc > 0) { inventory[c.code] = avail - alloc; }
        invQty = r4(alloc + issued); toMake = Math.max(0, r4(Number(c.total_qty) - invQty));
      } else { invQty = Math.max(Number(c.inventory_qty || 0), Math.min(issued, Number(c.total_qty))); toMake = c.qty_to_make != null ? c.qty_to_make : c.total_qty; }
      return { component_code: c.code, description: c.description, parent_code: c.parent, level: c.level, qty_per_parent: c.qty_per_parent, qty_per_unit: c.qty_per_unit, total_qty: c.total_qty, inventory_qty: invQty, qty_to_make: toMake, qty_issued: issued, qty_received: received, unit: c.unit, comp_kind: c.kind, cost_group: c.cost_group, department: Object.keys(d).join(', '), unit_cost: price, ext_cost: price == null ? null : Math.round(price * c.total_qty * 100) / 100, cost_pending: (c.kind === 'material' && price == null) ? 1 : 0, status: 'PENDING' };
    });
    // ops (stable ids)
    let n = 0; (o.ops || []).forEach((e) => { const m = String(e.id || '').match(/-(\d+)$/); if (m) { n = Math.max(n, parseInt(m[1], 10)); } });
    const uidToId = {};
    const newOps = res.ops.map((op) => {
      if (!op.id) { op.id = o.order_no + '-' + (++n); }
      uidToId[op.uid] = op.id;
      const row = { id: op.id, uid: op.uid, order_id: o.id, order_no: o.order_no, component_code: op.component_code, component_desc: op.component_desc, stage_key: op.stage_key, stage_name: op.stage_name, workflow_group: op.workflow_group, department: op.department, section_id: op.section_id, section_name: op.section_name, capacity_id: op.capacity_id, capacity_match: op.capacity_match, capacity_note: String(op.capacity_note || '').slice(0, 255), sequence: op.sequence, level: op.level, qty_planned: op.qty_planned, qty_completed: op.qty_completed || 0, qty_rejected: op.qty_rejected || 0, qty_rework: op.qty_rework || 0, minutes_per_unit: op.minutes_per_unit, bom_hours_per_unit: op.bom_hours_per_unit, machines: op.machines, op_codes: op.op_codes.join(','), site: op.site, earliest_start: op.earliest_start || null, manual_minutes: op.manual_minutes == null ? null : op.manual_minutes, manual_section_id: op.manual_section_id || null, is_scheduled: op.is_scheduled ? 1 : 0, daily: op.daily, planned_start: op.planned_start, planned_end: op.planned_end, actual_start: op.actual_start || null, actual_end: op.actual_end || null, status: op.status, predecessors_uid: op.predecessors };
      if (confirmed) { row.baseline_start = op.baseline_start || op.planned_start; row.baseline_end = op.baseline_end || op.planned_end; } else { row.baseline_start = op.planned_start; row.baseline_end = op.planned_end; }
      return row;
    });
    newOps.forEach((row) => { row.predecessors = row.predecessors_uid.map((p) => ({ id: uidToId[p.uid], ratio: p.ratio })).filter((p) => p.id); delete row.predecessors_uid; });
    o.ops = newOps;
    // loads of this order (planned minutes per resource per day)
    const loadsOwn = {}; res.allocations.forEach((a) => { (loadsOwn[a.resource_key] = loadsOwn[a.resource_key] || {})[a.sched_date] = Math.round(((loadsOwn[a.resource_key][a.sched_date] || 0) + a.minutes) * 100) / 100; }); o.loads = loadsOwn;
    // cost
    const cost = BOM.costRollup(o.product_code, qty);
    const anyScheduled = res.ops.some((op) => op.is_scheduled); const allDone = anyScheduled && res.ops.filter((op) => op.is_scheduled).every((op) => op.status === 'COMPLETED');
    if (!anyScheduled) { warnings.push('No operation of this product could be capacity-scheduled; check the stage map and capacity rows.'); }
    Object.assign(o, { planned_start: res.start || start, planned_end: res.end, forecast_end: res.end, lead_time_days: res.lead_time_days, bottleneck: res.bottleneck ? res.bottleneck.name : '', planned_cost: cost.order_total, cost_status: cost.cost_status, schedule: { bottleneck: res.bottleneck, utilisation: res.utilisation, start_used: start, cost: { material: cost.material, labor: cost.labor, machine: cost.machine, overhead: cost.overhead, total: cost.total, pending: cost.pending_count, erp_total: cost.erp_total, basis: cost.basis } }, warnings: [...new Set(warnings)], updated_at: E.now() });
    if (!confirmed) { o.baseline_start = o.planned_start; o.baseline_end = res.end; }
    if (confirmed && allDone) { o.status = 'COMPLETED'; o.actual_end = o.actual_end || E.today(); }
    return o;
  }
  async function confirmOrder(id) {
    need('jmg_plan'); const o = S.orders[id]; if (!o) { throw err('Order not found', 'jmg_404'); }
    if (o.status !== 'DRAFT') { throw err('Only draft plans can be confirmed.'); }
    planOrder(o, {});
    o.status = 'CONFIRMED'; o.baseline_start = o.planned_start; o.baseline_end = o.planned_end; o.confirmed_by = Srv.user.id; o.confirmed_at = E.now(); o.updated_at = E.now();
    o.ops.forEach((op) => { op.baseline_start = op.planned_start; op.baseline_end = op.planned_end; });
    await saveOrder(o);
    const req = o.request_id ? S.requests[o.request_id] : null; if (req) { req.status = 'CONFIRMED'; req.updated_at = E.now(); await saveRequest(req); }
    audit('order_confirm', 'order', o.order_no, { planned_end: o.planned_end, requested_date: o.requested_date });
    if (o.requested_date && o.planned_end && o.planned_end > o.requested_date) { await addAlert(o, 'delivery_risk', 'warning', 'sales,planning', 'Committed completion ' + o.planned_end + ' is later than the Sales requested date ' + o.requested_date + ' (' + (Cal.workingDaysBetween(o.requested_date, o.planned_end) - 1) + ' working days).'); }
    if (Number(E.setting('inventory_enabled'))) { const short = o.components.filter((c) => ['material', 'purchased_assembly'].includes(c.comp_kind) && Number(c.total_qty) > Number(c.inventory_qty || 0) + 0.0005); if (short.length) { await addAlert(o, 'material_shortage', 'warning', 'planning,purchasing', short.length + ' purchased item(s) are not covered by available stock (e.g. ' + short[0].component_code + ': ' + fmtQ(Number(short[0].total_qty) - Number(short[0].inventory_qty || 0)) + ' short). See Inventory > Shortages & purchase list.'); } }
    return getOrder(id);
  }
  async function cancelOrder(id, reason) {
    need('jmg_plan'); const o = S.orders[id]; if (!o) { throw err('Order not found', 'jmg_404'); }
    o.status = 'CANCELLED'; o.notes = ((o.notes || '') + '\nCancelled: ' + (reason || '')).trim(); o.loads = {}; o.updated_at = E.now(); await saveOrder(o);
    const req = o.request_id ? S.requests[o.request_id] : null; if (req) { req.status = 'NEW'; await saveRequest(req); }
    audit('order_cancel', 'order', o.order_no, { reason }); return getOrder(id);
  }
  async function updateOrder(id, d) {
    need('jmg_plan'); const o = S.orders[id]; if (!o) { throw err('Order not found', 'jmg_404'); }
    if (['COMPLETED', 'CANCELLED'].includes(o.status)) { throw err('Order is ' + o.status); }
    if (d.qty !== undefined && o.status === 'DRAFT') { o.qty = Math.max(0.01, Number(d.qty)); }
    if (['Normal', 'Urgent', 'Critical'].includes(d.priority)) { o.priority = d.priority; }
    if (d.plan_start) { o.plan_start = d.plan_start; }
    if (d.requested_date !== undefined) { o.requested_date = d.requested_date || null; }
    if (['', 'next_day', 'same_day', 'full_lot'].includes(d.transfer_rule)) { o.transfer_rule = d.transfer_rule; }
    if (d.notes !== undefined) { o.notes = d.notes; }
    if (Array.isArray(d.ops)) { d.ops.forEach((u) => { const op = o.ops.find((x) => String(x.id) === String(u.id)); if (!op) { return; } if ('earliest_start' in u) { op.earliest_start = u.earliest_start || null; } if ('manual_minutes' in u) { op.manual_minutes = (u.manual_minutes === '' || u.manual_minutes == null) ? null : Math.max(0, Number(u.manual_minutes)); } if ('manual_section_id' in u) { op.manual_section_id = u.manual_section_id ? Number(u.manual_section_id) : null; } }); }
    audit('order_adjust', 'order', o.order_no, d);
    planOrder(o, {}); await saveOrder(o);
    if (['CONFIRMED', 'IN_PROGRESS'].includes(o.status)) { await checkDelayAlerts(o); }
    return getOrder(id);
  }
  async function replanOrder(id) { need('jmg_plan'); const o = S.orders[id]; if (!o) { throw err('Order not found', 'jmg_404'); } planOrder(o, {}); await saveOrder(o); await checkDelayAlerts(o); audit('order_replan', 'order', o.order_no); return getOrder(id); }
  async function replanAll() {
    need('jmg_plan');
    const open = Object.values(S.orders).filter((o) => ['CONFIRMED', 'IN_PROGRESS'].includes(o.status)).sort((a, b) => (PRIO[a.priority] - PRIO[b.priority]) || String(a.requested_date || '9999').localeCompare(String(b.requested_date || '9999')) || String(a.confirmed_at || '').localeCompare(String(b.confirmed_at || '')));
    open.forEach((o) => { o.loads = {}; });
    for (const o of open) { planOrder(o, {}); await saveOrder(o); await checkDelayAlerts(o); }
    for (const o of Object.values(S.orders).filter((x) => x.status === 'DRAFT')) { planOrder(o, {}); await saveOrder(o); }
    audit('replan_all', 'order', '', { orders: open.length }); return { replanned: open.length };
  }
  function listOrders(f) {
    f = f || {}; let list = Object.values(S.orders);
    if (f.status) { list = list.filter((o) => o.status === f.status); }
    if (f.category) { list = list.filter((o) => o.category === f.category); }
    if (f.product_code) { list = list.filter((o) => o.product_code === f.product_code); }
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter((o) => [o.order_no, o.product_code, o.customer, o.description].join(' ').toLowerCase().includes(q)); }
    if (f.open) { list = list.filter((o) => ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'].includes(o.status)); }
    list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return list.map((o) => { const c = Object.assign({}, o); delete c.ops; delete c.components; delete c.loads; delete c.schedule; c.delayed = isDelayed(o); return c; });
  }
  function getOrder(id) {
    const o = S.orders[id]; if (!o) { throw err('Order not found', 'jmg_404'); }
    const out = JSON.parse(JSON.stringify(o)); delete out.loads;
    out.delayed = isDelayed(o); out.warnings = out.warnings || [];
    out.ops = (out.ops || []).slice().sort((a, b) => (b.level - a.level) || a.component_code.localeCompare(b.component_code) || (a.sequence - b.sequence));
    out.ops.forEach((op) => { op.qty_remaining = Math.max(0, op.qty_planned - op.qty_completed); op.progress_pct = op.qty_planned > 0 ? Math.round(1000 * op.qty_completed / op.qty_planned) / 10 : 0; op.delayed = !!(op.baseline_end && (op.actual_end || op.planned_end) && (op.actual_end || op.planned_end) > op.baseline_end); });
    out.alerts = Object.values(S.alerts).filter((a) => a.order_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    out.logs = Object.values(S.logs).filter((l) => l.order_id === id).sort((a, b) => b.log_date.localeCompare(a.log_date) || b.created_at.localeCompare(a.created_at));
    const depts = {};
    out.ops.forEach((op) => { if (!op.section_name) { return; } const k = op.section_name; if (!depts[k]) { depts[k] = { section_id: op.section_id, section_name: op.section_name, site: op.site, department: op.department, ops: [], daily: {} }; } depts[k].ops.push({ op_id: op.id, component_code: op.component_code, stage_name: op.stage_name, qty_planned: op.qty_planned, qty_completed: op.qty_completed, planned_start: op.planned_start, planned_end: op.planned_end, status: op.status }); Object.entries(op.daily || {}).forEach(([d, q]) => { depts[k].daily[d] = Math.round(((depts[k].daily[d] || 0) + q) * 1000) / 1000; }); });
    out.departments = Object.values(depts).map((d) => { const sorted = {}; Object.keys(d.daily).sort().forEach((k) => { sorted[k] = d.daily[k]; }); d.daily = sorted; return d; });
    const ohm = Inv.onHandMap();
    out.components.forEach((c) => { c.qty_issued = c.qty_issued || 0; c.qty_received = c.qty_received || 0; c.on_hand = Inv.sumWh(ohm[c.component_code]); c.shortage = ['material', 'purchased_assembly'].includes(c.comp_kind) ? Math.max(0, r4(Number(c.total_qty) - Number(c.inventory_qty || 0))) : 0; });
    out.stock_moves = Inv.ledger({ order_id: id, limit: 300 });
    out.materials = out.components.filter((c) => c.comp_kind === 'material' || c.comp_kind === 'purchased_assembly');
    out.semi_finished = out.components.filter((c) => c.comp_kind === 'assembly');
    out.cost = out.schedule ? out.schedule.cost : null;
    const done = Number(o.qty_completed || 0);
    out.actual_cost = out.cost && Number(o.qty) > 0 ? { finished_units: done, material_consumed_est: Math.round(out.cost.material * done * 100) / 100, labor_planned_share: Math.round(out.cost.labor * done * 100) / 100, logged_manpower_days: out.logs.reduce((a, l) => a + (Number(l.manpower) || 0), 0), total_est: Math.round(out.cost.total * done * 100) / 100, planned_total: o.planned_cost, completion_ratio: Math.round(1000 * done / Number(o.qty)) / 10, note: 'Actual cost = planned unit cost x finished units; actual material issues and payroll are not interfaced in this version.' } : null;
    return out;
  }

  /* ------------------------------------------------------------ tracking */
  function worklist(sectionId, date) {
    const rows = [];
    Object.values(S.orders).forEach((o) => {
      if (!['CONFIRMED', 'IN_PROGRESS'].includes(o.status)) { return; }
      (o.ops || []).forEach((op) => {
        if (!op.is_scheduled || op.status === 'COMPLETED') { return; }
        if (sectionId && Number(op.section_id) !== Number(sectionId)) { return; }
        let today = 0, overdue = 0; Object.entries(op.daily || {}).forEach(([d, q]) => { if (d === date) { today += q; } else if (d < date) { overdue += q; } });
        rows.push(Object.assign({}, op, { product_code: o.product_code, product_desc: o.description, priority: o.priority, requested_date: o.requested_date, order_status: o.status, planned_today: Math.round(today * 100) / 100, planned_overdue: Math.round(overdue * 100) / 100, qty_remaining: Math.max(0, op.qty_planned - op.qty_completed), target_today: Math.round((today + overdue) * 100) / 100 }));
      });
    });
    rows.sort((a, b) => String(a.planned_start || '').localeCompare(String(b.planned_start || '')) || (PRIO[a.priority] - PRIO[b.priority]));
    return rows;
  }
  async function logProduction(d) {
    need('jmg_track');
    let order = null, op = null;
    Object.values(S.orders).forEach((o) => { (o.ops || []).forEach((x) => { if (String(x.id) === String(d.op_id)) { order = o; op = x; } }); });
    if (!op) { throw err('Operation not found', 'jmg_404'); }
    if (!['CONFIRMED', 'IN_PROGRESS'].includes(order.status)) { throw err('Production can only be recorded on confirmed orders.'); }
    const date = d.log_date || E.today(); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { throw err('Invalid production date.'); }
    const actual = Math.max(0, Number(d.actual_qty) || 0), rejected = Math.max(0, Number(d.rejected_qty) || 0), rework = Math.max(0, Number(d.rework_qty) || 0), wip = Math.max(0, Number(d.wip_qty) || 0), downtime = Math.max(0, Number(d.downtime_min) || 0);
    const remaining = Math.max(0, op.qty_planned - op.qty_completed);
    if (actual > remaining + 0.0005) { throw err('Actual good quantity ' + actual + ' exceeds the remaining planned quantity ' + remaining + ' for this operation.'); }
    const planned = (d.planned_qty !== undefined && d.planned_qty !== '') ? Number(d.planned_qty) : Number((op.daily || {})[date] || 0);
    const achievement = planned > 0 ? Math.round(10000 * actual / planned) / 100 : null;
    const row = { id: E.uid(), log_date: date, order_id: order.id, order_no: order.order_no, op_id: op.id, section_id: op.section_id, section_name: op.section_name, component_code: op.component_code, stage_name: op.stage_name, planned_qty: planned, actual_qty: actual, rejected_qty: rejected, rework_qty: rework, wip_qty: wip, downtime_min: downtime, manpower: (d.manpower === '' || d.manpower == null) ? null : Number(d.manpower), remarks: d.remarks || '', delay_reason: d.delay_reason || '', achievement_pct: achievement, minutes: Math.round((actual * Number(op.minutes_per_unit || 0) + downtime) * 100) / 100, created_by: Srv.user.id, created_at: E.now() };
    await saveLog(row);
    const moves = await Inv.backflush(order, op, actual, rejected, date, row.id);
    op.qty_completed = Number(op.qty_completed) + actual; op.qty_rejected = Number(op.qty_rejected || 0) + rejected; op.qty_rework = Number(op.qty_rework || 0) + rework;
    if (!op.actual_start || date < op.actual_start) { op.actual_start = date; }
    if (op.qty_completed >= op.qty_planned - 0.0005) { op.status = 'COMPLETED'; op.actual_end = date; } else { op.status = 'IN_PROGRESS'; }
    if (order.status === 'CONFIRMED') { order.status = 'IN_PROGRESS'; }
    const finals = order.ops.filter((x) => x.is_scheduled && x.level === 0).sort((a, b) => b.sequence - a.sequence); if (finals.length) { order.qty_completed = Number(finals[0].qty_completed); }
    audit('daily_log', 'order', order.order_no, { op: op.component_code + ' / ' + op.stage_name, date, actual, rejected, rework });
    let from = Cal.nextWorking(Cal.addDays(date, 1)); if (E.today() > from) { from = E.today(); }
    planOrder(order, { from }); await saveOrder(order); await checkDelayAlerts(order);
    if (planned > 0 && actual < planned) { await addAlert(order, 'shortfall', 'warning', 'planning', op.section_name + ' / ' + op.component_code + ' on ' + date + ': ' + actual + ' of ' + planned + ' planned units completed (' + achievement + '%). Balance of ' + (Math.round((planned - actual) * 100) / 100) + ' carried forward; forecast completion now ' + order.forecast_end + '.'); }
    return Object.assign({}, row, { forecast_end: order.forecast_end, baseline_end: order.baseline_end, order_status: order.status, stock_moves: moves.length });
  }
  function listLogs(f) {
    f = f || {}; let list = Object.values(S.logs);
    if (f.section_id) { list = list.filter((l) => Number(l.section_id) === Number(f.section_id)); }
    if (f.order_id) { list = list.filter((l) => l.order_id === f.order_id); }
    if (f.from) { list = list.filter((l) => l.log_date >= f.from); } if (f.to) { list = list.filter((l) => l.log_date <= f.to); }
    return list.sort((a, b) => b.log_date.localeCompare(a.log_date) || b.created_at.localeCompare(a.created_at)).slice(0, 1000);
  }
  async function deleteLog(id) {
    need('jmg_plan'); const log = S.logs[id]; if (!log) { throw err('Log not found', 'jmg_404'); }
    const order = S.orders[log.order_id]; const op = order ? order.ops.find((x) => String(x.id) === String(log.op_id)) : null;
    if (op) { op.qty_completed = Math.max(0, op.qty_completed - log.actual_qty); op.qty_rejected = Math.max(0, (op.qty_rejected || 0) - log.rejected_qty); op.qty_rework = Math.max(0, (op.qty_rework || 0) - log.rework_qty); op.status = op.qty_completed > 0 ? 'IN_PROGRESS' : 'PENDING'; op.actual_end = null; }
    delete S.logs[id]; await deleteDoc('logs', id);
    await Inv.reverseLog(id, order);
    audit('daily_log_delete', 'order', log.order_no, { log_id: id });
    if (order) { planOrder(order, {}); await saveOrder(order); await checkDelayAlerts(order); }
    return true;
  }

  /* ------------------------------------------------------------ reports */
  function monthEnd(m) { const d = new Date(m + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); }
  function orderFilter(f) { return (o) => (!f.category || o.category === f.category) && (!f.product_code || o.product_code === f.product_code) && (!f.status || o.status === f.status); }
  function finalOp(o) { const finals = (o.ops || []).filter((x) => x.is_scheduled && x.level === 0).sort((a, b) => b.sequence - a.sequence); return finals[0] || null; }
  function dashboard(f) {
    f = f || {}; const month = f.month || E.today().slice(0, 7); const from = f.from || month + '-01', to = f.to || monthEnd(month);
    const orders = Object.values(S.orders).filter(orderFilter(f)).filter((o) => o.status !== 'CANCELLED');
    const reqWaiting = Object.values(S.requests).filter((r) => ['NEW', 'PLANNED'].includes(r.status)).length;
    const counts = { total: orders.length, awaiting_planning: reqWaiting, draft: 0, confirmed: 0, in_progress: 0, completed: 0, delayed: 0 }; const upcoming = [];
    orders.forEach((o) => { const k = o.status.toLowerCase(); if (counts[k] != null) { counts[k]++; } if (isDelayed(o)) { counts.delayed++; } if (['CONFIRMED', 'IN_PROGRESS'].includes(o.status)) { upcoming.push({ id: o.id, order_no: o.order_no, product_code: o.product_code, qty: o.qty, qty_completed: o.qty_completed, forecast_end: o.forecast_end, baseline_end: o.baseline_end, requested_date: o.requested_date, status: o.status, delayed: isDelayed(o), priority: o.priority, customer: o.customer }); } });
    upcoming.sort((a, b) => String(a.forecast_end).localeCompare(String(b.forecast_end)));
    const secOk = (sid) => { if (f.section_id && Number(sid) !== Number(f.section_id)) { return false; } if (f.department) { const s = R.section(Number(sid)); if (!s || s.department !== f.department) { return false; } } return true; };
    const orderIds = new Set(orders.map((o) => o.id));
    let finished = 0; const logsum = { planned: 0, actual: 0, rejected: 0, rework: 0, downtime: 0, n: 0 }; const dailyMap = {};
    Object.values(S.logs).forEach((l) => {
      if (!orderIds.has(l.order_id) || l.log_date < from || l.log_date > to) { return; }
      const o = S.orders[l.order_id]; const fo = o ? finalOp(o) : null; if (fo && String(fo.id) === String(l.op_id)) { finished += l.actual_qty; }
      if (!secOk(l.section_id)) { return; }
      logsum.planned += l.planned_qty; logsum.actual += l.actual_qty; logsum.rejected += l.rejected_qty; logsum.rework += l.rework_qty; logsum.downtime += l.downtime_min; logsum.n++;
      (dailyMap[l.log_date] = dailyMap[l.log_date] || { d: l.log_date, planned: 0, actual: 0 }).actual += l.actual_qty;
    });
    orders.forEach((o) => { if (o.status === 'DRAFT') { return; } (o.ops || []).forEach((op) => { if (!secOk(op.section_id)) { return; } Object.entries(op.daily || {}).forEach(([d, q]) => { if (d < from || d > to) { return; } (dailyMap[d] = dailyMap[d] || { d, planned: 0, actual: 0 }).planned += q; }); }); });
    Object.values(S.logs).forEach((l) => { if (orderIds.has(l.order_id) && l.log_date >= from && l.log_date <= to && secOk(l.section_id)) { (dailyMap[l.log_date] = dailyMap[l.log_date] || { d: l.log_date, planned: 0, actual: 0 }).planned += l.planned_qty; } });
    const daily = Object.values(dailyMap).sort((a, b) => a.d.localeCompare(b.d)).map((x) => ({ d: x.d, planned: Math.round(x.planned * 100) / 100, actual: Math.round(x.actual * 100) / 100 }));
    const wipMap = {};
    Object.values(S.orders).forEach((o) => { if (!['CONFIRMED', 'IN_PROGRESS'].includes(o.status)) { return; } (o.ops || []).forEach((op) => { if (!op.is_scheduled || op.status === 'COMPLETED' || !op.section_id) { return; } const s = R.section(Number(op.section_id)); const w = wipMap[op.section_id] = wipMap[op.section_id] || { section_id: op.section_id, section_name: op.section_name, department: s ? s.department : '', site: s ? s.site : '', open_ops: 0, qty_remaining: 0, qty_done: 0, in_progress: 0 }; w.open_ops++; w.qty_remaining += op.qty_planned - op.qty_completed; w.qty_done += op.qty_completed; if (op.status === 'IN_PROGRESS') { w.in_progress++; } }); });
    const wip = Object.values(wipMap).sort((a, b) => b.qty_remaining - a.qty_remaining);
    const today = E.today(); const hEnd = Cal.addWorkingDays(today, 9); const wd = Cal.workingDaysBetween(today, hEnd);
    const agg = {}; Object.values(S.orders).forEach((o) => { if (!['CONFIRMED', 'IN_PROGRESS'].includes(o.status)) { return; } Object.entries(o.loads || {}).forEach(([k, days]) => { Object.entries(days).forEach(([d, m]) => { if (d >= today && d <= hEnd) { agg[k] = (agg[k] || 0) + m; } }); }); });
    const bottlenecks = Object.entries(agg).map(([k, mins]) => { const capd = R.resourceMinutesPerDay(k) * Math.max(1, wd); return { resource_key: k, name: Sched.resourceName(k), minutes: Math.round(mins), capacity: Math.round(capd), utilisation_pct: capd > 0 ? Math.round(1000 * mins / capd) / 10 : null }; }).sort((a, b) => (b.utilisation_pct || 0) - (a.utilisation_pct || 0));
    const ob = {}; orders.forEach((o) => { if (o.bottleneck && ['CONFIRMED', 'IN_PROGRESS'].includes(o.status)) { ob[o.bottleneck] = (ob[o.bottleneck] || 0) + 1; } });
    const alerts = Object.values(S.alerts).filter((a) => !a.is_ack).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30);
    return { period: { from, to, month }, counts, finished_units: finished, achievement_pct: logsum.planned > 0 ? Math.round(1000 * logsum.actual / logsum.planned) / 10 : null, log_summary: logsum, daily, wip, bottlenecks: bottlenecks.slice(0, 10), order_bottlenecks: ob, upcoming: upcoming.slice(0, 15), alerts, horizon: { from: today, to: hEnd, working_days: wd } };
  }
  function monthly(month, category) {
    const from = month + '-01', to = monthEnd(month); const catOk = (o) => !category || o.category === category;
    const orders = Object.values(S.orders).filter(catOk);
    let plannedFp = 0, actualFp = 0;
    orders.forEach((o) => { if (!['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(o.status)) { return; } const fo = finalOp(o); if (!fo) { return; } Object.entries(fo.daily || {}).forEach(([d, q]) => { if (d >= from && d <= to) { plannedFp += q; } }); });
    const logs = Object.values(S.logs).filter((l) => l.log_date >= from && l.log_date <= to && S.orders[l.order_id] && catOk(S.orders[l.order_id]));
    logs.forEach((l) => { const o = S.orders[l.order_id]; const fo = finalOp(o); if (fo && String(fo.id) === String(l.op_id)) { actualFp += l.actual_qty; } });
    const wd = Cal.workingDaysBetween(from, to); const shifts = Math.max(1, Number(E.setting('shifts_per_day')) || 1);
    const rows = [];
    R.sectionsAll().forEach((se) => {
      if (!Number(se.is_active)) { return; }
      let plannedQty = 0, plannedMin = 0;
      orders.forEach((o) => { if (!['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(o.status)) { return; } (o.ops || []).forEach((op) => { if (Number(op.section_id) !== se.id) { return; } Object.entries(op.daily || {}).forEach(([d, q]) => { if (d >= from && d <= to) { plannedQty += q; plannedMin += q * Number(op.minutes_per_unit || 0); } }); }); });
      const sl = logs.filter((l) => Number(l.section_id) === se.id);
      const actual = sl.reduce((a, l) => a + l.actual_qty, 0); if (!plannedQty && !actual) { return; }
      const loggedPlanned = sl.reduce((a, l) => a + l.planned_qty, 0); const manDays = sl.reduce((a, l) => a + (Number(l.manpower) || 0), 0); const days = new Set(sl.map((l) => l.log_date)).size;
      plannedMin += sl.reduce((a, l) => a + (l.minutes || 0), 0);
      const avail = Number(se.minutes_per_day) * shifts * wd;
      rows.push({ section_id: se.id, site: se.site, department: se.department, section_name: se.section_name, staffs: se.staffs, planned_qty: Math.round(plannedQty * 100) / 100, actual_qty: Math.round(actual * 100) / 100, achievement_pct: loggedPlanned > 0 ? Math.round(1000 * actual / loggedPlanned) / 10 : null, utilisation_pct: avail > 0 ? Math.round(1000 * plannedMin / avail) / 10 : null, daily_productivity: days > 0 ? Math.round(100 * actual / days) / 100 : null, manpower_productivity: manDays > 0 ? Math.round(100 * actual / manDays) / 100 : null, rejected_qty: sl.reduce((a, l) => a + l.rejected_qty, 0), rework_qty: sl.reduce((a, l) => a + l.rework_qty, 0), downtime_min: sl.reduce((a, l) => a + l.downtime_min, 0), shortfall_days: sl.filter((l) => l.actual_qty < l.planned_qty).length, days_logged: days });
    });
    const dm = {}; logs.forEach((l) => { const d = dm[l.log_date] = dm[l.log_date] || { d: l.log_date, planned: 0, actual: 0, rejected: 0, rework: 0, downtime: 0 }; d.planned += l.planned_qty; d.actual += l.actual_qty; d.rejected += l.rejected_qty; d.rework += l.rework_qty; d.downtime += l.downtime_min; });
    const daily = Object.values(dm).sort((a, b) => a.d.localeCompare(b.d));
    const inMonth = orders.filter((o) => !['CANCELLED', 'DRAFT'].includes(o.status) && [o.planned_end, o.forecast_end, o.actual_end].some((d) => d && d >= from && d <= to)).sort((a, b) => String(a.forecast_end).localeCompare(String(b.forecast_end)));
    let onTime = 0, completed = 0; const lead = [], delays = [];
    const ord = inMonth.map((o) => { const end = o.actual_end || o.forecast_end; const delayDays = (o.baseline_end && end && end > o.baseline_end) ? Cal.workingDaysBetween(o.baseline_end, end) - 1 : 0; const lt = (o.planned_start && end) ? Cal.workingDaysBetween(o.planned_start, end) : o.lead_time_days; const delayed = isDelayed(o); if (o.status === 'COMPLETED') { completed++; if (!delayed) { onTime++; } } if (lt) { lead.push(lt); } if (delayDays > 0) { delays.push({ order_no: o.order_no, product_code: o.product_code, baseline_end: o.baseline_end, forecast_end: end, delay_days: delayDays, status: o.status }); } return { id: o.id, order_no: o.order_no, product_code: o.product_code, qty: o.qty, status: o.status, baseline_end: o.baseline_end, forecast_end: o.forecast_end, actual_end: o.actual_end, lead_time_days: lt, delay_days: delayDays, delayed }; });
    const rm = {}; logs.forEach((l) => { if (!l.delay_reason) { return; } const r = rm[l.delay_reason] = rm[l.delay_reason] || { reason: l.delay_reason, n: 0, shortfall: 0 }; r.n++; r.shortfall += l.planned_qty - l.actual_qty; });
    const tot = { planned: 0, actual: 0, rejected: 0, rework: 0, downtime: 0 }; daily.forEach((d) => { tot.planned += d.planned; tot.actual += d.actual; tot.rejected += d.rejected; tot.rework += d.rework; tot.downtime += d.downtime; });
    return { month, category, from, to, working_days: wd, finished: { planned: Math.round(plannedFp * 100) / 100, actual: Math.round(actualFp * 100) / 100, achievement_pct: plannedFp > 0 ? Math.round(1000 * actualFp / plannedFp) / 10 : null }, sections: rows, daily, totals: tot, achievement_pct: tot.planned > 0 ? Math.round(1000 * tot.actual / tot.planned) / 10 : null, orders: ord, delays, delay_reasons: Object.values(rm).sort((a, b) => b.n - a.n), lead_time_avg: lead.length ? Math.round(10 * lead.reduce((a, b) => a + b, 0) / lead.length) / 10 : null, lead_time_max: lead.length ? Math.max(...lead) : null, on_time_pct: completed > 0 ? Math.round(1000 * onTime / completed) / 10 : null, completed_orders: completed, on_time_orders: onTime };
  }
  function gantt(f) {
    f = f || {}; let orders = Object.values(S.orders).filter(orderFilter(f));
    if (f.order_id) { orders = orders.filter((o) => o.id === f.order_id); }
    if (!f.status) { orders = orders.filter((o) => ['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(o.status)); if (!f.include_completed && !f.order_id) { orders = orders.filter((o) => o.status !== 'COMPLETED'); } }
    orders.sort((a, b) => String(a.planned_start || '').localeCompare(String(b.planned_start || '')) || String(a.created_at).localeCompare(String(b.created_at))); orders = orders.slice(0, 60);
    let min = null, max = null;
    const out = orders.map((o) => {
      let ops = (o.ops || []).slice(); if (f.department) { ops = ops.filter((op) => op.department === f.department); }
      ops.sort((a, b) => (b.level - a.level) || a.component_code.localeCompare(b.component_code) || (a.sequence - b.sequence));
      ops = ops.map((op) => Object.assign({}, op, { progress_pct: op.qty_planned > 0 ? Math.round(1000 * op.qty_completed / op.qty_planned) / 10 : 0, delayed: !!(op.baseline_end && (op.actual_end || op.planned_end) > op.baseline_end) }));
      [o.planned_start, o.baseline_start].forEach((d) => { if (d && (!min || d < min)) { min = d; } }); [o.planned_end, o.baseline_end, o.forecast_end, o.requested_date].forEach((d) => { if (d && (!max || d > max)) { max = d; } });
      return { id: o.id, order_no: o.order_no, product_code: o.product_code, description: o.description, qty: o.qty, qty_completed: o.qty_completed, status: o.status, priority: o.priority, planned_start: o.planned_start, planned_end: o.planned_end, baseline_start: o.baseline_start, baseline_end: o.baseline_end, forecast_end: o.forecast_end, requested_date: o.requested_date, actual_end: o.actual_end, bottleneck: o.bottleneck, customer: o.customer, delayed: isDelayed(o), ops };
    });
    return { orders: out, range: { from: min, to: max }, today: E.today() };
  }

  /* ------------------------------------------------------------ demo scenario */
  async function demoScenario() {
    need('jmg_admin');
    const roleBefore = Srv.role;
    for (const o of Object.values(S.orders)) { if ((o.sales_ref || '').startsWith('DEMO-')) { await deleteOrder(o.id); } }
    for (const r of Object.values(S.requests)) { if ((r.sales_ref || '').startsWith('DEMO-')) { delete S.requests[r.id]; await deleteDoc('requests', r.id); } }
    const today = E.today(); let monday = Cal.addDays(today, -((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7)); monday = Cal.nextWorking(monday);
    const next = Cal.nextWorking(Cal.addDays(today, 1)); const log = { orders: [], daily_logs: 0, opening_stock: 0 };
    Srv.role = 'administrator';
    for (const b of Object.values(S.stock || {})) { if ((b.txns || []).some((t) => t.reference === 'DEMO-OPENING')) { delete S.stock[b.id]; await deleteDoc('stock', b.id); } }
    for (const s of [['MSH1-2MM2000x1220-H', 60], ['MSH1-2MM1500x1220-H', 25], ['1111931302-RAL-9001', 150], ['BASE-400SRS', 2], ['KIT-P22', 10]]) { try { await Inv.post({ txn_type: 'RECEIPT', item_code: s[0], qty: s[1], txn_date: Cal.addDays(monday, -3), reference: 'DEMO-OPENING', reason: 'Demonstration opening stock' }); log.opening_stock++; } catch (e) { log.errors = (log.errors || []).concat([e.message]); } }
    const r1 = await createRequest({ sales_ref: 'DEMO-SO-1001', customer: 'Acceptance Test Customer', product_code: 'SPGP22', qty: 20, requested_date: Cal.addWorkingDays(monday, 12), priority: 'Normal', instructions: 'Demonstration: 20 units, zero opening stock, all components manufactured from scratch.', requested_by: 'Sales Demo' });
    const r2 = await createRequest({ sales_ref: 'DEMO-SO-1002', customer: 'Lagos Industrial Park', product_code: 'SPGP65-OPT', qty: 10, requested_date: Cal.addWorkingDays(monday, 14), priority: 'Urgent', instructions: 'Competes with the first order for base welding, panel assembly, genset assembly, STC and packaging.', requested_by: 'Sales Demo' });
    await createRequest({ sales_ref: 'DEMO-SO-1003', customer: 'Abuja Data Centre', product_code: 'SPGP110-OPT', qty: 6, requested_date: Cal.addWorkingDays(monday, 20), priority: 'Normal', instructions: 'Awaiting planning - use "Generate plan" to see the proposal.', requested_by: 'Sales Demo' });
    const r4 = await createRequest({ sales_ref: 'DEMO-SO-1004', customer: 'Dealer stock', product_code: 'SPGP200', qty: 4, requested_date: Cal.addWorkingDays(monday, 25), priority: 'Critical', instructions: 'Critical priority example.', requested_by: 'Sales Demo' });
    let o1 = await generate({ request_id: r1.id, plan_start: monday }); o1 = await confirmOrder(o1.id);
    let o2 = await generate({ request_id: r2.id, plan_start: next }); o2 = await confirmOrder(o2.id);
    let o4 = await generate({ request_id: r4.id, plan_start: next }); o4 = await confirmOrder(o4.id);
    log.orders = [o1.order_no, o2.order_no, o4.order_no];
    const day1 = monday;
    if (day1 <= today) {
      const ord = S.orders[o1.id];
      const plan = ord.ops.filter((op) => op.is_scheduled && Number((op.daily || {})[day1] || 0) > 0).map((op) => ({ id: op.id, stage_key: op.stage_key, planned: Number(op.daily[day1]) }));
      for (const cur of plan) {
        const planned = cur.planned;
        const isCut = cur.stage_key === 'canopy_cutting'; const actual = isCut ? Math.round(planned * 0.8) : planned;
        try { await logProduction({ op_id: cur.id, log_date: day1, planned_qty: planned, actual_qty: actual, rejected_qty: isCut ? 1 : 0, rework_qty: 0, wip_qty: Math.max(0, planned - actual), downtime_min: isCut ? 90 : 0, manpower: 2, remarks: isCut ? 'Punch 2 breakdown 90 min; 1 sheet rejected' : 'As planned', delay_reason: isCut ? 'Machine breakdown' : '' }); log.daily_logs++; } catch (e) { log.errors = (log.errors || []).concat([e.message]); }
      }
    }
    Srv.role = roleBefore; audit('demo_seed', 'demo', '', log);
    return log;
  }

  /* ------------------------------------------------------------ router (same paths as the REST API) */
  const routes = [];
  const route = (method, re, fn) => routes.push({ method, re, fn });
  const parseQuery = (qs) => Object.fromEntries(new URLSearchParams(qs || ''));
  route('GET', /^bootstrap$/, () => {
    const sections = R.sectionsAll().sort((a, b) => (a.site + a.department + a.section_name).localeCompare(b.site + b.department + b.section_name)).map((s) => ({ id: s.id, site: s.site, department: s.department, section_name: s.section_name, stage_key: s.stage_key, is_active: s.is_active }));
    const dm = {}; sections.forEach((s) => { dm[s.site + ' / ' + s.department] = { site: s.site, department: s.department }; });
    const assigned = Srv.user.id && S.roles[Srv.user.id];
    return { user: { id: Srv.user.id, login: Srv.user.name, name: Srv.user.name || (Srv.user.isOwner ? 'Owner' : 'Demo user'), roles: [Srv.role], role_label: ROLES[Srv.role].name.replace('JMG ', ''), caps: caps(), sections: assigned && assigned.sections ? assigned.sections : [], role_assigned: Srv.roleAssigned, is_owner: Srv.user.isOwner, can_write: Srv.user.canWrite, local_store: store.local }, settings: Object.assign({}, E.DEFAULTS, S.settings), sections, departments: Object.values(dm), products: M.productList.map((p) => ({ code: p.code, description: p.description, item_type: p.item_type, category: p.category, model_kva: p.model_kva })), warehouses: Inv.warehouses(), today: E.today(), counts: { issues: M.issues.length - (S.settings.resolved_issues || []).length, alerts: Object.values(S.alerts).filter((a) => !a.is_ack).length }, import: M.importInfo, version: '1.0.0-demo', roles: ROLES };
  });
  route('GET', /^products$/, (m, q) => { let list = q.all ? Object.values(M.products) : M.productList; if (q.q) { const s = q.q.toLowerCase(); list = list.filter((p) => (p.code + ' ' + p.description).toLowerCase().includes(s)); } return list.slice(0, Number(q.limit) || 300); });
  route('GET', /^products\/([^/]+)\/bom$/, (m, q) => { const code = decodeURIComponent(m[1]); const qty = Math.max(1, Number(q.qty) || 1); const ex = BOM.explode(code, qty); const cost = BOM.costRollup(code, qty); const built = R.build(ex, qty); return { product: ex.product, tree: BOM.slimTree(ex.root), components: ex.components, issues: ex.issues, cost, ops: built.ops, routing_warnings: built.warnings }; });
  route('GET', /^requests$/, (m, q) => listRequests(q));
  route('POST', /^requests$/, (m, q, b) => createRequest(b));
  route('PUT', /^requests\/([^/]+)$/, (m, q, b) => updateRequest(m[1], b));
  route('POST', /^requests\/([^/]+)\/generate$/, (m, q, b) => generate(Object.assign({}, b, { request_id: m[1] })));
  route('GET', /^orders$/, (m, q) => listOrders(q));
  route('POST', /^orders$/, (m, q, b) => generate(b));
  route('POST', /^orders\/replan-all$/, () => replanAll());
  route('GET', /^orders\/([^/]+)$/, (m) => getOrder(m[1]));
  route('PUT', /^orders\/([^/]+)$/, (m, q, b) => updateOrder(m[1], b));
  route('POST', /^orders\/([^/]+)\/confirm$/, (m) => confirmOrder(m[1]));
  route('POST', /^orders\/([^/]+)\/cancel$/, (m, q, b) => cancelOrder(m[1], b && b.reason));
  route('POST', /^orders\/([^/]+)\/replan$/, (m) => replanOrder(m[1]));
  route('DELETE', /^orders\/([^/]+)$/, async (m) => { need('jmg_plan'); const o = S.orders[m[1]]; if (!o) { throw err('Order not found', 'jmg_404'); } if (o.status !== 'DRAFT') { throw err('Only draft plans can be deleted; cancel confirmed orders instead.'); } const req = o.request_id ? S.requests[o.request_id] : null; await deleteOrder(o.id); if (req) { req.status = 'NEW'; await saveRequest(req); } audit('order_delete_draft', 'order', o.order_no); return { deleted: true }; });
  route('GET', /^tracking\/worklist$/, (m, q) => worklist(q.section_id, q.date || E.today()));
  route('GET', /^tracking\/logs$/, (m, q) => listLogs(q));
  route('POST', /^tracking\/logs$/, (m, q, b) => logProduction(b));
  route('DELETE', /^tracking\/logs\/([^/]+)$/, (m) => deleteLog(m[1]));
  route('GET', /^dashboard$/, (m, q) => dashboard(q));
  route('GET', /^reports\/monthly$/, (m, q) => { const month = q.month || E.today().slice(0, 7); if (!/^\d{4}-\d{2}$/.test(month)) { throw err('month must be YYYY-MM'); } return monthly(month, q.category || ''); });
  route('GET', /^gantt$/, (m, q) => gantt(q));
  route('GET', /^alerts$/, (m, q) => Object.values(S.alerts).filter((a) => q.all || !a.is_ack).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 200));
  route('POST', /^alerts\/([^/]+)\/ack$/, async (m) => { const a = S.alerts[m[1]]; if (a) { a.is_ack = 1; a.ack_by = Srv.user.id; await saveAlert(a); audit('alert_ack', 'alert', m[1]); } return { ok: true }; });
  route('GET', /^inventory\/balances$/, (m, q) => Inv.balances(q));
  route('GET', /^inventory\/ledger$/, (m, q) => Inv.ledger(q));
  route('POST', /^inventory\/txn$/, (m, q, b) => Inv.post(b, false));
  route('POST', /^inventory\/txn\/([^/]+)\/reverse$/, (m) => Inv.reverse(m[1]));
  route('GET', /^inventory\/shortages$/, (m, q) => Inv.shortages(q));
  route('GET', /^inventory\/valuation$/, () => Inv.valuation());
  route('GET', /^inventory\/warehouses$/, () => Inv.warehouses());
  route('GET', /^inventory\/item\/([^/]+)$/, (m) => Inv.item(decodeURIComponent(m[1])));
  route('GET', /^costing\/([^/]+)$/, (m, q) => BOM.costRollup(decodeURIComponent(m[1]), Math.max(1, Number(q.qty) || 1)));
  route('GET', /^prices$/, (m, q) => { let list = M.priceRows.map((p) => { const edited = S.priceEdits[p.code]; return edited === undefined ? p : Object.assign({}, p, { unit_cost: edited, source: 'manual' }); }); Object.keys(S.priceEdits).forEach((code) => { if (!M.prices[code]) { list.push({ code, description: (S.priceMeta || {})[code] || '', price_type: 'material', unit: '', cost_group: '', unit_cost: S.priceEdits[code], source: 'manual', conflict_note: '' }); } }); if (q.q) { const s = q.q.toLowerCase(); list = list.filter((p) => (p.code + ' ' + p.description + ' ' + p.cost_group).toLowerCase().includes(s)); } if (q.type) { list = list.filter((p) => p.price_type === q.type); } if (q.pending) { list = list.filter((p) => p.unit_cost == null); } return list.sort((a, b) => ((b.unit_cost == null) - (a.unit_cost == null)) || a.code.localeCompare(b.code)).slice(0, 400); });
  route('POST', /^prices$/, async (m, q, b) => { need('jmg_cost'); if (!b.code) { throw err('code required'); } S.priceEdits[b.code] = (b.unit_cost === '' || b.unit_cost == null) ? null : Number(b.unit_cost); await saveSetting('prices'); audit('price_update', 'price', b.code, { unit_cost: S.priceEdits[b.code] }); return { code: b.code, unit_cost: S.priceEdits[b.code] }; });
  route('GET', /^masters\/sections$/, () => R.sectionsAll().sort((a, b) => (a.site + a.department + a.section_name).localeCompare(b.site + b.department + b.section_name)).map((s) => Object.assign({}, s, { capacities: (M.caps[s.id] || []).map(R.cap) })));
  route('PUT', /^masters\/sections\/(\d+)$/, async (m, q, b) => { need('jmg_admin'); const e = S.sectionEdits[m[1]] = S.sectionEdits[m[1]] || {}; ['section_name', 'department', 'site', 'stage_key', 'notes'].forEach((k) => { if (b[k] !== undefined) { e[k] = b[k]; } }); ['staffs', 'total_available_staffs', 'new_staffs', 'flow_lines'].forEach((k) => { if (b[k] !== undefined) { e[k] = b[k] === '' ? null : Number(b[k]); } }); ['machines', 'minutes_per_day', 'excel_shifts', 'is_active'].forEach((k) => { if (b[k] !== undefined) { e[k] = Number(b[k]); } }); await saveSetting('sections'); audit('section_update', 'section', m[1], b); return R.section(Number(m[1])); });
  route('PUT', /^masters\/capacities\/(\d+)$/, async (m, q, b) => { need('jmg_admin'); const e = S.capEdits[m[1]] = S.capEdits[m[1]] || {}; ['productivity_per_shift', 'new_productivity', 'manual_override', 'per_resource', 'staffs', 'prod_lines', 'kva_min', 'kva_max'].forEach((k) => { if (b[k] !== undefined) { e[k] = (b[k] === '' || b[k] == null) ? null : Number(b[k]); } }); ['type_code', 'series_key'].forEach((k) => { if (b[k] !== undefined) { e[k] = b[k]; } }); await saveSetting('capacities'); audit('capacity_update', 'capacity', m[1], b); return R.cap(M.capById[m[1]] || { id: Number(m[1]) }); });
  route('POST', /^masters\/capacities$/, async (m, q, b) => { need('jmg_admin'); if (!b.section_id || !b.type_code) { throw err('section_id and type_code required'); } const id = Math.max(100000, ...Object.keys(M.capById).map(Number)) + 1; const kva = E.kvaFromComponentCode(b.type_code); const row = { id, section_id: Number(b.section_id), type_code: b.type_code, series_key: E.seriesFromCode(b.type_code), kva_min: kva, kva_max: kva, productivity_per_shift: b.productivity_per_shift == null ? null : Number(b.productivity_per_shift), new_productivity: null, manual_override: null, staffs: null, prod_lines: null, per_resource: null }; M.capById[id] = row; (M.caps[row.section_id] = M.caps[row.section_id] || []).push(row); S.capEdits[id] = row; await saveSetting('capacities'); audit('capacity_create', 'capacity', id, row); return row; });
  route('GET', /^masters\/stage-map$/, () => M.stageRows.map((r) => { const s = r.section_id ? R.section(Number(r.section_id)) : null; return Object.assign({}, r, { section_name: s ? s.section_name : null, site: s ? s.site : null }); }).sort((a, b) => (a.workflow_group || '').localeCompare(b.workflow_group || '') || (Number(a.sequence) - Number(b.sequence))));
  route('PUT', /^masters\/stage-map\/(\d+)$/, () => { throw err('The stage map is fixed in the hosted demo; it is editable in the WordPress installation.'); });
  route('GET', /^masters\/series$/, () => M.series);
  route('PUT', /^masters\/series\/(\d+)$/, () => { throw err('Size classes are fixed in the hosted demo; they are editable in the WordPress installation.'); });
  route('GET', /^masters\/overrides$/, () => Object.entries(S.overrides).map(([k, o]) => { const cap = o.capacity_id ? M.capById[o.capacity_id] : null; const sec = cap ? R.section(cap.section_id) : null; return Object.assign({ id: k }, o, { type_code: cap ? cap.type_code : '', section_name: sec ? sec.section_name : '' }); }));
  route('POST', /^masters\/overrides$/, async (m, q, b) => { need('jmg_admin'); if (!b.component_code || !b.stage_key) { throw err('component_code and stage_key required'); } const k = b.component_code + '|' + b.stage_key; S.overrides[k] = { component_code: b.component_code, stage_key: b.stage_key, capacity_id: b.capacity_id ? Number(b.capacity_id) : null, minutes_per_unit: (b.minutes_per_unit === '' || b.minutes_per_unit == null) ? null : Number(b.minutes_per_unit), notes: b.notes || '' }; await saveSetting('overrides'); audit('override_save', 'override', k, b); return { id: k }; });
  route('DELETE', /^masters\/overrides\/(.+)$/, async (m) => { need('jmg_admin'); delete S.overrides[decodeURIComponent(m[1])]; await saveSetting('overrides'); return { ok: true }; });
  route('GET', /^masters\/machines$/, () => ({ machine_times: M.machineRows, cutting_files: M.cutting }));
  route('GET', /^masters\/calendar$/, () => ({ overrides: Object.entries(S.calendar).map(([d, v]) => ({ cal_date: d, is_working: v.is_working ? 1 : 0, note: v.note || '' })).sort((a, b) => a.cal_date.localeCompare(b.cal_date)), working_days: E.setting('working_days') }));
  route('POST', /^masters\/calendar$/, async (m, q, b) => { need('jmg_admin'); if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) { throw err('date required'); } if (b.remove) { delete S.calendar[b.date]; } else { S.calendar[b.date] = { is_working: Number(b.is_working) ? 1 : 0, note: b.note || '' }; } await saveSetting('calendar'); audit('calendar_update', 'calendar', b.date, b); return Object.entries(S.calendar).map(([d, v]) => ({ cal_date: d, is_working: v.is_working, note: v.note })); });
  route('GET', /^masters\/issues$/, (m, q) => { const resolved = new Set(S.settings.resolved_issues || []); return M.issues.map((i, idx) => Object.assign({ id: idx }, i, { is_resolved: resolved.has(idx) ? 1 : 0 })).filter((i) => q.all || !i.is_resolved); });
  route('PUT', /^masters\/issues\/(\d+)$/, async (m, q, b) => { need('jmg_admin'); const set = new Set(S.settings.resolved_issues || []); if (Number(b.is_resolved)) { set.add(Number(m[1])); } else { set.delete(Number(m[1])); } S.settings.resolved_issues = [...set]; await saveSetting('main'); return { ok: true }; });
  route('GET', /^settings$/, () => Object.assign({}, E.DEFAULTS, S.settings));
  route('PUT', /^settings$/, async (m, q, b) => { need('jmg_admin'); const allowed = Object.keys(E.DEFAULTS).concat(['inventory_qty']); const changed = {}; Object.entries(b).forEach(([k, v]) => { if (!allowed.includes(k)) { return; } if (k === 'working_days') { v = [].concat(v).map(Number); } else if (['break_minutes', 'net_minutes', 'shifts_per_day', 'inventory_enabled', 'backflush_enabled', 'allow_negative_stock', 'include_overheads', 'horizon_days', 'plan_lead_days'].includes(k)) { v = Number(v); } S.settings[k] = v; changed[k] = v; }); await saveSetting('main'); audit('settings_update', 'settings', '', changed); return Object.assign({}, E.DEFAULTS, S.settings); });
  route('GET', /^admin\/audit$/, (m, q) => { let list = (S.auditDoc || []).slice().reverse(); if (q.entity) { list = list.filter((a) => a.entity === q.entity); } if (q.entity_id) { list = list.filter((a) => a.entity_id === String(q.entity_id)); } return list.slice(0, Number(q.limit) || 300); });
  route('GET', /^admin\/backup$/, () => { need('jmg_admin'); audit('backup_export', 'backup', ''); return { format: 'jmg-pp-backup', version: '1.0.0-demo', created_at: E.now(), tables: { requests: Object.values(S.requests), orders: Object.values(S.orders), logs: Object.values(S.logs), alerts: Object.values(S.alerts), stock: Object.values(S.stock || {}), settings: S.settings, calendar: S.calendar, prices: S.priceEdits, capacities: S.capEdits, sections: S.sectionEdits, overrides: S.overrides, roles: S.roles } }; });
  route('POST', /^admin\/restore$/, async (m, q, b) => { need('jmg_admin'); if (!b || b.format !== 'jmg-pp-backup') { throw err('Not a Production Planning backup file.'); } const t = b.tables || {}; for (const c of ['requests', 'orders', 'logs', 'alerts', 'stock']) { S[c] = S[c] || {}; for (const id of Object.keys(S[c])) { await deleteDoc(c, id); } S[c] = {}; for (const row of (t[c] || [])) { S[c][row.id] = row; await writeDoc(c, row.id, row); } } S.settings = t.settings || {}; S.calendar = t.calendar || {}; S.priceEdits = t.prices || {}; S.capEdits = t.capacities || {}; S.sectionEdits = t.sections || {}; S.overrides = t.overrides || {}; for (const id of ['main', 'calendar', 'prices', 'capacities', 'sections', 'overrides']) { await saveSetting(id); } audit('backup_restore', 'backup', ''); return { requests: (t.requests || []).length, orders: (t.orders || []).length, logs: (t.logs || []).length }; });
  route('GET', /^admin\/users$/, () => ({ users: Object.entries(S.roles).map(([id, r]) => ({ id, login: r.name || id.slice(0, 10), name: r.name || id.slice(0, 10), email: '', roles: [r.role], role_label: (ROLES[r.role] || {}).name || r.role, sections: r.sections || [] })), roles: ROLES, me: { id: Srv.user.id, name: Srv.user.name, role: Srv.role } }));
  route('POST', /^admin\/users$/, async (m, q, b) => { need('jmg_admin'); if (!b.user_id || !ROLES[b.role]) { throw err('viewer id and a valid role are required'); } S.roles[b.user_id] = { role: b.role, name: b.name || '', sections: [].concat(b.sections || []).map(Number).filter(Boolean) }; await writeDoc('roles', b.user_id, S.roles[b.user_id]); audit('user_role', 'user', b.user_id, { role: b.role }); return { id: b.user_id }; });
  route('PUT', /^admin\/users\/([^/]+)$/, async (m, q, b) => { need('jmg_admin'); const id = decodeURIComponent(m[1]); const r = S.roles[id] || { role: 'jmg_sales', name: '', sections: [] }; if (ROLES[b.role]) { r.role = b.role; } if (b.sections !== undefined) { r.sections = [].concat(b.sections).map(Number).filter(Boolean); } if (b.name !== undefined) { r.name = b.name; } S.roles[id] = r; await writeDoc('roles', id, r); audit('user_update', 'user', id, b); return { ok: true }; });
  route('DELETE', /^admin\/users\/([^/]+)$/, async (m) => { need('jmg_admin'); const id = decodeURIComponent(m[1]); delete S.roles[id]; await deleteDoc('roles', id); return { ok: true }; });
  route('POST', /^admin\/demo$/, () => demoScenario());
  route('POST', /^role$/, (m, q, b) => { if (Srv.roleAssigned && !Srv.user.isOwner) { throw err('Your role has been assigned by the administrator.'); } Srv.setRole(b.role); return { role: Srv.role }; });

  Srv.handle = async function (method, path, body) {
    if (!Srv.ready) { throw err('Store not ready'); }
    const [p, qs] = path.split('?'); const q = parseQuery(qs);
    for (const r of routes) { if (r.method !== method) { continue; } const m = p.match(r.re); if (m) { return r.fn(m, q, body || {}); } }
    throw err('Unknown route ' + method + ' ' + p, 'jmg_404');
  };
  Srv.hasRole = (r) => !!ROLES[r];
  return Srv;
})();
