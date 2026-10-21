<?php
/** Demo / test users for each role. */
class PP_Demo {
	public static function users() {
		return array(
			array( 'login' => 'sales.demo', 'name' => 'Sales Demo', 'role' => 'pp_sales', 'departments' => array() ),
			array( 'login' => 'planner.demo', 'name' => 'Planner Demo', 'role' => 'pp_planner', 'departments' => array() ),
			array( 'login' => 'supervisor.demo', 'name' => 'Supervisor Demo (all sections)', 'role' => 'pp_supervisor', 'departments' => array() ),
			array( 'login' => 'cutting.demo', 'name' => 'Cutting Supervisor Demo', 'role' => 'pp_supervisor', 'departments' => array( 'GB-CUT', 'IK-CUT' ) ),
			array( 'login' => 'manager.demo', 'name' => 'Production Manager Demo', 'role' => 'pp_manager', 'departments' => array() ),
			array( 'login' => 'costing.demo', 'name' => 'Costing Demo', 'role' => 'pp_costing', 'departments' => array() ),
		);
	}
	public static function ensure_user( $u, $password ) {
		$existing = get_user_by( 'login', $u['login'] );
		if ( $existing ) {
			$existing->set_role( $u['role'] );
			wp_set_password( $password, $existing->ID );
			$id = $existing->ID;
		} else {
			$id = wp_insert_user( array( 'user_login' => $u['login'], 'user_pass' => $password, 'display_name' => $u['name'], 'user_email' => $u['login'] . '@example.com', 'role' => $u['role'] ) );
		}
		update_user_meta( $id, 'pp_departments', $u['departments'] );
		return $id;
	}
	public static function create_all( $password ) {
		$out = array();
		foreach ( self::users() as $u ) {
			$out[] = array( 'login' => $u['login'], 'id' => self::ensure_user( $u, $password ), 'role' => $u['role'] );
		}
		return $out;
	}
}
