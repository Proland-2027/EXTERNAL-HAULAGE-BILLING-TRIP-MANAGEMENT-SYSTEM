<?php
/**
 * Engine tests for the production planning application. Run:  php server/tests/run.php
 * Builds a throw-away SQLite database, imports the workbook, and checks the explosion, scheduling,
 * re-planning, costing, inventory netting and permission rules against known figures from the workbook.
 */
declare(strict_types=1);
require dirname(__DIR__) . '/src/App.php';
$tmp = sys_get_temp_dir() . '/pp-test-' . getmypid() . '.sqlite';
putenv("PP_SQLITE_PATH=$tmp"); putenv('PP_DB_DRIVER=sqlite');
$app = new App();
$pass = 0; $fail = 0;
function ok($cond, string $msg): void { global $pass, $fail; if ($cond) { $pass++; echo "  ok   $msg\n"; } else { $fail++; echo "  FAIL $msg\n"; } }
function near($a, $b, $tol, string $msg): void { ok(abs((float)$a - (float)$b) <= $tol, "$msg ($a vs $b)"); }

echo "Import\n";
$app->migrate();
$s = $app->importer->import(dirname(__DIR__, 2) . '/data/Prodction_Data.xlsx');
ok($s['bom_rows'] === 26673, 'all 26,673 BOM rows imported');
ok($s['finished_products'] === 41, '41 finished product codes');
ok(($s['items_by_type']['FINISHED'] ?? 0) >= 41, 'finished items present');
ok($s['primary_rates'] > 250, 'primary productivity rates chosen (' . $s['primary_rates'] . ')');
ok($s['cutting_models'] === 8 && $s['cutting_files'] > 60, 'cutting capacity + machine programme files');
ok((int)$app->db->val('SELECT COUNT(*) FROM {p}exceptions') > 100, 'exception report generated');
$item = $app->db->one("SELECT * FROM {p}items WHERE code='CHN100001'");
near($item['std_cost'], 3363.58, 0.05, 'standard unit cost derived from cost per lot ÷ consumption');
ok($app->db->one("SELECT * FROM {p}items WHERE code='MSPGP110'")['family'] === 'S3', 'MSPGP110 classified as S3 family');
$app->seeder->seedUsers();
$app->auth->setCurrentUser($app->db->one("SELECT * FROM {p}users WHERE username='planner'"));

echo "Explosion\n";
$ex = $app->planner->explode('MSPGP110', 20.0);
ok(count($ex['orders']) === 15, '15 production orders for MSPGP110 (finished + 14 semi-finished)');
ok(isset($ex['orders']['BASE-S3-OPT']) && abs($ex['orders']['BASE-S3-OPT']['gross_qty'] - 20) < 1e-9, 'base tank order for 20 units');
ok(isset($ex['orders']['OPT-CPNL-S2']) && $ex['orders']['OPT-CPNL-S2']['level'] === 4, 'empty control panel at level 4');
ok(count($ex['materials']) === 185, '185 distinct raw / purchased components (210 BOM material lines)');
$steel = $ex['materials']['MSH120001-H'] ?? null;
near($steel['qty'] ?? 0, 100, 1e-6, '5 sheets of 1.2 mm per canopy × 20 = 100 sheets');
$phantom = array_filter($ex['materials'], fn($m) => str_starts_with($m['code'], 'S-'));
ok(count($phantom) === 0, 'status / phantom items excluded (no double counting)');
$routing = array_map(fn($p) => $p['resource'], array_filter($ex['orders']['BASE-S3-OPT']['processes'], fn($p) => $p['kind'] === 'LABOUR'));
ok(array_values($routing) === ['IK-BCT-1', 'IK-BBD-1', 'IK-WBT-1', 'IK-WBG-1', 'IK-TBT-1', 'IK-PCP-1'], 'base routing: cut → bend → weld → grind → test → powder coat');

echo "Costing\n";
$c = $app->costing->bomCost('MSPGP110', 20.0);
near($c['material_cost_per_unit'] * 20, $c['material_cost_total'], 1, 'total = per unit × 20');
ok($c['sheet_rollup_per_unit'] > 0 && abs($c['sheet_rollup_variance_pct']) < 3, 'full cost reconciles with the workbook roll-up within 3% (' . $c['sheet_rollup_variance_pct'] . '%)');
ok($c['labour_hours_total'] > 2000, 'labour hours from Process rows');
ok(isset($c['flags']['OUTDATED']), 'outdated costs flagged');
$top = $c['components'][0]; ok($top['code'] === 'RK-PM-P110', 'largest cost component is the CKD engine kit');

