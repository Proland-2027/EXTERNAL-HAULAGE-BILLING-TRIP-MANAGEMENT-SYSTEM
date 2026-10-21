<?php
/**
 * WP-CLI: wp production-planning import <file> [--mode=initial|reimport]
 *         wp production-planning reforecast
 *         wp production-planning demo-users
 */
class PP_Cli {
	public function import( $args, $assoc ) {
		$path = $args[0] ?? PP_Seeder::bundled_workbook();
		$report = PP_Seeder::import_workbook( $path, $assoc['mode'] ?? 'reimport' );
		WP_CLI::success( 'Imported: ' . wp_json_encode( $report['counts'] ) . ' issues: ' . wp_json_encode( $report['issue_counts'] ) );
	}
	public function reforecast() {
		$r = PP_Planner::reforecast_all( 'cli' );
		WP_CLI::success( count( $r ) . ' plans re-forecast.' );
	}
	public function demo_users( $args, $assoc ) {
		$pw = $assoc['password'] ?? 'Demo#2026!';
		foreach ( PP_Demo::users() as $u ) {
			$id = PP_Demo::ensure_user( $u, $pw );
			WP_CLI::log( "{$u['login']} ({$u['role']}) -> user #$id" );
		}
		WP_CLI::success( 'Demo users ready. Password: ' . $pw );
	}
}
