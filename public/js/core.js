/* core.js — API client, state, formatting, DOM helpers, tables, modals, toasts, hash router. */
(function (root) {
  'use strict';
  const S = { user: null, perms: {}, company: '', currency: 'NGN', sections: [], products: [], route: null, cache: new Map() };

  async function api(method, url, body, opts = {}) {
    const init = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    else if (body !== undefined) { init.body = body; init.headers['Content-Type'] = 'application/octet-stream'; if (opts.filename) init.headers['X-Filename'] = encodeURIComponent(opts.filename); }
    const res = await fetch(url, init);
    if (res.status === 401 && !url.endsWith('/api/me') && !url.endsWith('/api/login')) { S.user = null; location.hash = '#/login'; throw new Error('Please sign in'); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) { const msg = (data && data.error) || `HTTP ${res.status}`; if (!opts.quiet) toast(msg, 'bad'); const e = new Error(msg); e.status = res.status; e.data = data; throw e; }
    return data;
  }
  const get = (u) => api('GET', u); const post = (u, b) => api('POST', u, b); const put = (u, b) => api('PUT', u, b); const del = (u) => api('DELETE', u);

  // ---- formatting
  const nf0 = new Intl.NumberFormat('en', { maximumFractionDigits: 0 }); const nf2 = new Intl.NumberFormat('en', { maximumFractionDigits: 2 }); const nf1 = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
  const fmt = {
    n: (v, d) => (v == null || Number.isNaN(Number(v)) ? '–' : (d === 0 ? nf0 : d === 1 ? nf1 : nf2).format(Number(v))),
    q: (v) => (v == null ? '–' : Number.isInteger(Number(v)) ? nf0.format(v) : nf2.format(v)),
    money: (v) => (v == null || Number.isNaN(Number(v)) ? '–' : `${S.currency} ${nf0.format(Math.round(Number(v)))}`),
    money2: (v) => (v == null || Number.isNaN(Number(v)) ? '–' : `${S.currency} ${nf2.format(Number(v))}`),
    pct: (v, d = 0) => (v == null || Number.isNaN(Number(v)) ? '–' : `${(d === 0 ? nf0 : nf1).format(Number(v))}%`),
    d: (v) => (v ? String(v).slice(0, 10) : '–'),
    dt: (v) => (v ? new Date(v).toLocaleString() : '–'),
    dd: (v) => { if (!v) return '–'; const d = new Date(v + 'T00:00:00'); return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }); },
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const can = (p) => !!S.perms[p];
  const statusPill = (s) => { const m = { SUBMITTED: 'info', PLANNED: 'warn', PROPOSED: 'warn', APPROVED: 'ok', RELEASED: 'ok', IN_PROGRESS: 'accent', COMPLETED: 'ok', COVERED: 'info', CANCELLED: 'bad', SUPERSEDED: 'info', UNSCHEDULED: 'bad', DELAYED: 'bad', OPEN: 'warn', REVIEWED: 'info', ACCEPTED: 'ok', FIXED: 'ok' }; return `<span class="pill ${m[s] || 'info'}">${esc((s || '').replace(/_/g, ' '))}</span>`; };

  // ---- DOM
  const $ = (sel, el = document) => el.querySelector(sel); const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  function el(tag, attrs = {}, html) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); } if (html != null) e.innerHTML = html; return e; }
  function toast(msg, kind = 'info', ms = 3500) { const t = $('#toast'); t.textContent = msg; t.className = `toast show ${kind}`; clearTimeout(t._h); t._h = setTimeout(() => { t.className = 'toast'; }, ms); }
  function kpi(label, value, sub, cls = '') { return `<div class="kpi ${cls}"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`; }
  function section(title, body, tools = '') { return `<section class="card"><h2><span>${title}</span><span class="row">${tools}</span></h2>${body}</section>`; }
  function selectOpts(list, value, { blank } = {}) { return (blank != null ? `<option value="">${esc(blank)}</option>` : '') + list.map((o) => { const v = typeof o === 'string' ? o : o.value; const l = typeof o === 'string' ? o : o.label; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`; }).join(''); }

  // ---- table with sort, filter, export
  const tableRegistry = new Map();
  function table(id, rows, cols, opts = {}) {
    tableRegistry.set(id, { rows, cols, opts, sort: opts.sort || null, q: '' });
    return `<div class="table-tools no-print">${opts.search === false ? '' : `<input type="search" placeholder="Filter…" data-tsearch="${id}">`}<span class="muted small" data-tcount="${id}"></span>${opts.export === false ? '' : `<button class="btn sm ghost" data-texport="${id}">Export Excel</button>`}${opts.tools || ''}</div><div class="table-wrap ${opts.wrapClass || ''}" style="${opts.maxHeight ? `max-height:${opts.maxHeight}` : ''}"><table class="data" data-table="${id}">${renderTable(id)}</table></div>`;
  }
  function renderTable(id) {
    const t = tableRegistry.get(id); if (!t) return '';
    let rows = t.rows;
    if (t.q) { const q = t.q.toLowerCase(); rows = rows.filter((r) => t.cols.some((c) => String(c.text ? c.text(r) : r[c.key] ?? '').toLowerCase().includes(q))); }
    if (t.sort) { const c = t.cols.find((x) => x.key === t.sort.key); const dir = t.sort.dir; rows = [...rows].sort((a, b) => { const va = c.sortVal ? c.sortVal(a) : a[c.key]; const vb = c.sortVal ? c.sortVal(b) : b[c.key]; if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * dir; }); }
    t.view = rows;
    const head = `<thead><tr>${t.cols.map((c) => `<th data-sort="${c.key}" class="${c.num ? 'num' : ''}">${esc(c.label)}${t.sort && t.sort.key === c.key ? (t.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>`;
    const body = rows.length ? rows.map((r, i) => `<tr class="${t.opts.rowClass ? t.opts.rowClass(r) : ''} ${t.opts.onRow ? 'clickable' : ''}" data-row="${i}">${t.cols.map((c) => `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? '')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${t.cols.length}" class="muted">${esc(t.opts.empty || 'Nothing to show')}</td></tr>`;
    const foot = t.opts.totals ? `<tfoot><tr>${t.cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.total ? c.total(rows) : ''}</td>`).join('')}</tr></tfoot>` : '';
    setTimeout(() => { const cnt = document.querySelector(`[data-tcount="${id}"]`); if (cnt) cnt.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}`; }, 0);
    return head + `<tbody>${body}</tbody>` + foot;
  }
  function bindTables(container) {
    container.addEventListener('input', (e) => { const id = e.target.dataset.tsearch; if (!id) return; const t = tableRegistry.get(id); t.q = e.target.value; const tb = container.querySelector(`table[data-table="${id}"]`); if (tb) tb.innerHTML = renderTable(id); });
    container.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) { const id = th.closest('table').dataset.table; const t = tableRegistry.get(id); const key = th.dataset.sort; t.sort = t.sort && t.sort.key === key ? { key, dir: -t.sort.dir } : { key, dir: 1 }; th.closest('table').innerHTML = renderTable(id); return; }
      const ex = e.target.closest('[data-texport]'); if (ex) { exportTable(ex.dataset.texport); return; }
      const tr = e.target.closest('tr[data-row]'); if (tr && !e.target.closest('button,a,input,select')) { const id = tr.closest('table').dataset.table; const t = tableRegistry.get(id); if (t.opts.onRow) t.opts.onRow(t.view[Number(tr.dataset.row)]); }
    });
  }
  function exportTable(id, name) {
    const t = tableRegistry.get(id); if (!t) return;
    const rows = (t.view || t.rows).map((r) => Object.fromEntries(t.cols.map((c) => [c.label, c.text ? c.text(r) : (c.fmt ? c.fmt(r[c.key], r) : r[c.key])])));
    downloadRows(rows, name || t.opts.exportName || id);
  }
  function downloadRows(rows, name) {
    if (root.XLSX) { const ws = root.XLSX.utils.json_to_sheet(rows); const wb = root.XLSX.utils.book_new(); root.XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 30)); root.XLSX.writeFile(wb, `${name}.xlsx`); return; }
    const cols = rows.length ? Object.keys(rows[0]) : []; const escv = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => escv(r[c])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `${name}.csv`; a.click();
  }

  // ---- modal forms
  function modal({ title, body, submitLabel = 'Save', onSubmit, wide, cancelLabel = 'Cancel' }) {
    const dlg = $('#modal'); const form = $('#modal-form');
    form.innerHTML = `<h2>${title}</h2>${body}<div class="modal-actions row" style="justify-content:flex-end;margin-top:1rem">${onSubmit ? `<button type="button" class="btn" data-cancel>${cancelLabel}</button><button type="submit" class="btn primary">${submitLabel}</button>` : `<button type="button" class="btn" data-cancel>Close</button>`}</div>`;
    dlg.style.width = wide ? 'min(1100px, 95vw)' : '';
    form.onsubmit = async (e) => { e.preventDefault(); if (!onSubmit) { dlg.close(); return; } const data = Object.fromEntries(new FormData(form).entries()); $$('input[type=checkbox]', form).forEach((c) => { data[c.name] = c.checked; }); const btn = $('button[type=submit]', form); btn.disabled = true; try { const r = await onSubmit(data, form); if (r !== false) dlg.close(); } catch (err) { /* toast already shown */ } finally { btn.disabled = false; } };
    $('[data-cancel]', form).onclick = () => dlg.close();
    dlg.showModal();
    return form;
  }
  function confirmDlg(msg, label = 'Confirm') { return new Promise((res) => { modal({ title: 'Please confirm', body: `<p>${msg}</p>`, submitLabel: label, onSubmit: async () => { res(true); } }); $('#modal').addEventListener('close', () => res(false), { once: true }); }); }

  // ---- router
  const routes = [];
  function route(pattern, handler) { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); routes.push({ re, keys, handler }); }
  async function render() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = hash.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const view = $('#view');
    if (!S.user && path !== '/login') { location.hash = '#/login'; return; }
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      S.route = { path, params, query };
      // each page renders into a fresh element so listeners from the previous page are discarded
      view.innerHTML = '<div class="page"><p class="muted">Loading…</p></div>';
      const page = view.firstElementChild;
      try { await r.handler({ params, query, view: page }); } catch (e) { console.error(e); page.innerHTML = `<div class="alert bad">${esc(e.message || e)}</div>`; }
      $$('#nav .tab').forEach((b) => b.classList.toggle('active', path.startsWith(b.dataset.path)));
      return;
    }
    view.innerHTML = '<div class="alert">Page not found</div>';
  }
  const go = (h) => { if (location.hash === '#' + h) render(); else location.hash = '#' + h; };

  root.App = { S, api, get, post, put, del, fmt, esc, today, addDays, can, statusPill, $, $$, el, toast, kpi, section, selectOpts, table, renderTable, bindTables, exportTable, downloadRows, modal, confirmDlg, route, render, go, tableRegistry };
})(window);
