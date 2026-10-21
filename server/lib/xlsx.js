/*
 * xlsx.js — dependency-free reader for .xlsx workbooks (values only).
 *
 * Understands: the ZIP container (stored / deflated entries), shared strings, inline strings,
 * booleans, numbers, formula results and date-formatted cells (converted to ISO dates).
 * Good enough for master-data imports of tens of thousands of rows; not a general spreadsheet engine.
 */
'use strict';
const zlib = require('node:zlib');

function readZip(buf) {
  const entries = new Map();
  // Locate the End Of Central Directory record (search backwards, allowing a comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP/XLSX file (no central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const xlen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    entries.set(name, { method, csize, usize, lho });
    off += 46 + nlen + xlen + clen;
  }
  function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    const nlen = buf.readUInt16LE(e.lho + 26);
    const xlen = buf.readUInt16LE(e.lho + 28);
    const start = e.lho + 30 + nlen + xlen;
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`Unsupported ZIP compression method ${e.method} for ${name}`);
  }
  return { entries, read };
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decodeXml(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] !== undefined ? ENT[e] : m;
  });
}
function attrs(s) {
  const out = {};
  const re = /([\w:]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}
function colIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    let text = '';
    const tre = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    let t;
    while ((t = tre.exec(m[1]))) text += t[1] === undefined ? '' : t[1];
    out.push(decodeXml(text));
  }
  return out;
}

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function parseStyles(xml) {
  const dateStyles = new Set();
  if (!xml) return dateStyles;
  const custom = new Map();
  const nf = /<numFmt\s+([^>]*)\/>/g;
  let m;
  while ((m = nf.exec(xml))) {
    const a = attrs(m[1]);
    const code = (a.formatCode || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    custom.set(Number(a.numFmtId), /[dmyhs]/i.test(code));
  }
  const xfsBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!xfsBlock) return dateStyles;
  const xf = /<xf\s+([^>]*?)(?:\/>|>)/g;
  let i = 0;
  while ((m = xf.exec(xfsBlock[1]))) {
    const a = attrs(m[1]);
    const id = Number(a.numFmtId || 0);
    if (BUILTIN_DATE_FMTS.has(id) || custom.get(id)) dateStyles.add(i);
    i++;
  }
  return dateStyles;
}

function serialToIso(serial) {
  // Excel 1900 date system; serial 1 = 1900-01-01, with the fictitious 1900-02-29 at 60.
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

function parseSheet(xml, shared, dateStyles) {
  const rows = [];
  if (!xml) return rows;
  const sd = /<sheetData[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml);
  const body = sd ? sd[1] : xml;
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g;
  const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  let rm;
  while ((rm = rowRe.exec(body))) {
    if (rm[3] !== undefined) continue; // empty self-closing row
    const ra = attrs(rm[1]);
    const r = Number(ra.r || rows.length + 1);
    const cells = [];
    let cm;
    cellRe.lastIndex = 0;
    const inner = rm[2];
    let colCursor = 0;
    while ((cm = cellRe.exec(inner))) {
      const a = attrs(cm[1] !== undefined ? cm[1] : cm[2]);
      const ci = a.r ? colIndex(a.r) : colCursor;
      colCursor = ci + 1;
      if (cm[1] !== undefined) continue; // self-closing: no value
      const content = cm[3];
      const v = /<v>([\s\S]*?)<\/v>/.exec(content);
      let val = null;
      const t = a.t || 'n';
      if (t === 's') val = shared[Number(v ? v[1] : -1)] ?? null;
      else if (t === 'inlineStr') {
        const is = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(content);
        val = is ? decodeXml(is[1]) : '';
      } else if (t === 'str') val = v ? decodeXml(v[1]) : '';
      else if (t === 'b') val = v ? v[1] === '1' : null;
      else if (t === 'e') val = null;
      else if (v) {
        const num = Number(v[1]);
        if (Number.isNaN(num)) val = decodeXml(v[1]);
        else if (a.s !== undefined && dateStyles.has(Number(a.s))) val = serialToIso(num);
        else val = num;
      }
      if (val === '') val = null;
      cells[ci] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
    rows.push({ r, cells });
  }
  return rows;
}

/**
 * Parse a workbook buffer. Returns { sheets: [{ name, rows }] } where rows are dense arrays
 * aligned to the physical row number (row 1 => index 0); empty rows are empty arrays.
 */
function parseWorkbook(buf, opts = {}) {
  const zip = readZip(buf);
  const wbXml = zip.read('xl/workbook.xml')?.toString('utf8');
  if (!wbXml) throw new Error('Not an XLSX workbook (xl/workbook.xml missing)');
  const relsXml = zip.read('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  const rels = new Map();
  const rr = /<Relationship\s+([^>]*)\/>/g;
  let m;
  while ((m = rr.exec(relsXml))) {
    const a = attrs(m[1]);
    let target = a.Target || '';
    if (target.startsWith('/')) target = target.slice(1);
    else if (!target.startsWith('xl/')) target = 'xl/' + target;
    rels.set(a.Id, target);
  }
  const shared = parseSharedStrings(zip.read('xl/sharedStrings.xml')?.toString('utf8'));
  const dateStyles = parseStyles(zip.read('xl/styles.xml')?.toString('utf8'));
  const sheets = [];
  const sr = /<sheet\s+([^>]*)\/>/g;
  while ((m = sr.exec(wbXml))) {
    const a = attrs(m[1]);
    const name = decodeXml(a.name);
    if (opts.only && !opts.only.includes(name)) { sheets.push({ name, rows: null }); continue; }
    const path = rels.get(a['r:id']) || rels.get(a.id);
    const xml = path ? zip.read(path)?.toString('utf8') : null;
    const parsed = parseSheet(xml, shared, dateStyles);
    const maxRow = parsed.length ? parsed[parsed.length - 1].r : 0;
    const rows = new Array(maxRow).fill(null).map(() => []);
    for (const p of parsed) rows[p.r - 1] = p.cells;
    sheets.push({ name, rows });
  }
  return { sheets, sheetNames: sheets.map((s) => s.name) };
}

function sheetByName(wb, name) {
  const want = name.replace(/\s+/g, '').toLowerCase();
  return wb.sheets.find((s) => s.name.replace(/\s+/g, '').toLowerCase() === want) || null;
}

module.exports = { parseWorkbook, sheetByName, colIndex, serialToIso, decodeXml };
