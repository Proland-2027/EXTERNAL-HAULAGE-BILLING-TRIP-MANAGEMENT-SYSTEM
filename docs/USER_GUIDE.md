# Haulage Billing Desk — Team User Guide

## Signing in

Open the demo link in Chrome (desktop, tablet or phone) and sign in with your individual account.
Demo accounts (change the passwords in **Users & Roles** before real use):

| Role | Username | Password | What the role can do |
|---|---|---|---|
| Administrator | `admin` | `Admin@2026` | Everything: settings, users, price list, all records |
| Operations Team | `ops` | `Ops@2026` | Create trips; edit dispatch, delivery, vehicle, client, route, journey plan, waybill |
| Billing Team | `billing` | `Billing@2026` | Select allocated trucks into the Trip Log, enter **Selling Price**, waybill details, quote/SO numbers; verify waybills; generate, issue and send invoices; credit notes |
| Finance Team | `finance` | `Finance@2026` | Payment status, advances, record payments, statements, outstanding balances |
| Management | `manager` | `Manager@2026` | Dashboards, reports, price-variance review, audit trail (read-only) |
| Tracking Officer | `tracking` | `Tracking@2026` | Update truck statuses on the Fleet Movement Report; read everything else |

Dispatch rights: Operations prepares, approves and records issues (Operations Manager); the Fleet Planner prepares forms and raises supplementary requests; Finance gives the finance approval and may record issues; administrators manage the Route Distance Master, Location Master and consumption matrix.
| Fleet Planner | `planner` | `Planner@2026` | Log client requests, allocate / reassign / cancel trucks, create trips from allocations, enter Trip IDs |

Operations has the planner's rights too; Billing additionally verifies waybills and issues / sends invoices.

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

## Fleet Movement Report (FMR)

*Fleet → Fleet Movement (FMR)*. One row per truck with its operational status, the time and officer of the last update, the route it is running, and the calculated **Back on ground**, **Committed until** (allocations), **Free from**, confidence and **availability category**. Tiles at the top count available / on trip / workshop / tracking-overdue / unconfirmed / double-booked trucks; click a tile to filter.

* **Update** opens the truck: choose the status (the list and its groups are configurable in Settings → Fleet planning), the date/time of the status (stamped automatically when the status changes), client, route, loading date, destination, estimated delivery / offloading / return, workshop release or days down, driver, Power Apps Trip ID and remarks. The right-hand panel shows the recalculated dates and every warning before you save.
* **Warnings** appear automatically: *Tracking Update Overdue* (no update within the configured hours), missing dates, outbound longer than the run (*confirm delivery*), past its estimated return with no update since (*needs tracking verification*; the truck is **not** counted as available until *Confirm back* is clicked), double bookings, idle trucks, body type / tonnage not set.
* **By availability** groups the fleet into the six categories; *Available and Unplanned* is what the planner can promise today.
* **Add truck to FMR** adds a vehicle from the Asset List; *Export Excel* downloads the report as shown.

## Requests & Fleet Allocation

*Fleet → Requests & Allocation*.

* **Client requests**: *New request* takes the client, a route from the register (or typed loading point / destination), truck type and tonnage, number of trucks, requested loading and delivery dates, priority, contact and instructions. The **Request ID** is generated (client code + sequence) and never reused. Each row shows **Requested / Allocated / Deployed / Trucks still required** separately and a status derived from the allocations.
* **Allocation planner** (*Plan N trucks*): every truck ranked by when it can load — free-from date plus repositioning days from where it drops to the loading bay — with *fits* (body type / tonnage vs the contract), *booked* (already promised over those days), days late and the reasons. Tick the trucks and *Allocate*; a truck promised to another request over the same days cannot be allocated, and trucks that cannot make the date are only allocable after ticking *Allow late loading*. Each allocation gets an **Allocation ID** (ALC-YYMMDD-NN) with planned loading, reaches-client and back-on-ground dates.
* **Allocations & chain**: every allocation with its truck, batch, dates, status (Planned → Deployed → Loaded → Completed / Cancelled), **Trip ID** (or *Pending*), link to the Trip Log and its **chain stage** (Allocated → Linked to Trip Log → Trip ID Assigned → Invoiced → Invoice Sent → Paid). Open an allocation to assign the Trip ID, create the Trip Log entry, reassign the truck (reason recorded), mark it loaded / completed or cancel it (reason recorded).
* **Route register**: the Routes sheet with turnaround (days out / offloading / back), approved price, estimated cost and margin; editable by planners.

