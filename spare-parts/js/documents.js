/*
 * documents.js — PDF layouts: the one-part Spare Parts Request (RFQ) sheet and the Purchase Order.
 * Pure: takes plain data + JPEG bytes, returns PDF bytes. Mirrors the DARCO JMG one-part RFQ template:
 * blue header, request no / date, green "PART PHOTOGRAPHS" band with three photo boxes, blue "PART & TRUCK
 * INFORMATION" band, green "SUPPLIER QUOTATION (TO BE COMPLETED)" band with blank lines for the supplier.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root.Pdf || require('./pdf.js'));
  else root.Documents = factory(root.Pdf);
})(typeof self !== 'undefined' ? self : this, function (Pdf) {
  'use strict';
  const BLUE = [0.11, 0.30, 0.55], GREEN = [0.0, 0.47, 0.40], INK = [0.1, 0.1, 0.1], GREY = [0.42, 0.42, 0.4], LIGHT = [0.94, 0.95, 0.97], LINE = [0.65, 0.7, 0.78], WHITE = [1, 1, 1], DASH = [0.6, 0.6, 0.6];
  const M = 12, W = 210 - 2 * M; // margins / content width (mm)
  const fmtNum = (v, d = 2) => { const n = Number(v) || 0; return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d }); };
  const fmtMoney = (v) => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function band(doc, y, label, color) { doc.rect(M, y, W, 8, { fill: color }); doc.text(label, M + 4, y + 1.7, { size: 10, bold: true, color: WHITE }); return y + 8; }
  function header(doc, title, sub) {
    doc.rect(M, 8, W, 24, { fill: BLUE });
    doc.text(title, M + 6, 11.5, { size: 18, bold: true, color: WHITE });
    doc.text(sub, M + 6, 22, { size: 10, bold: true, color: WHITE });
  }
  /** Label / value row with a light background on alternate rows. Returns next y. */
  function row(doc, y, label, value, i, h = 9, labelW = 58) {
    if (i % 2 === 0) doc.rect(M, y, W, h, { fill: LIGHT });
    doc.text(label, M + 4, y + 2.4, { size: 9, bold: true, color: INK });
    const lines = doc.wrap(String(value == null ? '' : value), 9, false, W - labelW - 8);
    doc.text(lines.slice(0, 2).join('\n'), M + labelW, y + 2.4, { size: 9, color: INK, lineHeight: 1.15 });
    doc.line(M + labelW, y + h - 1.5, M + W - 4, y + h - 1.5, { stroke: LINE, lineWidth: 0.2 });
    return y + h;
  }
  function photoBox(doc, x, y, w, h, title, sub, jpeg) {
    doc.rect(x, y, w, h, { stroke: DASH, lineWidth: 0.3, dash: [1.2, 1] });
    const inner = { x: x + 2, y: y + 2, w: w - 4, h: h - 15 };
    if (jpeg) { try { doc.image(jpeg, inner.x, inner.y, inner.w, inner.h); } catch (e) { doc.text('(photo not readable)', x + w / 2, y + h / 2 - 6, { size: 7, color: GREY, align: 'center' }); } }
    else { doc.rect(inner.x, inner.y, inner.w, inner.h, { fill: [0.96, 0.96, 0.95] }); doc.text('NO PHOTO', x + w / 2, y + h / 2 - 8, { size: 8, bold: true, color: GREY, align: 'center' }); }
    doc.text(title, x + 3, y + h - 12, { size: 7.5, bold: true, color: INK });
    doc.text(sub, x + 3, y + h - 7.5, { size: 6.5, color: GREY });
  }

  /**
   * request: the stored request object. settings: company settings. photos: [jpegBytes|null ×3].
   * Returns Uint8Array of a single A4 page.
   */
  function requestPdf(request, settings = {}, photos = []) {
    const company = settings.company || 'DARCO JMG';
    const doc = Pdf.create({ title: `${request.id} ${request.description}`, author: company });
    doc.addPage();
    header(doc, company, 'SPARE PARTS REQUEST  |  ONE ITEM');
    doc.text(`Request No: ${request.id}`, M, 35.5, { size: 9, bold: true, color: INK });
    doc.text(`Date: ${request.date || ''}`, M + W / 2 + 6, 35.5, { size: 9, bold: true, color: INK });
    doc.text(`Urgency: ${request.urgency || ''}`, M + W, 35.5, { size: 9, bold: true, color: request.urgency === 'CRITICAL' ? [0.7, 0.1, 0.1] : INK, align: 'right' });
    let y = band(doc, 42, 'PART PHOTOGRAPHS', GREEN) + 3;
    const ph = 70;
    photoBox(doc, M, y, 92, ph, 'PHOTO 1 - MAIN PART', 'Clear full view', photos[0]);
    photoBox(doc, M + 95, y, 44, ph, 'PHOTO 2', 'Different angle', photos[1]);
    photoBox(doc, M + 142, y, 44, ph, 'PHOTO 3', 'Part number / markings', photos[2]);
    y += ph + 5;
    y = band(doc, y, 'PART & TRUCK INFORMATION', BLUE) + 2;
    const truck = [request.truckMake, request.truckModel].filter(Boolean).join(' ');
    const rows = [
      ['Part Name', request.description], ['Part Category', request.category], ['Part Number / OEM No.', request.partNo || '-'],
      ['Quantity Required', `${fmtNum(request.qty)} ${request.unit || ''}`], ['Truck Model', `${truck}${request.truckReg ? `  (Reg. ${request.truckReg})` : ''}`],
      ['Engine Model', request.engineModel || '-'], ['Chassis / VIN', request.chassis || '-'], ['Size / Specification', request.size || '-'], ['Remarks', request.remarks || '-'],
    ];
    rows.forEach((r, i) => { y = row(doc, y, r[0], r[1], i, 8.6); });
    y = band(doc, y + 2, 'SUPPLIER QUOTATION (TO BE COMPLETED)', GREEN) + 2;
    ['Manufacturer / Brand', 'Unit Price (USD or RMB)', 'Availability / Lead Time', 'Warranty'].forEach((l, i) => { y = row(doc, y, l, '', i, 7.6); });
    y += 2;
    doc.rect(M, y, W, 12.5, { fill: LIGHT });
    doc.text(settings.pdfNote || 'Please confirm compatibility, best price, availability and delivery time.', M + 4, y + 1.8, { size: 7.5, bold: true, color: BLUE, maxWidth: W - 8 });
    doc.text(`Destination: ${settings.destination || 'Lagos, Nigeria'}   |   Quote reference: ${request.id}   |   One part per request`, M + 4, y + 7.6, { size: 7, color: GREY });
    const contact = [settings.procurementContact, settings.procurementPhone, settings.procurementEmail].filter(Boolean).join('  ·  ');
    doc.line(M, 288, M + W, 288, { stroke: LINE, lineWidth: 0.3 });
    doc.text(`${company}${settings.companyAddress ? '  ·  ' + settings.companyAddress : ''}`, M, 289.5, { size: 6.8, color: GREY });
    doc.text(contact ? `Contact: ${contact}` : '', M, 293, { size: 6.8, color: GREY });
    doc.text(`Ref ${request.id}  ·  Requested by ${request.requestedBy || ''} (${request.department || ''})`, M + W, 289.5, { size: 6.8, color: GREY, align: 'right' });
    return doc.build();
  }

  /** Purchase order PDF (multi-page if needed). po: stored PO; supplier: supplier record; settings. */
  function purchaseOrderPdf(po, supplier = {}, settings = {}) {
    const company = settings.company || 'DARCO JMG';
    const doc = Pdf.create({ title: `Purchase Order ${po.number}`, author: company });
    const cols = [{ k: '#', w: 7 }, { k: 'Request', w: 26 }, { k: 'Part No', w: 30 }, { k: 'Description', w: 55 }, { k: 'Brand', w: 24 }, { k: 'Qty', w: 12, num: true }, { k: 'Unit price', w: 16, num: true }, { k: 'Amount', w: 16, num: true }];
    const tableHead = (y) => { doc.rect(M, y, W, 7, { fill: BLUE }); let x = M; cols.forEach((c) => { doc.text(c.k, c.num ? x + c.w - 1.5 : x + 1.5, y + 1.6, { size: 7.5, bold: true, color: WHITE, align: c.num ? 'right' : 'left' }); x += c.w; }); return y + 7; };
    const newPage = () => {
      doc.addPage(); header(doc, company, 'PURCHASE ORDER');
      doc.text(`PO No: ${po.number}`, M, 35.5, { size: 9, bold: true });
      doc.text(`Date: ${po.date || ''}`, M + 70, 35.5, { size: 9, bold: true });
      doc.text(`Status: ${po.status}`, M + W, 35.5, { size: 9, bold: true, align: 'right' });
    };
    newPage();
    let y = 42;
    doc.rect(M, y, W / 2 - 2, 30, { fill: LIGHT }); doc.rect(M + W / 2 + 2, y, W / 2 - 2, 30, { fill: LIGHT });
    doc.text('SUPPLIER', M + 3, y + 1.5, { size: 7.5, bold: true, color: GREY });
    doc.text([supplier.name || po.supplierName, supplier.contact, [supplier.city, supplier.province, 'China'].filter(Boolean).join(', '), supplier.whatsapp ? `WhatsApp ${supplier.whatsapp}` : '', supplier.email || ''].filter(Boolean).join('\n'), M + 3, y + 6, { size: 8.5, lineHeight: 1.25, maxWidth: W / 2 - 8 });
    doc.text('BUYER / DELIVER TO', M + W / 2 + 5, y + 1.5, { size: 7.5, bold: true, color: GREY });
    doc.text([company, settings.companyAddress || '', po.deliveryTo && po.deliveryTo !== settings.companyAddress ? `Deliver to: ${po.deliveryTo}` : '', settings.procurementContact || '', [settings.procurementPhone, settings.procurementEmail].filter(Boolean).join('  ·  ')].filter(Boolean).join('\n'), M + W / 2 + 5, y + 6, { size: 8.5, lineHeight: 1.25, maxWidth: W / 2 - 8 });
    y += 34;
    y = tableHead(y);
    (po.lines || []).forEach((l, i) => {
      const desc = doc.wrap(l.description || '', 8, false, 52), brand = doc.wrap(l.brand || '', 8, false, 21), pn = doc.wrap(l.partNo || '', 8, false, 27);
      const h = Math.max(7, 3.2 + Math.max(desc.length, brand.length, pn.length) * 3.6);
      if (y + h > 250) { newPage(); y = tableHead(42); }
      if (i % 2 === 0) doc.rect(M, y, W, h, { fill: LIGHT });
      let x = M; const vals = [String(i + 1), l.requestId || '', pn.join('\n'), desc.join('\n'), brand.join('\n'), `${fmtNum(l.qty)} ${l.unit || ''}`, fmtMoney(l.unitPrice), fmtMoney(l.amount)];
      cols.forEach((c, ci) => { doc.text(vals[ci], c.num ? x + c.w - 1.5 : x + 1.5, y + 1.6, { size: 8, align: c.num ? 'right' : 'left', lineHeight: 1.15, maxWidth: c.num ? null : c.w - 3 }); x += c.w; });
      y += h;
    });
    doc.line(M, y, M + W, y, { stroke: LINE });
    if (y > 225) { newPage(); y = 42; }
    y += 3; const top = y;
    const tx = M + W - 60, vx = M + W - 2;
    const tot = (label, v, bold = false) => { doc.text(label, tx, y, { size: 8.5, bold }); doc.text(`${po.currency} ${fmtMoney(v)}`, vx, y, { size: 8.5, bold, align: 'right' }); y += 5.5; };
    tot('Subtotal', po.subtotal);
    if (Number(po.shippingCost)) tot('Shipping / freight', po.shippingCost);
    if (Number(po.otherCost)) tot('Other charges', po.otherCost);
    if (Number(po.discount)) tot('Discount', -po.discount);
    doc.line(tx, y - 1, M + W, y - 1, { stroke: INK, lineWidth: 0.4 });
    tot('TOTAL', po.total, true);
    let ly = top;
    doc.text('Payment terms', M, ly, { size: 7.5, bold: true, color: GREY }); ly = doc.text(po.paymentTerms || '-', M, ly + 3.5, { size: 8.5, maxWidth: 100 });
    doc.text('Shipping', M, ly + 1.5, { size: 7.5, bold: true, color: GREY }); ly = doc.text([po.shipment && po.shipment.method ? po.shipment.method.replace('_', ' ') : '', po.shipment && po.shipment.forwarder ? `via ${po.shipment.forwarder}` : '', po.shipment && po.shipment.destinationPort ? `to ${po.shipment.destinationPort}` : `to ${settings.destination || 'Lagos, Nigeria'}`].filter(Boolean).join(' ') || `To ${settings.destination || 'Lagos, Nigeria'}`, M, ly + 5, { size: 8.5, maxWidth: 100 });
    y = Math.max(y, ly) + 4;
    if (po.notes) { doc.text('Notes', M, y, { size: 7.5, bold: true, color: GREY }); y = doc.text(po.notes, M, y + 3.5, { size: 8.5, maxWidth: W }); }
    y += 6;
    doc.text('Please confirm this order with a Proforma Invoice (PI) showing the bank details, lead time and shipping date. Mark every box with the PO number and the DARCO JMG request number.', M, y, { size: 7.5, color: GREY, maxWidth: W });
    y += 14;
    [['Prepared by (Procurement)', M], ['Approved by (Management)', M + 64], ['Supplier confirmation / stamp', M + 128]].forEach(([l, x]) => { doc.line(x, y + 12, x + 54, y + 12, { stroke: INK }); doc.text(l, x, y + 13, { size: 7, color: GREY }); });
    doc.line(M, 288, M + W, 288, { stroke: LINE, lineWidth: 0.3 });
    doc.text(`${company}  ·  ${settings.companyAddress || ''}`, M, 289.5, { size: 6.8, color: GREY });
    doc.text(`Purchase Order ${po.number}`, M + W, 289.5, { size: 6.8, color: GREY, align: 'right' });
    return doc.build();
  }

  return { requestPdf, purchaseOrderPdf };
});
