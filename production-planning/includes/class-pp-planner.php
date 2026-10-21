<?php
/**
 * Planning orchestration: generate proposed plans, confirm them into production
 * orders / work orders / daily targets, and re-forecast confirmed plans when
 * actual output falls behind.
 */
class PP_Planner {

	/* ------------------------------------------------------------------ */
	/* Generation                                                          */
	/* ------------------------------------------------------------------ */

	/**
	 * Generate a proposed plan for a sales request.
	 *
	 * @param int   $request_id
	 * @param array $params  start_date, priority (1-5), use_stock (bool), capacity_basis ('productivity'|'routing'),
	 *                       manpower (dept=>n), earliest_start (opKey=>date), sequence (code=>n) adjustments, note
	 */
	public static function generate( $request_id, $params = array() ) {
		$req = PP_Db::find( 'sales_requests', $request_id );
		if ( ! $req ) {
			throw new RuntimeException( 'Sales request not found.' );
		}
		if ( in_array( $req['status'], array( 'Completed', 'Cancelled' ), true ) ) {
			throw new RuntimeException( 'This request is ' . $req['status'] . ' and cannot be re-planned.' );
		}
		PP_Bom::reset_cache();
		$settings = PP_Db::settings();
		$cal      = new PP_Calendar();
		$capacity = new PP_Capacity();
		$today    = PP_Db::today();
		$start    = ! empty( $params['start_date'] ) ? $params['start_date'] : $today;
		$start    = $cal->next_working_day( max( $start, $today ) );
		$priority = isset( $params['priority'] ) ? (int) $params['priority'] : self::priority_rank( $req['priority'] );
		$use_stock = ! empty( $params['use_stock'] );
		$basis_pref = ! empty( $params['capacity_basis'] ) ? $params['capacity_basis'] : ( $settings['capacity_basis'] ?? 'productivity' );
		$manpower_over = isset( $params['manpower'] ) && is_array( $params['manpower'] ) ? $params['manpower'] : array();
		$earliest_over = isset( $params['earliest_start'] ) && is_array( $params['earliest_start'] ) ? $params['earliest_start'] : array();
		$seq_over      = isset( $params['sequence'] ) && is_array( $params['sequence'] ) ? $params['sequence'] : array();

		$qty = (float) $req['qty'];
		$x   = PP_Bom::explode( $req['product_code'], $qty, $use_stock );
		$warnings = $x['warnings'];

		// ---- build orders and operations
		$orders = array();
		$ops    = array();
		$opdefs = array();
		$depts  = PP_Bom::departments();
		foreach ( $x['order'] as $code ) {
			$node = $x['nodes'][ $code ];
			$pq   = ceil( $node['qty'] - 1e-9 );
			$orders[ $code ] = array(
				'product_code' => $code, 'description' => $node['description'], 'level' => $node['level'], 'required_qty' => $node['gross_qty'],
				'planned_qty' => $pq, 'parents' => $node['parents'], 'children' => $node['children'], 'has_routing' => $node['has_routing'] ? 1 : 0,
				'is_master' => $code === $req['product_code'] ? 1 : 0, 'ops' => array(),
			);
			if ( $pq <= 0 ) {
				$orders[ $code ]['note'] = 'Covered by opening stock';
				continue;
			}
			$product = PP_Bom::product( $code );
			$oplist  = PP_Bom::operations( $code );
			if ( ! $oplist && $node['children'] ) {
				$warnings[] = "$code has a BOM but no routing in the workbook - it is treated as a pass-through assembly (zero processing time). Maintain its routing in Master Data.";
			} elseif ( ! $oplist ) {
				$warnings[] = "$code has no routing in the workbook - no work order generated.";
			}
			foreach ( $oplist as $op ) {
				$dept = $op['department_code'];
				list( $mpu, $cap_u, $basis, $mp_req ) = $capacity->lookup( $dept, $product, $op['labor_hours'], $op['machine_hours'] );
				if ( 'routing' === $basis_pref && $op['labor_hours'] + $op['machine_hours'] > 0 ) {
					$mpu   = round( ( $op['labor_hours'] > 0 ? $op['labor_hours'] : $op['machine_hours'] ) * 60, 2 );
					$cap_u = null;
					$basis = 'BOM routing hours (planner preference)';
				}
				if ( $mpu <= 0 ) {
					$warnings[] = "No capacity data for $code in {$depts[$dept]['name']} - operation scheduled with zero time.";
				}
				$key = $code . '#' . $op['seq'];
				$opdefs[ $key ] = array(
					'key' => $key, 'order_code' => $code, 'department_code' => $dept, 'operation_name' => $op['operation_name'], 'seq' => $op['seq'],
					'planned_qty' => $pq, 'minutes_per_unit' => $mpu, 'labor_hours_per_unit' => round( $op['labor_hours'], 4 ), 'machine_hours_per_unit' => round( $op['machine_hours'], 4 ),
					'planned_minutes' => round( $mpu * $pq, 2 ), 'capacity_basis' => $basis, 'units_per_day' => $cap_u, 'manpower_required' => $mp_req,
					'is_first_op' => 1 === $op['seq'] ? 1 : 0, 'is_last_op' => $op['seq'] === count( $oplist ) ? 1 : 0, 'resources' => $op['resources'],
				);
				$orders[ $code ]['ops'][] = $key;
			}
		}
		// ---- dependencies
		$last_ops = function ( $code, $ratio ) use ( &$last_ops, &$orders ) {
			$o = $orders[ $code ];
			if ( ! empty( $o['ops'] ) ) {
				return array( array( end( $o['ops'] ), $ratio ) );
			}
			$out = array();
			foreach ( $o['children'] as $ch ) {
				$cq = $orders[ $ch ]['planned_qty'];
				$pq = max( 1, $o['planned_qty'] );
				$out = array_merge( $out, $last_ops( $ch, $ratio * ( $cq > 0 ? $pq / $cq : 1 ) ) );
			}
			return $out;
		};
		foreach ( $orders as $code => $o ) {
			$prev = null;
			foreach ( $o['ops'] as $i => $key ) {
				$deps = array();
				if ( 0 === $i ) {
					foreach ( $o['children'] as $ch ) {
						$cq = $orders[ $ch ]['planned_qty'];
						if ( $cq <= 0 ) {
							continue;
						}
						foreach ( $last_ops( $ch, $o['planned_qty'] / $cq ) as $d ) {
							$deps[] = array( $d[0], $d[1], 'component' );
						}
					}
				} else {
					$deps[] = array( $prev, 1.0, 'sequence' );
				}
				$opdefs[ $key ]['deps'] = $deps;
				$prev = $key;
			}
		}
		// ---- scheduler input
		$seq_priority = array();
		foreach ( $opdefs as $key => $d ) {
			$lvl   = $orders[ $d['order_code'] ]['level'];
			$pri   = $priority * 1000 + ( 10 - min( 9, $lvl ) ) * 10; // deeper levels first within the same request
			if ( isset( $seq_over[ $d['order_code'] ] ) ) {
				$pri += (int) $seq_over[ $d['order_code'] ];
			}
			$ops[] = array(
				'key' => $key, 'order_key' => $d['order_code'], 'dept' => $d['department_code'], 'qty' => $d['planned_qty'], 'mpu' => $d['minutes_per_unit'],
				'cap_units_per_day' => $d['units_per_day'], 'deps' => array_map( function ( $x ) { return array( $x[0], $x[1] ); }, $d['deps'] ),
				'priority' => $pri, 'earliest_start' => isset( $earliest_over[ $key ] ) ? $earliest_over[ $key ] : ( isset( $earliest_over[ $d['order_code'] ] ) ? $earliest_over[ $d['order_code'] ] : null ),
				'done_units' => 0, 'done_minutes' => 0,
			);
		}
		$load = self::committed_load( $request_id );
		$pool = function ( $dept, $date ) use ( $capacity, $cal, $manpower_over, $depts ) {
			$m = $cal->minutes( $date );
			if ( isset( $manpower_over[ $dept ] ) && (float) $manpower_over[ $dept ] > 0 ) {
				return (float) $manpower_over[ $dept ] * $m;
			}
			return $capacity->pool_minutes( $dept, $m );
		};
		$res = PP_Scheduler::run( $ops, $load, $pool, array( $cal, 'is_working' ), $start, (int) $settings['horizon_days'] );
		if ( $res['infeasible'] ) {
			$warnings[] = 'The schedule could not be completed within the planning horizon (' . $settings['horizon_days'] . ' days). Check departments with zero manpower or capacity.';
		}
		// ---- assemble results
		$completion = null;
		foreach ( $opdefs as $key => &$d ) {
			$r = $res['ops'][ $key ];
			$d['planned_start']  = $r['start'];
			$d['planned_finish'] = $r['finish'];
			$d['wait_days']      = $r['wait_days'];
			$d['daily']          = $r['daily'];
			if ( $r['finish'] && ( ! $completion || $r['finish'] > $completion ) ) {
				$completion = $r['finish'];
			}
		}
		unset( $d );
		foreach ( $orders as $code => &$o ) {
			$s = null; $f = null;
			foreach ( $o['ops'] as $key ) {
				$d = $opdefs[ $key ];
				if ( $d['planned_start'] && ( ! $s || $d['planned_start'] < $s ) ) { $s = $d['planned_start']; }
				if ( $d['planned_finish'] && ( ! $f || $d['planned_finish'] > $f ) ) { $f = $d['planned_finish']; }
			}
			$o['planned_start']  = $s;
			$o['planned_finish'] = $f;
		}
		unset( $o );
		$master = $orders[ $req['product_code'] ];
		$completion = $master['planned_finish'] ?: $completion ?: $start;
		// bottleneck analysis
		$util = array_values( $res['utilisation'] );
		usort( $util, function ( $a, $b ) { return ( $b['utilisation'] ?? 0 ) <=> ( $a['utilisation'] ?? 0 ); } );
		foreach ( $util as &$u ) {
			$u['department'] = isset( $depts[ $u['department_code'] ] ) ? $depts[ $u['department_code'] ]['name'] : $u['department_code'];
		}
		unset( $u );
		$waits = array();
		foreach ( $opdefs as $key => $d ) {
			if ( $d['wait_days'] > 0 ) {
				$waits[] = array( 'key' => $key, 'order_code' => $d['order_code'], 'department_code' => $d['department_code'], 'wait_days' => $d['wait_days'] );
			}
		}
		usort( $waits, function ( $a, $b ) { return $b['wait_days'] - $a['wait_days']; } );
		$bottleneck = $util ? $util[0] : null;
		// capacity-constrained departments: utilisation >= 90%
		$constrained = array_values( array_filter( $util, function ( $u ) { return ( $u['utilisation'] ?? 0 ) >= 90; } ) );
		// costing
		$costing = ( new PP_Costing() )->cost_product( $req['product_code'], $qty );
		$working_days = PP_Calendar::working_days_between( $start, $completion, $cal );
		$summary = array(
			'start_date' => $start, 'completion_date' => $completion, 'working_days' => $working_days, 'delivery_date' => $req['delivery_date'],
			'on_time' => $req['delivery_date'] ? ( $completion <= $req['delivery_date'] ) : null,
			'orders' => count( $orders ), 'work_orders' => count( $opdefs ), 'materials' => count( $x['materials'] ),
			'bottleneck' => $bottleneck, 'constrained' => $constrained, 'utilisation' => $util, 'waits' => array_slice( $waits, 0, 10 ),
			'cost' => array( 'unit' => $costing['unit'], 'total' => $costing['total'], 'complete' => $costing['complete'], 'missing_prices' => $costing['missing_prices'], 'missing_routing' => $costing['missing_routing'] ),
			'warnings' => array_values( array_unique( $warnings ) ), 'infeasible' => $res['infeasible'], 'priority' => $priority,
			'capacity_basis' => $basis_pref, 'use_stock' => $use_stock,
		);
		return array( 'request' => $req, 'orders' => $orders, 'ops' => $opdefs, 'materials' => $x['materials'], 'tree' => $x['tree'], 'summary' => $summary, 'costing' => $costing, 'params' => $params );
	}

