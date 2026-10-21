# External Haulage Billing & Trip Management System

A complete, zero-install billing system for haulage operations that run **both an in-house fleet and
external contractors**:

* **Trip log** — every load: date, waybill, haulier (internal or contractor), vehicle, route, product,
  quantity, km and (for the internal fleet) actual diesel litres.
* **Price lists with MOQ** — one tariff per party per year, e.g. *Billing Price List 2026 (Internal)*
  and one per contractor. Every line is keyed by route + vehicle class and carries a **Minimum Order
  Quantity**: loads under the MOQ are billed at the MOQ.
  * Contractor lines: rate per tonne / litre / pallet / CBM, or a flat rate per trip.
  * Internal lines: **Fixed cost**, **Variable cost per km**, **Fixed-variable cost** and standard
    **Diesel litres**, with the diesel price per litre on the price-list header.
* **Billing format** — one billing per party per month, generated from the unbilled trips and the
  active price list, with MOQ adjustments, cost-component breakdown, levies, VAT, totals and signature
  blocks. Printable, exportable to Excel/CSV, with a DRAFT → APPROVED → PAID → VOID lifecycle.
  See [docs/BILLING_FORMAT.md](docs/BILLING_FORMAT.md).
* **Monthly comparison report (In-house Analysis)** — for any month: internal vs contractor cost,
  cost per tonne by route, the in-house saving against contractor rates, the outsourcing premium,
  the internal fixed / variable / fixed-variable / diesel structure, MOQ top-ups paid, and
  month-over-month movement. Uses the logged billings when they exist and flags estimates when a
  billing has not been logged yet.

## Run it

No build, no server required: open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).

Optionally serve it (`npm start`, or `python3 -m http.server 8080`) and open <http://localhost:8080>.

Data lives in the browser's local storage. Use **Data → Export backup** regularly and to move the
dataset to another computer; **Import backup** restores it. **Reset to demo data** reloads the sample
dataset (Ghana routes from Tema, two contractors, August–October 2026 trips, logged August and
September billings).

Excel export uses SheetJS from a CDN; when offline the same data downloads as CSV files.

## Monthly workflow

1. **Trips** → log each completed trip (or import a backup produced elsewhere). Quantity below the
   price-list MOQ is fine; the billing applies the MOQ.
2. **Price Lists & MOQ** → make sure each party has an `ACTIVE` list covering the month. Edit rates,
   MOQ, cost components and the diesel price inline; *Duplicate for next year* creates next year's draft.
3. **Billing** → pick the party and month, *Preview*, check the MOQ flags and any “no tariff line”
   errors, then *Save & log billing*. Do this once for each contractor and once for the internal fleet.
4. **Comparison Report** → choose the month (and optionally a single contractor). Export to Excel or print.
5. Approve / mark paid billings as they move through finance. Void and regenerate if a trip was wrong.

## How amounts are calculated

| | Formula |
|---|---|
| Billable quantity | `max(actual qty, MOQ)` — `TRIP` lines are flat and ignore MOQ |
| Contractor amount | `billable qty × rate per unit` (or the flat trip rate) |
| Internal trip cost | `Fixed + Variable/km × km + Fixed-variable + Diesel litres × Diesel price` |
| Internal cost per unit | `trip cost ÷ billable qty` |
| Levies / VAT | `subtotal × levy %`, then `(subtotal + levies) × VAT %`; internal billing untaxed by default |
| In-house saving | internal trips re-priced at the contractor tariff − internal cost |
| Outsourcing premium | contractor billing − the same trips priced at the internal cost model |

Tariff line lookup: exact route + vehicle class first, then the route's `ANY` class line. Trips with no
matching line are flagged on the preview and block saving until the price list is fixed.

## Project layout

```
index.html          application shell
css/styles.css      light/dark theme, billing document, print stylesheet
js/pricing.js       billing engine (MOQ, pricing, billing totals, comparison report) — also runs in Node
js/seed.js          demo dataset
js/store.js         localStorage persistence, import/export
js/export.js        CSV / XLSX download
js/charts.js        inline SVG charts
js/app.js           UI
tests/              engine tests: `npm test` (Node 18+)
docs/               billing format and data model
```

## Assumptions made (adjust in Setup / Price Lists)

* Currency GHS, VAT 15 %, levies 6 %, internal billing not taxed.
* MOQ is per trip and expressed in the line's unit. A monthly volume commitment is not modelled.
* “Fixed-variable” is treated as a semi-variable cost **per trip** (tolls, maintenance, allowances).
  If you prefer it per km, enter it as part of *Variable / km* instead.
* Internal diesel uses actual litres when logged on the trip, otherwise the line's standard litres.
* Per-unit comparisons assume the same unit (e.g. tonnes) on a route for both parties; a flat `TRIP`
  line reports cost per trip in those columns.

---

# Production Planning (WordPress application)

The folder [`jmg-production-planning/`](jmg-production-planning/) contains a separate deliverable: a
WordPress plugin that provides a complete production planning and manufacturing control system for
Genset and Canopy manufacturing (sales demand → multi-level BOM explosion → finite-capacity
scheduling → plan confirmation → daily departmental tracking → dashboards, monthly reports, BOM
costing and Gantt), built from the workbook `Prodction Data.xlsx`. Version 1.1 adds the **inventory
process**: a stock ledger per item and warehouse (receipts, issues, returns, adjustments, transfers,
stock take), netting of plans against available stock, automatic receipt of completed components and
backflush of the materials they consumed, shortage / purchase list, valuation and a Store Keeper role.

* Plugin zip ready for upload: [`jmg-production-planning.zip`](jmg-production-planning.zip)
* Deployment (hosting requirements, Docker + HTTPS, test accounts): [`jmg-production-planning/docs/DEPLOYMENT.md`](jmg-production-planning/docs/DEPLOYMENT.md)
* User guide: [`jmg-production-planning/docs/USER_GUIDE.md`](jmg-production-planning/docs/USER_GUIDE.md)
* Workbook analysis, mapping and flagged gaps: [`jmg-production-planning/docs/DATA_MAPPING.md`](jmg-production-planning/docs/DATA_MAPPING.md)
* Acceptance-test scenario and results: [`jmg-production-planning/docs/ACCEPTANCE_TEST.md`](jmg-production-planning/docs/ACCEPTANCE_TEST.md)
