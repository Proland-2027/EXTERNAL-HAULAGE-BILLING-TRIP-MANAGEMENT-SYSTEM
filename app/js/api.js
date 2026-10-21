/* api.js — JSON client. Standalone: /api/...; WordPress: window.PP_API_BASE = '/wp-json/proland/v1' with a nonce header. */
(function (root) {
  'use strict';
  const base = root.PP_API_BASE || '/api';
  async function call(method, path, body, opts = {}) {
    const headers = { 'X-Requested-With': 'fetch', Accept: 'application/json' };
    if (root.PP_WP_NONCE) headers['X-WP-Nonce'] = root.PP_WP_NONCE;
    let payload;
    if (body instanceof FormData) payload = body; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + path, { method, headers, body: payload, credentials: 'same-origin' });
    let data = null;
    try { data = await res.json(); } catch (e) { data = { error: res.statusText || 'Unexpected response' }; }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status; err.details = data && data.details;
      if (res.status === 401 && !opts.silent) root.dispatchEvent(new CustomEvent('pp:unauthorized'));
      throw err;
    }
    return data;
  }
  const qs = (o) => { const p = Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`); return p.length ? '?' + p.join('&') : ''; };
  root.Api = {
    get: (path, params, opts) => call('GET', path + qs(params), undefined, opts),
    post: (path, body) => call('POST', path, body),
    put: (path, body) => call('PUT', path, body),
    del: (path) => call('DELETE', path),
    qs,
  };
})(window);
