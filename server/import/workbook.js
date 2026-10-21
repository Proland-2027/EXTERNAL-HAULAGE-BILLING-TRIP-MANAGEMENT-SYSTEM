/*
 * workbook.js — interprets the "Prodction Data.xlsx" workbook.
 *
 * Output is plain data (no DB access) so it can be unit-tested and reused for re-imports:
 *   { products, finishedList, bomLines, items, workCentres, productivity, cuttingSummary, cuttingFiles,
 *     operationMap, modelClasses, exceptions }
 */
'use strict';
const X = require('../lib/xlsx.js');

const norm = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
const key = (s) => norm(s).toLowerCase();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null));

/* ------------------------------------------------------------------ sections & work centres */
const SECTIONS = [
  { code: 'CUT', name: 'Cutting and Bending', seq: 1 },
  { code: 'WELD', name: 'Welding', seq: 2 },
  { code: 'PWC', name: 'Powder Coating', seq: 3 },
  { code: 'BASE', name: 'Base Frame Manufacturing', seq: 4 },
  { code: 'PANEL', name: 'Panel / Basic Component Manufacturing', seq: 5 },
  { code: 'CANOPY', name: 'Canopy Assembly', seq: 6 },
  { code: 'GENSET', name: 'Genset Assembly', seq: 7 },
  { code: 'QC', name: 'Final Quality Inspection', seq: 8 },
  { code: 'FG', name: 'Finished Goods Receipt', seq: 9 },
];

/*
 * Work centres = the productivity blocks found in the two assembly worksheets. `blocks` lists the
 * (department | section/type) labels under which the block appears in the sheet.
 * `classify` tells the planner which model-class family the Type column of the block uses.
 */
