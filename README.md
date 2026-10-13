# Haulage Billing Desk

Web conversion of the **Haulage Billing Sheet (September R2)**, the **June Price List** and the **Truck Planning Management** workbooks into one multi-user application: Fleet Movement Report, client transport requests and truck allocation, Trip Log with Agreed Client Price and variance tracking, waybill and invoice workflow automation, payments, statements, dashboards and reports, with role-based accounts and an audit trail.

**Live demo:** https://claude.ai/artifact/4DDZWqX8UmbSfrnwx6yF5G (shared database; demo accounts in [docs/USER_GUIDE.md](docs/USER_GUIDE.md)).

## What is in the box

| Area | Delivered |
|---|---|
| Workbook analysis | [docs/WORKBOOK_ANALYSIS.md](docs/WORKBOOK_ANALYSIS.md) — every sheet, formula, validation and the ambiguities found; [docs/COLUMN_MAPPING.md](docs/COLUMN_MAPPING.md) — Excel column → database field |
| Data | 3,708 historical trips, 60 vehicles, 56 clients and 491 locations imported from the workbook; selling prices untouched; original file kept in `data/workbook/` |
| Trip Log | Spreadsheet-style grid, frozen headings/columns, inline editing with explicit Save, filters, search, sort, Excel import (duplicate detection) and export |
| Agreed Client Price | The actual June Price List (242 lanes, 12 clients) loaded; lookup by client (incl. aliases) + origin + destination (zones and zone lists) + vehicle type + contract type/tonnage on the trip date; documented priority rule; "No Agreed Rate Found"; manual pick when rates tie; VAT-inclusive list prices converted to the trip's basis |
| Selling Price | Manual entry only; VAT, billing and balances computed from it; variance ₦ and % with green/red/neutral display |
| Invoices | Workbook Invoice Generator rules; **Invoice Price Type** (Price Excluding VAT adds 7.5 %, Price Including VAT extracts it) saved per invoice and trip; client-code + date numbering with manual override and duplicate protection; Draft → Sent → Paid / Void; JMG-branded A4 PDF (logo, company details, TIN/RC) regenerated from saved figures |
| Truck Batch | New Batch / Old Batch per vehicle with effective dates; snapshotted on each trip; **Select Truck Batch** filter on Trip Log, dashboard and every report; **Sales Performance by Truck Batch** dashboard with KPI table, monthly New vs Old, contribution % and top trucks; net (excl. VAT) vs gross (incl. VAT) basis selector |
| Payments | Receipts allocated to trips oldest-first (Paid / Advance exactly as the workbook formulas), ledger, client statements (PDF/Excel), outstanding balances |
| Reports | Four-section Management Dashboard (Fleet Operations, Fleet Planning, Billing & Documentation, Financial Performance), Client Summary, Statement, Monthly Sales Summary, Sales by Vehicle, Price Variance, Unpaid trips, Outstanding waybills, Trip-to-billing pipeline; all exportable |
| Fleet Movement Report | Live truck statuses with configurable status groups, back-on-ground / committed-until / free-from dates ported from the FMR formulas, Tracking Update Overdue, delivery and return verification flags, double-booking detection, six availability categories |
| Requests & allocation | Client transport requests with generated Request IDs and Requested / Allocated / Deployed / Still Required counts; allocation planner ranking suitable trucks by availability, repositioning, body/tonnage fit and existing commitments; allocate / reassign / cancel with audit; double allocation blocked; Allocation IDs; route register with turnaround and margin |
| Fleet Planning Dashboard | KPIs, category/status charts, trucks needing attention, daily and weekly Fleet Availability Runway |
| Trip integration | **Select from Fleet Planning** (Billing, Operations, Planning; searchable; linked allocations reopen their trip; one allocation → one trip with an authorised split) creates Trip Log entries from allocations (Request ID → Allocation ID → Trip ID → Trip → Invoice chain); Power Apps Trip IDs validated and unique, never generated, with a Power Automate endpoint; waybill-later workflow with document upload and automated waybill statuses; automated invoice statuses (Draft → Issued → Sent → Voided, Internal Client) with separate issue/sent dates; payment status separate; credit notes for authorised corrections |
| Users | Administrator, Operations, Tracking Officer, Fleet Planner, Billing, Finance, Management; field-level permissions; audit trail with old/new values |
| Back ends | Shared claude.ai database (demo), Node 22 + SQLite server with server-side permissions, or local browser mode |

## Run it yourself

```bash
node server/seed.js          # one-off: load workbook data + demo accounts into data/haulage.db
node server/server.js        # http://localhost:8080
npm test                     # engine tests (totals reconcile to the workbook to the cent)
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for HTTPS hosting and backups, and [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for the team guide.

## Project layout

```
index.html              application shell (published as the demo page)
css/app.css             theme (light/dark), grid, forms, invoice document
js/core/engine.js       all business rules — shared by browser, server and tests
js/core/sample_rates.js illustrative agreed rates (demo only)
js/store/               storage adapters: common, local, api (server), artifact (shared db)
js/ui/                  views: trips, rates, invoices, payments, reports (+dashboard), admin, app shell, charts, exporter
server/server.js        Node + SQLite API with sessions, RBAC, audit and change feed
server/seed.js          database seeding
tools/                  workbook extraction (openpyxl) and seed builders
data/workbook/          original workbook + extracted JSON
tests/engine.test.js    validation against the workbook's cached values
docs/                   analysis, mapping, user guide, deployment
```

## Known limitations

* In the shared-database demo, permissions are applied by the application; anyone the artifact owner gives write access to could, in principle, write to the database directly. The Node server enforces every rule server-side and is the recommended production path.
* Power Apps could not be connected from the delivery environment; Trip IDs are entered manually or posted by Power Automate to the documented endpoint (docs/DEPLOYMENT.md).
* The FMR demo data is the workbook snapshot re-dated to the import day (docs/WORKBOOK_ANALYSIS.md, Phase 3).
* Excel/PDF generation uses browser libraries loaded from a CDN; when offline, exports fall back to CSV and PDF is unavailable.
* Invoice PDF layout is a clean standard document; company logo/letterhead can be added in `js/ui/exporter.js`.
