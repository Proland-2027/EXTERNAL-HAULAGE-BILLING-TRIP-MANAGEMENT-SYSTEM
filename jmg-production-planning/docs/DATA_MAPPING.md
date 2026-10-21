# Workbook analysis and data mapping

Source: `Prodction Data.xlsx` (11 sheets). Import summary from the bundled workbook:

| Imported | Count |
|---|---|
| BOM lines | 26,673 (112 top-level items, 41 of them in the "Finished Product" sheet) |
| Products / codes | 1,274 (112 plannable, 743 materials, process resources, overhead rates, status items) |
| Material prices and labour/machine/overhead rates | 824 (3 Cost Pending, 5 derived from ERP line cost) |
| Production sections | 63 (33 from "Canopy Assembly" / Gbagada, 30 from "Genset Assembly" / Ikotun) |
| Capacity rows (product type × section) | 511 |
| Cutting machine times | 24 (8 canopy series × Punch 1 / Punch 2 / Plasma) + 83 nesting files |
| Flagged data issues | 86 |

## Sheet → table mapping

| Sheet | Content | Tables |
|---|---|---|
| BOM | Exploded multi-level BOM per finished item: Item number (finished), Item/Resource (component), Parent Bom, Level, Line number, Consumption per lot size (qty per parent unit), Unit, Calculation Type (Item / BOM / Process / Rate / Output unit based / Production), Type 1-3, Cost Group, Operation, Warehouse, Cost per unit (ERP line cost), Unit Cost (col. Y), Total Cost, rate (col. AC) | `jmg_bom_lines`, `jmg_products`, `jmg_prices` |
| Finished Product | 41 sellable finished codes | `jmg_products.item_type = FINISHED` |
| Canopy Assembly | Gbagada departments/sections per canopy type (Lister, P13-22 … P500) and per soundproof genset (spgP13.5 … spgP500, Lister sets): productivity per machine/staff, staffs, productivity per shift (some per 2 shifts), available / kept / idle / new staffs, flow lines, new productivity. Weekly columns (Nov. weeks) are planning history and are not imported. | `jmg_sections`, `jmg_capacities` |
| Genset Assembly | Ikotun sections: Base cutting/bending/welding/grinding/testing/PWC, Panels cutting/bending/welding/grinding/PWC/metal/electrical assembly, White goods, Canopy (Ikotun), Genset assembly / pre-test / test / post-test, STC / GSP / PKG; keyed by semi-finished code (SF-C&B-BT-S1, SFP-BT-S1, BASE-S1, CPNL-S1, CMCPNL-P22-DCP, SFP-FGWP22 …) | `jmg_sections`, `jmg_capacities` |
| Cutting Capacity | Minutes per canopy on Punch 1, Punch 2 and Plasma for 400-SERIES, S1, S2, S3, S4, 200-250, 350-500, LST; canopies per shift; % machine time | `jmg_machine_times` |
| Capacity S1 … S4, Capacity200, Capacity500 | Nesting files per machine (parts, plate, minutes) – the detail behind "Cutting Capacity" | `jmg_cutting_files` (reference) |

## How the BOM drives planning

* **Explosion**: starting at the finished item, child rows are followed through `Parent Bom`; quantity
  per finished unit = product of "Consumption per lot size" along the path (lot size = 1 throughout).
  Sub-assemblies (`Calculation Type = BOM`) with process rows are *manufactured*; kits and BOM rows
  without any child rows are *purchased / kitted* and flagged.
* **Routing**: `Process` rows are labour and machine resources with hours per unit of their parent,
  e.g. for `BASE-400SRS`: IK-BCT (laser cutting), IK-BBD (bending), IK-WBT (welding), IK-WBG (grinding),
  IK-TBT (testing), IK-PCP (powder coating). Resource prefixes map to workflow stages (Masters → Stage map):

| BOM operation | Stage | Workbook section providing capacity |
|---|---|---|
| GB-MCM, GB-CCT, GB-BBM, GB-CBD | Canopy Cutting & Bending | Canopy Assembly / Cutting and Bending / Canopy Cutting + machines Punch 1, Punch 2, Plasma |
| GB-CWL | Canopy Welding | Door and Roof Welding / General Welding |
| GB-CGR | Canopy Grinding | Door And Roof Grinders |
| GB-PCP, GB-CPW | Canopy Powder Coating | Canopy Pwc |
| IK-BCT / IK-BBD / IK-WBT / IK-WBG / IK-TBT / IK-PCP (base) | Base cutting → bending → welding → grinding → testing → PWC | Genset Assembly Base_* sections |
| IK-PCT / IK-BBD / IK-WCP / IK-WCG / IK-PCP (panel) | Panel cutting → bending → welding → grinding → PWC | Genset Assembly Panels_* sections |
| IK-CPA | Control panel electrical assembly | Panels_Electical Assembly |
| IK-PCT / IK-BBD / IK-PCP (other parts) | Parts punching / bending / powder coating | White Goods_* sections |
| IK-GAS / IK-GPT / IK-GTT / IK-PTG | Genset assembly → pre-test → test (QC) → post-test | JMG gensets_* sections |
| GB-CST | Soundproof canopy fitting (STC) | Canopy Assembly / STC_Day |
| GB-CGS, GB-CFF | Foam fixing, glass & finishing (GSP) | Finishing Foam Fixing and GSP_Day |
| GB-CPK | Packaging & finished product | Packaging_Day |
| IK-PLA, IK-CDP | Power loom / cable assembly, pipe cutting | *no productivity data in the workbook – listed, not scheduled* |

  Base, panel and canopy branches have no dependency between them and run in parallel; genset
  assembly waits for base + panel (+ loom / parts); soundproof fitting waits for the canopy and the
  tested genset; packaging is the last stage.

