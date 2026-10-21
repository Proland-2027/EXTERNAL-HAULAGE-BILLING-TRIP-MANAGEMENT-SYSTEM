/* Small inline-SVG charts: vertical bars (optionally stacked), horizontal bars. Colours come from the --s1..--s8 tokens. */
(function () {
  'use strict';
  const U = HB.U;
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, text) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v); if (text !== undefined) el.textContent = text; return el; };
  const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
  const niceMax = (v) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10; return m * p; };

  function tooltip(svg) {
    const tip = U.h('div', { class: 'chart-tip', style: { position: 'fixed', pointerEvents: 'none', background: 'var(--fg)', color: 'var(--bg)', padding: '6px 9px', borderRadius: '6px', fontSize: '12px', zIndex: 60, display: 'none', maxWidth: '260px' } });
    document.body.append(tip);
    svg.addEventListener('mousemove', (e) => { const t = e.target.closest('[data-tip]'); if (!t) { tip.style.display = 'none'; return; } tip.textContent = t.dataset.tip; tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 12, window.innerWidth - 270) + 'px'; tip.style.top = (e.clientY + 12) + 'px'; });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    return tip;
  }

  /** Grouped or stacked vertical bars. data = { labels: [], series: [{ name, values: [] }] } */
  function bars(data, opts) {
    opts = opts || {};
    const W = opts.width || 720, H = opts.height || 260, padL = 56, padR = 12, padT = 12, padB = 36;
    const n = data.labels.length; const stacked = !!opts.stacked;
    const totals = data.labels.map((_, i) => (stacked ? data.series.reduce((s, sr) => s + (sr.values[i] || 0), 0) : Math.max(...data.series.map((sr) => sr.values[i] || 0))));
    const max = niceMax(Math.max(...totals, 0));
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': opts.label || 'bar chart' });
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const y = (v) => padT + plotH - (v / max) * plotH;
    const grid = svgEl('g', { class: 'grid' });
    for (let i = 0; i <= 4; i++) { const v = (max / 4) * i; grid.append(svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v) })); grid.append(svgEl('text', { x: padL - 6, y: y(v) + 4, 'text-anchor': 'end' }, opts.money ? U.moneyShort(v) : U.int(v))); }
    svg.append(grid);
    const slot = plotW / Math.max(n, 1); const groupW = Math.min(slot * 0.72, 64); const barW = stacked ? groupW : groupW / data.series.length;
    data.labels.forEach((lab, i) => {
      const x0 = padL + slot * i + (slot - groupW) / 2; let acc = 0;
      data.series.forEach((sr, si) => {
        const v = sr.values[i] || 0; if (v <= 0) return;
        const x = stacked ? x0 : x0 + barW * si; const yTop = stacked ? y(acc + v) : y(v); const h = Math.max(1, (stacked ? y(acc) : y(0)) - yTop - (stacked ? 2 : 0));
        const r = svgEl('rect', { x, y: yTop, width: Math.max(barW - 2, 2), height: h, fill: sr.color || SERIES[si % 8], class: 'bar hit', 'data-tip': `${lab} · ${sr.name}: ${opts.money ? U.money(v) : U.int(v)}` });
        svg.append(r); acc += v;
      });
      const every = Math.max(1, Math.ceil(n / Math.floor(plotW / 48)));
      if (i % every === 0) svg.append(svgEl('text', { x: x0 + groupW / 2, y: H - padB + 16, 'text-anchor': 'middle' }, lab));
    });
    tooltip(svg);
    const wrap = U.h('div', { class: 'stack' }, svg);
    if (data.series.length > 1) wrap.append(U.h('div', { class: 'legend' }, data.series.map((sr, si) => U.h('span', {}, U.h('i', { style: { background: sr.color || SERIES[si % 8] } }), sr.name))));
    return wrap;
  }

  /** Horizontal bars for ranked categories. rows = [{ label, value, sub }] */
  function hbars(rows, opts) {
    opts = opts || {};
    const max = Math.max(...rows.map((r) => r.value), 0) || 1;
    const list = U.h('div', { class: 'stack', style: { gap: '6px' } });
    rows.forEach((r, i) => {
      const pct = Math.max(1, (r.value / max) * 100);
      list.append(U.h('div', { class: 'stack', style: { gap: '2px' } },
        U.h('div', { class: 'row between small' }, U.h('span', { text: r.label, class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }), U.h('span', { class: 'num', text: opts.money ? U.money(r.value) : U.int(r.value) })),
        U.h('div', { class: 'progress', title: r.sub || '' }, U.h('i', { style: { width: pct + '%', background: opts.color || SERIES[i % 1] } }))));
    });
    return list;
  }

  HB.charts = { bars, hbars, SERIES };
})();
