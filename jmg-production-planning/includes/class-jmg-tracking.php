<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Daily production tracking per section and automatic re-forecasting. */
class JMG_Tracking {

	/** Operations a section can work on around a date (planned on that day, in progress, or overdue). */
	public static function section_worklist( $section_id, $date ) {
		global $wpdb;
		$ops = JMG_DB::table( 'order_ops' ); $ord = JMG_DB::table( 'orders' ); $sch = JMG_DB::table( 'op_schedule' );
		$where = "ord.status IN ('CONFIRMED','IN_PROGRESS') AND op.is_scheduled=1 AND op.status<>'COMPLETED'";
		$p = array();
		if ( $section_id ) { $where .= ' AND op.section_id=%d'; $p[] = (int) $section_id; }
		$sql = "SELECT op.*, ord.product_code, ord.description product_desc, ord.priority, ord.requested_date, ord.status order_status,
			(SELECT SUM(s.qty) FROM $sch s WHERE s.op_id=op.id AND s.sched_date=%s AND s.is_actual=0 AND s.resource_key LIKE 'section:%%') planned_today,
			(SELECT SUM(s.qty) FROM $sch s WHERE s.op_id=op.id AND s.sched_date<%s AND s.is_actual=0 AND s.resource_key LIKE 'section:%%') planned_overdue
			FROM $ops op JOIN $ord ord ON ord.id=op.order_id WHERE $where ORDER BY op.planned_start, ord.priority, op.id";
		array_unshift( $p, $date, $date );
		$rows = $wpdb->get_results( $wpdb->prepare( $sql, $p ), ARRAY_A );
		foreach ( $rows as &$r ) {
			$r['daily'] = json_decode( $r['daily_json'], true ) ?: array();
			unset( $r['daily_json'], $r['machines_json'], $r['predecessors_json'] );
			$r['planned_today'] = round( (float) $r['planned_today'], 2 );
			$r['planned_overdue'] = round( (float) $r['planned_overdue'], 2 );
			$r['qty_remaining'] = max( 0, (float) $r['qty_planned'] - (float) $r['qty_completed'] );
			$r['target_today'] = round( $r['planned_today'] + $r['planned_overdue'], 2 );
		}
		return $rows;
	}

