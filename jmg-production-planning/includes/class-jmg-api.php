<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** REST API: /wp-json/jmg/v1/... (cookie auth + nonce). */
class JMG_API {

	const NS = 'jmg/v1';

	private static function can( $cap ) {
		return function() use ( $cap ) { return is_user_logged_in() && current_user_can( $cap ); };
	}

	private static function route( $path, $methods, $cb, $cap = 'jmg_view' ) {
		register_rest_route( self::NS, $path, array( 'methods' => $methods, 'callback' => array( __CLASS__, $cb ), 'permission_callback' => self::can( $cap ) ) );
	}

	public static function register_routes() {
		self::route( '/bootstrap', 'GET', 'bootstrap' );
		self::route( '/products', 'GET', 'products' );
		self::route( '/products/(?P<code>[^/]+)/bom', 'GET', 'product_bom' );
		self::route( '/requests', 'GET', 'requests_list' );
		self::route( '/requests', 'POST', 'requests_create', 'jmg_sales' );
		self::route( '/requests/(?P<id>\d+)', 'PUT', 'requests_update', 'jmg_sales' );
		self::route( '/requests/(?P<id>\d+)/generate', 'POST', 'requests_generate', 'jmg_plan' );
		self::route( '/orders', 'GET', 'orders_list' );
		self::route( '/orders', 'POST', 'orders_create', 'jmg_plan' );
		self::route( '/orders/replan-all', 'POST', 'orders_replan_all', 'jmg_plan' );
		self::route( '/orders/(?P<id>\d+)', 'GET', 'orders_get' );
		self::route( '/orders/(?P<id>\d+)', 'PUT', 'orders_update', 'jmg_plan' );
		self::route( '/orders/(?P<id>\d+)/confirm', 'POST', 'orders_confirm', 'jmg_plan' );
		self::route( '/orders/(?P<id>\d+)/cancel', 'POST', 'orders_cancel', 'jmg_plan' );
		self::route( '/orders/(?P<id>\d+)/replan', 'POST', 'orders_replan', 'jmg_plan' );
		self::route( '/orders/(?P<id>\d+)', 'DELETE', 'orders_delete', 'jmg_plan' );
		self::route( '/tracking/worklist', 'GET', 'tracking_worklist', 'jmg_view' );
		self::route( '/tracking/logs', 'GET', 'tracking_logs' );
		self::route( '/tracking/logs', 'POST', 'tracking_log', 'jmg_track' );
		self::route( '/tracking/logs/(?P<id>\d+)', 'DELETE', 'tracking_log_delete', 'jmg_plan' );
		self::route( '/dashboard', 'GET', 'dashboard' );
		self::route( '/reports/monthly', 'GET', 'report_monthly' );
		self::route( '/gantt', 'GET', 'gantt' );
		self::route( '/alerts', 'GET', 'alerts' );
		self::route( '/alerts/(?P<id>\d+)/ack', 'POST', 'alerts_ack', 'jmg_view' );
		self::route( '/costing/(?P<code>[^/]+)', 'GET', 'costing' );
		self::route( '/prices', 'GET', 'prices_list' );
		self::route( '/prices', 'POST', 'prices_save', 'jmg_cost' );
		self::route( '/masters/sections', 'GET', 'sections_list' );
		self::route( '/masters/sections/(?P<id>\d+)', 'PUT', 'sections_update', 'jmg_admin' );
		self::route( '/masters/capacities/(?P<id>\d+)', 'PUT', 'capacities_update', 'jmg_admin' );
		self::route( '/masters/capacities', 'POST', 'capacities_create', 'jmg_admin' );
		self::route( '/masters/stage-map', 'GET', 'stage_map_list' );
		self::route( '/masters/stage-map/(?P<id>\d+)', 'PUT', 'stage_map_update', 'jmg_admin' );
		self::route( '/masters/series', 'GET', 'series_list' );
		self::route( '/masters/series/(?P<id>\d+)', 'PUT', 'series_update', 'jmg_admin' );
		self::route( '/masters/overrides', 'GET', 'overrides_list' );
		self::route( '/masters/overrides', 'POST', 'overrides_save', 'jmg_admin' );
		self::route( '/masters/overrides/(?P<id>\d+)', 'DELETE', 'overrides_delete', 'jmg_admin' );
		self::route( '/masters/machines', 'GET', 'machines_list' );
		self::route( '/masters/calendar', 'GET', 'calendar_list' );
		self::route( '/masters/calendar', 'POST', 'calendar_save', 'jmg_admin' );
		self::route( '/masters/issues', 'GET', 'issues_list' );
		self::route( '/masters/issues/(?P<id>\d+)', 'PUT', 'issues_update', 'jmg_admin' );
		self::route( '/settings', 'GET', 'settings_get' );
		self::route( '/settings', 'PUT', 'settings_put', 'jmg_admin' );
		self::route( '/admin/import', 'POST', 'admin_import', 'jmg_admin' );
		self::route( '/admin/backup', 'GET', 'admin_backup', 'jmg_admin' );
		self::route( '/admin/restore', 'POST', 'admin_restore', 'jmg_admin' );
		self::route( '/admin/audit', 'GET', 'admin_audit', 'jmg_manage' );
		self::route( '/admin/users', 'GET', 'users_list', 'jmg_admin' );
		self::route( '/admin/users', 'POST', 'users_create', 'jmg_admin' );
		self::route( '/admin/users/(?P<id>\d+)', 'PUT', 'users_update', 'jmg_admin' );
		self::route( '/admin/demo', 'POST', 'admin_demo', 'jmg_admin' );
		self::route( '/inventory/balances', 'GET', 'inv_balances' );
		self::route( '/inventory/ledger', 'GET', 'inv_ledger' );
		self::route( '/inventory/txn', 'POST', 'inv_post', 'jmg_stock' );
		self::route( '/inventory/txn/(?P<id>\d+)/reverse', 'POST', 'inv_reverse', 'jmg_stock' );
		self::route( '/inventory/shortages', 'GET', 'inv_shortages' );
		self::route( '/inventory/valuation', 'GET', 'inv_valuation' );
		self::route( '/inventory/warehouses', 'GET', 'inv_warehouses' );
		self::route( '/inventory/item/(?P<code>[^/]+)', 'GET', 'inv_item' );
	}

