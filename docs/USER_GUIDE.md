# User guide

Open the application URL and sign in. The tabs you see depend on your role; every role can view
everything, editing follows the permissions below.

| Role | Can change |
|---|---|
| Sales | Create / edit / cancel their production requests (until approved) |
| Production Planner | Generate, re-plan, approve and cancel plans; masters (productivity, calendar); report production |
| Production Manager | Everything the planner can, plus apply board scenarios, inventory movements |
| Section Supervisor | Daily production reports for their own sections |
| Store Officer | Inventory movements (receipts, issues, returns, opening balances) |
| Cost Accountant | Approve unit costs, costing settings (price basis, drift threshold, labour/overhead rates), review exceptions |
| Management | Dashboards and reports |
| Administrator | Users, data import, backups, audit trail, everything above |

## 1. Sales demand (Sales)
**Sales requests → New production request.** Pick the finished product code (only codes from the
Finished Product worksheet are offered; the description and Genset/Canopy type fill automatically),
enter quantity, requested delivery date, priority and remarks. On submit the system retrieves the
complete BOM, explodes it, schedules every section and shows the expected finished goods date. The
request now sits in the planning queue as **PLANNED** with a **PROPOSED** plan.

## 2. Planning (Production Planner / Manager)
**Planning → open the plan.** Review:
* **Production orders** – one order per semi-finished item with its routing, quantities (required,
  from stock, to produce), planned start/finish and status. Supplied kits/CKD have no routing and
  appear as *supply*.
* **Section plans** – what each section must produce, received from the previous step, awaiting,
  daily target and completion date, with the day-by-day quantities.
* **Timeline** – Gantt with the critical path in orange and the approved baseline as grey bars.
* **Raw materials** – aggregated requirements with inventory netting and cost flags.
* **Critical path** – the chain that decides the finished goods date and the bottleneck section.
* **Warnings** – machine-vs-productivity discrepancies, fallback rates, unmapped processes.

*Re-plan with options* lets you change start date, priority, inventory netting, transfer batch and
whether Punch/Plasma minutes constrain cutting. **Approve plan** freezes the baseline and releases
work orders to the sections. **What-if planning scenario** (Planning → button) simulates any product
and quantity without saving anything.

## 3. Daily production (Section Supervisors)
**Sections → your section → Report** on an operation: date, actual good, rejected, rework, downtime,
delay reason, remarks. The system checks that you do not report more than was received from the
previous step, records the achievement %, updates remaining quantities and recalculates the rest of
the schedule and the finished goods date. Operations that have not been reported are assumed not
produced and are re-planned from the next day; the approved baseline is kept and the delay is shown
in working days. **Daily report log** lists every entry (planners can undo one).

## 4. Planning board (Planner / Manager)
Gantt by section, work centre or order; section utilisation heat-map (red = above 100 %); cutting
machine load; delayed orders. The **Scenario** panel changes capacity factors (e.g. 2.0 for a second
shift) and plan priorities, warns about work centres that would exceed capacity and compares finish
dates before you *Apply to live schedule*.

## 5. Inventory (Store Officer)
Record opening balances, receipts, issues to production orders, returns and adjustments. Production
output is received into stock automatically from daily reports (finished goods for the top level,
semi-finished categories otherwise). When a plan is generated with *use inventory*, available
semi-finished stock reduces the quantity to produce and raw material requirements show *net to buy*.

## 6. BOM costing (Cost Accountant / Management)
Choose a product, quantity and price basis. The screen shows material cost per unit and for the
quantity, full manufacturing cost (material + labour + machine + overheads), the ERP standard for
comparison, the component-level breakdown with the unit cost used and its source, cost by cost
group, sub-assembly and manufacturing section, and the exception list (zero standard cost, no latest
price, price drift above the threshold, 2021 standard). **Approve cost** stores an approved unit
cost with history; existing plans keep the cost snapshot taken when they were generated. Labour and
overhead rates can be set per work centre (Masters → Work centres) or globally (Masters → Settings).

## 7. Management dashboard
Planned vs actual finished products, achievement %, work orders, lead time, WIP, section productivity,
planned BOM cost, actual material consumption, variance and cost by model, with daily/weekly/monthly
charts and filters for product, section, order and date range. *Export Excel* downloads the series;
*PDF / Print* uses the print layout.

## 8. Masters (Planner / Administrator)
Work centres and the productivity rows imported from the sheets (override a rate, change a capacity
factor), cutting capacity with the detail-vs-summary discrepancies, the working calendar (holidays,
extra days), settings, the import exception report and the item master (inventory category,
supplier lead time, approved costs).

## 9. Trip Log link
The haulage Trip Log / billing application is a separate system
(repository EXTERNAL-HAULAGE-BILLING-TRIP-MANAGEMENT-SYSTEM). Enter its URL under
Masters → Settings → *Trip Log application URL* and a **Trip Log** entry appears in the menu.

## Demonstration scenarios

1. **Production from scratch** – Sales: new request *MSPGP110 × 20*, start date e.g. next Monday,
   inventory ignored. Open the plan: 12 production orders + 3 supplied kits, 185 raw materials, section
   plans, Gantt and the expected date (16 working days with the workbook rates). Approve.
2. **Section productivity** – Sign in as *cutting*, *welding*, *coating*; report actuals on the
   Cutting & Bending, Welding and Powder Coating operations. The section dashboards show planned vs
   actual, achievement % and remaining quantities.
3. **Production delay** – Report fewer units than planned in one section (e.g. 8 instead of 15 at
   Canopy Cutting). The toast shows the new expected date; the plan header shows baseline vs
   revised and the delay in working days; the dashboard lists the delayed order.
4. **BOM costing** – BOM costing → MSPGP110, quantity 20: cost per unit, total for 20, components,
   cost groups, sections, flags.
5. **Monthly production** – Dashboard for the month: planned vs actual, section productivity,
   delayed orders, material cost. The Trip Log agreed-rate comparison is demonstrated in the Trip Log application.
