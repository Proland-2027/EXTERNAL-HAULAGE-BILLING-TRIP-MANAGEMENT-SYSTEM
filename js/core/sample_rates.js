/* Illustrative agreed rates so the demo shows the lookup working. Marked as examples in Remarks; replace with contract rates. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.HB = root.HB || {}; root.HB.sampleRates = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return function sampleRates() {
    const mk = (client, from, to, vehicleType, price, eff, extra) => Object.assign({ id: 'rate-' + [client, from, to, vehicleType, eff].join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-'), client, loadingFrom: from, loadingTo: to, vehicleType, contractType: '', price, effectiveDate: eff, expiryDate: '', remarks: 'Illustrative demo rate — replace with the contract rate', version: 1, createdAt: '2026-10-12T00:00:00Z', createdBy: 'seed', updatedAt: '2026-10-12T00:00:00Z', updatedBy: 'seed' }, extra || {});
    return [
      mk('Jamara', 'GBAGADA', 'IBADAN', 'HAULAGE', 680000, '2026-01-01'),
      mk('Jamara', 'GBAGADA', 'PHC', 'HAULAGE', 2450000, '2026-01-01'),
      mk('Jamara', 'GBAGADA', 'ABUJA', 'HAULAGE', 2300000, '2026-01-01'),
      mk('Jamara', 'GBAGADA', 'KANO', 'HAULAGE', 3750000, '2026-01-01'),
      mk('Jamara', 'GBAGADA', 'VI', 'Closed Body Logistics', 400000, '2026-01-01'),
      mk('MEGA MANU', 'APAPA', 'KANO', 'HAULAGE', 3720930.23, '2026-01-01'),
      mk('MAMUDA BEVERAGES CO. LTD', 'OGBA', 'IKORODU ELEPE', 'Closed Body Logistics', 116279.07, '2024-01-01', { expiryDate: '2025-12-31' }),
      mk('MAMUDA BEVERAGES CO. LTD', 'OGBA', 'IKORODU ELEPE', 'Closed Body Logistics', 139534.88, '2026-01-01'),
      mk('ABBA ABASS', 'NASARAWA', 'OGERE', 'HAULAGE', 1500000, '2026-01-01', { contractType: 'ABBA' }),
      mk('NIGER BISCUITS', 'Lagos', 'Owerri', 'HAULAGE', 2150000, '2026-01-01'),
      mk('ORCA DECO LIMITED', 'BERGER', 'VI', 'Closed Body Logistics', 400000, '2026-01-01'),
      mk('Lacasera', 'MILE-2', 'BENIN', 'HAULAGE', 900000, '2026-01-01'),
      mk('NATURAL BEAUTY', 'ISOLO', 'KANO', 'HAULAGE', 3255813.95, '2025-01-01'),
    ];
  };
});
