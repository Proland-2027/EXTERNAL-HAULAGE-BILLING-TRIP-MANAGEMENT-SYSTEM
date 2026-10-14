/* app.js — UI for the DARCO JMG Spare Parts Sourcing & Procurement system (vanilla JS, no build step). */
(function () {
  'use strict';
  const S = window.Spares;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let db = window.Store.load();
  const state = {
    view: 'dashboard', requestId: null, supplierId: null, poId: null, form: null,
    requestFilter: { q: '', status: '', urgency: '', truckReg: '', department: '' },
    quoteFilter: { status: '', supplierId: '' }, orderFilter: { status: '', supplierId: '' },
    history: { partNo: '', truckReg: '', supplierId: '' }, lastTruck: null, lastRequester: null, lastDepartment: null,
  };

  // ------------------------------------------------------------------ helpers
  const st = () => db.settings;
  const base = () => st().baseCurrency || 'USD';
  const rates = () => st().rates || { USD: 1 };
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtNum = (v, d = 2) => S.num(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d });
  const fmtMoney = (v, cur = base()) => `${cur} ${S.num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const toBase = (v, cur) => S.convert(v, cur, base(), rates());
  const supplier = (id) => db.suppliers.find((s) => s.id === id);
  const supplierName = (id) => (supplier(id) || {}).name || id || '';
  const request = (id) => db.requests.find((r) => r.id === id);
  const po = (id) => db.purchaseOrders.find((p) => p.id === id);
  const truckLabel = (r) => [r.truckMake, r.truckModel].filter(Boolean).join(' ') + (r.truckReg ? ` · ${r.truckReg}` : '');
  const label = (s) => String(s || '').replace(/_/g, ' ');
  const badge = (s, extra = '') => `<span class="badge st-${esc(s)} ${extra}">${esc(label(s))}</span>`;
  const urgency = (u) => `<span class="badge urg-${esc(u)}">${esc(u)}</span>`;
  const stars = (n) => `<span class="stars" title="${n}/5">${'★'.repeat(Math.round(S.num(n)))}${'☆'.repeat(5 - Math.round(S.num(n)))}</span>`;
  const options = (items, value, { allLabel = null, key = 'id', labelKey = 'name' } = {}) => (allLabel != null ? `<option value="">${esc(allLabel)}</option>` : '') + items.map((i) => { const k = typeof i === 'object' ? i[key] : i, l = typeof i === 'object' ? (typeof labelKey === 'function' ? labelKey(i) : i[labelKey]) : i; return `<option value="${esc(k)}" ${String(k) === String(value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
  const datalist = (id, items) => `<datalist id="${id}">${[...new Set(items.filter(Boolean))].map((i) => `<option value="${esc(i)}">`).join('')}</datalist>`;
  const rfqsOf = (id) => db.rfqs.filter((q) => q.requestId === id);
  const posOf = (id) => db.purchaseOrders.filter((p) => p.status !== 'CANCELLED' && p.lines.some((l) => l.requestId === id));
  const openRequest = (r) => !['CLOSED', 'CANCELLED', 'RECEIVED'].includes(r.status);
  const daysTo = (d) => (d ? S.daysBetween(today(), d) : null);

  function refreshStatuses() { db.requests.forEach((r) => { r.status = S.deriveStatus(r, { rfqs: db.rfqs, purchaseOrders: db.purchaseOrders }); }); }
  function save() { refreshStatuses(); if (!window.Store.save(db)) toast('Storage is full — export a backup and delete old data'); }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200); }

  /** Open the modal with form HTML; `onSubmit(values, form)` returns false to keep the dialog open (may be async). */
  function modal(title, bodyHtml, onSubmit, { submitLabel = 'Save', danger = false, cancelLabel = 'Cancel', wide = false } = {}) {
    const dlg = $('#modal'), form = $('#modal-form');
    dlg.style.maxWidth = wide ? '1000px' : '';
    form.innerHTML = `<h2>${esc(title)}</h2>${bodyHtml}<div class="form-actions"><button type="button" class="btn" data-close>${esc(cancelLabel)}</button>${onSubmit ? `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button>` : ''}</div>`;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const values = {}; new FormData(form).forEach((v, k) => { if (!(v instanceof File) && !k.endsWith('[]')) values[k] = v; });
      form.querySelectorAll('input[type="checkbox"]').forEach((c) => { if (c.name.endsWith('[]')) { values[c.name] = values[c.name] || []; if (c.checked) values[c.name].push(c.value); } else values[c.name] = c.checked; });
      const btn = form.querySelector('[type="submit"]'); if (btn) btn.disabled = true;
      try { if (!onSubmit || (await onSubmit(values, form)) !== false) dlg.close(); } finally { if (btn) btn.disabled = false; }
    };
    form.querySelector('[data-close]').onclick = () => dlg.close();
    dlg.showModal();
    const first = form.querySelector('input:not([type=hidden]), select, textarea'); if (first) first.focus();
    return form;
  }
  const field = (lbl, name, type = 'text', value = '', attrs = '', cls = '') => `<label class="${cls}">${lbl}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
  const selectField = (lbl, name, optsHtml, attrs = '', cls = '') => `<label class="${cls}">${lbl}<select name="${name}" ${attrs}>${optsHtml}</select></label>`;
  const textareaField = (lbl, name, value = '', attrs = '', cls = 'full') => `<label class="${cls}">${lbl}<textarea name="${name}" ${attrs}>${esc(value)}</textarea></label>`;
  const req = (l) => `${l} <span class="req">*</span>`;

  // ------------------------------------------------------------------ photos
  const photoCache = new Map();
  async function photoUrl(id) { if (!id) return null; if (photoCache.has(id)) return photoCache.get(id); const d = await window.Photos.get(id); if (d) photoCache.set(id, d); return d; }
  async function hydratePhotos(container) {
    const imgs = [...container.querySelectorAll('img[data-photo]')];
    for (const img of imgs) { const d = await photoUrl(img.dataset.photo); if (d) { img.src = d; img.classList.remove('empty'); } else img.alt = 'No photo'; }
  }
  async function ensureDemoPhotos() {
    const ids = db.requests.flatMap((r) => r.photos || []).filter((p) => p && p.startsWith('DEMO-'));
    if (!ids.length) return;
    const have = new Set(await window.Photos.keys());
    const missing = ids.filter((id) => !have.has(id));
    if (!missing.length) return;
    const obj = {};
    missing.forEach((id) => { const m = /^DEMO-(\d+)-(\d)$/.exec(id); const r = request(`DARCO-SP-${m[1]}`); obj[id] = window.Photos.placeholder(`PHOTO ${m[2]}`, r ? r.description : 'Demo photo'); });
    await window.Photos.putMany(obj);
  }
  function lightbox(src) { const d = document.createElement('div'); d.className = 'lightbox'; d.innerHTML = `<img src="${src}" alt="">`; d.onclick = () => d.remove(); document.body.appendChild(d); }

  // ------------------------------------------------------------------ PDF & sharing
  async function requestPdfBytes(r) {
    const photos = [];
    for (let i = 0; i < 3; i++) { const d = await photoUrl((r.photos || [])[i]); photos.push(d ? window.Photos.bytes(await window.Photos.toJpeg(d)) : null); }
    return window.Documents.requestPdf(r, st(), photos);
  }
  const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });
  async function downloadRequestPdf(r) { window.Exporter.download(`${r.id}.pdf`, pdfBlob(await requestPdfBytes(r))); toast(`${r.id}.pdf downloaded`); }
  /** Share a PDF with a prepared message: Web Share (phones → WhatsApp with the PDF attached), else download + open WhatsApp. */
  async function shareViaWhatsApp({ fileName, bytes, text, number, title }) {
    const file = new File([pdfBlob(bytes)], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title, text }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    window.Exporter.download(fileName, file);
    window.open(S.whatsappUrl(number || '', text), '_blank', 'noopener');
    toast(`${fileName} downloaded — attach it in the WhatsApp chat`);
    return 'fallback';
  }
  function shareRequestModal(r, preSupplierId = '') {
    const sups = db.suppliers.filter((s) => s.active !== false);
    const body = `<div class="form-grid">
      ${selectField('Supplier (fills the WhatsApp number)', 'supplierId', options(sups, preSupplierId, { allLabel: '— enter a number manually —' }))}
      ${field('WhatsApp number (with country code)', 'number', 'tel', (supplier(preSupplierId) || {}).whatsapp || '', 'placeholder="+86 ..."')}
      ${textareaField('Message', 'text', S.rfqMessage(r, st(), supplier(preSupplierId) || {}), 'rows="9"')}
      <label class="full check"><input type="checkbox" name="markSent" checked> Record this as an RFQ sent to the selected supplier (WhatsApp)</label>
      <div class="hint full">On a phone, <b>Share</b> opens the share sheet with the PDF attached — choose WhatsApp and the contact. On a computer the PDF is downloaded and WhatsApp Web opens with the message; attach the downloaded PDF.</div>
    </div>`;
    const form = modal(`Share ${r.id} via WhatsApp`, body, async (v) => {
      const bytes = await requestPdfBytes(r);
      const res = await shareViaWhatsApp({ fileName: `${r.id}.pdf`, bytes, text: v.text, number: v.number, title: `${r.id} ${r.description}` });
      if (res === 'cancelled') return false;
      if (v.markSent && v.supplierId) { addRfqs(r, [v.supplierId], 'WHATSAPP'); render(); }
    }, { submitLabel: 'Share PDF via WhatsApp' });
    form.querySelector('[name="supplierId"]').onchange = (e) => { const s = supplier(e.target.value) || {}; form.querySelector('[name="number"]').value = s.whatsapp || ''; form.querySelector('[name="text"]').value = S.rfqMessage(r, st(), s); };
  }
  function addRfqs(r, supplierIds, channel) {
    let n = 0;
    supplierIds.forEach((sid) => { if (db.rfqs.some((q) => q.requestId === r.id && q.supplierId === sid)) return; db.rfqs.push({ id: window.Store.uid('RFQ'), requestId: r.id, supplierId: sid, sentAt: today(), channel, status: 'SENT', selected: false, quote: null }); n++; });
    save(); if (n) toast(`RFQ recorded for ${n} supplier(s)`);
    return n;
  }

  // ------------------------------------------------------------------ router
  function render() {
    document.querySelectorAll('#nav .tab').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view || (state.view.startsWith('request') && b.dataset.view === 'requests') || (state.view === 'po' && b.dataset.view === 'orders') || (state.view === 'supplier' && b.dataset.view === 'suppliers')));
    $('#brand-company').textContent = st().company || 'DARCO JMG';
    $('#fab').classList.toggle('show', ['dashboard', 'requests'].includes(state.view));
    const views = { dashboard: renderDashboard, requests: renderRequests, 'request-form': renderRequestForm, request: renderRequestDetail, suppliers: renderSuppliers, supplier: renderSupplierDetail, quotes: renderQuotes, orders: renderOrders, po: renderPoDetail, shipping: renderShipping, history: renderHistory, setup: renderSetup, data: renderData };
    const v = $('#view');
    v.innerHTML = (views[state.view] || renderDashboard)();
    hydratePhotos(v);
    if (state.view === 'dashboard') window.Charts.bindTooltips(v);
    window.scrollTo({ top: 0 });
  }
  const go = (view, extra = {}) => { Object.assign(state, extra, { view }); render(); };
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) go(b.dataset.view); });
  $('#theme-toggle').addEventListener('click', () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; try { localStorage.setItem('darco.theme', r.dataset.theme); } catch (e) { /* ignore */ } });
  try { const th = localStorage.getItem('darco.theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* ignore */ }

  // ------------------------------------------------------------------ dashboard
  function renderDashboard() {
    const open = db.requests.filter(openRequest);
    const month = today().slice(0, 7);
    const spendMonth = db.purchaseOrders.filter((p) => p.status !== 'CANCELLED' && S.periodOf(p.date) === month).reduce((s, p) => s + toBase(p.total, p.currency), 0);
    const inTransit = db.purchaseOrders.filter((p) => ['SHIPPED', 'ARRIVED'].includes(p.status));
    const overdue = inTransit.filter((p) => p.shipment.eta && p.shipment.eta < today());
    const awaiting = db.rfqs.filter((q) => q.status === 'SENT');
    const kpi = (lbl, value, sub = '', cls = '') => `<div class="kpi"><div class="label">${esc(lbl)}</div><div class="value ${cls}">${value}</div><div class="delta">${sub}</div></div>`;
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - 5 + i); return d.toISOString().slice(0, 7); });
    const chart = window.Charts.groupedBars({ categories: months.map((m) => new Date(m + '-01').toLocaleString(undefined, { month: 'short', year: '2-digit' })), series: [
      { name: 'Requests raised', values: months.map((m) => db.requests.filter((r) => S.periodOf(r.date) === m).length) },
      { name: 'Parts ordered', values: months.map((m) => db.purchaseOrders.filter((p) => p.status !== 'CANCELLED' && S.periodOf(p.date) === m).reduce((s, p) => s + p.lines.length, 0)) },
      { name: 'Parts received', values: months.map((m) => db.purchaseOrders.filter((p) => S.periodOf(p.shipment.receivedAt) === m).reduce((s, p) => s + p.lines.length, 0)) },
    ], fmt: (v) => fmtNum(v, 0), unitLabel: 'Requests, orders and receipts per month' });
    const byStatus = S.REQUEST_STATUSES.map((s) => ({ s, n: db.requests.filter((r) => r.status === s).length })).filter((x) => x.n);
    const recent = db.requests.slice().sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date)).slice(0, 6);
    return `
      <div class="row between" style="margin-bottom:1rem"><h1>Dashboard</h1><div class="btn-row"><button class="btn primary" data-action="request-new">+ New spare part request</button></div></div>
      <div class="kpis">
        ${kpi('Open requests', open.length, `${open.filter((r) => r.urgency === 'CRITICAL').length} critical · ${open.filter((r) => r.urgency === 'URGENT').length} urgent`)}
        ${kpi('Not yet sent to suppliers', open.filter((r) => r.status === 'NEW').length, 'status NEW')}
        ${kpi('Awaiting quotations', awaiting.length, `${new Set(awaiting.map((q) => q.requestId)).size} request(s)`)}
        ${kpi('Ready to order', open.filter((r) => r.status === 'QUOTED').length, 'quoted, no PO yet')}
        ${kpi('Shipments in transit', inTransit.length, overdue.length ? `<span class="err">${overdue.length} overdue</span>` : 'none overdue')}
        ${kpi('Spend this month', fmtMoney(spendMonth), `${db.purchaseOrders.filter((p) => p.status !== 'CANCELLED' && S.periodOf(p.date) === month).length} purchase order(s)`)}
      </div>
      <div class="grid two" style="margin-top:1rem">
        <div class="card"><div class="card-head"><h2>Activity — last 6 months</h2></div>${chart}</div>
        <div class="card"><div class="card-head"><h2>Requests by status</h2><button class="btn sm" data-action="go" data-view="requests">All requests</button></div>
          <div class="pill-row">${byStatus.map((x) => `<button class="btn sm" data-action="requests-status" data-status="${x.s}">${badge(x.s)} ${x.n}</button>`).join('') || '<span class="muted">No requests yet</span>'}</div>
          <h3 style="margin-top:1rem">Shipments due</h3>
          ${inTransit.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th>PO</th><th>Supplier</th><th>ETA</th><th>Days</th><th>Customs</th></tr></thead><tbody>${inTransit.map((p) => { const d = daysTo(p.shipment.eta); return `<tr><td><a href="#" data-action="po-open" data-id="${p.id}">${esc(p.number)}</a></td><td>${esc(p.supplierName)}</td><td>${esc(p.shipment.eta || '–')}</td><td class="${d != null && d < 0 ? 'err' : ''}">${d == null ? '–' : d < 0 ? `${-d} overdue` : d}</td><td>${badge(p.shipment.customsStatus || 'NOT_STARTED')}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted small">Nothing in transit.</p>'}
        </div>
      </div>
      <div class="card" style="margin-top:1rem"><div class="card-head"><h2>Recent requests</h2></div>${requestCards(recent)}</div>`;
  }

  // ------------------------------------------------------------------ requests
  function requestCards(list) {
    if (!list.length) return '<div class="empty">No spare part requests match.</div>';
    return `<div class="req-list">${list.map((r) => `<div class="req-card" data-action="request-open" data-id="${r.id}">
      <img class="thumb" data-photo="${esc((r.photos || [])[0] || '')}" alt="">
      <div><div class="row between" style="gap:.3rem"><span class="id">${esc(r.id)}</span>${badge(r.status)}</div>
        <div class="title">${esc(r.description)}</div>
        <div class="meta">${esc(r.partNo || 'no part number')} · ${fmtNum(r.qty)} ${esc(r.unit)} ${urgency(r.urgency)}</div>
        <div class="meta">${esc(truckLabel(r))}</div>
        <div class="meta muted">${esc(r.date)} · ${esc(r.requestedBy)} · ${rfqsOf(r.id).length} RFQ · ${rfqsOf(r.id).filter((q) => q.status === 'QUOTED').length} quote(s)</div>
      </div></div>`).join('')}</div>`;
  }
  function filteredRequests() {
    const f = state.requestFilter, q = f.q.trim().toLowerCase(), pn = S.normalizePartNo(f.q);
    return db.requests.filter((r) => (!f.status || r.status === f.status) && (!f.urgency || r.urgency === f.urgency) && (!f.truckReg || r.truckReg === f.truckReg) && (!f.department || r.department === f.department) &&
      (!q || [r.id, r.description, r.partNo, r.truckReg, r.truckModel, r.chassis, r.requestedBy, r.category].some((x) => String(x || '').toLowerCase().includes(q)) || (pn && S.normalizePartNo(r.partNo).includes(pn))))
      .sort((a, b) => b.id.localeCompare(a.id));
  }
  function renderRequests() {
    const f = state.requestFilter, list = filteredRequests();
    return `
      <div class="row between" style="margin-bottom:.75rem"><h1>Spare Parts Requests</h1>
        <div class="btn-row"><button class="btn primary" data-action="request-new">+ New request</button><label class="btn">Import Excel/CSV… <input type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-action="requests-import" hidden></label><button class="btn" data-action="requests-export">Export Excel</button><button class="btn ghost" data-action="requests-template">Import template</button></div></div>
      <div class="card"><div class="toolbar">
        <label class="search">Search<input type="search" value="${esc(f.q)}" data-filter="q" placeholder="ID, part number, description, truck…"></label>
        <label>Status<select data-filter="status">${options(S.REQUEST_STATUSES.map((s) => ({ id: s, name: label(s) })), f.status, { allLabel: 'All' })}</select></label>
        <label>Urgency<select data-filter="urgency">${options(S.URGENCIES, f.urgency, { allLabel: 'All' })}</select></label>
        <label>Truck<select data-filter="truckReg">${options([...new Set(db.requests.map((r) => r.truckReg))].sort(), f.truckReg, { allLabel: 'All' })}</select></label>
        <label>Department<select data-filter="department">${options([...new Set(db.requests.map((r) => r.department))].sort(), f.department, { allLabel: 'All' })}</select></label>
        <span class="muted small">${list.length} of ${db.requests.length}</span>
      </div>${requestCards(list)}</div>`;
  }

  // ---- request form (new / edit) — a full page so the camera works comfortably on phones
  function blankForm(prev = {}) {
    const t = state.lastTruck || {};
    return { editingId: null, photos: [null, null, null], values: { date: today(), requestedBy: state.lastRequester || '', department: state.lastDepartment || t.department || '', truckReg: t.truckReg || '', truckMake: t.truckMake || '', truckModel: t.truckModel || '', chassis: t.chassis || '', engineModel: t.engineModel || '', category: '', description: '', partNo: '', qty: 1, unit: 'PCS', urgency: 'NORMAL', size: '', remarks: '', ...prev } };
  }
  function syncForm() { const f = state.form; if (!f) return; document.querySelectorAll('#req-form [name]').forEach((el) => { f.values[el.name] = el.type === 'checkbox' ? el.checked : el.value; }); }
  function renderRequestForm() {
    const f = state.form || (state.form = blankForm()); const v = f.values;
    const trucks = db.trucks;
    const slot = (i) => { const d = f.photos[i]; return `<div class="photo-slot ${d ? 'filled' : f.showErrors ? 'missing' : ''}">
      <div><div class="slot-title">Photo ${i + 1} ${d ? '✓' : '<span class="req">*</span>'}</div><div class="slot-sub">${esc(S.PHOTO_LABELS[i])}</div></div>
      ${d ? `<img class="preview" src="${d}" alt="Photo ${i + 1}" data-action="zoom">` : '<div class="placeholder">📷</div>'}
      <div class="btn-row"><label class="btn primary sm">📷 ${d ? 'Retake' : 'Take photo'}<input type="file" accept="image/*" capture="environment" data-photo-slot="${i}"></label><label class="btn sm">Gallery<input type="file" accept="image/*" data-photo-slot="${i}"></label>${d ? `<button type="button" class="btn sm ghost" data-action="photo-clear" data-id="${i}">Remove</button>` : ''}</div>
    </div>`; };
    const dup = v.partNo || v.description ? S.findDuplicates(v, db.requests, { excludeId: f.editingId }) : { exact: [], matchingPartNo: [], similar: [] };
    const errors = f.showErrors ? S.validateRequest({ ...v, photos: f.photos }) : [];
    return `<div class="form-page" id="req-form">
      <div class="row between" style="margin-bottom:.75rem"><h1>${f.editingId ? `Edit ${esc(f.editingId)}` : 'New spare part request'}</h1><span class="muted small">One spare part per request</span></div>
      ${errors.length ? `<div class="banner bad"><b>Please complete the form:</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      ${dup.exact.length ? `<div class="banner bad"><b>Duplicate:</b> part ${esc(v.partNo)} is already requested for ${esc(v.truckReg)} on ${dup.exact.map((x) => `<a href="#" data-action="request-open" data-id="${x.id}">${esc(x.id)}</a> (${esc(label(x.status))})`).join(', ')}. Saving is blocked until that request is closed or cancelled.</div>` : ''}
      ${!dup.exact.length && dup.matchingPartNo.length ? `<div class="banner warn"><b>Same part number found</b> on ${dup.matchingPartNo.map((x) => `<a href="#" data-action="request-open" data-id="${x.id}">${esc(x.id)}</a> (${esc(x.truckReg)}, ${esc(label(x.status))})`).join(', ')} — check the procurement history before ordering.</div>` : ''}
      ${dup.similar.length ? `<div class="banner warn"><b>Similar open request</b> for this truck: ${dup.similar.map((x) => `<a href="#" data-action="request-open" data-id="${x.id}">${esc(x.id)}</a>`).join(', ')}.</div>` : ''}
      <div class="card form-section"><h2><span class="step">1</span> Request</h2><div class="form-grid">
        ${field('Request ID', 'id', 'text', f.editingId || `${st().requestPrefix}${S.nextNumber(db.requests, st().requestPrefix).slice(st().requestPrefix.length)} (automatic)`, 'disabled')}
        ${field(req('Request date'), 'date', 'date', v.date, 'required')}
        ${field(req('Requested by'), 'requestedBy', 'text', v.requestedBy, 'list="dl-requesters" required')}${datalist('dl-requesters', (st().requesters || []).concat(db.requests.map((r) => r.requestedBy)))}
        ${field(req('Department / Workshop'), 'department', 'text', v.department, 'list="dl-departments" required')}${datalist('dl-departments', (st().departments || []).concat(db.requests.map((r) => r.department)))}
      </div></div>
      <div class="card form-section"><h2><span class="step">2</span> Truck</h2>
        ${trucks.length ? `<div class="quick-truck" style="margin-bottom:.6rem"><span class="small muted">Pick a truck:</span>${trucks.map((t) => `<button type="button" class="btn sm ${t.regNo === v.truckReg ? 'primary' : ''}" data-action="pick-truck" data-id="${t.id}">${esc(t.regNo)}</button>`).join('')}</div>` : ''}
        <div class="form-grid">
        ${field(req('Truck registration number'), 'truckReg', 'text', v.truckReg, 'required style="text-transform:uppercase"')}
        ${selectField(req('Truck make'), 'truckMake', options(st().truckMakes.includes(v.truckMake) || !v.truckMake ? st().truckMakes : [v.truckMake, ...st().truckMakes], v.truckMake || 'SINOTRUK'), 'required')}
        ${field(req('Truck model'), 'truckModel', 'text', v.truckModel, 'list="dl-models" required placeholder="e.g. HOWO 371 6x4 Tipper"')}${datalist('dl-models', db.trucks.map((t) => t.model).concat(db.requests.map((r) => r.truckModel)))}
        ${field('Chassis / VIN number', 'chassis', 'text', v.chassis, 'style="text-transform:uppercase"')}
        ${field('Engine model', 'engineModel', 'text', v.engineModel, 'list="dl-engines" placeholder="e.g. WD615.47"')}${datalist('dl-engines', db.trucks.map((t) => t.engineModel).concat(db.requests.map((r) => r.engineModel)))}
      </div><div class="hint">Truck details are kept for the next request so several parts for the same truck can be raised quickly.</div></div>
      <div class="card form-section"><h2><span class="step">3</span> Spare part</h2><div class="form-grid">
        ${selectField(req('Part category'), 'category', options(st().categories, v.category, { allLabel: '— select —' }), 'required')}
        ${field(req('Spare part description'), 'description', 'text', v.description, 'required placeholder="e.g. Rear brake drum"', 'full')}
        ${field('OEM / Manufacturer part number', 'partNo', 'text', v.partNo, 'placeholder="e.g. WG9231342006" style="text-transform:uppercase"')}
        ${field(req('Required quantity'), 'qty', 'number', v.qty, 'min="0.01" step="any" required')}
        ${selectField(req('Unit of measurement'), 'unit', options(st().units, v.unit), 'required')}
        ${selectField(req('Urgency'), 'urgency', options(S.URGENCIES.map((u) => ({ id: u, name: u[0] + u.slice(1).toLowerCase() })), v.urgency), 'required')}
        ${field('Size / specification', 'size', 'text', v.size, 'placeholder="dimensions, voltage, number of teeth…"')}
        ${textareaField('Additional remarks', 'remarks', v.remarks, 'rows="2" placeholder="fault description, where fitted, brand preference…"')}
      </div></div>
      <div class="card form-section"><h2><span class="step">4</span> Photographs <span class="small muted">(3 required — use the phone camera)</span></h2><div class="photo-grid">${slot(0)}${slot(1)}${slot(2)}</div></div>
      <div class="card"><div class="sticky-actions">
        <button class="btn" data-action="request-cancel-form">Cancel</button>
        ${f.editingId ? '' : '<button class="btn" data-action="request-save-another">Save &amp; add another part</button>'}
        <button class="btn primary" data-action="request-save">${f.editingId ? 'Save changes' : 'Save request'}</button>
      </div></div>
    </div>`;
  }
  async function saveRequest({ another = false } = {}) {
    syncForm(); const f = state.form, v = f.values;
    v.truckReg = v.truckReg.trim().toUpperCase(); v.partNo = v.partNo.trim().toUpperCase(); v.chassis = v.chassis.trim().toUpperCase();
    const errors = S.validateRequest({ ...v, photos: f.photos });
    const dup = S.findDuplicates(v, db.requests, { excludeId: f.editingId });
    if (errors.length || dup.blocked) { f.showErrors = true; render(); toast(dup.blocked ? 'Duplicate request — see the warning' : 'Please complete the required fields and photos'); return; }
    const id = f.editingId || S.nextNumber(db.requests, st().requestPrefix);
    const photoIds = [];
    for (let i = 0; i < 3; i++) { const pid = `${id}-P${i + 1}`; if (f.photos[i] && f.photos[i] !== photoCache.get(pid)) { await window.Photos.put(pid, f.photos[i]); photoCache.set(pid, f.photos[i]); } photoIds.push(f.photos[i] ? pid : null); }
    const data = { ...v, qty: S.num(v.qty), photos: photoIds, matchingPartNo: dup.matchingPartNo.map((x) => x.id) };
    delete data.id;
    if (f.editingId) Object.assign(request(id), data, { updatedAt: new Date().toISOString() });
    else db.requests.push({ id, ...data, status: 'NEW', createdAt: new Date().toISOString() });
    const truck = db.trucks.find((t) => S.normalizeReg(t.regNo) === S.normalizeReg(v.truckReg));
    if (truck) Object.assign(truck, { make: v.truckMake, model: v.truckModel, chassis: v.chassis || truck.chassis, engineModel: v.engineModel || truck.engineModel, department: v.department });
    else db.trucks.push({ id: window.Store.uid('TRK'), regNo: v.truckReg, make: v.truckMake, model: v.truckModel, chassis: v.chassis, engineModel: v.engineModel, department: v.department });
    state.lastTruck = { truckReg: v.truckReg, truckMake: v.truckMake, truckModel: v.truckModel, chassis: v.chassis, engineModel: v.engineModel, department: v.department };
    state.lastRequester = v.requestedBy; state.lastDepartment = v.department;
    save(); toast(`${id} saved`);
    if (another) { state.form = blankForm({ date: v.date }); render(); } else { state.form = null; go('request', { requestId: id }); }
  }

  // ---- request detail
  function renderRequestDetail() {
    const r = request(state.requestId); if (!r) return '<div class="empty">Request not found.</div>';
    const rfqs = rfqsOf(r.id), cmp = S.compareQuotes(r, db.rfqs, db.suppliers, { rates: rates(), baseCurrency: base() });
    const pos = posOf(r.id), dup = S.findDuplicates(r, db.requests), ps = S.priceStats(r.partNo, db.purchaseOrders, { rates: rates(), baseCurrency: base() });
    const steps = ['NEW', 'RFQ_SENT', 'QUOTED', 'ORDERED', 'SHIPPED', 'RECEIVED'];
    const idx = steps.indexOf(r.status);
    const manual = S.MANUAL_STATUSES.includes(r.status);
    const kv = (k, v) => `<dt>${k}</dt><dd>${v == null || v === '' ? '<span class="muted">–</span>' : v}</dd>`;
    return `
      <div class="row between" style="margin-bottom:.5rem"><div><a href="#" data-action="go" data-view="requests">← Requests</a><h1 style="margin-top:.3rem">${esc(r.id)} — ${esc(r.description)}</h1><div class="row">${badge(r.status)} ${urgency(r.urgency)} ${r.imported ? '<span class="badge">imported</span>' : ''}</div></div>
        <div class="btn-row">
          <button class="btn primary" data-action="request-pdf" data-id="${r.id}">⬇ Download PDF</button>
          <button class="btn whatsapp" data-action="request-share" data-id="${r.id}">Share via WhatsApp</button>
          <button class="btn green" data-action="rfq-send" data-id="${r.id}">Send RFQ to suppliers</button>
          <button class="btn" data-action="request-edit" data-id="${r.id}">Edit</button>
          <button class="btn" data-action="request-clone" data-id="${r.id}">Another part, same truck</button>
        </div></div>
      ${manual ? '' : `<div class="progress">${steps.map((s, i) => `<span class="step ${i < idx ? 'done' : i === idx ? 'current' : ''}">${esc(label(s))}</span>`).join('')}</div>`}
      ${dup.matchingPartNo.length ? `<div class="banner warn"><b>Same part number on:</b> ${dup.matchingPartNo.map((x) => `<a href="#" data-action="request-open" data-id="${x.id}">${esc(x.id)}</a> (${esc(x.truckReg)}, ${esc(label(x.status))})`).join(', ')}${ps.count ? ` · last bought at ${fmtMoney(ps.last)} from ${esc(ps.lastSupplier)} on ${esc(ps.lastDate)}` : ''}</div>` : ps.count ? `<div class="banner info">Previously bought ${ps.count}× · last ${fmtMoney(ps.last)} (${esc(ps.lastSupplier)}, ${esc(ps.lastDate)}) · min ${fmtMoney(ps.min)} · max ${fmtMoney(ps.max)}</div>` : ''}
      <div class="detail-grid">
        <div class="card"><div class="card-head"><h2>Photographs</h2></div>
          <div class="photos-row">${[0, 1, 2].map((i) => `<div><img data-photo="${esc((r.photos || [])[i] || '')}" alt="Photo ${i + 1}" data-action="zoom"><div class="cap">${i + 1}. ${esc(S.PHOTO_LABELS[i])}${(r.photos || [])[i] ? '' : ' — <span class="err">missing</span>'}</div></div>`).join('')}</div>
          ${(r.photos || []).filter(Boolean).length < 3 ? '<div class="hint" style="margin-top:.5rem">Imported requests can be completed with photos via <b>Edit</b>.</div>' : ''}
        </div>
        <div class="card"><div class="card-head"><h2>Part &amp; truck information</h2></div><dl class="kv">
          ${kv('Spare part', esc(r.description))}${kv('Category', esc(r.category))}${kv('OEM / part number', esc(r.partNo))}${kv('Quantity', `${fmtNum(r.qty)} ${esc(r.unit)}`)}${kv('Size / spec', esc(r.size))}
          ${kv('Truck', esc([r.truckMake, r.truckModel].filter(Boolean).join(' ')))}${kv('Registration', esc(r.truckReg))}${kv('Chassis / VIN', esc(r.chassis))}${kv('Engine', esc(r.engineModel))}
          ${kv('Requested by', `${esc(r.requestedBy)} · ${esc(r.department)}`)}${kv('Request date', esc(r.date))}${kv('Remarks', esc(r.remarks))}
        </dl>
        <div class="btn-row" style="margin-top:.8rem">
          ${openRequest(r) && r.status !== 'ON_HOLD' ? `<button class="btn sm" data-action="request-status" data-id="${r.id}" data-status="ON_HOLD">Put on hold</button>` : ''}
          ${r.status === 'ON_HOLD' || r.status === 'CANCELLED' || r.status === 'CLOSED' ? `<button class="btn sm" data-action="request-status" data-id="${r.id}" data-status="">Reopen</button>` : ''}
          ${r.status === 'RECEIVED' ? `<button class="btn sm good" data-action="request-status" data-id="${r.id}" data-status="CLOSED">Close request</button>` : ''}
          ${r.status !== 'CANCELLED' ? `<button class="btn sm danger" data-action="request-status" data-id="${r.id}" data-status="CANCELLED">Cancel request</button>` : ''}
          <button class="btn sm danger ghost" data-action="request-delete" data-id="${r.id}">Delete</button>
        </div></div>
      </div>
      <div class="card" style="margin-top:1rem"><div class="card-head"><h2>Suppliers contacted (${rfqs.length})</h2><button class="btn sm green" data-action="rfq-send" data-id="${r.id}">+ Send to more suppliers</button></div>
        ${rfqs.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th>Supplier</th><th>Channel</th><th>Sent</th><th>Status</th><th>Quotation</th><th></th></tr></thead><tbody>
          ${rfqs.map((q) => { const s = supplier(q.supplierId) || {}; return `<tr><td><a href="#" data-action="supplier-open" data-id="${q.supplierId}">${esc(s.name || q.supplierId)}</a><div class="small muted">${esc(s.contact || '')} ${esc(s.whatsapp || '')}</div></td><td>${esc(q.channel || '')}</td><td>${esc(q.sentAt || '')}</td><td>${badge(q.status)}${q.selected ? ' <span class="badge good">selected</span>' : ''}</td>
            <td>${q.quote ? `<b>${esc(q.quote.currency)} ${fmtNum(q.quote.unitPrice)}</b> / ${esc(r.unit)} · ${esc(q.quote.brand || '')}<div class="small muted">${q.quote.leadTimeDays != null && q.quote.leadTimeDays !== '' ? `${q.quote.leadTimeDays} days` : ''} ${esc(q.quote.availability || '')} ${q.quote.warranty ? '· ' + esc(q.quote.warranty) : ''}</div>` : '<span class="muted">–</span>'}</td>
            <td class="actions"><button class="btn sm whatsapp" data-action="request-share" data-id="${r.id}" data-supplier="${q.supplierId}">WhatsApp</button> <button class="btn sm primary" data-action="quote-record" data-id="${q.id}">${q.quote ? 'Edit quote' : 'Record quote'}</button> ${q.status === 'SENT' ? `<button class="btn sm" data-action="rfq-status" data-id="${q.id}" data-status="NO_RESPONSE">No response</button><button class="btn sm" data-action="rfq-status" data-id="${q.id}" data-status="DECLINED">Declined</button>` : ''} <button class="btn sm ghost danger" data-action="rfq-delete" data-id="${q.id}">✕</button></td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="muted">Not sent to any supplier yet. Use <b>Send RFQ to suppliers</b> (records who received it) and <b>Share via WhatsApp</b> to send the PDF.</p>'}
      </div>
      ${cmp.rows.length ? `<div class="card" style="margin-top:1rem"><div class="card-head"><h2>Price comparison (${cmp.rows.length} quotation${cmp.rows.length > 1 ? 's' : ''}, in ${esc(base())})</h2><div class="btn-row"><button class="btn sm" data-action="compare-export" data-id="${r.id}">Export Excel</button></div></div>
        ${comparisonTable(r, cmp)}
        <div class="hint" style="margin-top:.5rem">Score = 60 % price, 25 % lead time, 15 % supplier rating. Totals use max(quantity, supplier MOQ) and include the quoted shipping. Rates: ${Object.entries(rates()).map(([k, v]) => `1 ${k} = ${v} ${base()}`).join(' · ')} (Setup).</div></div>` : ''}
      ${pos.length ? `<div class="card" style="margin-top:1rem"><div class="card-head"><h2>Purchase orders &amp; shipping</h2></div><div class="table-wrap"><table class="compact"><thead><tr><th>PO</th><th>Supplier</th><th>Date</th><th>Status</th><th class="num">Qty</th><th class="num">Unit price</th><th>Shipping</th><th>ETA</th><th>Received</th></tr></thead><tbody>
        ${pos.map((p) => p.lines.filter((l) => l.requestId === r.id).map((l) => `<tr><td><a href="#" data-action="po-open" data-id="${p.id}">${esc(p.number)}</a></td><td>${esc(p.supplierName)}</td><td>${esc(p.date)}</td><td>${badge(p.status)}</td><td class="num">${fmtNum(l.qty)} ${esc(l.unit)}</td><td class="num">${esc(p.currency)} ${fmtNum(l.unitPrice)}</td><td>${esc(label(p.shipment.method || ''))} ${esc(p.shipment.trackingNo || '')}</td><td>${esc(p.shipment.eta || '–')}</td><td>${esc(p.shipment.receivedAt || '–')}</td></tr>`).join('')).join('')}
      </tbody></table></div></div>` : ''}`;
  }
  function comparisonTable(r, cmp) {
    const onPo = posOf(r.id).length > 0;
    return `<div class="table-wrap"><table class="compact compare"><thead><tr><th>#</th><th>Supplier</th><th>Brand</th><th class="num">Unit price</th><th class="num">Unit (${esc(base())})</th><th class="num">Qty</th><th class="num">Total (${esc(base())})</th><th class="num">vs lowest</th><th class="num">Lead</th><th>Warranty</th><th>Valid</th><th class="num">Score</th><th></th></tr></thead><tbody>
      ${cmp.rows.map((x, i) => `<tr class="${x.best ? 'best' : ''}"><td>${i + 1}</td><td>${esc(x.supplierName)} ${stars(x.rating)}${x.best ? '<span class="flag good">best</span>' : ''}${x.lowestPrice ? '<span class="flag good">lowest</span>' : ''}${x.fastest ? '<span class="flag">fastest</span>' : ''}${x.selected ? '<span class="flag good">selected</span>' : ''}</td><td>${esc(x.brand)}</td><td class="num">${esc(x.currency)} ${fmtNum(x.unitPrice)}</td><td class="num">${fmtNum(x.unitPriceBase)}</td><td class="num">${fmtNum(x.qty)}${x.moqApplied ? ' <span class="badge warn" title="supplier MOQ">MOQ</span>' : ''}</td><td class="num"><b>${fmtNum(x.totalBase)}</b>${x.shipping ? `<div class="small muted">incl. ship ${fmtNum(x.shipping)} ${esc(x.currency)}</div>` : ''}</td><td class="num">${x.vsLowestPct == null ? '–' : x.vsLowestPct === 0 ? '—' : `+${fmtNum(x.vsLowestPct, 1)}%`}</td><td class="num">${x.leadTimeDays == null ? '–' : x.leadTimeDays + ' d'}</td><td>${esc(x.warranty)}</td><td>${esc(x.validUntil)}</td><td class="num">${fmtNum(x.score, 0)}</td>
        <td class="actions">${onPo ? '' : x.selected ? `<button class="btn sm primary" data-action="po-from-quote" data-id="${x.rfqId}">Create PO</button> <button class="btn sm ghost" data-action="quote-select" data-id="${x.rfqId}" data-on="0">Unselect</button>` : `<button class="btn sm" data-action="quote-select" data-id="${x.rfqId}" data-on="1">Select</button>`}</td></tr>`).join('')}
    </tbody></table></div>`;
  }
  function comparisonSheet(r, cmp) {
    return { name: `Compare ${r.id}`.slice(0, 31), rows: [['Request', r.id, r.description, r.partNo, `${r.qty} ${r.unit}`], [], ['Rank', 'Supplier', 'Rating', 'Brand', 'Currency', 'Unit price', `Unit price ${base()}`, 'Qty', 'MOQ applied', 'Goods', 'Shipping', 'Total', `Total ${base()}`, 'vs lowest %', 'Lead days', 'Availability', 'Warranty', 'Valid until', 'Score', 'Flags', 'Remarks'], ...cmp.rows.map((x, i) => [i + 1, x.supplierName, x.rating, x.brand, x.currency, x.unitPrice, x.unitPriceBase, x.qty, x.moqApplied ? 'yes' : '', x.goods, x.shipping, x.total, x.totalBase, x.vsLowestPct, x.leadTimeDays, x.availability, x.warranty, x.validUntil, x.score, [x.best ? 'best' : '', x.lowestPrice ? 'lowest' : '', x.fastest ? 'fastest' : '', x.selected ? 'selected' : ''].filter(Boolean).join(' '), x.remarks])] };
  }
  function sendRfqModal(r) {
    const sups = db.suppliers.filter((s) => s.active !== false), already = new Set(rfqsOf(r.id).map((q) => q.supplierId));
    if (!sups.length) { toast('Add suppliers first (Suppliers tab)'); return; }
    modal(`Send ${r.id} to suppliers`, `<p class="small muted">Tick every supplier that receives this request. Then use the WhatsApp buttons on the request page to send the PDF to each one.</p>
      <div class="checklist">${sups.map((s) => `<label><input type="checkbox" name="sup[]" value="${s.id}" ${already.has(s.id) ? 'disabled checked' : ''}> <span><b>${esc(s.name)}</b> ${stars(s.rating)}<br><span class="small muted">${esc(s.city || '')} · ${esc(s.specialization || '')}${already.has(s.id) ? ' · already sent' : ''}</span></span></label>`).join('')}</div>
      <div class="form-grid" style="margin-top:.7rem">${selectField('Channel', 'channel', options(S.CHANNELS.map((c) => ({ id: c, name: c[0] + c.slice(1).toLowerCase() })), 'WHATSAPP'))}${field('Sent on', 'sentAt', 'date', today())}</div>`, (v) => {
      const ids = (v['sup[]'] || []).filter((id) => !already.has(id));
      if (!ids.length) { toast('Select at least one supplier'); return false; }
      ids.forEach((sid) => db.rfqs.push({ id: window.Store.uid('RFQ'), requestId: r.id, supplierId: sid, sentAt: v.sentAt || today(), channel: v.channel, status: 'SENT', selected: false, quote: null }));
      save(); render(); toast(`Sent to ${ids.length} supplier(s) — now share the PDF`);
    }, { submitLabel: 'Record as sent' });
  }
  function quoteModal(q) {
    const r = request(q.requestId), s = supplier(q.supplierId) || {}, qu = q.quote || {};
    modal(`Quotation from ${s.name || q.supplierId} — ${r.id}`, `<p class="small muted">${esc(r.description)} · ${esc(r.partNo || '')} · ${fmtNum(r.qty)} ${esc(r.unit)}</p><div class="form-grid">
      ${field('Received on', 'receivedAt', 'date', qu.receivedAt || today())}${field('Manufacturer / brand', 'brand', 'text', qu.brand || '', 'placeholder="OEM, SINOTRUK genuine, aftermarket…"')}
      ${field(req('Unit price'), 'unitPrice', 'number', qu.unitPrice || '', 'step="any" min="0" required')}${selectField('Currency', 'currency', options(S.CURRENCIES, qu.currency || s.currency || base()))}
      ${field('Supplier MOQ (0 = none)', 'moq', 'number', qu.moq || 0, 'step="any" min="0"')}${field('Lead time (days)', 'leadTimeDays', 'number', qu.leadTimeDays == null ? '' : qu.leadTimeDays, 'min="0"')}
      ${field('Availability', 'availability', 'text', qu.availability || '', 'placeholder="In stock / 2 weeks…"')}${field('Warranty', 'warranty', 'text', qu.warranty || '', 'placeholder="6 months"')}
      ${field('Quote valid until', 'validUntil', 'date', qu.validUntil || S.addDays(today(), 30))}${field('Shipping cost quoted (same currency)', 'shippingCost', 'number', qu.shippingCost || 0, 'step="any" min="0"')}
      ${textareaField('Remarks', 'remarks', qu.remarks || '', 'rows="2"')}
      <label class="full">Photo of the offered part (optional)<input type="file" accept="image/*" name="photo"></label>
    </div>`, async (v, form) => {
      const file = form.querySelector('[name="photo"]').files[0];
      let photoId = qu.photoId || null;
      if (file) { photoId = `${q.id}-Q`; const d = await window.Photos.fromFile(file); await window.Photos.put(photoId, d); photoCache.set(photoId, d); }
      q.quote = { receivedAt: v.receivedAt, brand: v.brand.trim(), unitPrice: S.num(v.unitPrice), currency: v.currency, moq: S.num(v.moq), leadTimeDays: v.leadTimeDays === '' ? null : S.num(v.leadTimeDays), availability: v.availability.trim(), warranty: v.warranty.trim(), validUntil: v.validUntil, shippingCost: S.num(v.shippingCost), remarks: v.remarks.trim(), photoId };
      q.status = 'QUOTED'; save(); render(); toast('Quotation recorded');
    });
  }
  function poFromQuoteModal(rfq) {
    const r = request(rfq.requestId), s = supplier(rfq.supplierId);
    if (!s) return toast('Supplier not found');
    const others = db.rfqs.filter((q) => q.id !== rfq.id && q.supplierId === s.id && q.status === 'QUOTED' && q.quote && !posOf(q.requestId).length && openRequest(request(q.requestId) || { status: 'CANCELLED' }));
    modal(`Purchase order — ${s.name}`, `<p class="small muted">Lines are taken from the quotations. Quantities use max(requested, supplier MOQ).</p>
      <div class="checklist"><label><input type="checkbox" checked disabled> <span><b>${esc(r.id)}</b> ${esc(r.description)} — ${fmtNum(S.quoteTotal(rfq.quote, r.qty).qty)} ${esc(r.unit)} × ${esc(rfq.quote.currency)} ${fmtNum(rfq.quote.unitPrice)}</span></label>
      ${others.map((q) => { const rr = request(q.requestId); return `<label><input type="checkbox" name="more[]" value="${q.id}" ${q.selected ? 'checked' : ''}> <span><b>${esc(rr.id)}</b> ${esc(rr.description)} — ${fmtNum(S.quoteTotal(q.quote, rr.qty).qty)} ${esc(rr.unit)} × ${esc(q.quote.currency)} ${fmtNum(q.quote.unitPrice)} ${q.selected ? '<span class="badge good">selected</span>' : '<span class="badge">quoted, not selected</span>'}</span></label>`; }).join('')}</div>
      <div class="form-grid" style="margin-top:.7rem">
        ${field('PO number', 'number', 'text', S.nextNumber(db.purchaseOrders, st().poPrefix, 'number'), 'disabled')}${field('PO date', 'date', 'date', today())}
        ${selectField('Currency', 'currency', options(S.CURRENCIES, rfq.quote.currency || s.currency || base()))}${field('Payment terms', 'paymentTerms', 'text', s.paymentTerms || '')}
        ${field('Shipping / freight', 'shippingCost', 'number', rfq.quote.shippingCost || 0, 'step="any" min="0"')}${field('Other charges', 'otherCost', 'number', 0, 'step="any" min="0"')}${field('Discount', 'discount', 'number', 0, 'step="any" min="0"')}
        ${field('Deliver to', 'deliveryTo', 'text', `${st().company}, ${st().destination}`)}${textareaField('Notes to supplier', 'notes', '', 'rows="2"')}
      </div><div class="hint">All lines must be quoted in the PO currency; quotes in another currency are converted at the Setup rates.</div>`, (v) => {
      const rfqIds = [rfq.id, ...(v['more[]'] || [])];
      const lines = rfqIds.map((id) => { const q = db.rfqs.find((x) => x.id === id), rr = request(q.requestId); const line = S.poLineFromQuote(rr, q, s); if ((q.quote.currency || s.currency) !== v.currency) line.unitPrice = S.round2(S.convert(q.quote.unitPrice, q.quote.currency || s.currency, v.currency, rates())); q.selected = true; return line; });
      const p = S.buildPo({ number: S.nextNumber(db.purchaseOrders, st().poPrefix, 'number'), supplier: s, request_lines: lines, date: v.date, currency: v.currency, paymentTerms: v.paymentTerms, shippingCost: S.num(v.shippingCost), otherCost: S.num(v.otherCost), discount: S.num(v.discount), notes: v.notes, deliveryTo: v.deliveryTo });
      db.purchaseOrders.push(p); save(); go('po', { poId: p.id }); toast(`${p.number} created as draft`);
    }, { submitLabel: 'Create purchase order' });
  }

  // ------------------------------------------------------------------ suppliers
  function supplierForm(s = {}) {
    return `<div class="form-grid">
      ${field('Supplier ID', 'id', 'text', s.id || S.nextNumber(db.suppliers, 'SUP-', 'id', 3), 'disabled')}${field(req('Company name'), 'name', 'text', s.name || '', 'required')}
      ${field('Contact person', 'contact', 'text', s.contact || '')}${field('WhatsApp number', 'whatsapp', 'tel', s.whatsapp || '', 'placeholder="+86 …"')}
      ${field('WeChat ID', 'wechat', 'text', s.wechat || '')}${field('Email', 'email', 'email', s.email || '')}
      ${field('City', 'city', 'text', s.city || '', 'placeholder="Jinan"')}${field('Province', 'province', 'text', s.province || '', 'placeholder="Shandong"')}
      ${field('Product specialization', 'specialization', 'text', s.specialization || '', 'placeholder="HOWO engine & gearbox parts"', 'full')}
      ${field('Payment terms', 'paymentTerms', 'text', s.paymentTerms || '', 'placeholder="30% deposit, 70% before shipment"')}${selectField('Quotes in currency', 'currency', options(S.CURRENCIES, s.currency || 'USD'))}
      ${selectField('Supplier rating', 'rating', options([5, 4, 3, 2, 1].map((n) => ({ id: n, name: `${'★'.repeat(n)}${'☆'.repeat(5 - n)} (${n})` })), s.rating == null ? 3 : s.rating))}${selectField('Active', 'active', options([{ id: 'true', name: 'Yes' }, { id: 'false', name: 'No (hidden from RFQs)' }], String(s.active !== false)))}
      ${textareaField('Supplier remarks', 'remarks', s.remarks || '', 'rows="2"')}
    </div>`;
  }
  const supplierFromForm = (v, s = {}) => Object.assign(s, { name: v.name.trim(), contact: v.contact.trim(), whatsapp: v.whatsapp.trim(), wechat: v.wechat.trim(), email: v.email.trim(), city: v.city.trim(), province: v.province.trim(), specialization: v.specialization.trim(), paymentTerms: v.paymentTerms.trim(), currency: v.currency, rating: S.num(v.rating), active: v.active === 'true', remarks: v.remarks.trim() });
  function renderSuppliers() {
    const rows = db.suppliers.map((s) => ({ s, st: S.supplierStats(s.id, db.purchaseOrders, db.rfqs, { rates: rates(), baseCurrency: base() }) })).sort((a, b) => b.st.orders - a.st.orders || a.s.name.localeCompare(b.s.name));
    return `<div class="row between" style="margin-bottom:.75rem"><h1>Chinese Suppliers</h1><div class="btn-row"><button class="btn primary" data-action="supplier-new">+ New supplier</button><button class="btn" data-action="suppliers-export">Export Excel</button></div></div>
      <div class="card">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Supplier</th><th>Contact</th><th>Location</th><th>Specialization</th><th>Terms / currency</th><th>Rating</th><th class="num">Orders</th><th class="num">On-time</th><th class="num">Avg lead</th><th class="num">RFQ response</th><th class="num">Spend (${esc(base())})</th><th></th></tr></thead><tbody>
        ${rows.map(({ s, st: x }) => `<tr class="${s.active === false ? 'muted' : ''}"><td>${esc(s.id)}</td><td><a href="#" data-action="supplier-open" data-id="${s.id}"><b>${esc(s.name)}</b></a>${s.active === false ? ' <span class="badge">inactive</span>' : ''}</td><td>${esc(s.contact)}<div class="small muted">${esc(s.whatsapp)} ${s.wechat ? '· WeChat ' + esc(s.wechat) : ''}<br>${esc(s.email)}</div></td><td>${esc([s.city, s.province].filter(Boolean).join(', '))}</td><td class="small">${esc(s.specialization)}</td><td class="small">${esc(s.paymentTerms)}<br>${esc(s.currency)}</td><td>${stars(s.rating)}</td><td class="num">${x.orders}${x.open ? ` <span class="small muted">(${x.open} open)</span>` : ''}</td><td class="num">${x.onTimePct == null ? '–' : fmtNum(x.onTimePct, 0) + '%'}</td><td class="num">${x.avgLeadDays == null ? '–' : x.avgLeadDays + ' d'}</td><td class="num">${x.responseRatePct == null ? '–' : `${fmtNum(x.responseRatePct, 0)}% (${x.quoted}/${x.rfqs})`}</td><td class="num">${fmtNum(x.spendBase)}</td><td class="actions"><button class="btn sm" data-action="supplier-edit" data-id="${s.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No suppliers yet.</div>'}</div>`;
  }
  function renderSupplierDetail() {
    const s = supplier(state.supplierId); if (!s) return '<div class="empty">Supplier not found.</div>';
    const x = S.supplierStats(s.id, db.purchaseOrders, db.rfqs, { rates: rates(), baseCurrency: base() });
    const rfqs = db.rfqs.filter((q) => q.supplierId === s.id).sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
    const pos = db.purchaseOrders.filter((p) => p.supplierId === s.id).sort((a, b) => b.number.localeCompare(a.number));
    const kpi = (l, v) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`;
    return `<div class="row between" style="margin-bottom:.5rem"><div><a href="#" data-action="go" data-view="suppliers">← Suppliers</a><h1 style="margin-top:.3rem">${esc(s.name)} ${stars(s.rating)}</h1><div class="small muted">${esc(s.id)} · ${esc([s.city, s.province, 'China'].filter(Boolean).join(', '))} · ${esc(s.specialization)}</div></div>
      <div class="btn-row">${s.whatsapp ? `<a class="btn whatsapp" href="${S.whatsappUrl(s.whatsapp, `Hello ${s.contact || ''}, this is ${st().company} procurement (${st().country}).`)}" target="_blank" rel="noopener">WhatsApp ${esc(s.contact || '')}</a>` : ''}<button class="btn" data-action="supplier-edit" data-id="${s.id}">Edit</button><button class="btn danger ghost" data-action="supplier-delete" data-id="${s.id}">Delete</button></div></div>
      <div class="kpis" style="margin:.75rem 0">${kpi('Orders', x.orders)}${kpi('Delivered on time', x.onTimePct == null ? '–' : fmtNum(x.onTimePct, 0) + '%')}${kpi('Average lead time', x.avgLeadDays == null ? '–' : x.avgLeadDays + ' days')}${kpi('RFQ response rate', x.responseRatePct == null ? '–' : fmtNum(x.responseRatePct, 0) + '%')}${kpi('Quotes won', `${x.won} / ${x.quoted}`)}${kpi(`Total spend (${esc(base())})`, fmtNum(x.spendBase))}</div>
      <div class="detail-grid"><div class="card"><div class="card-head"><h2>Contact &amp; terms</h2></div><dl class="kv"><dt>Contact person</dt><dd>${esc(s.contact) || '–'}</dd><dt>WhatsApp</dt><dd>${esc(s.whatsapp) || '–'}</dd><dt>WeChat</dt><dd>${esc(s.wechat) || '–'}</dd><dt>Email</dt><dd>${esc(s.email) || '–'}</dd><dt>Payment terms</dt><dd>${esc(s.paymentTerms) || '–'}</dd><dt>Currency</dt><dd>${esc(s.currency)}</dd><dt>Remarks</dt><dd>${esc(s.remarks) || '–'}</dd></dl></div>
      <div class="card"><div class="card-head"><h2>Previous orders (${pos.length})</h2></div>${pos.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th>PO</th><th>Date</th><th>Status</th><th class="num">Items</th><th class="num">Total</th><th>ETA</th><th>Received</th></tr></thead><tbody>${pos.map((p) => `<tr><td><a href="#" data-action="po-open" data-id="${p.id}">${esc(p.number)}</a></td><td>${esc(p.date)}</td><td>${badge(p.status)}</td><td class="num">${p.lines.length}</td><td class="num">${esc(p.currency)} ${fmtNum(p.total)}</td><td>${esc(p.shipment.eta || '–')}</td><td>${esc(p.shipment.receivedAt || '–')} ${p.shipment.receivedAt && p.shipment.eta ? (p.shipment.receivedAt <= p.shipment.eta ? '<span class="badge good">on time</span>' : '<span class="badge bad">late</span>') : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No purchase orders yet.</p>'}</div></div>
      <div class="card" style="margin-top:1rem"><div class="card-head"><h2>Requests sent to this supplier (${rfqs.length})</h2></div>${rfqs.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th>Sent</th><th>Request</th><th>Part</th><th>Status</th><th>Quote</th><th>Lead</th></tr></thead><tbody>${rfqs.map((q) => { const r = request(q.requestId) || {}; return `<tr><td>${esc(q.sentAt)}</td><td><a href="#" data-action="request-open" data-id="${r.id}">${esc(r.id)}</a></td><td>${esc(r.description)} <span class="small muted">${esc(r.partNo || '')}</span></td><td>${badge(q.status)}${q.selected ? ' <span class="badge good">won</span>' : ''}</td><td>${q.quote ? `${esc(q.quote.currency)} ${fmtNum(q.quote.unitPrice)} · ${esc(q.quote.brand || '')}` : '–'}</td><td>${q.quote && q.quote.leadTimeDays != null ? q.quote.leadTimeDays + ' d' : '–'}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">Nothing sent yet.</p>'}</div>`;
  }

  // ------------------------------------------------------------------ RFQs & quotes
  function renderQuotes() {
    const f = state.quoteFilter;
    const list = db.rfqs.filter((q) => (!f.status || q.status === f.status) && (!f.supplierId || q.supplierId === f.supplierId)).sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || '') || b.requestId.localeCompare(a.requestId));
    const byReq = {}; list.forEach((q) => { (byReq[q.requestId] = byReq[q.requestId] || []).push(q); });
    const waiting = db.rfqs.filter((q) => q.status === 'SENT' && S.daysBetween(q.sentAt, today()) > 3);
    return `<div class="row between" style="margin-bottom:.75rem"><h1>RFQs &amp; Quotations</h1><button class="btn" data-action="quotes-export">Export Excel</button></div>
      ${waiting.length ? `<div class="banner warn">${waiting.length} RFQ(s) have waited more than 3 days without a quotation — follow up on WhatsApp.</div>` : ''}
      <div class="card"><div class="toolbar"><label>Status<select data-qfilter="status">${options(S.RFQ_STATUSES.map((s) => ({ id: s, name: label(s) })), f.status, { allLabel: 'All' })}</select></label><label>Supplier<select data-qfilter="supplierId">${options(db.suppliers, f.supplierId, { allLabel: 'All' })}</select></label><span class="muted small">${list.length} RFQ(s)</span></div>
      ${Object.keys(byReq).length ? Object.entries(byReq).map(([rid, qs]) => { const r = request(rid) || { id: rid, description: '?', qty: 0, unit: '' }; const cmp = S.compareQuotes(r, db.rfqs, db.suppliers, { rates: rates(), baseCurrency: base() }); return `<div class="card-head" style="margin-top:.6rem"><h3><a href="#" data-action="request-open" data-id="${rid}">${esc(r.id)}</a> — ${esc(r.description)} <span class="small muted">${esc(r.partNo || '')} · ${fmtNum(r.qty)} ${esc(r.unit)} · ${badge(r.status)} ${urgency(r.urgency)}</span></h3>${cmp.best ? `<span class="small">Best: <b>${esc(cmp.best.supplierName)}</b> ${fmtMoney(cmp.best.totalBase)}${cmp.rows.length > 1 ? ` · spread ${fmtMoney(cmp.spread)}` : ''}</span>` : ''}</div>
        <div class="table-wrap"><table class="compact"><thead><tr><th>Supplier</th><th>Sent</th><th>Channel</th><th>Status</th><th>Brand</th><th class="num">Unit price</th><th class="num">Total ${esc(base())}</th><th class="num">Lead</th><th>Valid</th><th></th></tr></thead><tbody>${qs.map((q) => { const s = supplier(q.supplierId) || {}, row = cmp.rows.find((x) => x.rfqId === q.id); return `<tr class="${row && row.best ? 'best' : ''}"><td>${esc(s.name || q.supplierId)}</td><td>${esc(q.sentAt)}</td><td>${esc(q.channel)}</td><td>${badge(q.status)}${q.selected ? ' <span class="badge good">selected</span>' : ''}</td><td>${esc((q.quote || {}).brand || '')}</td><td class="num">${q.quote ? `${esc(q.quote.currency)} ${fmtNum(q.quote.unitPrice)}` : '–'}</td><td class="num">${row ? fmtNum(row.totalBase) : '–'}</td><td class="num">${q.quote && q.quote.leadTimeDays != null ? q.quote.leadTimeDays + ' d' : '–'}</td><td>${esc((q.quote || {}).validUntil || '')}${q.quote && q.quote.validUntil && q.quote.validUntil < today() ? ' <span class="badge bad">expired</span>' : ''}</td><td class="actions"><button class="btn sm whatsapp" data-action="request-share" data-id="${rid}" data-supplier="${q.supplierId}">WhatsApp</button> <button class="btn sm primary" data-action="quote-record" data-id="${q.id}">${q.quote ? 'Edit' : 'Record quote'}</button>${q.status === 'SENT' ? ` <button class="btn sm" data-action="rfq-status" data-id="${q.id}" data-status="NO_RESPONSE">No response</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`; }).join('') : '<div class="empty">No RFQs match. Send requests to suppliers from a request page.</div>'}</div>`;
  }

  // ------------------------------------------------------------------ purchase orders
  function renderOrders() {
    const f = state.orderFilter;
    const list = db.purchaseOrders.filter((p) => (!f.status || p.status === f.status) && (!f.supplierId || p.supplierId === f.supplierId)).sort((a, b) => b.number.localeCompare(a.number));
    const ready = db.rfqs.filter((q) => q.selected && q.status === 'QUOTED' && !posOf(q.requestId).length && openRequest(request(q.requestId) || { status: 'CANCELLED' }));
    return `<div class="row between" style="margin-bottom:.75rem"><h1>Purchase Orders</h1><div class="btn-row">${ready.length ? `<button class="btn primary" data-action="po-from-quote" data-id="${ready[0].id}">+ New PO from selected quotes (${ready.length})</button>` : '<span class="small muted">Select a winning quotation on a request to create a PO.</span>'}<button class="btn" data-action="orders-export">Export Excel</button></div></div>
      <div class="card"><div class="toolbar"><label>Status<select data-ofilter="status">${options(S.PO_STATUSES.map((s) => ({ id: s, name: label(s) })), f.status, { allLabel: 'All' })}</select></label><label>Supplier<select data-ofilter="supplierId">${options(db.suppliers, f.supplierId, { allLabel: 'All' })}</select></label><span class="muted small">${list.length} PO(s)</span></div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>PO</th><th>Date</th><th>Supplier</th><th>Status</th><th class="num">Items</th><th>Parts</th><th class="num">Total</th><th class="num">${esc(base())}</th><th>Shipping</th><th>ETA</th><th>Received</th></tr></thead><tbody>${list.map((p) => `<tr><td><a href="#" data-action="po-open" data-id="${p.id}"><b>${esc(p.number)}</b></a></td><td>${esc(p.date)}</td><td>${esc(p.supplierName)}</td><td>${badge(p.status)}</td><td class="num">${p.lines.length}</td><td class="small">${p.lines.slice(0, 3).map((l) => esc(l.description)).join(', ')}${p.lines.length > 3 ? '…' : ''}</td><td class="num">${esc(p.currency)} ${fmtNum(p.total)}</td><td class="num">${fmtNum(toBase(p.total, p.currency))}</td><td class="small">${esc(label(p.shipment.method || ''))} ${esc(p.shipment.trackingNo || '')}</td><td>${esc(p.shipment.eta || '–')}</td><td>${esc(p.shipment.receivedAt || '–')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No purchase orders yet.</div>'}</div>`;
  }
  const NEXT_PO = { DRAFT: ['SENT'], SENT: ['CONFIRMED'], CONFIRMED: ['PAID', 'SHIPPED'], PAID: ['SHIPPED'], SHIPPED: ['ARRIVED', 'RECEIVED'], ARRIVED: ['RECEIVED'], RECEIVED: ['CLOSED'], CLOSED: [], CANCELLED: [] };
  function renderPoDetail() {
    const p = po(state.poId); if (!p) return '<div class="empty">Purchase order not found.</div>';
    const s = supplier(p.supplierId) || { name: p.supplierName }, sh = p.shipment, lead = S.poLeadTimeDays(p);
    const steps = ['DRAFT', 'SENT', 'CONFIRMED', 'PAID', 'SHIPPED', 'ARRIVED', 'RECEIVED', 'CLOSED'], idx = steps.indexOf(p.status);
    const ship = (lbl, name, type, value, attrs = '') => `<label>${lbl}<input type="${type}" name="${name}" value="${esc(value == null ? '' : value)}" data-ship="${name}" ${attrs}></label>`;
    const d = daysTo(sh.eta);
    return `<div class="row between no-print" style="margin-bottom:.5rem"><div><a href="#" data-action="go" data-view="orders">← Purchase orders</a><h1 style="margin-top:.3rem">${esc(p.number)} ${badge(p.status)}</h1></div>
      <div class="btn-row"><button class="btn primary" data-action="po-pdf" data-id="${p.id}">⬇ PO PDF</button><button class="btn whatsapp" data-action="po-share" data-id="${p.id}">Send to supplier (WhatsApp)</button><button class="btn" data-action="po-export" data-id="${p.id}">Excel</button><button class="btn" onclick="window.print()">Print</button>
        ${NEXT_PO[p.status].map((n) => `<button class="btn green" data-action="po-status" data-id="${p.id}" data-status="${n}">Mark ${esc(label(n))}</button>`).join('')}${['CLOSED', 'CANCELLED', 'RECEIVED'].includes(p.status) ? '' : `<button class="btn danger ghost" data-action="po-status" data-id="${p.id}" data-status="CANCELLED">Cancel PO</button>`}</div></div>
      ${p.status !== 'CANCELLED' ? `<div class="progress no-print">${steps.map((x, i) => `<span class="step ${i < idx ? 'done' : i === idx ? 'current' : ''}">${esc(label(x))}</span>`).join('')}</div>` : ''}
      <div class="doc po"><div class="doc-head"><div><div class="doc-title">${esc(st().company)}</div><div class="small">${esc(st().companyAddress)}</div><div class="small">${esc([st().procurementContact, st().procurementPhone, st().procurementEmail].filter(Boolean).join(' · '))}</div></div><div><div class="doc-title">PURCHASE ORDER</div><dl class="doc-meta"><dt>PO No.</dt><dd>${esc(p.number)}</dd><dt>Date</dt><dd>${esc(p.date)}</dd><dt>Currency</dt><dd>${esc(p.currency)}</dd><dt>Status</dt><dd>${esc(label(p.status))}</dd></dl></div></div>
        <div class="doc-parties"><div class="party"><div class="who">Supplier</div>${esc(s.name)}<br>${esc(s.contact || '')}<br>${esc([s.city, s.province, 'China'].filter(Boolean).join(', '))}<br>${esc(s.whatsapp || '')} ${esc(s.email || '')}</div><div class="party"><div class="who">Deliver to</div>${esc(p.deliveryTo || st().destination)}<br>Payment terms: ${esc(p.paymentTerms || '–')}<br>${lead != null ? `Expected lead time: ${lead} days` : ''}</div></div>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Request</th><th>Part No</th><th>Description</th><th>Brand</th><th>Truck</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th><th class="no-print"></th></tr></thead><tbody>
          ${p.lines.map((l, i) => `<tr><td>${i + 1}</td><td><a href="#" data-action="request-open" data-id="${l.requestId}">${esc(l.requestId)}</a></td><td>${esc(l.partNo)}</td><td>${esc(l.description)}${l.warranty ? `<div class="small muted">Warranty ${esc(l.warranty)}</div>` : ''}</td><td>${esc(l.brand)}</td><td class="small">${esc(l.truckReg)}</td><td class="num">${p.status === 'DRAFT' ? `<input type="number" step="any" min="0" value="${l.qty}" data-po-line="${l.id}" data-field="qty">` : fmtNum(l.qty)} ${esc(l.unit)}</td><td class="num">${p.status === 'DRAFT' ? `<input type="number" step="any" min="0" value="${l.unitPrice}" data-po-line="${l.id}" data-field="unitPrice">` : fmtNum(l.unitPrice)}</td><td class="num">${fmtNum(l.amount)}</td><td class="no-print actions">${p.status === 'DRAFT' && p.lines.length > 1 ? `<button class="btn sm ghost danger" data-action="po-line-delete" data-id="${l.id}">✕</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="doc-totals"><div><h3>Notes</h3><div class="small">${esc(p.notes || '–')}</div>${p.status === 'DRAFT' ? `<div class="no-print" style="margin-top:.5rem"><div class="form-grid">${field('Shipping / freight', 'shippingCost', 'number', p.shippingCost, 'step="any" data-po-field="shippingCost"')}${field('Other charges', 'otherCost', 'number', p.otherCost, 'step="any" data-po-field="otherCost"')}${field('Discount', 'discount', 'number', p.discount, 'step="any" data-po-field="discount"')}${field('Payment terms', 'paymentTerms', 'text', p.paymentTerms, 'data-po-field="paymentTerms"')}${textareaField('Notes to supplier', 'notes', p.notes, 'rows="2" data-po-field="notes"')}</div></div>` : ''}</div>
          <table class="totals-table"><tr><td>Subtotal</td><td class="num">${esc(p.currency)} ${fmtNum(p.subtotal)}</td></tr>${S.num(p.shippingCost) ? `<tr><td>Shipping / freight</td><td class="num">${fmtNum(p.shippingCost)}</td></tr>` : ''}${S.num(p.otherCost) ? `<tr><td>Other charges</td><td class="num">${fmtNum(p.otherCost)}</td></tr>` : ''}${S.num(p.discount) ? `<tr><td>Discount</td><td class="num">−${fmtNum(p.discount)}</td></tr>` : ''}<tr class="grand"><td>TOTAL</td><td class="num">${esc(p.currency)} ${fmtNum(p.total)}</td></tr><tr><td class="muted small">≈ ${esc(base())}</td><td class="num muted small">${fmtNum(toBase(p.total, p.currency))}</td></tr>${st().localCurrency && rates()[st().localCurrency] ? `<tr><td class="muted small">≈ ${esc(st().localCurrency)}</td><td class="num muted small">${fmtNum(S.convert(p.total, p.currency, st().localCurrency, rates()), 0)}</td></tr>` : ''}</table></div>
        <div class="signatures"><div>Prepared by (Procurement)</div><div>Approved by (Management)</div><div>Supplier confirmation</div></div>
      </div>
      <div class="detail-grid no-print" style="margin-top:1rem">
        <div class="card"><div class="card-head"><h2>Shipping &amp; delivery</h2>${d != null && !sh.receivedAt ? `<span class="badge ${d < 0 ? 'bad' : d <= 3 ? 'warn' : ''}">${d < 0 ? `${-d} day(s) overdue` : `ETA in ${d} day(s)`}</span>` : ''}</div>
          <div class="form-grid" id="ship-form">
            <label>Method<select name="method" data-ship="method">${options(['', ...S.SHIP_METHODS].map((m) => ({ id: m, name: m ? label(m) : '—' })), sh.method || '')}</select></label>${ship('Forwarder / carrier', 'forwarder', 'text', sh.forwarder)}
            ${ship('Tracking / AWB / BL number', 'trackingNo', 'text', sh.trackingNo)}${ship('Origin port / airport', 'originPort', 'text', sh.originPort, 'placeholder="Qingdao / Guangzhou"')}${ship('Destination port / airport', 'destinationPort', 'text', sh.destinationPort || '', 'placeholder="Lagos (LOS) / Apapa"')}
            ${ship('ETD (departure)', 'etd', 'date', sh.etd)}${ship('ETA (arrival)', 'eta', 'date', sh.eta)}${ship('Shipped on', 'shippedAt', 'date', sh.shippedAt)}${ship('Arrived on', 'arrivedAt', 'date', sh.arrivedAt)}
            <label>Customs clearance<select name="customsStatus" data-ship="customsStatus">${options(S.CUSTOMS_STATUSES.map((c) => ({ id: c, name: label(c) })), sh.customsStatus || 'NOT_STARTED')}</select></label>
            ${ship('Received at workshop on', 'receivedAt', 'date', sh.receivedAt)}${ship('Received by', 'receivedBy', 'text', sh.receivedBy)}
            <label>Quantity / condition OK?<select name="receivedQtyOk" data-ship="receivedQtyOk">${options([{ id: 'true', name: 'Yes — complete and correct' }, { id: 'false', name: 'No — shortage / damage (see remarks)' }], String(sh.receivedQtyOk !== false))}</select></label>
            <label class="full">Shipping remarks<textarea name="remarks" rows="2" data-ship="remarks">${esc(sh.remarks || '')}</textarea></label>
          </div><div class="hint">Changes save automatically. Setting <b>Shipped on</b> / <b>Arrived on</b> / <b>Received on</b> also moves the PO status.</div></div>
        <div class="card"><div class="card-head"><h2>History</h2></div><ul class="timeline">${p.history.slice().reverse().map((h) => `<li><b>${esc(label(h.status))}</b> ${esc(h.note || '')}<div class="when">${esc(String(h.at).replace('T', ' ').slice(0, 16))}</div></li>`).join('')}</ul></div>
      </div>`;
  }
  function poSheets(p) {
    return [{ name: 'PO', rows: [['PO number', p.number], ['Date', p.date], ['Supplier', p.supplierName], ['Status', p.status], ['Currency', p.currency], ['Payment terms', p.paymentTerms], ['Deliver to', p.deliveryTo], ['Notes', p.notes], [], ['#', 'Request', 'Part No', 'Description', 'Brand', 'Truck', 'Qty', 'Unit', 'Unit price', 'Amount', 'Lead days', 'Warranty'], ...p.lines.map((l, i) => [i + 1, l.requestId, l.partNo, l.description, l.brand, l.truckReg, l.qty, l.unit, l.unitPrice, l.amount, l.leadTimeDays, l.warranty]), [], ['Subtotal', p.subtotal], ['Shipping', p.shippingCost], ['Other', p.otherCost], ['Discount', p.discount], ['Total', p.total]] },
      { name: 'Shipping', rows: [['Field', 'Value'], ...Object.entries(p.shipment).map(([k, v]) => [label(k), v])] }];
  }
  function setPoStatus(p, status, note = '') {
    p.status = status; p.history.push({ at: new Date().toISOString(), status, note });
    if (status === 'SHIPPED' && !p.shipment.shippedAt) p.shipment.shippedAt = today();
    if (status === 'ARRIVED' && !p.shipment.arrivedAt) p.shipment.arrivedAt = today();
    if (status === 'RECEIVED' && !p.shipment.receivedAt) p.shipment.receivedAt = today();
    if (status === 'CANCELLED') db.rfqs.forEach((q) => { if (p.lines.some((l) => l.rfqId === q.id)) q.selected = false; });
    save();
  }

  // ------------------------------------------------------------------ shipping
  function renderShipping() {
    const active = db.purchaseOrders.filter((p) => ['SENT', 'CONFIRMED', 'PAID', 'SHIPPED', 'ARRIVED'].includes(p.status)).sort((a, b) => (a.shipment.eta || '9999').localeCompare(b.shipment.eta || '9999'));
    const kpi = (l, v, c = '') => `<div class="kpi"><div class="label">${l}</div><div class="value ${c}">${v}</div></div>`;
    const overdue = active.filter((p) => p.shipment.eta && p.shipment.eta < today() && !p.shipment.receivedAt);
    return `<div class="row between" style="margin-bottom:.75rem"><h1>Shipping &amp; Deliveries</h1><button class="btn" data-action="shipping-export">Export Excel</button></div>
      <div class="kpis" style="margin-bottom:1rem">${kpi('Awaiting shipment', active.filter((p) => ['SENT', 'CONFIRMED', 'PAID'].length && ['SENT', 'CONFIRMED', 'PAID'].includes(p.status)).length)}${kpi('In transit', active.filter((p) => p.status === 'SHIPPED').length)}${kpi('Arrived / in customs', active.filter((p) => p.status === 'ARRIVED').length)}${kpi('Overdue vs ETA', overdue.length, overdue.length ? 'err' : '')}${kpi('Received this month', db.purchaseOrders.filter((p) => S.periodOf(p.shipment.receivedAt) === today().slice(0, 7)).length)}</div>
      <div class="card">${active.length ? `<div class="table-wrap"><table><thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Parts</th><th>Method</th><th>Forwarder</th><th>Tracking</th><th>ETD</th><th>ETA</th><th>Days</th><th>Customs</th><th></th></tr></thead><tbody>${active.map((p) => { const d = daysTo(p.shipment.eta); return `<tr><td><a href="#" data-action="po-open" data-id="${p.id}"><b>${esc(p.number)}</b></a></td><td>${esc(p.supplierName)}</td><td>${badge(p.status)}</td><td class="small">${p.lines.map((l) => `${esc(l.description)} (${esc(l.truckReg)})`).join('<br>')}</td><td>${esc(label(p.shipment.method || '–'))}</td><td>${esc(p.shipment.forwarder || '–')}</td><td>${esc(p.shipment.trackingNo || '–')}</td><td>${esc(p.shipment.etd || '–')}</td><td>${esc(p.shipment.eta || '–')}</td><td class="${d != null && d < 0 ? 'err' : ''}">${d == null ? '–' : d < 0 ? `${-d} overdue` : d}</td><td>${badge(p.shipment.customsStatus || 'NOT_STARTED')}</td><td class="actions">${NEXT_PO[p.status].map((n) => `<button class="btn sm" data-action="po-status" data-id="${p.id}" data-status="${n}">${esc(label(n))}</button>`).join(' ')}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No open shipments.</div>'}</div>`;
  }

  // ------------------------------------------------------------------ history
  function renderHistory() {
    const h = state.history;
    const lines = S.historyLines(db.purchaseOrders, h);
    const ps = h.partNo ? S.priceStats(h.partNo, db.purchaseOrders, { rates: rates(), baseCurrency: base() }) : null;
    const parts = {}; db.purchaseOrders.filter((p) => p.status !== 'CANCELLED').forEach((p) => p.lines.forEach((l) => { const k = S.normalizePartNo(l.partNo) || l.description; parts[k] = parts[k] || { partNo: l.partNo, description: l.description, n: 0, qty: 0 }; parts[k].n++; parts[k].qty += S.num(l.qty); }));
    const top = Object.values(parts).sort((a, b) => b.n - a.n).slice(0, 8);
    return `<div class="row between" style="margin-bottom:.75rem"><h1>Procurement History</h1><button class="btn" data-action="history-export">Export Excel</button></div>
      <div class="card"><div class="toolbar"><label>Part number<input type="search" value="${esc(h.partNo)}" data-hfilter="partNo" placeholder="WG…" list="dl-parts"></label>${datalist('dl-parts', db.purchaseOrders.flatMap((p) => p.lines.map((l) => l.partNo)))}<label>Truck<select data-hfilter="truckReg">${options([...new Set(db.purchaseOrders.flatMap((p) => p.lines.map((l) => l.truckReg)))].filter(Boolean).sort(), h.truckReg, { allLabel: 'All' })}</select></label><label>Supplier<select data-hfilter="supplierId">${options(db.suppliers, h.supplierId, { allLabel: 'All' })}</select></label><span class="muted small">${lines.length} line(s)</span></div>
      ${ps && ps.count ? `<div class="kpis" style="margin-bottom:1rem"><div class="kpi"><div class="label">Times bought</div><div class="value">${ps.count}</div></div><div class="kpi"><div class="label">Last price (${esc(base())})</div><div class="value">${fmtNum(ps.last)}</div><div class="delta">${esc(ps.lastSupplier)} · ${esc(ps.lastDate)}</div></div><div class="kpi"><div class="label">Lowest</div><div class="value">${fmtNum(ps.min)}</div></div><div class="kpi"><div class="label">Highest</div><div class="value">${fmtNum(ps.max)}</div></div><div class="kpi"><div class="label">Average</div><div class="value">${fmtNum(ps.avg)}</div></div></div>` : ''}
      ${lines.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>PO</th><th>Request</th><th>Part No</th><th>Description</th><th>Brand</th><th>Truck</th><th>Supplier</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Unit ${esc(base())}</th><th>Status</th><th>Received</th></tr></thead><tbody>${lines.map((l) => `<tr><td>${esc(l.date)}</td><td><a href="#" data-action="po-open" data-id="${l.poId}">${esc(l.poNumber)}</a></td><td><a href="#" data-action="request-open" data-id="${l.requestId}">${esc(l.requestId)}</a></td><td>${esc(l.partNo)}</td><td>${esc(l.description)}</td><td>${esc(l.brand)}</td><td>${esc(l.truckReg)}</td><td>${esc(l.supplierName)}</td><td class="num">${fmtNum(l.qty)} ${esc(l.unit)}</td><td class="num">${esc(l.currency)} ${fmtNum(l.unitPrice)}</td><td class="num">${fmtNum(toBase(l.unitPrice, l.currency))}</td><td>${badge(l.poStatus)}</td><td>${esc(l.receivedAt || '–')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No purchases match.</div>'}</div>
      <div class="card" style="margin-top:1rem"><div class="card-head"><h2>Most ordered parts</h2></div>${top.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th>Part No</th><th>Description</th><th class="num">Orders</th><th class="num">Total qty</th><th></th></tr></thead><tbody>${top.map((t) => `<tr><td>${esc(t.partNo)}</td><td>${esc(t.description)}</td><td class="num">${t.n}</td><td class="num">${fmtNum(t.qty)}</td><td class="actions"><button class="btn sm" data-action="history-part" data-id="${esc(t.partNo)}">Price history</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No purchases yet.</p>'}</div>`;
  }

  // ------------------------------------------------------------------ setup
  function renderSetup() {
    const s = st(); const list = (a) => (a || []).join(', ');
    return `<h1 style="margin-bottom:.75rem">Setup</h1>
      <div class="card"><div class="card-head"><h2>Company &amp; procurement contact</h2><button class="btn primary" data-action="settings-save">Save settings</button></div>
        <form id="settings-form" class="form-grid" onsubmit="return false">
          ${field('Company name', 'company', 'text', s.company)}${field('Address', 'companyAddress', 'text', s.companyAddress)}${field('Country', 'country', 'text', s.country)}${field('Delivery destination (shown on RFQ PDF)', 'destination', 'text', s.destination)}
          ${field('Procurement contact name', 'procurementContact', 'text', s.procurementContact)}${field('Procurement phone', 'procurementPhone', 'tel', s.procurementPhone)}${field('Procurement email', 'procurementEmail', 'email', s.procurementEmail)}${field('Procurement WhatsApp', 'procurementWhatsApp', 'tel', s.procurementWhatsApp)}
          ${field('Request ID prefix', 'requestPrefix', 'text', s.requestPrefix)}${field('PO number prefix', 'poPrefix', 'text', s.poPrefix)}
          ${selectField('Comparison base currency', 'baseCurrency', options(S.CURRENCIES, s.baseCurrency))}${selectField('Local currency', 'localCurrency', options(S.CURRENCIES, s.localCurrency))}
          ${field(`1 USD in ${esc(s.baseCurrency)}`, 'rate_USD', 'number', s.rates.USD, 'step="any"')}${field(`1 RMB (CNY) in ${esc(s.baseCurrency)}`, 'rate_RMB', 'number', s.rates.RMB, 'step="any"')}${field(`1 NGN in ${esc(s.baseCurrency)}`, 'rate_NGN', 'number', s.rates.NGN, 'step="any"')}${field(`1 EUR in ${esc(s.baseCurrency)}`, 'rate_EUR', 'number', s.rates.EUR, 'step="any"')}
          ${textareaField('Note printed on the RFQ PDF', 'pdfNote', s.pdfNote, 'rows="2"')}
          ${field('Part categories (comma separated)', 'categories', 'text', list(s.categories), '', 'full')}${field('Units of measurement', 'units', 'text', list(s.units))}${field('Truck makes', 'truckMakes', 'text', list(s.truckMakes))}${field('Departments / workshops', 'departments', 'text', list(s.departments))}${field('Requesters (names offered in the form)', 'requesters', 'text', list(s.requesters))}
        </form></div>
      <div class="card"><div class="card-head"><h2>Trucks (${db.trucks.length})</h2><button class="btn sm primary" data-action="truck-new">+ Truck</button></div>
        <div class="table-wrap"><table class="compact"><thead><tr><th>Registration</th><th>Make</th><th>Model</th><th>Chassis / VIN</th><th>Engine</th><th>Department</th><th class="num">Requests</th><th></th></tr></thead><tbody>${db.trucks.map((t) => `<tr><td><b>${esc(t.regNo)}</b></td><td>${esc(t.make)}</td><td>${esc(t.model)}</td><td>${esc(t.chassis)}</td><td>${esc(t.engineModel)}</td><td>${esc(t.department)}</td><td class="num">${db.requests.filter((r) => S.normalizeReg(r.truckReg) === S.normalizeReg(t.regNo)).length}</td><td class="actions"><button class="btn sm" data-action="truck-edit" data-id="${t.id}">Edit</button> <button class="btn sm ghost danger" data-action="truck-delete" data-id="${t.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Trucks are added automatically when a request is saved.</td></tr>'}</tbody></table></div></div>`;
  }
  const truckForm = (t = {}) => `<div class="form-grid">${field(req('Registration'), 'regNo', 'text', t.regNo || '', 'required style="text-transform:uppercase"')}${selectField('Make', 'make', options(st().truckMakes, t.make || 'SINOTRUK'))}${field('Model', 'model', 'text', t.model || '')}${field('Chassis / VIN', 'chassis', 'text', t.chassis || '')}${field('Engine model', 'engineModel', 'text', t.engineModel || '')}${field('Department', 'department', 'text', t.department || '', 'list="dl-departments"')}${datalist('dl-departments', st().departments)}</div>`;

  // ------------------------------------------------------------------ data
  function renderData() {
    return `<h1 style="margin-bottom:.75rem">Data</h1>
      <div class="grid two">
        <div class="card"><h2>Backup &amp; restore</h2><p class="small muted">All data (including photographs) lives in this browser. Export a backup regularly and to move the data to another phone or computer.</p>
          <div class="btn-row"><button class="btn primary" data-action="data-export">Export backup (JSON)</button><label class="btn">Import backup… <input type="file" accept="application/json,.json" data-action="data-import" hidden></label></div>
          <p class="small muted" style="margin-top:.6rem">${db.requests.length} requests · ${db.suppliers.length} suppliers · ${db.rfqs.length} RFQs · ${db.purchaseOrders.length} purchase orders · ${db.trucks.length} trucks</p></div>
        <div class="card"><h2>Excel</h2><p class="small muted">Export everything to one workbook, or bulk-import existing requests from Excel / CSV (download the template for the column layout; extra columns are ignored, header names are matched flexibly).</p>
          <div class="btn-row"><button class="btn" data-action="data-export-all">Export all to Excel</button><label class="btn">Import requests from Excel/CSV… <input type="file" accept=".xlsx,.xls,.csv,text/csv" data-action="requests-import" hidden></label><button class="btn ghost" data-action="requests-template">Download import template</button></div></div>
        <div class="card"><h2>Demo data</h2><p class="small muted">Replace everything with the sample dataset (fictitious suppliers, placeholder photos).</p><button class="btn danger" data-action="data-reset">Reset to demo data</button></div>
      </div>`;
  }
  async function importRequestsFile(file) {
    let rows;
    if (/\.csv$/i.test(file.name) || file.type === 'text/csv') rows = S.parseCsv(await file.text());
    else { if (!window.XLSX) return toast('Excel reader not loaded (offline?) — save the sheet as CSV and import that'); const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false }); rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }); }
    const res = S.importRequests(rows, { existing: db.requests, prefix: st().requestPrefix, today: today(), allowDuplicates: true });
    const problems = res.errors.length + res.skipped.length;
    modal(`Import ${res.requests.length} request(s) from ${file.name}`, `
      ${!res.requests.length && res.errors.length ? `<div class="banner bad">${esc(res.errors[0].message)}</div>` : ''}
      <div class="banner ${res.requests.length ? 'good' : 'warn'}"><b>${res.requests.length}</b> request(s) ready to import · <b>${res.skipped.length}</b> skipped (ID already exists) · <b>${res.errors.length}</b> row(s) with errors · <b>${res.requests.filter((r) => r.duplicateOf && r.duplicateOf.length).length}</b> flagged as duplicates (same part on the same truck)</div>
      <div class="small muted">Columns recognised: ${Object.keys(res.headerMap).map(label).join(', ') || 'none'}</div>
      ${problems ? `<details class="small" style="margin:.5rem 0"><summary>${problems} row(s) not imported</summary><ul>${res.errors.concat(res.skipped).map((e) => `<li>Row ${e.row}${e.id ? ` (${esc(e.id)})` : ''}: ${esc(e.message)}</li>`).join('')}</ul></details>` : ''}
      <div class="table-wrap import-preview"><table class="compact"><thead><tr><th>ID</th><th>Date</th><th>Truck</th><th>Part</th><th>Part No</th><th>Qty</th><th>Urgency</th><th>Status</th><th>Flags</th></tr></thead><tbody>${res.requests.slice(0, 200).map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.date)}</td><td>${esc(r.truckReg)} ${esc(r.truckMake)}</td><td>${esc(r.description)}</td><td>${esc(r.partNo)}</td><td>${fmtNum(r.qty)} ${esc(r.unit)}</td><td>${esc(r.urgency)}</td><td>${esc(r.status)}</td><td>${r.duplicateOf && r.duplicateOf.length ? `<span class="badge warn">dup of ${esc(r.duplicateOf.join(', '))}</span>` : ''}${r.matchingPartNo && r.matchingPartNo.length && !(r.duplicateOf || []).length ? '<span class="badge">part no. seen</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
      <label class="check" style="margin-top:.5rem"><input type="checkbox" name="skipDup"> Skip the rows flagged as duplicates</label>
      <div class="hint">Imported requests have no photographs; open each one and use Edit to add them before sending to suppliers.</div>`, (v) => {
      const toAdd = res.requests.filter((r) => !(v.skipDup && r.duplicateOf && r.duplicateOf.length));
      if (!toAdd.length) { toast('Nothing to import'); return; }
      toAdd.forEach((r) => { db.requests.push(r); if (!db.trucks.some((t) => S.normalizeReg(t.regNo) === S.normalizeReg(r.truckReg))) db.trucks.push({ id: window.Store.uid('TRK'), regNo: r.truckReg, make: r.truckMake, model: r.truckModel, chassis: r.chassis, engineModel: r.engineModel, department: r.department }); });
      save(); go('requests'); toast(`${toAdd.length} request(s) imported`);
    }, { submitLabel: 'Import', wide: true });
  }
  const rfqRows = () => [['RFQ', 'Request', 'Part', 'Part No', 'Qty', 'Unit', 'Supplier', 'Channel', 'Sent', 'Status', 'Selected', 'Received', 'Brand', 'Currency', 'Unit price', 'MOQ', 'Lead days', 'Availability', 'Warranty', 'Valid until', 'Shipping', `Total ${base()}`, 'Remarks'], ...db.rfqs.map((q) => { const r = request(q.requestId) || {}, qu = q.quote || {}; return [q.id, q.requestId, r.description, r.partNo, r.qty, r.unit, supplierName(q.supplierId), q.channel, q.sentAt, q.status, q.selected ? 'yes' : '', qu.receivedAt, qu.brand, qu.currency, qu.unitPrice, qu.moq, qu.leadTimeDays, qu.availability, qu.warranty, qu.validUntil, qu.shippingCost, q.quote ? S.round2(toBase(S.quoteTotal(qu, r.qty).total, qu.currency)) : '', qu.remarks]; })];
  const poRows = () => [['PO', 'Date', 'Supplier', 'Status', 'Currency', 'Items', 'Subtotal', 'Shipping', 'Other', 'Discount', 'Total', `Total ${base()}`, 'Payment terms', 'Method', 'Forwarder', 'Tracking', 'ETD', 'ETA', 'Shipped', 'Arrived', 'Customs', 'Received', 'Received by', 'Notes'], ...db.purchaseOrders.map((p) => [p.number, p.date, p.supplierName, p.status, p.currency, p.lines.length, p.subtotal, p.shippingCost, p.otherCost, p.discount, p.total, S.round2(toBase(p.total, p.currency)), p.paymentTerms, p.shipment.method, p.shipment.forwarder, p.shipment.trackingNo, p.shipment.etd, p.shipment.eta, p.shipment.shippedAt, p.shipment.arrivedAt, p.shipment.customsStatus, p.shipment.receivedAt, p.shipment.receivedBy, p.notes])];
  const poLineRows = () => [['PO', 'Date', 'Supplier', 'PO status', 'Request', 'Part No', 'Description', 'Brand', 'Truck', 'Qty', 'Unit', 'Currency', 'Unit price', 'Amount', `Unit price ${base()}`, 'Received'], ...S.historyLines(db.purchaseOrders).map((l) => [l.poNumber, l.date, l.supplierName, l.poStatus, l.requestId, l.partNo, l.description, l.brand, l.truckReg, l.qty, l.unit, l.currency, l.unitPrice, l.amount, S.round2(toBase(l.unitPrice, l.currency)), l.receivedAt])];
  const supplierRows = () => [['ID', 'Company', 'Contact', 'WhatsApp', 'WeChat', 'Email', 'City', 'Province', 'Specialization', 'Payment terms', 'Currency', 'Rating', 'Active', 'Orders', 'On-time %', 'Avg lead days', 'RFQs', 'Quoted', 'Won', `Spend ${base()}`, 'Remarks'], ...db.suppliers.map((s) => { const x = S.supplierStats(s.id, db.purchaseOrders, db.rfqs, { rates: rates(), baseCurrency: base() }); return [s.id, s.name, s.contact, s.whatsapp, s.wechat, s.email, s.city, s.province, s.specialization, s.paymentTerms, s.currency, s.rating, s.active === false ? 'no' : 'yes', x.orders, x.onTimePct, x.avgLeadDays, x.rfqs, x.quoted, x.won, x.spendBase, s.remarks]; })];

  // ------------------------------------------------------------------ events
  $('#view').addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.filter) { state.requestFilter[el.dataset.filter] = el.value; if (el.type === 'search') { clearTimeout(state._t); state._t = setTimeout(() => { render(); const i = $('#view [data-filter="q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } return; }
    if (el.dataset.hfilter === 'partNo') { state.history.partNo = el.value; clearTimeout(state._t); state._t = setTimeout(() => { render(); const i = $('#view [data-hfilter="partNo"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); }
    if (el.closest('#req-form') && (el.name === 'partNo' || el.name === 'truckReg' || el.name === 'description')) { syncForm(); clearTimeout(state._d); state._d = setTimeout(() => { const f = state.form; const dup = S.findDuplicates(f.values, db.requests, { excludeId: f.editingId }); const had = $('#req-form .banner.bad, #req-form .banner.warn'); if ((dup.exact.length || dup.matchingPartNo.length || dup.similar.length) !== !!had) { const active = document.activeElement && document.activeElement.name; render(); const back = active && $(`#req-form [name="${active}"]`); if (back) { back.focus(); back.setSelectionRange(back.value.length, back.value.length); } } }, 500); }
  });
  $('#view').addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.filter && el.type !== 'search') { state.requestFilter[el.dataset.filter] = el.value; render(); return; }
    if (el.dataset.qfilter) { state.quoteFilter[el.dataset.qfilter] = el.value; render(); return; }
    if (el.dataset.ofilter) { state.orderFilter[el.dataset.ofilter] = el.value; render(); return; }
    if (el.dataset.hfilter && el.dataset.hfilter !== 'partNo') { state.history[el.dataset.hfilter] = el.value; render(); return; }
    if (el.dataset.photoSlot != null) {
      const file = el.files[0]; if (!file) return;
      syncForm(); toast('Processing photo…');
      try { state.form.photos[+el.dataset.photoSlot] = await window.Photos.fromFile(file); } catch (err) { toast(`Could not read the photo: ${err.message}`); }
      render(); return;
    }
    if (el.matches('[data-action="requests-import"]')) { const f = el.files[0]; if (f) importRequestsFile(f).catch((err) => toast(`Import failed: ${err.message}`)); el.value = ''; return; }
    if (el.matches('[data-action="data-import"]')) {
      const f = el.files[0]; if (!f) return;
      if (!confirm('Importing a backup REPLACES all current data. Continue?')) { el.value = ''; return; }
      try { db = await window.Store.importJson(await f.text()); photoCache.clear(); refreshStatuses(); save(); go('dashboard'); toast('Backup imported'); } catch (err) { toast(`Import failed: ${err.message}`); }
      return;
    }
    if (el.dataset.ship != null) {
      const p = po(state.poId); if (!p) return; const k = el.dataset.ship;
      p.shipment[k] = k === 'receivedQtyOk' ? el.value === 'true' : el.value;
      if (k === 'shippedAt' && el.value && ['SENT', 'CONFIRMED', 'PAID'].includes(p.status)) setPoStatus(p, 'SHIPPED', p.shipment.trackingNo || '');
      else if (k === 'arrivedAt' && el.value && ['SENT', 'CONFIRMED', 'PAID', 'SHIPPED'].includes(p.status)) setPoStatus(p, 'ARRIVED', p.shipment.destinationPort || '');
      else if (k === 'receivedAt' && el.value && !['RECEIVED', 'CLOSED', 'CANCELLED'].includes(p.status)) setPoStatus(p, 'RECEIVED', `Received by ${p.shipment.receivedBy || ''}`);
      else save();
      if (['shippedAt', 'arrivedAt', 'receivedAt', 'eta'].includes(k)) render(); return;
    }
    if (el.dataset.poLine) { const p = po(state.poId); const l = p.lines.find((x) => x.id === el.dataset.poLine); l[el.dataset.field] = S.num(el.value); S.totalPo(p); save(); render(); return; }
    if (el.dataset.poField) { const p = po(state.poId); p[el.dataset.poField] = el.type === 'number' ? S.num(el.value) : el.value; S.totalPo(p); save(); render(); return; }
  });

  $('#fab').addEventListener('click', () => { state.form = blankForm(); go('request-form'); });
  $('#view').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]'); if (!btn || btn.tagName === 'INPUT') return;
    const a = btn.dataset.action, id = btn.dataset.id;
    if (btn.tagName === 'A' && !btn.target) e.preventDefault();
    const act = {
      go: () => go(btn.dataset.view),
      zoom: () => { if (btn.src) lightbox(btn.src); },
      'requests-status': () => { state.requestFilter.status = btn.dataset.status; go('requests'); },
      'request-new': () => { state.form = blankForm(); go('request-form'); },
      'request-open': () => go('request', { requestId: id }),
      'request-edit': async () => { const r = request(id); state.form = { editingId: r.id, photos: [await photoUrl(r.photos[0]), await photoUrl(r.photos[1]), await photoUrl(r.photos[2])], values: { ...r } }; go('request-form'); },
      'request-clone': () => { const r = request(id); state.lastTruck = { truckReg: r.truckReg, truckMake: r.truckMake, truckModel: r.truckModel, chassis: r.chassis, engineModel: r.engineModel, department: r.department }; state.lastRequester = r.requestedBy; state.lastDepartment = r.department; state.form = blankForm(); go('request-form'); },
      'request-cancel-form': () => { const back = state.form && state.form.editingId; state.form = null; back ? go('request', { requestId: back }) : go('requests'); },
      'request-save': () => saveRequest(), 'request-save-another': () => saveRequest({ another: true }),
      'photo-clear': () => { syncForm(); state.form.photos[+id] = null; render(); },
      'pick-truck': () => { syncForm(); const t = db.trucks.find((x) => x.id === id); Object.assign(state.form.values, { truckReg: t.regNo, truckMake: t.make, truckModel: t.model, chassis: t.chassis || '', engineModel: t.engineModel || '', department: state.form.values.department || t.department || '' }); render(); },
      'request-pdf': () => downloadRequestPdf(request(id)).catch((err) => toast(`PDF failed: ${err.message}`)),
      'request-share': () => shareRequestModal(request(id), btn.dataset.supplier || ''),
      'rfq-send': () => sendRfqModal(request(id)),
      'request-status': () => { const r = request(id); r.status = btn.dataset.status || 'NEW'; if (!btn.dataset.status) r.status = 'NEW'; save(); render(); toast(`${r.id} ${label(r.status).toLowerCase()}`); },
      'request-delete': async () => { const r = request(id); if (posOf(r.id).length) return toast('This request is on a purchase order — cancel the PO first'); if (!confirm(`Delete ${r.id} and its photos?`)) return; for (const p of r.photos || []) if (p) await window.Photos.remove(p); db.rfqs = db.rfqs.filter((q) => q.requestId !== r.id); db.requests = db.requests.filter((x) => x.id !== r.id); save(); go('requests'); toast('Request deleted'); },
      'requests-export': () => window.Exporter.workbook(`spare-part-requests-${today()}`, [{ name: 'Requests', rows: S.requestRows(filteredRequests()) }]),
      'requests-template': () => window.Exporter.workbook('spare-parts-import-template', [{ name: 'Requests', rows: [S.IMPORT_TEMPLATE_HEADERS, ['', today(), 'J. Okafor', 'Workshop A', 'LAG-123-XY', 'SINOTRUK', 'HOWO 371 6x4 Tipper', 'LZZ5EXSB9MA123456', 'WD615.47', 'Brake System', 'Rear brake drum', 'WG9231342006', 2, 'PCS', 'URGENT', 'Ø 420 mm', 'Cracked', 'NEW']] }]),
      'rfq-status': () => { const q = db.rfqs.find((x) => x.id === id); q.status = btn.dataset.status; save(); render(); },
      'rfq-delete': () => { const q = db.rfqs.find((x) => x.id === id); if (db.purchaseOrders.some((p) => p.status !== 'CANCELLED' && p.lines.some((l) => l.rfqId === q.id))) return toast('This quotation is on a purchase order'); if (confirm('Remove this supplier from the request?')) { db.rfqs = db.rfqs.filter((x) => x.id !== id); save(); render(); } },
      'quote-record': () => quoteModal(db.rfqs.find((x) => x.id === id)),
      'quote-select': () => { const q = db.rfqs.find((x) => x.id === id); db.rfqs.forEach((x) => { if (x.requestId === q.requestId) x.selected = false; }); q.selected = btn.dataset.on === '1'; save(); render(); toast(q.selected ? `${supplierName(q.supplierId)} selected — create the PO when ready` : 'Selection cleared'); },
      'compare-export': () => { const r = request(id); window.Exporter.workbook(`compare-${r.id}`, [comparisonSheet(r, S.compareQuotes(r, db.rfqs, db.suppliers, { rates: rates(), baseCurrency: base() }))]); },
      'quotes-export': () => window.Exporter.workbook(`rfqs-quotations-${today()}`, [{ name: 'RFQs', rows: rfqRows() }]),
      'po-from-quote': () => poFromQuoteModal(db.rfqs.find((x) => x.id === id)),
      'po-open': () => go('po', { poId: id }),
      'po-status': () => { const p = po(id); const s = btn.dataset.status; if (s === 'CANCELLED' && !confirm(`Cancel ${p.number}? Its requests go back to "quoted".`)) return; const note = s === 'SHIPPED' ? (p.shipment.trackingNo || '') : ''; setPoStatus(p, s, note); render(); toast(`${p.number} ${label(s).toLowerCase()}`); },
      'po-line-delete': () => { const p = po(state.poId); const l = p.lines.find((x) => x.id === id); if (!confirm(`Remove ${l.description} from ${p.number}?`)) return; p.lines = p.lines.filter((x) => x.id !== id); const q = db.rfqs.find((x) => x.id === l.rfqId); if (q) q.selected = false; S.totalPo(p); save(); render(); },
      'po-export': () => { const p = po(id); window.Exporter.workbook(p.number, poSheets(p)); },
      'po-pdf': () => { const p = po(id); window.Exporter.download(`${p.number}.pdf`, pdfBlob(window.Documents.purchaseOrderPdf(p, supplier(p.supplierId) || {}, st()))); },
      'po-share': async () => { const p = po(id), s = supplier(p.supplierId) || {}; const text = `Hello ${s.contact || ''},\n${st().company} purchase order ${p.number} (${p.date}):\n${p.lines.map((l) => `- ${l.description}${l.partNo ? ' ' + l.partNo : ''} × ${fmtNum(l.qty)} ${l.unit} @ ${p.currency} ${fmtNum(l.unitPrice)}`).join('\n')}\nTotal: ${p.currency} ${fmtNum(p.total)}\nPayment: ${p.paymentTerms || '-'}\nPlease see the attached PO PDF and send the Proforma Invoice. Thank you.`; const res = await shareViaWhatsApp({ fileName: `${p.number}.pdf`, bytes: window.Documents.purchaseOrderPdf(p, s, st()), text, number: s.whatsapp, title: p.number }); if (res !== 'cancelled' && p.status === 'DRAFT') { setPoStatus(p, 'SENT', 'Sent by WhatsApp'); render(); } },
      'orders-export': () => window.Exporter.workbook(`purchase-orders-${today()}`, [{ name: 'Purchase orders', rows: poRows() }, { name: 'PO lines', rows: poLineRows() }]),
      'shipping-export': () => window.Exporter.workbook(`shipments-${today()}`, [{ name: 'Shipments', rows: poRows() }]),
      'history-export': () => window.Exporter.workbook(`procurement-history-${today()}`, [{ name: 'History', rows: poLineRows() }]),
      'history-part': () => { state.history.partNo = id; render(); },
      'supplier-open': () => go('supplier', { supplierId: id }),
      'supplier-new': () => modal('New supplier', supplierForm(), (v) => { db.suppliers.push(supplierFromForm(v, { id: S.nextNumber(db.suppliers, 'SUP-', 'id', 3) })); save(); render(); toast('Supplier added'); }, { submitLabel: 'Add supplier' }),
      'supplier-edit': () => { const s = supplier(id); modal(`Edit ${s.name}`, supplierForm(s), (v) => { supplierFromForm(v, s); db.purchaseOrders.forEach((p) => { if (p.supplierId === s.id) p.supplierName = s.name; }); save(); render(); }); },
      'supplier-delete': () => { const n = db.purchaseOrders.filter((p) => p.supplierId === id).length + db.rfqs.filter((q) => q.supplierId === id).length; if (n) return toast(`${n} RFQ(s)/PO(s) reference this supplier — mark it inactive instead`); if (confirm('Delete supplier?')) { db.suppliers = db.suppliers.filter((s) => s.id !== id); save(); go('suppliers'); } },
      'suppliers-export': () => window.Exporter.workbook(`suppliers-${today()}`, [{ name: 'Suppliers', rows: supplierRows() }]),
      'settings-save': () => {
        const f = $('#settings-form'); const v = {}; f.querySelectorAll('[name]').forEach((i) => (v[i.name] = i.value)); const list = (x) => x.split(',').map((y) => y.trim()).filter(Boolean);
        Object.assign(st(), { company: v.company.trim() || 'DARCO JMG', companyAddress: v.companyAddress.trim(), country: v.country.trim(), destination: v.destination.trim(), procurementContact: v.procurementContact.trim(), procurementPhone: v.procurementPhone.trim(), procurementEmail: v.procurementEmail.trim(), procurementWhatsApp: v.procurementWhatsApp.trim(), requestPrefix: v.requestPrefix.trim() || 'DARCO-SP-', poPrefix: v.poPrefix.trim() || 'DARCO-PO-', baseCurrency: v.baseCurrency, localCurrency: v.localCurrency, pdfNote: v.pdfNote.trim(), rates: { USD: S.num(v.rate_USD) || 1, RMB: S.num(v.rate_RMB), NGN: S.num(v.rate_NGN), EUR: S.num(v.rate_EUR) }, categories: list(v.categories), units: list(v.units).map((u) => u.toUpperCase()), truckMakes: list(v.truckMakes).map((u) => u.toUpperCase()), departments: list(v.departments), requesters: list(v.requesters) });
        if (st().rates[st().baseCurrency] !== 1) { st().rates[st().baseCurrency] = 1; toast('Base currency rate set to 1'); }
        save(); render(); toast('Settings saved');
      },
      'truck-new': () => modal('New truck', truckForm(), (v) => { db.trucks.push({ id: window.Store.uid('TRK'), regNo: v.regNo.trim().toUpperCase(), make: v.make, model: v.model.trim(), chassis: v.chassis.trim().toUpperCase(), engineModel: v.engineModel.trim(), department: v.department.trim() }); save(); render(); }),
      'truck-edit': () => { const t = db.trucks.find((x) => x.id === id); modal('Edit truck', truckForm(t), (v) => { Object.assign(t, { regNo: v.regNo.trim().toUpperCase(), make: v.make, model: v.model.trim(), chassis: v.chassis.trim().toUpperCase(), engineModel: v.engineModel.trim(), department: v.department.trim() }); save(); render(); }); },
      'truck-delete': () => { if (confirm('Remove this truck from the list? Existing requests keep their truck details.')) { db.trucks = db.trucks.filter((t) => t.id !== id); save(); render(); } },
      'data-export': async () => { window.Exporter.download(`darco-spare-parts-backup-${today()}.json`, await window.Store.exportJson(db), 'application/json'); toast('Backup downloaded'); },
      'data-export-all': () => window.Exporter.workbook(`darco-spare-parts-${today()}`, [{ name: 'Requests', rows: S.requestRows(db.requests) }, { name: 'Suppliers', rows: supplierRows() }, { name: 'RFQs & quotes', rows: rfqRows() }, { name: 'Purchase orders', rows: poRows() }, { name: 'PO lines', rows: poLineRows() }, { name: 'Trucks', rows: [['Registration', 'Make', 'Model', 'Chassis', 'Engine', 'Department'], ...db.trucks.map((t) => [t.regNo, t.make, t.model, t.chassis, t.engineModel, t.department])] }]),
      'data-reset': async () => { if (confirm('Replace ALL data with the demo dataset? Export a backup first if needed.')) { await window.Photos.clear(); photoCache.clear(); db = window.Store.reset(); state.form = null; await ensureDemoPhotos(); refreshStatuses(); save(); go('dashboard'); toast('Demo data restored'); } },
    };
    if (act[a]) await act[a]();
  });

  // ------------------------------------------------------------------ start
  refreshStatuses();
  render();
  ensureDemoPhotos().then(() => hydratePhotos($('#view')));
})();
