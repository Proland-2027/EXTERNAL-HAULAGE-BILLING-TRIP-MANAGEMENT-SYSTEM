# JMG Production Planning — Manufacturing Tracking & BOM Costing System

One online application for a genset and canopy manufacturing operation, built from the uploaded
workbook **Prodction Data.xlsx** (BOM, capacities, productivity, finished product list). The haulage
**Trip Log / Billing** application lives in its own repository
(`EXTERNAL-HAULAGE-BILLING-TRIP-MANAGEMENT-SYSTEM`) and can be linked from the menu.

| Area | What it does |
|---|---|
| **Sales demand** | Sales submit a production request (auto number, customer, finished code from the Finished Product sheet, qty, delivery date, priority). The BOM is exploded immediately and a proposed plan with the expected completion date enters the planning queue. |
| **Multi-level BOM explosion** | Per-product trees exactly as exported (26,673 lines, 112 products, 244 sub-assemblies, 846 raw materials). Sub-assemblies are aggregated by code (no double counting), status/phantom items are excluded, raw-material requirements roll up through all levels. |
| **Routings** | Every sub-assembly gets its own routing from the BOM *Process* rows (cutting → bending → welding → grinding → powder coating, base cutting → … → base PWC, panel route, genset assembly → testing, canopy fitting). Nothing follows an assumed sequence. |
| **Capacity scheduling** | Finite-capacity, day-by-day simulation: 480 productive minutes/day, Mon–Fri calendar with holidays, item-specific productivity from the Canopy/Genset Assembly sheets, Punch 1 / Punch 2 / Plasma minutes from the Cutting Capacity sheets, partial transfers between sections, parallel component flows, dependencies, existing orders consuming the same capacity. Produces planned start/finish per operation, daily targets, expected finished goods date, critical path and bottleneck. |
| **Section plans & dashboards** | One plan per section (Cutting & Bending, Welding, Powder Coating, Base Frame, Panel, Canopy Assembly, Genset Assembly, Final QC, FG receipt) with received / awaiting / remaining quantities and daily targets; the Production Manager sees all sections together. |
| **Daily production reporting** | Supervisors enter actual good / rejected / rework / downtime / delay reason. Achievement %, remaining quantity and the revised completion date are recalculated; the approved baseline is kept for comparison. |
| **Planning board** | Gantt by section / work centre / order, utilisation heat-map with conflicts, machine load, delayed orders, what-if scenarios (capacity factors, priorities) with capacity warnings before applying. |
| **Inventory** | Raw materials, cut parts, welded parts, powder-coated parts, base frames, panels, other semi-finished, finished goods: opening, receipts, issues, returns, rejects, WIP; movements linked to production orders; net requirements when stock exists. |
| **BOM costing** | Material cost per unit and per requested quantity, by component, cost group, sub-assembly and section; standard (ERP 2021) vs latest vs approved prices, flags for zero / missing / drifted costs, approved cost updates without changing plan snapshots, labour and overhead configurable separately, standard vs actual consumption variance. |
| **Management dashboard** | Planned vs actual finished products, achievement, work orders (total / completed / delayed), lead time, WIP, section productivity, planned BOM cost, actual material cost, variance, cost by model; daily / weekly / monthly with filters; Excel and print/PDF export. |
| **Platform** | Node 22 + SQLite (no external services), role-based users, audit trail, automated backups, Excel import/export, WordPress single sign-on plugin, Docker / Render / Fly / systemd deployment. |

## Run it locally

```bash
node --version      # 22.5 or newer (uses the built-in SQLite module)
npm start           # http://localhost:8080 — imports data/source/Prodction Data.xlsx on first start
npm test            # engine and API tests
```

Sign in with one of the demo accounts (change them in Admin → Users):

| Role | Username | Password |
|---|---|---|
| Administrator | admin | Admin@2026 (or `ADMIN_PASSWORD`) |
| Sales | sales | Sales@2026 |
| Production Planner | planner | Planner@2026 |
| Production Manager | prodmgr | Prodmgr@2026 |
| Section Supervisors | cutting / welding / coating / assembly | Cutting@2026 / Welding@2026 / Coating@2026 / Assembly@2026 |
| Store Officer | stores | Stores@2026 |
| Cost Accountant | costing | Costing@2026 |
| Management | management | Manage@2026 |

Set `SEED_DEMO_USERS=0` to create only the administrator.

## Deploying to a shareable HTTPS URL

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Docker image, `render.yaml` (one click on Render with
a persistent disk), `fly.toml`, or a VPS with nginx + certbot. The WordPress plugin in `wordpress/`
embeds the application in your WordPress site and signs WordPress users in with their mapped role.

## Documentation

* [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — how each team uses the system, including the five demonstration scenarios.
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — data model, planning engine, scheduling rules, costing rules.
* [docs/DATA_IMPORT_REPORT.md](docs/DATA_IMPORT_REPORT.md) — how each worksheet was interpreted and the exception report for administrator review.
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — hosting, HTTPS, backups, WordPress SSO, environment variables.

## Project layout

```
server/index.js          HTTP server, sessions, routing, backups, WordPress SSO endpoint
server/db.js             SQLite schema (node:sqlite), transactions, VACUUM INTO backups
server/auth.js           roles, permissions, scrypt passwords, SSO tokens, demo users
server/lib/xlsx.js       dependency-free .xlsx reader
server/import/           workbook interpretation (all 11 sheets) + loader + exception report
server/engine/           bom.js (explosion, routing, costing) · scheduler.js (finite capacity simulation)
                         classes.js (model-class / productivity resolution) · planner.js · calendar.js
server/api/              REST endpoints: masters, planning, production, inventory, reports, admin
public/                  browser application (vanilla JS, no build step)
wordpress/               WordPress SSO + embed plugin
data/source/             the imported workbook
tests/                   node:test suites
```
