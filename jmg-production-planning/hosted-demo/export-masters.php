<?php
global $wpdb;
$out = '/tmp/claude-0/-home-user-EXTERNAL-HAULAGE-BILLING-TRIP-MANAGEMENT-SYSTEM/6749eec9-0992-58d3-9770-a3b5aa6cd6d7/scratchpad/demo/data/';
$num = function($v){ return $v === null ? null : (float)$v; };
$products = array();
foreach ($wpdb->get_results("SELECT code, description, item_type, category, model_kva, series_key, is_finished, unit, cost_group FROM ".JMG_DB::table('products'), ARRAY_A) as $p)
  $products[] = array($p['code'], $p['description'], $p['item_type'], $p['category'], $num($p['model_kva']), $p['series_key'], (int)$p['is_finished'], $p['unit'], $p['cost_group']);
$bom = array();
foreach ($wpdb->get_results("SELECT finished_code, parent_code, component_code, description, level, line_no, qty, unit, calc_type, type1, type3, cost_group, erp_cost_per_unit, unit_cost, line_cost, rate FROM ".JMG_DB::table('bom_lines')." ORDER BY finished_code, line_no, id", ARRAY_A) as $r)
  $bom[$r['finished_code']][] = array($r['parent_code'], $r['component_code'], $r['description'], (int)$r['level'], (int)$r['line_no'], $num($r['qty']), $r['unit'], $r['calc_type'], $r['type1'], $r['type3'], $r['cost_group'], $num($r['erp_cost_per_unit']), $num($r['unit_cost']), $num($r['line_cost']), $num($r['rate']));
$prices = array();
foreach ($wpdb->get_results("SELECT code, description, price_type, unit, cost_group, unit_cost, source, conflict_note FROM ".JMG_DB::table('prices'), ARRAY_A) as $p)
  $prices[] = array($p['code'], $p['description'], $p['price_type'], $p['unit'], $p['cost_group'], $num($p['unit_cost']), $p['source'], $p['conflict_note']);
$masters = array(
  'sections' => $wpdb->get_results("SELECT * FROM ".JMG_DB::table('sections'), ARRAY_A),
  'capacities' => $wpdb->get_results("SELECT * FROM ".JMG_DB::table('capacities'), ARRAY_A),
  'machine_times' => $wpdb->get_results("SELECT * FROM ".JMG_DB::table('machine_times'), ARRAY_A),
  'cutting_files' => $wpdb->get_results("SELECT * FROM ".JMG_DB::table('cutting_files'), ARRAY_A),
  'series' => $wpdb->get_results("SELECT * FROM ".JMG_DB::table('series'), ARRAY_A),
  'stage_map' => $wpdb->get_results("SELECT * FROM ".JMG_DB::table('stage_map'), ARRAY_A),
  'data_issues' => $wpdb->get_results("SELECT issue_type, ref_code, message FROM ".JMG_DB::table('data_issues'), ARRAY_A),
  'products' => $products, 'prices' => $prices,
  'import' => $wpdb->get_row("SELECT file_name, created_at, summary FROM ".JMG_DB::table('import_log')." ORDER BY id DESC LIMIT 1", ARRAY_A),
);
file_put_contents($out.'masters.json', json_encode($masters));
file_put_contents($out.'bom.json', json_encode($bom));
echo "masters ", round(filesize($out.'masters.json')/1e6,2), "MB; bom ", round(filesize($out.'bom.json')/1e6,2), "MB; products ", count($products), " finished ", count($bom), "\n";