## Fleet Planning Dashboard

KPIs (total fleet, available, allocated, on trip, returning today/tomorrow, workshop, open requests, trucks requested / allocated / still required, delayed deployments, tracking overdue, coming free this week), charts by category and status, the trucks needing attention, and the **Fleet Availability Runway**: a daily or weekly grid per truck (free / planned / on trip / down / unknown) with trucks coming free per day and per week. Filters: category, status, truck batch, body type, client, warnings only.

## Trip ID, waybills and the trip-to-billing chain

* **Select from Fleet Planning** (Trip Log toolbar; Billing, Operations and Planning) lists the allocations not yet in the Trip Log, searchable by client, plate, request, allocation or Trip ID. Tick the deployed trucks (one or many) and the trips are created with client, vehicle and asset code, truck batch, route, loading date, Request ID / client reference, Allocation ID and the Power Apps Trip ID when already issued; the allocation moves to *Deployed*. Nothing is re-typed and no invoice is issued by this step; billing completes the selling price, VAT basis and waybill afterwards.
* **One allocation → one trip.** A linked allocation never reappears in the list; tick *Show allocations already in the Trip Log* to search it and **open the existing trip** instead. A second trip for the same allocation (for example a load carried in two legs) needs the *Split allocation* action on the allocation, which only Operations, the Fleet Planner or an administrator can use, with a reason that is written to the audit trail.
* **Trip ID** comes from Power Apps. Enter it on the trip or the allocation (or let Power Automate post it, see docs/DEPLOYMENT.md). It is validated against the configured format and must be unique; the app never generates a replacement. Until then the trip shows *Pending*.
* **Waybill later**: the trip can be saved without a waybill. Add the number when it arrives (entry date stamped), the date the physical copy was received (and by whom), and attach a photo / PDF. Billing clicks *Verify waybill*. The **Waybill Status** moves automatically: Awaiting Waybill → Waybill Number Entered → Waybill Verification Pending → Waybill Verified (or *Waybill Received* when verification is switched off in Settings).
* **Invoice Status** is no longer typed: *Not Invoiced* → *Draft Invoice* (generated) → *Invoice Issued* (**Issue invoice**, date and user recorded) → *Invoice Sent* (**Mark as Sent**: channel, recipient, date recorded separately) → *Invoice Voided* / *Internal Client* (tick on the trip). Requests show *Partially Invoiced* when only some of their trips are invoiced.
* **Payment status** stays separate (Unpaid / Part Paid / Paid); the trip closes financially only when fully settled.
* **Corrections**: a Draft invoice can be voided (its trips become available again); an issued or sent invoice is never edited. Use **Issue credit note** on the invoice instead: the amount is applied to the invoice's trips like a receipt, numbered CN-…, recorded in the payments ledger and shown in the invoice list, while the issued document and its PDF stay as sent. Trips already on an invoice are never offered for a second invoice. The Reports → *Trip-to-billing pipeline* and *Outstanding waybills* tabs list every trip with stage, owner and timestamps.

## Dispatch & Diesel Planning

*Fleet → Dispatch & Diesel*. The continuous workflow is Client Request → Fleet Allocation → Trip Log → Route calculation → Diesel and road-expense calculation → Dispatch approval → Diesel / expense issuance → Trip execution → Waybill → Invoice → Payment.