	/** Record a day's production for an operation. */
	public static function log( $d ) {
		global $wpdb;
		$op = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'order_ops' ) . ' WHERE id=%d', (int) ( $d['op_id'] ?? 0 ) ), ARRAY_A );
		if ( ! $op ) { return new WP_Error( 'jmg_404', 'Operation not found' ); }
		$order = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', $op['order_id'] ), ARRAY_A );
		if ( ! $order || ! in_array( $order['status'], array( 'CONFIRMED', 'IN_PROGRESS' ), true ) ) { return new WP_Error( 'jmg_state', 'Production can only be recorded on confirmed orders.' ); }
		$user = wp_get_current_user();
		if ( ! current_user_can( 'jmg_plan' ) && ! current_user_can( 'jmg_manage' ) ) {
			$allowed = JMG_Roles::user_sections( $user->ID );
			if ( $allowed && ! in_array( (int) $op['section_id'], $allowed, true ) ) { return new WP_Error( 'jmg_forbidden', 'You are not assigned to this section.' ); }
		}
		$date = ! empty( $d['log_date'] ) ? $d['log_date'] : JMG_Calendar::today();
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date ) ) { return new WP_Error( 'jmg_validation', 'Invalid production date.' ); }
		$actual = max( 0, (float) ( $d['actual_qty'] ?? 0 ) );
		$rejected = max( 0, (float) ( $d['rejected_qty'] ?? 0 ) );
		$rework = max( 0, (float) ( $d['rework_qty'] ?? 0 ) );
		$wip = max( 0, (float) ( $d['wip_qty'] ?? 0 ) );
		$downtime = max( 0, (float) ( $d['downtime_min'] ?? 0 ) );
		$remaining = max( 0, (float) $op['qty_planned'] - (float) $op['qty_completed'] );
		if ( $actual > $remaining + 0.0005 ) { return new WP_Error( 'jmg_validation', sprintf( 'Actual good quantity %s exceeds the remaining planned quantity %s for this operation.', $actual, $remaining ) ); }
		$planned = isset( $d['planned_qty'] ) && '' !== $d['planned_qty'] ? (float) $d['planned_qty'] : (float) $wpdb->get_var( $wpdb->prepare( 'SELECT SUM(qty) FROM ' . JMG_DB::table( 'op_schedule' ) . " WHERE op_id=%d AND sched_date=%s AND resource_key LIKE 'section:%%'", $op['id'], $date ) );
		$achievement = $planned > 0 ? round( 100 * $actual / $planned, 2 ) : null;
		$row = array(
			'log_date' => $date, 'order_id' => $op['order_id'], 'order_no' => $op['order_no'], 'op_id' => $op['id'], 'section_id' => $op['section_id'], 'section_name' => $op['section_name'],
			'component_code' => $op['component_code'], 'stage_name' => $op['stage_name'], 'planned_qty' => $planned, 'actual_qty' => $actual, 'rejected_qty' => $rejected, 'rework_qty' => $rework, 'wip_qty' => $wip,
			'downtime_min' => $downtime, 'manpower' => isset( $d['manpower'] ) && '' !== $d['manpower'] ? (float) $d['manpower'] : null, 'remarks' => sanitize_textarea_field( $d['remarks'] ?? '' ), 'delay_reason' => sanitize_text_field( $d['delay_reason'] ?? '' ),
			'achievement_pct' => $achievement, 'created_by' => $user->ID, 'created_at' => JMG_DB::now(),
		);
		$wpdb->insert( JMG_DB::table( 'daily_logs' ), $row );
		$log_id = (int) $wpdb->insert_id;
		// operation progress
		$completed = (float) $op['qty_completed'] + $actual;
		$upd = array( 'qty_completed' => $completed, 'qty_rejected' => (float) $op['qty_rejected'] + $rejected, 'qty_rework' => (float) $op['qty_rework'] + $rework );
		if ( ! $op['actual_start'] || $date < $op['actual_start'] ) { $upd['actual_start'] = $date; }
		if ( $completed >= (float) $op['qty_planned'] - 0.0005 ) { $upd['status'] = 'COMPLETED'; $upd['actual_end'] = $date; } else { $upd['status'] = 'IN_PROGRESS'; }
		$wpdb->update( JMG_DB::table( 'order_ops' ), $upd, array( 'id' => $op['id'] ) );
		// schedule: replace planned allocation of that day by the actual
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . JMG_DB::table( 'op_schedule' ) . ' WHERE op_id=%d AND sched_date=%s', $op['id'], $date ) );
		$mpu = (float) $op['minutes_per_unit'];
		$wpdb->insert( JMG_DB::table( 'op_schedule' ), array( 'order_id' => $op['order_id'], 'op_id' => $op['id'], 'section_id' => $op['section_id'], 'resource_key' => 'section:' . (int) $op['section_id'], 'sched_date' => $date, 'qty' => $actual, 'minutes' => round( $actual * $mpu + $downtime, 3 ), 'is_actual' => 1 ) );
		// order status
		$oupd = array( 'updated_at' => JMG_DB::now() );
		if ( 'CONFIRMED' === $order['status'] ) { $oupd['status'] = 'IN_PROGRESS'; }
		// finished units = completed quantity of the final (highest sequence, level 0) scheduled operation
		$final = $wpdb->get_row( $wpdb->prepare( 'SELECT id, qty_completed, qty_planned, status FROM ' . JMG_DB::table( 'order_ops' ) . ' WHERE order_id=%d AND is_scheduled=1 ORDER BY level ASC, sequence DESC, id DESC LIMIT 1', $op['order_id'] ), ARRAY_A );
		if ( $final ) { $oupd['qty_completed'] = (float) $final['qty_completed']; }
		$wpdb->update( JMG_DB::table( 'orders' ), $oupd, array( 'id' => $op['order_id'] ) );
		JMG_Audit::log( 'daily_log', 'order', $op['order_id'], array( 'log_id' => $log_id, 'op' => $op['component_code'] . ' / ' . $op['stage_name'], 'date' => $date, 'actual' => $actual, 'rejected' => $rejected, 'rework' => $rework ) );
		$moves = JMG_Inventory::backflush( $order, $op, $actual, $rejected, $date, $log_id );
		// re-forecast remaining work from the next working day (never before today)
		$from = JMG_Calendar::next_working( JMG_Calendar::add_days( $date, 1 ) );
		if ( JMG_Calendar::today() > $from ) { $from = JMG_Calendar::today(); }
		JMG_Orders::plan_order( $op['order_id'], array( 'from' => $from ) );
		JMG_Orders::check_delay_alerts( $op['order_id'] );
		$o = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', $op['order_id'] ), ARRAY_A );
		if ( $planned > 0 && $actual < $planned ) {
			JMG_Orders::add_alert( $op['order_id'], $op['order_no'], 'shortfall', 'warning', 'planning', sprintf( '%s / %s on %s: %s of %s planned units completed (%s%%). Balance of %s carried forward; forecast completion now %s.', $op['section_name'], $op['component_code'], $date, rtrim( rtrim( number_format( $actual, 2, '.', '' ), '0' ), '.' ), rtrim( rtrim( number_format( $planned, 2, '.', '' ), '0' ), '.' ), $achievement, rtrim( rtrim( number_format( $planned - $actual, 2, '.', '' ), '0' ), '.' ), $o['forecast_end'] ) );
		}
		$row['id'] = $log_id;
		$row['stock_moves'] = count( $moves );
		$row['forecast_end'] = $o['forecast_end'];
		$row['baseline_end'] = $o['baseline_end'];
		$row['order_status'] = $o['status'];
		return $row;
	}

	public static function list_logs( $f = array() ) {
		global $wpdb;
		$t = JMG_DB::table( 'daily_logs' );
		$where = '1=1'; $p = array();
		if ( ! empty( $f['section_id'] ) ) { $where .= ' AND section_id=%d'; $p[] = (int) $f['section_id']; }
		if ( ! empty( $f['order_id'] ) ) { $where .= ' AND order_id=%d'; $p[] = (int) $f['order_id']; }
		if ( ! empty( $f['from'] ) ) { $where .= ' AND log_date>=%s'; $p[] = $f['from']; }
		if ( ! empty( $f['to'] ) ) { $where .= ' AND log_date<=%s'; $p[] = $f['to']; }
		$sql = "SELECT * FROM $t WHERE $where ORDER BY log_date DESC, id DESC LIMIT 1000";
		return $wpdb->get_results( $p ? $wpdb->prepare( $sql, $p ) : $sql, ARRAY_A );
	}

	public static function delete_log( $id ) {
		global $wpdb;
		$t = JMG_DB::table( 'daily_logs' );
		$log = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id=%d", $id ), ARRAY_A );
		if ( ! $log ) { return new WP_Error( 'jmg_404', 'Log not found' ); }
		$op = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'order_ops' ) . ' WHERE id=%d', $log['op_id'] ), ARRAY_A );
		if ( $op ) {
			$completed = max( 0, (float) $op['qty_completed'] - (float) $log['actual_qty'] );
			$wpdb->update( JMG_DB::table( 'order_ops' ), array( 'qty_completed' => $completed, 'qty_rejected' => max( 0, (float) $op['qty_rejected'] - (float) $log['rejected_qty'] ), 'qty_rework' => max( 0, (float) $op['qty_rework'] - (float) $log['rework_qty'] ), 'status' => $completed > 0 ? 'IN_PROGRESS' : 'PENDING', 'actual_end' => null ), array( 'id' => $op['id'] ) );
			$wpdb->delete( JMG_DB::table( 'op_schedule' ), array( 'op_id' => $op['id'], 'sched_date' => $log['log_date'], 'is_actual' => 1 ) );
		}
		JMG_Inventory::reverse_log( $id, $log['order_id'] );
		$wpdb->delete( $t, array( 'id' => $id ) );
		JMG_Audit::log( 'daily_log_delete', 'order', $log['order_id'], array( 'log_id' => $id ) );
		if ( $op ) { JMG_Orders::plan_order( $op['order_id'] ); JMG_Orders::check_delay_alerts( $op['order_id'] ); }
		return true;
	}
}
