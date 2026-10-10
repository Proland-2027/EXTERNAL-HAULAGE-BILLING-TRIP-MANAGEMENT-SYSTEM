# Data Model

Everything is one JSON document (see *Data → Export backup*). Field names below are the ones in the file.

## settings
`company`, `companyAddress`, `currency`, `vatRate`, `levyRate`, `taxInternal` (bool),
`defaultDieselPricePerLitre`, `vehicleClasses[]`, `units[]`, `products[]`.

## routes[]
`id`, `code`, `origin`, `destination`, `distanceKm`.

## contractors[]
`id`, `code` (used in billing numbers), `name`, `contact`, `phone`, `paymentTermsDays`.
The in-house fleet is the fixed party id `INTERNAL`.

## priceLists[]
`id`, `name`, `partyId` (`INTERNAL` or a contractor id), `currency`, `validFrom`, `validTo`,
`status` (`ACTIVE` | `DRAFT` | `ARCHIVED`), `dieselPricePerLitre` (internal lists), `notes`, `lines[]`.

### priceLists[].lines[]
| Field | Used by | Meaning |
|---|---|---|
| `routeId` | both | Route the line applies to |
| `vehicleClass` | both | A class from Setup, or `ANY`. An exact class match beats the `ANY` line |
| `unit` | both | `TONNE`, `LITRE`, `PALLET`, `CBM` or `TRIP` (flat rate) |
| `moq` | both | **Minimum Order Quantity** per trip in `unit`. Billable qty = max(actual, MOQ). Ignored for `TRIP` |
| `ratePerUnit` | contractor | Rate per unit (or per trip for `TRIP`) |
| `fixedCost` | internal | Fixed cost per trip |
| `variableCostPerKm` | internal | Variable cost per km |
| `fixedVariableCost` | internal | Fixed-variable (semi-variable) cost per trip |
| `dieselLitres` | internal | Standard diesel litres per trip (used when a trip has no actual litres) |

The price list for a billing is chosen automatically: the `ACTIVE` list for the party whose validity
covers the first day of the period, else the newest active list, else any list. It can be overridden
when generating a billing.

## trips[]
`id`, `date`, `waybill`, `partyId`, `vehicleNo`, `vehicleClass`, `driver`, `routeId`, `product`, `qty`,
`unit`, `distanceKm`, `dieselLitres` (optional, internal), `status` (`COMPLETED` | `CANCELLED`),
`billingId` (set once the trip is on a logged billing), `remarks`.

## billings[]
`id`, `number`, `partyId`, `period` (`YYYY-MM`), `priceListId`, `priceListName`, `currency`,
`status` (`DRAFT` | `APPROVED` | `PAID` | `VOID`), `createdAt`, `notes`, `lines[]`, `summary`.

`lines[]` are priced snapshots (`tripId`, `actualQty`, `moq`, `billableQty`, `moqApplied`, `moqTopUp`,
`rate`, `components {fixed, variable, fixedVariable, diesel}`, `dieselLitres`, `amount`, `costPerUnit`, …).

`summary` holds `trips`, `actualQty`, `billableQty`, `distanceKm`, `dieselLitres`, `moqTrips`, `moqTopUp`,
`moqTopUpValue`, `components`, `subtotal`, `levyRate`, `levyAmount`, `vatRate`, `vatAmount`, `total`,
`costPerUnit`, `costPerTrip`, `costPerKm`.

## Comparison report (computed, not stored)
`Pricing.buildMonthlyComparison()` returns the current and previous month side by side. For each
route it reports internal and contractor actuals (from logged billings when they exist, otherwise
estimated from the active price lists) plus two benchmarks:

* **internalAtContractorRate / inhouseSaving** — internal trips re-priced at the contractor tariff.
* **contractorAtInternalCost / outsourcingPremium** — contractor trips re-priced at the internal cost model.
