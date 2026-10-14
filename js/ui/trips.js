/* Trip Log: spreadsheet-style grid with inline editing, filters, detail form, import and export. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine, P = HB.planning, h = U.h;
  HB.views = HB.views || {};

  const COLS = [
    { key: 'dateDispatched', label: 'Dispatched', w: 104, freeze: true, edit: 'date' },
    { key: 'client', label: 'Client', w: 180, freeze2: true, edit: 'client' },
    { key: 'dateDelivered', label: 'Delivered', w: 104, edit: 'date' },
    { key: 'plate', label: 'Plate No.', w: 100, edit: 'asset' },
    { key: 'assetCode', label: 'Asset Code', w: 110 },
    { key: 'vehicleType', label: 'Vehicle Type', w: 150 },
    { key: 'vehicleCategory', label: 'Category', w: 90 },
    { key: 'costCenter', label: 'Cost Ctr', w: 70 },
    { key: 'truckBatch', label: 'Truck Batch', w: 95, batch: true },
    { key: 'contractType', label: 'Contract', w: 80, edit: 'text' },
    { key: 'loadingFrom', label: 'Loading From', w: 120, edit: 'location' },
    { key: 'loadingTo', label: 'Loading To', w: 120, edit: 'location' },
    { key: 'journeyPlanId', label: 'Trip ID', w: 150, tripId: true },
    { key: 'serviceType', label: 'Service', w: 100, service: true },
    { key: 'opsStatus', label: 'Ops status', w: 90, ops: true },
    { key: 'driver', label: 'Driver', w: 120, edit: 'text' },
    { key: 'allocationId', label: 'Allocation', w: 120, alloc: true },
    { key: 'waybill', label: 'Waybill No.', w: 130, edit: 'text' },
    { key: 'waybillStatus', label: 'Waybill Status', w: 160, wbstatus: true },
    { key: 'podStatus', label: 'POD', w: 110, pod: true },
    { key: 'returnWaybill', label: 'Return WB', w: 100, edit: 'enum', options: E.RETURN_WAYBILL },
    { key: 'invoiceStatus', label: 'Invoice Status (auto)', w: 140, invstatus: true },
    { key: 'agreedPrice', label: 'Agreed Client Price (₦)', w: 150, money: true, agreed: true },
    { key: 'sellingPrice', label: 'Selling Price (₦)', w: 140, money: true, edit: 'money' },
    { key: 'variance', label: 'Variance (₦)', w: 130, money: true, variance: true },
    { key: 'variancePct', label: 'Variance %', w: 90, pct: true, variance: true },
    { key: 'vat', label: 'VAT (₦)', w: 110, money: true },
    { key: 'billing', label: 'Billing After VAT (₦)', w: 150, money: true },
    { key: 'vatTreatment', label: 'VAT Basis', w: 120, edit: 'enum', options: E.VAT_TREATMENTS, vatLabel: true },
    { key: 'netSales', label: 'Net Sales excl. VAT (₦)', w: 150, money: true },
    { key: 'quoteNo', label: 'Quote No.', w: 100, edit: 'text' },
    { key: 'soNo', label: 'SO No.', w: 100, edit: 'text' },
    { key: 'manualInvoiceNo', label: 'Manual Inv. No.', w: 120, edit: 'text' },
    { key: 'invoiceNo', label: 'Invoice No.', w: 130 },
    { key: 'paymentStatus', label: 'Payment', w: 100, edit: 'enum', options: E.PAYMENT_STATUSES },
    { key: 'advance', label: 'Advance (₦)', w: 120, money: true, edit: 'money' },
    { key: 'amountPaid', label: 'Amount Paid (₦)', w: 130, money: true },
    { key: 'balance', label: 'Balance (₦)', w: 130, money: true },
    { key: 'tripStatus', label: 'Trip Status', w: 170, status: true },
    { key: 'note', label: 'Notes', w: 160, edit: 'text' },
  ];
  const PAGE = 100;
  const INV_KIND = { 'Not Invoiced': 'bad', 'Draft Invoice': 'info', 'Invoice Issued': 'warn', 'Invoice Sent': 'good', 'Partially Invoiced': 'warn', 'Invoice Voided': 'neutral', 'Internal Client': 'neutral' };
  const WB_KIND = { 'Awaiting Waybill': 'bad', 'Waybill Number Entered': 'warn', 'Waybill Received': 'info', 'Waybill Verification Pending': 'warn', 'Waybill Verified': 'good' };
  const view = { title: 'Trip Log', filters: U.storage.get('hb_trip_filters', {}), sort: { key: 'dateDispatched', dir: 'desc' }, page: 0, pending: new Map(), showFilters: false };

  view.render = function (root, ctx) {
    view.ctx = ctx; view.root = root;
    const { store } = ctx;
    const isNew = ctx.params && ctx.params.new;
    root.append(h('div', { class: 'stack', id: 'trip-view' }));
    view.draw();
    if (isNew) openDetail(ctx, null);
  };
  view.onStoreChange = () => { if (view.root && view.root.isConnected) view.draw(true); };

  function cellValue(t, c) {
    const v = t[c.key];
    if (c.agreed) { if (t.agreedStatus === 'multiple') return h('a', { href: '#', class: 'var-na', onClick: (e) => { e.preventDefault(); pickRate(view.ctx, t); } }, 'Multiple rates — choose'); if (t.agreedPrice === null || t.agreedPrice === undefined) return h('span', { class: 'var-na', text: 'No Agreed Rate Found' }); return U.money(v); }
    if (c.variance) { if (t.direction === 'na') return ''; return h('span', { class: 'var-' + t.direction, text: c.pct ? U.pct(v) : U.signedMoney(v) }); }
    if (c.money) return U.money(v);
    if (c.status) return U.pill(v, U.statusKind(v));
    if (c.invstatus) return U.pill(v, INV_KIND[v] || 'neutral');
    if (c.wbstatus) return U.pill(v, WB_KIND[v] || 'neutral');
    if (c.tripId) return v ? h('span', { class: 'num', text: String(v) }) : (t.allocationId ? h('span', { class: 'pill warn', text: 'Pending' }) : '');
    if (c.service) return U.pill(v === '3rd Party Contractor' ? '3rd Party' : 'Internal', v === '3rd Party Contractor' ? 'info' : 'neutral');
    if (c.ops) return U.pill(v, v === 'Open' ? 'info' : v === 'Closed' ? 'good' : 'neutral');
    if (c.pod) return U.pill(v, v === 'POD Verified' ? 'good' : v === 'POD Received' ? 'warn' : 'bad');
    if (c.alloc) return v ? h('a', { href: '#planning', class: 'num', onClick: (e) => { e.preventDefault(); HB.views.planning.openAllocation(view.ctx, v); } }, v) : '';
    if (c.batch) return v ? U.pill(v, v === 'New Batch' ? 'info' : v === 'Old Batch' ? 'neutral' : 'warn') : '';
    if (c.vatLabel) return v === 'inclusive' ? 'Incl. VAT' : 'Excl. VAT';
    if (c.key === 'dateDispatched' || c.key === 'dateDelivered') return U.date(v);
    return v === null || v === undefined ? '' : String(v);
  }
  function canEdit(ctx, c) { return !!c.edit && ctx.canField(c.key); }

  view.rows = function () {
    const { store } = view.ctx; const f = view.filters;
    let rows = E.filterTrips(store.trips(), f);
    if (f.variance === 'below') rows = rows.filter((t) => t.direction === 'below'); else if (f.variance === 'above') rows = rows.filter((t) => t.direction === 'above'); else if (f.variance === 'none') rows = rows.filter((t) => t.agreedPrice === null);
    rows = U.sortBy(rows, view.sort.key, view.sort.dir);
    if (view.sort.key === 'dateDispatched') rows = U.sortBy(rows, (t) => t.dateDispatched + '|' + String(t.xlRow || '').padStart(6, '0') + t.id, view.sort.dir);
    return rows;
  };

  view.draw = function (keepScroll) {
    const ctx = view.ctx, store = ctx.store; const wrap = view.root.querySelector('#trip-view'); if (!wrap) return;
    const frame = wrap.querySelector('.table-frame'); const scroll = frame ? { l: frame.scrollLeft, t: frame.scrollTop } : null;
    U.clear(wrap);
    const rows = view.rows(); const pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (view.page >= pages) view.page = pages - 1;
    const pageRows = rows.slice(view.page * PAGE, (view.page + 1) * PAGE);
    const f = view.filters;
    const search = h('input', { type: 'search', placeholder: 'Search client, plate, route, waybill, invoice…', value: f.search || '', id: 'trip-search', onInput: U.debounce((e) => { f.search = e.target.value; view.page = 0; persist(); view.draw(); }, 200) });
    const activeFilters = Object.entries(f).filter(([k, v]) => v && k !== 'search').length;
    const toolbar = h('div', { class: 'toolbar' }, search,
      h('button', { class: 'btn' + (view.showFilters || activeFilters ? ' primary' : ''), onClick: () => { view.showFilters = !view.showFilters; view.draw(); } }, `Filters${activeFilters ? ' (' + activeFilters + ')' : ''}`),
      ctx.can('trip.create') ? h('button', { class: 'btn accent', onClick: () => openDetail(ctx, null) }, '+ New trip') : null,
      ctx.can('trip.fromPlanning') ? h('button', { class: 'btn', id: 'btn-from-planning', onClick: () => selectFromPlanning(ctx) }, (() => { const n = store.state.allocations.filter((a) => !a.tripLogId && ['Planned', 'Deployed', 'Loaded'].includes(a.status)).length; return n ? `Select from Fleet Planning (${n})` : 'Select from Fleet Planning'; })()) : null,
      ctx.can('trip.import') ? h('button', { class: 'btn', onClick: () => importDialog(ctx) }, 'Import Excel') : null,
      ctx.can('export') ? h('button', { class: 'btn', onClick: () => HB.exporter.xlsx([{ name: 'Trip Log', rows: HB.exporter.tripsToRows(rows) }], `Trip_Log_${U.todayISO()}.xlsx`) }, 'Export Excel') : null,
      h('span', { class: 'muted small grow', style: { textAlign: 'right' }, text: `${U.int(rows.length)} of ${U.int(store.trips().length)} trips` }));
    wrap.append(toolbar);
    if (view.showFilters) wrap.append(filterBar(ctx));
    const sumRow = { billing: E.sum(rows, 'billing'), sellingPrice: E.sum(rows, 'sellingPrice'), vat: E.sum(rows, 'vat'), amountPaid: E.sum(rows, 'amountPaid'), balance: E.sum(rows, 'balance'), variance: E.sum(rows.filter((t) => t.direction !== 'na'), 'variance') };

    // table
    const thead = h('tr', {}, h('th', { class: 'freeze', style: { width: '36px', left: 0 } }, '#'));
    let left = 36;
    for (const c of COLS) {
      const th = h('th', { class: (c.freeze ? 'freeze' : '') + (c.freeze2 ? ' freeze2' : '') + (view.sort.key === c.key ? ' sorted ' + view.sort.dir : '') + (c.money || c.pct ? ' money' : ''), style: { minWidth: c.w + 'px', left: c.freeze || c.freeze2 ? left + 'px' : null }, onClick: () => { view.sort = view.sort.key === c.key ? { key: c.key, dir: view.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }; view.draw(); } }, c.label);
      if (c.freeze || c.freeze2) left += c.w + 19;
      thead.append(th);
    }
    const tbody = h('tbody');
    pageRows.forEach((t, i) => {
      const pend = view.pending.get(t.id); const shown = pend ? E.computeTrip(Object.assign({}, store.raw(t.id), pend.patch), store.ctx()) : t;
      const tr = h('tr', { class: pend ? 'dirty' : '', dataset: { id: t.id } });
      tr.append(h('td', { class: 'freeze num', style: { left: 0, cursor: 'pointer', color: 'var(--brand-2)' }, title: 'Open trip details', onClick: () => openDetail(ctx, t.id) }, view.page * PAGE + i + 1));
      let l = 36;
      for (const c of COLS) {
        const editable = canEdit(ctx, c);
        const td = h('td', { class: (c.freeze ? 'freeze' : '') + (c.freeze2 ? ' freeze2' : '') + (c.money || c.pct ? ' money' : '') + (editable ? ' editable' : c.edit ? ' locked' : ''), style: { left: c.freeze || c.freeze2 ? l + 'px' : null }, dataset: { key: c.key } }, cellValue(shown, c));
        if (c.freeze || c.freeze2) l += c.w + 19;
        if (editable) td.addEventListener('click', (e) => { if (e.target.tagName === 'A') return; startEdit(ctx, td, t.id, c); });
        tr.append(td);
      }
      tbody.append(tr);
    });
    const tfoot = h('tfoot', {}, h('tr', {}, h('td', { class: 'freeze', style: { left: 0 } }, 'Σ'), COLS.map((c) => h('td', { class: c.money ? 'money' : '' }, sumRow[c.key] !== undefined && c.key !== 'variancePct' ? U.money(sumRow[c.key]) : c.key === 'client' ? `${U.int(rows.length)} trips (page ${view.page + 1}/${pages})` : ''))));
    const table = h('table', { class: 'data', id: 'trip-table' }, h('thead', {}, thead), tbody, tfoot);
    const frameEl = h('div', { class: 'table-frame' }, rows.length ? table : h('div', { class: 'empty' }, h('strong', { text: 'No trips match these filters.' }), h('span', { text: 'Clear the filters or add a new trip.' })));
    wrap.append(frameEl);
    // frozen columns: measure the rendered header widths so the sticky offsets are exact
    if (rows.length) {
      const ths = [...thead.children]; let acc = 0;
      ths.forEach((th, i) => { if (th.classList.contains('freeze') || th.classList.contains('freeze2')) { const left = acc + 'px'; th.style.left = left; for (const tr of tbody.children) tr.children[i].style.left = left; tfoot.querySelector('tr').children[i].style.left = left; acc += th.getBoundingClientRect().width; } });
    }
    if (keepScroll && scroll) { frameEl.scrollLeft = scroll.l; frameEl.scrollTop = scroll.t; }
    // pager
    wrap.append(h('div', { class: 'pager' },
      h('span', { text: `Showing ${rows.length ? view.page * PAGE + 1 : 0}–${Math.min(rows.length, (view.page + 1) * PAGE)} of ${U.int(rows.length)}. Click a row number to open the full record; click a cell to edit it inline.` }),
      h('span', { class: 'row' }, h('button', { class: 'btn sm', disabled: view.page === 0, onClick: () => { view.page--; view.draw(); } }, '‹ Prev'), h('span', { text: `Page ${view.page + 1} of ${pages}` }), h('button', { class: 'btn sm', disabled: view.page >= pages - 1, onClick: () => { view.page++; view.draw(); } }, 'Next ›'))));
    if (view.pending.size) wrap.append(saveBar(ctx));
  };

  function persist() { U.storage.set('hb_trip_filters', view.filters); }
  function filterBar(ctx) {
    const { store } = ctx; const f = view.filters;
    const trips = store.trips();
    const opt = (list) => [['', 'All'], ...list.map((x) => [x, x])];
    const set = (k) => (e) => { f[k] = e.target.value; view.page = 0; persist(); view.draw(); };
    const bar = h('div', { class: 'filters card' },
      U.field('From date', h('input', { type: 'date', value: f.from || '', onChange: set('from') })),
      U.field('To date', h('input', { type: 'date', value: f.to || '', onChange: set('to') })),
      U.field('Month', U.select(opt([...new Set(trips.map((t) => t.month))].filter(Boolean).sort().reverse()), f.month || '', { onChange: set('month') })),
      U.field('Client', U.select(opt(store.clientNames()), f.client || '', { onChange: set('client') })),
      U.field('Vehicle type', U.select(opt([...new Set(store.state.assets.map((a) => a.vehicleType))].sort()), f.vehicleType || '', { onChange: set('vehicleType') })),
      U.field('Cost center', U.select(opt([...new Set(store.state.assets.map((a) => a.costCenter))].sort()), f.costCenter || '', { onChange: set('costCenter') })),
      U.field('Plate', U.select(opt(store.state.assets.map((a) => a.plate).sort()), f.plate || '', { onChange: set('plate') })),
      U.field('Select Truck Batch', U.select([['', 'All Batches'], ['New Batch', 'New Batch'], ['Old Batch', 'Old Batch'], ['3rd Party', '3rd Party / unclassified']], f.truckBatch || '', { onChange: set('truckBatch') })),
      U.field('Contract type', U.select(opt([...new Set(trips.map((t) => t.contractType).filter(Boolean))].sort()), f.contractType || '', { onChange: set('contractType') })),
      U.field('VAT basis', U.select([['', 'All'], ['exclusive', 'Price Excluding VAT'], ['inclusive', 'Price Including VAT']], f.vatTreatment || '', { onChange: set('vatTreatment') })),
      U.field('Payment status', U.select(opt(E.PAYMENT_STATUSES), f.paymentStatus || '', { onChange: set('paymentStatus') })),
      U.field('Invoice status', U.select(opt(E.INVOICE_STATUSES), f.invoiceStatus || '', { onChange: set('invoiceStatus') })),
      U.field('Waybill status', U.select(opt(E.WAYBILL_STATUSES), f.waybillStatus || '', { onChange: set('waybillStatus') })),
      U.field('POD status', U.select(opt(E.POD_STATUSES), f.podStatus || '', { onChange: set('podStatus') })),
      U.field('Service type', U.select(opt(E.SERVICE_TYPES), f.serviceType || '', { onChange: set('serviceType') })),
      U.field('Operational status', U.select(opt(E.OPS_STATUSES), f.opsStatus || '', { onChange: set('opsStatus') })),
      U.field('Trip status', U.select(opt(E.TRIP_STATUSES), f.tripStatus || '', { onChange: set('tripStatus') })),
      U.field('Price vs agreed', U.select([['', 'All'], ['below', 'Below agreed rate'], ['above', 'Above agreed rate'], ['none', 'No agreed rate']], f.variance || '', { onChange: set('variance') })),
      h('button', { class: 'btn', onClick: () => { view.filters = {}; persist(); view.draw(); } }, 'Clear filters'));
    return bar;
  }

  // ---------------------------------------------------------------- inline editing
  function editor(ctx, c, value) {
    const { store } = ctx;
    if (c.edit === 'enum') return U.select(c.options.map((o) => [o, c.vatLabel ? E.VAT_TREATMENT_LABELS[o] : (o || '—')]), value);
    if (c.edit === 'date') return h('input', { type: 'date', value: value || '' });
    if (c.edit === 'money') return h('input', { type: 'number', step: '0.01', min: '0', value: value === null || value === undefined ? '' : value });
    if (c.edit === 'client') return U.datalistInput('dl-clients', store.clientNames(), value);
    if (c.edit === 'asset') return U.datalistInput('dl-assets', store.state.assets.map((a) => a.plate), value);
    if (c.edit === 'location') return U.datalistInput('dl-locations', store.locationNames(), value);
    return h('input', { type: 'text', value: value || '' });
  }
  function readEditor(el, c) { const inp = el.tagName === 'INPUT' || el.tagName === 'SELECT' ? el : el.querySelector('input,select'); const v = inp.value; if (c.edit === 'money') return v === '' ? null : Number(v); return c.edit === 'text' || c.edit === 'client' || c.edit === 'asset' || c.edit === 'location' ? E.clean(v) : v; }
  function startEdit(ctx, td, id, c) {
    if (td.classList.contains('cell-edit')) return;
    const { store } = ctx; const raw = store.raw(id); const pend = view.pending.get(id);
    const current = pend && pend.patch[c.key] !== undefined ? pend.patch[c.key] : raw[c.key];
    const ed = editor(ctx, c, current); td.classList.add('cell-edit'); U.clear(td); td.append(ed);
    const inp = ed.tagName === 'INPUT' || ed.tagName === 'SELECT' ? ed : ed.querySelector('input,select'); inp.focus(); if (inp.select) inp.select();
    let done = false;
    const finish = (commit, moveNext) => {
      if (done) return; done = true;
      if (commit) { const v = readEditor(ed, c); const before = raw[c.key] === undefined || raw[c.key] === null ? '' : raw[c.key]; if (JSON.stringify(v === null ? '' : v) !== JSON.stringify(before)) { const p = view.pending.get(id) || { patch: {}, baseVersion: raw.version }; p.patch[c.key] = v; view.pending.set(id, p); } else if (pend) { delete pend.patch[c.key]; if (!Object.keys(pend.patch).length) view.pending.delete(id); } }
      view.draw(true);
      if (moveNext) { const next = view.root.querySelector(`tr[data-id="${id}"] td[data-key="${moveNext}"]`); if (next && next.classList.contains('editable')) next.click(); }
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') finish(false);
      else if (e.key === 'Tab') { e.preventDefault(); const i = COLS.findIndex((x) => x.key === c.key); const dir = e.shiftKey ? -1 : 1; let j = i + dir; while (COLS[j] && !canEdit(ctx, COLS[j])) j += dir; finish(true, COLS[j] ? COLS[j].key : null); }
    });
    inp.addEventListener('blur', () => setTimeout(() => finish(true), 120));
    if (ed.tagName === 'SELECT') ed.addEventListener('change', () => finish(true));
  }
  function saveBar(ctx) {
    const n = view.pending.size;
    return h('div', { class: 'savebar' }, h('strong', { text: `${n} trip${n > 1 ? 's' : ''} with unsaved changes` }), h('span', { class: 'grow small', text: 'Changes are kept here until you save them.' }),
      h('button', { class: 'btn', onClick: () => { view.pending.clear(); view.draw(true); } }, 'Discard'),
      h('button', { class: 'btn primary', onClick: () => savePending(ctx) }, `Save ${n} change${n > 1 ? 's' : ''}`));
  }
  async function savePending(ctx) {
    const { store } = ctx; let saved = 0, failed = 0;
    for (const [id, p] of [...view.pending.entries()]) {
      try { await store.saveTrip(Object.assign({ id }, p.patch), { expectedVersion: p.baseVersion }); view.pending.delete(id); saved++; }
      catch (e) { failed++; if (e.code === 'conflict') { const keep = await conflictDialog(ctx, id, p, e.current); if (keep === 'overwrite') { try { await store.saveTrip(Object.assign({ id }, p.patch), { expectedVersion: e.current.version }); view.pending.delete(id); saved++; failed--; } catch (e2) { U.toast(e2.message, 'bad'); } } else if (keep === 'discard') { view.pending.delete(id); } } else U.toast(e.message, 'bad'); }
    }
    view.draw(true);
    if (saved) U.toast(`Saved ${saved} trip${saved > 1 ? 's' : ''}.`, 'good');
    if (failed) U.toast(`${failed} change${failed > 1 ? 's' : ''} could not be saved.`, 'bad');
  }
  function conflictDialog(ctx, id, p, current) {
    return new Promise((resolve) => {
      const changes = Object.entries(p.patch).map(([k, v]) => h('div', { class: 'diff' }, `${k}: `, h('span', { class: 'from' }, String(current[k] ?? '')), h('span', { class: 'to' }, String(v ?? ''))));
      const m = U.modal({ title: 'Someone else changed this trip', size: 'narrow', onClose: (r) => resolve(r || 'keep'),
        body: h('div', { class: 'stack' }, h('p', { text: `${current.client} · ${current.plate} · ${U.date(current.dateDispatched)} was updated by ${current.updatedBy || 'another user'} at ${U.dateTime(current.updatedAt)}. Your pending edits (their current value → yours):` }), ...changes) });
      m.setActions([h('button', { class: 'btn', onClick: () => m.close('discard') }, 'Discard my edits'), h('button', { class: 'btn', onClick: () => m.close('keep') }, 'Keep pending'), h('button', { class: 'btn danger', onClick: () => m.close('overwrite') }, 'Overwrite with mine')]);
    });
  }

  // ---------------------------------------------------------------- detail form
  function openDetail(ctx, id) {
    const { store } = ctx; const raw = id ? store.raw(id) : null; const computed = id ? store.trip(id) : null;
    const t = Object.assign({ dateDispatched: U.todayISO(), dateDelivered: '', plate: '', client: '', loadingFrom: '', loadingTo: '', journeyPlanId: '', waybill: '', returnWaybill: '', invoiceStatus: 'Not Invoiced', sellingPrice: null, vatTreatment: 'exclusive', quoteNo: '', soNo: '', manualInvoiceNo: '', paymentStatus: 'Not Paid', advance: null, contractType: '', note: '', waybillReceivedAt: '', waybillReceivedBy: '', waybillDocId: '', waybillDocName: '', internalClient: false }, raw || {});
    const readInput = (inp) => (inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : inp.value);
    if (!id && !ctx.can('trip.create')) return U.toast('Your role cannot create trips.', 'bad');
    const inputs = {};
    const fld = (key, label, control, opts) => { inputs[key] = control.tagName === 'SPAN' ? control.querySelector('input') : control; const locked = !ctx.canField(key) && !(id === null && ctx.can('trip.create') && E.ROLE_FIELDS.operations.includes(key)); if (locked) { inputs[key].disabled = true; } return U.field(label, control, Object.assign({ locked }, opts || {})); };
    const preview = h('div', { class: 'card stack', style: { gap: '6px' } });
    const recompute = () => {
      const draft = Object.assign({}, t); for (const k of Object.keys(inputs)) draft[k] = readInput(inputs[k]);
      const c = E.computeTrip(draft, store.ctx()); U.clear(preview);
      const line = (k, v, cls) => h('div', { class: 'row between' }, h('span', { class: 'muted small', text: k }), h('span', { class: 'num ' + (cls || ''), text: v }));
      U.append(preview, [h('div', { class: 'label', text: 'Calculated (from Selling Price)' }),
        line('Agreed Client Price', c.agreedStatus === 'multiple' ? 'Multiple rates — choose below' : c.agreedPrice === null ? 'No Agreed Rate Found' : U.money(c.agreedPrice)),
        line('Price variance', c.direction === 'na' ? '—' : `${U.signedMoney(c.variance)} (${U.pct(c.variancePct)})`, 'var-' + c.direction),
        line('Net sales excl. VAT', U.money(c.netSales, { blank: '—' })), line(`VAT (${(E.vatRateOf(store.state.settings) * 100).toFixed(1)}%)`, U.money(c.vat, { blank: '—' })), line('Billing after VAT', U.money(c.billing, { blank: '—' })), line('Amount paid', U.money(c.amountPaid, { blank: '—' })), line('Balance', U.money(c.balance, { blank: '—' })),
        h('div', { class: 'row between' }, h('span', { class: 'muted small', text: 'Trip status' }), U.pill(c.tripStatus, U.statusKind(c.tripStatus))),
        h('div', { class: 'row between' }, h('span', { class: 'muted small', text: 'Invoice status (automatic)' }), h('span', { class: 'row' }, U.pill(c.invoiceStatus, INV_KIND[c.invoiceStatus] || 'neutral'), c.invoiceNo ? h('span', { class: 'tiny muted', text: c.invoiceNo }) : null)),
        c.invoiceIssuedAt || c.invoiceSentAt ? line('Issued / sent', [c.invoiceIssuedAt ? 'issued ' + U.date(c.invoiceIssuedAt) : '', c.invoiceSentAt ? 'sent ' + U.date(c.invoiceSentAt) : ''].filter(Boolean).join(' · ')) : null,
        h('div', { class: 'row between' }, h('span', { class: 'muted small', text: 'Payment' }), U.pill(c.paymentLabel, c.paymentLabel === 'Paid' ? 'good' : c.paymentLabel === 'Part Paid' ? 'info' : 'bad')),
        h('div', { class: 'row between' }, h('span', { class: 'muted small', text: 'Waybill status (automatic)' }), U.pill(c.waybillStatus, WB_KIND[c.waybillStatus] || 'neutral')),
        h('div', { class: 'row between' }, h('span', { class: 'muted small', text: 'Operational status' }), U.pill(c.opsStatus, c.opsStatus === 'Open' ? 'info' : 'neutral')),
        h('div', { class: 'row between' }, h('span', { class: 'muted small', text: 'POD status' }), U.pill(c.podStatus, c.podStatus === 'POD Verified' ? 'good' : c.podStatus === 'POD Received' ? 'warn' : 'bad')),
        (() => { const r = store.readiness(c); return h('div', { class: 'row between' }, h('span', { class: 'muted small', text: 'Invoice readiness' }), r.ready ? U.pill('Ready for invoicing', 'good') : h('span', { class: 'tiny var-below', text: 'Pending: ' + r.missing.join(', ') })); })(),
        c.vehicleType ? line('Vehicle', `${c.assetCode} · ${c.vehicleType} · ${c.vehicleCategory} · ${c.costCenter}`) : null,
        c.truckBatch ? h('div', { class: 'row between' }, h('span', { class: 'muted small', text: 'Truck Batch' }), U.pill(c.truckBatch, c.truckBatch === 'New Batch' ? 'info' : 'neutral')) : null]);
      if (c.agreedCandidates && c.agreedCandidates.length > 1 && ctx.canField('agreedRateId')) {
        const sel = U.select([['', 'Automatic (priority rule)'], ...c.agreedCandidates.map((r) => [r.id, `${U.money(r.price)} · ${r.contractType || 'any contract'} · from ${U.date(r.effectiveDate)}`])], draft.agreedRateId || '', { onChange: (e) => { t.agreedRateId = e.target.value; recompute(); } });
        preview.append(U.field('Agreed rate to apply', sel));
      }
    };
    const onInput = () => recompute();
    const form = h('div', { class: 'form-grid' },
      fld('dateDispatched', 'Date Dispatched', h('input', { type: 'date', value: t.dateDispatched || '', onInput })),
      fld('dateDelivered', 'Date Delivered', h('input', { type: 'date', value: t.dateDelivered || '', onInput })),
      fld('plate', 'Plate Number', U.datalistInput('dl-assets-f', store.state.assets.map((a) => a.plate), t.plate, { onInput })),
      fld('client', 'Client Name', U.datalistInput('dl-clients-f', store.clientNames(), t.client, { onInput })),
      fld('contractType', 'Contract Type', h('input', { type: 'text', value: t.contractType || '', onInput })),
      fld('loadingFrom', 'Loading From', U.datalistInput('dl-loc-f1', store.locationNames(), t.loadingFrom, { onInput })),
      fld('loadingTo', 'Loading To', U.datalistInput('dl-loc-f2', store.locationNames(), t.loadingTo, { onInput })),
      U.field('Trip ID (system generated)', h('input', { type: 'text', value: t.journeyPlanId || (id ? (t.allocationId ? 'Pending' : '') : 'Generated when an allocation is converted'), disabled: true }), { locked: true, help: E.TRIP_ID_RE.test(String(t.journeyPlanId || '')) ? 'Generated automatically (JMG-TRP-YYYY-NNNNNN); never overwritten or reused.' : t.journeyPlanId ? 'Historical Journey Plan reference from the workbook.' : 'Trip IDs are created automatically when an approved allocation (or 3PL assignment) becomes a trip.' }),
      fld('driver', 'Driver', h('input', { type: 'text', value: t.driver || '', onInput })),
      fld('waybill', 'Client Waybill Number', h('input', { type: 'text', value: t.waybill || '', onInput }), { help: t.waybillEnteredAt ? `Entered ${U.dateTime(t.waybillEnteredAt)}` : 'Can be added later; the status stays "Awaiting Waybill" until then.' }),
      fld('waybillReceivedAt', 'Physical waybill received on', h('input', { type: 'date', value: (t.waybillReceivedAt || '').slice(0, 10), onInput }), { help: t.waybillReceivedBy ? `Received by ${t.waybillReceivedBy}` : 'Date the paper copy came back.' }),
      fld('returnWaybill', 'Return Waybill Received', U.select(E.RETURN_WAYBILL.map((o) => [o, o || '—']), t.returnWaybill, { onChange: onInput })),
      fld('internalClient', 'Internal client trip (not billed)', h('input', { type: 'checkbox', checked: t.internalClient ? true : null, onChange: onInput, style: { width: 'auto', justifySelf: 'start' } })),
      fld('sellingPrice', 'Selling Price (₦) — manual entry', h('input', { type: 'number', step: '0.01', min: '0', value: t.sellingPrice ?? '', onInput }), { help: 'Never auto-filled from the agreed rate.' }),
      fld('vatTreatment', 'VAT Treatment', U.select(E.VAT_TREATMENTS.map((v) => [v, E.VAT_TREATMENT_LABELS[v]]), t.vatTreatment || 'exclusive', { onChange: onInput }), { help: 'Set by the invoice price type; "Including VAT" extracts VAT from the selling price.' }),
      fld('quoteNo', 'Quote Number', h('input', { type: 'text', value: t.quoteNo || '' })),
      fld('soNo', 'Sales Order Number', h('input', { type: 'text', value: t.soNo || '' })),
      fld('manualInvoiceNo', 'Manual Invoice Number', h('input', { type: 'text', value: t.manualInvoiceNo || '' }), { help: t.invoiceNo ? `Generated invoice: ${t.invoiceNo}` : '' }),
      fld('paymentStatus', 'Payment Status', U.select(E.PAYMENT_STATUSES, t.paymentStatus, { onChange: onInput })),
      fld('advance', 'Advance (₦)', h('input', { type: 'number', step: '0.01', min: '0', value: t.advance ?? '', onInput })),
      fld('note', 'Notes', h('input', { type: 'text', value: t.note || '' }), { span2: true }));
    recompute();
    const wbDoc = waybillDocBlock(ctx, raw, computed, () => { m.close(); openDetail(ctx, id); });
    const podDoc = podBlock(ctx, raw, computed, () => { m.close(); openDetail(ctx, id); });
    const history = h('div', { class: 'history' });
    if (raw && raw.history && raw.history.length) { history.append(h('div', { class: 'label', text: 'Change history' })); for (const hst of [...raw.history].reverse().slice(0, 15)) history.append(h('div', { class: 'h-item' }, h('div', { class: 'h-meta', text: `${U.dateTime(hst.ts)} · ${hst.user}` }), ...(hst.changes || []).slice(0, 8).map((c) => h('div', { class: 'diff' }, `${c.field}: `, h('span', { class: 'from' }, String(c.from ?? '')), h('span', { class: 'to' }, String(c.to ?? '')))))); }
    else if (raw) history.append(h('div', { class: 'muted small', text: `Imported from the workbook (row ${raw.xlRow || '?'}) · created ${U.dateTime(raw.createdAt)}` }));
    const states = raw && HB.geo ? h('div', { class: 'small muted row' }, 'Standardised: ' + (store.stateOf(raw.loadingFrom) || '?') + ' → ' + (store.stateOf(raw.loadingTo) || '?') + ' (original locations kept)', raw.serviceType === '3rd Party Contractor' ? h('span', { class: 'pill info', text: `3PL · ${raw.contractorName || ''} · cost ${U.money(raw.contractorCost)}` }) : null,
      raw.allocationId && raw.serviceType !== '3rd Party Contractor' && ctx.can('dispatch.prepare') ? h('button', { class: 'btn sm', onClick: () => { m.close(); ctx.nav('dispatch'); setTimeout(() => HB.views.dispatch.openForTrip(ctx, raw.id, 'diesel'), 50); } }, store.state.dieselreqs.some((d) => d.tripLogId === raw.id && !d.rejectedAt) ? 'Open diesel request' : 'Diesel request') : null,
      raw.allocationId && raw.serviceType !== '3rd Party Contractor' && ctx.can('dispatch.prepare') ? h('button', { class: 'btn sm', onClick: () => { m.close(); ctx.nav('dispatch'); setTimeout(() => HB.views.dispatch.openForTrip(ctx, raw.id, 'road'), 50); } }, store.state.roadslips.some((d) => d.tripLogId === raw.id && !d.rejectedAt) ? 'Open road expense slip' : 'Road expense slip') : null,
      (raw.allocationId || raw.serviceType === '3rd Party Contractor') ? h('button', { class: 'btn sm', onClick: () => { m.close(); ctx.nav('tat'); setTimeout(() => HB.views.tat.updateMilestones(ctx, raw.id), 50); } }, 'Tracking / TAT') : null,
      ctx.can('expense.request') && computed.opsStatus === 'Open' ? h('button', { class: 'btn sm', id: 'btn-trip-expense', onClick: () => { m.close(); HB.views.dispatch.requestExpense(ctx, computed); } }, 'Request additional expense') : null,
      ctx.can('expense.request') && computed.opsStatus !== 'Open' ? h('span', { class: 'tiny muted', text: `Trip ${computed.opsStatus.toLowerCase()}: no new expense requests` }) : null) : null;
    const links = raw && (raw.allocationId || raw.requestId) ? h('div', { class: 'notice info' }, 'Created from Fleet Planning: ', raw.requestId ? h('a', { href: '#planning', onClick: (e) => { e.preventDefault(); m.close(); HB.views.planning.openRequest(ctx, raw.requestId); } }, `request ${raw.requestId}`) : null, raw.requestId && raw.allocationId ? ' · ' : '', raw.allocationId ? h('a', { href: '#planning', onClick: (e) => { e.preventDefault(); m.close(); HB.views.planning.openAllocation(ctx, raw.allocationId); } }, `allocation ${raw.allocationId}`) : null) : null;
    const m = U.modal({ title: id ? `Trip ${computed.journeyPlanId || ''} · ${computed.client} · ${U.date(computed.dateDispatched)}` : 'New trip', size: 'wide', body: h('div', { class: 'grid-2' }, h('div', { class: 'stack' }, links, states, form, wbDoc, podDoc, history), preview) });
    const actions = [];
    if (id && ctx.can('trip.delete')) actions.push(h('button', { class: 'btn danger left', onClick: async () => { if (await U.confirm({ title: 'Delete trip', message: 'Delete this trip permanently? The audit trail keeps a record.', okLabel: 'Delete', danger: true })) { await store.deleteTrip(id); m.close(); view.draw(true); U.toast('Trip deleted.'); } } }, 'Delete'));
    actions.push(h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'));
    if (Object.values(inputs).some((i) => !i.disabled)) actions.push(h('button', { class: 'btn primary', onClick: async () => {
      const patch = { id: id || undefined };
      for (const [k, inp] of Object.entries(inputs)) if (!inp.disabled) patch[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : E.clean(inp.value);
      if (patch.waybillReceivedAt && !(raw && raw.waybillReceivedAt)) patch.waybillReceivedBy = store.user.username; if (patch.waybillReceivedAt === '') patch.waybillReceivedBy = '';
      if (t.agreedRateId !== undefined) patch.agreedRateId = t.agreedRateId;
      try { const saved = await store.saveTrip(patch, { expectedVersion: raw ? raw.version : undefined }); m.close(); view.pending.delete(saved.id); view.draw(true); U.toast(id ? 'Trip saved.' : 'Trip created.', 'good'); }
      catch (e) { if (e.code === 'conflict') { U.toast('This trip was changed by someone else. Review the latest values and save again.', 'bad'); m.close(); openDetail(ctx, id); } else U.toast(e.message, 'bad'); }
    } }, id ? 'Save changes' : 'Create trip'));
    m.setActions(actions);
  }
  // ---------------------------------------------------------------- waybill document & verification
  function waybillDocBlock(ctx, raw, computed, reload) {
    if (!raw) return null; const { store } = ctx;
    const doc = raw.waybillDocId ? store.state.waybilldocs.find((d) => d.id === raw.waybillDocId) : null;
    const canAttach = ctx.canField('waybillDocId'); const canVerify = ctx.can('waybill.verify');
    const file = h('input', { type: 'file', accept: 'image/*,.pdf' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try {
        let data, type = f.type;
        if (/^image\//.test(f.type)) { data = await new Promise((res, rej) => { const img = new Image(); const url = URL.createObjectURL(f); img.onload = () => { const scale = Math.min(1, 1400 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.8)); }; img.onerror = () => rej(new Error('Could not read the image.')); img.src = url; }); type = 'image/jpeg'; }
        else { if (f.size > 500 * 1024) throw new Error('PDF is larger than 500 KB. Scan at a lower resolution or attach a photo instead.'); data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(f); }); }
        if (data.length > 700000) throw new Error('File is too large after compression (limit ~500 KB).');
        const d = { id: U.id('wb'), tripId: raw.id, name: f.name, type, size: data.length, data, uploadedBy: store.user.username, uploadedAt: U.nowISO() };
        await store.saveDoc('waybilldocs', d, { label: `Waybill document ${f.name} for trip ${raw.id}`, silent: true });
        await store.saveTrip({ id: raw.id, waybillDocId: d.id, waybillDocName: f.name, waybillReceivedAt: raw.waybillReceivedAt || U.todayISO(), waybillReceivedBy: raw.waybillReceivedBy || store.user.username }, { expectedVersion: raw.version });
        U.toast('Waybill document attached.', 'good'); reload();
      } catch (e) { U.toast(e.message, 'bad'); }
    });
    const open = async () => { const d = doc || store.state.waybilldocs.find((x) => x.id === raw.waybillDocId); if (!d) return U.toast('Document not loaded.', 'bad'); const bin = atob(d.data.split(',')[1]); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); await U.download(new Blob([arr], { type: d.type }), d.name || 'waybill'); };
    return h('div', { class: 'card stack', style: { gap: '6px' } }, h('div', { class: 'row between' }, h('div', { class: 'label', text: 'Waybill documentation' }), U.pill(computed.waybillStatus, WB_KIND[computed.waybillStatus])),
      h('div', { class: 'small', text: [raw.waybill ? `No. ${raw.waybill}` : 'No waybill number yet', raw.waybillEnteredAt ? `entered ${U.dateTime(raw.waybillEnteredAt)}` : '', raw.waybillReceivedAt ? `physical copy received ${U.date(raw.waybillReceivedAt)} by ${raw.waybillReceivedBy || '—'}` : 'physical copy not yet received', raw.waybillVerifiedAt ? `verified ${U.dateTime(raw.waybillVerifiedAt)} by ${raw.waybillVerifiedBy}` : ''].filter(Boolean).join(' · ') }),
      h('div', { class: 'row' }, raw.waybillDocId ? h('button', { class: 'btn sm', onClick: open }, `Open ${raw.waybillDocName || 'document'}`) : h('span', { class: 'small muted', text: 'No scan or photo attached.' }), canAttach ? file : null,
        canVerify && raw.waybillReceivedAt && !raw.waybillVerifiedAt ? h('button', { class: 'btn sm primary', onClick: async () => { try { await store.saveTrip({ id: raw.id, waybillVerifiedAt: U.nowISO(), waybillVerifiedBy: store.user.username }, { expectedVersion: raw.version }); U.toast('Waybill verified.', 'good'); reload(); } catch (e) { U.toast(e.message, 'bad'); } } }, 'Verify waybill') : null,
        canVerify && raw.waybillVerifiedAt ? h('button', { class: 'btn sm', onClick: async () => { try { await store.saveTrip({ id: raw.id, waybillVerifiedAt: '', waybillVerifiedBy: '' }, { expectedVersion: raw.version }); reload(); } catch (e) { U.toast(e.message, 'bad'); } } }, 'Undo verification') : null));
  }

  // ---------------------------------------------------------------- POD and other client documents
  function podBlock(ctx, raw, computed, reload) {
    if (!raw) return null; const { store } = ctx; const canEdit = ctx.canField('podReceivedAt'); const canVerify = ctx.can('pod.verify');
    const client = store.state.clients.find((c) => E.norm(c.name) === E.norm(raw.client)) || null; const docs = Array.isArray(client && client.requiredDocs) ? client.requiredDocs : []; const r = store.readiness(computed);
    const file = h('input', { type: 'file', accept: 'image/*,.pdf' });
    file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; try { let data, type = f.type; if (/^image\//.test(f.type)) { data = await new Promise((res, rej) => { const img = new Image(); const url = URL.createObjectURL(f); img.onload = () => { const scale = Math.min(1, 1400 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.8)); }; img.onerror = () => rej(new Error('Could not read the image.')); img.src = url; }); type = 'image/jpeg'; } else { if (f.size > 500 * 1024) throw new Error('PDF is larger than 500 KB.'); data = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = () => rej(new Error('Could not read the file.')); rd.readAsDataURL(f); }); } const d = { id: U.id('pod'), tripId: raw.id, name: f.name, type, size: data.length, data, kind: 'pod', uploadedBy: store.user.username, uploadedAt: U.nowISO() }; await store.saveDoc('waybilldocs', d, { label: `POD ${f.name} for trip ${raw.id}`, silent: true }); await store.saveTrip({ id: raw.id, podDocId: d.id, podDocName: f.name, podReceivedAt: raw.podReceivedAt || U.todayISO(), podReceivedBy: raw.podReceivedBy || store.user.username }, { expectedVersion: raw.version }); U.toast('POD attached.', 'good'); reload(); } catch (e) { U.toast(e.message, 'bad'); } });
    const dateInp = h('input', { type: 'date', value: (raw.podReceivedAt || '').slice(0, 10), disabled: canEdit ? null : true, onChange: async (e) => { try { await store.saveTrip({ id: raw.id, podReceivedAt: e.target.value, podReceivedBy: e.target.value ? store.user.username : '' }, { expectedVersion: raw.version }); reload(); } catch (err) { U.toast(err.message, 'bad'); } } });
    const delivInp = h('input', { type: 'date', value: (raw.deliveryConfirmedAt || '').slice(0, 10), disabled: canEdit ? null : true, onChange: async (e) => { try { await store.saveTrip({ id: raw.id, deliveryConfirmedAt: e.target.value, deliveryConfirmedBy: e.target.value ? store.user.username : '' }, { expectedVersion: raw.version }); reload(); } catch (err) { U.toast(err.message, 'bad'); } } });
    return h('div', { class: 'card stack', style: { gap: '6px' } }, h('div', { class: 'row between' }, h('div', { class: 'label', text: 'Proof of delivery and billing documents' }), h('span', { class: 'row' }, U.pill(computed.podStatus, computed.podStatus === 'POD Verified' ? 'good' : computed.podStatus === 'POD Received' ? 'warn' : 'bad'), r.ready ? U.pill('Ready for invoicing', 'good') : U.pill('Pending documents', 'warn'))),
      h('div', { class: 'form-grid' }, U.field('POD received on', dateInp, { help: raw.podReceivedBy ? `Recorded by ${raw.podReceivedBy}` : '' }), U.field('Signed delivery confirmation received on', delivInp, { help: (client && client.requireDeliveryConfirmation) || store.state.settings.requireDeliveryConfirmation ? 'Mandatory for this client' : 'Optional unless the client requires it' })),
      docs.length ? h('div', { class: 'row small' }, 'Other client-required documents: ', docs.map((d) => h('label', { class: 'row small chip' }, h('input', { type: 'checkbox', checked: raw.otherDocs && raw.otherDocs[d] ? true : null, disabled: canEdit ? null : true, onChange: async (e) => { const od = Object.assign({}, raw.otherDocs || {}); if (e.target.checked) od[d] = U.todayISO(); else delete od[d]; try { await store.saveTrip({ id: raw.id, otherDocs: od }, { expectedVersion: raw.version }); reload(); } catch (err) { U.toast(err.message, 'bad'); } } }), ' ' + d))) : null,
      h('div', { class: 'row' }, raw.podDocId ? h('button', { class: 'btn sm', onClick: async () => { const d = store.state.waybilldocs.find((x) => x.id === raw.podDocId); if (!d) return U.toast('Document not loaded.', 'bad'); const bin = atob(d.data.split(',')[1]); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); await U.download(new Blob([arr], { type: d.type }), d.name || 'pod'); } }, `Open ${raw.podDocName || 'POD'}`) : h('span', { class: 'small muted', text: 'No POD scan attached.' }), canEdit ? file : null,
        canVerify && raw.podReceivedAt && !raw.podVerifiedAt ? h('button', { class: 'btn sm primary', id: 'btn-verify-pod', onClick: async () => { try { await store.saveTrip({ id: raw.id, podVerifiedAt: U.nowISO(), podVerifiedBy: store.user.username }, { expectedVersion: raw.version }); U.toast('POD verified.', 'good'); reload(); } catch (e) { U.toast(e.message, 'bad'); } } }, 'Verify POD') : null,
        canVerify && raw.podVerifiedAt ? h('button', { class: 'btn sm', onClick: async () => { try { await store.saveTrip({ id: raw.id, podVerifiedAt: '', podVerifiedBy: '' }, { expectedVersion: raw.version }); reload(); } catch (e) { U.toast(e.message, 'bad'); } } }, 'Undo POD verification') : null),
      r.missing.length ? h('div', { class: 'small var-below', text: 'Missing for invoicing: ' + r.missing.join(', ') }) : null);
  }

  // ---------------------------------------------------------------- create trips from fleet allocations
  function selectFromPlanning(ctx, preselect) {
    const { store } = ctx; if (!ctx.can('trip.fromPlanning')) return U.toast('Your role cannot create trips from Fleet Planning.', 'bad');
    const all = HB.views.planning.allocationRows(store).filter((a) => a.status !== 'Cancelled');
    const st = { search: '', showLinked: false, picked: new Set(preselect || []), dates: new Map() };
    const body = h('div', { class: 'stack' }); const m = U.modal({ title: 'Select from Fleet Planning', size: 'wide', body });
    const draw = () => {
      U.clear(body);
      const q = E.norm(st.search); const match = (a) => !q || E.norm(`${a.id} ${a.requestId} ${a.requestReference || ''} ${a.client} ${a.plate} ${a.assetCode} ${a.loadingFrom} ${a.destination} ${a.tripId} ${a.truckBatch}`).includes(q);
      const unlinked = all.filter((a) => !a.trip && !a.tripLogId && match(a)); const linked = all.filter((a) => (a.trip || a.tripLogId) && match(a));
      body.append(h('p', { class: 'small muted', text: 'Approved allocations not yet converted into trips. Tick the trucks that were deployed: each becomes one Trip Log entry with a generated Trip ID (JMG-TRP-YYYY-NNNNNN) and the client, vehicle, driver, batch, route, loading date, Request ID and Allocation ID filled in from the allocation. Nothing is re-typed; billing completes the selling price afterwards and no invoice is issued by this step.' }));
      body.append(h('div', { class: 'toolbar' }, h('input', { type: 'search', id: 'sfp-search', placeholder: 'Search client, plate, request, allocation, Trip ID…', value: st.search, onInput: U.debounce((e) => { st.search = e.target.value; draw(); }, 150) }), h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: st.showLinked ? true : null, onChange: (e) => { st.showLinked = e.target.checked; draw(); } }), ` Show allocations already in the Trip Log (${linked.length})`)));
      if (!unlinked.length && !st.showLinked) body.append(h('div', { class: 'empty', text: q ? 'No unlinked allocation matches the search. Tick "Show allocations already in the Trip Log" to reopen an existing trip.' : 'Every live allocation is already in the Trip Log.' }));
      if (unlinked.length) {
        const byReq = new Map(); for (const a of unlinked) { if (!byReq.has(a.requestId)) byReq.set(a.requestId, []); byReq.get(a.requestId).push(a); }
        const list = h('div', { class: 'check-list', id: 'sfp-list' });
        for (const [req, as] of byReq) { list.append(h('label', { style: { background: 'var(--surface-2)', fontWeight: 600 } }, h('input', { type: 'checkbox', checked: as.every((a) => st.picked.has(a.id)) ? true : null, onChange: (e) => { for (const a of as) { if (e.target.checked) st.picked.add(a.id); else st.picked.delete(a.id); } draw(); } }), h('span', { text: `Request ${req || '—'}${as[0].requestReference ? ' (' + as[0].requestReference + ')' : ''} · ${as[0].client} · ${as[0].loadingFrom} → ${as[0].destination}` }), h('span', { class: 'small muted', text: `${as.length} truck${as.length > 1 ? 's' : ''}` })));
          for (const a of as) { if (!st.dates.has(a.id)) st.dates.set(a.id, a.plannedDeploymentDate || a.plannedLoadingDate || U.todayISO()); list.append(h('label', {}, h('input', { type: 'checkbox', checked: st.picked.has(a.id) ? true : null, onChange: (e) => { if (e.target.checked) st.picked.add(a.id); else st.picked.delete(a.id); draw(); } }), h('span', { class: 'grow' }, `${a.id} · ${a.plate}${a.assetCode ? ' (' + a.assetCode + ')' : ''} · `, a.truckBatch ? U.pill(a.truckBatch, a.truckBatch === 'New Batch' ? 'info' : 'neutral') : null, ` · ${a.vehicleType || ''} ${a.tonnage || ''} · planned loading ${U.date(a.plannedLoadingDate)} · `, h('span', { class: 'pill info', text: 'Trip ID generated on conversion' }), ' ', U.pill(a.status, a.status === 'Planned' ? 'warn' : 'info')), h('span', { class: 'row small' }, 'Dispatched ', h('input', { type: 'date', value: st.dates.get(a.id), onChange: (e) => st.dates.set(a.id, e.target.value), onClick: (e) => e.stopPropagation() })))); }
        }
        body.append(list);
      }
      if (st.showLinked) body.append(h('div', { class: 'table-frame short' }, linked.length ? h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Allocation', 'Request', 'Client', 'Truck', 'Planned loading', 'Trip Log entry', 'Trip ID', 'Invoice status', ''].map((x) => h('th', { text: x })))), h('tbody', {}, linked.map((a) => h('tr', {}, h('td', { class: 'num', text: a.id + (a.split ? ' (split)' : '') }), h('td', { class: 'num', text: a.requestId || '' }), h('td', { text: a.client }), h('td', { text: a.plate }), h('td', { text: U.date(a.plannedLoadingDate) }), h('td', { text: a.trip ? `${U.date(a.trip.dateDispatched)} · ${a.trip.waybillStatus}` : a.tripLogId }), h('td', { text: (a.trip && a.trip.journeyPlanId) || a.tripId || 'Pending' }), h('td', { text: a.trip ? a.trip.invoiceStatus : '' }), h('td', {}, a.trip ? h('button', { class: 'btn sm', onClick: () => { m.close(); openDetail(ctx, a.trip.id); } }, 'Open trip') : ''))))) : h('div', { class: 'empty', text: 'No linked allocation matches.' })));
      const n = st.picked.size;
      m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', id: 'sfp-create', disabled: n ? null : true, onClick: async () => {
        let made = 0; const errors = [];
        for (const id of [...st.picked]) { try { await store.createTripFromAllocation(id, { dateDispatched: st.dates.get(id) }); made++; } catch (e) { errors.push(`${id}: ${e.message}`); } }
        m.close(); view.draw(); if (made) U.toast(`${made} trip${made > 1 ? 's' : ''} created from Fleet Planning with generated Trip IDs.`, 'good'); if (errors.length) U.toast(errors.join(' | '), 'bad');
      } }, `Create ${n || ''} trip${n === 1 ? '' : 's'}`)]);
    };
    draw();
  }
  view.selectFromPlanning = selectFromPlanning;

  function pickRate(ctx, t) {
    const { store } = ctx; if (!ctx.canField('agreedRateId')) return U.toast('Your role cannot choose the agreed rate.', 'bad');
    const list = h('div', { class: 'radio-list' }, t.agreedCandidates.map((r) => h('label', {}, h('input', { type: 'radio', name: 'rate', value: r.id, checked: t.agreedRateId === r.id ? true : null }), h('span', { class: 'grow' }, `${U.money(r.price)} · ${r.contractType || 'any contract type'} · effective ${U.date(r.effectiveDate)}${r.expiryDate ? ' to ' + U.date(r.expiryDate) : ''}`, r.remarks ? h('div', { class: 'small muted', text: r.remarks }) : null))));
    const m = U.modal({ title: 'Several agreed rates match this trip', size: 'narrow', body: h('div', { class: 'stack' }, h('p', { class: 'small muted', text: 'The priority rule (contract-type match, then latest effective date) could not separate these rates. Choose the one that applies.' }), list) });
    m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => { const v = list.querySelector('input:checked'); if (!v) return; try { await store.saveTrip({ id: t.id, agreedRateId: v.value }, { expectedVersion: t.version }); m.close(); view.draw(true); } catch (e) { U.toast(e.message, 'bad'); } } }, 'Apply rate')]);
  }

  // ---------------------------------------------------------------- import
  function importDialog(ctx) {
    const { store } = ctx;
    const file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv' });
    const body = h('div', { class: 'stack' }, h('p', { class: 'small muted', text: 'Upload a Trip Log export or any sheet with the same column headings. Rows that match an existing trip (same date, plate, client, waybill, journey plan and selling price) are flagged as duplicates and skipped unless you choose otherwise.' }), U.field('Excel or CSV file', file), h('div', { id: 'imp-result' }));
    const m = U.modal({ title: 'Import trips from Excel', size: 'wide', body });
    m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Close')]);
    file.addEventListener('change', async () => {
      const res = body.querySelector('#imp-result'); U.clear(res); if (!file.files[0]) return;
      try {
        const wb = await HB.exporter.readWorkbook(file.files[0]);
        const sheetSel = U.select(wb.sheets.map((s, i) => [i, `${s.name} (${s.rows.length} rows)`]), 0);
        const out = h('div', { class: 'stack' });
        const analyse = () => {
          const s = wb.sheets[Number(sheetSel.value)]; const map = E.mapHeaders(s.headers); U.clear(out);
          const mapped = Object.keys(map); if (!map.dateDispatched || !map.client) { out.append(h('div', { class: 'notice bad', text: `Could not find the "Date Dispatched" and "CLIENT NAME" columns in sheet ${s.name}. Found: ${s.headers.filter(Boolean).join(', ')}` })); return; }
          const existing = new Set(store.trips().map(E.dupKey)); const seen = new Set();
          const items = s.rows.map((r, i) => { const t = E.rowToTrip(r, map); const key = E.dupKey(t); const dup = existing.has(key) || seen.has(key); seen.add(key); const errors = E.validateTrip(t, store.ctx()).filter((e) => !e.startsWith('Plate') || !t.plate); return { t, dup, errors, row: i + 2 }; });
          const ok = items.filter((x) => !x.dup && !x.errors.length), dups = items.filter((x) => x.dup), bad = items.filter((x) => x.errors.length && !x.dup);
          const includeDups = h('input', { type: 'checkbox' });
          out.append(h('div', { class: 'row' }, h('span', { class: 'chip', text: `Columns mapped: ${mapped.length}` }), h('span', { class: 'chip', text: `New trips: ${ok.length}` }), h('span', { class: 'chip', text: `Duplicates: ${dups.length}` }), h('span', { class: 'chip', text: `Invalid: ${bad.length}` })));
          if (bad.length) out.append(h('div', { class: 'notice warn' }, h('strong', {}, 'Rows with problems (skipped): '), bad.slice(0, 8).map((x) => `row ${x.row}: ${x.errors[0]}`).join(' · ')));
          if (dups.length) out.append(h('label', { class: 'row small' }, includeDups, ` Import the ${dups.length} duplicate row(s) anyway`));
          const prev = h('div', { class: 'table-frame short' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Row', 'Dispatched', 'Client', 'Plate', 'From', 'To', 'Waybill', 'Selling Price', 'Payment', 'Status'].map((x) => h('th', { text: x })))), h('tbody', {}, items.slice(0, 50).map((x) => h('tr', {}, h('td', { text: x.row }), h('td', { text: x.t.dateDispatched }), h('td', { text: x.t.client }), h('td', { text: x.t.plate }), h('td', { text: x.t.loadingFrom }), h('td', { text: x.t.loadingTo }), h('td', { text: x.t.waybill }), h('td', { class: 'money', text: U.money(x.t.sellingPrice) }), h('td', { text: x.t.paymentStatus }), h('td', {}, x.dup ? U.pill('Duplicate', 'warn') : x.errors.length ? U.pill('Invalid', 'bad') : U.pill('New', 'good')))))));
          out.append(prev);
          const btn = h('button', { class: 'btn primary', onClick: async () => {
            const chosen = includeDups.checked ? [...ok, ...dups] : ok; if (!chosen.length) return U.toast('Nothing to import.');
            btn.disabled = true; btn.textContent = 'Importing…';
            const now = U.nowISO(); const who = store.user.username;
            const trips = chosen.map((x) => Object.assign(x.t, { id: U.id('t'), source: 'import', version: 1, createdAt: now, createdBy: who, updatedAt: now, updatedBy: who, history: [{ ts: now, user: store.user.name, changes: [{ field: 'import', from: '', to: file.files[0].name }] }] }));
            for (const t of trips) { const a = E.assetFor(t.plate, store.state.assets); if (a) { t.assetCode = a.assetCode; t.vehicleType = a.vehicleType; t.vehicleCategory = a.vehicleCategory; t.costCenter = a.costCenter; } t.truckBatch = E.batchOn(a, t.dateDispatched); }
            try { await store.bulkWriteTrips(trips); await store.writeAudit(store.auditEntry({ action: 'import', entity: 'trip', entityId: 'bulk', label: `${trips.length} trips imported from ${file.files[0].name}`, changes: [] })); U.toast(`Imported ${trips.length} trips.`, 'good'); m.close(); view.draw(); }
            catch (e) { U.toast(e.message, 'bad'); btn.disabled = false; btn.textContent = 'Import'; }
          } }, `Import ${ok.length} new trips`);
          includeDups.addEventListener('change', () => { btn.textContent = `Import ${includeDups.checked ? ok.length + dups.length : ok.length} trips`; });
          out.append(h('div', { class: 'row' }, btn));
        };
        sheetSel.addEventListener('change', analyse);
        res.append(U.field('Sheet', sheetSel), out); analyse();
      } catch (e) { res.append(h('div', { class: 'notice bad', text: e.message })); }
    });
  }

  view.openDetail = openDetail;
  HB.views.trips = view;
})();
