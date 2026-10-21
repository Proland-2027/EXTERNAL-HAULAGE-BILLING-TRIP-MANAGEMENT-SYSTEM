<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Imports the JMG production workbook (Prodction Data.xlsx) into the plugin tables.
 *
 * Sheets used:
 *  - BOM                : multi-level bill of materials (products, components, quantities, costs, process hours)
 *  - Finished Product   : list of sellable finished product codes
 *  - Canopy Assembly    : Gbagada canopy / soundproofing sections, manpower and productivity
 *  - Genset Assembly    : Ikotun base / panel / genset sections, manpower and productivity
 *  - Cutting Capacity   : Punch 1 / Punch 2 / Plasma minutes per canopy series
 *  - Capacity S1..S4, Capacity200, Capacity500 : nesting-file level cutting times (reference)
 *
 * Nothing is invented: rows without a usable figure are imported as NULL and flagged in jmg_data_issues.
 */
class JMG_Importer {

	private $issues = array();
	private $summary = array();

	/** Import a workbook. $mode = 'full' (replace master data) */
	public function import_workbook( $path, $mode = 'full' ) {
		global $wpdb;
		@set_time_limit( 600 );
		@ini_set( 'memory_limit', '512M' );
		$reader = new JMG_Xlsx_Reader( $path );
		$required = array( 'BOM', 'Finished Product', 'Canopy Assembly', 'Genset Assembly', 'Cutting Capacity' );
		foreach ( $required as $s ) {
			if ( ! $reader->has_sheet( $s ) ) { throw new Exception( 'Required worksheet missing: ' . $s ); }
		}

		$this->issues = array();
		$this->summary = array();

		// Clear master tables (operational tables keep their data).
		foreach ( array( 'products', 'bom_lines', 'sections', 'capacities', 'machine_times', 'cutting_files', 'data_issues' ) as $t ) {
			$wpdb->query( 'DELETE FROM ' . JMG_DB::table( $t ) );
		}
		// Prices: keep manual edits, refresh excel sourced ones.
		$wpdb->query( 'DELETE FROM ' . JMG_DB::table( 'prices' ) . " WHERE source IN ('excel','derived')" );

		$this->import_series();
		$finished = $this->import_finished_list( $reader );
		$this->import_bom( $reader, $finished );
		$this->import_capacity_sheet( $reader, 'Canopy Assembly', 'Gbagada', 'canopy' );
		$this->import_capacity_sheet( $reader, 'Genset Assembly', 'Ikotun', 'genset' );
		$this->import_cutting_capacity( $reader );
		foreach ( array( 'Capacity S1' => 'S1', 'Capacity S2' => 'S2', 'CapacityS3' => 'S3', 'CapacityS4' => 'S4', 'Capacity200' => '200-250', 'Capacity500' => '350-500' ) as $sheet => $series ) {
			if ( $reader->has_sheet( $sheet ) ) { $this->import_cutting_files( $reader, $sheet, $series ); }
		}
		$this->install_stage_map();
		$this->flush_issues();
		$reader->close();

		$wpdb->insert( JMG_DB::table( 'import_log' ), array(
			'file_name'  => basename( $path ),
			'mode'       => $mode,
			'summary'    => wp_json_encode( $this->summary ),
			'created_by' => get_current_user_id(),
			'created_at' => JMG_DB::now(),
		) );
		if ( function_exists( 'wp_get_current_user' ) ) { JMG_Audit::log( 'import_workbook', 'import', basename( $path ), $this->summary ); }
		return $this->summary;
	}

	private function issue( $type, $code, $msg ) {
		$key = $type . '|' . $code . '|' . $msg;
		$this->issues[ $key ] = array( 'issue_type' => $type, 'ref_code' => (string) $code, 'message' => $msg, 'is_resolved' => 0, 'created_at' => JMG_DB::now() );
	}

	private function flush_issues() {
		JMG_DB::bulk_insert( 'data_issues', array_values( $this->issues ) );
		$this->summary['data_issues'] = count( $this->issues );
	}

	/* ------------------------------------------------------------------ */
	/* Series dictionary                                                    */
	/* ------------------------------------------------------------------ */

	/**
	 * Series keys used to connect BOM component codes, Excel capacity rows and canopy cutting series.
	 * kVA bands are a planning assumption (editable in Masters > Series) derived from the workbook codes:
	 *  e.g. SPGP22 uses BASE-400SRS / CPNL-400SRS, SPGP65 uses OPT-BASE-S2, SPGP110 uses BASE-S3-OPT.
	 */
	public static function default_series() {
		return array(
			array( 'LST',       'Lister',             'genset', null, null, 'LST',        'LST,LISTER,LST_MTN' ),
			array( '400SRS',    '400 Series (P13-P25)', 'genset', 13,  25,   '400-SERIES', '400SRS,400SR,400-SERIES,400SERIES,EM16-20,EY18-22' ),
			array( 'S1',        'S1 (P33)',           'genset', 26,  39,   'S1',         'S1,F1' ),
			array( 'S2',        'S2 (P46-P97)',       'genset', 40,  97,   'S2',         'S2,F2,S2-P88' ),
			array( 'S3',        'S3 (P110)',          'genset', 98,  125,  'S3',         'S3' ),
			array( 'S4',        'S4 (P138-P165)',     'genset', 126, 175,  'S4',         'S4' ),
			array( 'P200/P250', 'P200-P275',          'genset', 176, 299,  '200-250',    'P200/P250,P200,P220,P250,P275,200-220,200/220,220/275,220-275,200-250,220/800,1300SRS' ),
			array( 'P350',      'P330-P400',          'genset', 300, 450,  '350-500',    'P350,P330,P400,350-500,P350/800,P350/500' ),
			array( 'P550',      'P500-P550',          'genset', 451, 600,  '350-500',    'P550,P500' ),
			array( 'P800',      'P600-P800',          'genset', 601, 900,  '350-500',    'P800,P700,P600' ),
		);
	}

