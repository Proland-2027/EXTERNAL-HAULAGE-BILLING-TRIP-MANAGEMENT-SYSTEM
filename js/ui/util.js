/* DOM, formatting and dialog helpers shared by every view. */
(function () {
  'use strict';
  const U = {};

  U.h = function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    U.append(el, children);
    return el;
  };
  U.append = (el, children) => { for (const c of children.flat(Infinity)) { if (c === null || c === undefined || c === false) continue; el.append(c instanceof Node ? c : document.createTextNode(String(c))); } return el; };
  U.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const nf = new Intl.NumberFormat('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });
  U.money = (n, opts) => { if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return (opts && opts.blank) || ''; return '₦' + nf.format(Number(n)); };
  U.moneyShort = (n) => { if (!Number.isFinite(Number(n))) return ''; const a = Math.abs(n); const s = a >= 1e9 ? (n / 1e9).toFixed(2) + 'bn' : a >= 1e6 ? (n / 1e6).toFixed(1) + 'm' : a >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : nf0.format(n); return '₦' + s; };
  U.signedMoney = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + U.money(Math.abs(n));
  U.pct = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Number(n)).toFixed(1) + '%');
  U.int = (n) => nf0.format(Number(n) || 0);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  U.date = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); if (!d) return iso; return `${Number(d)} ${MON[Number(m) - 1]} ${y}`; };
  U.dateTime = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return iso; return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  U.monthLabel = (ym) => (ym ? `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : '');
  U.nowISO = () => new Date().toISOString();
  U.todayISO = () => new Date().toISOString().slice(0, 10);
  U.id = (prefix) => (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  U.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  U.sortBy = (arr, key, dir) => { const s = dir === 'desc' ? -1 : 1; return [...arr].sort((a, b) => { const x = typeof key === 'function' ? key(a) : a[key], y = typeof key === 'function' ? key(b) : b[key]; if (x === y) return 0; if (x === null || x === undefined || x === '') return 1; if (y === null || y === undefined || y === '') return -1; return (x > y ? 1 : -1) * s; }); };

  // ---- toast
  let toastTimer;
  U.toast = (msg, kind) => { const t = document.getElementById('toast'); if (!t) return; t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : ''); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'bad' ? 6000 : 3200); };

  // ---- modal
  U.modal = function ({ title, body, actions, size, onClose }) {
    const root = document.getElementById('modal-root');
    const foot = U.h('div', { class: 'modal-foot' });
    const box = U.h('div', { class: 'modal' + (size ? ' ' + size : ''), role: 'dialog', 'aria-modal': 'true' },
      U.h('div', { class: 'modal-head' }, U.h('h2', { text: title }), U.h('button', { class: 'btn ghost sm', 'aria-label': 'Close', onClick: () => api.close() }, '✕')),
      U.h('div', { class: 'modal-body' }, body), foot);
    const overlay = U.h('div', { class: 'overlay', onClick: (e) => { if (e.target === overlay) api.close(); } }, box);
    const api = {
      el: box, foot,
      close(result) { if (!overlay.parentNode) return; overlay.remove(); document.removeEventListener('keydown', esc); if (onClose) onClose(result); },
      setActions(list) { U.clear(foot); for (const a of list) foot.append(a); },
    };
    const esc = (e) => { if (e.key === 'Escape') api.close(); };
    document.addEventListener('keydown', esc);
    if (actions) api.setActions(actions);
    root.append(overlay);
    const first = box.querySelector('input,select,textarea,button:not([aria-label=Close])'); if (first) setTimeout(() => first.focus(), 30);
    return api;
  };
  U.confirm = ({ title, message, okLabel, danger }) => new Promise((resolve) => {
    const m = U.modal({ title: title || 'Please confirm', size: 'narrow', body: U.h('p', { text: message }), onClose: (r) => resolve(!!r) });
    m.setActions([U.h('button', { class: 'btn', onClick: () => m.close(false) }, 'Cancel'), U.h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onClick: () => m.close(true) }, okLabel || 'Confirm')]);
  });
  U.prompt = ({ title, label, value, type }) => new Promise((resolve) => {
    const input = U.h('input', { type: type || 'text', value: value || '' });
    const m = U.modal({ title, size: 'narrow', body: U.h('label', { class: 'field' }, U.h('span', { text: label || '' }), input), onClose: (r) => resolve(r ? input.value : null) });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.close(true); });
    m.setActions([U.h('button', { class: 'btn', onClick: () => m.close(false) }, 'Cancel'), U.h('button', { class: 'btn primary', onClick: () => m.close(true) }, 'OK')]);
  });

  // ---- form controls
  U.field = (label, control, opts) => U.h('label', { class: 'field' + (opts && opts.locked ? ' locked' : '') + (opts && opts.span2 ? ' span2' : '') }, U.h('span', { text: label }), control, opts && opts.help ? U.h('span', { class: 'help', text: opts.help }) : null);
  U.select = (options, value, attrs) => { const s = U.h('select', attrs || {}); for (const o of options) { const [v, l] = Array.isArray(o) ? o : [o, o]; s.append(U.h('option', { value: v, selected: String(v) === String(value ?? '') ? true : null }, l)); } return s; };
  U.datalistInput = (id, options, value, attrs) => { const dl = U.h('datalist', { id }); for (const o of options) dl.append(U.h('option', { value: o })); const inp = U.h('input', Object.assign({ type: 'text', list: id, value: value || '', autocomplete: 'off' }, attrs || {})); return U.h('span', { class: 'row grow', style: { gap: 0 } }, inp, dl); };
  U.pill = (text, kind) => U.h('span', { class: 'pill ' + (kind || 'neutral'), text });
  U.statusKind = (tripStatus) => ({ 'Closed': 'good', 'Awaiting Payment': 'warn', 'Part Paid - Balance Due': 'info', 'Invoice Not Sent': 'bad', 'Internal Client': 'neutral' }[tripStatus] || 'neutral');

  // ---- crypto (PBKDF2-HMAC-SHA256, 100k iterations, 32 bytes) — identical to server/crypto.
  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  U.randomSalt = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return toHex(a); };
  U.hashPassword = async (password, salt) => {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
    return toHex(bits);
  };

  // ---- downloads (overridden by the artifact store when the downloads capability exists)
  U.download = async (blob, filename) => {
    if (U.downloadHook) { try { await U.downloadHook(blob, filename); return true; } catch (e) { if (e && e.code === 'not_granted') { U.toast('Download was not allowed in this view.', 'bad'); return false; } } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); return true;
  };

  U.storage = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  window.HB = window.HB || {};
  window.HB.U = U;
})();
