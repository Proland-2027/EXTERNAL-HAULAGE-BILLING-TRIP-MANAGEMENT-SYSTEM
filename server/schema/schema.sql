-- Proland Production Planning schema. Pseudo-types: AUTOINC, TEXT, LONGTXT, DATETIME, BOOL, DOUBLE (see Db::migrate).

CREATE TABLE IF NOT EXISTS {p}settings (
  skey TEXT NOT NULL PRIMARY KEY,
  svalue LONGTXT
);

CREATE TABLE IF NOT EXISTS {p}users (
  id AUTOINC,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL,
  section_id INTEGER,
  active BOOL NOT NULL DEFAULT 1,
  wp_user_id INTEGER,
  created_at DATETIME NOT NULL,
  last_login DATETIME
);

CREATE TABLE IF NOT EXISTS {p}sessions (
  token TEXT NOT NULL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS {p}audit_log (
  id AUTOINC,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details LONGTXT,
  created_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS {p}ix_audit_entity ON {p}audit_log (entity, entity_id);

-- ---------------------------------------------------------------- master data
CREATE TABLE IF NOT EXISTS {p}sections (
  id AUTOINC,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department TEXT,
  activity TEXT NOT NULL,            -- one of the 9 manufacturing activities
  seq INTEGER NOT NULL DEFAULT 0,
  site TEXT,
  lines INTEGER NOT NULL DEFAULT 1,  -- parallel production lines / machines
  staff INTEGER NOT NULL DEFAULT 1,
  minutes_per_day INTEGER NOT NULL DEFAULT 480,
  color TEXT,
  allow_partial_transfer BOOL NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS {p}resources (
  code TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                -- LABOUR | MACHINE
  section_id INTEGER,
  seq INTEGER NOT NULL DEFAULT 0,    -- routing order within an item
  rate_per_hour DOUBLE,
  cost_group TEXT,
  operation TEXT
);

CREATE TABLE IF NOT EXISTS {p}items (
  code TEXT NOT NULL PRIMARY KEY,
  name TEXT,
  item_type TEXT NOT NULL,           -- FINISHED | SEMI | RAW | PHANTOM | KIT
  product_type TEXT,                 -- GENSET | CANOPY | COMPONENT
  unit TEXT,
  warehouse TEXT,
  cost_group TEXT,
  type1 TEXT, type2 TEXT, type3 TEXT,
  bom_model TEXT,                    -- 'Model' column of the BOM sheet (FGW, YTO, MOBILE GENSETS ...)
  family TEXT,                       -- capacity family (LST, 400SRS, S1, S2, S3, S4, 200-250, 350-500, 700-800, 1100+)
  model TEXT,                        -- kVA model key (P13, P110, EY110, ...)
  is_finished_product BOOL NOT NULL DEFAULT 0,
  std_cost DOUBLE,                   -- standard unit cost = Cost per lot size ÷ consumption (as the sheet rolls up)
  current_price DOUBLE,              -- 'Unit Cost' column of the BOM sheet where given (latest purchase price)
  cost_status TEXT,                  -- OK | ZERO | OUTDATED | INCONSISTENT | MISSING
  cost_date TEXT,
  cost_updated_at DATETIME,
  cost_updated_by TEXT
);
CREATE INDEX IF NOT EXISTS {p}ix_items_type ON {p}items (item_type);

CREATE TABLE IF NOT EXISTS {p}bom_rows (
  id AUTOINC,
  root_code TEXT NOT NULL,
  parent_code TEXT,
  component_code TEXT NOT NULL,
  product_name TEXT,
  status TEXT, type1 TEXT, finished_code TEXT, type2 TEXT, model TEXT, type3 TEXT,
  level INTEGER NOT NULL,
  line_no INTEGER,
  qty_per DOUBLE NOT NULL,
  unit TEXT,
  cost_per_lot DOUBLE,
  lot_size DOUBLE,
  cost_per_unit DOUBLE,
  calc_type TEXT NOT NULL,           -- Item | BOM | Process | Rate | Output unit based | Production
  warehouse TEXT, site TEXT, cost_group TEXT, operation TEXT,
  cost_date TEXT,
  unit_cost DOUBLE,
  total_cost DOUBLE,
  cost_flag TEXT
);
CREATE INDEX IF NOT EXISTS {p}ix_bom_root ON {p}bom_rows (root_code, parent_code);
CREATE INDEX IF NOT EXISTS {p}ix_bom_comp ON {p}bom_rows (component_code);

CREATE TABLE IF NOT EXISTS {p}item_cost_history (
  id AUTOINC,
  item_code TEXT NOT NULL,
  old_cost DOUBLE, new_cost DOUBLE,
  reason TEXT,
  changed_by TEXT,
  changed_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS {p}capacity_rates (
  id AUTOINC,
  section_id INTEGER NOT NULL,
  family TEXT NOT NULL,
  model TEXT,
  source TEXT NOT NULL,              -- worksheet + block the rate came from
  source_code TEXT,                  -- code / type as written in the worksheet
  units_per_day DOUBLE NOT NULL,     -- total per working day (all lines / machines / staff)
  per_unit_rate DOUBLE,              -- per machine / staff as recorded
  staff DOUBLE, lines DOUBLE,
  is_primary BOOL NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS {p}ix_cap_sec ON {p}capacity_rates (section_id, family);

CREATE TABLE IF NOT EXISTS {p}machines (
  id AUTOINC,
  section_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  minutes_per_shift INTEGER NOT NULL DEFAULT 480,
  active BOOL NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS {p}cutting_capacity (
  id AUTOINC,
  family TEXT NOT NULL,              -- canopy model as written in the Cutting Capacity sheet
  machine TEXT NOT NULL,             -- Punch 1 | Punch 2 | Plasma
  minutes_per_canopy DOUBLE,
  qty_per_shift_calc DOUBLE,
  qty_per_shift_recorded DOUBLE,
  summary_qty_per_shift DOUBLE,      -- the single "Qty produced per shift" column
  minutes_required_per_canopy DOUBLE,
  pct_machine_consumed DOUBLE
);

CREATE TABLE IF NOT EXISTS {p}cutting_files (
  id AUTOINC,
  family TEXT NOT NULL,
  machine TEXT NOT NULL,
  file_name TEXT,
  description LONGTXT,
  minutes DOUBLE,
  plate TEXT,
  sheet_name TEXT
);

CREATE TABLE IF NOT EXISTS {p}calendar (
  cdate TEXT NOT NULL PRIMARY KEY,
  is_working BOOL NOT NULL DEFAULT 1,
  minutes INTEGER NOT NULL DEFAULT 480,
  note TEXT
);

CREATE TABLE IF NOT EXISTS {p}cost_rates (
  id AUTOINC,
  kind TEXT NOT NULL,                -- LABOUR | MFG_OVERHEAD | LABOUR_OVERHEAD | MATERIAL_OVERHEAD
  section_id INTEGER,
  rate_per_hour DOUBLE,
  pct_of_material DOUBLE,
  valid_from TEXT,
  notes TEXT
);

-- ---------------------------------------------------------------- demand & planning
CREATE TABLE IF NOT EXISTS {p}sales_requests (
  id AUTOINC,
  number TEXT NOT NULL UNIQUE,
  sales_order_ref TEXT,
  customer TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_desc TEXT,
  product_type TEXT,
  qty DOUBLE NOT NULL,
  delivery_date TEXT,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  remarks LONGTXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',  -- SUBMITTED | PLANNED | APPROVED | IN_PROGRESS | COMPLETED | CANCELLED
  created_by TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS {p}plans (
  id AUTOINC,
  sales_request_id INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PROPOSED',   -- PROPOSED | APPROVED | SUPERSEDED | COMPLETED | SCENARIO
  product_code TEXT NOT NULL,
  qty DOUBLE NOT NULL,
  start_date TEXT NOT NULL,
  consider_inventory BOOL NOT NULL DEFAULT 0,
  expected_completion TEXT,
  baseline_completion TEXT,
  revised_completion TEXT,
  bottleneck_section_id INTEGER,
  critical_path LONGTXT,
  summary LONGTXT,                   -- JSON: counts, utilisation, warnings
  cost_snapshot LONGTXT,             -- JSON: BOM costing frozen at approval
  created_by TEXT,
  created_at DATETIME NOT NULL,
  approved_by TEXT,
  approved_at DATETIME,
  notes LONGTXT
);

CREATE TABLE IF NOT EXISTS {p}orders (
  id AUTOINC,
  plan_id INTEGER NOT NULL,
  number TEXT NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT,
  parent_order_id INTEGER,
  level INTEGER NOT NULL DEFAULT 0,
  gross_qty DOUBLE NOT NULL,
  inventory_used DOUBLE NOT NULL DEFAULT 0,
  net_qty DOUBLE NOT NULL,
  family TEXT,
  main_section_id INTEGER,
  status TEXT NOT NULL DEFAULT 'PLANNED',    -- PLANNED | RELEASED | IN_PROGRESS | COMPLETED | CANCELLED
  planned_start TEXT, planned_finish TEXT,
  baseline_start TEXT, baseline_finish TEXT,
  actual_finish TEXT,
  completed_qty DOUBLE NOT NULL DEFAULT 0,
  is_critical BOOL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS {p}ix_orders_plan ON {p}orders (plan_id);

CREATE TABLE IF NOT EXISTS {p}operations (
  id AUTOINC,
  plan_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  section_id INTEGER NOT NULL,
  resource_code TEXT,
  machine_resource_code TEXT,
  machine_id INTEGER,
  item_code TEXT NOT NULL,
  required_qty DOUBLE NOT NULL,
  hours_per_unit DOUBLE,
  daily_capacity DOUBLE NOT NULL,
  capacity_source TEXT,
  total_minutes DOUBLE NOT NULL DEFAULT 0,
  planned_start TEXT, planned_finish TEXT,
  baseline_start TEXT, baseline_finish TEXT,
  actual_start TEXT, actual_finish TEXT,
  good_qty DOUBLE NOT NULL DEFAULT 0,
  rejected_qty DOUBLE NOT NULL DEFAULT 0,
  rework_qty DOUBLE NOT NULL DEFAULT 0,
  received_qty DOUBLE NOT NULL DEFAULT 0,  -- transferred in from predecessor
  status TEXT NOT NULL DEFAULT 'PLANNED',  -- PLANNED | READY | IN_PROGRESS | COMPLETED
  is_critical BOOL NOT NULL DEFAULT 0,
  delay_days INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS {p}ix_ops_plan ON {p}operations (plan_id, section_id);
CREATE INDEX IF NOT EXISTS {p}ix_ops_order ON {p}operations (order_id, seq);

CREATE TABLE IF NOT EXISTS {p}op_loads (
  id AUTOINC,
  op_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  section_id INTEGER NOT NULL,
  machine_id INTEGER,
  ldate TEXT NOT NULL,
  minutes DOUBLE NOT NULL,
  qty DOUBLE NOT NULL
);
CREATE INDEX IF NOT EXISTS {p}ix_loads_sec ON {p}op_loads (section_id, ldate);
CREATE INDEX IF NOT EXISTS {p}ix_loads_op ON {p}op_loads (op_id);

CREATE TABLE IF NOT EXISTS {p}order_deps (
  order_id INTEGER NOT NULL,
  requires_order_id INTEGER NOT NULL,
  PRIMARY KEY (order_id, requires_order_id)
);

CREATE TABLE IF NOT EXISTS {p}op_deps (
  op_id INTEGER NOT NULL,
  depends_on INTEGER NOT NULL,
  dep_type TEXT NOT NULL DEFAULT 'FS',      -- FS finish-to-start, PT partial transfer
  PRIMARY KEY (op_id, depends_on)
);

CREATE TABLE IF NOT EXISTS {p}materials (
  id AUTOINC,
  plan_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  component_code TEXT NOT NULL,
  component_name TEXT,
  qty_per DOUBLE NOT NULL,
  qty_required DOUBLE NOT NULL,
  unit TEXT,
  unit_cost DOUBLE,
  ext_cost DOUBLE,
  cost_group TEXT,
  warehouse TEXT,
  cost_flag TEXT,
  issued_qty DOUBLE NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS {p}ix_mat_plan ON {p}materials (plan_id);

CREATE TABLE IF NOT EXISTS {p}daily_reports (
  id AUTOINC,
  op_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  section_id INTEGER NOT NULL,
  rdate TEXT NOT NULL,
  planned_qty DOUBLE NOT NULL DEFAULT 0,
  good_qty DOUBLE NOT NULL DEFAULT 0,
  rejected_qty DOUBLE NOT NULL DEFAULT 0,
  rework_qty DOUBLE NOT NULL DEFAULT 0,
  downtime_min DOUBLE NOT NULL DEFAULT 0,
  delay_reason TEXT,
  remarks LONGTXT,
  supervisor TEXT,
  created_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS {p}ix_dr_op ON {p}daily_reports (op_id, rdate);
CREATE INDEX IF NOT EXISTS {p}ix_dr_date ON {p}daily_reports (rdate);

-- ---------------------------------------------------------------- inventory
CREATE TABLE IF NOT EXISTS {p}inventory_movements (
  id AUTOINC,
  item_code TEXT NOT NULL,
  category TEXT NOT NULL,            -- RAW | CUT | WELDED | COATED | BASE | PANEL | SEMI | FG
  mtype TEXT NOT NULL,               -- OPENING | RECEIPT | ISSUE | WIP_IN | WIP_OUT | REJECT | FG_RECEIPT | ADJUST
  qty DOUBLE NOT NULL,
  unit TEXT,
  unit_cost DOUBLE,
  order_id INTEGER,
  op_id INTEGER,
  plan_id INTEGER,
  reference TEXT,
  remarks LONGTXT,
  created_by TEXT,
  created_at DATETIME NOT NULL,
  mdate TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS {p}ix_inv_item ON {p}inventory_movements (item_code);
CREATE INDEX IF NOT EXISTS {p}ix_inv_order ON {p}inventory_movements (order_id);

-- ---------------------------------------------------------------- exceptions
CREATE TABLE IF NOT EXISTS {p}exceptions (
  id AUTOINC,
  category TEXT NOT NULL,            -- BOM | COST | CAPACITY | ROUTING | DATA | PRICING
  severity TEXT NOT NULL DEFAULT 'WARN',
  ref_type TEXT, ref_id TEXT,
  message LONGTXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  reviewed_by TEXT, reviewed_at DATETIME,
  created_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS {p}ix_exc_cat ON {p}exceptions (category, status);

-- ---------------------------------------------------------------- Trip Log (haulage) shared dataset
CREATE TABLE IF NOT EXISTS {p}haulage_state (
  id INTEGER NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  payload LONGTXT NOT NULL,
  updated_by TEXT,
  updated_at DATETIME NOT NULL
);
