<?php
/**
 * Dashboard, monthly reporting and Gantt data.
 */
class PP_Reports {

	/** Management dashboard. $f: month (YYYY-MM), product_type, department, product, status, from, to */
	public static function dashboard( $f = array() ) {
		$today = PP_Db::today();
		$month = ! empty( $f['month'] ) ? $f['month'] : substr( $today, 0, 7 );
		$m_from = $month . '-01';
		$m_to   = date( 'Y-m-t', strtotime( $m_from ) );
		$rw = array( '1=1' ); $ra = array();
		if ( ! empty( $f['product_type'] ) ) { $rw[] = 'r.product_type = %s'; $ra[] = $f['product_type']; }
		if ( ! empty( $f['product'] ) ) { $rw[] = 'r.product_code = %s'; $ra[] = $f['product']; }
		if ( ! empty( $f['status'] ) ) { $rw[] = 'r.status = %s'; $ra[] = $f['status']; }
		if ( ! empty( $f['from'] ) ) { $rw[] = 'r.created_at >= %s'; $ra[] = $f['from'] . ' 00:00:00'; }
		if ( ! empty( $f['to'] ) ) { $rw[] = 'r.created_at <= %s'; $ra[] = $f['to'] . ' 23:59:59'; }
		$rsql = 'SELECT r.* FROM ' . PP_Db::t( 'sales_requests' ) . ' r WHERE ' . implode( ' AND ', $rw ) . ' ORDER BY r.id DESC';
		$requests = PP_Db::rows( $rsql, ...$ra );
		$k = array( 'total' => count( $requests ), 'awaiting' => 0, 'planned' => 0, 'in_progress' => 0, 'completed' => 0, 'delayed' => 0, 'cancelled' => 0 );
		$delayed_ids = array();
		foreach ( $requests as &$r ) {
			$st = $r['status'];
			if ( 'Submitted' === $st ) { $k['awaiting']++; }
			elseif ( 'Planned' === $st ) { $k['planned']++; }
			elseif ( in_array( $st, array( 'Confirmed', 'In Progress' ), true ) ) { $k['in_progress']++; }
			elseif ( 'Completed' === $st ) { $k['completed']++; }
			elseif ( 'Cancelled' === $st ) { $k['cancelled']++; }
			$r['is_delayed'] = false;
			if ( ! in_array( $st, array( 'Completed', 'Cancelled', 'Submitted' ), true ) ) {
				$fc = $r['forecast_completion'] ?: $r['expected_completion'];
				if ( ( $fc && $r['expected_completion'] && $fc > $r['expected_completion'] ) || ( $r['delivery_date'] && $fc && $fc > $r['delivery_date'] ) ) {
					$r['is_delayed'] = true; $k['delayed']++; $delayed_ids[] = $r['id'];
				}
			}
		}
		unset( $r );
		$req_ids = array_map( 'intval', array_column( $requests, 'id' ) );
		$in = $req_ids ? implode( ',', $req_ids ) : '0';
		$dw = ''; $da = array();
		if ( ! empty( $f['department'] ) ) { $dw = ' AND w.department_code = %s'; $da[] = $f['department']; }

		// monthly planned vs actual (finished products = last op of master orders; departments = all)
		$planned_fp = (float) PP_Db::var( 'SELECT COALESCE(SUM(dt.planned_qty),0) FROM ' . PP_Db::t( 'daily_targets' ) . ' dt JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = dt.wo_id JOIN ' . PP_Db::t( 'production_orders' ) . ' po ON po.id = w.production_order_id JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = w.plan_id WHERE p.status = 'confirmed' AND dt.kind = 'baseline' AND po.is_master = 1 AND w.is_last_op = 1 AND dt.target_date BETWEEN %s AND %s AND w.request_id IN ($in)", $m_from, $m_to );
		$actual_fp  = (float) PP_Db::var( 'SELECT COALESCE(SUM(e.good_qty),0) FROM ' . PP_Db::t( 'production_entries' ) . ' e JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = e.wo_id JOIN ' . PP_Db::t( 'production_orders' ) . " po ON po.id = w.production_order_id WHERE po.is_master = 1 AND w.is_last_op = 1 AND e.entry_date BETWEEN %s AND %s AND w.request_id IN ($in)", $m_from, $m_to );
		$planned_all = (float) PP_Db::var( 'SELECT COALESCE(SUM(dt.planned_qty),0) FROM ' . PP_Db::t( 'daily_targets' ) . ' dt JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = dt.wo_id JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = w.plan_id WHERE p.status = 'confirmed' AND dt.kind = 'baseline' AND dt.target_date BETWEEN %s AND %s AND w.request_id IN ($in)$dw", $m_from, $m_to, ...$da );
		$actual_all  = (float) PP_Db::var( 'SELECT COALESCE(SUM(e.good_qty),0) FROM ' . PP_Db::t( 'production_entries' ) . ' e JOIN ' . PP_Db::t( 'work_orders' ) . " w ON w.id = e.wo_id WHERE e.entry_date BETWEEN %s AND %s AND w.request_id IN ($in)$dw", $m_from, $m_to, ...$da );
		// planned-to-date (baseline up to today) for achievement
		$planned_td = (float) PP_Db::var( 'SELECT COALESCE(SUM(dt.planned_qty),0) FROM ' . PP_Db::t( 'daily_targets' ) . ' dt JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = dt.wo_id JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = w.plan_id WHERE p.status = 'confirmed' AND dt.kind = 'baseline' AND dt.target_date BETWEEN %s AND %s AND w.request_id IN ($in)$dw", $m_from, min( $m_to, $today ), ...$da );

		// WIP by department (open work orders of confirmed plans)
		$wip = PP_Db::rows( 'SELECT w.department_code, d.name AS department, COUNT(*) AS open_orders, SUM(w.planned_qty) AS planned, SUM(w.good_qty) AS good, SUM(CASE WHEN w.received_qty - w.good_qty - w.rejected_qty > 0 THEN w.received_qty - w.good_qty - w.rejected_qty ELSE 0 END) AS in_process, SUM(CASE WHEN w.good_qty - w.transferred_qty > 0 THEN w.good_qty - w.transferred_qty ELSE 0 END) AS waiting_transfer, SUM(w.planned_qty - w.good_qty) AS balance FROM ' . PP_Db::t( 'work_orders' ) . ' w JOIN ' . PP_Db::t( 'departments' ) . ' d ON d.code = w.department_code JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = w.plan_id WHERE p.status = 'confirmed' AND w.status NOT IN ('Completed','Cancelled') AND w.request_id IN ($in)$dw GROUP BY w.department_code, d.name ORDER BY d.stage_order", ...$da );
		$delayed_by_dept = array();
		foreach ( PP_Db::rows( 'SELECT w.department_code, COUNT(*) AS n FROM ' . PP_Db::t( 'work_orders' ) . ' w JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = w.plan_id WHERE p.status = 'confirmed' AND w.status NOT IN ('Completed','Cancelled') AND w.request_id IN ($in) AND (w.forecast_finish > w.baseline_finish OR w.baseline_finish < %s) GROUP BY w.department_code", $today ) as $dr ) {
			$delayed_by_dept[ $dr['department_code'] ] = (int) $dr['n'];
		}
		$total_wip = 0;
		foreach ( $wip as &$w ) {
			$w['delayed'] = isset( $delayed_by_dept[ $w['department_code'] ] ) ? $delayed_by_dept[ $w['department_code'] ] : 0;
			$total_wip += (float) $w['in_process'] + (float) $w['waiting_transfer'];
		}
		unset( $w );

		// capacity utilisation next 10 working days (committed minutes / pool)
		$cal = new PP_Calendar(); $cap = new PP_Capacity();
		$util = array(); $d = $cal->next_working_day( $today ); $days = array();
		for ( $i = 0; $i < 10; $i++ ) { $days[] = $d; $d = $cal->add_working_days( $d, 1 ); }
		$load = PP_Planner::committed_load();
		foreach ( PP_Bom::departments() as $code => $dept ) {
			if ( ! empty( $f['department'] ) && $f['department'] !== $code ) { continue; }
			$pool = 0; $used = 0;
			foreach ( $days as $dd ) { $pool += $cap->pool_minutes( $code, $cal->minutes( $dd ) ); $used += $load[ $code ][ $dd ] ?? 0; }
			$util[] = array( 'department_code' => $code, 'department' => $dept['name'], 'site' => $dept['site'], 'stage' => $dept['stage'], 'manpower' => (float) $dept['manpower'], 'pool_minutes' => round( $pool ), 'committed_minutes' => round( $used ), 'utilisation' => $pool > 0 ? round( $used / $pool * 100, 1 ) : 0 );
		}
		usort( $util, function ( $a, $b ) { return $b['utilisation'] <=> $a['utilisation']; } );
		$bottlenecks = array_values( array_filter( $util, function ( $u ) { return $u['utilisation'] >= 80; } ) );
		// expected completion list
		$completions = array();
		foreach ( $requests as $r ) {
			if ( in_array( $r['status'], array( 'Confirmed', 'In Progress', 'Planned' ), true ) ) {
				$completions[] = array( 'request_no' => $r['request_no'], 'id' => $r['id'], 'customer' => $r['customer'], 'product_code' => $r['product_code'], 'qty' => $r['qty'], 'status' => $r['status'], 'delivery_date' => $r['delivery_date'], 'expected' => $r['expected_completion'], 'forecast' => $r['forecast_completion'], 'delayed' => $r['is_delayed'] );
			}
		}
		// cost of active orders
		$cost = PP_Db::row( 'SELECT COUNT(*) AS n, COALESCE(SUM(mr.cost),0) AS material FROM ' . PP_Db::t( 'material_requirements' ) . ' mr JOIN ' . PP_Db::t( 'plans' ) . ' p ON p.id = mr.plan_id JOIN ' . PP_Db::t( 'sales_requests' ) . " r ON r.id = p.request_id WHERE p.status = 'confirmed' AND r.status IN ('Confirmed','In Progress') AND r.id IN ($in)" );
		$total_cost = 0; $incomplete = 0;
		foreach ( PP_Db::rows( 'SELECT p.summary FROM ' . PP_Db::t( 'plans' ) . ' p JOIN ' . PP_Db::t( 'sales_requests' ) . " r ON r.id = p.request_id WHERE p.status = 'confirmed' AND r.status IN ('Confirmed','In Progress') AND r.id IN ($in)" ) as $p ) {
			$s = json_decode( $p['summary'], true );
			$total_cost += (float) ( $s['cost']['total']['total'] ?? 0 );
			if ( empty( $s['cost']['complete'] ) ) { $incomplete++; }
		}
		$alerts = PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'alerts' ) . ' WHERE acknowledged_at IS NULL ORDER BY id DESC LIMIT 20' );
		$achievement_fp = $planned_fp > 0 ? round( $actual_fp / $planned_fp * 100, 1 ) : null;
		return array(
			'month' => $month, 'today' => $today, 'kpis' => $k,
			'monthly' => array( 'planned_fp' => $planned_fp, 'actual_fp' => $actual_fp, 'achievement_fp' => $achievement_fp, 'planned_all' => $planned_all, 'actual_all' => $actual_all, 'planned_to_date' => $planned_td, 'achievement_all' => $planned_td > 0 ? round( $actual_all / $planned_td * 100, 1 ) : null ),
			'wip' => array( 'total' => $total_wip, 'by_department' => $wip ), 'utilisation' => $util, 'bottlenecks' => $bottlenecks, 'completions' => $completions,
			'cost' => array( 'active_total' => round( $total_cost, 2 ), 'incomplete_plans' => $incomplete ), 'alerts' => $alerts, 'delayed_request_ids' => $delayed_ids,
			'requests' => $requests,
		);
	}

	/** Daily production achievement by department for a date range. */
	public static function daily_achievement( $from, $to, $department = null ) {
		$w = ''; $a = array( $from, $to );
		if ( $department ) { $w = ' AND e.department_code = %s'; $a[] = $department; }
		$rows = PP_Db::rows( 'SELECT e.entry_date, e.department_code, d.name AS department, SUM(e.planned_qty) AS planned, SUM(e.good_qty) AS good, SUM(e.rejected_qty) AS rejected, SUM(e.rework_qty) AS rework, SUM(e.downtime_minutes) AS downtime, COUNT(*) AS entries FROM ' . PP_Db::t( 'production_entries' ) . ' e JOIN ' . PP_Db::t( 'departments' ) . " d ON d.code = e.department_code WHERE e.entry_date BETWEEN %s AND %s$w GROUP BY e.entry_date, e.department_code, d.name ORDER BY e.entry_date DESC, d.stage_order", ...$a );
		// targets per dept/day (forecast) for days without entries
		$tw = ''; if ( $department ) { $tw = ' AND dt.department_code = %s'; }
		$targets = PP_Db::rows( 'SELECT dt.target_date, dt.department_code, d.name AS department, SUM(dt.planned_qty) AS planned FROM ' . PP_Db::t( 'daily_targets' ) . ' dt JOIN ' . PP_Db::t( 'departments' ) . ' d ON d.code = dt.department_code JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = dt.plan_id WHERE p.status = 'confirmed' AND dt.kind = 'forecast' AND dt.target_date BETWEEN %s AND %s$tw GROUP BY dt.target_date, dt.department_code, d.name", ...$a );
		$map = array();
		foreach ( $targets as $t ) { $map[ $t['target_date'] . '|' . $t['department_code'] ] = array( 'date' => $t['target_date'], 'department_code' => $t['department_code'], 'department' => $t['department'], 'target' => (float) $t['planned'], 'planned' => 0, 'good' => 0, 'rejected' => 0, 'rework' => 0, 'downtime' => 0, 'entries' => 0 ); }
		foreach ( $rows as $r ) {
			$key = $r['entry_date'] . '|' . $r['department_code'];
			if ( ! isset( $map[ $key ] ) ) { $map[ $key ] = array( 'date' => $r['entry_date'], 'department_code' => $r['department_code'], 'department' => $r['department'], 'target' => 0 ); }
			$map[ $key ]['planned'] = (float) $r['planned']; $map[ $key ]['good'] = (float) $r['good']; $map[ $key ]['rejected'] = (float) $r['rejected']; $map[ $key ]['rework'] = (float) $r['rework']; $map[ $key ]['downtime'] = (int) $r['downtime']; $map[ $key ]['entries'] = (int) $r['entries'];
		}
		$out = array_values( $map );
		foreach ( $out as &$o ) {
			$base = $o['planned'] > 0 ? $o['planned'] : $o['target'];
			$o['achievement'] = $base > 0 ? round( $o['good'] / $base * 100, 1 ) : null;
		}
		usort( $out, function ( $a, $b ) { return strcmp( $b['date'], $a['date'] ) ?: strcmp( $a['department'], $b['department'] ); } );
		return $out;
	}

	/** Monthly production report. */
	public static function monthly( $month, $product_type = null ) {
		$from = $month . '-01'; $to = date( 'Y-m-t', strtotime( $from ) ); $today = PP_Db::today();
		$tw = ''; $ta = array();
		if ( $product_type ) { $tw = ' AND r.product_type = %s'; $ta[] = $product_type; }
		// finished products planned vs actual by product code
		$by_product = PP_Db::rows( 'SELECT r.product_code, r.product_type, MAX(r.product_description) AS description, SUM(CASE WHEN dt.kind = \'baseline\' AND dt.target_date BETWEEN %s AND %s THEN dt.planned_qty ELSE 0 END) AS planned FROM ' . PP_Db::t( 'daily_targets' ) . ' dt JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = dt.wo_id JOIN ' . PP_Db::t( 'production_orders' ) . ' po ON po.id = w.production_order_id JOIN ' . PP_Db::t( 'plans' ) . ' p ON p.id = w.plan_id JOIN ' . PP_Db::t( 'sales_requests' ) . " r ON r.id = w.request_id WHERE p.status = 'confirmed' AND po.is_master = 1 AND w.is_last_op = 1$tw GROUP BY r.product_code, r.product_type", $from, $to, ...$ta );
		$actual_rows = PP_Db::rows( 'SELECT r.product_code, SUM(e.good_qty) AS actual, SUM(e.rejected_qty) AS rejected FROM ' . PP_Db::t( 'production_entries' ) . ' e JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = e.wo_id JOIN ' . PP_Db::t( 'production_orders' ) . ' po ON po.id = w.production_order_id JOIN ' . PP_Db::t( 'sales_requests' ) . " r ON r.id = w.request_id WHERE po.is_master = 1 AND w.is_last_op = 1 AND e.entry_date BETWEEN %s AND %s$tw GROUP BY r.product_code", $from, $to, ...$ta );
		$act = array(); foreach ( $actual_rows as $a ) { $act[ $a['product_code'] ] = $a; }
		$products = array(); $tp = 0; $ta_ = 0;
		foreach ( $by_product as $p ) {
			$a = isset( $act[ $p['product_code'] ] ) ? (float) $act[ $p['product_code'] ]['actual'] : 0;
			$products[] = array( 'product_code' => $p['product_code'], 'product_type' => $p['product_type'], 'description' => $p['description'], 'planned' => (float) $p['planned'], 'actual' => $a, 'achievement' => (float) $p['planned'] > 0 ? round( $a / (float) $p['planned'] * 100, 1 ) : null );
			$tp += (float) $p['planned']; $ta_ += $a; unset( $act[ $p['product_code'] ] );
		}
		foreach ( $act as $code => $a ) { $products[] = array( 'product_code' => $code, 'product_type' => null, 'description' => '', 'planned' => 0, 'actual' => (float) $a['actual'], 'achievement' => null ); $ta_ += (float) $a['actual']; }
		// departments
		$dept = PP_Db::rows( 'SELECT d.code AS department_code, d.name AS department, d.site, d.stage_order, d.manpower, (SELECT COALESCE(SUM(dt.planned_qty),0) FROM ' . PP_Db::t( 'daily_targets' ) . ' dt JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = dt.plan_id WHERE p.status = 'confirmed' AND dt.kind = 'baseline' AND dt.department_code = d.code AND dt.target_date BETWEEN %s AND %s) AS planned, (SELECT COALESCE(SUM(dt.planned_minutes),0) FROM " . PP_Db::t( 'daily_targets' ) . ' dt JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = dt.plan_id WHERE p.status = 'confirmed' AND dt.kind = 'baseline' AND dt.department_code = d.code AND dt.target_date BETWEEN %s AND %s) AS planned_minutes, (SELECT COALESCE(SUM(e.good_qty),0) FROM " . PP_Db::t( 'production_entries' ) . ' e WHERE e.department_code = d.code AND e.entry_date BETWEEN %s AND %s) AS actual, (SELECT COALESCE(SUM(e.rejected_qty),0) FROM ' . PP_Db::t( 'production_entries' ) . ' e WHERE e.department_code = d.code AND e.entry_date BETWEEN %s AND %s) AS rejected, (SELECT COALESCE(SUM(e.rework_qty),0) FROM ' . PP_Db::t( 'production_entries' ) . ' e WHERE e.department_code = d.code AND e.entry_date BETWEEN %s AND %s) AS rework, (SELECT COALESCE(SUM(e.downtime_minutes),0) FROM ' . PP_Db::t( 'production_entries' ) . ' e WHERE e.department_code = d.code AND e.entry_date BETWEEN %s AND %s) AS downtime, (SELECT COUNT(*) FROM ' . PP_Db::t( 'work_orders' ) . ' w JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = w.plan_id WHERE p.status = 'confirmed' AND w.department_code = d.code AND w.status NOT IN ('Completed','Cancelled')) AS open_wos FROM " . PP_Db::t( 'departments' ) . ' d WHERE d.active = 1 ORDER BY d.stage_order, d.code', $from, $to, $from, $to, $from, $to, $from, $to, $from, $to, $from, $to );
		$cal = new PP_Calendar();
		$wdays = PP_Calendar::working_days_between( $from, $to, $cal );
		foreach ( $dept as &$d ) {
			$pool = (float) $d['manpower'] * 480 * $wdays;
			$d['working_days'] = $wdays;
			$d['capacity_minutes'] = round( $pool );
			$d['utilisation'] = $pool > 0 ? round( (float) $d['planned_minutes'] / $pool * 100, 1 ) : null;
			$d['achievement'] = (float) $d['planned'] > 0 ? round( (float) $d['actual'] / (float) $d['planned'] * 100, 1 ) : null;
		}
		unset( $d );
		// orders due in the month: on time %
		$orders = PP_Db::rows( 'SELECT r.request_no, r.id, r.customer, r.product_code, r.product_type, r.qty, r.status, r.delivery_date, r.expected_completion, r.forecast_completion, r.actual_completion, p.summary FROM ' . PP_Db::t( 'sales_requests' ) . ' r LEFT JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = r.confirmed_plan_id WHERE r.status NOT IN ('Cancelled') AND ((r.expected_completion BETWEEN %s AND %s) OR (r.actual_completion BETWEEN %s AND %s) OR (r.delivery_date BETWEEN %s AND %s))$tw ORDER BY r.expected_completion", $from, $to, $from, $to, $from, $to, ...$ta );
		$due = 0; $ontime = 0; $delayed = array(); $est_cost = 0; $plan_cost = 0; $actual_cost_total = 0; $actual_known = 0;
		foreach ( $orders as &$o ) {
			$s = $o['summary'] ? json_decode( $o['summary'], true ) : null;
			$o['estimated_cost'] = $s ? (float) ( $s['cost']['total']['total'] ?? 0 ) : null;
			$o['cost_complete'] = $s ? ! empty( $s['cost']['complete'] ) : null;
			unset( $o['summary'] );
			$est_cost += (float) $o['estimated_cost'];
			if ( 'Completed' === $o['status'] ) {
				$due++;
				$ref = $o['delivery_date'] ?: $o['expected_completion'];
				if ( ! $ref || $o['actual_completion'] <= $ref ) { $ontime++; }
			}
			$fc = $o['forecast_completion'] ?: $o['expected_completion'];
			$o['delayed'] = ( 'Completed' !== $o['status'] && $fc && ( ( $o['expected_completion'] && $fc > $o['expected_completion'] ) || ( $o['delivery_date'] && $fc > $o['delivery_date'] ) ) ) || ( 'Completed' === $o['status'] && $o['delivery_date'] && $o['actual_completion'] > $o['delivery_date'] );
			if ( $o['delayed'] ) { $delayed[] = $o; }
			if ( $o['id'] ) {
				$plan = PP_Db::row( 'SELECT id FROM ' . PP_Db::t( 'plans' ) . " WHERE request_id = %d AND status = 'confirmed'", $o['id'] );
				$o['actual_cost'] = $plan ? PP_Costing::actual_cost( $plan['id'] ) : null;
			}
		}
		unset( $o );
		$wip = PP_Db::rows( 'SELECT w.department_code, d.name AS department, COUNT(*) AS open_orders, SUM(w.planned_qty - w.good_qty) AS balance, SUM(CASE WHEN w.received_qty - w.good_qty - w.rejected_qty > 0 THEN w.received_qty - w.good_qty - w.rejected_qty ELSE 0 END) AS in_process, SUM(CASE WHEN w.good_qty - w.transferred_qty > 0 THEN w.good_qty - w.transferred_qty ELSE 0 END) AS waiting_transfer FROM ' . PP_Db::t( 'work_orders' ) . ' w JOIN ' . PP_Db::t( 'departments' ) . ' d ON d.code = w.department_code JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = w.plan_id WHERE p.status = 'confirmed' AND w.status NOT IN ('Completed','Cancelled') GROUP BY w.department_code, d.name ORDER BY d.stage_order" );
		$daily = self::daily_achievement( $from, $to );
		return array(
			'month' => $month, 'from' => $from, 'to' => $to, 'product_type' => $product_type, 'working_days' => $wdays,
			'totals' => array( 'planned' => $tp, 'actual' => $ta_, 'achievement' => $tp > 0 ? round( $ta_ / $tp * 100, 1 ) : null, 'completed_orders' => $due, 'on_time' => $ontime, 'on_time_pct' => $due > 0 ? round( $ontime / $due * 100, 1 ) : null, 'estimated_cost' => round( $est_cost, 2 ), 'rejected' => array_sum( array_column( $dept, 'rejected' ) ), 'rework' => array_sum( array_column( $dept, 'rework' ) ), 'downtime' => array_sum( array_column( $dept, 'downtime' ) ) ),
			'products' => $products, 'departments' => $dept, 'orders' => $orders, 'delayed' => $delayed, 'wip' => $wip, 'daily' => $daily,
		);
	}

	/** Gantt data: work orders with baseline/forecast/actual + dependencies. */
	public static function gantt( $f = array() ) {
		$f['plan_status'] = ! empty( $f['plan_id'] ) ? null : ( $f['plan_status'] ?? 'confirmed' );
		$rows = PP_Wip::list_work_orders( array_filter( $f ) );
		if ( ! empty( $f['plan_id'] ) ) {
			$rows = array_filter( $rows, function ( $r ) use ( $f ) { return (int) $r['plan_id'] === (int) $f['plan_id']; } );
		}
		$ids = array_map( 'intval', array_column( $rows, 'id' ) );
		$deps = $ids ? PP_Db::rows( 'SELECT wo_id, depends_on_wo_id, kind FROM ' . PP_Db::t( 'wo_dependencies' ) . ' WHERE wo_id IN (' . implode( ',', $ids ) . ')' ) : array();
		$tasks = array();
		foreach ( $rows as $r ) {
			$prog = (float) $r['planned_qty'] > 0 ? min( 100, round( (float) $r['good_qty'] / (float) $r['planned_qty'] * 100, 1 ) ) : 0;
			$tasks[] = array(
				'id' => (int) $r['id'], 'wo_no' => $r['wo_no'], 'order_no' => $r['order_no'], 'request_no' => $r['request_no'], 'request_id' => (int) $r['request_id'], 'plan_id' => (int) $r['plan_id'],
				'product_code' => $r['product_code'], 'finished_product_code' => $r['finished_product_code'], 'department_code' => $r['department_code'], 'department' => $r['department_name'],
				'operation' => $r['operation_name'], 'level' => (int) $r['level'], 'seq' => (int) $r['seq'], 'qty' => (float) $r['planned_qty'], 'good_qty' => (float) $r['good_qty'],
				'baseline_start' => $r['baseline_start'], 'baseline_finish' => $r['baseline_finish'], 'forecast_start' => $r['forecast_start'] ?: $r['planned_start'], 'forecast_finish' => $r['forecast_finish'] ?: $r['planned_finish'],
				'actual_start' => $r['actual_start'] ? substr( $r['actual_start'], 0, 10 ) : null, 'actual_finish' => $r['actual_finish'] ? substr( $r['actual_finish'], 0, 10 ) : null,
				'status' => $r['status'], 'progress' => $prog, 'delayed' => (bool) $r['delayed'], 'customer' => $r['customer'], 'priority' => $r['priority'],
			);
		}
		return array( 'tasks' => $tasks, 'dependencies' => $deps );
	}
}
