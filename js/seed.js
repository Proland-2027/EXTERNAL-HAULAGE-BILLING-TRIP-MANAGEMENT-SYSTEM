/*
 * seed.js — Demo dataset so the system is usable the moment it is opened.
 * Routes, contractors, the internal "Billing Price List 2026", a contractor price list,
 * and August + September 2026 trips for both the in-house fleet and the contractors.
 * Replace everything here through the UI (Setup / Price Lists / Trips) or via Data → Import.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pricing.js'));
  else root.Seed = factory(root.Pricing);
})(typeof self !== 'undefined' ? self : this, function (Pricing) {
  'use strict';

  function build() {
    const settings = {
      company: 'Proland Haulage Operations',
      companyAddress: 'Tema Industrial Area, Greater Accra, Ghana',
      currency: 'GHS',
      vatRate: 15,
      levyRate: 6,       // NHIL 2.5% + GETFund 2.5% + COVID 1% — edit in Setup
      taxInternal: false, // internal (in-house) billing is a cost recharge: no VAT/levies
      defaultDieselPricePerLitre: 14.9,
      vehicleClasses: ['Rigid 10T', 'Articulated 30T', 'Tanker 36,000L'],
      units: ['TONNE', 'LITRE', 'PALLET', 'CBM', 'TRIP'],
      products: ['Cement', 'Lubricants', 'Fuel', 'General Cargo'],
    };

    const routes = [
      { id: 'R-TEM-ACC', code: 'TEM-ACC', origin: 'Tema', destination: 'Accra', distanceKm: 30 },
      { id: 'R-TEM-TAK', code: 'TEM-TAK', origin: 'Tema', destination: 'Takoradi', distanceKm: 230 },
      { id: 'R-TEM-KUM', code: 'TEM-KUM', origin: 'Tema', destination: 'Kumasi', distanceKm: 250 },
      { id: 'R-TEM-SUN', code: 'TEM-SUN', origin: 'Tema', destination: 'Sunyani', distanceKm: 400 },
      { id: 'R-TEM-TAM', code: 'TEM-TAM', origin: 'Tema', destination: 'Tamale', distanceKm: 620 },
    ];

    const contractors = [
      { id: 'C-KHL', code: 'KHL', name: 'Kwame Haulage Ltd', contact: 'accounts@kwamehaulage.example', phone: '+233 24 000 0001', paymentTermsDays: 30 },
      { id: 'C-NST', code: 'NST', name: 'Northern Star Transport', contact: 'billing@northernstar.example', phone: '+233 20 000 0002', paymentTermsDays: 45 },
    ];

    // Internal cost model per route (per trip, Articulated 30T): fixed, variable/km, fixed-variable, standard diesel litres.
    const internalLines = [
      ['R-TEM-ACC', 30, 850, 3.2, 180, 18],
      ['R-TEM-TAK', 30, 1450, 3.2, 420, 115],
      ['R-TEM-KUM', 30, 1500, 3.2, 450, 125],
      ['R-TEM-SUN', 30, 1900, 3.2, 600, 200],
      ['R-TEM-TAM', 30, 2600, 3.2, 850, 310],
    ].map(([routeId, moq, fixedCost, variableCostPerKm, fixedVariableCost, dieselLitres], i) => ({
      id: `PL-INT-2026-L${i + 1}`, routeId, vehicleClass: 'Articulated 30T', unit: 'TONNE', moq,
      fixedCost, variableCostPerKm, fixedVariableCost, dieselLitres,
    }));
    // A rigid-truck line to show vehicle-class specific tariffs.
    internalLines.push({ id: 'PL-INT-2026-L6', routeId: 'R-TEM-KUM', vehicleClass: 'Rigid 10T', unit: 'TONNE', moq: 10, fixedCost: 900, variableCostPerKm: 2.1, fixedVariableCost: 300, dieselLitres: 70 });

    const contractorRates = {
      'C-KHL': [['R-TEM-ACC', 30, 48], ['R-TEM-TAK', 30, 165], ['R-TEM-KUM', 30, 170], ['R-TEM-SUN', 30, 235], ['R-TEM-TAM', 30, 330]],
      'C-NST': [['R-TEM-KUM', 28, 162], ['R-TEM-SUN', 28, 228], ['R-TEM-TAM', 28, 318]],
    };

    const customers = [
      { id: 'K-GHACEM', code: 'GHACEM', name: 'Ghacem Cement Distribution', contact: 'logistics@ghacem.example' },
      { id: 'K-TOTAL', code: 'TOTAL', name: 'TotalEnergies Lubricants Ghana', contact: 'supply@totalenergies.example' },
      { id: 'K-MELCOM', code: 'MELCOM', name: 'Melcom Retail Stores', contact: 'dc@melcom.example' },
    ];
    // Client rate cards: the agreed selling price per customer, keyed by route + equipment class, with validity dates.
    const clientRateCards = [
      { id: 'CR-GHACEM-2026', customerId: 'K-GHACEM', name: 'Ghacem haulage agreement 2026', currency: 'GHS', validFrom: '2026-01-01', validTo: '2026-12-31', status: 'ACTIVE', notes: 'Per tonne delivered, MOQ 30 t per articulated load',
        lines: [['R-TEM-ACC', 'ANY', 30, 62], ['R-TEM-TAK', 'ANY', 30, 205], ['R-TEM-KUM', 'ANY', 30, 215], ['R-TEM-SUN', 'ANY', 30, 290], ['R-TEM-TAM', 'ANY', 30, 395], ['R-TEM-KUM', 'Rigid 10T', 10, 240]].map(([routeId, vehicleClass, moq, ratePerUnit], i) => ({ id: `CR-GHACEM-L${i + 1}`, routeId, vehicleClass, unit: 'TONNE', moq, ratePerUnit })) },
      { id: 'CR-TOTAL-2025', customerId: 'K-TOTAL', name: 'TotalEnergies rate card 2025 (expired)', currency: 'GHS', validFrom: '2025-01-01', validTo: '2025-12-31', status: 'ACTIVE', notes: 'Renewal pending — rates expired 31 Dec 2025',
        lines: [['R-TEM-KUM', 'ANY', 28, 198], ['R-TEM-TAM', 'ANY', 28, 372], ['R-TEM-ACC', 'Rigid 10T', 9, 80]].map(([routeId, vehicleClass, moq, ratePerUnit], i) => ({ id: `CR-TOTAL-L${i + 1}`, routeId, vehicleClass, unit: 'TONNE', moq, ratePerUnit })) },
      { id: 'CR-MELCOM-2026', customerId: 'K-MELCOM', name: 'Melcom distribution tariff 2026', currency: 'GHS', validFrom: '2026-01-01', validTo: '2026-12-31', status: 'ACTIVE', notes: 'Flat rate per trip for the Accra shuttle; per tonne elsewhere',
        lines: [['R-TEM-ACC', 'ANY', 0, 2100, 'TRIP'], ['R-TEM-TAK', 'ANY', 30, 210, 'TONNE'], ['R-TEM-SUN', 'ANY', 30, 295, 'TONNE']].map(([routeId, vehicleClass, moq, ratePerUnit, unit], i) => ({ id: `CR-MELCOM-L${i + 1}`, routeId, vehicleClass, unit, moq, ratePerUnit })) },
    ];

    const priceLists = [
      {
        id: 'PL-INT-2026', name: 'Billing Price List 2026 (Internal)', partyId: Pricing.INTERNAL,
        currency: 'GHS', validFrom: '2026-01-01', validTo: '2026-12-31', status: 'ACTIVE',
        dieselPricePerLitre: 14.9,
        notes: 'In-house fleet cost recharge. Fixed = wages/insurance/depreciation per trip; Variable = tyres, lubricants & wear per km; Fixed-variable = tolls, maintenance & allowances per trip; Diesel = litres × pump price.',
        lines: internalLines,
      },
      ...contractors.map((c) => ({
        id: `PL-${c.code}-2026`, name: `${c.name} — Haulage Tariff 2026`, partyId: c.id,
        currency: 'GHS', validFrom: '2026-01-01', validTo: '2026-12-31', status: 'ACTIVE',
        notes: 'Contract rates per tonne delivered, subject to the agreed Minimum Order Quantity per trip.',
        lines: contractorRates[c.id].map(([routeId, moq, rate], i) => ({
          id: `PL-${c.code}-2026-L${i + 1}`, routeId, vehicleClass: 'ANY', unit: 'TONNE', moq, ratePerUnit: rate,
        })),
      })),
    ];
    // Vehicle-class specific rate for the Accra shuttle with Northern Star (rigid trucks, lower MOQ).
    priceLists[2].lines.push({ id: 'PL-NST-2026-L4', routeId: 'R-TEM-ACC', vehicleClass: 'Rigid 10T', unit: 'TONNE', moq: 9, ratePerUnit: 65 });

    // Deterministic pseudo-random trips for Aug & Sep 2026.
    let s = 20260901;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const pickFrom = (arr) => arr[Math.floor(rnd() * arr.length)];
    const trips = [];
    let n = 0;
    const internalVehicles = ['GT 4521-24', 'GT 7788-25', 'GR 1120-23', 'GT 9031-26'];
    const internalDrivers = ['K. Mensah', 'Y. Abdulai', 'E. Owusu', 'S. Boateng'];
    const contractorVehicles = { 'C-KHL': ['AS 3301-22', 'AS 4410-23', 'GN 2210-24'], 'C-NST': ['NR 1150-23', 'NR 1177-24'] };
    const products = ['Cement', 'Lubricants', 'General Cargo'];

    function addTrip(partyId, date, routeId, opts = {}) {
      n += 1;
      const route = routes.find((r) => r.id === routeId);
      const isInternal = partyId === Pricing.INTERNAL;
      const vehicleClass = opts.vehicleClass || 'Articulated 30T';
      const nominal = vehicleClass === 'Rigid 10T' ? 10 : 30;
      const qty = opts.qty != null ? opts.qty : Math.round((nominal - rnd() * 4.5) * 10) / 10; // sometimes under MOQ
      const line = priceLists[0].lines.find((l) => l.routeId === routeId && l.vehicleClass === vehicleClass) || priceLists[0].lines.find((l) => l.routeId === routeId);
      const dieselLitres = isInternal ? Math.round(line.dieselLitres * (0.93 + rnd() * 0.16)) : undefined;
      // customer + manual selling price (the agreed price is looked up from the client rate card for comparison)
      const customerId = opts.customerId || (routeId === 'R-TEM-ACC' ? (rnd() < 0.5 ? 'K-MELCOM' : 'K-GHACEM') : routeId === 'R-TEM-TAM' || (routeId === 'R-TEM-KUM' && rnd() < 0.3) ? 'K-TOTAL' : 'K-GHACEM');
      const agreed = Pricing.compareSellingPrice({ customerId, routeId, vehicleClass, qty, date }, clientRateCards).agreedPrice;
      let sellingPrice;
      if (agreed != null) { const f = rnd(); sellingPrice = Math.round(agreed * (f < 0.15 ? 0.93 : f < 0.3 ? 1.04 : 1)); } // 15% of trips priced under the agreement
      else sellingPrice = Math.round(qty * (routeId === 'R-TEM-ACC' ? 70 : routeId === 'R-TEM-TAM' ? 380 : 200));
      trips.push({
        id: `T-${String(n).padStart(4, '0')}`,
        customerId,
        sellingPrice,
        sellingPriceBy: 'sales',
        sellingPriceAt: `${date}T09:00:00.000Z`,
        date,
        waybill: `WB-${date.slice(2, 4)}${date.slice(5, 7)}-${String(n).padStart(4, '0')}`,
        partyId,
        vehicleNo: isInternal ? pickFrom(internalVehicles) : pickFrom(contractorVehicles[partyId]),
        vehicleClass,
        driver: isInternal ? pickFrom(internalDrivers) : '',
        routeId,
        product: opts.product || pickFrom(products),
        qty,
        unit: 'TONNE',
        distanceKm: route.distanceKm,
        dieselLitres,
        status: 'COMPLETED',
        billingId: null,
        remarks: '',
      });
    }

    const plan = [
      // [month, partyId, routeId, count]
      ['2026-08', Pricing.INTERNAL, 'R-TEM-KUM', 9], ['2026-08', Pricing.INTERNAL, 'R-TEM-TAK', 5], ['2026-08', Pricing.INTERNAL, 'R-TEM-TAM', 3], ['2026-08', Pricing.INTERNAL, 'R-TEM-ACC', 6],
      ['2026-08', 'C-KHL', 'R-TEM-KUM', 7], ['2026-08', 'C-KHL', 'R-TEM-TAK', 4], ['2026-08', 'C-KHL', 'R-TEM-SUN', 3], ['2026-08', 'C-NST', 'R-TEM-TAM', 4],
      ['2026-09', Pricing.INTERNAL, 'R-TEM-KUM', 11], ['2026-09', Pricing.INTERNAL, 'R-TEM-TAK', 6], ['2026-09', Pricing.INTERNAL, 'R-TEM-TAM', 4], ['2026-09', Pricing.INTERNAL, 'R-TEM-ACC', 7], ['2026-09', Pricing.INTERNAL, 'R-TEM-SUN', 2],
      ['2026-09', 'C-KHL', 'R-TEM-KUM', 8], ['2026-09', 'C-KHL', 'R-TEM-TAK', 5], ['2026-09', 'C-KHL', 'R-TEM-SUN', 4], ['2026-09', 'C-NST', 'R-TEM-TAM', 5], ['2026-09', 'C-NST', 'R-TEM-KUM', 3],
    ];
    plan.forEach(([month, partyId, routeId, count]) => {
      for (let i = 0; i < count; i++) {
        const day = 1 + Math.floor(rnd() * 28);
        addTrip(partyId, `${month}-${String(day).padStart(2, '0')}`, routeId);
      }
    });
    // Vehicle-class specific examples.
    addTrip(Pricing.INTERNAL, '2026-09-12', 'R-TEM-KUM', { vehicleClass: 'Rigid 10T', qty: 8.5, product: 'Lubricants' });
    addTrip('C-NST', '2026-09-18', 'R-TEM-ACC', { vehicleClass: 'Rigid 10T', qty: 9, product: 'Lubricants' });
    // A current-month (October) trip so the "unbilled" view has something.
    addTrip(Pricing.INTERNAL, '2026-10-03', 'R-TEM-KUM');
    addTrip('C-KHL', '2026-10-05', 'R-TEM-TAK');
    trips.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    // Log August billings for everyone and September billings for Internal + Kwame Haulage,
    // leaving Northern Star's September open so the "generate billing" flow has work to do.
    const billings = [];
    const partyCode = (id) => (id === Pricing.INTERNAL ? 'INT' : contractors.find((c) => c.id === id).code);
    [['2026-08', Pricing.INTERNAL], ['2026-08', 'C-KHL'], ['2026-08', 'C-NST'], ['2026-09', Pricing.INTERNAL], ['2026-09', 'C-KHL']].forEach(([period, partyId]) => {
      const priceList = Pricing.pickPriceList(priceLists, partyId, period);
      const sel = Pricing.selectTrips(trips, partyId, period);
      const b = Pricing.buildBilling({ partyId, period, priceList, trips: sel, routes, settings, number: Pricing.nextBillingNumber(billings, partyCode(partyId), period) });
      b.id = `B-${b.number}`;
      b.createdAt = `${period}-30T09:00:00.000Z`;
      b.status = period === '2026-08' ? 'APPROVED' : 'DRAFT';
      b.preparedBy = 'Operations';
      sel.forEach((t) => (t.billingId = b.id));
      billings.push(b);
    });

    return { version: 2, settings, routes, contractors, customers, clientRateCards, priceLists, trips, billings };
  }

  return { build };
});
