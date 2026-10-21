<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Demo accounts and the acceptance-test scenario (section 17 of the brief):
 *  - Sales requests 20 units of a finished product; the plan is generated from the real BOM and capacities.
 *  - Two further orders compete for the same sections.
 *  - A supervisor records a shortfall so the forecast is revised against the baseline.
 */
class JMG_Seed {

	public static function demo_accounts() {
		return array(
			array( 'user_login' => 'sales.demo',      'display_name' => 'Sales Demo',      'role' => 'jmg_sales',      'password' => 'Sales@2026' ),
			array( 'user_login' => 'planner.demo',    'display_name' => 'Planner Demo',    'role' => 'jmg_planner',    'password' => 'Planner@2026' ),
			array( 'user_login' => 'supervisor.demo', 'display_name' => 'Supervisor Demo', 'role' => 'jmg_supervisor', 'password' => 'Supervisor@2026' ),
			array( 'user_login' => 'manager.demo',    'display_name' => 'Manager Demo',    'role' => 'jmg_manager',    'password' => 'Manager@2026' ),
			array( 'user_login' => 'costing.demo',    'display_name' => 'Costing Demo',    'role' => 'jmg_costing',    'password' => 'Costing@2026' ),
			array( 'user_login' => 'store.demo',      'display_name' => 'Store Keeper Demo', 'role' => 'jmg_store',    'password' => 'Store@2026' ),
		);
	}

	public static function create_accounts() {
		$out = array();
		foreach ( self::demo_accounts() as $a ) {
			$u = get_user_by( 'login', $a['user_login'] );
			if ( ! $u ) {
				$id = wp_insert_user( array( 'user_login' => $a['user_login'], 'user_pass' => $a['password'], 'display_name' => $a['display_name'], 'user_email' => $a['user_login'] . '@example.com', 'role' => $a['role'] ) );
				if ( is_wp_error( $id ) ) { $out[] = $a['user_login'] . ': ' . $id->get_error_message(); continue; }
			} else {
				$id = $u->ID;
				$u->set_role( $a['role'] );
			}
			$out[] = $a['user_login'] . ' (' . $a['role'] . ')';
		}
		return $out;
	}

