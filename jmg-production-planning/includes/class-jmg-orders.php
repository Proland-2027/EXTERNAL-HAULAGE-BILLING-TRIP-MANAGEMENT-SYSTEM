<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Sales requests and production orders: explosion, scheduling, confirmation, adjustment, replanning.
 */
class JMG_Orders {

	/* ---------------------------------------------------------------- */
	/* Numbering                                                          */
	/* ---------------------------------------------------------------- */
	public static function next_number( $prefix ) {
		global $wpdb;
		$table = 'SR' === $prefix ? JMG_DB::table( 'requests' ) : JMG_DB::table( 'orders' );
		$col = 'SR' === $prefix ? 'request_no' : 'order_no';
		$year = current_time( 'Y' );
		$like = $prefix . '-' . $year . '-%';
		$last = $wpdb->get_var( $wpdb->prepare( "SELECT $col FROM $table WHERE $col LIKE %s ORDER BY id DESC LIMIT 1", $like ) );
		$n = $last ? (int) substr( $last, strrpos( $last, '-' ) + 1 ) + 1 : 1;
		return sprintf( '%s-%s-%04d', $prefix, $year, $n );
	}

	/* ---------------------------------------------------------------- */
	/* Sales requests                                                     */
	/* ---------------------------------------------------------------- */
	public static function create_request( $d ) {
		global $wpdb;
		$product = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'products' ) . ' WHERE code=%s', $d['product_code'] ), ARRAY_A );
		if ( ! $product ) { return new WP_Error( 'jmg_product', 'Unknown product code ' . $d['product_code'] ); }
		$user = wp_get_current_user();
		$row = array(
			'request_no' => self::next_number( 'SR' ), 'sales_ref' => sanitize_text_field( $d['sales_ref'] ?? '' ), 'customer' => sanitize_text_field( $d['customer'] ?? '' ),
			'product_code' => $product['code'], 'description' => $product['description'], 'category' => $product['category'] ?: 'Genset',
			'qty' => max( 0.01, (float) ( $d['qty'] ?? 1 ) ), 'requested_date' => ! empty( $d['requested_date'] ) ? $d['requested_date'] : null,
			'priority' => in_array( $d['priority'] ?? '', array( 'Normal', 'Urgent', 'Critical' ), true ) ? $d['priority'] : 'Normal',
			'status' => 'NEW', 'instructions' => sanitize_textarea_field( $d['instructions'] ?? '' ), 'requested_by' => $d['requested_by'] ?? $user->display_name,
			'created_by' => $user->ID, 'created_at' => JMG_DB::now(), 'updated_at' => JMG_DB::now(),
		);
		$wpdb->insert( JMG_DB::table( 'requests' ), $row );
		$row['id'] = (int) $wpdb->insert_id;
		JMG_Audit::log( 'request_create', 'request', $row['id'], array( 'request_no' => $row['request_no'], 'product' => $row['product_code'], 'qty' => $row['qty'] ) );
		return $row;
	}

	public static function update_request( $id, $d ) {
		global $wpdb;
		$t = JMG_DB::table( 'requests' );
		$req = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id=%d", $id ), ARRAY_A );
		if ( ! $req ) { return new WP_Error( 'jmg_404', 'Request not found' ); }
		$upd = array( 'updated_at' => JMG_DB::now() );
		foreach ( array( 'sales_ref', 'customer', 'instructions', 'requested_by' ) as $k ) { if ( isset( $d[ $k ] ) ) { $upd[ $k ] = sanitize_text_field( $d[ $k ] ); } }
		if ( isset( $d['requested_date'] ) ) { $upd['requested_date'] = $d['requested_date'] ?: null; }
		if ( isset( $d['priority'] ) && in_array( $d['priority'], array( 'Normal', 'Urgent', 'Critical' ), true ) ) { $upd['priority'] = $d['priority']; }
		if ( in_array( $req['status'], array( 'NEW', 'PLANNED' ), true ) ) {
			if ( isset( $d['qty'] ) ) { $upd['qty'] = max( 0.01, (float) $d['qty'] ); }
			if ( isset( $d['product_code'] ) ) {
				$p = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'products' ) . ' WHERE code=%s', $d['product_code'] ), ARRAY_A );
				if ( $p ) { $upd['product_code'] = $p['code']; $upd['description'] = $p['description']; $upd['category'] = $p['category']; }
			}
		}
		if ( isset( $d['status'] ) && in_array( $d['status'], array( 'CANCELLED', 'REJECTED' ), true ) && current_user_can( 'jmg_plan' ) ) { $upd['status'] = $d['status']; }
		$wpdb->update( $t, $upd, array( 'id' => $id ) );
		JMG_Audit::log( 'request_update', 'request', $id, $upd );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id=%d", $id ), ARRAY_A );
	}

	public static function list_requests( $f = array() ) {
		global $wpdb;
		$t = JMG_DB::table( 'requests' ); $o = JMG_DB::table( 'orders' );
		$where = '1=1'; $p = array();
		if ( ! empty( $f['status'] ) ) { $where .= ' AND r.status=%s'; $p[] = $f['status']; }
		if ( ! empty( $f['q'] ) ) { $like = '%' . $wpdb->esc_like( $f['q'] ) . '%'; $where .= ' AND (r.request_no LIKE %s OR r.customer LIKE %s OR r.product_code LIKE %s OR r.sales_ref LIKE %s)'; array_push( $p, $like, $like, $like, $like ); }
		if ( ! empty( $f['mine'] ) ) { $where .= ' AND r.created_by=%d'; $p[] = get_current_user_id(); }
		$sql = "SELECT r.*, (SELECT o.order_no FROM $o o WHERE o.request_id=r.id AND o.status<>'CANCELLED' ORDER BY o.id DESC LIMIT 1) order_no, (SELECT o.id FROM $o o WHERE o.request_id=r.id AND o.status<>'CANCELLED' ORDER BY o.id DESC LIMIT 1) order_id, (SELECT o.planned_end FROM $o o WHERE o.request_id=r.id AND o.status<>'CANCELLED' ORDER BY o.id DESC LIMIT 1) planned_end, (SELECT o.forecast_end FROM $o o WHERE o.request_id=r.id AND o.status<>'CANCELLED' ORDER BY o.id DESC LIMIT 1) forecast_end, (SELECT o.status FROM $o o WHERE o.request_id=r.id AND o.status<>'CANCELLED' ORDER BY o.id DESC LIMIT 1) order_status FROM $t r WHERE $where ORDER BY r.id DESC LIMIT 500";
		return $wpdb->get_results( $p ? $wpdb->prepare( $sql, $p ) : $sql, ARRAY_A );
	}

	/* ---------------------------------------------------------------- */
	/* Orders                                                             */
	/* ---------------------------------------------------------------- */

	/** Create a draft production order (proposal) for a request or directly for a product. */
	public static function generate( $args ) {
		global $wpdb;
		$req = null;
		if ( ! empty( $args['request_id'] ) ) {
			$req = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'requests' ) . ' WHERE id=%d', $args['request_id'] ), ARRAY_A );
			if ( ! $req ) { return new WP_Error( 'jmg_404', 'Request not found' ); }
			if ( ! in_array( $req['status'], array( 'NEW', 'PLANNED' ), true ) ) { return new WP_Error( 'jmg_state', 'Request ' . $req['request_no'] . ' is already ' . $req['status'] ); }
			// discard an older draft for the same request
			$old = $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM ' . JMG_DB::table( 'orders' ) . " WHERE request_id=%d AND status='DRAFT'", $req['id'] ) );
			foreach ( $old as $oid ) { self::delete_order( $oid ); }
		}
		$code = $req ? $req['product_code'] : ( $args['product_code'] ?? '' );
		$product = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'products' ) . ' WHERE code=%s', $code ), ARRAY_A );
		if ( ! $product ) { return new WP_Error( 'jmg_product', 'Unknown product ' . $code ); }
		$qty = $req ? (float) $req['qty'] : max( 0.01, (float) ( $args['qty'] ?? 1 ) );
		$user = wp_get_current_user();
		$start = ! empty( $args['plan_start'] ) ? $args['plan_start'] : JMG_Calendar::add_working_days( JMG_Calendar::today(), (int) JMG_Settings::get( 'plan_lead_days', 1 ) );
		$row = array(
			'order_no' => self::next_number( 'PO' ), 'request_id' => $req ? (int) $req['id'] : null, 'product_code' => $product['code'], 'description' => $product['description'], 'category' => $product['category'] ?: 'Genset',
			'qty' => $qty, 'priority' => $req ? $req['priority'] : ( $args['priority'] ?? 'Normal' ), 'status' => 'DRAFT', 'requested_date' => $req ? $req['requested_date'] : ( $args['requested_date'] ?? null ),
			'plan_start' => $start, 'transfer_rule' => $args['transfer_rule'] ?? '', 'customer' => $req ? $req['customer'] : ( $args['customer'] ?? '' ), 'sales_ref' => $req ? $req['sales_ref'] : ( $args['sales_ref'] ?? '' ),
			'notes' => sanitize_textarea_field( $args['notes'] ?? ( $req ? (string) $req['instructions'] : '' ) ), 'created_by' => $user->ID, 'created_at' => JMG_DB::now(), 'updated_at' => JMG_DB::now(),
		);
		$wpdb->insert( JMG_DB::table( 'orders' ), $row );
		$id = (int) $wpdb->insert_id;
		if ( $req ) { $wpdb->update( JMG_DB::table( 'requests' ), array( 'status' => 'PLANNED', 'updated_at' => JMG_DB::now() ), array( 'id' => $req['id'] ) ); }
		JMG_Audit::log( 'order_generate', 'order', $id, array( 'order_no' => $row['order_no'], 'product' => $row['product_code'], 'qty' => $qty ) );
		$r = self::plan_order( $id );
		if ( is_wp_error( $r ) ) { return $r; }
		return self::get( $id );
	}

	public static function delete_order( $id ) {
		global $wpdb;
		foreach ( array( 'order_components', 'order_ops', 'op_schedule', 'alerts' ) as $t ) { $wpdb->delete( JMG_DB::table( $t ), array( 'order_id' => $id ) ); }
		$wpdb->delete( JMG_DB::table( 'orders' ), array( 'id' => $id ) );
	}

	/**
	 * (Re)plan an order: explode BOM, build routing, schedule with finite capacity, cost.
	 * Keeps completed quantities, manual adjustments and the baseline when the order is already confirmed.
	 */
	public static function plan_order( $order_id, $opts = array() ) {
		global $wpdb;
		$order = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', $order_id ), ARRAY_A );
		if ( ! $order ) { return new WP_Error( 'jmg_404', 'Order not found' ); }
		$qty = (float) $order['qty'];
		$inventory = array();
		$inv_on = (int) JMG_Settings::get( 'inventory_enabled', 1 );
		// previous allocations consumed by production (kept across re-plans)
		$prev = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT component_code, parent_code, qty_issued, qty_received, inventory_qty FROM ' . JMG_DB::table( 'order_components' ) . ' WHERE order_id=%d', $order_id ), ARRAY_A ) as $pc ) { $prev[ $pc['component_code'] . '|' . $pc['parent_code'] ] = $pc; }
		if ( $inv_on ) {
			$inventory = JMG_Inventory::availability_map( $order_id );
			// units this order produced itself are in stock for its own parent stages: exclude them from
			// external allocation, and never allocate more external stock than is still to be produced
			$totals = array();
			foreach ( JMG_BOM::explode( $order['product_code'], $qty )['components'] as $c0 ) { if ( 'assembly' === $c0['kind'] ) { $totals[ $c0['code'] ] = ( $totals[ $c0['code'] ] ?? 0 ) + (float) $c0['total_qty']; } }
			foreach ( $prev as $pc ) {
				$own = max( 0.0, (float) $pc['qty_received'] - (float) $pc['qty_issued'] );
				if ( $own > 0 && isset( $inventory[ $pc['component_code'] ] ) ) { $inventory[ $pc['component_code'] ] = max( 0.0, $inventory[ $pc['component_code'] ] - $own ); }
				if ( isset( $totals[ $pc['component_code'] ], $inventory[ $pc['component_code'] ] ) ) { $inventory[ $pc['component_code'] ] = min( $inventory[ $pc['component_code'] ], max( 0.0, $totals[ $pc['component_code'] ] - (float) $pc['qty_received'] ) ); }
			}
		}
		$ex = JMG_BOM::explode( $order['product_code'], $qty, $inventory );
		$routing = new JMG_Routing();
		$built = $routing->build( $ex, $qty );
		$warnings = array_merge( $ex['issues'], $built['warnings'] );

		// existing ops: carry progress + manual adjustments
		$existing = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'order_ops' ) . ' WHERE order_id=%d', $order_id ), ARRAY_A ) as $e ) { $existing[ $e['component_code'] . '|' . $e['stage_key'] ] = $e; }
		$ops = $built['ops'];
		foreach ( $ops as $i => $op ) {
			$k = $op['component_code'] . '|' . $op['stage_key'];
			if ( isset( $existing[ $k ] ) ) {
				$e = $existing[ $k ];
				$ops[ $i ]['id'] = (int) $e['id'];
				$ops[ $i ]['qty_completed'] = (float) $e['qty_completed'];
				$ops[ $i ]['qty_rejected'] = (float) $e['qty_rejected'];
				$ops[ $i ]['qty_rework'] = (float) $e['qty_rework'];
				$ops[ $i ]['actual_start'] = $e['actual_start']; $ops[ $i ]['actual_end'] = $e['actual_end'];
				$ops[ $i ]['baseline_start'] = $e['baseline_start']; $ops[ $i ]['baseline_end'] = $e['baseline_end'];
				$ops[ $i ]['earliest_start'] = $e['earliest_start'];
				if ( null !== $e['manual_minutes'] && (float) $e['manual_minutes'] > 0 ) {
					$ops[ $i ]['minutes_per_unit'] = (float) $e['manual_minutes']; $ops[ $i ]['is_scheduled'] = 1; $ops[ $i ]['capacity_match'] = 'manual';
					$ops[ $i ]['capacity_note'] = 'Planner override: ' . (float) $e['manual_minutes'] . ' minutes per unit.';
				}
				if ( ! empty( $e['manual_section_id'] ) ) {
					$sec = $routing->sections()[ (int) $e['manual_section_id'] ] ?? null;
					if ( $sec ) { $ops[ $i ]['section_id'] = (int) $sec['id']; $ops[ $i ]['section_name'] = $sec['section_name']; $ops[ $i ]['site'] = $sec['site']; $ops[ $i ]['capacity_note'] .= ' Section reassigned by planner.'; }
				}
				$ops[ $i ]['manual_minutes'] = $e['manual_minutes']; $ops[ $i ]['manual_section_id'] = $e['manual_section_id'];
			}
		}
		// start date: plan_start, but never before the day after the last recorded production
		$start = $order['plan_start'] ?: JMG_Calendar::today();
		if ( ! empty( $opts['from'] ) && $opts['from'] > $start ) { $start = $opts['from']; }
		if ( in_array( $order['status'], array( 'CONFIRMED', 'IN_PROGRESS' ), true ) ) {
			$last_log = $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(log_date) FROM ' . JMG_DB::table( 'daily_logs' ) . ' WHERE order_id=%d', $order_id ) );
			$today = JMG_Calendar::today();
			if ( $last_log && JMG_Calendar::add_days( $last_log, 1 ) > $start ) { $start = JMG_Calendar::add_days( $last_log, 1 ); }
			if ( $today > $start ) { $start = $today; }
		}
		$loads = JMG_Scheduler::load_committed( $order_id, $start );
		$scheduler = new JMG_Scheduler( $routing );
		$sopts = array();
		if ( ! empty( $order['transfer_rule'] ) ) { $sopts['transfer_rule'] = $order['transfer_rule']; }
		$res = $scheduler->schedule( $ops, $start, $loads, $sopts );
		$warnings = array_merge( $warnings, $res['warnings'] );

		// persist components
		$wpdb->delete( JMG_DB::table( 'order_components' ), array( 'order_id' => $order_id ) );
		$prices = JMG_BOM::prices();
		$crow = array();
		$ops_by_comp = array();
		foreach ( $res['ops'] as $op ) { $ops_by_comp[ $op['component_code'] ][] = $op; }
		foreach ( $ex['components'] as $c ) {
			$price = isset( $prices[ $c['code'] ] ) ? $prices[ $c['code'] ]['cost'] : null;
			$pk = $c['code'] . '|' . $c['parent'];
			$issued = isset( $prev[ $pk ] ) ? (float) $prev[ $pk ]['qty_issued'] : 0.0;
			$received = isset( $prev[ $pk ] ) ? (float) $prev[ $pk ]['qty_received'] : 0.0;
			if ( 'material' === $c['kind'] || 'purchased_assembly' === $c['kind'] ) {
				// allocate available stock to purchased items (issued quantities are already out of stock)
				$need = max( 0.0, (float) $c['total_qty'] - $issued );
				$avail = isset( $inventory[ $c['code'] ] ) ? (float) $inventory[ $c['code'] ] : 0.0;
				$alloc = $inv_on ? min( $avail, $need ) : 0.0;
				if ( $alloc > 0 ) { $inventory[ $c['code'] ] = $avail - $alloc; }
				$c['inventory_qty'] = $alloc + $issued;
				$c['qty_to_make'] = max( 0.0, (float) $c['total_qty'] - $c['inventory_qty'] ); // = quantity to purchase
			} else {
				$c['inventory_qty'] = max( (float) ( $c['inventory_qty'] ?? 0 ), min( $issued, (float) $c['total_qty'] ) );
			}
			$dept = '';
			if ( isset( $ops_by_comp[ $c['code'] ] ) ) {
				$d = array();
				foreach ( $ops_by_comp[ $c['code'] ] as $o ) { if ( $o['section_name'] ) { $d[ $o['section_name'] ] = 1; } }
				$dept = implode( ', ', array_keys( $d ) );
			}
			$crow[] = array(
				'order_id' => $order_id, 'component_code' => $c['code'], 'description' => $c['description'], 'parent_code' => $c['parent'], 'level' => $c['level'],
				'qty_per_parent' => $c['qty_per_parent'], 'qty_per_unit' => $c['qty_per_unit'], 'total_qty' => $c['total_qty'], 'inventory_qty' => $c['inventory_qty'] ?? 0,
				'qty_to_make' => $c['qty_to_make'] ?? $c['total_qty'], 'unit' => $c['unit'], 'comp_kind' => $c['kind'], 'cost_group' => $c['cost_group'],
				'department' => $dept, 'unit_cost' => $price, 'ext_cost' => null === $price ? null : round( $price * $c['total_qty'], 2 ), 'cost_pending' => ( 'material' === $c['kind'] && null === $price ) ? 1 : 0,
				'qty_issued' => $issued, 'qty_received' => $received, 'status' => 'PENDING',
			);
		}
		JMG_DB::bulk_insert( 'order_components', $crow );
		$comp_ids = array();
		foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT id, component_code FROM ' . JMG_DB::table( 'order_components' ) . ' WHERE order_id=%d', $order_id ), ARRAY_A ) as $r ) { $comp_ids[ $r['component_code'] ] = (int) $r['id']; }

		// persist ops (update in place to keep ids referenced by daily logs)
		$keep_ids = array();
		$uid_to_id = array();
		$is_confirmed = in_array( $order['status'], array( 'CONFIRMED', 'IN_PROGRESS' ), true );
		foreach ( $res['ops'] as $op ) {
			$row = array(
				'order_id' => $order_id, 'order_no' => $order['order_no'], 'component_id' => $comp_ids[ $op['component_code'] ] ?? null, 'component_code' => $op['component_code'], 'component_desc' => $op['component_desc'],
				'stage_key' => $op['stage_key'], 'stage_name' => $op['stage_name'], 'workflow_group' => $op['workflow_group'], 'department' => $op['department'],
				'section_id' => $op['section_id'], 'section_name' => $op['section_name'], 'capacity_id' => $op['capacity_id'], 'capacity_match' => $op['capacity_match'], 'capacity_note' => mb_substr( (string) $op['capacity_note'], 0, 255 ),
				'sequence' => $op['sequence'], 'level' => $op['level'], 'qty_planned' => $op['qty_planned'], 'qty_completed' => $op['qty_completed'] ?? 0, 'qty_rejected' => $op['qty_rejected'] ?? 0, 'qty_rework' => $op['qty_rework'] ?? 0,
				'minutes_per_unit' => $op['minutes_per_unit'], 'bom_hours_per_unit' => $op['bom_hours_per_unit'], 'machines_json' => wp_json_encode( $op['machines'] ), 'predecessors_json' => wp_json_encode( $op['predecessors'] ),
				'op_codes' => implode( ',', $op['op_codes'] ), 'site' => $op['site'], 'earliest_start' => $op['earliest_start'] ?? null, 'manual_minutes' => $op['manual_minutes'] ?? null, 'manual_section_id' => $op['manual_section_id'] ?? null,
				'is_scheduled' => $op['is_scheduled'] ? 1 : 0, 'daily_json' => wp_json_encode( $op['daily'] ),
				'planned_start' => $op['planned_start'], 'planned_end' => $op['planned_end'], 'actual_start' => $op['actual_start'] ?? null, 'actual_end' => $op['actual_end'] ?? null, 'status' => $op['status'],
			);
			if ( $is_confirmed ) { $row['baseline_start'] = $op['baseline_start'] ?? $op['planned_start']; $row['baseline_end'] = $op['baseline_end'] ?? $op['planned_end']; }
			else { $row['baseline_start'] = $op['planned_start']; $row['baseline_end'] = $op['planned_end']; }
			if ( ! empty( $op['id'] ) ) {
				$wpdb->update( JMG_DB::table( 'order_ops' ), $row, array( 'id' => $op['id'] ) );
				$id = (int) $op['id'];
			} else {
				$wpdb->insert( JMG_DB::table( 'order_ops' ), $row );
				$id = (int) $wpdb->insert_id;
			}
			$keep_ids[] = $id; $uid_to_id[ $op['uid'] ] = $id;
		}
		if ( $keep_ids ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . JMG_DB::table( 'order_ops' ) . ' WHERE order_id=%d AND id NOT IN (' . implode( ',', array_map( 'intval', $keep_ids ) ) . ')', $order_id ) );
		}
		// predecessor uids -> op ids for display
		foreach ( $res['ops'] as $op ) {
			$pred_ids = array();
			foreach ( $op['predecessors'] as $p ) { if ( isset( $uid_to_id[ $p['uid'] ] ) ) { $pred_ids[] = array( 'id' => $uid_to_id[ $p['uid'] ], 'ratio' => $p['ratio'] ); } }
			$wpdb->update( JMG_DB::table( 'order_ops' ), array( 'predecessors_json' => wp_json_encode( $pred_ids ) ), array( 'id' => $uid_to_id[ $op['uid'] ] ) );
		}
		// schedule rows: replace planned (non-actual) rows from start date on
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . JMG_DB::table( 'op_schedule' ) . ' WHERE order_id=%d AND is_actual=0', $order_id ) );
		$srow = array();
		foreach ( $res['allocations'] as $a ) {
			$srow[] = array( 'order_id' => $order_id, 'op_id' => $uid_to_id[ $a['op_uid'] ], 'section_id' => $a['section_id'], 'resource_key' => $a['resource_key'], 'sched_date' => $a['sched_date'], 'qty' => $a['qty'], 'minutes' => $a['minutes'], 'is_actual' => 0 );
		}
		JMG_DB::bulk_insert( 'op_schedule', $srow );

		// cost
		$cost = JMG_BOM::cost_rollup( $order['product_code'], $qty );
		$end = $res['end'];
		$all_done = true; $any_scheduled = false;
		foreach ( $res['ops'] as $op ) { if ( $op['is_scheduled'] ) { $any_scheduled = true; if ( 'COMPLETED' !== $op['status'] ) { $all_done = false; } } }
		if ( ! $any_scheduled ) { $warnings[] = 'No operation of this product could be capacity-scheduled; check the stage map and capacity rows.'; }
		$upd = array(
			'planned_start' => $res['start'] ?: $start, 'planned_end' => $end, 'forecast_end' => $end, 'lead_time_days' => $res['lead_time_days'],
			'bottleneck' => $res['bottleneck'] ? $res['bottleneck']['name'] : '', 'planned_cost' => $cost['order_total'], 'cost_status' => $cost['cost_status'],
			'schedule_json' => wp_json_encode( array( 'bottleneck' => $res['bottleneck'], 'utilisation' => $res['utilisation'], 'start_used' => $start, 'cost' => array( 'material' => $cost['material'], 'labor' => $cost['labor'], 'machine' => $cost['machine'], 'overhead' => $cost['overhead'], 'total' => $cost['total'], 'pending' => $cost['pending_count'], 'erp_total' => $cost['erp_total'], 'basis' => $cost['basis'] ) ) ),
			'warnings_json' => wp_json_encode( array_values( array_unique( $warnings ) ) ), 'updated_at' => JMG_DB::now(),
		);
		if ( ! $is_confirmed ) { $upd['baseline_start'] = $upd['planned_start']; $upd['baseline_end'] = $end; }
		if ( $is_confirmed && $all_done && $any_scheduled ) { $upd['status'] = 'COMPLETED'; $upd['actual_end'] = $upd['actual_end'] ?? JMG_Calendar::today(); }
		$wpdb->update( JMG_DB::table( 'orders' ), $upd, array( 'id' => $order_id ) );
		return true;
	}

	/** Confirm a draft: becomes the operational baseline. */
	public static function confirm( $id ) {
		global $wpdb;
		$o = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', $id ), ARRAY_A );
		if ( ! $o ) { return new WP_Error( 'jmg_404', 'Order not found' ); }
		if ( 'DRAFT' !== $o['status'] ) { return new WP_Error( 'jmg_state', 'Only draft plans can be confirmed.' ); }
		$r = self::plan_order( $id ); // refresh against latest committed loads
		if ( is_wp_error( $r ) ) { return $r; }
		$o = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', $id ), ARRAY_A );
		$user = wp_get_current_user();
		$wpdb->update( JMG_DB::table( 'orders' ), array( 'status' => 'CONFIRMED', 'baseline_start' => $o['planned_start'], 'baseline_end' => $o['planned_end'], 'confirmed_by' => $user->ID, 'confirmed_at' => JMG_DB::now(), 'updated_at' => JMG_DB::now() ), array( 'id' => $id ) );
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . JMG_DB::table( 'order_ops' ) . ' SET baseline_start=planned_start, baseline_end=planned_end WHERE order_id=%d', $id ) );
		if ( $o['request_id'] ) { $wpdb->update( JMG_DB::table( 'requests' ), array( 'status' => 'CONFIRMED', 'updated_at' => JMG_DB::now() ), array( 'id' => $o['request_id'] ) ); }
		JMG_Audit::log( 'order_confirm', 'order', $id, array( 'order_no' => $o['order_no'], 'planned_end' => $o['planned_end'], 'requested_date' => $o['requested_date'] ) );
		if ( $o['requested_date'] && $o['planned_end'] && $o['planned_end'] > $o['requested_date'] ) {
			self::add_alert( $id, $o['order_no'], 'delivery_risk', 'warning', 'sales,planning', sprintf( 'Committed completion %s is later than the Sales requested date %s (%d working days).', $o['planned_end'], $o['requested_date'], JMG_Calendar::working_days_between( $o['requested_date'], $o['planned_end'] ) - 1 ) );
		}
		if ( (int) JMG_Settings::get( 'inventory_enabled', 1 ) ) {
			$short = $wpdb->get_results( $wpdb->prepare( 'SELECT component_code, total_qty, inventory_qty FROM ' . JMG_DB::table( 'order_components' ) . " WHERE order_id=%d AND comp_kind IN ('material','purchased_assembly') AND total_qty > inventory_qty + 0.0005", $id ), ARRAY_A );
			if ( $short ) {
				self::add_alert( $id, $o['order_no'], 'material_shortage', 'warning', 'planning,purchasing', sprintf( '%d purchased item(s) are not covered by available stock (e.g. %s: %s short). See Inventory > Shortages & purchase list.', count( $short ), $short[0]['component_code'], rtrim( rtrim( number_format( (float) $short[0]['total_qty'] - (float) $short[0]['inventory_qty'], 2, '.', '' ), '0' ), '.' ) ) );
			}
		}
		return self::get( $id );
	}

	public static function cancel( $id, $reason = '' ) {
		global $wpdb;
		$o = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', $id ), ARRAY_A );
		if ( ! $o ) { return new WP_Error( 'jmg_404', 'Order not found' ); }
		$wpdb->update( JMG_DB::table( 'orders' ), array( 'status' => 'CANCELLED', 'notes' => trim( $o['notes'] . "\nCancelled: " . sanitize_text_field( $reason ) ), 'updated_at' => JMG_DB::now() ), array( 'id' => $id ) );
		$wpdb->delete( JMG_DB::table( 'op_schedule' ), array( 'order_id' => $id, 'is_actual' => 0 ) );
		if ( $o['request_id'] ) { $wpdb->update( JMG_DB::table( 'requests' ), array( 'status' => 'NEW', 'updated_at' => JMG_DB::now() ), array( 'id' => $o['request_id'] ) ); }
		JMG_Audit::log( 'order_cancel', 'order', $id, array( 'reason' => $reason ) );
		return self::get( $id );
	}

	/** Planner adjustments at order level, then automatic recalculation. */
	public static function update_order( $id, $d ) {
		global $wpdb;
		$o = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', $id ), ARRAY_A );
		if ( ! $o ) { return new WP_Error( 'jmg_404', 'Order not found' ); }
		if ( in_array( $o['status'], array( 'COMPLETED', 'CANCELLED' ), true ) ) { return new WP_Error( 'jmg_state', 'Order is ' . $o['status'] ); }
		$upd = array( 'updated_at' => JMG_DB::now() );
		if ( isset( $d['qty'] ) && 'DRAFT' === $o['status'] ) { $upd['qty'] = max( 0.01, (float) $d['qty'] ); }
		if ( isset( $d['priority'] ) && in_array( $d['priority'], array( 'Normal', 'Urgent', 'Critical' ), true ) ) { $upd['priority'] = $d['priority']; }
		if ( isset( $d['plan_start'] ) && $d['plan_start'] ) { $upd['plan_start'] = $d['plan_start']; }
		if ( isset( $d['requested_date'] ) ) { $upd['requested_date'] = $d['requested_date'] ?: null; }
		if ( isset( $d['transfer_rule'] ) && in_array( $d['transfer_rule'], array( '', 'next_day', 'same_day', 'full_lot' ), true ) ) { $upd['transfer_rule'] = $d['transfer_rule']; }
		if ( isset( $d['notes'] ) ) { $upd['notes'] = sanitize_textarea_field( $d['notes'] ); }
		$wpdb->update( JMG_DB::table( 'orders' ), $upd, array( 'id' => $id ) );
		if ( isset( $d['ops'] ) && is_array( $d['ops'] ) ) {
			foreach ( $d['ops'] as $op ) {
				if ( empty( $op['id'] ) ) { continue; }
				$u = array();
				if ( array_key_exists( 'earliest_start', $op ) ) { $u['earliest_start'] = $op['earliest_start'] ?: null; }
				if ( array_key_exists( 'manual_minutes', $op ) ) { $u['manual_minutes'] = ( '' === $op['manual_minutes'] || null === $op['manual_minutes'] ) ? null : max( 0, (float) $op['manual_minutes'] ); }
				if ( array_key_exists( 'manual_section_id', $op ) ) { $u['manual_section_id'] = $op['manual_section_id'] ? (int) $op['manual_section_id'] : null; }
				if ( $u ) { $wpdb->update( JMG_DB::table( 'order_ops' ), $u, array( 'id' => (int) $op['id'], 'order_id' => $id ) ); }
			}
		}
		JMG_Audit::log( 'order_adjust', 'order', $id, $d );
		$r = self::plan_order( $id );
		if ( is_wp_error( $r ) ) { return $r; }
		if ( in_array( $o['status'], array( 'CONFIRMED', 'IN_PROGRESS' ), true ) ) { self::check_delay_alerts( $id ); }
		return self::get( $id );
	}

	/** Re-schedule every open order in priority order (used after capacity / calendar changes). */
	public static function replan_all() {
		global $wpdb;
		$ids = $wpdb->get_col( 'SELECT id FROM ' . JMG_DB::table( 'orders' ) . " WHERE status IN ('CONFIRMED','IN_PROGRESS') ORDER BY CASE priority WHEN 'Critical' THEN 0 WHEN 'Urgent' THEN 1 ELSE 2 END, COALESCE(requested_date,'9999-12-31'), confirmed_at, id" );
		$wpdb->query( 'DELETE s FROM ' . JMG_DB::table( 'op_schedule' ) . ' s WHERE s.is_actual=0 AND s.order_id IN (SELECT id FROM ' . JMG_DB::table( 'orders' ) . " WHERE status IN ('CONFIRMED','IN_PROGRESS'))" );
		if ( $wpdb->last_error ) { // fall back for engines without multi-table delete
			foreach ( $ids as $id ) { $wpdb->delete( JMG_DB::table( 'op_schedule' ), array( 'order_id' => $id, 'is_actual' => 0 ) ); }
		}
		$n = 0;
		foreach ( $ids as $id ) { self::plan_order( $id ); self::check_delay_alerts( $id ); $n++; }
		// drafts afterwards (they do not reserve capacity)
		foreach ( $wpdb->get_col( 'SELECT id FROM ' . JMG_DB::table( 'orders' ) . " WHERE status='DRAFT'" ) as $id ) { self::plan_order( $id ); }
		JMG_Audit::log( 'replan_all', 'order', '', array( 'orders' => $n ) );
		return $n;
	}

	/** Compare forecast with baseline / requested date and raise alerts. */
	public static function check_delay_alerts( $order_id ) {
		global $wpdb;
		$o = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', $order_id ), ARRAY_A );
		if ( ! $o || ! $o['forecast_end'] ) { return; }
		if ( $o['baseline_end'] && $o['forecast_end'] > $o['baseline_end'] ) {
			$days = JMG_Calendar::working_days_between( $o['baseline_end'], $o['forecast_end'] ) - 1;
			self::add_alert( $order_id, $o['order_no'], 'delay', 'serious', 'planning,management', sprintf( 'Forecast completion %s is %d working day(s) later than the confirmed baseline %s.', $o['forecast_end'], $days, $o['baseline_end'] ) );
		}
		if ( $o['requested_date'] && $o['forecast_end'] > $o['requested_date'] ) {
			self::add_alert( $order_id, $o['order_no'], 'delivery_risk', 'warning', 'sales,planning', sprintf( 'Forecast completion %s is later than the Sales requested delivery date %s.', $o['forecast_end'], $o['requested_date'] ) );
		}
	}

	public static function add_alert( $order_id, $order_no, $type, $severity, $audience, $message ) {
		global $wpdb;
		$t = JMG_DB::table( 'alerts' );
		$dup = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE order_id=%d AND alert_type=%s AND message=%s AND is_ack=0", $order_id, $type, $message ) );
		if ( $dup ) { return; }
		// an updated alert of the same type supersedes the previous open one
		$wpdb->query( $wpdb->prepare( "UPDATE $t SET is_ack=1, ack_by=0 WHERE order_id=%d AND alert_type=%s AND is_ack=0", $order_id, $type ) );
		$wpdb->insert( $t, array( 'order_id' => $order_id, 'order_no' => $order_no, 'alert_type' => $type, 'severity' => $severity, 'audience' => $audience, 'message' => $message, 'is_ack' => 0, 'created_at' => JMG_DB::now() ) );
	}

	/* ---------------------------------------------------------------- */
	/* Reading                                                            */
	/* ---------------------------------------------------------------- */
	public static function list_orders( $f = array() ) {
		global $wpdb;
		$t = JMG_DB::table( 'orders' );
		$where = '1=1'; $p = array();
		if ( ! empty( $f['status'] ) ) { $where .= ' AND status=%s'; $p[] = $f['status']; }
		if ( ! empty( $f['category'] ) ) { $where .= ' AND category=%s'; $p[] = $f['category']; }
		if ( ! empty( $f['product_code'] ) ) { $where .= ' AND product_code=%s'; $p[] = $f['product_code']; }
		if ( ! empty( $f['q'] ) ) { $like = '%' . $wpdb->esc_like( $f['q'] ) . '%'; $where .= ' AND (order_no LIKE %s OR product_code LIKE %s OR customer LIKE %s OR description LIKE %s)'; array_push( $p, $like, $like, $like, $like ); }
		if ( ! empty( $f['open'] ) ) { $where .= " AND status IN ('DRAFT','CONFIRMED','IN_PROGRESS')"; }
		$sql = "SELECT id, order_no, request_id, product_code, description, category, qty, qty_completed, priority, status, requested_date, plan_start, planned_start, planned_end, baseline_end, forecast_end, actual_end, lead_time_days, bottleneck, planned_cost, cost_status, customer, sales_ref, confirmed_at, created_at FROM $t WHERE $where ORDER BY id DESC LIMIT 500";
		$rows = $wpdb->get_results( $p ? $wpdb->prepare( $sql, $p ) : $sql, ARRAY_A );
		foreach ( $rows as &$r ) { $r['delayed'] = self::is_delayed( $r ); }
		return $rows;
	}

	public static function is_delayed( $o ) {
		if ( in_array( $o['status'], array( 'CANCELLED', 'DRAFT' ), true ) ) { return false; }
		$end = $o['actual_end'] ?: $o['forecast_end'];
		if ( ! $end ) { return false; }
		if ( $o['baseline_end'] && $end > $o['baseline_end'] ) { return true; }
		if ( $o['requested_date'] && $end > $o['requested_date'] ) { return true; }
		return false;
	}

	public static function get( $id ) {
		global $wpdb;
		$o = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', $id ), ARRAY_A );
		if ( ! $o ) { return new WP_Error( 'jmg_404', 'Order not found' ); }
		$o['schedule'] = json_decode( $o['schedule_json'], true ); unset( $o['schedule_json'] );
		$o['warnings'] = json_decode( $o['warnings_json'], true ) ?: array(); unset( $o['warnings_json'] );
		$o['delayed'] = self::is_delayed( $o );
		$o['components'] = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'order_components' ) . ' WHERE order_id=%d ORDER BY level, id', $id ), ARRAY_A );
		$oh = JMG_Inventory::on_hand_map();
		foreach ( $o['components'] as &$c ) {
			$c['on_hand'] = round( array_sum( $oh[ $c['component_code'] ] ?? array() ), 4 );
			$c['shortage'] = in_array( $c['comp_kind'], array( 'material', 'purchased_assembly' ), true ) ? round( max( 0, (float) $c['total_qty'] - (float) $c['inventory_qty'] ), 4 ) : 0;
		}
		unset( $c );
		$o['stock_moves'] = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'stock_txns' ) . ' WHERE order_id=%d ORDER BY id DESC LIMIT 300', $id ), ARRAY_A );
		$ops = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'order_ops' ) . ' WHERE order_id=%d ORDER BY level DESC, component_code, sequence, id', $id ), ARRAY_A );
		foreach ( $ops as &$op ) {
			$op['daily'] = json_decode( $op['daily_json'], true ) ?: array(); unset( $op['daily_json'] );
			$op['machines'] = json_decode( $op['machines_json'], true ) ?: array(); unset( $op['machines_json'] );
			$op['predecessors'] = json_decode( $op['predecessors_json'], true ) ?: array(); unset( $op['predecessors_json'] );
			$op['qty_remaining'] = max( 0, (float) $op['qty_planned'] - (float) $op['qty_completed'] );
			$op['progress_pct'] = (float) $op['qty_planned'] > 0 ? round( 100 * (float) $op['qty_completed'] / (float) $op['qty_planned'], 1 ) : 0;
			$op['delayed'] = ( $op['baseline_end'] && ( $op['actual_end'] ?: $op['planned_end'] ) && ( $op['actual_end'] ?: $op['planned_end'] ) > $op['baseline_end'] );
		}
		unset( $op );
		$o['ops'] = $ops;
		$o['alerts'] = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'alerts' ) . ' WHERE order_id=%d ORDER BY id DESC', $id ), ARRAY_A );
		$o['logs'] = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'daily_logs' ) . ' WHERE order_id=%d ORDER BY log_date DESC, id DESC LIMIT 200', $id ), ARRAY_A );
		// departmental orders: ops grouped by section with daily targets
		$depts = array();
		foreach ( $ops as $op ) {
			if ( ! $op['section_name'] ) { continue; }
			$k = $op['section_name'];
			if ( ! isset( $depts[ $k ] ) ) { $depts[ $k ] = array( 'section_id' => $op['section_id'], 'section_name' => $op['section_name'], 'site' => $op['site'], 'department' => $op['department'], 'ops' => array(), 'daily' => array() ); }
			$depts[ $k ]['ops'][] = array( 'op_id' => $op['id'], 'component_code' => $op['component_code'], 'stage_name' => $op['stage_name'], 'qty_planned' => $op['qty_planned'], 'qty_completed' => $op['qty_completed'], 'planned_start' => $op['planned_start'], 'planned_end' => $op['planned_end'], 'status' => $op['status'] );
			foreach ( $op['daily'] as $d => $q ) { $depts[ $k ]['daily'][ $d ] = round( ( $depts[ $k ]['daily'][ $d ] ?? 0 ) + $q, 3 ); }
		}
		foreach ( $depts as &$d ) { ksort( $d['daily'] ); }
		unset( $d );
		$o['departments'] = array_values( $depts );
		$o['materials'] = array_values( array_filter( $o['components'], function( $c ) { return 'material' === $c['comp_kind'] || 'purchased_assembly' === $c['comp_kind']; } ) );
		$o['semi_finished'] = array_values( array_filter( $o['components'], function( $c ) { return 'assembly' === $c['comp_kind']; } ) );
		$o['cost'] = $o['schedule']['cost'] ?? null;
		$o['actual_cost'] = self::actual_cost( $id );
		return $o;
	}

	/** Actual cost to date: logged good quantities x labour/section minutes x rates (where available) + planned material share. */
	public static function actual_cost( $order_id ) {
		global $wpdb;
		$o = $wpdb->get_row( $wpdb->prepare( 'SELECT qty, qty_completed, planned_cost, schedule_json FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', $order_id ), ARRAY_A );
		if ( ! $o ) { return null; }
		$sched = json_decode( $o['schedule_json'], true );
		$cost = $sched['cost'] ?? null;
		if ( ! $cost || (float) $o['qty'] <= 0 ) { return null; }
		$done = (float) $o['qty_completed'];
		$ratio = $done / (float) $o['qty'];
		$logged_hours = (float) $wpdb->get_var( $wpdb->prepare( 'SELECT SUM(manpower) FROM ' . JMG_DB::table( 'daily_logs' ) . ' WHERE order_id=%d', $order_id ) );
		return array( 'finished_units' => $done, 'material_consumed_est' => round( $cost['material'] * $done, 2 ), 'labor_planned_share' => round( $cost['labor'] * $done, 2 ), 'logged_manpower_days' => $logged_hours, 'total_est' => round( $cost['total'] * $done, 2 ), 'planned_total' => (float) $o['planned_cost'], 'completion_ratio' => round( $ratio * 100, 1 ), 'note' => 'Actual cost = planned unit cost x finished units; actual material issues and payroll are not interfaced in this version.' );
	}
}
