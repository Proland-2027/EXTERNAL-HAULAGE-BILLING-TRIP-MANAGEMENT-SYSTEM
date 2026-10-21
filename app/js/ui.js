/* ui.js — DOM helpers, formatting, modal, toast, tables, export. */
(function (root) {
  'use strict';
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 0) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : d; };
  const fmtNum = (v, d = 1) => (v == null || v === '' ? '—' : num(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d }));
  const fmtInt = (v) => fmtNum(v, 0);
  const fmtMoney = (v, d = 0) => (v == null ? '—' : num(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtPct = (v, d = 1) => (v == null || v === '' ? '—' : `${fmtNum(v, d)}%`);
  const fmtDate = (d) => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `${dd} ${names[+m - 1]} ${y}`; };
  const fmtDateTime = (d) => (d ? fmtDate(d) + ' ' + String(d).slice(11, 16) : '—');
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const monthStart = (d = today()) => d.slice(0, 7) + '-01';
  const monthEnd = (d = today()) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

  const statusBadge = (s) => { const good = ['APPROVED', 'COMPLETED', 'OK', 'ACTIVE', 'RELEASED', 'REVIEWED'], warn = ['PROPOSED', 'PLANNED', 'SUBMITTED', 'OUTDATED', 'PRICE_MOVED', 'WARN', 'SCENARIO'], bad = ['CANCELLED', 'SUPERSEDED', 'ZERO', 'INCONSISTENT', 'ERROR', 'ZERO_COST', 'DELAYED'], info = ['IN_PROGRESS', 'READY', 'INFO']; const cls = good.includes(s) ? 'good' : warn.includes(s) ? 'warn' : bad.includes(s) ? 'bad' : info.includes(s) ? 'info' : ''; return `<span class="badge ${cls}">${esc(String(s || '').replace(/_/g, ' '))}</span>`; };
  const options = (items, value, { allLabel = null, key = 'id', label = 'name' } = {}) => (allLabel != null ? `<option value="">${esc(allLabel)}</option>` : '') + items.map((i) => `<option value="${esc(i[key])}" ${String(i[key]) === String(value) ? 'selected' : ''}>${esc(typeof label === 'function' ? label(i) : i[label])}</option>`).join('');
  const field = (label, name, type, value, extra = '') => `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value == null ? '' : value)}" ${extra}></label>`;
  const selectField = (label, name, optsHtml, extra = '') => `<label>${esc(label)}<select name="${name}" ${extra}>${optsHtml}</select></label>`;
  const textarea = (label, name, value, extra = '') => `<label class="full">${esc(label)}<textarea name="${name}" rows="2" ${extra}>${esc(value || '')}</textarea></label>`;
  const progress = (pct) => { const p = Math.max(0, Math.min(100, num(pct))); return `<div class="progress ${p < 50 ? 'bad' : p < 100 ? 'warn' : ''}" title="${p}%"><span style="width:${p}%"></span></div>`; };
  const kpi = (label, value, delta = '', cls = '') => `<div class="kpi ${cls}"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="delta">${delta}</div></div>`;

  function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), err ? 5000 : 2800); }

  /** modal(title, bodyHtml, onSubmit(values, form) → false keeps open; may be async) */
  function modal(title, bodyHtml, onSubmit, { submitLabel = 'Save', danger = false, cancelLabel = 'Cancel', wide = false } = {}) {
    const dlg = $('#modal'), form = $('#modal-form');
    dlg.style.width = wide ? 'min(1100px, 96vw)' : '';
    form.innerHTML = `<h2>${esc(title)}</h2>${bodyHtml}<div class="row end">${onSubmit ? `<button type="button" class="btn" data-close>${esc(cancelLabel)}</button><button type="submit" class="btn primary ${danger ? 'danger' : ''}" data-submit>${esc(submitLabel)}</button>` : `<button type="button" class="btn primary" data-close>Close</button>`}</div>`;
    const close = () => { dlg.close(); form.onsubmit = null; };
    $$('[data-close]', form).forEach((b) => (b.onclick = close));
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!onSubmit) return close();
      const values = {}; new FormData(form).forEach((v, k) => (values[k] = v));
      $$('input[type="checkbox"]', form).forEach((c) => (values[c.name] = c.checked));
      const btn = $('[data-submit]', form); btn.disabled = true;
      try { const r = await onSubmit(values, form); if (r !== false) close(); } catch (err) { toast(err.message || 'Failed', true); } finally { btn.disabled = false; }
    };
    dlg.showModal();
    const first = form.querySelector('input:not([type=hidden]), select, textarea'); if (first) first.focus();
    return form;
  }
  const confirm = (title, text, label = 'Confirm', danger = false) => new Promise((resolve) => { modal(title, `<p>${text}</p>`, () => { resolve(true); }, { submitLabel: label, danger }); $('#modal').addEventListener('close', () => resolve(false), { once: true }); });

  /** Simple table renderer: cols = [{key, label, cls, fmt(row)}] */
  function table(cols, rows, { empty = 'Nothing to show.', rowClass = null, foot = null, cls = '', rowAttr = null } = {}) {
    const head = cols.map((c) => `<th class="${c.cls || ''}">${c.label}</th>`).join('');
    const body = rows.length ? rows.map((r) => `<tr class="${rowClass ? rowClass(r) : ''}" ${rowAttr ? rowAttr(r) : ''}>${cols.map((c) => `<td class="${c.cls || ''}">${c.fmt ? c.fmt(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}"><div class="empty">${empty}</div></td></tr>`;
    return `<div class="table-wrap"><table class="${cls}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`;
  }
  function tabs(items, active, attr = 'data-tab') { return `<div class="tabs">${items.map(([k, l]) => `<button type="button" ${attr}="${k}" class="${k === active ? 'active' : ''}">${l}</button>`).join('')}</div>`; }

  /** Export rows (array of arrays) to xlsx via SheetJS, CSV fallback. sheets = {name: rows} */
  function exportSheets(filename, sheets) {
    if (root.XLSX) {
      const wb = root.XLSX.utils.book_new();
      Object.entries(sheets).forEach(([name, rows]) => root.XLSX.utils.book_append_sheet(wb, root.XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31)));
      root.XLSX.writeFile(wb, filename + '.xlsx');
      return;
    }
    Object.entries(sheets).forEach(([name, rows]) => {
      const csv = rows.map((r) => r.map((v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${filename}-${name}.csv`; a.click();
    });
    toast('Excel library unavailable offline — downloaded CSV instead');
  }
  const tableToRows = (cols, rows) => [cols.map((c) => c.label.replace(/<[^>]+>/g, '')), ...rows.map((r) => cols.map((c) => (c.raw ? c.raw(r) : c.key ? r[c.key] : (c.fmt ? c.fmt(r) : '')).toString().replace(/<[^>]+>/g, '')))];

  root.UI = { $, $$, esc, num, fmtNum, fmtInt, fmtMoney, fmtPct, fmtDate, fmtDateTime, today, addDays, monthStart, monthEnd, daysBetween, statusBadge, options, field, selectField, textarea, progress, kpi, toast, modal, confirm, table, tabs, exportSheets, tableToRows };
})(window);
