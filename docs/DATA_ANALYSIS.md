# Workbook analysis — Prodction Data.xlsx

How each worksheet was interpreted and imported, the relationships found, and what the exception report flags.
Numbers below are from the import of the delivered workbook (`php server/bin/console import`).

## Worksheets and what became of them

| Worksheet | Rows | Imported as |
|---|---:|---|
| BOM | 26,673 | `pp_bom_rows` (every row kept verbatim) + `pp_items` master (1,181 items) |
| Finished Product | 41 codes | `is_finished_product` flag; the only codes Sales can order |
| Genset Assembly | 334 productivity rows | `pp_capacity_rates` by section, model family and code (Ikotun base, panel, genset lines; canopy blocks) |
| Canopy Assembly | 177 productivity rows | `pp_capacity_rates` (Gbagada canopy cutting, bending, welding, grinding, powder coating, STC, glass/GSP, foam, packaging, exhaust, stackers, Lister) |
| Cutting Capacity | 8 models × 3 machines | `pp_cutting_capacity` (minutes per canopy on Punch 1, Punch 2, Plasma; qty per shift; % machine consumed) |
| Capacity S1, S2, S3, S4, 200, 500 | 79 programme files | `pp_cutting_files` (file, parts, minutes, plate) + per-sheet capacity/shift rates |

## BOM structure as found

* **Item number** is the finished (root) item each row belongs to — 112 roots: the 41 finished products plus the
  BSC-*/SFP-* "basic" gensets, stacked canopies (SPF-*) and diesel tanks (DTK-*) that are themselves used as
  sub-assemblies.
* **Parent Bom → Item/Resource** gives the tree; **Level** is the depth (0–5). 321 distinct sub-assemblies; the same
  sub-assembly has the same component list under every root (316 of 321 — the 5 that differ are flagged).
* **Calculation Type** separates material from work: `Item` = material (raw or purchased), `BOM` = sub-assembly with its
  own lines, `Process` = labour or machine time (hours per unit of the parent), `Rate` = manufacturing / labour overhead,
  `Output unit based` = material overhead, `Production` = the root row.
* **Cost columns**: *Cost per lot size* is the standard cost of the consumed quantity (what the sheet rolls up);
  *Unit Cost* (where present) is the latest purchase price per unit; *Total Cost* = consumption × Unit Cost.
  The standard unit cost used by costing is `Cost per lot size ÷ Consumption` (e.g. U-channel 55,499.07 for 16.5 m
  = 3,363.58/m, matching the sheet's 3,363.63 unit price).
* **Status items** (cost group `STATUS ITE`, +1/−1 pairs such as `S-BASE-S3-OPT`) are phantom tracking items with no
  material or cost: 946 rows, excluded from requirements so nothing is double counted.
* **Routing**: the `Process` rows under a sub-assembly are its operations. 36 resources were mapped to 29
  manufacturing sections (`server/src/Seeder.php`), e.g. `IK-BCT-1` Ikotun laser cutting, `GB-CWL-1` Gbagada canopy
  welding, `IK-GAS-1` genset assembly. Every component therefore has its own route; nothing assumes one sequence.

Example — 20 × **MSPGP110** (mobile genset, 100 kVA): 15 production orders (canopy SF-SPF-S3-OPT cut → bend → weld
→ grind → powder coat; base tank BASE-S3-OPT laser cut → bend → weld → grind → test → powder coat; empty control
panel OPT-CPNL-S2 punch → bend → weld → grind → powder coat → panel assembly; alternator cover, pipe filler, cable
assemblies, power loom; genset assembly → pre-test → test → post-test; canopy standing → glass → foam → packaging;
mobile conversion; finished goods receipt), 37 section operations, 185 distinct raw / purchased components
(210 material lines), 18 working days from start to finished goods with the workbook capacities.

## Productivity data and the "primary rate" policy

Three worksheets give productivity for the same work, often with different numbers (e.g. P110 canopy cutting:
Cutting Capacity sheet 16 per shift on Punch 1 vs Canopy Assembly sheet 25/day with 2 staff vs Genset Assembly sheet
8/day). All values are stored; one is marked *primary* and drives the schedule:

* Canopy cutting: the **Cutting Capacity** machine figure (slowest of Punch 1 / Punch 2 / Plasma), then the detailed
  machine sheets, then the assembly sheets.
* Other Gbagada canopy sections: the **Canopy Assembly** sheet's current productivity.
* Ikotun sections (base, panel, genset assembly, testing): the **Genset Assembly** sheet's total productivity.
* "New Productivity" (revised staffing) columns are kept as alternatives.

Lookup order for an operation: exact code (`SFP-FGWP110` → genset assembly) → kVA model (`P110`, ranges such as
`P50-88` expand to P50, P65, P88) → enclosure family (`S3`), taking the lowest rate when several rows match.
When no rate exists the rate is derived from the BOM labour hours and the section staffing and the plan carries a
warning. 194 capacity discrepancies (>15 % between sources) are listed in *Capacity Master → Discrepancies* and the
Exception Report for management validation.

Model families derived from codes: LST (Lister), 400SRS (P13–P25), S1 (P33–P39), S2 (P46–P97), S3 (P110),
S4 (P138–P165), 200-250 (P200–P275), 350-500 (P330–P550), 700-800, 1100+.

## Exception report (after import)

| Category | Count | What it means |
|---|---:|---|
| COST | 328 | 321 materials whose latest unit price differs >5 % from the BOM standard (steel prices moved); 3 zero-cost materials (CKD engine kits); 3 inconsistent standards; all costs dated 17 Feb 2021 → every cost is OUTDATED until confirmed |
| CAPACITY | 196 | productivity differs between worksheets for the same section/model; summary vs machine figures |
| ROUTING | 26 | sub-assemblies with component lines but no labour rows (planned as kitting / purchased) |
| BOM | 7 | 459 repeated (root, parent, component) lines, 5 sub-assemblies whose contents differ by root, phantom items |

Raw material cost status: 399 outdated, 321 price moved, 17 current, 3 zero, 3 inconsistent (of 743).

## Assumptions made (adjustable in the application)

* Working day 08:00–17:00 with a 1-hour break = 480 productive minutes, Monday–Friday; holidays via the calendar.
* Section capacity = lines × 480 minutes shared by all orders; an item's minutes per unit = that pool ÷ its daily rate.
* Partial transfers are allowed between consecutive operations of one order (next section starts the day after the
  previous one starts, limited to what has been produced); final assembly waits for all child orders to complete.
* Finished goods receipt takes one working day after the last operation (setting `fg_receipt_days`).
* Materials are assumed available (zero semi-finished stock by default); inventory netting is optional per plan.
* Costs older than 12 months are flagged OUTDATED; cost snapshots are frozen when a plan is approved.
* Labour and overhead rates are initialised from the BOM Process/Rate rows per section and can be configured.
* Quantities on operations may be fractional for scheduling (a unit may span two days); targets are shown rounded.
