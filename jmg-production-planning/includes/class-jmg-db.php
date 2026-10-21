<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Database schema and table helpers.
 */
class JMG_DB {

	public static function table( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'jmg_' . $name;
	}

	public static function activate() {
		self::create_tables();
		JMG_Roles::register();
		JMG_Roles::add_caps();
		JMG_Settings::install_defaults();
		JMG_App::add_rewrite();
		flush_rewrite_rules();
		update_option( 'jmg_pp_db_version', JMG_PP_DB_VERSION );
		// Seed master data from the bundled workbook if the product master is empty.
		global $wpdb;
		$count = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table( 'products' ) );
		if ( 0 === $count && file_exists( JMG_PP_DIR . 'data/Prodction_Data.xlsx' ) ) {
			try {
				$imp = new JMG_Importer();
				$imp->import_workbook( JMG_PP_DIR . 'data/Prodction_Data.xlsx', 'activation' );
			} catch ( Exception $e ) {
				update_option( 'jmg_pp_import_error', $e->getMessage() );
			}
		}
	}

	public static function maybe_upgrade() {
		if ( get_option( 'jmg_pp_db_version' ) !== JMG_PP_DB_VERSION ) {
			self::create_tables();
			update_option( 'jmg_pp_db_version', JMG_PP_DB_VERSION );
		}
	}

	public static function create_tables() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();
		$p = $wpdb->prefix . 'jmg_';
		$sql = array();

		$sql[] = "CREATE TABLE {$p}products (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  code varchar(80) NOT NULL,
  description varchar(255) DEFAULT '',
  item_type varchar(20) NOT NULL DEFAULT 'RAW',
  category varchar(20) DEFAULT '',
  unit varchar(20) DEFAULT '',
  cost_group varchar(40) DEFAULT '',
  warehouse varchar(40) DEFAULT '',
  model_kva decimal(10,2) DEFAULT NULL,
  series_key varchar(40) DEFAULT '',
  is_finished tinyint(1) NOT NULL DEFAULT 0,
  is_active tinyint(1) NOT NULL DEFAULT 1,
  source varchar(20) DEFAULT 'excel',
  PRIMARY KEY  (id),
  UNIQUE KEY code (code),
  KEY item_type (item_type),
  KEY is_finished (is_finished)
) $charset;";

		$sql[] = "CREATE TABLE {$p}bom_lines (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  finished_code varchar(80) NOT NULL,
  parent_code varchar(80) NOT NULL,
  component_code varchar(80) NOT NULL,
  description varchar(255) DEFAULT '',
  level smallint NOT NULL DEFAULT 0,
  line_no int NOT NULL DEFAULT 0,
  qty decimal(18,6) NOT NULL DEFAULT 0,
  unit varchar(20) DEFAULT '',
  calc_type varchar(30) DEFAULT '',
  type1 varchar(40) DEFAULT '',
  type2 varchar(40) DEFAULT '',
  model varchar(40) DEFAULT '',
  type3 varchar(40) DEFAULT '',
  cost_group varchar(40) DEFAULT '',
  operation varchar(60) DEFAULT '',
  warehouse varchar(40) DEFAULT '',
  erp_cost_per_unit decimal(18,4) DEFAULT NULL,
  unit_cost decimal(18,4) DEFAULT NULL,
  line_cost decimal(18,4) DEFAULT NULL,
  rate decimal(18,4) DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY finished_code (finished_code),
  KEY component_code (component_code),
  KEY fin_parent (finished_code, parent_code)
) $charset;";

		$sql[] = "CREATE TABLE {$p}prices (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  code varchar(80) NOT NULL,
  description varchar(255) DEFAULT '',
  price_type varchar(20) NOT NULL DEFAULT 'material',
  unit varchar(20) DEFAULT '',
  cost_group varchar(40) DEFAULT '',
  unit_cost decimal(18,4) DEFAULT NULL,
  source varchar(20) DEFAULT 'excel',
  conflict_note varchar(255) DEFAULT '',
  updated_by bigint(20) DEFAULT NULL,
  updated_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY code (code),
  KEY price_type (price_type)
) $charset;";

		$sql[] = "CREATE TABLE {$p}sections (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  site varchar(40) DEFAULT '',
  sheet_source varchar(40) DEFAULT '',
  department varchar(80) DEFAULT '',
  section_name varchar(120) NOT NULL,
  stage_key varchar(40) DEFAULT '',
  resource_kind varchar(20) NOT NULL DEFAULT 'section',
  productivity_header varchar(80) DEFAULT '',
  excel_shifts smallint NOT NULL DEFAULT 1,
  staffs decimal(10,2) DEFAULT NULL,
  total_available_staffs decimal(10,2) DEFAULT NULL,
  staffs_to_keep decimal(10,2) DEFAULT NULL,
  staff_idle decimal(10,2) DEFAULT NULL,
  new_staffs decimal(10,2) DEFAULT NULL,
  flow_lines decimal(10,2) DEFAULT NULL,
  machines int NOT NULL DEFAULT 1,
  minutes_per_day int NOT NULL DEFAULT 480,
  is_active tinyint(1) NOT NULL DEFAULT 1,
  notes text,
  PRIMARY KEY  (id),
  KEY stage_key (stage_key)
) $charset;";

		$sql[] = "CREATE TABLE {$p}capacities (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  section_id bigint(20) unsigned NOT NULL,
  type_code varchar(80) NOT NULL,
  series_key varchar(40) DEFAULT '',
  kva_min decimal(10,2) DEFAULT NULL,
  kva_max decimal(10,2) DEFAULT NULL,
  per_resource decimal(12,4) DEFAULT NULL,
  staffs decimal(10,2) DEFAULT NULL,
  prod_lines decimal(10,2) DEFAULT NULL,
  productivity_per_shift decimal(12,4) DEFAULT NULL,
  new_productivity decimal(12,4) DEFAULT NULL,
  manual_override decimal(12,4) DEFAULT NULL,
  source_row int DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY section_id (section_id),
  KEY type_code (type_code)
) $charset;";

		$sql[] = "CREATE TABLE {$p}machine_times (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  canopy_series varchar(40) NOT NULL,
  machine varchar(40) NOT NULL,
  minutes_per_canopy decimal(12,4) NOT NULL DEFAULT 0,
  qty_per_shift decimal(12,4) DEFAULT NULL,
  pct_consumed decimal(12,6) DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY canopy_series (canopy_series)
) $charset;";

		$sql[] = "CREATE TABLE {$p}cutting_files (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  sheet_name varchar(40) NOT NULL,
  canopy_series varchar(40) NOT NULL,
  machine varchar(40) NOT NULL,
  file_name varchar(40) DEFAULT '',
  description varchar(255) DEFAULT '',
  time_text varchar(40) DEFAULT '',
  plate varchar(80) DEFAULT '',
  minutes decimal(12,4) DEFAULT NULL,
  PRIMARY KEY  (id)
) $charset;";

		$sql[] = "CREATE TABLE {$p}series (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  series_key varchar(40) NOT NULL,
  label varchar(80) DEFAULT '',
  family varchar(20) NOT NULL DEFAULT 'genset',
  kva_min decimal(10,2) DEFAULT NULL,
  kva_max decimal(10,2) DEFAULT NULL,
  canopy_cut_series varchar(40) DEFAULT '',
  aliases varchar(255) DEFAULT '',
  PRIMARY KEY  (id),
  UNIQUE KEY series_key (series_key)
) $charset;";

		$sql[] = "CREATE TABLE {$p}stage_map (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  op_prefix varchar(20) NOT NULL,
  family varchar(20) NOT NULL DEFAULT 'any',
  op_label varchar(120) DEFAULT '',
  stage_key varchar(40) NOT NULL,
  stage_name varchar(80) NOT NULL,
  workflow_group varchar(40) DEFAULT '',
  department varchar(80) DEFAULT '',
  sequence int NOT NULL DEFAULT 10,
  section_id bigint(20) unsigned DEFAULT NULL,
  machine_group varchar(40) DEFAULT '',
  match_mode varchar(20) NOT NULL DEFAULT 'auto',
  is_scheduled tinyint(1) NOT NULL DEFAULT 1,
  notes varchar(255) DEFAULT '',
  PRIMARY KEY  (id),
  UNIQUE KEY op_family (op_prefix, family)
) $charset;";

		$sql[] = "CREATE TABLE {$p}capacity_overrides (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  component_code varchar(80) NOT NULL,
  stage_key varchar(40) NOT NULL,
  capacity_id bigint(20) unsigned DEFAULT NULL,
  minutes_per_unit decimal(12,4) DEFAULT NULL,
  notes varchar(255) DEFAULT '',
  PRIMARY KEY  (id),
  UNIQUE KEY comp_stage (component_code, stage_key)
) $charset;";

		$sql[] = "CREATE TABLE {$p}calendar (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  cal_date date NOT NULL,
  is_working tinyint(1) NOT NULL DEFAULT 0,
  note varchar(120) DEFAULT '',
  PRIMARY KEY  (id),
  UNIQUE KEY cal_date (cal_date)
) $charset;";

		$sql[] = "CREATE TABLE {$p}requests (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  request_no varchar(30) NOT NULL,
  sales_ref varchar(80) DEFAULT '',
  customer varchar(160) DEFAULT '',
  product_code varchar(80) NOT NULL,
  description varchar(255) DEFAULT '',
  category varchar(20) DEFAULT '',
  qty decimal(12,2) NOT NULL DEFAULT 1,
  requested_date date DEFAULT NULL,
  priority varchar(10) NOT NULL DEFAULT 'Normal',
  status varchar(20) NOT NULL DEFAULT 'NEW',
  instructions text,
  requested_by varchar(80) DEFAULT '',
  created_by bigint(20) DEFAULT NULL,
  created_at datetime DEFAULT NULL,
  updated_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY request_no (request_no),
  KEY status (status)
) $charset;";

		$sql[] = "CREATE TABLE {$p}orders (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  order_no varchar(30) NOT NULL,
  request_id bigint(20) unsigned DEFAULT NULL,
  product_code varchar(80) NOT NULL,
  description varchar(255) DEFAULT '',
  category varchar(20) DEFAULT '',
  qty decimal(12,2) NOT NULL DEFAULT 1,
  priority varchar(10) NOT NULL DEFAULT 'Normal',
  status varchar(20) NOT NULL DEFAULT 'DRAFT',
  requested_date date DEFAULT NULL,
  plan_start date DEFAULT NULL,
  planned_start date DEFAULT NULL,
  planned_end date DEFAULT NULL,
  baseline_start date DEFAULT NULL,
  baseline_end date DEFAULT NULL,
  forecast_end date DEFAULT NULL,
  actual_end date DEFAULT NULL,
  lead_time_days int DEFAULT NULL,
  bottleneck varchar(160) DEFAULT '',
  planned_cost decimal(18,2) DEFAULT NULL,
  cost_status varchar(20) DEFAULT '',
  transfer_rule varchar(20) DEFAULT '',
  customer varchar(160) DEFAULT '',
  sales_ref varchar(80) DEFAULT '',
  qty_completed decimal(12,2) NOT NULL DEFAULT 0,
  schedule_json longtext,
  warnings_json longtext,
  notes text,
  created_by bigint(20) DEFAULT NULL,
  created_at datetime DEFAULT NULL,
  confirmed_by bigint(20) DEFAULT NULL,
  confirmed_at datetime DEFAULT NULL,
  updated_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY order_no (order_no),
  KEY status (status),
  KEY request_id (request_id)
) $charset;";

		$sql[] = "CREATE TABLE {$p}order_components (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  order_id bigint(20) unsigned NOT NULL,
  component_code varchar(80) NOT NULL,
  description varchar(255) DEFAULT '',
  parent_code varchar(80) DEFAULT '',
  level smallint NOT NULL DEFAULT 0,
  qty_per_parent decimal(18,6) NOT NULL DEFAULT 1,
  qty_per_unit decimal(18,6) NOT NULL DEFAULT 1,
  total_qty decimal(18,4) NOT NULL DEFAULT 0,
  inventory_qty decimal(18,4) NOT NULL DEFAULT 0,
  qty_to_make decimal(18,4) NOT NULL DEFAULT 0,
  unit varchar(20) DEFAULT '',
  comp_kind varchar(20) NOT NULL DEFAULT 'material',
  cost_group varchar(40) DEFAULT '',
  department varchar(120) DEFAULT '',
  unit_cost decimal(18,4) DEFAULT NULL,
  ext_cost decimal(18,2) DEFAULT NULL,
  cost_pending tinyint(1) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  PRIMARY KEY  (id),
  KEY order_id (order_id)
) $charset;";

		$sql[] = "CREATE TABLE {$p}order_ops (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  order_id bigint(20) unsigned NOT NULL,
  order_no varchar(30) DEFAULT '',
  component_id bigint(20) unsigned DEFAULT NULL,
  component_code varchar(80) NOT NULL,
  component_desc varchar(255) DEFAULT '',
  stage_key varchar(40) NOT NULL,
  stage_name varchar(80) NOT NULL,
  workflow_group varchar(40) DEFAULT '',
  department varchar(120) DEFAULT '',
  section_id bigint(20) unsigned DEFAULT NULL,
  section_name varchar(160) DEFAULT '',
  capacity_id bigint(20) unsigned DEFAULT NULL,
  capacity_match varchar(20) DEFAULT 'missing',
  capacity_note varchar(255) DEFAULT '',
  sequence int NOT NULL DEFAULT 10,
  level smallint NOT NULL DEFAULT 0,
  qty_planned decimal(18,4) NOT NULL DEFAULT 0,
  qty_completed decimal(18,4) NOT NULL DEFAULT 0,
  qty_rejected decimal(18,4) NOT NULL DEFAULT 0,
  qty_rework decimal(18,4) NOT NULL DEFAULT 0,
  minutes_per_unit decimal(14,4) DEFAULT NULL,
  bom_hours_per_unit decimal(14,4) DEFAULT NULL,
  machines_json text,
  predecessors_json text,
  op_codes varchar(255) DEFAULT '',
  site varchar(40) DEFAULT '',
  earliest_start date DEFAULT NULL,
  manual_minutes decimal(14,4) DEFAULT NULL,
  manual_section_id bigint(20) unsigned DEFAULT NULL,
  is_scheduled tinyint(1) NOT NULL DEFAULT 1,
  daily_json text,
  baseline_start date DEFAULT NULL,
  baseline_end date DEFAULT NULL,
  planned_start date DEFAULT NULL,
  planned_end date DEFAULT NULL,
  actual_start date DEFAULT NULL,
  actual_end date DEFAULT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  PRIMARY KEY  (id),
  KEY order_id (order_id),
  KEY section_id (section_id),
  KEY status (status)
) $charset;";

		$sql[] = "CREATE TABLE {$p}op_schedule (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  order_id bigint(20) unsigned NOT NULL,
  op_id bigint(20) unsigned NOT NULL,
  section_id bigint(20) unsigned DEFAULT NULL,
  resource_key varchar(60) NOT NULL,
  sched_date date NOT NULL,
  qty decimal(18,4) NOT NULL DEFAULT 0,
  minutes decimal(14,4) NOT NULL DEFAULT 0,
  is_actual tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  KEY op_id (op_id),
  KEY order_id (order_id),
  KEY res_date (resource_key, sched_date)
) $charset;";

		$sql[] = "CREATE TABLE {$p}daily_logs (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  log_date date NOT NULL,
  order_id bigint(20) unsigned NOT NULL,
  order_no varchar(30) DEFAULT '',
  op_id bigint(20) unsigned NOT NULL,
  section_id bigint(20) unsigned DEFAULT NULL,
  section_name varchar(160) DEFAULT '',
  component_code varchar(80) DEFAULT '',
  stage_name varchar(80) DEFAULT '',
  planned_qty decimal(18,4) NOT NULL DEFAULT 0,
  actual_qty decimal(18,4) NOT NULL DEFAULT 0,
  rejected_qty decimal(18,4) NOT NULL DEFAULT 0,
  rework_qty decimal(18,4) NOT NULL DEFAULT 0,
  wip_qty decimal(18,4) NOT NULL DEFAULT 0,
  downtime_min decimal(10,2) NOT NULL DEFAULT 0,
  manpower decimal(10,2) DEFAULT NULL,
  remarks text,
  delay_reason varchar(160) DEFAULT '',
  achievement_pct decimal(8,2) DEFAULT NULL,
  created_by bigint(20) DEFAULT NULL,
  created_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY log_date (log_date),
  KEY order_id (order_id),
  KEY op_id (op_id),
  KEY section_id (section_id)
) $charset;";

		$sql[] = "CREATE TABLE {$p}alerts (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  order_id bigint(20) unsigned DEFAULT NULL,
  order_no varchar(30) DEFAULT '',
  alert_type varchar(30) NOT NULL,
  severity varchar(10) NOT NULL DEFAULT 'warning',
  audience varchar(40) DEFAULT 'planning',
  message text,
  is_ack tinyint(1) NOT NULL DEFAULT 0,
  ack_by bigint(20) DEFAULT NULL,
  created_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY order_id (order_id),
  KEY is_ack (is_ack)
) $charset;";

		$sql[] = "CREATE TABLE {$p}data_issues (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  issue_type varchar(40) NOT NULL,
  ref_code varchar(120) DEFAULT '',
  message text,
  is_resolved tinyint(1) NOT NULL DEFAULT 0,
  created_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY issue_type (issue_type),
  KEY is_resolved (is_resolved)
) $charset;";

		$sql[] = "CREATE TABLE {$p}audit_log (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) DEFAULT NULL,
  user_login varchar(80) DEFAULT '',
  action varchar(60) NOT NULL,
  entity varchar(40) DEFAULT '',
  entity_id varchar(40) DEFAULT '',
  details longtext,
  ip varchar(60) DEFAULT '',
  created_at datetime DEFAULT NULL,
  PRIMARY KEY  (id),
  KEY entity (entity, entity_id),
  KEY created_at (created_at)
) $charset;";

		$sql[] = "CREATE TABLE {$p}settings (
  setting_key varchar(60) NOT NULL,
  setting_value longtext,
  PRIMARY KEY  (setting_key)
) $charset;";

		$sql[] = "CREATE TABLE {$p}import_log (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  file_name varchar(160) DEFAULT '',
  mode varchar(20) DEFAULT '',
  summary longtext,
  created_by bigint(20) DEFAULT NULL,
  created_at datetime DEFAULT NULL,
  PRIMARY KEY  (id)
) $charset;";

		foreach ( $sql as $q ) {
			dbDelta( $q );
		}
	}

	/** Names of all plugin tables (without prefix). */
	public static function all_tables() {
		return array( 'products', 'bom_lines', 'prices', 'sections', 'capacities', 'machine_times', 'cutting_files', 'series', 'stage_map', 'capacity_overrides', 'calendar', 'requests', 'orders', 'order_components', 'order_ops', 'op_schedule', 'daily_logs', 'alerts', 'data_issues', 'audit_log', 'settings', 'import_log' );
	}

	/** Multi-row insert helper. */
	public static function bulk_insert( $table, $rows, $chunk = 400 ) {
		global $wpdb;
		if ( empty( $rows ) ) { return 0; }
		$t = self::table( $table );
		$cols = array_keys( reset( $rows ) );
		$n = 0;
		foreach ( array_chunk( $rows, $chunk ) as $batch ) {
			$values = array();
			$params = array();
			foreach ( $batch as $r ) {
				$ph = array();
				foreach ( $cols as $c ) {
					$v = isset( $r[ $c ] ) ? $r[ $c ] : null;
					if ( null === $v ) { $ph[] = 'NULL'; } else { $ph[] = '%s'; $params[] = $v; }
				}
				$values[] = '(' . implode( ',', $ph ) . ')';
			}
			$q = "INSERT INTO $t (`" . implode( '`,`', $cols ) . '`) VALUES ' . implode( ',', $values );
			if ( $params ) { $q = $wpdb->prepare( $q, $params ); }
			$wpdb->query( $q );
			$n += count( $batch );
		}
		return $n;
	}

	public static function now() {
		return current_time( 'mysql' );
	}
}
