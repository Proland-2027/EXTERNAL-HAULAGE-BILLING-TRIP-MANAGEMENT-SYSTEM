/* Excel import/export (SheetJS) and PDF documents (jsPDF). Both libraries load from the CDN; CSV is the fallback. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine;

  const TRIP_COLUMNS = [
    ['Date Dispatched', 'dateDispatched'], ['Date Delivered', 'dateDelivered'], ['Plate Number', 'plate'], ['Asset Code', 'assetCode'], ['Type of Vehicle', 'vehicleType'], ['Type', 'vehicleCategory'], ['Truck Batch', 'truckBatch'], ['Cost Center', 'costCenter'],
    ['Contract Type', 'contractType'], ['CLIENT NAME', 'client'], ['Loading From', 'loadingFrom'], ['Loading State', 'loadingState'], ['Loading To', 'loadingTo'], ['Delivery State', 'deliveryState'], ['Journey Plan ID', 'journeyPlanId'], ['Request ID', 'requestId'], ['Allocation ID', 'allocationId'], ['Client Waybill Number', 'waybill'], ['Waybill Entered', 'waybillEnteredAt'], ['Waybill Received', 'waybillReceivedAt'], ['Waybill Verified', 'waybillVerifiedAt'], ['Waybill Status', 'waybillStatus'], ['Return Waybill Received?', 'returnWaybill'],
    ['Invoice Status', 'invoiceStatus'], ['Invoice Issued', 'invoiceIssuedAt'], ['Invoice Sent', 'invoiceSentAt'], ['Agreed Client Price (₦)', 'agreedPrice'], ['Selling Price (₦)', 'sellingPrice'], ['Price Variance (₦)', 'variance'], ['Price Variance (%)', 'variancePct'], ['VAT Treatment', 'vatTreatment'], ['Net Sales excl. VAT (₦)', 'netSales'], ['VAT (₦)', 'vat'], ['Billing After VAT (₦)', 'billing'],
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
    const co = Object.assign({ name: settings.company, address: settings.address, phone: settings.phone, email: settings.email, tin: settings.tin, rcNumber: settings.rcNumber }, inv.company || {});
    const priceType = inv.priceType || (inv.includesVat ? 'inclusive' : 'exclusive'); const rate = inv.vatRate || E.vatRateOf(settings);
    const lines = inv.lines && inv.lines.length ? inv.lines : trips.map((t) => { const sp = E.vatSplit(t.sellingPrice, rate, priceType); return { date: t.dateDispatched, loadingFrom: t.loadingFrom, loadingTo: t.loadingTo, plate: t.plate, journeyPlanId: t.journeyPlanId, waybill: t.waybill, manualInvoiceNo: t.manualInvoiceNo, sellingPrice: t.sellingPrice, net: sp.net, vat: sp.vat, gross: sp.gross }; });
    let x = 40, y = 44;
    if (settings.logo) { try { const fmt = /^data:image\/jpe?g/i.test(settings.logo) ? 'JPEG' : 'PNG'; const w = Math.min(120, settings.logoWidth || 120); const hgt = settings.logoHeight && settings.logoWidth ? w * (settings.logoHeight / settings.logoWidth) : 48; doc.addImage(settings.logo, fmt, x, y - 6, w, hgt); x += w + 14; } catch (e) { console.warn('logo not added', e); } }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(co.name || 'JMG Limited', x, y + 6);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); let cy = y + 19;
    for (const l of [co.address, [co.phone, co.email, settings.website].filter(Boolean).join('  ·  '), [co.tin ? 'TIN ' + co.tin : '', co.rcNumber ? 'RC ' + co.rcNumber : ''].filter(Boolean).join('  ·  ')]) { if (l) { doc.text(String(l), x, cy); cy += 11; } }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('INVOICE', 555, y + 6, { align: 'right' });
    doc.setFontSize(9); doc.text(String(inv.number), 555, y + 20, { align: 'right' }); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(`Invoice date: ${U.date(inv.invoiceDate)}`, 555, y + 32, { align: 'right' }); doc.text(`Due date: ${U.date(inv.dueDate)}`, 555, y + 43, { align: 'right' }); doc.text(E.VAT_TREATMENT_LABELS[priceType], 555, y + 54, { align: 'right' });
    doc.setDrawColor(23, 59, 99); doc.setLineWidth(1.2); doc.line(40, 112, 555, 112);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text('BILL TO', 40, 128); doc.setFont('helvetica', 'normal');
    doc.setFontSize(10); doc.text(String(inv.client), 40, 141); doc.setFontSize(8.5); let by = 153;
    if (client && client.address) { doc.text(String(client.address), 40, by); by += 11; } doc.text(`Period: ${U.monthLabel(inv.fromMonth)} – ${U.monthLabel(inv.toMonth)}`, 40, by);
    doc.setFont('helvetica', 'bold'); doc.text('REMIT TO', 380, 128); doc.setFont('helvetica', 'normal');
    [`Bank: ${settings.bankName || '—'}`, `Account name: ${settings.accountName || '—'}`, `Account number: ${settings.accountNumber || '—'}`].forEach((l, k) => doc.text(l, 380, 141 + k * 11));
    const rows = lines.map((l, i) => ({ sn: i + 1, date: U.date(l.date), from: l.loadingFrom, to: l.loadingTo, plate: l.plate, trip: l.journeyPlanId, wb: l.waybill, net: money(l.net), vat: money(l.vat), total: money(l.gross) }));
    const cols = [{ key: 'sn', title: 'S/N', w: 24 }, { key: 'date', title: 'Date', w: 54 }, { key: 'from', title: 'Loading From', w: 66 }, { key: 'to', title: 'Loading To', w: 66 }, { key: 'plate', title: 'Vehicle', w: 56 }, { key: 'trip', title: 'Trip No.', w: 50 }, { key: 'wb', title: 'Waybill', w: 62 }, { key: 'net', title: 'Net (Excl. VAT)', w: 58, align: 'right' }, { key: 'vat', title: 'VAT', w: 40, align: 'right' }, { key: 'total', title: 'Total', w: 39, align: 'right' }];
    let ty = table(doc, 40, 182, cols, rows);
    ty += 14; doc.setFontSize(9);
    const line = (k, v, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.text(k, 380, ty); doc.text(v, 555, ty, { align: 'right' }); ty += 14; };
    line('Subtotal before VAT', money(inv.subtotal)); line(`VAT (${(rate * 100).toFixed(1)}%)${priceType === 'inclusive' ? ' included' : ''}`, money(inv.vat)); line('INVOICE TOTAL', money(inv.total), true);
    ty += 8; doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(priceType === 'inclusive' ? 'Prices are quoted inclusive of VAT; the VAT component is extracted from each price.' : 'Prices are quoted exclusive of VAT; VAT is added at the rate shown.', 40, ty); ty += 11;
    if (settings.invoiceNote) { doc.text(String(settings.invoiceNote), 40, ty); ty += 11; }
    doc.setFontSize(7.5); doc.setTextColor(120); doc.text(`Generated ${U.dateTime(U.nowISO())} · ${co.name || ''}`, 40, 812); doc.setTextColor(0);
    await U.download(doc.output('blob'), `${inv.number}.pdf`);
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
