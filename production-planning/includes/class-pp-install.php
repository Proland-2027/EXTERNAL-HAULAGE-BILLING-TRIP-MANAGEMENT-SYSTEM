<?php
/**
 * Schema installation, upgrades and first-run seeding.
 */
class PP_Install {

	public static function activate() {
		self::create_tables();
		PP_Roles::install();
		self::seed_calendar_defaults();
		update_option( 'pp_db_version', PP_DB_VERSION );
		flush_rewrite_rules();
		if ( ! get_option( 'pp_seeded' ) ) {
			$result = PP_Seeder::seed_from_bundled_workbook();
			update_option( 'pp_seeded', $result ? current_time( 'mysql' ) : '' );
		}
		set_transient( 'pp_activated', 1, 60 );
	}

	public static function maybe_upgrade() {
		if ( get_option( 'pp_db_version' ) !== PP_DB_VERSION ) {
			self::create_tables();
			PP_Roles::install();
			update_option( 'pp_db_version', PP_DB_VERSION );
		}
	}

	public static function schema() {
		global $wpdb;
		$c = $wpdb->get_charset_collate();
		$p = $wpdb->prefix . 'pp_';
		$t = array();

		$t[] = "CREATE TABLE {$p}products (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  code varchar(64) NOT NULL,
  description varchar(255) DEFAULT '',
  kind varchar(8) NOT NULL DEFAULT 'RM',
  product_type varchar(32) DEFAULT NULL,
  family varchar(32) DEFAULT NULL,
  canopy_size varchar(32) DEFAULT NULL,
  uom varchar(16) DEFAULT NULL,
  std_cost decimal(18,4) DEFAULT NULL,
  cost_group varchar(32) DEFAULT NULL,
  type1 varchar(32) DEFAULT NULL,
  warehouse varchar(32) DEFAULT NULL,
  is_finished tinyint(1) NOT NULL DEFAULT 0,
  sellable tinyint(1) NOT NULL DEFAULT 0,
  active tinyint(1) NOT NULL DEFAULT 1,
  stock_qty decimal(14,4) NOT NULL DEFAULT 0,
  source varchar(16) NOT NULL DEFAULT 'excel',
  notes text,
  updated_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY code (code),
  KEY kind (kind),
  KEY is_finished (is_finished)
) $c;";

