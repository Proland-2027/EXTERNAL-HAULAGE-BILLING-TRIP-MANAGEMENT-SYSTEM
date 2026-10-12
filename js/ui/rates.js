/* Agreed Client Price List. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine, h = U.h;
  HB.views = HB.views || {};
  const view = { title: 'Client Price List', filters: {} };

  view.render = function (root, ctx) { view.ctx = ctx; view.root = root; root.append(h('div', { class: 'stack', id: 'rates-view' })); view.draw(); };
  view.onStoreChange = () => { if (view.root && view.root.isConnected) view.draw(); };

  view.draw = function () {
    const ctx = view.ctx, store = ctx.store, wrap = view.root.querySelector('#rates-view'); if (!wrap) return; U.clear(wrap);
    const f = view.filters, today = U.todayISO();
    let rates = store.state.rates.map((r) => Object.assign({}, r, { status: E.rateStatus(r, today) }));
    if (f.client) rates = rates.filter((r) => E.norm(r.client) === E.norm(f.client));
    if (f.status) rates = rates.filter((r) => r.status === f.status);
    if (f.search) rates = rates.filter((r) => [r.client, r.loadingFrom, r.loadingTo, r.vehicleType, r.contractType, r.remarks].some((x) => E.norm(x).includes(E.norm(f.search))));
    rates = U.sortBy(rates, (r) => `${E.norm(r.client)}|${E.norm(r.loadingFrom)}|${E.norm(r.loadingTo)}|${r.effectiveDate}`);
    const manage = ctx.can('rate.manage');
    const usage = new Map(); for (const t of store.trips()) if (t.agreedRate) usage.set(t.agreedRate.id, (usage.get(t.agreedRate.id) || 0) + 1);
    wrap.append(h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: 'Search client, route, vehicle…', value: f.search || '', onInput: U.debounce((e) => { f.search = e.target.value; view.draw(); }, 200) }),
      U.select([['', 'All clients'], ...store.clientNames().map((c) => [c, c])], f.client || '', { onChange: (e) => { f.client = e.target.value; view.draw(); } }),
      U.select([['', 'All statuses'], ['Active', 'Active'], ['Expired', 'Expired'], ['Future', 'Future']], f.status || '', { onChange: (e) => { f.status = e.target.value; view.draw(); } }),
      manage ? h('button', { class: 'btn accent', onClick: () => edit(ctx, null) }, '+ New rate') : null,
      manage ? h('button', { class: 'btn', onClick: () => importRates(ctx) }, 'Import Excel') : null,
      h('button', { class: 'btn', onClick: () => HB.exporter.xlsx([{ name: 'Price List', rows: [['Client', 'Loading From', 'Loading To', 'Vehicle Type', 'Contract Type', 'Agreed Price (₦)', 'Effective Date', 'Expiry Date', 'Status', 'Remarks'], ...rates.map((r) => [r.client, r.loadingFrom, r.loadingTo, r.vehicleType, r.contractType, r.price, r.effectiveDate, r.expiryDate, r.status, r.remarks])] }], `Client_Price_List_${today}.xlsx`) }, 'Export Excel'),
      h('span', { class: 'muted small grow', style: { textAlign: 'right' }, text: `${rates.length} rate${rates.length === 1 ? '' : 's'}` })));
    wrap.append(h('div', { class: 'notice info small' }, h('strong', {}, 'Lookup rule: '), 'a trip takes the rate whose client, loading origin, destination and vehicle type match and which is in force on the dispatch date. A rate with the trip\'s contract type beats a rate with none; a different contract type never matches. Latest effective date wins. Still tied → the trip shows "Multiple rates" and the user picks one.'));
    const rows = rates.map((r) => h('tr', {}, h('td', { text: r.client }), h('td', { text: r.loadingFrom }), h('td', { text: r.loadingTo }), h('td', { text: r.vehicleType || 'Any' }), h('td', { text: r.contractType || '—' }), h('td', { class: 'money', text: U.money(r.price) }),
      h('td', { text: U.date(r.effectiveDate) }), h('td', { text: r.expiryDate ? U.date(r.expiryDate) : 'Open' }), h('td', {}, U.pill(r.status, r.status === 'Active' ? 'good' : r.status === 'Expired' ? 'neutral' : 'info')), h('td', { class: 'num', text: usage.get(r.id) || 0 }), h('td', { text: r.remarks || '' }),
      h('td', {}, manage ? h('span', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => edit(ctx, r.id) }, 'Edit'), h('button', { class: 'btn sm', onClick: () => edit(ctx, r.id, true) }, 'New version'), h('button', { class: 'btn sm danger', onClick: async () => { if (await U.confirm({ title: 'Delete rate', message: `Delete the ${r.client} ${r.loadingFrom} → ${r.loadingTo} rate? Trips keep their manually entered selling prices.`, okLabel: 'Delete', danger: true })) { await store.deleteDoc('rates', r.id, `${r.client} ${r.loadingFrom}→${r.loadingTo}`); view.draw(); } } }, 'Delete')) : '')));
    wrap.append(h('div', { class: 'table-frame' }, rates.length ? h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Client', 'Loading From', 'Loading To', 'Vehicle Type', 'Contract Type', 'Agreed Price (₦)', 'Effective', 'Expiry', 'Status', 'Trips using', 'Remarks', ''].map((x) => h('th', { text: x })))), h('tbody', {}, rows)) : h('div', { class: 'empty' }, h('strong', { text: 'No agreed rates yet.' }), h('span', { text: manage ? 'Add a rate or import a price list from Excel.' : 'An administrator can add rates.' }))));
  };

  function edit(ctx, id, asNewVersion) {
    const { store } = ctx; const r = id ? store.state.rates.find((x) => x.id === id) : null;
    const t = Object.assign({ client: view.filters.client || '', loadingFrom: '', loadingTo: '', vehicleType: '', contractType: '', price: null, effectiveDate: U.todayISO(), expiryDate: '', remarks: '' }, r || {});
    if (asNewVersion) { t.id = undefined; t.remarks = ''; t.effectiveDate = U.todayISO(); t.expiryDate = ''; }
    const inp = {};
    const F = (k, label, control, opts) => { inp[k] = control.tagName === 'SPAN' ? control.querySelector('input') : control; return U.field(label, control, opts); };
    const vehicleTypes = [...new Set(store.state.assets.map((a) => a.vehicleType))].sort();
    const body = h('div', { class: 'form-grid' },
      F('client', 'Client Name', U.datalistInput('dl-rc', store.clientNames(), t.client)),
      F('vehicleType', 'Vehicle Type', U.select([['', 'Any vehicle type'], ...vehicleTypes.map((v) => [v, v])], t.vehicleType)),
      F('loadingFrom', 'Loading Origin', U.datalistInput('dl-rf', store.locationNames(), t.loadingFrom)),
      F('loadingTo', 'Delivery Destination', U.datalistInput('dl-rt', store.locationNames(), t.loadingTo)),
      F('contractType', 'Contract Type (optional)', h('input', { type: 'text', value: t.contractType || '' }), { help: 'Leave blank to apply to every contract type.' }),
      F('price', 'Agreed Price (₦)', h('input', { type: 'number', step: '0.01', min: '0', value: t.price ?? '' })),
      F('effectiveDate', 'Effective Date', h('input', { type: 'date', value: t.effectiveDate || '' })),
      F('expiryDate', 'Expiry Date (optional)', h('input', { type: 'date', value: t.expiryDate || '' })),
      F('remarks', 'Remarks', h('input', { type: 'text', value: t.remarks || '' }), { span2: true }));
    const m = U.modal({ title: id && !asNewVersion ? 'Edit agreed rate' : asNewVersion ? 'New rate version' : 'New agreed rate', body });
    m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
      const d = { id: asNewVersion ? undefined : id || undefined }; for (const k of Object.keys(inp)) d[k] = inp[k].type === 'number' ? E.num(inp[k].value) : E.clean(inp[k].value);
      if (!d.client || !d.loadingFrom || !d.loadingTo || !(d.price >= 0) || !d.effectiveDate) return U.toast('Client, origin, destination, price and effective date are required.', 'bad');
      if (d.expiryDate && d.expiryDate < d.effectiveDate) return U.toast('Expiry date cannot be before the effective date.', 'bad');
      const overlap = store.state.rates.find((x) => x.id !== d.id && E.norm(x.client) === E.norm(d.client) && E.norm(x.loadingFrom) === E.norm(d.loadingFrom) && E.norm(x.loadingTo) === E.norm(d.loadingTo) && E.norm(x.vehicleType) === E.norm(d.vehicleType) && E.norm(x.contractType) === E.norm(d.contractType) && (!x.expiryDate || x.expiryDate >= d.effectiveDate) && (!d.expiryDate || d.expiryDate >= x.effectiveDate));
      if (overlap && !(await U.confirm({ title: 'Overlapping rate', message: `An existing rate (${U.money(overlap.price)} from ${U.date(overlap.effectiveDate)}) overlaps this period. Trips in the overlap will show "Multiple rates" unless the old rate gets an expiry date. Save anyway?`, okLabel: 'Save anyway' }))) return;
      try { await store.saveDoc('rates', d, { expectedVersion: r && !asNewVersion ? r.version : undefined, label: `${d.client} ${d.loadingFrom}→${d.loadingTo} ${U.money(d.price)}` }); m.close(); view.draw(); U.toast('Rate saved.', 'good'); } catch (e) { U.toast(e.message, 'bad'); }
    } }, 'Save rate')]);
  }

  function importRates(ctx) {
    const { store } = ctx; const file = h('input', { type: 'file', accept: '.xlsx,.xls,.csv' }); const res = h('div');
    const m = U.modal({ title: 'Import price list', body: h('div', { class: 'stack' }, h('p', { class: 'small muted', text: 'Columns: Client, Loading From, Loading To, Vehicle Type, Contract Type, Agreed Price, Effective Date, Expiry Date, Remarks (header names are matched loosely).' }), U.field('File', file), res) });
    m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Close')]);
    file.addEventListener('change', async () => {
      try {
        const wb = await HB.exporter.readWorkbook(file.files[0]); const s = wb.sheets[0]; const hdr = s.headers.map(E.norm);
        const col = (names) => hdr.findIndex((x) => names.includes(x));
        const ci = { client: col(['client', 'client name']), from: col(['loading from', 'origin', 'loading origin', 'from']), to: col(['loading to', 'destination', 'delivery destination', 'to']), vt: col(['vehicle type', 'type of vehicle']), ct: col(['contract type']), price: col(['agreed price', 'agreed price (₦)', 'price', 'rate', 'agreed client price (₦)']), eff: col(['effective date', 'effective']), exp: col(['expiry date', 'expiry']), rem: col(['remarks', 'notes']) };
        if (ci.client < 0 || ci.from < 0 || ci.to < 0 || ci.price < 0) throw new Error('Client, Loading From, Loading To and Agreed Price columns are required.');
        const g = (r, i) => (i >= 0 ? r[i] : '');
        const items = s.rows.map((r) => ({ client: E.clean(g(r, ci.client)), loadingFrom: E.clean(g(r, ci.from)), loadingTo: E.clean(g(r, ci.to)), vehicleType: E.clean(g(r, ci.vt)), contractType: E.clean(g(r, ci.ct)), price: E.num(g(r, ci.price)), effectiveDate: E.excelDateToISO(g(r, ci.eff)) || U.todayISO(), expiryDate: E.excelDateToISO(g(r, ci.exp)), remarks: E.clean(g(r, ci.rem)) })).filter((x) => x.client && x.loadingFrom && x.loadingTo && x.price !== null);
        U.clear(res); res.append(h('div', { class: 'notice info', text: `${items.length} valid rate rows found.` }), h('button', { class: 'btn primary', onClick: async () => { for (const it of items) await store.saveDoc('rates', it, { silent: true }); await store.writeAudit(store.auditEntry({ action: 'import', entity: 'rates', entityId: 'bulk', label: `${items.length} rates imported from ${file.files[0].name}`, changes: [] })); U.toast(`Imported ${items.length} rates.`, 'good'); m.close(); view.draw(); } }, `Import ${items.length} rates`));
      } catch (e) { U.clear(res); res.append(h('div', { class: 'notice bad', text: e.message })); }
    });
  }
  HB.views.rates = view;
})();