echo "Scheduling\n";
$db = $app->db;
$sr = $db->insert('sales_requests', ['number' => 'SR-T-1', 'customer' => 'Test', 'product_code' => 'MSPGP110', 'product_desc' => 'x', 'product_type' => 'GENSET', 'qty' => 20, 'delivery_date' => '2026-12-31', 'priority' => 'HIGH', 'status' => 'SUBMITTED', 'created_by' => 'planner', 'created_at' => $db->now()]);
$planId = $app->planner->generate($sr, ['start_date' => '2026-11-02']);
$d = $app->planner->planDetail($planId);
$p = $d['plan'];
ok($p['start_date'] === '2026-11-02' && $p['expected_completion'] === '2026-11-25', 'plan runs 2 Nov → 25 Nov 2026 (' . $p['expected_completion'] . ')');
ok($p['summary']['lead_time_days'] === 18, '18 working days lead time');
ok(count($d['operations']) === 37, '37 section operations');
$byItem = []; foreach ($d['operations'] as $o) $byItem[$o['item_code']][] = $o;
$canopy = $byItem['SF-SPF-S3-OPT'];
ok($canopy[0]['section_code'] === 'CANOPY_CUT' && $canopy[1]['section_code'] === 'CANOPY_BEND', 'canopy order starts with cutting then bending');
ok($canopy[1]['planned_start'] > $canopy[0]['planned_start'] && $canopy[1]['planned_start'] <= $canopy[0]['planned_finish'], 'partial transfer: bending starts the day after cutting starts, before cutting finishes');
near($canopy[0]['daily_capacity'], 15, 0.01, 'canopy cutting at 15/shift for S3 (slowest machine from Cutting Capacity sheet)');
$assy = $byItem['SPGP110-OPT'][0];
$children = array_filter($d['orders'], fn($o) => $o['parent_order_id'] == $assy['order_id']);
$maxChild = max(array_map(fn($o) => $o['planned_finish'] ?? '', $children));
ok($assy['planned_start'] > $maxChild, 'final assembly starts only after all child orders finish');
ok(count($p['critical_path']) > 10 && end($p['critical_path'])['section_code'] === 'FG_RECEIPT', 'critical path ends at finished goods receipt');
ok($p['summary']['bottleneck'] !== null, 'bottleneck identified: ' . $p['summary']['bottleneck']['section']);
$sat = $db->val("SELECT COUNT(*) FROM {p}op_loads WHERE plan_id=? AND ldate IN ('2026-11-07','2026-11-08','2026-11-14','2026-11-15')", [$planId]);
ok((int)$sat === 0, 'nothing scheduled on weekends');

echo "Capacity sharing\n";
$app->planner->approve($planId);
$sr2 = $db->insert('sales_requests', ['number' => 'SR-T-2', 'customer' => 'Test2', 'product_code' => 'MSPGP110', 'product_desc' => 'x', 'product_type' => 'GENSET', 'qty' => 20, 'delivery_date' => '2026-12-31', 'priority' => 'NORMAL', 'status' => 'SUBMITTED', 'created_by' => 'planner', 'created_at' => $db->now()]);
$plan2 = $app->planner->generate($sr2, ['start_date' => '2026-11-02']);
$p2 = $db->one('SELECT * FROM {p}plans WHERE id=?', [$plan2]);
ok($p2['expected_completion'] > $p['expected_completion'], 'second identical order finishes later because capacity is already committed (' . $p2['expected_completion'] . ')');
$over = $db->all("SELECT l.section_id, l.ldate, SUM(l.minutes) m FROM {p}op_loads l WHERE l.machine_id IS NULL AND l.plan_id IN (?,?) GROUP BY l.section_id, l.ldate", [$planId, $plan2]);
$secs = []; foreach ($app->planner->sections() as $s) $secs[$s['id']] = (int)$s['minutes_per_day'] * max(1, (int)$s['lines']);
$overloaded = array_filter($over, fn($r) => (float)$r['m'] > $secs[(int)$r['section_id']] + 0.01);
ok(count($overloaded) === 0, 'no section-day exceeds its capacity across both plans');

