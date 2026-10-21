# Phase 1 — Workbook Analysis

Source: `data/workbook/Haulage_Billing_Sheet_September_R2_original.xlsx` (kept unmodified as the backup).
Analysed with openpyxl (formulas) and the workbook's own cached values (results).

## Worksheets

| Sheet | Role | Notes |
|---|---|---|
| **Trip Log** | Master operational table, 3,708 trips (rows 2–3709), columns A–AD plus free-text notes in AF | Frozen pane at row 3198, autofilter A1:AH8001 |
| **Settings** | VAT rate (7.5 %), payment terms (7 days), bank details (blank), next invoice sequence (1), month list Jan 2026–Dec 2028, Client Master List (56 clients, A58:A113) | Named ranges `ClientList`, `MonthList`, `MonthDates`, `MonthListAll` |
| **Asset List** | 60 vehicles: Plate → Asset Code, Type of Vehicle, Cost Center, Type (batch) | Lookup source for Trip Log columns D–G |
| **Invoice Generator** | Single-client invoice: pick client, Month From/To, invoice date, "Price includes VAT?" | Lists unpaid trips via helper columns AC/AD |
| **Invices** (hidden) | Older copy of the Invoice Generator | Same logic, fewer columns |
| **Client Summary** | Per client: trips, selling price, VAT, billing after VAT; optional month filter | Pulls client names from Settings |
| **Statement CLient** | Client Summary + Payment (Σ Amount Paid) + Balance Pending | Conditional format: balance > 0 highlighted |
| **Summary** | Pivot: Billing After VAT by Type of Vehicle × month | Pivot cache, no formulas |
| **Summary Sales by Vehicle** | Pivot: Billing After VAT by Type (batch) → Plate × month | Includes a monthly budget comparison on Sheet1 |
| **Sheet1** | Monthly billing per truck vs. "Monthly Budget" (₦10.5 m per New Batch truck) with period averages | Scratch analysis |
| **Sheet2 / Sheet3 / Sheet4 / Detail1** | Scratch extracts and pivot drill-downs (unpaid trips by client, etc.) | Not converted; covered by filters/reports |

## Trip Log columns and formulas

| Col | Header | Kind | Formula / rule |
|---|---|---|---|
| A | Date Dispatched | input | |
| B | Date Delivered | input | |
| C | Plate Number | input | |
| D | Asset Code | lookup | `XLOOKUP(C,'Asset List'!A:A,'Asset List'!B:B)` (typed on older rows) |
| E | Type of Vehicle | lookup | `XLOOKUP(D,'Asset List'!B:B,'Asset List'!C:C)` |
| F | Type | lookup | `XLOOKUP(C,'Asset List'!A:A,'Asset List'!E:E)` |
| G | Cost Center | lookup | `XLOOKUP(E,'Asset List'!C:C,'Asset List'!D:D)` |
| H | Contract Type | input | Mixed: numbers 3/30/35/40/45 (older rows) or a text code (e.g. `ABBA`, `JAMARA`) on newer rows |
| I | CLIENT NAME | input (list) | Validation list = `ClientList` |
| J / K | Loading From / Loading To | input | Free text, inconsistent casing (`Kano` vs `KANO`) |
| L | Journey Plan ID | input | `TRP-####` on new rows; some rows hold a 3rd-party haulier name |
| M | Client Waybill Number | input | Free text, may hold several waybills |
| N | Return Waybill Received? | input (list) | `Received,Not Received` |
| O | Invoice Status | input (list) | `Invoice Sent Awaiting Payment,Closed,Invoice Not Sent` |
| P | Selling Price (₦) | **input** | Manual, never computed |
| Q | VAT (₦) | formula | `=IF(P="","",ROUND(P*Settings!$B$6,2))` |
| R | Billing After VAT (₦) | formula | `=IF(P="","",P+Q)` |
| S / T | Quote Number / SO Number | input | |
| U | Manual Invoice Number | input | Pattern `<CLIENTCODE>-<seq>` e.g. `MAM-2491`, `ORC-2401`, `TLCP-1051A` |
| V | Invoice Number | input | Empty on every row (reserved for generated numbers) |
| W | Payment Status | input (list) | `Not Paid,Advance,Paid` (one range also allows `special Payment`, unused) |
| X | Advance (₦) | input | |
| Y | Amount Paid (₦) | formula | `=IF(I="","",IF(W="Paid",R,IF(W="Advance",IF(X="",0,X),0)))` |
| Z | Balance (₦) | formula | `=IF(I="","",R-Y)` |
| AA | Total (₦) | formula | `=IF(R="","",R)` |
| AB | Month (helper) | formula | `TEXT(A,"mmmm yyyy")` |
| AC | Eligible (helper) | formula | `IF(W="Paid",0,1)` — unpaid trips are invoice-eligible |
| AD | Match Rank (helper) | formula | Running `COUNTIFS` of eligible trips for the Invoice Generator's client and month range |
| AF | (no header) | input | Free-text payment notes (7 rows) |

Conditional formatting flags duplicate Journey Plan IDs (L) and duplicate waybills (M).

## Invoice Generator logic

* Inputs: client (C3), invoice date (C4), Price Includes VAT (C5), Month From (C6) and Month To (I6).
* `O3 = first day of Month From`, `P3 = EOMONTH(Month To)`.
* A trip is listed when `client = C3`, `O3 <= Date Dispatched <= P3` and `Payment Status <> "Paid"` (column AC = 1). Trips are ranked by AD and pulled with `INDEX`.
* Amount column shows R (incl. VAT) or P (excl. VAT) depending on C5; Total Due = Σ R.
* Invoice number = `"INV-" & TEXT(Settings!B15,"0000")` — a manual counter the user must increment.
* Due date = invoice date + payment terms.
* Bank details reference an external link (`[1]Settings`) that is broken in this copy.

## Reports