	public static function priority_rank( $label ) {
		$map = array( 'Urgent' => 1, 'High' => 2, 'Normal' => 3, 'Low' => 4 );
		return isset( $map[ $label ] ) ? $map[ $label ] : 3;
	}

	/**
	 * Minutes already committed per department per date by confirmed, open work
	 * orders (forecast rows when a re-forecast exists, otherwise baseline).
	 */
	public static function committed_load( $exclude_request_id = null, $exclude_plan_id = null ) {
		$sql = 'SELECT dt.wo_id, dt.department_code, dt.target_date, dt.planned_minutes, dt.kind FROM ' . PP_Db::t( 'daily_targets' ) . ' dt JOIN ' . PP_Db::t( 'work_orders' ) . ' wo ON wo.id = dt.wo_id JOIN ' . PP_Db::t( 'plans' ) . " p ON p.id = wo.plan_id WHERE p.status = 'confirmed' AND wo.status NOT IN ('Completed','Cancelled') AND dt.kind IN ('baseline','forecast') AND dt.target_date >= %s";
		$args = array( PP_Db::today() );
		if ( $exclude_request_id ) {
			$sql   .= ' AND wo.request_id <> %d';
			$args[] = (int) $exclude_request_id;
		}
		if ( $exclude_plan_id ) {
			$sql   .= ' AND wo.plan_id <> %d';
			$args[] = (int) $exclude_plan_id;
		}
		$rows   = PP_Db::rows( $sql, ...$args );
		$has_fc = array();
		foreach ( $rows as $r ) {
			if ( 'forecast' === $r['kind'] ) {
				$has_fc[ $r['wo_id'] ] = true;
			}
		}
		$load = array();
		foreach ( $rows as $r ) {
			if ( isset( $has_fc[ $r['wo_id'] ] ) && 'forecast' !== $r['kind'] ) {
				continue;
			}
			$load[ $r['department_code'] ][ $r['target_date'] ] = ( $load[ $r['department_code'] ][ $r['target_date'] ] ?? 0 ) + (float) $r['planned_minutes'];
		}
		return $load;
	}

