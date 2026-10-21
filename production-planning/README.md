# Production Planning (WordPress plugin)

A complete, browser-based production planning and costing application for **Genset and Canopy
assembly**, built as a WordPress plugin with its own relational tables, REST API and a single-page
interface. Every number in the system comes from the attached production workbook
(`data/Production_Data.xlsx`): finished-product codes, multi-level BOMs, routings, labour and
machine resources, departmental productivity, cutting-machine capacities and material prices.

The application name is exactly **Production Planning**; no company branding is used.

## What it does

| # | Module | Summary |
|---|--------|---------|
| 1 | Dashboard | Requests awaiting planning / in progress / completed / delayed, monthly planned vs actual, achievement %, WIP by department, capacity utilisation, bottlenecks, expected completion dates, estimated BOM cost of active orders, alerts. Every KPI drills down; filters for month, product type, department, product, status and date range. |
| 2 | Sales Demand | *New Production Request* form (automatic SR number, customer, SO ref, finished-product dropdown from the workbook, automatic description and type, quantity, delivery date, priority, remarks). BOM preview on selection. Only planners confirm schedules. |
| 3 | Production Planning | **Generate Production Plan** explodes the BOM, creates component orders, derives departmental operations from the routing, schedules them against finite daily capacity (8-hour day, existing confirmed load, dependencies, daily transfer batches), identifies the bottleneck and the earliest feasible completion date, and prices the order. Planner adjustments (start date, priority, capacity basis, manpower per department, earliest start / sequence per component) regenerate dependent operations. **Confirm Production Plan** releases the master order, component orders, departmental work orders, daily targets, material list, Gantt and baseline. |
| 4 | Production Orders | Master and semi-finished orders with required / planned / completed / WIP / balance / rejected, baseline vs forecast, children, materials and entries. |
| 5 | Department Work Orders | Operational screen per section with the required columns; supervisors start, record output / rejections / rework / downtime, transfer completed units and close orders. |
| 6 | Work in Progress | Where every component is: received, in process, waiting transfer, in transit, transferred, rejected, expected completion, delays. Interdepartmental transfers with receipt confirmation, partial transfers, duplicate / over-consumption prevention and full movement history. |
| 7 | Production Gantt Chart | Baseline, forecast and actual progress per operation, dependencies, today line; group by sales order, finished product or department; filters by request, product, department, date range. Print / save as PDF. |
| 8 | Daily Productivity | Daily entry screen (date, department, work order, planned, good, rejected, rework, downtime, manpower, delay reason); Achievement % = good ÷ planned × 100; daily / departmental achievement; cumulative vs schedule. Shortfalls trigger automatic re-forecasting and alerts. |
| 9 | BOM Costing | Material, direct labour, machine, overhead and total per unit and per order, multi-level roll-up, material list with unit prices and flags for missing prices, reference to the workbook standard cost, planned vs actual (labour from daily entries, actual material cost recorded on orders). |
| 10 | Monthly Reports | Planned / actual finished products, by product code, departmental performance, daily and monthly productivity, capacity utilisation, WIP, delayed orders, rejected / rework, on-time %, estimated and actual cost. Export to Excel, print / save as PDF. |
| 11 | Master Data & Settings | Products & BOM & routing, departments (manpower, stage), resources (rates, department mapping), capacities & machines, material price master, calendar (holidays, overtime, shifts) & working-hours settings, users & roles, Excel import, data-quality report, productivity history, audit trail. |

## Roles

| WordPress role | Capabilities |
|---|---|
| Sales (`pp_sales`) | view, submit / edit requests, monitor forecasts |
| Production Planner (`pp_planner`) | + generate / confirm plans, adjust, re-forecast, cancel requests |
| Department Supervisor (`pp_supervisor`) | view + start work orders, record output, transfers, receipts (optionally restricted to assigned sections) |
| Production Manager (`pp_manager`) | planner + supervisor rights, audit trail |
| Costing / Finance (`pp_costing`) | view + maintain material prices, record actual material cost |
| Administrator | everything, master data, calendars, users, imports |

Every change is written to the audit trail (`Master Data & Settings → Audit Trail`).

## Installation (any WordPress host with HTTPS)

1. Requirements: WordPress 6.0+, PHP 7.4+ (8.x recommended) with the `zip` and `xml` extensions
   (standard on almost every host), MySQL 5.7+/MariaDB 10.3+, HTTPS enabled by the host.
2. Upload `dist/production-planning.zip` through **Plugins → Add New → Upload Plugin**, or copy the
   `production-planning/` folder to `wp-content/plugins/`.
3. Click **Activate**. Activation creates the tables, roles and the production calendar and imports
   the bundled workbook (about 10–30 s). If the host has a short PHP time limit, open
   *Master Data → Excel Import* and import `data/Production_Data.xlsx` manually.
4. Open **`https://your-site/production-planning/`** (also linked from the WordPress admin menu and
   admin bar). Users without a Production Planning role see an explanatory message.
