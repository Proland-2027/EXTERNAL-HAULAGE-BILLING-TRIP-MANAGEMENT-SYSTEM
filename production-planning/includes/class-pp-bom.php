<?php
/**
 * Multi-level BOM explosion and routing derivation.
 */
class PP_Bom {

	private static $product_cache = array();
	private static $lines_cache   = array();
	private static $routing_cache = array();
	private static $dept_cache    = null;
	private static $res_cache     = null;

	public static function reset_cache() {
		self::$product_cache = array();
		self::$lines_cache   = array();
		self::$routing_cache = array();
		self::$dept_cache    = null;
		self::$res_cache     = null;
	}

	public static function product( $code ) {
		if ( ! array_key_exists( $code, self::$product_cache ) ) {
			self::$product_cache[ $code ] = PP_Db::row( 'SELECT * FROM ' . PP_Db::t( 'products' ) . ' WHERE code = %s', $code );
		}
		return self::$product_cache[ $code ];
	}

	public static function lines( $parent ) {
		if ( ! isset( self::$lines_cache[ $parent ] ) ) {
			self::$lines_cache[ $parent ] = PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'bom_lines' ) . ' WHERE parent_code = %s ORDER BY line_no, id', $parent );
		}
		return self::$lines_cache[ $parent ];
	}

	public static function routing( $parent ) {
		if ( ! isset( self::$routing_cache[ $parent ] ) ) {
			self::$routing_cache[ $parent ] = PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'routings' ) . ' WHERE parent_code = %s ORDER BY id', $parent );
		}
		return self::$routing_cache[ $parent ];
	}

	public static function departments() {
		if ( null === self::$dept_cache ) {
			self::$dept_cache = array();
			foreach ( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'departments' ) . ' ORDER BY stage_order, code' ) as $d ) {
				self::$dept_cache[ $d['code'] ] = $d;
			}
		}
		return self::$dept_cache;
	}

	public static function resources() {
		if ( null === self::$res_cache ) {
			self::$res_cache = array();
			foreach ( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'resources' ) ) as $r ) {
				self::$res_cache[ $r['code'] ] = $r;
			}
		}
		return self::$res_cache;
	}

	/**
	 * Explode a product. Returns:
	 *  nodes: component orders keyed by code => [code, description, qty, level, parents[], product]
	 *  materials: raw materials keyed by code => [code, description, uom, qty, used_in[]]
	 *  tree: nested structure for display
	 *  warnings
	 * Quantities honour opening stock when $use_stock is true (stock netted at each level).
	 */
	public static function explode( $code, $qty, $use_stock = false ) {
		$nodes     = array();
		$materials = array();
		$warnings  = array();
		$order     = array();
		$product   = self::product( $code );
		if ( ! $product ) {
			throw new RuntimeException( "Unknown product code $code" );
		}
		$tree = self::walk( $code, (float) $qty, 0, null, $nodes, $materials, $warnings, $order, array(), $use_stock );
		// level = longest path depth (children must be made before parents)
		$levels = array();
		foreach ( $order as $c ) {
			$levels[ $c ] = $nodes[ $c ]['level'];
		}
		return array(
			'product'   => $product,
			'qty'       => (float) $qty,
			'nodes'     => $nodes,
			'order'     => $order, // codes in dependency order (children before parents)
			'materials' => $materials,
			'tree'      => $tree,
			'warnings'  => $warnings,
		);
	}

	private static function walk( $code, $qty, $level, $parent, &$nodes, &$materials, &$warnings, &$order, $path, $use_stock ) {
		$p = self::product( $code );
		if ( ! $p ) {
			$warnings[] = "Component $code is not in the product master.";
			return null;
		}
		if ( in_array( $code, $path, true ) ) {
			$warnings[] = "Circular BOM reference detected at $code (path: " . implode( ' > ', $path ) . '); ignored.';
			return null;
		}
		$path[] = $code;
		$net    = $qty;
		if ( $use_stock && (float) $p['stock_qty'] > 0 ) {
			$net = max( 0, $qty - (float) $p['stock_qty'] );
		}
		if ( ! isset( $nodes[ $code ] ) ) {
			$nodes[ $code ] = array(
				'code'        => $code,
				'description' => $p['description'],
				'kind'        => $p['kind'],
				'product_type'=> $p['product_type'],
				'family'      => $p['family'],
				'canopy_size' => $p['canopy_size'],
				'qty'         => 0,
				'gross_qty'   => 0,
				'level'       => $level,
				'parents'     => array(),
				'has_routing' => count( self::routing( $code ) ) > 0,
				'children'    => array(),
			);
		}
		$nodes[ $code ]['qty']       += $net;
		$nodes[ $code ]['gross_qty'] += $qty;
		$nodes[ $code ]['level']      = max( $nodes[ $code ]['level'], $level );
		if ( $parent && ! in_array( $parent, $nodes[ $code ]['parents'], true ) ) {
			$nodes[ $code ]['parents'][] = $parent;
		}
		$node = array( 'code' => $code, 'description' => $p['description'], 'qty' => $qty, 'net_qty' => $net, 'level' => $level, 'kind' => $p['kind'], 'children' => array(), 'materials' => array() );
		if ( $net > 0 ) {
			foreach ( self::lines( $code ) as $ln ) {
				$cq = (float) $ln['qty'] * $net;
				if ( $cq <= 0 ) {
					continue;
				}
				if ( 'BOM' === $ln['calc_type'] ) {
					$child = self::walk( $ln['component_code'], $cq, $level + 1, $code, $nodes, $materials, $warnings, $order, $path, $use_stock );
					if ( $child ) {
						$child['qty_per']   = (float) $ln['qty'];
						$node['children'][] = $child;
						if ( ! in_array( $ln['component_code'], $nodes[ $code ]['children'], true ) ) {
							$nodes[ $code ]['children'][] = $ln['component_code'];
						}
					}
				} else {
					$mc = $ln['component_code'];
					if ( ! isset( $materials[ $mc ] ) ) {
						$mp = self::product( $mc );
						$materials[ $mc ] = array( 'code' => $mc, 'description' => $mp ? $mp['description'] : '', 'uom' => $ln['uom'], 'qty' => 0, 'used_in' => array(), 'cost_group' => $ln['cost_group'] );
					}
					$materials[ $mc ]['qty'] += $cq;
					if ( ! in_array( $code, $materials[ $mc ]['used_in'], true ) ) {
						$materials[ $mc ]['used_in'][] = $code;
					}
					$node['materials'][] = array( 'code' => $mc, 'description' => $materials[ $mc ]['description'], 'qty_per' => (float) $ln['qty'], 'qty' => $cq, 'uom' => $ln['uom'] );
				}
			}
		}
		// register in dependency order after children
		$idx = array_search( $code, $order, true );
		if ( false !== $idx ) {
			unset( $order[ $idx ] );
			$order = array_values( $order );
		}
		$order[] = $code;
		return $node;
	}

	/**
	 * Operations for one manufactured item: routing grouped by department in stage order.
	 * Returns list of [department_code, department, labor_hours, machine_hours, resources[]].
	 */
	public static function operations( $code ) {
		$depts = self::departments();
		$res   = self::resources();
		$ops   = array();
		foreach ( self::routing( $code ) as $rt ) {
			$r    = isset( $res[ $rt['resource_code'] ] ) ? $res[ $rt['resource_code'] ] : null;
			$dept = $r && $r['department_code'] ? $r['department_code'] : null;
			if ( ! $dept || ! isset( $depts[ $dept ] ) ) {
				continue;
			}
			if ( ! isset( $ops[ $dept ] ) ) {
				$ops[ $dept ] = array( 'department_code' => $dept, 'department' => $depts[ $dept ], 'labor_hours' => 0.0, 'machine_hours' => 0.0, 'resources' => array() );
			}
			if ( 'labor' === $rt['kind'] ) {
				$ops[ $dept ]['labor_hours'] += (float) $rt['hours_per_unit'];
			} else {
				$ops[ $dept ]['machine_hours'] += (float) $rt['hours_per_unit'];
			}
			$ops[ $dept ]['resources'][] = array( 'code' => $rt['resource_code'], 'name' => $r['name'], 'kind' => $rt['kind'], 'hours' => (float) $rt['hours_per_unit'], 'rate_per_hour' => $r['rate_per_hour'] );
		}
		$ops = array_values( $ops );
		usort(
			$ops,
			function ( $a, $b ) {
				$d = (int) $a['department']['stage_order'] - (int) $b['department']['stage_order'];
				return $d ?: strcmp( $a['department_code'], $b['department_code'] );
			}
		);
		foreach ( $ops as $i => &$op ) {
			$op['seq']            = $i + 1;
			$op['operation_name'] = PP_Workbook_Importer::$stages[ $op['department']['stage'] ][1] . ' - ' . $op['department']['name'];
		}
		return $ops;
	}
}