* **Client Summary / Statement**: COUNTIF/SUMIF over Trip Log by client (and month helper AB). Statement adds `Payment = Σ Y` (always all months — see ambiguities) and `Balance = E − F`.
* **Summary / Summary Sales by Vehicle**: pivots of Billing After VAT by vehicle type / plate × month.

## Validation against the workbook

Recomputing the formulas over all 3,708 rows reproduces the cached values exactly:

| Measure | Workbook cached total |
|---|---|
| Σ Selling Price | ₦4,926,148,230.46 |
| Σ Billing After VAT | ₦5,295,609,348.56 |
| Σ Amount Paid | ₦5,124,464,393.38 |
| Σ Balance | ₦171,144,955.18 |
| VAT mismatches (ROUND(P×7.5 %,2)) | 0 |

`tests/engine.test.js` re-asserts these totals from the imported data.

## Ambiguities and inconsistencies found

1. **Invoice Status values differ from the target rules.** The workbook uses `Invoice Sent Awaiting Payment`, `Closed`, `Invoice Not Sent` (and blank on 2,702 rows). The target system separates *Invoice Status* (`Invoice Not Sent`, `Invoice Sent`, `Internal Client`) from the *calculated Trip Status*. Mapping used on import: `Invoice Sent Awaiting Payment` → `Invoice Sent`; `Closed` → `Invoice Sent` (payment status already says Paid, which yields Trip Status *Closed*); blank → `Invoice Sent` when the trip is Paid/Advance (it has been billed), otherwise `Invoice Not Sent`. The raw value is kept in `invoiceStatusRaw`.
2. **Statement "Payment" ignores the month filter** (`SUMIFS(Y, I, client)` has no month criterion) while the other columns honour it. The web statement applies the month filter to payments as well; the all-months figure matches the workbook.
3. **Contract Type** mixes numbers (3, 30, 35, 40, 45 — most likely credit days / contract codes) and client codes. Kept as free text; the price list treats it as an optional matching key.
4. **Advance on Paid trips**: 12 Paid rows still carry an Advance amount; the formula ignores it (Amount Paid = full billing). Preserved as-is.
5. **Duplicate-looking rows**: 70 key collisions (same date, plate, client, waybill). They are retained because several trucks can carry one waybill set on one day; the importer flags them instead of dropping them.
6. **Inconsistent location spelling** (`Kano`/`KANO`, `MILE-2`/`Mile2`). The agreed-rate lookup normalises case and whitespace; a Locations list is maintained in Settings for dropdowns.
7. **Invoice Generator counter** cannot increment itself; the web app generates numbers per client code and trip date.
8. **Client list** holds trailing spaces / Unicode marks (e.g. `Jamara `, `SDS ENVIRON … \xa0`). Names are trimmed on import; the Settings list is the master.
9. **Broken external link** for bank details (`[1]Settings!$B$10`). Bank details are configured in Settings in the web app.
10. **Asset rows typed by hand** (rows 2–1984 have typed Asset Code / Type / Cost Center) — values agree with the Asset List, so the web app always derives them from the asset master.

---

# Phase 3 — Truck Planning Management workbook (`Truck_Planning_Managment_Rev1.xlsx`)

The planning workbook was analysed the same way as the billing sheet and its logic ported to `js/core/planning.js` (pure functions shared by the browser, the server and `tests/planning.test.js`). The original file is kept as `data/workbook/Truck_Planning_Management_Rev1_original.xlsx`; `tools/extract_workbook.py` produces `planning_extract.json` and `tools/build_planning_seed.js` turns it into the seed collections.

## Worksheets and how each one is used

| Sheet | Content | In the application |
|---|---|---|
| **Setup** | Diesel price, fallback turnaround (7 days), buffer added to every return (0), idle flag (3 days), default repositioning (3 days), same-place repositioning (0), runway start/window (92 days); status list with its availability **group**; body type → contract sizes it can run; size → tonnage table | Settings → *Fleet planning* (`meta/planning`): every number is editable; statuses, groups and phases are configurable; repositioning rules and body/contract table are editable text |
| **Routes** (524 rows) | Rate ID, contract name, truck size, division, tonnage, client, loading point, destination, state, region, KM, **Days**, **Offloading**, **Total days**, diesel, road expenses, contingency, approved price; derived `Days out = ROUNDUP(Days/2)`, `Days back = Days − out`, cost, margin, per truck-day | Route register (`routes`). `routeTiming()` reproduces out/offload/back/turnaround; `routeCost()` the cost and margin columns |
| **Repositioning** (197 rules) | From drop point → to loading bay = days | `repoDays(from, to)`; symmetric lookup, same place = 0, unknown pair = default |
| **Fleet (FMR)** (50 trucks) | Truck, body, tonnage, driver, home station, **Status**, date of status, route, date loaded, drop point, workshop release, days down; derived group, TAT/out/offload/back, **Back on ground**, **Committed until**, **Free to allocate from**, days until free, confidence, warning, delivery check, double booked | Fleet Movement Report (`fleet`). `truckStatus()` ports columns N..AA; the 12 assets not on the sheet are added with no status and show as *Unavailable or Status Unconfirmed* |
| **Requests** (28) | Request ID (client code + sequence), route, client, trucks, date, priority, status, notes | Client transport requests (`requests`); IDs follow the same `CODE-NNN` scheme (`nextRequestId`) |
| **Committed trips** (12) | Truck, request, route, client, load date, reaches client, back on ground, stage | Allocations (`allocations`), IDs `ALC-YYMMDD-NN`; dates from `allocationDates()` |
| **Allocation planner** | For one request: every truck ranked by *can load* date, reposition days, fits, booked, days late | `planForRequest()` with the same ranking (earliest loading, then wrong size, then booked) plus the warning notes |
| **Runway** | Day-by-day F/P/T/D grid per truck for the window, trucks coming free per day/week | `runway()`; Fleet Planning Dashboard (daily and weekly) |

## Rules carried over (and where they were tightened)

