<?php
/**
 * Capacity lookup: how many labour-minutes one unit of a product consumes in a
 * department, and the department's daily pool of minutes.
 *
 * Precedence (all values from the workbook unless maintained manually):
 *  1. Productivity row keyed by the exact product code.
 *  2. Productivity row for the same department + product family (+ category).
 *  3. Cutting-machine capacity for the product's canopy size (cutting departments).
 *  4. BOM routing hours (labour hours, else machine hours) x 60.
 */
class PP_Capacity {

	private $caps = array();      // dept => rows
	private $mcaps = array();     // dept => rows (machine 'ALL')
	private $depts;

	public function __construct() {
		$this->depts = PP_Bom::departments();
		foreach ( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'capacities' ) . ' WHERE units_per_day IS NOT NULL AND units_per_day > 0' ) as $r ) {
			$this->caps[ $r['department_code'] ][] = $r;
		}
		foreach ( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'machine_capacities' ) . " WHERE machine_code = 'ALL' AND minutes_per_unit > 0" ) as $r ) {
			$this->mcaps[ $r['department_code'] ][] = $r;
		}
	}

	public function department( $code ) {
		return isset( $this->depts[ $code ] ) ? $this->depts[ $code ] : null;
	}

	/** Daily pool of labour minutes for a department (manpower x minutes/day). */
	public function pool_minutes( $dept_code, $cal_minutes ) {
		$d = $this->department( $dept_code );
		if ( ! $d ) {
			return 0;
		}
		$manpower = (float) $d['manpower'];
		if ( $manpower <= 0 ) {
			$manpower = 1; // flagged in quality report: manpower not in workbook
		}
		return $manpower * $cal_minutes;
	}

	public static function category_of_product( $p ) {
		$t = strtolower( (string) ( $p['product_type'] ?? '' ) );
		if ( 'genset' === $t ) {
			return 'genset';
		}
		if ( 'canopy' === $t ) {
			return 'canopy';
		}
		if ( 'panel' === $t ) {
			return 'panel';
		}
		if ( 'base' === $t || 'tank' === $t ) {
			return 'base';
		}
		$d = strtoupper( (string) ( $p['description'] ?? '' ) );
		if ( strpos( $d, 'CHANNEL' ) !== false || strpos( $d, 'BRACKET' ) !== false ) {
			return 'whitegoods';
		}
		return 'other';
	}

	/**
	 * @return array [minutes_per_unit, units_per_day_cap|null, basis, manpower_required]
	 */
	public function lookup( $dept_code, $product, $labor_hours, $machine_hours ) {
		$d        = $this->department( $dept_code );
		$manpower = $d ? max( 1.0, (float) $d['manpower'] ) : 1.0;
		$mpd      = $d ? (int) $d['minutes_per_day'] : 480;
		$code     = $product['code'];
		$family   = $product['family'] ?? null;
		$size     = $product['canopy_size'] ?? null;
		$cat      = self::category_of_product( $product );
		$rows     = isset( $this->caps[ $dept_code ] ) ? $this->caps[ $dept_code ] : array();

		// 1. exact code
		foreach ( $rows as $r ) {
			if ( strcasecmp( $r['key_code'], $code ) === 0 ) {
				return $this->from_row( $r, $manpower, $mpd, 'Productivity sheet, exact code ' . $r['key_code'] . ' (' . $r['source'] . ')' );
			}
		}
		// 2. family (+category)
		if ( $family ) {
			$fam_rows = array_filter( $rows, function ( $r ) use ( $family, $size ) {
				return ( $r['family'] && strcasecmp( $r['family'], $family ) === 0 ) || ( $size && $r['size'] && strcasecmp( $r['size'], $size ) === 0 && ! $r['family'] );
			} );
			$pick = null;
			foreach ( $fam_rows as $r ) {
				if ( $r['category'] === $cat ) {
					$pick = $r;
					break;
				}
			}
			if ( ! $pick && $fam_rows ) {
				$pick = reset( $fam_rows );
			}
			if ( $pick ) {
				return $this->from_row( $pick, $manpower, $mpd, 'Productivity sheet, family ' . $family . ' via ' . $pick['key_code'] . ' (' . $pick['source'] . ')' );
			}
		}
		// 3. machine capacity (cutting)
		if ( $size && isset( $this->mcaps[ $dept_code ] ) ) {
			foreach ( $this->mcaps[ $dept_code ] as $r ) {
				if ( $r['size'] && strcasecmp( $r['size'], $size ) === 0 ) {
					return array( (float) $r['minutes_per_unit'], $r['units_per_shift'] ? (float) $r['units_per_shift'] : null, 'Cutting Capacity sheet, canopy size ' . $r['key_code'], 1 );
				}
			}
		}
		// 4. routing hours
		if ( $labor_hours > 0 ) {
			return array( round( $labor_hours * 60, 2 ), null, 'BOM routing labour hours (' . round( $labor_hours, 2 ) . ' h/unit)', 1 );
		}
		if ( $machine_hours > 0 ) {
			return array( round( $machine_hours * 60, 2 ), null, 'BOM routing machine hours (' . round( $machine_hours, 2 ) . ' h/unit)', 1 );
		}
		return array( 0, null, 'No capacity or routing data - review master data', 0 );
	}

	private function from_row( $r, $dept_manpower, $mpd, $basis ) {
		$upd   = (float) $r['units_per_day'];
		$staff = (float) $r['staff'] > 0 ? (float) $r['staff'] : ( (float) $r['prod_lines'] > 0 && (float) $r['available_staff'] > 0 ? (float) $r['available_staff'] : $dept_manpower );
		$staff = min( $staff, $dept_manpower ) ?: $dept_manpower;
		$mpu   = round( $staff * $mpd / $upd, 2 );
		return array( $mpu, $upd, $basis . ' = ' . rtrim( rtrim( number_format( $upd, 2, '.', '' ), '0' ), '.' ) . ' units/day with ' . rtrim( rtrim( number_format( $staff, 2, '.', '' ), '0' ), '.' ) . ' staff', $staff );
	}
}
