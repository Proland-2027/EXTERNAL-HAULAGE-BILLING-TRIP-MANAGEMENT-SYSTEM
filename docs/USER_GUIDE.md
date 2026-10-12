# Haulage Billing Desk — Team User Guide

## Signing in

Open the demo link in Chrome (desktop, tablet or phone) and sign in with your individual account.
Demo accounts (change the passwords in **Users & Roles** before real use):

| Role | Username | Password | What the role can do |
|---|---|---|---|
| Administrator | `admin` | `Admin@2026` | Everything: settings, users, price list, all records |
| Operations Team | `ops` | `Ops@2026` | Create trips; edit dispatch, delivery, vehicle, client, route, journey plan, waybill |
| Billing Team | `billing` | `Billing@2026` | Enter **Selling Price**, quote/SO numbers, invoice status; generate and send invoices |
| Finance Team | `finance` | `Finance@2026` | Payment status, advances, record payments, statements, outstanding balances |
| Management | `manager` | `Manager@2026` | Dashboards, reports, price-variance review, audit trail (read-only) |

Fields a role may not edit are greyed out in the Trip Log and in the trip form.

## Trip Log

* **Columns**: every workbook column plus *Agreed Client Price*, *Price Variance (₦)*, *Price Variance (%)* and *Trip Status*. The first two columns stay frozen while you scroll sideways; the heading row stays visible while you scroll down.
* **Inline editing**: click a cell to edit it. `Enter` keeps the value, `Tab` moves to the next editable cell, `Esc` cancels. Edited rows get an amber stripe and a **Save** bar appears at the bottom; nothing reaches the database until you click **Save**. Leaving the page with unsaved edits shows a warning.
* **Full record**: click the row number to open the trip form with every field, the calculated values and the change history.
* **Search and filters**: the search box matches client, plate, route, waybill, journey plan, quote/SO and invoice numbers. **Filters** adds date range, month, client, vehicle type, cost center, plate, payment/invoice/trip status and *Price vs agreed* (below / above / no rate).
* **Sort** by clicking any heading. **Export Excel** downloads the filtered rows with all computed columns.
* **Import Excel**: upload a Trip Log export (or any sheet with the same headings). The preview shows new rows, duplicates (same date, plate, client, waybill, journey plan and selling price) and invalid rows before anything is written.

### Agreed Client Price and Selling Price

* **Agreed Client Price** is looked up automatically from the Client Price List using the trip's client, loading origin, destination, vehicle type and (when the rate has one) contract type, for the rate in force on the dispatch date.
  * No match → the cell shows **No Agreed Rate Found**.
  * Several rates tie → the cell shows **Multiple rates — choose**; click it to pick the one that applies.
* **Selling Price (₦)** is always typed by the Billing Team (or an administrator). It is never filled, changed or "corrected" from the agreed rate, and changing a rate never changes historical selling prices.
* VAT (7.5 %), Billing After VAT, Amount Paid and Balance are always calculated from the Selling Price.
* **Variance** = Selling − Agreed, and Variance % = Variance ÷ Agreed × 100. Green when the selling price is above the agreed rate, red when below, grey when equal, blank when there is no agreed rate. A low price is highlighted, never blocked.

### VAT treatment (per trip, set by the invoice)

Every trip carries a **VAT Treatment**: *Price Excluding VAT* (default, the workbook rule: VAT = 7.5 % added on top) or *Price Including VAT* (VAT extracted from the selling price). It is set by the Invoice Price Type chosen when the invoice is generated and shows in the Trip Log, statements, dashboard and reports. The Selling Price itself is never changed. Example for ₦2,000,000: excluding → subtotal ₦2,000,000, VAT ₦150,000, total ₦2,150,000; including → subtotal ₦1,860,465.12, VAT ₦139,534.88, total ₦2,000,000.

### Truck Batch

Each vehicle in the Asset List carries a **Truck Batch** (New Batch / Old Batch; third-party haulage shows as *3rd Party*). A trip inherits the batch in force on its dispatch date and keeps it, so reclassifying a truck later never rewrites history. The Trip Log, dashboard and every report have a **Select Truck Batch** dropdown (All Batches / New Batch / Old Batch).

### Trip Status (calculated)

| Condition | Trip Status |
|---|---|
| Invoice Status = Internal Client | **Internal Client** |
| Payment Status = Paid | **Closed** |
| Payment Status = Advance with an advance amount | **Part Paid - Balance Due** |
| Invoice Status = Invoice Sent and not paid | **Awaiting Payment** |
| Otherwise | **Invoice Not Sent** |

## Client Price List

