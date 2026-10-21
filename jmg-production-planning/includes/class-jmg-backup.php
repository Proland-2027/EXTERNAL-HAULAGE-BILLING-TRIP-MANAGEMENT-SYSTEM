<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Full JSON backup / restore of every plugin table. */
class JMG_Backup {

	public static function export() {
		global $wpdb;
		@set_time_limit( 600 );
		$out = array( 'format' => 'jmg-pp-backup', 'version' => JMG_PP_VERSION, 'created_at' => JMG_DB::now(), 'site' => home_url(), 'tables' => array() );
		foreach ( JMG_DB::all_tables() as $t ) {
			$out['tables'][ $t ] = $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( $t ), ARRAY_A );
		}
		JMG_Audit::log( 'backup_export', 'backup', '', array( 'tables' => count( $out['tables'] ) ) );
		return $out;
	}

	public static function restore( $data ) {
		global $wpdb;
		@set_time_limit( 900 );
		if ( ! is_array( $data ) || ( $data['format'] ?? '' ) !== 'jmg-pp-backup' || empty( $data['tables'] ) ) {
			return new WP_Error( 'jmg_backup', 'Not a Production Planning backup file.' );
		}
		$summary = array();
		foreach ( JMG_DB::all_tables() as $t ) {
			if ( ! isset( $data['tables'][ $t ] ) ) { continue; }
			$wpdb->query( 'DELETE FROM ' . JMG_DB::table( $t ) );
			$rows = $data['tables'][ $t ];
			if ( $rows ) {
				// normalise columns to the first row's keys
				$cols = array_keys( $rows[0] );
				$norm = array();
				foreach ( $rows as $r ) { $n = array(); foreach ( $cols as $c ) { $n[ $c ] = $r[ $c ] ?? null; } $norm[] = $n; }
				JMG_DB::bulk_insert( $t, $norm, 200 );
			}
			$summary[ $t ] = count( $rows );
		}
		JMG_Calendar::reset_cache();
		JMG_BOM::reset_price_cache();
		JMG_Audit::log( 'backup_restore', 'backup', '', $summary );
		return $summary;
	}
}
