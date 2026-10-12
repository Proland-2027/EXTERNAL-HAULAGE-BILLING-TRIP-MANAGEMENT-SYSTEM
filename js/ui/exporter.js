/* Excel import/export (SheetJS) and PDF documents (jsPDF). Both libraries load from the CDN; CSV is the fallback. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine;

  const TRIP_COLUMNS = [
    ['Date Dispatched', 'dateDispatched'], ['Date Delivered', 'dateDelivered'], ['Plate Number', 'plate'], ['Asset Code', 'assetCode'], ['Type of Vehicle', 'vehicleType'], ['Type', 'vehicleCategory'], ['Cost Center', 'costCenter'],
    ['Contract Type', 'contractType'], ['CLIENT NAME', 'client'], ['Loading From', 'loadingFrom'], ['Loading To', 'loadingTo'], ['Journey Plan ID', 'journeyPlanId'], ['Client Waybill Number', 'waybill'], ['Return Waybill Received?', 'returnWaybill'],
    ['Invoice Status', 'invoiceStatus'], ['Agreed Client Price (₦)', 'agreedPrice'], ['Selling Price (₦)', 'sellingPrice'], ['Price Variance (₦)', 'variance'], ['Price Variance (%)', 'variancePct'], ['VAT (₦)', 'vat'], ['Billing After VAT (₦)', 'billing'],
    ['Quote Number', 'quoteNo'], ['SO Number', 'soNo'], ['Manual Invoice Number', 'manualInvoiceNo'], ['Invoice Number', 'invoiceNo'], ['Payment Status', 'paymentStatus'], ['Advance (₦)', 'advance'], ['Amount Paid (₦)', 'amountPaid'], ['Balance (₦)', 'balance'], ['Trip Status', 'tripStatus'], ['Notes', 'note'],
  ];
  const tripsToRows = (trips) => [TRIP_COLUMNS.map((c) => c[0]), ...trips.map((t) => TRIP_COLUMNS.map((c) => { const v = t[c[1]]; return v === null || v === undefined ? '' : v; }))];

  function csvBlob(rows) { const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }); }
  /** sheets = [{ name, rows: [[...]] }] */
  async function xlsx(sheets, filename) {
    if (typeof XLSX === 'undefined') { await U.download(csvBlob(sheets[0].rows), filename.replace(/\.xlsx$/, '.csv')); U.toast('Excel library unavailable; a CSV file was downloaded instead.'); return; }
    const wb = XLSX.utils.book_new();
    for (const s of sheets) { const ws = XLSX.utils.aoa_to_sheet(s.rows); ws['!cols'] = s.rows[0].map((_, i) => ({ wch: Math.min(40, Math.max(10, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) })); XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31)); }
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await U.download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  }
  /** Reads an .xlsx/.csv file into { sheets: [{ name, headers, rows }] }. Picks the "Trip Log" sheet first when present. */
  async function readWorkbook(file) {
    if (typeof XLSX === 'undefined') throw new Error('The Excel library has not loaded. Check your connection and try again.');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheets = wb.SheetNames.map((name) => { const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }); const hi = aoa.findIndex((r) => r && r.filter((c) => c !== null && c !== '').length >= 5); const headers = hi >= 0 ? aoa[hi].map((h) => (h === null ? '' : String(h))) : []; return { name, headers, rows: hi >= 0 ? aoa.slice(hi + 1).filter((r) => r && r.some((c) => c !== null && c !== '')) : [] }; });
    sheets.sort((a, b) => (E.norm(a.name) === 'trip log' ? -1 : E.norm(b.name) === 'trip log' ? 1 : 0));
    return { sheets };
  }

  // ------------------------------------------------------------------ PDF
  function pdfDoc() { const J = window.jspdf && window.jspdf.jsPDF; if (!J) throw new Error('The PDF library has not loaded. Check your connection and try again.'); return new J({ unit: 'pt', format: 'a4' }); }
  const money = (n) => (Number.isFinite(Number(n)) ? 'NGN ' + new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)) : '');
  function table(doc, x, y, cols, rows, opts) {
    opts = opts || {}; const lh = 14; const W = cols.reduce((s, c) => s + c.w, 0);
    const header = () => { doc.setFillColor(233, 237, 243); doc.rect(x, y, W, lh + 4, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); let cx = x; for (const c of cols) { doc.text(c.title, c.align === 'right' ? cx + c.w - 4 : cx + 4, y + 12, { align: c.align || 'left' }); cx += c.w; } y += lh + 4; doc.setFont('helvetica', 'normal'); };
    header();
    for (const r of rows) {
      if (y > 780) { doc.addPage(); y = 50; header(); }
      let cx = x; doc.setFontSize(8);
      for (const c of cols) { const txt = doc.splitTextToSize(String(r[c.key] ?? ''), c.w - 8)[0] || ''; doc.text(txt, c.align === 'right' ? cx + c.w - 4 : cx + 4, y + 10, { align: c.align || 'left' }); cx += c.w; }
      doc.setDrawColor(211, 218, 228); doc.line(x, y + lh, x + W, y + lh); y += lh;
    }
    return y;
  }
  async function invoicePdf(inv, trips, settings, clients) {
    const doc = pdfDoc(); const client = (clients || []).find((c) => E.norm(c.name) === E.norm(inv.client));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(settings.company || 'Haulage Services', 40, 50);
    doc.setFontSize(11); doc.text('HAULAGE SERVICES INVOICE', 555, 50, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const left = [['Bill to', inv.client], ['Address', (client && client.address) || ''], ['Period', `${U.monthLabel(inv.fromMonth)} – ${U.monthLabel(inv.toMonth)}`]];
    const right = [['Invoice No.', inv.number], ['Invoice date', U.date(inv.invoiceDate)], ['Due date', U.date(inv.dueDate)], ['Status', inv.status]];
    left.forEach((l, i) => { doc.setFont('helvetica', 'bold'); doc.text(l[0], 40, 80 + i * 13); doc.setFont('helvetica', 'normal'); doc.text(String(l[1] || ''), 100, 80 + i * 13); });
    right.forEach((l, i) => { doc.setFont('helvetica', 'bold'); doc.text(l[0], 380, 80 + i * 13); doc.setFont('helvetica', 'normal'); doc.text(String(l[1] || ''), 460, 80 + i * 13); });
    const rows = trips.map((t, i) => ({ sn: i + 1, date: U.date(t.dateDispatched), from: t.loadingFrom, to: t.loadingTo, plate: t.plate, trip: t.journeyPlanId, wb: t.waybill, ref: t.manualInvoiceNo, amount: money(inv.includesVat ? t.billing : t.sellingPrice), vat: inv.includesVat ? '' : money(t.vat), total: money(t.billing) }));
    const cols = inv.includesVat
      ? [{ key: 'sn', title: 'S/N', w: 26 }, { key: 'date', title: 'Date', w: 58 }, { key: 'from', title: 'Loading From', w: 70 }, { key: 'to', title: 'Loading To', w: 70 }, { key: 'plate', title: 'Vehicle', w: 62 }, { key: 'trip', title: 'Trip No.', w: 58 }, { key: 'wb', title: 'Waybill', w: 76 }, { key: 'total', title: 'Amount (Incl. VAT)', w: 95, align: 'right' }]
      : [{ key: 'sn', title: 'S/N', w: 26 }, { key: 'date', title: 'Date', w: 54 }, { key: 'from', title: 'From', w: 62 }, { key: 'to', title: 'To', w: 62 }, { key: 'plate', title: 'Vehicle', w: 58 }, { key: 'wb', title: 'Waybill', w: 66 }, { key: 'amount', title: 'Amount (Excl. VAT)', w: 72, align: 'right' }, { key: 'vat', title: 'VAT', w: 55, align: 'right' }, { key: 'total', title: 'Total', w: 60, align: 'right' }];
    let y = table(doc, 40, 140, cols, rows);
    const tot = E.invoiceTotals(trips, E.vatRateOf(settings));
    y += 12; doc.setFontSize(9);
    const line = (k, v, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.text(k, 400, y); doc.text(v, 555, y, { align: 'right' }); y += 14; };
    if (!inv.includesVat) { line('Subtotal', money(tot.subtotal)); line(`VAT (${(E.vatRateOf(settings) * 100).toFixed(1)}%)`, money(tot.vat)); }
    line('TOTAL DUE', money(tot.total), true);
    y += 10; doc.setFont('helvetica', 'bold'); doc.text('Remittance details', 40, y); doc.setFont('helvetica', 'normal'); y += 13;
    for (const l of [`Bank: ${settings.bankName || '—'}`, `Account name: ${settings.accountName || '—'}`, `Account number: ${settings.accountNumber || '—'}`, settings.invoiceNote || '']) { if (l) { doc.text(l, 40, y); y += 12; } }
    const blob = doc.output('blob');
    await U.download(blob, `${inv.number}.pdf`);
  }
  async function statementPdf(client, rows, totals, settings, title) {
    const doc = pdfDoc();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(settings.company || 'Haulage Services', 40, 50);
    doc.setFontSize(11); doc.text(title || 'CLIENT STATEMENT', 555, 50, { align: 'right' });
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.text(`Client: ${client}`, 40, 72); doc.text(`Generated: ${U.dateTime(U.nowISO())}`, 40, 85);
    const cols = [{ key: 'date', title: 'Date', w: 58 }, { key: 'route', title: 'Route', w: 130 }, { key: 'plate', title: 'Vehicle', w: 60 }, { key: 'inv', title: 'Invoice', w: 80 }, { key: 'billing', title: 'Billing (Incl. VAT)', w: 80, align: 'right' }, { key: 'paid', title: 'Paid', w: 55, align: 'right' }, { key: 'balance', title: 'Balance', w: 52, align: 'right' }];
    const data = rows.map((t) => ({ date: U.date(t.dateDispatched), route: `${t.loadingFrom} → ${t.loadingTo}`, plate: t.plate, inv: t.invoiceNo || t.manualInvoiceNo || '', billing: money(t.billing), paid: money(t.amountPaid), balance: money(t.balance) }));
    let y = table(doc, 40, 100, cols, data) + 14;
    doc.setFont('helvetica', 'bold'); doc.text(`Trips: ${totals.trips}`, 40, y); doc.text(`Billing: ${money(totals.billing)}`, 200, y); doc.text(`Paid: ${money(totals.paid)}`, 360, y); doc.text(`Balance: ${money(totals.balance)}`, 555, y, { align: 'right' });
    await U.download(doc.output('blob'), `Statement-${client.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`);
  }

  HB.exporter = { TRIP_COLUMNS, tripsToRows, xlsx, csvBlob, readWorkbook, invoicePdf, statementPdf };
})();
