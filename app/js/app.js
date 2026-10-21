/* app.js — shell, router, authentication, navigation. Views register themselves on window.Views. */
(function () {
  'use strict';
  const { $, $$, esc, toast, kpi, fmtNum, fmtDate, statusBadge } = window.UI;
  const V = window.Views = window.Views || {};
  const state = window.AppState = { user: null, app: null, meta: null, theme: localStorage.getItem('pp.theme') || '' };

  const NAV = [
    { group: 'Planning' },
    { hash: '#/home', label: 'Overview', ico: '◫', perm: 'reports.view' },
    { hash: '#/sales', label: 'Sales Requests', ico: '✎', perm: 'reports.view' },
    { hash: '#/plans', label: 'Production Plans', ico: '▤', perm: 'reports.view' },
    { hash: '#/board', label: 'Planning Board', ico: '▦', perm: 'reports.view' },
    { group: 'Production' },
    { hash: '#/sections', label: 'Section Dashboards', ico: '⚙', perm: 'reports.view' },
    { hash: '#/inventory', label: 'Inventory', ico: '▣', perm: 'reports.view' },
    { group: 'Costing & Reports' },
    { hash: '#/costing', label: 'BOM Costing', ico: '₵', perm: 'cost.view' },
    { hash: '#/reports', label: 'Management Dashboard', ico: '◔', perm: 'reports.view' },
    { hash: '#/capacity', label: 'Capacity Master', ico: '⏱', perm: 'reports.view' },
    { hash: '#/exceptions', label: 'Exception Report', ico: '⚠', perm: 'reports.view' },
    { group: 'Other' },
    { href: '/haulage/', label: 'Trip Log (Haulage)', ico: '⛟', perm: 'reports.view' },
    { hash: '#/admin', label: 'Administration', ico: '⚒', perm: 'admin' },
    { href: '/docs/USER_GUIDE.md', label: 'User guide', ico: '?', perm: 'reports.view' },
  ];

  const can = (perm) => !!(state.user && state.user.perms.includes(perm));
  window.can = can;

  function applyTheme() { document.documentElement.dataset.theme = state.theme; }
  function renderNav() {
    $('#nav').innerHTML = NAV.filter((n) => n.group || can(n.perm)).map((n) => n.group ? `<div class="group">${n.group}</div>` : `<a href="${n.hash || n.href}" ${n.href ? 'target="_blank" rel="noopener"' : ''} class="${location.hash.startsWith(n.hash || '##') ? 'active' : ''}"><span class="ico">${n.ico}</span>${n.label}</a>`).join('');
    const u = state.user;
    $('#user-box').innerHTML = u ? `<div><b>${esc(u.display_name)}</b></div><div class="role">${esc(u.role_name)} · <a href="#/password">change password</a></div>` : '';
    $('#brand-company').textContent = (state.app && state.app.company) || 'Gensets & Canopies';
  }

  function renderLogin(message = '') {
    document.body.innerHTML = `<div class="login-wrap"><form class="card login" id="login-form">
      <div class="brand"><span class="brand-mark">▣</span><div><div class="brand-title">Production Planning &amp; BOM Costing</div><div class="brand-sub">Gensets &amp; Canopies · multi-user</div></div></div>
      ${message ? `<div class="callout bad">${esc(message)}</div>` : ''}
      <div class="stack" style="gap:.6rem;margin-top:.5rem">
        <label>Username<input name="username" autocomplete="username" required autofocus></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary" type="submit">Sign in</button>
      </div>
      <div class="accounts">Test accounts (if the demo data is loaded): <b>sales</b>, <b>planner</b>, <b>prodmgr</b>, <b>supervisor</b>, <b>store</b>, <b>costacct</b>, <b>mgmt</b>, <b>admin</b>. Passwords are issued by the administrator.</div>
    </form></div>`;
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await window.Api.post('/auth/login', { username: f.get('username'), password: f.get('password') }); location.reload(); }
      catch (err) { renderLogin(err.message); }
    };
  }

  async function boot() {
    applyTheme();
    let me;
    try { me = await window.Api.get('/auth/me', {}, { silent: true }); } catch (e) { document.body.innerHTML = `<div class="login-wrap"><div class="card login"><h2>Server unavailable</h2><p class="muted">${esc(e.message)}</p><p class="small">If this is a fresh installation run <code>php server/bin/console import</code> then <code>seed-users</code>.</p></div></div>`; return; }
    state.app = me.app;
    if (!me.user) { renderLogin(); return; }
    state.user = me.user;
    try { state.meta = await window.Api.get('/meta'); } catch (e) { toast(e.message, true); }
    renderNav();
    $('#theme-toggle').onclick = () => { state.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('pp.theme', state.theme); applyTheme(); };
    $('#logout-btn').onclick = async () => { await window.Api.post('/auth/logout', {}); location.hash = ''; location.reload(); };
    $('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');
    $('#view').addEventListener('click', () => $('#sidebar').classList.remove('open'));
    window.addEventListener('pp:unauthorized', () => renderLogin('Your session has expired. Please sign in again.'));
    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#/home';
    route();
  }

  const ROUTES = [
    [/^#\/home$/, () => V.home()],
    [/^#\/sales$/, () => V.sales()],
    [/^#\/plans$/, () => V.plans()],
    [/^#\/plans\/(\d+)(?:\/(\w+))?$/, (m) => V.planDetail(+m[1], m[2] || 'overview')],
    [/^#\/board$/, () => V.board()],
    [/^#\/sections$/, () => V.sections()],
    [/^#\/sections\/(\d+)$/, (m) => V.sectionBoard(+m[1])],
    [/^#\/inventory$/, () => V.inventory()],
    [/^#\/costing(?:\/([^/]+))?$/, (m) => V.costing(m[1] ? decodeURIComponent(m[1]) : null)],
    [/^#\/reports$/, () => V.reports()],
    [/^#\/capacity$/, () => V.capacity()],
    [/^#\/exceptions$/, () => V.exceptions()],
    [/^#\/admin$/, () => V.admin()],
    [/^#\/password$/, () => V.password()],
    [/^#\/bom\/([^/]+)$/, (m) => V.bom(decodeURIComponent(m[1]))],
  ];

  async function route() {
    renderNav();
    const view = $('#view'); $('#topbar-actions').innerHTML = '';
    for (const [re, fn] of ROUTES) {
      const m = location.hash.match(re);
      if (m) {
        view.innerHTML = '<div class="muted">Loading…</div>';
        try { await fn(m); } catch (e) { console.error(e); view.innerHTML = `<div class="callout bad"><b>Could not load this page.</b> ${esc(e.message)}${e.details ? `<div class="small">${esc(JSON.stringify(e.details))}</div>` : ''}</div>`; }
        return;
      }
    }
    location.hash = '#/home';
  }
  window.setCrumbs = (html) => { $('#crumbs').innerHTML = html; };
  window.setActions = (html) => { $('#topbar-actions').innerHTML = html; };

  // ---------------------------------------------------------------- home
  V.home = async function () {
    setCrumbs('<b>Overview</b>');
    const [dash, sr, plans] = await Promise.all([window.Api.get('/dashboard', { from: window.UI.monthStart(), to: window.UI.monthEnd() }), window.Api.get('/sales-requests'), window.Api.get('/plans')]);
    const queue = sr.requests.filter((r) => ['SUBMITTED', 'PLANNED'].includes(r.status));
    const active = plans.plans.filter((p) => ['APPROVED', 'IN_PROGRESS'].includes(p.status));
    const k = dash.kpis;
    $('#view').innerHTML = `
      <div class="card-head"><div><h1>Production overview — ${esc(new Date().toLocaleString('en', { month: 'long', year: 'numeric' }))}</h1><div class="muted small">Live data shared by every signed-in user. Signed in as ${esc(state.user.display_name)} (${esc(state.user.role_name)}).</div></div>
        <div class="row">${can('sales.create') ? '<a class="btn primary" href="#/sales">+ New sales request</a>' : ''}<a class="btn" href="#/board">Planning board</a><a class="btn" href="#/reports">Management dashboard</a></div></div>
      <div class="kpis">
        ${kpi('Planned finished units (month)', fmtNum(k.planned_finished), 'from approved plans', 'accent')}
        ${kpi('Actual finished units', fmtNum(k.actual_finished), k.achievement_pct == null ? 'no receipts yet' : `${k.achievement_pct}% of plan`, k.achievement_pct >= 90 ? 'good' : 'warn')}
        ${kpi('Work orders in progress', fmtNum(k.work_orders - k.work_orders_completed, 0), `${k.work_orders_completed} completed of ${k.work_orders}`)}
        ${kpi('Delayed work orders', fmtNum(k.work_orders_delayed, 0), 'later than the approved baseline', k.work_orders_delayed ? 'bad' : 'good')}
        ${kpi('WIP quantity', fmtNum(k.wip_qty), 'released, not yet completed')}
        ${kpi('Planning queue', queue.length, 'sales requests awaiting approval', queue.length ? 'warn' : '')}
      </div>
      <div class="grid two">
        <div class="card"><div class="card-head"><h2>Planning queue</h2><a href="#/sales" class="small">all requests</a></div>
          ${window.UI.table([{ label: 'Request', fmt: (r) => `<b>${esc(r.number)}</b><div class="tiny muted">${esc(r.customer)}</div>` }, { label: 'Product', fmt: (r) => `${esc(r.product_code)} <span class="muted">× ${fmtNum(r.qty, 0)}</span>` }, { label: 'Needed', fmt: (r) => fmtDate(r.delivery_date) }, { label: 'Expected', fmt: (r) => r.expected_completion ? `${fmtDate(r.expected_completion)} ${r.delivery_date && r.expected_completion > r.delivery_date ? '<span class="badge bad">late</span>' : '<span class="badge good">on time</span>'}` : '—' }, { label: 'Status', fmt: (r) => statusBadge(r.status) }, { label: '', fmt: (r) => r.latest_plan_id ? `<a class="btn sm" href="#/plans/${r.latest_plan_id}">Review plan</a>` : '' }], queue, { empty: 'No requests waiting.' })}</div>
        <div class="card"><div class="card-head"><h2>Active production plans</h2><a href="#/plans" class="small">all plans</a></div>
          ${window.UI.table([{ label: 'Plan', fmt: (p) => `<a href="#/plans/${p.id}"><b>${esc(p.sr_number)}</b></a><div class="tiny muted">${esc(p.customer)}</div>` }, { label: 'Product', fmt: (p) => `${esc(p.product_code)} × ${fmtNum(p.qty, 0)}` }, { label: 'Start', fmt: (p) => fmtDate(p.start_date) }, { label: 'Expected completion', fmt: (p) => `${fmtDate(p.expected_completion)} ${p.baseline_completion && p.expected_completion > p.baseline_completion ? `<span class="badge bad">+${window.UI.daysBetween(p.baseline_completion, p.expected_completion)}d</span>` : ''}` }, { label: 'Bottleneck', fmt: (p) => esc(p.bottleneck || '—') }, { label: 'Status', fmt: (p) => statusBadge(p.status) }], active, { empty: 'No approved plans.' })}</div>
      </div>
      <div class="card"><div class="card-head"><h2>Section productivity this month</h2><span class="muted small">planned vs reported good output</span></div>
        ${window.Charts.hbars(dash.sections.filter((s) => +s.planned_qty || +s.good_qty).map((s) => ({ label: s.name, value: s.achievement_pct == null ? 0 : s.achievement_pct, text: s.achievement_pct == null ? `${fmtNum(s.planned_qty, 0)} planned, no reports` : `${s.achievement_pct}% (${fmtNum(s.good_qty, 0)}/${fmtNum(s.reported_planned_qty, 0)})` })), { warnAt: 101, badAt: 200 })}</div>`;
  };

  V.password = async function () {
    setCrumbs('<b>Change password</b>');
    $('#view').innerHTML = `<form class="card" id="pw" style="max-width:420px"><h2>Change password</h2><div class="stack" style="gap:.6rem"><label>Current password<input type="password" name="current" required></label><label>New password (min 8 characters)<input type="password" name="new" minlength="8" required></label><button class="btn primary">Update</button></div></form>`;
    $('#pw').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await window.Api.post('/auth/password', { current: f.get('current'), new: f.get('new') }); toast('Password updated'); location.hash = '#/home'; } catch (err) { toast(err.message, true); } };
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
