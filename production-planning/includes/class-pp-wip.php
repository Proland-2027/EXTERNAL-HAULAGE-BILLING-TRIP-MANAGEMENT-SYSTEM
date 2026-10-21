<?php
/**
 * Work orders, daily production entries, interdepartmental transfers and WIP balances.
 */
class PP_Wip {

	public static function wo( $id ) {
		$wo = PP_Db::row( 'SELECT w.*, d.name AS department_name, d.stage, po.order_no, po.finished_product_code, po.planned_qty AS order_qty, po.level, r.request_no, r.customer, r.priority, r.delivery_date, p.status AS plan_status FROM ' . PP_Db::t( 'work_orders' ) . ' w JOIN ' . PP_Db::t( 'departments' ) . ' d ON d.code = w.department_code JOIN ' . PP_Db::t( 'production_orders' ) . ' po ON po.id = w.production_order_id JOIN ' . PP_Db::t( 'sales_requests' ) . ' r ON r.id = w.request_id JOIN ' . PP_Db::t( 'plans' ) . ' p ON p.id = w.plan_id WHERE w.id = %d', $id );
		if ( ! $wo ) {
			throw new RuntimeException( 'Work order not found.' );
		}
		return $wo;
	}

	/** Dependencies (what this work order consumes) with received quantities. */
	public static function inputs( $wo_id ) {
		$deps = PP_Db::rows( 'SELECT dp.*, w.wo_no, w.product_code, w.department_code, w.good_qty, w.transferred_qty, w.status FROM ' . PP_Db::t( 'wo_dependencies' ) . ' dp JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = dp.depends_on_wo_id WHERE dp.wo_id = %d', $wo_id );
		foreach ( $deps as &$d ) {
			$d['received'] = (float) PP_Db::var( 'SELECT COALESCE(SUM(received_qty),0) FROM ' . PP_Db::t( 'wip_transfers' ) . " WHERE from_wo_id = %d AND to_wo_id = %d AND status = 'received'", $d['depends_on_wo_id'], $wo_id );
			$d['in_transit'] = (float) PP_Db::var( 'SELECT COALESCE(SUM(qty),0) FROM ' . PP_Db::t( 'wip_transfers' ) . " WHERE from_wo_id = %d AND to_wo_id = %d AND status = 'sent'", $d['depends_on_wo_id'], $wo_id );
			$d['units_available'] = floor( $d['received'] * (float) $d['ratio'] + 1e-6 );
		}
		return $deps;
	}

	/** Units this work order may still process (received from predecessors, not yet finished). */
	public static function availability( $wo ) {
		$deps = self::inputs( $wo['id'] );
		if ( ! $deps ) {
			$received = (float) $wo['planned_qty'];
		} else {
			$received = (float) $wo['planned_qty'];
			foreach ( $deps as $d ) {
				$received = min( $received, (float) $d['units_available'] );
			}
		}
		$processed = (float) $wo['good_qty'] + (float) $wo['rejected_qty'];
		return array(
			'received'        => $received,
			'processed'       => $processed,
			'available'       => max( 0, $received - $processed ),
			'balance'         => max( 0, (float) $wo['planned_qty'] - (float) $wo['good_qty'] ),
			'waiting_transfer'=> max( 0, (float) $wo['good_qty'] - (float) $wo['transferred_qty'] ),
			'inputs'          => $deps,
		);
	}

	public static function successors( $wo_id ) {
		return PP_Db::rows( 'SELECT dp.ratio, dp.kind, w.id, w.wo_no, w.product_code, w.department_code, w.status, d.name AS department_name FROM ' . PP_Db::t( 'wo_dependencies' ) . ' dp JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = dp.wo_id JOIN ' . PP_Db::t( 'departments' ) . ' d ON d.code = w.department_code WHERE dp.depends_on_wo_id = %d', $wo_id );
	}

	public static function assert_department( $wo ) {
		$user = wp_get_current_user();
		if ( user_can( $user, 'pp_manage' ) || user_can( $user, 'pp_admin' ) || user_can( $user, 'pp_plan' ) ) {
			return;
		}
		$depts = PP_Roles::user_departments( $user->ID );
		if ( $depts && ! in_array( $wo['department_code'], $depts, true ) ) {
			throw new RuntimeException( 'You are not assigned to department ' . $wo['department_code'] . '.' );
		}
	}