5. Add team members in *Master Data → Users* (or WordPress → Users) with one of the roles above.
   *Create demo users* creates `sales.demo`, `planner.demo`, `supervisor.demo`, `cutting.demo`
   (restricted to the cutting sections), `manager.demo` and `costing.demo` with password `Demo#2026!`.

Shareable link: `https://your-site/production-planning/` – every user logs in with their own WordPress
account and works on the same live database. Row versions on work orders and transfers, DB transactions
and sequential document numbers prevent duplicate transactions and lost updates.

WP-CLI (optional): `wp production-planning import <file.xlsx>`, `wp production-planning reforecast`,
`wp production-planning demo-users`.

## Importing updated Excel information

*Master Data & Settings → Excel Import* accepts the production workbook (.xlsx) with the same sheet
layout (BOM export, Finished Product, Canopy Assembly, Genset Assembly, Cutting Capacity, Capacity S1…S4,
Capacity200, Capacity500).

* **Update** mode refreshes all Excel-sourced master data and keeps manually created products, BOM
  and routing lines, edited department manpower, manually set material prices and product
  classifications.
* **Replace** mode reloads all master data from the workbook.
* Transactions (requests, plans, orders, work orders, entries, transfers) are never changed by an import.
* The *Data Quality* tab lists everything the workbook does not provide (missing prices, BOM items
  without routing, quantity conflicts, missing manpower, products without a capacity family).

## How the engine works

* **BOM explosion** follows the `Parent Bom` relationships of the workbook across all levels
  (`Calculation Type = BOM` → manufactured sub-assembly, `Item` → raw material). Quantities are
  multiplied down the tree; a component used under several parents gets one aggregated production
  order (no duplication). Status items and material-overhead lines are ignored. Opening stock is
  zero by default; *Net available stock* uses the stock quantity on the product master.
* **Routing** comes from the `Process` lines (labour `LBR DIR`, machine `MCH OVH`). Resources are
  mapped to departments (Ikotun cutting, bending, welding, grinding, base testing, powder coating,
  loom assembly, panel metal / electrical assembly, genset assembly, testing, dispatch; Gbagada
  canopy cutting, bending, welding, grinding, powder coating, exhaust & tank, canopy standing,
  finishing, packaging). Operations are ordered Cutting → Bending → Welding → Grinding → Testing →
  Powder Coating → Sub-assembly → Panel Assembly → Canopy Sub-assembly → Final Assembly → QC →
  Dispatch; only stages present in the routing are used.
* **Capacity** per operation (precedence): productivity row for the exact code → productivity row
  for the department + product family (kVA class / canopy size) → cutting-machine capacity for the
  canopy size → BOM routing hours. Labour minutes per unit = staff × 480 ÷ units/day. The department
  pool is manpower × 480 net minutes per working day (calendar-driven, overtime and shifts supported).
  The planner can switch to *BOM routing hours only*.
* **Scheduling** is a finite-capacity, day-bucket forward scheduler: higher priority requests take
  capacity first, deeper BOM levels first within a request, successors may process on day *D* what
  predecessors finished by day *D-1* (partial transfers), capacity already committed to confirmed
  plans is respected, the same department is never loaded beyond its pool.
* **Delay management**: every production entry (and a daily WP-Cron job) re-forecasts the remaining
  work of the confirmed plan from today, carries forward balances, recalculates dependent
  operations, updates forecast completion dates, flags delayed orders and raises alerts for
  Planning / Sales when the delivery date is at risk. The confirmed baseline is kept for comparison.
* **Costing**: material = Σ quantity × unit price (Material Price Master, seeded from the workbook
  *Unit Cost*, falling back to the standard cost); labour and machine = routing hours × resource
  rate; overhead = workbook `Rate` lines (manufacturing + labour overhead). Multi-level roll-up
  without double counting; missing prices are flagged instead of being treated as zero.

## Assumptions to review

* Product families for capacity matching are derived from the kVA in the description
  (≤22 → P13-22, ≤40 → P33, ≤99 → P50-88, ≤125 → P110, ≤175 → P150-165, ≤275 → P220-275,
  ≤400 → P350, larger → P500) and mapped to canopy sizes S1…S4 / 200-250 / 350-500. Edit per product
  in *Master Data → Products*.
* Department manpower is the sum of the *Staffs* / *Prd Line* columns of the productivity sheets
  (source shown per department). Where the workbook has no figure (e.g. Power Loom Assembly) the
  department is flagged and scheduled with 1 person until corrected.
* Cutting machines (Punch 1, Punch 2, Plasma) are attached to the Ikotun cutting department.
* Currency is NGN (configurable in Settings).

## Development

* Pure PHP + vanilla JavaScript, no build step. Front-end modules live in `assets/js/`.
* `tests/` contains a Playwright end-to-end script (`e2e.js`) used against a local WordPress.
* Local test stack used during development: WordPress + the SQLite Database Integration plugin
  served by the PHP built-in server (see `tests/README.md`).
