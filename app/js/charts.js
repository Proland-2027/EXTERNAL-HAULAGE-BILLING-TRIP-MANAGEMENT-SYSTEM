/* charts.js — inline SVG charts: grouped bars, horizontal bars, Gantt, load heat-map. No dependencies. */
(function (root) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
  const nice = (max) => { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p; const step = n <= 1 ? 0.2 : n <= 2 ? 0.5 : n <= 5 ? 1 : 2; return Math.ceil(max / (step * p)) * step * p; };

  /** Grouped bar chart. data: [{label, values:[...]}], series: ['Planned','Actual'] */
  function groupedBars(data, series, { height = 220, yLabel = '' } = {}) {
    const w = Math.max(420, data.length * Math.max(26, 10 * series.length) + 80), h = height, pl = 48, pr = 12, pt = 14, pb = 36;
    const max = nice(Math.max(1, ...data.flatMap((d) => d.values.map((v) => +v || 0))));
    const cw = (w - pl - pr) / Math.max(1, data.length), bw = Math.max(3, (cw * 0.72) / series.length);
    const y = (v) => pt + (h - pt - pb) * (1 - v / max);
    const ticks = 4; let g = '';
    for (let i = 0; i <= ticks; i++) { const v = (max / ticks) * i; g += `<line x1="${pl}" x2="${w - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v * 10) / 10}</text>`; }
    let bars = '';
    data.forEach((d, i) => {
      const x0 = pl + i * cw + (cw - bw * series.length) / 2;
      d.values.forEach((v, s) => { const vv = +v || 0; bars += `<rect x="${x0 + s * bw}" y="${y(vv)}" width="${bw - 1}" height="${Math.max(0, y(0) - y(vv))}" fill="${COLORS[s % COLORS.length]}"><title>${esc(d.label)} — ${esc(series[s])}: ${vv.toLocaleString()}</title></rect>`; });
      const every = Math.ceil(data.length / 14);
      if (i % every === 0) bars += `<text x="${pl + i * cw + cw / 2}" y="${h - pb + 14}" text-anchor="middle">${esc(String(d.label).slice(-5))}</text>`;
    });
    const legend = `<div class="legend">${series.map((s, i) => `<span><span class="sw" style="background:${COLORS[i]}"></span>${esc(s)}</span>`).join('')}</div>`;
    return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(yLabel)}"><g class="grid">${g}</g>${bars}</svg>${legend}</div>`;
  }

  /** Horizontal bars with a percentage value and threshold colouring. rows: [{label, value, max=100, text}] */
  function hbars(rows, { height = 22, max = 100, warnAt = 85, badAt = 100 } = {}) {
    const w = 600, lw = 230, h = rows.length * (height + 6) + 6;
    let out = '';
    rows.forEach((r, i) => {
      const v = Math.max(0, +r.value || 0), yy = 4 + i * (height + 6), bw = (w - lw - 70) * Math.min(1, v / max);
      const color = v >= badAt ? 'var(--bad)' : v >= warnAt ? 'var(--warn)' : 'var(--series-1)';
      out += `<text x="${lw - 8}" y="${yy + height / 2 + 4}" text-anchor="end" class="lbl">${esc(String(r.label).slice(0, 36))}</text><rect x="${lw}" y="${yy}" width="${w - lw - 70}" height="${height}" fill="var(--surface-2)" rx="4"/><rect x="${lw}" y="${yy}" width="${bw}" height="${height}" fill="${color}" rx="4"><title>${esc(r.label)}: ${r.text || v}</title></rect><text x="${w - 64}" y="${yy + height / 2 + 4}">${esc(r.text || v)}</text>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${w} ${Math.max(h, 30)}">${out}</svg></div>`;
  }

  /**
   * Gantt. rows: [{id, label, sub, start, finish, baseStart, baseFinish, color, crit, pct, group, status}] with ISO dates.
   * groups rendered as header rows when row.group changes. deps: [[fromId, toId]] drawn as connectors.
   */
  function gantt(rows, { from, to, todayStr, deps = [], labelWidth = 260, dayWidth = 26, rowHeight = 26, calendar = null } = {}) {
    if (!rows.length) return '<div class="empty">Nothing scheduled.</div>';
    const dates = rows.flatMap((r) => [r.start, r.finish, r.baseStart, r.baseFinish]).filter(Boolean);
    from = from || dates.reduce((a, b) => (a < b ? a : b)); to = to || dates.reduce((a, b) => (a > b ? a : b));
    from = addDays(from, -1); to = addDays(to, 2);
    const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
    const w = labelWidth + days * dayWidth + 10, headH = 40;
    const x = (d) => labelWidth + Math.round((new Date(d) - new Date(from)) / 86400000) * dayWidth;
    let body = '', y = headH, lastGroup = null, pos = {};
    rows.forEach((r) => {
      if (r.group !== undefined && r.group !== lastGroup) { body += `<rect class="grp" x="0" y="${y}" width="${w}" height="${rowHeight}"/><text class="lbl" x="8" y="${y + rowHeight / 2 + 4}" font-weight="600">${esc(r.group)}</text>`; y += rowHeight; lastGroup = r.group; }
      body += `<text class="lbl" x="${r.group !== undefined ? 18 : 8}" y="${y + rowHeight / 2 + 4}">${esc(String(r.label).slice(0, 34))}</text>`;
      if (r.sub) body += `<text x="${labelWidth - 6}" y="${y + rowHeight / 2 + 4}" text-anchor="end" class="muted">${esc(String(r.sub).slice(0, 16))}</text>`;
      if (r.baseStart && r.baseFinish && (r.baseStart !== r.start || r.baseFinish !== r.finish)) body += `<rect class="base" x="${x(r.baseStart)}" y="${y + 3}" width="${Math.max(4, x(r.baseFinish) - x(r.baseStart) + dayWidth)}" height="${rowHeight - 6}" rx="3"/>`;
      if (r.start && r.finish) {
        const bx = x(r.start), bw = Math.max(6, x(r.finish) - bx + dayWidth - 2);
        body += `<rect class="bar ${r.crit ? 'crit' : ''}" x="${bx}" y="${y + 5}" width="${bw}" height="${rowHeight - 10}" fill="${r.color || 'var(--series-1)'}" opacity="${r.status === 'COMPLETED' ? 0.55 : 0.9}"><title>${esc(r.title || r.label)}\n${r.start} → ${r.finish}${r.baseFinish && r.baseFinish !== r.finish ? `\nbaseline finish ${r.baseFinish}` : ''}</title></rect>`;
        if (r.pct != null && r.pct > 0) body += `<rect x="${bx}" y="${y + rowHeight - 8}" width="${(bw * Math.min(100, r.pct)) / 100}" height="3" fill="var(--good)"/>`;
        pos[r.id] = { x1: bx, x2: bx + bw, y: y + rowHeight / 2 };
      }
      y += rowHeight;
    });
    let header = '', cols = '';
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i), dt = new Date(d + 'T00:00:00Z'), dow = dt.getUTCDay();
      const nonWorking = calendar ? !calendar[d] : (dow === 0 || dow === 6);
      if (nonWorking) cols += `<rect class="wk" x="${x(d)}" y="${headH}" width="${dayWidth}" height="${y - headH}"/>`;
      if (dt.getUTCDate() === 1 || i === 0) header += `<text x="${x(d) + 2}" y="14" font-weight="600">${dt.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${dt.getUTCFullYear()}</text>`;
      header += `<text x="${x(d) + dayWidth / 2}" y="32" text-anchor="middle" ${nonWorking ? 'opacity=".45"' : ''}>${dt.getUTCDate()}</text>`;
      cols += `<line x1="${x(d)}" x2="${x(d)}" y1="${headH}" y2="${y}" stroke="var(--grid)"/>`;
    }
    let depLines = '';
    deps.forEach(([a, b]) => { const p = pos[a], q = pos[b]; if (!p || !q) return; depLines += `<path class="dep" d="M${p.x2} ${p.y} L${p.x2 + 4} ${p.y} L${p.x2 + 4} ${q.y} L${q.x1} ${q.y}" marker-end="url(#arr)"/>`; });
    const todayLine = todayStr && todayStr >= from && todayStr <= to ? `<line class="today" x1="${x(todayStr) + dayWidth / 2}" x2="${x(todayStr) + dayWidth / 2}" y1="${headH - 4}" y2="${y}"/><text x="${x(todayStr) + dayWidth / 2 + 3}" y="${headH - 6}" fill="var(--bad)">today</text>` : '';
    return `<div class="gantt"><svg width="${w}" height="${y + 6}" viewBox="0 0 ${w} ${y + 6}"><defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="var(--muted)"/></marker></defs><rect x="0" y="0" width="${w}" height="${headH}" fill="var(--surface-2)"/>${header}${cols}<line x1="${labelWidth}" x2="${labelWidth}" y1="0" y2="${y}" stroke="var(--axis)"/>${body}${depLines}${todayLine}</svg></div>`;
  }

  /** Load heat-map: sections × dates with utilisation %. loads: [{section_id, ldate, utilisation_pct}] */
  function heat(sections, loads, from, days = 21) {
    const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
    const map = {}; loads.forEach((l) => (map[`${l.section_id}|${l.ldate}`] = +l.utilisation_pct));
    const cls = (v) => (v == null ? '' : v > 100.5 ? 'over' : v >= 80 ? 'l3' : v >= 40 ? 'l2' : v > 0 ? 'l1' : '');
    const head = `<div class="cell" style="background:none"></div>${dates.map((d) => `<div class="cell tiny" style="background:none" title="${d}">${d.slice(8)}</div>`).join('')}`;
    const rows = sections.map((s) => `<div class="cell small" style="background:none;justify-content:start;overflow:hidden;white-space:nowrap" title="${esc(s.name)}">${esc(s.name.slice(0, 26))}</div>${dates.map((d) => { const v = map[`${s.id}|${d}`]; return `<div class="cell ${cls(v)}" title="${esc(s.name)} ${d}: ${v == null ? 'no load' : v + '%'}">${v == null ? '' : Math.round(v)}</div>`; }).join('')}`).join('');
    return `<div class="heat" style="grid-template-columns: 170px repeat(${days}, minmax(26px, 1fr))">${head}${rows}</div><div class="legend"><span><span class="sw" style="background:var(--surface-2)"></span>idle</span><span><span class="sw l1" style="background:color-mix(in srgb, var(--accent) 25%, var(--surface-2))"></span>&lt;40%</span><span><span class="sw" style="background:color-mix(in srgb, var(--accent) 50%, var(--surface-2))"></span>40–80%</span><span><span class="sw" style="background:color-mix(in srgb, var(--accent) 80%, var(--surface-2))"></span>80–100%</span><span><span class="sw" style="background:var(--bad)"></span>over capacity</span></div>`;
  }
  function addDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  root.Charts = { groupedBars, hbars, gantt, heat, COLORS };
})(window);
