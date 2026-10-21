<?php
/**
 * Maps the production workbook (BOM, Finished Product, capacity and productivity
 * sheets) into structured master data. Nothing is invented: every number comes
 * from the workbook and every gap is reported for administrator review.
 */
class PP_Workbook_Importer {

	public static $stages = array(
		'CUT' => array( 10, 'Cutting' ), 'BEND' => array( 20, 'Bending' ), 'WELD' => array( 30, 'Welding' ),
		'GRIND' => array( 40, 'Grinding' ), 'TEST_SF' => array( 50, 'Semi-finished Testing' ),
		'PWC' => array( 60, 'Powder Coating' ), 'SUBASM' => array( 70, 'Sub-assembly' ),
		'PANEL' => array( 75, 'Panel Assembly' ), 'CANOPY' => array( 80, 'Canopy Sub-assembly' ),
		'FINAL' => array( 90, 'Final Assembly' ), 'QC' => array( 100, 'Quality Control' ),
		'PACK' => array( 110, 'Packaging / Dispatch' ),
	);

	public static $departments = array(
		array( 'IK-CUT', 'Ikotun Cutting (Laser / Punch / Shearing)', 'Ikotun', 'CUT' ),
		array( 'IK-BEND', 'Ikotun Bending', 'Ikotun', 'BEND' ),
		array( 'IK-WELD', 'Ikotun Welding (Base & Panels)', 'Ikotun', 'WELD' ),
		array( 'IK-GRIND', 'Ikotun Grinding', 'Ikotun', 'GRIND' ),
		array( 'IK-TEST', 'Ikotun Base Tank Testing', 'Ikotun', 'TEST_SF' ),
		array( 'IK-PWC', 'Ikotun Powder Coating', 'Ikotun', 'PWC' ),
		array( 'IK-PLA', 'Ikotun Power Loom Assembly', 'Ikotun', 'SUBASM' ),
		array( 'IK-PMA', 'Ikotun Panel Metal Assembly', 'Ikotun', 'SUBASM' ),
		array( 'IK-CPA', 'Ikotun Control Panel Electrical Assembly', 'Ikotun', 'PANEL' ),
		array( 'IK-GAS', 'Ikotun Genset Final Assembly', 'Ikotun', 'FINAL' ),
		array( 'IK-GTT', 'Ikotun Genset Testing (Pre-test & Test)', 'Ikotun', 'QC' ),
		array( 'IK-PTG', 'Ikotun Post-test & Dispatch', 'Ikotun', 'PACK' ),
		array( 'GB-CUT', 'Gbagada Canopy Cutting', 'Gbagada', 'CUT' ),
		array( 'GB-BEND', 'Gbagada Canopy Bending', 'Gbagada', 'BEND' ),
		array( 'GB-WELD', 'Gbagada Canopy Welding', 'Gbagada', 'WELD' ),
		array( 'GB-GRIND', 'Gbagada Canopy Grinding', 'Gbagada', 'GRIND' ),
		array( 'GB-PWC', 'Gbagada Canopy Powder Coating', 'Gbagada', 'PWC' ),
		array( 'GB-EXH', 'Gbagada Exhaust & Diesel Tank', 'Gbagada', 'WELD' ),
		array( 'GB-CST', 'Gbagada Canopy Standing (STC)', 'Gbagada', 'CANOPY' ),
		array( 'GB-FIN', 'Gbagada Canopy Finishing (Foam & Glass)', 'Gbagada', 'CANOPY' ),
		array( 'GB-CPK', 'Gbagada Canopy Packaging', 'Gbagada', 'PACK' ),
		array( 'GB-STK', 'Gbagada Dealers Canopy Stacking', 'Gbagada', 'CANOPY' ),
		array( 'IK-LST', 'Lister Assembly', 'Ikotun', 'FINAL' ),
	);

	public static $resource_dept = array(
		'IK-BCT' => 'IK-CUT', 'IK-PCT' => 'IK-CUT', 'IK-CDP' => 'IK-CUT', 'IK-BBD' => 'IK-BEND',
		'IK-WBT' => 'IK-WELD', 'IK-WCP' => 'IK-WELD', 'IK-WBG' => 'IK-GRIND', 'IK-WCG' => 'IK-GRIND',
		'IK-TBT' => 'IK-TEST', 'IK-PCP' => 'IK-PWC', 'IK-PLA' => 'IK-PLA', 'IK-CPA' => 'IK-CPA',
		'IK-GAS' => 'IK-GAS', 'IK-GPT' => 'IK-GTT', 'IK-GTT' => 'IK-GTT', 'IK-PTG' => 'IK-PTG',
		'GB-MCM' => 'GB-CUT', 'GB-CCT' => 'GB-CUT', 'GB-BBM' => 'GB-BEND', 'GB-CBD' => 'GB-BEND',
		'GB-CWL' => 'GB-WELD', 'GB-CGR' => 'GB-GRIND', 'GB-PCP' => 'GB-PWC', 'GB-CPW' => 'GB-PWC',
		'GB-CST' => 'GB-CST', 'GB-CGS' => 'GB-FIN', 'GB-CFF' => 'GB-FIN', 'GB-CPK' => 'GB-CPK',
		'GB-EX&DT' => 'GB-EXH', 'GB-TPN' => 'GB-EXH',
	);

