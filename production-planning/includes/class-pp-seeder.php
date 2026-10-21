<?php
/**
 * Writes imported workbook data into the plugin tables.
 * Initial seeding replaces everything; re-imports refresh Excel-sourced rows and
 * keep rows/values the team maintained manually in the master-data screens.
 */
class PP_Seeder {

	public static function bundled_workbook() {
		return PP_PLUGIN_DIR . 'data/Production_Data.xlsx';
	}

	public static function seed_from_bundled_workbook() {
		$path = self::bundled_workbook();
		if ( ! file_exists( $path ) ) {
			return false;
		}
		try {
			return self::import_workbook( $path, 'initial' );
		} catch ( Exception $e ) {
			update_option( 'pp_import_error', $e->getMessage() );
			return false;
		}
	}

	/**
	 * @param string $path  Workbook file.
	 * @param string $mode  'initial' | 'reimport'
	 */
	public static function import_workbook( $path, $mode = 'reimport' ) {
		@set_time_limit( 600 );
		@ini_set( 'memory_limit', '512M' );
		$importer = new PP_Workbook_Importer();
		$data     = $importer->import( $path );
		self::apply( $data, $mode );
		$report                 = $data['quality_report'];
		$report['mode']         = $mode;
		$report['imported_at']  = current_time( 'mysql' );
		$report['imported_by']  = wp_get_current_user()->user_login ?: 'system';
		update_option( 'pp_quality_report', $report, false );
		update_option( 'pp_last_import', $report['imported_at'] );
		PP_Db::audit( 'import_workbook', 'master_data', basename( $path ), array( 'mode' => $mode, 'counts' => $report['counts'], 'issue_counts' => $report['issue_counts'] ) );
		return $report;
	}

