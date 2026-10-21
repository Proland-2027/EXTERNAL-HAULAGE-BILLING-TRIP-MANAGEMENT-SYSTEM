<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Dashboard, monthly reports and Gantt data. */
class JMG_Reports {

	private static function order_filter_sql( $f, &$p, $alias = 'o' ) {
		$w = '1=1';
		if ( ! empty( $f['category'] ) ) { $w .= " AND $alias.category=%s"; $p[] = $f['category']; }
		if ( ! empty( $f['product_code'] ) ) { $w .= " AND $alias.product_code=%s"; $p[] = $f['product_code']; }
		if ( ! empty( $f['status'] ) ) { $w .= " AND $alias.status=%s"; $p[] = $f['status']; }
		return $w;
	}

	public static function dashboard( $f = array() ) {
		global $wpdb;
		$o = JMG_DB::table( 'orders' ); $ops = JMG_DB::table( 'order_ops' ); $logs = JMG_DB::table( 'daily_logs' ); $sch = JMG_DB::table( 'op_schedule' ); $sec = JMG_DB::table( 'sections' );
		$month = ! empty( $f['month'] ) ? $f['month'] : current_time( 'Y-m' );
		$from = ! empty( $f['from'] ) ? $f['from'] : $month . '-01';
		$to = ! empty( $f['to'] ) ? $f['to'] : gmdate( 'Y-m-t', strtotime( $month . '-01' ) );
		$p = array();
		$w = self::order_filter_sql( $f, $p );
		$orders = $wpdb->get_results( $p ? $wpdb->prepare( "SELECT * FROM $o o WHERE $w AND status<>'CANCELLED'", $p ) : "SELECT * FROM $o o WHERE $w AND status<>'CANCELLED'", ARRAY_A );
		$req_waiting = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . JMG_DB::table( 'requests' ) . " WHERE status IN ('NEW','PLANNED')" );
		$counts = array( 'total' => count( $orders ), 'awaiting_planning' => $req_waiting, 'draft' => 0, 'confirmed' => 0, 'in_progress' => 0, 'completed' => 0, 'delayed' => 0 );
		$upcoming = array();
		foreach ( $orders as $r ) {
			$k = strtolower( $r['status'] );
			if ( isset( $counts[ $k ] ) ) { $counts[ $k ]++; }
			if ( JMG_Orders::is_delayed( $r ) ) { $counts['delayed']++; }
			if ( in_array( $r['status'], array( 'CONFIRMED', 'IN_PROGRESS' ), true ) ) {
				$upcoming[] = array( 'id' => $r['id'], 'order_no' => $r['order_no'], 'product_code' => $r['product_code'], 'qty' => $r['qty'], 'qty_completed' => $r['qty_completed'], 'forecast_end' => $r['forecast_end'], 'baseline_end' => $r['baseline_end'], 'requested_date' => $r['requested_date'], 'status' => $r['status'], 'delayed' => JMG_Orders::is_delayed( $r ), 'priority' => $r['priority'], 'customer' => $r['customer'] );
			}
		}
		usort( $upcoming, function( $a, $b ) { return strcmp( (string) $a['forecast_end'], (string) $b['forecast_end'] ); } );
		// finished units in period: completed quantity logged on final operations (level 0, highest sequence)
		$dept_w = ! empty( $f['department'] ) ? $wpdb->prepare( ' AND s.department=%s', $f['department'] ) : '';
		$sec_w = ! empty( $f['section_id'] ) ? $wpdb->prepare( ' AND l.section_id=%d', (int) $f['section_id'] ) : '';
		$ofilter_p = array(); $ofilter = self::order_filter_sql( $f, $ofilter_p, 'o' );
		$ofilter_sql = $ofilter_p ? $wpdb->prepare( $ofilter, $ofilter_p ) : $ofilter;
		$finished = (float) $wpdb->get_var( $wpdb->prepare( "SELECT SUM(l.actual_qty) FROM $logs l JOIN $ops op ON op.id=l.op_id JOIN $o o ON o.id=l.order_id WHERE l.log_date BETWEEN %s AND %s AND op.level=0 AND op.sequence=(SELECT MAX(sequence) FROM $ops x WHERE x.order_id=op.order_id AND x.level=0 AND x.is_scheduled=1) AND $ofilter_sql", $from, $to ) );
		// planned vs actual by day (section allocations)
		$daily = $wpdb->get_results( $wpdb->prepare( "SELECT s.sched_date d, SUM(CASE WHEN s.is_actual=0 THEN s.qty ELSE 0 END) planned, SUM(CASE WHEN s.is_actual=1 THEN s.qty ELSE 0 END) actual FROM $sch s JOIN $o o ON o.id=s.order_id JOIN $ops op ON op.id=s.op_id LEFT JOIN $sec se ON se.id=s.section_id WHERE s.sched_date BETWEEN %s AND %s AND s.resource_key LIKE 'section:%%' AND o.status<>'CANCELLED' AND o.status<>'DRAFT' AND $ofilter_sql " . str_replace( 's.department', 'se.department', $dept_w ) . str_replace( 'l.section_id', 's.section_id', $sec_w ) . ' GROUP BY s.sched_date ORDER BY s.sched_date', $from, $to ), ARRAY_A );
		$logsum = $wpdb->get_row( $wpdb->prepare( "SELECT SUM(l.planned_qty) planned, SUM(l.actual_qty) actual, SUM(l.rejected_qty) rejected, SUM(l.rework_qty) rework, SUM(l.downtime_min) downtime, COUNT(*) n FROM $logs l JOIN $o o ON o.id=l.order_id LEFT JOIN $sec s ON s.id=l.section_id WHERE l.log_date BETWEEN %s AND %s AND $ofilter_sql $dept_w $sec_w", $from, $to ), ARRAY_A );
		$achievement = ( $logsum && (float) $logsum['planned'] > 0 ) ? round( 100 * (float) $logsum['actual'] / (float) $logsum['planned'], 1 ) : null;
		// WIP by section: open operations on confirmed orders
		$wip = $wpdb->get_results( "SELECT op.section_id, op.section_name, se.department, se.site, COUNT(*) open_ops, SUM(op.qty_planned - op.qty_completed) qty_remaining, SUM(op.qty_completed) qty_done, SUM(CASE WHEN op.status='IN_PROGRESS' THEN 1 ELSE 0 END) in_progress FROM $ops op JOIN $o o ON o.id=op.order_id LEFT JOIN $sec se ON se.id=op.section_id WHERE o.status IN ('CONFIRMED','IN_PROGRESS') AND op.is_scheduled=1 AND op.status<>'COMPLETED' AND op.section_id IS NOT NULL GROUP BY op.section_id, op.section_name, se.department, se.site ORDER BY qty_remaining DESC", ARRAY_A );
		// bottlenecks: resource utilisation over the next 10 working days
		$routing = new JMG_Routing();
		$today = JMG_Calendar::today();
		$horizon_end = JMG_Calendar::add_working_days( $today, 9 );
		$profile = JMG_Scheduler::load_profile( $today, $horizon_end );
		$agg = array();
		foreach ( $profile as $r ) { $agg[ $r['resource_key'] ] = ( $agg[ $r['resource_key'] ] ?? 0 ) + (float) $r['minutes']; }
		$wd = JMG_Calendar::working_days_between( $today, $horizon_end );
		$sched = new JMG_Scheduler( $routing );
		$bottlenecks = array();
		foreach ( $agg as $k => $mins ) {
			$capd = $routing->resource_minutes_per_day( $k ) * max( 1, $wd );
			$bottlenecks[] = array( 'resource_key' => $k, 'name' => $sched->resource_name( $k ), 'minutes' => round( $mins ), 'capacity' => round( $capd ), 'utilisation_pct' => $capd > 0 ? round( 100 * $mins / $capd, 1 ) : null );
		}
		usort( $bottlenecks, function( $a, $b ) { return ( $b['utilisation_pct'] ?? 0 ) <=> ( $a['utilisation_pct'] ?? 0 ); } );
		$order_bottlenecks = array();
		foreach ( $orders as $r ) { if ( $r['bottleneck'] && in_array( $r['status'], array( 'CONFIRMED', 'IN_PROGRESS' ), true ) ) { $order_bottlenecks[ $r['bottleneck'] ] = ( $order_bottlenecks[ $r['bottleneck'] ] ?? 0 ) + 1; } }
		arsort( $order_bottlenecks );
		$alerts = $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'alerts' ) . ' WHERE is_ack=0 ORDER BY id DESC LIMIT 30', ARRAY_A );
		return array(
			'period' => array( 'from' => $from, 'to' => $to, 'month' => $month ), 'counts' => $counts, 'finished_units' => $finished, 'achievement_pct' => $achievement, 'log_summary' => $logsum,
			'daily' => $daily, 'wip' => $wip, 'bottlenecks' => array_slice( $bottlenecks, 0, 10 ), 'order_bottlenecks' => $order_bottlenecks, 'upcoming' => array_slice( $upcoming, 0, 15 ), 'alerts' => $alerts,
			'horizon' => array( 'from' => $today, 'to' => $horizon_end, 'working_days' => $wd ),
		);
	}

	/** Monthly production report. */
	public static function monthly( $month, $category = '' ) {
		global $wpdb;
		$o = JMG_DB::table( 'orders' ); $ops = JMG_DB::table( 'order_ops' ); $logs = JMG_DB::table( 'daily_logs' ); $sch = JMG_DB::table( 'op_schedule' ); $sec = JMG_DB::table( 'sections' );
		$from = $month . '-01'; $to = gmdate( 'Y-m-t', strtotime( $from ) );
		$cat_w = $category ? $wpdb->prepare( ' AND o.category=%s', $category ) : '';
		// finished product planned vs actual
		$planned_fp = (float) $wpdb->get_var( $wpdb->prepare( "SELECT SUM(s.qty) FROM $sch s JOIN $ops op ON op.id=s.op_id JOIN $o o ON o.id=s.order_id WHERE s.sched_date BETWEEN %s AND %s AND s.resource_key LIKE 'section:%%' AND op.level=0 AND op.sequence=(SELECT MAX(sequence) FROM $ops x WHERE x.order_id=op.order_id AND x.level=0 AND x.is_scheduled=1) AND o.status IN ('CONFIRMED','IN_PROGRESS','COMPLETED') $cat_w", $from, $to ) );
		$actual_fp = (float) $wpdb->get_var( $wpdb->prepare( "SELECT SUM(l.actual_qty) FROM $logs l JOIN $ops op ON op.id=l.op_id JOIN $o o ON o.id=l.order_id WHERE l.log_date BETWEEN %s AND %s AND op.level=0 AND op.sequence=(SELECT MAX(sequence) FROM $ops x WHERE x.order_id=op.order_id AND x.level=0 AND x.is_scheduled=1) $cat_w", $from, $to ) );
		// by department / section
		$by_section = $wpdb->get_results( $wpdb->prepare( "SELECT se.id section_id, se.site, se.department, se.section_name, se.staffs, se.minutes_per_day,
			(SELECT SUM(s.qty) FROM $sch s JOIN $o o ON o.id=s.order_id WHERE s.section_id=se.id AND s.resource_key LIKE 'section:%%' AND s.sched_date BETWEEN %s AND %s AND o.status IN ('CONFIRMED','IN_PROGRESS','COMPLETED') $cat_w) planned_qty,
			(SELECT SUM(s.minutes) FROM $sch s JOIN $o o ON o.id=s.order_id WHERE s.section_id=se.id AND s.resource_key LIKE 'section:%%' AND s.sched_date BETWEEN %s AND %s AND o.status IN ('CONFIRMED','IN_PROGRESS','COMPLETED') $cat_w) planned_minutes,
			(SELECT SUM(l.actual_qty) FROM $logs l JOIN $o o ON o.id=l.order_id WHERE l.section_id=se.id AND l.log_date BETWEEN %s AND %s $cat_w) actual_qty,
			(SELECT SUM(l.rejected_qty) FROM $logs l JOIN $o o ON o.id=l.order_id WHERE l.section_id=se.id AND l.log_date BETWEEN %s AND %s $cat_w) rejected_qty,
			(SELECT SUM(l.rework_qty) FROM $logs l JOIN $o o ON o.id=l.order_id WHERE l.section_id=se.id AND l.log_date BETWEEN %s AND %s $cat_w) rework_qty,
			(SELECT SUM(l.downtime_min) FROM $logs l JOIN $o o ON o.id=l.order_id WHERE l.section_id=se.id AND l.log_date BETWEEN %s AND %s $cat_w) downtime_min,
			(SELECT SUM(l.manpower) FROM $logs l JOIN $o o ON o.id=l.order_id WHERE l.section_id=se.id AND l.log_date BETWEEN %s AND %s $cat_w) manpower_days,
			(SELECT COUNT(DISTINCT l.log_date) FROM $logs l JOIN $o o ON o.id=l.order_id WHERE l.section_id=se.id AND l.log_date BETWEEN %s AND %s $cat_w) days_logged,
			(SELECT SUM(l.planned_qty) FROM $logs l JOIN $o o ON o.id=l.order_id WHERE l.section_id=se.id AND l.log_date BETWEEN %s AND %s $cat_w) logged_planned_qty,
			(SELECT SUM(CASE WHEN l.actual_qty < l.planned_qty THEN 1 ELSE 0 END) FROM $logs l JOIN $o o ON o.id=l.order_id WHERE l.section_id=se.id AND l.log_date BETWEEN %s AND %s $cat_w) shortfall_days
			FROM $sec se WHERE se.is_active=1 ORDER BY se.site, se.department, se.section_name", $from, $to, $from, $to, $from, $to, $from, $to, $from, $to, $from, $to, $from, $to, $from, $to, $from, $to, $from, $to ), ARRAY_A );
		$wd = JMG_Calendar::working_days_between( $from, $to );
		$shifts = max( 1, (int) JMG_Settings::get( 'shifts_per_day', 1 ) );
		$rows = array();
		foreach ( $by_section as $r ) {
			if ( ! (float) $r['planned_qty'] && ! (float) $r['actual_qty'] ) { continue; }
			$avail = (float) $r['minutes_per_day'] * $shifts * $wd;
			$used = (float) $r['planned_minutes'];
			$r['planned_qty'] = round( (float) $r['planned_qty'], 2 );
			$r['actual_qty'] = round( (float) $r['actual_qty'], 2 );
			$r['achievement_pct'] = (float) $r['logged_planned_qty'] > 0 ? round( 100 * (float) $r['actual_qty'] / (float) $r['logged_planned_qty'], 1 ) : null;
			$r['utilisation_pct'] = $avail > 0 ? round( 100 * $used / $avail, 1 ) : null;
			$r['daily_productivity'] = (int) $r['days_logged'] > 0 ? round( (float) $r['actual_qty'] / (int) $r['days_logged'], 2 ) : null;
			$r['manpower_productivity'] = (float) $r['manpower_days'] > 0 ? round( (float) $r['actual_qty'] / (float) $r['manpower_days'], 2 ) : null;
			$rows[] = $r;
		}
		// daily totals
		$daily = $wpdb->get_results( $wpdb->prepare( "SELECT l.log_date d, SUM(l.planned_qty) planned, SUM(l.actual_qty) actual, SUM(l.rejected_qty) rejected, SUM(l.rework_qty) rework, SUM(l.downtime_min) downtime FROM $logs l JOIN $o o ON o.id=l.order_id WHERE l.log_date BETWEEN %s AND %s $cat_w GROUP BY l.log_date ORDER BY l.log_date", $from, $to ), ARRAY_A );
		// orders in the month: lead time, on-time
		$orders = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $o o WHERE o.status<>'CANCELLED' AND o.status<>'DRAFT' AND ((o.planned_end BETWEEN %s AND %s) OR (o.forecast_end BETWEEN %s AND %s) OR (o.actual_end BETWEEN %s AND %s)) $cat_w ORDER BY o.forecast_end", $from, $to, $from, $to, $from, $to ), ARRAY_A );
		$on_time = 0; $completed = 0; $lead = array(); $delays = array();
		foreach ( $orders as &$r ) {
			$r['delayed'] = JMG_Orders::is_delayed( $r );
			$end = $r['actual_end'] ?: $r['forecast_end'];
			$r['delay_days'] = ( $r['baseline_end'] && $end && $end > $r['baseline_end'] ) ? JMG_Calendar::working_days_between( $r['baseline_end'], $end ) - 1 : 0;
			$r['lead_time_days'] = ( $r['planned_start'] && $end ) ? JMG_Calendar::working_days_between( $r['planned_start'], $end ) : $r['lead_time_days'];
			if ( 'COMPLETED' === $r['status'] ) { $completed++; if ( ! $r['delayed'] ) { $on_time++; } }
			if ( $r['lead_time_days'] ) { $lead[] = (int) $r['lead_time_days']; }
			if ( $r['delay_days'] > 0 ) { $delays[] = array( 'order_no' => $r['order_no'], 'product_code' => $r['product_code'], 'baseline_end' => $r['baseline_end'], 'forecast_end' => $end, 'delay_days' => $r['delay_days'], 'status' => $r['status'] ); }
			unset( $r['schedule_json'], $r['warnings_json'] );
		}
		unset( $r );
		$delay_reasons = $wpdb->get_results( $wpdb->prepare( "SELECT l.delay_reason reason, COUNT(*) n, SUM(l.planned_qty - l.actual_qty) shortfall FROM $logs l JOIN $o o ON o.id=l.order_id WHERE l.log_date BETWEEN %s AND %s AND l.delay_reason<>'' $cat_w GROUP BY l.delay_reason ORDER BY n DESC", $from, $to ), ARRAY_A );
		$tot = array( 'planned' => 0, 'actual' => 0, 'rejected' => 0, 'rework' => 0, 'downtime' => 0 );
		foreach ( $daily as $d ) { $tot['planned'] += (float) $d['planned']; $tot['actual'] += (float) $d['actual']; $tot['rejected'] += (float) $d['rejected']; $tot['rework'] += (float) $d['rework']; $tot['downtime'] += (float) $d['downtime']; }
		return array(
			'month' => $month, 'category' => $category, 'from' => $from, 'to' => $to, 'working_days' => $wd,
			'finished' => array( 'planned' => round( $planned_fp, 2 ), 'actual' => round( $actual_fp, 2 ), 'achievement_pct' => $planned_fp > 0 ? round( 100 * $actual_fp / $planned_fp, 1 ) : null ),
			'sections' => $rows, 'daily' => $daily, 'totals' => $tot, 'achievement_pct' => $tot['planned'] > 0 ? round( 100 * $tot['actual'] / $tot['planned'], 1 ) : null,
			'orders' => $orders, 'delays' => $delays, 'delay_reasons' => $delay_reasons,
			'lead_time_avg' => $lead ? round( array_sum( $lead ) / count( $lead ), 1 ) : null, 'lead_time_max' => $lead ? max( $lead ) : null,
			'on_time_pct' => $completed > 0 ? round( 100 * $on_time / $completed, 1 ) : null, 'completed_orders' => $completed, 'on_time_orders' => $on_time,
		);
	}

	/** Gantt data: orders with their operations and dependencies. */
	public static function gantt( $f = array() ) {
		global $wpdb;
		$o = JMG_DB::table( 'orders' ); $ops = JMG_DB::table( 'order_ops' );
		$p = array(); $w = self::order_filter_sql( $f, $p );
		if ( ! empty( $f['order_id'] ) ) { $w .= ' AND o.id=%d'; $p[] = (int) $f['order_id']; }
		if ( empty( $f['status'] ) ) { $w .= " AND o.status IN ('DRAFT','CONFIRMED','IN_PROGRESS','COMPLETED')"; }
		if ( empty( $f['include_completed'] ) && empty( $f['order_id'] ) && empty( $f['status'] ) ) { $w .= " AND o.status<>'COMPLETED'"; }
		$sql = "SELECT o.id, o.order_no, o.product_code, o.description, o.qty, o.qty_completed, o.status, o.priority, o.planned_start, o.planned_end, o.baseline_start, o.baseline_end, o.forecast_end, o.requested_date, o.actual_end, o.bottleneck, o.customer FROM $o o WHERE $w ORDER BY o.planned_start, o.id LIMIT 60";
		$orders = $wpdb->get_results( $p ? $wpdb->prepare( $sql, $p ) : $sql, ARRAY_A );
		$ids = array_map( function( $r ) { return (int) $r['id']; }, $orders );
		$by_order = array();
		if ( $ids ) {
			$dept_w = ! empty( $f['department'] ) ? $wpdb->prepare( ' AND department=%s', $f['department'] ) : '';
			$rows = $wpdb->get_results( "SELECT id, order_id, component_code, component_desc, stage_key, stage_name, workflow_group, department, section_id, section_name, site, sequence, level, qty_planned, qty_completed, baseline_start, baseline_end, planned_start, planned_end, actual_start, actual_end, status, is_scheduled, capacity_match, predecessors_json, daily_json FROM $ops WHERE order_id IN (" . implode( ',', $ids ) . ") $dept_w ORDER BY level DESC, component_code, sequence", ARRAY_A );
			foreach ( $rows as $r ) {
				$r['predecessors'] = json_decode( $r['predecessors_json'], true ) ?: array(); unset( $r['predecessors_json'] );
				$r['daily'] = json_decode( $r['daily_json'], true ) ?: array(); unset( $r['daily_json'] );
				$r['progress_pct'] = (float) $r['qty_planned'] > 0 ? round( 100 * (float) $r['qty_completed'] / (float) $r['qty_planned'], 1 ) : 0;
				$r['delayed'] = ( $r['baseline_end'] && ( $r['actual_end'] ?: $r['planned_end'] ) > $r['baseline_end'] );
				$by_order[ $r['order_id'] ][] = $r;
			}
		}
		foreach ( $orders as &$ord ) { $ord['ops'] = $by_order[ $ord['id'] ] ?? array(); $ord['delayed'] = JMG_Orders::is_delayed( $ord ); }
		unset( $ord );
		$min = null; $max = null;
		foreach ( $orders as $ord ) {
			foreach ( array( $ord['planned_start'], $ord['baseline_start'] ) as $d ) { if ( $d && ( null === $min || $d < $min ) ) { $min = $d; } }
			foreach ( array( $ord['planned_end'], $ord['baseline_end'], $ord['forecast_end'], $ord['requested_date'] ) as $d ) { if ( $d && ( null === $max || $d > $max ) ) { $max = $d; } }
		}
		return array( 'orders' => $orders, 'range' => array( 'from' => $min, 'to' => $max ), 'today' => JMG_Calendar::today() );
	}
}