echo "Daily reporting and re-planning\n";
$app->auth->setCurrentUser($db->one("SELECT * FROM {p}users WHERE username='supervisor'"));
$cut = $canopy[0];
$app->planner->recordDaily(['op_id' => $cut['id'], 'date' => '2026-11-02', 'good_qty' => 15, 'planned_qty' => 15]);
$app->planner->recordDaily(['op_id' => $cut['id'], 'date' => '2026-11-03', 'good_qty' => 5, 'planned_qty' => 5]);
$cutNow = $db->one('SELECT * FROM {p}operations WHERE id=?', [$cut['id']]);
ok($cutNow['status'] === 'COMPLETED' && (float)$cutNow['good_qty'] === 20.0, 'cutting completed after 15 + 5 good units');
$gas = $byItem['SFP-FGWP110-OPT'][0];
$app->planner->recordDaily(['op_id' => $gas['id'], 'date' => $gas['planned_start'], 'good_qty' => 8, 'planned_qty' => 20, 'delay_reason' => 'Material shortage']);
$pNow = $db->one('SELECT * FROM {p}plans WHERE id=?', [$planId]);
ok($pNow['expected_completion'] > $pNow['baseline_completion'], 'under-performance at genset assembly delays the finished product (' . $pNow['baseline_completion'] . ' → ' . $pNow['expected_completion'] . ')');
ok($pNow['baseline_completion'] === '2026-11-25', 'original approved date is kept for comparison');
$gasNow = $db->one('SELECT * FROM {p}operations WHERE id=?', [$gas['id']]);
ok((float)$gasNow['good_qty'] === 8.0 && (int)$gasNow['delay_days'] >= 1 && $gasNow['status'] === 'IN_PROGRESS', 'remaining 12 units re-planned, delay recorded');
$rep = $db->one('SELECT * FROM {p}daily_reports WHERE op_id=? ORDER BY id DESC LIMIT 1', [$gas['id']]);
near((float)$rep['good_qty'] / (float)$rep['planned_qty'] * 100, 40, 0.01, 'daily productivity achievement 40%');

echo "Inventory netting\n";
$app->auth->setCurrentUser($db->one("SELECT * FROM {p}users WHERE username='store'"));
$app->inventory->move(['item_code' => 'OPT-CPNL-S2', 'mtype' => 'OPENING', 'qty' => 12, 'mdate' => '2026-10-01']);
$app->auth->setCurrentUser($db->one("SELECT * FROM {p}users WHERE username='planner'"));
$ex2 = $app->planner->explode('MSPGP110', 20.0, true);
ok(abs($ex2['orders']['OPT-CPNL-S2']['net_qty'] - 8) < 1e-9, 'net requirement 8 after 12 in stock');
$ex3 = $app->planner->explode('MSPGP110', 20.0, false);
ok(abs($ex3['orders']['OPT-CPNL-S2']['net_qty'] - 20) < 1e-9, 'zero-stock assumption keeps the full 20');

echo "Permissions\n";
$app->auth->setCurrentUser($db->one("SELECT * FROM {p}users WHERE username='mgmt'"));
ok(!$app->auth->can('plan.approve') && $app->auth->can('reports.view') && $app->auth->can('haulage.approve'), 'management: view + pricing approval, no plan approval');
$app->auth->setCurrentUser($db->one("SELECT * FROM {p}users WHERE username='sales'"));
ok($app->auth->can('sales.create') && !$app->auth->can('production.report') && !$app->auth->can('cost.edit'), 'sales: create demand only');
$denied = false; try { $app->auth->require('cost.edit'); } catch (HttpException $e) { $denied = $e->status === 403; }
ok($denied, 'require() raises 403 for a forbidden permission');
ok((int)$db->val("SELECT COUNT(*) FROM {p}audit_log WHERE action='DAILY_REPORT'") === 3, 'audit trail records every daily report');

echo "Cost snapshot isolation\n";
$app->auth->setCurrentUser($db->one("SELECT * FROM {p}users WHERE username='costacct'"));
$snapBefore = json_decode($db->val('SELECT cost_snapshot FROM {p}plans WHERE id=?', [$planId]), true)['material_cost_total'];
$app->costing->updateItemCost('MSH120001-H', 20000, 'test');
$snapAfter = json_decode($db->val('SELECT cost_snapshot FROM {p}plans WHERE id=?', [$planId]), true)['material_cost_total'];
$current = $app->costing->planCost($planId)['material_cost_total'];
ok($snapBefore === $snapAfter && $current > $snapAfter, 'approved snapshot unchanged while current cost rises after the update');

@unlink($tmp); @unlink("$tmp-wal"); @unlink("$tmp-shm");
echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
