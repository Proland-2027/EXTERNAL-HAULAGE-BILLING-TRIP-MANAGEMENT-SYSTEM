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
