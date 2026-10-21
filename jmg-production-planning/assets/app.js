/* Production Planning - front-end application (no build step). */
(function () {
  'use strict';
  const CFG = window.JMG_CONFIG || {};
  const $root = document.getElementById('jmg-app');
  if (!$root) { return; }

  /* ------------------------------------------------------------ utils */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 0) => (v == null || v === '' || isNaN(v)) ? '-' : Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const qty = (v) => (v == null || v === '' || isNaN(v)) ? '-' : (Math.round(Number(v) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const money = (v) => (v == null || v === '' || isNaN(v)) ? '-' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const pct = (v) => (v == null || v === '' || isNaN(v)) ? '-' : num(v, 1) + '%';
  const dstr = (d) => d ? d : '-';
  const todayStr = () => (state.boot && state.boot.today) || new Date().toISOString().slice(0, 10);
  const monthStr = () => todayStr().slice(0, 7);
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const pill = (v) => `<span class="pill ${esc(v)}">${esc(String(v || '').replace('_', ' '))}</span>`;
  const can = (cap) => !!(state.boot && state.boot.user.caps.indexOf(cap) >= 0);
  const sel = (opts, value, blank) => (blank != null ? `<option value="">${esc(blank)}</option>` : '') + opts.map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(value) ? 'selected' : ''}>${esc(o.l)}</option>`).join('');
  const state = { boot: null, route: 'dashboard', params: {}, cache: {} };

  function toast(msg, isErr) {
    const t = document.createElement('div'); t.className = 'toast' + (isErr ? ' err' : ''); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), isErr ? 7000 : 3500);
  }
  function modal(html, opts = {}) {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}">${html}</div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    document.body.appendChild(bg);
    function close() { bg.remove(); }
    bg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    return { el: bg.firstElementChild, close };
  }
  function confirmDlg(msg) { return window.confirm(msg); }

  const api = {
    async req(method, path, body, isForm) {
      const headers = { 'X-WP-Nonce': CFG.nonce };
      if (!isForm) { headers['Content-Type'] = 'application/json'; }
      const r = await fetch(CFG.rest + path, { method, headers, credentials: 'same-origin', body: body == null ? undefined : (isForm ? body : JSON.stringify(body)) });
      let data = null; const text = await r.text();
      try { data = JSON.parse(text); } catch (e) { data = { error: text.slice(0, 300) }; }
      if (!r.ok) { throw new Error((data && (data.error || data.message)) || ('HTTP ' + r.status)); }
      return data;
    },
    get(path, params) { const q = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString() : ''; return this.req('GET', path + q); },
    post(path, body) { return this.req('POST', path, body); },
    put(path, body) { return this.req('PUT', path, body); },
    del(path) { return this.req('DELETE', path); },
    upload(path, form) { return this.req('POST', path, form, true); },
  };

  /* ------------------------------------------------------------ export */
  function tableToRows(table) {
    return Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((td) => td.innerText.trim()));
  }
  function downloadCSV(rows, name) {
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name + '.csv'; a.click();
  }
  function loadSheetJS() {
    if (window.XLSX) { return Promise.resolve(window.XLSX); }
    return new Promise((res) => {
      const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => res(window.XLSX); s.onerror = () => res(null); document.head.appendChild(s);
    });
  }
  async function exportTables(sheets, name) {
    const XLSX = await loadSheetJS();
    if (!XLSX) { sheets.forEach((s) => downloadCSV(s.rows, name + '-' + s.name)); toast('Excel library unavailable offline; exported as CSV.'); return; }
    const wb = XLSX.utils.book_new();
    sheets.forEach((s) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name.slice(0, 30)));
    XLSX.writeFile(wb, name + '.xlsx');
  }
  function exportSection(sectionEl, name) {
    const sheets = Array.from(sectionEl.querySelectorAll('table')).map((t, i) => ({ name: (t.dataset.sheet || ('Table' + (i + 1))), rows: tableToRows(t) }));
    if (!sheets.length) { toast('Nothing to export'); return; }
    exportTables(sheets, name);
  }

  /* ------------------------------------------------------------ charts (SVG) */
  function barChart(opts) {
    // opts: {data:[{label, values:[..]}], series:[{name,color}], height, yLabel}
    const W = 900, H = opts.height || 220, padL = 44, padR = 10, padT = 14, padB = 34;
    const data = opts.data || []; const series = opts.series || [];
    const max = Math.max(1, ...data.flatMap((d) => d.values.map((v) => Number(v) || 0)));
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const n = data.length || 1; const gw = innerW / n; const bw = Math.max(2, (gw - 6) / Math.max(1, series.length) - 2);
    const y = (v) => padT + innerH - (v / max) * innerH;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || 'chart')}">`;
    s += '<g class="grid">';
    for (let i = 0; i <= 4; i++) { const v = max * i / 4; s += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10">${num(v, 0)}</text>`; }
    s += '</g>';
    data.forEach((d, i) => {
      d.values.forEach((v, j) => {
        const x = padL + i * gw + 3 + j * (bw + 2); const h = Math.max(0, padT + innerH - y(v || 0));
        s += `<rect x="${x}" y="${y(v || 0)}" width="${bw}" height="${h}" fill="${series[j] ? series[j].color : '#2a78d6'}" rx="2" data-tip="${esc(d.label + ' - ' + (series[j] ? series[j].name : '') + ': ' + qty(v))}"/>`;
      });
      if (n <= 31 || i % Math.ceil(n / 15) === 0) { s += `<text x="${padL + i * gw + gw / 2}" y="${H - padB + 14}" text-anchor="middle" font-size="10">${esc(d.label)}</text>`; }
    });
    s += `<line class="axis" x1="${padL}" x2="${W - padR}" y1="${padT + innerH}" y2="${padT + innerH}"/>`;
    s += '</svg>';
    const legend = series.length > 1 ? `<div class="legend">${series.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join('')}</div>` : '';
    return legend + s;
  }
  function attachTips(container) {
    let tip = null;
    container.addEventListener('mousemove', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) { if (tip) { tip.remove(); tip = null; } return; }
      if (!tip) { tip = document.createElement('div'); tip.className = 'tooltip'; document.body.appendChild(tip); }
      tip.textContent = t.dataset.tip; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 12) + 'px';
    });
    container.addEventListener('mouseleave', () => { if (tip) { tip.remove(); tip = null; } });
  }

  /* ------------------------------------------------------------ gantt */
  function renderGantt(data, opts = {}) {
    const orders = data.orders || [];
    if (!orders.length) { return '<div class="empty">No orders to display.</div>'; }
    let from = data.range.from || data.today, to = data.range.to || data.today;
    if (data.today < from) { from = data.today; }
    if (data.today > to) { to = data.today; }
    from = addDays(from, -1); to = addDays(to, 2);
    const days = []; for (let d = from; d <= to; d = addDays(d, 1)) { days.push(d); }
    const dayW = opts.dayW || 26, labelW = 300, rowH = 22, headH = 40;
    const rows = [];
    orders.forEach((o) => {
      rows.push({ type: 'order', o });
      let lastComp = null;
      (o.ops || []).forEach((op) => { rows.push({ type: 'op', o, op }); });
    });
    const W = labelW + days.length * dayW, H = headH + rows.length * rowH + 10;
    const x = (d) => labelW + Math.max(0, days.indexOf(d)) * dayW;
    const wd = new Set((state.boot.settings.working_days || [1, 2, 3, 4, 5]).map(Number));
    let s = `<svg class="gantt" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#898781"/></marker></defs>`;
    days.forEach((d, i) => {
      const dow = new Date(d + 'T12:00:00Z').getUTCDay(); const iso = dow === 0 ? 7 : dow;
      if (!wd.has(iso)) { s += `<rect class="weekend" x="${labelW + i * dayW}" y="${headH}" width="${dayW}" height="${H - headH}"/>`; }
      if (i % 2 === 0 || dayW > 30) { s += `<text class="daylbl" x="${labelW + i * dayW + dayW / 2}" y="${headH - 6}" text-anchor="middle">${d.slice(8)}</text>`; }
      if (d.slice(8) === '01' || i === 0) { s += `<text class="daylbl" x="${labelW + i * dayW + 2}" y="${14}">${d.slice(0, 7)}</text>`; }
    });
    const byId = {}; rows.forEach((r, i) => { if (r.type === 'op') { byId[r.op.id] = i; } });
    rows.forEach((r, i) => {
      const y = headH + i * rowH;
      if (r.type === 'order') {
        const o = r.o;
        s += `<rect class="orow" x="0" y="${y}" width="${W}" height="${rowH}"/>`;
        s += `<text class="lbl o" x="6" y="${y + 15}">${esc(o.order_no)} · ${esc(o.product_code)} × ${qty(o.qty)} ${o.delayed ? '⚠' : ''}</text>`;
        if (o.baseline_start && o.baseline_end) { s += `<rect class="bar base-line" x="${x(o.baseline_start)}" y="${y + 4}" width="${Math.max(dayW, x(o.baseline_end) - x(o.baseline_start) + dayW)}" height="${rowH - 8}"><title>Baseline ${o.baseline_start} → ${o.baseline_end}</title></rect>`; }
        if (o.requested_date) { s += `<line class="req" x1="${x(o.requested_date) + dayW}" x2="${x(o.requested_date) + dayW}" y1="${y}" y2="${y + rowH}"><title>Requested ${o.requested_date}</title></line>`; }
        return;
      }
      const op = r.op;
      s += `<rect class="rowbg" x="0" y="${y}" width="${W}" height="${rowH}" fill="${i % 2 ? '#fafaf8' : '#fff'}"/>`;
      s += `<text class="lbl" x="14" y="${y + 15}"><tspan class="mono">${esc(op.component_code)}</tspan> ${esc(op.stage_name)}${op.status === 'UNSCHEDULED' ? '<tspan fill="#898781"> (no capacity data - not scheduled)</tspan>' : ''}</text>`;
      const start = op.planned_start || op.actual_start, end = op.planned_end || op.actual_end || start;
      if (op.baseline_start && op.baseline_end) { s += `<rect class="bar base-line" x="${x(op.baseline_start)}" y="${y + 3}" width="${Math.max(dayW, x(op.baseline_end) - x(op.baseline_start) + dayW)}" height="${rowH - 6}"><title>Baseline ${op.baseline_start} → ${op.baseline_end}</title></rect>`; }
      if (start) {
        const w = Math.max(dayW - 2, x(end) - x(start) + dayW - 2);
        s += `<rect class="bar plan ${esc(op.workflow_group)} ${op.delayed ? 'late' : ''}" x="${x(start) + 1}" y="${y + 5}" width="${w}" height="${rowH - 10}" data-tip="${esc(op.component_code + ' ' + op.stage_name + ' · ' + start + ' → ' + end + ' · ' + qty(op.qty_completed) + '/' + qty(op.qty_planned) + ' · ' + (op.section_name || ''))}"/>`;
        if (op.progress_pct > 0) { s += `<rect class="bar done" x="${x(start) + 1}" y="${y + 5}" width="${w * Math.min(100, op.progress_pct) / 100}" height="${rowH - 10}" pointer-events="none"/>`; }
        s += `<text class="daylbl" x="${x(start) + w + 6}" y="${y + 15}">${qty(op.qty_completed)}/${qty(op.qty_planned)}</text>`;
      } else if (op.actual_end) {
        s += `<rect class="bar done" x="${x(op.actual_start || op.actual_end) + 1}" y="${y + 5}" width="${Math.max(dayW - 2, x(op.actual_end) - x(op.actual_start || op.actual_end) + dayW - 2)}" height="${rowH - 10}" data-tip="${esc(op.component_code + ' ' + op.stage_name + ' completed ' + op.actual_end)}"/>`;
      }
      (op.predecessors || []).forEach((p) => {
        const pi = byId[p.id]; if (pi == null) { return; }
        const pop = rows[pi].op; const pend = pop.planned_end || pop.actual_end; if (!pend || !start) { return; }
        const x1 = x(pend) + dayW, y1 = headH + pi * rowH + rowH / 2, x2 = x(start), y2 = y + rowH / 2;
        s += `<path class="dep" d="M${x1},${y1} L${x1 + 4},${y1} L${x1 + 4},${y2} L${x2},${y2}"/>`;
      });
    });
    const tx = x(data.today);
    s += `<line class="today" x1="${tx}" x2="${tx}" y1="${headH - 20}" y2="${H}"/><text class="daylbl" x="${tx + 3}" y="${headH - 22}" fill="#e34948">today</text>`;
    s += '</svg>';
    return `<div class="legend"><span><i style="background:#f3b89e"></i>Canopy</span><span><i style="background:#9ec5f4"></i>Base</span><span><i style="background:#a6e3cb"></i>Panel</span><span><i style="background:#c9c1f1"></i>Genset assembly</span><span><i style="background:#f4b7cf"></i>Quality / testing</span><span><i style="background:#f6d58a"></i>Final assembly</span><span><i style="background:#1baf7a"></i>Completed</span><span><i style="border:1px dashed #52514e"></i>Confirmed baseline</span><span><i style="border-left:2px dashed #6250d6"></i>Requested date</span><span><i style="border-left:2px dashed #e34948"></i>Today</span></div><div class="gantt-wrap">${s}</div>`;
  }

  /* ------------------------------------------------------------ shell */
  const NAV = [
    { sec: 'Operate' },
    { id: 'dashboard', label: 'Dashboard', cap: 'jmg_view' },
    { id: 'requests', label: 'Sales Requests', cap: 'jmg_view' },
    { id: 'planning', label: 'Production Planning', cap: 'jmg_plan' },
    { id: 'orders', label: 'Production Orders', cap: 'jmg_view' },
    { id: 'gantt', label: 'Gantt Chart', cap: 'jmg_view' },
    { id: 'tracking', label: 'Daily Tracking', cap: 'jmg_view' },
    { id: 'inventory', label: 'Inventory', cap: 'jmg_view' },
    { sec: 'Analyse' },
    { id: 'reports', label: 'Monthly Reports', cap: 'jmg_view' },
    { id: 'bom', label: 'BOM & Costing', cap: 'jmg_view' },
    { id: 'alerts', label: 'Alerts', cap: 'jmg_view', badge: 'alerts' },
    { sec: 'Configure' },
    { id: 'masters', label: 'Masters & Capacities', cap: 'jmg_view', badge: 'issues' },
    { id: 'admin', label: 'Administration', cap: 'jmg_admin' },
  ];
  function shell() {
    const b = state.boot;
    const nav = NAV.map((n) => n.sec ? `<div class="sec">${n.sec}</div>` : (can(n.cap) ? `<a href="#/${n.id}" data-nav="${n.id}">${n.label}${n.badge && b.counts[n.badge] ? `<span class="badge">${b.counts[n.badge]}</span>` : ''}</a>` : '')).join('');
    $root.innerHTML = `<div class="app"><aside class="side" id="side"><div class="brand"><b>Production Planning</b><small>Genset &amp; Canopy manufacturing control · v${esc(b.version)}</small></div><nav class="nav">${nav}</nav><div class="user"><b>${esc(b.user.name)}</b>${esc(b.user.role_label || b.user.roles.join(', '))}<br><a href="${esc(b.logout_url)}">Log out</a>${can('jmg_admin') ? ` · <a href="${esc(b.admin_url)}">WP admin</a>` : ''}</div></aside><main class="main"><div class="topbar"><button class="btn menu-toggle" id="menuToggle">☰ Menu</button><h1 id="pageTitle"></h1><span class="muted small">${esc(b.today)}</span></div><div id="view"></div></main></div>`;
    document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('side').classList.toggle('open'));
    $root.querySelectorAll('[data-nav]').forEach((a) => a.addEventListener('click', () => document.getElementById('side').classList.remove('open')));
  }
  function setTitle(t) { document.getElementById('pageTitle').textContent = t; document.title = t + ' · Production Planning'; }
  function route() {
    const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [path, qs] = h.split('?'); const parts = path.split('/');
    state.route = parts[0]; state.params = { parts, q: Object.fromEntries(new URLSearchParams(qs || '')) };
    $root.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === state.route));
    const v = views[state.route] || views.dashboard;
    const el = document.getElementById('view'); el.innerHTML = '<div class="empty">Loading…</div>';
    Promise.resolve(v(el, state.params)).catch((e) => { el.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; });
  }

  /* ------------------------------------------------------------ views */
  const views = {};

  /* Dashboard */
  views.dashboard = async (el, p) => {
    setTitle('Production Monitoring Dashboard');
    const f = Object.assign({ month: monthStr() }, p.q);
    const b = state.boot;
    const d = await api.get('dashboard', f);
    const c = d.counts;
    const cats = [{ v: 'Genset', l: 'Genset' }, { v: 'Canopy', l: 'Canopy' }, { v: 'Tank', l: 'Tank' }];
    el.innerHTML = `
      <form class="toolbar" id="dashF">
        <input type="month" name="month" value="${esc(f.month)}" title="Month">
        <input type="date" name="from" value="${esc(f.from || '')}" title="From"> <input type="date" name="to" value="${esc(f.to || '')}" title="To">
        <select name="category">${sel(cats, f.category, 'All categories')}</select>
        <select name="department">${sel(b.departments.map((x) => ({ v: x.department, l: x.site + ' / ' + x.department })), f.department, 'All departments')}</select>
        <select name="section_id">${sel(b.sections.map((x) => ({ v: x.id, l: x.section_name + ' (' + x.site + ')' })), f.section_id, 'All sections')}</select>
        <select name="product_code">${sel(b.products.map((x) => ({ v: x.code, l: x.code })), f.product_code, 'All products')}</select>
        <select name="status">${sel(['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].map((x) => ({ v: x, l: x })), f.status, 'All statuses')}</select>
        <button class="btn primary">Apply</button>
      </form>
      <div class="grid g6">
        <div class="tile"><div class="l">Total orders</div><div class="v">${c.total}</div></div>
        <div class="tile"><div class="l">Awaiting planning</div><div class="v">${c.awaiting_planning}</div><div class="s">sales requests</div></div>
        <div class="tile"><div class="l">Confirmed</div><div class="v">${c.confirmed}</div></div>
        <div class="tile"><div class="l">In progress</div><div class="v">${c.in_progress}</div></div>
        <div class="tile good"><div class="l">Completed</div><div class="v">${c.completed}</div></div>
        <div class="tile ${c.delayed ? 'warn' : ''}"><div class="l">Delayed</div><div class="v">${c.delayed}</div></div>
      </div>
      <div class="grid g3" style="margin-top:14px">
        <div class="tile"><div class="l">Finished units (${esc(d.period.from)} → ${esc(d.period.to)})</div><div class="v">${qty(d.finished_units)}</div><div class="s">completed at final packaging stage</div></div>
        <div class="tile ${d.achievement_pct != null && d.achievement_pct < 90 ? 'warn' : 'good'}"><div class="l">Overall production achievement</div><div class="v">${pct(d.achievement_pct)}</div><div class="s">actual good ÷ planned on logged days · ${d.log_summary ? num(d.log_summary.n) : 0} entries</div></div>
        <div class="tile"><div class="l">Rejected / rework / downtime</div><div class="v">${qty(d.log_summary && d.log_summary.rejected)} / ${qty(d.log_summary && d.log_summary.rework)}</div><div class="s">${num(d.log_summary && d.log_summary.downtime)} min downtime</div></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h2>Planned vs actual production by day</h2><span class="muted small">section units; planned = scheduled allocations, actual = logged good quantity</span></div><div id="dailyChart">${d.daily.length ? barChart({ data: d.daily.map((x) => ({ label: x.d.slice(5), values: [x.planned, x.actual] })), series: [{ name: 'Planned', color: '#9ec5f4' }, { name: 'Actual', color: '#1baf7a' }], title: 'Planned vs actual' }) : '<div class="empty">No scheduled production in this period.</div>'}</div></div>
      <div class="grid g2">
        <div class="card"><div class="card-h"><h2>Work in progress by section</h2></div><div class="tbl-wrap short"><table class="tbl"><thead><tr><th>Section</th><th>Site</th><th class="num">Open ops</th><th class="num">In progress</th><th class="num">Done</th><th class="num">Remaining</th></tr></thead><tbody>${d.wip.map((w) => `<tr><td>${esc(w.section_name)}</td><td class="muted">${esc(w.site || '')}</td><td class="num">${w.open_ops}</td><td class="num">${w.in_progress}</td><td class="num">${qty(w.qty_done)}</td><td class="num">${qty(w.qty_remaining)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No open work.</td></tr>'}</tbody></table></div></div>
        <div class="card"><div class="card-h"><h2>Current bottlenecks</h2><span class="muted small">load next ${d.horizon.working_days} working days (${esc(d.horizon.from)} → ${esc(d.horizon.to)})</span></div><div class="tbl-wrap short"><table class="tbl"><thead><tr><th>Resource</th><th>Utilisation</th><th class="num">Load min</th><th class="num">Capacity min</th></tr></thead><tbody>${d.bottlenecks.map((x) => `<tr><td>${esc(x.name)}</td><td><div class="progress" title="${pct(x.utilisation_pct)}"><i class="${x.utilisation_pct > 95 ? 'late' : ''}" style="width:${Math.min(100, x.utilisation_pct || 0)}%"></i></div><span class="small">${pct(x.utilisation_pct)}</span></td><td class="num">${num(x.minutes)}</td><td class="num">${num(x.capacity)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No committed load.</td></tr>'}</tbody></table></div>${Object.keys(d.order_bottlenecks).length ? `<p class="small muted" style="margin-top:8px">Order-level bottlenecks: ${Object.entries(d.order_bottlenecks).map(([k, v]) => esc(k) + ' (' + v + ')').join(', ')}</p>` : ''}</div>
      </div>
      <div class="grid g2">
        <div class="card"><div class="card-h"><h2>Upcoming finished-product completions</h2></div><div class="tbl-wrap short"><table class="tbl"><thead><tr><th>Order</th><th>Product</th><th class="num">Qty</th><th>Forecast</th><th>Baseline</th><th>Requested</th><th>Status</th></tr></thead><tbody>${d.upcoming.map((o) => `<tr class="clickable" onclick="location.hash='#/orders/${o.id}'"><td class="mono">${esc(o.order_no)}</td><td>${esc(o.product_code)}<br><span class="muted small">${esc(o.customer || '')}</span></td><td class="num">${qty(o.qty_completed)}/${qty(o.qty)}</td><td class="${o.delayed ? 'crit' : ''}">${dstr(o.forecast_end)} ${o.delayed ? pill('delayed') : ''}</td><td>${dstr(o.baseline_end)}</td><td>${dstr(o.requested_date)}</td><td>${pill(o.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No confirmed orders.</td></tr>'}</tbody></table></div></div>
        <div class="card"><div class="card-h"><h2>Open alerts</h2><a href="#/alerts" class="small">all alerts</a></div>${alertsList(d.alerts)}</div>
      </div>`;
    attachTips(el);
    el.querySelector('#dashF').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/dashboard?' + new URLSearchParams(new FormData(e.target)).toString(); });
    bindAck(el);
  };
  function alertsList(list) {
    if (!list.length) { return '<div class="empty">No open alerts.</div>'; }
    return `<div class="tbl-wrap short"><table class="tbl"><thead><tr><th>When</th><th>Order</th><th>Type</th><th>Message</th><th></th></tr></thead><tbody>${list.map((a) => `<tr><td class="nowrap small">${esc((a.created_at || '').slice(0, 16))}</td><td><a href="#/orders/${a.order_id}" class="mono">${esc(a.order_no)}</a></td><td><span class="pill ${a.severity === 'serious' ? 'delayed' : 'Urgent'}">${esc(a.alert_type)}</span></td><td>${esc(a.message)}</td><td>${!a.is_ack ? `<button class="btn sm" data-ack="${a.id}">Acknowledge</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function bindAck(el) {
    el.querySelectorAll('[data-ack]').forEach((b) => b.addEventListener('click', async () => { await api.post('alerts/' + b.dataset.ack + '/ack'); toast('Alert acknowledged'); route(); }));
  }

  views.alerts = async (el) => {
    setTitle('Alerts');
    const list = await api.get('alerts', { all: 1 });
    el.innerHTML = `<div class="card"><div class="card-h"><h2>Alerts (planning, sales, management)</h2></div>${alertsList(list)}</div>`;
    bindAck(el);
  };

  /* Sales requests */
  views.requests = async (el, p) => {
    setTitle('Sales Production Requests');
    const f = p.q; const list = await api.get('requests', f);
    el.innerHTML = `<div class="toolbar"><input type="text" id="rq" placeholder="Search request, customer, product…" value="${esc(f.q || '')}"><select id="rs">${sel(['NEW', 'PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED'].map((x) => ({ v: x, l: x })), f.status, 'All statuses')}</select><span class="grow"></span>${can('jmg_sales') ? '<button class="btn primary" id="newReq">+ New sales request</button>' : ''}</div>
      <div class="card tight"><div class="tbl-wrap"><table class="tbl" data-sheet="Requests"><thead><tr><th>Request</th><th>Sales ref</th><th>Customer / project</th><th>Product</th><th>Cat.</th><th class="num">Qty</th><th>Requested date</th><th>Priority</th><th>Status</th><th>Order</th><th>Committed</th><th>Requested by</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr><td class="mono">${esc(r.request_no)}<br><span class="muted small">${esc((r.created_at || '').slice(0, 10))}</span></td><td>${esc(r.sales_ref)}</td><td>${esc(r.customer)}</td><td><b>${esc(r.product_code)}</b><br><span class="muted small">${esc(r.description)}</span></td><td>${esc(r.category)}</td><td class="num">${qty(r.qty)}</td><td>${dstr(r.requested_date)}</td><td>${pill(r.priority)}</td><td>${pill(r.status)}</td><td>${r.order_id ? `<a href="#/orders/${r.order_id}" class="mono">${esc(r.order_no)}</a> ${pill(r.order_status)}` : ''}</td><td>${r.forecast_end ? (r.forecast_end > (r.requested_date || '9999') ? `<span class="pill delayed">${r.forecast_end}</span>` : r.forecast_end) : '-'}</td><td>${esc(r.requested_by)}</td><td class="nowrap">${can('jmg_sales') && ['NEW', 'PLANNED'].includes(r.status) ? `<button class="btn sm" data-edit="${r.id}">Edit</button>` : ''} ${can('jmg_plan') && ['NEW', 'PLANNED'].includes(r.status) ? `<button class="btn sm primary" data-gen="${r.id}">Generate plan</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="13" class="empty">No requests yet.</td></tr>'}</tbody></table></div></div>`;
    const go = () => { location.hash = '#/requests?' + new URLSearchParams({ q: el.querySelector('#rq').value, status: el.querySelector('#rs').value }).toString(); };
    el.querySelector('#rq').addEventListener('change', go); el.querySelector('#rs').addEventListener('change', go);
    const nb = el.querySelector('#newReq'); if (nb) { nb.addEventListener('click', () => requestForm()); }
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => requestForm(list.find((r) => String(r.id) === b.dataset.edit))));
    el.querySelectorAll('[data-gen]').forEach((b) => b.addEventListener('click', () => generatePlan(b.dataset.gen)));
  };
  function productOptions(selected) {
    return sel(state.boot.products.map((x) => ({ v: x.code, l: x.code + ' - ' + (x.description || '').slice(0, 60) + (x.item_type !== 'FINISHED' ? ' (sub-assembly)' : '') })), selected, 'Select finished product…');
  }
  function requestForm(r) {
    const isNew = !r; r = r || {};
    const m = modal(`<h2>${isNew ? 'New sales production request' : 'Edit ' + esc(r.request_no)}</h2>
      <form class="form" id="rf">
        <label class="f"><span>Request number</span><input type="text" value="${esc(r.request_no || 'auto-generated')}" disabled></label>
        <label class="f"><span>Sales order / reference</span><input type="text" name="sales_ref" value="${esc(r.sales_ref || '')}"></label>
        <label class="f"><span>Customer or project</span><input type="text" name="customer" value="${esc(r.customer || '')}" required></label>
        <label class="f full"><span>Finished product code</span><select name="product_code" required>${productOptions(r.product_code)}</select></label>
        <label class="f"><span>Product description</span><input type="text" id="rf_desc" value="${esc(r.description || '')}" disabled></label>
        <label class="f"><span>Category</span><input type="text" id="rf_cat" value="${esc(r.category || '')}" disabled></label>
        <label class="f"><span>Required quantity</span><input type="number" name="qty" min="1" step="1" value="${esc(r.qty || 20)}" required></label>
        <label class="f"><span>Sales requested delivery date</span><input type="date" name="requested_date" value="${esc(r.requested_date || '')}"></label>
        <label class="f"><span>Priority</span><select name="priority">${sel([{ v: 'Normal', l: 'Normal' }, { v: 'Urgent', l: 'Urgent' }, { v: 'Critical', l: 'Critical' }], r.priority || 'Normal')}</select></label>
        <label class="f"><span>Requested by</span><input type="text" name="requested_by" value="${esc(r.requested_by || state.boot.user.name)}"></label>
        <label class="f"><span>Request creation date</span><input type="text" value="${esc(r.created_at ? r.created_at.slice(0, 10) : todayStr())}" disabled></label>
        <label class="f full"><span>Additional instructions</span><textarea name="instructions">${esc(r.instructions || '')}</textarea></label>
        <div class="full" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">${isNew ? 'Submit request' : 'Save changes'}</button></div>
      </form>`);
    const f = m.el.querySelector('#rf');
    const upd = () => { const pr = state.boot.products.find((x) => x.code === f.product_code.value); f.querySelector('#rf_desc').value = pr ? pr.description : ''; f.querySelector('#rf_cat').value = pr ? pr.category : ''; };
    f.product_code.addEventListener('change', upd); upd();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(f));
      try { if (isNew) { const res = await api.post('requests', data); toast('Request ' + res.request_no + ' submitted'); } else { await api.put('requests/' + r.id, data); toast('Request updated'); } m.close(); route(); } catch (err) { toast(err.message, true); }
    });
  }
  async function generatePlan(requestId, opts = {}) {
    const m = modal(`<h2>Generate production plan</h2><form class="form" id="gf"><label class="f"><span>Earliest production start</span><input type="date" name="plan_start" value="${esc(opts.plan_start || addDays(todayStr(), 1))}"></label><label class="f"><span>Batch transfer rule</span><select name="transfer_rule">${sel([{ v: '', l: 'System default (' + state.boot.settings.transfer_rule + ')' }, { v: 'next_day', l: 'Completed units move to next section the next day' }, { v: 'same_day', l: 'Completed units move the same day' }, { v: 'full_lot', l: 'Wait for the full lot' }], '')}</select></label><p class="full small muted">The system explodes the multi-level BOM, builds the routing from the BOM process operations, applies the workbook productivity figures and schedules against capacity already committed to confirmed orders. The result is a draft proposal that you review and confirm.</p><div class="full" style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Generate proposal</button></div></form>`);
    m.el.querySelector('#gf').addEventListener('submit', async (e) => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
      e.target.querySelector('button.primary').disabled = true;
      try { const o = await api.post('requests/' + requestId + '/generate', d); m.close(); toast('Draft plan ' + o.order_no + ' generated'); location.hash = '#/orders/' + o.id; } catch (err) { toast(err.message, true); e.target.querySelector('button.primary').disabled = false; }
    });
  }

  /* Planning */
  views.planning = async (el) => {
    setTitle('Production Planning');
    const [reqs, drafts] = await Promise.all([api.get('requests', { status: 'NEW' }), api.get('orders', { status: 'DRAFT' })]);
    const planned = await api.get('requests', { status: 'PLANNED' });
    el.innerHTML = `<div class="grid g2">
      <div class="card"><div class="card-h"><h2>Requests awaiting planning</h2></div><div class="tbl-wrap short"><table class="tbl"><thead><tr><th>Request</th><th>Product</th><th class="num">Qty</th><th>Requested</th><th>Priority</th><th></th></tr></thead><tbody>${reqs.concat(planned).map((r) => `<tr><td class="mono">${esc(r.request_no)}<br><span class="small muted">${esc(r.customer)}</span></td><td>${esc(r.product_code)}</td><td class="num">${qty(r.qty)}</td><td>${dstr(r.requested_date)}</td><td>${pill(r.priority)}</td><td class="nowrap">${r.order_id ? `<a class="btn sm" href="#/orders/${r.order_id}">Open draft</a>` : ''} <button class="btn sm primary" data-gen="${r.id}">${r.order_id ? 'Regenerate' : 'Generate plan'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nothing waiting.</td></tr>'}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h2>Plan a product directly</h2></div><form class="form" id="pf"><label class="f full"><span>Finished product</span><select name="product_code" required>${productOptions('')}</select></label><label class="f"><span>Quantity</span><input type="number" name="qty" value="20" min="1" required></label><label class="f"><span>Earliest start</span><input type="date" name="plan_start" value="${esc(addDays(todayStr(), 1))}"></label><label class="f"><span>Required by</span><input type="date" name="requested_date"></label><label class="f"><span>Priority</span><select name="priority">${sel([{ v: 'Normal', l: 'Normal' }, { v: 'Urgent', l: 'Urgent' }, { v: 'Critical', l: 'Critical' }], 'Normal')}</select></label><label class="f"><span>Customer</span><input type="text" name="customer"></label><div class="full"><button class="btn primary">Generate proposal</button></div></form>
      <h3 style="margin-top:14px">Draft proposals</h3><table class="tbl"><thead><tr><th>Order</th><th>Product</th><th class="num">Qty</th><th>Start</th><th>Earliest completion</th><th>Bottleneck</th></tr></thead><tbody>${drafts.map((o) => `<tr class="clickable" onclick="location.hash='#/orders/${o.id}'"><td class="mono">${esc(o.order_no)}</td><td>${esc(o.product_code)}</td><td class="num">${qty(o.qty)}</td><td>${dstr(o.planned_start)}</td><td>${dstr(o.planned_end)}</td><td class="small">${esc(o.bottleneck)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No drafts.</td></tr>'}</tbody></table>
      <div style="margin-top:14px;display:flex;gap:8px"><button class="btn" id="replanAll">Re-plan all confirmed orders</button><span class="small muted">Re-schedules every confirmed order in priority order (Critical → Urgent → Normal, then requested date) after capacity or calendar changes.</span></div></div></div>`;
    el.querySelectorAll('[data-gen]').forEach((b) => b.addEventListener('click', () => generatePlan(b.dataset.gen)));
    el.querySelector('#pf').addEventListener('submit', async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); try { const o = await api.post('orders', d); toast('Draft ' + o.order_no + ' created'); location.hash = '#/orders/' + o.id; } catch (err) { toast(err.message, true); } });
    el.querySelector('#replanAll').addEventListener('click', async () => { if (!confirmDlg('Re-plan all confirmed orders now?')) { return; } try { const r = await api.post('orders/replan-all'); toast(r.replanned + ' orders re-planned'); route(); } catch (err) { toast(err.message, true); } });
  };

  /* Orders list */
  views.orders = async (el, p) => {
    if (p.parts[1]) { return orderDetail(el, p.parts[1], p.q); }
    setTitle('Production Orders');
    const f = p.q; const list = await api.get('orders', f);
    el.innerHTML = `<div class="toolbar"><input type="text" id="oq" placeholder="Search order, product, customer…" value="${esc(f.q || '')}"><select id="os">${sel(['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((x) => ({ v: x, l: x })), f.status, 'All statuses')}</select><select id="oc">${sel([{ v: 'Genset', l: 'Genset' }, { v: 'Canopy', l: 'Canopy' }], f.category, 'All categories')}</select><span class="grow"></span><button class="btn" id="exp">Export</button></div>
      <div class="card tight" id="ordTbl"><div class="tbl-wrap"><table class="tbl" data-sheet="Orders"><thead><tr><th>Order</th><th>Product</th><th class="num">Qty</th><th class="num">Done</th><th>Priority</th><th>Status</th><th>Start</th><th>Committed end</th><th>Forecast</th><th>Requested</th><th class="num">Lead days</th><th>Bottleneck</th><th class="num">Planned cost</th></tr></thead><tbody>${list.map((o) => `<tr class="clickable" onclick="location.hash='#/orders/${o.id}'"><td class="mono">${esc(o.order_no)}<br><span class="small muted">${esc(o.customer || '')}</span></td><td><b>${esc(o.product_code)}</b><br><span class="small muted">${esc(o.description)}</span></td><td class="num">${qty(o.qty)}</td><td class="num">${qty(o.qty_completed)}</td><td>${pill(o.priority)}</td><td>${pill(o.status)} ${o.delayed ? pill('delayed') : ''}</td><td>${dstr(o.planned_start)}</td><td>${dstr(o.baseline_end || o.planned_end)}</td><td>${dstr(o.actual_end || o.forecast_end)}</td><td>${dstr(o.requested_date)}</td><td class="num">${o.lead_time_days || '-'}</td><td class="small">${esc(o.bottleneck)}</td><td class="num">${money(o.planned_cost)} <span class="small muted">${o.cost_status === 'Cost Pending' ? 'pending' : ''}</span></td></tr>`).join('') || '<tr><td colspan="13" class="empty">No orders.</td></tr>'}</tbody></table></div></div>`;
    const go = () => { location.hash = '#/orders?' + new URLSearchParams({ q: el.querySelector('#oq').value, status: el.querySelector('#os').value, category: el.querySelector('#oc').value }).toString(); };
    ['#oq', '#os', '#oc'].forEach((s) => el.querySelector(s).addEventListener('change', go));
    el.querySelector('#exp').addEventListener('click', () => exportSection(el.querySelector('#ordTbl'), 'production-orders'));
  };

  /* Order detail */
  async function orderDetail(el, id, q) {
    const o = await api.get('orders/' + id);
    setTitle(o.order_no + ' · ' + o.product_code);
    const tab = q.tab || 'schedule';
    const sc = o.schedule || {}; const cost = o.cost || {};
    const canPlan = can('jmg_plan') && !['COMPLETED', 'CANCELLED'].includes(o.status);
    const reqDiff = (o.requested_date && (o.baseline_end || o.planned_end)) ? daysBetween(o.requested_date, o.baseline_end || o.planned_end) : null;
    const fcDiff = (o.baseline_end && o.forecast_end) ? daysBetween(o.baseline_end, o.forecast_end) : null;
    el.innerHTML = `
      <div class="card"><div class="card-h"><h2>${esc(o.order_no)} ${pill(o.status)} ${pill(o.priority)} ${o.delayed ? pill('delayed') : ''}</h2>
        ${canPlan && o.status === 'DRAFT' ? '<button class="btn primary" id="btnConfirm">Confirm production plan</button>' : ''}
        ${canPlan ? '<button class="btn" id="btnReplan">Recalculate schedule</button>' : ''}
        ${canPlan && o.status === 'DRAFT' ? '<button class="btn danger" id="btnDelete">Discard draft</button>' : ''}
        ${canPlan && o.status !== 'DRAFT' ? '<button class="btn danger" id="btnCancel">Cancel order</button>' : ''}
        <button class="btn" onclick="window.print()">Print</button></div>
        <div class="grid g4">
          <div><dl class="kv"><dt>Product</dt><dd><b>${esc(o.product_code)}</b> ${esc(o.description)}</dd><dt>Category</dt><dd>${esc(o.category)}</dd><dt>Quantity</dt><dd>${qty(o.qty)} (completed ${qty(o.qty_completed)})</dd><dt>Customer</dt><dd>${esc(o.customer || '-')} ${o.sales_ref ? '· ' + esc(o.sales_ref) : ''}</dd><dt>Request</dt><dd>${o.request_id ? `<a href="#/requests">SR #${o.request_id}</a>` : 'direct'}</dd></dl></div>
          <div><dl class="kv"><dt>Plan start</dt><dd>${dstr(o.plan_start)}</dd><dt>Planned start</dt><dd>${dstr(o.planned_start)}</dd><dt>${o.status === 'DRAFT' ? 'Earliest completion' : 'Committed completion'}</dt><dd><b>${dstr(o.baseline_end || o.planned_end)}</b></dd><dt>Forecast completion</dt><dd><b class="${fcDiff > 0 ? 'crit' : ''}">${dstr(o.actual_end || o.forecast_end)}</b> ${fcDiff > 0 ? `<span class="pill delayed">+${fcDiff} days vs baseline</span>` : (fcDiff === 0 ? '<span class="pill COMPLETED">on baseline</span>' : '')}</dd><dt>Lead time</dt><dd>${o.lead_time_days || '-'} working days</dd></dl></div>
          <div><dl class="kv"><dt>Sales requested date</dt><dd>${dstr(o.requested_date)} ${reqDiff != null ? (reqDiff > 0 ? `<span class="pill delayed">${reqDiff} days late</span>` : `<span class="pill COMPLETED">${-reqDiff} days early</span>`) : ''}</dd><dt>Bottleneck</dt><dd>${esc(o.bottleneck || '-')}${sc.bottleneck ? ` <span class="small muted">(${sc.bottleneck.limited_days} capacity-limited days)</span>` : ''}</dd><dt>Transfer rule</dt><dd>${esc(o.transfer_rule || state.boot.settings.transfer_rule)}</dd><dt>Confirmed</dt><dd>${esc(o.confirmed_at || '-')}</dd></dl></div>
          <div><dl class="kv"><dt>Planned BOM cost</dt><dd><b>${money(o.planned_cost)} ${esc(state.boot.settings.currency)}</b> <span class="small ${o.cost_status === 'Cost Pending' ? 'crit' : 'muted'}">${esc(o.cost_status)}</span></dd><dt>Per unit</dt><dd>${money(cost.total)} (material ${money(cost.material)}, labour ${money(cost.labor)}, machine ${money(cost.machine)}, overhead ${money(cost.overhead)})</dd><dt>ERP reference / unit</dt><dd>${money(cost.erp_total)}</dd></dl></div>
        </div>
        ${o.warnings.length ? `<div class="alert warn" style="margin-top:10px"><b>Planning notes / missing data:</b><ul style="margin:4px 0 0 18px">${o.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        ${o.notes ? `<p class="small muted">Notes: ${esc(o.notes)}</p>` : ''}
      </div>
      <div class="tabs">${[['schedule', 'Schedule & operations'], ['dept', 'Departmental orders'], ['semi', 'Semi-finished orders'], ['materials', 'Raw materials'], ['stock', 'Stock movements'], ['cost', 'Cost'], ['gantt', 'Gantt'], ['logs', 'Daily production'], ['alerts', 'Alerts & audit']].map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="tabBody"></div>`;
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/orders/${id}?tab=${b.dataset.tab}`; }));
    const body = el.querySelector('#tabBody');
    const bind = (selector, fn) => { const b = el.querySelector(selector); if (b) { b.addEventListener('click', fn); } };
    bind('#btnConfirm', async () => { if (!confirmDlg('Confirm this production plan? It becomes the operational baseline and reserves capacity.')) { return; } try { await api.post('orders/' + id + '/confirm'); toast('Plan confirmed'); route(); } catch (e) { toast(e.message, true); } });
    bind('#btnReplan', async () => { try { await api.post('orders/' + id + '/replan'); toast('Schedule recalculated'); route(); } catch (e) { toast(e.message, true); } });
    bind('#btnDelete', async () => { if (!confirmDlg('Discard this draft?')) { return; } await api.del('orders/' + id); location.hash = '#/planning'; });
    bind('#btnCancel', async () => { const r = prompt('Reason for cancelling ' + o.order_no + ':'); if (r == null) { return; } await api.post('orders/' + id + '/cancel', { reason: r }); toast('Order cancelled'); route(); });

    if (tab === 'schedule') {
      const secOpts = state.boot.sections.map((s) => ({ v: s.id, l: s.section_name + ' (' + s.site + ')' }));
      body.innerHTML = `<div class="card tight">${canPlan ? `<form class="toolbar" id="adjF" style="padding:8px 6px 2px"><label class="f"><span>Quantity</span><input type="number" name="qty" value="${esc(o.qty)}" min="1" ${o.status !== 'DRAFT' ? 'disabled' : ''} class="inline-input"></label><label class="f"><span>Priority</span><select name="priority">${sel([{ v: 'Normal', l: 'Normal' }, { v: 'Urgent', l: 'Urgent' }, { v: 'Critical', l: 'Critical' }], o.priority)}</select></label><label class="f"><span>Earliest start</span><input type="date" name="plan_start" value="${esc(o.plan_start || '')}"></label><label class="f"><span>Requested date</span><input type="date" name="requested_date" value="${esc(o.requested_date || '')}"></label><label class="f"><span>Transfer rule</span><select name="transfer_rule">${sel([{ v: '', l: 'default' }, { v: 'next_day', l: 'next day' }, { v: 'same_day', l: 'same day' }, { v: 'full_lot', l: 'full lot' }], o.transfer_rule || '')}</select></label><span class="grow"></span><button class="btn primary">Apply adjustments &amp; recalculate</button></form><p class="small muted" style="padding:0 8px">Manual adjustment: change order parameters or, per operation, an earliest start date, a planner minutes-per-unit override or a different section. Downstream operations are recalculated automatically with finite capacity.</p>` : ''}
        <div class="tbl-wrap"><table class="tbl" data-sheet="Operations"><thead><tr><th>#</th><th>Component</th><th>Stage</th><th>Section (site)</th><th>Capacity basis</th><th class="num">Min/unit</th><th class="num">Qty</th><th class="num">Done</th><th>Progress</th><th>Planned</th><th>Baseline</th><th>Actual</th><th>Status</th>${canPlan ? '<th>Earliest start</th><th>Min/unit override</th><th>Section override</th>' : ''}<th>Depends on</th></tr></thead><tbody>
        ${o.ops.map((op, i) => `<tr class="${op.level === 0 ? '' : 'sub'}"><td>${op.id}</td><td class="lvl${Math.min(5, op.level)}"><b class="mono">${esc(op.component_code)}</b><br><span class="small muted">${esc(op.component_desc)}</span></td><td>${esc(op.stage_name)}<br><span class="small muted">${esc(op.op_codes)}</span></td><td>${esc(op.section_name || '-')}<br><span class="small muted">${esc(op.site || '')}</span></td><td><span class="pill ${esc(op.capacity_match)}" title="${esc(op.capacity_note)}">${esc(op.capacity_match)}</span><br><span class="small muted nowrap" title="${esc(op.capacity_note)}">${esc(((op.capacity_note || '').match(/row "([^"]+)"/) || [])[1] || '')}</span></td><td class="num">${op.minutes_per_unit ? num(op.minutes_per_unit, 1) : '-'}</td><td class="num">${qty(op.qty_planned)}</td><td class="num">${qty(op.qty_completed)}${Number(op.qty_rejected) ? `<br><span class="small crit">rej ${qty(op.qty_rejected)}</span>` : ''}</td><td><div class="progress"><i class="${op.delayed ? 'late' : ''}" style="width:${op.progress_pct}%"></i></div><span class="small">${pct(op.progress_pct)}</span></td><td class="nowrap">${op.status === 'COMPLETED' ? '<span class="muted small">done</span>' : dstr(op.planned_start) + '<br>' + dstr(op.planned_end)}</td><td class="nowrap small">${dstr(op.baseline_start)}<br>${dstr(op.baseline_end)}</td><td class="nowrap small">${dstr(op.actual_start)}<br>${dstr(op.actual_end)}</td><td>${pill(op.status)} ${op.delayed ? pill('delayed') : ''}</td>${canPlan ? `<td><input type="date" class="inline-input" style="width:130px" data-op="${op.id}" data-k="earliest_start" value="${esc(op.earliest_start || '')}"></td><td><input type="number" step="0.1" class="inline-input" data-op="${op.id}" data-k="manual_minutes" value="${esc(op.manual_minutes || '')}" placeholder="${op.minutes_per_unit ? num(op.minutes_per_unit, 1) : ''}"></td><td><select class="inline-input" style="width:150px" data-op="${op.id}" data-k="manual_section_id">${sel(secOpts, op.manual_section_id || '', 'auto')}</select></td>` : ''}<td class="small muted">${(op.predecessors || []).map((p) => '#' + p.id).join(', ')}</td></tr>`).join('')}</tbody></table></div>
        ${sc.utilisation && sc.utilisation.length ? `<h3 style="margin:14px 8px 6px">Capacity required vs available (this order)</h3><div class="tbl-wrap short"><table class="tbl" data-sheet="Capacity"><thead><tr><th>Resource</th><th class="num">Minutes required</th><th class="num">Daily capacity (min)</th><th class="num">Span (working days)</th><th class="num">Utilisation over span</th><th class="num">Capacity-limited days</th></tr></thead><tbody>${sc.utilisation.map((u) => `<tr><td>${esc(u.name)}</td><td class="num">${num(u.minutes)}</td><td class="num">${num(u.daily_capacity)}</td><td class="num">${u.span_days}</td><td class="num">${pct(u.utilisation_pct)}</td><td class="num">${u.limited_days}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
      const af = body.querySelector('#adjF');
      if (af) {
        af.addEventListener('submit', async (e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(af));
          const opsMap = {};
          body.querySelectorAll('[data-op]').forEach((inp) => { const oid = inp.dataset.op; opsMap[oid] = opsMap[oid] || { id: Number(oid) }; opsMap[oid][inp.dataset.k] = inp.value; });
          d.ops = Object.values(opsMap);
          try { await api.put('orders/' + id, d); toast('Schedule recalculated'); route(); } catch (err) { toast(err.message, true); }
        });
      }
    } else if (tab === 'dept') {
      body.innerHTML = o.departments.map((d) => {
        const dates = Object.keys(d.daily);
        return `<div class="card"><div class="card-h"><h3>${esc(d.section_name)} <span class="muted small">${esc(d.site)} · ${esc(d.department)}</span></h3><span class="small muted">Departmental production order ${esc(o.order_no)}</span></div>
          <table class="tbl" data-sheet="${esc(d.section_name).slice(0, 25)}"><thead><tr><th>Op</th><th>Semi-finished / product</th><th>Stage</th><th class="num">Planned</th><th class="num">Completed</th><th>Start</th><th>End</th><th>Status</th></tr></thead><tbody>${d.ops.map((x) => `<tr><td>${x.op_id}</td><td class="mono">${esc(x.component_code)}</td><td>${esc(x.stage_name)}</td><td class="num">${qty(x.qty_planned)}</td><td class="num">${qty(x.qty_completed)}</td><td>${dstr(x.planned_start)}</td><td>${dstr(x.planned_end)}</td><td>${pill(x.status)}</td></tr>`).join('')}</tbody></table>
          ${dates.length ? `<h4 style="margin-top:10px">Daily targets (remaining plan)</h4><div class="tbl-wrap short"><table class="tbl"><thead><tr>${dates.map((x) => `<th class="num">${x.slice(5)}</th>`).join('')}</tr></thead><tbody><tr>${dates.map((x) => `<td class="num">${qty(d.daily[x])}</td>`).join('')}</tr></tbody></table></div>` : ''}</div>`;
      }).join('') || '<div class="empty">No scheduled operations.</div>';
    } else if (tab === 'semi') {
      body.innerHTML = `<div class="card tight"><div class="tbl-wrap"><table class="tbl" data-sheet="Semi-finished"><thead><tr><th>Level</th><th>Semi-finished code</th><th>Description</th><th>Parent</th><th class="num">Per unit</th><th class="num">Total required</th><th class="num">From stock</th><th class="num">To manufacture</th><th class="num">Received</th><th class="num">Issued to parent</th><th class="num">On hand now</th><th>Sections</th><th class="num">Unit cost (ERP roll-up)</th></tr></thead><tbody>${o.semi_finished.map((c) => `<tr><td>${c.level}</td><td class="mono lvl${Math.min(5, c.level)}"><a href="#/inventory?tab=item&code=${encodeURIComponent(c.component_code)}">${esc(c.component_code)}</a></td><td>${esc(c.description)}</td><td class="mono small">${esc(c.parent_code)}</td><td class="num">${qty(c.qty_per_unit)}</td><td class="num">${qty(c.total_qty)}</td><td class="num">${qty(c.inventory_qty)}</td><td class="num"><b>${qty(c.qty_to_make)}</b></td><td class="num">${qty(c.qty_received)}</td><td class="num">${qty(c.qty_issued)}</td><td class="num">${qty(c.on_hand)}</td><td class="small">${esc(c.department)}</td><td class="num">${money(c.unit_cost)}</td></tr>`).join('')}</tbody></table></div><p class="small muted" style="padding:8px">${Number(state.boot.settings.inventory_enabled) ? 'Available stock is allocated to semi-finished requirements before manufacturing quantities are planned; completed units are received into stock at their final stage and issued when the parent assembly completes.' : 'Inventory netting is switched off in Settings: all components are manufactured from scratch.'}</p></div>`;
    } else if (tab === 'materials') {
      const tot = o.materials.reduce((a, c) => a + (Number(c.ext_cost) || 0), 0); const pend = o.materials.filter((c) => c.cost_pending).length; const shortItems = o.materials.filter((c) => c.shortage > 0).length;
      body.innerHTML = `<div class="card tight"><div class="toolbar" style="padding:8px"><span class="grow"><b>Raw-material requirement list</b> · ${o.materials.length} items · material value ${money(tot)} ${esc(state.boot.settings.currency)} ${pend ? `· <span class="crit">${pend} items Cost Pending</span>` : ''} ${shortItems ? `· <span class="crit">${shortItems} items not covered by stock</span> · <a href="#/inventory?tab=shortages">purchase list</a>` : '· all covered by stock'}</span><button class="btn sm" id="expM">Export</button></div><div class="tbl-wrap"><table class="tbl" data-sheet="Materials"><thead><tr><th>Material code</th><th>Description</th><th>Used in</th><th>Level</th><th class="num">Qty per finished unit</th><th class="num">Total required</th><th>Unit</th><th>Cost group</th><th class="num">On hand</th><th class="num">Allocated</th><th class="num">Issued</th><th class="num">Shortage / to buy</th><th class="num">Unit cost</th><th class="num">Extended cost</th></tr></thead><tbody>${o.materials.map((c) => `<tr><td class="mono"><a href="#/inventory?tab=item&code=${encodeURIComponent(c.component_code)}">${esc(c.component_code)}</a></td><td>${esc(c.description)} ${c.comp_kind === 'purchased_assembly' ? '<span class="pill PENDING">kit / purchased assembly</span>' : ''}</td><td class="mono small">${esc(c.parent_code)}</td><td>${c.level}</td><td class="num">${qty(c.qty_per_unit)}</td><td class="num"><b>${qty(c.total_qty)}</b></td><td>${esc(c.unit)}</td><td class="small">${esc(c.cost_group)}</td><td class="num">${qty(c.on_hand)}</td><td class="num">${qty(c.inventory_qty)}</td><td class="num">${qty(c.qty_issued)}</td><td class="num ${c.shortage > 0 ? 'crit' : ''}">${c.shortage > 0 ? `<b>${qty(c.shortage)}</b>` : '0'}</td><td class="num">${c.cost_pending ? '<span class="pill missing">Cost Pending</span>' : money(c.unit_cost)}</td><td class="num">${money(c.ext_cost)}</td></tr>`).join('')}</tbody></table></div></div>`;
      body.querySelector('#expM').addEventListener('click', () => exportSection(body, o.order_no + '-materials'));
    } else if (tab === 'stock') {
      const mv = o.stock_moves || [];
      body.innerHTML = `<div class="card tight"><div class="toolbar" style="padding:8px"><span class="grow small muted">Movements generated for this order: completed units received (PRODUCTION) at each component's final stage and consumed materials / sub-assemblies issued (ISSUE) by backflush. Undoing a daily log reverses them.</span></div><div class="tbl-wrap"><table class="tbl" data-sheet="Stock moves"><thead><tr><th>Date</th><th>Type</th><th>Item</th><th class="num">Qty</th><th>Warehouse</th><th>Reference</th><th>Reason</th></tr></thead><tbody>${mv.map((m) => `<tr><td>${m.txn_date}</td><td>${pill(m.txn_type)}</td><td class="mono"><a href="#/inventory?tab=item&code=${encodeURIComponent(m.item_code)}">${esc(m.item_code)}</a> <span class="small muted">${esc(m.description)}</span></td><td class="num ${m.qty < 0 ? 'crit' : ''}">${qty(m.qty)}</td><td>${esc(m.warehouse)}</td><td class="small">${esc(m.reference)}</td><td class="small">${esc(m.reason)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No stock movements yet.</td></tr>'}</tbody></table></div></div>`;
    } else if (tab === 'cost') {
      const ac = o.actual_cost;
      body.innerHTML = `<div class="grid g2"><div class="card"><h3>Planned manufacturing cost (${qty(o.qty)} units)</h3><table class="tbl" data-sheet="Cost"><tbody>
        <tr><td>BOM material cost</td><td class="num">${money(cost.material)}</td><td class="num">${money(cost.material * o.qty)}</td></tr>
        <tr><td>Direct labour</td><td class="num">${money(cost.labor)}</td><td class="num">${money(cost.labor * o.qty)}</td></tr>
        <tr><td>Machine / processing</td><td class="num">${money(cost.machine)}</td><td class="num">${money(cost.machine * o.qty)}</td></tr>
        <tr><td>Manufacturing &amp; labour overheads ${Number(state.boot.settings.include_overheads) ? '' : '(excluded)'}</td><td class="num">${money(cost.overhead)}</td><td class="num">${money(cost.overhead * o.qty)}</td></tr>
        <tr><th>Total estimated manufacturing cost</th><th class="num">${money(cost.total)}</th><th class="num">${money(o.planned_cost)}</th></tr>
        <tr><td class="muted">ERP reference cost (workbook BOM roll-up)</td><td class="num muted">${money(cost.erp_total)}</td><td class="num muted">${money(cost.erp_total * o.qty)}</td></tr></tbody></table>
        <p class="small muted">Cost basis: ${esc(cost.basis === 'erp' ? 'workbook "Cost per unit" (ERP line cost)' : 'workbook "Unit Cost" column / price master')}. ${cost.pending ? `<b class="crit">${cost.pending} item(s) have no price - Cost Pending.</b>` : ''} <a href="#/bom?code=${encodeURIComponent(o.product_code)}&qty=${o.qty}">Open full BOM costing</a></p></div>
        <div class="card"><h3>Planned vs actual</h3>${ac ? `<dl class="kv"><dt>Finished units</dt><dd>${qty(ac.finished_units)} of ${qty(o.qty)} (${pct(ac.completion_ratio)})</dd><dt>Planned total</dt><dd>${money(ac.planned_total)}</dd><dt>Actual to date (estimate)</dt><dd>${money(ac.total_est)}</dd><dt>Material consumed (est.)</dt><dd>${money(ac.material_consumed_est)}</dd><dt>Logged manpower (days)</dt><dd>${qty(ac.logged_manpower_days)}</dd></dl><p class="small muted">${esc(ac.note)}</p>` : '<div class="empty">No actuals yet.</div>'}</div></div>`;
    } else if (tab === 'gantt') {
      const g = await api.get('gantt', { order_id: id, status: o.status });
      body.innerHTML = `<div class="card">${renderGantt(g, { dayW: 30 })}</div>`; attachTips(body);
    } else if (tab === 'logs') {
      body.innerHTML = `<div class="card tight"><div class="tbl-wrap"><table class="tbl" data-sheet="Daily logs"><thead><tr><th>Date</th><th>Section</th><th>Component</th><th>Stage</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Rejected</th><th class="num">Rework</th><th class="num">WIP</th><th class="num">Downtime min</th><th class="num">Manpower</th><th class="num">Achievement</th><th>Delay reason</th><th>Remarks</th></tr></thead><tbody>${o.logs.map((l) => `<tr><td>${l.log_date}</td><td>${esc(l.section_name)}</td><td class="mono">${esc(l.component_code)}</td><td>${esc(l.stage_name)}</td><td class="num">${qty(l.planned_qty)}</td><td class="num">${qty(l.actual_qty)}</td><td class="num">${qty(l.rejected_qty)}</td><td class="num">${qty(l.rework_qty)}</td><td class="num">${qty(l.wip_qty)}</td><td class="num">${num(l.downtime_min)}</td><td class="num">${qty(l.manpower)}</td><td class="num">${pct(l.achievement_pct)}</td><td>${esc(l.delay_reason)}</td><td class="small">${esc(l.remarks)}</td></tr>`).join('') || '<tr><td colspan="14" class="empty">No production recorded yet.</td></tr>'}</tbody></table></div></div>`;
    } else if (tab === 'alerts') {
      const audit = can('jmg_manage') ? await api.get('admin/audit', { entity: 'order', entity_id: id }) : [];
      body.innerHTML = `<div class="card"><h3>Alerts</h3>${alertsList(o.alerts)}</div>${can('jmg_manage') ? `<div class="card"><h3>Audit history</h3><div class="tbl-wrap short"><table class="tbl"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody>${audit.map((a) => `<tr><td class="nowrap small">${esc(a.created_at)}</td><td>${esc(a.user_login)}</td><td>${esc(a.action)}</td><td class="small mono">${esc((a.details || '').slice(0, 160))}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
      bindAck(body);
    }
  }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }

  /* Gantt */
  views.gantt = async (el, p) => {
    setTitle('Production Gantt Chart');
    const f = p.q; const b = state.boot;
    const orders = await api.get('orders', { open: 1 });
    const g = await api.get('gantt', f);
    el.innerHTML = `<form class="toolbar" id="gf"><select name="product_code">${sel(b.products.map((x) => ({ v: x.code, l: x.code })), f.product_code, 'All products')}</select><select name="order_id">${sel(orders.map((x) => ({ v: x.id, l: x.order_no + ' ' + x.product_code })), f.order_id, 'All open orders')}</select><select name="department">${sel([...new Set(b.departments.map((x) => x.department))].map((x) => ({ v: x, l: x })), f.department, 'All departments')}</select><select name="status">${sel(['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].map((x) => ({ v: x, l: x })), f.status, 'Open orders')}</select><label class="small"><input type="checkbox" name="include_completed" value="1" ${f.include_completed ? 'checked' : ''}> include completed</label><label class="small">Day width <input type="number" name="dayW" class="inline-input" value="${esc(f.dayW || 26)}" min="10" max="60"></label><button class="btn primary">Apply</button></form><div class="card">${renderGantt(g, { dayW: Number(f.dayW || 26) })}</div>`;
    attachTips(el);
    el.querySelector('#gf').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/gantt?' + new URLSearchParams(new FormData(e.target)).toString(); });
  };

  /* Daily tracking */
  views.tracking = async (el, p) => {
    setTitle('Daily Production Tracking');
    const b = state.boot; const f = p.q;
    const mine = b.user.sections || [];
    const secs = b.sections.filter((s) => !mine.length || mine.includes(Number(s.id)) || can('jmg_plan') || can('jmg_manage'));
    const date = f.date || todayStr();
    const section_id = f.section_id || (secs.length === 1 ? secs[0].id : '');
    const [work, logs] = await Promise.all([api.get('tracking/worklist', { section_id, date }), api.get('tracking/logs', { section_id, from: addDays(date, -14), to: date })]);
    work.sort((a, b) => ((b.target_today > 0) - (a.target_today > 0)) || ((b.status === 'IN_PROGRESS') - (a.status === 'IN_PROGRESS')) || String(a.planned_start || '').localeCompare(String(b.planned_start || '')));
    const reasons = ['', 'Material shortage', 'Machine breakdown', 'Manpower shortage', 'Power outage', 'Quality issue / rework', 'Waiting for previous section', 'Tooling / setup', 'Other'];
    el.innerHTML = `<form class="toolbar" id="tf"><select name="section_id">${sel(secs.map((s) => ({ v: s.id, l: s.section_name + ' (' + s.site + ' · ' + s.department + ')' })), section_id, 'All sections' )}</select><input type="date" name="date" value="${esc(date)}"><button class="btn primary">Show</button><span class="grow"></span><span class="small muted">Production achievement % = actual good ÷ planned × 100</span></form>
      <div class="card tight"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Product</th><th>Section</th><th>Code / stage</th><th class="num">Order qty</th><th class="num">Done</th><th class="num">Target ${date.slice(5)}</th><th class="num">Overdue</th>${can('jmg_track') ? '<th class="num">Actual good</th><th class="num">Rejected</th><th class="num">Rework</th><th class="num">WIP</th><th class="num">Downtime min</th><th class="num">Manpower</th><th>Delay reason</th><th>Remarks</th><th></th>' : '<th>Status</th>'}</tr></thead><tbody>
      ${work.map((w) => `<tr data-op="${w.id}"><td class="mono">${esc(w.order_no)}<br>${pill(w.priority)}</td><td class="small">${esc(w.product_code)}</td><td class="small">${esc(w.section_name)}</td><td><b class="mono">${esc(w.component_code)}</b><br><span class="small">${esc(w.stage_name)}</span></td><td class="num">${qty(w.qty_planned)}</td><td class="num">${qty(w.qty_completed)}</td><td class="num"><b>${qty(w.planned_today)}</b></td><td class="num ${w.planned_overdue > 0 ? 'crit' : ''}">${qty(w.planned_overdue)}</td>${can('jmg_track') ? `<td><input type="number" step="1" min="0" class="inline-input" name="actual_qty" value="${w.target_today > 0 ? Math.min(w.target_today, w.qty_remaining) : ''}"></td><td><input type="number" step="1" min="0" class="inline-input" name="rejected_qty" value="0"></td><td><input type="number" step="1" min="0" class="inline-input" name="rework_qty" value="0"></td><td><input type="number" step="1" min="0" class="inline-input" name="wip_qty" value="0"></td><td><input type="number" step="5" min="0" class="inline-input" name="downtime_min" value="0"></td><td><input type="number" step="1" min="0" class="inline-input" name="manpower" value=""></td><td><select class="inline-input" style="width:150px" name="delay_reason">${reasons.map((r) => `<option>${r}</option>`).join('')}</select></td><td><input type="text" class="inline-input" style="width:160px" name="remarks"></td><td><button class="btn sm primary" data-save="${w.id}">Save</button></td>` : `<td>${pill(w.status)}</td>`}</tr>`).join('') || `<tr><td colspan="17" class="empty">No open operations for this section / date.</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h2>Recent entries</h2><button class="btn sm" id="expL">Export</button></div><div class="tbl-wrap short"><table class="tbl" data-sheet="Daily logs"><thead><tr><th>Date</th><th>Order</th><th>Section</th><th>Code / stage</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Rejected</th><th class="num">Rework</th><th class="num">WIP</th><th class="num">Downtime</th><th class="num">Manpower</th><th class="num">Achievement</th><th>Reason</th><th>Remarks</th><th></th></tr></thead><tbody>${logs.map((l) => `<tr><td>${l.log_date}</td><td class="mono">${esc(l.order_no)}</td><td class="small">${esc(l.section_name)}</td><td class="mono small">${esc(l.component_code)} · ${esc(l.stage_name)}</td><td class="num">${qty(l.planned_qty)}</td><td class="num">${qty(l.actual_qty)}</td><td class="num">${qty(l.rejected_qty)}</td><td class="num">${qty(l.rework_qty)}</td><td class="num">${qty(l.wip_qty)}</td><td class="num">${num(l.downtime_min)}</td><td class="num">${qty(l.manpower)}</td><td class="num ${l.achievement_pct != null && l.achievement_pct < 100 ? 'crit' : ''}">${pct(l.achievement_pct)}</td><td class="small">${esc(l.delay_reason)}</td><td class="small">${esc(l.remarks)}</td><td>${can('jmg_plan') ? `<button class="btn sm danger" data-dl="${l.id}">Undo</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="15" class="empty">No entries.</td></tr>'}</tbody></table></div></div>`;
    el.querySelector('#tf').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/tracking?' + new URLSearchParams(new FormData(e.target)).toString(); });
    el.querySelector('#expL').addEventListener('click', () => exportSection(el, 'daily-production'));
    el.querySelectorAll('[data-save]').forEach((btn) => btn.addEventListener('click', async () => {
      const tr = btn.closest('tr'); const d = { op_id: btn.dataset.save, log_date: date };
      tr.querySelectorAll('[name]').forEach((i) => { d[i.name] = i.value; });
      const w = work.find((x) => String(x.id) === btn.dataset.save); d.planned_qty = w ? w.target_today : '';
      btn.disabled = true;
      try { const r = await api.post('tracking/logs', d); toast(`Saved. Achievement ${pct(r.achievement_pct)} · forecast completion ${r.forecast_end}${r.baseline_end && r.forecast_end > r.baseline_end ? ' (later than baseline ' + r.baseline_end + ')' : ''}${r.stock_moves ? ' · ' + r.stock_moves + ' stock movements posted' : ''}`); route(); } catch (e) { toast(e.message, true); btn.disabled = false; }
    }));
    el.querySelectorAll('[data-dl]').forEach((btn) => btn.addEventListener('click', async () => { if (!confirmDlg('Remove this entry and recalculate?')) { return; } await api.del('tracking/logs/' + btn.dataset.dl); route(); }));
  };

  /* Inventory */
  views.inventory = async (el, p) => {
    setTitle('Inventory');
    const f = p.q; const tab = f.tab || 'stock'; const canStock = can('jmg_stock'); const b = state.boot; const cur = b.settings.currency;
    el.innerHTML = `<div class="tabs">${[['stock', 'Stock on hand'], ['ledger', 'Stock ledger'], ['post', 'Receive / issue / adjust'], ['count', 'Stock count'], ['shortages', 'Shortages & purchase list'], ['valuation', 'Valuation'], ['item', 'Item enquiry']].map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="ib"></div>`;
    el.querySelectorAll('[data-t]').forEach((bt) => bt.addEventListener('click', () => { go('inventory?tab=' + bt.dataset.t); }));
    const body = el.querySelector('#ib'); const whOpts = (b.warehouses || []).map((w) => ({ v: w, l: w }));
    const itemLink = (code) => `<a href="#/inventory?tab=item&code=${encodeURIComponent(code)}" class="mono">${esc(code)}</a>`;
    if (tab === 'stock') {
      const rows = await api.get('inventory/balances', { q: f.q || '', warehouse: f.warehouse || '', type: f.type || '', negative: f.negative || '' });
      const totalValue = rows.reduce((a, r) => a + (Number(r.value) || 0), 0);
      body.innerHTML = `<form class="toolbar" id="sf"><input type="hidden" name="tab" value="stock"><input type="text" name="q" placeholder="Search item / description / cost group" value="${esc(f.q || '')}"><select name="warehouse">${sel(whOpts, f.warehouse, 'All warehouses')}</select><select name="type">${sel([{ v: 'MATERIAL', l: 'Raw materials' }, { v: 'ASSEMBLY', l: 'Semi-finished' }, { v: 'FINISHED', l: 'Finished products' }], f.type, 'All item types')}</select><label class="small"><input type="checkbox" name="negative" value="1" ${f.negative ? 'checked' : ''}> only negative availability</label><button class="btn primary">Filter</button><span class="grow"></span><span class="small muted">${rows.length} items · value ${money(totalValue)} ${esc(cur)}</span><button type="button" class="btn" id="expS">Export</button></form>
        <div class="card tight"><div class="tbl-wrap"><table class="tbl" data-sheet="Stock on hand"><thead><tr><th>Item</th><th>Description</th><th>Type</th><th>Unit</th><th>By warehouse</th><th class="num">On hand</th><th class="num">Reserved for orders</th><th class="num">Available</th><th class="num">Unit cost</th><th class="num">Value (${esc(cur)})</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${itemLink(r.code)}</td><td>${esc(r.description)}</td><td class="small">${esc(r.item_type)}</td><td>${esc(r.unit)}</td><td class="small">${Object.entries(r.warehouses).map(([w, q]) => esc(w) + ': ' + qty(q)).join('<br>')}</td><td class="num"><b>${qty(r.on_hand)}</b></td><td class="num">${qty(r.reserved)}</td><td class="num ${r.available < 0 ? 'crit' : ''}">${qty(r.available)}</td><td class="num">${r.unit_cost == null ? '<span class="pill missing">pending</span>' : money(r.unit_cost)}</td><td class="num">${money(r.value)}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">No stock recorded yet. Use "Receive / issue / adjust" to post opening stock.</td></tr>'}</tbody></table></div></div>`;
      body.querySelector('#sf').addEventListener('submit', (e) => { e.preventDefault(); go('inventory?' + new URLSearchParams(new FormData(e.target)).toString()); });
      body.querySelector('#expS').addEventListener('click', () => exportSection(body, 'stock-on-hand'));
    } else if (tab === 'ledger') {
      const rows = await api.get('inventory/ledger', { q: f.q || '', warehouse: f.warehouse || '', type: f.type || '', from: f.from || '', to: f.to || '' });
      body.innerHTML = `<form class="toolbar" id="lf"><input type="hidden" name="tab" value="ledger"><input type="text" name="q" placeholder="Item / reference" value="${esc(f.q || '')}"><select name="type">${sel(['RECEIPT', 'ISSUE', 'PRODUCTION', 'ADJUSTMENT', 'COUNT', 'TRANSFER', 'RETURN'].map((x) => ({ v: x, l: x })), f.type, 'All types')}</select><select name="warehouse">${sel(whOpts, f.warehouse, 'All warehouses')}</select><input type="date" name="from" value="${esc(f.from || '')}"><input type="date" name="to" value="${esc(f.to || '')}"><button class="btn primary">Filter</button><span class="grow"></span><button type="button" class="btn" id="expL">Export</button></form>
        <div class="card tight"><div class="tbl-wrap"><table class="tbl" data-sheet="Stock ledger"><thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Description</th><th>Warehouse</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit cost</th><th>Reference</th><th>Order</th><th>Reason</th><th>By</th>${canStock ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((m) => `<tr><td class="nowrap">${m.txn_date}</td><td>${pill(m.txn_type)}</td><td>${itemLink(m.item_code)}</td><td class="small">${esc(m.description)}</td><td>${esc(m.warehouse)}</td><td class="num ${m.qty < 0 ? 'crit' : ''}">${qty(m.qty)}</td><td>${esc(m.unit)}</td><td class="num">${money(m.unit_cost)}</td><td class="small">${esc(m.reference)}</td><td class="mono small">${m.order_id ? `<a href="#/orders/${m.order_id}">${esc(m.order_no)}</a>` : ''}</td><td class="small">${esc(m.reason)}</td><td class="small muted">${esc(m.user_login || m.created_by || '')}</td>${canStock ? `<td>${Number(m.is_system) ? '' : `<button class="btn sm danger" data-rev="${m.id}">Reverse</button>`}</td>` : ''}</tr>`).join('') || '<tr><td colspan="13" class="empty">No movements.</td></tr>'}</tbody></table></div></div>`;
      body.querySelector('#lf').addEventListener('submit', (e) => { e.preventDefault(); go('inventory?' + new URLSearchParams(new FormData(e.target)).toString()); });
      body.querySelector('#expL').addEventListener('click', () => exportSection(body, 'stock-ledger'));
      body.querySelectorAll('[data-rev]').forEach((bt) => bt.addEventListener('click', async () => { if (!(await confirmDlg('Post a reversing movement for this transaction?'))) { return; } try { await api.post('inventory/txn/' + bt.dataset.rev + '/reverse'); toast('Reversed'); route(); } catch (e) { toast(e.message, true); } }));
    } else if (tab === 'post') {
      if (!canStock) { body.innerHTML = '<div class="alert info">Your role can view stock but not post movements (Store Keeper, Planner, Manager or Administrator).</div>'; return; }
      body.innerHTML = `<div class="grid g2"><div class="card"><h3>Post a stock movement</h3><form class="form" id="pf">
        <label class="f"><span>Type</span><select name="txn_type" id="ptype">${sel([{ v: 'RECEIPT', l: 'Receipt (purchase / opening stock)' }, { v: 'ISSUE', l: 'Issue (manual, to production or other)' }, { v: 'RETURN', l: 'Return to stock' }, { v: 'ADJUSTMENT', l: 'Adjustment (+ / −)' }, { v: 'TRANSFER', l: 'Transfer between warehouses' }], f.type || 'RECEIPT')}</select></label>
        <label class="f"><span>Date</span><input type="date" name="txn_date" value="${esc(todayStr())}"></label>
        <label class="f full"><span>Item code</span><input type="text" name="item_code" list="itemList" required placeholder="e.g. MSH1-2MM2000x1220-H" value="${esc(f.code || '')}"><datalist id="itemList"></datalist></label>
        <label class="f"><span>Warehouse</span><input type="text" name="warehouse" list="whList" placeholder="item default"><datalist id="whList">${(b.warehouses || []).map((w) => `<option value="${esc(w)}">`).join('')}</datalist></label>
        <label class="f" id="toWh" hidden><span>To warehouse</span><input type="text" name="to_warehouse" list="whList"></label>
        <label class="f"><span>Quantity</span><input type="number" step="0.001" name="qty" required></label>
        <label class="f"><span>Unit cost (blank = price master)</span><input type="number" step="0.01" name="unit_cost"></label>
        <label class="f"><span>Reference (PO, delivery note, order)</span><input type="text" name="reference"></label>
        <label class="f full"><span>Reason / remarks</span><input type="text" name="reason"></label>
        <div class="full"><button class="btn primary">Post movement</button></div></form></div>
        <div class="card"><h3>How the ledger works</h3><ul class="small"><li><b>Receipt</b> adds purchased or opening stock. <b>Issue</b> removes stock manually; issues beyond stock are blocked unless negative stock is allowed in Settings.</li><li><b>Production</b> movements are posted automatically by Daily Tracking: when the final stage of a semi-finished or finished item is recorded, the good units are received into stock and the materials and sub-assemblies consumed (good + rejected) are issued (backflush). Undoing the daily log reverses them.</li><li><b>Allocation</b>: when a plan is generated, available stock (on hand minus reservations of other confirmed orders) is allocated to semi-finished and raw-material requirements; only the balance is manufactured or listed for purchase.</li><li><b>Count</b> adjusts an item to the counted quantity; <b>Transfer</b> moves stock between warehouses.</li></ul></div></div>`;
      const pf = body.querySelector('#pf'); const sync = () => { pf.querySelector('#toWh').hidden = pf.txn_type.value !== 'TRANSFER'; }; pf.txn_type.addEventListener('change', sync); sync();
      let t = null; pf.item_code.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { const list = await api.get('products', { q: pf.item_code.value, all: 1, limit: 30 }); pf.querySelector('#itemList').innerHTML = list.map((x) => `<option value="${esc(x.code)}">${esc(x.description)}</option>`).join(''); }, 250); });
      pf.addEventListener('submit', async (e) => { e.preventDefault(); try { const r = await api.post('inventory/txn', Object.fromEntries(new FormData(pf))); toast(`${r.txn_type} posted: ${qty(r.qty)} ${r.item_code} in ${r.warehouse}`); go('inventory?tab=item&code=' + encodeURIComponent(r.item_code)); } catch (err) { toast(err.message, true); } });
    } else if (tab === 'count') {
      if (!canStock) { body.innerHTML = '<div class="alert info">Your role can view stock but not post counts.</div>'; return; }
      const rows = await api.get('inventory/balances', { warehouse: f.warehouse || '' });
      body.innerHTML = `<form class="toolbar" id="cf"><input type="hidden" name="tab" value="count"><select name="warehouse">${sel(whOpts, f.warehouse, 'All warehouses')}</select><button class="btn primary">Show</button><span class="grow"></span><span class="small muted">Enter the counted quantity per warehouse line and save; the difference is posted as a COUNT adjustment.</span></form>
        <div class="card tight"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Description</th><th>Warehouse</th><th class="num">System qty</th><th class="num">Counted qty</th><th>Reference</th><th></th></tr></thead><tbody>${rows.flatMap((r) => Object.entries(r.warehouses).filter(([w]) => !f.warehouse || w === f.warehouse).map(([w, q]) => `<tr><td>${itemLink(r.code)}</td><td class="small">${esc(r.description)}</td><td>${esc(w)}</td><td class="num">${qty(q)}</td><td><input type="number" step="0.001" class="inline-input" name="counted" value="${q}"></td><td><input type="text" class="inline-input" style="width:120px" name="ref" value="STK-${todayStr()}"></td><td><button class="btn sm" data-count="${esc(r.code)}" data-wh="${esc(w)}">Save count</button></td></tr>`)).join('') || '<tr><td colspan="7" class="empty">No stock lines.</td></tr>'}</tbody></table></div></div>`;
      body.querySelector('#cf').addEventListener('submit', (e) => { e.preventDefault(); go('inventory?' + new URLSearchParams(new FormData(e.target)).toString()); });
      body.querySelectorAll('[data-count]').forEach((bt) => bt.addEventListener('click', async () => { const tr = bt.closest('tr'); try { const r = await api.post('inventory/txn', { txn_type: 'COUNT', item_code: bt.dataset.count, warehouse: bt.dataset.wh, counted_qty: tr.querySelector('[name=counted]').value, reference: tr.querySelector('[name=ref]').value, reason: 'Stock count' }); toast(`Count posted: adjustment ${qty(r.qty)}`); route(); } catch (e) { toast(e.message, true); } }));
    } else if (tab === 'shortages') {
      const rows = await api.get('inventory/shortages', { shortage_only: f.all ? '' : 1 });
      const val = rows.reduce((a, r) => a + (Number(r.purchase_value) || 0), 0);
      body.innerHTML = `<div class="toolbar"><span class="grow small muted">Purchased items required by confirmed orders versus allocated stock. Shortage = required − allocated from stock = quantity to buy. ${rows.length} items · purchase value ${money(val)} ${esc(cur)}</span><label class="small"><input type="checkbox" id="allS" ${f.all ? 'checked' : ''}> show all requirements</label><button class="btn" id="expP">Export purchase list</button></div>
        <div class="card tight"><div class="tbl-wrap"><table class="tbl" data-sheet="Purchase list"><thead><tr><th>Item</th><th>Description</th><th>Unit</th><th>Cost group</th><th class="num">Required</th><th class="num">On hand</th><th class="num">Allocated</th><th class="num">Issued</th><th class="num">Shortage / to buy</th><th>Needed by</th><th class="num">Unit cost</th><th class="num">Purchase value</th><th>Orders</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${itemLink(r.code)}</td><td class="small">${esc(r.description)}</td><td>${esc(r.unit)}</td><td class="small">${esc(r.cost_group)}</td><td class="num">${qty(r.required)}</td><td class="num">${qty(r.on_hand)}</td><td class="num">${qty(r.allocated)}</td><td class="num">${qty(r.issued)}</td><td class="num ${r.shortage > 0 ? 'crit' : ''}"><b>${qty(r.shortage)}</b></td><td>${dstr(r.needed_by)}</td><td class="num">${money(r.unit_cost)}</td><td class="num">${money(r.purchase_value)}</td><td class="small">${r.orders.map((o) => `<a href="#/orders/${o.order_id}" class="mono">${esc(o.order_no)}</a> (${qty(o.shortage)})`).join(', ')}</td></tr>`).join('') || '<tr><td colspan="13" class="empty">No shortages: every purchased requirement is covered by stock.</td></tr>'}</tbody></table></div></div>`;
      body.querySelector('#allS').addEventListener('change', (e) => go('inventory?tab=shortages' + (e.target.checked ? '&all=1' : '')));
      body.querySelector('#expP').addEventListener('click', () => exportSection(body, 'purchase-list'));
    } else if (tab === 'valuation') {
      const v = await api.get('inventory/valuation');
      body.innerHTML = `<div class="grid g3"><div class="tile"><div class="l">Stock value</div><div class="v">${money(v.total_value)}</div><div class="s">${esc(cur)} at price-master unit costs</div></div><div class="tile"><div class="l">Items in stock</div><div class="v">${v.items}</div></div><div class="tile ${v.unpriced_items ? 'warn' : ''}"><div class="l">Items without a price</div><div class="v">${v.unpriced_items}</div><div class="s">not included in the value</div></div></div>
        <div class="card" style="margin-top:14px"><table class="tbl" data-sheet="Valuation"><thead><tr><th>Item type</th><th class="num">Items</th><th class="num">Quantity</th><th class="num">Value (${esc(cur)})</th><th class="num">Unpriced</th></tr></thead><tbody>${v.by_type.map((t) => `<tr><td>${esc(t.item_type)}</td><td class="num">${t.items}</td><td class="num">${qty(t.qty)}</td><td class="num">${money(t.value)}</td><td class="num">${t.unpriced}</td></tr>`).join('')}</tbody></table></div>`;
    } else if (tab === 'item') {
      if (!f.code) { body.innerHTML = `<form class="toolbar" id="itf"><input type="hidden" name="tab" value="item"><input type="text" name="code" placeholder="Item code" required><button class="btn primary">Open</button></form>`; body.querySelector('#itf').addEventListener('submit', (e) => { e.preventDefault(); go('inventory?' + new URLSearchParams(new FormData(e.target)).toString()); }); return; }
      const it = await api.get('inventory/item/' + encodeURIComponent(f.code));
      body.innerHTML = `<div class="card"><div class="card-h"><h2 class="mono">${esc(f.code)}</h2><span class="muted">${esc(it.product ? it.product.description : 'not in product master')}</span>${canStock ? `<a class="btn sm" href="#/inventory?tab=post&code=${encodeURIComponent(f.code)}">Post movement</a>` : ''}</div><div class="grid g4"><div class="tile"><div class="l">On hand</div><div class="v">${qty(it.on_hand)}</div><div class="s">${Object.entries(it.warehouses).map(([w, q]) => esc(w) + ': ' + qty(q)).join(' · ') || 'no stock'}</div></div><div class="tile"><div class="l">Reserved for orders</div><div class="v">${qty(it.reserved)}</div></div><div class="tile"><div class="l">Available</div><div class="v">${qty(it.on_hand - it.reserved)}</div></div><div class="tile"><div class="l">Type / unit</div><div class="v" style="font-size:1rem">${esc(it.product ? it.product.item_type : '')} ${esc(it.product ? it.product.unit : '')}</div><div class="s">${esc(it.product ? it.product.cost_group : '')}</div></div></div></div>
        <div class="grid g2"><div class="card"><h3>Used in open orders</h3><table class="tbl"><thead><tr><th>Order</th><th>Status</th><th class="num">Required</th><th class="num">Allocated</th><th class="num">Issued</th><th class="num">Received</th></tr></thead><tbody>${it.used_in.map((u) => `<tr><td><a href="#/orders/${u.order_id}" class="mono">${esc(u.order_no)}</a></td><td>${pill(u.status)}</td><td class="num">${qty(u.total_qty)}</td><td class="num">${qty(u.inventory_qty)}</td><td class="num">${qty(u.qty_issued)}</td><td class="num">${qty(u.qty_received)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Not required by any open order.</td></tr>'}</tbody></table></div>
        <div class="card"><h3>Ledger</h3><div class="tbl-wrap short"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Warehouse</th><th class="num">Qty</th><th>Reference</th><th>Reason</th></tr></thead><tbody>${it.ledger.map((m) => `<tr><td>${m.txn_date}</td><td>${pill(m.txn_type)}</td><td>${esc(m.warehouse)}</td><td class="num ${m.qty < 0 ? 'crit' : ''}">${qty(m.qty)}</td><td class="small">${esc(m.reference)}</td><td class="small">${esc(m.reason)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No movements.</td></tr>'}</tbody></table></div></div></div>`;
    }
  };

  /* Reports */
  views.reports = async (el, p) => {
    setTitle('Monthly Production Reports');
    const f = Object.assign({ month: monthStr(), category: '' }, p.q);
    const r = await api.get('reports/monthly', f);
    const cur = state.boot.settings.currency;
    el.innerHTML = `<form class="toolbar no-print" id="rf"><input type="month" name="month" value="${esc(f.month)}"><select name="category">${sel([{ v: 'Genset', l: 'Genset' }, { v: 'Canopy', l: 'Canopy' }], f.category, 'Genset + Canopy')}</select><button class="btn primary">Run</button><span class="grow"></span><button type="button" class="btn" id="expX">Export to Excel</button><button type="button" class="btn" onclick="window.print()">Export to PDF (print)</button></form>
      <div id="rep"><div class="card"><h2>${esc(f.category || 'Genset & Canopy')} production report · ${esc(r.month)} <span class="muted small">(${r.working_days} working days)</span></h2>
      <div class="grid g6"><div class="tile"><div class="l">Planned finished units</div><div class="v">${qty(r.finished.planned)}</div></div><div class="tile"><div class="l">Actual finished units</div><div class="v">${qty(r.finished.actual)}</div></div><div class="tile"><div class="l">FP achievement</div><div class="v">${pct(r.finished.achievement_pct)}</div></div><div class="tile"><div class="l">Section achievement</div><div class="v">${pct(r.achievement_pct)}</div><div class="s">all logged operations</div></div><div class="tile"><div class="l">On-time completion</div><div class="v">${pct(r.on_time_pct)}</div><div class="s">${r.on_time_orders}/${r.completed_orders} completed orders</div></div><div class="tile"><div class="l">Lead time (avg / max)</div><div class="v">${r.lead_time_avg || '-'} / ${r.lead_time_max || '-'}</div><div class="s">working days</div></div></div>
      <div class="grid g4" style="margin-top:12px"><div class="tile"><div class="l">Rejected units</div><div class="v">${qty(r.totals.rejected)}</div></div><div class="tile"><div class="l">Reworked units</div><div class="v">${qty(r.totals.rework)}</div></div><div class="tile"><div class="l">Downtime (min)</div><div class="v">${num(r.totals.downtime)}</div></div><div class="tile"><div class="l">Orders in month</div><div class="v">${r.orders.length}</div><div class="s">${r.delays.length} delayed</div></div></div></div>
      <div class="card"><h3>Daily productivity</h3>${r.daily.length ? barChart({ data: r.daily.map((x) => ({ label: x.d.slice(8), values: [x.planned, x.actual] })), series: [{ name: 'Planned', color: '#9ec5f4' }, { name: 'Actual good', color: '#1baf7a' }] }) : '<div class="empty">No daily entries in this month.</div>'}<table class="tbl" data-sheet="Daily"><thead><tr><th>Date</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Rejected</th><th class="num">Rework</th><th class="num">Downtime min</th><th class="num">Achievement</th></tr></thead><tbody>${r.daily.map((x) => `<tr><td>${x.d}</td><td class="num">${qty(x.planned)}</td><td class="num">${qty(x.actual)}</td><td class="num">${qty(x.rejected)}</td><td class="num">${qty(x.rework)}</td><td class="num">${num(x.downtime)}</td><td class="num">${pct(x.planned > 0 ? 100 * x.actual / x.planned : null)}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><h3>Planned vs actual by department / section</h3><div class="tbl-wrap"><table class="tbl" data-sheet="Sections"><thead><tr><th>Site</th><th>Department</th><th>Section</th><th class="num">Planned qty</th><th class="num">Actual qty</th><th class="num">Achievement</th><th class="num">Machine / section utilisation</th><th class="num">Daily productivity</th><th class="num">Units per man-day</th><th class="num">Rejected</th><th class="num">Rework</th><th class="num">Downtime min</th><th class="num">Shortfall days</th></tr></thead><tbody>${r.sections.map((s) => `<tr><td>${esc(s.site)}</td><td>${esc(s.department)}</td><td>${esc(s.section_name)}</td><td class="num">${qty(s.planned_qty)}</td><td class="num">${qty(s.actual_qty)}</td><td class="num">${pct(s.achievement_pct)}</td><td class="num">${pct(s.utilisation_pct)}</td><td class="num">${qty(s.daily_productivity)}</td><td class="num">${qty(s.manpower_productivity)}</td><td class="num">${qty(s.rejected_qty)}</td><td class="num">${qty(s.rework_qty)}</td><td class="num">${num(s.downtime_min)}</td><td class="num">${s.shortfall_days || 0}</td></tr>`).join('') || '<tr><td colspan="13" class="empty">No section activity.</td></tr>'}</tbody></table></div></div>
      <div class="grid g2"><div class="card"><h3>Orders and lead times</h3><div class="tbl-wrap short"><table class="tbl" data-sheet="Orders"><thead><tr><th>Order</th><th>Product</th><th class="num">Qty</th><th>Status</th><th>Baseline end</th><th>Forecast / actual</th><th class="num">Lead days</th><th class="num">Delay days</th></tr></thead><tbody>${r.orders.map((o) => `<tr><td class="mono">${esc(o.order_no)}</td><td>${esc(o.product_code)}</td><td class="num">${qty(o.qty)}</td><td>${pill(o.status)}</td><td>${dstr(o.baseline_end)}</td><td>${dstr(o.actual_end || o.forecast_end)}</td><td class="num">${o.lead_time_days || '-'}</td><td class="num ${o.delay_days > 0 ? 'crit' : ''}">${o.delay_days}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h3>Production delays</h3><table class="tbl" data-sheet="Delays"><thead><tr><th>Delay reason</th><th class="num">Occurrences</th><th class="num">Shortfall units</th></tr></thead><tbody>${r.delay_reasons.map((x) => `<tr><td>${esc(x.reason)}</td><td class="num">${x.n}</td><td class="num">${qty(x.shortfall)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No delay reasons recorded.</td></tr>'}</tbody></table></div></div></div>`;
    attachTips(el);
    el.querySelector('#rf').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/reports?' + new URLSearchParams(new FormData(e.target)).toString(); });
    el.querySelector('#expX').addEventListener('click', () => exportSection(el.querySelector('#rep'), 'production-report-' + f.month));
  };

  /* BOM & costing */
  views.bom = async (el, p) => {
    setTitle('BOM & Costing');
    const f = p.q; const code = f.code || ''; const q = Number(f.qty || 1);
    const tab = f.tab || 'bom';
    el.innerHTML = `<div class="tabs no-print">${[['bom', 'Product BOM & cost'], ['prices', 'Material price & rate master']].map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="bomBody"></div>`;
    el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/bom?' + new URLSearchParams(Object.assign({}, f, { tab: b.dataset.t })).toString(); }));
    const body = el.querySelector('#bomBody');
    if (tab === 'prices') { return priceMaster(body, f); }
    body.innerHTML = `<form class="toolbar" id="bf"><select name="code" style="min-width:360px">${productOptions(code)}</select><label class="small">Quantity <input type="number" name="qty" value="${q}" min="1" class="inline-input"></label><button class="btn primary">Show</button><span class="grow"></span><button type="button" class="btn" id="expB" ${code ? '' : 'disabled'}>Export</button></form><div id="bomOut">${code ? '<div class="empty">Loading…</div>' : '<div class="empty">Select a finished product.</div>'}</div>`;
    body.querySelector('#bf').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/bom?' + new URLSearchParams(new FormData(e.target)).toString(); });
    if (!code) { return; }
    const d = await api.get('products/' + encodeURIComponent(code) + '/bom', { qty: q });
    const c = d.cost; const cur = state.boot.settings.currency;
    const rows = [];
    const walk = (n, lvl) => {
      rows.push({ lvl, code: n.code, desc: n.description, kind: n.kind, qpp: n.qty_per_parent, qpu: n.qty_per_unit, tot: n.total_qty, unit: n.unit, cg: n.cost_group, inc: n.bom_incomplete });
      n.materials.forEach((m) => rows.push({ lvl: lvl + 1, code: m.code, desc: m.description, kind: 'material', qpp: m.qty_per_parent, qpu: m.qty_per_unit, tot: m.total_qty, unit: m.unit, cg: m.cost_group, uc: m.unit_cost }));
      n.ops.forEach((o) => rows.push({ lvl: lvl + 1, code: o.code, desc: o.description, kind: o.type3 === 'MCH OVH' ? 'machine' : 'labour', qpp: o.hours, qpu: o.hours * (n.qty_per_unit || 1), tot: o.hours * (n.qty_per_unit || 1) * q, unit: 'HR', cg: o.type3, uc: o.rate }));
      n.children.forEach((ch) => walk(ch, lvl + 1));
    };
    walk(d.tree, 0);
    const priceMap = {}; c.lines.forEach((l) => { priceMap[l.code + '|' + l.parent] = l; });
    const asmMap = {}; c.assemblies.forEach((a) => { asmMap[a.code] = a; });
    body.querySelector('#bomOut').innerHTML = `
      <div class="grid g6"><div class="tile"><div class="l">Material cost / unit</div><div class="v">${money(c.material)}</div></div><div class="tile"><div class="l">Direct labour / unit</div><div class="v">${money(c.labor)}</div></div><div class="tile"><div class="l">Machine / processing</div><div class="v">${money(c.machine)}</div></div><div class="tile"><div class="l">Overheads</div><div class="v">${money(c.overhead)}</div></div><div class="tile ${c.pending_count ? 'warn' : 'good'}"><div class="l">Total / unit (${esc(cur)})</div><div class="v">${money(c.total)}</div><div class="s">${esc(c.cost_status)}${c.pending_count ? ' · ' + c.pending_count + ' items without price' : ''} · ERP ref ${money(c.erp_total)}</div></div><div class="tile"><div class="l">Order total × ${q}</div><div class="v">${money(c.order_total)}</div></div></div>
      ${d.issues.length ? `<div class="alert warn" style="margin-top:10px">${d.issues.map(esc).join('<br>')}</div>` : ''}
      <div class="card" style="margin-top:12px"><div class="card-h"><h3>Multi-level BOM for ${esc(d.product.code)} <span class="muted small">${esc(d.product.description)}</span></h3><span class="small muted">Material cost = required quantity × unit cost · sub-assemblies roll up from their own lines (no double counting)</span></div><div class="tbl-wrap"><table class="tbl" data-sheet="BOM ${esc(code)}"><thead><tr><th>Level</th><th>Code</th><th>Description</th><th>Type</th><th>Parent</th><th class="num">Qty per parent</th><th class="num">Qty per finished unit</th><th class="num">Total for ${q}</th><th>Unit</th><th>Cost group</th><th class="num">Unit cost / rate</th><th class="num">Extended cost / unit</th><th class="num">Assembly roll-up / unit</th></tr></thead><tbody>${(() => { const parents = [d.product.code]; return rows.map((r) => { parents[r.lvl] = r.code; const parent = r.lvl ? parents[r.lvl - 1] : ''; const pl = priceMap[r.code + '|' + parent]; const asm = asmMap[r.code]; const isAsm = ['assembly', 'purchased_assembly', 'finished'].includes(r.kind); return `<tr class="${r.lvl ? 'sub' : ''}"><td>${r.lvl}</td><td class="mono lvl${Math.min(5, r.lvl)}">${esc(r.code)}</td><td>${esc(r.desc)} ${r.inc ? '<span class="pill missing">BOM incomplete</span>' : ''}</td><td class="small">${esc(r.kind)}</td><td class="mono small">${esc(parent)}</td><td class="num">${qty(r.qpp)}</td><td class="num">${qty(r.qpu)}</td><td class="num">${qty(r.tot)}</td><td>${esc(r.unit)}</td><td class="small">${esc(r.cg)}</td><td class="num">${isAsm ? '' : (pl && pl.unit_cost != null ? money(pl.unit_cost) : '<span class="pill missing">Cost Pending</span>')}</td><td class="num">${isAsm ? '' : (pl && pl.ext_cost != null ? money(pl.ext_cost) : '-')}</td><td class="num">${isAsm && asm ? `<b>${money(asm.total)}</b><br><span class="small muted">mat ${money(asm.material)} · lab ${money(asm.labor)} · mch ${money(asm.machine)} · oh ${money(asm.overhead)}</span>` : ''}</td></tr>`; }).join(''); })()}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Routing derived from BOM operations</h3><span class="small muted">${d.routing_warnings.length} note(s)</span></div><div class="tbl-wrap short"><table class="tbl" data-sheet="Routing"><thead><tr><th>Component</th><th>Stage</th><th>Section</th><th>Capacity match</th><th class="num">Min / unit</th><th class="num">BOM labour h / unit</th><th>Note</th></tr></thead><tbody>${d.ops.map((o) => `<tr><td class="mono">${esc(o.component_code)}</td><td>${esc(o.stage_name)}</td><td>${esc(o.section_name || '-')}</td><td><span class="pill ${esc(o.capacity_match)}">${esc(o.capacity_match)}</span></td><td class="num">${o.minutes_per_unit ? num(o.minutes_per_unit, 1) : '-'}</td><td class="num">${num(o.bom_hours_per_unit, 2)}</td><td class="small">${esc(o.capacity_note)}</td></tr>`).join('')}</tbody></table></div>${d.routing_warnings.length ? `<ul class="small" style="margin:8px 0 0 18px">${d.routing_warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</div>`;
    body.querySelector('#expB').addEventListener('click', () => exportSection(body.querySelector('#bomOut'), 'bom-' + code));
  };
  async function priceMaster(body, f) {
    const list = await api.get('prices', { q: f.q || '', type: f.type || '', pending: f.pending || '' });
    const canCost = can('jmg_cost');
    body.innerHTML = `<form class="toolbar" id="pf"><input type="hidden" name="tab" value="prices"><input type="text" name="q" placeholder="Search code / description / cost group" value="${esc(f.q || '')}"><select name="type">${sel([{ v: 'material', l: 'Materials' }, { v: 'labor', l: 'Labour rates' }, { v: 'machine', l: 'Machine rates' }, { v: 'overhead', l: 'Overhead rates' }], f.type, 'All types')}</select><label class="small"><input type="checkbox" name="pending" value="1" ${f.pending ? 'checked' : ''}> Cost Pending only</label><button class="btn primary">Filter</button><span class="grow"></span>${canCost ? '<button type="button" class="btn" id="addP">+ Add price</button>' : ''}</form>
      <div class="card tight"><div class="tbl-wrap"><table class="tbl" data-sheet="Prices"><thead><tr><th>Code</th><th>Description</th><th>Type</th><th>Unit</th><th>Cost group</th><th class="num">Unit cost / rate (${esc(state.boot.settings.currency)})</th><th>Source</th><th>Note</th><th>Updated</th>${canCost ? '<th></th>' : ''}</tr></thead><tbody>${list.map((p) => `<tr><td class="mono">${esc(p.code)}</td><td>${esc(p.description)}</td><td>${esc(p.price_type)}</td><td>${esc(p.unit)}</td><td class="small">${esc(p.cost_group)}</td><td class="num">${canCost ? `<input type="number" step="0.01" class="inline-input" style="width:120px" data-code="${esc(p.code)}" value="${p.unit_cost == null ? '' : p.unit_cost}" placeholder="pending">` : (p.unit_cost == null ? '<span class="pill missing">Cost Pending</span>' : num(p.unit_cost, 2))}</td><td class="small">${esc(p.source)}</td><td class="small muted">${esc(p.conflict_note)}</td><td class="small">${esc((p.updated_at || '').slice(0, 10))}</td>${canCost ? `<td><button class="btn sm" data-save="${esc(p.code)}">Save</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="10" class="empty">No prices match.</td></tr>'}</tbody></table></div></div>`;
    body.querySelector('#pf').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/bom?' + new URLSearchParams(new FormData(e.target)).toString(); });
    body.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => { const inp = body.querySelector(`input[data-code="${CSS.escape(b.dataset.save)}"]`); try { await api.post('prices', { code: b.dataset.save, unit_cost: inp.value }); toast('Price saved'); } catch (e) { toast(e.message, true); } }));
    const add = body.querySelector('#addP');
    if (add) { add.addEventListener('click', () => { const m = modal(`<h2>Add price / rate</h2><form class="form" id="apf"><label class="f"><span>Code</span><input name="code" required></label><label class="f"><span>Description</span><input name="description"></label><label class="f"><span>Type</span><select name="price_type">${sel([{ v: 'material', l: 'Material' }, { v: 'labor', l: 'Labour rate (per hour)' }, { v: 'machine', l: 'Machine rate (per hour)' }, { v: 'overhead', l: 'Overhead rate' }], 'material')}</select></label><label class="f"><span>Unit</span><input name="unit" value="PCS"></label><label class="f"><span>Unit cost</span><input type="number" step="0.01" name="unit_cost"></label><div class="full" style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`); m.el.querySelector('#apf').addEventListener('submit', async (e) => { e.preventDefault(); try { await api.post('prices', Object.fromEntries(new FormData(e.target))); m.close(); toast('Saved'); route(); } catch (err) { toast(err.message, true); } }); }); }
  }

  /* Masters */
  views.masters = async (el, p) => {
    setTitle('Masters & Capacities');
    const tab = p.q.tab || 'sections';
    const isAdmin = can('jmg_admin');
    el.innerHTML = `<div class="tabs">${[['sections', 'Sections & productivity'], ['machines', 'Cutting machines'], ['stagemap', 'Workflow stage map'], ['series', 'Size classes'], ['overrides', 'Capacity overrides'], ['calendar', 'Working calendar'], ['issues', 'Data issues'], ['settings', 'Settings']].map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-t="${k}">${l}${k === 'issues' && state.boot.counts.issues ? ` <span class="pill delayed">${state.boot.counts.issues}</span>` : ''}</button>`).join('')}</div><div id="mb"></div>`;
    el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/masters?tab=' + b.dataset.t; }));
    const body = el.querySelector('#mb');
    const ro = isAdmin ? '' : 'disabled';
    if (tab === 'sections') {
      const secs = await api.get('masters/sections');
      body.innerHTML = `<p class="small muted">Imported from the workbook sheets "Canopy Assembly" (Gbagada) and "Genset Assembly" (Ikotun). Productivity figures are per shift as given in the workbook (rows marked "per 2 shifts" are halved per shift). Minutes per unit = ${esc(state.boot.settings.net_minutes)} ÷ productivity per shift. Capacity basis in use: <b>${esc(state.boot.settings.capacity_basis)}</b> productivity.</p>` + secs.map((s) => `<div class="card tight"><div class="card-h" style="padding:6px 8px 0"><h3>${esc(s.section_name)} <span class="muted small">${esc(s.site)} · ${esc(s.department)} · stage <code>${esc(s.stage_key)}</code></span></h3><span class="small muted">${esc(s.productivity_header)} · ${s.excel_shifts > 1 ? s.excel_shifts + ' shifts in workbook' : '1 shift'}</span></div>
        <form class="toolbar sec-form" data-id="${s.id}" style="padding:4px 8px"><label class="f"><span>Staffs</span><input type="number" step="0.5" name="staffs" value="${s.staffs ?? ''}" class="inline-input" ${ro}></label><label class="f"><span>Available staffs</span><input type="number" step="0.5" name="total_available_staffs" value="${s.total_available_staffs ?? ''}" class="inline-input" ${ro}></label><label class="f"><span>New staffs</span><input type="number" step="0.5" name="new_staffs" value="${s.new_staffs ?? ''}" class="inline-input" ${ro}></label><label class="f"><span>Lines / machines</span><input type="number" name="machines" value="${s.machines}" class="inline-input" ${ro}></label><label class="f"><span>Min / day</span><input type="number" name="minutes_per_day" value="${s.minutes_per_day}" class="inline-input" ${ro}></label><label class="f"><span>Stage key</span><input type="text" name="stage_key" value="${esc(s.stage_key)}" class="inline-input" style="width:150px" ${ro}></label><label class="f"><span>Active</span><select name="is_active" class="inline-input" ${ro}>${sel([{ v: 1, l: 'yes' }, { v: 0, l: 'no' }], s.is_active)}</select></label>${isAdmin ? '<button class="btn sm">Save section</button>' : ''}</form>
        <div class="tbl-wrap short"><table class="tbl"><thead><tr><th>Type / code</th><th>Series</th><th>kVA band</th><th class="num">Per machine/staff</th><th class="num">Staffs</th><th class="num">Lines</th><th class="num">Productivity / shift (workbook)</th><th class="num">New productivity</th><th class="num">Manual override</th><th class="num">Min / unit</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>${s.capacities.map((c) => { const prod = c.manual_override > 0 ? c.manual_override : (state.boot.settings.capacity_basis === 'new' && c.new_productivity > 0 ? c.new_productivity : c.productivity_per_shift); const mpu = prod > 0 ? s.minutes_per_day / (prod / Math.max(1, s.excel_shifts)) : null; return `<tr data-cap="${c.id}"><td class="mono">${esc(c.type_code)}</td><td>${esc(c.series_key)}</td><td>${c.kva_min != null ? c.kva_min + '–' + c.kva_max : ''}</td><td class="num">${qty(c.per_resource)}</td><td class="num">${qty(c.staffs)}</td><td class="num">${qty(c.prod_lines)}</td><td class="num"><input type="number" step="0.01" name="productivity_per_shift" value="${c.productivity_per_shift ?? ''}" class="inline-input" ${ro}></td><td class="num"><input type="number" step="0.01" name="new_productivity" value="${c.new_productivity ?? ''}" class="inline-input" ${ro}></td><td class="num"><input type="number" step="0.01" name="manual_override" value="${c.manual_override ?? ''}" class="inline-input" ${ro}></td><td class="num ${mpu == null ? 'crit' : ''}">${mpu == null ? 'missing' : num(mpu, 1)}</td>${isAdmin ? `<td><button class="btn sm" data-capsave="${c.id}">Save</button></td>` : ''}</tr>`; }).join('')}</tbody></table></div>${isAdmin ? `<div style="padding:6px 8px"><button class="btn sm" data-addcap="${s.id}">+ Add type row</button></div>` : ''}</div>`).join('');
      body.querySelectorAll('.sec-form').forEach((f) => f.addEventListener('submit', async (e) => { e.preventDefault(); try { await api.put('masters/sections/' + f.dataset.id, Object.fromEntries(new FormData(f))); toast('Section saved'); } catch (err) { toast(err.message, true); } }));
      body.querySelectorAll('[data-capsave]').forEach((b) => b.addEventListener('click', async () => { const tr = b.closest('tr'); const d = {}; tr.querySelectorAll('input[name]').forEach((i) => { d[i.name] = i.value; }); try { await api.put('masters/capacities/' + b.dataset.capsave, d); toast('Capacity saved. Re-plan orders to apply.'); } catch (err) { toast(err.message, true); } }));
      body.querySelectorAll('[data-addcap]').forEach((b) => b.addEventListener('click', async () => { const code = prompt('Type / code for the new row (e.g. P600, SFP-BT-P1100):'); if (!code) { return; } const prod = prompt('Productivity per shift:'); try { await api.post('masters/capacities', { section_id: b.dataset.addcap, type_code: code, productivity_per_shift: prod }); toast('Row added'); route(); } catch (err) { toast(err.message, true); } }));
    } else if (tab === 'machines') {
      const m = await api.get('masters/machines');
      body.innerHTML = `<div class="card"><h3>Cutting machine times per canopy (sheet "Cutting Capacity")</h3><p class="small muted">Each canopy series needs Punch 1, Punch 2 and Plasma time. The canopy cutting stage is limited by the section manpower and by each machine's ${esc(state.boot.settings.net_minutes)} productive minutes per day; machines are shared across all orders.</p><table class="tbl" data-sheet="Machines"><thead><tr><th>Canopy series</th><th>Machine</th><th class="num">Minutes per canopy</th><th class="num">Canopies per shift</th><th class="num">% of machine shift</th></tr></thead><tbody>${m.machine_times.map((x) => `<tr><td>${esc(x.canopy_series)}</td><td>${esc(x.machine)}</td><td class="num">${num(x.minutes_per_canopy, 2)}</td><td class="num">${qty(x.qty_per_shift)}</td><td class="num">${pct(x.pct_consumed * 100)}</td></tr>`).join('')}</tbody></table></div>
        <div class="card"><h3>Nesting files (sheets Capacity S1–S4, 200, 500)</h3><div class="tbl-wrap short"><table class="tbl"><thead><tr><th>Sheet</th><th>Series</th><th>Machine</th><th>File</th><th>Parts</th><th>Plate</th><th class="num">Minutes</th></tr></thead><tbody>${m.cutting_files.map((x) => `<tr><td>${esc(x.sheet_name)}</td><td>${esc(x.canopy_series)}</td><td>${esc(x.machine)}</td><td>${esc(x.file_name)}</td><td class="small">${esc(x.description)}</td><td class="small">${esc(x.plate)}</td><td class="num">${num(x.minutes, 2)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if (tab === 'stagemap') {
      const map = await api.get('masters/stage-map'); const secOpts = state.boot.sections.map((s) => ({ v: s.id, l: s.section_name + ' (' + s.site + ')' }));
      body.innerHTML = `<div class="card tight"><p class="small muted" style="padding:8px">BOM process resource codes (e.g. IK-WBT = Ikotun base tank welding) are mapped to workflow stages, in sequence, and to the workbook section that provides the capacity. Family lets the same operation code route base, panel and other parts to different sections.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Op code</th><th>Family</th><th>BOM resource</th><th>Stage key</th><th>Stage name</th><th>Workflow group</th><th class="num">Seq</th><th>Section</th><th>Machines</th><th>Scheduled</th><th>Notes</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>${map.map((m) => `<tr data-id="${m.id}"><td class="mono">${esc(m.op_prefix)}</td><td>${esc(m.family)}</td><td class="small">${esc(m.op_label)}</td><td><input name="stage_key" value="${esc(m.stage_key)}" class="inline-input" style="width:130px" ${ro}></td><td><input name="stage_name" value="${esc(m.stage_name)}" class="inline-input" style="width:170px" ${ro}></td><td><input name="workflow_group" value="${esc(m.workflow_group)}" class="inline-input" style="width:100px" ${ro}></td><td><input type="number" name="sequence" value="${m.sequence}" class="inline-input" style="width:60px" ${ro}></td><td><select name="section_id" class="inline-input" style="width:200px" ${ro}>${sel(secOpts, m.section_id || '', '(any with stage key)')}</select></td><td><input name="machine_group" value="${esc(m.machine_group)}" class="inline-input" style="width:90px" ${ro}></td><td><select name="is_scheduled" class="inline-input" ${ro}>${sel([{ v: 1, l: 'yes' }, { v: 0, l: 'no' }], m.is_scheduled)}</select></td><td class="small muted">${esc(m.notes)}</td>${isAdmin ? `<td><button class="btn sm" data-ms="${m.id}">Save</button></td>` : ''}</tr>`).join('')}</tbody></table></div></div>`;
      body.querySelectorAll('[data-ms]').forEach((b) => b.addEventListener('click', async () => { const tr = b.closest('tr'); const d = {}; tr.querySelectorAll('[name]').forEach((i) => { d[i.name] = i.value; }); try { await api.put('masters/stage-map/' + b.dataset.ms, d); toast('Saved'); } catch (err) { toast(err.message, true); } }));
    } else if (tab === 'series') {
      const list = await api.get('masters/series');
      body.innerHTML = `<div class="card tight"><p class="small muted" style="padding:8px"><b>Planning assumption (editable):</b> kVA bands connect finished-product ratings to the workbook size classes (400SRS, S1–S4, P200/P250 …) used by base, panel and canopy capacity rows, and to the canopy cutting series of the Cutting Capacity sheet. Derived from the workbook codes (SPGP22 → BASE-400SRS, SPGP65 → OPT-BASE-S2, SPGP110 → BASE-S3-OPT).</p><table class="tbl"><thead><tr><th>Series key</th><th>Label</th><th class="num">kVA min</th><th class="num">kVA max</th><th>Canopy cutting series</th><th>Aliases in codes</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>${list.map((s) => `<tr data-id="${s.id}"><td class="mono">${esc(s.series_key)}</td><td><input name="label" value="${esc(s.label)}" class="inline-input" style="width:140px" ${ro}></td><td><input type="number" name="kva_min" value="${s.kva_min ?? ''}" class="inline-input" ${ro}></td><td><input type="number" name="kva_max" value="${s.kva_max ?? ''}" class="inline-input" ${ro}></td><td><input name="canopy_cut_series" value="${esc(s.canopy_cut_series)}" class="inline-input" ${ro}></td><td><input name="aliases" value="${esc(s.aliases)}" class="inline-input" style="width:320px" ${ro}></td>${isAdmin ? `<td><button class="btn sm" data-ss="${s.id}">Save</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
      body.querySelectorAll('[data-ss]').forEach((b) => b.addEventListener('click', async () => { const tr = b.closest('tr'); const d = {}; tr.querySelectorAll('[name]').forEach((i) => { d[i.name] = i.value; }); try { await api.put('masters/series/' + b.dataset.ss, d); toast('Saved'); } catch (err) { toast(err.message, true); } }));
    } else if (tab === 'overrides') {
      const [list, secs] = await Promise.all([api.get('masters/overrides'), api.get('masters/sections')]);
      const capOpts = []; secs.forEach((s) => s.capacities.forEach((c) => capOpts.push({ v: c.id, l: s.section_name + ' · ' + c.type_code })));
      body.innerHTML = `<div class="card"><h3>Component / stage capacity overrides</h3><p class="small muted">Pin a component code at a stage to a specific workbook capacity row, or set minutes per unit directly. Overrides take precedence over automatic size-class matching.</p>${isAdmin ? `<form class="form" id="of"><label class="f"><span>Component code</span><input name="component_code" required placeholder="e.g. 143-0851"></label><label class="f"><span>Stage key</span><input name="stage_key" required placeholder="e.g. wg_pwc"></label><label class="f"><span>Capacity row</span><select name="capacity_id">${sel(capOpts, '', '(none)')}</select></label><label class="f"><span>Minutes per unit</span><input type="number" step="0.1" name="minutes_per_unit"></label><label class="f"><span>Notes</span><input name="notes"></label><div><button class="btn primary">Save override</button></div></form>` : ''}<table class="tbl"><thead><tr><th>Component</th><th>Stage</th><th>Capacity row</th><th class="num">Min / unit</th><th>Notes</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>${list.map((o) => `<tr><td class="mono">${esc(o.component_code)}</td><td>${esc(o.stage_key)}</td><td>${esc(o.section_name || '')} ${esc(o.type_code || '')}</td><td class="num">${o.minutes_per_unit ?? '-'}</td><td>${esc(o.notes)}</td>${isAdmin ? `<td><button class="btn sm danger" data-del="${o.id}">Remove</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="empty">No overrides.</td></tr>'}</tbody></table></div>`;
      const of = body.querySelector('#of'); if (of) { of.addEventListener('submit', async (e) => { e.preventDefault(); try { await api.post('masters/overrides', Object.fromEntries(new FormData(of))); toast('Saved'); route(); } catch (err) { toast(err.message, true); } }); }
      body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await api.del('masters/overrides/' + b.dataset.del); route(); }));
    } else if (tab === 'calendar') {
      const c = await api.get('masters/calendar');
      const wdays = (c.working_days || []).map(Number);
      body.innerHTML = `<div class="grid g2"><div class="card"><h3>Working week</h3><p class="small muted">Production day ${esc(state.boot.settings.work_start)}–${esc(state.boot.settings.work_end)}, break ${esc(state.boot.settings.break_minutes)} min, net ${esc(state.boot.settings.net_minutes)} productive minutes, ${esc(state.boot.settings.shifts_per_day)} shift(s) per day (Settings tab).</p><form id="wdf">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => `<label style="margin-right:12px"><input type="checkbox" name="wd" value="${i + 1}" ${wdays.includes(i + 1) ? 'checked' : ''} ${ro}> ${d}</label>`).join('')}${isAdmin ? '<div style="margin-top:10px"><button class="btn primary">Save working days</button></div>' : ''}</form></div>
        <div class="card"><h3>Holidays and extra working days</h3>${isAdmin ? `<form class="toolbar" id="hf"><input type="date" name="date" required><select name="is_working">${sel([{ v: 0, l: 'Holiday (non-working)' }, { v: 1, l: 'Extra working day' }], 0)}</select><input type="text" name="note" placeholder="Note"><button class="btn primary">Add</button></form>` : ''}<table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Note</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>${c.overrides.map((o) => `<tr><td>${o.cal_date}</td><td>${Number(o.is_working) ? 'Working day' : 'Holiday'}</td><td>${esc(o.note)}</td>${isAdmin ? `<td><button class="btn sm danger" data-rm="${o.cal_date}">Remove</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="4" class="empty">No overrides.</td></tr>'}</tbody></table></div></div>`;
      const wdf = body.querySelector('#wdf'); wdf.addEventListener('submit', async (e) => { e.preventDefault(); const days = Array.from(wdf.querySelectorAll('input:checked')).map((i) => Number(i.value)); await api.put('settings', { working_days: days }); toast('Saved. Re-plan orders to apply.'); await boot(false); });
      const hf = body.querySelector('#hf'); if (hf) { hf.addEventListener('submit', async (e) => { e.preventDefault(); await api.post('masters/calendar', Object.fromEntries(new FormData(hf))); route(); }); }
      body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { await api.post('masters/calendar', { date: b.dataset.rm, remove: 1 }); route(); }));
    } else if (tab === 'issues') {
      const list = await api.get('masters/issues', { all: p.q.all || '' });
      body.innerHTML = `<div class="card tight"><div class="toolbar" style="padding:8px"><span class="grow small muted">Information missing or ambiguous in the workbook. Nothing has been invented: affected operations are flagged in plans until the administrator completes the data.</span><label class="small"><input type="checkbox" id="showAll" ${p.q.all ? 'checked' : ''}> show resolved</label><button class="btn sm" id="expI">Export</button></div><div class="tbl-wrap"><table class="tbl" data-sheet="Data issues"><thead><tr><th>Type</th><th>Reference</th><th>Message</th><th>Status</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>${list.map((i) => `<tr><td><span class="pill ${i.issue_type.includes('missing') || i.issue_type.includes('zero') ? 'missing' : 'approx'}">${esc(i.issue_type)}</span></td><td class="mono">${esc(i.ref_code)}</td><td>${esc(i.message)}</td><td>${Number(i.is_resolved) ? 'resolved' : 'open'}</td>${isAdmin ? `<td><button class="btn sm" data-res="${i.id}" data-v="${Number(i.is_resolved) ? 0 : 1}">${Number(i.is_resolved) ? 'Reopen' : 'Mark resolved'}</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="5" class="empty">No open issues.</td></tr>'}</tbody></table></div></div>`;
      body.querySelector('#showAll').addEventListener('change', (e) => { location.hash = '#/masters?tab=issues' + (e.target.checked ? '&all=1' : ''); });
      body.querySelector('#expI').addEventListener('click', () => exportSection(body, 'data-issues'));
      body.querySelectorAll('[data-res]').forEach((b) => b.addEventListener('click', async () => { await api.put('masters/issues/' + b.dataset.res, { is_resolved: b.dataset.v }); await boot(false); route(); }));
    } else if (tab === 'settings') {
      const s = state.boot.settings;
      body.innerHTML = `<div class="card"><form class="form" id="sf">
        <label class="f"><span>Company</span><input name="company_name" value="${esc(s.company_name)}" ${ro}></label><label class="f"><span>Currency</span><input name="currency" value="${esc(s.currency)}" ${ro}></label>
        <label class="f"><span>Work start</span><input name="work_start" value="${esc(s.work_start)}" ${ro}></label><label class="f"><span>Work end</span><input name="work_end" value="${esc(s.work_end)}" ${ro}></label><label class="f"><span>Break (min)</span><input type="number" name="break_minutes" value="${esc(s.break_minutes)}" ${ro}></label><label class="f"><span>Net productive minutes / day</span><input type="number" name="net_minutes" value="${esc(s.net_minutes)}" ${ro}></label><label class="f"><span>Shifts per day</span><input type="number" name="shifts_per_day" value="${esc(s.shifts_per_day)}" min="1" max="3" ${ro}></label>
        <label class="f"><span>Batch transfer rule</span><select name="transfer_rule" ${ro}>${sel([{ v: 'next_day', l: 'Completed units move next day' }, { v: 'same_day', l: 'Completed units move same day' }, { v: 'full_lot', l: 'Wait for full lot' }], s.transfer_rule)}</select></label>
        <label class="f"><span>Capacity basis</span><select name="capacity_basis" ${ro}>${sel([{ v: 'current', l: 'Workbook current productivity' }, { v: 'new', l: 'Workbook "New Productivity"' }], s.capacity_basis)}</select></label>
        <label class="f"><span>Cost basis</span><select name="cost_basis" ${ro}>${sel([{ v: 'unit_cost', l: 'Workbook "Unit Cost" / price master' }, { v: 'erp', l: 'Workbook ERP "Cost per unit"' }], s.cost_basis)}</select></label>
        <label class="f"><span>Include overheads in cost</span><select name="include_overheads" ${ro}>${sel([{ v: 1, l: 'yes' }, { v: 0, l: 'no' }], s.include_overheads)}</select></label>
        <label class="f"><span>Inventory netting</span><select name="inventory_enabled" ${ro}>${sel([{ v: 0, l: 'off (manufacture / buy everything)' }, { v: 1, l: 'on (allocate available stock)' }], s.inventory_enabled)}</select></label>
        <label class="f"><span>Backflush on completion</span><select name="backflush_enabled" ${ro}>${sel([{ v: 1, l: 'on (receive output, issue consumed items)' }, { v: 0, l: 'off' }], s.backflush_enabled == null ? 1 : s.backflush_enabled)}</select></label>
        <label class="f"><span>Allow negative stock</span><select name="allow_negative_stock" ${ro}>${sel([{ v: 0, l: 'no (block issues beyond stock)' }, { v: 1, l: 'yes' }], s.allow_negative_stock || 0)}</select></label>
        <label class="f"><span>Default warehouse</span><input name="default_warehouse" value="${esc(s.default_warehouse || 'MAIN')}" ${ro}></label>
        <label class="f"><span>Planning horizon (days)</span><input type="number" name="horizon_days" value="${esc(s.horizon_days)}" ${ro}></label><label class="f"><span>Default plan start (working days from today)</span><input type="number" name="plan_lead_days" value="${esc(s.plan_lead_days)}" ${ro}></label>
        ${isAdmin ? '<div class="full"><button class="btn primary">Save settings</button> <span class="small muted">Re-plan orders after changing capacity-related settings.</span></div>' : ''}</form></div>`;
      body.querySelector('#sf').addEventListener('submit', async (e) => { e.preventDefault(); try { await api.put('settings', Object.fromEntries(new FormData(e.target))); toast('Settings saved'); await boot(false); route(); } catch (err) { toast(err.message, true); } });
    }
  };

  /* Admin */
  views.admin = async (el, p) => {
    setTitle('Administration');
    const tab = p.q.tab || 'import';
    el.innerHTML = `<div class="tabs">${[['import', 'Excel import'], ['users', 'Users & roles'], ['backup', 'Backup & restore'], ['audit', 'Audit log'], ['demo', 'Demo scenario']].map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="ab"></div>`;
    el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/admin?tab=' + b.dataset.t; }));
    const body = el.querySelector('#ab');
    if (tab === 'import') {
      const imp = state.boot.import;
      body.innerHTML = `<div class="card"><h3>Import / update the production workbook</h3><p class="small">Upload the Excel workbook (same layout as <code>Prodction Data.xlsx</code>: sheets BOM, Finished Product, Canopy Assembly, Genset Assembly, Cutting Capacity, Capacity S1–S4/200/500). Product, BOM, section, capacity and machine masters are replaced; manually entered prices, overrides, calendar, orders and tracking history are kept. Missing figures are flagged under Masters → Data issues, never invented.</p>${imp ? `<p class="small muted">Last import: ${esc(imp.file_name)} on ${esc(imp.created_at)}.</p>` : ''}<form id="if" class="toolbar"><input type="file" name="file" accept=".xlsx" required><label class="small"><input type="checkbox" name="replan" value="1"> re-plan confirmed orders afterwards</label><button class="btn primary">Import workbook</button></form><pre id="ires" class="small"></pre></div>`;
      body.querySelector('#if').addEventListener('submit', async (e) => { e.preventDefault(); const fd = new FormData(e.target); const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Importing… (about a minute)'; try { const r = await api.upload('admin/import', fd); body.querySelector('#ires').textContent = JSON.stringify(r.summary, null, 2); toast('Workbook imported'); await boot(false); } catch (err) { toast(err.message, true); } b.disabled = false; b.textContent = 'Import workbook'; });
    } else if (tab === 'users') {
      const u = await api.get('admin/users');
      const roleOpts = Object.entries(u.roles).map(([k, v]) => ({ v: k, l: v.name }));
      const secOpts = state.boot.sections.map((s) => ({ v: s.id, l: s.section_name + ' (' + s.site + ')' }));
      body.innerHTML = `<div class="grid g2"><div class="card"><h3>Invite a team member</h3><form class="form" id="uf"><label class="f"><span>Username</span><input name="login" required></label><label class="f"><span>Email</span><input type="email" name="email" required></label><label class="f"><span>Display name</span><input name="name"></label><label class="f"><span>Role</span><select name="role">${sel(roleOpts, 'jmg_sales')}</select></label><label class="f"><span>Password (blank = generate)</span><input type="text" name="password"></label><label class="f full"><span>Sections (supervisors; none = all)</span><select name="sections" multiple size="6">${sel(secOpts, '')}</select></label><div class="full"><button class="btn primary">Create user</button></div></form><p class="small muted">Users sign in at <code>${esc(location.origin)}/wp-login.php</code> and are taken straight to this application.</p></div>
        <div class="card"><h3>Users with production planning roles</h3><div class="tbl-wrap short"><table class="tbl"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Sections</th><th></th></tr></thead><tbody>${u.users.map((x) => `<tr data-id="${x.id}"><td><b>${esc(x.name)}</b><br><span class="small muted">${esc(x.login)}</span></td><td class="small">${esc(x.email)}</td><td><select name="role" class="inline-input" style="width:170px">${sel(roleOpts, x.roles[0])}</select></td><td><select name="sections" multiple size="3" class="inline-input" style="width:190px">${sel(secOpts.map((o) => ({ v: o.v, l: o.l })), '')}</select><script></script></td><td><button class="btn sm" data-us="${x.id}">Save</button></td></tr>`).join('')}</tbody></table></div></div></div>`;
      u.users.forEach((x) => { const s = body.querySelector(`tr[data-id="${x.id}"] select[name=sections]`); Array.from(s.options).forEach((o) => { o.selected = x.sections.includes(Number(o.value)); }); });
      body.querySelector('#uf').addEventListener('submit', async (e) => { e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd); d.sections = fd.getAll('sections'); try { const r = await api.post('admin/users', d); alert('User created. Password: ' + r.password); route(); } catch (err) { toast(err.message, true); } });
      body.querySelectorAll('[data-us]').forEach((b) => b.addEventListener('click', async () => { const tr = b.closest('tr'); const d = { role: tr.querySelector('[name=role]').value, sections: Array.from(tr.querySelector('[name=sections]').selectedOptions).map((o) => o.value) }; const pw = prompt('New password (leave blank to keep):'); if (pw) { d.password = pw; } try { await api.put('admin/users/' + b.dataset.us, d); toast('User updated'); } catch (err) { toast(err.message, true); } }));
    } else if (tab === 'backup') {
      body.innerHTML = `<div class="grid g2"><div class="card"><h3>Backup</h3><p class="small">Downloads every planning table (masters, orders, schedules, tracking, audit) as one JSON file.</p><button class="btn primary" id="bk">Download backup</button></div><div class="card"><h3>Restore</h3><p class="small">Replaces all planning tables with the content of a backup file. WordPress users are not included.</p><form id="rsf" class="toolbar"><input type="file" name="file" accept=".json" required><button class="btn danger">Restore</button></form><pre id="rres" class="small"></pre></div></div>`;
      body.querySelector('#bk').addEventListener('click', async () => { const d = await api.get('admin/backup'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' })); a.download = 'jmg-production-planning-backup-' + todayStr() + '.json'; a.click(); });
      body.querySelector('#rsf').addEventListener('submit', async (e) => { e.preventDefault(); if (!confirmDlg('Replace ALL planning data with this backup?')) { return; } try { const r = await api.upload('admin/restore', new FormData(e.target)); body.querySelector('#rres').textContent = JSON.stringify(r, null, 2); toast('Restored'); await boot(false); } catch (err) { toast(err.message, true); } });
    } else if (tab === 'audit') {
      const list = await api.get('admin/audit', { limit: 400 });
      body.innerHTML = `<div class="card tight"><div class="tbl-wrap"><table class="tbl" data-sheet="Audit"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead><tbody>${list.map((a) => `<tr><td class="nowrap small">${esc(a.created_at)}</td><td>${esc(a.user_login)}</td><td>${esc(a.action)}</td><td class="small">${esc(a.entity)} ${esc(a.entity_id)}</td><td class="small mono">${esc((a.details || '').slice(0, 200))}</td><td class="small muted">${esc(a.ip)}</td></tr>`).join('')}</tbody></table></div></div>`;
    } else if (tab === 'demo') {
      body.innerHTML = `<div class="card"><h3>Acceptance-test demo scenario</h3><p class="small">Creates the demo accounts (sales.demo / planner.demo / supervisor.demo / manager.demo / costing.demo) and the scenario from the brief: Sales requests 20 × SPGP22, the planner generates and confirms the plan, two more orders (10 × SPGP65-OPT, 4 × SPGP200) compete for the same sections, one request is left awaiting planning, and the supervisor records a shortfall on canopy cutting so the forecast slips from the confirmed baseline. Previous demo documents (sales ref DEMO-*) are removed first.</p><button class="btn primary" id="seed">Create / reset demo scenario</button><pre id="sres" class="small"></pre></div>`;
      body.querySelector('#seed').addEventListener('click', async (e) => { e.target.disabled = true; try { const r = await api.post('admin/demo'); toast('Demo scenario ready: ' + (r.orders || []).join(', ')); await boot(false); go('dashboard'); } catch (err) { toast(err.message, true); } e.target.disabled = false; });
    }
  };

  /* ------------------------------------------------------------ boot */
  async function boot(render = true) {
    state.boot = await api.get('bootstrap');
    if (render) { shell(); }
    else { shell(); }
  }
  window.addEventListener('hashchange', route);
  boot().then(route).catch((e) => { $root.innerHTML = `<div class="card" style="margin:40px auto;max-width:600px"><h2>Production Planning</h2><div class="alert err">${esc(e.message)}</div><p>Please log in with an account that has a production planning role.</p></div>`; });
})();