	/* ------------------------------------------------------------------ */
	/* Persistence                                                         */
	/* ------------------------------------------------------------------ */

	/** Save a generated plan as a new proposed version (supersedes earlier proposals). */
	public static function save_proposed( $gen ) {
		$req  = $gen['request'];
		$user = wp_get_current_user();
		PP_Db::begin();
		try {
			foreach ( PP_Db::rows( 'SELECT id FROM ' . PP_Db::t( 'plans' ) . " WHERE request_id = %d AND status = 'proposed'", $req['id'] ) as $old ) {
				self::delete_plan_data( $old['id'] );
				PP_Db::update( 'plans', array( 'status' => 'superseded' ), array( 'id' => $old['id'] ) );
			}
			$version = (int) PP_Db::var( 'SELECT COALESCE(MAX(version),0)+1 FROM ' . PP_Db::t( 'plans' ) . ' WHERE request_id = %d', $req['id'] );
			$plan_id = PP_Db::insert(
				'plans',
				array(
					'plan_no' => PP_Db::next_number( 'PL', 'PL-' ), 'request_id' => $req['id'], 'version' => $version, 'status' => 'proposed',
					'params' => wp_json_encode( $gen['params'] ), 'summary' => wp_json_encode( $gen['summary'] ),
					'created_by' => $user->user_login, 'created_at' => PP_Db::now(),
				)
			);
			$po_ids = array();
			foreach ( $gen['orders'] as $code => $o ) {
				$po_ids[ $code ] = PP_Db::insert(
					'production_orders',
					array(
						'order_no' => PP_Db::next_number( 'PO', 'PO-' ), 'plan_id' => $plan_id, 'request_id' => $req['id'], 'parent_order_id' => null,
						'product_code' => $code, 'description' => $o['description'], 'parent_codes' => implode( ', ', $o['parents'] ),
						'finished_product_code' => $req['product_code'], 'level' => $o['level'], 'required_qty' => $o['required_qty'], 'planned_qty' => $o['planned_qty'],
						'status' => 'Proposed', 'is_master' => $o['is_master'], 'has_routing' => $o['has_routing'],
						'planned_start' => $o['planned_start'], 'planned_finish' => $o['planned_finish'], 'baseline_finish' => $o['planned_finish'], 'forecast_finish' => $o['planned_finish'],
					)
				);
			}
			foreach ( $gen['orders'] as $code => $o ) {
				if ( $o['parents'] ) {
					PP_Db::update( 'production_orders', array( 'parent_order_id' => $po_ids[ $o['parents'][0] ] ), array( 'id' => $po_ids[ $code ] ) );
				}
			}
			$wo_ids = array();
			foreach ( $gen['ops'] as $key => $d ) {
				$wo_ids[ $key ] = PP_Db::insert(
					'work_orders',
					array(
						'wo_no' => PP_Db::next_number( 'WO', 'WO-' ), 'production_order_id' => $po_ids[ $d['order_code'] ], 'plan_id' => $plan_id, 'request_id' => $req['id'],
						'product_code' => $d['order_code'], 'department_code' => $d['department_code'], 'operation_name' => $d['operation_name'], 'seq' => $d['seq'],
						'planned_qty' => $d['planned_qty'], 'minutes_per_unit' => $d['minutes_per_unit'], 'labor_hours_per_unit' => $d['labor_hours_per_unit'], 'machine_hours_per_unit' => $d['machine_hours_per_unit'],
						'planned_minutes' => $d['planned_minutes'], 'capacity_basis' => $d['capacity_basis'], 'units_per_day' => $d['units_per_day'], 'manpower_required' => $d['manpower_required'],
						'planned_start' => $d['planned_start'], 'planned_finish' => $d['planned_finish'], 'baseline_start' => $d['planned_start'], 'baseline_finish' => $d['planned_finish'],
						'forecast_start' => $d['planned_start'], 'forecast_finish' => $d['planned_finish'], 'status' => 'Proposed', 'is_first_op' => $d['is_first_op'], 'is_last_op' => $d['is_last_op'],
					)
				);
			}
			$deps = array(); $targets = array();
			foreach ( $gen['ops'] as $key => $d ) {
				foreach ( $d['deps'] as $dep ) {
					$deps[] = array( 'wo_id' => $wo_ids[ $key ], 'depends_on_wo_id' => $wo_ids[ $dep[0] ], 'kind' => $dep[2], 'ratio' => round( $dep[1], 6 ) );
				}
				foreach ( $d['daily'] as $day ) {
					$targets[] = array( 'wo_id' => $wo_ids[ $key ], 'plan_id' => $plan_id, 'department_code' => $d['department_code'], 'target_date' => $day['date'], 'planned_qty' => $day['qty'], 'planned_minutes' => $day['minutes'], 'kind' => 'proposed' );
				}
			}
			PP_Db::bulk_insert( 'wo_dependencies', $deps );
			PP_Db::bulk_insert( 'daily_targets', $targets );
			$mats = array();
			foreach ( $gen['costing']['materials'] as $m ) {
				$mats[] = array( 'plan_id' => $plan_id, 'request_id' => $req['id'], 'material_code' => $m['code'], 'description' => mb_substr( (string) $m['description'], 0, 255 ), 'uom' => $m['uom'], 'qty' => $m['qty'], 'unit_price' => $m['unit_price'], 'cost' => $m['cost'], 'price_status' => $m['price_status'] );
			}
			PP_Db::bulk_insert( 'material_requirements', $mats );
			PP_Db::update( 'sales_requests', array( 'status' => 'Planned', 'expected_completion' => $gen['summary']['completion_date'], 'updated_at' => PP_Db::now() ), array( 'id' => $req['id'] ) );
			PP_Db::commit();
		} catch ( Exception $e ) {
			PP_Db::rollback();
			throw $e;
		}
		PP_Db::audit( 'plan_generated', 'plan', $plan_id, array( 'request' => $req['request_no'], 'version' => $version, 'completion' => $gen['summary']['completion_date'] ) );
		return $plan_id;
	}

