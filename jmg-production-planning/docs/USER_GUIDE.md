# User guide

Open `https://<site>/production-planning/` and log in. The left menu shows only what your role may use.

## Roles and responsibilities

| Role | Menu | Responsibilities |
|---|---|---|
| Sales | Dashboard, Sales Requests, Orders (read), Gantt, Reports, BOM | Submit production requests, follow committed and forecast dates, receive delivery-risk alerts. |
| Production Planner | + Production Planning, Daily Tracking | Review demand, generate proposals, adjust, confirm plans, re-plan, record production. |
| Section Supervisor | Dashboard, Daily Tracking (assigned sections), Orders (read), Gantt | Record daily output, rejects, rework, WIP, downtime, manpower, delay reasons. |
| Production Manager | + Planning, Alerts, Audit | Monitor performance and bottlenecks, acknowledge alerts, approve re-scheduling (re-plan). |
| Costing / Finance | BOM & Costing with editable price master | Maintain material prices, labour and processing rates; review product and order costs. |
| Store Keeper | Dashboard, Inventory (post movements, stock take, ledger, shortages, valuation) | Receive purchases and opening stock, issue and return materials, transfer between warehouses, count stock. Planners and managers also hold this right. |
| Administrator | Everything + Masters & Administration | BOM and product masters, capacities, stage map, calendar, users, import, backup, settings. |

## 1. Sales request (Sales)
Sales Requests → **New sales request**. The request number is generated; choose the finished product
(codes from the workbook "Finished Product" sheet, description and category fill automatically),
quantity, requested delivery date, priority (Normal / Urgent / Critical), instructions. Status is
`NEW` until a planner works on it. Sales can edit a request while it is `NEW` or `PLANNED`.

## 2. Planning (Production Planner)
Production Planning lists requests awaiting planning. **Generate plan** explodes the BOM, derives the
routing, applies the workbook capacities, schedules against capacity already reserved by confirmed
orders and opens a **draft proposal** showing:

* committed-vs-requested date, earliest completion, lead time, bottleneck section, planned BOM cost;
* Schedule & operations: every semi-finished component and stage with section, capacity basis
  (exact / approx / override / missing), minutes per unit, planned start/end, dependencies;
* Departmental orders with daily targets, Semi-finished orders, Raw materials, Cost, Gantt, Stock.

Requirements are **netted against stock** before scheduling (Settings → Inventory netting, on by
default): available stock (on hand minus what other confirmed orders have already claimed) is
allocated first to semi-finished items - a sub-assembly taken from stock is not manufactured, so its
operations and its own materials disappear from the plan - and then to purchased materials. The
Semi-finished tab shows *From stock / To manufacture*, the Raw materials tab shows *On hand /
Allocated / Issued / Shortage*; the shortage is the quantity to purchase. Confirming a plan with
uncovered purchased items raises a *material shortage* alert for planning and purchasing.

Manual adjustment: change quantity (drafts only), priority, earliest start, requested date, transfer
rule, and per operation an earliest start date, a minutes-per-unit override or another section, then
**Apply adjustments & recalculate** – downstream operations are rescheduled automatically.
A product can also be planned directly without a sales request.

**Confirm production plan** turns the draft into the operational baseline: capacity is reserved,
baseline dates are frozen for performance measurement, the request becomes `CONFIRMED`, and a
delivery-risk alert is raised for Sales if the committed date is later than the requested date.
**Re-plan all confirmed orders** (Planning screen) reschedules every open order in priority order
after capacity, calendar or data changes.

## 3. Daily tracking (Section Supervisor)
Daily Tracking → choose section and date. The worklist shows the operations planned for that day
(target), overdue balances and remaining quantities. Enter actual good quantity, rejected, rework,
WIP, downtime minutes, manpower, delay reason and remarks → **Save**.

* Production achievement % = actual good ÷ planned × 100 (shown per entry and aggregated).
* When the entry is the **last scheduled stage of a component**, the good units are received into
  stock (PRODUCTION movement) and the materials and sub-assemblies the component consumed are issued
  automatically (ISSUE movements for good + rejected units, "backflush"). The saved message shows how
  many stock movements were posted; undoing the entry removes them again.
* Actual output updates the operation and order progress; shortfalls are carried forward, dependent
  stages and the finished-product forecast are recalculated immediately, the confirmed baseline is kept,
  and alerts are created when the forecast passes the baseline or the Sales date.
* Planners can undo an entry (the order is recalculated).

## 4. Monitoring (Production Manager / everyone)
* **Dashboard**: order counts (total, awaiting planning, confirmed, in progress, completed, delayed),
  finished units in the period, planned vs actual by day, overall achievement, WIP by section,
  resource bottlenecks for the next 10 working days, upcoming completions, open alerts.
  Filters: month / date range, category, department, section, product, status.