* **Dispatch forms**: once an allocation is linked to a Trip Log record, *Prepare dispatch form* (Operations / Planner) builds the **Trip Dispatch Authorization Form**: standardised origin and destination states, the approved route distance (one-way, return, total), the truck's consumption category and rate, outbound / return / total diesel, and the road expense allowance at ₦/km. Every figure shows its calculation; an adjustment to the calculated allowance needs a reason. Submit for approval → Operations Manager approves (or rejects with a reason) → Finance approves when the road expenses exceed the threshold.
* **Issuance**: on an approved form, *Record diesel issued* and *Record road expense paid* are recorded separately with references. The initial issue can be recorded once and never above the approved allowance; anything more needs a *Supplementary request* (reason) approved by the Operations Manager. Calculated allowances never count as diesel issued or cash paid until recorded. The form is downloadable as a PDF.
* **Trip expense control**: budgeted vs approved vs actual diesel (initial, supplementary, consumed) and road expenses, with variances and exceptions highlighted.
* **Assistant & checks**: ask the management questions (trips awaiting diesel, diesel for tomorrow, road expenses for the next seven days, routes consuming most diesel, trucks above allowance, highest variance, diesel for planned trips to a state, available but unallocated trucks, requests at risk of lost sales). Answers come from live records and are labelled as such; approved operational values are never replaced by a recommendation. Automatic checks list duplicate routes, inconsistent state names, implausible distances, wrong consumption categories, duplicate or excessive diesel and missing approved distances.
* **Dashboard**: planned trips, awaiting approval, approved awaiting diesel, diesel required / issued, road expenses required / paid, supplementary requests, variance by truck, diesel by category and route, available trucks not planned, confirmed lost sales, with filters for date, client, vehicle category, truck batch, route and station.

## Lost Sales

*Fleet → Lost Sales*. Every cancelled request with trucks still required becomes a record: **Lost Sales = unfulfilled trucks × agreed client rate** (price list first, then the route register). Records are classified as *Confirmed lost sale*, *At risk* or *Not a lost sale* (the cancellation reason suggests the class; it can be changed). Open requests that still lack trucks show live as *At risk*. Reports by client, route, month, station, vehicle type and reason, exportable.

In **Requests & Allocation**, tick requests (or *Select all visible*) and use **Cancel selected requests**: choose the reason, classification and department, add remarks, and confirm whether allocated trucks are released. Cancelled requests are never deleted; the user, time and reason stay in the audit trail.

## Location Master and Route Distance Master (Settings)

* **Location Master**: every loading / delivery location typed anywhere is mapped to a Nigerian state (Apapa → Lagos, Fagge → Kano, Ilesa → Osun, Port Harcourt → Rivers, Abuja → FCT…). Exact matches are approved automatically; spelling matches, zone lists spanning several states and unknown names wait for an administrator to approve or correct them. The original text is always kept; the standardised states drive reports, route grouping, distances and fuel.
* **Route Distance Master**: road distances from JMG Gbagada, Lagos to a reference point in every state (one-way, return, two-leg). Suggested distances (routing service or reference atlas) are marked unverified until an administrator approves them; approved distances are used automatically by every dispatch form. A trip starting from another station uses its own origin state. *Suggest from routing service* asks the road-routing service when the server or browser can reach it.
* **Diesel consumption matrix**: Haulage 45T 0.50 L/km, Jumbo 30T / 102 CBM 0.45 L/km, Flatbed 0.42 L/km, road expenses ₦25 per km, finance approval threshold; all editable by an administrator.

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

## Management Dashboard and Reports

The Management Dashboard has four sections: **1 Fleet Operations** (FMR KPIs), **2 Fleet Planning** (requests, allocations, trucks still required, delayed deployments, allocated-not-in-Trip-Log, awaiting Trip ID), **3 Billing & Documentation** (trips awaiting waybill, verification pending, completed trips not invoiced, drafts, issued-not-sent, sent-awaiting-payment) and **4 Financial Performance** (sales, VAT, payments, receivables, Sales Performance by Truck Batch). Tiles are clickable.

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
