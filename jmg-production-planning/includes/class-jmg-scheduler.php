<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Finite-capacity, day-bucket scheduler.
 *
 * Every production section and every cutting machine is a pooled resource with a fixed number of
 * productive minutes per working day. An operation consumes minutes_per_unit of its section (and of
 * each machine it needs) per unit produced. Minutes already committed by other confirmed orders are
 * subtracted first, so resources are never double booked. Downstream operations may only process
 * units that upstream operations have completed (per the transfer rule), which gives overlapping
 * partial-batch flow while independent branches (base, panel, canopy ...) run in parallel.
 */
class JMG_Scheduler {

	private $routing;

	public function __construct( JMG_Routing $routing ) {
		$this->routing = $routing;
	}

	/**
	 * Committed loads of other open orders: resource_key => date => minutes.
	 */
	public static function load_committed( $exclude_order_id = 0, $from_date = null ) {
		global $wpdb;
		$t = JMG_DB::table( 'op_schedule' );
		$o = JMG_DB::table( 'orders' );
		$from = $from_date ? $from_date : JMG_Calendar::today();
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT s.resource_key, s.sched_date, SUM(s.minutes) m FROM $t s JOIN $o ord ON ord.id = s.order_id
			 WHERE ord.status IN ('CONFIRMED','IN_PROGRESS') AND s.is_actual=0 AND s.order_id<>%d AND s.sched_date >= %s
			 GROUP BY s.resource_key, s.sched_date", (int) $exclude_order_id, $from ), ARRAY_A );
		$loads = array();
		foreach ( $rows as $r ) { $loads[ $r['resource_key'] ][ $r['sched_date'] ] = (float) $r['m']; }
		return $loads;
	}