* **Gantt**: every open order with its stages, dependency arrows, confirmed baseline (dashed), progress
  (green), delays (red outline), requested date (purple) and today (red). Filters by product, order,
  department, status, completed orders, day width.
* **Alerts**: delivery risk (Sales), delay vs baseline (Planning/Management), daily shortfall; acknowledge when handled.
* **Monthly Reports**: Genset and Canopy planned vs actual finished units, by department/section
  (achievement, utilisation, daily and manpower productivity, rejects, rework, downtime, shortfall days),
  daily productivity, orders with lead times and delay days, delay reasons, on-time completion %.
  **Export to Excel** or **Export to PDF** (print dialog → Save as PDF).

## 5. BOM & costing (Costing / Finance)
BOM & Costing → choose product and quantity: multi-level BOM with code, description, parent, quantity
per parent, per finished unit and total, unit of measure, unit cost, extended cost, assembly roll-ups,
labour, machine and overhead lines, totals and the ERP reference cost. Items without a price show
**Cost Pending**. The **Material price & rate master** tab lets Costing edit unit costs and hourly
rates; the planned cost of new plans uses the updated prices. Order → Cost tab shows planned vs
actual-to-date.

## 6. Inventory (Store Keeper, Planner, Manager)
Inventory keeps a **stock ledger**: every movement is a dated transaction per item and warehouse, and
stock on hand is the sum of the movements.

* **Stock on hand**: every item with stock or with a claim from an open order, by warehouse, with
  *Reserved* (allocated to confirmed orders and not yet issued, plus units those orders produced for
  their own later stages) and *Available* (= on hand − reserved) and the stock value at the price master.
* **Ledger**: all movements with filters by item, type, warehouse, dates, reference; manual postings
  can be reversed (a reversing movement is posted, nothing is deleted). Movements generated by daily
  tracking are reversed by undoing the daily entry.
* **Post movement**: Receipt (purchase / opening stock), Issue, Return, Adjustment (+/−), Transfer
  between warehouses, Count (enter the counted quantity, the difference is posted). Issues and transfers
  beyond stock on hand are refused unless Settings → *Allow negative stock* is on.
* **Stock take**: system quantity per item and warehouse with a counted-quantity field per row.
* **Shortages & purchase list**: for every purchased item required by confirmed orders - required,
  allocated, issued, on hand, shortage, needed-by date (earliest order start) and purchase value.
* **Valuation**: stock value by item type (materials, assemblies, finished) at current unit costs;
  items without a price are listed as unpriced.
* **Item card**: stock by warehouse, reserved, available, the open orders that use the item and the
  item's ledger (also reachable from the order's Stock tab and from the materials list).

Warehouses come from the workbook (BOM *Warehouse* column, e.g. WH-IK-FLI) with a default warehouse for
items without one (Settings → Default warehouse).

## 7. Masters & Administration (Administrator)
* **Sections & productivity**: every workbook section with manpower and the productivity rows per
  product type; edit figures, add rows, set manual overrides, de-activate sections.
* **Cutting machines**: Punch 1 / Punch 2 / Plasma minutes per canopy series and nesting files.
* **Workflow stage map**: BOM operation code → stage, sequence, workflow group, section, machine group.
* **Size classes**: kVA bands linking finished products to the workbook size classes.
* **Capacity overrides**: pin a component/stage to a capacity row or minutes per unit.
* **Working calendar**: working weekdays, holidays, extra working days.
* **Data issues**: everything the workbook does not define (zero productivity rows, missing prices,
  incomplete sub-assembly BOMs). Resolve by entering data, then re-plan.
* **Settings**: working hours, break, net minutes, shifts, transfer rule, capacity basis, cost basis,
  overheads, inventory netting, backflush, negative stock, default warehouse, horizon, currency.
* **Administration**: Excel import, users and roles, backup/restore, audit log, demo scenario.

## Formulas used
* Minutes per unit = net productive minutes per day (480) ÷ productivity per shift from the workbook
  (figures labelled "per 2 shifts" are divided by 2).
* Daily capacity of a resource = 480 min × shifts per day × lines/machines; load = Σ qty × minutes per unit
  over all confirmed orders; remaining capacity is what a new order can use.
* Downstream stage can only process units completed upstream (next day by default), in proportion to
  the BOM quantity per parent; final assembly waits for all mandatory sub-assemblies.
* Production Achievement % = actual good ÷ planned × 100; utilisation = loaded minutes ÷ available minutes.
* Material cost = required quantity × unit cost; Total = Σ raw-material cost + direct labour + machine /
  processing + configured overheads; sub-assemblies are rolled up from their own lines only.