* **Capacity row matching** (per component and stage): manual override → series token in the code
  (`OPT-BASE-S2` → S2, `BASE-400SRS` → 400SRS) → kVA of the component (`CMCPNL-P22-DCP` → 22) → size
  class of the finished product → nearest size class (flagged "approx"). No match → flagged "missing",
  operation not scheduled, planner warned.
* **Minutes per unit** = 480 ÷ productivity per shift (rows labelled "Productivity Per 2 Shift" are
  divided by 2). Each section is a pool of 480 min × shifts × lines per working day shared by all orders.

## Size classes (planning assumption, editable)

| Class | kVA band | Canopy cutting series | Evidence in workbook |
|---|---|---|---|
| 400SRS | 13–25 | 400-SERIES | SPGP22 → BASE-400SRS, CPNL-400SRS, SF-SPF400SRS |
| S1 | 26–39 | S1 | SPGP33-OPT → OPT-CPNL-S1 |
| S2 | 40–97 | S2 | SPGP65-OPT / SPGP88-OPT → OPT-BASE-S2, CPNL-S2 |
| S3 | 98–125 | S3 | SPGP110-OPT → BASE-S3-OPT |
| S4 | 126–175 | S4 | SPGP150/165 → BASE-S4-OPT |
| P200/P250 | 176–299 | 200-250 | SPGP200/220/275 → BASE-P200-P220, CPNL-200-220 |
| P350 | 300–450 | 350-500 | SPGP330/400 |
| P550 | 451–600 | 350-500 | SPGP550 |
| P800 | 601–900 | 350-500 | SPGP700/800 |

Products above 900 kVA (SPGP1100-C, SPGM1100-1, SPGP1250, SPGP1500, SPGP2000) have no size class in the
workbook; their operations are flagged "missing" until capacity rows are added.

## Inventory data

* The BOM *Warehouse* column (e.g. WH-IK-FLI, WH-GB-RM) is stored on the product master and used as the
  item's default warehouse for stock movements; items without one use Settings → Default warehouse (MAIN).
* The workbook contains no stock balances: stock on hand starts at zero and is built from receipts
  (opening stock, purchases), production receipts and issues recorded in the application. The demo
  scenario posts a small opening stock (sheets, powder, 2 base tanks, 10 kits) to show the netting.
* Consumption per completed component (backflush) uses the BOM rows directly under the component
  (`Calculation Type` Item / BOM, excluding STATUS ITEM rows) × (good + rejected units).

## Costing data

* Material unit costs come from the BOM column **Unit Cost** (col. Y); 255 codes have more than one value
  in the workbook – the most frequent is used and the conflict is noted in the price master.
* Labour / machine / overhead rates come from the Process and Rate rows (rate column AC, cost per hour).
* The workbook's own roll-up (**Cost per unit** on the level-0 row, e.g. 824,883 for SPGP22) uses older
  ERP prices and carries CKD engine kits (`RK-P22`, 2,098,452 in the Unit Cost column) at 0. The system
  therefore shows both: the estimated cost at current unit prices (default) and the ERP reference.
  Settings → Cost basis switches the calculation to the ERP line costs.
* 3 items have no price anywhere (EXH-FLANGE-6INCH, KIT-EY97, KIT-EM220) → Cost Pending; 5 were derived
  from ERP line cost ÷ quantity and should be verified (RK-PM-P110, KIT-PM-P110-3, three LS alternators).

## Information missing in the workbook (flagged, to be completed by the administrator)

| Issue | Where | Effect |
|---|---|---|
| Productivity 0 / blank | Genset Assembly: STC_Day and PKG (current column 0, only "New Productivity"); Canopy Assembly: Dealers canopy STC, Base Tank 350-500, Exhaust Pot Welding (Lister–P165 rows), 145 l base frames, one Base_Bending row (LST), one White Goods punch row | Rows cannot be used for scheduling until a value is entered or capacity basis is switched to "new" |
| No productivity data at all | Power loom / cable assembly (IK-PLA), pipe cutting & threading (IK-CDP), panel metal assembly (no BOM operation code) | Operations are listed on the order but do not consume capacity |
| Sub-assemblies without component rows (18) | SF-SPF-EY110/138/165/220/275, SF-SPF-EY97, KIT-EY110/138/165/220/275, EXH-FLANGE-10/16INCH, cable 370-4031 | Treated as purchased items; their materials and operations are unknown |
| Finished product lists only gensets | "Finished Product" sheet | Stacked canopies (SPF-*) are plannable as sub-assemblies but are not in the sales list |
| Machine cutting times only for 8 canopy series | Cutting Capacity | Canopy cutting for products outside those series is limited by manpower only |
| Shift definition | Canopy sheet mixes "per shift" and "per 2 shift" | Handled by the imported shift count; verify under Masters → Sections |
