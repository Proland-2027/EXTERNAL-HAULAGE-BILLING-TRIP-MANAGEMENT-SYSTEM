<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Multi-level BOM explosion and cost roll-up.
 *
 * The workbook BOM is a fully exploded list per finished product: every row carries the finished
 * product code, its direct parent and its quantity per one unit of the parent. Explosion walks the
 * parent/child links, multiplying quantities down each path, so a component needed 2x inside a
 * sub-assembly needed 3x is required 6x per finished unit.
 */
class JMG_BOM {

	private static $price_cache = null;

	/** All BOM rows of a finished product, grouped by parent code. */
	public static function rows_by_parent( $finished_code ) {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'bom_lines' ) . ' WHERE finished_code=%s ORDER BY line_no, id', $finished_code ), ARRAY_A );
		$by = array();
		foreach ( $rows as $r ) {
			if ( 0 === (int) $r['level'] ) { continue; }
			$by[ $r['parent_code'] ][] = $r;
		}
		return $by;
	}

	public static function root_row( $finished_code ) {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'bom_lines' ) . ' WHERE finished_code=%s AND level=0 LIMIT 1', $finished_code ), ARRAY_A );
	}

	public static function prices() {
		if ( null === self::$price_cache ) {
			global $wpdb;
			self::$price_cache = array();
			foreach ( $wpdb->get_results( 'SELECT code, price_type, unit_cost FROM ' . JMG_DB::table( 'prices' ), ARRAY_A ) as $p ) {
				self::$price_cache[ $p['code'] ] = array( 'type' => $p['price_type'], 'cost' => null === $p['unit_cost'] ? null : (float) $p['unit_cost'] );
			}
		}
		return self::$price_cache;
	}

	public static function reset_price_cache() { self::$price_cache = null; }

	/** Component family used by the stage map (base / panel / canopy / genset / any). */
	public static function family( $code, $cost_group ) {
		$c = strtoupper( $code );
		if ( 'SF-BASE' === $cost_group ) { return 'base'; }
		if ( 'SF-PANEL' === $cost_group ) { return 'panel'; }
		if ( 'SF-CANOPY' === $cost_group ) { return 'canopy'; }
		if ( 'SF-EXH' === $cost_group ) { return 'exhaust'; }
		if ( preg_match( '/^(OPT-)?(SFP|BSC)-|^SPG|^MSPG/', $c ) ) { return 'genset'; }
		if ( preg_match( '/BASE|^BT-|HOOK/', $c ) ) { return 'base'; }
		if ( preg_match( '/PNL|RELAY|CBB/', $c ) ) { return 'panel'; }
		return 'any';
	}

	/** Operation prefix of a process resource code: IK-BBD-BM1 -> IK-BBD, GB-EX&DT-1 -> GB-EX&DT. */
	public static function op_prefix( $code ) {
		$parts = explode( '-', strtoupper( trim( $code ) ) );
		return count( $parts ) >= 2 ? $parts[0] . '-' . $parts[1] : $parts[0];
	}

	/**
	 * Explode a finished product.
	 *
	 * @return array {
	 *   root        => product row,
	 *   components  => flat list of nodes (manufactured assemblies, purchased assemblies, materials),
	 *   tree        => nested tree (children arrays),
	 *   issues      => list of strings,
	 * }
	 * Each node: code, description, parent, level, qty_per_parent, qty_per_unit, total_qty, unit, kind,
	 *            cost_group, family, ops (per-unit hours by op code for manufactured nodes), children
	 */
	public static function explode( $finished_code, $qty = 1, $inventory = array() ) {
		global $wpdb;
		$by = self::rows_by_parent( $finished_code );
		$root = self::root_row( $finished_code );
		$product = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'products' ) . ' WHERE code=%s', $finished_code ), ARRAY_A );
		$issues = array();
		if ( ! $root || empty( $by[ $finished_code ] ) ) {
			$issues[] = 'No BOM rows found for ' . $finished_code . '.';
		}
		$components = array();
		$visited = array();
		$tree = self::walk( $finished_code, $finished_code, 1.0, 0, $by, $components, $issues, $visited, $qty, $inventory );
		$tree['code'] = $finished_code;
		$tree['description'] = $product ? $product['description'] : ( $root ? $root['description'] : '' );
		$tree['kind'] = 'finished';
		$tree['qty_per_unit'] = 1.0;
		$tree['total_qty'] = (float) $qty;
		$tree['qty_to_make'] = (float) $qty;
		$tree['level'] = 0;
		$tree['family'] = 'genset';
		$tree['cost_group'] = $root ? $root['cost_group'] : '';
		$tree['unit'] = $root ? $root['unit'] : 'PCS';
		return array( 'root' => $tree, 'product' => $product, 'components' => $components, 'issues' => $issues );
	}

	private static function walk( $finished, $parent, $mult, $level, &$by, &$components, &$issues, &$visited, $qty, $inventory ) {
		$node = array( 'children' => array(), 'ops' => array(), 'materials' => array(), 'overheads' => array() );
		if ( empty( $by[ $parent ] ) ) { return $node; }
		if ( $level > 12 ) { $issues[] = 'BOM deeper than 12 levels at ' . $parent; return $node; }
		foreach ( $by[ $parent ] as $r ) {
			$calc = $r['calc_type'];
			$code = $r['component_code'];
			$q = (float) $r['qty'];
			if ( 'STATUS ITEM' === $r['type1'] ) { continue; }
			if ( 'Process' === $calc ) {
				// hours per one unit of the parent component
				$node['ops'][] = array( 'code' => $code, 'prefix' => self::op_prefix( $code ), 'hours' => $q, 'type3' => $r['type3'], 'description' => $r['description'], 'operation' => $r['operation'], 'rate' => $r['rate'], 'cost_group' => $r['cost_group'] );
				continue;
			}
			if ( 'Rate' === $calc || 'Output unit based' === $calc ) {
				$node['overheads'][] = array( 'code' => $code, 'qty' => $q, 'type3' => $r['type3'], 'rate' => $r['rate'], 'line_cost' => $r['line_cost'], 'description' => $r['description'], 'calc' => $calc );
				continue;
			}
			$per_unit = $mult * $q;
			$child = array(
				'code' => $code, 'description' => $r['description'], 'parent' => $parent, 'level' => (int) $r['level'],
				'qty_per_parent' => $q, 'qty_per_unit' => $per_unit, 'total_qty' => $per_unit * $qty, 'unit' => $r['unit'],
				'cost_group' => $r['cost_group'], 'family' => self::family( $code, $r['cost_group'] ), 'warehouse' => $r['warehouse'],
				'unit_cost' => $r['unit_cost'], 'erp_cost' => $r['erp_cost_per_unit'], 'kind' => 'material', 'children' => array(), 'ops' => array(), 'materials' => array(), 'overheads' => array(),
			);
			if ( 'BOM' === $calc ) {
				$key = $parent . '>' . $code;
				if ( isset( $visited[ $key ] ) ) { continue; }
				$visited[ $key ] = true;
				$sub = self::walk( $finished, $code, $per_unit, $level + 1, $by, $components, $issues, $visited, $qty, $inventory );
				$child = array_merge( $child, array( 'children' => $sub['children'], 'ops' => $sub['ops'], 'materials' => $sub['materials'], 'overheads' => $sub['overheads'] ) );
				$has_rows = ! empty( $by[ $code ] );
				if ( ! $has_rows ) {
					$child['kind'] = 'purchased_assembly';
					$issues[] = 'Sub-assembly ' . $code . ' (' . $r['description'] . ') has no component rows in the BOM; treated as a purchased/kitted item and flagged for the administrator.';
					$child['bom_incomplete'] = 1;
				} else {
					$child['kind'] = ! empty( $sub['ops'] ) ? 'assembly' : 'purchased_assembly';
				}
				$inv = isset( $inventory[ $code ] ) ? (float) $inventory[ $code ] : 0.0;
				$child['inventory_qty'] = $inv;
				$child['qty_to_make'] = max( 0.0, $child['total_qty'] - $inv );
				$components[] = self::strip( $child );
				$node['children'][] = $child;
			} else {
				$node['materials'][] = $child;
				$components[] = self::strip( $child );
			}
		}
		return $node;
	}

	private static function strip( $node ) {
		$n = $node;
		unset( $n['children'], $n['materials'], $n['overheads'], $n['ops'] );
		$n['has_ops'] = ! empty( $node['ops'] );
		$n['op_count'] = count( $node['ops'] );
		return $n;
	}

	/**
	 * Cost roll-up for one finished unit. Leaf rows are costed once; sub-assembly rows are never
	 * costed themselves, so multi-level BOMs are not double counted.
	 */
	public static function cost_rollup( $finished_code, $qty = 1 ) {
		$ex = self::explode( $finished_code, 1 );
		$prices = self::prices();
		$include_oh = (int) JMG_Settings::get( 'include_overheads', 1 );
		$basis = JMG_Settings::get( 'cost_basis', 'unit_cost' );
		$tot = array( 'material' => 0.0, 'labor' => 0.0, 'machine' => 0.0, 'overhead' => 0.0, 'pending_items' => array(), 'lines' => array(), 'assemblies' => array(), 'basis' => $basis );
		self::cost_node( $ex['root'], 1.0, $prices, $tot, $include_oh, $finished_code, $basis );
		$tot['total'] = $tot['material'] + $tot['labor'] + $tot['machine'] + ( $include_oh ? $tot['overhead'] : 0 );
		$tot['pending_count'] = count( array_unique( $tot['pending_items'] ) );
		$tot['pending_items'] = array_values( array_unique( $tot['pending_items'] ) );
		$tot['cost_status'] = $tot['pending_count'] > 0 ? 'Cost Pending' : 'Costed';
		$root = self::root_row( $finished_code );
		$tot['erp_total'] = $root ? (float) $root['erp_cost_per_unit'] : null;
		$tot['qty'] = (float) $qty;
		$tot['order_total'] = $tot['total'] * $qty;
		$tot['issues'] = $ex['issues'];
		return $tot;
	}

	private static function cost_node( $node, $mult, $prices, &$tot, $include_oh, $finished, $basis = 'unit_cost' ) {
		$asm = array( 'code' => $node['code'], 'description' => $node['description'] ?? '', 'level' => $node['level'] ?? 0, 'parent' => $node['parent'] ?? '', 'qty_per_unit' => $mult, 'material' => 0.0, 'labor' => 0.0, 'machine' => 0.0, 'overhead' => 0.0, 'pending' => 0, 'kind' => $node['kind'] ?? 'assembly' );
		foreach ( $node['materials'] as $m ) {
			$per_unit = $m['qty_per_unit'];
			$price = isset( $prices[ $m['code'] ] ) ? $prices[ $m['code'] ]['cost'] : null;
			if ( 'erp' === $basis ) {
				// Workbook "Cost per unit" column = ERP line cost per one parent unit.
				$price = ( null !== $m['erp_cost'] && $m['qty_per_parent'] > 0 ) ? (float) $m['erp_cost'] / (float) $m['qty_per_parent'] : null;
			}
			$line = array( 'code' => $m['code'], 'description' => $m['description'], 'parent' => $m['parent'], 'level' => $m['level'], 'qty_per_parent' => $m['qty_per_parent'], 'qty_per_unit' => $per_unit, 'unit' => $m['unit'], 'unit_cost' => $price, 'ext_cost' => null, 'kind' => 'material', 'cost_group' => $m['cost_group'] );
			if ( null === $price ) {
				$tot['pending_items'][] = $m['code'];
				$asm['pending']++;
			} else {
				$line['ext_cost'] = $per_unit * $price;
				$tot['material'] += $line['ext_cost'];
				$asm['material'] += $line['ext_cost'];
			}
			$tot['lines'][] = $line;
		}
		foreach ( $node['ops'] as $op ) {
			$hours = $op['hours'] * $mult;
			$rate = isset( $prices[ $op['code'] ] ) ? $prices[ $op['code'] ]['cost'] : ( null !== $op['rate'] ? (float) $op['rate'] : null );
			$kind = 'MCH OVH' === $op['type3'] ? 'machine' : 'labor';
			$line = array( 'code' => $op['code'], 'description' => $op['description'], 'parent' => $node['code'], 'level' => ( $node['level'] ?? 0 ) + 1, 'qty_per_parent' => $op['hours'], 'qty_per_unit' => $hours, 'unit' => 'HR', 'unit_cost' => $rate, 'ext_cost' => null, 'kind' => $kind, 'cost_group' => $op['cost_group'] );
			if ( null === $rate ) { $tot['pending_items'][] = $op['code']; $asm['pending']++; }
			else { $line['ext_cost'] = $hours * $rate; $tot[ $kind ] += $line['ext_cost']; $asm[ $kind ] += $line['ext_cost']; }
			$tot['lines'][] = $line;
		}
		foreach ( $node['overheads'] as $oh ) {
			if ( 'Output unit based' === $oh['calc'] ) {
				$amt = ( null !== $oh['line_cost'] ? (float) $oh['line_cost'] : 0 ) * $mult;
			} else {
				$rate = isset( $prices[ $oh['code'] ] ) ? $prices[ $oh['code'] ]['cost'] : ( null !== $oh['rate'] ? (float) $oh['rate'] : 0 );
				$amt = $oh['qty'] * $mult * (float) $rate;
			}
			$tot['overhead'] += $amt; $asm['overhead'] += $amt;
			$tot['lines'][] = array( 'code' => $oh['code'], 'description' => $oh['description'], 'parent' => $node['code'], 'level' => ( $node['level'] ?? 0 ) + 1, 'qty_per_parent' => $oh['qty'], 'qty_per_unit' => $oh['qty'] * $mult, 'unit' => 'Output unit based' === $oh['calc'] ? 'UNIT' : 'HR', 'unit_cost' => null, 'ext_cost' => $amt, 'kind' => 'overhead', 'cost_group' => $oh['type3'] );
		}
		foreach ( $node['children'] as $child ) {
			$sub = self::cost_node( $child, $child['qty_per_unit'], $prices, $tot, $include_oh, $finished, $basis );
			$asm['material'] += $sub['material']; $asm['labor'] += $sub['labor']; $asm['machine'] += $sub['machine']; $asm['overhead'] += $sub['overhead']; $asm['pending'] += $sub['pending'];
		}
		$asm['total'] = $asm['material'] + $asm['labor'] + $asm['machine'] + ( $include_oh ? $asm['overhead'] : 0 );
		$tot['assemblies'][] = $asm;
		return $asm;
	}

	/** Searchable product list. */
	public static function search_products( $q = '', $finished_only = true, $limit = 200 ) {
		global $wpdb;
		$t = JMG_DB::table( 'products' );
		$where = $finished_only ? 'is_finished=1' : '1=1';
		$params = array();
		if ( '' !== $q ) { $where .= ' AND (code LIKE %s OR description LIKE %s)'; $like = '%' . $wpdb->esc_like( $q ) . '%'; $params[] = $like; $params[] = $like; }
		$params[] = (int) $limit;
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE $where ORDER BY item_type='FINISHED' DESC, code LIMIT %d", $params ), ARRAY_A );
	}
}