	public static function start( $wo_id ) {
		$wo = self::wo( $wo_id );
		self::assert_department( $wo );
		if ( 'confirmed' !== $wo['plan_status'] ) {
			throw new RuntimeException( 'The production plan is not confirmed.' );
		}
		if ( ! in_array( $wo['status'], array( 'Released', 'Delayed' ), true ) ) {
			throw new RuntimeException( 'Work order is ' . $wo['status'] . ' and cannot be started.' );
		}
		PP_Db::update( 'work_orders', array( 'status' => 'In Progress', 'actual_start' => PP_Db::now(), 'version' => (int) $wo['version'] + 1 ), array( 'id' => $wo_id, 'version' => $wo['version'] ) );
		PP_Db::query( 'UPDATE ' . PP_Db::t( 'production_orders' ) . " SET status = 'In Progress' WHERE id = %d AND status IN ('Released','Planned')", $wo['production_order_id'] );
		PP_Db::query( 'UPDATE ' . PP_Db::t( 'sales_requests' ) . " SET status = 'In Progress' WHERE id = %d AND status = 'Confirmed'", $wo['request_id'] );
		PP_Db::audit( 'wo_started', 'work_order', $wo['wo_no'] );
		return self::wo( $wo_id );
	}

	/** Planned quantity for a work order on a date from the latest forecast (falls back to baseline). */
	public static function planned_for_date( $wo_id, $date ) {
		$v = PP_Db::var( 'SELECT planned_qty FROM ' . PP_Db::t( 'daily_targets' ) . " WHERE wo_id = %d AND target_date = %s AND kind = 'forecast'", $wo_id, $date );
		if ( null === $v ) {
			$v = PP_Db::var( 'SELECT planned_qty FROM ' . PP_Db::t( 'daily_targets' ) . " WHERE wo_id = %d AND target_date = %s AND kind = 'baseline'", $wo_id, $date );
		}
		return null === $v ? 0 : (float) $v;
	}

