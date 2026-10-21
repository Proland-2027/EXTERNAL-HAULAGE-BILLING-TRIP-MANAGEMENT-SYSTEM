<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Inventory process.
 *
 * A stock ledger (jmg_stock_txns) records every movement: RECEIPT (purchase / opening stock),
 * ISSUE (to a production order), PRODUCTION (completed units received from the shop floor),
 * ADJUSTMENT / COUNT (stock take), TRANSFER (between warehouses), RETURN (back from production).
 * Stock on hand is the sum of movements per item and warehouse. Available stock = on hand minus
 * the quantity allocated to other confirmed orders and not yet issued. Planning allocates available
 * stock to semi-finished and raw-material requirements (netting); daily production receives
 * completed components into stock and backflushes the materials and sub-assemblies they consumed.
 */
class JMG_Inventory {

	const TYPES = array( 'RECEIPT', 'ISSUE', 'PRODUCTION', 'ADJUSTMENT', 'COUNT', 'TRANSFER', 'RETURN' );

	public static function default_warehouse() {
		return (string) ( JMG_Settings::get( 'default_warehouse', 'MAIN' ) ?: 'MAIN' );
	}

	/** Warehouse of an item: the product master (workbook) warehouse, else the default. */
	public static function item_warehouse( $code ) {
		global $wpdb;
		$wh = $wpdb->get_var( $wpdb->prepare( 'SELECT warehouse FROM ' . JMG_DB::table( 'products' ) . ' WHERE code=%s', $code ) );
		return $wh ? $wh : self::default_warehouse();
	}

	public static function warehouses() {
		global $wpdb;
		$a = $wpdb->get_col( 'SELECT DISTINCT warehouse FROM ' . JMG_DB::table( 'stock_txns' ) . " WHERE warehouse<>'' ORDER BY warehouse" );
		$b = $wpdb->get_col( 'SELECT DISTINCT warehouse FROM ' . JMG_DB::table( 'products' ) . " WHERE warehouse<>'' ORDER BY warehouse" );
		$all = array_values( array_unique( array_merge( array( self::default_warehouse() ), (array) $a, (array) $b ) ) );
		sort( $all );
		return $all;
	}

	/* ---------------------------------------------------------------- balances */

	/** On-hand quantities: code => warehouse => qty (all items with any movement). */
	public static function on_hand_map() {
		global $wpdb;
		$rows = $wpdb->get_results( 'SELECT item_code, warehouse, SUM(qty) q FROM ' . JMG_DB::table( 'stock_txns' ) . ' GROUP BY item_code, warehouse', ARRAY_A );
		$m = array();
		foreach ( $rows as $r ) { $m[ $r['item_code'] ][ $r['warehouse'] ] = round( (float) $r['q'], 4 ); }
		return $m;
	}

