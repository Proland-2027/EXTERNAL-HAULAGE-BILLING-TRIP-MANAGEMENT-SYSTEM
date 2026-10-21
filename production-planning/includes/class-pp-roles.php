<?php
/**
 * Roles and capabilities.
 */
class PP_Roles {

	const CAPS = array(
		'pp_view'          => 'View production planning screens',
		'pp_sales'         => 'Submit sales demand',
		'pp_plan'          => 'Generate / confirm production plans, reschedule',
		'pp_supervise'     => 'Record production, downtime, transfers',
		'pp_manage'        => 'Approve changes, manage bottlenecks',
		'pp_cost'          => 'Maintain material prices, review costs',
		'pp_admin'         => 'Maintain master data, calendars, imports, users',
	);

	const ROLES = array(
		'pp_sales'      => array( 'Sales', array( 'pp_view', 'pp_sales' ) ),
		'pp_planner'    => array( 'Production Planner', array( 'pp_view', 'pp_sales', 'pp_plan' ) ),
		'pp_supervisor' => array( 'Department Supervisor', array( 'pp_view', 'pp_supervise' ) ),
		'pp_manager'    => array( 'Production Manager', array( 'pp_view', 'pp_sales', 'pp_plan', 'pp_supervise', 'pp_manage' ) ),
		'pp_costing'    => array( 'Costing / Finance', array( 'pp_view', 'pp_cost' ) ),
	);

	public static function install() {
		foreach ( self::ROLES as $slug => $def ) {
			remove_role( $slug );
			$caps = array( 'read' => true );
			foreach ( $def[1] as $c ) {
				$caps[ $c ] = true;
			}
			add_role( $slug, $def[0], $caps );
		}
		$admin = get_role( 'administrator' );
		if ( $admin ) {
			foreach ( array_keys( self::CAPS ) as $c ) {
				$admin->add_cap( $c );
			}
		}
	}

	public static function user_caps( $user = null ) {
		$user = $user ?: wp_get_current_user();
		$out  = array();
		foreach ( array_keys( self::CAPS ) as $c ) {
			$out[ $c ] = user_can( $user, $c );
		}
		return $out;
	}

	public static function role_label( $user ) {
		$labels = array();
		foreach ( (array) $user->roles as $r ) {
			if ( isset( self::ROLES[ $r ] ) ) {
				$labels[] = self::ROLES[ $r ][0];
			} elseif ( 'administrator' === $r ) {
				$labels[] = 'Administrator';
			} else {
				$labels[] = ucfirst( $r );
			}
		}
		return implode( ', ', $labels );
	}

	/** Departments a supervisor is assigned to (empty = all). */
	public static function user_departments( $user_id ) {
		$v = get_user_meta( $user_id, 'pp_departments', true );
		return is_array( $v ) ? $v : array();
	}
}
