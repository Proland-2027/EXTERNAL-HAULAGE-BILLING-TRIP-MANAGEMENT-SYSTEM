<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Working calendar: weekday pattern + holiday / extra working day overrides. */
class JMG_Calendar {
	private static $overrides = null;

	private static function overrides() {
		if ( null === self::$overrides ) {
			global $wpdb;
			self::$overrides = array();
			$rows = $wpdb->get_results( 'SELECT cal_date, is_working, note FROM ' . JMG_DB::table( 'calendar' ), ARRAY_A );
			foreach ( (array) $rows as $r ) { self::$overrides[ $r['cal_date'] ] = array( 'is_working' => (int) $r['is_working'], 'note' => $r['note'] ); }
		}
		return self::$overrides;
	}

	public static function reset_cache() { self::$overrides = null; }

	public static function is_working( $date ) {
		$ov = self::overrides();
		if ( isset( $ov[ $date ] ) ) { return (bool) $ov[ $date ]['is_working']; }
		$dow = (int) gmdate( 'N', strtotime( $date . ' 12:00:00 UTC' ) );
		$days = (array) JMG_Settings::get( 'working_days', array( 1, 2, 3, 4, 5 ) );
		return in_array( $dow, array_map( 'intval', $days ), true );
	}

	public static function add_days( $date, $n ) {
		return gmdate( 'Y-m-d', strtotime( $date . ' 12:00:00 UTC' ) + $n * 86400 );
	}

	/** First working day on or after $date. */
	public static function next_working( $date ) {
		$guard = 0;
		while ( ! self::is_working( $date ) && $guard++ < 400 ) { $date = self::add_days( $date, 1 ); }
		return $date;
	}

	/** Add N working days (N>=0) to a date; result is a working day. */
	public static function add_working_days( $date, $n ) {
		$date = self::next_working( $date );
		while ( $n > 0 ) { $date = self::next_working( self::add_days( $date, 1 ) ); $n--; }
		return $date;
	}

	/** Number of working days from $a to $b inclusive. */
	public static function working_days_between( $a, $b ) {
		if ( ! $a || ! $b || $b < $a ) { return 0; }
		$n = 0; $d = $a; $guard = 0;
		while ( $d <= $b && $guard++ < 2000 ) { if ( self::is_working( $d ) ) { $n++; } $d = self::add_days( $d, 1 ); }
		return $n;
	}

	public static function set_override( $date, $is_working, $note = '' ) {
		global $wpdb;
		$t = JMG_DB::table( 'calendar' );
		$id = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE cal_date=%s", $date ) );
		if ( $id ) {
			$wpdb->update( $t, array( 'is_working' => $is_working ? 1 : 0, 'note' => $note ), array( 'id' => $id ) );
		} else {
			$wpdb->insert( $t, array( 'cal_date' => $date, 'is_working' => $is_working ? 1 : 0, 'note' => $note ) );
		}
		self::reset_cache();
	}

	public static function remove_override( $date ) {
		global $wpdb;
		$wpdb->delete( JMG_DB::table( 'calendar' ), array( 'cal_date' => $date ) );
		self::reset_cache();
	}

	public static function list_overrides() {
		global $wpdb;
		return $wpdb->get_results( 'SELECT cal_date, is_working, note FROM ' . JMG_DB::table( 'calendar' ) . ' ORDER BY cal_date', ARRAY_A );
	}

	public static function today() {
		return current_time( 'Y-m-d' );
	}
}
