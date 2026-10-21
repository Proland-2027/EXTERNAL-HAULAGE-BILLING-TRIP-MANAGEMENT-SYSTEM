/*
 * load.js — writes an interpreted workbook into the database (replace-all for master data).
 */
'use strict';
const { nowIso } = require('../db.js');

function loadWorkbook(db, interp, { filename, user } = {}) {
  const t0 = Date.now();
  return db.tx(() => {
    const importId = db.run('INSERT INTO imports(ts,filename,user,summary) VALUES(?,?,?,?)', nowIso(), filename || null, user?.username || 'system', null).lastInsertRowid;
    for (const t of ['products', 'bom_lines', 'sections', 'work_centres', 'productivity', 'model_classes', 'operation_map', 'cutting_summary', 'cutting_files', 'import_exceptions']) db.exec(`DELETE FROM ${t}`);
    // keep approved costs / inventory categories / lead days from an earlier import
    const prevItems = new Map(db.all('SELECT code, approved_unit_cost, approved_at, approved_by, inventory_category, supplier_lead_days FROM items').map((r) => [r.code, r]));
    db.exec('DELETE FROM items');

    const insProduct = db.prep('INSERT INTO products(code,name,family,kva,pnum,engine,soundproof,mobile,model,cost_group,std_cost,line_count,in_finished_list,bom_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const p of interp.products) insProduct.run(p.code, p.name, p.family, p.kva, p.pnum, p.engine, p.soundproof, p.mobile, p.model, p.costGroup, p.stdCost, p.lineCount, p.inFinishedList, p.bomDate);

    const insItem = db.prep('INSERT INTO items(code,name,kind,unit,cost_group,type1,warehouse,std_unit_cost,current_unit_cost,approved_unit_cost,approved_at,approved_by,cost_flags,bom_date,used_in,inventory_category,supplier_lead_days) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const it of interp.items) {
      const prev = prevItems.get(it.code);
      insItem.run(it.code, it.name, it.kind, it.unit, it.costGroup, it.type1, it.warehouse, it.stdUnitCost, it.currentUnitCost, prev?.approved_unit_cost ?? null, prev?.approved_at ?? null, prev?.approved_by ?? null, it.costFlags || null, it.bomDate, it.usedIn, prev?.inventory_category ?? inventoryCategory(it), prev?.supplier_lead_days ?? 0);
    }
    const insBom = db.prep(`INSERT INTO bom_lines(product_code,row_no,line_no,level,parent_code,item_code,name,calc_type,consumption,unit,cost_per_lot,lot_size,cost_per_unit,warehouse,site,cost_group,operation,bom_date,unit_cost,total_cost,total_hike,unit_cost2,active,type1,type2,type3,model,finished_code,status,is_status_item)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const l of interp.bomLines) insBom.run(l.productCode, l.rowNo, l.lineNo, l.level, l.parentCode, l.itemCode, l.name, l.calcType, l.consumption, l.unit, l.costPerLot, l.lotSize, l.costPerUnit, l.warehouse, l.site, l.costGroup, l.operation, l.bomDate, l.unitCost, l.totalCost, l.totalHike, l.unitCost2, l.active, l.type1, l.type2, l.type3, l.model, l.finishedCode, l.status, l.isStatusItem ? 1 : 0);

    const insSec = db.prep('INSERT INTO sections(code,name,seq) VALUES(?,?,?)');
    for (const s of interp.sections) insSec.run(s.code, s.name, s.seq);
    const insWc = db.prep('INSERT INTO work_centres(code,name,site,section_code,sheet,classify) VALUES(?,?,?,?,?,?)');
    for (const w of interp.workCentres) insWc.run(w.code, w.name, w.site, w.section, w.sheet, w.classify);
    const insProd = db.prep(`INSERT INTO productivity(work_centre_code,type_code,class_family,sheet,source_row,department,section_label,warehouse,per_unit_basis,per_unit,staffs,productivity_basis,productivity,lines,total_productivity,total_staff,staff_keep,staff_idle,new_staff,lines_kept,new_productivity,rate_per_day,rate_basis,week_plan)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const p of interp.productivity) insProd.run(p.workCentre, p.typeCode, p.classFamily, p.sheet, p.sourceRow, p.department, p.section, p.warehouse, p.perUnitBasis, p.perUnit, p.staffs, p.productivityBasis, p.productivity, p.lines, p.totalProductivity, p.totalStaff, p.staffKeep, p.staffIdle, p.newStaff, p.linesKept, p.newProductivity, p.ratePerDay, p.rateBasis, JSON.stringify(p.weekPlan || []));
    const insCls = db.prep('INSERT INTO model_classes(family,code,kva_min,kva_max,aliases) VALUES(?,?,?,?,?)');
    for (const c of interp.modelClasses) insCls.run(c.family, c.code, c.kvaMin, c.kvaMax, JSON.stringify(c.aliases || []));
    const insMap = db.prep('INSERT INTO operation_map(cost_group_prefix,family,work_centre_code,process,seq) VALUES(?,?,?,?,?)');
    interp.operationMap.forEach((m, i) => insMap.run(m.costGroup, m.family, m.workCentre, m.process, i));
    const insCs = db.prep('INSERT INTO cutting_summary(class_code,machine,minutes_per_canopy,per_shift_calc,per_shift_rounded,pct_consumed,qty_per_shift_recorded,time_per_canopy,source_row) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const r of interp.cuttingSummary) for (const m of ['Punch 1', 'Punch 2', 'Plasma']) insCs.run(r.classCode, m, r.minutes[m], r.perShiftCalc[m], r.perShiftRounded[m], r.pctConsumed[m], r.qtyPerShiftRecorded, r.timePerCanopy, r.sourceRow);
    const insCf = db.prep('INSERT INTO cutting_files(class_code,machine,file_no,description,minutes,plate,time_text,sheet,source_row) VALUES(?,?,?,?,?,?,?,?,?)');
    for (const f of interp.cuttingFiles) insCf.run(f.classCode, f.machine, f.fileNo, f.description, f.minutes, f.plate, f.timeText, null, f.sourceRow);
    if (!db.get('SELECT 1 FROM machines LIMIT 1')) {
      const insM = db.prep('INSERT INTO machines(code,name,work_centre_code,minutes_per_day,count) VALUES(?,?,?,?,?)');
      insM.run('PUNCH1', 'Punch 1', 'GB-CANOPY-CUT', 480, 1); insM.run('PUNCH2', 'Punch 2', 'GB-CANOPY-CUT', 480, 1); insM.run('PLASMA', 'Plasma', 'GB-CANOPY-CUT', 480, 1);
    }
    const insEx = db.prep('INSERT INTO import_exceptions(import_id,type,severity,entity,message,data) VALUES(?,?,?,?,?,?)');
    for (const e of interp.exceptions) insEx.run(importId, e.type, e.severity, e.entity || null, e.message, e.data ? JSON.stringify(e.data) : null);
    const summary = { products: interp.products.length, finished: interp.finishedList.length, items: interp.items.length, bomLines: interp.bomLines.length, productivity: interp.productivity.length, cuttingFiles: interp.cuttingFiles.length, exceptions: interp.exceptions.length, ms: Date.now() - t0 };
    db.run('UPDATE imports SET summary = ? WHERE id = ?', JSON.stringify(summary), importId);
    db.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'last_import', JSON.stringify({ id: importId, ts: nowIso(), ...summary }));
    return { importId, summary };
  });
}

function inventoryCategory(it) {
  if (it.kind === 'PRODUCT') return 'Finished Goods';
  if (it.kind === 'SEMI') {
    const c = (it.code || '').toUpperCase(); const n = (it.name || '').toUpperCase(); const t = (it.type1 || '').toUpperCase();
    if (/^BASE|BASE TANK|BASE FRAME|^OPT-BASE|BT-/.test(c) || /BASE TANK|BASE FRAME/.test(n) || t === 'BASE') return 'Base Frames';
    if (/CPNL|PANEL|RELAY|BB-|RB-|CBB/.test(c) || /PANEL|RELAY BOX|BREAKER BOX/.test(n) || t === 'PANEL') return 'Panels';
    if (/SPF|CANOPY|ENCLOSURE/.test(c) || /CANOPY|ENCLOSURE/.test(n) || t === 'CANOPY') return 'Powder-Coated Parts';
    return 'Other Semi-Finished Components';
  }
  if (it.kind === 'RAW') return 'Raw Materials';
  return null;
}

module.exports = { loadWorkbook, inventoryCategory };