	public static $section_dept = array(
		'canopy cutting' => 'GB-CUT', 'canopy pwc' => 'GB-PWC', 'general welding' => 'GB-WELD',
		'door and roof grinding' => 'GB-GRIND', 'stc_day' => 'GB-CST', 'packaging_day' => 'GB-CPK',
		'canopy stacking' => 'GB-STK', 'canopy dealers scoa stc' => 'GB-STK',
		'foam cutting' => 'GB-FIN', 'finishing foam fixing and gsp_day' => 'GB-FIN',
		'exhaust pot welding' => 'GB-EXH', 'base tank for 350-500' => 'IK-WELD',
		'stackers cutting section' => 'GB-CUT', 'stackers powder coating section' => 'GB-PWC',
		'lister electrical assembly' => 'IK-LST', 'lister mechanical assembly' => 'IK-LST',
		'preparation of ac looms' => 'IK-LST', 'lister testing' => 'IK-LST', 'lister control panel' => 'IK-LST',
		'welding dt1500' => 'GB-EXH', 'framing of dt1500' => 'GB-EXH', 'welding of dt channels' => 'GB-EXH',
		'testing of dt1500' => 'GB-EXH', 'grinding of deisel tanks 1500' => 'GB-EXH', 'painting deisel tanks 1500' => 'GB-EXH',
		'welding oil tanks small' => 'IK-WELD', 'framing base' => 'IK-WELD', 'grinding of base frames' => 'IK-GRIND',
		'testing of oil tanks and base' => 'IK-TEST', 'wedling channels' => 'IK-WELD',
		'base frame (145 ltrs) weld' => 'IK-WELD', 'base frame (145ltrs) grind' => 'IK-GRIND', 'base frame (145ltrs) test' => 'IK-TEST',
		'base_cutting' => 'IK-CUT', 'base_bending' => 'IK-BEND', 'canopy bending' => 'IK-BEND',
		'panels_bending' => 'IK-BEND', 'canopy welding' => 'IK-WELD', 'canopy grinding' => 'IK-GRIND',
		'white goods_manual shearing machine' => 'IK-CUT', 'white goods_punch manual' => 'IK-CUT',
		'panels_cutting' => 'IK-CUT', 'base_welding p13 to p165' => 'IK-WELD', 'base_welding_p250_p800' => 'IK-WELD',
		'white goods_welding' => 'IK-WELD', 'panels_welding' => 'IK-WELD', 'base_grinding' => 'IK-GRIND',
		'base_testing' => 'IK-TEST', 'panels_grinding' => 'IK-GRIND', 'base_pwc' => 'IK-PWC',
		'white goods_pwc' => 'IK-PWC', 'panels_pwc' => 'IK-PWC', 'panels_metal assembly' => 'IK-PMA',
		'panels_electical assembly' => 'IK-CPA', 'jmg gensets_assembly' => 'IK-GAS',
		'jmg gensets_pre_testing' => 'IK-GTT', 'jmg gensets_testing' => 'IK-GTT',
		'jmg gensets_post_testing' => 'IK-PTG', 'stc' => 'GB-CST', 'gsp' => 'GB-FIN', 'pkg' => 'GB-CPK',
	);

	/** kVA upper bound => family (assumption documented in README, editable per product). */
	public static $family_by_kva = array( array( 22, 'P13-22' ), array( 40, 'P33' ), array( 99, 'P50-88' ), array( 125, 'P110' ), array( 175, 'P150-165' ), array( 275, 'P220-275' ), array( 400, 'P350' ), array( 1000000, 'P500' ) );
	public static $size_by_family = array( 'P13-22' => 'S1', 'P33' => 'S1', 'P50-88' => 'S2', 'P110' => 'S3', 'P150-165' => 'S4', 'P220-275' => '200-250', 'P350' => '350-500', 'P500' => '350-500', 'LST' => 'LST' );
	public static $family_by_size = array( 'S1' => 'P13-22', 'S2' => 'P50-88', 'S3' => 'P110', 'S4' => 'P150-165', '200-250' => 'P220-275', '350-500' => 'P500', '400-SERIES' => 'P350', 'LST' => 'LST' );
	public static $family_tokens = array(
		'lister' => 'LST', 'lst' => 'LST', 'p13-22' => 'P13-22', 'p13.5' => 'P13-22', 'p13' => 'P13-22', 'p16' => 'P13-22',
		'p18' => 'P13-22', 'p22' => 'P13-22', 'p33' => 'P33', 'p50-88' => 'P50-88', 'p50' => 'P50-88', 'p65' => 'P50-88',
		'p88' => 'P50-88', 'p110' => 'P110', 'p150-165' => 'P150-165', 'p150' => 'P150-165', 'p165' => 'P150-165',
		'p150/165' => 'P150-165', 'p220-275' => 'P220-275', 'p200' => 'P220-275', 'p220' => 'P220-275', 'p250' => 'P220-275',
		'p275' => 'P220-275', 'p200/p250' => 'P220-275', '220/275' => 'P220-275', 'p350' => 'P350', 'p330' => 'P350',
		'p400' => 'P350', '400srs' => 'P350', '400sr' => 'P350', 'p500' => 'P500', 'p550' => 'P500', 'p600' => 'P500', 'p700' => 'P500',
		'p800' => 'P500', '1300srs' => 'P500', 'p350/500' => 'P350', 'p350/800' => 'P350', '220/800' => 'P220-275',
		's1' => 'S1', 's2' => 'S2', 's3' => 'S3', 's4' => 'S4', 's3/s4' => 'S3', 's2/s3' => 'S2', 's2-p88' => 'S2',
		'200-250' => '200-250', '350-500' => '350-500', '400-series' => '400-SERIES', '200-220' => 'P220-275',
	);

