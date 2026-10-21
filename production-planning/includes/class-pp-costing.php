<?php
/**
 * BOM costing: multi-level roll-up of material, direct labour, machine and
 * overhead cost without double counting. Missing prices are flagged, never
 * silently treated as zero in the "complete" indicator.
 */
class PP_Costing {

	private $prices = null;

	private function prices() {
		if ( null === $this->prices ) {
			$this->prices = array();
			foreach ( PP_Db::rows( 'SELECT material_code, unit_price, source, uom, description FROM ' . PP_Db::t( 'material_prices' ) ) as $r ) {
				$this->prices[ $r['material_code'] ] = $r;
			}
		}
		return $this->prices;
	}

	public function price( $code ) {
		$p = $this->prices();
		return isset( $p[ $code ] ) ? $p[ $code ] : null;
	}

	/**
	 * Cost one unit of a product (recursive). Returns a breakdown with lines.
	 */
	public function cost_unit( $code, $path = array() ) {
		$product = PP_Bom::product( $code );
		$out     = array(
			'code' => $code, 'description' => $product ? $product['description'] : '', 'material' => 0.0, 'labor' => 0.0,
			'machine' => 0.0, 'overhead' => 0.0, 'total' => 0.0, 'std_cost' => $product ? (float) $product['std_cost'] : null,
			'complete' => true, 'missing_prices' => array(), 'missing_routing' => array(), 'materials' => array(), 'components' => array(), 'operations' => array(), 'overheads' => array(),
		);
		if ( ! $product || in_array( $code, $path, true ) ) {
			return $out;
		}
		$path[] = $code;
		$prices = $this->prices();
		foreach ( PP_Bom::lines( $code ) as $ln ) {
			$q = (float) $ln['qty'];
			if ( 'BOM' === $ln['calc_type'] ) {
				$child = $this->cost_unit( $ln['component_code'], $path );
				$out['components'][] = array( 'code' => $ln['component_code'], 'description' => $child['description'], 'qty_per' => $q, 'unit_cost' => $child['total'], 'extended' => $child['total'] * $q, 'complete' => $child['complete'], 'breakdown' => $child );
				$out['material'] += $child['material'] * $q;
				$out['labor']    += $child['labor'] * $q;
				$out['machine']  += $child['machine'] * $q;
				$out['overhead'] += $child['overhead'] * $q;
				if ( ! $child['complete'] ) {
					$out['complete']       = false;
					$out['missing_prices'] = array_unique( array_merge( $out['missing_prices'], $child['missing_prices'] ) );
				}
				$out['missing_routing'] = array_values( array_unique( array_merge( $out['missing_routing'], $child['missing_routing'] ) ) );
			} else {
				$mc    = $ln['component_code'];
				$pr    = isset( $prices[ $mc ] ) ? $prices[ $mc ] : null;
				$price = $pr && null !== $pr['unit_price'] && '' !== $pr['unit_price'] ? (float) $pr['unit_price'] : null;
				$ext   = null === $price ? null : $price * $q;
				$mp    = PP_Bom::product( $mc );
				$out['materials'][] = array( 'code' => $mc, 'description' => $mp ? $mp['description'] : ( $pr ? $pr['description'] : '' ), 'qty_per' => $q, 'uom' => $ln['uom'], 'unit_price' => $price, 'extended' => $ext, 'price_source' => $pr ? $pr['source'] : 'missing', 'cost_group' => $ln['cost_group'] );
				if ( null === $price ) {
					$out['complete']         = false;
					$out['missing_prices'][] = $mc;
				} else {
					$out['material'] += $ext;
				}
			}
		}
		$ops = PP_Bom::operations( $code );
		foreach ( $ops as $op ) {
			foreach ( $op['resources'] as $r ) {
				$rate = null === $r['rate_per_hour'] ? null : (float) $r['rate_per_hour'];
				$cost = null === $rate ? 0 : $rate * $r['hours'];
				if ( 'labor' === $r['kind'] ) {
					$out['labor'] += $cost;
				} else {
					$out['machine'] += $cost;
				}
				$out['operations'][] = array( 'department_code' => $op['department_code'], 'department' => $op['department']['name'], 'resource' => $r['code'], 'name' => $r['name'], 'kind' => $r['kind'], 'hours' => $r['hours'], 'rate_per_hour' => $rate, 'cost' => $cost );
			}
		}
		if ( ! $ops && count( PP_Bom::lines( $code ) ) ) {
			$out['missing_routing'][] = $code;
		}
		foreach ( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'overheads' ) . ' WHERE parent_code = %s', $code ) as $oh ) {
			$cost = (float) $oh['std_cost'];
			$out['overhead'] += $cost;
			$out['overheads'][] = array( 'resource' => $oh['resource_code'], 'name' => $oh['name'], 'kind' => $oh['kind'], 'hours' => (float) $oh['hours'], 'rate_per_hour' => $oh['rate_per_hour'], 'cost' => $cost );
		}
		$out['total'] = $out['material'] + $out['labor'] + $out['machine'] + $out['overhead'];
		return $out;
	}

	/** Cost summary for a quantity (per unit x qty) plus flattened material list. */
	public function cost_product( $code, $qty ) {
		$unit = $this->cost_unit( $code );
		$qty  = (float) $qty;
		$x    = PP_Bom::explode( $code, $qty );
		$mats = array();
		$missing = array();
		foreach ( $x['materials'] as $m ) {
			$pr    = $this->price( $m['code'] );
			$price = $pr && null !== $pr['unit_price'] && '' !== $pr['unit_price'] ? (float) $pr['unit_price'] : null;
			$mats[] = array( 'code' => $m['code'], 'description' => $m['description'], 'uom' => $m['uom'], 'qty' => round( $m['qty'], 4 ), 'unit_price' => $price, 'cost' => null === $price ? null : round( $price * $m['qty'], 2 ), 'price_status' => null === $price ? 'missing' : $pr['source'], 'used_in' => $m['used_in'], 'cost_group' => $m['cost_group'] );
			if ( null === $price ) {
				$missing[] = $m['code'];
			}
		}
		usort( $mats, function ( $a, $b ) { return ( $b['cost'] ?? 0 ) <=> ( $a['cost'] ?? 0 ); } );
		return array(
			'code' => $code, 'description' => $unit['description'], 'qty' => $qty,
			'unit' => array( 'material' => round( $unit['material'], 2 ), 'labor' => round( $unit['labor'], 2 ), 'machine' => round( $unit['machine'], 2 ), 'overhead' => round( $unit['overhead'], 2 ), 'total' => round( $unit['total'], 2 ), 'std_cost' => $unit['std_cost'] ),
			'total' => array( 'material' => round( $unit['material'] * $qty, 2 ), 'labor' => round( $unit['labor'] * $qty, 2 ), 'machine' => round( $unit['machine'] * $qty, 2 ), 'overhead' => round( $unit['overhead'] * $qty, 2 ), 'total' => round( $unit['total'] * $qty, 2 ) ),
			'complete' => $unit['complete'], 'missing_prices' => array_values( array_unique( $missing ) ), 'missing_routing' => array_values( array_unique( $unit['missing_routing'] ) ),
			'materials' => $mats, 'breakdown' => $unit,
		);
	}

	/** Actual cost collected so far for a plan (labour from production entries, material if recorded). */
	public static function actual_cost( $plan_id ) {
		$rates = array();
		foreach ( PP_Db::rows( 'SELECT department_code, AVG(rate_per_hour) AS r FROM ' . PP_Db::t( 'resources' ) . " WHERE kind = 'labor' AND rate_per_hour IS NOT NULL GROUP BY department_code" ) as $r ) {
			$rates[ $r['department_code'] ] = (float) $r['r'];
		}
		$entries = PP_Db::rows( 'SELECT e.*, w.minutes_per_unit FROM ' . PP_Db::t( 'production_entries' ) . ' e JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = e.wo_id WHERE w.plan_id = %d', $plan_id );
		$labor_minutes = 0; $labor_cost = 0; $downtime = 0;
		foreach ( $entries as $e ) {
			$mins = (float) $e['good_qty'] * (float) $e['minutes_per_unit'];
			if ( null !== $e['manpower'] && (float) $e['manpower'] > 0 ) {
				$mins = (float) $e['manpower'] * max( 0, 480 - (int) $e['downtime_minutes'] );
			}
			$labor_minutes += $mins;
			$rate = isset( $rates[ $e['department_code'] ] ) ? $rates[ $e['department_code'] ] : 0;
			$labor_cost += $mins / 60 * $rate;
			$downtime   += (int) $e['downtime_minutes'];
		}
		$mat = PP_Db::var( 'SELECT SUM(actual_material_cost) FROM ' . PP_Db::t( 'production_orders' ) . ' WHERE plan_id = %d', $plan_id );
		return array( 'labor_minutes' => round( $labor_minutes ), 'labor_cost' => round( $labor_cost, 2 ), 'material_cost' => null === $mat ? null : (float) $mat, 'downtime_minutes' => $downtime, 'entries' => count( $entries ) );
	}
}