		$t[] = "CREATE TABLE {$p}bom_lines (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  parent_code varchar(64) NOT NULL,
  component_code varchar(64) NOT NULL,
  qty decimal(14,6) NOT NULL DEFAULT 0,
  uom varchar(16) DEFAULT NULL,
  line_no int(11) DEFAULT NULL,
  calc_type varchar(16) DEFAULT 'Item',
  type1 varchar(32) DEFAULT NULL,
  cost_group varchar(32) DEFAULT NULL,
  warehouse varchar(32) DEFAULT NULL,
  std_cost decimal(18,4) DEFAULT NULL,
  unit_cost decimal(18,4) DEFAULT NULL,
  source varchar(16) NOT NULL DEFAULT 'excel',
  PRIMARY KEY  (id),
  UNIQUE KEY parent_component (parent_code,component_code),
  KEY component_code (component_code)
) $c;";

		$t[] = "CREATE TABLE {$p}routings (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  parent_code varchar(64) NOT NULL,
  resource_code varchar(64) NOT NULL,
  hours_per_unit decimal(12,4) NOT NULL DEFAULT 0,
  std_cost decimal(18,4) DEFAULT NULL,
  kind varchar(16) NOT NULL DEFAULT 'labor',
  operation varchar(64) DEFAULT NULL,
  source varchar(16) NOT NULL DEFAULT 'excel',
  PRIMARY KEY  (id),
  UNIQUE KEY parent_resource (parent_code,resource_code)
) $c;";

		$t[] = "CREATE TABLE {$p}overheads (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  parent_code varchar(64) NOT NULL,
  resource_code varchar(64) NOT NULL,
  name varchar(128) DEFAULT NULL,
  hours decimal(12,4) DEFAULT NULL,
  std_cost decimal(18,4) DEFAULT NULL,
  kind varchar(32) NOT NULL DEFAULT 'manufacturing_overhead',
  rate_per_hour decimal(18,4) DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY parent_resource (parent_code,resource_code)
) $c;";

		$t[] = "CREATE TABLE {$p}resources (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  code varchar(64) NOT NULL,
  name varchar(128) DEFAULT NULL,
  kind varchar(16) NOT NULL DEFAULT 'labor',
  operation varchar(64) DEFAULT NULL,
  department_code varchar(32) DEFAULT NULL,
  rate_per_hour decimal(18,4) DEFAULT NULL,
  rate_observations int(11) DEFAULT 0,
  PRIMARY KEY  (id),
  UNIQUE KEY code (code)
) $c;";

		$t[] = "CREATE TABLE {$p}departments (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  code varchar(32) NOT NULL,
  name varchar(128) NOT NULL,
  site varchar(64) DEFAULT NULL,
  stage varchar(32) NOT NULL DEFAULT 'FINAL',
  stage_order int(11) NOT NULL DEFAULT 90,
  manpower decimal(8,2) NOT NULL DEFAULT 0,
  machines int(11) NOT NULL DEFAULT 1,
  minutes_per_day int(11) NOT NULL DEFAULT 480,
  manpower_source varchar(255) DEFAULT NULL,
  active tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY  (id),
  UNIQUE KEY code (code)
) $c;";

		$t[] = "CREATE TABLE {$p}capacities (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  department_code varchar(32) NOT NULL,
  section varchar(128) DEFAULT NULL,
  key_code varchar(64) DEFAULT NULL,
  family varchar(32) DEFAULT NULL,
  size varchar(32) DEFAULT NULL,
  category varchar(32) DEFAULT NULL,
  units_per_day decimal(12,4) DEFAULT NULL,
  units_per_machine_per_day decimal(12,4) DEFAULT NULL,
  staff decimal(8,2) DEFAULT NULL,
  prod_lines decimal(8,2) DEFAULT NULL,
  available_staff decimal(8,2) DEFAULT NULL,
  planned_productivity decimal(12,4) DEFAULT NULL,
  source varchar(128) DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY department_code (department_code),
  KEY key_code (key_code)
) $c;";

		$t[] = "CREATE TABLE {$p}machines (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  code varchar(32) NOT NULL,
  name varchar(128) NOT NULL,
  department_code varchar(32) NOT NULL,
  minutes_per_day int(11) NOT NULL DEFAULT 480,
  active tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY  (id),
  UNIQUE KEY code (code)
) $c;";

		$t[] = "CREATE TABLE {$p}machine_capacities (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  machine_code varchar(32) NOT NULL,
  department_code varchar(32) NOT NULL,
  key_code varchar(64) DEFAULT NULL,
  family varchar(32) DEFAULT NULL,
  size varchar(32) DEFAULT NULL,
  category varchar(32) DEFAULT NULL,
  minutes_per_unit decimal(12,4) DEFAULT NULL,
  units_per_shift decimal(12,4) DEFAULT NULL,
  pct_shift_per_unit decimal(12,6) DEFAULT NULL,
  source varchar(128) DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY machine_code (machine_code)
) $c;";

		$t[] = "CREATE TABLE {$p}cutting_files (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  sheet varchar(64) DEFAULT NULL,
  canopy_type varchar(64) DEFAULT NULL,
  machine_code varchar(32) DEFAULT NULL,
  file_name varchar(32) DEFAULT NULL,
  parts varchar(255) DEFAULT NULL,
  plate varchar(128) DEFAULT NULL,
  minutes decimal(12,4) DEFAULT NULL,
  PRIMARY KEY  (id)
) $c;";

		$t[] = "CREATE TABLE {$p}material_prices (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  material_code varchar(64) NOT NULL,
  description varchar(255) DEFAULT NULL,
  uom varchar(16) DEFAULT NULL,
  unit_price decimal(18,4) DEFAULT NULL,
  currency varchar(8) DEFAULT 'NGN',
  source varchar(32) DEFAULT 'excel_unit_cost',
  cost_group varchar(32) DEFAULT NULL,
  updated_by varchar(64) DEFAULT NULL,
  updated_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY material_code (material_code)
) $c;";

		$t[] = "CREATE TABLE {$p}calendar (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  cal_date date NOT NULL,
  is_working tinyint(1) NOT NULL DEFAULT 1,
  minutes_available int(11) NOT NULL DEFAULT 480,
  overtime_minutes int(11) NOT NULL DEFAULT 0,
  shifts int(11) NOT NULL DEFAULT 1,
  note varchar(128) DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY cal_date (cal_date)
) $c;";

		$t[] = "CREATE TABLE {$p}sales_requests (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  request_no varchar(32) NOT NULL,
  customer varchar(128) DEFAULT NULL,
  sales_order_ref varchar(64) DEFAULT NULL,
  product_code varchar(64) NOT NULL,
  product_description varchar(255) DEFAULT NULL,
  product_type varchar(32) DEFAULT NULL,
  qty decimal(12,2) NOT NULL DEFAULT 1,
  delivery_date date DEFAULT NULL,
  priority varchar(16) NOT NULL DEFAULT 'Normal',
  remarks text,
  status varchar(24) NOT NULL DEFAULT 'Submitted',
  confirmed_plan_id bigint(20) unsigned DEFAULT NULL,
  expected_completion date DEFAULT NULL,
  forecast_completion date DEFAULT NULL,
  actual_completion date DEFAULT NULL,
  created_by varchar(64) DEFAULT NULL,
  created_at datetime DEFAULT NULL,
  updated_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY request_no (request_no),
  KEY status (status),
  KEY product_code (product_code)
) $c;";

		$t[] = "CREATE TABLE {$p}plans (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  plan_no varchar(32) NOT NULL,
  request_id bigint(20) unsigned NOT NULL,
  version int(11) NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'proposed',
  params longtext,
  summary longtext,
  created_by varchar(64) DEFAULT NULL,
  created_at datetime DEFAULT NULL,
  confirmed_by varchar(64) DEFAULT NULL,
  confirmed_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY plan_no (plan_no),
  KEY request_id (request_id)
) $c;";

		$t[] = "CREATE TABLE {$p}production_orders (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  order_no varchar(32) NOT NULL,
  plan_id bigint(20) unsigned NOT NULL,
  request_id bigint(20) unsigned NOT NULL,
  parent_order_id bigint(20) unsigned DEFAULT NULL,
  product_code varchar(64) NOT NULL,
  description varchar(255) DEFAULT NULL,
  parent_codes varchar(255) DEFAULT NULL,
  finished_product_code varchar(64) DEFAULT NULL,
  level int(11) NOT NULL DEFAULT 0,
  required_qty decimal(14,4) NOT NULL DEFAULT 0,
  planned_qty decimal(14,4) NOT NULL DEFAULT 0,
  completed_qty decimal(14,4) NOT NULL DEFAULT 0,
  rejected_qty decimal(14,4) NOT NULL DEFAULT 0,
  status varchar(24) NOT NULL DEFAULT 'Planned',
  is_master tinyint(1) NOT NULL DEFAULT 0,
  has_routing tinyint(1) NOT NULL DEFAULT 1,
  planned_start date DEFAULT NULL,
  planned_finish date DEFAULT NULL,
  baseline_finish date DEFAULT NULL,
  forecast_finish date DEFAULT NULL,
  actual_finish date DEFAULT NULL,
  actual_material_cost decimal(18,2) DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY order_no (order_no),
  KEY plan_id (plan_id),
  KEY request_id (request_id),
  KEY status (status)
) $c;";

		$t[] = "CREATE TABLE {$p}work_orders (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  wo_no varchar(32) NOT NULL,
  production_order_id bigint(20) unsigned NOT NULL,
  plan_id bigint(20) unsigned NOT NULL,
  request_id bigint(20) unsigned NOT NULL,
  product_code varchar(64) NOT NULL,
  department_code varchar(32) NOT NULL,
  operation_name varchar(128) DEFAULT NULL,
  seq int(11) NOT NULL DEFAULT 1,
  planned_qty decimal(14,4) NOT NULL DEFAULT 0,
  good_qty decimal(14,4) NOT NULL DEFAULT 0,
  rejected_qty decimal(14,4) NOT NULL DEFAULT 0,
  rework_qty decimal(14,4) NOT NULL DEFAULT 0,
  received_qty decimal(14,4) NOT NULL DEFAULT 0,
  transferred_qty decimal(14,4) NOT NULL DEFAULT 0,
  minutes_per_unit decimal(12,4) NOT NULL DEFAULT 0,
  labor_hours_per_unit decimal(12,4) NOT NULL DEFAULT 0,
  machine_hours_per_unit decimal(12,4) NOT NULL DEFAULT 0,
  planned_minutes decimal(14,2) NOT NULL DEFAULT 0,
  capacity_basis varchar(255) DEFAULT NULL,
  units_per_day decimal(12,4) DEFAULT NULL,
  manpower_required decimal(8,2) DEFAULT NULL,
  planned_start date DEFAULT NULL,
  planned_finish date DEFAULT NULL,
  baseline_start date DEFAULT NULL,
  baseline_finish date DEFAULT NULL,
  forecast_start date DEFAULT NULL,
  forecast_finish date DEFAULT NULL,
  actual_start datetime DEFAULT NULL,
  actual_finish datetime DEFAULT NULL,
  status varchar(24) NOT NULL DEFAULT 'Planned',
  is_first_op tinyint(1) NOT NULL DEFAULT 0,
  is_last_op tinyint(1) NOT NULL DEFAULT 0,
  downtime_minutes int(11) NOT NULL DEFAULT 0,
  version int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY  (id),
  UNIQUE KEY wo_no (wo_no),
  KEY production_order_id (production_order_id),
  KEY department_code (department_code),
  KEY plan_id (plan_id),
  KEY status (status)
) $c;";

		$t[] = "CREATE TABLE {$p}wo_dependencies (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  wo_id bigint(20) unsigned NOT NULL,
  depends_on_wo_id bigint(20) unsigned NOT NULL,
  kind varchar(16) NOT NULL DEFAULT 'sequence',
  ratio decimal(14,6) NOT NULL DEFAULT 1,
  PRIMARY KEY  (id),
  KEY wo_id (wo_id),
  KEY depends_on_wo_id (depends_on_wo_id)
) $c;";

		$t[] = "CREATE TABLE {$p}daily_targets (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  wo_id bigint(20) unsigned NOT NULL,
  plan_id bigint(20) unsigned NOT NULL,
  department_code varchar(32) NOT NULL,
  target_date date NOT NULL,
  planned_qty decimal(14,4) NOT NULL DEFAULT 0,
  planned_minutes decimal(14,2) NOT NULL DEFAULT 0,
  kind varchar(16) NOT NULL DEFAULT 'baseline',
  PRIMARY KEY  (id),
  KEY wo_id (wo_id),
  KEY target_date (target_date),
  KEY dept_date (department_code,target_date)
) $c;";

		$t[] = "CREATE TABLE {$p}production_entries (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  entry_date date NOT NULL,
  department_code varchar(32) NOT NULL,
  wo_id bigint(20) unsigned NOT NULL,
  product_code varchar(64) DEFAULT NULL,
  planned_qty decimal(14,4) NOT NULL DEFAULT 0,
  good_qty decimal(14,4) NOT NULL DEFAULT 0,
  rejected_qty decimal(14,4) NOT NULL DEFAULT 0,
  rework_qty decimal(14,4) NOT NULL DEFAULT 0,
  downtime_minutes int(11) NOT NULL DEFAULT 0,
  manpower decimal(8,2) DEFAULT NULL,
  delay_reason varchar(128) DEFAULT NULL,
  remarks text,
  entered_by varchar(64) DEFAULT NULL,
  created_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY wo_id (wo_id),
  KEY entry_date (entry_date),
  KEY department_code (department_code)
) $c;";

		$t[] = "CREATE TABLE {$p}wip_transfers (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  transfer_no varchar(32) NOT NULL,
  from_wo_id bigint(20) unsigned NOT NULL,
  to_wo_id bigint(20) unsigned NOT NULL,
  from_department varchar(32) DEFAULT NULL,
  to_department varchar(32) DEFAULT NULL,
  product_code varchar(64) DEFAULT NULL,
  qty decimal(14,4) NOT NULL DEFAULT 0,
  received_qty decimal(14,4) DEFAULT NULL,
  status varchar(16) NOT NULL DEFAULT 'sent',
  sent_by varchar(64) DEFAULT NULL,
  sent_at datetime DEFAULT NULL,
  received_by varchar(64) DEFAULT NULL,
  received_at datetime DEFAULT NULL,
  remarks varchar(255) DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY transfer_no (transfer_no),
  KEY from_wo_id (from_wo_id),
  KEY to_wo_id (to_wo_id)
) $c;";

		$t[] = "CREATE TABLE {$p}material_requirements (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  plan_id bigint(20) unsigned NOT NULL,
  request_id bigint(20) unsigned NOT NULL,
  material_code varchar(64) NOT NULL,
  description varchar(255) DEFAULT NULL,
  uom varchar(16) DEFAULT NULL,
  qty decimal(14,4) NOT NULL DEFAULT 0,
  unit_price decimal(18,4) DEFAULT NULL,
  cost decimal(18,2) DEFAULT NULL,
  price_status varchar(32) DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY plan_id (plan_id)
) $c;";

		$t[] = "CREATE TABLE {$p}alerts (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  level varchar(16) NOT NULL DEFAULT 'warning',
  type varchar(32) NOT NULL,
  message varchar(255) NOT NULL,
  request_id bigint(20) unsigned DEFAULT NULL,
  wo_id bigint(20) unsigned DEFAULT NULL,
  department_code varchar(32) DEFAULT NULL,
  audience varchar(64) DEFAULT NULL,
  created_at datetime DEFAULT NULL,
  acknowledged_by varchar(64) DEFAULT NULL,
  acknowledged_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY request_id (request_id),
  KEY acknowledged_at (acknowledged_at)
) $c;";

		$t[] = "CREATE TABLE {$p}audit_log (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned DEFAULT 0,
  user_login varchar(64) DEFAULT NULL,
  action varchar(64) NOT NULL,
  entity varchar(32) NOT NULL,
  entity_id varchar(64) DEFAULT NULL,
  details longtext,
  created_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY entity (entity,entity_id),
  KEY created_at (created_at)
) $c;";

		$t[] = "CREATE TABLE {$p}productivity_history (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  sheet varchar(64) DEFAULT NULL,
  week_label varchar(32) DEFAULT NULL,
  day_name varchar(8) DEFAULT NULL,
  section varchar(128) DEFAULT NULL,
  key_code varchar(64) DEFAULT NULL,
  department_code varchar(32) DEFAULT NULL,
  qty decimal(12,4) DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY department_code (department_code)
) $c;";

		$t[] = "CREATE TABLE {$p}sequences (
  seq_key varchar(32) NOT NULL,
  seq_value bigint(20) NOT NULL DEFAULT 0,
  PRIMARY KEY  (seq_key)
) $c;";

		return $t;
	}

	public static function create_tables() {
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		foreach ( self::schema() as $sql ) {
			dbDelta( $sql );
		}
	}

	/** Pre-fill the calendar for the next 18 months with the standard working week. */
	public static function seed_calendar_defaults() {
		global $wpdb;
		$t = PP_Db::t( 'calendar' );
		if ( (int) $wpdb->get_var( "SELECT COUNT(*) FROM $t" ) > 0 ) {
			return;
		}
		$s     = PP_Db::settings();
		$rows  = array();
		$start = new DateTime( 'first day of this month' );
		for ( $i = 0; $i < 548; $i++ ) {
			$d   = clone $start;
			$d->modify( "+$i day" );
			$dow = (int) $d->format( 'N' );
			$wk  = in_array( $dow, $s['working_days'], true ) ? 1 : 0;
			$rows[] = array(
				'cal_date'          => $d->format( 'Y-m-d' ),
				'is_working'        => $wk,
				'minutes_available' => $wk ? (int) $s['net_minutes'] : 0,
				'overtime_minutes'  => 0,
				'shifts'            => 1,
				'note'              => $wk ? null : 'Weekend',
			);
		}
		PP_Db::bulk_insert( 'calendar', $rows );
	}

	/** Danger: wipes transactional data (used by the demo reset). */
	public static function truncate_transactions() {
		foreach ( array( 'sales_requests', 'plans', 'production_orders', 'work_orders', 'wo_dependencies', 'daily_targets', 'production_entries', 'wip_transfers', 'material_requirements', 'alerts' ) as $tbl ) {
			PP_Db::query( 'DELETE FROM ' . PP_Db::t( $tbl ) );
		}
		PP_Db::query( 'DELETE FROM ' . PP_Db::t( 'sequences' ) . " WHERE seq_key IN ('SR','PL','PO','WO','TR')" );
	}
}
