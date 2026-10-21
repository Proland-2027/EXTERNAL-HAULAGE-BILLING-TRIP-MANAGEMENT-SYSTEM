# Acceptance test – demo scenario

Created by Administration → Demo scenario (`JMG_Seed::scenario()`), reproducible on any installation.
Figures below come from the engine run on the bundled workbook with the default settings
(480 min/day, Mon–Fri, 1 shift, next-day batch transfer, current productivity, demo opening stock:
60 + 25 steel sheets, 150 kg powder, 2 × BASE-400SRS, 10 × KIT-P22).

## Scenario
1. **Sales** (`sales.demo`) submits four requests: 20 × SPGP22 (Normal), 10 × SPGP65-OPT (Urgent),
   6 × SPGP110-OPT (Normal, left awaiting planning), 4 × SPGP200 (Critical).
2. **Planner** (`planner.demo`) generates and confirms the plans for SPGP22, SPGP65-OPT and SPGP200.
   They compete for Base_Cutting, Base_Welding, Panels_*, General Welding, Door and Roof Grinding,
   Canopy Pwc, JMG gensets_*, STC_Day, Finishing and Packaging, and for Punch 1 / Punch 2 / Plasma.
3. **Supervisor** (`supervisor.demo`) records the first production day of the SPGP22 order:
   panel cutting 20/20, base cutting 20/20, canopy cutting & bending 16 of 20 (1 rejected, 90 min
   Punch 2 breakdown).

## Results – 20 × SPGP22 (order PO-…-0001)

| Check (brief §17) | Result |
|---|---|
| 1. BOM identified | 183 component lines, 8 manufactured semi-finished items: SF-SPF400SRS (canopy), CPNL-400SRS (empty panel), CMCPNL-P22-DCP (control panel), BASE-400SRS (base tank), SFP-FGWP22 (genset), 143-0851 pipe filler, battery cable assemblies 360-7285/7286; purchased kits KIT-P22, KIT-400SRS |
| 2. Semi-finished quantities for 20 units | 20 of each (quantity per parent 1 at every level); 175 raw-material lines with totals (e.g. 80 sheets MSH1-2MM2000x1220-H, 92 kg powder RAL 9001) |
| 3. Manufacturing requirements per section | 27 operations across 23 sections (23 scheduled, 4 listed without capacity data) |
| 4. Workbook capacities applied | e.g. Canopy Cutting P13-22 45/shift → 10.7 min/unit; Base_Welding SFP-BT-400SRS 44/shift → 10.9 min; Panels_Electrical CMCPNL-P22-DCP 57.5/shift → 8.3 min; JMG gensets_assembly SFP-FGWP22 35/shift → 13.7 min; STC_Day spgP22 90 per 2 shifts → 10.7 min; Packaging spgP22 60/shift → 8 min |
| 5. Shared machine / labour constraints | Punch 1 16 min, Punch 2 15.5 min, Plasma 4 min per 400-series canopy on top of the cutting section; all three orders load the same sections, order 2 and 3 are scheduled around order 1's reservations |
| 6. Departmental schedules | Departmental orders tab: per section, operations with daily targets |
| 7. Earliest completion | Start Monday → finished-product completion after **12 working days** (base, panel and canopy branches in parallel; genset assembly from day 7; STC, finishing, packaging days 10–12) |
| 8. Gantt | Order and global Gantt with dependencies, baseline and progress |
| 9. BOM cost | 2,726,725 NGN per unit (material 2,622,800; labour 28,885; machine 4,932; overhead 70,108) → 54.5 M NGN for 20; ERP reference 824,883 per unit; status Costed |
| 10. Actuals revise the forecast | After the 16/20 canopy cutting day: balance of 4 carried forward, canopy welding/grinding/PWC re-planned, forecast completion 1 working day later than the confirmed baseline, `delay` and `delivery_risk` alerts raised, baseline retained |
| 11. Inventory netting | 2 × BASE-400SRS in stock → base tank operations planned for 18, base materials for 18; 60 sheets MSH1-2MM2000x1220-H allocated of 80 required → shortage 20 on the purchase list; `material_shortage` alert at confirmation; the second order sees 0 available (reserved by order 1) |
| 12. Backflush and undo | Logging 2 good + 1 rejected at Base Powder Coating (final base stage): PRODUCTION +2 BASE-400SRS, 10 ISSUE movements (BOM rows under the base × 3), order shows Received 2, stock on hand 4 / reserved 4; undoing the entry removes the movements and restores on hand 2 |
| 13. Manual stock movements | Receipt, transfer MAIN → IKOTUN, count difference, reversal; over-issue refused ("Only 12 of KIT-P22 on hand…") while negative stock is off |

## Competing orders
SPGP65-OPT × 10 (13 working days) and SPGP200 × 4 (16 working days, bottleneck Base_Cutting) are
scheduled around the SPGP22 reservations; the Dashboard "Current bottlenecks" panel shows the combined
load of the next 10 working days per resource, and each order lists its own capacity-limited days.

## Verification performed
* Explosion quantities checked against the workbook rows (quantity per parent chain) for SPGP22,
  SPGP65-OPT, SPGP110-OPT, SPGP200, MSPGP110.
* Cost roll-up compared with the workbook's ERP total (difference explained by the CKD kit priced at 0
  in the ERP roll-up and by updated unit costs – see DATA_MAPPING.md).
* Routing resolution reviewed per operation (exact / approx / missing flags shown on the order).
* Scheduler: dependencies respected (downstream never ahead of upstream), no resource over 480 min/day,
  parallel branches, replan after actuals keeps logged history.
* Browser test (Playwright, Chromium): every screen for every role (including Store Keeper and the
  Inventory screens), request → proposal → confirm → daily log → dashboard/report flow, stock receipt
  from the posting form; no JavaScript errors.