* **Back on ground per group/phase** — Free: today. Down: workshop release + buffer, else status date + days down (never before today). On trip: inbound = status date + days back; offloading = + (offload − 1) + back; at destination = + offload + back; loading/loaded/outbound = load date + out + offload + back. Explicit tracking estimates (estimated return, offload complete, delivery) override the formula.
* **Free to allocate from** = max(back on ground, committed until). *Committed until* is the latest back-on-ground of the truck's active allocations.
* **ETA passed is not "available"** (brief requirement; the workbook left it to the planner). When the estimated return is in the past and the tracking record has not been updated since, the truck is flagged *Past its estimated return and completion is unconfirmed* and falls in *Unavailable or Status Unconfirmed* until a tracking officer verifies it (one click: *Confirm back*).
* **Tracking Update Overdue** — no status update for more than the configured hours (48 by default).
* **Delivery check** — outbound longer than the one-way run: *Tracking officer to confirm delivery*.
* **Double booked** — two active allocations whose loading…back windows overlap; the planner refuses to allocate a truck over a window already promised (`bookingConflicts`, also enforced on the server).
* **Availability categories**: Available and Unplanned · Available but Already Allocated · Expected to Become Available (free within *returnSoonDays*) · Currently on Trip · In Workshop / Breakdown · Unavailable or Status Unconfirmed.
* **Trucks Still Required** = trucks requested − allocations that are not cancelled. Requested, allocated, deployed and outstanding are always shown separately. Request status derives from the allocations (New → Under Planning → Partially / Fully Allocated → In Progress → Completed); Cancelled is manual.

## Decisions and ambiguities

1. **Snapshot dates.** The FMR statuses were all dated 2026-10-02 while loading dates ran from 2026-09-24. For the demo the seed re-dates the whole snapshot to the import date (every operational date moved by the same offset, recorded in `meta/planning.dateShiftDays`), otherwise every truck would open as "tracking overdue". A production import keeps the dates as entered.
2. **Committed trips already in the past** are imported as *Completed*; three demo allocations were planned with the engine on the first open requests so the planner and *Select from Fleet Planning* have live data (remark "Seeded demo allocation").
3. **Workbook statuses** (`On standby / held`, `Loading at bay`, `Laden`, `At client destination`, `Offloading at client`, `Inbound (returning)`, `Transit breakdown (offsite)`) are mapped to the configurable list; the aliases stay recognised on import.
4. **Clients only in the planning workbook** (BAJAJ, ATLANTIC PVC) were added to the client master; `JAT` → JUBAILI AGROTEC, `ABBA SALEH` → ABBA ABASS, `VANDERA` → VENDARA etc. are handled with the alias table in `tools/build_planning_seed.js`.
5. **Power Apps Trip ID.** No Power Apps environment, Dataverse connection or API credentials were available, so the Trip ID is entered manually (validated against a configurable pattern, unique across the Trip Log, never generated by the app) and a server endpoint accepts it from Power Automate (see docs/DEPLOYMENT.md). Trips created from an allocation show *Trip ID pending* until it arrives.
6. **Invoice status** is derived from the invoice record (Draft → Issued → Sent → Voided), so the workbook's `Invoice Not Sent` becomes *Not Invoiced*; 'Invoice Sent' rows billed before the app keep their status. Payment status stays separate (Unpaid / Part Paid / Paid); a trip closes financially only on full settlement.

---

# Phase 4 — Route management, lost sales, fuel planning and dispatch

No new workbook accompanied this brief; the rules below were designed from the brief and the existing masters.

| Area | Implementation | Where |
|---|---|---|
| Bulk cancellation of requests | Checkboxes on Client Requests, *Cancel selected requests*: reason, lost-sales classification, responsible department, remarks, optional release of allocated trucks after a confirmation; cancelled requests are kept with user, time and reason in the audit trail | `js/ui/requests_bulk.js` |
| Lost sales | `lostsales` records (client, request, requested / allocated / unfulfilled trucks, agreed rate, estimated lost revenue, reason, date, department, remarks, standardised states, vehicle type); **Lost Sales = unfulfilled trucks × agreed client rate**; rate from the price list (client + origin + destination + tonnage) or the route register; kinds *Confirmed lost sale* / *At risk* / *Not a lost sale*, suggested from the reason; open requests still lacking trucks appear live as *At risk*; reports by client, route, month, station, vehicle type, reason | `js/core/dispatch.js` (`requestRate`, `lostSales`, `lostSalesSummary`), `js/ui/lostsales.js` |
| Location standardisation | Gazetteer of the 36 states + FCT with capitals, towns, LGAs, Lagos areas, depots and abbreviations (GBD, PHC, VI, IKM…); rules: approved Location Master → exact match → every part of a zone list → spelling match (suggestion) → ambiguous / unknown (needs confirmation). Original text is never changed; computed trips carry `loadingState` / `deliveryState`. Location Master in Settings: approve, correct or reject; bulk approval of single-candidate suggestions; approved mappings reused everywhere | `js/core/geo.js`, `meta/locationmaster`, `js/ui/masters.js` |
| Route Distance Master | One entry per origin station → destination state: route name, reference destination (capital unless management approves a hub), one-way / return / two-leg km, straight-line km as a sanity check, source, verification status, verifier and date. Seeded for all 37 destinations from JMG Gbagada with reference road-atlas distances flagged **unverified**; *Suggest from routing service* fetches the road distance (OSRM through the server when `OSRM_URL` is set, or directly from the browser); an administrator verifies before the distance counts as approved. Resolution order for a trip: approved entry → unverified entry (flagged) → route register km → within-state default → missing (blocks approval) | `data/workbook/distances.json`, `tools/build_distance_master.js`, `resolveDistance()` |
| Consumption matrix | Vehicle category from body type / tonnage / vehicle type: Haulage 45T 0.50 L/km, Jumbo 30T / 102 CBM 0.45, Flatbed 0.42 (editable); road expenses ₦25/km (editable); finance approval threshold; within-state default km; implausible-distance threshold | Settings → *Diesel consumption matrix and road expenses* (`meta/planning.dispatch`) |
| Dispatch form | `dispatches` record per trip (DSP-YYMMDD-NN): trip, route, distance breakdown, rate, outbound / return / total diesel, road allowance, approved figures (adjustment needs a reason), approvals (operations; finance when required), diesel issues and road payments (initial once; more only through an approved supplementary request), status Draft → Awaiting Approval → Awaiting Finance → Approved → Partly Dispatched → Dispatched → Closed (or Rejected); printable PDF | `js/ui/dispatch.js`, `js/ui/exporter_dispatch.js`, server field-level checks in `server/server.js` |
| Expense control | Budget vs approved vs actual (initial, supplementary, consumed) with variances and exceptions | `expenseControl()` |
| Assistant | Nine management questions answered from live records (rule-based, labelled as such; an LLM can be plugged in front of the same functions) and automatic checks for duplicate routes, inconsistent state names, implausible distances, consumption categories, duplicate / excessive diesel and missing approved distances | `assistant()`, `anomalies()` |

