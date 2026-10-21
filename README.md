# Proland — Production Planning, Manufacturing Tracking & BOM Costing (+ Haulage Trip Log)

A multi-user web application for a manufacturer of **gensets and canopies**:

* **Sales demand → automatic production plan** — pick a finished product code from the workbook, enter the quantity,
  and receive the full multi-level BOM explosion, raw material requirements, a production order per semi-finished
  item, a plan per manufacturing section, the manufacturing timeline (Gantt), critical path, bottleneck and the
  **expected finished goods date** — scheduled with finite capacity against every other approved plan.
* **Production execution** — section dashboards, daily production reports (good / rejected / rework / downtime /
  reasons), productivity achievement, remaining quantities, automatic re-planning and revised completion dates while
  the original approved plan is kept for comparison.
* **Inventory** — raw materials, cut / welded / coated parts, base frames, panels, semi-finished and finished goods,
  movements linked to production orders, net requirements against available stock.
* **BOM costing** — material cost per unit and per order, by component, cost group and section; labour and overhead
  configured separately; cost flags (zero, outdated, inconsistent, price moved); approved cost updates with history
  that never change historical plan snapshots; standard vs actual material variance.
* **Management dashboard** — monthly / weekly / daily planned vs actual, section productivity, delayed orders, costing
  KPIs, filters, Excel and PDF export.
* **Trip Log (haulage billing)** — the existing external haulage billing application, now sharing the same login and
  server database, with the **Client Agreed Price** beside the manual Selling Price, variance, flags and management
  approval of pricing exceptions.
* Roles and permissions (Sales, Planner, Production Manager, Supervisor, Store, Cost Accountant, Management, Admin),
  audit trail, workbook import with exception report, backups, WordPress integration.

All data comes from `data/Prodction_Data.xlsx` (BOM, Finished Product, Canopy Assembly, Genset Assembly, Cutting
Capacity and the machine capacity sheets) — see [docs/DATA_ANALYSIS.md](docs/DATA_ANALYSIS.md).

## Run it locally (2 minutes)

Requirements: PHP 8.1+ (with pdo_sqlite, zip, xmlreader) and Node 18+ for the tests.

```bash
npm run setup     # create tables, import the workbook, create test accounts, load the 5 demo scenarios
npm start         # http://localhost:8080   (Trip Log at http://localhost:8080/haulage/)
npm test          # Trip Log engine tests (Node) + planning engine tests (PHP)
```

Sign in as `planner` / `Planner@2026` (all accounts in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Put it online

* **Docker + automatic HTTPS**: `cp .env.example .env`, set `DOMAIN`, then `docker compose --profile https up -d --build`.
* **Any PHP host**: document root `server/public`, `server/config.php` for MySQL, run `php server/bin/console import`.
* **WordPress**: `npm run build:wp` → upload `dist/proland-production.zip`, activate, add `[proland_production]` to a page.

Full instructions, security notes and backup schedule: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
How the team uses it, with the five demonstration scenarios: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Project layout

```
server/public/index.php   front controller: /api/* JSON API, /haulage/* Trip Log, / planning app
server/src/               App, Db (SQLite/MySQL), Auth, Audit, XlsxReader, Importer, Families, Seeder, Calendar,
                          Planner (explosion + finite-capacity scheduling + re-planning), Costing, Inventory,
                          Reports, Backup, DemoSeeder, Api
server/schema/schema.sql  relational schema (prefix pp_)
server/bin/console        migrate | import | seed-users | seed-demo | backup | create-user | reset-password
server/tests/run.php      engine tests (44 checks)
app/                      production planning front-end (vanilla JS, no build step)
index.html js/ css/       Trip Log / haulage billing application (localStorage or shared server mode)
tests/                    Trip Log engine tests (node --test)
wordpress/, scripts/      WordPress plugin wrapper and its build script
docker/, docker-compose.yml  container deployment with optional Caddy HTTPS
data/Prodction_Data.xlsx  the source workbook
docs/                     USER_GUIDE, DEPLOYMENT, DATA_ANALYSIS, DATA_MODEL, BILLING_FORMAT
```

## How the planning engine works (short version)

1. **Explode** the BOM rows recorded under the requested finished product (Parent Bom → Item/Resource, by level).
   Sub-assemblies become production orders (merged per item, dependencies kept), `Item` rows become material
   requirements, `Process` rows become section operations in resource order; phantom status items are skipped.
2. **Capacity** per operation from the productivity master (exact code → model → family → derived from BOM hours),
   converted to minutes per unit of the section's daily pool (480 min × lines); canopy cutting also loads Punch 1,
   Punch 2 and Plasma individually.
3. **Schedule** orders children-first, day by day, consuming remaining section minutes after every other approved
   plan, honouring the working calendar, partial transfers within an order and full completion of child orders before
   assembly. The last operation's finish is the expected date; walking back through the constraining predecessors
   gives the critical path; the longest critical operation (or a section loaded ≥95 % for 3+ days) is the bottleneck.
4. **Re-plan** after each daily report: actual output replaces the plan for reported operations, unreported
   operations before the report date are assumed on plan and flagged, remaining quantities are rescheduled from the
   next working day, and delays are measured against the frozen baseline.

## Haulage billing (original Trip Log) in brief

Price lists with MOQ, billing format and in-house vs contractor comparison are unchanged — see
[docs/BILLING_FORMAT.md](docs/BILLING_FORMAT.md) and [docs/DATA_MODEL.md](docs/DATA_MODEL.md). New: customers, client
rate cards, `Price Variance = Manual Selling Price − Client Agreed Price`, flags for below-agreement / missing / expired
rates, a *Pricing Exceptions* screen for management, and the user who entered each selling price.