const WORK_CENTRES = [
  // --- Canopy Assembly sheet (Gbagada canopy plant) ---
  { code: 'GB-CANOPY-CUT', name: 'Canopy Cutting & Bending (Gbagada)', site: 'Gbagada', section: 'CUT', sheet: 'Canopy Assembly', blocks: ['cutting and bending|canopy cutting'], classify: 'CANOPY' },
  { code: 'GB-CANOPY-PWC', name: 'Canopy Powder Coating (Gbagada)', site: 'Gbagada', section: 'PWC', sheet: 'Canopy Assembly', blocks: ['canopy pwc|canopy pwc'], classify: 'CANOPY' },
  { code: 'GB-CANOPY-WELD', name: 'Door & Roof Welding (Gbagada)', site: 'Gbagada', section: 'WELD', sheet: 'Canopy Assembly', blocks: ['door and roof welding|general welding'], classify: 'CANOPY' },
  { code: 'GB-CANOPY-GRIND', name: 'Door & Roof Grinding (Gbagada)', site: 'Gbagada', section: 'WELD', sheet: 'Canopy Assembly', blocks: ['door and roof grinders|door and roof grinding'], classify: 'CANOPY' },
  { code: 'GB-STC', name: 'Soundproof Canopy Fitting – STC (Gbagada)', site: 'Gbagada', section: 'CANOPY', sheet: 'Canopy Assembly', blocks: ['stc|stc_day'], classify: 'GENSET' },
  { code: 'GB-PACK', name: 'Packaging (Gbagada)', site: 'Gbagada', section: 'CANOPY', sheet: 'Canopy Assembly', blocks: ['packaging|packaging_day'], classify: 'GENSET' },
  { code: 'GB-STACK', name: 'Dealer Canopy Stacking (Gbagada)', site: 'Gbagada', section: 'CANOPY', sheet: 'Canopy Assembly', blocks: ['delaers canopy|canopy stacking'], classify: 'CUTCLASS' },
  { code: 'GB-DEALER-STC', name: 'Dealer Canopy STC (Gbagada)', site: 'Gbagada', section: 'CANOPY', sheet: 'Canopy Assembly', blocks: ['delaers canopy|canopy dealers scoa stc'], classify: 'CUTCLASS' },
  { code: 'GB-LST-ELEC', name: 'Lister Electrical Assembly', site: 'Gbagada', section: 'GENSET', sheet: 'Canopy Assembly', blocks: ['lister assembly|lister electrical assembly'], classify: 'LISTER' },
  { code: 'GB-LST-MECH', name: 'Lister Mechanical Assembly', site: 'Gbagada', section: 'GENSET', sheet: 'Canopy Assembly', blocks: ['lister assembly|lister mechanical assembly'], classify: 'LISTER' },
  { code: 'GB-LST-LOOM', name: 'Preparation of AC Looms', site: 'Gbagada', section: 'PANEL', sheet: 'Canopy Assembly', blocks: ['lister assembly|preparation of ac looms'], classify: 'LISTER' },
  { code: 'GB-LST-TEST', name: 'Lister Testing', site: 'Gbagada', section: 'QC', sheet: 'Canopy Assembly', blocks: ['lister assembly|lister testing'], classify: 'LISTER' },
  { code: 'GB-LST-CPL', name: 'Lister Control Panel', site: 'Gbagada', section: 'PANEL', sheet: 'Canopy Assembly', blocks: ['lister assembly|lister control panel'], classify: 'LISTER' },
  { code: 'GB-TANK-1500', name: 'Base Tank Welding – 1500 L Tank', site: 'Gbagada', section: 'BASE', sheet: 'Canopy Assembly', blocks: ['base tank welding 1500 liter|*', 'base tank welding 1500 liter tank|*'], classify: 'LISTER' },
  { code: 'GB-TANK-LST', name: 'Base Tank Welding – Lister Base', site: 'Gbagada', section: 'BASE', sheet: 'Canopy Assembly', blocks: ['base tank welding lister base|*'], classify: 'LISTER' },
  { code: 'GB-FOAM', name: 'Foam Cutting (Gbagada)', site: 'Gbagada', section: 'CANOPY', sheet: 'Canopy Assembly', blocks: ['foam cutting|foam cutting'], classify: 'GENSET' },
  { code: 'GB-FINISH', name: 'Finishing, Foam Fixing & GSP (Gbagada)', site: 'Gbagada', section: 'CANOPY', sheet: 'Canopy Assembly', blocks: ['stc|finishing foam fixing and gsp_day'], classify: 'GENSET' },
  { code: 'GB-EXHAUST', name: 'Exhaust Pot Welding (Gbagada)', site: 'Gbagada', section: 'WELD', sheet: 'Canopy Assembly', blocks: ['exhaust department|exhaust pot welding'], classify: 'CANOPY' },
  { code: 'GB-TANK-350', name: 'Base Tank 350–500 (Gbagada)', site: 'Gbagada', section: 'BASE', sheet: 'Canopy Assembly', blocks: ['base tank 350-500|base tank for 350-500'], classify: 'CANOPY' },
  { code: 'GB-STACK-CUT', name: 'Stackers Cutting Section', site: 'Gbagada', section: 'CUT', sheet: 'Canopy Assembly', blocks: ['stackers cutting section|stackers cutting section'], classify: 'CANOPY' },
  { code: 'GB-STACK-PWC', name: 'Stackers Powder Coating Section', site: 'Gbagada', section: 'PWC', sheet: 'Canopy Assembly', blocks: ['stackers powder coating section|stackers powder coating section'], classify: 'CANOPY' },
  // --- Genset Assembly sheet (Ikotun plant) ---
  { code: 'IK-BASE-CUT', name: 'Base Cutting (Ikotun)', site: 'Ikotun', section: 'CUT', sheet: 'Genset Assembly', blocks: ['base_cutting'], classify: 'BASE' },
  { code: 'IK-CANOPY-CUT', name: 'Canopy Cutting (Ikotun)', site: 'Ikotun', section: 'CUT', sheet: 'Genset Assembly', blocks: ['canopy cutting'], classify: 'CANOPY' },
  { code: 'IK-BASE-BEND', name: 'Base Bending (Ikotun)', site: 'Ikotun', section: 'CUT', sheet: 'Genset Assembly', blocks: ['base_bending'], classify: 'BASE' },
  { code: 'IK-CANOPY-BEND', name: 'Canopy Bending (Ikotun)', site: 'Ikotun', section: 'CUT', sheet: 'Genset Assembly', blocks: ['canopy bending'], classify: 'CANOPY' },
  { code: 'IK-PANEL-BEND', name: 'Panels Bending (Ikotun)', site: 'Ikotun', section: 'PANEL', sheet: 'Genset Assembly', blocks: ['panels_bending'], classify: 'PANEL' },
  { code: 'IK-CANOPY-WELD', name: 'Canopy Welding (Ikotun)', site: 'Ikotun', section: 'WELD', sheet: 'Genset Assembly', blocks: ['canopy welding'], classify: 'CANOPY' },
  { code: 'IK-CANOPY-GRIND', name: 'Canopy Grinding (Ikotun)', site: 'Ikotun', section: 'WELD', sheet: 'Genset Assembly', blocks: ['canopy grinding'], classify: 'CANOPY' },
  { code: 'IK-CANOPY-PWC', name: 'Canopy Powder Coating (Ikotun)', site: 'Ikotun', section: 'PWC', sheet: 'Genset Assembly', blocks: ['canopy pwc'], classify: 'CANOPY' },
  { code: 'IK-WG-SHEAR', name: 'White Goods – Manual Shearing', site: 'Ikotun', section: 'CUT', sheet: 'Genset Assembly', blocks: ['white goods_manual shearing machine'], classify: 'BASE' },
  { code: 'IK-WG-PUNCH', name: 'White Goods – Manual Punch', site: 'Ikotun', section: 'CUT', sheet: 'Genset Assembly', blocks: ['white goods_punch manual'], classify: 'BASE' },
  { code: 'IK-PANEL-CUT', name: 'Panels Cutting (Ikotun)', site: 'Ikotun', section: 'PANEL', sheet: 'Genset Assembly', blocks: ['panels_cutting'], classify: 'PANEL' },
  { code: 'IK-BASE-WELD-S', name: 'Base Welding P13–P165 (Ikotun)', site: 'Ikotun', section: 'BASE', sheet: 'Genset Assembly', blocks: ['base_welding p13 to p165'], classify: 'BASE' },
  { code: 'IK-BASE-WELD-L', name: 'Base Welding P250–P800 (Ikotun)', site: 'Ikotun', section: 'BASE', sheet: 'Genset Assembly', blocks: ['base_welding_p250_p800'], classify: 'BASE' },
  { code: 'IK-WG-WELD', name: 'White Goods Welding (Ikotun)', site: 'Ikotun', section: 'WELD', sheet: 'Genset Assembly', blocks: ['white goods_welding'], classify: 'BASE' },
  { code: 'IK-PANEL-WELD', name: 'Panels Welding (Ikotun)', site: 'Ikotun', section: 'PANEL', sheet: 'Genset Assembly', blocks: ['panels_welding'], classify: 'PANEL' },
  { code: 'IK-BASE-GRIND', name: 'Base Grinding (Ikotun)', site: 'Ikotun', section: 'BASE', sheet: 'Genset Assembly', blocks: ['base_grinding'], classify: 'BASE' },
  { code: 'IK-BASE-TEST', name: 'Base Tank Testing (Ikotun)', site: 'Ikotun', section: 'BASE', sheet: 'Genset Assembly', blocks: ['base_testing'], classify: 'BASE' },
  { code: 'IK-PANEL-GRIND', name: 'Panels Grinding (Ikotun)', site: 'Ikotun', section: 'PANEL', sheet: 'Genset Assembly', blocks: ['panels_grinding'], classify: 'PANEL' },
  { code: 'IK-BASE-PWC', name: 'Base Powder Coating (Ikotun)', site: 'Ikotun', section: 'PWC', sheet: 'Genset Assembly', blocks: ['base_pwc'], classify: 'BASE' },
  { code: 'IK-WG-PWC', name: 'White Goods Powder Coating (Ikotun)', site: 'Ikotun', section: 'PWC', sheet: 'Genset Assembly', blocks: ['white goods_pwc'], classify: 'BASE' },
  { code: 'IK-PANEL-PWC', name: 'Panels Powder Coating (Ikotun)', site: 'Ikotun', section: 'PWC', sheet: 'Genset Assembly', blocks: ['panels_pwc'], classify: 'PANEL' },
  { code: 'IK-PANEL-METAL', name: 'Panels Metal Assembly (Ikotun)', site: 'Ikotun', section: 'PANEL', sheet: 'Genset Assembly', blocks: ['panels_metal assembly'], classify: 'PANEL' },
  { code: 'IK-PANEL-ELEC', name: 'Panels Electrical Assembly (Ikotun)', site: 'Ikotun', section: 'PANEL', sheet: 'Genset Assembly', blocks: ['panels_electical assembly'], classify: 'PANELELEC' },
  { code: 'IK-LOOM', name: 'Power Loom Assembly (Ikotun)', site: 'Ikotun', section: 'PANEL', sheet: null, blocks: [], classify: 'GENSET' },
  { code: 'IK-GENSET-ASSY', name: 'Genset Assembly (Ikotun)', site: 'Ikotun', section: 'GENSET', sheet: 'Genset Assembly', blocks: ['jmg gensets_assembly'], classify: 'GENSET' },
  { code: 'IK-GENSET-PRETEST', name: 'Genset Pre-testing (Ikotun)', site: 'Ikotun', section: 'GENSET', sheet: 'Genset Assembly', blocks: ['jmg gensets_pre_testing'], classify: 'GENSET' },
  { code: 'IK-GENSET-TEST', name: 'Genset Testing (Ikotun)', site: 'Ikotun', section: 'QC', sheet: 'Genset Assembly', blocks: ['jmg gensets_testing'], classify: 'GENSET' },
  { code: 'IK-GENSET-POST', name: 'Genset Post-testing (Ikotun)', site: 'Ikotun', section: 'QC', sheet: 'Genset Assembly', blocks: ['jmg gensets_post_testing'], classify: 'GENSET' },
  { code: 'IK-STC', name: 'Soundproof Canopy Fitting – STC (Ikotun)', site: 'Ikotun', section: 'CANOPY', sheet: 'Genset Assembly', blocks: ['stc|stc_day'], classify: 'GENSET' },
  { code: 'IK-GSP', name: 'GSP (Ikotun)', site: 'Ikotun', section: 'CANOPY', sheet: 'Genset Assembly', blocks: ['gsp|gsp'], classify: 'GENSET' },
  { code: 'IK-PKG', name: 'Packaging (Ikotun)', site: 'Ikotun', section: 'CANOPY', sheet: 'Genset Assembly', blocks: ['pkg|pkg'], classify: 'GENSET' },
  { code: 'FG-RECEIPT', name: 'Finished Goods Receipt', site: 'Store', section: 'FG', sheet: null, blocks: [], classify: 'GENSET' },
];