	public static function on_hand( $code, $wh = null ) {
		global $wpdb;
		if ( $wh ) { return (float) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(SUM(qty),0) FROM ' . JMG_DB::table( 'stock_txns' ) . ' WHERE item_code=%s AND warehouse=%s', $code, $wh ) ); }
		return (float) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(SUM(qty),0) FROM ' . JMG_DB::table( 'stock_txns' ) . ' WHERE item_code=%s', $code ) );
	}

	/** Quantity allocated to open orders and not yet issued: code => qty. */
	public static function reserved_map( $exclude_order_id = 0 ) {
		global $wpdb;
		// claim on stock = external allocation + own units received, less what has been issued already
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT c.component_code, SUM(CASE WHEN c.inventory_qty + c.qty_received - c.qty_issued > 0 THEN c.inventory_qty + c.qty_received - c.qty_issued ELSE 0 END) q FROM ' . JMG_DB::table( 'order_components' ) . ' c JOIN ' . JMG_DB::table( 'orders' ) . " o ON o.id=c.order_id WHERE o.status IN ('CONFIRMED','IN_PROGRESS') AND o.id<>%d GROUP BY c.component_code", (int) $exclude_order_id ), ARRAY_A );
		$m = array();
		foreach ( $rows as $r ) { $m[ $r['component_code'] ] = max( 0, round( (float) $r['q'], 4 ) ); }
		return $m;
	}

	/** Available-for-planning quantities (on hand across warehouses minus reservations of other orders). */
	public static function availability_map( $exclude_order_id = 0 ) {
		$oh = self::on_hand_map();
		$res = self::reserved_map( $exclude_order_id );
		$out = array();
		foreach ( $oh as $code => $whs ) {
			$tot = array_sum( $whs );
			$avail = $tot - ( $res[ $code ] ?? 0 );
			if ( $avail > 0.0005 ) { $out[ $code ] = round( $avail, 4 ); }
		}
		return $out;
	}

	/** Stock on hand list for the UI. */
	public static function balances( $f = array() ) {
		global $wpdb;
		$oh = self::on_hand_map();
		$res = self::reserved_map( 0 );
		$prices = JMG_BOM::prices();
		$codes = array_keys( $oh );
		// include items with reservations but no stock (shortages)
		foreach ( $res as $c => $q ) { if ( ! isset( $oh[ $c ] ) ) { $codes[] = $c; } }
		$codes = array_values( array_unique( $codes ) );
		$meta = array();
		if ( $codes ) {
			$in = implode( ',', array_fill( 0, count( $codes ), '%s' ) );
			foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT code, description, item_type, unit, cost_group, warehouse FROM ' . JMG_DB::table( 'products' ) . " WHERE code IN ($in)", $codes ), ARRAY_A ) as $p ) { $meta[ $p['code'] ] = $p; }
		}
		$out = array();
		foreach ( $codes as $code ) {
			$whs = $oh[ $code ] ?? array();
			$tot = array_sum( $whs );
			$m = $meta[ $code ] ?? array( 'description' => '', 'item_type' => '', 'unit' => '', 'cost_group' => '', 'warehouse' => '' );
			$price = isset( $prices[ $code ] ) ? $prices[ $code ]['cost'] : null;
			$row = array( 'code' => $code, 'description' => $m['description'], 'item_type' => $m['item_type'], 'unit' => $m['unit'], 'cost_group' => $m['cost_group'], 'warehouses' => $whs, 'on_hand' => round( $tot, 4 ), 'reserved' => $res[ $code ] ?? 0, 'available' => round( $tot - ( $res[ $code ] ?? 0 ), 4 ), 'unit_cost' => $price, 'value' => null === $price ? null : round( $tot * $price, 2 ) );
			if ( ! empty( $f['q'] ) ) { $q = strtolower( $f['q'] ); if ( false === strpos( strtolower( $code . ' ' . $m['description'] . ' ' . $m['cost_group'] ), $q ) ) { continue; } }
			if ( ! empty( $f['warehouse'] ) && ! isset( $whs[ $f['warehouse'] ] ) ) { continue; }
			if ( ! empty( $f['type'] ) && $m['item_type'] !== $f['type'] ) { continue; }
			if ( ! empty( $f['negative'] ) && $row['available'] >= 0 ) { continue; }
			$out[] = $row;
		}
		usort( $out, function( $a, $b ) { return strcmp( $a['code'], $b['code'] ); } );
		return $out;
	}

	/* ---------------------------------------------------------------- ledger */

	public static function ledger( $f = array() ) {
		global $wpdb;
		$t = JMG_DB::table( 'stock_txns' );
		$w = '1=1'; $p = array();
		if ( ! empty( $f['item'] ) ) { $w .= ' AND item_code=%s'; $p[] = $f['item']; }
		if ( ! empty( $f['warehouse'] ) ) { $w .= ' AND warehouse=%s'; $p[] = $f['warehouse']; }
		if ( ! empty( $f['type'] ) ) { $w .= ' AND txn_type=%s'; $p[] = $f['type']; }
		if ( ! empty( $f['order_id'] ) ) { $w .= ' AND order_id=%d'; $p[] = (int) $f['order_id']; }
		if ( ! empty( $f['from'] ) ) { $w .= ' AND txn_date>=%s'; $p[] = $f['from']; }
		if ( ! empty( $f['to'] ) ) { $w .= ' AND txn_date<=%s'; $p[] = $f['to']; }
		if ( ! empty( $f['q'] ) ) { $like = '%' . $wpdb->esc_like( $f['q'] ) . '%'; $w .= ' AND (item_code LIKE %s OR description LIKE %s OR reference LIKE %s)'; array_push( $p, $like, $like, $like ); }
		$sql = "SELECT * FROM $t WHERE $w ORDER BY txn_date DESC, id DESC LIMIT " . (int) ( $f['limit'] ?? 500 );
		return $wpdb->get_results( $p ? $wpdb->prepare( $sql, $p ) : $sql, ARRAY_A );
	}

	/**
	 * Post a stock movement. $d: txn_type, item_code, warehouse, qty (positive number), txn_date,
	 * reference, reason, unit_cost, to_warehouse (TRANSFER), counted_qty (COUNT), order_id/order_no/op_id.
	 */
	public static function post( $d, $system = false ) {
		global $wpdb;
		$type = strtoupper( trim( (string) ( $d['txn_type'] ?? '' ) ) );
		if ( ! in_array( $type, self::TYPES, true ) ) { return new WP_Error( 'jmg_validation', 'Unknown transaction type ' . $type ); }
		$code = JMG_Importer::clean_code( $d['item_code'] ?? '' );
		if ( '' === $code ) { return new WP_Error( 'jmg_validation', 'Item code is required.' ); }
		$product = $wpdb->get_row( $wpdb->prepare( 'SELECT code, description, unit, warehouse FROM ' . JMG_DB::table( 'products' ) . ' WHERE code=%s', $code ), ARRAY_A );
		if ( ! $product && ! $system ) { return new WP_Error( 'jmg_validation', 'Unknown item code ' . $code . '. Add it to the product master first.' ); }
		$wh = trim( (string) ( $d['warehouse'] ?? '' ) ) ?: ( $product ? ( $product['warehouse'] ?: self::default_warehouse() ) : self::default_warehouse() );
		$date = ! empty( $d['txn_date'] ) ? $d['txn_date'] : JMG_Calendar::today();
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date ) ) { return new WP_Error( 'jmg_validation', 'Invalid date.' ); }
		$qty = (float) ( $d['qty'] ?? 0 );
		if ( 'COUNT' === $type ) {
			$counted = (float) ( $d['counted_qty'] ?? 0 );
			$qty = $counted - self::on_hand( $code, $wh );
			if ( abs( $qty ) < 0.00005 ) { return new WP_Error( 'jmg_validation', 'Counted quantity equals stock on hand; nothing to adjust.' ); }
		} elseif ( 'ADJUSTMENT' === $type ) {
			if ( 0 == $qty ) { return new WP_Error( 'jmg_validation', 'Quantity is required (positive to add, negative to remove).' ); }
		} else {
			if ( $qty <= 0 ) { return new WP_Error( 'jmg_validation', 'Quantity must be greater than zero.' ); }
			if ( in_array( $type, array( 'ISSUE', 'TRANSFER' ), true ) ) { $qty = -$qty; }
		}
		if ( in_array( $type, array( 'ISSUE', 'TRANSFER' ), true ) && ! $system && ! (int) JMG_Settings::get( 'allow_negative_stock', 0 ) ) {
			$oh = self::on_hand( $code, $wh );
			if ( $oh + $qty < -0.00005 ) { return new WP_Error( 'jmg_validation', sprintf( 'Only %s of %s on hand in %s; cannot issue %s. Enable negative stock in Settings or receive stock first.', rtrim( rtrim( number_format( $oh, 2, '.', '' ), '0' ), '.' ), $code, $wh, rtrim( rtrim( number_format( -$qty, 2, '.', '' ), '0' ), '.' ) ) ); }
		}
		$prices = JMG_BOM::prices();
		$unit_cost = isset( $d['unit_cost'] ) && '' !== $d['unit_cost'] && null !== $d['unit_cost'] ? (float) $d['unit_cost'] : ( isset( $prices[ $code ] ) ? $prices[ $code ]['cost'] : null );
		$user = wp_get_current_user();
		$row = array(
			'txn_date' => $date, 'item_code' => $code, 'description' => $product ? $product['description'] : (string) ( $d['description'] ?? '' ), 'warehouse' => $wh, 'txn_type' => $type, 'qty' => round( $qty, 4 ), 'unit' => $product ? $product['unit'] : (string) ( $d['unit'] ?? '' ),
			'unit_cost' => $unit_cost, 'reference' => sanitize_text_field( $d['reference'] ?? '' ), 'order_id' => ! empty( $d['order_id'] ) ? (int) $d['order_id'] : null, 'order_no' => sanitize_text_field( $d['order_no'] ?? '' ), 'op_id' => ! empty( $d['op_id'] ) ? (int) $d['op_id'] : null,
			'reason' => sanitize_text_field( $d['reason'] ?? '' ), 'is_system' => $system ? 1 : 0, 'created_by' => $user && $user->ID ? $user->ID : null, 'created_at' => JMG_DB::now(),
		);
		$wpdb->insert( JMG_DB::table( 'stock_txns' ), $row );
		$row['id'] = (int) $wpdb->insert_id;
		if ( 'TRANSFER' === $type ) {
			$to = trim( (string) ( $d['to_warehouse'] ?? '' ) );
			if ( '' === $to || $to === $wh ) { $wpdb->delete( JMG_DB::table( 'stock_txns' ), array( 'id' => $row['id'] ) ); return new WP_Error( 'jmg_validation', 'A different destination warehouse is required for a transfer.' ); }
			$in = $row; unset( $in['id'] ); $in['warehouse'] = $to; $in['qty'] = -$qty; $in['reason'] = trim( 'Transfer from ' . $wh . '. ' . $in['reason'] );
			$wpdb->insert( JMG_DB::table( 'stock_txns' ), $in );
			$row['to_warehouse'] = $to;
		}
		if ( ! $system ) { JMG_Audit::log( 'stock_' . strtolower( $type ), 'stock', $code, array( 'qty' => $row['qty'], 'warehouse' => $wh, 'reference' => $row['reference'] ) ); }
		return $row;
	}

	public static function reverse( $id ) {
		global $wpdb;
		$t = JMG_DB::table( 'stock_txns' );
		$r = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id=%d", $id ), ARRAY_A );
		if ( ! $r ) { return new WP_Error( 'jmg_404', 'Transaction not found' ); }
		if ( (int) $r['is_system'] ) { return new WP_Error( 'jmg_state', 'Movements generated by production tracking are reversed by undoing the daily log.' ); }
		$rev = $r; unset( $rev['id'] ); $rev['qty'] = -(float) $r['qty']; $rev['reason'] = 'Reversal of #' . $id . '. ' . $r['reason']; $rev['created_at'] = JMG_DB::now(); $rev['created_by'] = get_current_user_id();
		$wpdb->insert( $t, $rev );
		JMG_Audit::log( 'stock_reverse', 'stock', $r['item_code'], array( 'txn' => $id ) );
		return array( 'id' => (int) $wpdb->insert_id );
	}

	/* ---------------------------------------------------------------- production integration */

	/**
	 * Backflush for a daily log: when the operation is the final scheduled stage of its component,
	 * receive the good units into stock and issue the materials / sub-assemblies consumed (good + rejected).
	 */
	public static function backflush( $order, $op, $good, $rejected, $date, $log_id ) {
		global $wpdb;
		if ( ! (int) JMG_Settings::get( 'inventory_enabled', 1 ) || ! (int) JMG_Settings::get( 'backflush_enabled', 1 ) ) { return array(); }
		$last = $wpdb->get_var( $wpdb->prepare( 'SELECT MAX(sequence) FROM ' . JMG_DB::table( 'order_ops' ) . ' WHERE order_id=%d AND component_code=%s AND is_scheduled=1', $order['id'], $op['component_code'] ) );
		if ( null === $last || (int) $op['sequence'] !== (int) $last ) { return array(); }
		$moves = array();
		$consumed = $good + $rejected;
		$ref = 'Log #' . $log_id . ' ' . $op['stage_name'];
		if ( $good > 0 ) {
			$r = self::post( array( 'txn_type' => 'PRODUCTION', 'item_code' => $op['component_code'], 'qty' => $good, 'txn_date' => $date, 'reference' => $ref, 'order_id' => $order['id'], 'order_no' => $order['order_no'], 'op_id' => $op['id'], 'reason' => 'Completed at ' . $op['section_name'] ), true );
			if ( ! is_wp_error( $r ) ) { $moves[] = $r; $wpdb->query( $wpdb->prepare( 'UPDATE ' . JMG_DB::table( 'order_components' ) . ' SET qty_received = qty_received + %f WHERE order_id=%d AND component_code=%s', $good, $order['id'], $op['component_code'] ) ); }
		}
		if ( $consumed > 0 ) {
			$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT component_code, qty, calc_type, type1 FROM ' . JMG_DB::table( 'bom_lines' ) . " WHERE finished_code=%s AND parent_code=%s AND calc_type IN ('Item','BOM') AND type1<>'STATUS ITEM'", $order['product_code'], $op['component_code'] ), ARRAY_A );
			foreach ( $rows as $b ) {
				$q = (float) $b['qty'] * $consumed;
				if ( $q <= 0 ) { continue; }
				$r = self::post( array( 'txn_type' => 'ISSUE', 'item_code' => $b['component_code'], 'qty' => $q, 'txn_date' => $date, 'reference' => $ref, 'order_id' => $order['id'], 'order_no' => $order['order_no'], 'op_id' => $op['id'], 'reason' => 'Backflush for ' . $op['component_code'] ), true );
				if ( ! is_wp_error( $r ) ) { $moves[] = $r; $wpdb->query( $wpdb->prepare( 'UPDATE ' . JMG_DB::table( 'order_components' ) . ' SET qty_issued = qty_issued + %f WHERE order_id=%d AND component_code=%s AND parent_code=%s', $q, $order['id'], $b['component_code'], $op['component_code'] ) ); }
			}
		}
		return $moves;
	}

	/** Reverse the movements of a daily log (undo). */
	public static function reverse_log( $log_id, $order_id ) {
		global $wpdb;
		$t = JMG_DB::table( 'stock_txns' );
		$ref = 'Log #' . (int) $log_id . ' %';
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE order_id=%d AND reference LIKE %s AND is_system=1", $order_id, $ref ), ARRAY_A );
		foreach ( $rows as $r ) {
			if ( 'PRODUCTION' === $r['txn_type'] ) { $wpdb->query( $wpdb->prepare( 'UPDATE ' . JMG_DB::table( 'order_components' ) . ' SET qty_received = GREATEST(0, qty_received - %f) WHERE order_id=%d AND component_code=%s', (float) $r['qty'], $order_id, $r['item_code'] ) ); }
			elseif ( 'ISSUE' === $r['txn_type'] ) { $wpdb->query( $wpdb->prepare( 'UPDATE ' . JMG_DB::table( 'order_components' ) . ' SET qty_issued = GREATEST(0, qty_issued - %f) WHERE order_id=%d AND component_code=%s', -(float) $r['qty'], $order_id, $r['item_code'] ) ); }
			$wpdb->delete( $t, array( 'id' => $r['id'] ) );
		}
		return count( $rows );
	}

	/* ---------------------------------------------------------------- requirements / shortages */

	/** Material and semi-finished requirements of open orders versus stock: the purchase / shortage list. */
	public static function shortages( $f = array() ) {
		global $wpdb;
		$rows = $wpdb->get_results( 'SELECT c.component_code, c.description, c.unit, c.comp_kind, c.cost_group, o.order_no, o.id order_id, o.planned_start, c.total_qty, c.inventory_qty, c.qty_issued, c.qty_to_make, c.unit_cost FROM ' . JMG_DB::table( 'order_components' ) . ' c JOIN ' . JMG_DB::table( 'orders' ) . " o ON o.id=c.order_id WHERE o.status IN ('CONFIRMED','IN_PROGRESS') AND c.comp_kind IN ('material','purchased_assembly') ORDER BY c.component_code, o.planned_start", ARRAY_A );
		$oh = self::on_hand_map();
		$items = array();
		foreach ( $rows as $r ) {
			$code = $r['component_code'];
			if ( ! isset( $items[ $code ] ) ) { $items[ $code ] = array( 'code' => $code, 'description' => $r['description'], 'unit' => $r['unit'], 'cost_group' => $r['cost_group'], 'required' => 0, 'allocated' => 0, 'issued' => 0, 'shortage' => 0, 'on_hand' => array_sum( $oh[ $code ] ?? array() ), 'unit_cost' => $r['unit_cost'], 'orders' => array(), 'needed_by' => null ); }
			$it = &$items[ $code ];
			$it['required'] += (float) $r['total_qty']; $it['allocated'] += (float) $r['inventory_qty']; $it['issued'] += (float) $r['qty_issued'];
			$short = max( 0, (float) $r['total_qty'] - (float) $r['inventory_qty'] );
			$it['shortage'] += $short;
			$it['orders'][] = array( 'order_no' => $r['order_no'], 'order_id' => $r['order_id'], 'required' => (float) $r['total_qty'], 'allocated' => (float) $r['inventory_qty'], 'issued' => (float) $r['qty_issued'], 'shortage' => $short, 'needed_by' => $r['planned_start'] );
			if ( $short > 0 && ( null === $it['needed_by'] || ( $r['planned_start'] && $r['planned_start'] < $it['needed_by'] ) ) ) { $it['needed_by'] = $r['planned_start']; }
			unset( $it );
		}
		$out = array_values( $items );
		foreach ( $out as &$it ) { $it['purchase_value'] = null === $it['unit_cost'] ? null : round( $it['shortage'] * (float) $it['unit_cost'], 2 ); }
		unset( $it );
		if ( ! empty( $f['shortage_only'] ) ) { $out = array_values( array_filter( $out, function( $i ) { return $i['shortage'] > 0.0005; } ) ); }
		usort( $out, function( $a, $b ) { return ( $b['shortage'] <=> $a['shortage'] ) ?: strcmp( $a['code'], $b['code'] ); } );
		return $out;
	}

	public static function valuation() {
		$rows = self::balances();
		$by = array(); $total = 0; $pending = 0;
		foreach ( $rows as $r ) {
			$k = $r['item_type'] ?: 'OTHER';
			if ( ! isset( $by[ $k ] ) ) { $by[ $k ] = array( 'item_type' => $k, 'items' => 0, 'qty' => 0, 'value' => 0, 'unpriced' => 0 ); }
			$by[ $k ]['items']++; $by[ $k ]['qty'] += $r['on_hand'];
			if ( null === $r['value'] ) { $by[ $k ]['unpriced']++; $pending++; } else { $by[ $k ]['value'] += $r['value']; $total += $r['value']; }
		}
		return array( 'total_value' => round( $total, 2 ), 'unpriced_items' => $pending, 'by_type' => array_values( $by ), 'items' => count( $rows ) );
	}

	/** Movement summary for a period (dashboard / monthly report). */
	public static function movements( $from, $to ) {
		global $wpdb;
		return $wpdb->get_results( $wpdb->prepare( 'SELECT txn_type, COUNT(*) n, SUM(CASE WHEN qty>0 THEN qty ELSE 0 END) qty_in, SUM(CASE WHEN qty<0 THEN -qty ELSE 0 END) qty_out, SUM(qty*COALESCE(unit_cost,0)) value FROM ' . JMG_DB::table( 'stock_txns' ) . ' WHERE txn_date BETWEEN %s AND %s GROUP BY txn_type ORDER BY txn_type', $from, $to ), ARRAY_A );
	}
}