Decisions: (1) routing services were not reachable from the delivery environment, so the seeded distances are reference values marked unverified and the routing call is wired for environments that allow it; (2) "AI" standardisation and analysis are deterministic rules so that every answer is reproducible and auditable; (3) a trip starting from a station other than Lagos resolves its own origin state and uses the matching master entry or the route register, never the Lagos distance.

# Phase 5 — Workflow and module enhancements

No new workbook accompanied this brief; the rules below were designed from the brief, the existing masters and the Power Apps-free Trip ID requirement.

| Area | Implementation | Where |
|---|---|---|
| CRM requests | `requests` carry `serviceType` (mandatory: Internal Fleet / 3rd Party Contractor), `submittedAt/By`, `routeMasterId`, `routeApproved`, `plan` (approved quantity, category, tonnage, station, notes, suggested trucks, prepared / approved by and when), cancellation request and approval fields; status derived by `requestStatus()`; never deleted | `js/core/planning.js`, `js/ui/crm.js`, `js/ui/planning.js` |
| Route Master | `routes` extended with `originState`, `destState`, `kmReturn`, `totalKm`, `tatDays`, `status`, `approvedAt/By`, `mappingNote`; `routeValidation()` returns **Route Not Mapped — Route Approval Required.** for missing or unapproved routes and blocks submission, plan approval, allocation and Trip ID generation in the store and on the server; distances resolve from the approved Route Master first | `routeMaster()`, `routeValidation()`, `resolveDistance()` |
| Stage permissions | `request.manage` (CRM, Operations), `plan.approve` / `allocation.release` / `plan.override` / `expense.approve` / `tpl.approve` / `route.manage` / `invoice.override.ops` (Operations Manager), `allocation.manage` (Station Manager, Operations), `trip.fromPlanning`, `fmr.import` / `tat.update` / `trip.close` (Tracking), `expense.request` (Planner, Station), `expense.pay` / `tpl.pay` / `invoice.override.finance` (Finance); administrators deliberately cannot approve additional expenses | `ROLE_ACTIONS` in `js/core/engine.js`, `COLLECTION_ACTION` / `COLLECTION_ALSO` |
| Trip ID | `JMG-TRP-YYYY-NNNNNN`; `nextTripId(year)` (server: `counters` table in the write transaction + partial unique index on `trips.trip_id`; shared database: `meta/tripseq` + duplicate check); `validateTrip` refuses typing, overwriting or blanking a generated ID; `tripIdSource: 'generated'` | `js/core/engine.js`, `js/store/*.js`, `server/server.js` |
| TAT | `trip.milestones` (six mandatory keys), `trip.events[]`, `tatTargetDays` from the approved route, `tatCalc()` (segments, total, variance, status), `milestoneError()` (chronology, no future times), `tatDashboard()`; `opsStatus` Open / Closed / Cancelled set by the tracking team; closed trips block new expense requests | `js/core/planning.js`, `js/ui/tat.js` |
| Diesel / road slips | `dieselreqs` (DSL-YYMMDD-NN) and `roadslips` (RXP-YYMMDD-NN) replace the combined dispatch form: own status (Draft → Awaiting Approval → Awaiting Finance → Approved → Partly Issued → Issued → Closed / Rejected), approvals, issue / payment records, supplementary requests, separate PDFs | `js/core/dispatch.js`, `js/ui/dispatch.js`, `js/ui/exporter_dispatch.js` |
| Additional expenses | `extraexpenses` (AEX-YYMMDD-NN): category, amount, reason, document, Pending Approval → Approved / Rejected → Paid; `expenseRequestError()` (open trip, duplicates), `expenseTransitionError()` (Operations Manager decides, finance pays) | `js/core/dispatch.js` |
| 3PL | `request.tpl` (equipment, job, cargo, selling price, contractor, quote, approved cost, assignment status, contractor invoice / payment), `contractors`, `quotes` (Requested → Quoted → Selected / Rejected / Withdrawn); contractor trips carry `serviceType`, `contractorId/Name/Plate/Cost`; `tplMargin()`, `tplProfitability()` | `js/ui/tpl.js`, `createTplTrips()`, `POST /api/trips/tpl` |
| Billing documents | `billingReadiness()`: completion + verified waybill + verified POD (+ signed delivery confirmation and client-specific documents when required) → Ready / Pending Documents; invoices carry `docOverride` (Operations Manager + Finance, reason) | `js/core/engine.js`, `js/ui/invoices.js` |
| FMR Excel | Download current / blank template, upload Excel or CSV, header aliases, validation, preview, authorisation for protected trucks, `planning.lastFmrUpdate*` | `js/ui/fmr_excel.js`, CSV fallback in `js/ui/exporter.js` |
| KPIs | `managementKpis()` feeds dashboard section 4 *Workflow KPIs* | `js/core/dispatch.js`, `js/ui/reports.js` |