	/* ---------------- inventory ---------------- */
	public static function inv_balances( $req ) { return JMG_Inventory::balances( $req->get_params() ); }
	public static function inv_ledger( $req ) { return JMG_Inventory::ledger( $req->get_params() ); }
	public static function inv_post( $req ) { return self::result( JMG_Inventory::post( self::body( $req ) ) ); }
	public static function inv_reverse( $req ) { return self::result( JMG_Inventory::reverse( (int) $req['id'] ) ); }
	public static function inv_shortages( $req ) { return JMG_Inventory::shortages( $req->get_params() ); }
	public static function inv_valuation( $req ) { return JMG_Inventory::valuation(); }
	public static function inv_warehouses( $req ) { return JMG_Inventory::warehouses(); }
	public static function inv_item( $req ) {
		global $wpdb;
		$code = urldecode( $req['code'] );
		$p = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'products' ) . ' WHERE code=%s', $code ), ARRAY_A );
		$oh = JMG_Inventory::on_hand_map();
		$res = JMG_Inventory::reserved_map( 0 );
		return array( 'product' => $p, 'warehouses' => $oh[ $code ] ?? array(), 'on_hand' => array_sum( $oh[ $code ] ?? array() ), 'reserved' => $res[ $code ] ?? 0, 'ledger' => JMG_Inventory::ledger( array( 'item' => $code, 'limit' => 300 ) ), 'used_in' => $wpdb->get_results( $wpdb->prepare( 'SELECT c.order_id, o.order_no, o.status, c.total_qty, c.inventory_qty, c.qty_issued, c.qty_received FROM ' . JMG_DB::table( 'order_components' ) . ' c JOIN ' . JMG_DB::table( 'orders' ) . " o ON o.id=c.order_id WHERE c.component_code=%s AND o.status IN ('CONFIRMED','IN_PROGRESS','DRAFT') ORDER BY o.id DESC LIMIT 50", $code ), ARRAY_A ) );
	}

	private static function body( $req ) {
		$j = $req->get_json_params();
		return is_array( $j ) ? $j : $req->get_params();
	}

	private static function result( $r ) {
		if ( is_wp_error( $r ) ) { return new WP_REST_Response( array( 'error' => $r->get_error_message(), 'code' => $r->get_error_code() ), 'jmg_404' === $r->get_error_code() ? 404 : 400 ); }
		return rest_ensure_response( $r );
	}

	/* ---------------- bootstrap / masters ---------------- */
	public static function bootstrap( $req ) {
		global $wpdb;
		$user = wp_get_current_user();
		$sections = $wpdb->get_results( 'SELECT id, site, department, section_name, stage_key, is_active FROM ' . JMG_DB::table( 'sections' ) . ' ORDER BY site, department, section_name', ARRAY_A );
		$departments = array();
		foreach ( $sections as $s ) { $departments[ $s['site'] . ' / ' . $s['department'] ] = array( 'site' => $s['site'], 'department' => $s['department'] ); }
		$products = $wpdb->get_results( 'SELECT code, description, item_type, category, model_kva FROM ' . JMG_DB::table( 'products' ) . " WHERE is_finished=1 ORDER BY item_type='FINISHED' DESC, code", ARRAY_A );
		return array(
			'user' => array( 'id' => $user->ID, 'login' => $user->user_login, 'name' => $user->display_name, 'roles' => $user->roles, 'role_label' => JMG_Roles::role_label( $user ), 'caps' => JMG_Roles::current_caps(), 'sections' => JMG_Roles::user_sections( $user->ID ) ),
			'settings' => JMG_Settings::all(), 'sections' => $sections, 'departments' => array_values( $departments ), 'products' => $products,
			'today' => JMG_Calendar::today(), 'logout_url' => wp_logout_url( home_url( '/' ) ), 'app_url' => JMG_App::app_url(), 'admin_url' => admin_url(),
			'counts' => array( 'issues' => (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . JMG_DB::table( 'data_issues' ) . ' WHERE is_resolved=0' ), 'alerts' => (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . JMG_DB::table( 'alerts' ) . ' WHERE is_ack=0' ) ),
			'warehouses' => JMG_Inventory::warehouses(),
			'import' => $wpdb->get_row( 'SELECT file_name, created_at, summary FROM ' . JMG_DB::table( 'import_log' ) . ' ORDER BY id DESC LIMIT 1', ARRAY_A ),
			'version' => JMG_PP_VERSION,
		);
	}

	public static function products( $req ) {
		$all = $req->get_param( 'all' );
		return JMG_BOM::search_products( (string) $req->get_param( 'q' ), ! $all, (int) ( $req->get_param( 'limit' ) ?: 300 ) );
	}

	public static function product_bom( $req ) {
		$code = urldecode( $req['code'] );
		$qty = max( 1, (float) ( $req->get_param( 'qty' ) ?: 1 ) );
		$ex = JMG_BOM::explode( $code, $qty );
		$cost = JMG_BOM::cost_rollup( $code, $qty );
		$routing = new JMG_Routing();
		$built = $routing->build( $ex, $qty );
		return array( 'product' => $ex['product'], 'tree' => self::slim_tree( $ex['root'] ), 'components' => $ex['components'], 'issues' => $ex['issues'], 'cost' => $cost, 'ops' => $built['ops'], 'routing_warnings' => $built['warnings'] );
	}

	private static function slim_tree( $n ) {
		$out = array( 'code' => $n['code'] ?? '', 'description' => $n['description'] ?? '', 'kind' => $n['kind'] ?? '', 'qty_per_parent' => $n['qty_per_parent'] ?? 1, 'qty_per_unit' => $n['qty_per_unit'] ?? 1, 'total_qty' => $n['total_qty'] ?? null, 'unit' => $n['unit'] ?? '', 'cost_group' => $n['cost_group'] ?? '', 'level' => $n['level'] ?? 0, 'family' => $n['family'] ?? '', 'bom_incomplete' => $n['bom_incomplete'] ?? 0,
			'materials' => array(), 'ops' => array(), 'children' => array() );
		foreach ( $n['materials'] as $m ) { $out['materials'][] = array( 'code' => $m['code'], 'description' => $m['description'], 'qty_per_parent' => $m['qty_per_parent'], 'qty_per_unit' => $m['qty_per_unit'], 'total_qty' => $m['total_qty'], 'unit' => $m['unit'], 'cost_group' => $m['cost_group'], 'unit_cost' => $m['unit_cost'] ); }
		foreach ( $n['ops'] as $o ) { $out['ops'][] = array( 'code' => $o['code'], 'description' => $o['description'], 'hours' => $o['hours'], 'type3' => $o['type3'], 'rate' => $o['rate'] ); }
		foreach ( $n['children'] as $c ) { $out['children'][] = self::slim_tree( $c ); }
		return $out;
	}

	/* ---------------- requests ---------------- */
	public static function requests_list( $req ) { return JMG_Orders::list_requests( $req->get_params() ); }
	public static function requests_create( $req ) { return self::result( JMG_Orders::create_request( self::body( $req ) ) ); }
	public static function requests_update( $req ) { return self::result( JMG_Orders::update_request( (int) $req['id'], self::body( $req ) ) ); }
	public static function requests_generate( $req ) { $b = self::body( $req ); $b['request_id'] = (int) $req['id']; return self::result( JMG_Orders::generate( $b ) ); }

	/* ---------------- orders ---------------- */
	public static function orders_list( $req ) { return JMG_Orders::list_orders( $req->get_params() ); }
	public static function orders_create( $req ) { return self::result( JMG_Orders::generate( self::body( $req ) ) ); }
	public static function orders_get( $req ) { return self::result( JMG_Orders::get( (int) $req['id'] ) ); }
	public static function orders_update( $req ) { return self::result( JMG_Orders::update_order( (int) $req['id'], self::body( $req ) ) ); }
	public static function orders_confirm( $req ) { return self::result( JMG_Orders::confirm( (int) $req['id'] ) ); }
	public static function orders_cancel( $req ) { $b = self::body( $req ); return self::result( JMG_Orders::cancel( (int) $req['id'], $b['reason'] ?? '' ) ); }
	public static function orders_replan( $req ) {
		$r = JMG_Orders::plan_order( (int) $req['id'] );
		if ( is_wp_error( $r ) ) { return self::result( $r ); }
		JMG_Orders::check_delay_alerts( (int) $req['id'] );
		JMG_Audit::log( 'order_replan', 'order', (int) $req['id'] );
		return self::result( JMG_Orders::get( (int) $req['id'] ) );
	}
	public static function orders_replan_all( $req ) { return array( 'replanned' => JMG_Orders::replan_all() ); }
	public static function orders_delete( $req ) {
		global $wpdb;
		$o = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'orders' ) . ' WHERE id=%d', (int) $req['id'] ), ARRAY_A );
		if ( ! $o ) { return self::result( new WP_Error( 'jmg_404', 'Order not found' ) ); }
		if ( 'DRAFT' !== $o['status'] ) { return self::result( new WP_Error( 'jmg_state', 'Only draft plans can be deleted; cancel confirmed orders instead.' ) ); }
		JMG_Orders::delete_order( $o['id'] );
		if ( $o['request_id'] ) { $wpdb->update( JMG_DB::table( 'requests' ), array( 'status' => 'NEW' ), array( 'id' => $o['request_id'] ) ); }
		JMG_Audit::log( 'order_delete_draft', 'order', $o['id'], array( 'order_no' => $o['order_no'] ) );
		return array( 'deleted' => true );
	}

	/* ---------------- tracking ---------------- */
	public static function tracking_worklist( $req ) {
		$date = $req->get_param( 'date' ) ?: JMG_Calendar::today();
		return JMG_Tracking::section_worklist( (int) $req->get_param( 'section_id' ), $date );
	}
	public static function tracking_logs( $req ) { return JMG_Tracking::list_logs( $req->get_params() ); }
	public static function tracking_log( $req ) { return self::result( JMG_Tracking::log( self::body( $req ) ) ); }
	public static function tracking_log_delete( $req ) { return self::result( JMG_Tracking::delete_log( (int) $req['id'] ) ); }

	/* ---------------- dashboards / reports ---------------- */
	public static function dashboard( $req ) { return JMG_Reports::dashboard( $req->get_params() ); }
	public static function report_monthly( $req ) {
		$month = $req->get_param( 'month' ) ?: current_time( 'Y-m' );
		if ( ! preg_match( '/^\d{4}-\d{2}$/', $month ) ) { return self::result( new WP_Error( 'jmg_validation', 'month must be YYYY-MM' ) ); }
		return JMG_Reports::monthly( $month, (string) $req->get_param( 'category' ) );
	}
	public static function gantt( $req ) { return JMG_Reports::gantt( $req->get_params() ); }
	public static function alerts( $req ) {
		global $wpdb;
		$all = $req->get_param( 'all' );
		return $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'alerts' ) . ( $all ? '' : ' WHERE is_ack=0' ) . ' ORDER BY id DESC LIMIT 200', ARRAY_A );
	}
	public static function alerts_ack( $req ) {
		global $wpdb;
		$wpdb->update( JMG_DB::table( 'alerts' ), array( 'is_ack' => 1, 'ack_by' => get_current_user_id() ), array( 'id' => (int) $req['id'] ) );
		JMG_Audit::log( 'alert_ack', 'alert', (int) $req['id'] );
		return array( 'ok' => true );
	}

	/* ---------------- costing ---------------- */
	public static function costing( $req ) {
		$code = urldecode( $req['code'] );
		$qty = max( 1, (float) ( $req->get_param( 'qty' ) ?: 1 ) );
		return JMG_BOM::cost_rollup( $code, $qty );
	}
	public static function prices_list( $req ) {
		global $wpdb;
		$q = (string) $req->get_param( 'q' ); $type = (string) $req->get_param( 'type' ); $pending = $req->get_param( 'pending' );
		$where = '1=1'; $p = array();
		if ( $q ) { $like = '%' . $wpdb->esc_like( $q ) . '%'; $where .= ' AND (code LIKE %s OR description LIKE %s OR cost_group LIKE %s)'; array_push( $p, $like, $like, $like ); }
		if ( $type ) { $where .= ' AND price_type=%s'; $p[] = $type; }
		if ( $pending ) { $where .= ' AND unit_cost IS NULL'; }
		$sql = 'SELECT * FROM ' . JMG_DB::table( 'prices' ) . " WHERE $where ORDER BY unit_cost IS NULL DESC, code LIMIT 400";
		return $wpdb->get_results( $p ? $wpdb->prepare( $sql, $p ) : $sql, ARRAY_A );
	}
	public static function prices_save( $req ) {
		global $wpdb;
		$b = self::body( $req );
		$code = sanitize_text_field( $b['code'] ?? '' );
		if ( '' === $code ) { return self::result( new WP_Error( 'jmg_validation', 'code required' ) ); }
		$t = JMG_DB::table( 'prices' );
		$row = array( 'unit_cost' => ( '' === ( $b['unit_cost'] ?? '' ) || null === ( $b['unit_cost'] ?? null ) ) ? null : (float) $b['unit_cost'], 'source' => 'manual', 'updated_by' => get_current_user_id(), 'updated_at' => JMG_DB::now() );
		if ( isset( $b['description'] ) ) { $row['description'] = sanitize_text_field( $b['description'] ); }
		if ( isset( $b['price_type'] ) ) { $row['price_type'] = sanitize_text_field( $b['price_type'] ); }
		if ( isset( $b['unit'] ) ) { $row['unit'] = sanitize_text_field( $b['unit'] ); }
		$exists = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE code=%s", $code ) );
		if ( $exists ) { $wpdb->update( $t, $row, array( 'code' => $code ) ); } else { $row['code'] = $code; $wpdb->insert( $t, $row ); }
		JMG_BOM::reset_price_cache();
		JMG_Audit::log( 'price_update', 'price', $code, $row );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE code=%s", $code ), ARRAY_A );
	}

	/* ---------------- masters ---------------- */
	public static function sections_list( $req ) {
		global $wpdb;
		$sections = $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'sections' ) . ' ORDER BY site, department, section_name', ARRAY_A );
		$caps = $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'capacities' ) . ' ORDER BY section_id, id', ARRAY_A );
		$by = array();
		foreach ( $caps as $c ) { $by[ $c['section_id'] ][] = $c; }
		foreach ( $sections as &$s ) { $s['capacities'] = $by[ $s['id'] ] ?? array(); }
		return $sections;
	}
	public static function sections_update( $req ) {
		global $wpdb;
		$b = self::body( $req );
		$u = array();
		foreach ( array( 'section_name', 'department', 'site', 'stage_key', 'notes' ) as $k ) { if ( isset( $b[ $k ] ) ) { $u[ $k ] = sanitize_text_field( $b[ $k ] ); } }
		foreach ( array( 'staffs', 'total_available_staffs', 'new_staffs', 'flow_lines' ) as $k ) { if ( array_key_exists( $k, $b ) ) { $u[ $k ] = '' === $b[ $k ] || null === $b[ $k ] ? null : (float) $b[ $k ]; } }
		foreach ( array( 'machines', 'minutes_per_day', 'excel_shifts', 'is_active' ) as $k ) { if ( isset( $b[ $k ] ) ) { $u[ $k ] = (int) $b[ $k ]; } }
		if ( $u ) { $wpdb->update( JMG_DB::table( 'sections' ), $u, array( 'id' => (int) $req['id'] ) ); }
		JMG_Audit::log( 'section_update', 'section', (int) $req['id'], $u );
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'sections' ) . ' WHERE id=%d', (int) $req['id'] ), ARRAY_A );
	}
	public static function capacities_update( $req ) {
		global $wpdb;
		$b = self::body( $req );
		$u = array();
		foreach ( array( 'productivity_per_shift', 'new_productivity', 'manual_override', 'per_resource', 'staffs', 'prod_lines', 'kva_min', 'kva_max' ) as $k ) { if ( array_key_exists( $k, $b ) ) { $u[ $k ] = ( '' === $b[ $k ] || null === $b[ $k ] ) ? null : (float) $b[ $k ]; } }
		foreach ( array( 'type_code', 'series_key' ) as $k ) { if ( isset( $b[ $k ] ) ) { $u[ $k ] = sanitize_text_field( $b[ $k ] ); } }
		if ( $u ) { $wpdb->update( JMG_DB::table( 'capacities' ), $u, array( 'id' => (int) $req['id'] ) ); }
		JMG_Audit::log( 'capacity_update', 'capacity', (int) $req['id'], $u );
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . JMG_DB::table( 'capacities' ) . ' WHERE id=%d', (int) $req['id'] ), ARRAY_A );
	}
	public static function capacities_create( $req ) {
		global $wpdb;
		$b = self::body( $req );
		if ( empty( $b['section_id'] ) || empty( $b['type_code'] ) ) { return self::result( new WP_Error( 'jmg_validation', 'section_id and type_code required' ) ); }
		$imp = new JMG_Importer();
		list( $series, $kmin, $kmax ) = $imp->classify_type_code( $b['type_code'] );
		$row = array( 'section_id' => (int) $b['section_id'], 'type_code' => sanitize_text_field( $b['type_code'] ), 'series_key' => isset( $b['series_key'] ) ? sanitize_text_field( $b['series_key'] ) : $series, 'kva_min' => isset( $b['kva_min'] ) && '' !== $b['kva_min'] ? (float) $b['kva_min'] : $kmin, 'kva_max' => isset( $b['kva_max'] ) && '' !== $b['kva_max'] ? (float) $b['kva_max'] : $kmax, 'productivity_per_shift' => isset( $b['productivity_per_shift'] ) ? (float) $b['productivity_per_shift'] : null, 'new_productivity' => isset( $b['new_productivity'] ) && '' !== $b['new_productivity'] ? (float) $b['new_productivity'] : null, 'staffs' => isset( $b['staffs'] ) && '' !== $b['staffs'] ? (float) $b['staffs'] : null );
		$wpdb->insert( JMG_DB::table( 'capacities' ), $row );
		$row['id'] = (int) $wpdb->insert_id;
		JMG_Audit::log( 'capacity_create', 'capacity', $row['id'], $row );
		return $row;
	}
	public static function stage_map_list( $req ) {
		global $wpdb;
		return $wpdb->get_results( 'SELECT m.*, s.section_name, s.site FROM ' . JMG_DB::table( 'stage_map' ) . ' m LEFT JOIN ' . JMG_DB::table( 'sections' ) . ' s ON s.id=m.section_id ORDER BY m.workflow_group, m.sequence, m.op_prefix', ARRAY_A );
	}
	public static function stage_map_update( $req ) {
		global $wpdb;
		$b = self::body( $req );
		$u = array();
		foreach ( array( 'stage_name', 'workflow_group', 'department', 'machine_group', 'notes', 'stage_key' ) as $k ) { if ( isset( $b[ $k ] ) ) { $u[ $k ] = sanitize_text_field( $b[ $k ] ); } }
		if ( isset( $b['sequence'] ) ) { $u['sequence'] = (int) $b['sequence']; }
		if ( isset( $b['is_scheduled'] ) ) { $u['is_scheduled'] = (int) $b['is_scheduled']; }
		if ( array_key_exists( 'section_id', $b ) ) { $u['section_id'] = $b['section_id'] ? (int) $b['section_id'] : null; }
		if ( $u ) { $wpdb->update( JMG_DB::table( 'stage_map' ), $u, array( 'id' => (int) $req['id'] ) ); }
		JMG_Audit::log( 'stage_map_update', 'stage_map', (int) $req['id'], $u );
		return array( 'ok' => true );
	}
	public static function series_list( $req ) { global $wpdb; return $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'series' ) . ' ORDER BY kva_min', ARRAY_A ); }
	public static function series_update( $req ) {
		global $wpdb;
		$b = self::body( $req ); $u = array();
		foreach ( array( 'label', 'canopy_cut_series', 'aliases' ) as $k ) { if ( isset( $b[ $k ] ) ) { $u[ $k ] = sanitize_text_field( $b[ $k ] ); } }
		foreach ( array( 'kva_min', 'kva_max' ) as $k ) { if ( array_key_exists( $k, $b ) ) { $u[ $k ] = '' === $b[ $k ] || null === $b[ $k ] ? null : (float) $b[ $k ]; } }
		if ( $u ) { $wpdb->update( JMG_DB::table( 'series' ), $u, array( 'id' => (int) $req['id'] ) ); }
		JMG_Audit::log( 'series_update', 'series', (int) $req['id'], $u );
		return array( 'ok' => true );
	}
	public static function overrides_list( $req ) {
		global $wpdb;
		return $wpdb->get_results( 'SELECT o.*, c.type_code, s.section_name FROM ' . JMG_DB::table( 'capacity_overrides' ) . ' o LEFT JOIN ' . JMG_DB::table( 'capacities' ) . ' c ON c.id=o.capacity_id LEFT JOIN ' . JMG_DB::table( 'sections' ) . ' s ON s.id=c.section_id ORDER BY o.component_code', ARRAY_A );
	}
	public static function overrides_save( $req ) {
		global $wpdb;
		$b = self::body( $req );
		if ( empty( $b['component_code'] ) || empty( $b['stage_key'] ) ) { return self::result( new WP_Error( 'jmg_validation', 'component_code and stage_key required' ) ); }
		$t = JMG_DB::table( 'capacity_overrides' );
		$row = array( 'component_code' => sanitize_text_field( $b['component_code'] ), 'stage_key' => sanitize_text_field( $b['stage_key'] ), 'capacity_id' => ! empty( $b['capacity_id'] ) ? (int) $b['capacity_id'] : null, 'minutes_per_unit' => isset( $b['minutes_per_unit'] ) && '' !== $b['minutes_per_unit'] ? (float) $b['minutes_per_unit'] : null, 'notes' => sanitize_text_field( $b['notes'] ?? '' ) );
		$id = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE component_code=%s AND stage_key=%s", $row['component_code'], $row['stage_key'] ) );
		if ( $id ) { $wpdb->update( $t, $row, array( 'id' => $id ) ); } else { $wpdb->insert( $t, $row ); $id = $wpdb->insert_id; }
		JMG_Audit::log( 'override_save', 'override', $id, $row );
		return array( 'id' => (int) $id );
	}
	public static function overrides_delete( $req ) { global $wpdb; $wpdb->delete( JMG_DB::table( 'capacity_overrides' ), array( 'id' => (int) $req['id'] ) ); JMG_Audit::log( 'override_delete', 'override', (int) $req['id'] ); return array( 'ok' => true ); }
	public static function machines_list( $req ) {
		global $wpdb;
		return array( 'machine_times' => $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'machine_times' ) . ' ORDER BY canopy_series, machine', ARRAY_A ), 'cutting_files' => $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'cutting_files' ) . ' ORDER BY sheet_name, id', ARRAY_A ) );
	}
	public static function calendar_list( $req ) { return array( 'overrides' => JMG_Calendar::list_overrides(), 'working_days' => JMG_Settings::get( 'working_days' ) ); }
	public static function calendar_save( $req ) {
		$b = self::body( $req );
		if ( empty( $b['date'] ) || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $b['date'] ) ) { return self::result( new WP_Error( 'jmg_validation', 'date required' ) ); }
		if ( ! empty( $b['remove'] ) ) { JMG_Calendar::remove_override( $b['date'] ); } else { JMG_Calendar::set_override( $b['date'], ! empty( $b['is_working'] ), sanitize_text_field( $b['note'] ?? '' ) ); }
		JMG_Audit::log( 'calendar_update', 'calendar', $b['date'], $b );
		return JMG_Calendar::list_overrides();
	}
	public static function issues_list( $req ) {
		global $wpdb;
		$all = $req->get_param( 'all' );
		return $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'data_issues' ) . ( $all ? '' : ' WHERE is_resolved=0' ) . ' ORDER BY issue_type, ref_code', ARRAY_A );
	}
	public static function issues_update( $req ) { global $wpdb; $b = self::body( $req ); $wpdb->update( JMG_DB::table( 'data_issues' ), array( 'is_resolved' => ! empty( $b['is_resolved'] ) ? 1 : 0 ), array( 'id' => (int) $req['id'] ) ); return array( 'ok' => true ); }

	/* ---------------- settings ---------------- */
	public static function settings_get( $req ) { return JMG_Settings::all(); }
	public static function settings_put( $req ) {
		$b = self::body( $req );
		$allowed = array_keys( JMG_Settings::defaults() );
		$allowed[] = 'inventory_qty';
		$changed = array();
		foreach ( $b as $k => $v ) {
			if ( ! in_array( $k, $allowed, true ) ) { continue; }
			if ( 'working_days' === $k ) { $v = array_values( array_map( 'intval', (array) $v ) ); }
			elseif ( in_array( $k, array( 'break_minutes', 'net_minutes', 'shifts_per_day', 'inventory_enabled', 'backflush_enabled', 'allow_negative_stock', 'include_overheads', 'horizon_days', 'plan_lead_days' ), true ) ) { $v = (int) $v; }
			elseif ( is_string( $v ) ) { $v = sanitize_text_field( $v ); }
			JMG_Settings::set( $k, $v ); $changed[ $k ] = $v;
		}
		JMG_Audit::log( 'settings_update', 'settings', '', $changed );
		JMG_Calendar::reset_cache();
		return JMG_Settings::all();
	}

	/* ---------------- admin ---------------- */
	public static function admin_import( $req ) {
		$files = $req->get_file_params();
		if ( empty( $files['file']['tmp_name'] ) ) { return self::result( new WP_Error( 'jmg_validation', 'Upload the Excel workbook as "file".' ) ); }
		$name = $files['file']['name'];
		if ( ! preg_match( '/\.xlsx$/i', $name ) ) { return self::result( new WP_Error( 'jmg_validation', 'Only .xlsx workbooks are supported.' ) ); }
		$tmp = $files['file']['tmp_name'];
		try {
			$imp = new JMG_Importer();
			$summary = $imp->import_workbook( $tmp, 'upload' );
			// keep a copy as the current master workbook
			$dir = wp_upload_dir();
			$dest = trailingslashit( $dir['basedir'] ) . 'jmg-production-planning/';
			wp_mkdir_p( $dest );
			@copy( $tmp, $dest . 'current-workbook.xlsx' );
			if ( ! empty( $req->get_param( 'replan' ) ) ) { JMG_Orders::replan_all(); }
			return array( 'summary' => $summary );
		} catch ( Exception $e ) {
			return self::result( new WP_Error( 'jmg_import', $e->getMessage() ) );
		}
	}
	public static function admin_backup( $req ) {
		$data = JMG_Backup::export();
		$resp = new WP_REST_Response( $data );
		$resp->header( 'Content-Disposition', 'attachment; filename="jmg-production-planning-backup-' . gmdate( 'Ymd-His' ) . '.json"' );
		return $resp;
	}
	public static function admin_restore( $req ) {
		$files = $req->get_file_params();
		$data = null;
		if ( ! empty( $files['file']['tmp_name'] ) ) { $data = json_decode( file_get_contents( $files['file']['tmp_name'] ), true ); }
		else { $data = self::body( $req ); }
		return self::result( JMG_Backup::restore( $data ) );
	}
	public static function admin_audit( $req ) { return JMG_Audit::recent( (int) ( $req->get_param( 'limit' ) ?: 300 ), (string) $req->get_param( 'entity' ), (string) $req->get_param( 'entity_id' ) ); }
	public static function users_list( $req ) {
		$out = array();
		foreach ( get_users( array( 'number' => 500 ) ) as $u ) {
			$has = false;
			foreach ( $u->roles as $r ) { if ( 'administrator' === $r || 0 === strpos( $r, 'jmg_' ) ) { $has = true; } }
			if ( ! $has ) { continue; }
			$out[] = array( 'id' => $u->ID, 'login' => $u->user_login, 'name' => $u->display_name, 'email' => $u->user_email, 'roles' => $u->roles, 'role_label' => JMG_Roles::role_label( $u ), 'sections' => JMG_Roles::user_sections( $u->ID ) );
		}
		return array( 'users' => $out, 'roles' => array_merge( array( 'administrator' => array( 'name' => 'Administrator' ) ), JMG_Roles::roles() ) );
	}
	public static function users_create( $req ) {
		$b = self::body( $req );
		$roles = array_keys( JMG_Roles::roles() ); $roles[] = 'administrator';
		if ( empty( $b['login'] ) || empty( $b['email'] ) || empty( $b['role'] ) || ! in_array( $b['role'], $roles, true ) ) { return self::result( new WP_Error( 'jmg_validation', 'login, email and a valid role are required' ) ); }
		$pass = ! empty( $b['password'] ) ? $b['password'] : wp_generate_password( 12 );
		$id = wp_insert_user( array( 'user_login' => sanitize_user( $b['login'] ), 'user_email' => sanitize_email( $b['email'] ), 'user_pass' => $pass, 'display_name' => sanitize_text_field( $b['name'] ?? $b['login'] ), 'role' => $b['role'] ) );
		if ( is_wp_error( $id ) ) { return self::result( $id ); }
		if ( isset( $b['sections'] ) ) { update_user_meta( $id, 'jmg_sections', array_map( 'intval', (array) $b['sections'] ) ); }
		JMG_Audit::log( 'user_create', 'user', $id, array( 'login' => $b['login'], 'role' => $b['role'] ) );
		return array( 'id' => $id, 'password' => $pass );
	}
	public static function users_update( $req ) {
		$b = self::body( $req );
		$u = get_user_by( 'id', (int) $req['id'] );
		if ( ! $u ) { return self::result( new WP_Error( 'jmg_404', 'User not found' ) ); }
		$roles = array_keys( JMG_Roles::roles() ); $roles[] = 'administrator';
		if ( ! empty( $b['role'] ) && in_array( $b['role'], $roles, true ) ) { $u->set_role( $b['role'] ); }
		if ( isset( $b['sections'] ) ) { update_user_meta( $u->ID, 'jmg_sections', array_map( 'intval', (array) $b['sections'] ) ); }
		if ( ! empty( $b['password'] ) ) { wp_set_password( $b['password'], $u->ID ); }
		if ( isset( $b['name'] ) ) { wp_update_user( array( 'ID' => $u->ID, 'display_name' => sanitize_text_field( $b['name'] ) ) ); }
		JMG_Audit::log( 'user_update', 'user', $u->ID, array( 'role' => $b['role'] ?? null, 'sections' => $b['sections'] ?? null ) );
		return array( 'ok' => true );
	}
	public static function admin_demo( $req ) { return JMG_Seed::scenario(); }
}