	/**
	 * @param array  $ops        ops from JMG_Routing::build() (+ qty_completed, earliest_start optional)
	 * @param string $start_date first day that may be used
	 * @param array  $loads      committed loads (modified in place: this order's minutes are added)
	 * @param array  $opts       transfer_rule, horizon_days
	 */
	public function schedule( $ops, $start_date, &$loads, $opts = array() ) {
		$transfer = $opts['transfer_rule'] ?? JMG_Settings::get( 'transfer_rule', 'next_day' );
		$horizon = (int) ( $opts['horizon_days'] ?? JMG_Settings::get( 'horizon_days', 400 ) );
		$by_uid = array();
		foreach ( $ops as $i => $op ) { $by_uid[ $op['uid'] ] = $i; }
		usort( $ops, function( $a, $b ) { return $a['uid'] - $b['uid']; } ); // uids are created children-first => topological
		$by_uid = array();
		foreach ( $ops as $i => $op ) { $by_uid[ $op['uid'] ] = $i; }

		$remaining = array(); $cum = array(); $alloc = array(); $limited_days = array(); $own_load = array();
		foreach ( $ops as $i => $op ) {
			$done = (float) ( $op['qty_completed'] ?? 0 );
			$cum[ $i ] = $done;
			$remaining[ $i ] = $op['is_scheduled'] ? max( 0.0, (float) $op['qty_planned'] - $done ) : 0.0;
			$alloc[ $i ] = array();
			$ops[ $i ]['planned_start'] = null; $ops[ $i ]['planned_end'] = null;
			if ( ! $op['is_scheduled'] ) { $ops[ $i ]['status'] = 'UNSCHEDULED'; }
			elseif ( $remaining[ $i ] <= 0.0005 ) { $ops[ $i ]['status'] = 'COMPLETED'; $remaining[ $i ] = 0.0; }
			else { $ops[ $i ]['status'] = $done > 0 ? 'IN_PROGRESS' : 'PENDING'; }
		}
		$day = JMG_Calendar::next_working( $start_date );
		$end_limit = JMG_Calendar::add_days( $start_date, $horizon );
		$allocations = array();
		$guard = 0;
		while ( array_sum( $remaining ) > 0.0005 && $day <= $end_limit && $guard++ < 5000 ) {
			if ( ! JMG_Calendar::is_working( $day ) ) { $day = JMG_Calendar::add_days( $day, 1 ); continue; }
			$snapshot = $cum;           // cumulative completed as of start of day
			$snap_rem = $remaining;
			$free = array();            // resource_key => free minutes today
			foreach ( $ops as $i => $op ) {
				if ( $remaining[ $i ] <= 0.0005 ) { continue; }
				if ( ! empty( $op['earliest_start'] ) && $day < $op['earliest_start'] ) { continue; }
				// predecessor availability
				$avail = $remaining[ $i ];
				foreach ( $op['predecessors'] as $p ) {
					if ( ! isset( $by_uid[ $p['uid'] ] ) ) { continue; }
					$pi = $by_uid[ $p['uid'] ];
					$ratio = (float) $p['ratio'] > 0 ? (float) $p['ratio'] : 1.0;
					if ( 'full_lot' === $transfer ) {
						// whole lot must be complete at the start of the day
						$pred_cum = $snap_rem[ $pi ] <= 0.0005 ? $snapshot[ $pi ] : 0.0;
					} elseif ( 'same_day' === $transfer ) {
						$pred_cum = $cum[ $pi ];
					} else {
						$pred_cum = $snapshot[ $pi ];
					}
					$avail = min( $avail, $pred_cum / $ratio - $cum[ $i ] );
				}
				if ( $avail <= 0.0005 ) { continue; }
				// capacity
				$resources = array( array( 'resource_key' => 'section:' . (int) $op['section_id'], 'minutes_per_unit' => (float) $op['minutes_per_unit'] ) );
				foreach ( (array) $op['machines'] as $m ) { $resources[] = array( 'resource_key' => $m['resource_key'], 'minutes_per_unit' => (float) $m['minutes_per_unit'] ); }
				$cap = $avail; $binding = null;
				foreach ( $resources as $r ) {
					$k = $r['resource_key'];
					if ( ! isset( $free[ $k ] ) ) {
						$free[ $k ] = $this->routing->resource_minutes_per_day( $k ) - (float) ( $loads[ $k ][ $day ] ?? 0 );
					}
					$mpu = $r['minutes_per_unit'];
					if ( $mpu <= 0 ) { continue; }
					$c = max( 0.0, $free[ $k ] ) / $mpu;
					if ( $c < $cap ) { $cap = $c; $binding = $k; }
				}
				$q = floor( min( $avail, $cap, $remaining[ $i ] ) * 1000 ) / 1000;
				if ( $q < 0.001 ) {
					if ( $binding && $avail > 0.001 ) { $limited_days[ $binding ] = ( $limited_days[ $binding ] ?? 0 ) + 1; }
					continue;
				}
				if ( $binding && $q < min( $avail, $remaining[ $i ] ) - 0.0005 ) { $limited_days[ $binding ] = ( $limited_days[ $binding ] ?? 0 ) + 1; }
				foreach ( $resources as $r ) {
					$k = $r['resource_key'];
					$mins = $q * $r['minutes_per_unit'];
					$free[ $k ] -= $mins;
					$loads[ $k ][ $day ] = (float) ( $loads[ $k ][ $day ] ?? 0 ) + $mins;
					$own_load[ $k ] = (float) ( $own_load[ $k ] ?? 0 ) + $mins;
					$allocations[] = array( 'op_uid' => $op['uid'], 'resource_key' => $k, 'section_id' => 0 === strpos( $k, 'section:' ) ? (int) $op['section_id'] : null, 'sched_date' => $day, 'qty' => 0 === strpos( $k, 'section:' ) ? $q : 0, 'minutes' => round( $mins, 3 ) );
				}
				$alloc[ $i ][ $day ] = $q;
				$cum[ $i ] += $q;
				$remaining[ $i ] -= $q;
				if ( null === $ops[ $i ]['planned_start'] ) { $ops[ $i ]['planned_start'] = $day; }
				$ops[ $i ]['planned_end'] = $day;
			}
			$day = JMG_Calendar::add_days( $day, 1 );
		}
		$warnings = array();
		$unfinished = array();
		foreach ( $ops as $i => $op ) {
			$ops[ $i ]['daily'] = $alloc[ $i ];
			if ( $remaining[ $i ] > 0.0005 ) { $unfinished[] = $op['component_code'] . ' / ' . $op['stage_name']; }
			if ( $op['is_scheduled'] && 'COMPLETED' !== $ops[ $i ]['status'] && null === $ops[ $i ]['planned_start'] && $remaining[ $i ] > 0.0005 ) { $ops[ $i ]['status'] = 'BLOCKED'; }
		}
		if ( $unfinished ) { $warnings[] = 'Horizon of ' . $horizon . ' days exceeded; not fully scheduled: ' . implode( ', ', array_slice( $unfinished, 0, 6 ) ) . ( count( $unfinished ) > 6 ? ' ...' : '' ); }
		$end = null; $start = null;
		foreach ( $ops as $op ) {
			if ( $op['planned_end'] && ( null === $end || $op['planned_end'] > $end ) ) { $end = $op['planned_end']; }
			if ( $op['planned_start'] && ( null === $start || $op['planned_start'] < $start ) ) { $start = $op['planned_start']; }
		}
		// bottleneck: resource with most capacity-limited days, tie-break by own load
		$bottleneck = null;
		arsort( $limited_days );
		foreach ( $limited_days as $k => $days ) {
			$bottleneck = array( 'resource_key' => $k, 'name' => $this->resource_name( $k ), 'limited_days' => $days, 'minutes' => round( $own_load[ $k ] ?? 0 ), 'daily_capacity' => $this->routing->resource_minutes_per_day( $k ) );
			break;
		}
		// utilisation summary per resource over the order span
		$util = array();
		$span_days = ( $start && $end ) ? JMG_Calendar::working_days_between( $start, $end ) : 0;
		foreach ( $own_load as $k => $mins ) {
			$capd = $this->routing->resource_minutes_per_day( $k );
			$util[] = array( 'resource_key' => $k, 'name' => $this->resource_name( $k ), 'minutes' => round( $mins ), 'daily_capacity' => $capd, 'span_days' => $span_days, 'utilisation_pct' => ( $capd > 0 && $span_days > 0 ) ? round( 100 * $mins / ( $capd * $span_days ), 1 ) : null, 'limited_days' => $limited_days[ $k ] ?? 0 );
		}
		usort( $util, function( $a, $b ) { return $b['limited_days'] - $a['limited_days'] ?: $b['minutes'] <=> $a['minutes']; } );
		return array( 'ops' => $ops, 'allocations' => $allocations, 'start' => $start, 'end' => $end, 'bottleneck' => $bottleneck, 'utilisation' => $util, 'warnings' => $warnings, 'lead_time_days' => $span_days );
	}

	public function resource_name( $key ) {
		if ( 0 === strpos( $key, 'section:' ) ) {
			$s = $this->routing->sections();
			$sid = (int) substr( $key, 8 );
			return isset( $s[ $sid ] ) ? $s[ $sid ]['section_name'] . ' (' . $s[ $sid ]['site'] . ')' : 'Section #' . $sid;
		}
		return str_replace( 'machine:', '', $key ) . ' (cutting machine)';
	}

	/** Resource load profile for a date range (all committed orders): for dashboards. */
	public static function load_profile( $from, $to ) {
		global $wpdb;
		$t = JMG_DB::table( 'op_schedule' ); $o = JMG_DB::table( 'orders' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT s.resource_key, s.section_id, s.sched_date, SUM(s.minutes) minutes, SUM(s.qty) qty FROM $t s JOIN $o ord ON ord.id=s.order_id WHERE ord.status IN ('CONFIRMED','IN_PROGRESS') AND s.sched_date BETWEEN %s AND %s GROUP BY s.resource_key, s.section_id, s.sched_date ORDER BY s.sched_date", $from, $to ), ARRAY_A );
	}
}