/*
 * BOM process cost groups → work centre. `family` narrows by the component family of the
 * sub-assembly being made (CANOPY / BASE / PANEL / ASSEMBLY / EXH / DTK / *).
 */
const OPERATION_MAP = [
  { costGroup: 'GB-CCT', family: '*', workCentre: 'GB-CANOPY-CUT', process: 'CUT' },
  { costGroup: 'GB-CBD', family: '*', workCentre: 'GB-CANOPY-CUT', process: 'BEND' },
  { costGroup: 'GB-CWL', family: '*', workCentre: 'GB-CANOPY-WELD', process: 'WELD' },
  { costGroup: 'GB-CGR', family: '*', workCentre: 'GB-CANOPY-GRIND', process: 'GRIND' },
  { costGroup: 'GB-CPW', family: '*', workCentre: 'GB-CANOPY-PWC', process: 'PWC' },
  { costGroup: 'GB-CFF', family: '*', workCentre: 'GB-FOAM', process: 'FOAM' },
  { costGroup: 'GB-CGS', family: '*', workCentre: 'GB-STC', process: 'ASSEMBLE' },
  { costGroup: 'GB-CST', family: '*', workCentre: 'GB-STC', process: 'ASSEMBLE' },
  { costGroup: 'GB-CPK', family: '*', workCentre: 'GB-PACK', process: 'PACK' },
  { costGroup: 'GB-EXHDTPT', family: '*', workCentre: 'GB-EXHAUST', process: 'PAINT' },
  { costGroup: 'GB-EX', family: '*', workCentre: 'GB-EXHAUST', process: 'WELD' },
  { costGroup: 'IK-BCT', family: '*', workCentre: 'IK-BASE-CUT', process: 'CUT' },
  { costGroup: 'IK-CDP', family: '*', workCentre: 'IK-WG-SHEAR', process: 'CUT' },
  { costGroup: 'IK-BBD', family: 'PANEL', workCentre: 'IK-PANEL-BEND', process: 'BEND' },
  { costGroup: 'IK-BBD', family: 'ASSEMBLY', workCentre: 'IK-PANEL-BEND', process: 'BEND' },
  { costGroup: 'IK-BBD', family: '*', workCentre: 'IK-BASE-BEND', process: 'BEND' },
  { costGroup: 'IK-PCT', family: '*', workCentre: 'IK-PANEL-CUT', process: 'CUT' },
  { costGroup: 'IK-WCP', family: '*', workCentre: 'IK-PANEL-WELD', process: 'WELD' },
  { costGroup: 'IK-WCG', family: '*', workCentre: 'IK-PANEL-GRIND', process: 'GRIND' },
  { costGroup: 'IK-WFL', family: '*', workCentre: 'IK-BASE-WELD-S', process: 'WELD' },
  { costGroup: 'IK-WBT', family: '*', workCentre: 'IK-BASE-WELD-L', process: 'WELD' },
  { costGroup: 'IK-WBG', family: '*', workCentre: 'IK-BASE-GRIND', process: 'GRIND' },
  { costGroup: 'IK-GBT', family: '*', workCentre: 'IK-BASE-GRIND', process: 'GRIND' },
  { costGroup: 'IK-TBT', family: '*', workCentre: 'IK-BASE-TEST', process: 'TEST' },
  { costGroup: 'IK-PCP', family: 'PANEL', workCentre: 'IK-PANEL-PWC', process: 'PWC' },
  { costGroup: 'IK-PCP', family: 'ASSEMBLY', workCentre: 'IK-WG-PWC', process: 'PWC' },
  { costGroup: 'IK-PCP', family: '*', workCentre: 'IK-BASE-PWC', process: 'PWC' },
  { costGroup: 'IK-PLA', family: '*', workCentre: 'IK-LOOM', process: 'ASSEMBLE' },
  { costGroup: 'IK-CPA', family: '*', workCentre: 'IK-PANEL-ELEC', process: 'ASSEMBLE' },
  { costGroup: 'IK-GAS', family: '*', workCentre: 'IK-GENSET-ASSY', process: 'ASSEMBLE' },
  { costGroup: 'IK-GPT', family: '*', workCentre: 'IK-GENSET-PRETEST', process: 'TEST' },
  { costGroup: 'IK-GTT', family: '*', workCentre: 'IK-GENSET-TEST', process: 'TEST' },
  { costGroup: 'IK-PTG', family: '*', workCentre: 'IK-GENSET-POST', process: 'TEST' },
];

