# JMG Transport Management System — Team User Guide

## Signing in

Open the demo link in Chrome (desktop, tablet or phone) and sign in with your individual account.

**Two levels of access on the demo link.** The demo stores its data in the claude.ai page's shared database, so two things decide what you can do: (1) your claude.ai access to the page, granted by the page owner from the page's **Share** menu, and (2) the role of the application account you sign in with. A colleague who opens the link signed out of claude.ai, or who was given view-only access, can read everything but every save is refused, even as *admin*; the app shows a yellow *View-only access* notice in that case. To let a colleague edit: they sign in to claude.ai with their own account, and the page owner shares the page with them with edit (contributor) access. The role then governs what they may change. On your own server deployment (see `docs/DEPLOYMENT.md`) there is no claude.ai layer and the application login alone decides.
Demo accounts (change the passwords in **Users & Roles** before real use):

| Role | Username | Password | What the role can do |
|---|---|---|---|
| Administrator | `admin` | `Admin@2026` | Settings, users, price list, masters, all records (but not the Operations Manager's approvals of additional expenses) |
| CRM | `crm` | `Crm@2026` | Create and edit client requests (Internal Fleet or 3rd Party Contractor), submit them, bulk-cancel with a reason, lost sales, 3PL quotations, contractor selection and assignment |
| Operations Manager | `ops` | `Ops@2026` | Approve fleet plans, approve the release of allocated trucks, authorise category substitutions, approve diesel / road slips, approve or reject additional expenses, approve 3PL costs, map and approve routes, operations-side invoice document override; also everything the planner and station can do |
| Fleet Planner | `planner` | `Planner@2026` | Prepare plans for the Operations Manager, prepare diesel request forms and road expense slips, raise additional expense requests, update the FMR |
| Station Manager | `station` | `Station@2026` | Allocate the truck registration and driver within the approved plan, convert allocations into trips (Trip ID generated), prepare slips, raise additional expenses, record milestones |
| Tracking Officer | `tracking` | `Tracking@2026` | FMR status updates and Excel upload, trip milestones and TAT, close trips operationally |
| Billing Team | `billing` | `Billing@2026` | Select open trips for invoicing, enter **Selling Price**, waybill and POD details, verify waybills and PODs, create / issue / send invoices, credit notes |
| Finance Team | `finance` | `Finance@2026` | Finance approval of road slips above the threshold, record diesel issues and payments, pay approved additional expenses, contractor payments, finance-side invoice document override, receipts, statements |
| Management | `manager` | `Manager@2026` | Dashboards, KPIs, reports, price-variance review, audit trail (read-only) |

Each stage of the workflow belongs to one role: CRM owns the request, the Operations Manager owns the plan and every approval, the Station Manager owns the allocation, the tracking team owns the FMR and milestones, billing owns the invoice, finance owns the money. Attempts outside the stage are refused in the app and on the server.

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

## Client requests (CRM)

*CRM → Client Requests* (CRM, Operations). *New request*: client, client reference, the mandatory **Transport Service Type** (Internal Fleet or 3rd Party Contractor), a route from the approved Route Master or the origin and destination typed, vehicle type and tonnage (or the 3PL equipment, cargo and selling price), number of trucks, loading and delivery dates, priority, contact and instructions. The **Request ID** is generated (client code + sequence) and never reused.

* **Route check**: while you type, the form confirms the approved Route Master entry or shows **Route Not Mapped — Route Approval Required.** An unmapped request can only be saved as *Pending Route Mapping*; it cannot be submitted, planned, allocated or turned into a trip until Operations maps and approves the route (*Fleet → Requests & Allocation → Route Master*, or *Map route* on the request row).
* **Submit for planning** sends an internal request to the Operations Manager (*Awaiting Planning*) and a 3rd Party request to the 3PL module (*3PL Planning*).
* Each row shows the service type, route status, approved plan, **Requested / Allocated / Deployed / Trucks still required** and the live status: Draft → Pending Route Mapping / Awaiting Planning → Plan Approved → Partially / Fully Allocated → In Progress → Completed; Cancellation Requested; Cancelled. *Open* shows the stage chain and every allocation and trip of the request.
* **Bulk cancellation**: tick requests (or *Select all*), *Cancel selected requests*, choose the reason, lost-sales classification and department, add remarks. Requests are never deleted; user, time and reason stay on the record and in the audit trail. A request whose trucks are already allocated becomes *Cancellation Requested* until the Operations Manager approves the release (*Approve release* on the request); the trucks are freed only then.

## Fleet plan approval (Operations Manager)

*Fleet → Requests & Allocation*, *Approve plan* on an *Awaiting Planning* request: the form shows the client requirement, the route with its approved turnaround, the fleet position from the FMR (available, on trip, back today / tomorrow, down, already allocated), how many suitable trucks can load by the requested date, and the candidate trucks with their return dates and existing allocations. Approve the quantity (never more than requested), the vehicle category, tonnage and the station to allocate from; optionally tick suggested trucks. Only the Operations Manager can approve; the Fleet Planner can prepare the plan for approval.

## Truck allocation (Station Manager)

*Allocate* on a *Plan Approved* request lists every truck ranked by when it can load — free-from date plus repositioning days from where it drops to the loading bay — with *fits plan* (approved category), *booked* (already promised over those days), days late and the reasons. Enter the **driver**, tick the trucks and *Allocate*: the station cannot exceed the approved quantity, cannot pick another category (the Operations Manager may authorise a substitution with the override box), and a truck promised to another request over the same days is refused. Each allocation gets an **Allocation ID** (ALC-YYMMDD-NN) with planned loading, reaches-client and back-on-ground dates. Partial allocations leave the request open for the outstanding trucks.

**Allocations & chain**: every allocation with its truck, driver, batch, dates, status (Planned → Deployed → Loaded → Completed / Cancelled), Trip ID and chain stage (Allocated → Linked to Trip Log → Trip ID Assigned → Invoiced → Invoice Sent → Paid). *Convert to trip* (station, planner, operations, billing) creates the Trip Log entry and **generates the Trip ID**; *Convert all* does it for every planned allocation.

**Route Master** (same screen): the centralised list of routes with client, detailed loading and delivery locations, standardised origin and destination states (suggested automatically from the location gazetteer, kept as typed until approved), truck size / equipment, approved outbound, return and total km, approved turnaround days, price and status. Planners map routes as *Pending Approval*; the Operations Manager or an administrator approves them (approver and date recorded). Only approved routes feed requests, diesel and road calculations and TAT targets.

## 3rd Party Contractor (3PL) module

*Fleet → 3PL Contractors*. Requests with the service type *3rd Party Contractor* arrive here with their equipment (Lowbed, Flatbed, Crane 100T / 150T / 80T, 20FT / 25FT / 40FT containers, Hiab), job and cargo description, weight, dimensions, special handling and the client's agreed selling price.

1. **Request quotations** (CRM / Operations): pick the contractors from the register (filtered by equipment); each gets a quotation line.
2. **Record quote**: quoted price per unit, availability, validity, notes.
3. **Select contractor**: the other quotes are marked rejected.
4. **Approve contractor cost** (Operations Manager only): the approved cost per unit with the expected gross margin (selling price − cost) shown; a difference from the quote needs a reason.
5. **Assign contractor and create trips**: one Trip Log entry per unit with its own generated **Trip ID**, contractor plate, selling price and approved cost. JMG diesel and road allowances do not apply; the trips flow into tracking, POD, client invoicing, receivables and reports like any other trip.
6. **Record contractor invoice / payment** (Finance / Operations): invoice number and amount, amount paid, date, method, reference; payment above the approved cost is refused.

Tabs: requests, quotations, contractor register (equipment, contacts, active flag) and profitability (revenue, cost and gross margin per contractor and per trip).
## Fleet Planning Dashboard

KPIs (total fleet, available, allocated, on trip, returning today/tomorrow, workshop, open requests, trucks requested / allocated / still required, delayed deployments, tracking overdue, coming free this week), charts by category and status, the trucks needing attention, and the **Fleet Availability Runway**: a daily or weekly grid per truck (free / planned / on trip / down / unknown) with trucks coming free per day and per week. Filters: category, status, truck batch, body type, client, warnings only.

## Trip ID, waybills, POD and the trip-to-billing chain

* **Trip ID** is generated by the system as `JMG-TRP-YYYY-NNNNNN` when an approved allocation is converted into a trip (or a 3PL request is assigned): one per truck movement, sequential, unique, never typed, overwritten or reused; cancelled trips keep theirs. The Trip Log column and field are locked. Historical Journey Plan IDs from the workbook remain on the old trips.
* **Select from Fleet Planning** (Trip Log toolbar; Billing, Operations, Planning, Station) lists the allocations not yet in the Trip Log, searchable by client, plate, request, allocation or driver. Tick the trucks and the trips are created with client, vehicle, driver, truck batch, route, loading date, Request ID / reference, Allocation ID and the generated Trip ID; the allocation moves to *Deployed*. Nothing is re-typed and no invoice is issued by this step.
* **One allocation → one trip.** A linked allocation never reappears in the list; a second trip for the same allocation needs *Split allocation* (Operations or an administrator, with a reason in the audit trail).
* **Waybill later**: add the number when it arrives (entry date stamped), the date the physical copy was received and attach a photo / PDF; billing clicks *Verify waybill*. Waybill Status: Awaiting Waybill → Waybill Number Entered → Waybill Verification Pending → Waybill Verified.
* **Proof of delivery**: on the trip, record the POD received date, attach the scan, the signed delivery confirmation date (mandatory for clients flagged in *Clients* or globally in Settings) and tick any client-specific documents; billing clicks *Verify POD*. The trip shows *Ready for invoicing* or *Pending documents* with the list of what is missing.
* **Invoice Status** is automatic: Not Invoiced → Draft Invoice → Invoice Issued (**Issue invoice**) → Invoice Sent (**Mark as Sent**) → Voided / Internal Client. **Payment status** stays separate (Unpaid / Part Paid / Paid).
* **Corrections**: a Draft invoice can be voided; an issued or sent invoice is never edited — use **Issue credit note** (numbered CN-…, applied like a receipt, the issued PDF stays as sent).

## Trip tracking and turnaround time (TAT)

*Fleet → Trip Tracking & TAT* (tracking team, operations, station). Every trip created from an allocation or a 3PL assignment is tracked against the **approved route turnaround**. Open a trip and record the six mandatory milestones with date and time (*Now* stamps the current time): Truck Allocated, Truck Loaded, Truck Arrived at Client, Truck Offloaded, Truck Left Client Location, Truck Arrived Back. Milestones must be in order and cannot be in the future; extra events (departed, breakdown, delay, diversion, returned to station) carry a delay reason and comment. The screen shows each segment's duration, the elapsed or total turnaround, the approved target and the variance; statuses are *Within Target*, *Approaching*, *Overdue*, *Completed Within Target* and *Completed Late*. A trip is never completed automatically: after *Truck Arrived Back*, the tracking team clicks **Close trip**, which blocks new additional-expense requests while approved ones stay visible. When a truck loads earlier than the planned date the dispatch date follows the loading milestone. The TAT dashboard gives average turnaround by route, truck and client, trucks currently exceeding the route days, loading / offloading / return delays and compliance %.

## Fleet Movement Report — Excel upload (tracking team)

On the FMR: **Download current FMR** (Excel, with the computed availability columns), **Download blank template** (one row per truck, allowed statuses listed) and **Upload completed FMR** (Excel or CSV). Trucks are matched by Asset Code or Registration; statuses and dates are validated; duplicate rows and unknown trucks are rejected; every proposed change is previewed (current → new) before you click *Import*. Trucks with active allocations or recorded trip milestones are only overwritten after ticking the authorisation box. The upload time, user and row count are recorded and the dashboard shows the **Last FMR update**.
## Diesel request forms, road expense slips and additional expenses

*Fleet → Diesel & Expenses*. For every internal-fleet trip the two allowance documents are prepared, approved and issued **independently** against the same Trip ID; the calculated figures never count as issued or paid until the issue or payment is recorded.

* **Diesel Request Form** (DSL-YYMMDD-NN; planner, station or operations prepares): truck, driver, client, route and standardised states, total approved km from the Route Master (outbound + return), vehicle category and consumption rate (Haulage 45T 0.50, Jumbo 30T / 102 CBM 0.45, Flatbed 0.42 L/km), **Diesel Required = km × rate**, diesel already issued, additional diesel requested, quantity approved (an adjustment needs a reason), diesel station or supplier. Submit → Operations Manager approves or rejects → *Record diesel issued* (quantity, station, date and time, voucher) → Issued → Closed with the actual consumption. More diesel needs an approved *additional request*. PDF per form.
* **Road Expense Payment Slip** (RXP-YYMMDD-NN): the same trip data, **Road Expenses = km × ₦25**, amount previously paid, additional amount requested, amount approved, payment method; Operations Manager approval and Finance approval above the threshold; *Record payment* (amount, method, reference, date). PDF per slip.
* **Additional Trip Expense Requests** (AEX-YYMMDD-NN): a planner or station supervisor requests an expense (toll, repairs, escort, loading labour, …) against an operationally **open** trip with amount, description, reason and supporting document. **Only the Operations Manager** approves or rejects (approved amount, decision note); finance records the payment; the expense is linked to the trip cost record. Duplicate requests and requests on closed or cancelled trips are refused; approved requests stay visible after closure.
* **Trip expense control**: budget vs approved vs actual diesel and road expenses, additional expenses approved and paid, variances and exceptions per Trip ID.
* **Assistant & checks** and the **Dashboard** answer the management questions from live records (trips awaiting diesel, diesel for tomorrow, road expenses for the week, trucks above allowance, requests at risk of lost sales) and list anomalies.

## Invoicing — Select Open Trips for Invoicing

*Invoices → Select Open Trips for Invoicing* (billing). Four tabs: **A Ready for Invoicing** (completed trips with the mandatory documents verified), **B Pending Documents** (completed trips still missing waybill, POD, signed delivery confirmation or client-specific documents — the missing items are listed), **C Draft Invoices** and **D Issued / Sent Invoices**. Tick trips of one client and *Create invoice from selected*; the invoice form pre-selects them, the number is generated and VAT is applied inclusive or exclusive. An invoice whose trips lack documents cannot be issued: the **Issue invoice** button stays disabled until the documents are verified or both the Operations Manager and Finance record a **document override** with the reason (kept on the invoice and in the audit trail). Issue and Sent dates are recorded separately; the JMG-branded PDF regenerates from the saved figures.
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

The Management Dashboard has five sections: **1 Fleet Operations** (FMR KPIs), **2 Fleet Planning** (requests, allocations, trucks still required, delayed deployments, allocated-not-in-Trip-Log), **3 Billing & Documentation** (trips awaiting waybill, verification pending, completed trips not invoiced, drafts, issued-not-sent, sent-awaiting-payment), **4 Workflow KPIs** (open client requests, requests awaiting route mapping / Operations planning / station allocation, available but unplanned trucks, active trips, trucks exceeding route TAT, diesel requests pending approval, diesel approved but not issued, road expense slips pending payment, additional expenses pending the Operations Manager, completed trips ready for invoicing, trips awaiting POD, trips awaiting waybill, draft invoices, invoices issued but not sent, confirmed lost sales, at-risk sales, internal fleet revenue, 3PL revenue and gross margin) and **5 Financial Performance** (sales, VAT, payments, receivables, Sales Performance by Truck Batch — New vs Old Batch). Tiles are clickable and open the module concerned.

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
