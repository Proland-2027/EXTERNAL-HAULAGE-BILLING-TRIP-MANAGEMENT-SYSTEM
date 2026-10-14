/*
 * photos.js — photograph capture, downscaling and storage.
 * Photos taken on a phone are 3–8 MB; they are resized on the device to max 1280 px JPEG (~150 KB)
 * before being stored in IndexedDB, keyed by photo id. Falls back to localStorage when IndexedDB is
 * unavailable (private browsing on some phones).
 */
(function (root) {
  'use strict';
  const DB_NAME = 'darco.spares.photos', STORE = 'photos', LS_KEY = 'darco.spares.photos.fallback';
  let dbPromise = null, memory = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (!root.indexedDB) return resolve(null);
      try {
        const req = root.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { console.warn('IndexedDB unavailable, using localStorage for photos', req.error); resolve(null); };
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }
  function mem() {
    if (memory) return memory;
    memory = new Map();
    try { const raw = localStorage.getItem(LS_KEY); if (raw) Object.entries(JSON.parse(raw)).forEach(([k, v]) => memory.set(k, v)); } catch (e) { /* ignore */ }
    return memory;
  }
  function memSave() { try { localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(mem()))); } catch (e) { console.warn('Photo storage is full — export a backup and clear old requests', e); } }
  const tx = (db, mode, fn) => new Promise((resolve, reject) => { const t = db.transaction(STORE, mode); const r = fn(t.objectStore(STORE)); t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });

  async function put(id, dataUrl) { const db = await openDb(); if (db) return tx(db, 'readwrite', (s) => s.put(dataUrl, id)); mem().set(id, dataUrl); memSave(); }
  async function putMany(obj) { const db = await openDb(); if (db) return tx(db, 'readwrite', (s) => { Object.entries(obj).forEach(([k, v]) => s.put(v, k)); }); Object.entries(obj).forEach(([k, v]) => mem().set(k, v)); memSave(); }
  async function get(id) { if (!id) return null; const db = await openDb(); if (db) return (await tx(db, 'readonly', (s) => s.get(id))) || null; return mem().get(id) || null; }
  async function getMany(ids) { const out = {}; for (const id of ids || []) if (id) out[id] = await get(id); return out; }
  async function remove(id) { const db = await openDb(); if (db) return tx(db, 'readwrite', (s) => s.delete(id)); mem().delete(id); memSave(); }
  async function all() {
    const db = await openDb();
    if (db) { const keys = await tx(db, 'readonly', (s) => s.getAllKeys()); const vals = await tx(db, 'readonly', (s) => s.getAll()); const out = {}; keys.forEach((k, i) => (out[k] = vals[i])); return out; }
    return Object.fromEntries(mem());
  }
  async function clear() { const db = await openDb(); if (db) await tx(db, 'readwrite', (s) => s.clear()); mem().clear(); memSave(); }
  async function keys() { return Object.keys(await all()); }

  /** Resize an image File/Blob to a JPEG data URL (max side `max` px). Honours EXIF orientation where the browser supports it. */
  async function fromFile(file, { max = 1280, quality = 0.82 } = {}) {
    let bitmap = null;
    if (root.createImageBitmap) { try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bitmap = null; } }
    if (!bitmap) {
      bitmap = await new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the image')); }; img.src = url; });
    }
    const w = bitmap.width || bitmap.naturalWidth, h = bitmap.height || bitmap.naturalHeight;
    const scale = Math.min(1, max / Math.max(w, h));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    return canvas.toDataURL('image/jpeg', quality);
  }
  /** A labelled grey placeholder JPEG (used for the demo dataset). */
  function placeholder(label, sub = '', w = 640, h = 480) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.fillStyle = '#d9d9d4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a5a49d'; g.lineWidth = 6; g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = '#8f8e87'; g.beginPath(); g.arc(w / 2, h / 2 - 30, 70, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a3a37'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.fillText(label, w / 2, h / 2 + 90);
    g.font = '22px sans-serif'; g.fillStyle = '#5a5955'; g.fillText(sub || 'Demo photo', w / 2, h / 2 + 125);
    return c.toDataURL('image/jpeg', 0.7);
  }
  const bytes = (dataUrl) => root.Pdf.dataUrlToBytes(dataUrl);
  const isJpeg = (dataUrl) => /^data:image\/jpe?g;base64,/i.test(String(dataUrl || ''));
  /** Any image data URL → JPEG data URL (PDF embedding needs JPEG). */
  async function toJpeg(dataUrl) {
    if (isJpeg(dataUrl)) return dataUrl;
    const blob = await (await fetch(dataUrl)).blob();
    return fromFile(blob);
  }

  root.Photos = { put, putMany, get, getMany, remove, all, clear, keys, fromFile, placeholder, bytes, isJpeg, toJpeg };
})(typeof self !== 'undefined' ? self : this);