	/** Build the demo scenario. Removes previous demo orders/requests (those whose sales_ref starts with DEMO-). */
	public static function scenario() {
		global $wpdb;
		@set_time_limit( 600 );
		$original_user = get_current_user_id();
		$accounts = self::create_accounts();
		// clear previous demo documents
		$ids = $wpdb->get_col( 'SELECT id FROM ' . JMG_DB::table( 'orders' ) . " WHERE sales_ref LIKE 'DEMO-%'" );
		foreach ( $ids as $id ) { $wpdb->delete( JMG_DB::table( 'daily_logs' ), array( 'order_id' => $id ) ); JMG_Orders::delete_order( $id ); }
		$wpdb->query( 'DELETE FROM ' . JMG_DB::table( 'requests' ) . " WHERE sales_ref LIKE 'DEMO-%'" );
		$wpdb->query( 'DELETE FROM ' . JMG_DB::table( 'alerts' ) . " WHERE order_id NOT IN (SELECT id FROM " . JMG_DB::table( 'orders' ) . ')' );

		$today = JMG_Calendar::today();
		$monday = gmdate( 'Y-m-d', strtotime( $today . ' 12:00:00 UTC' ) - ( ( (int) gmdate( 'N', strtotime( $today . ' 12:00:00 UTC' ) ) - 1 ) * 86400 ) );
		$monday = JMG_Calendar::next_working( $monday );
		$sales = get_user_by( 'login', 'sales.demo' );
		$planner = get_user_by( 'login', 'planner.demo' );
		$supervisor = get_user_by( 'login', 'supervisor.demo' );
		$log = array( 'accounts' => $accounts );

		// 0. Store: opening stock (demo quantities, clearly referenced) - metal sheets, powder, one complete base tank
		$wpdb->query( 'DELETE FROM ' . JMG_DB::table( 'stock_txns' ) . " WHERE reference LIKE 'DEMO-%'" );
		$store = get_user_by( 'login', 'store.demo' );
		wp_set_current_user( $store ? $store->ID : get_current_user_id() );
		foreach ( array( array( 'MSH1-2MM2000x1220-H', 60 ), array( 'MSH1-2MM1500x1220-H', 25 ), array( '1111931302-RAL-9001', 150 ), array( 'BASE-400SRS', 2 ), array( 'KIT-P22', 10 ) ) as $s ) {
			JMG_Inventory::post( array( 'txn_type' => 'RECEIPT', 'item_code' => $s[0], 'qty' => $s[1], 'txn_date' => JMG_Calendar::add_days( $monday, -3 ), 'reference' => 'DEMO-OPENING', 'reason' => 'Demonstration opening stock' ) );
		}
		// 1. Sales: 20 x SPGP22 (acceptance scenario)
		wp_set_current_user( $sales ? $sales->ID : get_current_user_id() );
		$r1 = JMG_Orders::create_request( array( 'sales_ref' => 'DEMO-SO-1001', 'customer' => 'Acceptance Test Customer', 'product_code' => 'SPGP22', 'qty' => 20, 'requested_date' => JMG_Calendar::add_working_days( $monday, 12 ), 'priority' => 'Normal', 'instructions' => 'Demonstration: 20 units, zero opening stock, all components manufactured from scratch.', 'requested_by' => 'Sales Demo' ) );
		$r2 = JMG_Orders::create_request( array( 'sales_ref' => 'DEMO-SO-1002', 'customer' => 'Lagos Industrial Park', 'product_code' => 'SPGP65-OPT', 'qty' => 10, 'requested_date' => JMG_Calendar::add_working_days( $monday, 14 ), 'priority' => 'Urgent', 'instructions' => 'Competes with SR-1 for base welding, panel assembly, genset assembly, STC and packaging.', 'requested_by' => 'Sales Demo' ) );
		$r3 = JMG_Orders::create_request( array( 'sales_ref' => 'DEMO-SO-1003', 'customer' => 'Abuja Data Centre', 'product_code' => 'SPGP110-OPT', 'qty' => 6, 'requested_date' => JMG_Calendar::add_working_days( $monday, 20 ), 'priority' => 'Normal', 'instructions' => 'Awaiting planning - use "Generate plan" to see the proposal.', 'requested_by' => 'Sales Demo' ) );
		$r4 = JMG_Orders::create_request( array( 'sales_ref' => 'DEMO-SO-1004', 'customer' => 'Dealer stock', 'product_code' => 'SPGP200', 'qty' => 4, 'requested_date' => JMG_Calendar::add_working_days( $monday, 25 ), 'priority' => 'Critical', 'instructions' => 'Critical priority example.', 'requested_by' => 'Sales Demo' ) );

		// 2. Planner: generate and confirm the first two orders
		wp_set_current_user( $planner ? $planner->ID : get_current_user_id() );
		$o1 = JMG_Orders::generate( array( 'request_id' => $r1['id'], 'plan_start' => $monday ) );
		if ( is_wp_error( $o1 ) ) { $log['errors'][] = $o1->get_error_message(); return $log; }
		$o1 = JMG_Orders::confirm( $o1['id'] );
		$next = JMG_Calendar::next_working( JMG_Calendar::add_days( $today, 1 ) );
		$o2 = JMG_Orders::generate( array( 'request_id' => $r2['id'], 'plan_start' => $next ) );
		if ( ! is_wp_error( $o2 ) ) { $o2 = JMG_Orders::confirm( $o2['id'] ); }
		$o4 = JMG_Orders::generate( array( 'request_id' => $r4['id'], 'plan_start' => $next ) );
		if ( ! is_wp_error( $o4 ) ) { $o4 = JMG_Orders::confirm( $o4['id'] ); }
		$log['orders'] = array( $o1['order_no'] ?? null, $o2['order_no'] ?? null, $o4['order_no'] ?? null );

		// 3. Supervisor: record the first days of production on order 1 (shortfall on day 2 of canopy welding)
		wp_set_current_user( $supervisor ? $supervisor->ID : get_current_user_id() );
		if ( $supervisor ) { update_user_meta( $supervisor->ID, 'jmg_sections', array() ); } // all sections
		$logged = 0;
		if ( ! is_wp_error( $o1 ) ) {
			$ops = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'order_ops' ) . ' WHERE order_id=%d AND is_scheduled=1 ORDER BY planned_start, id', $o1['id'] ), ARRAY_A );
			$day1 = $monday; $day2 = JMG_Calendar::add_working_days( $monday, 1 );
			foreach ( $ops as $op ) {
				$daily = json_decode( $op['daily_json'], true ) ?: array();
				if ( $day1 > $today ) { break; }
				if ( isset( $daily[ $day1 ] ) ) {
					$planned = (float) $daily[ $day1 ];
					$actual = ( 'canopy_cutting' === $op['stage_key'] ) ? round( $planned * 0.8, 0 ) : $planned; // shortfall on canopy cutting
					$res = JMG_Tracking::log( array( 'op_id' => $op['id'], 'log_date' => $day1, 'planned_qty' => $planned, 'actual_qty' => $actual, 'rejected_qty' => 'canopy_cutting' === $op['stage_key'] ? 1 : 0, 'rework_qty' => 0, 'wip_qty' => max( 0, $planned - $actual ), 'downtime_min' => 'canopy_cutting' === $op['stage_key'] ? 90 : 0, 'manpower' => 2, 'remarks' => 'canopy_cutting' === $op['stage_key'] ? 'Punch 2 breakdown 90 min; 1 sheet rejected' : 'As planned', 'delay_reason' => 'canopy_cutting' === $op['stage_key'] ? 'Machine breakdown' : '' ) );
					if ( ! is_wp_error( $res ) ) { $logged++; }
				}
			}
			if ( $day2 <= $today ) {
				$ops = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'order_ops' ) . ' WHERE order_id=%d AND is_scheduled=1 ORDER BY planned_start, id', $o1['id'] ), ARRAY_A );
				foreach ( $ops as $op ) {
					$daily = json_decode( $op['daily_json'], true ) ?: array();
					if ( isset( $daily[ $day2 ] ) ) {
						$planned = (float) $daily[ $day2 ];
						$res = JMG_Tracking::log( array( 'op_id' => $op['id'], 'log_date' => $day2, 'planned_qty' => $planned, 'actual_qty' => $planned, 'manpower' => 2, 'remarks' => 'As planned' ) );
						if ( ! is_wp_error( $res ) ) { $logged++; }
					}
				}
			}
		}
		$log['daily_logs'] = $logged;
		wp_set_current_user( $original_user );
		JMG_Audit::log( 'demo_seed', 'demo', '', $log );
		return $log;
	}
}