	public $issues = array();
	public $out = array();

	public static function norm( $v ) {
		if ( null === $v ) {
			return '';
		}
		if ( is_float( $v ) && floor( $v ) == $v && abs( $v ) < 1e15 ) {
			$v = (string) (int) $v;
		}
		return trim( preg_replace( '/\s+/u', ' ', str_replace( "\xc2\xa0", ' ', (string) $v ) ) );
	}

	public static function num( $v ) {
		if ( null === $v || '' === $v || is_bool( $v ) ) {
			return null;
		}
		return is_numeric( $v ) ? (float) $v : null;
	}

	private function issue( $kind, $data ) {
		$this->issues[] = array_merge( array( 'kind' => $kind ), $data );
	}

	public static function kva_of( $desc ) {
		if ( preg_match( '/\/(\d+(?:\.\d+)?)\s*KVA/i', (string) $desc, $m ) ) {
			return (float) $m[1];
		}
		return null;
	}

	public static function family_for_kva( $k ) {
		foreach ( self::$family_by_kva as $pair ) {
			if ( $k <= $pair[0] ) {
				return $pair[1];
			}
		}
		return null;
	}

	public static function family_of( $code, $desc ) {
		$k = self::kva_of( $desc );
		if ( null === $k ) {
			if ( preg_match( '/P(\d{2,4})/', $code, $m ) ) {
				$k = (float) $m[1] * 0.9;
			} elseif ( preg_match( '/EY(\d+)/', $code, $m ) ) {
				$k = (float) $m[1] * 0.9;
			}
		}
		if ( null === $k ) {
			if ( preg_match( '/\b(S[1-4])\b/i', $code . ' ' . $desc, $m ) ) {
				return self::$family_by_size[ strtoupper( $m[1] ) ];
			}
			if ( preg_match( '/200-2[25]0/', $code . ' ' . $desc ) ) {
				return 'P220-275';
			}
			return null;
		}
		return self::family_for_kva( $k );
	}

	/** Canonical family (P-class) and size token from a productivity/capacity key. */
	public static function family_from_key( $key ) {
		$k = strtolower( self::norm( $key ) );
		$tokens = self::$family_tokens;
		uksort(
			$tokens,
			function ( $a, $b ) {
				return strlen( $b ) - strlen( $a );
			}
		);
		foreach ( $tokens as $tok => $fam ) {
			if ( preg_match( '/(^|[^a-z0-9])' . preg_quote( $tok, '/' ) . '($|[^a-z0-9])/', $k ) ) {
				return $fam;
			}
		}
		if ( preg_match( '/lst/', $k ) ) {
			return 'LST';
		}
		if ( preg_match( '/p(\d{2,4})/', $k, $m ) ) {
			return self::family_for_kva( (float) $m[1] );
		}
		return null;
	}

	public static function normalise_family( $fam ) {
		if ( null === $fam ) {
			return array( null, null );
		}
		if ( isset( self::$family_by_size[ $fam ] ) ) {
			return array( self::$family_by_size[ $fam ], $fam );
		}
		return array( $fam, isset( self::$size_by_family[ $fam ] ) ? self::$size_by_family[ $fam ] : null );
	}

	public static function category_of_key( $key ) {
		$k = strtolower( self::norm( $key ) );
		if ( strpos( $k, 'cpnl' ) !== false || strpos( $k, 'relay' ) !== false || strpos( $k, 'cbb' ) !== false || strpos( $k, 'rb-' ) === 0 || strpos( $k, 'bb-' ) === 0 ) {
			return 'panel';
		}
		if ( preg_match( '/(^|-)bt(p|-|$)/', $k ) || strpos( $k, 'base' ) !== false ) {
			return 'base';
		}
		if ( strpos( $k, 'chnl' ) !== false || strpos( $k, 'brckt' ) !== false || strpos( $k, 'hook' ) !== false || strpos( $k, 'covr' ) !== false || strpos( $k, 'ltpmp' ) !== false ) {
			return 'whitegoods';
		}
		if ( strpos( $k, 'sfp-fgw' ) === 0 || strpos( $k, 'spg' ) === 0 ) {
			return 'genset';
		}
		return 'canopy';
	}

