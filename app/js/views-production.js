/* views-production.js — section dashboards with daily production entry, production manager overview, inventory. */
(function () {
  'use strict';
  const { $, $$, esc, toast, modal, table, kpi, fmtNum, fmtMoney, fmtPct, fmtDate, fmtDateTime, today, statusBadge, options, field, selectField, textarea, progress, exportSheets, addDays } = window.UI;
  const V = window.Views = window.Views || {};
  const Api = window.Api;
  const meta = () => window.AppState.meta || { sections: [] };

  // ---------------------------------------------------------------- all sections (Production Manager)
  V.sections = async function () {
    setCrumbs('<b>Section Dashboards</b>');
    const b = await Api.get('/board');
    const user = window.AppState.user;
    const byActivity = {};
    meta().sections.forEach((s) => ((byActivity[s.activity] = byActivity[s.activity] || []).push(s)));
    const opsBySec = {}; b.operations.forEach((o) => ((opsBySec[o.section_id] = opsBySec[o.section_id] || []).push(o)));
    const loadToday = {}; b.loads.filter((l) => l.ldate === today()).forEach((l) => (loadToday[l.section_id] = l));
    const cards = Object.entries(window.Seeder_ACTIVITIES || meta().activities || {}).map(([k, label]) => {
      const secs = byActivity[k] || [];
      if (!secs.length) return '';
      return `<div class="card"><h2>${esc(label)}</h2><div class="stack" style="gap:.5rem">${secs.map((s) => {
        const ops = opsBySec[s.id] || [];
        const open = ops.filter((o) => o.status !== 'COMPLETED');
        const req = open.reduce((a, o) => a + +o.required_qty - +o.good_qty, 0);
        const late = open.filter((o) => +o.delay_days > 0).length;
        const mine = user.section_id && +user.section_id === +s.id;
        return `<a href="#/sections/${s.id}" class="row between" style="padding:.45rem .6rem;border:1px solid var(--border);border-radius:8px;color:inherit${mine ? ';outline:2px solid var(--accent)' : ''}"><span><span class="dot" style="background:${s.color}"></span> <b>${esc(s.name)}</b><div class="tiny muted">${esc(s.site || '')} · ${s.lines} line(s) · ${s.staff} staff · ${s.minutes_per_day} min/day</div></span><span class="right small">${open.length} open op(s) · ${fmtNum(req, 0)} units remaining${late ? ` · <span class="bad">${late} late</span>` : ''}<div class="tiny muted">today ${loadToday[s.id] ? `${loadToday[s.id].utilisation_pct}% loaded` : 'idle'}</div></span></a>`;
      }).join('')}</div></div>`;
    }).join('');
    $('#view').innerHTML = `<div class="card-head"><div><h1>Manufacturing sections</h1><div class="muted small">Every section has its own production dashboard and daily reporting. The Production Manager sees all sections together here.</div></div></div><div class="grid">${cards}</div>`;
  };

  // ---------------------------------------------------------------- one section
  V.sectionBoard = async function (id) {
    const date = V.sectionBoard.date || today();
    const b = await Api.get(`/sections/${id}/board`, { date });
    const s = b.section;
    setCrumbs(`<a href="#/sections">Sections</a> › <b>${esc(s.name)}</b>`);
    setActions(`<label class="row small">Date <input type="date" id="sb-date" value="${date}" style="width:150px"></label><button class="btn" id="exp-sec">Export</button>`);
    const open = b.operations.filter((o) => o.status !== 'COMPLETED');
    const todayTarget = b.operations.reduce((a, o) => a + +o.today_target, 0), todayGood = b.operations.reduce((a, o) => a + +o.today_good, 0);
    const canReport = window.can('production.report') && (!window.AppState.user.section_id || +window.AppState.user.section_id === +id);
    const cols = [
      { label: 'Production order', fmt: (o) => `<b>${esc(o.order_number)}</b><div class="tiny muted">${esc(o.sr_number)} · ${esc(o.product_code)} · ${esc(o.customer)}</div>` },
      { label: 'Item', fmt: (o) => `<b>${esc(o.item_code)}</b><div class="tiny muted">${esc(o.item_name || '')}</div>` },
      { label: 'Machine', fmt: (o) => esc(o.machine_name || o.machine_resource_code || '—') },
      { label: 'Required', cls: 'num', fmt: (o) => fmtNum(o.required_qty, 1) },
      { label: 'Received from previous', cls: 'num', fmt: (o) => (+o.has_predecessor ? `${fmtNum(o.received_from_predecessor, 1)}<div class="tiny muted">awaiting ${fmtNum(o.awaiting_from_predecessor, 1)}</div>` : '<span class="muted">first op</span>') },
      { label: 'Available to process', cls: 'num', fmt: (o) => fmtNum(o.available_to_process, 1) },
      { label: 'Daily target', cls: 'num', fmt: (o) => `<span title="${esc(o.capacity_source)}">${fmtNum(o.daily_capacity, 1)}</span>` },
      { label: `Target ${date.slice(5)}`, cls: 'num', fmt: (o) => fmtNum(o.today_target, 1) },
      { label: `Good ${date.slice(5)}`, cls: 'num', fmt: (o) => fmtNum(o.today_good, 1) },
      { label: 'Good / Rej / Rework', cls: 'num', fmt: (o) => `${fmtNum(o.good_qty, 1)} / ${fmtNum(o.rejected_qty, 1)} / ${fmtNum(o.rework_qty, 1)}` },
      { label: 'Remaining', cls: 'num', fmt: (o) => `<b>${fmtNum(o.remaining_qty, 1)}</b>` },
      { label: 'Planned finish', fmt: (o) => `${fmtDate(o.planned_finish)}${+o.delay_days > 0 ? ` <span class="badge bad">+${o.delay_days}d</span>` : ''}` },
      { label: 'Progress', fmt: (o) => progress(o.required_qty ? (100 * o.good_qty) / o.required_qty : 0) },
      { label: 'Status', fmt: (o) => statusBadge(o.status) },
      { label: '', fmt: (o) => (canReport && o.status !== 'COMPLETED' ? `<button class="btn sm primary" data-report="${o.id}">Report output</button>` : '') },
    ];
    $('#view').innerHTML = `<div class="card-head"><div><h1><span class="dot" style="background:${s.color}"></span> ${esc(s.name)}</h1><div class="muted small">${esc(s.department)} · ${esc(s.site || '')} · ${s.lines} line(s)/machine(s) · ${s.staff} staff · ${s.minutes_per_day} productive minutes per day${+s.allow_partial_transfer ? ' · partial transfers to the next section allowed' : ''}</div></div></div>
      <div class="kpis">${kpi('Open operations', open.length, `${b.operations.length - open.length} completed`)}${kpi(`Target for ${fmtDate(date)}`, fmtNum(todayTarget, 1), 'units scheduled')}${kpi('Reported good', fmtNum(todayGood, 1), todayTarget ? `${fmtPct((100 * todayGood) / todayTarget, 0)} achievement` : '', todayTarget && todayGood / todayTarget < 0.9 ? 'warn' : 'good')}${kpi('Units remaining', fmtNum(open.reduce((a, o) => a + o.remaining_qty, 0), 1), 'across open orders')}${kpi('Late operations', open.filter((o) => +o.delay_days > 0).length, 'vs approved baseline', open.some((o) => +o.delay_days > 0) ? 'bad' : 'good')}</div>
      <div class="card"><div class="card-head"><h2>Section production plan</h2><span class="muted small">components required from the previous section, quantity received, awaiting production, daily target, planned completion</span></div>${table(cols, b.operations, { cls: 'compact', rowClass: (o) => (o.status === 'COMPLETED' ? 'done' : +o.is_critical ? 'crit' : ''), empty: 'No work orders released to this section.' })}</div>
      <div class="grid two">
        <div class="card"><div class="card-head"><h2>Daily load (approved plans)</h2><span class="muted small">capacity ${b.capacity_minutes} min/day</span></div>${window.Charts.groupedBars(b.loads.map((l) => ({ label: l.ldate, values: [l.minutes] })), ['Minutes committed'], { height: 200 })}</div>
        ${b.machines.length ? `<div class="card"><div class="card-head"><h2>Machine loading</h2><span class="muted small">next 2 weeks</span></div>${table([{ label: 'Machine', key: 'name' }, { label: 'Minutes/shift', cls: 'num', key: 'minutes_per_shift' }, { label: 'Committed (next 14 days)', fmt: (m) => b.machine_loads.filter((l) => +l.machine_id === +m.id).map((l) => `<span class="chip ${l.minutes > m.minutes_per_shift ? 'bad' : ''}" title="${l.ldate}">${l.ldate.slice(5)}: ${fmtNum(l.minutes, 0)}m</span>`).join(' ') || '<span class="muted">idle</span>' }], b.machines, { cls: 'compact' })}</div>` : ''}
      </div>
      <div class="card"><div class="card-head"><h2>Recent daily reports</h2></div>${table([{ label: 'Date', fmt: (r) => fmtDate(r.rdate) }, { label: 'Order', key: 'order_number' }, { label: 'Item', key: 'item_code' }, { label: 'Planned', cls: 'num', fmt: (r) => fmtNum(r.planned_qty, 1) }, { label: 'Good', cls: 'num', fmt: (r) => fmtNum(r.good_qty, 1) }, { label: 'Rejected', cls: 'num', fmt: (r) => fmtNum(r.rejected_qty, 1) }, { label: 'Rework', cls: 'num', fmt: (r) => fmtNum(r.rework_qty, 1) }, { label: 'Achievement', cls: 'num', fmt: (r) => (+r.planned_qty ? fmtPct((100 * r.good_qty) / r.planned_qty, 0) : '—') }, { label: 'Downtime', cls: 'num', fmt: (r) => `${fmtNum(r.downtime_min, 0)} min` }, { label: 'Delay reason', key: 'delay_reason' }, { label: 'Remarks', key: 'remarks' }, { label: 'By', key: 'supervisor' }, { label: 'Entered', fmt: (r) => fmtDateTime(r.created_at) }], b.reports, { cls: 'compact', empty: 'No reports yet.' })}</div>`;
    $('#sb-date').onchange = (e) => { V.sectionBoard.date = e.target.value; V.sectionBoard(id); };
    $('#exp-sec').onclick = () => exportSheets(`section-${s.code}`, { Plan: [['Order', 'Request', 'Product', 'Item', 'Machine', 'Required', 'Received', 'Awaiting', 'Daily target', 'Good', 'Rejected', 'Rework', 'Remaining', 'Planned start', 'Planned finish', 'Status'], ...b.operations.map((o) => [o.order_number, o.sr_number, o.product_code, o.item_code, o.machine_name, o.required_qty, o.received_from_predecessor, o.awaiting_from_predecessor, o.daily_capacity, o.good_qty, o.rejected_qty, o.rework_qty, o.remaining_qty, o.planned_start, o.planned_finish, o.status])], Reports: [['Date', 'Order', 'Item', 'Planned', 'Good', 'Rejected', 'Rework', 'Downtime', 'Reason', 'Remarks', 'Supervisor'], ...b.reports.map((r) => [r.rdate, r.order_number, r.item_code, r.planned_qty, r.good_qty, r.rejected_qty, r.rework_qty, r.downtime_min, r.delay_reason, r.remarks, r.supervisor])] });
    $$('[data-report]').forEach((btn) => (btn.onclick = () => openDailyReport(b.operations.find((o) => +o.id === +btn.dataset.report), s, id, date)));
  };

  function openDailyReport(o, s, sectionId, date) {
    const body = `<div class="callout info small"><b>${esc(o.item_code)}</b> — ${esc(o.item_name || '')}<br>${esc(o.order_number)} · ${esc(o.sr_number)} · ${esc(o.product_code)} · required ${fmtNum(o.required_qty, 1)} · good so far ${fmtNum(o.good_qty, 1)} · remaining ${fmtNum(o.remaining_qty, 1)}${+o.has_predecessor ? ` · received from previous section ${fmtNum(o.received_from_predecessor, 1)}` : ''}</div>
      <div class="form-grid">
        ${field('Date', 'date', 'date', date, `required max="${today()}"`)}
        ${field('Production order', 'order', 'text', o.order_number, 'disabled')}
        ${field('Section', 'section', 'text', s.name, 'disabled')}
        ${field('Item code', 'item', 'text', o.item_code, 'disabled')}
        ${field('Planned quantity (from schedule)', 'planned_qty', 'number', o.today_target || o.daily_capacity, 'step="0.01" min="0"')}
        ${field('Actual good quantity', 'good_qty', 'number', '', 'step="0.01" min="0" required autofocus')}
        ${field('Rejected quantity', 'rejected_qty', 'number', 0, 'step="0.01" min="0"')}
        ${field('Rework quantity', 'rework_qty', 'number', 0, 'step="0.01" min="0"')}
        ${field('Downtime (minutes)', 'downtime_min', 'number', 0, 'step="1" min="0"')}
        ${selectField('Delay reason', 'delay_reason', options(['', 'Material shortage', 'Machine breakdown', 'Manpower shortage', 'Power outage', 'Quality / rework', 'Waiting for previous section', 'Changeover', 'Other'].map((x) => ({ id: x, name: x || '— none —' })), ''))}
        ${textarea('Supervisor remarks', 'remarks', '')}
      </div><p class="hint">Achievement % = good ÷ planned × 100. Remaining = required − accepted good. When output is below plan the remaining schedule and the finished-product date are recalculated automatically; the original approved plan is kept for comparison.</p>`;
    modal('Daily production report', body, async (v) => {
      if (+v.good_qty + +v.rejected_qty + +v.rework_qty <= 0) throw new Error('Enter the quantities produced');
      if (+v.good_qty > o.remaining_qty + 1e-6) throw new Error(`Good quantity exceeds the remaining ${fmtNum(o.remaining_qty, 2)}`);
      const r = await Api.post('/daily-reports', { op_id: o.id, date: v.date, planned_qty: +v.planned_qty, good_qty: +v.good_qty, rejected_qty: +v.rejected_qty, rework_qty: +v.rework_qty, downtime_min: +v.downtime_min, delay_reason: v.delay_reason || null, remarks: v.remarks });
      const p = r.plan; const d = p.baseline_completion && p.expected_completion ? window.UI.daysBetween(p.baseline_completion, p.expected_completion) : 0;
      toast(`Report saved. Expected completion for ${p.product_code}: ${fmtDate(p.expected_completion)}${d > 0 ? ` (${d} days later than approved)` : d < 0 ? ' (earlier than approved)' : ' (on baseline)'}`);
      V.sectionBoard(sectionId);
    }, { submitLabel: 'Save report' });
  }

  // ---------------------------------------------------------------- inventory
  V.inventory = async function () {
    setCrumbs('<b>Inventory</b>');
    const f = V.inventory.f = V.inventory.f || { category: '', search: '', tab: 'balances' };
    const [bal, mov] = await Promise.all([Api.get('/inventory/balances', { category: f.category, search: f.search }), Api.get('/inventory/movements', {})]);
    setActions(`${window.can('inventory.move') ? '<button class="btn primary" id="new-mov">+ Record movement</button>' : ''}<button class="btn" id="exp-inv">Export</button>`);
    const cats = bal.categories;
    const totals = {}; bal.balances.forEach((r) => { totals[r.category] = totals[r.category] || { n: 0, value: 0 }; totals[r.category].n++; totals[r.category].value += +r.value; });
    $('#view').innerHTML = `<div class="card-head"><div><h1>Inventory & semi-finished availability</h1><div class="muted small">Opening balance, receipts, issues, work-in-progress, rejects and available balance by category. Movements are linked to production orders; completed orders receive their output automatically.</div></div></div>
      <div class="kpis">${Object.entries(cats).map(([k, name]) => kpi(name, totals[k] ? totals[k].n : 0, totals[k] ? `${fmtMoney(totals[k].value)} value` : 'no stock', '')).join('')}</div>
      ${window.UI.tabs([['balances', 'Balances'], ['movements', 'Movements']], f.tab)}
      <div class="card flat"><div class="filters"><label>Category<select id="f-cat">${options(Object.entries(cats).map(([k, v]) => ({ id: k, name: v })), f.category, { allLabel: 'All categories' })}</select></label><label>Search<input id="f-search" value="${esc(f.search)}" placeholder="item code or name"></label><button class="btn" id="f-apply">Apply</button></div></div>
      <div id="inv-body"></div>`;
    $$('.tabs button').forEach((b) => (b.onclick = () => { f.tab = b.dataset.tab; V.inventory(); }));
    $('#f-apply').onclick = () => { f.category = $('#f-cat').value; f.search = $('#f-search').value; V.inventory(); };
    const body = $('#inv-body');
    if (f.tab === 'balances') body.innerHTML = table([{ label: 'Category', fmt: (r) => esc(cats[r.category] || r.category) }, { label: 'Item', fmt: (r) => `<b>${esc(r.item_code)}</b><div class="tiny muted">${esc(r.name || '')}</div>` }, { label: 'Unit', key: 'unit' }, { label: 'Opening', cls: 'num', fmt: (r) => fmtNum(r.opening, 2) }, { label: 'Receipts', cls: 'num', fmt: (r) => fmtNum(r.receipts, 2) }, { label: 'Issues', cls: 'num', fmt: (r) => fmtNum(r.issues, 2) }, { label: 'Rejected', cls: 'num', fmt: (r) => fmtNum(r.rejected, 2) }, { label: 'WIP (in orders)', cls: 'num', fmt: (r) => fmtNum(r.wip, 2) }, { label: 'Available', cls: 'num', fmt: (r) => `<b class="${r.available < 0 ? 'bad' : ''}">${fmtNum(r.available, 2)}</b>` }, { label: 'Std cost', cls: 'num', fmt: (r) => fmtMoney(r.std_cost, 2) }, { label: 'Value', cls: 'num', fmt: (r) => fmtMoney(r.value) }, { label: '', fmt: (r) => `<a class="small" href="#/inventory" data-item="${esc(r.item_code)}">movements</a>` }], bal.balances, { cls: 'compact', empty: 'No stock recorded. Record opening balances or receipts to start.' });
    else body.innerHTML = table([{ label: 'Date', fmt: (m) => fmtDate(m.mdate) }, { label: 'Type', fmt: (m) => statusBadge(m.mtype) }, { label: 'Category', fmt: (m) => esc(cats[m.category] || m.category) }, { label: 'Item', fmt: (m) => `<b>${esc(m.item_code)}</b>` }, { label: 'Qty', cls: 'num', fmt: (m) => fmtNum(m.qty, 3) }, { label: 'Unit cost', cls: 'num', fmt: (m) => fmtMoney(m.unit_cost, 2) }, { label: 'Value', cls: 'num', fmt: (m) => fmtMoney(m.qty * m.unit_cost) }, { label: 'Production order', fmt: (m) => esc(m.order_number || '—') }, { label: 'Reference', key: 'reference' }, { label: 'Remarks', key: 'remarks' }, { label: 'By', key: 'created_by' }, { label: 'Entered', fmt: (m) => fmtDateTime(m.created_at) }], mov.movements, { cls: 'compact', empty: 'No movements.' });
    $$('[data-item]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); f.tab = 'movements'; f.search = a.dataset.item; V.inventory(); }));
    $('#exp-inv').onclick = () => exportSheets('inventory', { Balances: [['Category', 'Item', 'Name', 'Unit', 'Opening', 'Receipts', 'Issues', 'Rejected', 'WIP', 'Available', 'Std cost', 'Value'], ...bal.balances.map((r) => [cats[r.category], r.item_code, r.name, r.unit, r.opening, r.receipts, r.issues, r.rejected, r.wip, r.available, r.std_cost, r.value])], Movements: [['Date', 'Type', 'Category', 'Item', 'Qty', 'Unit cost', 'Order', 'Reference', 'Remarks', 'By'], ...mov.movements.map((m) => [m.mdate, m.mtype, m.category, m.item_code, m.qty, m.unit_cost, m.order_number, m.reference, m.remarks, m.created_by])] });
    if ($('#new-mov')) $('#new-mov').onclick = async () => {
      const board = await Api.get('/board');
      const orders = {}; board.operations.forEach((o) => (orders[o.order_id] = { id: o.order_id, name: `${o.order_number} · ${o.item_code} (${o.sr_number})` }));
      modal('Record inventory movement', `<div class="form-grid">
        <label>Item code<input name="item_code" list="item-list" required placeholder="type to search" autocomplete="off"><datalist id="item-list"></datalist></label>
        ${selectField('Movement type', 'mtype', options([['OPENING', 'Opening balance'], ['RECEIPT', 'Receipt (purchase / supplier)'], ['ISSUE', 'Issue to production order'], ['RETURN', 'Return from production'], ['WIP_IN', 'Semi-finished receipt from section'], ['WIP_OUT', 'Semi-finished transfer to assembly'], ['REJECT', 'Reject / scrap'], ['FG_RECEIPT', 'Finished goods receipt'], ['DISPATCH', 'Dispatch to customer'], ['ADJUST_IN', 'Adjustment +'], ['ADJUST_OUT', 'Adjustment −']].map(([id, name]) => ({ id, name })), 'RECEIPT'))}
        ${field('Quantity', 'qty', 'number', '', 'step="0.001" min="0" required')}
        ${field('Unit cost (blank = standard)', 'unit_cost', 'number', '', 'step="0.01" min="0"')}
        ${field('Date', 'mdate', 'date', today(), 'required')}
        ${selectField('Linked production order', 'order_id', options(Object.values(orders), '', { allLabel: '— none —' }))}
        ${field('Reference (GRN / MRN / waybill)', 'reference', 'text', '')}
        ${textarea('Remarks', 'remarks', '')}
      </div>`, async (v) => { await Api.post('/inventory/movements', { item_code: v.item_code.trim(), mtype: v.mtype, qty: +v.qty, unit_cost: v.unit_cost === '' ? undefined : +v.unit_cost, mdate: v.mdate, order_id: v.order_id || null, reference: v.reference, remarks: v.remarks }); toast('Movement recorded'); V.inventory(); });
      const inp = $('#modal-form [name=item_code]'), dl = $('#item-list');
      inp.addEventListener('input', async () => { if (inp.value.length < 2) return; const r = await Api.get('/items', { search: inp.value, limit: 30 }); dl.innerHTML = r.items.map((i) => `<option value="${esc(i.code)}">${esc(i.name)} (${esc(i.item_type)})</option>`).join(''); });
    };
  };
})();
