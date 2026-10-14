/* Fleet Movement Report (FMR): live truck statuses, tracking updates, availability categories, planning dashboard, runway. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine, P = HB.planning, h = U.h;
  HB.views = HB.views || {};

  const GROUP_KIND = { Free: 'good', 'On trip': 'info', Down: 'bad', Unavailable: 'neutral', '': 'neutral' };
  const CAT_KIND = { 'Available and Unplanned': 'good', 'Available but Already Allocated': 'info', 'Expected to Become Available': 'warn', 'Currently on Trip': 'info', 'In Workshop / Breakdown': 'bad', 'Unavailable or Status Unconfirmed': 'neutral' };
  const batchOf = (store, plate) => E.batchOn(E.assetFor(plate, store.state.assets), U.todayISO());
  const tile = (label, value, sub, kind, onClick) => h('div', { class: 'tile ' + (kind || '') + (onClick ? ' clickable' : ''), onClick }, h('span', { class: 'label', text: label }), h('span', { class: 'value', text: value }), sub ? h('span', { class: 'sub', text: sub }) : null);

  /** Every active truck with its computed FMR columns. */
  function fleetRows(store) {
    const pctx = store.planningCtx();
    return store.state.fleet.filter((t) => t.active !== false).map((truck) => ({ truck, st: P.truckStatus(truck, pctx), batch: batchOf(store, truck.plate) }));
  }
  function applyFilters(rows, f) {
    const q = E.norm(f.search || '');
    return rows.filter((r) => (!f.category || r.st.category === f.category) && (!f.status || r.truck.status === f.status) && (!f.truckBatch || r.batch === f.truckBatch) && (!f.client || E.norm(r.truck.client) === E.norm(f.client)) && (!f.bodyType || r.truck.bodyType === f.bodyType)
      && (!f.warnings || r.st.warnings.length) && (!q || E.norm(`${r.truck.plate} ${r.truck.driver} ${r.truck.client} ${r.truck.destination} ${r.truck.status} ${r.truck.tripId} ${r.truck.remarks}`).includes(q)));
  }
  function fleetFilterBar(ctx, f, redraw, rows) {
    const { store } = ctx; const set = (k) => (e) => { f[k] = e.target.value; redraw(); }; const opt = (list) => [['', 'All'], ...list.map((x) => [x, x])];
    return h('div', { class: 'filters card' },
      U.field('Availability category', U.select(opt(P.AVAILABILITY_CATEGORIES), f.category || '', { onChange: set('category') })),
      U.field('Status', U.select(opt(P.statusList(store.state.planning).map((s) => s.status)), f.status || '', { onChange: set('status') })),
      U.field('Select Truck Batch', U.select([['', 'All Batches'], ['New Batch', 'New Batch'], ['Old Batch', 'Old Batch'], ['3rd Party', '3rd Party / unclassified']], f.truckBatch || '', { onChange: set('truckBatch') })),
      U.field('Body type', U.select(opt([...new Set(rows.map((r) => r.truck.bodyType).filter(Boolean))].sort()), f.bodyType || '', { onChange: set('bodyType') })),
      U.field('Client', U.select(opt([...new Set(rows.map((r) => r.truck.client).filter(Boolean))].sort()), f.client || '', { onChange: set('client') })),
      U.field('Warnings', U.select([['', 'All trucks'], ['1', 'Only trucks with warnings']], f.warnings || '', { onChange: set('warnings') })),
      h('button', { class: 'btn', onClick: () => { for (const k of Object.keys(f)) delete f[k]; redraw(); } }, 'Clear'));
  }
  const dateCell = (d) => h('td', { text: U.date(d) });
  const warnCell = (st) => h('td', { style: { whiteSpace: 'normal', minWidth: '260px', maxWidth: '420px' } }, st.warnings.length ? st.warnings.map((w) => h('div', { class: 'small ' + (/overdue|Double|unconfirmed|verification/i.test(w) ? 'var-below' : 'muted'), text: '• ' + w })) : h('span', { class: 'small muted', text: '—' }));

  // ---------------------------------------------------------------- FMR view
  const fmr = { title: 'Fleet Movement Report', filters: {}, tab: 'table', sort: 'plate' };
  fmr.render = function (root, ctx) { fmr.ctx = ctx; fmr.root = root; root.append(h('div', { class: 'stack', id: 'fmr' })); fmr.draw(); if (ctx.params && ctx.params.plate) setTimeout(() => { const t = ctx.store.state.fleet.find((x) => P.plateKey(x.plate) === P.plateKey(ctx.params.plate)); if (t) updateStatus(ctx, t.id); }, 30); };
  fmr.onStoreChange = () => { if (fmr.root && fmr.root.isConnected) fmr.draw(); };
  fmr.draw = function () {
    const ctx = fmr.ctx, store = ctx.store, wrap = fmr.root.querySelector('#fmr'); if (!wrap) return; U.clear(wrap);
    const all = fleetRows(store); const f = fmr.filters; let rows = applyFilters(all, f);
    const k = P.fleetKpis(store.planningCtx()); const canUpdate = ctx.can('fmr.update');
    wrap.append(h('div', { class: 'tiles' },
      tile('Trucks on FMR', U.int(k.totalFleet), `${U.int(all.filter((r) => r.truck.status).length)} with a status`), tile('Available now', U.int(k.available), `${U.int(k.availableUnplanned)} unplanned`, 'good', () => { f.category = P.AVAILABILITY_CATEGORIES[0]; fmr.draw(); }),
      tile('On trip', U.int(k.onTrip), `${U.int(k.backToday)} back today · ${U.int(k.backTomorrow)} tomorrow`, 'info'), tile('Workshop / breakdown', U.int(k.inWorkshop + k.breakdown), null, k.inWorkshop + k.breakdown ? 'bad' : ''),
      tile('Tracking update overdue', U.int(k.trackingOverdue), `> ${store.planningSetup().trackingOverdueHours} h since last update`, k.trackingOverdue ? 'bad' : 'good', () => { f.warnings = '1'; fmr.draw(); }), tile('Status unconfirmed', U.int(k.unconfirmed), 'needs tracking verification', k.unconfirmed ? 'warn' : 'good', () => { f.category = P.AVAILABILITY_CATEGORIES[5]; fmr.draw(); }),
      tile('Double booked', U.int(k.doubleBooked), null, k.doubleBooked ? 'bad' : 'good'), tile('Delivery to confirm', U.int(k.deliveryChecks), 'outbound longer than the run', k.deliveryChecks ? 'warn' : 'good'),
      tile('Last FMR update', store.state.planning.lastFmrUpdate ? U.dateTime(store.state.planning.lastFmrUpdate) : '—', store.state.planning.lastFmrUpdate ? `${store.state.planning.lastFmrUpdateRows} trucks by ${store.state.planning.lastFmrUpdateBy}` : 'no Excel upload yet', store.state.planning.lastFmrUpdate && (Date.now() - Date.parse(store.state.planning.lastFmrUpdate)) > 12 * 3600000 ? 'warn' : 'info')));
    const search = h('input', { type: 'search', placeholder: 'Search plate, driver, client, destination…', value: f.search || '', onInput: U.debounce((e) => { f.search = e.target.value; fmr.draw(); }, 200) });
    wrap.append(h('div', { class: 'toolbar' }, search,
      h('button', { class: 'btn' + (fmr.tab === 'table' ? ' primary' : ''), onClick: () => { fmr.tab = 'table'; fmr.draw(); } }, 'Movement report'),
      h('button', { class: 'btn' + (fmr.tab === 'cards' ? ' primary' : ''), onClick: () => { fmr.tab = 'cards'; fmr.draw(); } }, 'By availability'),
      canUpdate ? h('button', { class: 'btn accent', onClick: () => addTruck(ctx) }, '+ Add truck to FMR') : null,
      ctx.can('export') ? h('button', { class: 'btn', id: 'btn-fmr-download', onClick: () => HB.fmrExcel.downloadCurrent(ctx) }, 'Download current FMR') : null,
      canUpdate ? h('button', { class: 'btn', id: 'btn-fmr-template', onClick: () => HB.fmrExcel.downloadTemplate(ctx) }, 'Blank update template') : null,
      canUpdate ? h('button', { class: 'btn primary', id: 'btn-fmr-upload', onClick: () => HB.fmrExcel.upload(ctx) }, 'Upload completed FMR') : null,
      ctx.can('export') ? h('button', { class: 'btn', onClick: () => HB.exporter.xlsx([{ name: 'FMR', rows: [['Plate', 'Truck Batch', 'Body', 'Tonnage', 'Driver', 'Status', 'Status date', 'Updated by', 'Client', 'Route', 'Loading date', 'Destination', 'Trip ID', 'Back on ground', 'Committed until', 'Free from', 'Days until free', 'Confidence', 'Availability category', 'Next client', 'Next loading', 'Warnings'], ...rows.map((r) => [r.truck.plate, r.batch, r.truck.bodyType, r.truck.tonnage, r.truck.driver, r.truck.status, r.truck.statusAt, r.truck.updatedBy, r.truck.client, P.routeLabel(r.st.route), r.truck.loadingDate, r.truck.destination, r.truck.tripId, r.st.backOnGround, r.st.committedUntil, r.st.freeFrom, r.st.daysUntilFree, r.st.confidence, r.st.category, r.st.nextClient, r.st.nextLoadingDate, r.st.warnings.join(' | ')])] }], `FMR_${U.todayISO()}.xlsx`) }, 'Export Excel') : null,
      h('span', { class: 'muted small grow', style: { textAlign: 'right' }, text: `${U.int(rows.length)} of ${U.int(all.length)} trucks · as of ${U.dateTime(U.nowISO())}` })));
    wrap.append(fleetFilterBar(ctx, f, fmr.draw, all));
    rows = U.sortBy(rows, (r) => (fmr.sort === 'free' ? (r.st.freeFrom || '9999') + r.truck.plate : fmr.sort === 'status' ? (r.st.group || 'zz') + r.truck.status + r.truck.plate : P.plateKey(r.truck.plate)));
    if (fmr.tab === 'cards') { wrap.append(categoryCards(ctx, rows)); return; }
    const th = (t, key) => h('th', { class: fmr.sort === key ? 'sorted asc' : '', style: { cursor: key ? 'pointer' : null }, onClick: key ? () => { fmr.sort = key; fmr.draw(); } : null }, t);
    wrap.append(h('div', { class: 'table-frame' }, rows.length ? h('table', { class: 'data', id: 'fmr-table' }, h('thead', {}, h('tr', {}, th('Plate', 'plate'), th('Batch'), th('Body / Ton'), th('Driver'), th('Status', 'status'), th('Last update'), th('Client · Route'), th('Loaded'), th('Destination'), th('Trip ID'), th('Back on ground'), th('Committed until'), th('Free from', 'free'), th('Days'), th('Confidence'), th('Availability'), th('Next planned'), th('Warnings'), th(''))),
      h('tbody', {}, rows.map((r) => { const t = r.truck, st = r.st; return h('tr', { class: st.trackingOverdue ? 'dirty' : '' },
        h('td', {}, h('strong', { text: t.plate }), h('div', { class: 'tiny muted', text: t.assetCode || '' })), h('td', {}, r.batch ? U.pill(r.batch, r.batch === 'New Batch' ? 'info' : 'neutral') : ''), h('td', { text: [t.bodyType, t.tonnage].filter(Boolean).join(' · ') }), h('td', { text: t.driver || '' }),
        h('td', {}, t.status ? U.pill(t.status, GROUP_KIND[st.group]) : U.pill('No status', 'bad')),
        h('td', {}, h('div', { text: U.dateTime(t.statusAt) }), h('div', { class: 'tiny ' + (st.trackingOverdue ? 'var-below' : 'muted'), text: st.trackingOverdue ? 'Tracking Update Overdue' : (t.statusBy || t.updatedBy || '') })),
        h('td', {}, h('div', { text: t.client || '' }), h('div', { class: 'tiny muted', text: st.route ? `${st.route.id} ${st.route.loadingPoint} > ${st.route.destination} · ${st.tat.tat}d` : (t.loadingFrom ? `${t.loadingFrom} > ${t.destination || ''}` : '') })),
        dateCell(t.loadingDate), h('td', { text: t.destination || t.currentLocation || '' }), h('td', {}, t.tripId ? h('span', { class: 'num', text: t.tripId }) : h('span', { class: 'tiny muted', text: st.group === 'On trip' ? 'Pending' : '' })),
        dateCell(st.backOnGround), dateCell(st.committedUntil), h('td', {}, st.freeFrom ? h('strong', { text: U.date(st.freeFrom) }) : h('span', { class: 'muted', text: '—' })), h('td', { class: 'num', text: st.daysUntilFree === null ? '' : st.daysUntilFree }),
        h('td', {}, U.pill(st.confidence, st.confidence === 'Firm' ? 'good' : st.confidence === 'Estimate' ? 'warn' : 'neutral')), h('td', {}, U.pill(st.category, CAT_KIND[st.category])),
        h('td', { class: 'small', text: st.nextClient ? `${st.nextClient} · ${U.date(st.nextLoadingDate)}` : '' }), warnCell(st),
        h('td', {}, h('span', { class: 'row' }, canUpdate ? h('button', { class: 'btn sm primary', onClick: () => updateStatus(ctx, t.id) }, 'Update') : h('button', { class: 'btn sm', onClick: () => updateStatus(ctx, t.id) }, 'View'), st.returnUnconfirmed && canUpdate ? h('button', { class: 'btn sm', title: 'Confirm the truck is back and available', onClick: () => confirmBack(ctx, t) }, 'Confirm back') : null))); }))) : h('div', { class: 'empty' }, h('strong', { text: 'No trucks match.' }), h('span', { text: 'Clear the filters or add trucks to the FMR.' }))));
  };

  function categoryCards(ctx, rows) {
    return h('div', { class: 'grid-2' }, P.AVAILABILITY_CATEGORIES.map((cat) => { const mine = rows.filter((r) => r.st.category === cat); return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: cat }), U.pill(`${mine.length} truck${mine.length === 1 ? '' : 's'}`, CAT_KIND[cat])),
      mine.length ? h('div', { class: 'stack', style: { gap: '6px' } }, mine.map((r) => h('div', { class: 'row between', style: { borderBottom: '1px solid var(--line)', paddingBottom: '4px' } }, h('span', {}, h('strong', { text: r.truck.plate }), h('span', { class: 'small muted', text: `  ${r.truck.bodyType || ''} ${r.truck.tonnage || ''} · ${r.truck.status || 'no status'}${r.truck.client ? ' · ' + r.truck.client : ''}` })), h('span', { class: 'small' }, r.st.freeFrom ? `free ${U.date(r.st.freeFrom)}` : '', r.st.nextClient ? h('span', { class: 'chip', style: { marginLeft: '6px' }, text: `next: ${r.st.nextClient}` }) : null, h('button', { class: 'btn sm', style: { marginLeft: '6px' }, onClick: () => updateStatus(ctx, r.truck.id) }, 'Open'))))) : h('div', { class: 'muted small', text: 'None.' })); }));
  }

  // ---------------------------------------------------------------- status update
  function updateStatus(ctx, id) {
    const { store } = ctx; const truck = store.state.fleet.find((t) => t.id === id); if (!truck) return;
    const planning = store.state.planning; const statuses = P.statusList(planning); const canUpdate = ctx.can('fmr.update');
    const t = Object.assign({}, truck);
    const routesFor = (client) => store.state.routes.filter((r) => !client || E.norm(r.client) === E.norm(client));
    const inp = {
      status: U.select([['', '— no status —'], ...statuses.map((s) => [s.status, `${s.status} (${s.group})`])], t.status),
      statusAt: h('input', { type: 'datetime-local', value: toLocal(t.statusAt || U.nowISO()) }),
      client: U.datalistInput('dl-fmr-client', [...new Set(store.state.routes.map((r) => r.client))].sort(), t.client),
      routeId: U.select([['', '— none —'], ...routesFor(t.client).map((r) => [r.id, P.routeLabel(r)])], t.routeId),
      loadingFrom: U.datalistInput('dl-fmr-from', store.locationNames(), t.loadingFrom), destination: U.datalistInput('dl-fmr-to', store.locationNames(), t.destination),
      loadingDate: h('input', { type: 'date', value: t.loadingDate || '' }), etaDelivery: h('input', { type: 'date', value: t.etaDelivery || '' }), actualDelivery: h('input', { type: 'date', value: t.actualDelivery || '' }), etaOffloadDone: h('input', { type: 'date', value: t.etaOffloadDone || '' }), etaReturn: h('input', { type: 'date', value: t.etaReturn || '' }),
      currentLocation: U.datalistInput('dl-fmr-loc', store.locationNames(), t.currentLocation), workshopRelease: h('input', { type: 'date', value: t.workshopRelease || '' }), daysDown: h('input', { type: 'number', min: '0', value: t.daysDown ?? '' }),
      driver: h('input', { type: 'text', value: t.driver || '' }), bodyType: U.datalistInput('dl-fmr-body', Object.keys(P.DEFAULT_BODY_RUNS).concat(Object.keys((planning && planning.bodyRuns) || {})).filter((v, i, a) => a.indexOf(v) === i), t.bodyType), tonnage: U.datalistInput('dl-fmr-ton', ['30T', '40T', '45T', '20T', '15T'], t.tonnage),
      tripId: h('input', { type: 'text', value: t.tripId || '', placeholder: 'Current Trip ID (from the Trip Log)' }), remarks: h('textarea', { rows: 2 }, t.remarks || ''),
    };
    const val = (k) => (inp[k].tagName === 'SPAN' ? inp[k].querySelector('input') : inp[k]).value;
    if (!canUpdate) for (const i of Object.values(inp)) (i.tagName === 'SPAN' ? i.querySelector('input') : i).disabled = true;
    inp.client.querySelector('input').addEventListener('input', () => { const sel = inp.routeId; U.clear(sel); for (const [v, l] of [['', '— none —'], ...routesFor(val('client')).map((r) => [r.id, P.routeLabel(r)])]) sel.append(h('option', { value: v }, l)); });
    inp.routeId.addEventListener('change', () => { const r = store.state.routes.find((x) => x.id === inp.routeId.value); if (r) { inp.loadingFrom.querySelector('input').value = r.loadingPoint; inp.destination.querySelector('input').value = r.destination; if (!val('client')) inp.client.querySelector('input').value = r.client; } preview(); });
    const prev = h('div', { class: 'card stack', style: { gap: '6px' } });
    const draft = () => { const d = Object.assign({}, t); for (const k of Object.keys(inp)) d[k] = k === 'daysDown' ? E.num(val(k)) : k === 'statusAt' ? fromLocal(val(k)) : E.clean(val(k)); return d; };
    const preview = () => { const d = draft(); const st = P.truckStatus(d, store.planningCtx()); U.clear(prev);
      const line = (k, v) => h('div', { class: 'row between' }, h('span', { class: 'muted small', text: k }), h('span', { class: 'num', text: v || '—' }));
      prev.append(h('div', { class: 'label', text: 'Calculated availability' }), h('div', { class: 'row between' }, h('span', { class: 'muted small', text: 'Group' }), U.pill(st.group || 'none', GROUP_KIND[st.group])), line('Route turnaround', st.route ? `${st.tat.out}d out · ${st.tat.offload}d offload · ${st.tat.back}d back = ${st.tat.tat}d` : `${st.tat.tat}d default (no route)`), line('Back on ground', U.date(st.backOnGround)), line('Committed until (allocations)', U.date(st.committedUntil)), line('Free from', U.date(st.freeFrom)), line('Confidence', st.confidence), h('div', { class: 'row between' }, h('span', { class: 'muted small', text: 'Availability category' }), U.pill(st.category, CAT_KIND[st.category])),
        st.warnings.length ? h('div', { class: 'notice warn', style: { whiteSpace: 'normal' } }, st.warnings.map((w) => h('div', { text: '• ' + w }))) : h('div', { class: 'notice good', text: 'No warnings.' }),
        st.activeAllocations.length ? h('div', { class: 'small' }, h('div', { class: 'label', text: 'Planned allocations' }), st.activeAllocations.map((a) => h('div', { text: `${a.id} · ${a.client} · load ${U.date(a.plannedLoadingDate)} · back ${U.date(a.backOnGround)} · ${a.status}` }))) : null); };
    for (const i of Object.values(inp)) (i.tagName === 'SPAN' ? i.querySelector('input') : i).addEventListener('input', preview);
    inp.status.addEventListener('change', () => { if (inp.status.value !== truck.status) inp.statusAt.value = toLocal(U.nowISO()); preview(); });
    preview();
    const form = h('div', { class: 'form-grid' },
      U.field('Operational status', inp.status, { span2: true, help: 'Statuses and their availability group are configured in Settings → Fleet planning.' }), U.field('Date/time of this status', inp.statusAt, { help: 'Set automatically when the status changes; adjust if the update was late.' }),
      U.field('Client', inp.client), U.field('Route it is running', inp.routeId, { span2: true }), U.field('Loading point', inp.loadingFrom), U.field('Destination / drop point', inp.destination),
      U.field('Date loaded', inp.loadingDate), U.field('Estimated delivery', inp.etaDelivery), U.field('Actual delivery', inp.actualDelivery), U.field('Est. offloading complete', inp.etaOffloadDone), U.field('Estimated return', inp.etaReturn, { help: 'Overrides the route formula when set.' }),
      U.field('Current location', inp.currentLocation), U.field('Workshop release date', inp.workshopRelease), U.field('Days down (if no release date)', inp.daysDown),
      U.field('Driver', inp.driver), U.field('Body type', inp.bodyType), U.field('Tonnage', inp.tonnage), U.field('Current Trip ID', inp.tripId, { help: 'The generated Trip ID of the trip the truck is running (from the Trip Log).' }), U.field('Remarks', inp.remarks, { span2: true }));
    const hist = h('div', { class: 'history' }, (t.statusHistory || []).slice().reverse().slice(0, 8).map((x) => h('div', { class: 'h-item' }, h('div', { class: 'h-meta', text: `${U.dateTime(x.at)} · ${x.by}` }), h('div', { class: 'small', text: `${x.status}${x.destination ? ' · ' + x.destination : ''}${x.remarks ? ' · ' + x.remarks : ''}` }))));
    const m = U.modal({ title: `${truck.plate} · ${truck.bodyType || ''} ${truck.tonnage || ''}`, size: 'wide', body: h('div', { class: 'grid-2' }, h('div', { class: 'stack' }, form, (t.statusHistory || []).length ? h('div', { class: 'label', text: 'Status history' }) : null, hist), prev) });
    const acts = [h('button', { class: 'btn', onClick: () => m.close() }, 'Close')];
    if (canUpdate) acts.push(h('button', { class: 'btn primary', onClick: async () => {
      const d = draft(); d.status = P.canonicalStatus(d.status, planning) || d.status;
      if (d.tripId && !E.tripIdValid(d.tripId, store.planningSetup().tripIdPattern)) return U.toast('Trip ID is not a valid Trip ID.', 'bad');
      if (d.routeId && !d.client) { const r = store.state.routes.find((x) => x.id === d.routeId); if (r) d.client = r.client; }
      if (d.status !== truck.status || d.statusAt !== truck.statusAt) { d.statusBy = store.user.username; d.statusHistory = [...(truck.statusHistory || []), { at: d.statusAt, status: d.status, by: store.user.username, destination: d.destination, remarks: d.remarks }].slice(-30); }
      if (d.status && P.statusInfo(d.status, planning).group === 'Free') { d.loadingDate = d.loadingDate && d.loadingDate > U.todayISO() ? d.loadingDate : ''; d.routeId = ''; d.client = ''; d.etaDelivery = ''; d.etaReturn = ''; d.etaOffloadDone = ''; d.currentLocation = d.currentLocation || d.destination; d.destination = ''; d.tripId = ''; }
      try { await store.saveDoc('fleet', d, { expectedVersion: truck.version, label: `${truck.plate} · ${d.status || 'no status'}` }); m.close(); fmr.draw(); U.toast(`${truck.plate} updated.`, 'good'); } catch (e) { if (e.code === 'conflict') U.toast('Someone else updated this truck first. Reopen it to see their change.', 'bad'); else U.toast(e.message, 'bad'); }
    } }, 'Save update'));
    m.setActions(acts);
  }
  async function confirmBack(ctx, truck) {
    const { store } = ctx; if (!(await U.confirm({ title: 'Confirm truck is back', message: `${truck.plate} is past its estimated return. Confirm it has returned and is available now? The status becomes Available with the time stamped now.`, okLabel: 'Confirm available' }))) return;
    const now = U.nowISO();
    try { await store.saveDoc('fleet', { id: truck.id, status: 'Available', statusAt: now, statusBy: store.user.username, currentLocation: truck.destination || truck.homeStation || '', destination: '', routeId: '', client: '', loadingDate: '', etaDelivery: '', etaReturn: '', etaOffloadDone: '', tripId: '', statusHistory: [...(truck.statusHistory || []), { at: now, status: 'Available', by: store.user.username, remarks: 'Return verified by tracking' }].slice(-30) }, { expectedVersion: truck.version, label: `${truck.plate} · return verified` }); fmr.draw(); U.toast(`${truck.plate} confirmed available.`, 'good'); } catch (e) { U.toast(e.message, 'bad'); }
  }
  function addTruck(ctx) {
    const { store } = ctx; const onFmr = new Set(store.state.fleet.map((t) => P.plateKey(t.plate)));
    const candidates = store.state.assets.filter((a) => a.active !== false && !onFmr.has(P.plateKey(a.plate)));
    const sel = U.select(candidates.map((a) => [a.plate, `${a.plate} · ${a.vehicleType} · ${a.vehicleCategory}`]), candidates[0] ? candidates[0].plate : '');
    const body = U.datalistInput('dl-add-body', Object.keys(P.DEFAULT_BODY_RUNS), '102'), ton = U.datalistInput('dl-add-ton', ['30T', '40T', '45T'], '30T');
    const m = U.modal({ title: 'Add truck to the Fleet Movement Report', size: 'narrow', body: h('div', { class: 'stack' }, h('p', { class: 'small muted', text: 'Trucks come from the Asset List. Add the body type and tonnage so the planner can match contracts.' }), candidates.length ? U.field('Vehicle', sel) : h('div', { class: 'notice info', text: 'Every active asset is already on the FMR.' }), U.field('Body type', body), U.field('Tonnage', ton)) });
    m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), candidates.length ? h('button', { class: 'btn primary', onClick: async () => { const a = candidates.find((x) => x.plate === sel.value); if (!a) return; const d = { id: a.id || a.plate.replace(/[^A-Za-z0-9_-]+/g, '-'), plate: a.plate, assetCode: a.assetCode, bodyType: E.clean(body.querySelector('input').value), tonnage: E.clean(ton.querySelector('input').value), runsContracts: '', driver: '', homeStation: 'Lagos', currentLocation: '', status: '', statusAt: '', client: '', tripId: '', routeId: '', loadingFrom: '', destination: '', loadingDate: '', etaDelivery: '', actualDelivery: '', etaOffloadDone: '', etaReturn: '', workshopRelease: '', daysDown: null, remarks: '', active: true }; try { await store.saveDoc('fleet', d, { label: a.plate }); m.close(); fmr.draw(); updateStatus(ctx, d.id); } catch (e) { U.toast(e.message, 'bad'); } } }, 'Add') : null]);
  }
  const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fromLocal = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toISOString(); };
  fmr.updateStatus = updateStatus; fmr.fleetRows = fleetRows;
  HB.views.fleet = fmr;

  // ---------------------------------------------------------------- Fleet Planning Dashboard + runway
  const dash = { title: 'Fleet Planning Dashboard', filters: {}, runwayDays: 28, runwayMode: 'daily' };
  dash.render = function (root, ctx) { dash.ctx = ctx; dash.root = root; root.append(h('div', { class: 'stack', id: 'fleet-dash' })); dash.draw(); };
  dash.onStoreChange = () => { if (dash.root && dash.root.isConnected) dash.draw(); };
  dash.draw = function () {
    const ctx = dash.ctx, store = ctx.store, wrap = dash.root.querySelector('#fleet-dash'); if (!wrap) return; U.clear(wrap);
    const pctx = store.planningCtx(); const all = fleetRows(store); const f = dash.filters; const rows = applyFilters(all, f);
    const sub = Object.assign({}, pctx, { fleet: rows.map((r) => r.truck) });
    const k = P.fleetKpis(sub); const b = P.billingKpis(pctx); const setup = store.planningSetup();
    const week = (n) => P.runway(sub, 14).weeks[n];
    wrap.append(fleetFilterBar(ctx, f, dash.draw, all));
    wrap.append(h('div', { class: 'tiles' },
      tile('Total fleet', U.int(k.totalFleet)), tile('Available trucks', U.int(k.available), `${U.int(k.availableUnplanned)} available and unplanned`, 'good', () => ctx.nav('fleet')), tile('Allocated trucks', U.int(k.allocated), 'with an active allocation', 'info'),
      tile('Trucks on trip', U.int(k.onTrip), null, 'info'), tile('Returning today / tomorrow', `${U.int(k.backToday)} / ${U.int(k.backTomorrow)}`), tile('In workshop / breakdown', U.int(k.inWorkshop + k.breakdown), null, k.inWorkshop + k.breakdown ? 'bad' : ''),
      tile('Open client requests', U.int(k.openRequests), `${U.int(k.trucksRequested)} trucks requested`, 'warn', () => ctx.nav('planning')), tile('Trucks still required', U.int(k.outstandingTrucks), `${U.int(k.trucksAllocated)} allocated so far`, k.outstandingTrucks ? 'bad' : 'good'),
      tile('Delayed deployments', U.int(k.delayedDeployments), 'planned loading date passed', k.delayedDeployments ? 'bad' : 'good'), tile('Tracking update overdue', U.int(k.trackingOverdue), `threshold ${setup.trackingOverdueHours} h`, k.trackingOverdue ? 'bad' : 'good'),
      tile('Coming free this week', U.int(week(0).comingFree), `${U.int(week(1).comingFree)} next week`, 'good'), tile('Allocated, not yet in Trip Log', U.int(b.allocatedNotInTripLog), `${U.int(b.allocatedAwaitingTripId)} awaiting Trip ID`, b.allocatedNotInTripLog ? 'warn' : 'good', () => ctx.nav('planning', { tab: 'allocations' }))));
    wrap.append(h('div', { class: 'grid-2' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Fleet by availability category' })), HB.charts.hbars(k.byCategory.map((c) => ({ label: c.category, value: c.count })), {})),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Fleet by operational status' })), HB.charts.hbars(P.statusList(store.state.planning).map((s) => ({ label: s.status, value: rows.filter((r) => r.truck.status === s.status).length })).concat([{ label: 'No status', value: rows.filter((r) => !r.truck.status).length }]).filter((x) => x.value), {})),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Open requests · trucks requested vs allocated' })), HB.charts.bars({ labels: k.requests.slice(0, 12).map((r) => r.id), series: [{ name: 'Requested', values: k.requests.slice(0, 12).map((r) => r.counts.requested), color: 'var(--s2)' }, { name: 'Allocated', values: k.requests.slice(0, 12).map((r) => r.counts.allocated), color: 'var(--s3)' }] }, { height: 220 })),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Trucks coming free per week' })), HB.charts.bars({ labels: P.runway(sub, 56).weeks.map((w) => U.date(w.from).slice(0, 6)), series: [{ name: 'Coming free', values: P.runway(sub, 56).weeks.map((w) => w.comingFree), color: 'var(--s3)' }] }, { height: 220 }))));
    // warnings list
    const warn = rows.filter((r) => r.st.warnings.length).sort((a, b) => b.st.warnings.length - a.st.warnings.length).slice(0, 30);
    wrap.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: `Trucks needing attention (${rows.filter((r) => r.st.warnings.length).length})` }), h('button', { class: 'btn sm', onClick: () => ctx.nav('fleet') }, 'Open FMR')),
      warn.length ? h('div', { class: 'table-frame short', style: { minHeight: 0, border: 0 } }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Plate', 'Status', 'Last update', 'Free from', 'Category', 'Warnings', ''].map((x) => h('th', { text: x })))), h('tbody', {}, warn.map((r) => h('tr', {}, h('td', {}, h('strong', { text: r.truck.plate })), h('td', {}, r.truck.status ? U.pill(r.truck.status, GROUP_KIND[r.st.group]) : U.pill('No status', 'bad')), h('td', { text: U.dateTime(r.truck.statusAt) }), dateCell(r.st.freeFrom), h('td', {}, U.pill(r.st.category, CAT_KIND[r.st.category])), warnCell(r.st), h('td', {}, h('button', { class: 'btn sm', onClick: () => updateStatus(ctx, r.truck.id) }, 'Update'))))))) : h('div', { class: 'notice good', text: 'No warnings on the trucks in scope.' })));
    wrap.append(runwayCard(ctx, sub));
  };
  function runwayCard(ctx, pctx) {
    const { store } = ctx; const n = dash.runwayDays; const r = P.runway(pctx, n); const today = pctx.today;
    const head = h('div', { class: 'card-head' }, h('h3', { text: 'Fleet Availability Runway' }), h('span', { class: 'row' },
      U.select([['daily', 'Daily'], ['weekly', 'Weekly']], dash.runwayMode, { onChange: (e) => { dash.runwayMode = e.target.value; dash.draw(); } }),
      U.select([[14, '14 days'], [28, '28 days'], [56, '8 weeks'], [92, '92 days']], n, { onChange: (e) => { dash.runwayDays = Number(e.target.value); dash.draw(); } }),
      ctx.can('export') ? h('button', { class: 'btn sm', onClick: () => HB.exporter.xlsx([{ name: 'Runway', rows: [['Plate', 'Status', 'Free from', ...r.dates], ...r.rows.map((x) => [x.truck.plate, x.truck.status, x.status.freeFrom, ...x.codes])] }, { name: 'Weekly', rows: [['Week from', 'Week to', 'Trucks coming free'], ...r.weeks.map((w) => [w.from, w.to, w.comingFree])] }], `Runway_${U.todayISO()}.xlsx`) }, 'Export') : null));
    const legend = h('div', { class: 'row small muted' }, [['F', 'Free'], ['P', 'Planned / allocated'], ['T', 'On trip'], ['D', 'Workshop / down'], ['?', 'Unknown']].map(([c, l]) => h('span', { class: 'row', style: { gap: '4px' } }, h('span', { class: 'rw rw-' + (c === '?' ? 'U' : c), style: { width: '14px', height: '14px', display: 'inline-block' } }), l)));
    if (dash.runwayMode === 'weekly') {
      const weeks = r.weeks; const rows = r.rows.map((x) => ({ truck: x.truck, cells: weeks.map((w, i) => { const codes = x.codes.slice(i * 7, i * 7 + 7); const free = codes.filter((c) => c === 'F').length; const planned = codes.filter((c) => c === 'P').length; return { free, planned, trip: codes.filter((c) => c === 'T').length, down: codes.filter((c) => c === 'D').length, unknown: codes.filter((c) => c === '?').length }; }) }));
      return h('div', { class: 'card' }, head, legend, h('div', { class: 'table-frame short', style: { minHeight: 0, border: 0, marginTop: '8px' } }, h('table', { class: 'data runway' }, h('thead', {}, h('tr', {}, h('th', { text: 'Truck' }), h('th', { text: 'Free from' }), ...weeks.map((w) => h('th', { class: 'num', text: `${U.date(w.from).slice(0, 6)} – ${U.date(w.to).slice(0, 6)}` })))),
        h('tbody', {}, h('tr', { style: { fontWeight: 600 } }, h('td', { text: 'Trucks coming free' }), h('td'), ...weeks.map((w) => h('td', { class: 'num', text: w.comingFree }))), h('tr', { style: { fontWeight: 600 } }, h('td', { text: 'Free truck-days' }), h('td'), ...weeks.map((w, i) => h('td', { class: 'num', text: r.freeCountByDay.slice(i * 7, i * 7 + 7).reduce((a, b) => a + b, 0) }))),
          ...rows.map((x) => h('tr', {}, h('td', {}, h('strong', { text: x.truck.plate })), h('td', { text: U.date(r.rows.find((y) => y.truck === x.truck).status.freeFrom) }), ...x.cells.map((c) => h('td', { class: 'rw ' + (c.unknown === 7 ? 'rw-U' : c.free >= 4 ? 'rw-F' : c.planned >= 3 ? 'rw-P' : c.down >= 4 ? 'rw-D' : 'rw-T'), title: `free ${c.free} · planned ${c.planned} · trip ${c.trip} · down ${c.down}`, text: c.free ? `${c.free}F` : c.planned ? `${c.planned}P` : c.down ? 'D' : c.unknown === 7 ? '?' : 'T' }))))))));
    }
    return h('div', { class: 'card' }, head, legend, h('div', { class: 'table-frame short', style: { minHeight: 0, border: 0, marginTop: '8px' } }, h('table', { class: 'data runway' }, h('thead', {}, h('tr', {}, h('th', { text: 'Truck' }), h('th', { text: 'Status' }), ...r.dates.map((d) => h('th', { class: d === today ? 'today' : '', title: U.date(d), text: d.slice(8) })))),
      h('tbody', {}, h('tr', { style: { fontWeight: 600 } }, h('td', { text: 'Free trucks' }), h('td'), ...r.freeCountByDay.map((c) => h('td', { class: 'num', text: c }))), h('tr', { style: { fontWeight: 600 } }, h('td', { text: 'Coming free' }), h('td'), ...r.freeByDay.map((c) => h('td', { class: 'num', text: c || '' }))),
        ...r.rows.map((x) => h('tr', {}, h('td', {}, h('strong', { text: x.truck.plate })), h('td', { class: 'small', text: x.truck.status || '—' }), ...x.codes.map((c, i) => h('td', { class: 'rw rw-' + (c === '?' ? 'U' : c) + (r.dates[i] === today ? ' today' : ''), title: `${x.truck.plate} · ${U.date(r.dates[i])} · ${c === 'F' ? 'free' : c === 'P' ? 'planned' : c === 'T' ? 'on trip' : c === 'D' ? 'down' : 'unknown'}`, text: c === '?' ? '?' : '' }))))))));
  }
  HB.views.fleetdash = dash;
})();
