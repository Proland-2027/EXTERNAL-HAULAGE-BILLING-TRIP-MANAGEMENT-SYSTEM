/* app.js — UI for the External Haulage Billing & Trip Management System (vanilla JS, no build step). */
(function () {
  'use strict';
  const P = window.Pricing;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let db = window.Store.load();
  const state = {
    view: 'dashboard',
    period: null,
    tripFilter: { period: '', partyId: '', routeId: '', status: '', billed: '' },
    priceListId: null,
    billing: { partyId: P.INTERNAL, period: null, priceListId: '', preview: null, openId: null },
    report: { period: null, contractorId: '' },
  };

  // ------------------------------------------------------------------ helpers
  const cur = () => db.settings.currency || 'GHS';
  const fmtMoney = (v, withCur = false) => `${withCur ? cur() + ' ' : ''}${P.num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum = (v, d = 2) => P.num(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d });
  const fmtPct = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${fmtNum(v, 1)}%`);
  const today = () => new Date().toISOString().slice(0, 10);
  const contractor = (id) => db.contractors.find((c) => c.id === id);
  const partyName = (id) => (id === P.INTERNAL ? 'In-house Fleet (Internal)' : (contractor(id) || {}).name || id);
  const partyCode = (id) => (id === P.INTERNAL ? 'INT' : (contractor(id) || {}).code || 'CTR');
  const route = (id) => db.routes.find((r) => r.id === id);
  const routeLabel = (id) => { const r = route(id); return r ? `${r.origin} → ${r.destination}` : id || ''; };
  const parties = () => [{ id: P.INTERNAL, name: partyName(P.INTERNAL) }, ...db.contractors];
  const periods = () => {
    const set = new Set(db.trips.map((t) => P.periodOf(t.date)).concat(db.billings.map((b) => b.period)));
    return [...set].filter(Boolean).sort().reverse();
  };
  const latestPeriod = () => {
    const withBilling = db.billings.map((b) => b.period).sort().reverse()[0];
    return withBilling || periods()[0] || today().slice(0, 7);
  };
  const save = () => window.Store.save(db);
  const options = (items, value, { allLabel = null, key = 'id', label = 'name' } = {}) =>
    (allLabel != null ? `<option value="">${esc(allLabel)}</option>` : '') +
    items.map((i) => `<option value="${esc(i[key])}" ${String(i[key]) === String(value) ? 'selected' : ''}>${esc(typeof label === 'function' ? label(i) : i[label])}</option>`).join('');
  const statusBadge = (s) => `<span class="badge ${s === 'APPROVED' || s === 'PAID' || s === 'ACTIVE' || s === 'COMPLETED' ? 'good' : s === 'VOID' || s === 'CANCELLED' ? 'bad' : s === 'DRAFT' ? 'warn' : ''}">${esc(s)}</span>`;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /** Open the modal with form HTML; `onSubmit(values)` returns false to keep the dialog open. */
  function modal(title, bodyHtml, onSubmit, { submitLabel = 'Save', danger = false } = {}) {
    const dlg = $('#modal'), form = $('#modal-form');
    form.innerHTML = `<h2>${esc(title)}</h2>${bodyHtml}<div class="form-actions"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button></div>`;
    form.onsubmit = (e) => {
      e.preventDefault();
      const values = {};
      new FormData(form).forEach((v, k) => (values[k] = v));
      form.querySelectorAll('input[type="checkbox"]').forEach((c) => (values[c.name] = c.checked));
      if (onSubmit(values, form) !== false) dlg.close();
    };
    form.querySelector('[data-close]').onclick = () => dlg.close();
    dlg.showModal();
    const first = form.querySelector('input, select, textarea'); if (first) first.focus();
  }
  const field = (label, name, type = 'text', value = '', attrs = '') =>
    `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
  const selectField = (label, name, optsHtml, attrs = '') => `<label>${esc(label)}<select name="${name}" ${attrs}>${optsHtml}</select></label>`;

  // ------------------------------------------------------------------ router
  function render() {
    document.querySelectorAll('#nav .tab').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    $('#brand-company').textContent = db.settings.company || '';
    const v = $('#view');
    const views = { dashboard: renderDashboard, trips: renderTrips, pricelists: renderPriceLists, billing: renderBilling, report: renderReport, setup: renderSetup, data: renderData };
    v.innerHTML = views[state.view]();
    if (state.view === 'report' || state.view === 'dashboard') window.Charts.bindTooltips(v);
  }
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) { state.view = b.dataset.view; render(); } });
  $('#theme-toggle').addEventListener('click', () => {
    const r = document.documentElement;
    const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    r.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('ehb.theme', r.dataset.theme); } catch (e) { /* ignore */ }
  });
  try { const th = localStorage.getItem('ehb.theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* ignore */ }

  // ------------------------------------------------------------------ dashboard
  function renderDashboard() {
    const period = state.period || latestPeriod();
    const mom = P.buildMonthlyComparison({ period, trips: db.trips, billings: db.billings, priceLists: db.priceLists, routes: db.routes, contractors: db.contractors });
    const c = mom.current.totals;
    const unbilled = parties().map((p) => ({ p, n: P.selectTrips(db.trips, p.id, period).length })).filter((x) => x.n);
    const open = db.billings.filter((b) => b.status === 'DRAFT').length;
    const kpi = (label, value, d, goodWhenUp = false) => {
      const cls = d && d.change ? ((d.change > 0) === goodWhenUp ? 'up' : 'down') : '';
      return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="delta ${cls}">${d ? `${d.change > 0 ? '▲' : d.change < 0 ? '▼' : '•'} ${fmtPct(d.changePct)} vs ${P.periodLabel(mom.previous.period)}` : ''}</div></div>`;
    };
    return `
      <div class="row between" style="margin-bottom:1rem">
        <h1>Dashboard — ${esc(P.periodLabel(period))}</h1>
        <label class="row">Period <input type="month" value="${period}" data-action="set-period"></label>
      </div>
      <div class="kpis">
        ${kpi('Internal billing (in-house cost)', fmtMoney(c.internal.amount, true), mom.deltas.internalAmount)}
        ${kpi('Contractor billing', fmtMoney(c.contractor.amount, true), mom.deltas.contractorAmount)}
        ${kpi('In-house saving vs contractor rate', fmtMoney(c.inhouseSaving, true), mom.deltas.inhouseSaving, true)}
        ${kpi('Internal cost / tonne', fmtMoney(c.internal.costPerUnit), mom.deltas.internalCostPerUnit)}
        ${kpi('Contractor cost / tonne', fmtMoney(c.contractor.costPerUnit), mom.deltas.contractorCostPerUnit)}
        ${kpi('MOQ top-ups paid to contractors', fmtMoney(c.contractor.moqTopUpValue, true), mom.deltas.moqTopUpValue)}
      </div>
      <div class="grid two" style="margin-top:1rem">
        <div class="card">
          <div class="card-head"><h2>Billing status for ${esc(P.periodLabel(period))}</h2><button class="btn sm" data-action="go" data-view="billing">Open billing</button></div>
          <div class="table-wrap"><table class="compact"><thead><tr><th>Party</th><th>Logged billing</th><th class="num">Trips</th><th class="num">Total</th><th>Unbilled trips</th></tr></thead><tbody>
            ${parties().map((p) => {
              const bs = db.billings.filter((b) => b.partyId === p.id && b.period === period && b.status !== 'VOID');
              const u = unbilled.find((x) => x.p.id === p.id);
              return `<tr><td>${esc(p.name)}</td><td>${bs.length ? bs.map((b) => `${esc(b.number)} ${statusBadge(b.status)}`).join('<br>') : '<span class="muted">not logged</span>'}</td><td class="num">${bs.reduce((s, b) => s + b.summary.trips, 0)}</td><td class="num">${fmtMoney(bs.reduce((s, b) => s + b.summary.total, 0))}</td><td>${u ? `<span class="badge warn">${u.n} to bill</span>` : '<span class="badge good">none</span>'}</td></tr>`;
            }).join('')}
          </tbody></table></div>
          <p class="hint" style="margin-top:.6rem">${open} draft billing${open === 1 ? '' : 's'} awaiting approval across all periods.</p>
        </div>
        <div class="card">
          <div class="card-head"><h2>Cost per tonne by route</h2><button class="btn sm" data-action="go" data-view="report">Full report</button></div>
          ${mom.current.rows.length ? window.Charts.groupedBars({
            categories: mom.current.rows.map((r) => r.routeName),
            series: [{ name: 'Internal (in-house)', values: mom.current.rows.map((r) => r.internal.costPerUnit) }, { name: 'Contractor', values: mom.current.rows.map((r) => r.contractor.costPerUnit) }],
            fmt: (v) => fmtNum(v, 0), unitLabel: `Cost per tonne (${cur()})`, height: 240,
          }) : '<div class="empty">No trips in this period yet.</div>'}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ trips
  function renderTrips() {
    const f = state.tripFilter;
    const rows = db.trips.filter((t) => (!f.period || P.periodOf(t.date) === f.period) && (!f.partyId || t.partyId === f.partyId) && (!f.routeId || t.routeId === f.routeId) && (!f.status || t.status === f.status) && (!f.billed || (f.billed === 'yes') === !!t.billingId))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const totQty = rows.reduce((s, t) => s + P.num(t.qty), 0);
    return `
      <div class="card">
        <div class="card-head"><h1>Trip Log</h1><div class="row"><button class="btn" data-action="export-trips">Export</button><button class="btn primary" data-action="trip-new">+ Log trip</button></div></div>
        <div class="toolbar">
          <label>Period<select data-filter="period">${options(periods().map((p) => ({ id: p, name: P.periodLabel(p) })), f.period, { allLabel: 'All periods' })}</select></label>
          <label>Party<select data-filter="partyId">${options(parties(), f.partyId, { allLabel: 'All parties' })}</select></label>
          <label>Route<select data-filter="routeId">${options(db.routes, f.routeId, { allLabel: 'All routes', label: (r) => `${r.origin} → ${r.destination}` })}</select></label>
          <label>Status<select data-filter="status">${options([{ id: 'COMPLETED', name: 'Completed' }, { id: 'CANCELLED', name: 'Cancelled' }], f.status, { allLabel: 'All' })}</select></label>
          <label>Billing<select data-filter="billed">${options([{ id: 'yes', name: 'Billed' }, { id: 'no', name: 'Unbilled' }], f.billed, { allLabel: 'All' })}</select></label>
          <span class="muted small" style="align-self:center">${rows.length} trips · ${fmtNum(totQty, 1)} units</span>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Waybill</th><th>Party</th><th>Vehicle</th><th>Class</th><th>Driver</th><th>Route</th><th>Product</th><th class="num">Qty</th><th>Unit</th><th class="num">Km</th><th class="num">Diesel L</th><th>Status</th><th>Billing</th><th></th></tr></thead>
          <tbody>${rows.length ? rows.map((t) => `<tr>
            <td class="nowrap">${esc(t.date)}</td><td>${esc(t.waybill)}</td><td>${esc(partyName(t.partyId))}</td><td class="nowrap">${esc(t.vehicleNo)}</td><td>${esc(t.vehicleClass)}</td><td>${esc(t.driver)}</td>
            <td>${esc(routeLabel(t.routeId))}</td><td>${esc(t.product)}</td><td class="num">${fmtNum(t.qty, 3)}</td><td>${esc(t.unit)}</td><td class="num">${fmtNum(t.distanceKm, 0)}</td><td class="num">${t.dieselLitres != null && t.dieselLitres !== '' ? fmtNum(t.dieselLitres, 1) : ''}</td>
            <td>${statusBadge(t.status || 'COMPLETED')}</td><td>${t.billingId ? `<a href="#" data-action="open-billing" data-id="${esc(t.billingId)}">${esc((db.billings.find((b) => b.id === t.billingId) || {}).number || t.billingId)}</a>` : '<span class="muted">—</span>'}</td>
            <td class="actions"><button class="btn sm" data-action="trip-edit" data-id="${esc(t.id)}">Edit</button> <button class="btn sm ghost danger" data-action="trip-delete" data-id="${esc(t.id)}">✕</button></td></tr>`).join('') : '<tr><td colspan="15"><div class="empty">No trips match the filter.</div></td></tr>'}
          </tbody></table></div>
      </div>`;
  }

  function tripForm(t = {}) {
    const classes = db.settings.vehicleClasses || [];
    const units = db.settings.units || ['TONNE'];
    const r = route(t.routeId);
    return `<div class="form-grid">
      ${field('Date', 'date', 'date', t.date || today(), 'required')}
      ${selectField('Party (haulier)', 'partyId', options(parties(), t.partyId || P.INTERNAL), 'required')}
      ${field('Waybill / Trip No.', 'waybill', 'text', t.waybill || '', 'required')}
      ${field('Vehicle No.', 'vehicleNo', 'text', t.vehicleNo || '')}
      ${selectField('Vehicle class', 'vehicleClass', options(classes.map((c) => ({ id: c, name: c })), t.vehicleClass || classes[0]))}
      ${field('Driver', 'driver', 'text', t.driver || '')}
      ${selectField('Route', 'routeId', options(db.routes, t.routeId || (db.routes[0] || {}).id, { label: (x) => `${x.origin} → ${x.destination} (${x.distanceKm} km)` }), 'required data-autofill-km')}
      <label>Product<input name="product" list="products" value="${esc(t.product || '')}"><datalist id="products">${(db.settings.products || []).map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label>
      ${field('Quantity loaded', 'qty', 'number', t.qty != null ? t.qty : '', 'step="0.001" min="0" required')}
      ${selectField('Unit', 'unit', options(units.map((u) => ({ id: u, name: u })), t.unit || 'TONNE'))}
      ${field('Distance (km)', 'distanceKm', 'number', t.distanceKm != null ? t.distanceKm : (r ? r.distanceKm : ''), 'step="0.1" min="0"')}
      ${field('Diesel used (litres, internal fleet)', 'dieselLitres', 'number', t.dieselLitres != null ? t.dieselLitres : '', 'step="0.1" min="0" placeholder="blank = standard litres"')}
      ${selectField('Status', 'status', options([{ id: 'COMPLETED', name: 'Completed' }, { id: 'CANCELLED', name: 'Cancelled' }], t.status || 'COMPLETED'))}
      <label class="full">Remarks<input name="remarks" value="${esc(t.remarks || '')}"></label>
    </div>
    ${t.billingId ? `<p class="hint err">This trip is already on billing ${esc((db.billings.find((b) => b.id === t.billingId) || {}).number || '')}. Edits here do not change that logged billing — void and regenerate it if the change should be billed.</p>` : '<p class="hint">Quantity below the price-list MOQ is billed at the MOQ. Leave diesel blank to use the standard litres from the price list.</p>'}`;
  }
  function openTripForm(t) {
    modal(t ? 'Edit trip' : 'Log trip', tripForm(t || {}), (v) => {
      const rec = t || { id: window.Store.uid('T'), billingId: null };
      Object.assign(rec, { date: v.date, partyId: v.partyId, waybill: v.waybill.trim(), vehicleNo: v.vehicleNo.trim(), vehicleClass: v.vehicleClass, driver: v.driver.trim(), routeId: v.routeId, product: v.product.trim(), qty: P.num(v.qty), unit: v.unit, distanceKm: v.distanceKm === '' ? P.num((route(v.routeId) || {}).distanceKm) : P.num(v.distanceKm), dieselLitres: v.dieselLitres === '' ? undefined : P.num(v.dieselLitres), status: v.status, remarks: v.remarks.trim() });
      if (!t) db.trips.push(rec);
      save(); render(); toast(t ? 'Trip updated' : 'Trip logged');
    });
    $('#modal-form').addEventListener('change', (e) => {
      if (e.target.matches('[data-autofill-km]')) { const r = route(e.target.value); if (r) $('#modal-form [name="distanceKm"]').value = r.distanceKm; }
    });
  }

  // ------------------------------------------------------------------ price lists & MOQ
  function renderPriceLists() {
    const lists = [...db.priceLists].sort((a, b) => (a.partyId === P.INTERNAL ? -1 : 1) - (b.partyId === P.INTERNAL ? -1 : 1) || String(b.validFrom).localeCompare(String(a.validFrom)));
    if (!state.priceListId || !lists.find((l) => l.id === state.priceListId)) state.priceListId = (lists[0] || {}).id;
    const pl = lists.find((l) => l.id === state.priceListId);
    return `
      <div class="row between" style="margin-bottom:1rem"><h1>Price Lists &amp; MOQ</h1><button class="btn primary" data-action="pl-new">+ New price list</button></div>
      <div style="display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:1rem;align-items:start">
        <div class="list">${lists.map((l) => `<div class="list-item ${l.id === state.priceListId ? 'active' : ''}" data-action="pl-select" data-id="${esc(l.id)}">
          <div class="row between"><strong>${esc(l.name)}</strong>${statusBadge(l.status || 'ACTIVE')}</div>
          <div class="small muted">${esc(partyName(l.partyId))} · ${esc(l.validFrom || '…')} → ${esc(l.validTo || '…')} · ${(l.lines || []).length} lines</div></div>`).join('') || '<div class="empty">No price lists yet.</div>'}</div>
        ${pl ? priceListEditor(pl) : ''}
      </div>`;
  }
  function priceListEditor(pl) {
    const internal = pl.partyId === P.INTERNAL;
    const classes = ['ANY', ...(db.settings.vehicleClasses || [])];
    const units = db.settings.units || ['TONNE'];
    const lineTotal = (l) => P.round2(P.num(l.fixedCost) + P.num(l.variableCostPerKm) * P.num((route(l.routeId) || {}).distanceKm) + P.num(l.fixedVariableCost) + P.num(l.dieselLitres) * P.num(pl.dieselPricePerLitre));
    return `<div class="card">
      <div class="card-head"><h2>${esc(pl.name)}</h2><div class="row">
        <button class="btn sm" data-action="pl-duplicate" data-id="${esc(pl.id)}">Duplicate for next year</button>
        <button class="btn sm" data-action="pl-export" data-id="${esc(pl.id)}">Export</button>
        <button class="btn sm danger" data-action="pl-delete" data-id="${esc(pl.id)}">Delete</button></div></div>
      <div class="form-grid" data-pl-head="${esc(pl.id)}">
        ${field('Name', 'name', 'text', pl.name)}
        ${selectField('Party', 'partyId', options(parties(), pl.partyId))}
        ${selectField('Status', 'status', options(['ACTIVE', 'DRAFT', 'ARCHIVED'].map((s) => ({ id: s, name: s })), pl.status || 'ACTIVE'))}
        ${field('Currency', 'currency', 'text', pl.currency || cur())}
        ${field('Valid from', 'validFrom', 'date', pl.validFrom || '')}
        ${field('Valid to', 'validTo', 'date', pl.validTo || '')}
        ${internal ? field(`Diesel price per litre (${esc(pl.currency || cur())})`, 'dieselPricePerLitre', 'number', pl.dieselPricePerLitre != null ? pl.dieselPricePerLitre : db.settings.defaultDieselPricePerLitre || '', 'step="0.01" min="0"') : ''}
        <label class="full">Notes<input name="notes" value="${esc(pl.notes || '')}"></label>
      </div>
      <h3 style="margin-top:1rem">Tariff lines ${internal ? '<span class="muted small">— internal cost per trip = Fixed + Variable × km + Fixed-variable + Diesel litres × price</span>' : '<span class="muted small">— contractor rate per unit; quantities under the MOQ are billed at the MOQ</span>'}</h3>
      <div class="table-wrap"><table class="compact" data-pl-lines="${esc(pl.id)}">
        <thead><tr><th>Route</th><th>Vehicle class</th><th>Unit</th><th class="num" title="Minimum Order Quantity per trip">MOQ</th>
          ${internal ? '<th class="num">Fixed cost</th><th class="num">Variable / km</th><th class="num">Fixed-variable</th><th class="num">Diesel litres</th><th class="num">Cost / trip</th><th class="num">Cost / unit @MOQ</th>' : '<th class="num">Rate / unit</th><th class="num">Min. charge / trip</th>'}<th></th></tr></thead>
        <tbody>${(pl.lines || []).map((l) => `<tr data-line="${esc(l.id)}">
          <td><select data-field="routeId">${options(db.routes, l.routeId, { label: (r) => `${r.origin} → ${r.destination}` })}</select></td>
          <td><select data-field="vehicleClass">${options(classes.map((c) => ({ id: c, name: c === 'ANY' ? 'Any class' : c })), l.vehicleClass || 'ANY')}</select></td>
          <td><select data-field="unit">${options(units.map((u) => ({ id: u, name: u })), l.unit || 'TONNE')}</select></td>
          <td class="num"><input type="number" step="0.001" min="0" data-field="moq" value="${esc(l.moq != null ? l.moq : 0)}" ${l.unit === 'TRIP' ? 'disabled title="Flat per-trip rate: MOQ not applied"' : ''}></td>
          ${internal ? `
            <td class="num"><input type="number" step="0.01" min="0" data-field="fixedCost" value="${esc(l.fixedCost != null ? l.fixedCost : 0)}"></td>
            <td class="num"><input type="number" step="0.01" min="0" data-field="variableCostPerKm" value="${esc(l.variableCostPerKm != null ? l.variableCostPerKm : 0)}"></td>
            <td class="num"><input type="number" step="0.01" min="0" data-field="fixedVariableCost" value="${esc(l.fixedVariableCost != null ? l.fixedVariableCost : 0)}"></td>
            <td class="num"><input type="number" step="0.1" min="0" data-field="dieselLitres" value="${esc(l.dieselLitres != null ? l.dieselLitres : 0)}"></td>
            <td class="num"><strong>${fmtMoney(lineTotal(l))}</strong></td>
            <td class="num">${P.num(l.moq) ? fmtMoney(lineTotal(l) / P.num(l.moq)) : '—'}</td>`
          : `<td class="num"><input type="number" step="0.01" min="0" data-field="ratePerUnit" value="${esc(l.ratePerUnit != null ? l.ratePerUnit : 0)}"></td>
             <td class="num">${fmtMoney(l.unit === 'TRIP' ? P.num(l.ratePerUnit) : P.num(l.ratePerUnit) * P.num(l.moq))}</td>`}
          <td class="actions"><button class="btn sm ghost danger" data-action="pl-line-delete" data-id="${esc(l.id)}">✕</button></td></tr>`).join('')}
        </tbody></table></div>
      <div class="row" style="margin-top:.6rem"><button class="btn sm" data-action="pl-line-add" data-id="${esc(pl.id)}">+ Add line</button><span class="hint">Changes save automatically. Routes are defined in Setup.</span></div>
    </div>`;
  }

  // ------------------------------------------------------------------ billing
  function renderBilling() {
    const b = state.billing;
    if (!b.period) b.period = latestPeriod();
    if (b.openId) {
      const bill = db.billings.find((x) => x.id === b.openId);
      if (!bill) { b.openId = null; } else return billingDocument(bill, { logged: true });
    }
    const lists = db.priceLists.filter((l) => l.partyId === b.partyId);
    const auto = P.pickPriceList(db.priceLists, b.partyId, b.period);
    const chosen = lists.find((l) => l.id === b.priceListId) || auto;
    const candidates = P.selectTrips(db.trips, b.partyId, b.period);
    const existing = db.billings.filter((x) => x.partyId === b.partyId && x.period === b.period && x.status !== 'VOID');
    const all = [...db.billings].sort((x, y) => y.period.localeCompare(x.period) || y.number.localeCompare(x.number));
    return `
      <div class="card">
        <div class="card-head"><h1>Generate billing</h1></div>
        <div class="toolbar">
          <label>Party<select data-bill="partyId">${options(parties(), b.partyId)}</select></label>
          <label>Period<input type="month" data-bill="period" value="${esc(b.period)}"></label>
          <label>Price list<select data-bill="priceListId">${lists.length ? options(lists, chosen ? chosen.id : '', { label: (l) => `${l.name}${auto && l.id === auto.id ? ' (auto)' : ''}` }) : '<option value="">— none for this party —</option>'}</select></label>
          <button class="btn primary" data-action="bill-preview" ${candidates.length && chosen ? '' : 'disabled'}>Preview ${candidates.length} unbilled trip${candidates.length === 1 ? '' : 's'}</button>
          ${existing.length ? `<span class="badge warn">Already logged: ${existing.map((x) => esc(x.number)).join(', ')}</span>` : ''}
        </div>
        ${!chosen ? `<p class="hint err">No price list for ${esc(partyName(b.partyId))}. Create one under Price Lists &amp; MOQ.</p>` : ''}
        ${b.preview ? `<div class="row between" style="margin:.5rem 0"><span>${b.preview.summary.tripsWithErrors ? `<span class="badge bad">${b.preview.summary.tripsWithErrors} trip(s) have no tariff line — fix the price list before saving</span>` : '<span class="badge good">All trips priced</span>'}</span>
          <div class="row"><button class="btn" data-action="bill-cancel">Discard</button><button class="btn primary" data-action="bill-save" ${b.preview.summary.tripsWithErrors ? 'disabled' : ''}>Save &amp; log billing</button></div></div>
          ${billingDocument(b.preview, { logged: false })}` : ''}
      </div>
      <div class="card">
        <div class="card-head"><h2>Logged billings</h2></div>
        <div class="table-wrap"><table class="compact">
          <thead><tr><th>Billing No.</th><th>Period</th><th>Party</th><th>Price list</th><th class="num">Trips</th><th class="num">Billable qty</th><th class="num">MOQ top-ups</th><th class="num">Subtotal</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
          <tbody>${all.length ? all.map((x) => `<tr>
            <td><a href="#" data-action="open-billing" data-id="${esc(x.id)}">${esc(x.number)}</a></td><td>${esc(P.periodLabel(x.period))}</td><td>${esc(partyName(x.partyId))}</td><td class="small">${esc(x.priceListName)}</td>
            <td class="num">${x.summary.trips}</td><td class="num">${fmtNum(x.summary.billableQty, 1)}</td><td class="num">${x.summary.moqTrips ? `${x.summary.moqTrips} (${fmtMoney(x.summary.moqTopUpValue)})` : '—'}</td>
            <td class="num">${fmtMoney(x.summary.subtotal)}</td><td class="num"><strong>${fmtMoney(x.summary.total)}</strong></td><td>${statusBadge(x.status)}</td>
            <td class="actions">${x.status === 'DRAFT' ? `<button class="btn sm" data-action="bill-status" data-id="${esc(x.id)}" data-status="APPROVED">Approve</button>` : ''}${x.status === 'APPROVED' ? `<button class="btn sm" data-action="bill-status" data-id="${esc(x.id)}" data-status="PAID">Mark paid</button>` : ''}
              ${x.status !== 'VOID' ? `<button class="btn sm ghost danger" data-action="bill-void" data-id="${esc(x.id)}">Void</button>` : `<button class="btn sm ghost danger" data-action="bill-delete" data-id="${esc(x.id)}">Delete</button>`}</td></tr>`).join('') : '<tr><td colspan="11"><div class="empty">No billings logged yet.</div></td></tr>'}
          </tbody></table></div>
      </div>`;
  }

  /** The billing format — used for preview, logged view and print. */
  function billingDocument(bill, { logged }) {
    const internal = bill.partyId === P.INTERNAL;
    const s = bill.summary, c = s.components;
    const ctr = contractor(bill.partyId) || {};
    const pct = (v) => (s.subtotal ? `${fmtNum((v / s.subtotal) * 100, 1)}%` : '—');
    const hasErr = bill.lines.some((l) => l.errors && l.errors.length);
    const errCell = (l) => (hasErr ? `<td class="err small">${esc((l.errors || []).join('; '))}</td>` : '');
    const lineRows = bill.lines.map((l, i) => internal ? `<tr>
        <td>${i + 1}</td><td class="nowrap">${esc(l.date)}</td><td class="nowrap">${esc(l.waybill)}</td><td class="nowrap">${esc(l.vehicleNo)}</td><td>${esc(l.routeName)}</td><td>${esc(l.product)}</td>
        <td class="num">${fmtNum(l.actualQty, 3)}</td><td class="num">${fmtNum(l.moq, 1)}</td><td class="num">${fmtNum(l.billableQty, 3)}${l.moqApplied ? ' <span class="badge warn" title="billed at MOQ">MOQ</span>' : ''}</td><td class="num">${fmtNum(l.distanceKm, 0)}</td>
        <td class="num">${l.components ? fmtMoney(l.components.fixed) : ''}</td><td class="num">${l.components ? fmtMoney(l.components.variable) : ''}</td><td class="num">${l.components ? fmtMoney(l.components.fixedVariable) : ''}</td>
        <td class="num">${fmtNum(l.dieselLitres, 1)}</td><td class="num">${l.components ? fmtMoney(l.components.diesel) : ''}</td><td class="num"><strong>${fmtMoney(l.amount)}</strong></td><td class="num">${fmtMoney(l.costPerUnit)}</td>
        ${errCell(l)}</tr>`
      : `<tr>
        <td>${i + 1}</td><td class="nowrap">${esc(l.date)}</td><td class="nowrap">${esc(l.waybill)}</td><td class="nowrap">${esc(l.vehicleNo)}</td><td>${esc(l.routeName)}</td><td>${esc(l.product)}</td>
        <td class="num">${fmtNum(l.actualQty, 3)}</td><td>${esc(l.unit)}</td><td class="num">${l.unit === 'TRIP' ? '—' : fmtNum(l.moq, 1)}</td><td class="num">${fmtNum(l.billableQty, 3)}${l.moqApplied ? ' <span class="badge warn" title="billed at MOQ">MOQ</span>' : ''}</td>
        <td class="num">${l.rate != null ? fmtMoney(l.rate) : ''}</td><td class="num"><strong>${fmtMoney(l.amount)}</strong></td>
        ${errCell(l)}</tr>`).join('');
    return `
      ${logged ? `<div class="row between no-print" style="margin-bottom:.75rem"><button class="btn" data-action="bill-back">← All billings</button><div class="row">
        ${statusBadge(bill.status)}<button class="btn" data-action="bill-export" data-id="${esc(bill.id)}">Export Excel/CSV</button><button class="btn primary" onclick="window.print()">Print / PDF</button></div></div>` : ''}
      <div class="doc">
        <div class="doc-head">
          <div><div class="doc-title">${internal ? 'INTERNAL HAULAGE BILLING — COST RECHARGE' : 'EXTERNAL HAULAGE BILLING STATEMENT'}</div>
            <div class="small muted">${esc(db.settings.company || '')}${db.settings.companyAddress ? ' · ' + esc(db.settings.companyAddress) : ''}</div></div>
          <dl class="doc-meta">
            <dt>Billing No.</dt><dd>${esc(bill.number || '(preview)')}</dd>
            <dt>Period</dt><dd>${esc(P.periodLabel(bill.period))}</dd>
            <dt>Date</dt><dd>${esc((bill.createdAt || new Date().toISOString()).slice(0, 10))}</dd>
            <dt>Price list</dt><dd>${esc(bill.priceListName || '—')}</dd>
            <dt>Currency</dt><dd>${esc(bill.currency)}</dd>
            ${!internal && ctr.paymentTermsDays ? `<dt>Terms</dt><dd>${esc(ctr.paymentTermsDays)} days</dd>` : ''}
          </dl>
        </div>
        <div class="doc-parties">
          <div class="party"><div class="who">${internal ? 'Cost centre (haulier)' : 'Contractor (haulier)'}</div>${esc(partyName(bill.partyId))}${ctr.contact ? `<br>${esc(ctr.contact)}` : ''}${ctr.phone ? `<br>${esc(ctr.phone)}` : ''}</div>
          <div class="party"><div class="who">${internal ? 'Recharged to' : 'Billed to'}</div>${esc(db.settings.company || '')}<br>${esc(db.settings.companyAddress || '')}</div>
          <div class="party"><div class="who">Basis</div>${internal ? 'Fixed + Variable (per km) + Fixed-variable + Diesel (litres × price). Per-unit cost shown at the billable (MOQ) quantity.' : 'Rate per unit × billable quantity. Loads under the price-list MOQ are billed at the MOQ.'}</div>
        </div>
        <div class="table-wrap"><table class="compact">
          <thead>${internal
            ? '<tr><th>#</th><th>Date</th><th>Waybill</th><th>Vehicle</th><th>Route</th><th>Product</th><th class="num">Qty</th><th class="num">MOQ</th><th class="num">Billable</th><th class="num">Km</th><th class="num">Fixed</th><th class="num">Variable</th><th class="num">Fixed-var.</th><th class="num">Diesel L</th><th class="num">Diesel</th><th class="num">Trip cost</th><th class="num">Cost/unit</th>' + (hasErr ? '<th>Issue</th>' : '') + '</tr>'
            : '<tr><th>#</th><th>Date</th><th>Waybill</th><th>Vehicle</th><th>Route</th><th>Product</th><th class="num">Qty</th><th>Unit</th><th class="num">MOQ</th><th class="num">Billable</th><th class="num">Rate</th><th class="num">Amount</th>' + (hasErr ? '<th>Issue</th>' : '') + '</tr>'}</thead>
          <tbody>${lineRows || `<tr><td colspan="18"><div class="empty">No trips.</div></td></tr>`}</tbody>
          <tfoot>${internal
            ? `<tr><td colspan="6">Totals — ${s.trips} trips</td><td class="num">${fmtNum(s.actualQty, 3)}</td><td></td><td class="num">${fmtNum(s.billableQty, 3)}</td><td class="num">${fmtNum(s.distanceKm, 0)}</td><td class="num">${fmtMoney(c.fixed)}</td><td class="num">${fmtMoney(c.variable)}</td><td class="num">${fmtMoney(c.fixedVariable)}</td><td class="num">${fmtNum(s.dieselLitres, 1)}</td><td class="num">${fmtMoney(c.diesel)}</td><td class="num">${fmtMoney(s.subtotal)}</td><td class="num">${fmtMoney(s.costPerUnit)}</td>${hasErr ? '<td></td>' : ''}</tr>`
            : `<tr><td colspan="6">Totals — ${s.trips} trips</td><td class="num">${fmtNum(s.actualQty, 3)}</td><td></td><td></td><td class="num">${fmtNum(s.billableQty, 3)}</td><td></td><td class="num">${fmtMoney(s.subtotal)}</td>${hasErr ? '<td></td>' : ''}</tr>`}</tfoot>
        </table></div>
        <div class="doc-totals">
          <div>
            <h3>MOQ adjustments</h3>
            <table class="compact totals-table"><tbody>
              <tr><td>Trips billed at MOQ</td><td class="num">${s.moqTrips} of ${s.trips}</td></tr>
              <tr><td>Quantity topped up to MOQ</td><td class="num">${fmtNum(s.moqTopUp, 3)}</td></tr>
              ${internal ? '' : `<tr><td>Value of MOQ top-ups (paid for unused capacity)</td><td class="num">${fmtMoney(s.moqTopUpValue)}</td></tr>`}
              <tr><td>Average cost per unit (billable)</td><td class="num">${fmtMoney(s.costPerUnit)}</td></tr>
              <tr><td>Average cost per trip</td><td class="num">${fmtMoney(s.costPerTrip)}</td></tr>
              ${internal ? `<tr><td>Average cost per km</td><td class="num">${fmtMoney(s.costPerKm)}</td></tr>` : ''}
            </tbody></table>
            ${internal ? `<h3 style="margin-top:.8rem">Cost structure</h3>
            <table class="compact totals-table"><tbody>
              <tr><td><span class="comp-chip c1"></span>Fixed cost</td><td class="num">${fmtMoney(c.fixed)}</td><td class="num">${pct(c.fixed)}</td></tr>
              <tr><td><span class="comp-chip c2"></span>Variable cost (${fmtNum(s.distanceKm, 0)} km)</td><td class="num">${fmtMoney(c.variable)}</td><td class="num">${pct(c.variable)}</td></tr>
              <tr><td><span class="comp-chip c3"></span>Fixed-variable cost</td><td class="num">${fmtMoney(c.fixedVariable)}</td><td class="num">${pct(c.fixedVariable)}</td></tr>
              <tr><td><span class="comp-chip c4"></span>Diesel (${fmtNum(s.dieselLitres, 1)} L)</td><td class="num">${fmtMoney(c.diesel)}</td><td class="num">${pct(c.diesel)}</td></tr>
            </tbody></table>` : ''}
            ${bill.notes ? `<p class="small" style="margin-top:.8rem"><strong>Notes:</strong> ${esc(bill.notes)}</p>` : ''}
          </div>
          <table class="totals-table"><tbody>
            <tr><td>Subtotal</td><td class="num">${fmtMoney(s.subtotal)}</td></tr>
            <tr><td>Levies ${s.levyRate ? `(${fmtNum(s.levyRate, 2)}%)` : ''}</td><td class="num">${fmtMoney(s.levyAmount)}</td></tr>
            <tr><td>VAT ${s.vatRate ? `(${fmtNum(s.vatRate, 2)}%)` : ''}</td><td class="num">${fmtMoney(s.vatAmount)}</td></tr>
            <tr class="grand"><td>TOTAL ${esc(bill.currency)}</td><td class="num">${fmtMoney(s.total)}</td></tr>
          </tbody></table>
        </div>
        <div class="signatures"><div>Prepared by${bill.preparedBy ? `: ${esc(bill.preparedBy)}` : ''}</div><div>Checked by</div><div>Approved by</div></div>
      </div>`;
  }
  function billingSheets(bill) {
    const internal = bill.partyId === P.INTERNAL;
    const head = internal
      ? ['#', 'Date', 'Waybill', 'Vehicle', 'Class', 'Driver', 'Route', 'Product', 'Qty', 'MOQ', 'Billable qty', 'MOQ applied', 'Km', 'Fixed', 'Variable', 'Fixed-variable', 'Diesel L', 'Diesel price', 'Diesel', 'Trip cost', 'Cost/unit', 'Cost/km']
      : ['#', 'Date', 'Waybill', 'Vehicle', 'Class', 'Route', 'Product', 'Qty', 'Unit', 'MOQ', 'Billable qty', 'MOQ applied', 'MOQ top-up', 'Rate', 'Amount', 'MOQ top-up value'];
    const rows = bill.lines.map((l, i) => internal
      ? [i + 1, l.date, l.waybill, l.vehicleNo, l.vehicleClass, l.driver, l.routeName, l.product, l.actualQty, l.moq, l.billableQty, l.moqApplied ? 'Y' : '', l.distanceKm, l.components && l.components.fixed, l.components && l.components.variable, l.components && l.components.fixedVariable, l.dieselLitres, l.dieselPricePerLitre, l.components && l.components.diesel, l.amount, l.costPerUnit, l.costPerKm]
      : [i + 1, l.date, l.waybill, l.vehicleNo, l.vehicleClass, l.routeName, l.product, l.actualQty, l.unit, l.moq, l.billableQty, l.moqApplied ? 'Y' : '', l.moqTopUp, l.rate, l.amount, l.moqTopUpValue]);
    const s = bill.summary;
    const summary = [['Billing No.', bill.number], ['Party', partyName(bill.partyId)], ['Period', P.periodLabel(bill.period)], ['Price list', bill.priceListName], ['Status', bill.status], ['Currency', bill.currency], [],
      ['Trips', s.trips], ['Actual qty', s.actualQty], ['Billable qty', s.billableQty], ['Trips at MOQ', s.moqTrips], ['MOQ top-up qty', s.moqTopUp], ['MOQ top-up value', s.moqTopUpValue], ['Distance km', s.distanceKm], ['Diesel litres', s.dieselLitres], [],
      ['Fixed cost', s.components.fixed], ['Variable cost', s.components.variable], ['Fixed-variable cost', s.components.fixedVariable], ['Diesel', s.components.diesel], [],
      ['Subtotal', s.subtotal], [`Levies ${s.levyRate}%`, s.levyAmount], [`VAT ${s.vatRate}%`, s.vatAmount], ['TOTAL', s.total], ['Cost per unit', s.costPerUnit], ['Cost per trip', s.costPerTrip], ['Cost per km', s.costPerKm]];
    return [{ name: 'Summary', rows: summary }, { name: 'Lines', rows: [head, ...rows] }];
  }

  // ------------------------------------------------------------------ comparison report
  function renderReport() {
    const r = state.report;
    if (!r.period) r.period = latestPeriod();
    const args = { period: r.period, trips: db.trips, billings: db.billings, priceLists: db.priceLists, routes: db.routes, contractors: db.contractors, contractorId: r.contractorId || null };
    const mom = P.buildMonthlyComparison(args);
    const cu = mom.current, pr = mom.previous, t = cu.totals, d = mom.deltas;
    const src = (s) => s === 'LOGGED' ? '<span class="badge good">logged billing</span>' : s === 'ESTIMATED' ? '<span class="badge warn">estimated from price list (no billing logged)</span>' : '<span class="badge">no trips</span>';
    const delta = (x, goodWhenUp = false) => `<span class="delta ${x.change ? ((x.change > 0) === goodWhenUp ? 'up' : 'down') : ''}">${x.change > 0 ? '▲' : x.change < 0 ? '▼' : '•'} ${fmtMoney(Math.abs(x.change))} (${fmtPct(x.changePct)})</span>`;
    const momRow = (label, key, fmt = fmtMoney, goodWhenUp = false) => `<tr><td>${label}</td><td class="num">${fmt(d[key].previous)}</td><td class="num">${fmt(d[key].current)}</td><td class="num">${d[key].change ? `<span class="delta ${(d[key].change > 0) === goodWhenUp ? 'up' : 'down'}">${d[key].change > 0 ? '+' : ''}${fmt(d[key].change)}</span>` : '—'}</td><td class="num">${fmtPct(d[key].changePct)}</td></tr>`;
    const compRows = cu.rows.filter((x) => x.internal.trips);
    return `
      <div class="card">
        <div class="card-head"><div><h1>Monthly Comparison Report — In-house Analysis</h1><div class="small muted">${esc(P.periodLabel(cu.period))} vs ${esc(P.periodLabel(pr.period))} · Internal: ${esc(cu.priceLists.internal || 'no price list')} · Contractor benchmark: ${esc(cu.priceLists.contractor || 'no price list')}</div></div>
          <div class="row"><button class="btn" data-action="report-export">Export Excel/CSV</button><button class="btn" onclick="window.print()">Print / PDF</button></div></div>
        <div class="toolbar no-print">
          <label>Period<input type="month" data-report="period" value="${esc(r.period)}"></label>
          <label>Contractor<select data-report="contractorId">${options(db.contractors, r.contractorId, { allLabel: 'All contractors' })}</select></label>
          <span style="align-self:center" class="small">Internal source: ${src(cu.sources.internal)} &nbsp; Contractor source: ${src(cu.sources.contractor)}</span>
        </div>
        <div class="kpis">
          <div class="kpi"><div class="label">Internal billing (in-house cost)</div><div class="value">${fmtMoney(t.internal.amount)}</div><div class="delta">${t.internal.trips} trips · ${fmtNum(t.internal.billableQty, 1)} units · ${delta(d.internalAmount)}</div></div>
          <div class="kpi"><div class="label">Contractor billing</div><div class="value">${fmtMoney(t.contractor.amount)}</div><div class="delta">${t.contractor.trips} trips · ${fmtNum(t.contractor.billableQty, 1)} units · ${delta(d.contractorAmount)}</div></div>
          <div class="kpi"><div class="label">In-house saving vs contractor rate</div><div class="value">${fmtMoney(t.inhouseSaving)}</div><div class="delta">Internal trips would cost ${fmtMoney(t.internalAtContractorRate)} at contractor rates · ${delta(d.inhouseSaving, true)}</div></div>
          <div class="kpi"><div class="label">Cost per unit — internal vs contractor</div><div class="value">${fmtMoney(t.internal.costPerUnit)} <span class="muted" style="font-size:1rem">vs</span> ${fmtMoney(t.contractor.costPerUnit)}</div><div class="delta">Contractor is ${fmtPct(t.costPerUnitVariancePct)} vs in-house</div></div>
          <div class="kpi"><div class="label">Diesel (internal)</div><div class="value">${fmtMoney(t.internal.components.diesel)}</div><div class="delta">${fmtNum(t.internal.dieselLitres, 0)} L · ${delta(d.dieselCost)}</div></div>
          <div class="kpi"><div class="label">MOQ top-ups paid to contractors</div><div class="value">${fmtMoney(t.contractor.moqTopUpValue)}</div><div class="delta">${t.contractor.moqTrips} trips under MOQ · ${delta(d.moqTopUpValue)}</div></div>
        </div>
      </div>

      <div class="card">
        <h2>Month-over-month</h2>
        <div class="table-wrap"><table class="compact"><thead><tr><th>Measure</th><th class="num">${esc(P.periodLabel(pr.period))}</th><th class="num">${esc(P.periodLabel(cu.period))}</th><th class="num">Change</th><th class="num">%</th></tr></thead><tbody>
          ${momRow('Internal billing', 'internalAmount')}${momRow('Contractor billing', 'contractorAmount')}${momRow('Combined haulage cost', 'combinedAmount')}
          ${momRow('Internal trips', 'internalTrips', (v) => fmtNum(v, 0))}${momRow('Contractor trips', 'contractorTrips', (v) => fmtNum(v, 0))}
          ${momRow('Internal billable units', 'internalQty', (v) => fmtNum(v, 1))}${momRow('Contractor billable units', 'contractorQty', (v) => fmtNum(v, 1))}
          ${momRow('Internal cost per unit', 'internalCostPerUnit')}${momRow('Contractor cost per unit', 'contractorCostPerUnit')}${momRow('Internal cost per km', 'internalCostPerKm')}
          ${momRow('Diesel litres (internal)', 'dieselLitres', (v) => fmtNum(v, 0))}${momRow('Diesel cost (internal)', 'dieselCost')}
          ${momRow('In-house saving vs contractor rate', 'inhouseSaving', fmtMoney, true)}${momRow('MOQ top-up value (contractors)', 'moqTopUpValue')}
        </tbody></table></div>
      </div>

      <div class="card">
        <h2>Route comparison — ${esc(P.periodLabel(cu.period))}</h2>
        <div class="table-wrap"><table class="compact">
          <thead><tr><th rowspan="2">Route</th><th rowspan="2" class="num">Km</th><th colspan="4" style="text-align:center">Internal (in-house)</th><th colspan="4" style="text-align:center">Contractor</th><th rowspan="2" class="num" title="Contractor cost/unit minus internal cost/unit">Cost/unit variance</th><th rowspan="2" class="num" title="Internal trips re-priced at the contractor tariff, minus internal cost">In-house saving</th><th rowspan="2" class="num" title="Contractor billing minus what the same trips would cost in-house">Outsourcing premium</th></tr>
          <tr><th class="num">Trips</th><th class="num">Units</th><th class="num">Amount</th><th class="num">Cost/unit</th><th class="num">Trips</th><th class="num">Units</th><th class="num">Amount</th><th class="num">Cost/unit</th></tr></thead>
          <tbody>${cu.rows.length ? cu.rows.map((x) => `<tr><td>${esc(x.routeName)}</td><td class="num">${fmtNum(x.distanceKm, 0)}</td>
            <td class="num">${x.internal.trips}</td><td class="num">${fmtNum(x.internal.billableQty, 1)}</td><td class="num">${fmtMoney(x.internal.amount)}</td><td class="num">${x.internal.trips ? fmtMoney(x.internal.costPerUnit) : '—'}</td>
            <td class="num">${x.contractor.trips}</td><td class="num">${fmtNum(x.contractor.billableQty, 1)}</td><td class="num">${fmtMoney(x.contractor.amount)}</td><td class="num">${x.contractor.trips ? fmtMoney(x.contractor.costPerUnit) : '—'}</td>
            <td class="num">${x.internal.trips && x.contractor.trips ? `<span class="delta ${x.costPerUnitVariance >= 0 ? 'up' : 'down'}">${fmtMoney(x.costPerUnitVariance)} (${fmtPct(x.costPerUnitVariancePct)})</span>` : '—'}</td>
            <td class="num">${x.internal.trips ? `<span class="delta ${x.inhouseSaving >= 0 ? 'up' : 'down'}">${fmtMoney(x.inhouseSaving)}</span>` : '—'}</td>
            <td class="num">${x.contractor.trips ? `<span class="delta ${x.outsourcingPremium > 0 ? 'down' : 'up'}">${fmtMoney(x.outsourcingPremium)}</span>` : '—'}</td></tr>`).join('') : '<tr><td colspan="13"><div class="empty">No trips in this period.</div></td></tr>'}
          </tbody>
          <tfoot><tr><td>Total</td><td></td><td class="num">${t.internal.trips}</td><td class="num">${fmtNum(t.internal.billableQty, 1)}</td><td class="num">${fmtMoney(t.internal.amount)}</td><td class="num">${fmtMoney(t.internal.costPerUnit)}</td>
            <td class="num">${t.contractor.trips}</td><td class="num">${fmtNum(t.contractor.billableQty, 1)}</td><td class="num">${fmtMoney(t.contractor.amount)}</td><td class="num">${fmtMoney(t.contractor.costPerUnit)}</td>
            <td class="num">${fmtMoney(t.costPerUnitVariance)} (${fmtPct(t.costPerUnitVariancePct)})</td><td class="num">${fmtMoney(t.inhouseSaving)}</td><td class="num">${fmtMoney(t.outsourcingPremium)}</td></tr></tfoot>
        </table></div>
        <p class="hint">In-house saving = what the contractor tariff would have charged for the internal trips, minus the internal cost. Outsourcing premium = contractor billing minus what those trips would have cost in-house (at standard diesel litres). Positive = in-house cheaper.</p>
        ${cu.rows.length ? window.Charts.groupedBars({
          categories: cu.rows.map((x) => x.routeName),
          series: [{ name: 'Internal (in-house) cost/unit', values: cu.rows.map((x) => x.internal.costPerUnit) }, { name: 'Contractor cost/unit', values: cu.rows.map((x) => x.contractor.costPerUnit) }],
          fmt: (v) => fmtNum(v, 0), unitLabel: `Cost per unit by route (${cur()})`,
        }) : ''}
      </div>

      <div class="card">
        <h2>Internal cost structure — fixed, variable, fixed-variable, diesel</h2>
        <div class="table-wrap"><table class="compact">
          <thead><tr><th>Route</th><th class="num">Trips</th><th class="num">Km</th><th class="num"><span class="comp-chip c1"></span>Fixed</th><th class="num"><span class="comp-chip c2"></span>Variable</th><th class="num"><span class="comp-chip c3"></span>Fixed-variable</th><th class="num">Diesel L</th><th class="num"><span class="comp-chip c4"></span>Diesel</th><th class="num">Total</th><th class="num">Cost/trip</th><th class="num">Cost/km</th><th class="num">Diesel share</th></tr></thead>
          <tbody>${compRows.length ? compRows.map((x) => `<tr><td>${esc(x.routeName)}</td><td class="num">${x.internal.trips}</td><td class="num">${fmtNum(x.internal.distanceKm, 0)}</td>
            <td class="num">${fmtMoney(x.internal.components.fixed)}</td><td class="num">${fmtMoney(x.internal.components.variable)}</td><td class="num">${fmtMoney(x.internal.components.fixedVariable)}</td><td class="num">${fmtNum(x.internal.dieselLitres, 0)}</td><td class="num">${fmtMoney(x.internal.components.diesel)}</td>
            <td class="num"><strong>${fmtMoney(x.internal.amount)}</strong></td><td class="num">${fmtMoney(x.internal.costPerTrip)}</td><td class="num">${fmtMoney(x.internal.costPerKm)}</td><td class="num">${x.internal.amount ? fmtNum((x.internal.components.diesel / x.internal.amount) * 100, 1) + '%' : '—'}</td></tr>`).join('') : '<tr><td colspan="12"><div class="empty">No internal trips in this period.</div></td></tr>'}
          </tbody>
          <tfoot><tr><td>Total</td><td class="num">${t.internal.trips}</td><td class="num">${fmtNum(t.internal.distanceKm, 0)}</td><td class="num">${fmtMoney(t.internal.components.fixed)}</td><td class="num">${fmtMoney(t.internal.components.variable)}</td><td class="num">${fmtMoney(t.internal.components.fixedVariable)}</td><td class="num">${fmtNum(t.internal.dieselLitres, 0)}</td><td class="num">${fmtMoney(t.internal.components.diesel)}</td><td class="num">${fmtMoney(t.internal.amount)}</td><td class="num">${fmtMoney(t.internal.costPerTrip)}</td><td class="num">${fmtMoney(t.internal.costPerKm)}</td><td class="num">${t.internal.amount ? fmtNum((t.internal.components.diesel / t.internal.amount) * 100, 1) + '%' : '—'}</td></tr></tfoot>
        </table></div>
        ${compRows.length ? window.Charts.stackedBars({
          rows: compRows.map((x) => ({ label: x.routeName, values: P.COMPONENTS.map((k) => x.internal.components[k]) })),
          series: P.COMPONENTS.map((k) => ({ name: P.COMPONENT_LABELS[k] })),
          fmt: (v) => fmtNum(v, 0), unitLabel: `Internal cost by component (${cur()})`,
        }) : ''}
      </div>`;
  }
  function reportSheets(mom) {
    const cu = mom.current, pr = mom.previous, d = mom.deltas;
    const summary = [['Monthly Comparison Report — In-house Analysis'], ['Period', P.periodLabel(cu.period)], ['Compared with', P.periodLabel(pr.period)], ['Contractor filter', cu.contractorId ? partyName(cu.contractorId) : 'All contractors'], ['Internal source', cu.sources.internal], ['Contractor source', cu.sources.contractor], [],
      ['Measure', P.periodLabel(pr.period), P.periodLabel(cu.period), 'Change', 'Change %'],
      ...Object.keys(d).map((k) => [k, d[k].previous, d[k].current, d[k].change, d[k].changePct])];
    const routes = [['Route', 'Km', 'Int trips', 'Int units', 'Int amount', 'Int cost/unit', 'Int cost/km', 'Ctr trips', 'Ctr units', 'Ctr amount', 'Ctr cost/unit', 'Ctr MOQ trips', 'Ctr MOQ top-up value', 'Cost/unit variance', 'Variance %', 'Internal at contractor rate', 'In-house saving', 'Contractor at internal cost', 'Outsourcing premium'],
      ...cu.rows.map((x) => [x.routeName, x.distanceKm, x.internal.trips, x.internal.billableQty, x.internal.amount, x.internal.costPerUnit, x.internal.costPerKm, x.contractor.trips, x.contractor.billableQty, x.contractor.amount, x.contractor.costPerUnit, x.contractor.moqTrips, x.contractor.moqTopUpValue, x.costPerUnitVariance, x.costPerUnitVariancePct, x.internalAtContractorRate, x.inhouseSaving, x.contractorAtInternalCost, x.outsourcingPremium])];
    const comps = [['Route', 'Trips', 'Km', 'Fixed', 'Variable', 'Fixed-variable', 'Diesel litres', 'Diesel', 'Total', 'Cost/trip', 'Cost/km', 'Cost/unit'],
      ...cu.rows.filter((x) => x.internal.trips).map((x) => [x.routeName, x.internal.trips, x.internal.distanceKm, x.internal.components.fixed, x.internal.components.variable, x.internal.components.fixedVariable, x.internal.dieselLitres, x.internal.components.diesel, x.internal.amount, x.internal.costPerTrip, x.internal.costPerKm, x.internal.costPerUnit])];
    return [{ name: 'Summary', rows: summary }, { name: 'Routes', rows: routes }, { name: 'Internal cost structure', rows: comps }];
  }

  // ------------------------------------------------------------------ setup
  function renderSetup() {
    const s = db.settings;
    return `
      <div class="card">
        <div class="card-head"><h1>Setup</h1><button class="btn primary" data-action="settings-save">Save settings</button></div>
        <div class="form-grid" id="settings-form">
          ${field('Company', 'company', 'text', s.company || '')}
          ${field('Company address', 'companyAddress', 'text', s.companyAddress || '')}
          ${field('Currency code', 'currency', 'text', s.currency || 'GHS', 'maxlength="4"')}
          ${field('VAT rate %', 'vatRate', 'number', s.vatRate != null ? s.vatRate : 0, 'step="0.01" min="0"')}
          ${field('Levies % (NHIL, GETFund, etc.)', 'levyRate', 'number', s.levyRate != null ? s.levyRate : 0, 'step="0.01" min="0"')}
          <label>Tax internal billing?<select name="taxInternal"><option value="false" ${s.taxInternal === false ? 'selected' : ''}>No — cost recharge</option><option value="true" ${s.taxInternal !== false ? 'selected' : ''}>Yes</option></select></label>
          ${field('Default diesel price / litre', 'defaultDieselPricePerLitre', 'number', s.defaultDieselPricePerLitre || '', 'step="0.01" min="0"')}
          ${field('Vehicle classes (comma separated)', 'vehicleClasses', 'text', (s.vehicleClasses || []).join(', '))}
          ${field('Units (comma separated)', 'units', 'text', (s.units || []).join(', '))}
          <label class="full">Products (comma separated)<input name="products" value="${esc((s.products || []).join(', '))}"></label>
        </div>
      </div>
      <div class="grid two">
        <div class="card">
          <div class="card-head"><h2>Routes</h2><button class="btn sm primary" data-action="route-new">+ Route</button></div>
          <table class="compact"><thead><tr><th>Code</th><th>Origin</th><th>Destination</th><th class="num">Km</th><th></th></tr></thead><tbody>
            ${db.routes.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.origin)}</td><td>${esc(r.destination)}</td><td class="num">${fmtNum(r.distanceKm, 0)}</td><td class="actions"><button class="btn sm" data-action="route-edit" data-id="${esc(r.id)}">Edit</button> <button class="btn sm ghost danger" data-action="route-delete" data-id="${esc(r.id)}">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">No routes.</div></td></tr>'}
          </tbody></table>
        </div>
        <div class="card">
          <div class="card-head"><h2>Contractors</h2><button class="btn sm primary" data-action="contractor-new">+ Contractor</button></div>
          <table class="compact"><thead><tr><th>Code</th><th>Name</th><th>Contact</th><th class="num">Terms</th><th></th></tr></thead><tbody>
            ${db.contractors.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td class="small">${esc(c.contact || '')}${c.phone ? '<br>' + esc(c.phone) : ''}</td><td class="num">${c.paymentTermsDays || ''} d</td><td class="actions"><button class="btn sm" data-action="contractor-edit" data-id="${esc(c.id)}">Edit</button> <button class="btn sm ghost danger" data-action="contractor-delete" data-id="${esc(c.id)}">✕</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">No contractors.</div></td></tr>'}
          </tbody></table>
        </div>
      </div>`;
  }
  const routeForm = (r = {}) => `<div class="form-grid">${field('Code', 'code', 'text', r.code || '', 'required')}${field('Distance (km)', 'distanceKm', 'number', r.distanceKm != null ? r.distanceKm : '', 'step="0.1" min="0" required')}${field('Origin', 'origin', 'text', r.origin || '', 'required')}${field('Destination', 'destination', 'text', r.destination || '', 'required')}</div>`;
  const contractorForm = (c = {}) => `<div class="form-grid">${field('Code (used in billing numbers)', 'code', 'text', c.code || '', 'required maxlength="6"')}${field('Name', 'name', 'text', c.name || '', 'required')}${field('Contact / email', 'contact', 'text', c.contact || '')}${field('Phone', 'phone', 'text', c.phone || '')}${field('Payment terms (days)', 'paymentTermsDays', 'number', c.paymentTermsDays || 30, 'min="0"')}</div>`;

  // ------------------------------------------------------------------ data
  function renderData() {
    const size = (() => { try { return (localStorage.getItem(window.Store.KEY) || '').length; } catch (e) { return 0; } })();
    return `
      <div class="card"><h1>Data</h1>
        <p>All data is stored in this browser (localStorage, ${fmtNum(size / 1024, 0)} KB). Export regularly for backup or to move to another computer; import restores a backup.</p>
        <div class="row">
          <button class="btn primary" data-action="data-export">Export backup (.json)</button>
          <label class="btn">Import backup… <input type="file" accept="application/json,.json" data-action="data-import" hidden></label>
          <button class="btn" data-action="data-export-all">Export everything to Excel/CSV</button>
          <button class="btn danger" data-action="data-reset">Reset to demo data</button>
        </div>
        <h3 style="margin-top:1rem">Counts</h3>
        <table class="compact" style="max-width:420px"><tbody>
          <tr><td>Routes</td><td class="num">${db.routes.length}</td></tr><tr><td>Contractors</td><td class="num">${db.contractors.length}</td></tr><tr><td>Price lists</td><td class="num">${db.priceLists.length}</td></tr><tr><td>Trips</td><td class="num">${db.trips.length}</td></tr><tr><td>Billings</td><td class="num">${db.billings.length}</td></tr>
        </tbody></table>
      </div>`;
  }

  // ------------------------------------------------------------------ actions
  $('#view').addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-action="set-period"]')) { state.period = el.value; render(); return; }
    if (el.matches('[data-filter]')) { state.tripFilter[el.dataset.filter] = el.value; render(); return; }
    if (el.matches('[data-bill]')) { state.billing[el.dataset.bill] = el.value; if (el.dataset.bill !== 'priceListId') state.billing.priceListId = ''; state.billing.preview = null; render(); return; }
    if (el.matches('[data-report]')) { state.report[el.dataset.report] = el.value; render(); return; }
    if (el.matches('[data-action="data-import"]')) {
      const f = el.files[0]; if (!f) return;
      f.text().then((txt) => { db = window.Store.importJson(txt); state.billing.preview = null; render(); toast('Backup imported'); }).catch((err) => toast(`Import failed: ${err.message}`));
      return;
    }
    const head = el.closest('[data-pl-head]');
    if (head) {
      const pl = db.priceLists.find((l) => l.id === head.dataset.plHead); if (!pl) return;
      const k = el.name; pl[k] = el.type === 'number' ? (el.value === '' ? undefined : P.num(el.value)) : el.value;
      if (k === 'partyId') { pl.lines.forEach((l) => { /* keep lines; fields not relevant are ignored by the engine */ }); }
      save(); render(); return;
    }
    const tr = el.closest('tr[data-line]');
    if (tr) {
      const table = tr.closest('[data-pl-lines]'); const pl = db.priceLists.find((l) => l.id === table.dataset.plLines);
      const line = pl && pl.lines.find((l) => l.id === tr.dataset.line); if (!line) return;
      line[el.dataset.field] = el.type === 'number' ? P.num(el.value) : el.value;
      if (el.dataset.field === 'unit' && el.value === 'TRIP') line.moq = 0;
      save(); render(); return;
    }
  });

  $('#view').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]'); if (!btn || btn.tagName === 'INPUT') return;
    const a = btn.dataset.action, id = btn.dataset.id;
    if (btn.tagName === 'A') e.preventDefault();
    const act = {
      go: () => { state.view = btn.dataset.view; render(); },
      'trip-new': () => openTripForm(null),
      'trip-edit': () => openTripForm(db.trips.find((t) => t.id === id)),
      'trip-delete': () => {
        const t = db.trips.find((x) => x.id === id);
        if (t.billingId) return toast('Trip is on a logged billing — void the billing first');
        if (confirm(`Delete trip ${t.waybill}?`)) { db.trips = db.trips.filter((x) => x.id !== id); save(); render(); toast('Trip deleted'); }
      },
      'export-trips': () => {
        const f = state.tripFilter;
        const rows = db.trips.filter((t) => (!f.period || P.periodOf(t.date) === f.period) && (!f.partyId || t.partyId === f.partyId));
        window.Exporter.workbook(`trips-${f.period || 'all'}`, [{ name: 'Trips', rows: [['Date', 'Waybill', 'Party', 'Vehicle', 'Class', 'Driver', 'Route', 'Product', 'Qty', 'Unit', 'Km', 'Diesel L', 'Status', 'Billing', 'Remarks'], ...rows.map((t) => [t.date, t.waybill, partyName(t.partyId), t.vehicleNo, t.vehicleClass, t.driver, routeLabel(t.routeId), t.product, t.qty, t.unit, t.distanceKm, t.dieselLitres, t.status, (db.billings.find((b) => b.id === t.billingId) || {}).number || '', t.remarks])] }]);
      },
      'pl-select': () => { state.priceListId = id; render(); },
      'pl-new': () => modal('New price list', `<div class="form-grid">${field('Name', 'name', 'text', `Billing Price List ${new Date().getFullYear() + 1}`, 'required')}${selectField('Party', 'partyId', options(parties(), P.INTERNAL))}${field('Valid from', 'validFrom', 'date', `${new Date().getFullYear() + 1}-01-01`)}${field('Valid to', 'validTo', 'date', `${new Date().getFullYear() + 1}-12-31`)}${field('Diesel price / litre (internal lists)', 'dieselPricePerLitre', 'number', db.settings.defaultDieselPricePerLitre || '', 'step="0.01"')}</div>`, (v) => {
        const pl = { id: window.Store.uid('PL'), name: v.name.trim(), partyId: v.partyId, currency: cur(), validFrom: v.validFrom, validTo: v.validTo, status: 'DRAFT', dieselPricePerLitre: P.num(v.dieselPricePerLitre), notes: '', lines: db.routes.map((r) => ({ id: window.Store.uid('L'), routeId: r.id, vehicleClass: 'ANY', unit: 'TONNE', moq: 0, ratePerUnit: 0, fixedCost: 0, variableCostPerKm: 0, fixedVariableCost: 0, dieselLitres: 0 })) };
        db.priceLists.push(pl); state.priceListId = pl.id; save(); render(); toast('Price list created with one line per route');
      }, { submitLabel: 'Create' }),
      'pl-duplicate': () => {
        const src = db.priceLists.find((l) => l.id === id); const y = (parseInt((src.validFrom || '').slice(0, 4), 10) || new Date().getFullYear()) + 1;
        const copy = JSON.parse(JSON.stringify(src)); copy.id = window.Store.uid('PL'); copy.name = src.name.replace(/\d{4}/, String(y)) + (src.name.match(/\d{4}/) ? '' : ` ${y}`); copy.status = 'DRAFT'; copy.validFrom = `${y}-01-01`; copy.validTo = `${y}-12-31`; copy.lines.forEach((l) => (l.id = window.Store.uid('L')));
        db.priceLists.push(copy); state.priceListId = copy.id; save(); render(); toast('Duplicated as draft');
      },
      'pl-delete': () => {
        const used = db.billings.filter((b) => b.priceListId === id).length;
        if (confirm(`Delete this price list?${used ? ` ${used} logged billing(s) reference it (their snapshots stay intact).` : ''}`)) { db.priceLists = db.priceLists.filter((l) => l.id !== id); save(); render(); }
      },
      'pl-export': () => {
        const pl = db.priceLists.find((l) => l.id === id); const internal = pl.partyId === P.INTERNAL;
        const head = internal ? ['Route', 'Vehicle class', 'Unit', 'MOQ', 'Fixed cost', 'Variable/km', 'Fixed-variable', 'Diesel litres', 'Diesel price', 'Cost/trip'] : ['Route', 'Vehicle class', 'Unit', 'MOQ', 'Rate/unit', 'Min charge/trip'];
        const rows = pl.lines.map((l) => internal ? [routeLabel(l.routeId), l.vehicleClass, l.unit, l.moq, l.fixedCost, l.variableCostPerKm, l.fixedVariableCost, l.dieselLitres, pl.dieselPricePerLitre, P.round2(P.num(l.fixedCost) + P.num(l.variableCostPerKm) * P.num((route(l.routeId) || {}).distanceKm) + P.num(l.fixedVariableCost) + P.num(l.dieselLitres) * P.num(pl.dieselPricePerLitre))] : [routeLabel(l.routeId), l.vehicleClass, l.unit, l.moq, l.ratePerUnit, l.unit === 'TRIP' ? l.ratePerUnit : P.round2(P.num(l.ratePerUnit) * P.num(l.moq))]);
        window.Exporter.workbook(pl.name.replace(/\W+/g, '_'), [{ name: 'Price list', rows: [['Name', pl.name], ['Party', partyName(pl.partyId)], ['Valid', `${pl.validFrom || ''} → ${pl.validTo || ''}`], ['Status', pl.status], [], head, ...rows] }]);
      },
      'pl-line-add': () => { const pl = db.priceLists.find((l) => l.id === id); pl.lines.push({ id: window.Store.uid('L'), routeId: (db.routes[0] || {}).id, vehicleClass: 'ANY', unit: 'TONNE', moq: 0, ratePerUnit: 0, fixedCost: 0, variableCostPerKm: 0, fixedVariableCost: 0, dieselLitres: 0 }); save(); render(); },
      'pl-line-delete': () => { const pl = db.priceLists.find((l) => l.id === state.priceListId); pl.lines = pl.lines.filter((l) => l.id !== id); save(); render(); },
      'bill-preview': () => {
        const b = state.billing; const pl = db.priceLists.find((l) => l.id === b.priceListId) || P.pickPriceList(db.priceLists, b.partyId, b.period);
        const trips = P.selectTrips(db.trips, b.partyId, b.period);
        b.preview = P.buildBilling({ partyId: b.partyId, period: b.period, priceList: pl, trips, routes: db.routes, settings: db.settings, number: P.nextBillingNumber(db.billings, partyCode(b.partyId), b.period) });
        render();
      },
      'bill-cancel': () => { state.billing.preview = null; render(); },
      'bill-save': () => {
        const b = state.billing.preview; if (!b) return;
        b.id = `B-${b.number}`; b.createdAt = new Date().toISOString(); b.status = 'DRAFT';
        b.lines.forEach((l) => { const t = db.trips.find((x) => x.id === l.tripId); if (t) t.billingId = b.id; });
        db.billings.push(b); state.billing.preview = null; state.billing.openId = b.id; save(); render(); toast(`${b.number} logged`);
      },
      'open-billing': () => { state.view = 'billing'; state.billing.openId = id; render(); },
      'bill-back': () => { state.billing.openId = null; render(); },
      'bill-status': () => { const b = db.billings.find((x) => x.id === id); b.status = btn.dataset.status; save(); render(); toast(`${b.number} ${b.status.toLowerCase()}`); },
      'bill-void': () => {
        const b = db.billings.find((x) => x.id === id);
        if (confirm(`Void ${b.number}? Its trips become unbilled and can be re-generated.`)) { b.status = 'VOID'; db.trips.forEach((t) => { if (t.billingId === b.id) t.billingId = null; }); save(); render(); }
      },
      'bill-delete': () => { if (confirm('Permanently delete this voided billing?')) { db.billings = db.billings.filter((x) => x.id !== id); save(); render(); } },
      'bill-export': () => { const b = db.billings.find((x) => x.id === id); window.Exporter.workbook(b.number, billingSheets(b)); },
      'report-export': () => {
        const r = state.report; const mom = P.buildMonthlyComparison({ period: r.period, trips: db.trips, billings: db.billings, priceLists: db.priceLists, routes: db.routes, contractors: db.contractors, contractorId: r.contractorId || null });
        window.Exporter.workbook(`InhouseAnalysis-${r.period}`, reportSheets(mom));
      },
      'settings-save': () => {
        const f = $('#settings-form'); const v = {}; f.querySelectorAll('[name]').forEach((i) => (v[i.name] = i.value));
        const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
        Object.assign(db.settings, { company: v.company.trim(), companyAddress: v.companyAddress.trim(), currency: v.currency.trim().toUpperCase() || 'GHS', vatRate: P.num(v.vatRate), levyRate: P.num(v.levyRate), taxInternal: v.taxInternal === 'true', defaultDieselPricePerLitre: P.num(v.defaultDieselPricePerLitre), vehicleClasses: list(v.vehicleClasses), units: list(v.units), products: list(v.products) });
        save(); render(); toast('Settings saved');
      },
      'route-new': () => modal('New route', routeForm(), (v) => { db.routes.push({ id: window.Store.uid('R'), code: v.code.trim().toUpperCase(), origin: v.origin.trim(), destination: v.destination.trim(), distanceKm: P.num(v.distanceKm) }); save(); render(); }),
      'route-edit': () => { const r = route(id); modal('Edit route', routeForm(r), (v) => { Object.assign(r, { code: v.code.trim().toUpperCase(), origin: v.origin.trim(), destination: v.destination.trim(), distanceKm: P.num(v.distanceKm) }); save(); render(); }); },
      'route-delete': () => { const n = db.trips.filter((t) => t.routeId === id).length; if (n) return toast(`${n} trip(s) use this route — cannot delete`); if (confirm('Delete route?')) { db.routes = db.routes.filter((r) => r.id !== id); db.priceLists.forEach((pl) => (pl.lines = pl.lines.filter((l) => l.routeId !== id))); save(); render(); } },
      'contractor-new': () => modal('New contractor', contractorForm(), (v) => { db.contractors.push({ id: window.Store.uid('C'), code: v.code.trim().toUpperCase(), name: v.name.trim(), contact: v.contact.trim(), phone: v.phone.trim(), paymentTermsDays: P.num(v.paymentTermsDays) }); save(); render(); }),
      'contractor-edit': () => { const c = contractor(id); modal('Edit contractor', contractorForm(c), (v) => { Object.assign(c, { code: v.code.trim().toUpperCase(), name: v.name.trim(), contact: v.contact.trim(), phone: v.phone.trim(), paymentTermsDays: P.num(v.paymentTermsDays) }); save(); render(); }); },
      'contractor-delete': () => { const n = db.trips.filter((t) => t.partyId === id).length; if (n) return toast(`${n} trip(s) belong to this contractor — cannot delete`); if (confirm('Delete contractor and its price lists?')) { db.contractors = db.contractors.filter((c) => c.id !== id); db.priceLists = db.priceLists.filter((l) => l.partyId !== id); save(); render(); } },
      'data-export': () => window.Exporter.download(`haulage-billing-backup-${today()}.json`, window.Store.exportJson(db), 'application/json'),
      'data-export-all': () => window.Exporter.workbook(`haulage-billing-${today()}`, [
        { name: 'Trips', rows: [['Date', 'Waybill', 'Party', 'Vehicle', 'Class', 'Driver', 'Route', 'Product', 'Qty', 'Unit', 'Km', 'Diesel L', 'Status', 'Billing'], ...db.trips.map((t) => [t.date, t.waybill, partyName(t.partyId), t.vehicleNo, t.vehicleClass, t.driver, routeLabel(t.routeId), t.product, t.qty, t.unit, t.distanceKm, t.dieselLitres, t.status, (db.billings.find((b) => b.id === t.billingId) || {}).number || ''])] },
        { name: 'Billings', rows: [['Number', 'Period', 'Party', 'Price list', 'Status', 'Trips', 'Actual qty', 'Billable qty', 'MOQ trips', 'MOQ top-up value', 'Fixed', 'Variable', 'Fixed-variable', 'Diesel', 'Subtotal', 'Levies', 'VAT', 'Total'], ...db.billings.map((b) => [b.number, b.period, partyName(b.partyId), b.priceListName, b.status, b.summary.trips, b.summary.actualQty, b.summary.billableQty, b.summary.moqTrips, b.summary.moqTopUpValue, b.summary.components.fixed, b.summary.components.variable, b.summary.components.fixedVariable, b.summary.components.diesel, b.summary.subtotal, b.summary.levyAmount, b.summary.vatAmount, b.summary.total])] },
        { name: 'Price list lines', rows: [['Price list', 'Party', 'Route', 'Class', 'Unit', 'MOQ', 'Rate/unit', 'Fixed', 'Variable/km', 'Fixed-variable', 'Diesel litres', 'Diesel price'], ...db.priceLists.flatMap((pl) => pl.lines.map((l) => [pl.name, partyName(pl.partyId), routeLabel(l.routeId), l.vehicleClass, l.unit, l.moq, l.ratePerUnit, l.fixedCost, l.variableCostPerKm, l.fixedVariableCost, l.dieselLitres, pl.dieselPricePerLitre]))] },
        { name: 'Routes', rows: [['Code', 'Origin', 'Destination', 'Km'], ...db.routes.map((r) => [r.code, r.origin, r.destination, r.distanceKm])] },
        { name: 'Contractors', rows: [['Code', 'Name', 'Contact', 'Phone', 'Terms (days)'], ...db.contractors.map((c) => [c.code, c.name, c.contact, c.phone, c.paymentTermsDays])] },
      ]),
      'data-reset': () => { if (confirm('Replace ALL data with the demo dataset? Export a backup first if needed.')) { db = window.Store.reset(); state.billing.preview = null; state.billing.openId = null; state.priceListId = null; render(); toast('Demo data restored'); } },
    };
    if (act[a]) act[a]();
  });

  render();
})();