	public static function apply( $data, $mode ) {
		global $wpdb;
		$initial = ( 'initial' === $mode );

		// ---- Products
		$existing = array();
		if ( ! $initial ) {
			foreach ( PP_Db::rows( 'SELECT code, source, product_type, family, canopy_size, sellable, active, stock_qty, notes FROM ' . PP_Db::t( 'products' ) ) as $r ) {
				$existing[ $r['code'] ] = $r;
			}
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'products' ) . " WHERE source = 'excel'" );
		} else {
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'products' ) );
		}
		$rows = array();
		$now  = current_time( 'mysql' );
		foreach ( $data['products'] as $p ) {
			if ( isset( $existing[ $p['code'] ] ) && 'manual' === $existing[ $p['code'] ]['source'] ) {
				continue; // manually created product with the same code wins
			}
			$row = array(
				'code' => $p['code'], 'description' => mb_substr( $p['description'], 0, 255 ), 'kind' => $p['kind'],
				'product_type' => $p['product_type'], 'family' => $p['family'], 'canopy_size' => $p['canopy_size'],
				'uom' => $p['uom'], 'std_cost' => $p['std_cost'], 'cost_group' => $p['cost_group'], 'type1' => $p['type1'],
				'warehouse' => $p['warehouse'], 'is_finished' => (int) $p['is_finished'], 'sellable' => (int) $p['sellable'],
				'active' => 1, 'stock_qty' => 0, 'source' => 'excel', 'notes' => null, 'updated_at' => $now,
			);
			if ( isset( $existing[ $p['code'] ] ) ) {
				$e = $existing[ $p['code'] ];
				// keep team-maintained classification and stock
				foreach ( array( 'product_type', 'family', 'canopy_size', 'sellable', 'active', 'stock_qty', 'notes' ) as $k ) {
					if ( null !== $e[ $k ] && '' !== $e[ $k ] ) {
						$row[ $k ] = $e[ $k ];
					}
				}
			}
			$rows[] = $row;
		}
		PP_Db::bulk_insert( 'products', $rows );

		// ---- BOM / routings / overheads / resources
		foreach ( array( 'bom_lines', 'routings' ) as $tbl ) {
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( $tbl ) . ( $initial ? '' : " WHERE source = 'excel'" ) );
		}
		PP_Db::bulk_insert( 'bom_lines', $data['bom_lines'] );
		PP_Db::bulk_insert( 'routings', $data['routings'] );
		PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'overheads' ) );
		PP_Db::bulk_insert( 'overheads', $data['overheads'] );

		$res_existing = array();
		if ( ! $initial ) {
			foreach ( PP_Db::rows( 'SELECT code, department_code FROM ' . PP_Db::t( 'resources' ) ) as $r ) {
				$res_existing[ $r['code'] ] = $r['department_code'];
			}
		}
		PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'resources' ) );
		$rows = array();
		foreach ( $data['resources'] as $r ) {
			if ( isset( $res_existing[ $r['code'] ] ) && $res_existing[ $r['code'] ] ) {
				$r['department_code'] = $res_existing[ $r['code'] ];
			}
			$rows[] = $r;
		}
		PP_Db::bulk_insert( 'resources', $rows );

		// ---- Material prices (keep manual prices)
		$manual = array();
		if ( ! $initial ) {
			foreach ( PP_Db::rows( 'SELECT material_code FROM ' . PP_Db::t( 'material_prices' ) . " WHERE source = 'manual'" ) as $r ) {
				$manual[ $r['material_code'] ] = true;
			}
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'material_prices' ) . " WHERE source <> 'manual'" );
		} else {
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'material_prices' ) );
		}
		$rows = array();
		foreach ( $data['material_prices'] as $m ) {
			if ( isset( $manual[ $m['material_code'] ] ) ) {
				continue;
			}
			$m['currency']   = 'NGN';
			$m['updated_by'] = 'import';
			$m['updated_at'] = $now;
			$rows[]          = $m;
		}
		PP_Db::bulk_insert( 'material_prices', $rows );

		// ---- Departments (keep manual manpower edits)
		$dept_existing = array();
		foreach ( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'departments' ) ) as $r ) {
			$dept_existing[ $r['code'] ] = $r;
		}
		foreach ( $data['departments'] as $d ) {
			if ( isset( $dept_existing[ $d['code'] ] ) ) {
				$e   = $dept_existing[ $d['code'] ];
				$upd = array( 'name' => $e['name'], 'site' => $d['site'], 'stage' => $e['stage'], 'stage_order' => $e['stage_order'] );
				if ( 0 !== strpos( (string) $e['manpower_source'], 'manual' ) ) {
					$upd['manpower']        = $d['manpower'];
					$upd['manpower_source'] = $d['manpower_source'];
				}
				PP_Db::update( 'departments', $upd, array( 'code' => $d['code'] ) );
			} else {
				$d['active'] = 1;
				PP_Db::insert( 'departments', $d );
			}
		}

		// ---- Capacities, machines, history (Excel-sourced; manual rows have source 'manual')
		PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'capacities' ) . " WHERE source IS NULL OR source NOT LIKE 'manual%'" );
		PP_Db::bulk_insert( 'capacities', $data['capacities'] );
		PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'machine_capacities' ) . " WHERE source IS NULL OR source NOT LIKE 'manual%'" );
		PP_Db::bulk_insert( 'machine_capacities', $data['machine_capacities'] );
		PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'cutting_files' ) );
		PP_Db::bulk_insert( 'cutting_files', $data['cutting_files'] );
		PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'productivity_history' ) );
		PP_Db::bulk_insert( 'productivity_history', $data['productivity_history'] );
		$mach_existing = array();
		foreach ( PP_Db::rows( 'SELECT code FROM ' . PP_Db::t( 'machines' ) ) as $r ) {
			$mach_existing[ $r['code'] ] = true;
		}
		foreach ( $data['machines'] as $m ) {
			if ( ! isset( $mach_existing[ $m['code'] ] ) ) {
				PP_Db::insert( 'machines', $m );
			}
		}
		wp_cache_flush();
	}
}