	/**
	 * Record daily production. $d: entry_date, wo_id, planned_qty, good_qty, rejected_qty, rework_qty,
	 * downtime_minutes, manpower, delay_reason, remarks, version (optimistic lock)
	 */
	public static function record_entry( $d ) {
		$wo = self::wo( (int) $d['wo_id'] );
		self::assert_department( $wo );
		if ( 'confirmed' !== $wo['plan_status'] ) {
			throw new RuntimeException( 'The production plan is not confirmed.' );
		}
		if ( in_array( $wo['status'], array( 'Completed', 'Cancelled', 'Proposed' ), true ) ) {
			throw new RuntimeException( 'Work order is ' . $wo['status'] . '; production cannot be recorded.' );
		}
		if ( isset( $d['version'] ) && (int) $d['version'] !== (int) $wo['version'] ) {
			throw new RuntimeException( 'This work order was updated by another user. Please reload and try again.' );
		}
		$good = max( 0, (float) ( $d['good_qty'] ?? 0 ) );
		$rej  = max( 0, (float) ( $d['rejected_qty'] ?? 0 ) );
		$rew  = max( 0, (float) ( $d['rework_qty'] ?? 0 ) );
		$down = max( 0, (int) ( $d['downtime_minutes'] ?? 0 ) );
		if ( $good + $rej + $rew + $down <= 0 ) {
			throw new RuntimeException( 'Enter a good, rejected or rework quantity, or downtime.' );
		}
		$av = self::availability( $wo );
		if ( $good + $rej > $av['available'] + 1e-6 ) {
			throw new RuntimeException( sprintf( 'Only %s units are available to process in this section (received %s, already processed %s). Receive the pending transfer first.', self::fmt( $av['available'] ), self::fmt( $av['received'] ), self::fmt( $av['processed'] ) ) );
		}
		$date    = ! empty( $d['entry_date'] ) ? $d['entry_date'] : PP_Db::today();
		$planned = isset( $d['planned_qty'] ) && '' !== $d['planned_qty'] ? (float) $d['planned_qty'] : self::planned_for_date( $wo['id'], $date );
		$user    = wp_get_current_user();
		PP_Db::begin();
		try {
			$entry_id = PP_Db::insert(
				'production_entries',
				array(
					'entry_date' => $date, 'department_code' => $wo['department_code'], 'wo_id' => $wo['id'], 'product_code' => $wo['product_code'],
					'planned_qty' => $planned, 'good_qty' => $good, 'rejected_qty' => $rej, 'rework_qty' => $rew, 'downtime_minutes' => $down,
					'manpower' => isset( $d['manpower'] ) && '' !== $d['manpower'] ? (float) $d['manpower'] : null, 'delay_reason' => $d['delay_reason'] ?? null,
					'remarks' => $d['remarks'] ?? null, 'entered_by' => $user->user_login, 'created_at' => PP_Db::now(),
				)
			);
			$new_good = (float) $wo['good_qty'] + $good;
			$upd      = array(
				'good_qty' => $new_good, 'rejected_qty' => (float) $wo['rejected_qty'] + $rej, 'rework_qty' => (float) $wo['rework_qty'] + $rew,
				'downtime_minutes' => (int) $wo['downtime_minutes'] + $down, 'version' => (int) $wo['version'] + 1, 'status' => 'In Progress',
			);
			if ( ! $wo['actual_start'] ) {
				$upd['actual_start'] = PP_Db::now();
			}
			if ( $new_good + 1e-6 >= (float) $wo['planned_qty'] ) {
				$upd['status']        = 'Completed';
				$upd['actual_finish'] = PP_Db::now();
				$upd['forecast_finish'] = $date;
			}
			PP_Db::update( 'work_orders', $upd, array( 'id' => $wo['id'] ) );
			self::sync_order( $wo['production_order_id'], $date );
			PP_Db::commit();
		} catch ( Exception $e ) {
			PP_Db::rollback();
			throw $e;
		}
		PP_Db::audit( 'production_entry', 'work_order', $wo['wo_no'], array( 'date' => $date, 'good' => $good, 'rejected' => $rej, 'rework' => $rew, 'downtime' => $down ) );
		// delay management: re-forecast the plan when output misses target (and always keep forecast current)
		$shortfall = $planned > 0 && $good < $planned;
		$fc = PP_Planner::reforecast( $wo['plan_id'], $shortfall ? 'shortfall' : 'entry' );
		if ( $shortfall ) {
			PP_Alerts::raise( 'warning', 'shortfall', sprintf( '%s (%s) produced %s of %s planned on %s%s.', $wo['wo_no'], $wo['department_name'], self::fmt( $good ), self::fmt( $planned ), $date, $d['delay_reason'] ? ' - ' . $d['delay_reason'] : '' ), $wo['request_id'], $wo['id'], $wo['department_code'], 'planning,management' );
		}
		return array( 'entry_id' => $entry_id, 'work_order' => self::wo( $wo['id'] ), 'availability' => self::availability( self::wo( $wo['id'] ) ), 'forecast' => $fc, 'shortfall' => $shortfall );
	}

