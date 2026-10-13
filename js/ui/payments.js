/* Payments and client statements (Finance). A payment updates the trips' Payment Status / Advance exactly as the
 * workbook models it (Paid → full billing; Advance → the advance amount) and is logged in the payments ledger. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine, h = U.h;
  HB.views = HB.views || {};
  const view = { title: 'Payments & Statements', tab: 'payments', client: '', month: '' };

  view.render = function (root, ctx) { view.ctx = ctx; view.root = root; root.append(h('div', { class: 'stack', id: 'pay-view' })); view.draw(); };
  view.onStoreChange = () => { if (view.root && view.root.isConnected) view.draw(); };

  view.draw = function () {
    const ctx = view.ctx, store = ctx.store, wrap = view.root.querySelector('#pay-view'); if (!wrap) return; U.clear(wrap);
    const tabs = h('div', { class: 'row' }, [['payments', 'Payments ledger'], ['statement', 'Client statement'], ['outstanding', 'Outstanding balances']].map(([k, l]) => h('button', { class: 'btn' + (view.tab === k ? ' primary' : ''), onClick: () => { view.tab = k; view.draw(); } }, l)), ctx.can('payment.manage') ? h('button', { class: 'btn accent', style: { marginLeft: 'auto' }, onClick: () => view.recordPayment(ctx, {}) }, '+ Record payment') : null);
    wrap.append(tabs);
    if (view.tab === 'payments') drawLedger(wrap, ctx); else if (view.tab === 'statement') drawStatement(wrap, ctx); else drawOutstanding(wrap, ctx);
  };

  function drawLedger(wrap, ctx) {
    const { store } = ctx; const rows = U.sortBy(store.state.payments, 'date', 'desc');
    wrap.append(h('div', { class: 'tiles' }, h('div', { class: 'tile good' }, h('span', { class: 'label', text: 'Payments recorded here' }), h('span', { class: 'value', text: U.moneyShort(E.sum(rows, 'amount')) }), h('span', { class: 'sub', text: `${rows.length} receipt${rows.length === 1 ? '' : 's'}` })), h('div', { class: 'tile' }, h('span', { class: 'label', text: 'Total received (all trips)' }), h('span', { class: 'value', text: U.moneyShort(E.sum(store.trips(), 'amountPaid')) }), h('span', { class: 'sub', text: 'Workbook rule: Paid → full billing, Advance → advance amount' }))));
    wrap.append(h('div', { class: 'table-frame' }, rows.length ? h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Date', 'Client', 'Invoice', 'Amount (₦)', 'Method / type', 'Reference', 'Trips', 'Recorded by', 'Notes'].map((x) => h('th', { text: x })))), h('tbody', {}, rows.map((p) => { const inv = store.state.invoices.find((i) => i.id === p.invoiceId); return h('tr', {}, h('td', { text: U.date(p.date) }), h('td', { text: p.client }), h('td', { text: inv ? inv.number : '—' }), h('td', { class: 'money', text: U.money(p.amount) }), h('td', { text: p.method }), h('td', { text: p.reference }), h('td', { class: 'num', text: (p.tripIds || []).length }), h('td', { text: p.recordedBy }), h('td', { text: p.notes || '' })); }))) : h('div', { class: 'empty' }, h('strong', { text: 'No payments recorded yet.' }), h('span', { text: 'Historic payments imported from the workbook are reflected in each trip\'s Payment Status.' }))));
  }

  function statementRows(ctx) { const { store } = ctx; let trips = store.trips().filter((t) => E.norm(t.client) === E.norm(view.client)); if (view.month) trips = trips.filter((t) => t.month === view.month); return U.sortBy(trips, 'dateDispatched'); }
  function drawStatement(wrap, ctx) {
    const { store } = ctx; const months = [...new Set(store.trips().map((t) => t.month))].filter(Boolean).sort().reverse();
    wrap.append(h('div', { class: 'toolbar' }, U.field('Client', U.select([['', 'Select a client…'], ...store.clientNames().map((c) => [c, c])], view.client, { onChange: (e) => { view.client = e.target.value; view.draw(); } })), U.field('Month', U.select([['', '(All Months)'], ...months.map((m) => [m, U.monthLabel(m)])], view.month, { onChange: (e) => { view.month = e.target.value; view.draw(); } }))));
    if (!view.client) { wrap.append(h('div', { class: 'empty' }, h('strong', { text: 'Choose a client to build its statement.' }))); return; }
    const rows = statementRows(ctx); const totals = { trips: rows.length, selling: E.sum(rows, 'sellingPrice'), vat: E.sum(rows, 'vat'), billing: E.sum(rows, 'billing'), paid: E.sum(rows, 'amountPaid'), balance: E.sum(rows, 'balance') };
    wrap.append(h('div', { class: 'tiles' }, h('div', { class: 'tile' }, h('span', { class: 'label', text: 'Trips' }), h('span', { class: 'value', text: U.int(totals.trips) })), h('div', { class: 'tile' }, h('span', { class: 'label', text: 'Billing after VAT' }), h('span', { class: 'value', text: U.moneyShort(totals.billing) })), h('div', { class: 'tile good' }, h('span', { class: 'label', text: 'Payment received' }), h('span', { class: 'value', text: U.moneyShort(totals.paid) })), h('div', { class: 'tile ' + (totals.balance > 0 ? 'bad' : '') }, h('span', { class: 'label', text: 'Balance pending' }), h('span', { class: 'value', text: U.money(totals.balance) }))));
    wrap.append(h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => HB.exporter.statementPdf(view.client, rows, totals, store.state.settings, `CLIENT STATEMENT · ${view.month ? U.monthLabel(view.month) : 'All months'}`).catch((e) => U.toast(e.message, 'bad')) }, 'Download PDF'), h('button', { class: 'btn', onClick: () => HB.exporter.xlsx([{ name: 'Statement', rows: [['Date', 'Plate', 'Loading From', 'Loading To', 'Journey Plan', 'Waybill', 'Invoice No.', 'Selling Price (₦)', 'VAT (₦)', 'Billing After VAT (₦)', 'Payment Status', 'Amount Paid (₦)', 'Balance (₦)', 'Trip Status'], ...rows.map((t) => [t.dateDispatched, t.plate, t.loadingFrom, t.loadingTo, t.journeyPlanId, t.waybill, t.invoiceNo || t.manualInvoiceNo, t.sellingPrice, t.vat, t.billing, t.paymentStatus, t.amountPaid, t.balance, t.tripStatus]), ['TOTAL', '', '', '', '', '', '', totals.selling, totals.vat, totals.billing, '', totals.paid, totals.balance, '']] }], `Statement_${view.client.replace(/[^A-Za-z0-9]+/g, '_')}.xlsx`) }, 'Export Excel')));
    wrap.append(h('div', { class: 'table-frame' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Date', 'Plate', 'Route', 'Journey Plan', 'Waybill', 'Invoice', 'Billing (₦)', 'Payment', 'Paid (₦)', 'Balance (₦)', 'Trip Status'].map((x) => h('th', { text: x })))), h('tbody', {}, rows.map((t) => h('tr', {}, h('td', { text: U.date(t.dateDispatched) }), h('td', { text: t.plate }), h('td', { text: `${t.loadingFrom} → ${t.loadingTo}` }), h('td', { text: t.journeyPlanId }), h('td', { text: t.waybill }), h('td', { text: t.invoiceNo || t.manualInvoiceNo }), h('td', { class: 'money', text: U.money(t.billing) }), h('td', { text: t.paymentStatus }), h('td', { class: 'money', text: U.money(t.amountPaid) }), h('td', { class: 'money', text: U.money(t.balance) }), h('td', {}, U.pill(t.tripStatus, U.statusKind(t.tripStatus)))))),
      h('tfoot', {}, h('tr', {}, h('td', { text: 'TOTAL' }), h('td', { text: `${totals.trips} trips` }), h('td'), h('td'), h('td'), h('td'), h('td', { class: 'money', text: U.money(totals.billing) }), h('td'), h('td', { class: 'money', text: U.money(totals.paid) }), h('td', { class: 'money', text: U.money(totals.balance) }), h('td'))))));
  }
  function drawOutstanding(wrap, ctx) {
    const { store } = ctx; const s = E.clientSummary(store.trips().filter((t) => t.invoiceStatus !== 'Internal Client'), store.state.clients); const rows = s.rows.filter((r) => r.balance > 0.5).sort((a, b) => b.balance - a.balance);
    wrap.append(h('div', { class: 'row between' }, h('p', { class: 'muted small', text: 'Clients with a balance pending (Billing After VAT minus Amount Paid), from the live Trip Log.' }), h('button', { class: 'btn', onClick: () => HB.exporter.xlsx([{ name: 'Outstanding', rows: [['Client', 'Unpaid trips', 'Billing (₦)', 'Paid (₦)', 'Balance (₦)'], ...rows.map((r) => [r.client, r.unpaidTrips, r.billing, r.paid, r.balance])] }], `Outstanding_${U.todayISO()}.xlsx`) }, 'Export Excel')));
    wrap.append(h('div', { class: 'table-frame' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Client', 'Unpaid trips', 'Total billing (₦)', 'Paid (₦)', 'Balance pending (₦)', ''].map((x) => h('th', { text: x })))), h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { text: r.client }), h('td', { class: 'num', text: r.unpaidTrips }), h('td', { class: 'money', text: U.money(r.billing) }), h('td', { class: 'money', text: U.money(r.paid) }), h('td', { class: 'money var-below', text: U.money(r.balance) }), h('td', {}, h('button', { class: 'btn sm', onClick: () => { view.client = r.client; view.month = ''; view.tab = 'statement'; view.draw(); } }, 'Statement'))))), h('tfoot', {}, h('tr', {}, h('td', { text: 'TOTAL' }), h('td', { class: 'num', text: E.sum(rows, 'unpaidTrips') }), h('td', { class: 'money', text: U.money(E.sum(rows, 'billing')) }), h('td', { class: 'money', text: U.money(E.sum(rows, 'paid')) }), h('td', { class: 'money', text: U.money(E.sum(rows, 'balance')) }), h('td'))))));
  }

  /** Record a payment and allocate it to trips oldest-first. */
  view.recordPayment = function (ctx, preset) {
    const { store } = ctx; if (!ctx.can('payment.manage')) return U.toast('Only Finance or an administrator can record payments.', 'bad');
    const st = { client: preset.client || '', invoiceId: preset.invoiceId || '', amount: '', date: U.todayISO(), method: 'Bank transfer', reference: '', notes: '', mode: 'auto', picked: new Set() };
    const body = h('div', { class: 'stack' }); const m = U.modal({ title: 'Record payment', size: 'wide', body });
    const draw = () => {
      U.clear(body);
      const invoices = HB.views.invoices.invRows(store).filter((i) => E.norm(i.client) === E.norm(st.client) && i.liveStatus !== 'Void' && i.balance > 0);
      let trips = store.trips().filter((t) => E.norm(t.client) === E.norm(st.client) && t.paymentStatus !== 'Paid' && t.invoiceStatus !== 'Internal Client' && t.billing !== null);
      if (st.invoiceId) trips = trips.filter((t) => t.invoiceId === st.invoiceId);
      trips = U.sortBy(trips, 'dateDispatched');
      const amount = E.num(st.amount) || 0;
      body.append(h('div', { class: 'form-grid' },
        U.field('Client', U.select([['', 'Select a client…'], ...store.clientNames().map((c) => [c, c])], st.client, { onChange: (e) => { st.client = e.target.value; st.invoiceId = ''; st.picked.clear(); draw(); } })),
        U.field('Apply to', U.select([['', 'All unpaid trips of the client'], ...invoices.map((i) => [i.id, `${i.number} · balance ${U.money(i.balance)}`])], st.invoiceId, { onChange: (e) => { st.invoiceId = e.target.value; st.picked.clear(); draw(); } })),
        U.field('Amount received (₦)', h('input', { type: 'number', step: '0.01', min: '0', value: st.amount, onInput: (e) => { st.amount = e.target.value; U.debounce(draw, 400)(); } })),
        U.field('Payment date', h('input', { type: 'date', value: st.date, onChange: (e) => { st.date = e.target.value; } })),
        U.field('Method', U.select(['Bank transfer', 'Cheque', 'Cash', 'Other'], st.method, { onChange: (e) => { st.method = e.target.value; } }), { help: 'Credit notes are issued from the invoice (Invoices → open → Issue credit note).' }),
        U.field('Reference', h('input', { type: 'text', value: st.reference, placeholder: 'Teller / transfer reference', onInput: (e) => { st.reference = e.target.value; } })),
        U.field('Notes', h('input', { type: 'text', value: st.notes, onInput: (e) => { st.notes = e.target.value; } }), { span2: true })));
      if (!st.client) { m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel')]); return; }
      // allocation preview: oldest first; a trip is Paid when covered, the last partially covered trip becomes Advance.
      let remaining = amount; const alloc = [];
      for (const t of trips) { const due = Math.max(0, E.round2(t.balance)); if (remaining <= 0 || due <= 0) { alloc.push({ t, pay: 0 }); continue; } const pay = Math.min(due, remaining); remaining = E.round2(remaining - pay); alloc.push({ t, pay }); }
      const totalDue = E.sum(trips, 'balance');
      U.append(body, [h('div', { class: 'row between' }, h('span', { class: 'muted small', text: `${trips.length} unpaid trip${trips.length === 1 ? '' : 's'} · balance due ${U.money(totalDue)}` }), remaining > 0 ? h('span', { class: 'notice warn small', text: `${U.money(remaining)} exceeds the balance due and will be noted as an over-payment.` }) : null)]);
      body.append(h('div', { class: 'table-frame short' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Date', 'Route', 'Plate', 'Invoice', 'Balance (₦)', 'Allocated (₦)', 'New status'].map((x) => h('th', { text: x })))), h('tbody', {}, alloc.map(({ t, pay }) => { const covered = pay >= E.round2(t.balance) - 0.005 && pay > 0; const ns = covered ? 'Paid' : pay > 0 ? 'Advance' : t.paymentStatus; return h('tr', {}, h('td', { text: U.date(t.dateDispatched) }), h('td', { text: `${t.loadingFrom} → ${t.loadingTo}` }), h('td', { text: t.plate }), h('td', { text: t.invoiceNo || t.manualInvoiceNo || '—' }), h('td', { class: 'money', text: U.money(t.balance) }), h('td', { class: 'money', text: pay ? U.money(pay) : '' }), h('td', {}, pay ? U.pill(ns, ns === 'Paid' ? 'good' : 'info') : h('span', { class: 'muted small', text: t.paymentStatus }))); })))));
      m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', disabled: amount <= 0 || !trips.length ? true : null, onClick: async () => {
        try {
          const touched = alloc.filter((a) => a.pay > 0);
          const payment = { id: U.id('pay'), client: st.client, invoiceId: st.invoiceId || '', amount, date: st.date, method: st.method, reference: E.clean(st.reference), notes: E.clean(st.notes) + (remaining > 0 ? ` Over-payment ${U.money(remaining)}.` : ''), tripIds: touched.map((a) => a.t.id), recordedBy: store.user.username };
          for (const { t, pay } of touched) { const covered = pay >= E.round2(t.balance) - 0.005; const patch = covered ? { id: t.id, paymentStatus: 'Paid' } : { id: t.id, paymentStatus: 'Advance', advance: E.round2((t.amountPaid || 0) + pay) }; await store.saveTrip(patch, { expectedVersion: t.version }); }
          await store.saveDoc('payments', payment, { label: `${payment.client} · ${U.money(amount)} · ${payment.reference}` });
          m.close(); view.draw(); U.toast(`Payment of ${U.money(amount)} recorded across ${touched.length} trip${touched.length === 1 ? '' : 's'}.`, 'good');
        } catch (e) { U.toast(e.message, 'bad'); }
      } }, 'Save payment')]);
    };
    draw();
  };
  HB.views.payments = view;
})();
