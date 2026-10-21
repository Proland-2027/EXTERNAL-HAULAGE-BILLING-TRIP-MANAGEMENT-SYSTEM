<?php
/**
 * Engine regression test. Run inside a WordPress installation where the plugin is active:
 *   php wp-content/plugins/jmg-production-planning/tests/engine-test.php /path/to/wordpress
 * Exits non-zero on failure.
 */
$wp_root = $argv[1] ?? dirname( __DIR__, 4 );
$_SERVER['HTTP_HOST'] = 'localhost'; $_SERVER['REQUEST_URI'] = '/'; $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
define( 'WP_USE_THEMES', false );
require rtrim( $wp_root, '/' ) . '/wp-load.php';
wp_set_current_user( 1 );
global $wpdb;
$fail = 0;
function check( $cond, $msg ) { global $fail; echo ( $cond ? 'PASS ' : 'FAIL ' ) . $msg . "\n"; if ( ! $cond ) { $fail++; } }

// 1. Masters imported
check( (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . JMG_DB::table( 'bom_lines' ) ) > 20000, 'BOM lines imported' );
check( (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . JMG_DB::table( 'sections' ) ) >= 60, 'sections imported' );
check( (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . JMG_DB::table( 'machine_times' ) ) === 24, 'cutting machine times imported' );

// 2. Explosion quantities multiply through levels
$ex = JMG_BOM::explode( 'SPGP22', 20 );
$codes = array(); $sheet_qty = 0;
foreach ( $ex['components'] as $c ) { $codes[ $c['code'] ] = $c; if ( 'MSH1-2MM2000x1220-H' === $c['code'] ) { $sheet_qty += (float) $c['qty_per_unit']; } }
check( isset( $codes['BASE-400SRS'] ) && abs( $codes['BASE-400SRS']['total_qty'] - 20 ) < 1e-6, 'BASE-400SRS x20 for 20 units' );
check( isset( $codes['CPNL-400SRS'] ) && (int) $codes['CPNL-400SRS']['level'] === 3, 'CPNL-400SRS found at level 3' );
check( $sheet_qty >= 4.3, 'MSH1-2MM2000x1220-H total per unit across canopy + panel >= 4.33 (' . round( $sheet_qty, 2 ) . ')' );
$ex200 = JMG_BOM::explode( 'SPGP200', 1 );
$plate = null; foreach ( $ex200['components'] as $c ) { if ( '439-1711-WH' === $c['code'] ) { $plate = $c; } }
check( $plate && abs( $plate['qty_per_unit'] - 4 ) < 1e-6, 'SPGP200 needs 4 plates 439-1711-WH per unit' );

// 3. Cost roll-up: leaf lines only, no sub-assembly double counting
$cost = JMG_BOM::cost_rollup( 'SPGP22', 1 );
$sum = 0; foreach ( $cost['lines'] as $l ) { $sum += (float) ( $l['ext_cost'] ?? 0 ); }
check( abs( $sum - ( $cost['material'] + $cost['labor'] + $cost['machine'] + $cost['overhead'] ) ) < 1, 'cost total equals sum of leaf lines' );
check( $cost['material'] > 0 && 'Costed' === $cost['cost_status'], 'SPGP22 fully costed' );

// 4. Routing resolves workbook capacities
$r = new JMG_Routing();
$b = $r->build( $ex, 20 );
$exact = 0; $stages = array();
foreach ( $b['ops'] as $op ) { if ( 'exact' === $op['capacity_match'] ) { $exact++; } $stages[ $op['stage_key'] ] = 1; }
check( $exact >= 20, "at least 20 operations matched exactly ($exact)" );
foreach ( array( 'canopy_cutting', 'base_welding', 'panel_electrical', 'genset_assembly', 'genset_test', 'sp_fitting', 'packaging' ) as $s ) { check( isset( $stages[ $s ] ), "stage $s present" ); }
$cut = null; foreach ( $b['ops'] as $op ) { if ( 'canopy_cutting' === $op['stage_key'] ) { $cut = $op; } }
check( $cut && count( $cut['machines'] ) === 3, 'canopy cutting constrained by Punch 1, Punch 2 and Plasma' );
check( $cut && abs( $cut['minutes_per_unit'] - 480 / 45 ) < 0.01, 'P13-22 canopy cutting = 480/45 min per unit' );

// 5. Scheduling: dependencies respected, capacity never exceeded
$s = new JMG_Scheduler( $r );
$loads = array();
$res = $s->schedule( $b['ops'], '2026-11-02', $loads, array( 'transfer_rule' => 'next_day' ) );
check( $res['end'] && $res['lead_time_days'] > 0, 'schedule produced an end date (' . $res['end'] . ', ' . $res['lead_time_days'] . ' wd)' );
$by = array(); foreach ( $res['ops'] as $op ) { $by[ $op['uid'] ] = $op; }
$ok = true;
foreach ( $res['ops'] as $op ) {
	if ( ! $op['is_scheduled'] || ! $op['planned_start'] ) { continue; }
	foreach ( $op['predecessors'] as $p ) { $pr = $by[ $p['uid'] ]; if ( $pr['planned_start'] && $pr['planned_start'] > $op['planned_start'] ) { $ok = false; } }
}
check( $ok, 'no operation starts before its predecessor' );
$over = false;
foreach ( $loads as $k => $days ) { foreach ( $days as $d => $m ) { if ( $m > $r->resource_minutes_per_day( $k ) + 1e-6 ) { $over = true; } } }
check( ! $over, 'no resource loaded above its daily capacity' );
// second order competes for the same resources and must be later or equal
$ex2 = JMG_BOM::explode( 'SPGP65-OPT', 10 ); $b2 = $r->build( $ex2, 10 );
$res2 = $s->schedule( $b2['ops'], '2026-11-02', $loads, array() );
$loads_empty = array();
$res2_alone = $s->schedule( $b2['ops'], '2026-11-02', $loads_empty, array() );
check( $res2['end'] >= $res2_alone['end'], 'competing order finishes no earlier than when scheduled alone (' . $res2_alone['end'] . ' -> ' . $res2['end'] . ')' );

// 6. Calendar
check( ! JMG_Calendar::is_working( '2026-11-01' ), 'Sunday is not a working day' );
check( JMG_Calendar::add_working_days( '2026-11-06', 1 ) === '2026-11-09', 'Friday + 1 working day = Monday' );

echo $fail ? "\n$fail check(s) FAILED\n" : "\nAll checks passed\n";
exit( $fail ? 1 : 0 );
