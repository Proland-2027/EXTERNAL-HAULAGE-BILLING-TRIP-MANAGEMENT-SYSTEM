<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Builds the manufacturing routing of an order from the BOM process rows and resolves each
 * operation to an Excel capacity row (section + productivity).
 */
class JMG_Routing {

	private $stage_map = array();   // prefix|family => map row
	private $sections = array();    // id => section
	private $caps = array();        // section_id => capacity rows
	private $series = array();      // series_key => row
	private $overrides = array();   // component|stage => override
	private $machine_times = array();// canopy_series => machine => minutes
	private $settings;

	public function __construct() {
		global $wpdb;
		$this->settings = JMG_Settings::all();
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'stage_map' ), ARRAY_A ) as $m ) { $this->stage_map[ $m['op_prefix'] . '|' . $m['family'] ] = $m; }
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'sections' ), ARRAY_A ) as $s ) { $this->sections[ (int) $s['id'] ] = $s; }
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'capacities' ), ARRAY_A ) as $c ) { $this->caps[ (int) $c['section_id'] ][] = $c; }
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'series' ), ARRAY_A ) as $s ) { $this->series[ $s['series_key'] ] = $s; }
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'capacity_overrides' ), ARRAY_A ) as $o ) { $this->overrides[ $o['component_code'] . '|' . $o['stage_key'] ] = $o; }
		foreach ( $wpdb->get_results( 'SELECT * FROM ' . JMG_DB::table( 'machine_times' ), ARRAY_A ) as $m ) { $this->machine_times[ $m['canopy_series'] ][ $m['machine'] ] = (float) $m['minutes_per_canopy']; }
	}

	public function sections() { return $this->sections; }

	/** Series record for a kVA rating. */
	public function series_for_kva( $kva ) {
		if ( null === $kva ) { return null; }
		foreach ( $this->series as $s ) {
			if ( null !== $s['kva_min'] && null !== $s['kva_max'] && $kva >= (float) $s['kva_min'] && $kva <= (float) $s['kva_max'] ) { return $s; }
		}
		return null;
	}

	/** Series record from a token found in a code. */
	public function series_for_token( $token ) {
		if ( '' === $token ) { return null; }
		foreach ( explode( ',', $token ) as $t ) {
			$t = trim( $t );
			if ( isset( $this->series[ $t ] ) ) { return $this->series[ $t ]; }
			foreach ( $this->series as $s ) {
				$aliases = array_map( 'trim', explode( ',', strtoupper( $s['aliases'] ) ) );
				if ( in_array( strtoupper( $t ), $aliases, true ) ) { return $s; }
			}
		}
		return null;
	}

	/**
	 * Build the list of operations for an exploded order.
	 * @param array $explosion  JMG_BOM::explode() result
	 * @param float $order_qty
	 * @return array( ops => [...], warnings => [...] )
	 */
	public function build( $explosion, $order_qty ) {
		$product = $explosion['product'];
		$kva = $product && null !== $product['model_kva'] ? (float) $product['model_kva'] : JMG_Importer::kva_from_code( $explosion['root']['code'] );
		$ops = array();
		$warnings = array();
		$this->build_node( $explosion['root'], $kva, $order_qty, $ops, $warnings, true );
		// sequence numbers for display: children first (deepest level first), then stage sequence
		usort( $ops, function( $a, $b ) {
			if ( $a['level'] !== $b['level'] ) { return $b['level'] - $a['level']; }
			if ( $a['component_code'] !== $b['component_code'] ) { return strcmp( $a['component_code'], $b['component_code'] ); }
			return $a['sequence'] - $b['sequence'];
		} );
		return array( 'ops' => $ops, 'warnings' => $warnings );
	}

	/** Recursively create ops for a node; returns the uid of the node's last scheduled op (or list of child last ops). */
	private function build_node( $node, $kva, $order_qty, &$ops, &$warnings, $is_root = false ) {
		// children first
		$child_last = array();
		foreach ( $node['children'] as $child ) {
			if ( 'assembly' !== $child['kind'] ) { continue; }
			$last = $this->build_node( $child, $kva, $order_qty, $ops, $warnings );
			foreach ( $last as $l ) { $child_last[] = array( 'uid' => $l, 'ratio' => (float) $child['qty_per_parent'] ); }
		}
		if ( empty( $node['ops'] ) ) { return $child_last; }
		$family = $is_root ? 'genset' : $node['family'];
		$code = $node['code'];
		$comp_kva = $is_root ? $kva : ( JMG_Importer::kva_from_component_code( $code ) ?: $kva );
		$comp_series = JMG_Importer::series_from_code( $code );

		// group process rows by stage
		$stages = array();
		foreach ( $node['ops'] as $op ) {
			$map = $this->stage_map[ $op['prefix'] . '|' . $family ] ?? ( $this->stage_map[ $op['prefix'] . '|any' ] ?? null );
			if ( ! $map ) {
				$warnings[] = 'No workflow stage mapped for operation ' . $op['code'] . ' on ' . $code . '; operation not scheduled.';
				continue;
			}
			$k = $map['stage_key'];
			if ( ! isset( $stages[ $k ] ) ) { $stages[ $k ] = array( 'map' => $map, 'labor_hours' => 0.0, 'machine_hours' => 0.0, 'codes' => array() ); }
			if ( 'MCH OVH' === $op['type3'] ) { $stages[ $k ]['machine_hours'] += $op['hours']; } else { $stages[ $k ]['labor_hours'] += $op['hours']; }
			$stages[ $k ]['codes'][] = $op['code'];
		}
		uasort( $stages, function( $a, $b ) { return (int) $a['map']['sequence'] - (int) $b['map']['sequence']; } );

		$qty = (float) ( $node['qty_to_make'] ?? $node['total_qty'] );
		$prev_uid = null;
		$first = true;
		$last_uids = array();
		foreach ( $stages as $skey => $st ) {
			$map = $st['map'];
			$uid = count( $ops ) + 1;
			$res = $this->resolve_capacity( $map, $code, $comp_series, $comp_kva, $kva, $family );
			$op = array(
				'uid' => $uid, 'component_code' => $code, 'component_desc' => $node['description'] ?? '', 'level' => (int) ( $node['level'] ?? 0 ),
				'stage_key' => $skey, 'stage_name' => $map['stage_name'], 'workflow_group' => $map['workflow_group'], 'department' => $map['department'],
				'sequence' => (int) $map['sequence'], 'qty_planned' => $qty, 'qty_completed' => 0.0,
				'bom_hours_per_unit' => round( $st['labor_hours'], 4 ), 'bom_machine_hours' => round( $st['machine_hours'], 4 ), 'op_codes' => $st['codes'],
				'section_id' => $res['section_id'], 'section_name' => $res['section_name'], 'capacity_id' => $res['capacity_id'],
				'capacity_match' => $res['match'], 'capacity_note' => $res['note'], 'minutes_per_unit' => $res['minutes_per_unit'],
				'machines' => $res['machines'], 'is_scheduled' => (int) $map['is_scheduled'] && null !== $res['minutes_per_unit'],
				'predecessors' => array(), 'site' => $res['site'],
			);
			if ( ! (int) $map['is_scheduled'] ) {
				$op['capacity_match'] = 'unscheduled';
				$op['capacity_note'] = 'No productivity figures in the workbook for this operation; it is listed for information and does not consume capacity.';
			} elseif ( null === $res['minutes_per_unit'] ) {
				$warnings[] = $code . ' / ' . $map['stage_name'] . ': ' . $res['note'];
			} elseif ( 'approx' === $res['match'] ) {
				$warnings[] = $code . ' / ' . $map['stage_name'] . ': ' . $res['note'];
			}
			if ( $first ) {
				foreach ( $child_last as $cl ) { $op['predecessors'][] = $cl; }
				$first = false;
			} elseif ( null !== $prev_uid ) {
				$op['predecessors'][] = array( 'uid' => $prev_uid, 'ratio' => 1.0 );
			}
			$ops[] = $op;
			if ( $op['is_scheduled'] ) { $prev_uid = $uid; }
		}
		// If no scheduled op in this node, pass the child dependencies upward.
		if ( null === $prev_uid ) { return $child_last; }
		return array( $prev_uid );
	}

	/** Resolve a section + capacity row for a stage of a component. */
	public function resolve_capacity( $map, $code, $comp_series, $comp_kva, $product_kva, $family ) {
		$out = array( 'section_id' => null, 'section_name' => '', 'capacity_id' => null, 'match' => 'missing', 'note' => '', 'minutes_per_unit' => null, 'machines' => array(), 'site' => '' );
		$stage_key = $map['stage_key'];
		// candidate sections: mapped section first, then every section with the same stage key
		$candidates = array();
		if ( $map['section_id'] && isset( $this->sections[ (int) $map['section_id'] ] ) ) { $candidates[] = (int) $map['section_id']; }
		foreach ( $this->sections as $sid => $s ) { if ( $s['stage_key'] === $stage_key && ! in_array( $sid, $candidates, true ) ) { $candidates[] = $sid; } }
		if ( empty( $candidates ) ) {
			$out['note'] = 'No production section in the workbook is mapped to stage "' . $map['stage_name'] . '".';
			return $out;
		}
		$ov = $this->overrides[ $code . '|' . $stage_key ] ?? null;
		$best = null; // array(score, cap, section)
		$product_series = $this->series_for_kva( $product_kva );
		$comp_series_rec = $this->series_for_token( $comp_series );
		foreach ( $candidates as $sid ) {
			$section = $this->sections[ $sid ];
			if ( ! (int) $section['is_active'] ) { continue; }
			foreach ( $this->caps[ $sid ] ?? array() as $cap ) {
				$score = null; $how = '';
				if ( $ov && $ov['capacity_id'] && (int) $ov['capacity_id'] === (int) $cap['id'] ) { $score = 100; $how = 'override'; }
				elseif ( '' !== $comp_series && '' !== $cap['series_key'] && $this->series_overlap( $comp_series, $cap['series_key'] ) ) { $score = 90; $how = 'series'; }
				elseif ( null !== $comp_kva && null !== $cap['kva_min'] && $comp_kva >= (float) $cap['kva_min'] && $comp_kva <= (float) $cap['kva_max'] ) { $score = 80; $how = 'kva'; }
				elseif ( $product_series && '' !== $cap['series_key'] && $this->series_overlap( $product_series['series_key'], $cap['series_key'] ) ) { $score = 70; $how = 'product series'; }
				elseif ( $comp_series_rec && null !== $cap['kva_min'] && null !== $comp_series_rec['kva_min'] && (float) $cap['kva_max'] >= (float) $comp_series_rec['kva_min'] && (float) $cap['kva_min'] <= (float) $comp_series_rec['kva_max'] ) { $score = 60; $how = 'series kVA band'; }
				elseif ( null !== $product_kva && null !== $cap['kva_min'] && $product_kva >= (float) $cap['kva_min'] && $product_kva <= (float) $cap['kva_max'] ) { $score = 50; $how = 'product kVA'; }
				if ( null !== $score && ( null === $best || $score > $best[0] ) ) { $best = array( $score, $cap, $section, $how ); }
			}
		}
		$approx = false;
		if ( null === $best ) {
			// nearest size class by kVA (next larger, else largest) - flagged as an assumption
			$kv = null !== $comp_kva ? $comp_kva : $product_kva;
			if ( null !== $kv ) {
				$nearest = null;
				foreach ( $candidates as $sid ) {
					foreach ( $this->caps[ $sid ] ?? array() as $cap ) {
						if ( null === $cap['kva_min'] ) { continue; }
						$d = (float) $cap['kva_min'] >= $kv ? (float) $cap['kva_min'] - $kv : 10000 + ( $kv - (float) $cap['kva_max'] );
						if ( null === $nearest || $d < $nearest[0] ) { $nearest = array( $d, $cap, $this->sections[ $sid ] ); }
					}
				}
				if ( $nearest ) { $best = array( 10, $nearest[1], $nearest[2], 'nearest size class' ); $approx = true; }
			}
		}
		if ( null === $best ) {
			$s = $this->sections[ $candidates[0] ];
			$out['section_id'] = (int) $s['id']; $out['section_name'] = $s['section_name']; $out['site'] = $s['site'];
			$out['note'] = 'Section "' . $s['section_name'] . '" has no productivity row for ' . $code . ( null !== $comp_kva ? ' (' . $comp_kva . ' kVA)' : '' ) . '. Add a capacity row or an override.';
			return $out;
		}
		list( $score, $cap, $section, $how ) = $best;
		$out['section_id'] = (int) $section['id']; $out['section_name'] = $section['section_name']; $out['capacity_id'] = (int) $cap['id']; $out['site'] = $section['site'];
		$out['match'] = $approx ? 'approx' : ( 'override' === $how ? 'override' : 'exact' );
		$prod = $this->productivity( $cap );
		$mpu = null;
		if ( $ov && null !== $ov['minutes_per_unit'] && (float) $ov['minutes_per_unit'] > 0 ) {
			$mpu = (float) $ov['minutes_per_unit']; $out['match'] = 'override';
			$out['note'] = 'Manual override: ' . $mpu . ' min/unit.';
		} elseif ( null === $prod || $prod <= 0 ) {
			$out['note'] = 'Workbook productivity for ' . $cap['type_code'] . ' in "' . $section['section_name'] . '" is 0/blank; enter a value in Masters > Capacities.';
			$out['match'] = 'missing';
		} else {
			$per_shift = $prod / max( 1, (int) $section['excel_shifts'] );
			$mpu = (float) $section['minutes_per_day'] / $per_shift;
			$out['note'] = sprintf( '%s row "%s": %s/%s%s -> %.1f min per unit (matched by %s).', $section['sheet_source'], $cap['type_code'], rtrim( rtrim( number_format( $prod, 2, '.', '' ), '0' ), '.' ), (int) $section['excel_shifts'] > 1 ? $section['excel_shifts'] . ' shifts' : 'shift', 'new' === ( $this->settings['capacity_basis'] ?? 'current' ) ? ' (new productivity)' : '', $mpu, $how );
			if ( $approx ) { $out['note'] = 'ASSUMPTION - ' . $out['note'] . ' No exact size class for ' . $code . '; nearest class used. Add an override to correct.'; }
		}
		$out['minutes_per_unit'] = null === $mpu ? null : round( $mpu, 4 );
		// machine constraints
		if ( '' !== $map['machine_group'] && null !== $mpu ) {
			$ser = $comp_series_rec ?: $product_series;
			$cut = $ser ? $ser['canopy_cut_series'] : '';
			if ( $cut && isset( $this->machine_times[ $cut ] ) ) {
				foreach ( $this->machine_times[ $cut ] as $machine => $mins ) { $out['machines'][] = array( 'resource_key' => 'machine:' . $machine, 'name' => $machine, 'minutes_per_unit' => $mins, 'series' => $cut ); }
			} else {
				$out['note'] .= ' No machine cutting times (Punch 1 / Punch 2 / Plasma) in the Cutting Capacity sheet for this canopy series; machine constraint not applied.';
			}
		}
		return $out;
	}

	private function series_overlap( $a, $b ) {
		$aa = array_map( 'trim', explode( ',', strtoupper( $a ) ) );
		$bb = array_map( 'trim', explode( ',', strtoupper( $b ) ) );
		foreach ( $aa as $x ) {
			if ( '' === $x ) { continue; }
			if ( in_array( $x, $bb, true ) ) { return true; }
			$rec = $this->series_for_token( $x );
			if ( $rec ) {
				$al = array_map( 'trim', explode( ',', strtoupper( $rec['aliases'] ) ) );
				foreach ( $bb as $y ) { if ( in_array( $y, $al, true ) || $y === strtoupper( $rec['series_key'] ) ) { return true; } }
			}
		}
		return false;
	}

	/** Productivity figure per the configured basis (current or "new"). */
	public function productivity( $cap ) {
		if ( null !== $cap['manual_override'] && (float) $cap['manual_override'] > 0 ) { return (float) $cap['manual_override']; }
		$basis = $this->settings['capacity_basis'] ?? 'current';
		$cur = null !== $cap['productivity_per_shift'] ? (float) $cap['productivity_per_shift'] : null;
		$new = null !== $cap['new_productivity'] ? (float) $cap['new_productivity'] : null;
		if ( 'new' === $basis ) { return ( null !== $new && $new > 0 ) ? $new : $cur; }
		return ( null !== $cur && $cur > 0 ) ? $cur : null;
	}

	/** Daily available minutes of a resource key. */
	public function resource_minutes_per_day( $resource_key ) {
		$shifts = max( 1, (int) ( $this->settings['shifts_per_day'] ?? 1 ) );
		if ( 0 === strpos( $resource_key, 'section:' ) ) {
			$sid = (int) substr( $resource_key, 8 );
			$s = $this->sections[ $sid ] ?? null;
			if ( ! $s ) { return 0; }
			return (float) $s['minutes_per_day'] * max( 1, (int) $s['machines'] ) * $shifts;
		}
		return (float) ( $this->settings['net_minutes'] ?? 480 ) * $shifts;
	}
}