	/** Roll work-order progress up to the production order and the sales request. */
	public static function sync_order( $po_id, $date = null ) {
		$po   = PP_Db::find( 'production_orders', $po_id );
		$last = PP_Db::row( 'SELECT * FROM ' . PP_Db::t( 'work_orders' ) . ' WHERE production_order_id = %d AND is_last_op = 1 ORDER BY seq DESC LIMIT 1', $po_id );
		$all  = PP_Db::rows( 'SELECT status, rejected_qty FROM ' . PP_Db::t( 'work_orders' ) . ' WHERE production_order_id = %d', $po_id );
		$rej  = 0;
		$all_done = count( $all ) > 0;
		foreach ( $all as $w ) {
			$rej += (float) $w['rejected_qty'];
			if ( 'Completed' !== $w['status'] ) {
				$all_done = false;
			}
		}
		$upd = array( 'completed_qty' => $last ? (float) $last['good_qty'] : 0, 'rejected_qty' => $rej );
		if ( $all_done ) {
			$upd['status']        = 'Completed';
			$upd['actual_finish'] = $date ?: PP_Db::today();
		} elseif ( in_array( $po['status'], array( 'Released', 'Planned' ), true ) ) {
			$upd['status'] = 'In Progress';
		}
		PP_Db::update( 'production_orders', $upd, array( 'id' => $po_id ) );
		if ( (int) $po['is_master'] && $all_done ) {
			PP_Db::update( 'sales_requests', array( 'status' => 'Completed', 'actual_completion' => $date ?: PP_Db::today(), 'updated_at' => PP_Db::now() ), array( 'id' => $po['request_id'] ) );
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'alerts' ) . ' WHERE request_id = %d AND acknowledged_at IS NULL', $po['request_id'] );
		}
	}

	/** Close a work order short (supervisor decision) - remaining balance is dropped and the plan re-forecast. */
	public static function complete( $wo_id, $remarks = '' ) {
		$wo = self::wo( $wo_id );
		self::assert_department( $wo );
		if ( in_array( $wo['status'], array( 'Completed', 'Cancelled' ), true ) ) {
			throw new RuntimeException( 'Work order already ' . $wo['status'] . '.' );
		}
		PP_Db::update( 'work_orders', array( 'status' => 'Completed', 'actual_finish' => PP_Db::now(), 'planned_qty' => $wo['good_qty'], 'version' => (int) $wo['version'] + 1 ), array( 'id' => $wo_id ) );
		self::sync_order( $wo['production_order_id'] );
		PP_Db::audit( 'wo_completed', 'work_order', $wo['wo_no'], array( 'good_qty' => $wo['good_qty'], 'planned_qty' => $wo['planned_qty'], 'remarks' => $remarks ) );
		PP_Planner::reforecast( $wo['plan_id'], 'wo_completed' );
		return self::wo( $wo_id );
	}

	/* ---------------- Transfers ---------------- */

	public static function transfer( $from_wo_id, $to_wo_id, $qty, $remarks = '' ) {
		$from = self::wo( $from_wo_id );
		$to   = self::wo( $to_wo_id );
		self::assert_department( $from );
		$qty = (float) $qty;
		if ( $qty <= 0 ) {
			throw new RuntimeException( 'Transfer quantity must be positive.' );
		}
		$dep = PP_Db::row( 'SELECT * FROM ' . PP_Db::t( 'wo_dependencies' ) . ' WHERE wo_id = %d AND depends_on_wo_id = %d', $to_wo_id, $from_wo_id );
		if ( ! $dep ) {
			throw new RuntimeException( 'The receiving work order does not consume output of ' . $from['wo_no'] . '.' );
		}
		$available = (float) $from['good_qty'] - (float) $from['transferred_qty'];
		if ( $qty > $available + 1e-6 ) {
			throw new RuntimeException( sprintf( 'Only %s completed units are available to transfer from %s (good %s, already transferred %s).', self::fmt( $available ), $from['wo_no'], self::fmt( $from['good_qty'] ), self::fmt( $from['transferred_qty'] ) ) );
		}
		$user = wp_get_current_user();
		PP_Db::begin();
		try {
			$updated = PP_Db::update( 'work_orders', array( 'transferred_qty' => (float) $from['transferred_qty'] + $qty, 'version' => (int) $from['version'] + 1 ), array( 'id' => $from_wo_id, 'version' => $from['version'] ) );
			if ( ! $updated ) {
				throw new RuntimeException( 'The work order changed while you were transferring. Please reload.' );
			}
			$tid = PP_Db::insert(
				'wip_transfers',
				array(
					'transfer_no' => PP_Db::next_number( 'TR', 'TR-' ), 'from_wo_id' => $from_wo_id, 'to_wo_id' => $to_wo_id, 'from_department' => $from['department_code'],
					'to_department' => $to['department_code'], 'product_code' => $from['product_code'], 'qty' => $qty, 'status' => 'sent', 'sent_by' => $user->user_login,
					'sent_at' => PP_Db::now(), 'remarks' => $remarks,
				)
			);
			PP_Db::commit();
		} catch ( Exception $e ) {
			PP_Db::rollback();
			throw $e;
		}
		PP_Db::audit( 'wip_transfer_sent', 'transfer', $tid, array( 'from' => $from['wo_no'], 'to' => $to['wo_no'], 'qty' => $qty ) );
		return PP_Db::find( 'wip_transfers', $tid );
	}

	public static function receive( $transfer_id, $received_qty = null, $remarks = '' ) {
		$tr = PP_Db::find( 'wip_transfers', $transfer_id );
		if ( ! $tr ) {
			throw new RuntimeException( 'Transfer not found.' );
		}
		if ( 'sent' !== $tr['status'] ) {
			throw new RuntimeException( 'Transfer ' . $tr['transfer_no'] . ' is already ' . $tr['status'] . '.' );
		}
		$to = self::wo( $tr['to_wo_id'] );
		self::assert_department( $to );
		$rq = null === $received_qty || '' === $received_qty ? (float) $tr['qty'] : (float) $received_qty;
		if ( $rq < 0 || $rq > (float) $tr['qty'] + 1e-6 ) {
			throw new RuntimeException( 'Received quantity must be between 0 and the sent quantity.' );
		}
		$user = wp_get_current_user();
		PP_Db::begin();
		try {
			$n = PP_Db::update( 'wip_transfers', array( 'status' => 'received', 'received_qty' => $rq, 'received_by' => $user->user_login, 'received_at' => PP_Db::now(), 'remarks' => trim( $tr['remarks'] . ' ' . $remarks ) ), array( 'id' => $transfer_id, 'status' => 'sent' ) );
			if ( ! $n ) {
				throw new RuntimeException( 'Transfer was already received by another user.' );
			}
			if ( $rq < (float) $tr['qty'] ) {
				// short receipt: return the difference to the sending section
				PP_Db::query( 'UPDATE ' . PP_Db::t( 'work_orders' ) . ' SET transferred_qty = transferred_qty - %f, version = version + 1 WHERE id = %d', (float) $tr['qty'] - $rq, $tr['from_wo_id'] );
			}
			$av = self::availability( self::wo( $tr['to_wo_id'] ) );
			PP_Db::update( 'work_orders', array( 'received_qty' => $av['received'], 'version' => (int) $to['version'] + 1 ), array( 'id' => $tr['to_wo_id'] ) );
			PP_Db::commit();
		} catch ( Exception $e ) {
			PP_Db::rollback();
			throw $e;
		}
		PP_Db::audit( 'wip_transfer_received', 'transfer', $transfer_id, array( 'qty' => $rq ) );
		return PP_Db::find( 'wip_transfers', $transfer_id );
	}

	public static function cancel_transfer( $transfer_id, $reason = '' ) {
		$tr = PP_Db::find( 'wip_transfers', $transfer_id );
		if ( ! $tr || 'sent' !== $tr['status'] ) {
			throw new RuntimeException( 'Only transfers that have not been received can be cancelled.' );
		}
		PP_Db::update( 'wip_transfers', array( 'status' => 'cancelled', 'remarks' => trim( $tr['remarks'] . ' Cancelled: ' . $reason ) ), array( 'id' => $transfer_id, 'status' => 'sent' ) );
		PP_Db::query( 'UPDATE ' . PP_Db::t( 'work_orders' ) . ' SET transferred_qty = transferred_qty - %f, version = version + 1 WHERE id = %d', (float) $tr['qty'], $tr['from_wo_id'] );
		PP_Db::audit( 'wip_transfer_cancelled', 'transfer', $transfer_id, array( 'reason' => $reason ) );
		return PP_Db::find( 'wip_transfers', $transfer_id );
	}

	/* ---------------- Queries ---------------- */

	/** Work-order list with WIP figures. $f: department, status, request_id, plan_status, product, from, to */
	public static function list_work_orders( $f = array() ) {
		$where = array( "p.status IN ('confirmed','proposed')" );
		$args  = array();
		if ( ! empty( $f['plan_status'] ) ) {
			$where = array( 'p.status = %s' ); $args[] = $f['plan_status'];
		}
		if ( ! empty( $f['department'] ) ) { $where[] = 'w.department_code = %s'; $args[] = $f['department']; }
		if ( ! empty( $f['status'] ) ) { $where[] = 'w.status = %s'; $args[] = $f['status']; }
		if ( ! empty( $f['request_id'] ) ) { $where[] = 'w.request_id = %d'; $args[] = (int) $f['request_id']; }
		if ( ! empty( $f['plan_id'] ) ) { $where[] = 'w.plan_id = %d'; $args[] = (int) $f['plan_id']; }
		if ( ! empty( $f['product'] ) ) { $where[] = '(po.finished_product_code = %s OR w.product_code = %s)'; $args[] = $f['product']; $args[] = $f['product']; }
		if ( ! empty( $f['open'] ) ) { $where[] = "w.status NOT IN ('Completed','Cancelled')"; }
		if ( ! empty( $f['from'] ) ) { $where[] = 'COALESCE(w.forecast_finish, w.planned_finish) >= %s'; $args[] = $f['from']; }
		if ( ! empty( $f['to'] ) ) { $where[] = 'COALESCE(w.forecast_start, w.planned_start) <= %s'; $args[] = $f['to']; }
		$sql = 'SELECT w.*, d.name AS department_name, d.stage, d.site, po.order_no, po.finished_product_code, po.description AS product_description, po.level, po.is_master, po.status AS order_status, r.request_no, r.customer, r.priority, r.delivery_date, r.product_type, p.status AS plan_status, p.plan_no FROM ' . PP_Db::t( 'work_orders' ) . ' w JOIN ' . PP_Db::t( 'departments' ) . ' d ON d.code = w.department_code JOIN ' . PP_Db::t( 'production_orders' ) . ' po ON po.id = w.production_order_id JOIN ' . PP_Db::t( 'sales_requests' ) . ' r ON r.id = w.request_id JOIN ' . PP_Db::t( 'plans' ) . ' p ON p.id = w.plan_id WHERE ' . implode( ' AND ', $where ) . ' ORDER BY COALESCE(w.forecast_start, w.planned_start), w.request_id, po.level DESC, w.seq';
		$rows = PP_Db::rows( $sql, ...$args );
		$today = PP_Db::today();
		foreach ( $rows as &$w ) {
			$w['wip_qty']       = max( 0, (float) $w['received_qty'] - (float) $w['good_qty'] - (float) $w['rejected_qty'] );
			$w['balance_qty']   = max( 0, (float) $w['planned_qty'] - (float) $w['good_qty'] );
			$w['waiting_qty']   = max( 0, (float) $w['good_qty'] - (float) $w['transferred_qty'] );
			$w['in_transit_qty']= (float) PP_Db::var( 'SELECT COALESCE(SUM(qty),0) FROM ' . PP_Db::t( 'wip_transfers' ) . " WHERE from_wo_id = %d AND status = 'sent'", $w['id'] );
			$w['delayed']       = ( $w['forecast_finish'] && $w['baseline_finish'] && $w['forecast_finish'] > $w['baseline_finish'] ) || ( 'Completed' !== $w['status'] && $w['baseline_finish'] && $w['baseline_finish'] < $today );
			$w['today_target']  = self::planned_for_date( $w['id'], $today );
		}
		return $rows;
	}

	public static function movements( $f = array() ) {
		$where = array( '1=1' ); $args = array();
		if ( ! empty( $f['wo_id'] ) ) { $where[] = '(t.from_wo_id = %d OR t.to_wo_id = %d)'; $args[] = (int) $f['wo_id']; $args[] = (int) $f['wo_id']; }
		if ( ! empty( $f['department'] ) ) { $where[] = '(t.from_department = %s OR t.to_department = %s)'; $args[] = $f['department']; $args[] = $f['department']; }
		if ( ! empty( $f['status'] ) ) { $where[] = 't.status = %s'; $args[] = $f['status']; }
		if ( ! empty( $f['request_id'] ) ) { $where[] = 'fw.request_id = %d'; $args[] = (int) $f['request_id']; }
		$sql = 'SELECT t.*, fw.wo_no AS from_wo_no, tw.wo_no AS to_wo_no, tw.product_code AS to_product_code, fd.name AS from_department_name, td.name AS to_department_name, r.request_no FROM ' . PP_Db::t( 'wip_transfers' ) . ' t JOIN ' . PP_Db::t( 'work_orders' ) . ' fw ON fw.id = t.from_wo_id JOIN ' . PP_Db::t( 'work_orders' ) . ' tw ON tw.id = t.to_wo_id JOIN ' . PP_Db::t( 'departments' ) . ' fd ON fd.code = t.from_department JOIN ' . PP_Db::t( 'departments' ) . ' td ON td.code = t.to_department JOIN ' . PP_Db::t( 'sales_requests' ) . ' r ON r.id = fw.request_id WHERE ' . implode( ' AND ', $where ) . ' ORDER BY t.id DESC LIMIT 500';
		return PP_Db::rows( $sql, ...$args );
	}

	public static function fmt( $n ) {
		return rtrim( rtrim( number_format( (float) $n, 2, '.', '' ), '0' ), '.' );
	}
}
