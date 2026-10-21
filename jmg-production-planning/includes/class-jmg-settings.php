<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class JMG_Settings {
	private static $cache = null;

	public static function defaults() {
		return array(
			'work_start'        => '08:00',
			'work_end'          => '17:00',
			'break_minutes'     => 60,
			'net_minutes'       => 480,
			'shifts_per_day'    => 1,
			'working_days'      => array( 1, 2, 3, 4, 5 ), // ISO weekday numbers: Mon..Fri
			'transfer_rule'     => 'next_day',             // next_day | same_day | full_lot
			'capacity_basis'    => 'current',              // current | new (Excel "New Productivity")
			'inventory_enabled' => 0,
			'currency'          => 'NGN',
			'include_overheads' => 1,
			'cost_basis'        => 'unit_cost',             // unit_cost (workbook "Unit Cost" column) | erp (workbook "Cost per unit" ERP line cost)
			'horizon_days'      => 400,
			'company_name'      => '',
			'plan_lead_days'    => 1,                      // earliest plan start = today + N working days
		);
	}

	public static function all() {
		if ( null !== self::$cache ) { return self::$cache; }
		global $wpdb;
		$rows = $wpdb->get_results( 'SELECT setting_key, setting_value FROM ' . JMG_DB::table( 'settings' ), ARRAY_A );
		$out = self::defaults();
		foreach ( (array) $rows as $r ) {
			$v = json_decode( $r['setting_value'], true );
			$out[ $r['setting_key'] ] = ( null === $v && 'null' !== $r['setting_value'] ) ? $r['setting_value'] : $v;
		}
		self::$cache = $out;
		return $out;
	}

	public static function get( $key, $default = null ) {
		$all = self::all();
		return array_key_exists( $key, $all ) ? $all[ $key ] : $default;
	}

	public static function set( $key, $value ) {
		global $wpdb;
		$t = JMG_DB::table( 'settings' );
		$json = wp_json_encode( $value );
		$exists = $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE setting_key=%s", $key ) );
		if ( $exists ) {
			$wpdb->update( $t, array( 'setting_value' => $json ), array( 'setting_key' => $key ) );
		} else {
			$wpdb->insert( $t, array( 'setting_key' => $key, 'setting_value' => $json ) );
		}
		self::$cache = null;
	}

	public static function install_defaults() {
		foreach ( self::defaults() as $k => $v ) {
			if ( null === self::get_raw( $k ) ) { self::set( $k, $v ); }
		}
	}

	private static function get_raw( $key ) {
		global $wpdb;
		return $wpdb->get_var( $wpdb->prepare( 'SELECT setting_value FROM ' . JMG_DB::table( 'settings' ) . ' WHERE setting_key=%s', $key ) );
	}
}