	private function import_series() {
		global $wpdb;
		$t = JMG_DB::table( 'series' );
		$existing = (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t" );
		if ( $existing > 0 ) { return; } // keep administrator edits
		$rows = array();
		foreach ( self::default_series() as $s ) {
			$rows[] = array( 'series_key' => $s[0], 'label' => $s[1], 'family' => $s[2], 'kva_min' => $s[3], 'kva_max' => $s[4], 'canopy_cut_series' => $s[5], 'aliases' => $s[6] );
		}
		JMG_DB::bulk_insert( 'series', $rows );
	}

	/* ------------------------------------------------------------------ */
	/* Finished products + BOM                                               */
	/* ------------------------------------------------------------------ */

	private function import_finished_list( $reader ) {
		$rows = $reader->rows( 'Finished Product', 1 );
		$codes = array();
		foreach ( $rows as $n => $r ) {
			if ( 1 === $n ) { continue; }
			$c = trim( (string) ( $r[1] ?? '' ) );
			if ( '' !== $c && strtolower( $c ) !== 'item number' ) { $codes[ $c ] = true; }
		}
		$this->summary['finished_product_list'] = count( $codes );
		return $codes;
	}

	public static function clean_code( $v ) {
		$v = (string) $v;
		$v = str_replace( "\xc2\xa0", ' ', $v );
		return trim( $v );
	}

	/** kVA only when the code carries an explicit model prefix (P22, EY110, EM16, P150/165). */
	public static function kva_from_component_code( $code ) {
		$c = strtoupper( self::clean_code( $code ) );
		if ( preg_match( '/(?<![A-Z0-9])(?:P|EY|EM)(\d{2,4}(?:\.\d)?)(?![0-9])/', $c, $m ) ) {
			$n = (float) $m[1];
			if ( $n >= 13 && $n <= 2500 ) { return $n; }
		}
		return null;
	}

	/** Extract a kVA model number from a product code (SPGP22 -> 22, SPGEY110 -> 110, MSPGP65 -> 65). */
	public static function kva_from_code( $code ) {
		$c = strtoupper( self::clean_code( $code ) );
		if ( preg_match( '/(?:P|EY|EM|M|SPG|GP)(\d{2,4}(?:\.\d)?)(?![0-9])/', $c, $m ) ) {
			$n = (float) $m[1];
			if ( $n >= 13 && $n <= 2500 ) { return $n; }
		}
		if ( preg_match( '/(?<![0-9])(\d{2,4}(?:\.\d)?)(?![0-9])/', $c, $m ) ) {
			$n = (float) $m[1];
			if ( $n >= 13 && $n <= 2500 && false === strpos( $c, '400SRS' ) ) { return $n; }
		}
		return null;
	}

	private function import_bom( $reader, $finished ) {
		$rows = $reader->rows( 'BOM', 29 );
		$hdr = array();
		foreach ( $rows[1] as $col => $name ) { $hdr[ strtolower( trim( (string) $name ) ) ] = $col; }
		$need = array( 'item number', 'item/resource', 'parent bom', 'product name', 'calculation type', 'level', 'line number', 'consumption per lot size' );
		foreach ( $need as $n ) {
			if ( ! isset( $hdr[ $n ] ) ) { throw new Exception( 'BOM sheet column missing: ' . $n ); }
		}
		$col = function( $r, $name ) use ( $hdr ) {
			$name = strtolower( $name );
			return isset( $hdr[ $name ], $r[ $hdr[ $name ] ] ) ? $r[ $hdr[ $name ] ] : null;
		};
		// Column 25 ("Unit Cost") and 26 ("Total Cost") and 29 ("Unit Cost" rate) are positional in the workbook.
		$products = array();
		$lines = array();
		$prices = array(); // code => array(cost => count)
		$rates = array();
		$roots = array();
		$n = 0;
		foreach ( $rows as $rn => $r ) {
			if ( 1 === $rn ) { continue; }
			$fin = self::clean_code( $col( $r, 'item number' ) );
			$comp = self::clean_code( $col( $r, 'item/resource' ) );
			if ( '' === $fin || '' === $comp ) { continue; }
			$parent = self::clean_code( $col( $r, 'parent bom' ) );
			$calc = trim( (string) $col( $r, 'calculation type' ) );
			$level = (int) $col( $r, 'level' );
			$qty = (float) $col( $r, 'consumption per lot size' );
			$lot = (float) $col( $r, 'lot size qty' );
			if ( $lot > 0 && 1.0 !== $lot ) { $qty = $qty / $lot; }
			$desc = trim( (string) $col( $r, 'product name' ) );
			$unit = trim( (string) $col( $r, 'unit' ) );
			$type1 = trim( (string) $col( $r, 'type 1' ) );
			$type3 = trim( (string) $col( $r, 'type 3' ) );
			$cg = trim( (string) $col( $r, 'cost group' ) );
			$wh = trim( (string) $col( $r, 'warehouse' ) );
			$op = trim( (string) $col( $r, 'operation' ) );
			$erp_cpu = isset( $r[18] ) ? (float) $r[18] : null;
			$ucost = isset( $r[25] ) && is_numeric( $r[25] ) ? (float) $r[25] : null;
			$lcost = isset( $r[26] ) && is_numeric( $r[26] ) ? (float) $r[26] : null;
			$rate = isset( $r[29] ) && is_numeric( $r[29] ) ? (float) $r[29] : null;
			$type2 = trim( (string) $col( $r, 'type 2' ) );
			$model = trim( (string) $col( $r, 'model' ) );

			if ( 0 === $level || '' === $parent ) { $parent = $fin; }
			$lines[] = array(
				'finished_code' => $fin, 'parent_code' => $parent, 'component_code' => $comp, 'description' => mb_substr( $desc, 0, 255 ),
				'level' => $level, 'line_no' => (int) $col( $r, 'line number' ), 'qty' => $qty, 'unit' => $unit, 'calc_type' => $calc,
				'type1' => $type1, 'type2' => '0' === $type2 ? '' : $type2, 'model' => '0' === $model ? '' : $model, 'type3' => $type3, 'cost_group' => $cg, 'operation' => $op, 'warehouse' => $wh,
				'erp_cost_per_unit' => $erp_cpu, 'unit_cost' => $ucost, 'line_cost' => $lcost, 'rate' => $rate,
			);
			if ( 0 === $level ) {
				$roots[ $fin ] = array( 'desc' => $desc, 'type2' => $type2, 'model' => $model, 'unit' => $unit, 'cg' => $cg, 'wh' => $wh );
			}
			// product master entries
			if ( ! isset( $products[ $comp ] ) ) {
				$products[ $comp ] = array( 'code' => $comp, 'description' => mb_substr( $desc, 0, 255 ), 'item_type' => $this->item_type( $calc, $type1 ), 'unit' => $unit, 'cost_group' => $cg, 'warehouse' => $wh );
			} elseif ( 'BOM' === $calc && 'ASSEMBLY' !== $products[ $comp ]['item_type'] ) {
				$products[ $comp ]['item_type'] = 'ASSEMBLY';
			}
			// prices / rates
			if ( 'Item' === $calc && 'STATUS ITEM' !== $type1 ) {
				if ( null !== $ucost && $ucost > 0 ) {
					$k = (string) round( $ucost, 4 );
					$prices[ $comp ]['vals'][ $k ] = ( $prices[ $comp ]['vals'][ $k ] ?? 0 ) + 1;
				} elseif ( $qty > 0 && $erp_cpu ) {
					$prices[ $comp ]['derived'][] = $erp_cpu / $qty;
				}
				$prices[ $comp ]['desc'] = $desc; $prices[ $comp ]['unit'] = $unit; $prices[ $comp ]['cg'] = $cg;
			} elseif ( in_array( $calc, array( 'Process', 'Rate' ), true ) && null !== $rate && $rate > 0 ) {
				$k = (string) round( $rate, 4 );
				$rates[ $comp ]['vals'][ $k ] = ( $rates[ $comp ]['vals'][ $k ] ?? 0 ) + 1;
				$rates[ $comp ]['desc'] = $desc; $rates[ $comp ]['type'] = $this->rate_type( $calc, $type3 ); $rates[ $comp ]['cg'] = $cg;
			}
			$n++;
		}
		$this->summary['bom_lines'] = $n;

		// Products: roots are plannable products.
		foreach ( $roots as $code => $info ) {
			$cat = $this->category_from( $code, $info['type2'], $info['model'], $info['cg'] );
			$products[ $code ] = array(
				'code' => $code, 'description' => mb_substr( $info['desc'], 0, 255 ), 'item_type' => isset( $finished[ $code ] ) ? 'FINISHED' : 'ASSEMBLY',
				'unit' => $info['unit'], 'cost_group' => $info['cg'], 'warehouse' => $info['wh'],
				'category' => $cat, 'model_kva' => self::kva_from_code( $code ), 'is_finished' => 1,
			);
		}
		foreach ( $finished as $code => $_ ) {
			if ( ! isset( $roots[ $code ] ) ) {
				$this->issue( 'bom_missing', $code, 'Finished product listed in "Finished Product" sheet has no BOM rows.' );
				$products[ $code ] = array( 'code' => $code, 'description' => '', 'item_type' => 'FINISHED', 'unit' => 'PCS', 'cost_group' => '', 'warehouse' => '', 'category' => $this->category_from( $code, '', '', '' ), 'model_kva' => self::kva_from_code( $code ), 'is_finished' => 1 );
			}
		}
		$prow = array();
		foreach ( $products as $code => $p ) {
			$prow[] = array(
				'code' => $code, 'description' => $p['description'], 'item_type' => $p['item_type'], 'category' => $p['category'] ?? '',
				'unit' => $p['unit'], 'cost_group' => $p['cost_group'], 'warehouse' => $p['warehouse'], 'model_kva' => $p['model_kva'] ?? null,
				'series_key' => $this->series_from_code( $code ), 'is_finished' => $p['is_finished'] ?? 0, 'is_active' => 1, 'source' => 'excel',
			);
		}
		$this->summary['products'] = JMG_DB::bulk_insert( 'products', $prow );
		$this->summary['finished_products'] = count( $roots );
		JMG_DB::bulk_insert( 'bom_lines', $lines, 300 );

		// BOM sub-assemblies without child rows
		$has_children = array();
		foreach ( $lines as $l ) { $has_children[ $l['finished_code'] . '|' . $l['parent_code'] ] = true; }
		foreach ( $lines as $l ) {
			if ( 'BOM' === $l['calc_type'] && ! isset( $has_children[ $l['finished_code'] . '|' . $l['component_code'] ] ) ) {
				$this->issue( 'bom_incomplete', $l['finished_code'], 'Sub-assembly ' . $l['component_code'] . ' (' . $l['description'] . ') has no component rows in the workbook; its materials and operations are unknown.' );
			}
		}

		// Prices
		$price_rows = array();
		foreach ( $prices as $code => $p ) {
			$row = array( 'code' => $code, 'description' => mb_substr( (string) $p['desc'], 0, 255 ), 'price_type' => 'material', 'unit' => $p['unit'] ?? '', 'cost_group' => $p['cg'] ?? '', 'unit_cost' => null, 'source' => 'excel', 'conflict_note' => '', 'updated_at' => JMG_DB::now() );
			if ( ! empty( $p['vals'] ) ) {
				arsort( $p['vals'] );
				$row['unit_cost'] = (float) array_key_first( $p['vals'] );
				if ( count( $p['vals'] ) > 1 ) {
					$row['conflict_note'] = 'Workbook lists ' . count( $p['vals'] ) . ' different unit costs: ' . implode( ', ', array_slice( array_keys( $p['vals'] ), 0, 4 ) ) . '. Most frequent value used.';
				}
			} elseif ( ! empty( $p['derived'] ) ) {
				$row['unit_cost'] = round( array_sum( $p['derived'] ) / count( $p['derived'] ), 4 );
				$row['source'] = 'derived';
				$row['conflict_note'] = 'No unit cost column value; derived from ERP line cost / quantity. Please verify.';
				$this->issue( 'price_derived', $code, 'Unit cost derived from ERP line cost for ' . $p['desc'] . '; verify in price master.' );
			} else {
				$this->issue( 'price_missing', $code, 'No unit cost in workbook for ' . $p['desc'] . ' (Cost Pending).' );
			}
			$price_rows[] = $row;
		}
		foreach ( $rates as $code => $p ) {
			arsort( $p['vals'] );
			$price_rows[] = array( 'code' => $code, 'description' => mb_substr( (string) $p['desc'], 0, 255 ), 'price_type' => $p['type'], 'unit' => 'HR', 'cost_group' => $p['cg'] ?? '', 'unit_cost' => (float) array_key_first( $p['vals'] ), 'source' => 'excel', 'conflict_note' => count( $p['vals'] ) > 1 ? 'Workbook lists ' . count( $p['vals'] ) . ' different rates; most frequent used.' : '', 'updated_at' => JMG_DB::now() );
		}
		// keep manually maintained prices
		global $wpdb;
		$manual = $wpdb->get_col( 'SELECT code FROM ' . JMG_DB::table( 'prices' ) );
		$manual = array_flip( $manual );
		$price_rows = array_values( array_filter( $price_rows, function( $r ) use ( $manual ) { return ! isset( $manual[ $r['code'] ] ); } ) );
		$this->summary['prices'] = JMG_DB::bulk_insert( 'prices', $price_rows );
	}

	private function item_type( $calc, $type1 ) {
		if ( 'STATUS ITEM' === $type1 ) { return 'STATUS'; }
		switch ( $calc ) {
			case 'BOM': case 'Production': return 'ASSEMBLY';
			case 'Process': return 'RESOURCE';
			case 'Rate': case 'Output unit based': return 'OVERHEAD';
			default: return 'MATERIAL';
		}
	}

	private function rate_type( $calc, $type3 ) {
		if ( 'MCH OVH' === $type3 ) { return 'machine'; }
		if ( 'LBR DIR' === $type3 ) { return 'labor'; }
		return 'overhead';
	}

	private function category_from( $code, $type2, $model, $cg ) {
		$c = strtoupper( $code );
		if ( 'SF-CANOPY' === $cg && 0 === strpos( $c, 'SPF' ) ) { return 'Canopy'; }
		if ( in_array( strtoupper( $type2 ), array( 'STACKED' ), true ) || 'FLAT-PACK' === strtoupper( $model ) ) { return 'Canopy'; }
		if ( 'FUEL TANKS' === strtoupper( $type2 ) || 0 === strpos( $c, 'DTK' ) ) { return 'Tank'; }
		if ( 0 === strpos( $c, 'SPF' ) ) { return 'Canopy'; }
		return 'Genset';
	}

	/** Series token contained in a code (S1..S4, 400SRS, LST, P200/P250 ...). */
	public static function series_from_code( $code ) {
		$c = strtoupper( self::clean_code( $code ) );
		if ( preg_match( '/400\s*-?\s*S(?:ERIES|RS?)/', $c ) ) { return '400SRS'; }
		if ( preg_match( '/1300SRS/', $c ) ) { return 'P200/P250'; }
		if ( preg_match( '/(?<![A-Z0-9])LST|LISTER/', $c ) ) { return 'LST'; }
		if ( preg_match( '/(?<![A-Z0-9])S([1-4])(?:\/S([1-4]))?(?![0-9])/', $c, $m ) ) { return isset( $m[2] ) ? 'S' . $m[1] . ',S' . $m[2] : 'S' . $m[1]; }
		if ( preg_match( '/(?<![A-Z0-9])F([12])(?![0-9])/', $c, $m ) ) { return 'S' . $m[1]; }
		if ( preg_match( '/EM16-20|EY18-22/', $c ) ) { return '400SRS'; }
		return '';
	}

	/* ------------------------------------------------------------------ */
	/* Capacity sheets                                                       */
	/* ------------------------------------------------------------------ */

	private function import_capacity_sheet( $reader, $sheet, $site, $family ) {
		global $wpdb;
		$rows = $reader->rows( $sheet, 13 );
		$blocks = array();
		$bi = -1;
		$last_row = 0;
		foreach ( $rows as $rn => $r ) {
			$c1 = strtolower( trim( (string) ( $r[1] ?? '' ) ) );
			$c2 = strtolower( trim( (string) ( $r[2] ?? '' ) ) );
			$is_header = ( in_array( $c1, array( 'type', 'finished code' ), true ) && in_array( $c2, array( 'department', 'type' ), true ) );
			if ( $is_header ) {
				$blocks[] = array( 'header' => $r, 'rows' => array(), 'row' => $rn );
				$bi = count( $blocks ) - 1;
				$last_row = $rn;
				continue;
			}
			if ( $bi < 0 ) { continue; }
			if ( ! isset( $r[1] ) || '' === trim( (string) $r[1] ) ) { continue; } // sub-total rows
			if ( $rn - $last_row > 3 ) { $bi = -1; continue; }
			$blocks[ $bi ]['rows'][ $rn ] = $r;
			$last_row = $rn;
		}

		$sections_done = array();
		$n_sections = 0; $n_rows = 0;
		foreach ( $blocks as $b ) {
			$h = $b['header'];
			$is_genset = ( 'genset' === $family );
			$dept_in_col2 = ( 'department' === strtolower( trim( (string) ( $h[2] ?? '' ) ) ) );
			// Column layout
			if ( $is_genset ) {
				$ix = array( 'code' => 1, 'section' => $dept_in_col2 ? 3 : 2, 'dept' => $dept_in_col2 ? 2 : null, 'wh' => $dept_in_col2 ? null : 3, 'per' => 4, 'staffs' => 5, 'lines' => 6, 'prod' => 7, 'avail' => 8, 'keep' => 9, 'idle' => 10, 'new_staffs' => 11, 'flow' => 12, 'newprod' => 13 );
				$prod_header = trim( (string) ( $h[7] ?? 'Total Productivity' ) );
				$per_header = trim( (string) ( $h[4] ?? 'Productivity' ) );
			} else {
				$ix = array( 'code' => 1, 'dept' => 2, 'section' => 3, 'wh' => null, 'per' => 4, 'staffs' => 5, 'lines' => null, 'prod' => 6, 'avail' => 7, 'keep' => 8, 'idle' => 9, 'new_staffs' => 10, 'flow' => 11, 'newprod' => 12 );
				$prod_header = trim( (string) ( $h[6] ?? 'Productivity' ) );
				$per_header = trim( (string) ( $h[4] ?? 'Productivity' ) );
			}
			$excel_shifts = preg_match( '/2\s*shift/i', $prod_header ) ? 2 : 1;
			$first = true;
			$block_meta = array();
			foreach ( $b['rows'] as $rn => $r ) {
				$code = self::clean_code( $r[ $ix['code'] ] ?? '' );
				$section_name = self::clean_code( $r[ $ix['section'] ] ?? '' );
				$dept = $ix['dept'] ? self::clean_code( $r[ $ix['dept'] ] ?? '' ) : '';
				if ( $is_genset && '' === $dept ) {
					$parts = preg_split( '/_/', $section_name, 2 );
					$dept = count( $parts ) > 1 ? trim( $parts[0] ) : $this->genset_dept( $section_name );
				}
				if ( '' === $section_name ) { continue; }
				$wh = $ix['wh'] ? self::clean_code( $r[ $ix['wh'] ] ?? '' ) : '';
				$skey = $sheet . '|' . $dept . '|' . $section_name;
				if ( $first ) {
					$block_meta = array(
						'staffs' => $this->num( $r[ $ix['staffs'] ] ?? null ),
						'avail' => $this->num( $r[ $ix['avail'] ] ?? null ), 'keep' => $this->num( $r[ $ix['keep'] ] ?? null ), 'idle' => $this->num( $r[ $ix['idle'] ] ?? null ),
						'new_staffs' => $this->num( $r[ $ix['new_staffs'] ] ?? null ), 'flow' => $this->num( $r[ $ix['flow'] ] ?? null ),
					);
					$first = false;
				}
				if ( ! isset( $sections_done[ $skey ] ) ) {
					$stage = $this->stage_for_section( $family, $dept, $section_name );
					$wpdb->insert( JMG_DB::table( 'sections' ), array(
						'site' => $site, 'sheet_source' => $sheet, 'department' => $dept, 'section_name' => $section_name . ( $wh ? '' : '' ),
						'stage_key' => $stage, 'resource_kind' => 'section', 'productivity_header' => $prod_header . ' / ' . $per_header,
						'excel_shifts' => $excel_shifts,
						'staffs' => $this->num( $r[ $ix['staffs'] ] ?? null ) ?? $block_meta['staffs'],
						'total_available_staffs' => $block_meta['avail'], 'staffs_to_keep' => $block_meta['keep'], 'staff_idle' => $block_meta['idle'],
						'new_staffs' => $block_meta['new_staffs'], 'flow_lines' => $block_meta['flow'],
						'machines' => 1, 'minutes_per_day' => 480, 'is_active' => 1,
						'notes' => ( $wh ? 'Warehouse ' . $wh . '. ' : '' ) . 'Imported from sheet "' . $sheet . '" row ' . $rn . '.',
					) );
					$sections_done[ $skey ] = (int) $wpdb->insert_id;
					$n_sections++;
				}
				$sid = $sections_done[ $skey ];
				$prod = $this->num( $r[ $ix['prod'] ] ?? null );
				$newprod = $this->num( $r[ $ix['newprod'] ] ?? null );
				$per = $this->num( $r[ $ix['per'] ] ?? null );
				$lines = $ix['lines'] ? $this->num( $r[ $ix['lines'] ] ?? null ) : null;
				$staffs = $this->num( $r[ $ix['staffs'] ] ?? null );
				list( $series, $kmin, $kmax ) = $this->classify_type_code( $code );
				$wpdb->insert( JMG_DB::table( 'capacities' ), array(
					'section_id' => $sid, 'type_code' => $code, 'series_key' => $series, 'kva_min' => $kmin, 'kva_max' => $kmax,
					'per_resource' => $per, 'staffs' => $staffs, 'prod_lines' => $lines,
					'productivity_per_shift' => $prod, 'new_productivity' => $newprod, 'source_row' => $rn,
				) );
				$n_rows++;
				if ( ( null === $prod || $prod <= 0 ) && ( null === $newprod || $newprod <= 0 ) ) {
					$this->issue( 'capacity_zero', $code, $sheet . ' / ' . $section_name . ': productivity is 0 or blank for ' . $code . ' (row ' . $rn . '). Section cannot be scheduled for this type until a value is entered.' );
				} elseif ( null === $prod || $prod <= 0 ) {
					$this->issue( 'capacity_new_only', $code, $sheet . ' / ' . $section_name . ': current productivity is 0 for ' . $code . '; only "New Productivity" (' . $newprod . ') exists. Switch capacity basis to "new" or enter a current value.' );
				}
			}
		}
		$this->summary[ 'sections_' . $family ] = $n_sections;
		$this->summary[ 'capacity_rows_' . $family ] = $n_rows;
	}

	private function genset_dept( $section ) {
		$s = strtolower( $section );
		if ( false !== strpos( $s, 'canopy' ) ) { return 'Canopy'; }
		if ( false !== strpos( $s, 'stc' ) || false !== strpos( $s, 'gsp' ) || false !== strpos( $s, 'pkg' ) ) { return 'Soundproofing'; }
		return 'Genset';
	}

	private function num( $v ) {
		if ( null === $v || '' === $v ) { return null; }
		return is_numeric( $v ) ? (float) $v : null;
	}

	/** Map a capacity row type code to a series key and / or a kVA band. */
	public function classify_type_code( $code ) {
		$c = strtoupper( self::clean_code( $code ) );
		$series = self::series_from_code( $c );
		$kmin = $kmax = null;
		// Canopy type bands: P13-22, P50-88, P150-165, P220-275, P33, P110, P350, P500
		if ( preg_match( '/^P(\d{2,3})\s*-\s*(\d{2,3})$/', $c, $m ) ) { $kmin = (float) $m[1]; $kmax = (float) $m[2]; }
		elseif ( preg_match( '/^P(\d{2,3})$/', $c, $m ) ) { $kmin = $kmax = (float) $m[1]; }
		elseif ( preg_match( '/^SPGP(\d{2,3}(?:\.\d)?)$/', $c, $m ) ) { $kmin = $kmax = (float) $m[1]; }
		elseif ( preg_match( '/P(\d{2,3})\s*\/\s*P?(\d{2,3})/', $c, $m ) ) { $kmin = (float) $m[1]; $kmax = (float) $m[2]; }
		elseif ( preg_match( '/(\d{3})\s*\/\s*(\d{3})/', $c, $m ) ) { $kmin = (float) $m[1]; $kmax = (float) $m[2]; }
		elseif ( preg_match( '/P(\d{2,3}(?:\.\d)?)(?:-DCP|-OPT|$|-)/', $c, $m ) && false === strpos( $c, 'P200/P250' ) ) { $kmin = $kmax = (float) $m[1]; }
		elseif ( preg_match( '/^SFP-FGWP(\d{2,3}(?:\.\d)?)$/', $c, $m ) ) { $kmin = $kmax = (float) $m[1]; }
		if ( '' === $series ) {
			// series by explicit token
			foreach ( array( 'P200/P250' => '/P200\/P250|BTP200|CPNL-220|220\/800|P220\/275|220\/275|1300SRS/', 'P350' => '/P350(?!\/800)|BTP350|BB-P350/', 'P550' => '/P550|BTP550/', 'P800' => '/P800|BTP800|BB-P800/' ) as $k => $re ) {
				if ( preg_match( $re, $c ) ) { $series = $k; break; }
			}
			if ( preg_match( '/P350\/800/', $c ) ) { $series = 'P350,P550,P800'; }
			if ( preg_match( '/220\/800/', $c ) ) { $series = 'P200/P250,P350,P550,P800'; }
		}
		if ( 'LST' === $series ) { $kmin = $kmax = null; }
		return array( $series, $kmin, $kmax );
	}

	/** Default stage key for an imported section. */
	private function stage_for_section( $family, $dept, $section ) {
		$d = strtolower( $dept ); $s = strtolower( $section );
		if ( 'canopy' === $family ) {
			if ( false !== strpos( $d, 'cutting and bending' ) ) { return 'canopy_cutting'; }
			if ( false !== strpos( $d, 'canopy pwc' ) ) { return 'canopy_pwc'; }
			if ( false !== strpos( $d, 'door and roof welding' ) ) { return 'canopy_welding'; }
			if ( false !== strpos( $d, 'grinder' ) ) { return 'canopy_grinding'; }
			if ( 'stc' === trim( $d ) && false !== strpos( $s, 'stc_day' ) ) { return 'sp_fitting'; }
			if ( false !== strpos( $s, 'finishing foam' ) ) { return 'sp_finishing'; }
			if ( false !== strpos( $d, 'packaging' ) ) { return 'packaging'; }
			if ( false !== strpos( $d, 'foam cutting' ) ) { return 'foam_cutting'; }
			if ( false !== strpos( $d, 'delaers' ) || false !== strpos( $d, 'dealers' ) ) { return 'dealer_canopy'; }
			if ( false !== strpos( $d, 'lister assembly' ) ) { return 'lister_assembly'; }
			if ( false !== strpos( $d, 'base tank welding' ) ) { return 'tank_welding'; }
			if ( false !== strpos( $d, 'exhaust' ) ) { return 'exhaust'; }
			if ( false !== strpos( $d, 'base tank 350' ) ) { return 'base_tank_large'; }
			if ( false !== strpos( $d, 'stackers cutting' ) ) { return 'stacker_cutting'; }
			if ( false !== strpos( $d, 'stackers powder' ) ) { return 'stacker_pwc'; }
			return 'other';
		}
		$map = array(
			'base_cutting' => 'base_cutting', 'base_bending' => 'base_bending', 'base_welding' => 'base_welding', 'base_grinding' => 'base_grinding', 'base_testing' => 'base_testing', 'base_pwc' => 'base_pwc',
			'canopy cutting' => 'ik_canopy_cutting', 'canopy bending' => 'ik_canopy_bending', 'canopy welding' => 'ik_canopy_welding', 'canopy grinding' => 'ik_canopy_grinding', 'canopy pwc' => 'ik_canopy_pwc',
			'panels_bending' => 'panel_bending', 'panels_cutting' => 'panel_cutting', 'panels_welding' => 'panel_welding', 'panels_grinding' => 'panel_grinding', 'panels_pwc' => 'panel_pwc', 'panels_metal assembly' => 'panel_metal_assembly', 'panels_electical assembly' => 'panel_electrical', 'panels_electrical assembly' => 'panel_electrical',
			'white goods_manual shearing machine' => 'wg_shearing', 'white goods_punch manual' => 'wg_punch', 'white goods_welding' => 'wg_welding', 'white goods_pwc' => 'wg_pwc',
			'jmg gensets_assembly' => 'genset_assembly', 'jmg gensets_pre_testing' => 'genset_pretest', 'jmg gensets_testing' => 'genset_test', 'jmg gensets_post_testing' => 'genset_posttest',
			'stc_day' => 'ik_sp_fitting', 'gsp' => 'ik_sp_finishing', 'pkg' => 'ik_packaging',
		);
		$s = trim( $s );
		foreach ( $map as $k => $v ) {
			if ( 0 === strpos( $s, $k ) ) { return $v; }
		}
		return 'other';
	}

	/* ------------------------------------------------------------------ */
	/* Cutting capacity                                                      */
	/* ------------------------------------------------------------------ */

	private function import_cutting_capacity( $reader ) {
		$rows = $reader->rows( 'Cutting Capacity', 15 );
		$n = 0;
		foreach ( $rows as $rn => $r ) {
			if ( $rn < 3 ) { continue; }
			$series = self::clean_code( $r[1] ?? '' );
			if ( '' === $series ) { continue; }
			$key = $this->norm_cut_series( $series );
			$machines = array( 'Punch 1' => array( 2, 8, 13 ), 'Punch 2' => array( 3, 9, 14 ), 'Plasma' => array( 4, 10, 15 ) );
			foreach ( $machines as $m => $cols ) {
				$mins = $this->num( $r[ $cols[0] ] ?? null );
				if ( null === $mins ) { $this->issue( 'cutting_missing', $series, 'Cutting Capacity: no time for ' . $m . ' on ' . $series ); continue; }
				JMG_DB::bulk_insert( 'machine_times', array( array(
					'canopy_series' => $key, 'machine' => $m, 'minutes_per_canopy' => $mins,
					'qty_per_shift' => $this->num( $r[ $cols[1] ] ?? null ), 'pct_consumed' => $this->num( $r[ $cols[2] ] ?? null ),
				) ) );
				$n++;
			}
		}
		$this->summary['machine_times'] = $n;
	}

	private function norm_cut_series( $s ) {
		$u = strtoupper( trim( $s ) );
		if ( false !== strpos( $u, '400' ) ) { return '400-SERIES'; }
		if ( preg_match( '/^S[1-4]$/', $u ) ) { return $u; }
		if ( false !== strpos( $u, '200' ) ) { return '200-250'; }
		if ( false !== strpos( $u, '350' ) ) { return '350-500'; }
		if ( false !== strpos( $u, 'LST' ) ) { return 'LST'; }
		return $u;
	}

	private function import_cutting_files( $reader, $sheet, $series ) {
		$rows = $reader->rows( $sheet, 9 );
		$machine = '';
		$n = 0;
		$batch = array();
		foreach ( $rows as $rn => $r ) {
			$c1 = trim( (string) ( $r[1] ?? '' ) );
			if ( preg_match( '/^(punch\s*1|punch\s*2|plasma)$/i', $c1, $m ) ) {
				$machine = preg_replace( '/\s+/', ' ', ucwords( strtolower( $m[1] ) ) );
				$machine = str_replace( array( 'Punch1', 'Punch2' ), array( 'Punch 1', 'Punch 2' ), $machine );
				continue;
			}
			if ( '' === $machine || ! preg_match( '/^file/i', $c1 ) ) { continue; }
			$desc = trim( (string) ( $r[2] ?? '' ) );
			// time text is col 3 (S sheets) or col 6 (200/500 sheets); numeric minutes col 5 or col 8
			$time_text = trim( (string) ( $r[3] ?? ( $r[6] ?? '' ) ) );
			$mins = $this->num( $r[5] ?? ( $r[8] ?? null ) );
			$plate = trim( (string) ( $r[4] ?? ( $r[7] ?? '' ) ) );
			$batch[] = array( 'sheet_name' => $sheet, 'canopy_series' => $series, 'machine' => $machine, 'file_name' => $c1, 'description' => mb_substr( $desc, 0, 255 ), 'time_text' => $time_text, 'plate' => mb_substr( $plate, 0, 80 ), 'minutes' => $mins );
			$n++;
			if ( $rn > 60 ) { break; }
		}
		JMG_DB::bulk_insert( 'cutting_files', $batch );
		$this->summary[ 'cutting_files_' . $series ] = $n;
	}

	/* ------------------------------------------------------------------ */
	/* Stage map (BOM operation code -> workflow stage -> section)           */
	/* ------------------------------------------------------------------ */

	public static function default_stage_map() {
		// op_prefix, family, label, stage_key, stage_name, workflow_group, department, sequence, section_stage, machine_group, is_scheduled
		return array(
			array( 'GB-MCM', 'any', 'Manual cutting machine (Gbagada)', 'canopy_cutting', 'Canopy Cutting & Bending', 'canopy', 'Cutting and Bending', 10, 'canopy_cutting', 'canopy_cut', 1 ),
			array( 'GB-CCT', 'any', 'Gbagada cutting worker', 'canopy_cutting', 'Canopy Cutting & Bending', 'canopy', 'Cutting and Bending', 10, 'canopy_cutting', 'canopy_cut', 1 ),
			array( 'GB-BBM', 'any', 'Baykal bending machine (Gbagada)', 'canopy_cutting', 'Canopy Cutting & Bending', 'canopy', 'Cutting and Bending', 10, 'canopy_cutting', 'canopy_cut', 1 ),
			array( 'GB-CBD', 'any', 'Gbagada bending worker', 'canopy_cutting', 'Canopy Cutting & Bending', 'canopy', 'Cutting and Bending', 10, 'canopy_cutting', 'canopy_cut', 1 ),
			array( 'GB-CWL', 'any', 'Gbagada canopy welding worker', 'canopy_welding', 'Canopy Welding', 'canopy', 'Door and Roof Welding', 20, 'canopy_welding', '', 1 ),
			array( 'GB-CGR', 'any', 'Gbagada canopy grinder worker', 'canopy_grinding', 'Canopy Grinding', 'canopy', 'Door and Roof Grinding', 30, 'canopy_grinding', '', 1 ),
			array( 'GB-PCP', 'any', 'Gbagada powder coating plant', 'canopy_pwc', 'Canopy Powder Coating', 'canopy', 'Canopy PWC', 40, 'canopy_pwc', '', 1 ),
			array( 'GB-CPW', 'any', 'Gbagada canopy powder coating worker', 'canopy_pwc', 'Canopy Powder Coating', 'canopy', 'Canopy PWC', 40, 'canopy_pwc', '', 1 ),
			array( 'GB-CST', 'any', 'Gbagada canopy standing worker', 'sp_fitting', 'Soundproof Canopy Fitting (STC)', 'final_assembly', 'STC', 100, 'sp_fitting', '', 1 ),
			array( 'GB-CGS', 'any', 'Gbagada canopy glass fixing worker', 'sp_finishing', 'Foam Fixing, Glass & Finishing (GSP)', 'final_assembly', 'STC', 110, 'sp_finishing', '', 1 ),
			array( 'GB-CFF', 'any', 'Gbagada canopy foam cutting worker', 'sp_finishing', 'Foam Fixing, Glass & Finishing (GSP)', 'final_assembly', 'STC', 110, 'sp_finishing', '', 1 ),
			array( 'GB-CPK', 'any', 'Gbagada canopy packaging worker', 'packaging', 'Packaging & Finished Product', 'final_assembly', 'Packaging', 120, 'packaging', '', 1 ),
			array( 'GB-EX&DT', 'any', 'Gbagada exhaust & diesel tank welding/grinding', 'exhaust', 'Exhaust & Diesel Tank Fabrication', 'exhaust', 'Exhaust Department', 10, 'exhaust', '', 1 ),
			array( 'GB-TPN', 'any', 'Gbagada exhaust & tank painting', 'exhaust_paint', 'Exhaust & Tank Painting', 'exhaust', 'Exhaust Department', 20, 'exhaust', '', 1 ),
			array( 'IK-BCT', 'any', 'Ikotun laser cutting', 'base_cutting', 'Base Cutting', 'base', 'Base', 10, 'base_cutting', '', 1 ),
			array( 'IK-BBD', 'base', 'Ikotun bending (base)', 'base_bending', 'Base Bending', 'base', 'Base', 20, 'base_bending', '', 1 ),
			array( 'IK-BBD', 'panel', 'Ikotun bending (panel)', 'panel_bending', 'Panel Bending', 'panel', 'Panels', 20, 'panel_bending', '', 1 ),
			array( 'IK-BBD', 'any', 'Ikotun bending (other parts)', 'base_bending', 'Base Bending', 'base', 'Base', 20, 'base_bending', '', 1 ),
			array( 'IK-WBT', 'any', 'Ikotun base tank welding', 'base_welding', 'Base Tank Welding', 'base', 'Base', 30, 'base_welding', '', 1 ),
			array( 'IK-WBG', 'any', 'Ikotun base grinding', 'base_grinding', 'Base Grinding', 'base', 'Base', 40, 'base_grinding', '', 1 ),
			array( 'IK-TBT', 'any', 'Ikotun base tank testing', 'base_testing', 'Base Tank Testing', 'quality', 'Base', 50, 'base_testing', '', 1 ),
			array( 'IK-PCP', 'base', 'Ikotun powder coating (base)', 'base_pwc', 'Base Powder Coating', 'base', 'Powder Coating', 60, 'base_pwc', '', 1 ),
			array( 'IK-PCP', 'panel', 'Ikotun powder coating (panel)', 'panel_pwc', 'Panel Powder Coating', 'panel', 'Powder Coating', 50, 'panel_pwc', '', 1 ),
			array( 'IK-PCP', 'any', 'Ikotun powder coating (white goods / parts)', 'wg_pwc', 'Parts Powder Coating', 'parts', 'Powder Coating', 50, 'wg_pwc', '', 1 ),
			array( 'IK-PCT', 'panel', 'Ikotun punch cutting (panel)', 'panel_cutting', 'Panel Cutting', 'panel', 'Panels', 10, 'panel_cutting', '', 1 ),
			array( 'IK-PCT', 'any', 'Ikotun punch cutting (parts)', 'wg_punch', 'Parts Punching / Cutting', 'parts', 'White Goods', 10, 'wg_punch', '', 1 ),
			array( 'IK-WCP', 'any', 'Ikotun panel welding', 'panel_welding', 'Panel Welding', 'panel', 'Panels', 30, 'panel_welding', '', 1 ),
			array( 'IK-WCG', 'any', 'Ikotun panel grinding', 'panel_grinding', 'Panel Grinding', 'panel', 'Panels', 40, 'panel_grinding', '', 1 ),
			array( 'IK-CPA', 'any', 'Ikotun control panel assembly', 'panel_electrical', 'Control Panel Electrical Assembly', 'panel', 'Panels', 70, 'panel_electrical', '', 1 ),
			array( 'IK-PLA', 'any', 'Ikotun power loom assembly', 'loom_assembly', 'Power Loom / Cable Assembly', 'parts', 'Panels', 10, '', '', 0 ),
			array( 'IK-CDP', 'any', 'Ikotun pipe cutting / threading', 'pipe_cutting', 'Pipe Cutting & Threading', 'parts', 'Base', 10, '', '', 0 ),
			array( 'IK-GAS', 'any', 'Ikotun generator assembly worker', 'genset_assembly', 'Genset Assembly', 'genset', 'JMG gensets', 10, 'genset_assembly', '', 1 ),
			array( 'IK-GPT', 'any', 'Ikotun pre-test', 'genset_pretest', 'Genset Pre-Testing', 'quality', 'JMG gensets', 20, 'genset_pretest', '', 1 ),
			array( 'IK-GTT', 'any', 'Ikotun testing', 'genset_test', 'Genset Testing (QC)', 'quality', 'JMG gensets', 30, 'genset_test', '', 1 ),
			array( 'IK-PTG', 'any', 'Ikotun post-test', 'genset_posttest', 'Genset Post-Testing', 'quality', 'JMG gensets', 40, 'genset_posttest', '', 1 ),
		);
	}

	private function install_stage_map() {
		global $wpdb;
		$t = JMG_DB::table( 'stage_map' );
		$existing = (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t" );
		$sections = $wpdb->get_results( 'SELECT id, stage_key, section_name FROM ' . JMG_DB::table( 'sections' ), ARRAY_A );
		$by_stage = array();
		foreach ( $sections as $s ) { if ( ! isset( $by_stage[ $s['stage_key'] ] ) ) { $by_stage[ $s['stage_key'] ] = (int) $s['id']; } }
		if ( $existing > 0 ) {
			// Re-link sections after re-import (ids changed) using stage keys.
			$rows = $wpdb->get_results( "SELECT id, stage_key FROM $t", ARRAY_A );
			foreach ( $rows as $r ) {
				$wpdb->update( $t, array( 'section_id' => isset( $by_stage[ $r['stage_key'] ] ) ? $by_stage[ $r['stage_key'] ] : null ), array( 'id' => $r['id'] ) );
			}
			return;
		}
		$rows = array();
		foreach ( self::default_stage_map() as $m ) {
			$rows[] = array(
				'op_prefix' => $m[0], 'family' => $m[1], 'op_label' => $m[2], 'stage_key' => $m[3], 'stage_name' => $m[4], 'workflow_group' => $m[5], 'department' => $m[6],
				'sequence' => $m[7], 'section_id' => ( $m[8] && isset( $by_stage[ $m[8] ] ) ) ? $by_stage[ $m[8] ] : null, 'machine_group' => $m[9], 'match_mode' => 'auto', 'is_scheduled' => $m[10],
				'notes' => $m[8] && ! isset( $by_stage[ $m[8] ] ) ? 'No section with stage ' . $m[8] . ' found in workbook.' : ( $m[10] ? '' : 'No productivity data in workbook for this operation; it is listed but not capacity-scheduled.' ),
			);
		}
		JMG_DB::bulk_insert( 'stage_map', $rows );
	}
}
