/*
 * Location standardisation: every loading / delivery location typed on a trip, request, route or truck is mapped to a
 * Nigerian state for reporting, route grouping, distance planning and fuel calculation. The original text is never
 * changed. Rules, in order: the approved Location Master → exact gazetteer match (state, capital, town, LGA, depot,
 * industrial area, abbreviation) → every part of a zone list ("VI-Lekki-AJAH") → fuzzy match (misspellings) which is
 * only a suggestion → ambiguous / unknown, which must be confirmed by an administrator.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.HB = root.HB || {}; root.HB.geo = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** 36 states + FCT with capital, reporting reference point (JMG default origin for Lagos) and approximate coordinates. */
  const STATES = [
    ['Abia', 'Umuahia', 5.525, 7.494], ['Adamawa', 'Yola', 9.203, 12.495], ['Akwa Ibom', 'Uyo', 5.038, 7.909], ['Anambra', 'Awka', 6.212, 7.072], ['Bauchi', 'Bauchi', 10.314, 9.846], ['Bayelsa', 'Yenagoa', 4.926, 6.264],
    ['Benue', 'Makurdi', 7.733, 8.521], ['Borno', 'Maiduguri', 11.846, 13.160], ['Cross River', 'Calabar', 4.958, 8.327], ['Delta', 'Asaba', 6.198, 6.733], ['Ebonyi', 'Abakaliki', 6.325, 8.113], ['Edo', 'Benin City', 6.335, 5.627],
    ['Ekiti', 'Ado-Ekiti', 7.623, 5.221], ['Enugu', 'Enugu', 6.459, 7.549], ['FCT', 'Abuja', 9.058, 7.490], ['Gombe', 'Gombe', 10.290, 11.167], ['Imo', 'Owerri', 5.485, 7.035], ['Jigawa', 'Dutse', 11.756, 9.339],
    ['Kaduna', 'Kaduna', 10.526, 7.438], ['Kano', 'Kano', 12.000, 8.517], ['Katsina', 'Katsina', 12.985, 7.617], ['Kebbi', 'Birnin Kebbi', 12.454, 4.197], ['Kogi', 'Lokoja', 7.802, 6.743], ['Kwara', 'Ilorin', 8.497, 4.542],
    ['Lagos', 'Ikeja', 6.554, 3.389], ['Nasarawa', 'Lafia', 8.493, 8.517], ['Niger', 'Minna', 9.614, 6.556], ['Ogun', 'Abeokuta', 7.146, 3.361], ['Ondo', 'Akure', 7.251, 5.195], ['Osun', 'Osogbo', 7.771, 4.557],
    ['Oyo', 'Ibadan', 7.378, 3.947], ['Plateau', 'Jos', 9.897, 8.858], ['Rivers', 'Port Harcourt', 4.815, 7.050], ['Sokoto', 'Sokoto', 13.061, 5.240], ['Taraba', 'Jalingo', 8.893, 11.360], ['Yobe', 'Damaturu', 11.747, 11.966], ['Zamfara', 'Gusau', 12.163, 6.664],
  ].map(([state, capital, lat, lng]) => ({ state, capital, lat, lng }));
  const STATE_NAMES = STATES.map((s) => s.state);
  /** Operational origin used for the distance master. */
  const DEFAULT_ORIGIN = { name: 'JMG Gbagada, Lagos', state: 'Lagos', lat: 6.5536, lng: 3.3894 };

  /** Towns, areas, LGAs, depots and abbreviations → state. Keys are compared after normalisation (lower case, punctuation removed). */
  const TOWNS = {
    Lagos: ['Lagos', 'Lagos State', 'Lagos Island', 'Marina', 'Ikeja', 'Apapa', 'Apapa Boundary', 'Tin Can', 'Tincan', 'APMT', 'Medlog', 'PHG', 'Gbagada', 'GBD', 'Ikotun', 'Igando', 'Ijegun', 'Abaranje', 'Lekki', 'Ajah', 'Ikate', 'Ikate Lekki', 'Sangotedo', 'Awoyaya', 'Lakowe', 'Bogije', 'Ibeju', 'Magbon', 'Eleko', 'Epe', 'VI', 'Victoria Island', 'Ikoyi', 'Banana Island', 'Oniru', 'Osapa London', 'Kajola Ajah', 'Jakande', 'Festac', 'Mile 2', 'Mile2', 'Mile 12', 'Mile-12', 'Amuwo', 'Amuwo Odofin', 'Okota', 'Isolo', 'Oshodi', 'Mafoluku', 'Ajao Estate', 'Ilupeju', 'Matori', 'Mushin', 'Fadeyi', 'Surulere', 'Lawanson', 'Lawanson Market', 'Yaba', 'Iwaya', 'Ebute Metta', 'Ebutte Meta', 'Oyingbo', 'Ijora', 'Iganmu', 'Orile Iganmu', 'Ajegunle', 'Kirikiri', 'Kirkiri', 'Satellite Town', 'Trade Fair', 'Tradefair', 'Trade Fare', 'Atiku Market', 'Alaba', 'Alaba Intl', "Alaba Int'l", 'Alaba Suru', 'Ojo', 'Okoko', 'Okokomaiko', 'Igboelerin', 'Ajangbadi', 'Shibiri', 'Iba', 'Iyana Iba', 'Oko Afo', 'Badagry', 'Badagary', 'Agege', 'Ile Epo', 'Ilepo', 'Ile-Epo', 'Abule Egba', 'Dopemu', 'Agbado', 'Alagbado', 'Alakuko', 'Ijaiye', 'Ipaja', 'Iyana Ipaja', 'Ayobo', 'Ikola', 'Ipaja Command', 'Ipaja Church', 'Shasha', 'Egbe', 'Idimu', 'Isheri', 'Ejigbo', 'Iyana Ejigbo', 'Ijesha', 'Magodo', 'Ojota', 'Ketu', 'Ikosi', 'Ojodu', 'Berger', 'Omole', 'Ogba', 'Oregun', 'Oba Akran', 'Acme', 'Ikeja Acme', 'Ikorodu', 'Elepe', 'Gberigbe', 'Ibeshe', 'Ogijo', 'Bariga', 'Iyana Oworo', 'Ebute Ero', 'Oke Arin', 'Karame City', 'Karameh City', 'Kamameh City', 'Statelight', 'IKM', 'Shagari', 'Egigbo', 'Iju', 'Iju Ishaga', 'Ijushaga', 'Fatai Atere', 'NBL Lagos', 'Nbl Depot', 'Ipaja - Lagos'],
    Ogun: ['Ogun', 'Ogun State', 'Abeokuta', 'Kuto', 'Kobape', 'Sagamu', 'Shagamu', 'Ijebu Ode', 'Ijebu-Ode', 'Ijebu Osas', 'Ijebu', 'Ikenne', 'Iperu', 'Iperu Remo', 'Ogere', 'Mowe', 'Ibafo', 'Magboro', 'Akute', 'Ajuwon', 'Ota', 'Otta', 'Sango', 'Sango Ota', 'Sango Otta', 'Sangotta', 'Sango Ijoko', 'Ijoko', 'Oju Ore', 'Sango Toll Gate', 'Iyana Iyesi', 'Atan', 'Atan Ota', 'Agbara', 'Igbesa', 'Ifo', 'Itori', 'Idiroko', 'Imeko', 'Ilaro', 'Oja Odan', 'NBL Ota', 'Ota Brewery', 'Ijebu Ode Brewery', 'NBL Ijebu Ode', 'Agbara-Badagri'],
    Oyo: ['Oyo', 'Oyo State', 'Ibadan', 'Ibadan Depot', 'Ibadan Brewery Depot', 'NBL Ibadan', 'Nbl - Ibadan', 'Ibadan Sumal', 'Apata', 'Apata - Ibadan', 'Moniya', 'Iwo Road', 'Bashorun', 'Ogbomosho', 'Ogbomoso', 'Oyo Town', 'Iseyin', 'Saki', 'Kishi', 'Kisi', 'Igboora', 'Ibadan Toll Gate', 'Ibadan 45Tons'],
    Osun: ['Osun', 'Osun State', 'Osogbo', 'Oshogbo', 'Osogobo', 'Ilesa', 'Ilesha', 'Inbev Ilesa', 'Inbev-Ilesa', 'Ile Ife', 'Ile-Ife', 'Ife', 'Ejigbo (Osun)', 'Ifon Osun', 'Iwo', 'Ede', 'Ikire', 'Gbongan'],
    Ondo: ['Ondo', 'Ondo State', 'Akure', 'Ondo Town', 'Ore', 'Owo', 'Ikare', 'Ikare Akoko', 'Idanre', 'Ifon', 'Okitipupa', 'Ondo-Akure'],
    Ekiti: ['Ekiti', 'Ekiti State', 'Ado Ekiti', 'Ado-Ekiti', 'Ado - Ekiti', 'Ikere Ekiti', 'Ekite', 'Ijero', 'Ikole'],
    Kwara: ['Kwara', 'Kwara State', 'Ilorin', 'Illorin', 'Lorin', 'Ilorin Depot', 'Offa', 'Ijagbo', 'Ijagbo Offa', 'Omu Aran', 'Omu-Aran', 'Jebba', 'Kaiama', 'Kayama', 'Lafiaji', 'Lara', 'Patigi', 'Share', 'Chikanda'],
    Kogi: ['Kogi', 'Kogi State', 'Lokoja', 'Okene', 'Kabba', 'Ajaokuta', 'Idah', 'Ayangba', 'Anyigba', 'Ayingba', 'Koton Karfe', 'Okpella', 'Egbe Kogi'],
    Edo: ['Edo', 'Edo State', 'Benin', 'Benin City', 'Auchi', 'Uromi', 'Ekpoma', 'Irrua', 'Abudu', 'Okpella', 'Irrua - Edo'],
    Delta: ['Delta', 'Delta State', 'Asaba', 'Warri', 'Sapele', 'Agbor', 'Kwale', 'Ughelli', 'Abraka', 'Koko Delta'],
    Anambra: ['Anambra', 'Anambra State', 'Awka', 'Akwa', 'Onitsha', 'Nnewi', 'Nkpor', 'Umunze', 'Ihiala', 'Uli', 'Ekwulobia'],
    Imo: ['Imo', 'Imo State', 'Owerri', 'Orlu', 'Imo-Orlu', 'Okigwe', 'Okigwe Depot', 'Mbaise'],
    Abia: ['Abia', 'Abia State', 'Aba', 'Aba Brewery', 'Aba - Brewery', 'NBL Aba', 'Umuahia', 'Arochukwu'],
    Enugu: ['Enugu', 'Enugu State', 'Ama', 'Ama Brewery', 'Nsukka', 'Orba', 'Ninth Mile', '9th Mile'],
    Ebonyi: ['Ebonyi', 'Ebonyi State', 'Abakaliki', 'Abakalike', 'Afikpo', 'Afikpo Depot'],
    'Akwa Ibom': ['Akwa Ibom', 'Akwa-Ibom', 'Uyo', 'Eket', 'Ikot Ekpene', 'Oron', 'Abak'],
    'Cross River': ['Cross River', 'Cross River State', 'Calabar', 'Ikom', 'Obubra', 'Ogoja'],
    Rivers: ['Rivers', 'Rivers State', 'Port Harcourt', 'Port-Harcourt', 'PHC', 'PH', 'Bori', 'Onne', 'Eleme', 'Oyigbo'],
    Bayelsa: ['Bayelsa', 'Bayelsa State', 'Yenagoa', 'Yenogoa'],
    FCT: ['FCT', 'Abuja', 'Abujja', 'Federal Capital Territory', 'Gwagwalada', 'Kubwa', 'Kuje', 'Zuba', 'Abaji', 'Bwari'],
    Nasarawa: ['Nasarawa', 'Nassarawa', 'Nasarawa State', 'Lafia', 'Keffi', 'Akwanga', 'Mararaba', 'Maraba', 'Masaka', 'Karu', 'Nasarawa Eggon'],
    Niger: ['Niger', 'Niger State', 'Minna', 'Bida', 'Suleja', 'Kontagora', 'Kontangora', 'Kotangora', 'Kotongora', 'Mokwa', 'Tegina', 'Tigina', 'Trgina', 'Lapai', 'Agaie', 'Mokwa'],
    Benue: ['Benue', 'Benue State', 'Makurdi', 'Makurdi Depot', 'Gboko', 'Otukpo', 'Otukpa', 'Otukpa Depot', 'Katsina Ala', 'Kastina Ala', 'Adikpo', 'Vandeikya', 'Zaki Biam', 'Zakiblarn'],
    Plateau: ['Plateau', 'Plateau State', 'Jos', 'Bukuru', 'Shendam', 'Shandam', 'Mangu', 'Langtang', 'Lantang', 'Tudun Wada', 'Tundun Wada', 'Pankshin'],
    Kaduna: ['Kaduna', 'Kaduna State', 'Zaria', 'Kafanchan', 'Kanfanchan', 'Saminaka', 'Kudenda', 'Kudena', 'Kudenda Brewery', 'Chikun', 'Kachia', 'Makarfi'],
    Kano: ['Kano', 'Kano State', 'Kano City', 'Fagge', 'Sharada', 'Bompai', 'Dawanau', 'Wudil', 'Sabon Gari', 'Challawa', 'Gwarzo'],
    Katsina: ['Katsina', 'Kastina', 'Katsina State', 'Funtua', 'Daura', 'Malumfashi', 'Dutsin Ma'],
    Jigawa: ['Jigawa', 'Jigawa State', 'Dutse', 'Hadejia', 'Gumel', 'Gasgua', 'Kazaure'],
    Kebbi: ['Kebbi', 'Kebbi State', 'Birnin Kebbi', 'Yauri', 'Koko', 'Koko (Kebbi)', 'Argungu', 'Zuru', 'Jega', 'Lella'],
    Sokoto: ['Sokoto', 'Sokoto State', 'Wamakko', 'Tambuwal', 'Illela'],
    Zamfara: ['Zamfara', 'Zamfara State', 'Gusau', 'Talata Mafara', 'Kaura Namoda'],
    Bauchi: ['Bauchi', 'Bauchi State', 'Azare', 'Misau', 'Jamaare'],
    Gombe: ['Gombe', 'Gombe State', 'Kumo', 'Billiri'],
    Yobe: ['Yobe', 'Yobe State', 'Damaturu', 'Potiskum', 'Gashua', 'Nguru'],
    Borno: ['Borno', 'Borno State', 'Maiduguri', 'Maidugri', 'Maidugry', 'Biu', 'Biu (Borno)', 'Bama', 'Dembal'],
    Adamawa: ['Adamawa', 'Adamawa State', 'Yola', 'Yola Depot', 'Mubi', 'Madagali', 'Ganye', 'Numan', 'Jimeta'],
    Taraba: ['Taraba', 'Taraba State', 'Jalingo', 'Wukari', 'Takum', 'Mutum Biyu', 'Mutu Biyu', 'Bali', 'Gembu'],
  };
  /** Names that match more than one place: never resolved automatically. */
  const AMBIGUOUS = { 'ejigbo': ['Lagos', 'Osun'], 'egbe': ['Lagos', 'Kogi'], 'koko': ['Kebbi', 'Delta'], 'ifon': ['Ondo', 'Osun'], 'okpella': ['Edo', 'Kogi'] };

  const key = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[‎‏‪-‮ ]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const STATE_BY_KEY = new Map(STATE_NAMES.map((s) => [key(s), s]));
  const INDEX = new Map();
  for (const [state, names] of Object.entries(TOWNS)) for (const n of names) { const k = key(n); if (!k) continue; if (AMBIGUOUS[k]) continue; if (!INDEX.has(k)) INDEX.set(k, state); }
  for (const s of STATES) { INDEX.set(key(s.state), s.state); if (!INDEX.has(key(s.capital))) INDEX.set(key(s.capital), s.state); INDEX.set(key(s.state + ' state'), s.state); }
  const NOISE = ['depot', 'brewery', 'market', 'toll gate', 'town', 'city', 'warehouse', 'factory', 'plant', 'yard', 'terminal', 'port', 'nbl', 'state', 'tons', 'ton', '45tons', '30tons', 'local'];
  const stripNoise = (k) => { let out = ' ' + k + ' '; for (const n of NOISE) out = out.replace(new RegExp(' ' + n + ' ', 'g'), ' '); return out.replace(/\s+/g, ' ').trim(); };
  /** Levenshtein distance (small strings). */
  function lev(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let prev = Array.from({ length: n + 1 }, (_, i) => i); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
  const SPLIT = /\s*(?:--|[\/,;&+|]|\(|\)|\bor\b|\band\b| - )\s*|\s+-\s*|-(?=[A-Za-z]{3,})/i;
  function parts(name) { return String(name || '').split(SPLIT).map((p) => key(p)).filter(Boolean); }

  function lookupExact(k) {
    if (!k) return null;
    if (STATE_BY_KEY.has(k)) return STATE_BY_KEY.get(k);
    if (INDEX.has(k)) return INDEX.get(k);
    const s = stripNoise(k); if (s && INDEX.has(s)) return INDEX.get(s);
    // "ikorodu elepe", "ibadan depot", "ipaja lagos": every word that is a known place must agree
    const words = s.split(' ').filter((w) => w.length > 2); const found = [...new Set(words.map((w) => INDEX.get(w)).filter(Boolean))];
    if (found.length === 1) return found[0];
    // two-word combinations ("sango ota", "ile ife")
    for (let i = 0; i + 1 < words.length; i++) { const two = INDEX.get(words[i] + ' ' + words[i + 1]); if (two) return two; }
    return null;
  }
  function fuzzy(k) {
    const s = stripNoise(k); if (s.length < 4) return [];
    const out = [];
    for (const [name, state] of INDEX) { if (Math.abs(name.length - s.length) > 2) continue; const d = lev(s, name); const tol = s.length >= 8 ? 2 : 1; if (d <= tol) out.push({ name, state, distance: d }); }
    out.sort((a, b) => a.distance - b.distance || a.name.length - b.name.length);
    const states = [...new Set(out.map((o) => o.state))];
    return states.map((st) => out.find((o) => o.state === st));
  }
  /**
   * Standardise one location. master = { [key]: { state, status: 'approved'|'suggested'|'rejected', ... } }.
   * Returns { state, confidence: 'approved'|'exact'|'likely'|'ambiguous'|'unknown', candidates: [state…], via }.
   */
  function standardize(name, master) {
    const raw = String(name || '').trim(); const k = key(raw);
    if (!k) return { state: '', confidence: 'unknown', candidates: [], via: '' };
    const m = master && (master[k] || master[raw] || master[String(raw).toLowerCase()]);
    if (m && m.status === 'approved' && m.state) return { state: m.state, confidence: 'approved', candidates: [m.state], via: 'Location Master' };
    if (AMBIGUOUS[k]) return { state: '', confidence: 'ambiguous', candidates: AMBIGUOUS[k], via: 'gazetteer (ambiguous name)' };
    const exact = lookupExact(k); if (exact) return { state: exact, confidence: 'exact', candidates: [exact], via: 'gazetteer' };
    // zone lists / multi-part names: every part resolved and agreeing → that state; disagreeing → ambiguous
    const ps = parts(raw); if (ps.length > 1) {
      const found = [...new Set(ps.map((p) => (AMBIGUOUS[p] ? null : lookupExact(p))).filter(Boolean))];
      if (found.length === 1) return { state: found[0], confidence: 'exact', candidates: found, via: 'gazetteer (zone list)' };
      if (found.length > 1) return { state: '', confidence: 'ambiguous', candidates: found, via: 'zone list spans several states' };
    }
    const fz = fuzzy(k);
    if (fz.length === 1) return { state: fz[0].state, confidence: 'likely', candidates: [fz[0].state], via: `looks like "${fz[0].name}"` };
    if (fz.length > 1) return { state: '', confidence: 'ambiguous', candidates: fz.map((f) => f.state), via: 'several similar names' };
    if (m && m.state) return { state: m.state, confidence: m.status === 'approved' ? 'approved' : 'likely', candidates: [m.state], via: 'Location Master (' + m.status + ')' };
    return { state: '', confidence: 'unknown', candidates: [], via: '' };
  }
  /** Build / refresh the Location Master suggestions for a list of names. Keeps approved entries untouched. */
  function suggestMaster(names, master) {
    const out = Object.assign({}, master || {});
    for (const n of names) { const k = key(n); if (!k || (out[k] && out[k].status === 'approved')) continue; const r = standardize(n, null); out[k] = Object.assign({}, out[k] || {}, { name: String(n).trim(), state: r.state, candidates: r.candidates, confidence: r.confidence, via: r.via, status: out[k] && out[k].status === 'rejected' ? 'rejected' : (r.confidence === 'exact' ? 'approved' : 'suggested'), source: out[k] && out[k].source || (r.confidence === 'exact' ? 'gazetteer' : 'suggestion') }); }
    return out;
  }
  function stateInfo(state) { return STATES.find((s) => s.state === state) || null; }
  /** Great-circle distance in km (used only as a sanity check on routed distances, never as the operational distance). */
  function haversineKm(a, b) { const R = 6371; const toRad = (d) => (d * Math.PI) / 180; const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng); const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(x))); }

  return { STATES, STATE_NAMES, DEFAULT_ORIGIN, TOWNS, AMBIGUOUS, key, parts, standardize, suggestMaster, stateInfo, haversineKm, lev };
});
