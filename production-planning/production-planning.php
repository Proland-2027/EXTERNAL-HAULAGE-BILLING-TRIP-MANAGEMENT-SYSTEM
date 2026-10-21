<?php
/**
 * Plugin Name: Production Planning
 * Description: Manufacturing planning, scheduling, work-in-progress tracking, productivity monitoring and BOM costing for Genset and Canopy assembly.
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: Production Planning Team
 * Text Domain: production-planning
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'PP_VERSION', '1.0.0' );
define( 'PP_DB_VERSION', '1.0.0' );
define( 'PP_PLUGIN_FILE', __FILE__ );
define( 'PP_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'PP_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'PP_APP_SLUG', 'production-planning' );

spl_autoload_register(
	function ( $class ) {
		if ( strpos( $class, 'PP_' ) !== 0 ) {
			return;
		}
		$file = PP_PLUGIN_DIR . 'includes/class-' . str_replace( '_', '-', strtolower( $class ) ) . '.php';
		if ( file_exists( $file ) ) {
			require_once $file;
		}
	}
);

register_activation_hook( __FILE__, array( 'PP_Install', 'activate' ) );

add_action( 'plugins_loaded', array( 'PP_Install', 'maybe_upgrade' ) );
add_action( 'init', array( 'PP_Frontend', 'init' ) );
add_action( 'rest_api_init', array( 'PP_Rest', 'register_routes' ) );
add_action( 'admin_menu', array( 'PP_Frontend', 'admin_menu' ) );
add_action( 'admin_bar_menu', array( 'PP_Frontend', 'admin_bar' ), 90 );
add_filter( 'login_redirect', array( 'PP_Frontend', 'login_redirect' ), 10, 3 );

// Daily automatic re-forecast of all confirmed plans (delay management).
add_action( 'pp_daily_reforecast', array( 'PP_Planner', 'reforecast_all' ) );
add_action(
	'init',
	function () {
		if ( ! wp_next_scheduled( 'pp_daily_reforecast' ) ) {
			wp_schedule_event( strtotime( 'tomorrow 05:00' ), 'daily', 'pp_daily_reforecast' );
		}
	}
);
register_deactivation_hook( __FILE__, function () { wp_clear_scheduled_hook( 'pp_daily_reforecast' ); } );

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command( 'production-planning', 'PP_Cli' );
}
