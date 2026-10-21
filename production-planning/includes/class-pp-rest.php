<?php
/**
 * REST API: /wp-json/pp/v1/...
 */
class PP_Rest {

	const NS = 'pp/v1';

	public static function register_routes() {
		$r = function ( $route, $methods, $cb, $cap = 'pp_view' ) {
			register_rest_route(
				self::NS,
				$route,
				array(
					'methods'             => $methods,
					'callback'            => function ( WP_REST_Request $req ) use ( $cb ) {
						try {
							PP_Bom::reset_cache();
							$out = call_user_func( array( 'PP_Rest', $cb ), $req );
							if ( $out instanceof WP_REST_Response || $out instanceof WP_Error ) {
								return $out;
							}
							return rest_ensure_response( $out );
						} catch ( Exception $e ) {
							return new WP_Error( 'pp_error', $e->getMessage(), array( 'status' => 400 ) );
						} catch ( Error $e ) {
							return new WP_Error( 'pp_fatal', 'Internal error: ' . $e->getMessage(), array( 'status' => 500 ) );
						}
					},
					'permission_callback' => function () use ( $cap ) {
						return is_user_logged_in() && current_user_can( $cap );
					},
				)
			);
		};
		$r( '/bootstrap', 'GET', 'bootstrap' );
		$r( '/products', 'GET', 'products' );
		$r( '/products/(?P<code>[^/]+)', 'GET', 'product' );
		$r( '/products/(?P<code>[^/]+)', 'POST', 'save_product', 'pp_admin' );
		$r( '/products', 'POST', 'save_product', 'pp_admin' );
		$r( '/bom/(?P<code>[^/]+)', 'GET', 'bom' );
		$r( '/bom/(?P<code>[^/]+)/explode', 'GET', 'explode' );
		$r( '/bom-line', 'POST', 'save_bom_line', 'pp_admin' );
		$r( '/bom-line/(?P<id>\d+)', 'DELETE', 'delete_bom_line', 'pp_admin' );
		$r( '/routing-line', 'POST', 'save_routing_line', 'pp_admin' );
		$r( '/routing-line/(?P<id>\d+)', 'DELETE', 'delete_routing_line', 'pp_admin' );
		$r( '/departments', 'GET', 'departments' );
		$r( '/departments/(?P<code>[^/]+)', 'POST', 'save_department', 'pp_admin' );
		$r( '/resources', 'GET', 'resources' );
		$r( '/resources/(?P<code>[^/]+)', 'POST', 'save_resource', 'pp_admin' );
		$r( '/capacities', 'GET', 'capacities' );
		$r( '/capacities', 'POST', 'save_capacity', 'pp_admin' );
		$r( '/capacities/(?P<id>\d+)', 'DELETE', 'delete_capacity', 'pp_admin' );
		$r( '/machines', 'GET', 'machines' );
		$r( '/prices', 'GET', 'prices', 'pp_view' );
		$r( '/prices/(?P<code>.+)', 'POST', 'save_price', 'pp_cost' );
		$r( '/calendar', 'GET', 'calendar' );
		$r( '/calendar', 'POST', 'save_calendar', 'pp_admin' );
		$r( '/settings', 'POST', 'save_settings', 'pp_admin' );
		$r( '/requests', 'GET', 'requests' );
		$r( '/requests', 'POST', 'create_request', 'pp_sales' );
		$r( '/requests/(?P<id>\d+)', 'GET', 'request' );
		$r( '/requests/(?P<id>\d+)', 'POST', 'update_request', 'pp_sales' );
		$r( '/requests/(?P<id>\d+)/cancel', 'POST', 'cancel_request', 'pp_plan' );
		$r( '/requests/(?P<id>\d+)/generate', 'POST', 'generate', 'pp_plan' );
		$r( '/plans/(?P<id>\d+)', 'GET', 'plan' );
		$r( '/plans/(?P<id>\d+)/confirm', 'POST', 'confirm', 'pp_plan' );
		$r( '/plans/(?P<id>\d+)/reforecast', 'POST', 'reforecast', 'pp_plan' );
		$r( '/reforecast-all', 'POST', 'reforecast_all', 'pp_plan' );
		$r( '/orders', 'GET', 'orders' );
		$r( '/orders/(?P<id>\d+)', 'GET', 'order' );
		$r( '/orders/(?P<id>\d+)', 'POST', 'update_order', 'pp_cost' );
		$r( '/work-orders', 'GET', 'work_orders' );
		$r( '/work-orders/(?P<id>\d+)', 'GET', 'work_order' );
		$r( '/work-orders/(?P<id>\d+)/start', 'POST', 'wo_start', 'pp_supervise' );
		$r( '/work-orders/(?P<id>\d+)/complete', 'POST', 'wo_complete', 'pp_supervise' );
		$r( '/entries', 'GET', 'entries' );
		$r( '/entries', 'POST', 'create_entry', 'pp_supervise' );
		$r( '/transfers', 'GET', 'transfers' );
		$r( '/transfers', 'POST', 'create_transfer', 'pp_supervise' );
		$r( '/transfers/(?P<id>\d+)/receive', 'POST', 'receive_transfer', 'pp_supervise' );
		$r( '/transfers/(?P<id>\d+)/cancel', 'POST', 'cancel_transfer', 'pp_supervise' );
		$r( '/wip', 'GET', 'wip' );
		$r( '/dashboard', 'GET', 'dashboard' );
		$r( '/daily', 'GET', 'daily' );
		$r( '/reports/monthly', 'GET', 'monthly' );
		$r( '/gantt', 'GET', 'gantt' );
		$r( '/costing/(?P<code>[^/]+)', 'GET', 'costing' );
		$r( '/alerts', 'GET', 'alerts' );
		$r( '/alerts/(?P<id>\d+)/ack', 'POST', 'ack_alert' );
		$r( '/audit', 'GET', 'audit', 'pp_manage' );
		$r( '/quality-report', 'GET', 'quality_report' );
		$r( '/import', 'POST', 'import', 'pp_admin' );
		$r( '/users', 'GET', 'users', 'pp_admin' );
		$r( '/users', 'POST', 'save_user', 'pp_admin' );
		$r( '/demo/reset', 'POST', 'demo_reset', 'pp_admin' );
		$r( '/demo/users', 'POST', 'demo_users', 'pp_admin' );
		$r( '/export/(?P<what>[a-z-]+)', 'GET', 'export' );
		$r( '/history', 'GET', 'history' );
	}

	private static function p( $req, $key, $default = null ) {
		$v = $req->get_param( $key );
		return ( null === $v || '' === $v ) ? $default : $v;
	}

	private static function body( $req ) {
		$b = $req->get_json_params();
		if ( ! is_array( $b ) || ! $b ) {
			$b = $req->get_params();
		}
		return $b;
	}

	/* ---------------- bootstrap & master data ---------------- */

	public static function bootstrap( $req ) {
		$user = wp_get_current_user();
		return array(
			'user'        => array( 'id' => $user->ID, 'login' => $user->user_login, 'name' => $user->display_name, 'roles' => PP_Roles::role_label( $user ), 'caps' => PP_Roles::user_caps( $user ), 'departments' => PP_Roles::user_departments( $user->ID ) ),
			'settings'    => PP_Db::settings(),
			'departments' => array_values( PP_Bom::departments() ),
			'stages'      => PP_Workbook_Importer::$stages,
			'products'    => PP_Db::rows( 'SELECT code, description, product_type, family, canopy_size, kind, is_finished, sellable, std_cost FROM ' . PP_Db::t( 'products' ) . " WHERE kind = 'FG' AND active = 1 ORDER BY is_finished DESC, product_type, code" ),
			'today'       => PP_Db::today(),
			'last_import' => get_option( 'pp_last_import' ),
			'alerts_open' => (int) PP_Db::var( 'SELECT COUNT(*) FROM ' . PP_Db::t( 'alerts' ) . ' WHERE acknowledged_at IS NULL' ),
			'version'     => PP_VERSION,
			'logout_url'  => wp_logout_url( home_url( '/' ) ),
			'admin_url'   => admin_url(),
		);
	}

