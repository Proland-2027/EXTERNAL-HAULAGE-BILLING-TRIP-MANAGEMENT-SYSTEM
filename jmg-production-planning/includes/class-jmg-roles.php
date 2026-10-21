<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Role based access.
 *
 * Capabilities:
 *  jmg_view   - open the application, dashboards, reports
 *  jmg_sales  - create / edit sales production requests
 *  jmg_plan   - generate schedules, confirm plans, replan
 *  jmg_track  - record daily production for assigned sections
 *  jmg_manage - approve rescheduling, acknowledge alerts, management reports
 *  jmg_cost   - maintain material prices, labour and processing rates
 *  jmg_admin  - masters, capacities, calendar, users, import, backup, settings
 */
class JMG_Roles {

	public static function roles() {
		return array(
			'jmg_sales'      => array( 'name' => 'Sales',              'caps' => array( 'jmg_view', 'jmg_sales' ) ),
			'jmg_planner'    => array( 'name' => 'Production Planner', 'caps' => array( 'jmg_view', 'jmg_sales', 'jmg_plan', 'jmg_track' ) ),
			'jmg_supervisor' => array( 'name' => 'Section Supervisor', 'caps' => array( 'jmg_view', 'jmg_track' ) ),
			'jmg_manager'    => array( 'name' => 'Production Manager', 'caps' => array( 'jmg_view', 'jmg_plan', 'jmg_track', 'jmg_manage' ) ),
			'jmg_costing'    => array( 'name' => 'Costing / Finance',  'caps' => array( 'jmg_view', 'jmg_cost' ) ),
		);
	}

	public static function all_caps() {
		return array( 'jmg_view', 'jmg_sales', 'jmg_plan', 'jmg_track', 'jmg_manage', 'jmg_cost', 'jmg_admin' );
	}

	public static function register() {
		foreach ( self::roles() as $slug => $def ) {
			if ( ! get_role( $slug ) ) {
				$caps = array( 'read' => true );
				foreach ( $def['caps'] as $c ) { $caps[ $c ] = true; }
				add_role( $slug, $def['name'], $caps );
			}
		}
	}

	public static function add_caps() {
		self::register();
		$admin = get_role( 'administrator' );
		if ( $admin ) {
			foreach ( self::all_caps() as $c ) { $admin->add_cap( $c ); }
		}
		foreach ( self::roles() as $slug => $def ) {
			$r = get_role( $slug );
			if ( $r ) { foreach ( $def['caps'] as $c ) { $r->add_cap( $c ); } }
		}
	}

	/** Capabilities of the current user as a flat list. */
	public static function current_caps() {
		$out = array();
		foreach ( self::all_caps() as $c ) {
			if ( current_user_can( $c ) ) { $out[] = $c; }
		}
		return $out;
	}

	public static function user_sections( $user_id ) {
		$v = get_user_meta( $user_id, 'jmg_sections', true );
		return is_array( $v ) ? array_map( 'intval', $v ) : array();
	}

	public static function role_label( $user ) {
		$labels = array();
		$roles = self::roles();
		foreach ( (array) $user->roles as $r ) {
			if ( 'administrator' === $r ) { $labels[] = 'Administrator'; }
			elseif ( isset( $roles[ $r ] ) ) { $labels[] = str_replace( 'JMG ', '', $roles[ $r ]['name'] ); }
		}
		return implode( ', ', $labels );
	}
}