Decisions: (1) the Power Apps integration and its endpoint were removed; (2) tracking may move the dispatch date to the actual loading date when a truck loads earlier than planned, so milestones and the Trip Log agree; (3) the seed upgrades the existing routes to approved Route Master entries (`tools/build_brief5_seed.js`) so historical requests keep working, while one request (LEB-001) is left unmapped to demonstrate the validation.

# Phase 6 — Setup_Haulage workbook (asset, staff, LOB, KPI, accounts, items, rate card, Route Master, suppliers, 3PL rate cards)

Extracted with `tools/extract_setup.py` (cached values only) and turned into masters by `tools/build_setup_masters.js`; the full report is `data/workbook/setup_report.json` and the *Import report* tab of Master Data.

| Sheet | Rows | Becomes | Notes |
|---|---|---|---|
| Asset Code | 124 | `assets` (merged: 57 existing vehicles updated, 67 added, 3 Haulage-sheet assets kept and flagged) | asset code, plate, name, tonnage, body size, type, cost center and name; plates normalised (T2404LA = T-2404LA); batch classification unknown for the 67 new vehicles (*Unclassified*) |
| Driver Mapping On Each Vehicle | 67 | `assets` / `fleet` driver, staff ID, station officer, operations manager | 7 driver-mapped vehicles missing from the FMR added without a status |
| Staffs List | 131 | `staff` | employee ID (6 digits), position, department, cost center, branch, category, joining date, manager |
| LOB | 6 | `lob` | Haulage, Port Operations, Hiab, Vans, Crane & Heavy Lifts, 3PL |
| KPI | 17 | `meta/planning.dispatch.dieselRates`, `meta/planning.kpi`, `meta/planning.portExpenses` | 300 km/day, 1 day loading and offloading, diesel L/km per category, port-operation expense table |
| Expense Account | 23 | `accounts` + `meta/accountmap` | GL numbers, expense types and the module rule; two accounts have no number yet (CNG, tracking) |
| Item List | 726 | `items` | part name, make, model, category, group, subgroup, class, cost (475 priced); no stock, unit, part number, reorder level or inventory account in the sheet |
| Supplier | 55 | `suppliers` | account, terms, division, scope per equipment / service |
| Rate Card for costing | 67 | `ratecard` | consumption, maintenance budget, trips and km per month, planned days, fixed cost and selling fixed per day, maintenance / tyre / road cost per km |
| All Routes | 823 | `routes` (Route Master) | contract, client, loading point and state, corrected destination and state, region, delivery type, zone, stops, leg km, source; 395 existing routes re-mapped (390 with different km, previous values in `kmHistory`), 428 new lanes, 10 unlocated lanes pending approval, 130 legacy routes kept, 48 duplicate lanes flagged |
| KM from … / Internal Zones / Zone Areas / Spelling Corrections / Method & Notes | 437 / 46 / 361 / 106 / 14 | `meta/routezones` | zone centres and far ends per depot, areas per zone, the spelling corrections applied, the workbook's own method notes |
| 3PL Rate Card – Internal / Interstate | 46 / 303 | `tplrates` | every rate blank, as instructed |

