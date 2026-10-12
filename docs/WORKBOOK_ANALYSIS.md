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
