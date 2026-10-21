/* views-planning.js — sales requests, production plans (detail with BOM explosion, orders, section plans, Gantt, materials, costing), planning board. */
(function () {
  'use strict';
  const { $, $$, esc, toast, modal, confirm, table, tabs, kpi, fmtNum, fmtInt, fmtMoney, fmtPct, fmtDate, fmtDateTime, today, statusBadge, options, field, selectField, textarea, progress, exportSheets, tableToRows, daysBetween } = window.UI;
  const V = window.Views = window.Views || {};
  const Api = window.Api;
  const meta = () => window.AppState.meta || { sections: [], finished_products: [] };
  const secById = (id) => meta().sections.find((s) => +s.id === +id) || {};

  // ---------------------------------------------------------------- sales requests
  V.sales = async function () {
    setCrumbs('<b>Sales Requests</b>');
    const f = V.sales.filter = V.sales.filter || { status: '', search: '' };
    const data = await Api.get('/sales-requests', f);
    setActions(window.can('sales.create') ? `<button class="btn primary" id="new-sr">+ New sales request</button>` : '');
    const cols = [
      { label: 'Request no.', fmt: (r) => `<b>${esc(r.number)}</b><div class="tiny muted">${esc(r.sales_order_ref || '')}</div>` },
      { label: 'Customer', key: 'customer' },
      { label: 'Finished product', fmt: (r) => `<b>${esc(r.product_code)}</b> <span class="badge">${esc(r.product_type)}</span><div class="tiny muted">${esc(r.product_desc || '')}</div>` },
      { label: 'Qty', cls: 'num', fmt: (r) => fmtNum(r.qty, 0) },
      { label: 'Requested delivery', fmt: (r) => fmtDate(r.delivery_date) },
      { label: 'Expected completion', fmt: (r) => r.expected_completion ? `${fmtDate(r.expected_completion)} ${r.delivery_date ? (r.expected_completion > r.delivery_date ? `<span class="badge bad">${daysBetween(r.delivery_date, r.expected_completion)}d late</span>` : '<span class="badge good">on time</span>') : ''}` : '<span class="muted">not planned</span>' },
      { label: 'Priority', fmt: (r) => statusBadge(r.priority) },
      { label: 'Status', fmt: (r) => statusBadge(r.status) },
      { label: 'Plans', cls: 'num', fmt: (r) => r.plans },
      { label: '', fmt: (r) => `${r.latest_plan_id ? `<a class="btn sm" href="#/plans/${r.active_plan_id || r.latest_plan_id}">${r.active_plan_id ? 'Open plan' : 'Review plan'}</a>` : (window.can('plan.generate') ? `<button class="btn sm" data-plan="${r.id}">Generate plan</button>` : '')} ${window.can('sales.edit') && !['COMPLETED', 'CANCELLED'].includes(r.status) ? `<button class="btn sm ghost" data-edit="${r.id}">Edit</button>` : ''}` },
    ];
    $('#view').innerHTML = `<div class="card-head"><div><h1>Sales production requests</h1><div class="muted small">Production starts here: Sales submits a demand for a finished product; the system retrieves the complete BOM and prepares a proposed plan for the planner's review.</div></div></div>
      <div class="card flat"><div class="filters"><label>Status<select id="f-status">${options([{ id: 'SUBMITTED', name: 'Submitted' }, { id: 'PLANNED', name: 'Planned (awaiting approval)' }, { id: 'APPROVED', name: 'Approved' }, { id: 'IN_PROGRESS', name: 'In progress' }, { id: 'COMPLETED', name: 'Completed' }, { id: 'CANCELLED', name: 'Cancelled' }], f.status, { allLabel: 'All' })}</select></label><label>Search<input id="f-search" value="${esc(f.search)}" placeholder="number, customer, product…"></label><button class="btn" id="f-apply">Apply</button><button class="btn" id="exp">Export</button></div></div>
      ${table(cols, data.requests, { empty: 'No sales requests yet.' })}`;
    $('#f-apply').onclick = () => { f.status = $('#f-status').value; f.search = $('#f-search').value; V.sales(); };
    $('#f-search').onkeydown = (e) => { if (e.key === 'Enter') $('#f-apply').click(); };
    $('#exp').onclick = () => exportSheets('sales-requests', { Requests: [['Number', 'SO ref', 'Customer', 'Product', 'Description', 'Type', 'Qty', 'Delivery', 'Expected', 'Priority', 'Status'], ...data.requests.map((r) => [r.number, r.sales_order_ref, r.customer, r.product_code, r.product_desc, r.product_type, r.qty, r.delivery_date, r.expected_completion, r.priority, r.status])] });
    if ($('#new-sr')) $('#new-sr').onclick = () => openRequestForm();
    $$('[data-edit]').forEach((b) => (b.onclick = () => openRequestForm(data.requests.find((r) => +r.id === +b.dataset.edit))));
    $$('[data-plan]').forEach((b) => (b.onclick = async () => { b.disabled = true; try { const r = await Api.post(`/sales-requests/${b.dataset.plan}/plan`, {}); location.hash = `#/plans/${r.plan_id}`; } catch (e) { toast(e.message, true); b.disabled = false; } }));
  };

  function openRequestForm(r) {
    const fps = meta().finished_products;
    const body = `<div class="form-grid">
      ${field('Sales request number', 'number', 'text', r ? r.number : 'automatic', 'disabled')}
      ${field('Sales order reference', 'sales_order_ref', 'text', r ? r.sales_order_ref : '')}
      ${field('Customer name', 'customer', 'text', r ? r.customer : '', 'required')}
      <label>Finished product code<input name="product_code" list="fp-list" value="${esc(r ? r.product_code : '')}" required ${r ? 'disabled' : ''} placeholder="e.g. MSPGP110" autocomplete="off"><datalist id="fp-list">${fps.map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('')}</datalist></label>
      <label>Finished product description<input name="product_desc" value="${esc(r ? r.product_desc : '')}" readonly placeholder="filled from the Finished Product list"></label>
      ${selectField('Genset or Canopy', 'product_type', options([{ id: 'GENSET', name: 'Genset' }, { id: 'CANOPY', name: 'Canopy' }], r ? r.product_type : 'GENSET'))}
      ${field('Required quantity', 'qty', 'number', r ? r.qty : 20, 'min="1" step="1" required')}
      ${field('Requested delivery date', 'delivery_date', 'date', r ? r.delivery_date : '')}
      ${selectField('Priority', 'priority', options([{ id: 'LOW', name: 'Low' }, { id: 'NORMAL', name: 'Normal' }, { id: 'HIGH', name: 'High' }, { id: 'URGENT', name: 'Urgent' }], r ? r.priority : 'NORMAL'))}
      ${r ? selectField('Status', 'status', options([{ id: 'SUBMITTED', name: 'Submitted' }, { id: 'PLANNED', name: 'Planned' }, { id: 'APPROVED', name: 'Approved' }, { id: 'IN_PROGRESS', name: 'In progress' }, { id: 'COMPLETED', name: 'Completed' }, { id: 'CANCELLED', name: 'Cancelled' }], r.status)) : ''}
      ${textarea('Remarks', 'remarks', r ? r.remarks : '')}
      ${r ? '' : '<label class="check full"><input type="checkbox" name="consider_inventory"> Net the requirement against available semi-finished inventory (default: produce everything from scratch, zero opening stock)</label>'}
    </div><p class="hint">Codes come from the workbook's Finished Product worksheet (${fps.length} products). On submit the full multi-level BOM is exploded and a proposed production plan with an expected completion date is generated for the planner.</p>`;
    const form = modal(r ? 'Edit sales request' : 'New sales production request', body, async (v) => {
      if (r) { await Api.put(`/sales-requests/${r.id}`, { sales_order_ref: v.sales_order_ref, customer: v.customer, qty: +v.qty, delivery_date: v.delivery_date || null, priority: v.priority, remarks: v.remarks, status: v.status }); toast('Request updated'); V.sales(); return; }
      const res = await Api.post('/sales-requests', { sales_order_ref: v.sales_order_ref, customer: v.customer, product_code: v.product_code.trim().toUpperCase(), product_type: v.product_type, qty: +v.qty, delivery_date: v.delivery_date || null, priority: v.priority, remarks: v.remarks, consider_inventory: !!v.consider_inventory });
      if (res.plan_id) { toast(`Request ${res.number} submitted — proposed plan generated`); location.hash = `#/plans/${res.plan_id}`; }
      else { toast(`Request ${res.number} saved, but the plan could not be generated: ${res.plan_error}`, true); V.sales(); }
    }, { submitLabel: r ? 'Save' : 'Submit to planning' });
    const pc = form.querySelector('[name=product_code]');
    const sync = () => { const p = fps.find((x) => x.code === pc.value.trim().toUpperCase()); form.querySelector('[name=product_desc]').value = p ? p.name : ''; if (p) form.querySelector('[name=product_type]').value = p.product_type; };
    pc.addEventListener('input', sync); sync();
  }

  // ---------------------------------------------------------------- plans list
  V.plans = async function () {
    setCrumbs('<b>Production Plans</b>');
    const data = await Api.get('/plans');
    const cols = [
      { label: 'Plan', fmt: (p) => `<a href="#/plans/${p.id}"><b>${esc(p.sr_number)}</b> v${p.version}</a><div class="tiny muted">${esc(p.customer)}</div>` },
      { label: 'Finished product', fmt: (p) => `<b>${esc(p.product_code)}</b> × ${fmtNum(p.qty, 0)}` },
      { label: 'Start', fmt: (p) => fmtDate(p.start_date) },
      { label: 'Baseline completion', fmt: (p) => fmtDate(p.baseline_completion) },
      { label: 'Expected completion', fmt: (p) => `${fmtDate(p.expected_completion)} ${p.baseline_completion && p.expected_completion > p.baseline_completion ? `<span class="badge bad">+${daysBetween(p.baseline_completion, p.expected_completion)}d</span>` : p.baseline_completion && p.expected_completion < p.baseline_completion ? '<span class="badge good">early</span>' : ''}` },
      { label: 'Requested delivery', fmt: (p) => `${fmtDate(p.delivery_date)} ${p.delivery_date && p.expected_completion > p.delivery_date ? '<span class="badge bad">late</span>' : ''}` },
      { label: 'Bottleneck', fmt: (p) => esc(p.bottleneck || '—') },
      { label: 'Stock netting', fmt: (p) => (+p.consider_inventory ? '<span class="badge info">net of stock</span>' : '<span class="badge">from scratch</span>') },
      { label: 'Status', fmt: (p) => statusBadge(p.status) },
    ];
    $('#view').innerHTML = `<div class="card-head"><div><h1>Production plans</h1><div class="muted small">Proposed plans wait in the planning queue until the Production Planner approves them. Approved plans release work orders to every section.</div></div></div>${table(cols, data.plans, { empty: 'No plans yet — submit a sales request.' })}`;
  };

  // ---------------------------------------------------------------- plan detail
  V.planDetail = async function (id, tab) {
    const d = await Api.get(`/plans/${id}`);
    const p = d.plan, s = p.summary || {};
    setCrumbs(`<a href="#/plans">Production Plans</a> › <b>${esc(p.sr_number)} v${p.version}</b> · ${esc(p.product_code)} × ${fmtNum(p.qty, 0)} ${statusBadge(p.status)}`);
    const canApprove = window.can('plan.approve') && ['PROPOSED', 'SCENARIO'].includes(p.status);
    const canAdjust = window.can('plan.adjust') && !['SUPERSEDED', 'COMPLETED'].includes(p.status);
    setActions(`${canApprove ? `<button class="btn primary" id="approve">Approve plan</button>` : ''}${canAdjust ? `<button class="btn" id="adjust">Adjust schedule</button><button class="btn" id="scenario">Run scenario</button>` : ''}${canAdjust && ['PROPOSED', 'SCENARIO'].includes(p.status) ? `<button class="btn ghost danger" id="discard">Discard</button>` : ''}<button class="btn" id="export">Export</button><button class="btn ghost" onclick="window.print()">Print</button>`);
    const delay = p.baseline_completion && p.expected_completion ? daysBetween(p.baseline_completion, p.expected_completion) : 0;
    const ops = d.operations, orders = d.orders;
    const opsByOrder = {}; ops.forEach((o) => ((opsByOrder[o.order_id] = opsByOrder[o.order_id] || []).push(o)));
    const done = orders.filter((o) => o.status === 'COMPLETED').length;
    const tabList = [['overview', 'Overview'], ['bom', 'BOM explosion'], ['orders', `Production orders (${orders.length})`], ['sections', 'Section plans'], ['gantt', 'Timeline'], ['materials', `Materials (${d.materials.length})`], ['costing', 'Costing'], ['reports', `Daily reports (${d.reports.length})`]];
    const head = `
      <div class="card-head"><div><h1>${esc(p.product_code)} <span class="muted">× ${fmtNum(p.qty, 0)}</span> — ${esc(p.product_desc || '')}</h1>
        <div class="muted small">${esc(p.sr_number)} · ${esc(p.customer)} · requested delivery ${fmtDate(p.delivery_date)} · priority ${esc(p.priority)} · plan v${p.version} created ${fmtDateTime(p.created_at)} by ${esc(p.created_by)}${p.approved_at ? ` · approved ${fmtDateTime(p.approved_at)} by ${esc(p.approved_by)}` : ''} · ${+p.consider_inventory ? 'net of available semi-finished stock' : 'all semi-finished items produced from scratch (zero opening stock)'}</div></div></div>
      <div class="kpis">
        ${kpi('Expected finished goods date', fmtDate(p.expected_completion), p.delivery_date ? (p.expected_completion <= p.delivery_date ? `<span class="good">meets requested ${fmtDate(p.delivery_date)}</span>` : `<span class="bad">${daysBetween(p.delivery_date, p.expected_completion)} days after requested date</span>`) : '', delay > 0 ? 'bad' : 'accent')}
        ${kpi('Original approved date', fmtDate(p.baseline_completion), delay > 0 ? `<span class="bad">revised +${delay} calendar days (${s.delay_days ?? '?'} working)</span>` : delay < 0 ? '<span class="good">ahead of baseline</span>' : 'on baseline')}
        ${kpi('Lead time', s.lead_time_days != null ? `${s.lead_time_days} <span class="small muted">working days</span>` : '—', `start ${fmtDate(p.start_date)}`)}
        ${kpi('Bottleneck section', s.bottleneck ? esc(s.bottleneck.section) : '—', s.bottleneck ? esc(s.bottleneck.reason) : '', 'warn')}
        ${kpi('Production orders', `${done}/${orders.length}`, `${s.operations || ops.length} section operations · ${s.orders_covered_by_stock || 0} covered by stock`)}
        ${kpi('BOM material cost', p.cost_snapshot ? fmtMoney(p.cost_snapshot.material_cost_total) : '—', p.cost_snapshot ? `${fmtMoney(p.cost_snapshot.material_cost_per_unit)} per unit · ${p.cost_snapshot.flagged_components} flagged costs` : '')}
      </div>
      ${d.conflicts && d.conflicts.length ? `<div class="callout warn"><b>Capacity conflicts:</b> approving this plan would overload ${d.conflicts.length} section-day(s): ${d.conflicts.slice(0, 6).map((c) => `${esc(c.section)} ${fmtDate(c.date)} (${c.load_pct}%)`).join('; ')}${d.conflicts.length > 6 ? '…' : ''}. The scheduler already queued this plan behind approved work; adjust the start date or capacity if the date is not acceptable.</div>` : ''}
      ${(s.warnings || []).length ? `<details class="callout"><summary><b>${s.warnings.length} planning warning(s)</b> — data gaps the planner should review</summary><ul class="small">${s.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
      ${tabs(tabList, tab)}`;
    const view = $('#view');
    view.innerHTML = head + `<div id="tab-body"></div>`;
    $$('.tabs button', view).forEach((b) => (b.onclick = () => { location.hash = `#/plans/${id}/${b.dataset.tab}`; }));
    const body = $('#tab-body');
    const sectionName = (sid) => esc((secById(sid).name) || '');

    if (tab === 'overview') {
      const cp = p.critical_path || [];
      body.innerHTML = `<div class="grid two">
        <div class="card"><div class="card-head"><h2>Critical path</h2><span class="muted small">the chain of operations that sets the completion date</span></div>
          ${cp.length ? table([{ label: 'Item', fmt: (c) => `<b>${esc(c.item_code)}</b>` }, { label: 'Section', fmt: (c) => esc(c.section) }, { label: 'Start', fmt: (c) => fmtDate(c.start) }, { label: 'Finish', fmt: (c) => fmtDate(c.finish) }, { label: 'Days', cls: 'num', key: 'days' }, { label: 'Rate/day', cls: 'num', fmt: (c) => fmtNum(c.daily_capacity, 1) }], cp, { cls: 'compact' }) : '<div class="empty">No schedule.</div>'}
          <p class="hint">Cutting, base frame and panel work run in parallel; final assembly waits for every component. The date is not a sum of department lead times.</p></div>
        <div class="card"><div class="card-head"><h2>Section load for this plan</h2><span class="muted small">share of capacity used over the days each section works on it</span></div>
          ${window.Charts.hbars((s.utilisation || []).map((u) => ({ label: u.section, value: u.utilisation_pct, text: `${u.utilisation_pct}% · ${u.busy_days}d` })))}
          <p class="hint">Includes load from other approved plans in the same window, so capacity is never counted twice.</p></div>
      </div>
      <div class="card"><div class="card-head"><h2>Production orders & dependencies</h2></div>
        ${table([
          { label: 'Order', fmt: (o) => `<b>${esc(o.number)}</b>` }, { label: 'Level', cls: 'num', key: 'level' },
          { label: 'Item', fmt: (o) => `<b>${esc(o.item_code)}</b><div class="tiny muted">${esc(o.item_name || '')}</div>` },
          { label: 'Gross qty', cls: 'num', fmt: (o) => fmtNum(o.gross_qty, 1) }, { label: 'From stock', cls: 'num', fmt: (o) => fmtNum(o.inventory_used, 1) }, { label: 'To produce', cls: 'num', fmt: (o) => `<b>${fmtNum(o.net_qty, 1)}</b>` },
          { label: 'Completed', cls: 'num', fmt: (o) => fmtNum(o.completed_qty, 1) },
          { label: 'Route', fmt: (o) => (opsByOrder[o.id] || []).map((x) => `<span class="chip" title="${esc(x.capacity_source)}"><span class="dot" style="background:${x.color}"></span>${esc(x.section_name)}</span>`).join(' → ') || '<span class="muted">kit / purchased — no section work</span>' },
          { label: 'Planned', fmt: (o) => o.planned_start ? `${fmtDate(o.planned_start)} → ${fmtDate(o.planned_finish)}` : '—' },
          { label: 'Status', fmt: (o) => statusBadge(o.status) },
        ], orders, { rowClass: (o) => (+o.is_critical ? 'crit' : '') + (o.status === 'COMPLETED' ? ' done' : ''), cls: 'compact' })}
        <p class="hint">Rows highlighted in red are on the critical path. Required components are scheduled first; a parent order starts only after all of its child orders are complete.</p></div>`;
    }

    if (tab === 'bom') {
      const ex = await Api.get(`/bom/${encodeURIComponent(p.product_code)}/explode`, { qty: p.qty, inventory: +p.consider_inventory ? 1 : '' });
      const node = (n, depth = 0) => {
        const kids = n.children || [];
        const inner = `<span class="node"><span class="code">${esc(n.code)}</span><span class="muted">${esc(n.name || '')}</span><span class="badge ${n.type === 'FINISHED' ? 'accent' : n.type === 'KIT' ? '' : 'info'}">${esc(n.type)}</span><span class="chip">qty ${fmtNum(n.qty, 2)}</span>${n.qty_per != null ? `<span class="tiny muted">${fmtNum(n.qty_per, 3)} per parent</span>` : ''}${n.processes && n.processes.length ? `<span class="tiny">${n.processes.filter((x) => x.kind === 'LABOUR').map((x) => esc(sectionName(x.section_id))).join(' → ')}</span>` : ''}<span class="tiny muted">${n.material_count} material lines</span></span>`;
        return kids.length ? `<li><details ${depth < 2 ? 'open' : ''}><summary>${inner}</summary><ul>${kids.map((k) => node(k, depth + 1)).join('')}</ul></details></li>` : `<li>${inner}</li>`;
      };
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Multi-level BOM explosion for ${fmtNum(p.qty, 0)} × ${esc(p.product_code)}</h2><a class="small" href="#/bom/${encodeURIComponent(p.product_code)}">open BOM explorer</a></div>
        <p class="small muted">Levels follow the BOM worksheet (Parent Bom → Item/Resource). Semi-finished items become production orders with their own routing; raw materials become material requirements; labour (Process) rows become section operations. Status/phantom items are excluded so nothing is double counted.</p>
        <div class="tree"><ul>${node(ex.tree)}</ul></div>${ex.warnings.length ? `<div class="callout warn small">${ex.warnings.map(esc).join('<br>')}</div>` : ''}</div>`;
    }

    if (tab === 'orders') {
      const cols = [
        { label: 'Production order', fmt: (o) => `<b>${esc(o.number)}</b>` }, { label: 'Finished product', fmt: () => esc(p.product_code) },
        { label: 'Semi-finished item', fmt: (o) => `<b>${esc(o.item_code)}</b><div class="tiny muted">${esc(o.item_name || '')}</div>` },
        { label: 'Section', fmt: (o) => esc(o.section_name) }, { label: 'Required qty', cls: 'num', fmt: (o) => fmtNum(o.required_qty, 1) },
        { label: 'Daily capacity', cls: 'num', fmt: (o) => `<span title="${esc(o.capacity_source)}">${fmtNum(o.daily_capacity, 2)}</span>` },
        { label: 'Planned start', fmt: (o) => fmtDate(o.planned_start) }, { label: 'Planned finish', fmt: (o) => `${fmtDate(o.planned_finish)}${+o.delay_days > 0 ? ` <span class="badge bad">+${o.delay_days}d</span>` : ''}` },
        { label: 'Actual output', cls: 'num', fmt: (o) => `${fmtNum(o.good_qty, 1)}${+o.rejected_qty ? ` <span class="bad tiny">(${fmtNum(o.rejected_qty, 1)} rej)</span>` : ''}${+o.unreported_qty && !+o.good_qty ? ` <span class="badge warn" title="Scheduled before today but no daily report — assumed to plan">unreported ${fmtNum(o.unreported_qty, 0)}</span>` : ''}` },
        { label: 'Remaining', cls: 'num', fmt: (o) => fmtNum(o.remaining_qty, 1) }, { label: 'Progress', fmt: (o) => progress(o.progress_pct) }, { label: 'Status', fmt: (o) => statusBadge(o.status) },
      ];
      const rows = ops.map((o) => ({ ...o, number: (orders.find((x) => +x.id === +o.order_id) || {}).number }));
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Production plan — all section operations</h2><span class="muted small">Production order · item · section · required qty · daily capacity (productivity master) · planned start/finish · actual · remaining · status</span></div>${table(cols, rows, { rowClass: (o) => (+o.is_critical ? 'crit' : '') + (o.status === 'COMPLETED' ? ' done' : ''), cls: 'compact' })}</div>`;
    }

    if (tab === 'sections') {
      const bySec = {}; ops.forEach((o) => ((bySec[o.section_id] = bySec[o.section_id] || []).push(o)));
      const loadsByOp = {}; d.loads.forEach((l) => ((loadsByOp[l.op_id] = loadsByOp[l.op_id] || []).push(l)));
      const predOf = {}; d.op_deps.forEach((x) => (predOf[x.op_id] = x.depends_on));
      const opById = {}; ops.forEach((o) => (opById[o.id] = o));
      body.innerHTML = `<p class="small muted">A separate plan for every manufacturing section: what to produce, received from the previous section, awaiting, daily target and completion date. Supervisors enter actual output from the <a href="#/sections">section dashboards</a>.</p>` + meta().sections.filter((sec) => bySec[sec.id]).map((sec) => {
        const list = bySec[sec.id];
        return `<div class="card"><div class="card-head"><h2><span class="dot" style="background:${sec.color}"></span> ${esc(sec.name)} <span class="muted small">· ${esc(sec.department)}</span></h2><a class="btn sm" href="#/sections/${sec.id}">Section dashboard</a></div>
          ${table([
            { label: 'Item code', fmt: (o) => `<b>${esc(o.item_code)}</b><div class="tiny muted">${esc((orders.find((x) => +x.id === +o.order_id) || {}).item_name || '')}</div>` },
            { label: 'Required', cls: 'num', fmt: (o) => fmtNum(o.required_qty, 1) },
            { label: 'From previous section', fmt: (o) => { const pr = opById[predOf[o.id]]; return pr ? `${esc(pr.section_name)}<div class="tiny">received ${fmtNum(pr.good_qty, 1)} · awaiting ${fmtNum(Math.max(0, o.required_qty - pr.good_qty), 1)}</div>` : '<span class="muted">first operation</span>'; } },
            { label: 'Machine', fmt: (o) => esc(o.machine_name || o.machine_resource_code || '—') },
            { label: 'Daily target', cls: 'num', fmt: (o) => `<span title="${esc(o.capacity_source)}">${fmtNum(o.daily_capacity, 1)}</span>` },
            { label: 'Hours/unit', cls: 'num', fmt: (o) => fmtNum(o.hours_per_unit, 2) },
            { label: 'Schedule', fmt: (o) => (loadsByOp[o.id] || []).map((l) => `<span class="chip" title="${l.ldate}">${l.ldate.slice(5)}: ${fmtNum(l.qty, 1)}</span>`).join(' ') },
            { label: 'Planned completion', fmt: (o) => `${fmtDate(o.planned_finish)}${+o.delay_days > 0 ? ` <span class="badge bad">+${o.delay_days}d</span>` : ''}` },
            { label: 'Good / Rej / Rework', cls: 'num', fmt: (o) => `${fmtNum(o.good_qty, 1)} / ${fmtNum(o.rejected_qty, 1)} / ${fmtNum(o.rework_qty, 1)}` },
            { label: 'Remaining', cls: 'num', fmt: (o) => `<b>${fmtNum(o.remaining_qty, 1)}</b>` }, { label: 'Status', fmt: (o) => statusBadge(o.status) },
          ], list, { cls: 'compact', rowClass: (o) => (+o.is_critical ? 'crit' : '') })}</div>`;
      }).join('');
    }

    if (tab === 'gantt') {
      const mode = V.planDetail.ganttMode || 'order';
      const rows = [];
      const orderById = {}; orders.forEach((o) => (orderById[o.id] = o));
      const sorted = [...ops].sort((a, b) => mode === 'order' ? (orderById[a.order_id].level - orderById[b.order_id].level) || (a.order_id - b.order_id) || (a.seq - b.seq) : (secById(a.section_id).seq - secById(b.section_id).seq) || (a.planned_start || '').localeCompare(b.planned_start || ''));
      sorted.forEach((o) => rows.push({ id: o.id, group: mode === 'order' ? `${orderById[o.order_id].number} · ${o.item_code} × ${fmtNum(o.required_qty, 0)}` : o.section_name, label: mode === 'order' ? o.section_name : `${o.item_code}`, sub: mode === 'order' ? '' : orderById[o.order_id].number, start: o.planned_start, finish: o.planned_finish, baseStart: o.baseline_start, baseFinish: o.baseline_finish, color: o.color, crit: +o.is_critical, pct: o.progress_pct, status: o.status, title: `${o.item_code} @ ${o.section_name} · ${fmtNum(o.required_qty, 0)} units at ${fmtNum(o.daily_capacity, 1)}/day` }));
      const deps = d.op_deps.map((x) => [x.depends_on, x.op_id]);
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Manufacturing timeline</h2><div class="row"><span class="small muted">Red outline = critical path · dashed = original approved plan · green line = progress</span><select id="gmode"><option value="order" ${mode === 'order' ? 'selected' : ''}>Group by production order</option><option value="section" ${mode === 'section' ? 'selected' : ''}>Group by section</option></select></div></div>
        ${window.Charts.gantt(rows, { todayStr: today(), deps: mode === 'order' ? deps : [] })}</div>`;
      $('#gmode').onchange = (e) => { V.planDetail.ganttMode = e.target.value; V.planDetail(id, 'gantt'); };
    }

    if (tab === 'materials') {
      const groups = {}; d.materials.forEach((m) => { const g = groups[m.component_code] = groups[m.component_code] || { ...m, qty_required: 0, ext_cost: 0, issued_qty: 0, parents: new Set() }; g.qty_required += +m.qty_required; g.ext_cost += +m.ext_cost; g.issued_qty += +m.issued_qty; g.parents.add(m.parent_code); });
      const rows = Object.values(groups).sort((a, b) => b.ext_cost - a.ext_cost);
      const cols = [{ label: 'Component', fmt: (m) => `<b>${esc(m.component_code)}</b><div class="tiny muted">${esc(m.component_name || '')}</div>` }, { label: 'Used in', fmt: (m) => [...m.parents].map(esc).join(', ') }, { label: 'Cost group', key: 'cost_group' }, { label: 'Warehouse', key: 'warehouse' }, { label: 'Required', cls: 'num', fmt: (m) => `${fmtNum(m.qty_required, 3)} ${esc(m.unit || '')}` }, { label: 'Issued', cls: 'num', fmt: (m) => fmtNum(m.issued_qty, 3) }, { label: 'Unit cost', cls: 'num', fmt: (m) => fmtMoney(m.unit_cost, 2) }, { label: 'Extended cost', cls: 'num', fmt: (m) => fmtMoney(m.ext_cost, 2) }, { label: 'Cost flag', fmt: (m) => (m.cost_flag || '').split(',').filter(Boolean).map(statusBadge).join(' ') }];
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Raw material & purchased component requirements</h2><div class="row"><span class="muted small">${rows.length} components · total ${fmtMoney(rows.reduce((s, r) => s + r.ext_cost, 0))}</span><button class="btn sm" id="exp-mat">Export</button></div></div>${table(cols, rows, { cls: 'compact' })}<p class="hint">Quantities are for the net production quantity of each order. Flags: ZERO_COST = no price in the BOM sheet; OUTDATED = cost date older than the configured threshold; PRICE_MOVED = latest unit price differs from the BOM standard by more than 5%; INCONSISTENT = different unit costs across BOM lines.</p></div>`;
      $('#exp-mat').onclick = () => exportSheets(`materials-${p.sr_number}`, { Materials: [['Component', 'Name', 'Used in', 'Cost group', 'Warehouse', 'Required', 'Unit', 'Issued', 'Unit cost', 'Extended cost', 'Flags'], ...rows.map((m) => [m.component_code, m.component_name, [...m.parents].join(' '), m.cost_group, m.warehouse, m.qty_required, m.unit, m.issued_qty, m.unit_cost, m.ext_cost, m.cost_flag])] });
    }

    if (tab === 'costing') {
      if (!window.can('cost.view')) { body.innerHTML = '<div class="callout">Your role cannot view costing.</div>'; return; }
      const c = await Api.get(`/plans/${id}/cost`);
      body.innerHTML = V.costingPanel(c.snapshot, c.current, c.variance, p);
    }

    if (tab === 'reports') {
      body.innerHTML = `<div class="card"><div class="card-head"><h2>Daily production reports for this plan</h2></div>${table([{ label: 'Date', fmt: (r) => fmtDate(r.rdate) }, { label: 'Section', fmt: (r) => sectionName(r.section_id) }, { label: 'Item', fmt: (r) => esc((ops.find((o) => +o.id === +r.op_id) || {}).item_code || '') }, { label: 'Planned', cls: 'num', fmt: (r) => fmtNum(r.planned_qty, 1) }, { label: 'Good', cls: 'num', fmt: (r) => fmtNum(r.good_qty, 1) }, { label: 'Rejected', cls: 'num', fmt: (r) => fmtNum(r.rejected_qty, 1) }, { label: 'Rework', cls: 'num', fmt: (r) => fmtNum(r.rework_qty, 1) }, { label: 'Achievement', cls: 'num', fmt: (r) => +r.planned_qty ? fmtPct((100 * r.good_qty) / r.planned_qty, 0) : '—' }, { label: 'Downtime (min)', cls: 'num', fmt: (r) => fmtNum(r.downtime_min, 0) }, { label: 'Delay reason', key: 'delay_reason' }, { label: 'Remarks', key: 'remarks' }, { label: 'Supervisor', key: 'supervisor' }], d.reports, { cls: 'compact', empty: 'No daily reports yet.' })}</div>`;
    }

    // actions
    if ($('#approve')) $('#approve').onclick = async () => { if (!(await confirm('Approve production plan', `Approve plan v${p.version} for ${fmtNum(p.qty, 0)} × ${esc(p.product_code)}? Work orders are released to all sections and the expected completion date ${fmtDate(p.expected_completion)} becomes the baseline. The schedule is re-checked against other approved plans first.`, 'Approve'))) return; try { await Api.post(`/plans/${id}/approve`, {}); toast('Plan approved — work orders released'); V.planDetail(id, 'overview'); } catch (e) { toast(e.message, true); } };
    if ($('#discard')) $('#discard').onclick = async () => { if (!(await confirm('Discard plan', 'Discard this proposed plan / scenario? The sales request stays in the queue.', 'Discard', true))) return; try { await Api.del(`/plans/${id}`); toast('Plan discarded'); location.hash = '#/sales'; } catch (e) { toast(e.message, true); } };
    if ($('#adjust')) $('#adjust').onclick = () => openAdjust(d);
    if ($('#scenario')) $('#scenario').onclick = () => modal('Run a planning scenario', `<div class="form-grid">${field('Start date', 'start_date', 'date', p.start_date)}${field('Quantity', 'qty', 'number', p.qty, 'min="1"')}<label class="check"><input type="checkbox" name="consider_inventory" ${+p.consider_inventory ? 'checked' : ''}> Net against available semi-finished inventory</label>${textarea('Scenario notes', 'notes', '')}</div><p class="hint">A scenario is a separate plan version that is scheduled around the approved plans but does not reserve capacity. Approve it to make it the active plan.</p>`, async (v) => { const r = await Api.post(`/sales-requests/${p.sales_request_id}/plan`, { start_date: v.start_date, qty: +v.qty, consider_inventory: !!v.consider_inventory, scenario: true, notes: v.notes }); toast('Scenario generated'); location.hash = `#/plans/${r.plan_id}`; }, { submitLabel: 'Generate scenario' });
    $('#export').onclick = () => exportSheets(`plan-${p.sr_number}-v${p.version}`, {
      Summary: [['Plan', p.sr_number], ['Product', p.product_code], ['Qty', p.qty], ['Start', p.start_date], ['Baseline completion', p.baseline_completion], ['Expected completion', p.expected_completion], ['Lead time (working days)', s.lead_time_days], ['Bottleneck', s.bottleneck ? s.bottleneck.section : ''], ['Status', p.status]],
      Orders: [['Order', 'Level', 'Item', 'Name', 'Gross', 'From stock', 'Net', 'Completed', 'Planned start', 'Planned finish', 'Status'], ...orders.map((o) => [o.number, o.level, o.item_code, o.item_name, o.gross_qty, o.inventory_used, o.net_qty, o.completed_qty, o.planned_start, o.planned_finish, o.status])],
      Operations: [['Order', 'Item', 'Section', 'Required', 'Daily capacity', 'Capacity source', 'Planned start', 'Planned finish', 'Baseline finish', 'Good', 'Rejected', 'Rework', 'Remaining', 'Status', 'Critical'], ...ops.map((o) => [(orders.find((x) => +x.id === +o.order_id) || {}).number, o.item_code, o.section_name, o.required_qty, o.daily_capacity, o.capacity_source, o.planned_start, o.planned_finish, o.baseline_finish, o.good_qty, o.rejected_qty, o.rework_qty, o.remaining_qty, o.status, o.is_critical ? 'yes' : ''])],
      Materials: [['Component', 'Name', 'Parent', 'Qty per', 'Required', 'Unit', 'Unit cost', 'Extended cost', 'Cost group', 'Flags'], ...d.materials.map((m) => [m.component_code, m.component_name, m.parent_code, m.qty_per, m.qty_required, m.unit, m.unit_cost, m.ext_cost, m.cost_group, m.cost_flag])],
    });
  };

  function openAdjust(d) {
    const p = d.plan;
    const rows = d.operations.filter((o) => o.status !== 'COMPLETED');
    const body = `<div class="form-grid">${field('Plan start date', 'start_date', 'date', p.start_date, p.status === 'IN_PROGRESS' ? 'disabled title="Work has started: only remaining operations are rescheduled"' : '')}</div>
      <h3>Capacity / machine overrides per operation</h3><div class="table-wrap" style="max-height:50vh"><table class="compact"><thead><tr><th>Item</th><th>Section</th><th class="num">Required</th><th class="num">Daily capacity</th><th>Override (units/day)</th><th>Machine</th></tr></thead><tbody>
      ${rows.map((o) => `<tr><td>${esc(o.item_code)}</td><td>${esc(o.section_name)}</td><td class="num">${fmtNum(o.required_qty, 1)}</td><td class="num" title="${esc(o.capacity_source)}">${fmtNum(o.daily_capacity, 2)}</td><td><input name="cap_${o.id}" type="number" step="0.01" min="0" placeholder="keep" style="width:110px"></td><td><select name="mach_${o.id}" style="width:150px"><option value="">—</option>${(meta().machines || []).filter((m) => +m.section_id === +o.section_id).map((m) => `<option value="${m.id}" ${+o.machine_id === +m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
      ${field('Reason for the change (audit trail)', 'reason', 'text', '', 'required')}<p class="hint">The schedule is recalculated with finite capacity; conflicts with approved plans are shown on the plan page before you approve.</p>`;
    modal('Adjust schedule', body, async (v) => {
      const changes = { start_date: v.start_date, operations: [] };
      rows.forEach((o) => { const cap = v[`cap_${o.id}`]; const mach = v[`mach_${o.id}`]; if (cap || (mach !== '' && +mach !== +(o.machine_id || 0))) changes.operations.push({ id: o.id, daily_capacity: cap ? +cap : undefined, machine_id: mach === '' ? undefined : +mach, reason: v.reason }); });
      await Api.post(`/plans/${p.id}/adjust`, changes); toast('Schedule recalculated'); V.planDetail(p.id, 'overview');
    }, { submitLabel: 'Recalculate', wide: true });
  }

  // ---------------------------------------------------------------- BOM explorer
  V.bom = async function (code) {
    setCrumbs(`<a href="#/costing">BOM Costing</a> › <b>BOM explorer ${esc(code)}</b>`);
    const qty = V.bom.qty || 1;
    const ex = await Api.get(`/bom/${encodeURIComponent(code)}/explode`, { qty });
    const node = (n, depth = 0) => { const kids = n.children || []; const inner = `<span class="node"><span class="code">${esc(n.code)}</span><span class="muted">${esc(n.name || '')}</span><span class="badge">${esc(n.type)}</span><span class="chip">qty ${fmtNum(n.qty, 3)}</span>${(n.processes || []).filter((x) => x.kind === 'LABOUR').length ? `<span class="tiny">${n.processes.filter((x) => x.kind === 'LABOUR').map((x) => `${esc(secById(x.section_id).name)} ${fmtNum(x.hours_per_unit, 2)}h`).join(' → ')}</span>` : ''}<span class="tiny muted">${n.material_count} materials</span></span>`; return kids.length ? `<li><details ${depth < 2 ? 'open' : ''}><summary>${inner}</summary><ul>${kids.map((k) => node(k, depth + 1)).join('')}</ul></details></li>` : `<li>${inner}</li>`; };
    $('#view').innerHTML = `<div class="card-head"><h1>BOM explorer — ${esc(code)}</h1><div class="row"><label>Quantity<input id="bq" type="number" min="1" value="${qty}" style="width:90px"></label><a class="btn" href="#/costing/${encodeURIComponent(code)}">Costing</a></div></div>
      <div class="card"><div class="tree"><ul>${node(ex.tree)}</ul></div></div>
      <div class="card"><h2>Aggregated material requirements (${ex.materials.length})</h2>${table([{ label: 'Component', fmt: (m) => `<b>${esc(m.code)}</b><div class="tiny muted">${esc(m.name)}</div>` }, { label: 'Used in', fmt: (m) => Object.keys(m.parents).map(esc).join(', ') }, { label: 'Cost group', key: 'cost_group' }, { label: 'Qty', cls: 'num', fmt: (m) => `${fmtNum(m.qty, 3)} ${esc(m.unit || '')}` }, { label: 'Unit cost', cls: 'num', fmt: (m) => fmtMoney(m.unit_cost, 2) }, { label: 'Extended', cls: 'num', fmt: (m) => fmtMoney(m.ext_cost, 2) }, { label: 'Flags', fmt: (m) => (m.flags || []).map(statusBadge).join(' ') }], ex.materials.sort((a, b) => b.ext_cost - a.ext_cost), { cls: 'compact' })}</div>`;
    $('#bq').onchange = (e) => { V.bom.qty = +e.target.value || 1; V.bom(code); };
  };

  // ---------------------------------------------------------------- planning board
  V.board = async function () {
    setCrumbs('<b>Planning Board</b>');
    const f = V.board.f = V.board.f || { include_proposed: '', plan_id: '', mode: 'section' };
    const b = await Api.get('/board', { include_proposed: f.include_proposed, plan_id: f.plan_id });
    setActions(`<button class="btn" id="exp-board">Export</button>`);
    const planById = {}; b.plans.forEach((p) => (planById[p.id] = p));
    const rows = [...b.operations].filter((o) => o.status !== 'COMPLETED' || o.planned_finish >= window.UI.addDays(today(), -14)).sort((a, b2) => f.mode === 'section' ? (secById(a.section_id).seq - secById(b2.section_id).seq) || (a.planned_start || '').localeCompare(b2.planned_start || '') : (a.plan_id - b2.plan_id) || a.level - b2.level || a.order_id - b2.order_id || a.seq - b2.seq)
      .map((o) => ({ id: o.id, group: f.mode === 'section' ? secById(o.section_id).name : `${o.sr_number} · ${o.product_code} × ${fmtNum((planById[o.plan_id] || {}).qty, 0)} (${o.plan_status})`, label: f.mode === 'section' ? `${o.item_code}` : `${secById(o.section_id).name}`, sub: f.mode === 'section' ? o.sr_number : o.item_code, start: o.planned_start, finish: o.planned_finish, baseStart: o.baseline_start, baseFinish: o.baseline_finish, color: secById(o.section_id).color, crit: +o.is_critical, pct: o.required_qty ? (100 * o.good_qty) / o.required_qty : 0, status: o.status, title: `${o.item_code} (${o.order_number}) @ ${secById(o.section_id).name} · ${fmtNum(o.required_qty, 0)} at ${fmtNum(o.daily_capacity, 1)}/day · ${o.machine_name || ''}` }));
    const from = window.UI.addDays(today(), -7);
    const overloaded = b.loads.filter((l) => l.utilisation_pct > 100.5 && l.ldate >= today());
    const delayed = b.plans.filter((p) => p.baseline_completion && p.expected_completion > p.baseline_completion);
    $('#view').innerHTML = `<div class="card-head"><div><h1>Interactive planning board</h1><div class="muted small">Gantt by section or by production order, machine assignments, section utilisation, bottlenecks and delayed orders across every approved plan.</div></div>
      <div class="row"><label class="check small"><input type="checkbox" id="inc-prop" ${f.include_proposed ? 'checked' : ''}> show proposed plans & scenarios</label><select id="plan-sel">${options(b.plans, f.plan_id, { allLabel: 'All plans', label: (p) => `${p.sr_number} · ${p.product_code} × ${fmtNum(p.qty, 0)}` })}</select><select id="mode"><option value="section" ${f.mode === 'section' ? 'selected' : ''}>By section</option><option value="order" ${f.mode === 'order' ? 'selected' : ''}>By production order</option></select></div></div>
      <div class="kpis">${kpi('Plans on the board', b.plans.length, `${b.plans.filter((p) => p.status === 'IN_PROGRESS').length} in progress`)}${kpi('Delayed plans', delayed.length, delayed.map((p) => `${esc(p.sr_number)} +${daysBetween(p.baseline_completion, p.expected_completion)}d`).join(', ') || 'all on baseline', delayed.length ? 'bad' : 'good')}${kpi('Capacity conflicts', overloaded.length, overloaded.length ? `${esc(secById(overloaded[0].section_id).name)} ${overloaded[0].ldate} …` : 'no section-day over 100%', overloaded.length ? 'bad' : 'good')}${kpi('Operations shown', rows.length, '')}</div>
      <div class="card"><div class="card-head"><h2>Section utilisation — next 3 weeks</h2><span class="muted small">% of section capacity committed (approved plans only); red = over capacity</span></div>${window.Charts.heat(b.sections, b.loads, from, 28)}</div>
      <div class="card"><div class="card-head"><h2>Gantt</h2><span class="muted small">red outline = critical path · dashed = baseline · click a bar's plan to adjust</span></div>${window.Charts.gantt(rows, { todayStr: today(), deps: f.mode === 'order' ? b.op_deps.map((x) => [x.depends_on, x.op_id]) : [] })}</div>
      <div class="card"><div class="card-head"><h2>Plans</h2></div>${table([{ label: 'Plan', fmt: (p) => `<a href="#/plans/${p.id}"><b>${esc(p.sr_number)}</b></a> ${statusBadge(p.status)}` }, { label: 'Product', fmt: (p) => `${esc(p.product_code)} × ${fmtNum(p.qty, 0)}` }, { label: 'Customer', key: 'customer' }, { label: 'Start', fmt: (p) => fmtDate(p.start_date) }, { label: 'Baseline', fmt: (p) => fmtDate(p.baseline_completion) }, { label: 'Expected', fmt: (p) => `${fmtDate(p.expected_completion)} ${p.baseline_completion && p.expected_completion > p.baseline_completion ? `<span class="badge bad">+${daysBetween(p.baseline_completion, p.expected_completion)}d</span>` : ''}` }, { label: 'Requested', fmt: (p) => `${fmtDate(p.delivery_date)} ${p.delivery_date && p.expected_completion > p.delivery_date ? '<span class="badge bad">late</span>' : ''}` }, { label: 'Bottleneck', fmt: (p) => esc(secById(p.bottleneck_section_id).name || '—') }, { label: '', fmt: (p) => window.can('plan.adjust') && !['COMPLETED', 'SUPERSEDED'].includes(p.status) ? `<a class="btn sm" href="#/plans/${p.id}/gantt">Adjust</a>` : '' }], b.plans, { cls: 'compact' })}</div>`;
    $('#inc-prop').onchange = (e) => { f.include_proposed = e.target.checked ? 1 : ''; V.board(); };
    $('#plan-sel').onchange = (e) => { f.plan_id = e.target.value; V.board(); };
    $('#mode').onchange = (e) => { f.mode = e.target.value; V.board(); };
    $('#exp-board').onclick = () => exportSheets('planning-board', { Operations: [['Plan', 'Product', 'Order', 'Item', 'Section', 'Machine', 'Required', 'Good', 'Daily capacity', 'Planned start', 'Planned finish', 'Baseline finish', 'Status', 'Critical'], ...b.operations.map((o) => [o.sr_number, o.product_code, o.order_number, o.item_code, secById(o.section_id).name, o.machine_name, o.required_qty, o.good_qty, o.daily_capacity, o.planned_start, o.planned_finish, o.baseline_finish, o.status, o.is_critical ? 'yes' : ''])], Loads: [['Section', 'Date', 'Minutes', 'Utilisation %'], ...b.loads.map((l) => [secById(l.section_id).name, l.ldate, l.minutes, l.utilisation_pct])] });
  };
})();
