/*
 * pdf.js — a tiny dependency-free PDF writer (text, lines, rectangles, JPEG images).
 * Enough for single-page A4 request / purchase-order documents. Coordinates are millimetres from the
 * top-left corner of the page. Works in the browser (window.Pdf) and in Node (require) for tests.
 *
 *   const doc = Pdf.create();           // A4 portrait
 *   doc.text('Hello', 20, 20, { size: 12, bold: true, color: [0, 0, 0], align: 'left' });
 *   doc.rect(10, 10, 50, 20, { fill: [0.9, 0.9, 0.9], stroke: [0, 0, 0] });
 *   doc.image(jpegBytes, 10, 40, 60, 40);   // fitted (contain) and centred inside the box
 *   const bytes = doc.build();           // Uint8Array
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PT = 72 / 25.4; // points per millimetre
  const SIZES = { A4: [210, 297], LETTER: [215.9, 279.4] };
  // Helvetica / Helvetica-Bold advance widths for ASCII 32..126 (units of 1/1000 em)
  const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

  const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
  const rgb = (c) => (c || [0, 0, 0]).map((v) => fmt(v)).join(' ');
  /** Characters outside WinAnsi are replaced; the result is a plain byte-per-char string. */
  function sanitize(str) {
    return String(str == null ? '' : str).replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2013|\u2014/g, '-').replace(/\u2026/g, '...').replace(/\u2192/g, '->').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  }
  function escapeText(s) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\x80-\xFF]/g, (c) => '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')); }
  function textWidth(str, size, bold) {
    const w = bold ? W_BOLD : W_REG; let t = 0;
    for (const ch of sanitize(str)) { const c = ch.charCodeAt(0); t += c >= 32 && c <= 126 ? w[c - 32] : 556; }
    return (t / 1000) * size / PT; // mm
  }
  function wrap(str, size, bold, maxWidthMm) {
    const lines = [];
    String(str == null ? '' : str).split(/\r?\n/).forEach((para) => {
      const words = para.split(/\s+/).filter(Boolean); let line = '';
      if (!words.length) { lines.push(''); return; }
      words.forEach((w) => {
        const cand = line ? `${line} ${w}` : w;
        if (textWidth(cand, size, bold) <= maxWidthMm || !line) line = cand; else { lines.push(line); line = w; }
      });
      lines.push(line);
    });
    return lines;
  }
  /** Reads width / height / components from the SOF marker of a baseline or progressive JPEG. */
  function jpegSize(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b[0] !== 0xFF || b[1] !== 0xD8) throw new Error('Not a JPEG');
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01 || marker === 0xFF) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], components: b[i + 9] };
      }
      i += 2 + len;
    }
    throw new Error('JPEG size not found');
  }
  const latin1 = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF; return u; };
  function concat(chunks) { const n = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(n); let o = 0; chunks.forEach((c) => { out.set(c, o); o += c.length; }); return out; }

  function create({ size = 'A4', landscape = false, title = '', author = '' } = {}) {
    const dims = SIZES[size] || SIZES.A4; const pw = landscape ? dims[1] : dims[0], ph = landscape ? dims[0] : dims[1];
    const pages = [], images = []; let cur = null;
    const X = (mm) => fmt(mm * PT), Y = (mm) => fmt((ph - mm) * PT);
    const api = {
      width: pw, height: ph, textWidth, wrap, sanitize,
      addPage() { cur = { ops: [], imgs: new Set() }; pages.push(cur); return api; },
      text(str, x, y, { size: fs = 10, bold = false, color = [0, 0, 0], align = 'left', maxWidth = null, lineHeight = 1.3 } = {}) {
        if (!cur) api.addPage();
        const lines = maxWidth ? wrap(str, fs, bold, maxWidth) : String(str == null ? '' : str).split(/\r?\n/);
        lines.forEach((ln, i) => {
          const w = textWidth(ln, fs, bold); const tx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
          const ty = y + fs / PT * 0.8 + i * fs / PT * lineHeight; // baseline sits below the top-left anchor
          cur.ops.push(`BT /${bold ? 'F2' : 'F1'} ${fmt(fs)} Tf ${rgb(color)} rg ${X(tx)} ${Y(ty)} Td (${escapeText(sanitize(ln))}) Tj ET`);
        });
        return y + lines.length * fs / PT * lineHeight; // y below the block
      },
      rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.2, dash = null } = {}) {
        if (!cur) api.addPage();
        const op = fill && stroke ? 'B' : fill ? 'f' : stroke ? 'S' : 'n';
        cur.ops.push(`q ${fill ? rgb(fill) + ' rg ' : ''}${stroke ? rgb(stroke) + ' RG ' : ''}${fmt(lineWidth * PT)} w ${dash ? `[${dash.map((d) => fmt(d * PT)).join(' ')}] 0 d ` : ''}${X(x)} ${Y(y + h)} ${fmt(w * PT)} ${fmt(h * PT)} re ${op} Q`);
        return api;
      },
      line(x1, y1, x2, y2, { stroke = [0, 0, 0], lineWidth = 0.2, dash = null } = {}) {
        if (!cur) api.addPage();
        cur.ops.push(`q ${rgb(stroke)} RG ${fmt(lineWidth * PT)} w ${dash ? `[${dash.map((d) => fmt(d * PT)).join(' ')}] 0 d ` : ''}${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} l S Q`);
        return api;
      },
      /** JPEG only. Fitted inside the box (contain) and centred. Returns the drawn rectangle. */
      image(jpegBytes, x, y, w, h) {
        if (!cur) api.addPage();
        const bytes = jpegBytes instanceof Uint8Array ? jpegBytes : new Uint8Array(jpegBytes);
        const info = jpegSize(bytes);
        let idx = images.findIndex((im) => im.bytes === bytes);
        if (idx < 0) { images.push({ bytes, info }); idx = images.length - 1; }
        const s = Math.min(w / info.width, h / info.height); const dw = info.width * s, dh = info.height * s; const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
        cur.imgs.add(idx);
        cur.ops.push(`q ${fmt(dw * PT)} 0 0 ${fmt(dh * PT)} ${X(dx)} ${Y(dy + dh)} cm /Im${idx + 1} Do Q`);
        return { x: dx, y: dy, w: dw, h: dh };
      },
      build() {
        if (!pages.length) api.addPage();
        const objs = []; // array of Uint8Array bodies (without "n 0 obj" wrapper), index+1 = object number
        const add = (body) => { objs.push(body instanceof Uint8Array ? body : latin1(body)); return objs.length; };
        const fontReg = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        const imgObjs = images.map((im) => {
          const cs = im.info.components === 1 ? '/DeviceGray' : im.info.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
          const head = latin1(`<< /Type /XObject /Subtype /Image /Width ${im.info.width} /Height ${im.info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode ${im.info.components === 4 ? '/Decode [1 0 1 0 1 0 1 0] ' : ''}/Length ${im.bytes.length} >>\nstream\n`);
          return add(concat([head, im.bytes, latin1('\nendstream')]));
        });
        const pagesObjNo = objs.length + 1 + pages.length * 2; // reserved after page+content pairs
        const pageObjNos = [];
        pages.forEach((p) => {
          const content = latin1(p.ops.join('\n'));
          const cNo = add(concat([latin1(`<< /Length ${content.length} >>\nstream\n`), content, latin1('\nendstream')]));
          const xo = [...p.imgs].map((i) => `/Im${i + 1} ${imgObjs[i]} 0 R`).join(' ');
          pageObjNos.push(add(`<< /Type /Page /Parent ${pagesObjNo} 0 R /MediaBox [0 0 ${fmt(pw * PT)} ${fmt(ph * PT)}] /Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> ${xo ? `/XObject << ${xo} >> ` : ''}>> /Contents ${cNo} 0 R >>`));
        });
        const pagesNo = add(`<< /Type /Pages /Kids [${pageObjNos.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`);
        if (pagesNo !== pagesObjNo) throw new Error('PDF object numbering error');
        const catalogNo = add(`<< /Type /Catalog /Pages ${pagesNo} 0 R >>`);
        const infoNo = add(`<< /Producer (DARCO JMG Spare Parts System) /Title (${escapeText(sanitize(title))}) /Author (${escapeText(sanitize(author))}) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
        const chunks = [latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]; const offsets = []; let pos = chunks[0].length;
        objs.forEach((body, i) => { offsets.push(pos); const c = concat([latin1(`${i + 1} 0 obj\n`), body, latin1('\nendobj\n')]); chunks.push(c); pos += c.length; });
        const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalogNo} 0 R /Info ${infoNo} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
        chunks.push(latin1(xref));
        return concat(chunks);
      },
    };
    return api;
  }

  /** data:image/jpeg;base64,... → Uint8Array (browser and Node). */
  function dataUrlToBytes(dataUrl) {
    const b64 = String(dataUrl).split(',')[1] || '';
    if (typeof atob === 'function') { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  return { create, jpegSize, textWidth, wrap, sanitize, dataUrlToBytes, PT };
});
