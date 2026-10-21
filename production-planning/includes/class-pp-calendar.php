<?php
/**
 * Production calendar: working days, available minutes, overtime and shifts.
 */
class PP_Calendar {

	private $days = array();
	private $settings;

	public function __construct() {
		$this->settings = PP_Db::settings();
		foreach ( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'calendar' ) ) as $r ) {
			$this->days[ $r['cal_date'] ] = $r;
		}
	}

	public function is_working( $date ) {
		if ( isset( $this->days[ $date ] ) ) {
			return (int) $this->days[ $date ]['is_working'] === 1;
		}
		$dow = (int) date( 'N', strtotime( $date ) );
		return in_array( $dow, (array) $this->settings['working_days'], true );
	}

	/** Net production minutes for one person/machine on a date (0 when not working). */
	public function minutes( $date ) {
		if ( isset( $this->days[ $date ] ) ) {
			$d = $this->days[ $date ];
			if ( ! (int) $d['is_working'] ) {
				return 0;
			}
			return ( (int) $d['minutes_available'] + (int) $d['overtime_minutes'] ) * max( 1, (int) $d['shifts'] );
		}
		return $this->is_working( $date ) ? (int) $this->settings['net_minutes'] : 0;
	}

	public function next_working_day( $date ) {
		$d = $date;
		for ( $i = 0; $i < 60; $i++ ) {
			if ( $this->is_working( $d ) ) {
				return $d;
			}
			$d = date( 'Y-m-d', strtotime( $d . ' +1 day' ) );
		}
		return $d;
	}

	public function add_working_days( $date, $n ) {
		$d = $date;
		while ( $n > 0 ) {
			$d = date( 'Y-m-d', strtotime( $d . ' +1 day' ) );
			if ( $this->is_working( $d ) ) {
				$n--;
			}
		}
		return $d;
	}

	public static function working_days_between( $from, $to, $cal = null ) {
		$cal = $cal ?: new self();
		$n   = 0;
		$d   = $from;
		while ( $d <= $to ) {
			if ( $cal->is_working( $d ) ) {
				$n++;
			}
			$d = date( 'Y-m-d', strtotime( $d . ' +1 day' ) );
		}
		return $n;
	}
}
