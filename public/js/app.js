/* app.js — navigation, session bootstrap, theme. */
(function (root) {
  'use strict';
  const A = root.App; const { S, get, post, esc, can, go } = A;
  const NAV = [
    { path: '/', label: 'Dashboard', exact: true, show: () => true },
    { path: '/sales', label: 'Sales requests', show: () => true },
    { path: '/plans', label: 'Planning', show: () => true },
    { path: '/board', label: 'Planning board', show: () => true },
    { path: '/sections', label: 'Sections', show: () => true },
    { path: '/inventory', label: 'Inventory', show: () => true },
    { path: '/costing', label: 'BOM costing', show: () => true },
    { path: '/bom', label: 'BOM explorer', show: () => true },
    { path: '/masters', label: 'Masters', show: () => true },
    { path: '/admin', label: 'Admin', show: () => can('admin') },
    { path: '', label: 'Trip Log', external: true, show: () => !!S.tripLogUrl, href: () => S.tripLogUrl },
    { path: '/account', label: 'Account', show: () => true },
  ];
  async function loadSession() {
    const me = await get('/api/me');
    S.user = me.user; S.perms = me.permissions || {}; S.company = me.company; S.currency = me.currency || 'NGN'; S.tripLogUrl = me.tripLogUrl || '';
    document.title = `${S.company} · Production Planning`;
    A.$('#brand-title').textContent = `${S.company} · Production Planning`;
    if (S.user) {
      A.$('#brand-user').textContent = `${S.user.name} · ${S.user.roleLabel}`;
      const [sections, products] = await Promise.all([get('/api/sections'), get('/api/products')]);
      S.sections = sections; S.products = products;
      A.$('#nav').innerHTML = NAV.filter((n) => n.show()).map((n) => n.external ? `<a class="tab" href="${n.href ? n.href() : n.path}" target="_blank" rel="noopener">${n.label}</a>` : `<button class="tab" data-path="${n.path}">${n.label}</button>`).join('');
      A.$$('#nav button').forEach((b) => { b.onclick = () => go(b.dataset.path); });
      A.$('#topbar').hidden = false;
    } else A.$('#topbar').hidden = true;
  }
  root.AppBoot = { loadSession };
  A.$('#logout-btn').onclick = async () => { await post('/api/logout'); S.user = null; go('/login'); A.$('#topbar').hidden = true; };
  A.$('#theme-toggle').onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('ppm.theme', next); } catch (e) { /* ignore */ } };
  try { const t = localStorage.getItem('ppm.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
  A.bindTables(A.$('#view'));
  window.addEventListener('hashchange', A.render);
  (async () => { try { await loadSession(); } catch (e) { console.warn(e); } if (!location.hash) location.hash = '#/'; A.render(); })();
})(window);
