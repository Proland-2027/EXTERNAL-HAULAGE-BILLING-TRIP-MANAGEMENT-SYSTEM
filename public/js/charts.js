/* charts.js — dependency-free inline SVG charts: bars, lines, Gantt, utilisation heatmap. */
(function (root) {
  'use strict';
  const { esc } = root.App;
  const C = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', '#9b59b6', '#16a085'];
  function nice(max) { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p; const step = n <= 1 ? 0.2 : n <= 2 ? 0.5 : n <= 5 ? 1 : 2; return Math.ceil(n / step) * step * p; }

  /** Grouped bars. data: [{label, values:[..]}], series: ['Planned','Actual'] */
  function bars(data, series, { height = 220, width = 720, yFmt = (v) => v, title } = {}) {
    if (!data.length) return `<p class="muted small">No data</p>`;
    const pad = { l: 48, r: 10, t: 16, b: 46 }; const W = width; const H = height; const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
    const max = nice(Math.max(1e-9, ...data.flatMap((d) => d.values))); const gw = iw / data.length; const bw = Math.max(2, (gw * 0.7) / series.length);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title || '')}">`;
    for (let i = 0; i <= 4; i++) { const y = pad.t + ih - (ih * i) / 4; s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" fill="var(--muted)" font-size="10">${esc(yFmt((max * i) / 4))}</text>`; }
    data.forEach((d, i) => {
      const x0 = pad.l + i * gw + (gw - bw * series.length) / 2;
      d.values.forEach((v, j) => { const h = (v / max) * ih; s += `<rect x="${x0 + j * bw}" y="${pad.t + ih - h}" width="${bw - 1}" height="${h}" fill="${C[j % C.length]}"><title>${esc(d.label)} – ${esc(series[j])}: ${esc(yFmt(v))}</title></rect>`; });
      if (data.length <= 40 || i % Math.ceil(data.length / 40) === 0) s += `<text x="${pad.l + i * gw + gw / 2}" y="${H - pad.b + 14}" text-anchor="middle" fill="var(--ink-2)" font-size="10" transform="rotate(${data.length > 14 ? -40 : 0} ${pad.l + i * gw + gw / 2} ${H - pad.b + 14})">${esc(d.label)}</text>`;
    });
    s += '</svg>';
    return s + `<div class="legend">${series.map((n, j) => `<span><i style="background:${C[j % C.length]}"></i>${esc(n)}</span>`).join('')}</div>`;
  }
  /** Horizontal bars with optional target: rows [{label, value, max?, sub}] */
  function hbars(rows, { fmt = (v) => v, color = 'var(--series-1)' } = {}) {
    const max = Math.max(1e-9, ...rows.map((r) => r.max != null ? Math.max(r.max, r.value) : r.value));
    return rows.map((r) => `<div class="bar-h"><span style="width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.label)}">${esc(r.label)}</span><div class="track"><div class="fill" style="width:${Math.min(100, (r.value / max) * 100)}%;background:${r.color || color}"></div></div><span class="num" style="width:110px">${esc(fmt(r.value))}${r.sub ? ` <span class="muted">${esc(r.sub)}</span>` : ''}</span></div>`).join('');
  }
  /** Gantt: rows [{label, group, start, finish, baselineStart?, baselineFinish?, cp?, pct?, sub?}] dates ISO; range from/to */
  function gantt(rows, { from, to, today, dayWidth = 22, labelWidth = 260, onRowAttr = () => '' } = {}) {
    if (!rows.length) return `<p class="muted small">Nothing scheduled in this range</p>`;
    const d0 = new Date(from + 'T00:00:00Z'); const d1 = new Date(to + 'T00:00:00Z'); const days = Math.max(1, Math.round((d1 - d0) / 86400000) + 1);
    const x = (iso) => labelWidth + Math.round((new Date(iso + 'T00:00:00Z') - d0) / 86400000) * dayWidth;
    const rowH = 24; const headH = 40; const W = labelWidth + days * dayWidth; const H = headH + rows.length * rowH + 10;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    let lastMonth = '';
    for (let i = 0; i < days; i++) { const d = new Date(d0); d.setUTCDate(d.getUTCDate() + i); const iso = d.toISOString().slice(0, 10); const wd = d.getUTCDay(); const xx = labelWidth + i * dayWidth;
      if (wd === 0 || wd === 6) s += `<rect x="${xx}" y="${headH}" width="${dayWidth}" height="${H - headH}" fill="var(--surface-2)"/>`;
      const m = iso.slice(0, 7); if (m !== lastMonth) { lastMonth = m; s += `<text x="${xx + 2}" y="12" font-size="11" fill="var(--ink-2)" font-weight="600">${d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</text>`; }
      s += `<text x="${xx + dayWidth / 2}" y="30" font-size="10" text-anchor="middle" fill="var(--muted)">${d.getUTCDate()}</text><line x1="${xx}" x2="${xx}" y1="${headH}" y2="${H}" stroke="var(--grid)"/>`; }
    rows.forEach((r, i) => {
      const y = headH + i * rowH;
      s += `<g ${onRowAttr(r)}><rect x="0" y="${y}" width="${W}" height="${rowH}" fill="${i % 2 ? 'transparent' : 'color-mix(in srgb, var(--ink) 2%, transparent)'}"/><text x="6" y="${y + 15}" font-size="11" fill="var(--ink)"><title>${esc(r.title || r.label)}</title>${esc(r.label.length > 44 ? r.label.slice(0, 43) + '…' : r.label)}</text>`;
      if (r.baselineStart && r.baselineFinish) { const bx = x(r.baselineStart); const bw = Math.max(dayWidth, x(r.baselineFinish) + dayWidth - bx); s += `<rect x="${bx}" y="${y + 17}" width="${bw}" height="4" fill="var(--axis)" opacity=".7"><title>Baseline ${r.baselineStart} → ${r.baselineFinish}</title></rect>`; }
      if (r.start && r.finish) { const bx = x(r.start); const bw = Math.max(dayWidth - 2, x(r.finish) + dayWidth - bx - 2); const col = r.color || (r.cp ? 'var(--series-2)' : 'var(--series-1)'); s += `<rect class="bar ${r.cp ? 'cp' : ''}" x="${bx}" y="${y + 4}" width="${bw}" height="12" fill="${col}" opacity=".85"><title>${esc(r.title || r.label)}: ${r.start} → ${r.finish}${r.pct != null ? ` (${Math.round(r.pct)}% done)` : ''}</title></rect>`; if (r.pct) s += `<rect x="${bx}" y="${y + 4}" width="${bw * Math.min(1, r.pct / 100)}" height="12" fill="var(--good)" opacity=".8"/>`; }
      else if (r.start) { s += `<circle cx="${x(r.start) + dayWidth / 2}" cy="${y + 10}" r="4" fill="var(--muted)"/>`; }
    });
    if (today && today >= from && today <= to) s += `<line class="today" x1="${x(today) + dayWidth / 2}" x2="${x(today) + dayWidth / 2}" y1="${headH - 4}" y2="${H}" stroke="var(--bad)" stroke-dasharray="3 3"/>`;
    return s + '</svg>';
  }
  /** Heatmap: rows [{label, cells:{date: value}}], values 0..1+ (utilisation) */
  function heat(rows, dates, { fmt = (v) => `${Math.round(v * 100)}%` } = {}) {
    const col = (v) => v == null || v === 0 ? 'var(--surface-2)' : v > 1.001 ? 'var(--bad-bg)' : v > 0.85 ? 'var(--warn-bg)' : 'color-mix(in srgb, var(--series-1) ' + Math.round(20 + v * 50) + '%, var(--surface))';
    const cols = `200px repeat(${dates.length}, minmax(34px, 1fr))`;
    let s = `<div class="heat" style="grid-template-columns:${cols}"><div></div>${dates.map((d) => `<div class="cell muted" title="${d}">${d.slice(8)}</div>`).join('')}`;
    for (const r of rows) s += `<div class="cell" style="justify-content:flex-start;overflow:hidden;white-space:nowrap" title="${esc(r.label)}">${esc(r.label)}</div>${dates.map((d) => { const v = r.cells[d]; return `<div class="cell" style="background:${col(v)}" title="${esc(r.label)} ${d}: ${v == null ? '–' : fmt(v)}">${v ? fmt(v) : ''}</div>`; }).join('')}`;
    return s + '</div>';
  }
  root.Charts = { bars, hbars, gantt, heat, C };
})(window);