	public static function delete_plan_data( $plan_id ) {
		$wo_ids = array_map( 'intval', array_column( PP_Db::rows( 'SELECT id FROM ' . PP_Db::t( 'work_orders' ) . ' WHERE plan_id = %d', $plan_id ), 'id' ) );
		if ( $wo_ids ) {
			$in = implode( ',', $wo_ids );
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'wo_dependencies' ) . " WHERE wo_id IN ($in) OR depends_on_wo_id IN ($in)" );
		}
		foreach ( array( 'daily_targets', 'work_orders', 'production_orders', 'material_requirements' ) as $t ) {
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( $t ) . ' WHERE plan_id = %d', $plan_id );
		}
	}

	/** Confirm a proposed plan: it becomes the baseline. */
	public static function confirm( $plan_id ) {
		$plan = PP_Db::find( 'plans', $plan_id );
		if ( ! $plan || 'proposed' !== $plan['status'] ) {
			throw new RuntimeException( 'Only a proposed plan can be confirmed.' );
		}
		$req  = PP_Db::find( 'sales_requests', $plan['request_id'] );
		$user = wp_get_current_user();
		PP_Db::begin();
		try {
			// supersede a previously confirmed plan for the same request (no production yet)
			foreach ( PP_Db::rows( 'SELECT id FROM ' . PP_Db::t( 'plans' ) . " WHERE request_id = %d AND status = 'confirmed'", $req['id'] ) as $old ) {
				$entries = (int) PP_Db::var( 'SELECT COUNT(*) FROM ' . PP_Db::t( 'production_entries' ) . ' e JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = e.wo_id WHERE w.plan_id = %d', $old['id'] );
				if ( $entries > 0 ) {
					throw new RuntimeException( 'Production has already been recorded against the confirmed plan. Use Recalculate forecast instead of re-planning.' );
				}
				self::delete_plan_data( $old['id'] );
				PP_Db::update( 'plans', array( 'status' => 'superseded' ), array( 'id' => $old['id'] ) );
			}
			$now = PP_Db::now();
			PP_Db::update( 'plans', array( 'status' => 'confirmed', 'confirmed_by' => $user->user_login, 'confirmed_at' => $now ), array( 'id' => $plan_id ) );
			PP_Db::query( 'UPDATE ' . PP_Db::t( 'production_orders' ) . " SET status = 'Released' WHERE plan_id = %d", $plan_id );
			PP_Db::query( 'UPDATE ' . PP_Db::t( 'work_orders' ) . " SET status = 'Released' WHERE plan_id = %d", $plan_id );
			PP_Db::query( 'UPDATE ' . PP_Db::t( 'daily_targets' ) . " SET kind = 'baseline' WHERE plan_id = %d AND kind = 'proposed'", $plan_id );
			// forecast copy
			$rows = PP_Db::rows( 'SELECT wo_id, plan_id, department_code, target_date, planned_qty, planned_minutes FROM ' . PP_Db::t( 'daily_targets' ) . " WHERE plan_id = %d AND kind = 'baseline'", $plan_id );
			foreach ( $rows as &$r ) {
				$r['kind'] = 'forecast';
			}
			unset( $r );
			PP_Db::bulk_insert( 'daily_targets', $rows );
			$summary = json_decode( $plan['summary'], true );
			PP_Db::update( 'sales_requests', array( 'status' => 'Confirmed', 'confirmed_plan_id' => $plan_id, 'expected_completion' => $summary['completion_date'], 'forecast_completion' => $summary['completion_date'], 'updated_at' => $now ), array( 'id' => $req['id'] ) );
			PP_Db::commit();
		} catch ( Exception $e ) {
			PP_Db::rollback();
			throw $e;
		}
		if ( $req['delivery_date'] && $summary['completion_date'] > $req['delivery_date'] ) {
			PP_Alerts::raise( 'warning', 'delivery_risk', "Confirmed plan for {$req['request_no']} ({$req['product_code']} x {$req['qty']}) completes on {$summary['completion_date']}, after the requested delivery date {$req['delivery_date']}.", $req['id'], null, null, 'sales,planning' );
		}
		PP_Db::audit( 'plan_confirmed', 'plan', $plan_id, array( 'request' => $req['request_no'], 'completion' => $summary['completion_date'] ) );
		return true;
	}

	public static function cancel_request( $request_id, $reason = '' ) {
		$req = PP_Db::find( 'sales_requests', $request_id );
		if ( ! $req ) {
			throw new RuntimeException( 'Request not found.' );
		}
		foreach ( PP_Db::rows( 'SELECT id, status FROM ' . PP_Db::t( 'plans' ) . ' WHERE request_id = %d', $request_id ) as $p ) {
			if ( in_array( $p['status'], array( 'proposed', 'confirmed' ), true ) ) {
				PP_Db::query( 'UPDATE ' . PP_Db::t( 'work_orders' ) . " SET status = 'Cancelled' WHERE plan_id = %d AND status NOT IN ('Completed')", $p['id'] );
				PP_Db::query( 'UPDATE ' . PP_Db::t( 'production_orders' ) . " SET status = 'Cancelled' WHERE plan_id = %d AND status NOT IN ('Completed')", $p['id'] );
				PP_Db::update( 'plans', array( 'status' => 'cancelled' ), array( 'id' => $p['id'] ) );
			}
		}
		PP_Db::update( 'sales_requests', array( 'status' => 'Cancelled', 'updated_at' => PP_Db::now() ), array( 'id' => $request_id ) );
		PP_Db::audit( 'request_cancelled', 'sales_request', $request_id, array( 'reason' => $reason ) );
	}

	/* ------------------------------------------------------------------ */
	/* Re-forecast (delay management)                                       */
	/* ------------------------------------------------------------------ */

	/**
	 * Recalculate remaining work of every open work order of a confirmed plan
	 * from today, honouring other orders' commitments. Baseline is untouched.
	 */
	public static function reforecast( $plan_id, $trigger = 'manual' ) {
		$plan = PP_Db::find( 'plans', $plan_id );
		if ( ! $plan || 'confirmed' !== $plan['status'] ) {
			return null;
		}
		$req      = PP_Db::find( 'sales_requests', $plan['request_id'] );
		$cal      = new PP_Calendar();
		$capacity = new PP_Capacity();
		$settings = PP_Db::settings();
		$today    = $cal->next_working_day( PP_Db::today() );
		$wos      = PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'work_orders' ) . ' WHERE plan_id = %d ORDER BY id', $plan_id );
		$orders   = array();
		foreach ( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'production_orders' ) . ' WHERE plan_id = %d', $plan_id ) as $o ) {
			$orders[ $o['id'] ] = $o;
		}
		$deps = array();
		foreach ( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'wo_dependencies' ) . ' WHERE wo_id IN (SELECT id FROM ' . PP_Db::t( 'work_orders' ) . ' WHERE plan_id = %d)', $plan_id ) as $d ) {
			$deps[ $d['wo_id'] ][] = array( 'wo' . $d['depends_on_wo_id'], (float) $d['ratio'] );
		}
		$ops = array();
		$wo_by_id = array();
		foreach ( $wos as $wo ) {
			$wo_by_id[ $wo['id'] ] = $wo;
			if ( in_array( $wo['status'], array( 'Cancelled' ), true ) ) {
				continue;
			}
			$done = (float) $wo['good_qty'];
			$lvl  = (int) $orders[ $wo['production_order_id'] ]['level'];
			$ops[] = array(
				'key' => 'wo' . $wo['id'], 'order_key' => $wo['production_order_id'], 'dept' => $wo['department_code'], 'qty' => (float) $wo['planned_qty'],
				'mpu' => (float) $wo['minutes_per_unit'], 'cap_units_per_day' => $wo['units_per_day'], 'deps' => isset( $deps[ $wo['id'] ] ) ? $deps[ $wo['id'] ] : array(),
				'priority' => self::priority_rank( $req['priority'] ) * 1000 + ( 10 - min( 9, $lvl ) ) * 10, 'earliest_start' => null, 'done_units' => $done, 'done_minutes' => 0,
			);
		}
		$load = self::committed_load( null, $plan_id );
		$pool = function ( $dept, $date ) use ( $capacity, $cal ) {
			return $capacity->pool_minutes( $dept, $cal->minutes( $date ) );
		};
		$res = PP_Scheduler::run( $ops, $load, $pool, array( $cal, 'is_working' ), $today, (int) $settings['horizon_days'] );
		PP_Db::begin();
		try {
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'daily_targets' ) . " WHERE plan_id = %d AND kind = 'forecast'", $plan_id );
			$targets    = array();
			$order_fin  = array();
			$completion = null;
			foreach ( $ops as $op ) {
				$id = (int) substr( $op['key'], 2 );
				$wo = $wo_by_id[ $id ];
				$r  = $res['ops'][ $op['key'] ];
				$fs = $r['start']; $ff = $r['finish'];
				$remaining = (float) $wo['planned_qty'] - (float) $wo['good_qty'];
				if ( $remaining <= 1e-6 || 'Completed' === $wo['status'] ) {
					$ff = $wo['actual_finish'] ? substr( $wo['actual_finish'], 0, 10 ) : ( $wo['forecast_finish'] ?: $wo['baseline_finish'] );
					$fs = $wo['actual_start'] ? substr( $wo['actual_start'], 0, 10 ) : $wo['forecast_start'];
				} elseif ( $wo['actual_start'] ) {
					$fs = substr( $wo['actual_start'], 0, 10 );
				}
				PP_Db::update( 'work_orders', array( 'forecast_start' => $fs, 'forecast_finish' => $ff ), array( 'id' => $id ) );
				foreach ( $r['daily'] as $day ) {
					$targets[] = array( 'wo_id' => $id, 'plan_id' => $plan_id, 'department_code' => $wo['department_code'], 'target_date' => $day['date'], 'planned_qty' => $day['qty'], 'planned_minutes' => $day['minutes'], 'kind' => 'forecast' );
				}
				$poid = $wo['production_order_id'];
				if ( $ff && ( ! isset( $order_fin[ $poid ] ) || $ff > $order_fin[ $poid ] ) ) {
					$order_fin[ $poid ] = $ff;
				}
				if ( $ff && ( ! $completion || $ff > $completion ) ) {
					$completion = $ff;
				}
			}
			PP_Db::bulk_insert( 'daily_targets', $targets );
			$delayed_orders = array();
			foreach ( $orders as $oid => $o ) {
				$ff = isset( $order_fin[ $oid ] ) ? $order_fin[ $oid ] : $o['forecast_finish'];
				$upd = array( 'forecast_finish' => $ff );
				if ( 'Completed' !== $o['status'] && 'Cancelled' !== $o['status'] ) {
					if ( $ff && $o['baseline_finish'] && $ff > $o['baseline_finish'] ) {
						$upd['status'] = 'Delayed';
						$delayed_orders[] = $o;
					} elseif ( 'Delayed' === $o['status'] ) {
						$upd['status'] = (float) $o['completed_qty'] > 0 ? 'In Progress' : 'Released';
					}
				}
				PP_Db::update( 'production_orders', $upd, array( 'id' => $oid ) );
			}
			$master = null;
			foreach ( $orders as $o ) {
				if ( (int) $o['is_master'] ) {
					$master = $o;
				}
			}
			$fc = $master && isset( $order_fin[ $master['id'] ] ) ? $order_fin[ $master['id'] ] : $completion;
			PP_Db::update( 'sales_requests', array( 'forecast_completion' => $fc, 'updated_at' => PP_Db::now() ), array( 'id' => $req['id'] ) );
			PP_Db::commit();
		} catch ( Exception $e ) {
			PP_Db::rollback();
			throw $e;
		}
		// alerts
		$summary = json_decode( $plan['summary'], true );
		if ( $fc && $summary && $fc > $summary['completion_date'] ) {
			PP_Alerts::raise( 'warning', 'forecast_slip', "Forecast completion of {$req['request_no']} ({$req['product_code']} x {$req['qty']}) moved to $fc (baseline {$summary['completion_date']}).", $req['id'], null, null, 'planning,management', true );
		}
		if ( $fc && $req['delivery_date'] && $fc > $req['delivery_date'] ) {
			PP_Alerts::raise( 'danger', 'delivery_risk', "Delivery date {$req['delivery_date']} for {$req['request_no']} is at risk: forecast completion $fc.", $req['id'], null, null, 'sales,planning', true );
		}
		PP_Db::audit( 'plan_reforecast', 'plan', $plan_id, array( 'trigger' => $trigger, 'forecast_completion' => $fc, 'delayed_orders' => count( $delayed_orders ) ) );
		return array( 'forecast_completion' => $fc, 'delayed_orders' => count( $delayed_orders ), 'infeasible' => $res['infeasible'] );
	}

	/** Re-forecast every confirmed, open plan (ordered by priority then delivery date). */
	public static function reforecast_all( $trigger = 'manual' ) {
		$plans = PP_Db::rows( 'SELECT p.id FROM ' . PP_Db::t( 'plans' ) . ' p JOIN ' . PP_Db::t( 'sales_requests' ) . " r ON r.id = p.request_id WHERE p.status = 'confirmed' AND r.status NOT IN ('Completed','Cancelled') ORDER BY CASE r.priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Normal' THEN 3 ELSE 4 END, r.delivery_date, p.id" );
		$out = array();
		foreach ( $plans as $p ) {
			$out[ $p['id'] ] = self::reforecast( $p['id'], $trigger );
		}
		return $out;
	}
}
