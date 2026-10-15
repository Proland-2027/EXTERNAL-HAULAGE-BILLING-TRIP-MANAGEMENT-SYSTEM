#!/usr/bin/env node
/* Builds the Route Distance Master seed (data/workbook/distances.json): road distance from JMG Gbagada, Lagos to a
 * reference point in every state (the capital). When a routing service is reachable (OSRM) the road distance is
 * fetched; otherwise the reference road distances below are used. Every entry is flagged unverified: an administrator
 * approves the operational distance in Settings → Route Distance Master.
 *   node tools/build_distance_master.js            # reference table
 *   OSRM=https://router.project-osrm.org node tools/build_distance_master.js   # try the routing service first */
const fs = require('fs'); const path = require('path');
const G = require('../js/core/geo.js');
const OUT = path.join(__dirname, '..', 'data', 'workbook', 'distances.json');
// Reference one-way road distances (km) from Lagos (Gbagada) to the state capital; published road atlas figures, to be verified.
const REFERENCE = { Abia: 560, Adamawa: 1350, 'Akwa Ibom': 690, Anambra: 450, Bauchi: 1050, Bayelsa: 600, Benue: 780, Borno: 1550, 'Cross River': 790, Delta: 420, Ebonyi: 620, Edo: 320, Ekiti: 330, Enugu: 530, FCT: 760, Gombe: 1200, Imo: 540, Jigawa: 1100, Kaduna: 800, Kano: 990, Katsina: 1110, Kebbi: 980, Kogi: 560, Kwara: 300, Lagos: 25, Nasarawa: 830, Niger: 680, Ogun: 80, Ondo: 300, Osun: 230, Oyo: 130, Plateau: 1000, Rivers: 620, Sokoto: 1080, Taraba: 1250, Yobe: 1420, Zamfara: 1000 };
async function osrm(from, to) {
  const base = process.env.OSRM; if (!base) return null;
  try { const r = await fetch(`${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`, { signal: AbortSignal.timeout(15000) }); if (!r.ok) return null; const j = await r.json(); const m = j.routes && j.routes[0] && j.routes[0].distance; return m ? Math.round(m / 1000) : null; } catch (e) { return null; }
}
(async () => {
  const origin = G.DEFAULT_ORIGIN; const today = (process.env.IMPORT_DATE || new Date().toISOString().slice(0, 10));
  const rows = [];
  for (const s of G.STATES) {
    const routed = await osrm(origin, s); const one = routed || REFERENCE[s.state];
    rows.push({ id: G.key(origin.name).replace(/\s+/g, '-') + '__' + G.key(s.state).replace(/\s+/g, '-'), routeName: `${origin.state} (JMG Gbagada) → ${s.state}`, originStation: origin.name, originState: origin.state, destState: s.state, referenceLocation: s.state === 'Lagos' ? 'Lagos metropolis (within state)' : s.capital, oneWayKm: one, returnKm: one, totalKm: one * 2, airKm: G.haversineKm(origin, s), source: routed ? 'OSRM routing service' : 'reference road atlas (AI suggestion)', suggestedKm: one, verified: false, verifiedBy: '', verifiedAt: '', notes: routed ? 'Road distance from the routing service; verify before operational use.' : 'Reference distance pending verification by an administrator; recalculate with the routing service when available.', updatedAt: today + 'T00:00:00Z', updatedBy: 'distance-import', version: 1 });
  }
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  console.log(`${rows.length} distance entries → ${OUT} (${rows.filter((r) => /OSRM/.test(r.source)).length} routed, ${rows.filter((r) => !/OSRM/.test(r.source)).length} reference)`);
})();
