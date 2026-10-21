/*
 * classes.js — resolves which productivity row applies to a (work centre, component, product) and
 * which cutting class a canopy belongs to. Everything is driven by the model_classes table and the
 * type codes of the productivity sheets, so planners can correct a mapping without code changes.
 */
'use strict';

const CLASS_TOKEN = /^(s[1-4]|400srs|400-series|lst|lister|ckd|\d{2,4}(?:-\d{2,4})?)$/;

function tokens(code) {
  return String(code || '').toLowerCase().replace(/&/g, '').split(/[^a-z0-9.]+/).filter(Boolean);
}

/* Parse the kVA band encoded in a productivity Type code, e.g. "SF-C&B-BT-S2", "P50-88", "spgP13.5",
 * "SFP-BTP200/P250", "CMCPNL-P150/165-DCP", "BASE-220/275", "Lister With Base". */
function bandFromTypeCode(typeCode, classesForFamily) {
  const raw = String(typeCode || '');
  const low = raw.toLowerCase();
  const toks = tokens(raw);
  // explicit class aliases first (S1..S4, 400SRS, LST, 1300SRS …)
  for (const cls of classesForFamily) {
    for (const a of cls.aliases) {
      const al = a.toLowerCase();
      if (toks.includes(al) || (al.includes('/') && low.includes(al)) || (al.includes('-') && low.includes(al))) return { min: cls.kva_min, max: cls.kva_max, code: cls.code, via: 'alias' };
    }
  }
  // P-number patterns: p13.5, p50-88, p200/p250, p150/165, 220/275, 220/800
  let m = /p(\d+(?:\.\d+)?)\s*(?:[-/]\s*p?(\d+(?:\.\d+)?))?/i.exec(low);
  if (!m) m = /(?:^|[^0-9])(\d{2,4})\s*[-/]\s*(\d{2,4})(?:$|[^0-9])/.exec(low);
  if (m) {
    const a = Number(m[1]); const b = m[2] != null ? Number(m[2]) : a;
    return { min: Math.min(a, b), max: Math.max(a, b), code: raw, via: 'pnum' };
  }
  m = /(?:spf|ey|em)(\d{2,4})/i.exec(low);
  if (m) return { min: Number(m[1]), max: Number(m[1]), code: raw, via: 'pnum' };
  return null;
}

class ClassResolver {
  constructor({ modelClasses, productivity, workCentres, cuttingSummary }) {
    this.classes = new Map();
    for (const c of modelClasses) {
      const fam = c.family;
      if (!this.classes.has(fam)) this.classes.set(fam, []);
      this.classes.get(fam).push({ ...c, aliases: typeof c.aliases === 'string' ? JSON.parse(c.aliases) : (c.aliases || []) });
    }
    this.wc = new Map(workCentres.map((w) => [w.code, w]));
    this.rows = new Map();
    for (const r of productivity) {
      if (r.active === 0) continue;
      const wc = this.wc.get(r.work_centre_code || r.workCentre);
      const fam = wc?.classify || 'GENSET';
      const band = bandFromTypeCode(r.type_code || r.typeCode, this.classes.get(fam) || []);
      const row = { ...r, workCentre: wc?.code, band, toks: tokens(r.type_code || r.typeCode), rate: (r.override_rate != null && r.override_rate > 0) ? r.override_rate : (r.rate_per_day ?? r.ratePerDay ?? 0) };
      if (!this.rows.has(row.workCentre)) this.rows.set(row.workCentre, []);
      this.rows.get(row.workCentre).push(row);
    }
    this.cutting = new Map();
    for (const c of cuttingSummary || []) {
      const k = String(c.class_code || c.classCode).toUpperCase();
      if (!this.cutting.has(k)) this.cutting.set(k, { classCode: k, minutes: {}, recorded: c.qty_per_shift_recorded ?? c.qtyPerShiftRecorded, perShiftCalc: {} });
      const e = this.cutting.get(k);
      if (c.machine) { e.minutes[c.machine] = c.minutes_per_canopy; e.perShiftCalc[c.machine] = c.per_shift_calc; } else if (c.minutes) { Object.assign(e.minutes, c.minutes); Object.assign(e.perShiftCalc, c.perShiftCalc); }
    }
  }

  /** Resolve the model class code of a family for a component/product. */
  resolveClass(family, { code, pnum }) {
    const list = this.classes.get(family) || [];
    const toks = tokens(code);
    for (const c of list) for (const a of c.aliases) if (toks.includes(a.toLowerCase())) return { code: c.code, via: 'alias' };
    if (pnum != null) {
      const hit = list.find((c) => pnum >= c.kva_min && pnum <= c.kva_max && !(c.kva_min === 0 && c.kva_max === 0));
      if (hit) return { code: hit.code, via: 'band' };
      // nearest band
      let best = null; let bd = Infinity;
      for (const c of list) { if (c.kva_min === 0 && c.kva_max === 0) continue; const d = pnum < c.kva_min ? c.kva_min - pnum : pnum - c.kva_max; if (d < bd) { bd = d; best = c; } }
      if (best) return { code: best.code, via: 'nearest' };
    }
    return null;
  }

  /** Pick the productivity row for a work centre given the component code and product P-number. */
  findRate(wcCode, { code, pnum }) {
    const rows = this.rows.get(wcCode) || [];
    if (!rows.length) return { rate: 0, source: 'none', row: null };
    const toks = tokens(code).filter((t) => CLASS_TOKEN.test(t));
    // 1) alias token in component code (e.g. "S3" in SF-SPF-S3-OPT)
    for (const r of rows) {
      if (!r.band || r.band.via !== 'alias') continue;
      const cls = (this.classes.get(this.wc.get(wcCode)?.classify) || []).find((c) => c.code === r.band.code);
      if (cls && cls.aliases.some((a) => toks.includes(a.toLowerCase()))) return { rate: r.rate, source: 'master:alias', row: r };
    }
    if (pnum != null) {
      const inBand = rows.filter((r) => r.band && pnum >= r.band.min && pnum <= r.band.max && !(r.band.min === 0 && r.band.max === 0));
      if (inBand.length) { const r = inBand.find((x) => x.rate > 0) || inBand[0]; return { rate: r.rate, source: 'master:band', row: r }; }
      let best = null; let bd = Infinity;
      for (const r of rows) { if (!r.band || (r.band.min === 0 && r.band.max === 0)) continue; const d = pnum < r.band.min ? r.band.min - pnum : pnum - r.band.max; if (d < bd || (d === bd && r.rate > 0 && !(best?.rate > 0))) { bd = d; best = r; } }
      if (best) return { rate: best.rate, source: 'master:nearest', row: best };
    }
    const single = rows.length === 1 ? rows[0] : null;
    if (single) return { rate: single.rate, source: 'master:single', row: single };
    return { rate: 0, source: 'none', row: null };
  }

  /** Cutting-machine minutes per canopy for the class of this component/product. */
  cuttingMinutes({ code, pnum }) {
    const cls = this.resolveClass('CUTCLASS', { code, pnum });
    if (!cls) return null;
    const e = this.cutting.get(cls.code.toUpperCase());
    if (!e) return null;
    return { classCode: cls.code, via: cls.via, minutes: e.minutes, recordedPerShift: e.recorded, perShiftCalc: e.perShiftCalc };
  }
}

module.exports = { ClassResolver, bandFromTypeCode, tokens };
