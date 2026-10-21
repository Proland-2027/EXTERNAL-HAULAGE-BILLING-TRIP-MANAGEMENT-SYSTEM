/* http.js — tiny router + helpers on top of node:http (no framework dependency). */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.sqlite': 'application/octet-stream', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };
  return {
    get: (p, h) => add('GET', p, h), post: (p, h) => add('POST', p, h), put: (p, h) => add('PUT', p, h), del: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(pathname);
        if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); return { handler: r.handler, params }; }
      }
      return null;
    },
    routes,
  };
}

function readBody(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, 20 * 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body'); }
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie; if (!h) return out;
  for (const part of h.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function send(res, status, body, headers = {}) {
  const h = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers };
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) { h['Content-Type'] = 'application/json; charset=utf-8'; body = JSON.stringify(body); }
  res.writeHead(status, h); res.end(body);
}
function serveStatic(root, urlPath, res, { maxAge = 0, index = 'index.html' } = {}) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += index;
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(path.normalize(root))) return false;
  let st; try { st = fs.statSync(file); } catch { return false; }
  if (st.isDirectory()) { res.writeHead(302, { Location: urlPath.split('?')[0] + '/' }); res.end(); return true; }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
  return true;
}
function csv(rows, columns) {
  const cols = columns || (rows.length ? Object.keys(rows[0]) : []);
  const esc = (v) => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
}

module.exports = { http, HttpError, createRouter, readBody, readJson, parseCookies, send, serveStatic, csv, URL, MIME };
