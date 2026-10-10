/* charts.js — tiny inline-SVG charts (grouped bars + stacked horizontal bars) with hover tooltips. */
(function (root) {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return step * p;
  }
  function legend(series) {
    return `<div class="legend">${series.map((s, i) => `<span style="--sw:${SERIES[i]}">${esc(s.name)}</span>`).join('')}</div>`;
  }

  /** Grouped vertical bars. categories: [..], series: [{name, values:[..]}], fmt: value formatter. */
  function groupedBars({ categories, series, fmt = (v) => v, height = 260, unitLabel = '' }) {
    const W = 760, H = height, padL = 56, padR = 12, padT = 14, padB = 46;
    const iw = W - padL - padR, ih = H - padT - padB;
    const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)) * 1.08);
    const groupW = iw / Math.max(1, categories.length);
    const barW = Math.min(44, (groupW * 0.72) / series.length);
    const y = (v) => padT + ih - (v / max) * ih;
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unitLabel)}">`;
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      out += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text class="tick" x="${padL - 6}" y="${yy + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
    }
    categories.forEach((c, ci) => {
      const gx = padL + ci * groupW + (groupW - barW * series.length - 2 * (series.length - 1)) / 2;
      series.forEach((s, si) => {
        const v = s.values[ci] || 0, x = gx + si * (barW + 2), top = y(v), h = Math.max(0, padT + ih - top);
        const r = Math.min(4, h / 2);
        const d = h > 0 ? `M${x},${padT + ih} V${top + r} a${r},${r} 0 0 1 ${r},-${r} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} V${padT + ih} Z` : '';
        out += `<path class="mark" d="${d}" fill="${SERIES[si]}" data-tip="${esc(`${c} · ${s.name}: ${fmt(v)}`)}"/>`;
        if (h > 16 && series.length <= 4) out += `<text class="dlabel" x="${x + barW / 2}" y="${top - 4}" text-anchor="middle">${esc(fmt(v))}</text>`;
      });
      out += `<text class="cat" x="${padL + ci * groupW + groupW / 2}" y="${H - padB + 16}" text-anchor="middle">${esc(c.length > 16 ? c.slice(0, 15) + '…' : c)}</text>`;
    });
    out += `<line class="baseline" x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}"/></svg>`;
    return `<div class="chart">${legend(series)}${out}</div>`;
  }

  /** Stacked horizontal bars (part-to-whole). rows: [{label, values:[..]}], series: [{name}]. */
  function stackedBars({ rows, series, fmt = (v) => v, unitLabel = '' }) {
    const W = 760, padL = 130, padR = 60, rowH = 30, padT = 8, padB = 28;
    const H = padT + padB + rows.length * rowH;
    const iw = W - padL - padR;
    const max = niceMax(Math.max(0, ...rows.map((r) => r.values.reduce((a, b) => a + b, 0))) * 1.02);
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unitLabel)}">`;
    for (let i = 0; i <= 4; i++) {
      const x = padL + (iw / 4) * i;
      out += `<line class="grid-line" x1="${x}" x2="${x}" y1="${padT}" y2="${H - padB}"/><text class="tick" x="${x}" y="${H - padB + 14}" text-anchor="middle">${esc(fmt((max / 4) * i))}</text>`;
    }
    rows.forEach((r, ri) => {
      const yy = padT + ri * rowH + 4, h = rowH - 10;
      let x = padL;
      const total = r.values.reduce((a, b) => a + b, 0);
      r.values.forEach((v, si) => {
        const w = (v / max) * iw;
        if (w > 0) {
          const isLast = si === r.values.length - 1 || r.values.slice(si + 1).every((z) => !z);
          const rr = isLast ? Math.min(4, w, h / 2) : 0;
          const d = `M${x},${yy} h${Math.max(0, w - rr)} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} a${rr},${rr} 0 0 1 -${rr},${rr} h-${Math.max(0, w - rr)} Z`;
          out += `<path class="mark" d="${d}" fill="${SERIES[si]}" data-tip="${esc(`${r.label} · ${series[si].name}: ${fmt(v)} (${total ? Math.round((v / total) * 100) : 0}%)`)}"/>`;
          if (w > 46) out += `<text class="dlabel" x="${x + w / 2}" y="${yy + h / 2 + 4}" text-anchor="middle" style="fill:#fff">${total ? Math.round((v / total) * 100) : 0}%</text>`;
          x += w + 2;
        }
      });
      out += `<text class="cat" x="${padL - 8}" y="${yy + h / 2 + 4}" text-anchor="end">${esc(r.label.length > 18 ? r.label.slice(0, 17) + '…' : r.label)}</text>`;
      out += `<text class="dlabel" x="${x + 4}" y="${yy + h / 2 + 4}">${esc(fmt(total))}</text>`;
    });
    out += `<line class="baseline" x1="${padL}" x2="${padL}" y1="${padT}" y2="${H - padB}"/></svg>`;
    return `<div class="chart">${legend(series)}${out}</div>`;
  }

  function bindTooltips(container) {
    const tip = document.getElementById('tooltip');
    if (!tip) return;
    container.addEventListener('mousemove', (e) => {
      const m = e.target.closest('[data-tip]');
      if (!m) { tip.hidden = true; return; }
      tip.textContent = m.getAttribute('data-tip');
      tip.hidden = false;
      const x = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12);
      tip.style.left = `${x}px`;
      tip.style.top = `${e.clientY + 14}px`;
    });
    container.addEventListener('mouseleave', () => { tip.hidden = true; });
  }

  root.Charts = { groupedBars, stackedBars, bindTooltips };
})(typeof self !== 'undefined' ? self : this);
