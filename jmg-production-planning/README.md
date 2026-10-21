# JMG Production Planning (WordPress plugin)

A browser-based production planning and manufacturing control system for JMG Genset and Canopy
manufacturing, delivered as a WordPress plugin with its own full-screen interface
(`https://<your-site>/production-planning/`), a REST API and a shared MySQL/MariaDB database.

Everything the application knows about products, bills of materials, sections, manpower,
productivity and machine cutting times comes from the workbook `data/Prodction_Data.xlsx`
(imported automatically at activation and re-importable from the Administration screen).
Figures that are missing in the workbook are **flagged, never invented**.

## What it does

| Area | Capability |
|---|---|
| Sales demand | Sales Production Request screen (auto number, sales ref, customer, product, qty, requested date, priority, instructions). A request never becomes a plan by itself. |
| BOM explosion | Multi-level explosion of the workbook BOM with quantity multiplication at every level, semi-finished components, raw-material list, zero-inventory demo assumption (inventory netting can be switched on). |
| Routing | Manufacturing stages are derived from the BOM's own process rows (e.g. `IK-WBT` = Ikotun base-tank welding) and mapped to the workbook sections through an editable stage map: Cutting & Bending → Welding → Grinding → Powder Coating → Base / Panel / Canopy sub-assembly → Genset assembly → Testing (QC) → Soundproof fitting → Finishing → Packaging. |
| Scheduling | Finite-capacity, day-bucket scheduler. Each section and each cutting machine (Punch 1, Punch 2, Plasma) is a shared pool of productive minutes per day; confirmed orders reserve capacity, so resources are never double booked. Parallel branches, partial-batch transfer (next day / same day / full lot), bottleneck and utilisation analysis, earliest completion date, lead time. |
| Plan confirmation | Draft proposal → planner review and manual adjustment (quantities, priority, start date, per-operation earliest start, minutes-per-unit override, section reassignment, automatic recalculation) → Confirm. Confirmation freezes the baseline and produces master order, departmental orders with daily targets, semi-finished orders, raw-material list, final assembly schedule, committed date vs Sales date and planned BOM cost. |
| Daily tracking | Per-section screen: planned, actual good, rejected, rework, WIP, downtime, manpower, remarks, delay reason. Achievement % = actual good ÷ planned × 100. Actuals update the order, carry balances forward, re-forecast all dependent stages, keep the baseline and raise delay / delivery-risk alerts. |
| Dashboard | Order counts by status, delayed orders, finished units, planned vs actual by day, achievement %, WIP by section, resource bottlenecks, upcoming completions, open alerts; filters by period, category, department, section, product, status. |
| Monthly reports | Genset / Canopy planned vs actual, by department and section, daily productivity, achievement, utilisation, manpower productivity, rejects/rework, downtime, delays and reasons, lead times, on-time %. Export to Excel (SheetJS) or PDF (print). |
| BOM costing | Full multi-level BOM with quantity per unit, unit cost, extended cost, assembly roll-ups without double counting, labour / machine / overhead, ERP reference cost, Cost Pending flags, editable material price and rate master, planned vs actual at order level. |
| Gantt | Interactive SVG Gantt per order and across orders: stages, dependencies, baseline vs current plan, progress, delays, requested dates, today line; filters by product, order, department, status. |
| Access control | WordPress roles: Sales, Production Planner, Section Supervisor (assigned sections), Production Manager, Costing / Finance, Administrator. Every write is audit-logged with user, timestamp and IP. |
| Administration | Excel import/update, user invitations, JSON backup/restore, audit log, working calendar and holidays, capacity editing, stage map, size classes, overrides, settings, demo scenario generator. |

## Layout

```
jmg-production-planning.php      plugin bootstrap
includes/class-jmg-db.php        schema (22 tables, dbDelta)
includes/class-jmg-xlsx-reader.php  dependency-free streaming .xlsx reader
includes/class-jmg-importer.php  workbook -> masters (products, BOM, prices, sections, capacities, machines, stage map)
includes/class-jmg-bom.php       explosion + cost roll-up
includes/class-jmg-routing.php   BOM operations -> stages -> workbook capacity rows (size-class matching, overrides)
includes/class-jmg-scheduler.php finite-capacity scheduler
includes/class-jmg-orders.php    requests, orders, confirmation, adjustments, replanning, alerts
includes/class-jmg-tracking.php  daily production logs and re-forecasting
includes/class-jmg-reports.php   dashboard, monthly report, Gantt data
includes/class-jmg-api.php       REST API  /wp-json/jmg/v1/*
includes/class-jmg-app.php       /production-planning/ shell, admin menu, shortcode [jmg_production_planning]
includes/class-jmg-seed.php      demo accounts + acceptance scenario
assets/app.js, app.css           single-page interface (no build step)
data/Prodction_Data.xlsx         source workbook (imported at activation)
docs/                            deployment, user guide, data mapping, acceptance test
deploy/                          docker-compose + HTTPS (Caddy) + setup script + zip builder
tests/engine-test.php            engine regression test (run inside a WordPress install)
```

## Hosted edition

A ready-to-use multi-user version runs on the claude.ai artifact platform (shared database, no hosting
needed): https://claude.ai/artifact/4eqdTG5R9fhNfmkZcn7HBG — see `hosted-demo/README.md`.

## Install (summary - see docs/DEPLOYMENT.md)

1. Upload the plugin folder (or `deploy/build-zip.sh` output) to `wp-content/plugins/` and activate it.
   Activation creates the tables, roles and imports the bundled workbook (about 30 s).
2. Open **Production Planning** from the WordPress admin menu or go to `/production-planning/`.
3. Administration → Demo scenario creates the test accounts and the 20-unit acceptance scenario.
4. Administration → Users to invite team members; Administration → Excel import to update data.

Requirements: WordPress 6.0+, PHP 7.4+ (8.x recommended) with `zip` and `xml` extensions, MySQL 5.7+/MariaDB 10.3+, HTTPS.

## Demonstration assumptions (all editable)

* Working day 08:00–17:00 with 1 h break = 480 productive minutes, Monday–Friday, 1 shift; rows the workbook labels "per 2 shifts" are halved per shift.
* Zero opening stock of finished and semi-finished goods (inventory netting off).
* Capacity basis = workbook current productivity ("New Productivity" selectable).
* Size classes (kVA bands linking SPGP codes to 400SRS / S1–S4 / P200-P250 / P350 / P550 / P800 and to the canopy cutting series) are derived from the workbook codes and shown under Masters → Size classes.
* Cost basis = workbook "Unit Cost" column (ERP "Cost per unit" selectable). The workbook's ERP roll-up excludes CKD engine kits (e.g. RK-P22 at 0), while its Unit Cost column prices them; both figures are shown.

See `docs/DATA_MAPPING.md` for the complete list of flagged gaps in the workbook.