The actual **June Price List** is loaded: 242 lanes for Jamara, Mega Manu (45T long-haul plus 30T/40T/45T local lanes), SASO, Natural Beauty (June and August prices), Vendara, Ilera Agro, K&D, Interstyle, I'HS, JMG, Lacasera (palletised 45T) and JAT (Jubaili Agrotec). Rows marked *Price Not Approved* were not imported; the Lacasera per-case (35cl/60cl) tariff was not imported because it is priced per case, not per trip.

How a trip finds its rate: client (name, code or alias such as "Mega Manu-Local"), loading origin and destination (exact, by zone such as GBAGADA → Lagos, or as a member of a zone list such as "VI-Lekki-AJAH"), the rate in force on the dispatch date, and the contract type / tonnage ("45" on a trip matches "45T"). When the trip has no contract type and several tonnages exist for the lane, the trip shows **Multiple rates — choose**. Prices listed including VAT (SASO's "PLIST INL VAT") are converted to the trip's VAT basis before comparison.

Administrators add, edit or version rates, import a new price list (the JMG layout is recognised sheet by sheet, repeated header rows included) and maintain the **Location zones** in Settings.

## Invoices

1. **Generate invoice**: pick the client, Month From / Month To and the **Invoice Price Type** (Price Excluding VAT or Price Including VAT). The app lists every trip of that client dispatched in the period that is not Paid and not already on an invoice, grouped by date, all pre-selected. One invoice never mixes VAT treatments: trips already sent on the other basis must be invoiced separately.
2. The invoice number is generated as **client code + first trip date + sequence** (e.g. `MAM-260930-01`). Type over it to use a manual number. A number that already exists is refused, so two unrelated invoices can never share a number.
3. The invoice is created as **Draft** and every trip receives the generated invoice number. **Mark as Sent** sets the trips' Invoice Status to *Invoice Sent* (Trip Status becomes *Awaiting Payment*). **Void** releases the unpaid trips for a new invoice.
4. **Download PDF** produces the A4 JMG-branded invoice: logo, company name, address, phone, email, TIN and RC number from Settings, bill-to block, the trip lines with net, VAT and total per line, subtotal before VAT, VAT, invoice total and remittance details. Line figures and totals are saved with the invoice, so the PDF can be regenerated at any time without touching historical values. Browsers can print the PDF once downloaded.

## Payments and statements (Finance)

* **Record payment**: choose the client (and optionally the invoice), enter the amount received, date, method and reference. The app allocates the money to the unpaid trips oldest-first: fully covered trips become **Paid**, a partly covered trip becomes **Advance** with the amount received, exactly as the workbook's Amount Paid formula expects. Every receipt is kept in the payments ledger.
* **Client statement**: trips, billing, payments received and balance pending for one client, all months or one month, with PDF and Excel downloads.
* **Outstanding balances**: every client with a balance pending.

## Dashboard and Reports

The dashboard shows total trips, sales, VAT, payments received, outstanding balance, trips awaiting payment, trips not yet invoiced and trips priced below the agreed rate, then **Sales Performance by Truck Batch**: total sales, trips, trucks, average sales per truck and per trip, payments received and outstanding receivables for New Batch, Old Batch and Total, with monthly New vs Old sales, percentage contribution and top trucks per batch. A **Basis** selector switches between net sales (excluding VAT) and gross invoiced (including VAT); payments and receivables are always gross. Filters: date range, client, vehicle type, cost center, truck batch, vehicle, contract type, payment status, invoice status.

Reports reproduce the workbook sheets from the live database: **Client Summary**, **Statement (all clients)**, **Monthly Sales Summary** (Type of Vehicle × month), **Sales by Vehicle** (truck × month), **Price Variance** and **Unpaid trips**. Every report exports to Excel.

## Setup

* **Clients**: master list with the invoice code prefix and default contract type.
* **Asset List**: plate → asset code, type of vehicle, category, **Truck Batch** (with an effective date and history) and cost center; these fill in automatically on every trip.
* **Users & Roles**: administrators add users, change roles, disable accounts and reset passwords.
* **Settings**: company name, address, phone, email, TIN, RC number and **logo** for invoices, VAT rate, payment terms, bank details, location zones and locations list.
* **Audit Trail**: who changed what and when, with previous and new values. Each trip also carries its own history.

## Working together

Everyone works on the same central database. A change saved by one person appears on every other screen within seconds (the green dot in the sidebar pulses when an update arrives). If two people edit the same trip at the same time, the second save is stopped with a comparison of both versions and a choice to keep, discard or overwrite, so nobody's work is lost silently.
