/* Dashboard and the report sheets (Client Summary, Statement, Monthly Sales Summary, Sales by Vehicle, Price Variance). */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine, h = U.h;
  HB.views = HB.views || {};

  function filterBar(ctx, f, redraw) {
    const { store } = ctx; const trips = store.trips(); const opt = (list) => [['', 'All'], ...list.map((x) => [x, x])]; const set = (k) => (e) => { f[k] = e.target.value; redraw(); };
    return h('div', { class: 'filters card' },
      U.field('From', h('input', { type: 'date', value: f.from || '', onChange: set('from') })), U.field('To', h('input', { type: 'date', value: f.to || '', onChange: set('to') })),
      U.field('Client', U.select(opt(store.clientNames()), f.client || '', { onChange: set('client') })),
      U.field('Vehicle type', U.select(opt([...new Set(store.state.assets.map((a) => a.vehicleType))].sort()), f.vehicleType || '', { onChange: set('vehicleType') })),
      U.field('Cost center', U.select(opt([...new Set(store.state.assets.map((a) => a.costCenter))].sort()), f.costCenter || '', { onChange: set('costCenter') })),
      U.field('Select Truck Batch', U.select([['', 'All Batches'], ['New Batch', 'New Batch'], ['Old Batch', 'Old Batch'], ['3rd Party', '3rd Party / unclassified']], f.truckBatch || '', { onChange: set('truckBatch') })),
      U.field('Vehicle (plate)', U.select(opt(store.state.assets.map((a) => a.plate).sort()), f.plate || '', { onChange: set('plate') })),
      U.field('Contract type', U.select(opt([...new Set(trips.map((t) => t.contractType).filter(Boolean))].sort()), f.contractType || '', { onChange: set('contractType') })),
      U.field('Payment status', U.select(opt(E.PAYMENT_STATUSES), f.paymentStatus || '', { onChange: set('paymentStatus') })),
      U.field('Invoice status', U.select(opt(E.INVOICE_STATUSES), f.invoiceStatus || '', { onChange: set('invoiceStatus') })),
      h('button', { class: 'btn', onClick: () => { for (const k of Object.keys(f)) delete f[k]; redraw(); } }, 'Clear'),
      h('span', { class: 'muted small', text: `${U.int(E.filterTrips(trips, f).length)} trips in scope` }));
  }
  const tile = (label, value, sub, kind) => h('div', { class: 'tile ' + (kind || '') }, h('span', { class: 'label', text: label }), h('span', { class: 'value', text: value }), sub ? h('span', { class: 'sub', text: sub }) : null);

  // ------------------------------------------------------------ dashboard
  const dash = { title: 'Dashboard', filters: { from: '2026-01-01' }, basis: 'net' };
  dash.render = function (root, ctx) { dash.ctx = ctx; dash.root = root; root.append(h('div', { class: 'stack', id: 'dash' })); dash.draw(); };
  dash.onStoreChange = () => { if (dash.root && dash.root.isConnected) dash.draw(); };
  dash.draw = function () {
    const ctx = dash.ctx, store = ctx.store, wrap = dash.root.querySelector('#dash'); if (!wrap) return; U.clear(wrap);
    const f = dash.filters; const trips = E.filterTrips(store.trips(), f); const d = E.dashboard(trips);
    wrap.append(filterBar(ctx, f, dash.draw));
    const perf = E.batchPerformance(trips, dash.basis);
    const basisLabel = dash.basis === 'gross' ? 'Gross invoiced (incl. VAT)' : 'Net sales (excl. VAT)';
    wrap.append(h('div', { class: 'row between' }, h('span', { class: 'muted small', text: `Reporting basis: ${basisLabel}. Net sales = selling price excluding VAT; gross = billing after VAT as invoiced. Payments and receivables are always gross.` }), h('span', { class: 'row' }, h('span', { class: 'label', text: 'Basis' }), U.select([['net', 'Net sales excl. VAT'], ['gross', 'Gross invoiced incl. VAT']], dash.basis, { onChange: (e) => { dash.basis = e.target.value; dash.draw(); } }))));
    wrap.append(h('div', { class: 'tiles' },
      tile('Total trips', U.int(d.trips), `${U.int(d.closed)} closed`), tile(dash.basis === 'gross' ? 'Total billing (incl. VAT)' : 'Net sales (excl. VAT)', U.moneyShort(perf.total.sales), U.money(perf.total.sales)), tile(`VAT (${(E.vatRateOf(store.state.settings) * 100).toFixed(1)}%)`, U.moneyShort(d.vat)),
      tile('Payments received', U.moneyShort(d.paid), null, 'good'), tile('Outstanding balance', U.moneyShort(d.balance), `${U.int(d.unpaidTrips)} unpaid trips`, d.balance > 0 ? 'bad' : 'good'),
      tile('Awaiting payment', U.int(d.awaiting), `${U.int(d.partPaid)} part paid`, 'warn'), tile('Invoice not sent', U.int(d.invoiceNotSent), null, d.invoiceNotSent ? 'bad' : ''),
      tile('Below agreed rate', U.int(d.belowAgreed), `${U.int(d.aboveAgreed)} above · net ${U.signedMoney(d.varianceTotal)}`, d.belowAgreed ? 'bad' : 'good')));
    const months = d.byMonth.months;
    const paidByMonth = months.map((m) => E.sum(trips.filter((t) => t.month === m), 'amountPaid'));
    const balByMonth = months.map((m) => E.sum(trips.filter((t) => t.month === m), 'balance'));
    wrap.append(h('div', { class: 'grid-2' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Billing by month' }), h('span', { class: 'muted small', text: 'Paid vs. outstanding (incl. VAT)' })), months.length ? HB.charts.bars({ labels: months.map(U.monthLabel), series: [{ name: 'Paid', values: paidByMonth, color: 'var(--s3)' }, { name: 'Outstanding', values: balByMonth, color: 'var(--s2)' }] }, { stacked: true, money: true }) : h('div', { class: 'empty', text: 'No trips in scope.' })),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Revenue by vehicle type' })), HB.charts.bars({ labels: d.byVehicleType.map((r) => r.key), series: [{ name: 'Billing', values: d.byVehicleType.map((r) => r.total) }] }, { money: true, height: 220 })),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Top clients by billing' })), HB.charts.hbars(d.byClient.map((r) => ({ label: r.key, value: r.total, sub: `${r.trips} trips` })), { money: true })),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Trip status' })), HB.charts.hbars(E.TRIP_STATUSES.map((s) => ({ label: s, value: trips.filter((t) => t.tripStatus === s).length })), {}))));
    // ---- Sales Performance by Truck Batch
    const M = (v) => h('td', { class: 'money', text: U.money(v) }), N = (v) => h('td', { class: 'num', text: U.int(v) });
    const kpiRows = [['Total Sales (' + basisLabel + ')', 'sales', M], ['Number of Trips', 'trips', N], ['Number of Trucks', 'trucks', N], ['Average Sales per Truck', 'perTruck', M], ['Average Sales per Trip', 'perTrip', M], ['Payments Received', 'paid', M], ['Outstanding Receivables', 'outstanding', M]];
    const hasOther = perf.other.trips > 0;
    wrap.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Sales Performance by Truck Batch' }), h('span', { class: 'muted small', text: f.truckBatch ? `Filtered to ${f.truckBatch}` : 'All batches' })),
      h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'data', style: { width: '100%' } }, h('thead', {}, h('tr', {}, h('th', { text: 'KPI' }), h('th', { class: 'money', text: 'New Batch' }), h('th', { class: 'money', text: 'Old Batch' }), hasOther ? h('th', { class: 'money', text: '3rd Party / other' }) : null, h('th', { class: 'money', text: 'Total' }))),
        h('tbody', {}, kpiRows.map(([label, key, cell]) => h('tr', {}, h('td', {}, h('strong', { text: label })), cell(perf.newBatch[key]), cell(perf.oldBatch[key]), hasOther ? cell(perf.other[key]) : null, cell(perf.total[key]))),
          h('tr', {}, h('td', {}, h('strong', { text: 'Share of total sales' })), h('td', { class: 'money', text: U.pct(perf.share['New Batch']).replace('+', '') }), h('td', { class: 'money', text: U.pct(perf.share['Old Batch']).replace('+', '') }), hasOther ? h('td', { class: 'money', text: U.pct(perf.share.Other).replace('+', '') }) : null, h('td', { class: 'money', text: '100.0%' })))))));
    wrap.append(h('div', { class: 'grid-2' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Monthly sales — New Batch vs Old Batch' }), h('span', { class: 'muted small', text: basisLabel })), perf.months.length ? HB.charts.bars({ labels: perf.months.map(U.monthLabel), series: [{ name: 'New Batch', values: perf.monthly['New Batch'], color: 'var(--s1)' }, { name: 'Old Batch', values: perf.monthly['Old Batch'], color: 'var(--s2)' }] }, { money: true }) : h('div', { class: 'empty', text: 'No trips in scope.' })),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Contribution to total sales' })), HB.charts.hbars([{ label: `New Batch · ${U.pct(perf.share['New Batch']).replace('+', '')}`, value: perf.newBatch.sales }, { label: `Old Batch · ${U.pct(perf.share['Old Batch']).replace('+', '')}`, value: perf.oldBatch.sales }].concat(hasOther ? [{ label: `3rd Party / other · ${U.pct(perf.share.Other).replace('+', '')}`, value: perf.other.sales }] : []), { money: true })),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Top trucks — New Batch' })), HB.charts.hbars(perf.topTrucks['New Batch'].map((r) => ({ label: r.key, value: r.total, sub: `${r.trips} trips` })), { money: true })),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Top trucks — Old Batch' })), HB.charts.hbars(perf.topTrucks['Old Batch'].map((r) => ({ label: r.key, value: r.total, sub: `${r.trips} trips` })), { money: true }))));
    const recent = U.sortBy(trips, (t) => t.updatedAt || '', 'desc').slice(0, 8);
    wrap.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Recently updated trips' }), h('button', { class: 'btn sm', onClick: () => ctx.nav('trips') }, 'Open Trip Log')), h('div', { class: 'table-frame short', style: { minHeight: 0, maxHeight: 'none', border: 0 } }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Updated', 'By', 'Dispatched', 'Client', 'Route', 'Plate', 'Batch', 'Selling Price', 'Agreed', 'Variance', 'Status'].map((x) => h('th', { text: x })))), h('tbody', {}, recent.map((t) => h('tr', { style: { cursor: 'pointer' }, onClick: () => { ctx.nav('trips'); setTimeout(() => HB.views.trips.openDetail(ctx, t.id), 50); } }, h('td', { text: U.dateTime(t.updatedAt) }), h('td', { text: t.updatedBy }), h('td', { text: U.date(t.dateDispatched) }), h('td', { text: t.client }), h('td', { text: `${t.loadingFrom} → ${t.loadingTo}` }), h('td', { text: t.plate }), h('td', { text: t.truckBatch }), h('td', { class: 'money', text: U.money(t.sellingPrice) }), h('td', { class: 'money', text: t.agreedPrice === null ? '—' : U.money(t.agreedPrice) }), h('td', { class: 'money var-' + t.direction, text: t.direction === 'na' ? '' : U.pct(t.variancePct) }), h('td', {}, U.pill(t.tripStatus, U.statusKind(t.tripStatus))))))))));
  };
  HB.views.dashboard = dash;

  // ------------------------------------------------------------- reports
  const rep = { title: 'Reports', tab: 'client', filters: {}, basis: 'gross' };
  rep.render = function (root, ctx) { rep.ctx = ctx; rep.root = root; root.append(h('div', { class: 'stack', id: 'rep' })); rep.draw(); };
  rep.onStoreChange = () => { if (rep.root && rep.root.isConnected) rep.draw(); };
  const TABS = [['client', 'Client Summary'], ['statement', 'Statement (all clients)'], ['monthly', 'Monthly Sales Summary'], ['vehicle', 'Sales by Vehicle'], ['variance', 'Price Variance'], ['unpaid', 'Unpaid trips']];
  rep.draw = function () {
    const ctx = rep.ctx, store = ctx.store, wrap = rep.root.querySelector('#rep'); if (!wrap) return; U.clear(wrap);
    const f = rep.filters; const trips = E.filterTrips(store.trips(), f);
    wrap.append(h('div', { class: 'row' }, TABS.filter(([k]) => k !== 'variance' || ctx.can('variance.review') || ctx.user.role === 'billing').map(([k, l]) => h('button', { class: 'btn' + (rep.tab === k ? ' primary' : ''), onClick: () => { rep.tab = k; rep.draw(); } }, l))));
    wrap.append(filterBar(ctx, f, rep.draw));
    const measure = rep.basis === 'net' ? 'netSales' : 'billing'; const measureLabel = rep.basis === 'net' ? 'Net Sales excl. VAT' : 'Billing After VAT';
    wrap.append(h('div', { class: 'row between' }, h('span', { class: 'muted small', text: `Truck Batch: ${f.truckBatch || 'All Batches'} · Basis: ${measureLabel}` }), h('span', { class: 'row' }, h('span', { class: 'label', text: 'Basis' }), U.select([['gross', 'Gross invoiced incl. VAT'], ['net', 'Net sales excl. VAT']], rep.basis, { onChange: (e) => { rep.basis = e.target.value; rep.draw(); } }))));
    const exportBtn = (name, rows) => h('button', { class: 'btn', onClick: () => HB.exporter.xlsx([{ name, rows }], `${name.replace(/\s+/g, '_')}_${U.todayISO()}.xlsx`) }, 'Export Excel');
    const table = (headers, rows, foot) => h('div', { class: 'table-frame' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, headers.map((x) => h('th', { class: typeof x === 'object' ? 'money' : '', text: typeof x === 'object' ? x.t : x })))), h('tbody', {}, rows), foot ? h('tfoot', {}, foot) : null));
    const M = (v) => h('td', { class: 'money', text: U.money(v) });
    if (rep.tab === 'client' || rep.tab === 'statement') {
      const s = E.clientSummary(trips, store.state.clients); const st = rep.tab === 'statement';
      const headers = ['Client Name', 'No. of Trips', { t: 'Total Selling Price (₦)' }, { t: 'Total VAT (₦)' }, { t: 'Total Billing After VAT (₦)' }].concat(st ? [{ t: 'Payment (₦)' }, { t: 'Balance Pending (₦)' }, ''] : []);
      wrap.append(h('div', { class: 'row between' }, h('p', { class: 'muted small', text: st ? 'Statement CLient sheet: billing, payments and balance pending per client. Payment honours the date filter (the workbook summed all months).' : 'Client Summary sheet: trips and billing per client for the selected period.' }), exportBtn(st ? 'Statement' : 'Client Summary', [headers.map((x) => (typeof x === 'object' ? x.t : x)), ...s.rows.map((r) => [r.client, r.trips, r.sellingPrice, r.vat, r.billing].concat(st ? [r.paid, r.balance, ''] : [])), [s.total.client, s.total.trips, s.total.sellingPrice, s.total.vat, s.total.billing].concat(st ? [s.total.paid, s.total.balance, ''] : [])])));
      wrap.append(table(headers, s.rows.map((r) => h('tr', {}, h('td', { text: r.client }), h('td', { class: 'num', text: r.trips }), M(r.sellingPrice), M(r.vat), M(r.billing), st ? M(r.paid) : null, st ? h('td', { class: 'money ' + (r.balance > 0.5 ? 'var-below' : ''), text: U.money(r.balance) }) : null, st ? h('td', {}, h('button', { class: 'btn sm', onClick: () => { HB.views.payments.client = r.client; HB.views.payments.tab = 'statement'; ctx.nav('payments'); } }, 'Statement')) : null)),
        h('tr', {}, h('td', { text: 'GRAND TOTAL' }), h('td', { class: 'num', text: s.total.trips }), M(s.total.sellingPrice), M(s.total.vat), M(s.total.billing), st ? M(s.total.paid) : null, st ? M(s.total.balance) : null, st ? h('td') : null)));
    } else if (rep.tab === 'monthly' || rep.tab === 'vehicle') {
      const byVeh = rep.tab === 'monthly';
      const pv = byVeh ? E.pivotByMonth(trips, 'vehicleType', measure) : E.pivotByMonth(trips, (t) => `${t.truckBatch || '(no batch)'} · ${t.plate}`, measure);
      const headers = [byVeh ? 'Type of Vehicle' : 'Vehicle (Truck Batch · Plate)', 'Trips', ...pv.months.map((m) => ({ t: U.monthLabel(m) })), { t: `Grand Total ${measureLabel} (₦)` }];
      wrap.append(h('div', { class: 'row between' }, h('p', { class: 'muted small', text: byVeh ? `Summary sheet: ${measureLabel} by vehicle type and month.` : `Summary Sales by Vehicle sheet: ${measureLabel} by truck (grouped by Truck Batch) and month.` }), exportBtn(byVeh ? 'Monthly Sales Summary' : 'Sales by Vehicle', [headers.map((x) => (typeof x === 'object' ? x.t : x)), ...pv.rows.map((r) => [r.key, r.trips, ...pv.months.map((m) => r.byMonth[m] || 0), r.total]), ['Grand Total', pv.totals.trips, ...pv.months.map((m) => pv.totals.byMonth[m] || 0), pv.totals.total]])));
      if (byVeh && pv.months.length) wrap.append(h('div', { class: 'card' }, HB.charts.bars({ labels: pv.months.map(U.monthLabel), series: pv.rows.map((r) => ({ name: r.key, values: pv.months.map((m) => r.byMonth[m] || 0) })) }, { stacked: true, money: true })));
      wrap.append(table(headers, pv.rows.map((r) => h('tr', {}, h('td', { text: r.key }), h('td', { class: 'num', text: r.trips }), ...pv.months.map((m) => M(r.byMonth[m] || 0)), M(r.total))), h('tr', {}, h('td', { text: 'Grand Total' }), h('td', { class: 'num', text: pv.totals.trips }), ...pv.months.map((m) => M(pv.totals.byMonth[m] || 0)), M(pv.totals.total))));
    } else if (rep.tab === 'variance') {
      const rows = U.sortBy(trips.filter((t) => t.direction !== 'na'), 'variance', 'asc'); const noRate = trips.filter((t) => t.agreedPrice === null && t.sellingPrice !== null).length;
      const below = rows.filter((t) => t.direction === 'below'), above = rows.filter((t) => t.direction === 'above');
      wrap.append(h('div', { class: 'tiles' }, tile('Trips priced below agreed rate', U.int(below.length), U.signedMoney(E.sum(below, 'variance')), 'bad'), tile('Trips priced above agreed rate', U.int(above.length), U.signedMoney(E.sum(above, 'variance')), 'good'), tile('At agreed rate', U.int(rows.filter((t) => t.direction === 'equal').length)), tile('No agreed rate found', U.int(noRate), 'Add rates in the Client Price List')));
      wrap.append(h('div', { class: 'row between' }, h('p', { class: 'muted small', text: 'Selling Price minus Agreed Client Price for every trip with a matching rate. Negative = billed below the agreed rate.' }), exportBtn('Price Variance', [['Date', 'Client', 'Loading From', 'Loading To', 'Vehicle Type', 'Plate', 'Agreed Client Price (₦)', 'Selling Price (₦)', 'Variance (₦)', 'Variance (%)', 'Entered by', 'Invoice'], ...rows.map((t) => [t.dateDispatched, t.client, t.loadingFrom, t.loadingTo, t.vehicleType, t.plate, t.agreedPrice, t.sellingPrice, t.variance, t.variancePct, t.updatedBy, t.invoiceNo || t.manualInvoiceNo])])));
      wrap.append(table(['Date', 'Client', 'Route', 'Vehicle', { t: 'Agreed (₦)' }, { t: 'Selling (₦)' }, { t: 'Variance (₦)' }, { t: 'Variance %' }, 'Last edited by', ''], rows.map((t) => h('tr', {}, h('td', { text: U.date(t.dateDispatched) }), h('td', { text: t.client }), h('td', { text: `${t.loadingFrom} → ${t.loadingTo}` }), h('td', { text: `${t.plate} · ${t.vehicleType}` }), M(t.agreedPrice), M(t.sellingPrice), h('td', { class: 'money var-' + t.direction, text: U.signedMoney(t.variance) }), h('td', { class: 'money var-' + t.direction, text: U.pct(t.variancePct) }), h('td', { text: t.updatedBy || '' }), h('td', {}, h('button', { class: 'btn sm', onClick: () => { ctx.nav('trips'); setTimeout(() => HB.views.trips.openDetail(ctx, t.id), 50); } }, 'Open'))))));
    } else {
      const rows = U.sortBy(trips.filter((t) => t.paymentStatus !== 'Paid' && t.invoiceStatus !== 'Internal Client'), 'dateDispatched');
      wrap.append(h('div', { class: 'row between' }, h('p', { class: 'muted small', text: 'Every trip not yet fully paid (the workbook\'s "Eligible" helper), with its invoice status.' }), exportBtn('Unpaid Trips', HB.exporter.tripsToRows(rows))));
      wrap.append(table(['Date', 'Client', 'Route', 'Plate', 'Invoice', 'Invoice Status', { t: 'Billing (₦)' }, { t: 'Paid (₦)' }, { t: 'Balance (₦)' }, 'Trip Status'], rows.map((t) => h('tr', {}, h('td', { text: U.date(t.dateDispatched) }), h('td', { text: t.client }), h('td', { text: `${t.loadingFrom} → ${t.loadingTo}` }), h('td', { text: t.plate }), h('td', { text: t.invoiceNo || t.manualInvoiceNo || '—' }), h('td', { text: t.invoiceStatus }), M(t.billing), M(t.amountPaid), M(t.balance), h('td', {}, U.pill(t.tripStatus, U.statusKind(t.tripStatus))))), h('tr', {}, h('td', { text: 'TOTAL' }), h('td', { text: `${rows.length} trips` }), h('td'), h('td'), h('td'), h('td'), M(E.sum(rows, 'billing')), M(E.sum(rows, 'amountPaid')), M(E.sum(rows, 'balance')), h('td'))));
    }
  };
  HB.views.reports = rep;
})();