	public static function products( $req ) {
		$q    = self::p( $req, 'q' );
		$kind = self::p( $req, 'kind' );
		$where = array( '1=1' ); $args = array();
		if ( $kind ) { $where[] = 'kind = %s'; $args[] = $kind; }
		if ( $q ) { $where[] = '(code LIKE %s OR description LIKE %s)'; $args[] = '%' . $q . '%'; $args[] = '%' . $q . '%'; }
		if ( self::p( $req, 'finished' ) ) { $where[] = 'is_finished = 1'; }
		$limit = (int) self::p( $req, 'limit', 300 );
		return PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'products' ) . ' WHERE ' . implode( ' AND ', $where ) . " ORDER BY kind, is_finished DESC, code LIMIT $limit", ...$args );
	}

	public static function product( $req ) {
		$code = urldecode( $req['code'] );
		$p    = PP_Bom::product( $code );
		if ( ! $p ) { throw new RuntimeException( 'Product not found.' ); }
		$p['bom']       = self::bom( $req );
		$p['routing']   = PP_Bom::routing( $code );
		$p['operations']= PP_Bom::operations( $code );
		$p['used_in']   = PP_Db::rows( 'SELECT b.parent_code, p.description, b.qty FROM ' . PP_Db::t( 'bom_lines' ) . ' b LEFT JOIN ' . PP_Db::t( 'products' ) . ' p ON p.code = b.parent_code WHERE b.component_code = %s ORDER BY b.parent_code', $code );
		$p['overheads'] = PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'overheads' ) . ' WHERE parent_code = %s', $code );
		return $p;
	}

	public static function save_product( $req ) {
		$b    = self::body( $req );
		$code = isset( $req['code'] ) ? urldecode( $req['code'] ) : ( $b['code'] ?? '' );
		$code = trim( (string) $code );
		if ( '' === $code ) { throw new RuntimeException( 'Product code is required.' ); }
		$fields = array( 'description', 'kind', 'product_type', 'family', 'canopy_size', 'uom', 'std_cost', 'is_finished', 'sellable', 'active', 'stock_qty', 'notes' );
		$data = array();
		foreach ( $fields as $f ) { if ( array_key_exists( $f, $b ) ) { $data[ $f ] = is_array( $b[ $f ] ) ? null : $b[ $f ]; } }
		foreach ( array( 'is_finished', 'sellable', 'active' ) as $f ) { if ( isset( $data[ $f ] ) ) { $data[ $f ] = (int) (bool) $data[ $f ]; } }
		$data['updated_at'] = PP_Db::now();
		$existing = PP_Bom::product( $code );
		if ( $existing ) {
			PP_Db::update( 'products', $data, array( 'code' => $code ) );
		} else {
			$data['code'] = $code; $data['source'] = 'manual';
			if ( empty( $data['kind'] ) ) { $data['kind'] = 'SF'; }
			PP_Db::insert( 'products', $data );
		}
		PP_Db::audit( $existing ? 'product_updated' : 'product_created', 'product', $code, $data );
		PP_Bom::reset_cache();
		return PP_Bom::product( $code );
	}

	public static function bom( $req ) {
		$code  = urldecode( $req['code'] );
		$lines = PP_Bom::lines( $code );
		foreach ( $lines as &$l ) {
			$p = PP_Bom::product( $l['component_code'] );
			$l['description'] = $p ? $p['description'] : '';
			$l['kind']        = $p ? $p['kind'] : null;
			$pr = PP_Db::row( 'SELECT unit_price, source FROM ' . PP_Db::t( 'material_prices' ) . ' WHERE material_code = %s', $l['component_code'] );
			$l['unit_price']  = $pr ? $pr['unit_price'] : null;
			$l['price_source']= $pr ? $pr['source'] : null;
		}
		return $lines;
	}

	public static function explode( $req ) {
		$code = urldecode( $req['code'] );
		$qty  = (float) self::p( $req, 'qty', 1 );
		$x    = PP_Bom::explode( $code, $qty, (bool) self::p( $req, 'use_stock', false ) );
		$cap  = new PP_Capacity();
		$nodes = array();
		foreach ( $x['order'] as $c ) {
			$n = $x['nodes'][ $c ];
			$p = PP_Bom::product( $c );
			$n['operations'] = array();
			foreach ( PP_Bom::operations( $c ) as $op ) {
				list( $mpu, $cu, $basis, $mp ) = $cap->lookup( $op['department_code'], $p, $op['labor_hours'], $op['machine_hours'] );
				$n['operations'][] = array( 'seq' => $op['seq'], 'department_code' => $op['department_code'], 'department' => $op['department']['name'], 'operation_name' => $op['operation_name'], 'labor_hours' => round( $op['labor_hours'], 3 ), 'machine_hours' => round( $op['machine_hours'], 3 ), 'minutes_per_unit' => $mpu, 'units_per_day' => $cu, 'capacity_basis' => $basis, 'manpower_required' => $mp, 'total_minutes' => round( $mpu * ceil( $n['qty'] ), 1 ) );
			}
			$nodes[] = $n;
		}
		$mats = array_values( $x['materials'] );
		usort( $mats, function ( $a, $b ) { return strcmp( $a['code'], $b['code'] ); } );
		return array( 'product' => $x['product'], 'qty' => $qty, 'nodes' => $nodes, 'materials' => $mats, 'tree' => $x['tree'], 'warnings' => $x['warnings'] );
	}

	public static function save_bom_line( $req ) {
		$b = self::body( $req );
		$parent = trim( (string) ( $b['parent_code'] ?? '' ) ); $comp = trim( (string) ( $b['component_code'] ?? '' ) );
		if ( ! $parent || ! $comp ) { throw new RuntimeException( 'Parent and component codes are required.' ); }
		if ( $parent === $comp ) { throw new RuntimeException( 'A product cannot contain itself.' ); }
		if ( ! PP_Bom::product( $comp ) ) { throw new RuntimeException( "Component $comp is not in the product master. Create it first." ); }
		$cp = PP_Bom::product( $comp );
		$data = array( 'qty' => (float) ( $b['qty'] ?? 1 ), 'uom' => $b['uom'] ?? $cp['uom'], 'calc_type' => 'RM' === $cp['kind'] ? 'Item' : 'BOM', 'source' => 'manual' );
		$ex = PP_Db::row( 'SELECT id FROM ' . PP_Db::t( 'bom_lines' ) . ' WHERE parent_code = %s AND component_code = %s', $parent, $comp );
		if ( $ex ) { PP_Db::update( 'bom_lines', $data, array( 'id' => $ex['id'] ) ); } else { $data['parent_code'] = $parent; $data['component_code'] = $comp; PP_Db::insert( 'bom_lines', $data ); }
		PP_Db::query( 'UPDATE ' . PP_Db::t( 'products' ) . " SET kind = CASE WHEN kind = 'RM' THEN 'SF' ELSE kind END WHERE code = %s", $parent );
		PP_Db::audit( 'bom_line_saved', 'bom', $parent . '/' . $comp, $data );
		return array( 'ok' => true );
	}

	public static function delete_bom_line( $req ) {
		$l = PP_Db::find( 'bom_lines', (int) $req['id'] );
		if ( ! $l ) { throw new RuntimeException( 'Line not found.' ); }
		PP_Db::delete( 'bom_lines', array( 'id' => $l['id'] ) );
		PP_Db::audit( 'bom_line_deleted', 'bom', $l['parent_code'] . '/' . $l['component_code'] );
		return array( 'ok' => true );
	}

	public static function save_routing_line( $req ) {
		$b = self::body( $req );
		$parent = trim( (string) ( $b['parent_code'] ?? '' ) ); $res = trim( (string) ( $b['resource_code'] ?? '' ) );
		if ( ! $parent || ! $res ) { throw new RuntimeException( 'Product and resource are required.' ); }
		$rr = PP_Db::row( 'SELECT * FROM ' . PP_Db::t( 'resources' ) . ' WHERE code = %s', $res );
		if ( ! $rr ) { throw new RuntimeException( 'Unknown resource ' . $res ); }
		$data = array( 'hours_per_unit' => (float) ( $b['hours_per_unit'] ?? 0 ), 'kind' => $rr['kind'], 'operation' => $rr['operation'], 'source' => 'manual' );
		$ex = PP_Db::row( 'SELECT id FROM ' . PP_Db::t( 'routings' ) . ' WHERE parent_code = %s AND resource_code = %s', $parent, $res );
		if ( $ex ) { PP_Db::update( 'routings', $data, array( 'id' => $ex['id'] ) ); } else { $data['parent_code'] = $parent; $data['resource_code'] = $res; PP_Db::insert( 'routings', $data ); }
		PP_Db::audit( 'routing_saved', 'routing', $parent . '/' . $res, $data );
		return array( 'ok' => true );
	}

	public static function delete_routing_line( $req ) {
		$l = PP_Db::find( 'routings', (int) $req['id'] );
		if ( ! $l ) { throw new RuntimeException( 'Line not found.' ); }
		PP_Db::delete( 'routings', array( 'id' => $l['id'] ) );
		PP_Db::audit( 'routing_deleted', 'routing', $l['parent_code'] . '/' . $l['resource_code'] );
		return array( 'ok' => true );
	}

	public static function departments( $req ) {
		$rows = PP_Db::rows( 'SELECT d.*, (SELECT COUNT(*) FROM ' . PP_Db::t( 'resources' ) . ' r WHERE r.department_code = d.code) AS resources, (SELECT COUNT(*) FROM ' . PP_Db::t( 'capacities' ) . ' c WHERE c.department_code = d.code) AS capacity_rows FROM ' . PP_Db::t( 'departments' ) . ' d ORDER BY d.stage_order, d.code' );
		foreach ( $rows as &$d ) { $d['stage_label'] = PP_Workbook_Importer::$stages[ $d['stage'] ][1] ?? $d['stage']; }
		return $rows;
	}

	public static function save_department( $req ) {
		$b = self::body( $req ); $code = urldecode( $req['code'] );
		$ex = PP_Db::row( 'SELECT * FROM ' . PP_Db::t( 'departments' ) . ' WHERE code = %s', $code );
		$data = array();
		foreach ( array( 'name', 'site', 'stage', 'manpower', 'machines', 'minutes_per_day', 'active' ) as $f ) { if ( array_key_exists( $f, $b ) ) { $data[ $f ] = $b[ $f ]; } }
		if ( isset( $data['stage'] ) && isset( PP_Workbook_Importer::$stages[ $data['stage'] ] ) ) { $data['stage_order'] = PP_Workbook_Importer::$stages[ $data['stage'] ][0]; }
		if ( isset( $data['manpower'] ) && ( ! $ex || (float) $ex['manpower'] !== (float) $data['manpower'] ) ) { $data['manpower_source'] = 'manual: set by ' . wp_get_current_user()->user_login . ' on ' . PP_Db::today(); }
		if ( $ex ) { PP_Db::update( 'departments', $data, array( 'code' => $code ) ); } else { $data['code'] = $code; if ( empty( $data['name'] ) ) { $data['name'] = $code; } PP_Db::insert( 'departments', $data ); }
		PP_Db::audit( 'department_saved', 'department', $code, $data );
		return PP_Db::row( 'SELECT * FROM ' . PP_Db::t( 'departments' ) . ' WHERE code = %s', $code );
	}

	public static function resources( $req ) {
		return PP_Db::rows( 'SELECT r.*, d.name AS department_name, (SELECT COUNT(*) FROM ' . PP_Db::t( 'routings' ) . ' x WHERE x.resource_code = r.code) AS used_in FROM ' . PP_Db::t( 'resources' ) . ' r LEFT JOIN ' . PP_Db::t( 'departments' ) . ' d ON d.code = r.department_code ORDER BY r.department_code, r.code' );
	}

	public static function save_resource( $req ) {
		$b = self::body( $req ); $code = urldecode( $req['code'] );
		$data = array();
		foreach ( array( 'name', 'kind', 'department_code', 'rate_per_hour' ) as $f ) { if ( array_key_exists( $f, $b ) ) { $data[ $f ] = $b[ $f ]; } }
		$ex = PP_Db::row( 'SELECT id FROM ' . PP_Db::t( 'resources' ) . ' WHERE code = %s', $code );
		if ( $ex ) { PP_Db::update( 'resources', $data, array( 'code' => $code ) ); } else { $data['code'] = $code; PP_Db::insert( 'resources', $data ); }
		PP_Db::audit( 'resource_saved', 'resource', $code, $data );
		return array( 'ok' => true );
	}

	public static function capacities( $req ) {
		$dept = self::p( $req, 'department' );
		$rows = $dept ? PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'capacities' ) . ' WHERE department_code = %s ORDER BY key_code', $dept ) : PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'capacities' ) . ' ORDER BY department_code, key_code' );
		$mach = PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'machine_capacities' ) . ' ORDER BY key_code, machine_code' );
		$files = PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'cutting_files' ) . ' ORDER BY sheet, machine_code, id' );
		return array( 'capacities' => $rows, 'machine_capacities' => $mach, 'cutting_files' => $files );
	}

	public static function save_capacity( $req ) {
		$b = self::body( $req );
		$data = array();
		foreach ( array( 'department_code', 'section', 'key_code', 'family', 'size', 'category', 'units_per_day', 'units_per_machine_per_day', 'staff', 'prod_lines', 'available_staff', 'planned_productivity' ) as $f ) { if ( array_key_exists( $f, $b ) ) { $data[ $f ] = ( '' === $b[ $f ] ) ? null : $b[ $f ]; } }
		if ( empty( $data['department_code'] ) || empty( $data['key_code'] ) ) { throw new RuntimeException( 'Department and product / family key are required.' ); }
		if ( empty( $data['family'] ) ) { list( $fam, $size ) = PP_Workbook_Importer::normalise_family( PP_Workbook_Importer::family_from_key( $data['key_code'] ) ); $data['family'] = $fam; $data['size'] = $data['size'] ?? $size; }
		if ( empty( $data['category'] ) ) { $data['category'] = PP_Workbook_Importer::category_of_key( $data['key_code'] ); }
		$data['source'] = 'manual: ' . wp_get_current_user()->user_login . ' ' . PP_Db::today();
		if ( ! empty( $b['id'] ) ) { PP_Db::update( 'capacities', $data, array( 'id' => (int) $b['id'] ) ); $id = (int) $b['id']; } else { $id = PP_Db::insert( 'capacities', $data ); }
		PP_Db::audit( 'capacity_saved', 'capacity', $id, $data );
		return PP_Db::find( 'capacities', $id );
	}

	public static function delete_capacity( $req ) {
		PP_Db::delete( 'capacities', array( 'id' => (int) $req['id'] ) );
		PP_Db::audit( 'capacity_deleted', 'capacity', (int) $req['id'] );
		return array( 'ok' => true );
	}

	public static function machines( $req ) {
		return PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'machines' ) . ' ORDER BY department_code, code' );
	}

	public static function prices( $req ) {
		$q = self::p( $req, 'q' ); $missing = self::p( $req, 'missing' );
		$where = array( '1=1' ); $args = array();
		if ( $q ) { $where[] = '(material_code LIKE %s OR description LIKE %s)'; $args[] = "%$q%"; $args[] = "%$q%"; }
		if ( $missing ) { $where[] = '(unit_price IS NULL OR unit_price = 0)'; }
		return PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'material_prices' ) . ' WHERE ' . implode( ' AND ', $where ) . ' ORDER BY (unit_price IS NULL) DESC, material_code LIMIT 1000', ...$args );
	}

	public static function save_price( $req ) {
		$b = self::body( $req ); $code = urldecode( $req['code'] );
		$price = isset( $b['unit_price'] ) && '' !== $b['unit_price'] ? (float) $b['unit_price'] : null;
		$data = array( 'unit_price' => $price, 'source' => 'manual', 'updated_by' => wp_get_current_user()->user_login, 'updated_at' => PP_Db::now() );
		if ( isset( $b['description'] ) ) { $data['description'] = $b['description']; }
		if ( isset( $b['uom'] ) ) { $data['uom'] = $b['uom']; }
		if ( isset( $b['currency'] ) ) { $data['currency'] = $b['currency']; }
		$ex = PP_Db::row( 'SELECT id, unit_price FROM ' . PP_Db::t( 'material_prices' ) . ' WHERE material_code = %s', $code );
		if ( $ex ) { PP_Db::update( 'material_prices', $data, array( 'material_code' => $code ) ); } else { $data['material_code'] = $code; PP_Db::insert( 'material_prices', $data ); }
		PP_Db::audit( 'price_updated', 'material_price', $code, array( 'from' => $ex ? $ex['unit_price'] : null, 'to' => $price ) );
		return PP_Db::row( 'SELECT * FROM ' . PP_Db::t( 'material_prices' ) . ' WHERE material_code = %s', $code );
	}

	public static function calendar( $req ) {
		$from = self::p( $req, 'from', date( 'Y-m-01' ) ); $to = self::p( $req, 'to', date( 'Y-m-d', strtotime( $from . ' +3 months' ) ) );
		return PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'calendar' ) . ' WHERE cal_date BETWEEN %s AND %s ORDER BY cal_date', $from, $to );
	}

	public static function save_calendar( $req ) {
		$b = self::body( $req ); $days = isset( $b['days'] ) && is_array( $b['days'] ) ? $b['days'] : array( $b );
		foreach ( $days as $d ) {
			if ( empty( $d['cal_date'] ) ) { continue; }
			$data = array( 'is_working' => (int) (bool) ( $d['is_working'] ?? 1 ), 'minutes_available' => (int) ( $d['minutes_available'] ?? 480 ), 'overtime_minutes' => (int) ( $d['overtime_minutes'] ?? 0 ), 'shifts' => max( 1, (int) ( $d['shifts'] ?? 1 ) ), 'note' => $d['note'] ?? null );
			$ex = PP_Db::row( 'SELECT id FROM ' . PP_Db::t( 'calendar' ) . ' WHERE cal_date = %s', $d['cal_date'] );
			if ( $ex ) { PP_Db::update( 'calendar', $data, array( 'id' => $ex['id'] ) ); } else { $data['cal_date'] = $d['cal_date']; PP_Db::insert( 'calendar', $data ); }
		}
		PP_Db::audit( 'calendar_updated', 'calendar', count( $days ) . ' days' );
		return array( 'ok' => true );
	}

	public static function save_settings( $req ) {
		$b = self::body( $req );
		$allowed = array( 'work_start', 'work_end', 'break_minutes', 'net_minutes', 'working_days', 'currency', 'currency_symbol', 'horizon_days', 'capacity_basis', 'site_name' );
		$data = array();
		foreach ( $allowed as $k ) { if ( array_key_exists( $k, $b ) ) { $data[ $k ] = $b[ $k ]; } }
		if ( isset( $data['working_days'] ) ) { $data['working_days'] = array_map( 'intval', (array) $data['working_days'] ); }
		$s = PP_Db::save_settings( $data );
		PP_Db::audit( 'settings_updated', 'settings', 'pp_settings', $data );
		return $s;
	}

	/* ---------------- sales demand ---------------- */

	public static function requests( $req ) {
		$where = array( '1=1' ); $args = array();
		foreach ( array( 'status' => 'r.status', 'product_type' => 'r.product_type', 'product' => 'r.product_code', 'priority' => 'r.priority' ) as $k => $col ) {
			$v = self::p( $req, $k ); if ( $v ) { $where[] = "$col = %s"; $args[] = $v; }
		}
		if ( self::p( $req, 'open' ) ) { $where[] = "r.status NOT IN ('Completed','Cancelled')"; }
		$q = self::p( $req, 'q' ); if ( $q ) { $where[] = '(r.request_no LIKE %s OR r.customer LIKE %s OR r.sales_order_ref LIKE %s OR r.product_code LIKE %s)'; for ( $i = 0; $i < 4; $i++ ) { $args[] = "%$q%"; } }
		$rows = PP_Db::rows( 'SELECT r.*, p.plan_no, p.version AS plan_version, p.status AS plan_status, (SELECT COUNT(*) FROM ' . PP_Db::t( 'plans' ) . " x WHERE x.request_id = r.id AND x.status = 'proposed') AS proposed_plans FROM " . PP_Db::t( 'sales_requests' ) . ' r LEFT JOIN ' . PP_Db::t( 'plans' ) . ' p ON p.id = r.confirmed_plan_id WHERE ' . implode( ' AND ', $where ) . ' ORDER BY r.id DESC LIMIT 500', ...$args );
		foreach ( $rows as &$r ) { $r['is_delayed'] = self::is_delayed( $r ); }
		return $rows;
	}

	private static function is_delayed( $r ) {
		if ( in_array( $r['status'], array( 'Completed', 'Cancelled', 'Submitted' ), true ) ) { return false; }
		$fc = $r['forecast_completion'] ?: $r['expected_completion'];
		return (bool) ( ( $fc && $r['expected_completion'] && $fc > $r['expected_completion'] ) || ( $fc && $r['delivery_date'] && $fc > $r['delivery_date'] ) );
	}

	public static function create_request( $req ) {
		$b = self::body( $req );
		$code = trim( (string) ( $b['product_code'] ?? '' ) );
		$p = PP_Bom::product( $code );
		if ( ! $p ) { throw new RuntimeException( 'Select a valid finished-product code.' ); }
		$qty = (float) ( $b['qty'] ?? 0 );
		if ( $qty <= 0 ) { throw new RuntimeException( 'Quantity must be greater than zero.' ); }
		$priority = in_array( $b['priority'] ?? '', array( 'Urgent', 'High', 'Normal', 'Low' ), true ) ? $b['priority'] : 'Normal';
		$user = wp_get_current_user();
		$id = PP_Db::insert(
			'sales_requests',
			array(
				'request_no' => PP_Db::next_number( 'SR', 'SR-' ), 'customer' => sanitize_text_field( $b['customer'] ?? '' ), 'sales_order_ref' => sanitize_text_field( $b['sales_order_ref'] ?? '' ),
				'product_code' => $code, 'product_description' => $p['description'], 'product_type' => $b['product_type'] ?? $p['product_type'], 'qty' => $qty,
				'delivery_date' => ! empty( $b['delivery_date'] ) ? $b['delivery_date'] : null, 'priority' => $priority, 'remarks' => sanitize_textarea_field( $b['remarks'] ?? '' ),
				'status' => 'Submitted', 'created_by' => $user->user_login, 'created_at' => PP_Db::now(), 'updated_at' => PP_Db::now(),
			)
		);
		PP_Db::audit( 'request_created', 'sales_request', $id, array( 'product' => $code, 'qty' => $qty ) );
		return self::request_detail( $id );
	}

	public static function request( $req ) {
		return self::request_detail( (int) $req['id'] );
	}

	private static function request_detail( $id ) {
		$r = PP_Db::row( 'SELECT r.*, p.plan_no, p.version AS plan_version FROM ' . PP_Db::t( 'sales_requests' ) . ' r LEFT JOIN ' . PP_Db::t( 'plans' ) . ' p ON p.id = r.confirmed_plan_id WHERE r.id = %d', $id );
		if ( ! $r ) { throw new RuntimeException( 'Request not found.' ); }
		$r['is_delayed'] = self::is_delayed( $r );
		$r['plans'] = PP_Db::rows( 'SELECT id, plan_no, version, status, created_by, created_at, confirmed_by, confirmed_at, summary FROM ' . PP_Db::t( 'plans' ) . ' WHERE request_id = %d ORDER BY version DESC', $id );
		foreach ( $r['plans'] as &$p ) { $p['summary'] = json_decode( $p['summary'], true ); }
		$r['bom_preview'] = PP_Bom::explode( $r['product_code'], (float) $r['qty'] );
		$r['bom_preview'] = array( 'nodes' => array_values( $r['bom_preview']['nodes'] ), 'materials' => count( $r['bom_preview']['materials'] ), 'warnings' => $r['bom_preview']['warnings'] );
		return $r;
	}

	public static function update_request( $req ) {
		$id = (int) $req['id']; $b = self::body( $req );
		$r = PP_Db::find( 'sales_requests', $id );
		if ( ! $r ) { throw new RuntimeException( 'Request not found.' ); }
		$data = array();
		foreach ( array( 'customer', 'sales_order_ref', 'delivery_date', 'priority', 'remarks' ) as $f ) { if ( array_key_exists( $f, $b ) ) { $data[ $f ] = $b[ $f ] === '' ? null : $b[ $f ]; } }
		if ( 'Submitted' === $r['status'] ) {
			foreach ( array( 'product_code', 'qty', 'product_type' ) as $f ) { if ( array_key_exists( $f, $b ) ) { $data[ $f ] = $b[ $f ]; } }
			if ( isset( $data['product_code'] ) ) { $p = PP_Bom::product( $data['product_code'] ); if ( ! $p ) { throw new RuntimeException( 'Invalid product.' ); } $data['product_description'] = $p['description']; }
		}
		$data['updated_at'] = PP_Db::now();
		PP_Db::update( 'sales_requests', $data, array( 'id' => $id ) );
		PP_Db::audit( 'request_updated', 'sales_request', $id, $data );
		return self::request_detail( $id );
	}

	public static function cancel_request( $req ) {
		PP_Planner::cancel_request( (int) $req['id'], self::body( $req )['reason'] ?? '' );
		return self::request_detail( (int) $req['id'] );
	}

	/* ---------------- planning ---------------- */

	public static function generate( $req ) {
		$id = (int) $req['id']; $b = self::body( $req );
		$params = array();
		foreach ( array( 'start_date', 'priority', 'use_stock', 'capacity_basis', 'manpower', 'earliest_start', 'sequence', 'note' ) as $k ) { if ( isset( $b[ $k ] ) && '' !== $b[ $k ] ) { $params[ $k ] = $b[ $k ]; } }
		$gen = PP_Planner::generate( $id, $params );
		$plan_id = PP_Planner::save_proposed( $gen );
		return self::plan_detail( $plan_id );
	}

	public static function plan( $req ) {
		return self::plan_detail( (int) $req['id'] );
	}

	private static function plan_detail( $plan_id ) {
		$p = PP_Db::find( 'plans', $plan_id );
		if ( ! $p ) { throw new RuntimeException( 'Plan not found.' ); }
		$p['summary'] = json_decode( $p['summary'], true );
		$p['params']  = json_decode( $p['params'], true );
		$p['request'] = PP_Db::find( 'sales_requests', $p['request_id'] );
		$p['orders']  = PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'production_orders' ) . ' WHERE plan_id = %d ORDER BY level DESC, id', $plan_id );
		$p['work_orders'] = PP_Wip::list_work_orders( array( 'plan_id' => $plan_id, 'plan_status' => $p['status'] ) );
		if ( ! $p['work_orders'] && in_array( $p['status'], array( 'superseded', 'cancelled' ), true ) ) { $p['work_orders'] = array(); }
		$p['dependencies'] = PP_Db::rows( 'SELECT dp.* FROM ' . PP_Db::t( 'wo_dependencies' ) . ' dp JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = dp.wo_id WHERE w.plan_id = %d', $plan_id );
		$p['daily_targets'] = PP_Db::rows( 'SELECT wo_id, department_code, target_date, planned_qty, planned_minutes, kind FROM ' . PP_Db::t( 'daily_targets' ) . ' WHERE plan_id = %d ORDER BY target_date', $plan_id );
		$p['materials'] = PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'material_requirements' ) . ' WHERE plan_id = %d ORDER BY cost DESC, material_code', $plan_id );
		$p['actual_cost'] = 'confirmed' === $p['status'] ? PP_Costing::actual_cost( $plan_id ) : null;
		return $p;
	}

	public static function confirm( $req ) {
		PP_Planner::confirm( (int) $req['id'] );
		return self::plan_detail( (int) $req['id'] );
	}

	public static function reforecast( $req ) {
		$r = PP_Planner::reforecast( (int) $req['id'], 'manual' );
		return array( 'result' => $r, 'plan' => self::plan_detail( (int) $req['id'] ) );
	}

	public static function reforecast_all( $req ) {
		return PP_Planner::reforecast_all( 'manual' );
	}

	/* ---------------- orders / work orders ---------------- */

	public static function orders( $req ) {
		$where = array( "p.status = 'confirmed'" ); $args = array();
		if ( self::p( $req, 'status' ) ) { $where[] = 'po.status = %s'; $args[] = self::p( $req, 'status' ); }
		if ( self::p( $req, 'request_id' ) ) { $where[] = 'po.request_id = %d'; $args[] = (int) self::p( $req, 'request_id' ); }
		if ( self::p( $req, 'product' ) ) { $where[] = '(po.finished_product_code = %s OR po.product_code = %s)'; $args[] = self::p( $req, 'product' ); $args[] = self::p( $req, 'product' ); }
		if ( self::p( $req, 'product_type' ) ) { $where[] = 'r.product_type = %s'; $args[] = self::p( $req, 'product_type' ); }
		if ( self::p( $req, 'master' ) ) { $where[] = 'po.is_master = 1'; }
		if ( self::p( $req, 'open' ) ) { $where[] = "po.status NOT IN ('Completed','Cancelled')"; }
		if ( self::p( $req, 'delayed' ) ) { $where[] = "(po.status = 'Delayed' OR po.forecast_finish > po.baseline_finish)"; }
		$rows = PP_Db::rows( 'SELECT po.*, r.request_no, r.customer, r.priority, r.delivery_date, r.product_type, r.status AS request_status, p.plan_no, (SELECT COUNT(*) FROM ' . PP_Db::t( 'work_orders' ) . ' w WHERE w.production_order_id = po.id) AS work_orders, (SELECT COUNT(*) FROM ' . PP_Db::t( 'work_orders' ) . " w WHERE w.production_order_id = po.id AND w.status = 'Completed') AS work_orders_done FROM " . PP_Db::t( 'production_orders' ) . ' po JOIN ' . PP_Db::t( 'sales_requests' ) . ' r ON r.id = po.request_id JOIN ' . PP_Db::t( 'plans' ) . ' p ON p.id = po.plan_id WHERE ' . implode( ' AND ', $where ) . ' ORDER BY po.request_id DESC, po.level DESC, po.id LIMIT 2000', ...$args );
		foreach ( $rows as &$o ) {
			$o['balance_qty'] = max( 0, (float) $o['planned_qty'] - (float) $o['completed_qty'] );
			$o['delayed'] = ( $o['forecast_finish'] && $o['baseline_finish'] && $o['forecast_finish'] > $o['baseline_finish'] ) || 'Delayed' === $o['status'];
			$o['wip_qty'] = (float) PP_Db::var( 'SELECT COALESCE(SUM(CASE WHEN received_qty - good_qty - rejected_qty > 0 THEN received_qty - good_qty - rejected_qty ELSE 0 END),0) FROM ' . PP_Db::t( 'work_orders' ) . ' WHERE production_order_id = %d', $o['id'] );
		}
		return $rows;
	}

	public static function order( $req ) {
		$o = PP_Db::row( 'SELECT po.*, r.request_no, r.customer, r.priority, r.delivery_date, p.plan_no, p.status AS plan_status FROM ' . PP_Db::t( 'production_orders' ) . ' po JOIN ' . PP_Db::t( 'sales_requests' ) . ' r ON r.id = po.request_id JOIN ' . PP_Db::t( 'plans' ) . ' p ON p.id = po.plan_id WHERE po.id = %d', (int) $req['id'] );
		if ( ! $o ) { throw new RuntimeException( 'Order not found.' ); }
		$o['work_orders'] = array_values( array_filter( PP_Wip::list_work_orders( array( 'plan_id' => $o['plan_id'], 'plan_status' => $o['plan_status'] ) ), function ( $w ) use ( $o ) { return (int) $w['production_order_id'] === (int) $o['id']; } ) );
		$o['children'] = PP_Db::rows( 'SELECT id, order_no, product_code, description, planned_qty, completed_qty, status, forecast_finish FROM ' . PP_Db::t( 'production_orders' ) . ' WHERE parent_order_id = %d', $o['id'] );
		$o['materials'] = array();
		foreach ( PP_Bom::lines( $o['product_code'] ) as $ln ) { if ( 'Item' === $ln['calc_type'] ) { $mp = PP_Bom::product( $ln['component_code'] ); $o['materials'][] = array( 'code' => $ln['component_code'], 'description' => $mp ? $mp['description'] : '', 'qty_per' => (float) $ln['qty'], 'qty' => (float) $ln['qty'] * (float) $o['planned_qty'], 'uom' => $ln['uom'] ); } }
		$o['entries'] = PP_Db::rows( 'SELECT e.*, w.wo_no FROM ' . PP_Db::t( 'production_entries' ) . ' e JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = e.wo_id WHERE w.production_order_id = %d ORDER BY e.entry_date DESC, e.id DESC', $o['id'] );
		return $o;
	}

	public static function update_order( $req ) {
		$b = self::body( $req ); $id = (int) $req['id'];
		$data = array();
		if ( array_key_exists( 'actual_material_cost', $b ) ) { $data['actual_material_cost'] = '' === $b['actual_material_cost'] ? null : (float) $b['actual_material_cost']; }
		if ( $data ) { PP_Db::update( 'production_orders', $data, array( 'id' => $id ) ); PP_Db::audit( 'order_updated', 'production_order', $id, $data ); }
		return self::order( $req );
	}

	public static function work_orders( $req ) {
		$f = array();
		foreach ( array( 'department', 'status', 'request_id', 'plan_id', 'product', 'open', 'from', 'to', 'plan_status' ) as $k ) { $v = self::p( $req, $k ); if ( null !== $v ) { $f[ $k ] = $v; } }
		if ( empty( $f['plan_status'] ) && empty( $f['plan_id'] ) ) { $f['plan_status'] = 'confirmed'; }
		$user = wp_get_current_user();
		if ( self::p( $req, 'mine' ) ) { $d = PP_Roles::user_departments( $user->ID ); if ( $d ) { $f['departments'] = $d; } }
		$rows = PP_Wip::list_work_orders( $f );
		if ( ! empty( $f['departments'] ) ) { $rows = array_values( array_filter( $rows, function ( $w ) use ( $f ) { return in_array( $w['department_code'], $f['departments'], true ); } ) ); }
		return $rows;
	}

	public static function work_order( $req ) {
		$wo = PP_Wip::wo( (int) $req['id'] );
		$wo['availability'] = PP_Wip::availability( $wo );
		$wo['successors']   = PP_Wip::successors( $wo['id'] );
		$wo['entries']      = PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'production_entries' ) . ' WHERE wo_id = %d ORDER BY entry_date DESC, id DESC', $wo['id'] );
		$wo['transfers']    = PP_Wip::movements( array( 'wo_id' => $wo['id'] ) );
		$wo['targets']      = PP_Db::rows( 'SELECT target_date, planned_qty, planned_minutes, kind FROM ' . PP_Db::t( 'daily_targets' ) . " WHERE wo_id = %d AND kind IN ('baseline','forecast','proposed') ORDER BY target_date", $wo['id'] );
		$wo['today_target'] = PP_Wip::planned_for_date( $wo['id'], PP_Db::today() );
		$wo['wip_qty']      = $wo['availability']['available'];
		$wo['balance_qty']  = $wo['availability']['balance'];
		return $wo;
	}

	public static function wo_start( $req ) { return PP_Wip::start( (int) $req['id'] ); }
	public static function wo_complete( $req ) { return PP_Wip::complete( (int) $req['id'], self::body( $req )['remarks'] ?? '' ); }

	public static function entries( $req ) {
		$where = array( '1=1' ); $args = array();
		if ( self::p( $req, 'department' ) ) { $where[] = 'e.department_code = %s'; $args[] = self::p( $req, 'department' ); }
		if ( self::p( $req, 'from' ) ) { $where[] = 'e.entry_date >= %s'; $args[] = self::p( $req, 'from' ); }
		if ( self::p( $req, 'to' ) ) { $where[] = 'e.entry_date <= %s'; $args[] = self::p( $req, 'to' ); }
		if ( self::p( $req, 'wo_id' ) ) { $where[] = 'e.wo_id = %d'; $args[] = (int) self::p( $req, 'wo_id' ); }
		return PP_Db::rows( 'SELECT e.*, w.wo_no, w.operation_name, d.name AS department_name, r.request_no, po.order_no, (CASE WHEN e.planned_qty > 0 THEN ROUND(e.good_qty / e.planned_qty * 100, 1) ELSE NULL END) AS achievement FROM ' . PP_Db::t( 'production_entries' ) . ' e JOIN ' . PP_Db::t( 'work_orders' ) . ' w ON w.id = e.wo_id JOIN ' . PP_Db::t( 'departments' ) . ' d ON d.code = e.department_code JOIN ' . PP_Db::t( 'sales_requests' ) . ' r ON r.id = w.request_id JOIN ' . PP_Db::t( 'production_orders' ) . ' po ON po.id = w.production_order_id WHERE ' . implode( ' AND ', $where ) . ' ORDER BY e.entry_date DESC, e.id DESC LIMIT 500', ...$args );
	}

	public static function create_entry( $req ) {
		$b = self::body( $req );
		return PP_Wip::record_entry( $b );
	}

	public static function transfers( $req ) {
		$f = array();
		foreach ( array( 'wo_id', 'department', 'status', 'request_id' ) as $k ) { $v = self::p( $req, $k ); if ( $v ) { $f[ $k ] = $v; } }
		return PP_Wip::movements( $f );
	}

	public static function create_transfer( $req ) {
		$b = self::body( $req );
		return PP_Wip::transfer( (int) $b['from_wo_id'], (int) $b['to_wo_id'], (float) $b['qty'], sanitize_text_field( $b['remarks'] ?? '' ) );
	}

	public static function receive_transfer( $req ) {
		$b = self::body( $req );
		return PP_Wip::receive( (int) $req['id'], $b['received_qty'] ?? null, sanitize_text_field( $b['remarks'] ?? '' ) );
	}

	public static function cancel_transfer( $req ) {
		return PP_Wip::cancel_transfer( (int) $req['id'], sanitize_text_field( self::body( $req )['reason'] ?? '' ) );
	}

	public static function wip( $req ) {
		$f = array( 'open' => 1, 'plan_status' => 'confirmed' );
		foreach ( array( 'department', 'request_id', 'product' ) as $k ) { $v = self::p( $req, $k ); if ( $v ) { $f[ $k ] = $v; } }
		$rows = PP_Wip::list_work_orders( $f );
		$pending = PP_Wip::movements( array( 'status' => 'sent' ) );
		return array( 'work_orders' => $rows, 'pending_transfers' => $pending );
	}

	/* ---------------- dashboard / reports ---------------- */

	public static function dashboard( $req ) {
		$f = array();
		foreach ( array( 'month', 'product_type', 'department', 'product', 'status', 'from', 'to' ) as $k ) { $v = self::p( $req, $k ); if ( $v ) { $f[ $k ] = $v; } }
		return PP_Reports::dashboard( $f );
	}

	public static function daily( $req ) {
		$from = self::p( $req, 'from', date( 'Y-m-d', strtotime( '-14 days' ) ) ); $to = self::p( $req, 'to', PP_Db::today() );
		return PP_Reports::daily_achievement( $from, $to, self::p( $req, 'department' ) );
	}

	public static function monthly( $req ) {
		return PP_Reports::monthly( self::p( $req, 'month', substr( PP_Db::today(), 0, 7 ) ), self::p( $req, 'product_type' ) );
	}

	public static function gantt( $req ) {
		$f = array();
		foreach ( array( 'department', 'request_id', 'plan_id', 'product', 'from', 'to', 'status', 'plan_status' ) as $k ) { $v = self::p( $req, $k ); if ( $v ) { $f[ $k ] = $v; } }
		return PP_Reports::gantt( $f );
	}

	public static function costing( $req ) {
		$code = urldecode( $req['code'] );
		$qty  = (float) self::p( $req, 'qty', 1 );
		return ( new PP_Costing() )->cost_product( $code, $qty );
	}

	public static function alerts( $req ) {
		$all = self::p( $req, 'all' );
		return PP_Db::rows( 'SELECT a.*, r.request_no FROM ' . PP_Db::t( 'alerts' ) . ' a LEFT JOIN ' . PP_Db::t( 'sales_requests' ) . ' r ON r.id = a.request_id ' . ( $all ? '' : 'WHERE a.acknowledged_at IS NULL ' ) . 'ORDER BY a.id DESC LIMIT 200' );
	}

	public static function ack_alert( $req ) {
		PP_Db::update( 'alerts', array( 'acknowledged_by' => wp_get_current_user()->user_login, 'acknowledged_at' => PP_Db::now() ), array( 'id' => (int) $req['id'] ) );
		return array( 'ok' => true );
	}

	public static function audit( $req ) {
		$where = array( '1=1' ); $args = array();
		if ( self::p( $req, 'entity' ) ) { $where[] = 'entity = %s'; $args[] = self::p( $req, 'entity' ); }
		if ( self::p( $req, 'q' ) ) { $where[] = '(action LIKE %s OR entity_id LIKE %s OR user_login LIKE %s)'; for ( $i = 0; $i < 3; $i++ ) { $args[] = '%' . self::p( $req, 'q' ) . '%'; } }
		return PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'audit_log' ) . ' WHERE ' . implode( ' AND ', $where ) . ' ORDER BY id DESC LIMIT 300', ...$args );
	}

	public static function quality_report( $req ) {
		$r = get_option( 'pp_quality_report', array() );
		$r['import_error'] = get_option( 'pp_import_error', '' );
		return $r;
	}

	public static function history( $req ) {
		return PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'productivity_history' ) . ' ORDER BY sheet, section, key_code, week_label, id LIMIT 2000' );
	}

	public static function import( $req ) {
		$files = $req->get_file_params();
		if ( empty( $files['workbook']['tmp_name'] ) ) { throw new RuntimeException( 'Upload the production workbook (.xlsx) in the "workbook" field.' ); }
		$f = $files['workbook'];
		if ( ! preg_match( '/\.xlsx$/i', $f['name'] ) ) { throw new RuntimeException( 'Only .xlsx workbooks are supported.' ); }
		$mode = self::p( $req, 'mode', 'reimport' );
		$dir  = wp_upload_dir();
		$dest = trailingslashit( $dir['basedir'] ) . 'production-planning';
		wp_mkdir_p( $dest );
		$path = $dest . '/workbook-' . date( 'Ymd-His' ) . '.xlsx';
		if ( ! move_uploaded_file( $f['tmp_name'], $path ) && ! copy( $f['tmp_name'], $path ) ) { throw new RuntimeException( 'Could not store the uploaded file.' ); }
		$report = PP_Seeder::import_workbook( $path, 'initial' === $mode ? 'initial' : 'reimport' );
		return $report;
	}

	public static function users( $req ) {
		$out = array();
		foreach ( get_users( array( 'orderby' => 'display_name' ) ) as $u ) {
			$out[] = array( 'id' => $u->ID, 'login' => $u->user_login, 'name' => $u->display_name, 'email' => $u->user_email, 'roles' => (array) $u->roles, 'role_label' => PP_Roles::role_label( $u ), 'departments' => PP_Roles::user_departments( $u->ID ) );
		}
		return array( 'users' => $out, 'roles' => array_merge( array( 'administrator' => 'Administrator' ), array_map( function ( $r ) { return $r[0]; }, PP_Roles::ROLES ) ) );
	}

	public static function save_user( $req ) {
		$b = self::body( $req );
		$roles_ok = array_merge( array( 'administrator' ), array_keys( PP_Roles::ROLES ) );
		$role = in_array( $b['role'] ?? '', $roles_ok, true ) ? $b['role'] : 'pp_sales';
		if ( ! empty( $b['id'] ) ) {
			$u = get_user_by( 'id', (int) $b['id'] );
			if ( ! $u ) { throw new RuntimeException( 'User not found.' ); }
			if ( (int) $u->ID !== get_current_user_id() ) { $u->set_role( $role ); }
			if ( ! empty( $b['password'] ) ) { wp_set_password( $b['password'], $u->ID ); }
			if ( isset( $b['name'] ) ) { wp_update_user( array( 'ID' => $u->ID, 'display_name' => $b['name'] ) ); }
			if ( isset( $b['email'] ) && is_email( $b['email'] ) ) { wp_update_user( array( 'ID' => $u->ID, 'user_email' => $b['email'] ) ); }
			$id = $u->ID;
		} else {
			$login = sanitize_user( $b['login'] ?? '' );
			if ( ! $login || empty( $b['password'] ) ) { throw new RuntimeException( 'Username and password are required.' ); }
			$id = wp_insert_user( array( 'user_login' => $login, 'user_pass' => $b['password'], 'user_email' => $b['email'] ?? '', 'display_name' => $b['name'] ?? $login, 'role' => $role ) );
			if ( is_wp_error( $id ) ) { throw new RuntimeException( $id->get_error_message() ); }
		}
		update_user_meta( $id, 'pp_departments', array_values( array_filter( (array) ( $b['departments'] ?? array() ) ) ) );
		PP_Db::audit( 'user_saved', 'user', $id, array( 'role' => $role ) );
		return self::users( $req );
	}

	public static function demo_users( $req ) {
		$b  = self::body( $req );
		$pw = ! empty( $b['password'] ) ? $b['password'] : 'Demo#2026!';
		$out = PP_Demo::create_all( $pw );
		PP_Db::audit( 'demo_users_created', 'user', count( $out ) );
		return array( 'users' => $out, 'password' => $pw );
	}

	public static function demo_reset( $req ) {
		PP_Install::truncate_transactions();
		PP_Db::audit( 'demo_reset', 'system', 'transactions' );
		return array( 'ok' => true );
	}

	/* ---------------- exports ---------------- */

	public static function export( $req ) {
		$what = $req['what'];
		$sheets = array(); $name = 'export';
		switch ( $what ) {
			case 'monthly':
				$m = PP_Reports::monthly( self::p( $req, 'month', substr( PP_Db::today(), 0, 7 ) ), self::p( $req, 'product_type' ) );
				$name = 'monthly-production-' . $m['month'];
				$sheets['Summary'] = array( array( 'Month', $m['month'] ), array( 'Working days', $m['working_days'] ), array( 'Planned finished products', $m['totals']['planned'] ), array( 'Actual finished products', $m['totals']['actual'] ), array( 'Achievement %', $m['totals']['achievement'] ), array( 'Completed orders', $m['totals']['completed_orders'] ), array( 'On time', $m['totals']['on_time'] ), array( 'On-time %', $m['totals']['on_time_pct'] ), array( 'Estimated manufacturing cost', $m['totals']['estimated_cost'] ), array( 'Rejected', $m['totals']['rejected'] ), array( 'Rework', $m['totals']['rework'] ), array( 'Downtime (min)', $m['totals']['downtime'] ) );
				$sheets['By product'] = PP_Export::table( $m['products'], array( 'product_code' => 'Product', 'product_type' => 'Type', 'description' => 'Description', 'planned' => 'Planned', 'actual' => 'Actual', 'achievement' => 'Achievement %' ) );
				$sheets['Departments'] = PP_Export::table( $m['departments'], array( 'department_code' => 'Code', 'department' => 'Department', 'site' => 'Site', 'manpower' => 'Manpower', 'planned' => 'Planned qty', 'actual' => 'Actual qty', 'achievement' => 'Achievement %', 'rejected' => 'Rejected', 'rework' => 'Rework', 'downtime' => 'Downtime (min)', 'planned_minutes' => 'Planned minutes', 'capacity_minutes' => 'Capacity minutes', 'utilisation' => 'Utilisation %', 'open_wos' => 'Open work orders' ) );
				$orders = $m['orders'];
				foreach ( $orders as &$o ) { $o['actual_labor_cost'] = $o['actual_cost']['labor_cost'] ?? null; $o['actual_material_cost'] = $o['actual_cost']['material_cost'] ?? null; }
				unset( $o );
				$sheets['Orders'] = PP_Export::table( $orders, array( 'request_no' => 'Request', 'customer' => 'Customer', 'product_code' => 'Product', 'product_type' => 'Type', 'qty' => 'Qty', 'status' => 'Status', 'delivery_date' => 'Delivery date', 'expected_completion' => 'Planned completion', 'forecast_completion' => 'Forecast completion', 'actual_completion' => 'Actual completion', 'delayed' => 'Delayed', 'estimated_cost' => 'Estimated cost', 'actual_labor_cost' => 'Actual labour cost', 'actual_material_cost' => 'Actual material cost' ) );
				$sheets['WIP'] = PP_Export::table( $m['wip'], array( 'department_code' => 'Code', 'department' => 'Department', 'open_orders' => 'Open work orders', 'in_process' => 'In process', 'waiting_transfer' => 'Waiting transfer', 'balance' => 'Balance' ) );
				$sheets['Daily'] = PP_Export::table( $m['daily'], array( 'date' => 'Date', 'department' => 'Department', 'target' => 'Target', 'planned' => 'Planned', 'good' => 'Good', 'rejected' => 'Rejected', 'rework' => 'Rework', 'downtime' => 'Downtime (min)', 'achievement' => 'Achievement %' ) );
				break;
			case 'work-orders':
				$rows = self::work_orders( $req ); $name = 'work-orders';
				$sheets['Work orders'] = PP_Export::table( $rows, array( 'wo_no' => 'Work order', 'order_no' => 'Production order', 'request_no' => 'Request', 'product_code' => 'Component', 'finished_product_code' => 'Finished product', 'department_name' => 'Department', 'operation_name' => 'Operation', 'planned_qty' => 'Planned', 'good_qty' => 'Actual', 'wip_qty' => 'WIP', 'balance_qty' => 'Balance', 'rejected_qty' => 'Rejected', 'baseline_start' => 'Baseline start', 'baseline_finish' => 'Baseline finish', 'forecast_start' => 'Forecast start', 'forecast_finish' => 'Forecast finish', 'status' => 'Status', 'capacity_basis' => 'Capacity basis' ) );
				break;
			case 'wip':
				$w = self::wip( $req ); $name = 'wip';
				$sheets['WIP'] = PP_Export::table( $w['work_orders'], array( 'wo_no' => 'Work order', 'request_no' => 'Request', 'product_code' => 'Component', 'department_name' => 'Section', 'planned_qty' => 'Required', 'received_qty' => 'Received', 'good_qty' => 'Completed', 'wip_qty' => 'In process', 'waiting_qty' => 'Waiting transfer', 'in_transit_qty' => 'In transit', 'transferred_qty' => 'Transferred', 'rejected_qty' => 'Rejected', 'rework_qty' => 'Rework', 'forecast_finish' => 'Expected completion', 'delayed' => 'Delayed', 'status' => 'Status' ) );
				$sheets['Pending transfers'] = PP_Export::table( $w['pending_transfers'], array( 'transfer_no' => 'Transfer', 'from_wo_no' => 'From WO', 'from_department_name' => 'From', 'to_wo_no' => 'To WO', 'to_department_name' => 'To', 'product_code' => 'Component', 'qty' => 'Qty', 'sent_by' => 'Sent by', 'sent_at' => 'Sent at' ) );
				break;
			case 'costing':
				$c = ( new PP_Costing() )->cost_product( urldecode( self::p( $req, 'code' ) ), (float) self::p( $req, 'qty', 1 ) ); $name = 'bom-costing-' . $c['code'];
				$sheets['Summary'] = array( array( 'Product', $c['code'] ), array( 'Description', $c['description'] ), array( 'Quantity', $c['qty'] ), array( 'Material (unit)', $c['unit']['material'] ), array( 'Labour (unit)', $c['unit']['labor'] ), array( 'Machine (unit)', $c['unit']['machine'] ), array( 'Overhead (unit)', $c['unit']['overhead'] ), array( 'Total (unit)', $c['unit']['total'] ), array( 'Total (order)', $c['total']['total'] ), array( 'Costing complete', $c['complete'] ? 'Yes' : 'No - ' . count( $c['missing_prices'] ) . ' missing prices' ) );
				$sheets['Materials'] = PP_Export::table( $c['materials'], array( 'code' => 'Material', 'description' => 'Description', 'uom' => 'UoM', 'qty' => 'Qty', 'unit_price' => 'Unit price', 'cost' => 'Cost', 'price_status' => 'Price status', 'used_in' => 'Used in' ) );
				$ops = array();
				$walk = function ( $bd, $qty ) use ( &$walk, &$ops ) { foreach ( $bd['operations'] as $o ) { $o['component'] = $bd['code']; $o['qty'] = $qty; $o['cost_total'] = $o['cost'] * $qty; $ops[] = $o; } foreach ( $bd['components'] as $cmp ) { $walk( $cmp['breakdown'], $qty * $cmp['qty_per'] ); } };
				$walk( $c['breakdown'], $c['qty'] );
				$sheets['Labour & machine'] = PP_Export::table( $ops, array( 'component' => 'Component', 'department' => 'Department', 'resource' => 'Resource', 'name' => 'Name', 'kind' => 'Kind', 'hours' => 'Hours/unit', 'rate_per_hour' => 'Rate/hour', 'qty' => 'Qty', 'cost_total' => 'Cost' ) );
				break;
			case 'materials':
				$pid = (int) self::p( $req, 'plan_id' ); $name = 'material-requirements-plan-' . $pid;
				$sheets['Materials'] = PP_Export::table( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'material_requirements' ) . ' WHERE plan_id = %d ORDER BY material_code', $pid ), array( 'material_code' => 'Material', 'description' => 'Description', 'uom' => 'UoM', 'qty' => 'Qty', 'unit_price' => 'Unit price', 'cost' => 'Cost', 'price_status' => 'Price status' ) );
				break;
			case 'prices':
				$name = 'material-price-master';
				$sheets['Prices'] = PP_Export::table( PP_Db::rows( 'SELECT * FROM ' . PP_Db::t( 'material_prices' ) . ' ORDER BY material_code' ), array( 'material_code' => 'Material', 'description' => 'Description', 'uom' => 'UoM', 'unit_price' => 'Unit price', 'currency' => 'Currency', 'source' => 'Source', 'cost_group' => 'Cost group', 'updated_by' => 'Updated by', 'updated_at' => 'Updated at' ) );
				break;
			case 'entries':
				$name = 'daily-production';
				$sheets['Entries'] = PP_Export::table( self::entries( $req ), array( 'entry_date' => 'Date', 'department_name' => 'Department', 'wo_no' => 'Work order', 'product_code' => 'Component', 'planned_qty' => 'Planned', 'good_qty' => 'Good', 'rejected_qty' => 'Rejected', 'rework_qty' => 'Rework', 'downtime_minutes' => 'Downtime (min)', 'manpower' => 'Manpower', 'achievement' => 'Achievement %', 'delay_reason' => 'Delay reason', 'entered_by' => 'Entered by' ) );
				break;
			case 'quality':
				$q = get_option( 'pp_quality_report', array() ); $name = 'data-quality-report';
				$sheets['Issues'] = PP_Export::table( array_map( function ( $i ) { return array( 'kind' => $i['kind'], 'details' => wp_json_encode( array_diff_key( $i, array( 'kind' => 1 ) ) ) ); }, $q['issues'] ?? array() ), array( 'kind' => 'Issue', 'details' => 'Details' ) );
				break;
			default:
				throw new RuntimeException( 'Unknown export.' );
		}
		$x = PP_Export::xlsx( $sheets, $name . '.xlsx' );
		$data = file_get_contents( $x['path'] );
		@unlink( $x['path'] );
		PP_Db::audit( 'export', 'report', $what );
		$resp = new WP_REST_Response( null, 200 );
		$resp->header( 'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' );
		$resp->header( 'Content-Disposition', 'attachment; filename="' . $x['filename'] . '"' );
		add_filter( 'rest_pre_serve_request', function ( $served, $result, $request ) use ( $data ) {
			if ( $result instanceof WP_REST_Response && $result->get_headers() && isset( $result->get_headers()['Content-Disposition'] ) ) {
				echo $data; // phpcs:ignore
				return true;
			}
			return $served;
		}, 10, 3 );
		return $resp;
	}
}