/* Model classes used by the productivity sheets, with the kVA band they stand for. */
const MODEL_CLASSES = [
  // canopy / enclosure classes (Canopy Assembly sheet "Type")
  { family: 'CANOPY', code: 'Lister', kvaMin: 0, kvaMax: 0, aliases: ['lister', 'lst'] },
  { family: 'CANOPY', code: 'P13-22', kvaMin: 13, kvaMax: 22, aliases: ['400srs', '400-series', '400series'] },
  { family: 'CANOPY', code: 'P33', kvaMin: 33, kvaMax: 46, aliases: ['s1'] },
  { family: 'CANOPY', code: 'P50-88', kvaMin: 50, kvaMax: 97, aliases: ['s2'] },
  { family: 'CANOPY', code: 'P110', kvaMin: 110, kvaMax: 138, aliases: ['s3'] },
  { family: 'CANOPY', code: 'P150-165', kvaMin: 150, kvaMax: 165, aliases: ['s4'] },
  { family: 'CANOPY', code: 'P220-275', kvaMin: 200, kvaMax: 275, aliases: ['200-220', '220/800', '200-250'] },
  { family: 'CANOPY', code: 'P350', kvaMin: 330, kvaMax: 350, aliases: ['p330'] },
  { family: 'CANOPY', code: 'P500', kvaMin: 400, kvaMax: 10000, aliases: ['p550', 'p700', 'p800', 'ckd'] },
  // cutting machine classes (Cutting Capacity sheet)
  { family: 'CUTCLASS', code: '400-SERIES', kvaMin: 13, kvaMax: 22, aliases: ['400srs', '400-series', '400series'] },
  { family: 'CUTCLASS', code: 'S1', kvaMin: 33, kvaMax: 46, aliases: ['s1'] },
  { family: 'CUTCLASS', code: 'S2', kvaMin: 50, kvaMax: 97, aliases: ['s2', 's2-p88'] },
  { family: 'CUTCLASS', code: 'S3', kvaMin: 110, kvaMax: 138, aliases: ['s3'] },
  { family: 'CUTCLASS', code: 'S4', kvaMin: 150, kvaMax: 165, aliases: ['s4'] },
  { family: 'CUTCLASS', code: '200-250', kvaMin: 200, kvaMax: 275, aliases: ['200-250', '200-220', 'p275', '220/275'] },
  { family: 'CUTCLASS', code: '350-500', kvaMin: 330, kvaMax: 10000, aliases: ['350-500', 'p550', 'p700', 'p800', '500'] },
  { family: 'CUTCLASS', code: 'LST', kvaMin: 0, kvaMax: 0, aliases: ['lister', 'lst'] },
  // base frame classes (Genset Assembly sheet Base_* blocks)
  { family: 'BASE', code: 'LST', kvaMin: 0, kvaMax: 0, aliases: ['lst', 'lister'] },
  { family: 'BASE', code: '400SRS', kvaMin: 13, kvaMax: 22, aliases: ['400srs'] },
  { family: 'BASE', code: 'S1', kvaMin: 33, kvaMax: 46, aliases: ['s1'] },
  { family: 'BASE', code: 'S2', kvaMin: 50, kvaMax: 97, aliases: ['s2', 's2/s3'] },
  { family: 'BASE', code: 'S3', kvaMin: 110, kvaMax: 138, aliases: ['s3', 's2/s3', 's3/s4'] },
  { family: 'BASE', code: 'S4', kvaMin: 150, kvaMax: 165, aliases: ['s4', 's3/s4'] },
  { family: 'BASE', code: 'P200/P250', kvaMin: 200, kvaMax: 275, aliases: ['p200/p250', '220/275', 'p200-p220', 'p275', 'p220/275'] },
  { family: 'BASE', code: 'P350', kvaMin: 330, kvaMax: 350, aliases: ['p350', 'p330'] },
  { family: 'BASE', code: 'P550', kvaMin: 400, kvaMax: 550, aliases: ['p550', 'p400', 'p500'] },
  { family: 'BASE', code: 'P800', kvaMin: 600, kvaMax: 10000, aliases: ['p800', 'p700'] },
  // panel enclosure classes
  { family: 'PANEL', code: 'LST', kvaMin: 0, kvaMax: 0, aliases: ['lst'] },
  { family: 'PANEL', code: '400SRS', kvaMin: 13, kvaMax: 22, aliases: ['400srs', '400sr'] },
  { family: 'PANEL', code: 'S1', kvaMin: 33, kvaMax: 46, aliases: ['s1'] },
  { family: 'PANEL', code: 'S2', kvaMin: 50, kvaMax: 138, aliases: ['s2'] },
  { family: 'PANEL', code: 'S3/S4', kvaMin: 150, kvaMax: 165, aliases: ['s3/s4', 's3', 's4'] },
  { family: 'PANEL', code: '220/800', kvaMin: 200, kvaMax: 10000, aliases: ['220/800', '220-800', '200-220', '1300srs', 'p350/800', 'p350', 'p500', 'p800'] },
  // genset / product classes (kVA bands read from the P-number)
  { family: 'GENSET', code: 'P13.5', kvaMin: 0, kvaMax: 13.5, aliases: ['p13.5', 'p13', 'spgp13.5'] },
  { family: 'GENSET', code: 'P18', kvaMin: 14, kvaMax: 18, aliases: ['p18', 'p16'] },
  { family: 'GENSET', code: 'P22', kvaMin: 19, kvaMax: 25, aliases: ['p22', 'p20', 'p25'] },
  { family: 'GENSET', code: 'P33', kvaMin: 26, kvaMax: 39, aliases: ['p33'] },
  { family: 'GENSET', code: 'P50', kvaMin: 40, kvaMax: 50, aliases: ['p50', 'p46'] },
  { family: 'GENSET', code: 'P65', kvaMin: 51, kvaMax: 69, aliases: ['p65', 'p69'] },
  { family: 'GENSET', code: 'P88', kvaMin: 70, kvaMax: 97, aliases: ['p88', 'p97'] },
  { family: 'GENSET', code: 'P110', kvaMin: 98, kvaMax: 138, aliases: ['p110', 'p138'] },
  { family: 'GENSET', code: 'P150', kvaMin: 139, kvaMax: 150, aliases: ['p150'] },
  { family: 'GENSET', code: 'P165', kvaMin: 151, kvaMax: 199, aliases: ['p165'] },
  { family: 'GENSET', code: 'P200', kvaMin: 200, kvaMax: 219, aliases: ['p200'] },
  { family: 'GENSET', code: 'P220', kvaMin: 220, kvaMax: 249, aliases: ['p220'] },
  { family: 'GENSET', code: 'P275', kvaMin: 250, kvaMax: 329, aliases: ['p275', 'p250'] },
  { family: 'GENSET', code: 'P350', kvaMin: 330, kvaMax: 399, aliases: ['p350', 'p330'] },
  { family: 'GENSET', code: 'P550', kvaMin: 400, kvaMax: 599, aliases: ['p550', 'p500', 'p400'] },
  { family: 'GENSET', code: 'P600', kvaMin: 600, kvaMax: 699, aliases: ['p600'] },
  { family: 'GENSET', code: 'P800', kvaMin: 700, kvaMax: 10000, aliases: ['p800', 'p700', 'p1100', 'p1250', 'p1500', 'p2000', 'm1100'] },
  { family: 'LISTER', code: 'Lister', kvaMin: 0, kvaMax: 0, aliases: ['lst', 'lister'] },
];

