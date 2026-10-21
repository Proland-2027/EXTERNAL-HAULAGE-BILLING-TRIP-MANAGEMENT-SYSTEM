<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

class JMG_Audit {
	public static function log( $action, $entity = '', $entity_id = '', $details = null ) {
		global $wpdb;
		$user = wp_get_current_user();
		$wpdb->insert( JMG_DB::table( 'audit_log' ), array(
			'user_id'    => $user && $user->ID ? $user->ID : null,
			'user_login' => $user && $user->ID ? $user->user_login : 'system',
			'action'     => $action,
			'entity'     => $entity,
			'entity_id'  => (string) $entity_id,
			'details'    => null === $details ? null : wp_json_encode( $details ),
			'ip'         => isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '',
			'created_at' => JMG_DB::now(),
		) );
	}

	public static function recent( $limit = 200, $entity = '', $entity_id = '' ) {
		global $wpdb;
		$t = JMG_DB::table( 'audit_log' );
		$where = '1=1';
		$params = array();
		if ( $entity ) { $where .= ' AND entity=%s'; $params[] = $entity; }
		if ( $entity_id ) { $where .= ' AND entity_id=%s'; $params[] = (string) $entity_id; }
		$params[] = (int) $limit;
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE $where ORDER BY id DESC LIMIT %d", $params ), ARRAY_A );
	}
}
