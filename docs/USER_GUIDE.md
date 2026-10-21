# User Guide — Production Planning, Manufacturing Tracking & BOM Costing

One connected web application for Sales, Planning, Production, Stores, Costing and Management. Everyone signs in
with their own account and works on the same live data from any modern browser (Chrome, Edge, Safari, Firefox).

## Signing in

Open the site address given by your administrator and sign in. Your role decides what you can change:

| Role | Can do |
|---|---|
| Sales | Create and monitor sales production requests |
| Production Planner | Generate, adjust, run scenarios and approve production plans; maintain capacity |
| Production Manager | Everything the planner can, plus all section dashboards and daily reports |
| Section Supervisor | Enter daily production for their section |
| Store Officer | Record material receipts, issues, returns, rejects and stock adjustments |
| Cost Accountant | Maintain BOM costs, labour and overhead rates, costing reports |
| Management | View every dashboard and report; approve Trip Log pricing exceptions |
| Administrator | Users, settings, workbook import, backups, audit trail |

Change your password from the link under your name (bottom-left). Use **Light / Dark** to switch the theme.

## 1. Sales request → proposed plan (Sales)

**Sales Requests → + New sales request.** Pick the finished product code (the list comes from the workbook's
*Finished Product* sheet, e.g. `MSPGP110`), enter the quantity, requested delivery date and priority, and submit.

The system immediately explodes the complete multi-level BOM, creates a production order for every semi-finished
item, routes each order through its manufacturing sections, schedules everything against available capacity and
shows the **expected finished goods date**. The request now waits in the planning queue.

By default every semi-finished item is produced from scratch (zero opening stock). Tick *Net the requirement against
available semi-finished inventory* when stock should be used.

## 2. Reviewing and approving a plan (Planner)

**Production Plans** lists proposed plans. Open one to see:

* **Overview** — expected date vs requested date, lead time, bottleneck section, critical path, section load,
  planning warnings (e.g. no productivity master for an item) and capacity conflicts with approved plans.
* **BOM explosion** — the full tree with quantities per level and the routing of each sub-assembly.
* **Production orders** — every section operation with required quantity, daily capacity (from the productivity
  master), planned start/finish, actual output, remaining quantity and live status.
* **Section plans** — a separate plan per section (cutting plan, welding plan, powder coating plan, …) showing what
  is received from the previous section, awaiting, daily target and planned completion.
* **Timeline** — Gantt by production order or by section; red outline = critical path; dashed = original approved plan.
* **Materials** — raw material and purchased component requirements with cost flags; export to Excel.
* **Costing** — BOM material cost per unit and for the order quantity, labour and overheads, variance.

**Adjust schedule** changes the start date, overrides a daily capacity or assigns a machine and recalculates.
**Run scenario** creates an alternative version (different start date, quantity, stock netting) without reserving
capacity. **Approve plan** releases the work orders to every section and freezes the baseline date and the cost snapshot.

## 3. Daily production (Section Supervisors)

**Section Dashboards → your section.** Each open operation shows the production order, item, machine, quantity
received from the previous section, quantity awaiting, today's target and the remaining quantity.

Click **Report output**, enter the date, actual good quantity, rejected, rework, downtime, delay reason and remarks.
The system calculates achievement % (good ÷ planned), remaining quantity (required − good) and — when output is
below plan — reschedules the remaining work and recalculates the finished product date. The original approved plan is
kept for comparison; delays appear on the plan, the planning board and the management dashboard.

Partial transfers: the next section can start on what has already been produced, it does not wait for the full batch.

## 4. Planning board (Planner / Production Manager)

**Planning Board** shows every approved plan on one Gantt (by section or by order), the section utilisation heat map
for the next weeks, capacity conflicts, delayed plans and bottlenecks. Open a plan from the list to adjust it.

## 5. Inventory (Store Officer)

**Inventory** shows balances by category (raw materials, cut parts, welded parts, powder-coated parts, base frames,
panels, other semi-finished, finished goods) with opening, receipts, issues, WIP, rejects and available balance.
**+ Record movement** logs opening balances, receipts, issues to a production order, returns, rejects, finished goods
receipts and dispatches. When a production order's last operation completes its output is received into stock
automatically. Issues linked to orders feed the standard-vs-actual material variance.

## 6. BOM costing (Cost Accountant)

**BOM Costing** — choose a finished product and quantity to see material cost per unit and total, the component
breakdown, cost by cost group and by manufacturing section, labour hours and cost, overheads and the full
manufacturing cost (compared with the workbook's own roll-up). Flags show zero, outdated, inconsistent or moved
prices; **update** records an approved new cost with reason and history — plans approved earlier keep their snapshot.
**Labour & overhead rates** are configured separately from material costs. **Item costs & flags** lists all materials.

## 7. Management dashboard (Management)

**Management Dashboard** — daily / weekly / monthly planned vs actual output with filters for product, section, plan
and date range; production KPIs (planned vs actual finished products, achievement %, work orders, delayed, lead time,
WIP); section productivity; costing KPIs (planned BOM cost, cost per unit, actual material consumption, variance, cost
by model). **Export Excel** or **PDF / Print**.

## 8. Capacity master & exceptions

**Capacity Master** holds the productivity rates from the Canopy Assembly, Genset Assembly, Cutting Capacity and
machine worksheets. The *primary* rate per section and model family drives the schedule; *Discrepancies* lists where
worksheets disagree so management can validate. Sections (lines, staff, minutes per day, partial transfer) and the
working calendar (holidays, overtime) are maintained here.

**Exception Report** lists everything the import or planning could not resolve automatically: BOM ambiguities,
cost problems, capacity discrepancies, unmapped routing resources. Mark items reviewed once handled.

## 9. Trip Log — client agreed price

Open **Trip Log (Haulage)**. Every trip now has a **Customer** and a manual **Selling price**; beside it the
**Client agreed price** is looked up from the customer's rate card (route, equipment class, validity dates) and the
**Price variance = Selling − Agreed** is calculated. Trips priced below the agreement, or without a valid rate, are
flagged and listed under **Pricing Exceptions**, where Management approves or rejects each one with a comment.
**Client Rates** maintains the rate cards; customers are managed under Setup. The selling price is never overwritten
and the user who entered or changed it is recorded.

## 10. Administration

**Administration** — users and roles (a supervisor can be limited to one section), settings (company, currency,
working hours, receipt days, cost age threshold), workbook re-import, backups and the audit trail.

## Demonstration scenarios

Load them from *Administration → Workbook import → Load demo scenarios* (or `php server/bin/console seed-demo`):

1. **Production from scratch** — SR-…-0001: 20 × MSPGP110, zero semi-finished stock. Open the plan to see the BOM
   explosion, raw material requirements, 14 semi-finished production orders, section plans, timeline and expected date.
2. **Section productivity** — daily reports already entered for Canopy Cutting, Welding, Powder Coating (and the
   other sections) up to yesterday: see *Section Dashboards* and the plan's *Daily reports* tab.
3. **Production delay** — Genset Assembly produced 8 instead of 20 (engine kits short-delivered): the plan shows the
   revised finished product date against the original approved date, and the delayed operations.
4. **BOM costing** — *BOM Costing* → MSPGP110 × 20 for the per-unit and total cost with component breakdown.
5. **Monthly production** — *Management Dashboard* for the current month: planned vs actual, section productivity,
   delayed orders and material cost; *Trip Log → Pricing Exceptions* for selling price vs client agreed price.
