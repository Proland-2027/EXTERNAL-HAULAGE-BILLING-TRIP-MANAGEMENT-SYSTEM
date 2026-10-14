// Minimal PDF writer tests.  Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const Pdf = require('../spare-parts/js/pdf.js');

/** A structurally valid JPEG header (SOI, APP0, SOF0 with 40×30 RGB, EOI) — enough for size parsing and embedding. */
function fakeJpeg(w = 40, h = 30, comps = 3) {
  return new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x4A, 0x46, 0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, comps, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0xFF, 0xD9]);
}
const text = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

test('jpegSize reads the SOF marker', () => {
  assert.deepEqual(Pdf.jpegSize(fakeJpeg(640, 480)), { width: 640, height: 480, components: 3 });
  assert.deepEqual(Pdf.jpegSize(fakeJpeg(10, 20, 1)), { width: 10, height: 20, components: 1 });
  assert.throws(() => Pdf.jpegSize(new Uint8Array([0x89, 0x50])), /Not a JPEG/);
});

test('text metrics: Helvetica widths and word wrapping', () => {
  assert.ok(Math.abs(Pdf.textWidth('Hello', 10, false) - (722 + 556 + 222 + 222 + 556) / 1000 * 10 / Pdf.PT) < 1e-9);
  assert.ok(Pdf.textWidth('Hello', 10, true) > Pdf.textWidth('Hello', 10, false));
  const lines = Pdf.wrap('one two three four five six seven', 10, false, 25);
  assert.ok(lines.length > 1);
  lines.forEach((l) => assert.ok(Pdf.textWidth(l, 10, false) <= 25 || !l.includes(' ')));
  assert.deepEqual(Pdf.wrap('a\n\nb', 10, false, 100), ['a', '', 'b']);
  assert.equal(Pdf.sanitize('Résumé – “quoted” 中文'), 'Résumé - "quoted" ??');
});

test('build produces a well-formed PDF with correct xref offsets, fonts, page and image', () => {
  const doc = Pdf.create({ title: 'Test (1)' });
  doc.addPage();
  doc.text('DARCO JMG', 20, 20, { size: 18, bold: true, color: [1, 1, 1] });
  doc.rect(10, 10, 100, 20, { fill: [0.1, 0.3, 0.6] });
  doc.line(10, 40, 200, 40, { dash: [2, 1] });
  const jpg = fakeJpeg(40, 30);
  const drawn = doc.image(jpg, 10, 50, 60, 60);
  assert.equal(drawn.w, 60); assert.equal(drawn.h, 45); assert.equal(drawn.y, 50 + 7.5, 'image is centred in its box');
  doc.image(jpg, 80, 50, 30, 30); // same bytes → same XObject
  const bytes = doc.build();
  const s = text(bytes);
  assert.ok(s.startsWith('%PDF-1.4\n'));
  assert.ok(s.endsWith('%%EOF\n'));
  assert.ok(s.includes('/BaseFont /Helvetica-Bold'));
  assert.ok(s.includes('/Subtype /Image /Width 40 /Height 30 /ColorSpace /DeviceRGB'));
  assert.equal((s.match(/\/Subtype \/Image/g) || []).length, 1, 'image embedded once');
  assert.ok(s.includes('/Title (Test \\(1\\))'));
  assert.ok(s.includes('/Count 1'));
  // every xref offset must point at "N 0 obj"
  const xrefAt = parseInt(/startxref\n(\d+)\n%%EOF/.exec(s)[1], 10);
  assert.equal(s.slice(xrefAt, xrefAt + 4), 'xref');
  const entries = s.slice(xrefAt).split('\n').filter((l) => /^\d{10} 00000 n/.test(l));
  entries.forEach((e, i) => { const off = parseInt(e.slice(0, 10), 10); assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`); });
  const size = parseInt(/\/Size (\d+)/.exec(s)[1], 10);
  assert.equal(entries.length, size - 1);
});

test('text returns the y position below the block and supports alignment', () => {
  const doc = Pdf.create();
  const y = doc.text('two\nlines', 10, 10, { size: 10 });
  assert.ok(y > 10 + 2 * 10 / Pdf.PT);
  doc.text('right', 100, 10, { align: 'right' }); doc.text('centre', 100, 10, { align: 'center' });
  const s = text(doc.build());
  assert.ok(s.includes('(right) Tj') && s.includes('(centre) Tj'));
});

test('dataUrlToBytes decodes base64', () => {
  const b = Pdf.dataUrlToBytes('data:image/jpeg;base64,/9j/2Q==');
  assert.deepEqual(Array.from(b), [0xFF, 0xD8, 0xFF, 0xD9]);
});
