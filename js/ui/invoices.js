/* Invoice management: generate from eligible trips (workbook Invoice Generator rules), number, send, void, PDF. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine, h = U.h;
  HB.views = HB.views || {};
  const view = { title: 'Invoices', filters: {} };

  view.render = function (root, ctx) { view.ctx = ctx; view.root = root; root.append(h('div', { class: 'stack', id: 'inv-view' })); view.draw(); if (ctx.params && ctx.params.open) openInvoice(ctx, ctx.params.open); };
  view.onStoreChange = () => { if (view.root && view.root.isConnected) view.draw(); };

  function invRows(store) { const trips = store.trips(); return store.state.invoices.map((inv) => { const mine = trips.filter((t) => t.invoiceId === inv.id); const priceType = inv.priceType || (inv.includesVat ? 'inclusive' : 'exclusive'); const tot = inv.lines && inv.lines.length ? { subtotal: inv.subtotal, vat: inv.vat, total: inv.total } : E.invoiceTotals(mine, E.vatRateOf(store.state.settings), priceType); return Object.assign({}, inv, { priceType, trips: mine, subtotal: tot.subtotal, vat: tot.vat, total: tot.total, paid: E.sum(mine, 'amountPaid'), balance: E.round2(tot.total - E.sum(mine, 'amountPaid')), liveStatus: E.invoiceDocStatus(inv, trips) }); }); }

  view.draw = function () {
    const ctx = view.ctx, store = ctx.store, wrap = view.root.querySelector('#inv-view'); if (!wrap) return; U.clear(wrap);
    const f = view.filters; let rows = invRows(store);
    if (f.client) rows = rows.filter((r) => E.norm(r.client) === E.norm(f.client)); if (f.status) rows = rows.filter((r) => r.liveStatus === f.status);
    if (f.search) rows = rows.filter((r) => E.norm(r.number + ' ' + r.client).includes(E.norm(f.search)));
    rows = U.sortBy(rows, 'invoiceDate', 'desc');
    const manage = ctx.can('invoice.manage');
    const unbilled = store.trips().filter((t) => !t.invoiceId && t.paymentStatus !== 'Paid' && t.invoiceStatus !== 'Internal Client' && t.sellingPrice !== null);
    wrap.append(h('div', { class: 'tiles' },
      h('div', { class: 'tile' }, h('span', { class: 'label', text: 'Invoices' }), h('span', { class: 'value', text: U.int(store.state.invoices.length) })),
      h('div', { class: 'tile warn' }, h('span', { class: 'label', text: 'Outstanding on invoices' }), h('span', { class: 'value', text: U.moneyShort(E.sum(rows.filter((r) => r.liveStatus !== 'Void'), 'balance')) })),
      h('div', { class: 'tile bad' }, h('span', { class: 'label', text: 'Unpaid trips not yet invoiced' }), h('span', { class: 'value', text: U.int(unbilled.length) }), h('span', { class: 'sub', text: U.money(E.sum(unbilled, 'billing')) }))));
    wrap.append(h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: 'Search invoice number or client…', value: f.search || '', onInput: U.debounce((e) => { f.search = e.target.value; view.draw(); }, 200) }),
      U.select([['', 'All clients'], ...store.clientNames().map((c) => [c, c])], f.client || '', { onChange: (e) => { f.client = e.target.value; view.draw(); } }),
      U.select([['', 'All statuses'], ...E.INVOICE_DOC_STATUSES.map((s) => [s, s])], f.status || '', { onChange: (e) => { f.status = e.target.value; view.draw(); } }),
      manage ? h('button', { class: 'btn accent', onClick: () => newInvoice(ctx) }, '+ Generate invoice') : null,
      h('button', { class: 'btn', onClick: () => HB.exporter.xlsx([{ name: 'Invoices', rows: [['Invoice No.', 'Client', 'Invoice Date', 'Due Date', 'Period From', 'Period To', 'Price Type', 'Trips', 'Subtotal excl. VAT (₦)', 'VAT (₦)', 'Total (₦)', 'Paid (₦)', 'Balance (₦)', 'Status', 'Manual number?'], ...rows.map((r) => [r.number, r.client, r.invoiceDate, r.dueDate, r.fromMonth, r.toMonth, E.VAT_TREATMENT_LABELS[r.priceType], r.trips.length, r.subtotal, r.vat, r.total, r.paid, r.balance, r.liveStatus, r.manualNumber ? 'Yes' : 'No'])] }], `Invoices_${U.todayISO()}.xlsx`) }, 'Export Excel')));
    const kind = (s) => ({ Paid: 'good', Sent: 'warn', Draft: 'info', Void: 'neutral' }[s]);
    wrap.append(h('div', { class: 'table-frame' }, rows.length ? h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Invoice No.', 'Client', 'Invoice Date', 'Due', 'Period', 'Price Type', 'Trips', 'Total (₦)', 'Paid (₦)', 'Balance (₦)', 'Status', ''].map((x) => h('th', { text: x })))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, h('a', { href: '#invoices', onClick: (e) => { e.preventDefault(); openInvoice(ctx, r.id); } }, r.number), r.manualNumber ? h('span', { class: 'chip', style: { marginLeft: '6px' }, text: 'manual' }) : null), h('td', { text: r.client }), h('td', { text: U.date(r.invoiceDate) }), h('td', { text: U.date(r.dueDate) }), h('td', { text: `${U.monthLabel(r.fromMonth)}–${U.monthLabel(r.toMonth)}` }), h('td', { text: r.priceType === 'inclusive' ? 'Incl. VAT' : 'Excl. VAT' }), h('td', { class: 'num', text: r.trips.length }), h('td', { class: 'money', text: U.money(r.total) }), h('td', { class: 'money', text: U.money(r.paid) }), h('td', { class: 'money', text: U.money(r.balance) }), h('td', {}, U.pill(r.liveStatus, kind(r.liveStatus))),
        h('td', {}, h('span', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => openInvoice(ctx, r.id) }, 'Open'), h('button', { class: 'btn sm', onClick: () => pdf(ctx, r) }, 'PDF'))))))) : h('div', { class: 'empty' }, h('strong', { text: 'No invoices yet.' }), h('span', { text: manage ? 'Generate an invoice from the unpaid trips of a client.' : 'The billing team generates invoices here.' }))));
  };

  async function pdf(ctx, r) { try { await HB.exporter.invoicePdf(r, r.trips, ctx.store.state.settings, ctx.store.state.clients); } catch (e) { U.toast(e.message, 'bad'); } }

  function newInvoice(ctx) {
    const { store } = ctx; const settings = store.state.settings;
    const months = [...new Set(store.trips().map((t) => t.month))].filter(Boolean).sort().reverse();
    const cur = months[0] || U.todayISO().slice(0, 7);
    const st = { client: view.filters.client || '', fromMonth: cur, toMonth: cur, priceType: 'exclusive', invoiceDate: U.todayISO(), number: '', manual: false, picked: new Set() };
    const body = h('div', { class: 'stack' }); const m = U.modal({ title: 'Generate invoice', size: 'wide', body });
    const draw = () => {
      U.clear(body);
      const eligible = st.client ? U.sortBy(E.eligibleTrips(store.trips(), st.client, st.fromMonth, st.toMonth), 'dateDispatched') : [];
      if (!st.initialised && eligible.length) { st.picked = new Set(eligible.filter((t) => t.sellingPrice !== null).map((t) => t.id)); st.initialised = true; }
      const chosen = eligible.filter((t) => st.picked.has(t.id)); const tot = E.invoiceTotals(chosen, E.vatRateOf(settings), st.priceType);
      const conflicting = chosen.filter((t) => (t.vatTreatment || 'exclusive') !== st.priceType && t.invoiceStatus === 'Invoice Sent');
      const firstDate = chosen.length ? chosen[0].dateDispatched : `${st.fromMonth}-01`;
      const auto = st.client ? E.generateInvoiceNumber(st.client, firstDate, store.state.invoices.flatMap((i) => [i.number, i.manualNumber]).filter(Boolean), store.state.clients) : '';
      if (!st.manual) st.number = auto;
      const numInput = h('input', { type: 'text', value: st.number, onInput: (e) => { st.number = E.clean(e.target.value); st.manual = st.number !== auto; } });
      body.append(h('div', { class: 'form-grid' },
        U.field('Client', U.select([['', 'Select a client…'], ...store.clientNames().map((c) => [c, c])], st.client, { onChange: (e) => { st.client = e.target.value; st.initialised = false; st.manual = false; draw(); } })),
        U.field('Month From', U.select(months.map((x) => [x, U.monthLabel(x)]), st.fromMonth, { onChange: (e) => { st.fromMonth = e.target.value; st.initialised = false; draw(); } })),
        U.field('Month To', U.select(months.map((x) => [x, U.monthLabel(x)]), st.toMonth, { onChange: (e) => { st.toMonth = e.target.value; st.initialised = false; draw(); } })),
        U.field('Invoice Price Type', U.select([['exclusive', 'Price Excluding VAT — VAT added on top'], ['inclusive', 'Price Including VAT — VAT extracted from the selling price']], st.priceType, { onChange: (e) => { st.priceType = e.target.value; draw(); } }), { help: `VAT ${(E.vatRateOf(settings) * 100).toFixed(1)}% from Settings. Saved with the invoice and applied to its trips.` }),
        U.field('Invoice date', h('input', { type: 'date', value: st.invoiceDate, onChange: (e) => { st.invoiceDate = e.target.value; draw(); } })),
        U.field('Due date', h('input', { type: 'date', value: E.addDays(st.invoiceDate, settings.paymentTermsDays || 7), disabled: true }), { locked: true, help: `Invoice date + ${settings.paymentTermsDays || 7} days (Settings)` }),
        U.field('Invoice number', numInput, { help: `Automatic: client code + first trip date + sequence (${auto || '—'}). Type over it to use a manual number.` })));
      if (!st.client) { body.append(h('div', { class: 'notice info', text: 'Pick a client to list its unpaid trips in the period.' })); m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel')]); return; }
      const dup = E.findDuplicateInvoiceNumber(st.number, store.state.invoices);
      if (dup) body.append(h('div', { class: 'notice bad', text: `Invoice number ${st.number} already exists for ${dup.client} (${U.date(dup.invoiceDate)}). Choose another number.` }));
      if (conflicting.length) body.append(h('div', { class: 'notice warn', text: `${conflicting.length} selected trip(s) were already sent to the client on a ${E.VAT_TREATMENT_LABELS[conflicting[0].vatTreatment || 'exclusive']} basis. Untick them or generate a separate invoice so one invoice never mixes VAT treatments.` }));
      body.append(h('p', { class: 'small muted', text: `Workbook rule: trips of ${st.client} dispatched between ${U.monthLabel(st.fromMonth)} and ${U.monthLabel(st.toMonth)}, not Paid, not already invoiced. Trips on the same date are grouped on the same invoice by default.` }));
      const byDate = new Map(); for (const t of eligible) { if (!byDate.has(t.dateDispatched)) byDate.set(t.dateDispatched, []); byDate.get(t.dateDispatched).push(t); }
      const list = h('div', { class: 'check-list' });
      for (const [d, ts] of byDate) {
        const all = ts.every((t) => st.picked.has(t.id));
        list.append(h('label', { style: { background: 'var(--surface-2)', fontWeight: 600 } }, h('input', { type: 'checkbox', checked: all ? true : null, onChange: (e) => { for (const t of ts) { if (e.target.checked && t.sellingPrice !== null) st.picked.add(t.id); else st.picked.delete(t.id); } draw(); } }), h('span', { text: `${U.date(d)} · ${ts.length} trip${ts.length > 1 ? 's' : ''}` }), h('span', { class: 'money', text: U.money(E.sum(ts, 'billing')) })));
        for (const t of ts) list.append(h('label', {}, h('input', { type: 'checkbox', checked: st.picked.has(t.id) ? true : null, disabled: t.sellingPrice === null ? true : null, onChange: (e) => { if (e.target.checked) st.picked.add(t.id); else st.picked.delete(t.id); draw(); } }), h('span', {}, `${t.plate} · ${t.loadingFrom} → ${t.loadingTo} · ${t.journeyPlanId || ''} · WB ${t.waybill || '—'}${t.manualInvoiceNo ? ' · ref ' + t.manualInvoiceNo : ''}${t.sellingPrice === null ? ' · no selling price yet' : ''}`, t.tripStatus === 'Part Paid - Balance Due' ? U.pill('Part paid', 'info') : null), h('span', { class: 'money', text: U.money(t.billing) })));
      }
      body.append(eligible.length ? list : h('div', { class: 'notice warn', text: 'No eligible trips: every trip of this client in the period is paid, already invoiced or an internal client trip.' }));
      body.append(h('div', { class: 'row between' }, h('span', { class: 'muted', text: `${chosen.length} trip${chosen.length === 1 ? '' : 's'} selected · ${E.VAT_TREATMENT_LABELS[st.priceType]}` }), h('span', { class: 'num' }, `Subtotal before VAT ${U.money(tot.subtotal)} · VAT ${U.money(tot.vat)} · `, h('strong', {}, `Invoice total ${U.money(tot.total)}`))));
      m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', disabled: !chosen.length || !!dup || !st.number || conflicting.length ? true : null, onClick: async () => {
        try {
          const rate = E.vatRateOf(settings);
          const lines = U.sortBy(chosen, 'dateDispatched').map((t) => { const sp = E.vatSplit(t.sellingPrice, rate, st.priceType); return { tripId: t.id, date: t.dateDispatched, loadingFrom: t.loadingFrom, loadingTo: t.loadingTo, plate: t.plate, journeyPlanId: t.journeyPlanId, waybill: t.waybill, manualInvoiceNo: t.manualInvoiceNo, sellingPrice: t.sellingPrice, net: sp.net, vat: sp.vat, gross: sp.gross }; });
          const inv = { id: U.id('inv'), number: st.number, manualNumber: st.manual, client: st.client, invoiceDate: st.invoiceDate, dueDate: E.addDays(st.invoiceDate, settings.paymentTermsDays || 7), fromMonth: st.fromMonth, toMonth: st.toMonth, priceType: st.priceType, includesVat: st.priceType === 'inclusive', vatRate: rate, tripIds: chosen.map((t) => t.id), lines, subtotal: tot.subtotal, vat: tot.vat, total: tot.total, status: 'Draft', company: { name: settings.company, address: settings.address, phone: settings.phone, email: settings.email, tin: settings.tin, rcNumber: settings.rcNumber } };
          await store.saveDoc('invoices', inv, { label: `${inv.number} · ${inv.client} · ${U.money(inv.total)} · ${E.VAT_TREATMENT_LABELS[st.priceType]}` });
          for (const t of chosen) await store.saveTrip({ id: t.id, invoiceId: inv.id, invoiceNo: inv.number, vatTreatment: st.priceType }, { expectedVersion: t.version });
          m.close(); view.draw(); U.toast(`Invoice ${inv.number} created as Draft.`, 'good'); openInvoice(ctx, inv.id);
        } catch (e) { U.toast(e.message, 'bad'); }
      } }, 'Create invoice')]);
    };
    draw();
  }

  function openInvoice(ctx, id) {
    const { store } = ctx; const r = invRows(store).find((x) => x.id === id); if (!r) return U.toast('Invoice not found.', 'bad');
    const s = store.state.settings; const manage = ctx.can('invoice.manage');
    const co = Object.assign({ name: s.company, address: s.address, phone: s.phone, email: s.email, tin: s.tin, rcNumber: s.rcNumber }, r.company || {});
    const lines = r.lines && r.lines.length ? r.lines : U.sortBy(r.trips, 'dateDispatched').map((t) => { const sp = E.vatSplit(t.sellingPrice, r.vatRate || E.vatRateOf(s), r.priceType); return { date: t.dateDispatched, loadingFrom: t.loadingFrom, loadingTo: t.loadingTo, plate: t.plate, journeyPlanId: t.journeyPlanId, waybill: t.waybill, manualInvoiceNo: t.manualInvoiceNo, sellingPrice: t.sellingPrice, net: sp.net, vat: sp.vat, gross: sp.gross, tripId: t.id }; });
    const payOf = (l) => { const t = r.trips.find((x) => x.id === l.tripId); return t ? t.paymentStatus : ''; };
    const doc = h('div', { class: 'doc' },
      h('div', { class: 'doc-head' }, h('div', { class: 'row', style: { gap: '14px', alignItems: 'flex-start' } }, s.logo ? h('img', { src: s.logo, alt: co.name + ' logo', class: 'doc-logo' }) : h('div', { class: 'brand-mark', style: { width: '56px', height: '56px', lineHeight: '56px', fontSize: '18px' } }, s.companyShort || 'JMG'), h('div', {}, h('h2', { text: co.name || 'JMG Limited' }), co.address ? h('div', { class: 'small muted', text: co.address }) : null, h('div', { class: 'small muted', text: [co.phone, co.email, s.website].filter(Boolean).join(' · ') }), h('div', { class: 'small muted', text: [co.tin ? 'TIN ' + co.tin : '', co.rcNumber ? 'RC ' + co.rcNumber : ''].filter(Boolean).join(' · ') }))),
        h('div', { class: 'stack', style: { gap: '2px', textAlign: 'right' } }, h('div', { class: 'label', text: 'Haulage Services Invoice' }), h('div', {}, h('strong', { text: r.number, style: { fontSize: '16px' } })), h('div', { class: 'small', text: `Invoice date ${U.date(r.invoiceDate)} · Due ${U.date(r.dueDate)}` }), h('div', { class: 'small', text: E.VAT_TREATMENT_LABELS[r.priceType] }), U.pill(r.liveStatus, { Paid: 'good', Sent: 'warn', Draft: 'info', Void: 'neutral' }[r.liveStatus]))),
      h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'label', text: 'Bill to' }), h('div', {}, h('strong', { text: r.client })), h('div', { class: 'small muted', text: `Period ${U.monthLabel(r.fromMonth)} – ${U.monthLabel(r.toMonth)}` })), h('div', { class: 'small muted', style: { textAlign: 'right' } }, h('div', { text: s.bankName ? `Bank: ${s.bankName}` : 'Bank details: set in Settings' }), s.accountName ? h('div', { text: `Account: ${s.accountName} ${s.accountNumber || ''}` }) : null)),
      h('div', { style: { overflowX: 'auto' } }, h('table', {}, h('thead', {}, h('tr', {}, ['S/N', 'Date', 'Loading From', 'Loading To', 'Vehicle', 'Trip No.', 'Waybill', 'Manual Ref.', r.priceType === 'inclusive' ? 'Price (Incl. VAT)' : 'Price (Excl. VAT)', 'Net (Excl. VAT)', 'VAT', 'Total', 'Payment'].map((x) => h('th', { text: x })))),
        h('tbody', {}, lines.map((l, i) => h('tr', {}, h('td', { text: i + 1 }), h('td', { text: U.date(l.date) }), h('td', { text: l.loadingFrom }), h('td', { text: l.loadingTo }), h('td', { text: l.plate }), h('td', { text: l.journeyPlanId }), h('td', { text: l.waybill }), h('td', { text: l.manualInvoiceNo }), h('td', { class: 'money', text: U.money(l.sellingPrice) }), h('td', { class: 'money', text: U.money(l.net) }), h('td', { class: 'money', text: U.money(l.vat) }), h('td', { class: 'money', text: U.money(l.gross) }), h('td', {}, payOf(l) ? U.pill(payOf(l), payOf(l) === 'Paid' ? 'good' : payOf(l) === 'Advance' ? 'info' : 'bad') : '')))))),
      h('div', { class: 'totals' }, h('div', {}, h('span', { text: 'Subtotal before VAT' }), h('span', { class: 'num', text: U.money(r.subtotal) })), h('div', {}, h('span', { text: `VAT (${((r.vatRate || E.vatRateOf(s)) * 100).toFixed(1)}%)${r.priceType === 'inclusive' ? ' — included' : ''}` }), h('span', { class: 'num', text: U.money(r.vat) })), h('div', { class: 'grand' }, h('span', { text: 'INVOICE TOTAL' }), h('span', { class: 'num', text: U.money(r.total) })), h('div', {}, h('span', { text: 'Paid' }), h('span', { class: 'num', text: U.money(r.paid) })), h('div', {}, h('span', { text: 'Balance' }), h('span', { class: 'num', text: U.money(r.balance) }))),
      s.invoiceNote ? h('p', { class: 'small muted', text: s.invoiceNote }) : null, r.notes ? h('p', { class: 'small muted', text: r.notes }) : null);
    const m = U.modal({ title: `Invoice ${r.number}`, size: 'wide', body: doc });
    const acts = [h('button', { class: 'btn left', onClick: () => pdf(ctx, r) }, 'Download PDF'), h('span', { class: 'small muted left', text: 'PDF regenerates from the figures saved with the invoice; historical values never change.' })];
    if (manage && r.liveStatus === 'Draft') acts.push(h('button', { class: 'btn primary', onClick: async () => { try { await store.saveDoc('invoices', { id: r.id, status: 'Sent', sentAt: U.nowISO() }, { expectedVersion: r.version, label: `${r.number} marked Sent` }); for (const t of r.trips) if (t.invoiceStatus !== 'Invoice Sent') await store.saveTrip({ id: t.id, invoiceStatus: 'Invoice Sent' }, { expectedVersion: t.version }); m.close(); view.draw(); U.toast('Invoice marked as sent; trips now show Awaiting Payment.', 'good'); } catch (e) { U.toast(e.message, 'bad'); } } }, 'Mark as Sent'));
    if (manage && r.liveStatus === 'Draft') acts.push(h('button', { class: 'btn', onClick: async () => { const n = await U.prompt({ title: 'Override invoice number', label: 'New invoice number', value: r.number }); if (n === null) return; const num = E.clean(n); if (!num) return; const dup = E.findDuplicateInvoiceNumber(num, store.state.invoices, r.id); if (dup) return U.toast(`Number ${num} already belongs to invoice for ${dup.client}.`, 'bad'); try { await store.saveDoc('invoices', { id: r.id, number: num, manualNumber: true }, { expectedVersion: r.version, label: `${r.number} renumbered ${num}` }); for (const t of r.trips) await store.saveTrip({ id: t.id, invoiceNo: num }, { expectedVersion: t.version }); m.close(); view.draw(); openInvoice(ctx, r.id); } catch (e) { U.toast(e.message, 'bad'); } } }, 'Change number'));
    if (ctx.can('payment.manage') && r.liveStatus !== 'Void' && r.balance > 0) acts.push(h('button', { class: 'btn accent', onClick: () => { m.close(); HB.views.payments.recordPayment(ctx, { client: r.client, invoiceId: r.id }); } }, 'Record payment'));
    if (manage && r.liveStatus !== 'Void' && r.liveStatus !== 'Paid') acts.push(h('button', { class: 'btn danger', onClick: async () => { if (!(await U.confirm({ title: 'Void invoice', message: `Void ${r.number}? Its trips become available for a new invoice. Paid trips are left untouched.`, okLabel: 'Void', danger: true }))) return; try { await store.saveDoc('invoices', { id: r.id, status: 'Void', voidedAt: U.nowISO() }, { expectedVersion: r.version, label: `${r.number} voided` }); for (const t of r.trips) if (t.paymentStatus !== 'Paid') await store.saveTrip({ id: t.id, invoiceId: '', invoiceNo: '', invoiceStatus: 'Invoice Not Sent' }, { expectedVersion: t.version }); m.close(); view.draw(); U.toast('Invoice voided.'); } catch (e) { U.toast(e.message, 'bad'); } } }, 'Void'));
    acts.push(h('button', { class: 'btn', onClick: () => m.close() }, 'Close'));
    m.setActions(acts);
  }
  view.openInvoice = openInvoice; view.invRows = invRows;
  HB.views.invoices = view;
})();
