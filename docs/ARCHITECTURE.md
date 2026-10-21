# Architecture and calculation rules

## Stack
Node.js 22 (`node:http`, `node:sqlite`, `node:crypto` — no third-party runtime packages),
SQLite in WAL mode, vanilla-JS browser application. The haulage Trip Log is a separate application;
its URL can be configured so it appears in the menu.

## Data model (SQLite)
* **Masters**: `products` (112 trees, 41 flagged as sellable from the Finished Product sheet),
  `bom_lines` (every row of the BOM sheet with all 29 columns), `items` (raw / semi / product /
  resource / overhead with standard, latest and approved unit cost + flags), `sections` (9),
  `work_centres` (51, mapped from the productivity blocks), `productivity` (511 rows, all sheet
  columns + weekly plan grid), `model_classes`, `operation_map` (BOM cost group → work centre),
  `cutting_summary` / `cutting_files` / `machines`, `calendar`, `settings`, `import_exceptions`.
* **Transactions**: `sales_requests`, `plans` (versioned per request; baseline, expected, revised
  finish, critical path, bottleneck, summary, warnings), `production_orders` (one per sub-assembly),
  `po_operations` (routing steps with rate, source, class, machine minutes, baseline/planned dates,
  completed/rejected/rework), `po_schedule_days` (daily targets, baseline and current),
  `material_requirements` (cost snapshot per plan), `daily_reports`, `inventory_movements`,
  `item_cost_history`, `audit_log`, `users`, `sessions`, `backups`, `imports`.

## Workbook interpretation
* **BOM**: `Item number` = product tree, `Item/Resource` = component, `Parent Bom` + `Level` + `Line
  number` give the nesting (verified: 0 mismatches). `Calculation Type` *Production/BOM* = assembly
  node, *Item* = material (status items with the −1/+1 phantom pattern are excluded), *Process* =
  labour or machine hours of the parent node, *Rate* = manufacturing / labour overhead, *Output unit
  based* = material overhead. `Cost per lot size` is the ERP standard (dated 2021-02-17); `Unit Cost`
  is the latest price; the difference is flagged.
* **Canopy Assembly / Genset Assembly**: every header block becomes a work centre with one
  productivity row per model class (Type / Finished Code column). Rate used = *New Productivity* when
  present, else the total productivity. Staff, lines and the weekly plan grid are kept.
* **Capacity S1…S4, 200, 500**: Punch 1 / Punch 2 / Plasma file times; **Cutting Capacity**: minutes
  per canopy, output per shift, machine limits. Detail vs summary differences are reported.
* **Finished Product**: the sellable list.

## Model classes
Productivity rows carry type codes like `P50-88`, `SF-C&B-BT-S2`, `SFP-FGWP110`, `spgP13.5`. Each is
parsed into a kVA band; a component is matched first by an explicit class token in its code
(`S3` in `SF-SPF-S3-OPT`), then by the product's P-number falling in the band, then by the nearest
band (flagged). Bands and aliases live in `model_classes` and can be edited.

## Routing derivation
For every assembly node the Process rows (in BOM line order) are mapped through `operation_map`
(cost-group prefix + component family) to work centres; consecutive steps on the same work centre
merge into one operation with labour and machine hours. Nodes without Process rows are *supply*
items (kits, CKD) with an optional supplier lead time.

## Scheduling (server/engine/scheduler.js)
* Working days from the calendar (default Mon–Fri, 480 min). Each work centre offers one
  resource-day per day × capacity factor; an operation producing *q* units at *R* units/day consumes
  *q/R*, so mixed models never double count capacity.
* Cutting operations on the Gbagada canopy line additionally consume Punch 1 / Punch 2 / Plasma
  minutes (from the Cutting Capacity sheet); the slowest machine limits the day's output and the
  discrepancy to the department productivity is reported.
* Inputs: operation 1 of an order waits for its child orders (per-unit factors, transfer batches),
  later operations wait for the previous operation; transfers become available the next working day
  (configurable lag) → partial transfers and parallel flows are natural.
* Orders are served daily in priority order (sales priority, then deeper components first, then
  earlier plans). Existing approved orders are simulated together with a new plan, so a new plan
  only gets the capacity that is really free.
* Results: planned start/finish and daily quantities per operation, expected finished goods date,
  critical path (walked back from the last operation through the binding input or capacity
  constraint), bottleneck (most loaded / most waited-for work centre), utilisation per day.
* Rescheduling after daily reports re-runs the simulation from the next working day with the
  completed quantities; the approved baseline is kept; delay = working days between baseline and
  revised finish.

## Costing (server/engine/bom.js)
* Material cost = Σ leaf items (qty per finished unit × unit cost) through all levels; semi-finished
  nodes are never added on top of their components.
* Unit cost policy: approved → latest → standard (configurable). Flags: ZERO_STANDARD,
  NO_CURRENT_PRICE, PRICE_UP/DOWN beyond the drift threshold, STD_2021.
* Conversion cost = Process hours × rate (BOM rate, or per-work-centre / global labour and overhead
  rates) + Rate rows (MFGOVH, LBROVH) + material overhead. Full manufacturing cost at standard
  prices reproduces the ERP rolled cost of the product (verified in tests).
* Plans store a cost snapshot (`material_requirements`); later approved costs do not change it.
  Actual consumption = inventory issues/returns linked to the plan.

## Security
scrypt passwords, DB-backed sessions (HttpOnly, SameSite=Lax, Secure in production), per-role
permission matrix on every write endpoint, supervisors limited to their sections, origin check on
state-changing requests, audit log of every important change, WordPress SSO via HMAC-SHA256 tokens.
