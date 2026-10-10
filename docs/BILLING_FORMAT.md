# Billing Format

One billing is produced **per party per month**: one for each contractor and one for the
internal (in-house) fleet. Each billing is a snapshot of the trips it covers, priced against the
price list that was active for that party and period. Editing a trip or a price list afterwards
never changes a logged billing; void it and regenerate instead.

## Header

| Field | Source |
|---|---|
| Billing No. | `BILL-<YYYY-MM>-<PARTY CODE>-<seq>` e.g. `BILL-2026-09-INT-001`, `BILL-2026-09-KHL-001` |
| Period | Billing month |
| Date | Date the billing was logged |
| Price list | Name of the tariff used (e.g. *Billing Price List 2026 (Internal)*) |
| Currency | From the price list, falling back to Setup |
| Terms | Contractor payment terms (contractor billings only) |
| Haulier / Billed to | Contractor or in-house cost centre; your company |

## Lines — contractor billing (`EXTERNAL HAULAGE BILLING STATEMENT`)

| # | Date | Waybill | Vehicle | Route | Product | Qty | Unit | MOQ | Billable | Rate | Amount |
|---|---|---|---|---|---|---|---|---|---|---|---|

* **Billable** = `max(Qty, MOQ)`. A line billed at the MOQ carries an **MOQ** tag.
* **Amount** = `Billable × Rate` (per TONNE / LITRE / PALLET / CBM) or the flat `Rate` for `TRIP` lines.

## Lines — internal billing (`INTERNAL HAULAGE BILLING — COST RECHARGE`)

| # | Date | Waybill | Vehicle | Route | Product | Qty | MOQ | Billable | Km | Fixed | Variable | Fixed-var. | Diesel L | Diesel | Trip cost | Cost/unit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

* **Fixed** = fixed cost per trip from the price list line.
* **Variable** = variable cost per km × trip km (trip km defaults to the route distance).
* **Fixed-var.** = fixed-variable (semi-variable) cost per trip.
* **Diesel** = diesel litres × diesel price per litre (price-list header). Litres are the actual litres
  logged on the trip; when blank the line's standard litres are used.
* **Trip cost** = Fixed + Variable + Fixed-var. + Diesel.
* **Cost/unit** = Trip cost ÷ Billable quantity (so a short load shows the true cost per tonne at MOQ).

## Footer

* Totals row (trips, quantities, km, each component, subtotal, average cost per unit).
* **MOQ adjustments**: trips billed at MOQ, quantity topped up, value of the top-ups (contractor), averages per unit / trip / km.
* **Cost structure** (internal only): each component with its share of the subtotal.
* Subtotal → Levies (%) → VAT (%) → **TOTAL**. Internal billings are untaxed by default (Setup → *Tax internal billing?*).
* Signature blocks: Prepared by / Checked by / Approved by.

## Lifecycle

`DRAFT` → `APPROVED` → `PAID`. A billing can be **voided** at any time, which releases its trips so they
can be billed again. Voided billings can then be deleted.

## Export

*Export Excel/CSV* produces a workbook with a **Summary** sheet (header, MOQ summary, component totals,
taxes) and a **Lines** sheet with every column above plus driver, vehicle class, diesel price and cost/km.
*Print / PDF* uses a print stylesheet that hides the application chrome.
