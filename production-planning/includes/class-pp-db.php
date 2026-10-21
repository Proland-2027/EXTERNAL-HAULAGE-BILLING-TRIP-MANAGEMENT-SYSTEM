<?php
/**
 * Database helper: table names, small query helpers, audit trail, settings.
 */
class PP_Db {

	public static $tables = array(
		'products', 'bom_lines', 'routings', 'overheads', 'resources', 'departments', 'capacities',
		'machines', 'machine_capacities', 'cutting_files', 'material_prices', 'calendar',
		'sales_requests', 'plans', 'production_orders', 'work_orders', 'wo_dependencies', 'daily_targets',
		'production_entries', 'wip_transfers', 'material_requirements', 'alerts', 'audit_log',
		'productivity_history', 'sequences',
	);

	public static function t( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'pp_' . $name;
	}

	public static function rows( $sql, ...$args ) {
		global $wpdb;
		if ( $args ) {
			$sql = $wpdb->prepare( $sql, ...$args );
		}
		return $wpdb->get_results( $sql, ARRAY_A ) ?: array();
	}

	public static function row( $sql, ...$args ) {
		global $wpdb;
		if ( $args ) {
			$sql = $wpdb->prepare( $sql, ...$args );
		}
		return $wpdb->get_row( $sql, ARRAY_A );
	}

	public static function var( $sql, ...$args ) {
		global $wpdb;
		if ( $args ) {
			$sql = $wpdb->prepare( $sql, ...$args );
		}
		return $wpdb->get_var( $sql );
	}

	public static function insert( $table, $data ) {
		global $wpdb;
		$wpdb->insert( self::t( $table ), $data );
		return (int) $wpdb->insert_id;
	}

	public static function update( $table, $data, $where ) {
		global $wpdb;
		return $wpdb->update( self::t( $table ), $data, $where );
	}

	public static function delete( $table, $where ) {
		global $wpdb;
		return $wpdb->delete( self::t( $table ), $where );
	}

	public static function query( $sql, ...$args ) {
		global $wpdb;
		if ( $args ) {
			$sql = $wpdb->prepare( $sql, ...$args );
		}
		return $wpdb->query( $sql );
	}

	public static function find( $table, $id ) {
		return self::row( 'SELECT * FROM ' . self::t( $table ) . ' WHERE id = %d', $id );
	}

	public static function begin() {
		global $wpdb;
		$wpdb->query( 'START TRANSACTION' );
	}

	public static function commit() {
		global $wpdb;
		$wpdb->query( 'COMMIT' );
	}

	public static function rollback() {
		global $wpdb;
		$wpdb->query( 'ROLLBACK' );
	}

	/** Bulk insert rows (array of assoc arrays sharing the same keys). */
	public static function bulk_insert( $table, $rows, $chunk = 400 ) {
		global $wpdb;
		if ( empty( $rows ) ) {
			return 0;
		}
		$cols  = array_keys( $rows[0] );
		$count = 0;
		foreach ( array_chunk( $rows, $chunk ) as $batch ) {
			$values = array();
			foreach ( $batch as $r ) {
				$vals = array();
				foreach ( $cols as $c ) {
					$v = isset( $r[ $c ] ) ? $r[ $c ] : null;
					if ( null === $v ) {
						$vals[] = 'NULL';
					} elseif ( is_int( $v ) || is_float( $v ) ) {
						$vals[] = (string) ( 0 + $v );
					} else {
						$vals[] = "'" . esc_sql( (string) $v ) . "'";
					}
				}
				$values[] = '(' . implode( ',', $vals ) . ')';
			}
			$sql = 'INSERT INTO ' . self::t( $table ) . ' (`' . implode( '`,`', $cols ) . '`) VALUES ' . implode( ',', $values );
			$wpdb->query( $sql );
			$count += count( $batch );
		}
		return $count;
	}

	/** Sequential, gap-free document numbers (SR-000001, PO-..., WO-..., TR-...). */
	public static function next_number( $key, $prefix, $pad = 6 ) {
		global $wpdb;
		$t = self::t( 'sequences' );
		$wpdb->query( $wpdb->prepare( "INSERT INTO $t (seq_key, seq_value) VALUES (%s, 1) ON DUPLICATE KEY UPDATE seq_value = seq_value + 1", $key ) );
		$val = (int) $wpdb->get_var( $wpdb->prepare( "SELECT seq_value FROM $t WHERE seq_key = %s", $key ) );
		return $prefix . str_pad( (string) $val, $pad, '0', STR_PAD_LEFT );
	}

	public static function audit( $action, $entity, $entity_id, $details = array() ) {
		$user = wp_get_current_user();
		self::insert(
			'audit_log',
			array(
				'user_id'    => $user ? (int) $user->ID : 0,
				'user_login' => $user && $user->ID ? $user->user_login : 'system',
				'action'     => $action,
				'entity'     => $entity,
				'entity_id'  => (string) $entity_id,
				'details'    => wp_json_encode( $details ),
				'created_at' => current_time( 'mysql' ),
			)
		);
	}

	public static function settings() {
		$defaults = array(
			'work_start'        => '08:00',
			'work_end'          => '17:00',
			'break_minutes'     => 60,
			'net_minutes'       => 480,
			'working_days'      => array( 1, 2, 3, 4, 5 ),
			'currency'          => 'NGN',
			'currency_symbol'   => '₦',
			'overtime_minutes'  => 0,
			'shifts'            => 1,
			'horizon_days'      => 730,
			'transfer_batch'    => 'daily',
			'site_name'         => 'Production Planning',
		);
		$saved = get_option( 'pp_settings', array() );
		return array_merge( $defaults, is_array( $saved ) ? $saved : array() );
	}

	public static function save_settings( $settings ) {
		$current = self::settings();
		$merged  = array_merge( $current, $settings );
		update_option( 'pp_settings', $merged );
		return $merged;
	}

	public static function now() {
		return current_time( 'mysql' );
	}

	public static function today() {
		return current_time( 'Y-m-d' );
	}
}