/* Finished product kVA band (P-number) from the ERP description, e.g. ".../PERKINS/P110/100KVA/..." */
function parseProductMeta(code, name) {
  const n = norm(name);
  let pnum = null;
  let m = /\/(?:P|EY|EM|M)(\d+(?:\.\d+)?)\//i.exec(n);
  if (m) pnum = Number(m[1]);
  if (pnum == null) { m = /(?:P|EY)(\d+(?:\.\d+)?)/i.exec(code); if (m) pnum = Number(m[1]); }
  let kva = null;
  m = /(\d+(?:\.\d+)?)\s*KVA/i.exec(n);
  if (m) kva = Number(m[1]);
  let family = 'GENSET';
  if (/TANK/i.test(n) || /^DTK/i.test(code)) family = 'TANK';
  else if (/CANOPY|ENCLOSURE/i.test(n) && !/GENSET/i.test(n)) family = 'CANOPY';
  const soundproof = /SOUNDPROOF/i.test(n) || /^(M?SPG|SPF)/i.test(code);
  const engine = /PERKINS/i.test(n) ? 'Perkins' : /YTO/i.test(n) ? 'YTO' : /MITSUBISHI|MITUSBISHI/i.test(n) ? 'Mitsubishi' : null;
  const mobile = /MOBILE/i.test(n);
  return { pnum, kva, family, soundproof, engine, mobile };
}

/* ------------------------------------------------------------------ BOM */
const BOM_COLS = {
  'item number': 'productCode', 'item/resource': 'itemCode', 'parent bom': 'parentCode', 'concatenate': 'concat',
  'product name': 'name', 'status': 'status', 'type 1': 'type1', 'finished code': 'finishedCode', 'type 2': 'type2',
  'model': 'model', 'type 3': 'type3', 'level': 'level', 'line number': 'lineNo', 'consumption per lot size': 'consumption',
  'unit': 'unit', 'cost per lot size': 'costPerLot', 'lot size qty': 'lotSize', 'cost per unit': 'costPerUnit',
  'calculation type': 'calcType', 'warehouse': 'warehouse', 'site': 'site', 'cost group': 'costGroup', 'operation': 'operation',
  'date': 'bomDate', 'unit cost': 'unitCost', 'total cost': 'totalCost', 'total hike': 'totalHike', 'active/in': 'active',
};

function parseBom(sheet, exceptions) {
  const header = sheet.rows[0].map((h) => key(h));
  const idx = {};
  header.forEach((h, i) => {
    const k = BOM_COLS[h];
    if (!k) return;
    if (k === 'unitCost' && idx.unitCost !== undefined) idx.unitCost2 = i; else idx[k] = i;
  });
  const required = ['productCode', 'itemCode', 'parentCode', 'name', 'level', 'lineNo', 'consumption', 'costPerLot', 'lotSize', 'calcType'];
  for (const r of required) if (idx[r] === undefined) throw new Error(`BOM sheet is missing column "${r}"`);
  const lines = [];
  for (let i = 1; i < sheet.rows.length; i++) {
    const c = sheet.rows[i];
    if (!c || c.length === 0 || c[idx.productCode] == null) continue;
    const g = (k) => (idx[k] === undefined ? null : c[idx[k]]);
    const s = (k) => { const v = g(k); return v == null ? null : norm(v) || null; };
    const costGroup = s('costGroup');
    const line = {
      rowNo: i + 1,
      productCode: s('productCode'), itemCode: s('itemCode'), parentCode: s('parentCode'), name: s('name'),
      status: s('status'), type1: s('type1'), finishedCode: (() => { const v = s('finishedCode'); return v && v !== '0' ? v : null; })(),
      type2: (() => { const v = s('type2'); return v && v !== '0' ? v : null; })(), model: (() => { const v = s('model'); return v && v !== '0' ? v : null; })(),
      type3: s('type3'), level: num(g('level')), lineNo: num(g('lineNo')), consumption: num(g('consumption')), unit: s('unit'),
      costPerLot: num(g('costPerLot')), lotSize: num(g('lotSize')) ?? 1, costPerUnit: num(g('costPerUnit')), calcType: s('calcType'),
      warehouse: s('warehouse'), site: s('site'), costGroup, operation: s('operation'), bomDate: s('bomDate'),
      unitCost: num(g('unitCost')), totalCost: num(g('totalCost')), totalHike: num(g('totalHike')), active: s('active'),
      unitCost2: num(g('unitCost2')),
      isStatusItem: costGroup === 'STATUS ITE' || key(s('type1')) === 'status item' || key(s('type3')) === 'status item',
    };
    if (line.level == null || line.lineNo == null) { exceptions.push({ type: 'BOM_ROW_INVALID', severity: 'error', entity: `BOM row ${i + 1}`, message: 'Level or line number missing; row skipped' }); continue; }
    lines.push(line);
  }
  return lines;
}