**Missing data (left empty, never invented)**
* Cost center budgets are not in the workbook (budgetMonthly is null); the "cost centers exceeding budget" question answers "no budget set" until Finance enters budgets.
* 67 vehicles from the Asset Code sheet have no New Batch / Old Batch classification in any workbook (shown as "Unclassified" until an administrator sets it).
* Acquisition information (purchase date, cost) is not in the workbook; the asset master carries the fields empty.
* 7 driver-mapped vehicles were not on the Truck Planning FMR; they are added without an operational status (shown as status unconfirmed until the tracking team updates them).
* Expense accounts without a general-ledger number in the workbook: CNG Expense, Tracking System, Insurance, GIT, License and Permit, Salaries Local and Expat, Rent, Depreciation. They are listed as pending; postings to them are held as "account number pending" until Finance supplies the number.
* No revenue (sales) account numbers were supplied; revenue postings carry the LOB and cost center but an empty GL account until Finance adds revenue accounts to the Chart of Accounts.
* Item list: stock quantities, units of measure, part numbers, reorder levels and inventory accounts are not in the workbook (unit defaults to EA, stock starts at 0 and is flagged "stock not supplied", 251 items have no unit cost). Expense account defaults: tyres → 6102028, everything else → 6102010 (Hiab jobs post to 6102009 by the job card's vehicle).
* 3PL rate cards (internal zones and interstate lanes) are imported with every rate blank, as instructed; Station Supervisors enter contractor rates per request until management finalises the card.
* 428 Route Master lanes have no approved client price in any workbook (price null); the price list and request pricing fall back to the client price list.

**Conflicts between the supplied files**
* Asset Code sheet: T1590LA carries cost center CC039 with the name "Closed Body Logistics" while CC039 is Hiabs Logistics elsewhere; CC039 = Hiabs Logistics is kept and the asset keeps its code.
* Asset T-2422LA (MVEH-000282) is in the Haulage Billing asset list but not in the Setup_Haulage Asset Code sheet; kept and flagged.
* Asset T8115LA (MVEH-000338) is in the Haulage Billing asset list but not in the Setup_Haulage Asset Code sheet; kept and flagged.
* Asset THIRD-PARTYHAULAGE (THIRD-PARTYHAULAGE) is in the Haulage Billing asset list but not in the Setup_Haulage Asset Code sheet; kept and flagged.
* Rate Card road expense per km differs by division (25 / 36 / 38 / 40 / 49 / 59 / 80 ₦/km) while the Expense Account sheet fixes the driver road allowance at ₦25/km; the payment slip keeps ₦25/km (operational standard) and costing uses the rate card value.
* 48 Route Master rows repeat a contract + loading point + destination already listed (different stop sequences or duplicated entries); both are kept and flagged duplicateLane for the administrator to retire one.
* Contracts in the Truck Planning route register that the Setup_Haulage Route Master does not list (kept as legacy routes): BAJAJ-30T-NBL-DSL-JUMBO (57), ATLANTIC PVC-45T-NBL-DSL-JUMBO (72), ORCA-3PL-LOWBED (1).
* 390 existing routes had different kilometres in the Truck Planning register than in the Route Master; the Route Master values are now operational and the previous values are kept in each route's kmHistory.
* Diesel KPI: the brief's initial assumption for Jumbo 30T / 102 CBM is 0.45 L/km but the supplied KPI master says 0.42 L/km; the KPI master overrides, as instructed (the matrix stays editable in Settings).

**Assumptions (documented and editable in the masters)**
* Default LOB per cost center: CC059 Haulage and CC046 Flat Trucks → Haulage, CC039 Hiabs → Hiab, CC047 Closed Body → Vans; overhead, workshop and stores cost centers carry no LOB. The planner can change the LOB on every allocation.
* Suggested expense account per additional-expense category (editable): extra diesel → 6103013, road / accommodation → 6101027, labour and pushing → 6101030, police / community → 6105061, tolls, tickets, demurrage, other → 6105047, repairs on the road → 6102010, towing → 6105040, port expenses → 6105051.
* Rate Card for costing: "Actual Fixed Cost" and "Selling Fixed" are read as amounts per planned working day (the sheet gives Project Number of Day / Planned days per asset), "KM" as planned kilometres per month; MTC, tyre and road costs are per km as given. Diesel cost in costing uses the diesel price in Settings (₦ per litre, editable) because the workbook has no diesel price.
* Port operations KPI table (APMT / ESS-Libra / Ikorodu lanes): the sheet header lists five columns for four value columns ("Additional Diesel" and "Passing Truck Express" share one column); values are kept as Port expenses, Driver road expenses, Additional diesel / passing truck, Dropping empty, pending confirmation.
* Delivery-time bands come from the brief, not the workbook; the operational delivery leg is counted from loading completion (driving days at 300 km/day), so the loading allowance is not double counted against the OTD target; local deliveries ≤ 100 km use one 24-hour window including handling.
* Diesel cost in costing and in the P&L uses the diesel price in Settings → Fleet planning (the workbooks have none); approved allowances are never costs until issued or paid.
* No revenue account numbers, cost-center budgets, preventive maintenance schedule or opening stock were supplied; the screens show these as pending and Finance / the Storekeeper complete them.
* The official JMG logo file was not included in this upload; the invoice PDF keeps the logo already configured in Settings.


# Phase 7 — Audit & Control brief: Client_Rate_Comparison_2026 (9).xlsx and the updated Setup_Haulage (1).xlsx

## Setup_Haulage (1).xlsx vs the copy imported in Phase 6

Every sheet is identical to the Phase 6 copy except two: the **Asset Code** sheet only renumbers its external-workbook reference (`[3]Budgets 2027` → `[2]Budgets 2027`, the budget link is still not resolvable), and the empty **Sheet1** is replaced by a **TripLog** sheet (1,788 rows, 29 columns, 2 Jan – 20 Oct 2026). The masters imported in Phase 6 therefore stand; nothing was re-imported.

### TripLog sheet → application Trip Log (`tools/build_audit_data.js`, report `data/workbook/triplog_reconciliation.json`)

| Result | Rows |
|---|---|
| Matched exactly (date, truck, client, loading point, destination, selling price) | 1413 |
| Matched by date + truck + client (the sheet flattens the loading point) | 321 |
| New trips, appended to the Trip Log as history (`source: "setup-triplog"`, ids `tl-NNNN`) | 54 (2026-10-02 – 2026-10-20) |
| Application trips absent from the sheet | 0 |

- The sheet collapses the NBL depot loading points (Ama Brewery, Kudenda, Ota, Ijebu Ode, Aba, Idimu, NGB4/5/8 …) to "IBADAN" on 317 rows. The application keeps the depot so route comparisons stay at the level the rate comparison workbook itself used (Ama, Kaduna (Kudenda), Ijebu Ode, Ota …).
- 4 October rows carry a different selling price in the sheet than in the application (wb-3697 MEGA MANU ₦2,020,000 vs ₦1,925,581.4; wb-3705 MEGA MANU ₦2,850,000 vs ₦3,079,069.77; wb-3706 ABBA ABASS ₦1,520,000 vs ₦1,413,953.49; wb-3709 ABBA ABASS ₦1,520,000 vs ₦1,413,953.49). Historical selling prices are never changed by an import; the differences are listed in **Audit & Control → Workbook Baseline** for management to resolve in the Trip Log.
- Eight canter rows store the selling price as text ("₦139,534.88"); they are parsed. The helper columns "Eligible (helper)" (133 rows flagged 1 across all vehicle types) and "Match Rank (helper)" (one row) have no documented meaning and are not used.
- Historical rows never become FMR statuses, CRM requests or allocations; the operational demo keeps its clean request and FMR environment (acceptance test C16).

## Client_Rate_Comparison_2026 (9).xlsx

| Sheet | Content | Use in the application |
|---|---|---|
| Summary | Narrative: ₦2391.1M achieved, ₦118.9M (+5.0%) at the best-paying client's average, ₦178.3M (+7.5%) at the highest rate; key findings per client | Frozen baseline text (Workbook Baseline tab) |
| Achieved vs Best Rate | By client and by month: trips, revenue achieved, revenue at best rate, at best client average | Baseline headline and by-client / by-month reconciliation |
| Client Rate Ranking | Rank, rate level (client avg ÷ best client avg), verdict (At top rate ≥ 99.9%, Close to top ≥ 95%, Below peers ≥ 80%, Well below peers), revenue lost, lost if priced at highest, trips and revenue on compared routes, routes with the biggest gaps | Methodology of `HB.audit.clientRanking`; the workbook label is shown next to the brief's verdicts |
| Rate Gaps by Route | Quarter × route × vehicle × client: trips, average rate, best-paying client and its trips, best average, rate level, revenue lost = MAX(0, best avg − avg) × trips, highest rate, lost if at highest | `HB.audit.routeGaps` (same formulas; thin benchmarks additionally flagged) |
| Turnaround Table | 197 one-leg day values (drop point → loading bay, key = UPPER(from)>UPPER(to)) | `data/workbook/turnaround.json` → `meta/turnaround`, editable in the Control policy; planned truck-days = 2 × one-leg days when no approved Route Master turnaround exists |
| Truck Requirement | Operating days per truck per month (26), default one-leg days (2), trips per truck per month = MAX(1, INT(26 ÷ round-trip days)), trucks needed per client per month (rounded up per client; shared-fleet total), own trucks actually used (35–40 per month) | `HB.audit.truckRequirement` and the Revenue per Truck-Day tab |
| Order Planner / Revenue Planner | Trucks needed and revenue per truck-day for a client's monthly request at a given price; market average and highest price Jul–Sep from Route Prices | Revenue per truck-day = price ÷ round-trip days; the pre-allocation audit shows truck-days required and the benchmark |
| Truck Req by Route | 317 client × loading area × destination rows with the turnaround key used and how it was matched (Exact, Reverse, Nearest bay, Lagos bay used, Not in table) | Matching order reproduced in `HB.audit.turnaroundLookup` |
| Client List | 60 client names for dropdowns | Not needed (the application has a client master) |
| Route Prices | 99 turnaround keys → trip-log route names with 2026 trips, averages and highest Jul–Sep prices | Reference baseline |

### Methodology reproduced, and where the web result differs

- Scope: trips 2 Jan – 30 Sep 2026, selling price excl. VAT, haulage and flat trucks as one class, closed-body / canter and Hiab excluded, 3rd-party trucks included, quarters, only routes with 2+ clients in the same quarter.
- The workbook snapshot predates 17 September trips (Sep 124 → 141 in the application), so achieved revenue is ₦31.8M higher in the web result and the Q3 benchmarks move slightly (Jamara 88.9% → 87.7%, MEGA MANU 89.6% → 91.8%); Lacasera (64.6%, ₦14.2M) and JUBAILI AGROTEC (₦5.7M) reproduce exactly.
- Routes are keyed by the application's loading-area and destination normalisation (`HB.audit.loadingArea`, `destName`, aliases such as PHG/PHC → Port Harcourt) instead of the workbook's manual grouping; KD & SONS (Kaduna → Ibadan) therefore falls into a different group than NBL's Kudenda brewery trips and is not compared.
- The brief's stricter rule (never compare 45T haulage with 30T jumbo or Hiab) is available as the "strict" vehicle grouping in the Control policy; the default keeps the workbook grouping so the baseline reconciles.
- Benchmarks resting on fewer than 3 trips of the best-paying client are flagged ("thin benchmark"), and the highest observed price is labelled an aggressive benchmark that is not assumed achievable for every client.

### Assumptions recorded in the default control policy (`data/workbook/auditpolicy.json`)

- Below-approved-rate and below-cost prices block invoice issue until a commercial exception is approved; a **missing** Client Rate Card entry does not block (93% of the historical Trip Log has no rate card entry) — it is flagged "Approved Rate Missing" for commercial review. Both switches are configurable.
- Approval matrix: every exception is reviewed by the Operations Manager; below-approved, missing-rate and override exceptions are approved by Management or Finance; below-cost and exceptional-arrangement exceptions by Management only. Nobody reviews or approves their own request.
- Estimated trip cost before a truck is known = median Rate Card parameters of the matching vehicle class (45T haulage, 30T, flatbed …) on the approved route distance and turnaround.


# Phase 8 — Client_Contracts_And_Rate_Cards_cleaned_3.xlsx (the approved Client Rate Card)

| Sheet | Content | Use |
|---|---|---|
| Client Route And Contracts | 927 contract lanes: supervisor, truck size, division, tonnage, client, loading point, destination (standardised), state, KM, total KM, diesel issuance, road expenses, price | The approved Client Rate Card (`data/workbook/rates.json`) and Route Master prices (`tools/build_client_rates.js`) |
| NEW-DSL JMR | 602-lane costing model (Jamara, JMG, Lacasera, Niger Biscuit): fixed / MTC / tyre / diesel / road costs from external links, selling build-up, discount, approved client price, contractor price, status | Cross-check only: 7 lanes where the model's approved price differs from the card are listed in the report; 104 contractor prices are not imported (3PL rates stay blank per the Setup brief) |
| Name Changes | 416 original → standardised destination names with state and notes | Location Master (160 approved entries added) |
| Sheet1 | empty | — |

## Import result (`data/workbook/client_rates_report.json`)

| Result | Count |
|---|---|
| Lanes whose price equals the rate already on the card (record kept, confirmed by the contract card) | 118 |
| Lanes with a different price (new record effective 2026-10-20; previous rate expires 2026-10-19) | [object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object] (43 records expired) |
| Lanes new to the card (effective 2026-01-01 — assumption, the card carries no dates) | 744 |
| Rows without a price (skipped, nothing invented) | 5: JUBAILI AGROTEC Ibadan → Yola 45T; MEGA MANU Lagos → Ilorin 30T; ABBA ABASS Ogere → Lafia 45T; WALTER & HIFY RESOURCES Port Harcourt → Benin City 30T; LEBRUNI AGRO LTD Ibadan → Idiroko 40T |
| Duplicate lanes with two prices (both kept; the Trip Log asks the user to pick) | 5: Jamara Ibadan 8T 25CBM ₦235,970 / ₦141,582; Jamara Ibadan 3T 16CBM ₦148,299 / ₦88,980; MEGA MANU Ibadan 45T JUMBO ₦850,000 / ₦828,000; I'HS IKM 30T FLATBED ₦330,000 / ₦440,000; I'HS Epe 30T FLATBED ₦970,000 / ₦740,000 |
| Card lanes whose equipment differs from the June rate on the same lane (both kept, review) | 14 (JMG and I'HS 30T flatbed lanes vs June rates typed as haulage) |
| Route Master lanes that had no approved price and now carry the card price | 144 |
| Route Master prices changed by the card (previous price kept in priceHistory) | 20 |
| Lanes added to the Route Master as Pending Approval (card KM, not road-routed) | 318 |
| Card KM differing from the road-routed Route Master KM by more than 5 km (Route Master kept) | 368 |

Client names on the card are mapped to the client master: JAMARA → Jamara, Mega Manu / Mega Manu-Local → MEGA MANU, JAT → JUBAILI AGROTEC, VANDERA → VENDARA, NIGER BISCUIT → NIGER BISCUITS, Lebruni → LEBRUNI AGRO LTD, Orca → ORCA DECO LIMITED, WALTER & Hiffy → WALTER & HIFY RESOURCES, Givanas → GIVANAS, Interstyle → INTERSTYLE, and **ABBA SALEH → ABBA ABASS (assumption: its Ogere → Lafia lane matches that client's Nasarawa ↔ Ogere trips — confirm)**. Prices are read as VAT-exclusive (120 lanes equal the June price list to the naira). Vehicle type comes from Division / Truck Size (NBL-DSL → haulage, FLATBED → flat trucks, CANTER → closed body, Hiabs Logistics → Hiab).

Natural Beauty's two June rates were recorded as VAT-inclusive; the card restates the same figures (Lagos → Kano ₦4,450,000) and ₦5,820,000 for Maiduguri, so they are now carried as VAT-exclusive like every other lane on the card — the previous inclusive records expire on 2026-10-19 and stay in the history.

Coverage after the import: 2026 trips with an approved rate found rise from 245 to 390, 76 trips match two card prices (size variants) and wait for the user's pick, 1,322 still have no card lane (mostly NBL, ORCA DECO, AB-INBEV, SASO upcountry lanes not on this card).


## Brief 8 — CRM, FMR, 3PL, Finance, Excel integration and Incident Management

* **Trip IDs**: internal `Trip-200601`…, 3PL `TRP-3PL2001`… (`E.formatTripId(kind, n)`, `E.nextTripSeq`); the server keeps one counter per kind inside the write transaction plus a unique index on both generated formats; the shared database uses the `meta/tripseq` counter (`kinternal` / `ktpl`). IDs already issued under `JMG-TRP-YYYY-NNNNNN` and the workbook's historical Journey Plan IDs (`TRP4384`, `Trip-2090`, `TRIP-202602031353`…) are untouched; the generated regexes are exact (six digits / `TRP-3PL` + four or more digits) so historical `Trip-2090` style values are not confused with generated IDs.
* **CRM origin and rate**: `D.clientOrigins` reads the current Client Price List lanes of the client (state from the Location Master; GIVANAS → Lagos / Lagos State, JUBAILI AGROTEC → Ibadan / Oyo State); `D.clientLaneRates` lists the lanes for the destination with vehicle category, tonnage, basis and effective dates and flags a missing mapping. `D.requestRate` keeps the Route Master price as a separate `routePrice` (reference only) and reports `approvedRate` from the price list alone.
* **GM commercial approval**: `A.commercialReview` (approved rate, costing rate, expected profit, margin, below-cost / below-rate flags), `A.commercialSnapshot` stored on `request.commercial` on every save (termsHash of client, lane, vehicle, tonnage, trucks, expected price, loading date; a changed hash clears `gmApprovedAt` and records *Re-approval required*), `A.gmDecisionError` (only `commercial.gmapprove`, remarks and approved price required). Plan approval is refused with code `commercial` while `requiresGm && !gmApprovedAt`; request status *Awaiting Commercial Approval*. A valid GM approval authorises the job in `requestAudit` like an approved exception.
* **FMR**: `P.fleetPosition` derives Operational Status, Current State (Location Master), Current City, Movement Direction, Expected Availability and Existing Allocation; `planningEligible = Free group || (On trip && Returning Empty)`; `P.freeFilter` implements the four brief filters; `P.allocationChecks` lists the ETA / driver / conflict / eligibility checks. Tracking fields `currentState`, `currentCity`, `movementDirection`, `expectedAvailability` were added to the FMR form.
* **3PL**: quotation candidates come from `suppliers` with `is3pl` (24 of 55 Setup_Haulage suppliers, division "3rd party Logistics") matched on the capability flags (lowbed / flatbed / crane / hiab / 20FT / 25FT / 40FT); the legacy `contractors` register is kept read-only for history.
* **Finance disbursements**: UI over the existing slip rules (`D.slipIssueError`, one issue record per write, supplementary requests), one transaction per document; approved additional / incident expenses paid per request.
* **Excel masters**: `js/ui/masterio.js` configurations per master (columns, identity, duplicates, protected fields, version rules); `importlogs` collection; Route Master changes on approved routes become *Pending Approval* with `previousVersion` / `versions`; price changes on an existing rate expire the old entry (`supersededBy`) and create a new one.
* **Incidents** (`js/core/incident.js`): categories master (`meta/incidentcats`), `fromTrip`, `incidentError` / `stamp` (roles per stage, order, immutable history, closure conditions), `expenseError` (planner / station supervisor only; Additional Diesel → diesel workflow; Spare Parts → job card), `costs` (paid expenses + linked job cards, once), `timing` / `tripDelay` / `tatImpact` (breakdown hours to release, repair hours, TAT and OTD excluding incident delay, revised ETA, OTD failure caused by the incident), `dashboard`, `assistant`, `closureFlag`, `jobCardFromIncident`. `F.tripPnl` adds `direct.incident` (incident-linked paid expenses and incident job cards are removed from `extras` / `repairsOnTrip`) and `unprofitableDueToIncident`.
* **Roles**: new `gm` (General Manager) with `commercial.gmapprove`; incident actions `incident.report` (tracking, station supervisor, station, operations, planning, admin), `incident.review` (operations, admin), `incident.view` (all).
