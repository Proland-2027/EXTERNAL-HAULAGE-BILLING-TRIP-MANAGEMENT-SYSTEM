<?php
/**
 * Plugin Name: Production Planning
 * Description: Production planning and manufacturing control for Genset and Canopy manufacturing: sales demand, multi-level BOM explosion, finite-capacity scheduling, daily tracking, dashboards, BOM costing and Gantt.
 * Version: 1.1.0
 * Author: Production Planning Team
 * Requires PHP: 7.4
 * Requires at least: 6.0
 * Text Domain: jmg-pp
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'JMG_PP_VERSION', '1.1.0' );
define( 'JMG_PP_FILE', __FILE__ );
define( 'JMG_PP_DIR', plugin_dir_path( __FILE__ ) );
define( 'JMG_PP_URL', plugin_dir_url( __FILE__ ) );
define( 'JMG_PP_DB_VERSION', '1.1.0' );

foreach ( array(
	'class-jmg-db.php',
	'class-jmg-settings.php',
	'class-jmg-audit.php',
	'class-jmg-roles.php',
	'class-jmg-xlsx-reader.php',
	'class-jmg-importer.php',
	'class-jmg-calendar.php',
	'class-jmg-bom.php',
	'class-jmg-routing.php',
	'class-jmg-scheduler.php',
	'class-jmg-orders.php',
	'class-jmg-tracking.php',
	'class-jmg-inventory.php',
	'class-jmg-reports.php',
	'class-jmg-backup.php',
	'class-jmg-seed.php',
	'class-jmg-api.php',
	'class-jmg-app.php',
) as $f ) {
	require_once JMG_PP_DIR . 'includes/' . $f;
}

register_activation_hook( __FILE__, array( 'JMG_DB', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'JMG_App', 'deactivate' ) );

add_action( 'plugins_loaded', array( 'JMG_DB', 'maybe_upgrade' ) );
add_action( 'init', array( 'JMG_Roles', 'register' ) );
add_action( 'init', array( 'JMG_App', 'init' ) );
add_action( 'rest_api_init', array( 'JMG_API', 'register_routes' ) );
