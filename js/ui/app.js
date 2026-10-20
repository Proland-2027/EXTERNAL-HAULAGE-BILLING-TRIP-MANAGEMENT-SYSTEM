/* Application shell: store detection, login, navigation, live-update wiring. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine, h = U.h;
  const NAV = [
    { group: 'Operations' }, { key: 'dashboard', label: 'Management Dashboard', icon: '▦' }, { key: 'crm', label: 'Client Requests (CRM)', icon: '✎' }, { key: 'planning', label: 'Fleet Planning & Allocation', icon: '⇄' }, { key: 'tpl', label: '3PL Management', icon: '⊞' }, { key: 'trips', label: 'Trip Log', icon: '☰' },
    { group: 'Fleet' }, { key: 'fleet', label: 'Fleet Movement (FMR)', icon: '⛟' }, { key: 'tat', label: 'Trip Tracking & TAT', icon: '◷' }, { key: 'fleetdash', label: 'Fleet Planning Dashboard', icon: '◈' }, { key: 'workshop', label: 'Workshop & Maintenance', icon: '⚒' }, { key: 'dispatch', label: 'Diesel & Road Expenses', icon: '⛽' }, { key: 'lostsales', label: 'Lost Sales', icon: '◔' },
    { group: 'Billing' }, { key: 'rates', label: 'Client Price List', icon: '₦' }, { key: 'invoices', label: 'Invoices', icon: '▤' }, { key: 'payments', label: 'Payments & Statements', icon: '◧' }, { key: 'finance', label: 'Finance: Ledger & P&L', icon: '∑', need: 'costing.view' },
    { group: 'Insight' }, { key: 'reports', label: 'Reports', icon: '▥' },
    { group: 'Audit & Control' }, { key: 'commercial', label: 'Commercial Audit & Control', icon: '⚖', need: 'commercial.view' }, { key: 'audit', label: 'Audit Trail', icon: '◷', need: 'audit.view' },
    { group: 'Setup' }, { key: 'clients', label: 'Clients', icon: '◉' }, { key: 'assets', label: 'Asset List', icon: '▣' }, { key: 'masters', label: 'Master Data', icon: '▤' }, { key: 'users', label: 'Users & Roles', icon: '◎', need: 'user.manage' }, { key: 'settings', label: 'Settings', icon: '⚙' },
  ];
  const app = { store: null, user: null, view: 'dashboard', params: {} };

  async function detectStore(progress) {
    progress('Connecting to the shared database…');
    const art = await Promise.race([HB.ArtifactStore.detect(), new Promise((r) => setTimeout(() => r(null), 12000))]).catch(() => null);
    if (art) return art;
    progress('Looking for the application server…');
    try { const ping = await Promise.race([fetch('api/ping', { credentials: 'same-origin' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))]); if (ping.ok) return new HB.ApiStore(''); } catch (e) { /* no server */ }
    progress('Starting in local mode…');
    return new HB.LocalStore();
  }

  async function boot() {
    const msg = document.getElementById('boot-msg'); const progress = (t) => { if (msg) msg.textContent = t; };
    try {
      app.store = await detectStore(progress);
      await app.store.init(progress);
      if (app.store.mode !== 'server') { try { await app.store.ensureDemoUsers(); } catch (e) { console.warn('could not seed users', e); } }
      const user = await app.store.resume();
      if (user) start(user); else showLogin();
    } catch (e) { console.error(e); progress('Could not start: ' + e.message); }
  }

  function showLogin(error) {
    const root = document.getElementById('app'); U.clear(root);
    const store = app.store;
    const u = h('input', { type: 'text', id: 'login-user', autocomplete: 'username', placeholder: 'Username', required: true });
    const p = h('input', { type: 'password', id: 'login-pass', autocomplete: 'current-password', placeholder: 'Password', required: true });
    const err = h('div', { class: 'notice bad' + (error ? '' : ' hidden'), text: error || '' });
    const form = h('form', { class: 'login-form', onSubmit: async (e) => { e.preventDefault(); btn.disabled = true; try { const user = await store.login(u.value, p.value); start(user); } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); btn.disabled = false; } } },
      U.field('Username', u), U.field('Password', p), err);
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'); form.append(btn);
    const demo = h('div', { class: 'demo-accounts' }, h('div', { class: 'label', text: 'Demo accounts (click to fill)' }), HB.DEMO_USERS.map((d) => h('button', { type: 'button', class: 'btn sm', onClick: () => { u.value = d.username; p.value = d.password; } }, `${E.ROLE_LABELS[d.role]} — ${d.username} / ${d.password}`)));
    const modeText = store.mode === 'shared' ? 'Shared database · changes are visible to every signed-in team member' : store.mode === 'server' ? 'Application server · central SQLite database' : 'Local demo mode · data stays in this browser';
    const viewOnly = store.mode === 'shared' && store.canWrite === false ? h('div', { class: 'notice warn small', text: 'View-only access: your claude.ai account can open this page but not change its shared data, whatever role you sign in with. Ask the page owner to share it with you with edit (contributor) access, then reload.' }) : null;
    root.append(h('div', { class: 'boot' }, h('div', { class: 'boot-card' }, h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'HB'), h('h1', { text: 'JMG Transport Management System' }), h('p', { class: 'muted small', text: 'Client requests, route validation, fleet planning and allocation, automatic Trip IDs, tracking and TAT, diesel and road expense documents, invoicing and payments.' }), viewOnly, form, demo, h('p', { class: 'tiny muted', text: modeText }))));
  }

  function ctx() {
    const user = app.user, role = user.role;
    return { store: app.store, user, E, U, params: app.params, nav, can: (a) => E.can(role, a), canField: (f) => E.canEditField(role, f) };
  }
  function nav(view, params) { if (!HB.views[view]) view = 'dashboard'; if (HB.views.trips.pending && HB.views.trips.pending.size && app.view === 'trips' && view !== 'trips') U.toast(`${HB.views.trips.pending.size} unsaved Trip Log change(s) kept — save or discard them in the Trip Log.`); app.view = view; app.params = params || {}; try { history.replaceState(null, '', '#' + view); } catch (e) { /* ignore */ } renderView(); }

  function start(user) {
    app.user = user; const store = app.store;
    const hash = (location.hash || '').replace('#', ''); if (HB.views[hash]) app.view = hash;
    const root = document.getElementById('app'); U.clear(root);
    const navEl = h('nav', { class: 'nav', 'aria-label': 'Sections' });
    const rail = h('aside', { class: 'rail', id: 'rail' }, h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }, 'HB'), h('div', {}, h('div', { class: 'brand-title', text: 'JMG Transport Management' }), h('div', { class: 'brand-sub', text: store.state.settings.company || '' }))), navEl,
      h('div', { class: 'user-box' }, h('strong', { text: user.name }), h('span', { text: E.ROLE_LABELS[user.role] }), h('span', {}, h('span', { class: 'live-dot' + (store.live ? '' : ' off') }), store.mode === 'shared' ? 'Live · shared database' : store.mode === 'server' ? 'Live · server' : 'Local mode'), h('button', { class: 'btn sm', style: { justifySelf: 'start', color: 'inherit', borderColor: 'rgba(255,255,255,.4)', background: 'transparent' }, onClick: async () => { await store.logout(); location.hash = ''; showLogin(); } }, 'Sign out')));
    const title = h('h1', { id: 'view-title' });
    const viewOnlyBar = store.mode === 'shared' && store.canWrite === false ? h('div', { class: 'notice warn small', style: { margin: '0', borderRadius: '0' }, text: `View-only: ${user.name} is signed in as ${E.ROLE_LABELS[user.role]}, but your claude.ai account only has view access to this page, so saves will be refused. Ask the page owner for edit (contributor) access.` }) : null;
    const topbar = h('header', { class: 'topbar' }, h('button', { class: 'btn menu-btn', 'aria-label': 'Menu', onClick: () => rail.classList.toggle('open') }, '☰'), title, h('span', { class: 'grow' }), h('span', { class: 'mode-pill', text: store.mode === 'shared' ? 'Shared database' : store.mode === 'server' ? 'Server' : 'Local demo' }), h('button', { class: 'btn sm ghost', title: 'Toggle light / dark', onClick: () => { const r = document.documentElement; const cur = r.getAttribute('data-theme'); const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.setAttribute('data-theme', dark ? 'light' : 'dark'); } }, '◐'));
    const content = h('div', { class: 'content', id: 'content' });
    root.append(h('div', { class: 'shell' }, rail, h('div', { class: 'main' }, topbar, viewOnlyBar, content)));
    app.navEl = navEl; app.titleEl = title; app.contentEl = content; app.rail = rail;
    renderNav(); renderView();
    if (app.unsub) app.unsub();
    app.unsub = store.subscribe((evt) => { const v = HB.views[app.view]; if (v && v.onStoreChange) v.onStoreChange(evt); if (evt && evt.type === 'remote') flashLive(); if (evt && evt.type === 'revoked') U.toast('Your connection to the shared database was revoked. Reload to continue.', 'bad'); });
    window.addEventListener('beforeunload', (e) => { if (HB.views.trips.pending && HB.views.trips.pending.size) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('hashchange', () => { const v = (location.hash || '').replace('#', ''); if (HB.views[v] && v !== app.view) nav(v); });
  }
  let flashT; function flashLive() { const dot = document.querySelector('.live-dot'); if (!dot) return; dot.style.boxShadow = '0 0 0 4px var(--good-bg)'; clearTimeout(flashT); flashT = setTimeout(() => { dot.style.boxShadow = ''; }, 800); }
  function renderNav() {
    const c = ctx(); U.clear(app.navEl);
    for (const n of NAV) { if (n.group) { app.navEl.append(h('div', { class: 'nav-group', text: n.group })); continue; } if (n.need && !c.can(n.need)) continue; app.navEl.append(h('button', { class: n.key === app.view ? 'active' : '', onClick: () => { nav(n.key); app.rail.classList.remove('open'); } }, h('span', { 'aria-hidden': 'true', style: { width: '16px', textAlign: 'center' } }, n.icon), n.label)); }
  }
  function renderView() {
    const v = HB.views[app.view] || HB.views.dashboard; const c = ctx();
    app.titleEl.textContent = v.title; renderNav(); U.clear(app.contentEl);
    try { v.render(app.contentEl, c); } catch (e) { console.error(e); app.contentEl.append(h('div', { class: 'notice bad', text: 'This view failed to render: ' + e.message })); }
    app.contentEl.scrollTop = 0;
  }

  HB.app = app;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