/* Build per-product trees and derive products, items, routings, exceptions. */
function analyseBom(lines, finishedSet, exceptions) {
  const byProduct = new Map();
  for (const l of lines) {
    if (!byProduct.has(l.productCode)) byProduct.set(l.productCode, []);
    byProduct.get(l.productCode).push(l);
  }
  const products = [];
  const items = new Map();
  const subassemblySignatures = new Map();
  for (const [code, rows] of byProduct) {
    rows.sort((a, b) => a.lineNo - b.lineNo);
    const root = rows.find((r) => r.level === 0);
    if (!root) exceptions.push({ type: 'BOM_NO_ROOT', severity: 'error', entity: code, message: 'Product tree has no level-0 row' });
    const meta = parseProductMeta(code, root ? root.name : code);
    products.push({
      code, name: root ? root.name : code, family: meta.family, kva: meta.kva, pnum: meta.pnum, engine: meta.engine,
      soundproof: meta.soundproof ? 1 : 0, mobile: meta.mobile ? 1 : 0, model: root?.model || null, costGroup: root?.costGroup || null,
      stdCost: root?.costPerLot ?? null, lineCount: rows.length, inFinishedList: finishedSet.has(code) ? 1 : 0, bomDate: root?.bomDate || null,
    });
    // nesting check & signatures
    const stack = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
      const expected = stack.length ? stack[stack.length - 1].itemCode : null;
      if (r.level > 0 && r.parentCode !== expected) exceptions.push({ type: 'BOM_PARENT_MISMATCH', severity: 'warning', entity: `${code} line ${r.lineNo}`, message: `Parent "${r.parentCode}" does not match nesting parent "${expected}"` });
      r.nestParent = expected;
      stack.push(r);
      if (r.finishedCode && r.finishedCode !== code) exceptions.push({ type: 'BOM_FINISHED_CODE_MISMATCH', severity: 'info', entity: `${code} line ${r.lineNo}`, message: `Row carries Finished Code "${r.finishedCode}" inside the ${code} tree` });
      if (r.calcType === 'Item' && !r.isStatusItem && (r.costPerUnit == null || r.costPerUnit === 0)) exceptions.push({ type: 'COST_ZERO_STANDARD', severity: 'warning', entity: `${r.itemCode}`, message: `${r.name}: standard cost is zero in BOM of ${code}` });
      if (r.consumption != null && r.consumption < 0 && !r.isStatusItem) exceptions.push({ type: 'BOM_NEGATIVE_QTY', severity: 'warning', entity: `${code} line ${r.lineNo}`, message: `Negative consumption ${r.consumption} on ${r.itemCode}` });
      if (r.calcType === 'BOM' || r.calcType === 'Production') {
        const kids = [];
        let childSum = 0;
        for (let j = i + 1; j < rows.length && rows[j].level > r.level; j++) {
          if (rows[j].level === r.level + 1) {
            kids.push(`${rows[j].itemCode}:${rows[j].consumption}`);
            if (!rows[j].isStatusItem) childSum += rows[j].costPerLot || 0;
          }
        }
        if (r.calcType === 'BOM' && r.costPerLot && Math.abs(r.costPerLot - childSum) > Math.max(1, r.costPerLot * 0.01)) {
          exceptions.push({ type: 'COST_ROLLUP_MISMATCH', severity: 'warning', entity: `${code} / ${r.itemCode}`, message: `Sub-assembly cost ${r.costPerLot.toFixed(2)} differs from sum of children ${childSum.toFixed(2)}`, data: { costPerLot: r.costPerLot, childSum } });
        }
        const sig = kids.sort().join('|');
        if (!subassemblySignatures.has(r.itemCode)) subassemblySignatures.set(r.itemCode, new Map());
        const sm = subassemblySignatures.get(r.itemCode);
        if (!sm.has(sig)) sm.set(sig, []);
        sm.get(sig).push(code);
      }
      // item master
      const kind = r.calcType === 'Production' ? 'PRODUCT' : r.calcType === 'BOM' ? 'SEMI' : r.calcType === 'Item' ? (r.isStatusItem ? 'STATUS' : 'RAW') : r.calcType === 'Process' ? 'RESOURCE' : 'OVERHEAD';
      const it = items.get(r.itemCode);
      const stdUnit = r.consumption && r.consumption > 0 && r.costPerLot != null ? r.costPerLot / r.consumption : r.costPerUnit;
      if (!it) items.set(r.itemCode, { code: r.itemCode, name: r.name, kind, unit: r.unit, costGroup: r.costGroup, type1: r.type1, warehouse: r.warehouse, stdUnitCost: kind === 'RAW' ? stdUnit : null, currentUnitCost: kind === 'RAW' ? (r.unitCost || null) : null, bomDate: r.bomDate, usedIn: new Set([code]) });
      else { it.usedIn.add(code); if (!it.currentUnitCost && r.unitCost) it.currentUnitCost = r.unitCost; if (it.kind === 'RAW' && it.stdUnitCost == null) it.stdUnitCost = stdUnit; }
    }
  }
  for (const [sub, sm] of subassemblySignatures) {
    if (sm.size > 1) exceptions.push({ type: 'BOM_STRUCTURE_VARIES', severity: 'info', entity: sub, message: `Sub-assembly ${sub} has ${sm.size} different child structures across products`, data: Object.fromEntries([...sm].map(([k, v], i) => [`variant${i + 1}`, v])) });
  }
  // item-level cost flags
  for (const it of items.values()) {
    it.usedIn = it.usedIn.size;
    if (it.kind !== 'RAW') { it.costFlags = null; continue; }
    const flags = [];
    if (!it.stdUnitCost) flags.push('ZERO_STANDARD');
    if (!it.currentUnitCost) flags.push('NO_CURRENT_PRICE');
    else if (it.stdUnitCost && Math.abs(it.currentUnitCost - it.stdUnitCost) / it.stdUnitCost > 0.10) flags.push(it.currentUnitCost > it.stdUnitCost ? 'PRICE_UP_10PCT' : 'PRICE_DOWN_10PCT');
    it.costFlags = flags.join(',') || null;
  }
  for (const code of finishedSet) if (!byProduct.has(code)) exceptions.push({ type: 'FINISHED_NOT_IN_BOM', severity: 'error', entity: code, message: 'Finished Product sheet code has no BOM tree' });
  return { products, items: [...items.values()] };
}

