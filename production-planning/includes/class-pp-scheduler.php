<?php
/**
 * Finite-capacity, day-bucket scheduler.
 *
 * Each operation consumes labour-minutes from its department's daily pool.
 * Operations flow with daily transfer batches: a successor may work on day D on
 * whatever its predecessors completed up to the end of day D-1 (partial
 * transfers). Capacity already committed to confirmed orders is honoured.
 *
 * Pure PHP: operates on arrays so it can be unit-tested without WordPress.
 */
class PP_Scheduler {

	const EPS = 1e-6;

	/**
	 * @param array    $ops   list of operations:
	 *   key, order_key, dept, qty, mpu (minutes/unit), cap_units_per_day|null, deps [[key, ratio]],
	 *   priority (int), earliest_start (Y-m-d|null), done_units, done_minutes
	 * @param array    $load  dept => date => minutes already committed
	 * @param callable $pool  function(dept, date): available minutes for that department that day
	 * @param callable $is_working function(date): bool
	 * @param string   $start Y-m-d
	 * @param int      $horizon_days
	 */
	public static function run( array $ops, array $load, callable $pool, callable $is_working, $start, $horizon_days = 730 ) {
		$byKey = array();
		foreach ( $ops as $i => $op ) {
			$op['remaining']   = max( 0.0, ( (float) $op['qty'] - (float) ( $op['done_units'] ?? 0 ) ) * (float) $op['mpu'] );
			$op['produced']    = (float) ( $op['done_minutes'] ?? 0 ); // minutes of work done on units not yet complete
			$op['cum_units']   = (float) ( $op['done_units'] ?? 0 );
			$op['daily']       = array();
			$op['start']       = null;
			$op['finish']      = null;
			$op['wait_days']   = 0;
			$op['idx']         = $i;
			$byKey[ $op['key'] ] = $op;
		}
		// scheduling priority: lower priority value first, then order of appearance
		uasort(
			$byKey,
			function ( $a, $b ) {
				$d = (int) $a['priority'] - (int) $b['priority'];
				return $d ?: ( $a['idx'] - $b['idx'] );
			}
		);
		$dept_used = array(); // dept => date => minutes used by this run
		$dept_avail = array();
		$date      = $start;
		$days      = 0;
		$pending   = count( array_filter( $byKey, function ( $o ) { return $o['remaining'] > self::EPS; } ) );
		$infeasible = false;

		while ( $pending > 0 ) {
			if ( $days++ > $horizon_days ) {
				$infeasible = true;
				break;
			}
			if ( ! $is_working( $date ) ) {
				$date = date( 'Y-m-d', strtotime( $date . ' +1 day' ) );
				continue;
			}
			// snapshot of cumulative output at start of day (end of previous day)
			$prev_cum = array();
			foreach ( $byKey as $k => $o ) {
				$prev_cum[ $k ] = $o['cum_units'];
			}
			$avail = array();
			foreach ( $byKey as $k => &$o ) {
				if ( $o['remaining'] <= self::EPS ) {
					continue;
				}
				if ( ! empty( $o['earliest_start'] ) && $date < $o['earliest_start'] ) {
					continue;
				}
				$dept = $o['dept'];
				if ( ! isset( $avail[ $dept ] ) ) {
					$committed = isset( $load[ $dept ][ $date ] ) ? (float) $load[ $dept ][ $date ] : 0.0;
					$avail[ $dept ] = max( 0.0, (float) $pool( $dept, $date ) - $committed );
					$dept_avail[ $dept ][ $date ] = (float) $pool( $dept, $date );
				}
				// units that predecessors have made available
				$limit_units = (float) $o['qty'] - $o['cum_units'];
				foreach ( $o['deps'] as $dep ) {
					if ( ! isset( $byKey[ $dep[0] ] ) ) {
						continue; // dependency without operations = available
					}
					$avail_units = $prev_cum[ $dep[0] ] * (float) $dep[1];
					$limit_units = min( $limit_units, floor( $avail_units + 1e-6 ) - $o['cum_units'] );
				}
				if ( $limit_units <= self::EPS ) {
					$o['wait_days']++;
					continue;
				}
				$mpu = (float) $o['mpu'];
				if ( $mpu <= 0 ) {
					// pass-through (no capacity data): completes what is available
					$add = $limit_units;
					$o['cum_units'] += $add;
					$o['remaining']  = 0;
					$o['daily'][]    = array( 'date' => $date, 'qty' => $add, 'minutes' => 0 );
					$o['start']      = $o['start'] ?: $date;
					$o['finish']     = $date;
					continue;
				}
				// minutes needed to finish the available units (accounting for partial work)
				$need = $limit_units * $mpu - $o['produced'];
				$use  = min( $o['remaining'], $avail[ $dept ], max( 0.0, $need ) );
				if ( ! empty( $o['cap_units_per_day'] ) ) {
					$use = min( $use, (float) $o['cap_units_per_day'] * $mpu );
				}
				if ( $use <= self::EPS ) {
					if ( $avail[ $dept ] <= self::EPS ) {
						$o['wait_days']++;
					}
					continue;
				}
				$o['remaining'] -= $use;
				$avail[ $dept ]  -= $use;
				$dept_used[ $dept ][ $date ] = ( $dept_used[ $dept ][ $date ] ?? 0 ) + $use;
				$o['produced']  += $use;
				$whole           = floor( $o['produced'] / $mpu + 1e-6 );
				if ( $o['remaining'] <= self::EPS ) {
					// finished: everything left counts as complete
					$whole = (float) $o['qty'] - $o['cum_units'];
					$o['remaining'] = 0;
				}
				$o['produced']  -= $whole * $mpu;
				if ( $o['produced'] < 0 ) {
					$o['produced'] = 0;
				}
				$o['cum_units'] += $whole;
				$o['daily'][]    = array( 'date' => $date, 'qty' => $whole, 'minutes' => round( $use, 2 ) );
				$o['start']      = $o['start'] ?: $date;
				if ( $o['remaining'] <= self::EPS ) {
					$o['finish'] = $date;
				}
			}
			unset( $o );
			$pending = 0;
			foreach ( $byKey as $o ) {
				if ( $o['remaining'] > self::EPS ) {
					$pending++;
				}
			}
			$date = date( 'Y-m-d', strtotime( $date . ' +1 day' ) );
		}

		// utilisation per department over the span of this run
		$util = array();
		foreach ( $dept_used as $dept => $dates ) {
			$used = array_sum( $dates );
			$cap  = 0;
			$committed = 0;
			foreach ( $dates as $d => $m ) {
				$cap += $dept_avail[ $dept ][ $d ] ?? 0;
				$committed += $load[ $dept ][ $d ] ?? 0;
			}
			$util[ $dept ] = array( 'department_code' => $dept, 'minutes_used' => round( $used ), 'minutes_committed' => round( $committed ), 'minutes_available' => round( $cap ), 'days' => count( $dates ), 'utilisation' => $cap > 0 ? round( ( $used + $committed ) / $cap * 100, 1 ) : null );
		}
		$result = array();
		foreach ( $byKey as $k => $o ) {
			$result[ $k ] = array( 'key' => $k, 'start' => $o['start'], 'finish' => $o['finish'], 'daily' => $o['daily'], 'wait_days' => $o['wait_days'], 'completed' => $o['remaining'] <= self::EPS, 'cum_units' => $o['cum_units'] );
		}
		return array( 'ops' => $result, 'utilisation' => $util, 'infeasible' => $infeasible, 'dept_used' => $dept_used );
	}
}
