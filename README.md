# Haulage Billing Desk

Web conversion of the **Haulage Billing Sheet (September R2)** workbook: a multi-user Trip Log with an **Agreed Client Price** list and price-variance tracking, invoicing, payments, client statements, dashboards and reports, with role-based accounts and an audit trail.

**Live demo:** https://claude.ai/artifact/4DDZWqX8UmbSfrnwx6yF5G (shared database; demo accounts in [docs/USER_GUIDE.md](docs/USER_GUIDE.md)).

## What is in the box

| Area | Delivered |
|---|---|
| Workbook analysis | [docs/WORKBOOK_ANALYSIS.md](docs/WORKBOOK_ANALYSIS.md) — every sheet, formula, validation and the ambiguities found; [docs/COLUMN_MAPPING.md](docs/COLUMN_MAPPING.md) — Excel column → database field |
| Data | 3,708 historical trips, 60 vehicles, 56 clients and 491 locations imported from the workbook; selling prices untouched; original file kept in `data/workbook/` |
| Trip Log | Spreadsheet-style grid, frozen headings/columns, inline editing with explicit Save, filters, search, sort, Excel import (duplicate detection) and export |
| Agreed Client Price | Price-list module; automatic lookup by client + origin + destination + vehicle type (+ contract type) on the trip date; documented priority rule; "No Agreed Rate Found"; manual pick when rates tie |
| Selling Price | Manual entry only; VAT, billing and balances computed from it; variance ₦ and % with green/red/neutral display |
| Invoices | Workbook Invoice Generator rules; client-code + date numbering with manual override and duplicate protection; Draft → Sent → Paid / Void; PDF download |
| Payments | Receipts allocated to trips oldest-first (Paid / Advance exactly as the workbook formulas), ledger, client statements (PDF/Excel), outstanding balances |
| Reports | Dashboard, Client Summary, Statement, Monthly Sales Summary, Sales by Vehicle, Price Variance, Unpaid trips; all from the live database, all exportable |
| Users | Administrator, Operations, Billing, Finance, Management; field-level permissions; audit trail with old/new values |
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
* The agreed rates shipped with the demo are illustrative placeholders (marked in Remarks); load the real contract rates in **Client Price List**.
* Excel/PDF generation uses browser libraries loaded from a CDN; when offline, exports fall back to CSV and PDF is unavailable.
* Invoice PDF layout is a clean standard document; company logo/letterhead can be added in `js/ui/exporter.js`.