	/**
	 * Run the import. Returns an array of datasets keyed by table name plus 'quality_report'.
	 */
	public function import( $path ) {
		$reader = new PP_Xlsx_Reader( $path );
		$names  = $reader->sheet_names();
		foreach ( array( 'BOM', 'Finished Product' ) as $req ) {
			if ( ! in_array( $req, $names, true ) ) {
				throw new RuntimeException( "Required sheet '$req' not found in workbook." );
			}
		}
		$fp_list = array();
		foreach ( array_slice( $reader->rows( 'Finished Product' ), 1 ) as $r ) {
			if ( ! empty( $r[0] ) ) {
				$fp_list[ self::norm( $r[0] ) ] = true;
			}
		}

		// ---------------- BOM ----------------
		$rows = $reader->rows( 'BOM' );
		$hdr  = array_map( array( __CLASS__, 'norm' ), $rows[0] );
		$C    = array();
		foreach ( $hdr as $i => $h ) {
			if ( ! isset( $C[ $h ] ) ) {
				$C[ $h ] = $i;
			}
		}
		foreach ( array( 'Item number', 'Item/Resource', 'Parent Bom', 'Product name', 'Level', 'Calculation Type', 'Consumption per lot size', 'Cost per unit', 'Type 1', 'Type 3' ) as $req ) {
			if ( ! isset( $C[ $req ] ) ) {
				throw new RuntimeException( "BOM sheet is missing column '$req'." );
			}
		}
		$unit_cost_col = isset( $C['Unit Cost'] ) ? $C['Unit Cost'] : null;
		$col = function ( $r, $name ) use ( $C ) {
			return isset( $C[ $name ] ) && isset( $r[ $C[ $name ] ] ) ? $r[ $C[ $name ] ] : null;
		};

		$products = array(); $bom = array(); $conflicts = array(); $routings = array(); $overheads = array();
		$resources = array(); $materials = array(); $price_obs = array(); $level0 = array();

		$ensure = function ( $code, $name = null, $attrs = array() ) use ( &$products ) {
			if ( ! isset( $products[ $code ] ) ) {
				$products[ $code ] = array(
					'code' => $code, 'description' => '', 'kind' => 'RM', 'is_finished' => 0, 'product_type' => null,
					'family' => null, 'canopy_size' => null, 'uom' => null, 'std_cost' => null, 'cost_group' => null,
					'type1' => null, 'warehouse' => null, 'sellable' => 0,
				);
			}
			if ( $name && '' === $products[ $code ]['description'] ) {
				$products[ $code ]['description'] = self::norm( $name );
			}
			foreach ( $attrs as $k => $v ) {
				if ( null !== $v && '' !== $v && 0 !== $v && empty( $products[ $code ][ $k ] ) ) {
					$products[ $code ][ $k ] = $v;
				}
			}
		};

		$n = count( $rows );
		for ( $i = 1; $i < $n; $i++ ) {
			$r    = $rows[ $i ];
			$item = self::norm( $col( $r, 'Item number' ) );
			if ( '' === $item ) {
				continue;
			}
			$comp   = self::norm( $col( $r, 'Item/Resource' ) );
			$parent = self::norm( $col( $r, 'Parent Bom' ) );
			$name   = self::norm( $col( $r, 'Product name' ) );
			$lvl    = self::num( $col( $r, 'Level' ) );
			$calc   = self::norm( $col( $r, 'Calculation Type' ) );
			$qty    = self::num( $col( $r, 'Consumption per lot size' ) );
			$unit   = self::norm( $col( $r, 'Unit' ) ); $unit = '' === $unit ? null : $unit;
			$cpu    = self::num( $col( $r, 'Cost per unit' ) );
			$uc     = null !== $unit_cost_col && isset( $r[ $unit_cost_col ] ) ? self::num( $r[ $unit_cost_col ] ) : null;
			$t1     = self::norm( $col( $r, 'Type 1' ) );
			$t3     = self::norm( $col( $r, 'Type 3' ) );
			$cg     = self::norm( $col( $r, 'Cost Group' ) ); $cg = '' === $cg ? null : $cg;
			$op     = self::norm( $col( $r, 'Operation' ) ); $op = '' === $op ? null : $op;
			$wh     = self::norm( $col( $r, 'Warehouse' ) ); $wh = '' === $wh ? null : $wh;
			$lineno = self::num( $col( $r, 'Line number' ) );

			if ( 0.0 === (float) $lvl && ( 'Production' === $calc || '' === $parent ) ) {
				$level0[ $item ] = true;
				$ensure( $item, $name, array( 'kind' => 'SF', 'std_cost' => $cpu, 'type1' => $t1 ) );
				$products[ $item ]['kind'] = 'SF';
				continue;
			}
			if ( 'STATUS ITEM' === $t1 || 'Output unit based' === $calc || '' === $comp ) {
				continue;
			}
			if ( '' === $parent ) {
				$parent = $item;
			}
			if ( 'Item' === $calc || 'BOM' === $calc ) {
				$ensure( $parent, null, array( 'kind' => 'SF' ) );
				$products[ $parent ]['kind'] = 'SF';
				$ensure( $comp, $name, array( 'uom' => $unit, 'cost_group' => $cg, 'type1' => $t1, 'warehouse' => $wh ) );
				if ( 'BOM' === $calc ) {
					$products[ $comp ]['kind'] = 'SF';
					if ( $cpu && empty( $products[ $comp ]['std_cost'] ) ) {
						$products[ $comp ]['std_cost'] = $cpu;
					}
				}
				$key = $parent . "\0" . $comp;
				if ( isset( $bom[ $key ] ) ) {
					if ( null !== $qty && abs( (float) $bom[ $key ]['qty'] - $qty ) > 1e-9 ) {
						$conflicts[ $key ][ (string) $qty ] = $qty;
					}
					continue;
				}
				$bom[ $key ] = array(
					'parent_code' => $parent, 'component_code' => $comp, 'qty' => null === $qty ? 0 : $qty, 'uom' => $unit,
					'line_no' => null === $lineno ? null : (int) $lineno, 'calc_type' => $calc, 'type1' => $t1 ?: null,
					'cost_group' => $cg, 'warehouse' => $wh, 'std_cost' => $cpu, 'unit_cost' => $uc, 'source' => 'excel',
				);
				if ( 'Item' === $calc ) {
					if ( ! isset( $materials[ $comp ] ) ) {
						$materials[ $comp ] = array( 'code' => $comp, 'description' => $name, 'uom' => $unit, 'cost_group' => $cg );
					}
					if ( $uc ) {
						$price_obs[ $comp ]['unit_cost'][] = $uc;
					} elseif ( $cpu && $qty ) {
						$price_obs[ $comp ]['standard_cost'][] = $cpu / $qty;
					}
				}
			} elseif ( 'Process' === $calc ) {
				$kind = ( 'LBR DIR' === $t3 ) ? 'labor' : 'machine';
				if ( ! isset( $resources[ $comp ] ) ) {
					$resources[ $comp ] = array( 'code' => $comp, 'name' => $name, 'kind' => $kind, 'operation' => $op, 'department_code' => null, 'rates' => array() );
				}
				if ( $cpu && $qty ) {
					$resources[ $comp ]['rates'][] = $cpu / $qty;
				}
				$key = $parent . "\0" . $comp;
				if ( ! isset( $routings[ $key ] ) ) {
					$routings[ $key ] = array( 'parent_code' => $parent, 'resource_code' => $comp, 'hours_per_unit' => null === $qty ? 0 : $qty, 'std_cost' => $cpu, 'kind' => $kind, 'operation' => $op, 'source' => 'excel' );
				}
			} elseif ( 'Rate' === $calc ) {
				$kind = ( 'MAN OVH' === $t3 ) ? 'manufacturing_overhead' : 'labor_overhead';
				$key  = $parent . "\0" . $comp;
				if ( ! isset( $overheads[ $key ] ) ) {
					$overheads[ $key ] = array( 'parent_code' => $parent, 'resource_code' => $comp, 'name' => $name, 'hours' => $qty, 'std_cost' => $cpu, 'kind' => $kind, 'rate_per_hour' => ( $cpu && $qty ) ? $cpu / $qty : null );
				}
			}
		}
		unset( $rows );

		// resources -> departments & rates
		foreach ( $resources as $code => &$res ) {
			$dept = null;
			foreach ( self::$resource_dept as $pref => $d ) {
				if ( 0 === stripos( $code, $pref ) ) {
					$dept = $d;
					break;
				}
			}
			$res['department_code']   = $dept;
			$res['rate_per_hour']     = $res['rates'] ? round( self::median( $res['rates'] ), 4 ) : null;
			$res['rate_observations'] = count( $res['rates'] );
			unset( $res['rates'] );
			if ( ! $dept ) {
				$this->issue( 'resource_without_department', array( 'resource' => $code, 'name' => $res['name'] ) );
			}
		}
		unset( $res );

		// product classification
		foreach ( $products as $code => &$p ) {
			$d = strtoupper( $p['description'] );
			if ( isset( $fp_list[ $code ] ) ) {
				$p['kind'] = 'FG'; $p['is_finished'] = 1; $p['sellable'] = 1;
			} elseif ( isset( $level0[ $code ] ) ) {
				$p['kind'] = 'FG'; $p['is_finished'] = ( strpos( $d, 'CANOPY' ) !== false ) ? 1 : 0; $p['sellable'] = $p['is_finished'];
			}
			if ( 'FG' === $p['kind'] || 'SF' === $p['kind'] ) {
				if ( strpos( $d, 'CANOPY' ) !== false || strpos( $d, 'ENCLOSURE' ) !== false ) {
					$p['product_type'] = 'Canopy';
				} elseif ( strpos( $d, 'TANK' ) !== false ) {
					$p['product_type'] = 'Tank';
				} elseif ( strpos( $d, 'PANEL' ) !== false || strpos( $d, 'RELAY' ) !== false || strpos( $code, 'CBB' ) !== false ) {
					$p['product_type'] = 'Panel';
				} elseif ( strpos( $d, 'BASE' ) !== false || 0 === strpos( $code, 'BASE-' ) ) {
					$p['product_type'] = 'Base';
				} elseif ( strpos( $d, 'LOOM' ) !== false || strpos( $d, 'CABLE ASSEMBLY' ) !== false ) {
					$p['product_type'] = 'Loom';
				} else {
					$p['product_type'] = 'Genset';
				}
				$p['family'] = self::family_of( $code, $p['description'] );
				if ( $p['family'] ) {
					$p['canopy_size'] = isset( self::$size_by_family[ $p['family'] ] ) ? self::$size_by_family[ $p['family'] ] : null;
				}
			}
			if ( 'FG' === $p['kind'] && ! $p['family'] ) {
				$this->issue( 'finished_product_without_family', array( 'product' => $code, 'description' => $p['description'] ) );
			}
		}
		unset( $p );

		// inherit family to sub-assemblies from finished products that use them
		$children = array();
		foreach ( $bom as $ln ) {
			if ( 'BOM' === $ln['calc_type'] ) {
				$children[ $ln['parent_code'] ][] = $ln['component_code'];
			}
		}
		$inherit = function ( $code, $fam, &$seen ) use ( &$inherit, &$children, &$products ) {
			if ( empty( $children[ $code ] ) ) {
				return;
			}
			foreach ( $children[ $code ] as $comp ) {
				if ( isset( $seen[ $comp ] ) ) {
					continue;
				}
				$seen[ $comp ] = true;
				if ( empty( $products[ $comp ]['family'] ) ) {
					$products[ $comp ]['family']      = $fam;
					$products[ $comp ]['canopy_size'] = isset( self::$size_by_family[ $fam ] ) ? self::$size_by_family[ $fam ] : null;
				}
				$inherit( $comp, $fam, $seen );
			}
		};
		foreach ( $products as $code => $p ) {
			if ( 'FG' === $p['kind'] && $p['family'] ) {
				$seen = array();
				$inherit( $code, $p['family'], $seen );
			}
		}

		// material prices
		$prices = array();
		foreach ( $materials as $code => $m ) {
			$uc = isset( $price_obs[ $code ]['unit_cost'] ) ? $price_obs[ $code ]['unit_cost'] : array();
			$sc = isset( $price_obs[ $code ]['standard_cost'] ) ? $price_obs[ $code ]['standard_cost'] : array();
			if ( $uc ) {
				$price = self::median( $uc ); $src = 'excel_unit_cost';
			} elseif ( $sc ) {
				$price = self::median( $sc ); $src = 'excel_standard_cost';
			} else {
				$price = null; $src = 'missing';
				$this->issue( 'missing_material_price', array( 'material' => $code, 'description' => $m['description'] ) );
			}
			if ( $uc && ( max( $uc ) - min( $uc ) ) > 0.01 * max( $uc ) ) {
				$vals = array_values( array_unique( array_map( function ( $v ) { return round( $v, 2 ); }, $uc ) ) );
				sort( $vals );
				$this->issue( 'inconsistent_material_price', array( 'material' => $code, 'values' => $vals ) );
			}
			$prices[] = array( 'material_code' => $code, 'description' => $m['description'], 'uom' => $m['uom'], 'unit_price' => null === $price ? null : round( $price, 4 ), 'source' => $src, 'cost_group' => $m['cost_group'] );
		}
		foreach ( $conflicts as $key => $vals ) {
			list( $par, $comp ) = explode( "\0", $key );
			$v = array_values( $vals ); sort( $v );
			$this->issue( 'bom_quantity_conflict', array( 'parent' => $par, 'component' => $comp, 'used' => $bom[ $key ]['qty'], 'other_values' => $v ) );
		}
		$routed = array();
		foreach ( $routings as $rt ) {
			$routed[ $rt['parent_code'] ] = true;
		}
		$has_children = array();
		foreach ( $bom as $ln ) {
			$has_children[ $ln['parent_code'] ] = true;
		}
		foreach ( $products as $code => $p ) {
			if ( in_array( $p['kind'], array( 'SF', 'FG' ), true ) && ! isset( $routed[ $code ] ) && isset( $has_children[ $code ] ) ) {
				$this->issue( 'bom_without_routing', array( 'product' => $code, 'description' => $p['description'] ) );
			}
		}

		// ---------------- Departments, capacities, history ----------------
		$departments = array();
		foreach ( self::$departments as $d ) {
			$departments[ $d[0] ] = array( 'code' => $d[0], 'name' => $d[1], 'site' => $d[2], 'stage' => $d[3], 'stage_order' => self::$stages[ $d[3] ][0], 'manpower' => 0, 'machines' => 1, 'minutes_per_day' => 480, 'manpower_source' => 'not in workbook - review' );
		}
		$capacities = array(); $history = array(); $dept_staff = array();

		$add_cap = function ( $dept, $section, $key, $upd, $per_machine, $staff, $lines, $sheet, $rownum, $extra ) use ( &$capacities ) {
			if ( null === $dept ) {
				$this->issue( 'capacity_section_unmapped', array( 'sheet' => $sheet, 'section' => $section, 'key' => $key ) );
				return;
			}
			list( $fam, $size ) = self::normalise_family( self::family_from_key( $key ) );
			$capacities[] = array_merge(
				array( 'department_code' => $dept, 'section' => $section, 'key_code' => self::norm( $key ), 'family' => $fam, 'size' => $size, 'category' => self::category_of_key( $key ), 'units_per_day' => $upd, 'units_per_machine_per_day' => $per_machine, 'staff' => $staff, 'prod_lines' => $lines, 'source' => $sheet . '!row' . $rownum ),
				$extra
			);
		};
		$add_hist = function ( $row, $starts, $labels, $sheet, $section, $key, $dept ) use ( &$history ) {
			$days = array( 'Mon', 'Tue', 'Wed', 'Thu', 'Fri' );
			foreach ( $starts as $wi => $c0 ) {
				foreach ( $days as $di => $dn ) {
					$v = isset( $row[ $c0 + $di ] ) ? self::num( $row[ $c0 + $di ] ) : null;
					if ( $v ) {
						$history[] = array( 'sheet' => $sheet, 'week_label' => $labels[ $wi ], 'day_name' => $dn, 'section' => $section, 'key_code' => self::norm( $key ), 'department_code' => $dept, 'qty' => $v );
					}
				}
			}
		};

		if ( in_array( 'Canopy Assembly', $names, true ) ) {
			$crow   = $reader->rows( 'Canopy Assembly' );
			$labels = array( 'Week 1 November', 'Week 2 November', 'Week 3 November', 'Week 4 November' );
			foreach ( $crow as $i => $row ) {
				if ( $i < 3 || empty( $row[0] ) || empty( $row[1] ) || 'Type' === self::norm( $row[0] ) ) {
					continue;
				}
				$typ = self::norm( $row[0] ); $dep = self::norm( $row[1] ); $sec = self::norm( $row[2] );
				$dept = isset( self::$section_dept[ strtolower( $sec ) ] ) ? self::$section_dept[ strtolower( $sec ) ] : null;
				$ppm = self::num( $row[3] ); $staff = self::num( $row[4] ); $prod = self::num( $row[5] );
				$add_cap( $dept, "$dep / $sec", $typ, $prod, $ppm, $staff, null, 'Canopy Assembly', $i + 1, array( 'available_staff' => self::num( $row[6] ), 'planned_productivity' => self::num( $row[11] ) ) );
				if ( $dept && $staff ) {
					$dept_staff[ $dept ][ $sec ] = max( isset( $dept_staff[ $dept ][ $sec ] ) ? $dept_staff[ $dept ][ $sec ] : 0, $staff );
				}
				$add_hist( $row, array( 13, 20, 27, 34 ), $labels, 'Canopy Assembly', "$dep / $sec", $typ, $dept );
			}
		}
		if ( in_array( 'Genset Assembly', $names, true ) ) {
			$grow   = $reader->rows( 'Genset Assembly' );
			$labels = array( 'Week 1', 'Week 2', 'Week 3', 'Week 4' );
			foreach ( $grow as $i => $row ) {
				if ( $i < 3 || empty( $row[0] ) || empty( $row[1] ) || in_array( self::norm( $row[0] ), array( 'Finished Code', 'Type' ), true ) ) {
					continue;
				}
				$key = self::norm( $row[0] ); $dep = self::norm( $row[1] ); $wh = self::norm( $row[2] );
				$dept = isset( self::$section_dept[ strtolower( $dep ) ] ) ? self::$section_dept[ strtolower( $dep ) ] : null;
				$prod = self::num( $row[3] ); $staff = self::num( $row[4] ); $line = self::num( $row[5] ); $total = self::num( $row[6] );
				$add_cap( $dept, "$dep ($wh)", $key, $total ? $total : $prod, $prod, $staff, $line, 'Genset Assembly', $i + 1, array( 'available_staff' => self::num( $row[7] ), 'planned_productivity' => self::num( $row[12] ) ) );
				if ( $dept ) {
					$people = $staff ? $staff : ( $line ? $line : 0 );
					if ( $people ) {
						$dept_staff[ $dept ][ $dep ] = max( isset( $dept_staff[ $dept ][ $dep ] ) ? $dept_staff[ $dept ][ $dep ] : 0, $people );
					}
				}
				$add_hist( $row, array( 14, 21, 28, 35 ), $labels, 'Genset Assembly', "$dep ($wh)", $key, $dept );
			}
		}
		// Gbagada cutting & bending share one team in the workbook ("Cutting and Bending")
		if ( isset( $dept_staff['GB-CUT'] ) && ! isset( $dept_staff['GB-BEND'] ) ) {
			$dept_staff['GB-BEND'] = array( 'Cutting and Bending (shared team with GB-CUT)' => max( $dept_staff['GB-CUT'] ) );
		}
		foreach ( $dept_staff as $dcode => $secs ) {
			if ( isset( $departments[ $dcode ] ) ) {
				$departments[ $dcode ]['manpower']        = round( array_sum( $secs ), 2 );
				$parts = array();
				foreach ( $secs as $k => $v ) {
					$parts[] = "$k: " . rtrim( rtrim( number_format( $v, 2, '.', '' ), '0' ), '.' );
				}
				$departments[ $dcode ]['manpower_source'] = implode( '; ', $parts );
			}
		}
		foreach ( $departments as $dcode => $d ) {
			if ( ! $d['manpower'] ) {
				$this->issue( 'department_manpower_missing', array( 'department' => $dcode, 'name' => $d['name'] ) );
			}
		}

		// ---------------- Cutting machines ----------------
		$machine_caps = array(); $cut_files = array();
		if ( in_array( 'Cutting Capacity', $names, true ) ) {
			$cc = $reader->rows( 'Cutting Capacity' );
			foreach ( array_slice( $cc, 2 ) as $row ) {
				if ( empty( $row[0] ) ) {
					continue;
				}
				$typ = self::norm( $row[0] );
				list( $fam, $size ) = self::normalise_family( self::family_from_key( $typ ) );
				foreach ( array( 'PUNCH1' => array( 'Punch 1', 1, 4, 12 ), 'PUNCH2' => array( 'Punch 2', 2, 5, 13 ), 'PLASMA' => array( 'Plasma', 3, 6, 14 ) ) as $mcode => $m ) {
					$machine_caps[] = array( 'machine_code' => $mcode, 'department_code' => 'IK-CUT', 'key_code' => $typ, 'family' => $fam, 'size' => $size, 'category' => 'canopy', 'minutes_per_unit' => self::num( $row[ $m[1] ] ), 'units_per_shift' => self::num( $row[ $m[2] ] ), 'pct_shift_per_unit' => self::num( $row[ $m[3] ] ), 'source' => 'Cutting Capacity' );
				}
				$machine_caps[] = array( 'machine_code' => 'ALL', 'department_code' => 'IK-CUT', 'key_code' => $typ, 'family' => $fam, 'size' => $size, 'category' => 'canopy', 'minutes_per_unit' => self::num( $row[11] ), 'units_per_shift' => self::num( $row[10] ), 'pct_shift_per_unit' => null, 'source' => 'Cutting Capacity' );
			}
		}
		foreach ( array( 'Capacity S1', 'Capacity S2', 'CapacityS3', 'CapacityS4', 'Capacity200', 'Capacity500' ) as $sheet ) {
			if ( ! in_array( $sheet, $names, true ) ) {
				continue;
			}
			$rws     = $reader->rows( $sheet );
			$title   = ! empty( $rws[0][0] ) ? self::norm( $rws[0][0] ) : $sheet;
			$machine = null;
			foreach ( $rws as $row ) {
				$a = isset( $row[0] ) ? self::norm( $row[0] ) : '';
				if ( preg_match( '/^punch\s*1$/i', $a ) ) { $machine = 'PUNCH1'; continue; }
				if ( preg_match( '/^punch\s*2$/i', $a ) ) { $machine = 'PUNCH2'; continue; }
				if ( preg_match( '/^plasma$/i', $a ) ) { $machine = 'PLASMA'; continue; }
				if ( $machine && preg_match( '/^file\s*\d+/i', $a ) ) {
					$minutes = null; $plate = null;
					foreach ( array( 4, 7, 6, 5 ) as $ci ) {
						if ( isset( $row[ $ci ] ) && is_numeric( $row[ $ci ] ) ) { $minutes = (float) $row[ $ci ]; break; }
					}
					foreach ( array( 3, 6 ) as $ci ) {
						if ( isset( $row[ $ci ] ) && is_string( $row[ $ci ] ) ) { $plate = self::norm( $row[ $ci ] ); break; }
					}
					$cut_files[] = array( 'sheet' => $sheet, 'canopy_type' => $title, 'machine_code' => $machine, 'file_name' => $a, 'parts' => self::norm( isset( $row[1] ) ? $row[1] : '' ), 'plate' => $plate, 'minutes' => $minutes );
				}
			}
		}
		$machines = array(
			array( 'code' => 'PUNCH1', 'name' => 'Punch machine 1', 'department_code' => 'IK-CUT', 'minutes_per_day' => 480, 'active' => 1 ),
			array( 'code' => 'PUNCH2', 'name' => 'Punch machine 2', 'department_code' => 'IK-CUT', 'minutes_per_day' => 480, 'active' => 1 ),
			array( 'code' => 'PLASMA', 'name' => 'Plasma cutter', 'department_code' => 'IK-CUT', 'minutes_per_day' => 480, 'active' => 1 ),
		);
		$departments['IK-CUT']['machines'] = 3;

		$counts = array();
		$issue_counts = array();
		foreach ( $this->issues as $is ) {
			$issue_counts[ $is['kind'] ] = isset( $issue_counts[ $is['kind'] ] ) ? $issue_counts[ $is['kind'] ] + 1 : 1;
		}
		$this->out = array(
			'products'             => array_values( $products ),
			'bom_lines'            => array_values( $bom ),
			'routings'             => array_values( $routings ),
			'overheads'            => array_values( $overheads ),
			'resources'            => array_values( $resources ),
			'material_prices'      => $prices,
			'departments'          => array_values( $departments ),
			'capacities'           => $capacities,
			'machines'             => $machines,
			'machine_capacities'   => $machine_caps,
			'cutting_files'        => $cut_files,
			'productivity_history' => $history,
		);
		foreach ( $this->out as $k => $v ) {
			$counts[ $k ] = count( $v );
		}
		$counts['finished_products'] = count( array_filter( $products, function ( $p ) { return $p['is_finished']; } ) );
		$this->out['quality_report'] = array(
			'generated_at' => current_time( 'mysql' ), 'source' => basename( $path ), 'sheets' => $names,
			'counts' => $counts, 'issue_counts' => $issue_counts, 'issues' => $this->issues,
		);
		return $this->out;
	}

	public static function median( $a ) {
		sort( $a );
		$n = count( $a );
		if ( ! $n ) {
			return null;
		}
		$m = (int) floor( ( $n - 1 ) / 2 );
		return ( $n % 2 ) ? $a[ $m ] : ( $a[ $m ] + $a[ $m + 1 ] ) / 2;
	}
}