/* ------------------------------------------------------------------ productivity sheets */
function isHeaderRow(c) {
  const a = key(c[0]); const b = key(c[1]);
  return (a === 'type' || a === 'finished code') && (b === 'department' || b === 'type');
}
function parseProductivitySheet(sheet, sheetName, exceptions) {
  const rows = sheet.rows;
  const out = [];
  let header = null; let layout = null; let blockNo = 0;
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i] || [];
    if (isHeaderRow(c)) {
      header = c.map((h) => norm(h)); blockNo++;
      layout = key(c[1]) === 'department' ? 'canopy' : 'genset';
      continue;
    }
    if (!header) continue;
    if (c[0] == null || norm(c[0]) === '') { if (c.slice(0, 3).every((v) => v == null)) continue; else continue; }
    const typeCode = norm(c[0]);
    if (layout === 'canopy') {
      const department = norm(c[1]); const section = norm(c[2]);
      if (!department && !section) continue;
      out.push({ sheet: sheetName, sourceRow: i + 1, block: blockNo, layout, typeCode, department, section, warehouse: null,
        perUnitBasis: header[3] || null, perUnit: num(c[3]), staffs: num(c[4]), productivityBasis: header[5] || null, productivity: num(c[5]),
        lines: num(c[10]), totalProductivity: num(c[5]), totalStaff: num(c[6]), staffKeep: num(c[7]), staffIdle: num(c[8]), newStaff: num(c[9]), linesKept: num(c[10]), newProductivity: num(c[11]),
        weekPlan: c.slice(13).map((v) => (typeof v === 'number' ? v : null)) });
    } else {
      const wcName = norm(c[1]); const warehouse = norm(c[2]);
      if (!wcName) continue;
      out.push({ sheet: sheetName, sourceRow: i + 1, block: blockNo, layout, typeCode, department: wcName, section: wcName, warehouse,
        perUnitBasis: header[3] || null, perUnit: num(c[3]), staffs: num(c[4]), productivityBasis: header[6] || null, productivity: num(c[3]),
        lines: num(c[5]), totalProductivity: num(c[6]), totalStaff: num(c[7]), staffKeep: num(c[8]), staffIdle: num(c[9]), newStaff: num(c[10]), linesKept: num(c[11]), newProductivity: num(c[12]),
        weekPlan: c.slice(14).map((v) => (typeof v === 'number' ? v : null)) });
    }
  }
  return out;
}

function attachWorkCentres(prodRows, exceptions) {
  const wcByBlock = new Map();
  for (const wc of WORK_CENTRES) for (const b of wc.blocks) wcByBlock.set(`${wc.sheet}|${b}`, wc);
  for (const r of prodRows) {
    const dep = key(r.department); const sec = key(r.section);
    let wc = wcByBlock.get(`${r.sheet}|${dep}|${sec}`) || wcByBlock.get(`${r.sheet}|${dep}|*`) || (r.layout === 'genset' ? wcByBlock.get(`${r.sheet}|${sec}`) : null);
    if (!wc) {
      exceptions.push({ type: 'PRODUCTIVITY_UNMAPPED', severity: 'warning', entity: `${r.sheet} row ${r.sourceRow}`, message: `No work centre mapping for "${r.department} / ${r.section}"` });
      continue;
    }
    r.workCentre = wc.code;
    r.classFamily = wc.classify;
    const eff = (r.newProductivity != null && r.newProductivity > 0) ? r.newProductivity : (r.totalProductivity != null && r.totalProductivity > 0 ? r.totalProductivity : (r.productivity || 0));
    r.ratePerDay = eff || 0;
    r.rateBasis = (r.newProductivity != null && r.newProductivity > 0) ? 'revised' : 'current';
    if (!r.ratePerDay) exceptions.push({ type: 'PRODUCTIVITY_ZERO', severity: 'info', entity: `${wc.code} / ${r.typeCode}`, message: `Productivity is zero or blank for ${r.typeCode} at ${wc.name} (${r.sheet} row ${r.sourceRow}); planner falls back to BOM process hours` });
  }
  return prodRows.filter((r) => r.workCentre);
}

/* ------------------------------------------------------------------ cutting capacity */
const CAP_SHEET_CLASS = { 'capacitys1': 'S1', 'capacitys2': 'S2', 'capacitys3': 'S3', 'capacitys4': 'S4', 'capacity200': '200-250', 'capacity500': '350-500' };

function parseCapacitySheet(sheet, exceptions) {
  const cls = CAP_SHEET_CLASS[key(sheet.name).replace(/\s+/g, '')];
  if (!cls) return { files: [], summary: null };
  const files = [];
  let machine = null; let seenPlasmaTotal = false; let perShift = null;
  for (let i = 0; i < sheet.rows.length && !seenPlasmaTotal; i++) {
    const c = sheet.rows[i] || [];
    const a = key(c[0]);
    if (perShift == null) { const csIdx = c.findIndex((v) => key(v) === 'capacity/shift'); if (csIdx >= 0) { const nx = sheet.rows[i + 1] || []; perShift = num(nx[csIdx]); } }
    if (/^punch\s*1/.test(a)) { machine = 'Punch 1'; continue; }
    if (/^punch\s*2/.test(a)) { machine = 'Punch 2'; continue; }
    if (/^plasma/.test(a)) { machine = 'Plasma'; continue; }
    if (/^file\s*\d/.test(a) && machine) {
      // layout A: [file, desc, timeText, plate, minutes]; layout B: [File, Desc, -, -, -, timeText, plate, minutes]
      const plateIdx = c.findIndex((v, k) => k >= 2 && k <= 7 && typeof v === 'string' && /plate|sheet|scrap/i.test(v));
      let minutes = plateIdx >= 0 && typeof c[plateIdx + 1] === 'number' ? c[plateIdx + 1] : null;
      if (minutes == null) { const nums = c.slice(2, 8).filter((v) => typeof v === 'number'); minutes = nums.length ? nums[0] : null; }
      const plate = plateIdx >= 0 ? c[plateIdx] : null;
      const timeText = c.slice(2, 8).find((v) => typeof v === 'string' && /min|hour/i.test(v)) || c.slice(2, 8).find((v) => typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) || null;
      if (minutes == null) exceptions.push({ type: 'CUTTING_FILE_NO_TIME', severity: 'warning', entity: `${sheet.name} row ${i + 1}`, message: `No numeric time for ${c[0]} (${c[1]})` });
      files.push({ classCode: cls, machine, fileNo: norm(c[0]), description: norm(c[1]), minutes, plate: plate ? norm(plate) : null, timeText: timeText ? norm(timeText) : null, sourceRow: i + 1 });
      continue;
    }
    if (machine === 'Plasma' && c[0] == null && c.slice(2, 10).some((v) => typeof v === 'number')) seenPlasmaTotal = true;
  }
  const perMachine = {};
  for (const f of files) perMachine[f.machine] = (perMachine[f.machine] || 0) + (f.minutes || 0);
  return { files, summary: { classCode: cls, perShiftRecorded: perShift, minutesPerCanopy: perMachine, sheet: sheet.name } };
}

function parseCuttingCapacity(sheet, exceptions) {
  const out = [];
  for (let i = 2; i < sheet.rows.length; i++) {
    const c = sheet.rows[i] || [];
    if (c[0] == null) continue;
    const row = { classCode: norm(c[0]), minutes: { 'Punch 1': num(c[1]), 'Punch 2': num(c[2]), 'Plasma': num(c[3]) },
      perShiftCalc: { 'Punch 1': num(c[4]), 'Punch 2': num(c[5]), 'Plasma': num(c[6]) },
      perShiftRounded: { 'Punch 1': num(c[7]), 'Punch 2': num(c[8]), 'Plasma': num(c[9]) },
      qtyPerShiftRecorded: num(c[10]), timePerCanopy: num(c[11]), pctConsumed: { 'Punch 1': num(c[12]), 'Punch 2': num(c[13]), 'Plasma': num(c[14]) }, sourceRow: i + 1 };
    const calcMin = Math.min(...Object.values(row.perShiftCalc).filter((v) => v != null));
    row.bottleneckMachine = Object.entries(row.perShiftCalc).sort((a, b) => (a[1] ?? 1e9) - (b[1] ?? 1e9))[0]?.[0] || null;
    row.machineLimitPerShift = Number.isFinite(calcMin) ? calcMin : null;
    if (row.machineLimitPerShift != null && row.qtyPerShiftRecorded != null && Math.abs(row.machineLimitPerShift - row.qtyPerShiftRecorded) / row.qtyPerShiftRecorded > 0.05) {
      exceptions.push({ type: 'CUTTING_CAPACITY_DISCREPANCY', severity: 'info', entity: row.classCode, message: `Recorded ${row.qtyPerShiftRecorded}/shift vs machine-time limit ${row.machineLimitPerShift.toFixed(1)}/shift (${row.bottleneckMachine})` });
    }
    out.push(row);
  }
  return out;
}

/* ------------------------------------------------------------------ main */
function interpretWorkbook(buf) {
  const exceptions = [];
  const wb = X.parseWorkbook(buf);
  const need = (n) => { const s = X.sheetByName(wb, n); if (!s) throw new Error(`Worksheet "${n}" not found (sheets: ${wb.sheetNames.join(', ')})`); return s; };
  const fpSheet = need('Finished Product');
  const finishedList = fpSheet.rows.slice(1).map((r) => norm(r[0])).filter((v) => v && key(v) !== 'item number');
  const finishedSet = new Set(finishedList);
  const bomLines = parseBom(need('BOM'), exceptions);
  const { products, items } = analyseBom(bomLines, finishedSet, exceptions);
  const prodRows = [
    ...parseProductivitySheet(need('Canopy Assembly'), 'Canopy Assembly', exceptions),
    ...parseProductivitySheet(need('Genset Assembly'), 'Genset Assembly', exceptions),
  ];
  const productivity = attachWorkCentres(prodRows, exceptions);
  const cuttingFiles = []; const capacitySummaries = [];
  for (const s of wb.sheets) {
    if (!CAP_SHEET_CLASS[key(s.name).replace(/\s+/g, '')]) continue;
    const r = parseCapacitySheet(s, exceptions);
    cuttingFiles.push(...r.files); if (r.summary) capacitySummaries.push(r.summary);
  }
  const cuttingSummary = parseCuttingCapacity(need('Cutting Capacity'), exceptions);
  // cross-check capacity sheets against the summary sheet
  for (const cs of capacitySummaries) {
    const sum = cuttingSummary.find((r) => key(r.classCode) === key(cs.classCode));
    if (!sum) { exceptions.push({ type: 'CUTTING_CLASS_UNMATCHED', severity: 'info', entity: cs.classCode, message: `${cs.sheet} has no matching row in Cutting Capacity` }); continue; }
    for (const m of ['Punch 1', 'Punch 2', 'Plasma']) {
      const a = cs.minutesPerCanopy[m]; const b = sum.minutes[m];
      if (a != null && b != null && Math.abs(a - b) > 0.5) exceptions.push({ type: 'CUTTING_DETAIL_VS_SUMMARY', severity: 'info', entity: `${cs.classCode} ${m}`, message: `Detail files total ${a.toFixed(2)} min/canopy vs summary ${b.toFixed(2)} min` });
    }
    if (cs.perShiftRecorded != null && sum.qtyPerShiftRecorded != null && cs.perShiftRecorded !== sum.qtyPerShiftRecorded) exceptions.push({ type: 'CUTTING_DETAIL_VS_SUMMARY', severity: 'info', entity: cs.classCode, message: `Capacity/shift ${cs.perShiftRecorded} in ${cs.sheet} vs ${sum.qtyPerShiftRecorded} in Cutting Capacity` });
  }
  return { sheetNames: wb.sheetNames, finishedList, products, items, bomLines, sections: SECTIONS, workCentres: WORK_CENTRES, productivity, cuttingFiles, cuttingSummary, capacitySummaries, operationMap: OPERATION_MAP, modelClasses: MODEL_CLASSES, exceptions };
}

module.exports = { interpretWorkbook, parseProductMeta, SECTIONS, WORK_CENTRES, OPERATION_MAP, MODEL_CLASSES, norm, key };
