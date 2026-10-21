<?php
/**
 * Costing — BOM material cost, labour and overhead, cost snapshots and variance.
 * Material cost = Σ (raw / purchased component quantity × standard unit cost) over the exploded tree.
 * Semi-finished items are never priced by their own roll-up row (that would double count) — only their contents.
 */
final class Costing
{
    public function __construct(private App $app) {}

    /** Component-level BOM cost for one unit and for $qty units of a finished product. */
    public function bomCost(string $product, float $qty = 1.0): array
    {
        $ex = $this->app->planner->explode($product, $qty, false);
        return $this->buildFromExplosion($ex, $product, $qty);
    }

    /** Cost of a generated plan from its stored requirements (so later cost updates do not change the record). */
    public function planCost(int $planId): array
    {
        $db = $this->app->db;
        $plan = $db->one('SELECT * FROM {p}plans WHERE id=?', [$planId]);
        $ex = $this->app->planner->explode($plan['product_code'], (float)$plan['qty'], false);
        $cost = $this->buildFromExplosion($ex, $plan['product_code'], (float)$plan['qty']);
        $cost['plan_id'] = $planId; $cost['snapshot_at'] = $db->now();
        return $cost;
    }

    private function buildFromExplosion(array $ex, string $product, float $qty): array
    {
        $byComponent = []; $byGroup = []; $bySection = []; $flags = []; $flaggedCount = 0;
        $labour = 0.0; $labourHours = 0.0; $mfgOvh = 0.0; $lbrOvh = 0.0; $mchOvh = 0.0; $matOvh = 0.0;
        $sections = $this->app->planner->sections();
        $rates = $this->rates();
        $labourBySection = []; $sectionOf = [];
        foreach ($ex['orders'] as $code => $o) {
            // section attribution: the last labour operation of the sub-assembly (where it is completed)
            $secId = null; foreach ($o['processes'] as $p) if ($p['kind'] === 'LABOUR') $secId = $p['section_id'];
            $secName = $secId ? $sections[$secId]['department'] . ' — ' . $sections[$secId]['name'] : ($o['type'] === 'KIT' ? 'Kitting / bolt & nut kits' : 'Purchased / CKD assemblies (no in-house routing)');
            $sectionOf[$code] = $secName;
            foreach ($o['materials'] as $m) {
                $k = $m['code'];
                if (!isset($byComponent[$k])) $byComponent[$k] = ['code' => $k, 'name' => $m['name'], 'unit' => $m['unit'], 'cost_group' => $m['cost_group'], 'qty_per_unit' => 0.0, 'qty_total' => 0.0, 'unit_cost' => $m['unit_cost'], 'ext_cost' => 0.0, 'flags' => $m['flags'], 'used_in' => []];
                $byComponent[$k]['qty_total'] += $m['qty']; $byComponent[$k]['qty_per_unit'] += $m['qty'] / max(1e-9, $qty); $byComponent[$k]['ext_cost'] += $m['ext_cost'];
                $byComponent[$k]['used_in'][$code] = true;
                $g = $m['cost_group'] ?: '(none)';
                $byGroup[$g] = ($byGroup[$g] ?? 0) + $m['ext_cost'];
                $bySection[$secName]['material'] = ($bySection[$secName]['material'] ?? 0) + $m['ext_cost'];
                if ($m['flags']) { $flaggedCount++; foreach ($m['flags'] as $f) $flags[$f] = ($flags[$f] ?? 0) + 1; }
            }
            foreach ($o['processes'] as $p) {
                $hours = $p['hours_per_unit'] * $o['gross_qty'];
                $rateRow = $rates[$p['kind'] === 'LABOUR' ? 'LABOUR' : 'MACHINE_OVERHEAD'][$p['section_id']] ?? null;
                $cost = $rateRow && $rateRow['rate_per_hour'] !== null ? $hours * (float)$rateRow['rate_per_hour'] : $p['cost_per_unit'] * $o['gross_qty'];
                if ($p['kind'] === 'LABOUR') { $labour += $cost; $labourHours += $hours; $labourBySection[$sections[$p['section_id']]['name']] = ($labourBySection[$sections[$p['section_id']]['name']] ?? 0) + $cost; $bySection[$secName]['labour'] = ($bySection[$secName]['labour'] ?? 0) + $cost; }
                else { $mchOvh += $cost; $bySection[$secName]['overhead'] = ($bySection[$secName]['overhead'] ?? 0) + $cost; }
            }
            foreach ($o['overheads'] as $ov) {
                $c = $ov['cost_per_unit'] * $o['gross_qty'];
                if (str_starts_with($ov['code'], 'MOVH')) $mfgOvh += $c; elseif (str_starts_with($ov['code'], 'LOVH')) $lbrOvh += $c; else $matOvh += $c;
                $bySection[$secName]['overhead'] = ($bySection[$secName]['overhead'] ?? 0) + $c;
            }
        }
        // configured overhead rates (per labour hour) override the BOM's embedded overhead rows when set
        $cfgMfg = $this->overheadFromRates($rates['MFG_OVERHEAD'] ?? [], $ex, $sections);
        $cfgLbr = $this->overheadFromRates($rates['LABOUR_OVERHEAD'] ?? [], $ex, $sections);
        $material = array_sum(array_column($byComponent, 'ext_cost'));
        $matOvhPct = isset($rates['MATERIAL_OVERHEAD'][0]) ? (float)$rates['MATERIAL_OVERHEAD'][0]['pct_of_material'] : null;
        $materialOverhead = $matOvhPct !== null ? $material * $matOvhPct / 100 : $matOvh;
        $mfg = $cfgMfg ?? $mfgOvh; $lbr = $cfgLbr ?? $lbrOvh;
        $full = $material + $labour + $mchOvh + $mfg + $lbr + $materialOverhead;
        uasort($byComponent, fn($a, $b) => $b['ext_cost'] <=> $a['ext_cost']);
        foreach ($byComponent as &$c) { $c['used_in'] = array_keys($c['used_in']); $c['ext_cost_per_unit'] = $c['ext_cost'] / max(1e-9, $qty); } unset($c);
        arsort($byGroup);
        $groupRows = []; foreach ($byGroup as $g => $v) $groupRows[] = ['cost_group' => $g, 'ext_cost' => round($v, 2), 'per_unit' => round($v / max(1e-9, $qty), 2), 'pct' => $material > 0 ? round(100 * $v / $material, 1) : 0];
        $secRows = []; foreach ($bySection as $sname => $v) $secRows[] = ['section' => $sname, 'material' => round($v['material'] ?? 0, 2), 'labour' => round($v['labour'] ?? 0, 2), 'overhead' => round($v['overhead'] ?? 0, 2), 'total' => round(($v['material'] ?? 0) + ($v['labour'] ?? 0) + ($v['overhead'] ?? 0), 2)];
        usort($secRows, fn($a, $b) => $b['total'] <=> $a['total']);
        $sheetRoot = $ex['sheet_root_cost'];
        return [
            'product' => $product, 'qty' => $qty, 'currency' => $this->app->setting('currency', 'NGN'),
            'material_cost_per_unit' => round($material / max(1e-9, $qty), 2), 'material_cost_total' => round($material, 2),
            'labour_cost_total' => round($labour, 2), 'labour_hours_total' => round($labourHours, 2), 'machine_overhead_total' => round($mchOvh, 2),
            'mfg_overhead_total' => round($mfg, 2), 'labour_overhead_total' => round($lbr, 2), 'material_overhead_total' => round($materialOverhead, 2),
            'full_cost_total' => round($full, 2), 'full_cost_per_unit' => round($full / max(1e-9, $qty), 2),
            'sheet_rollup_per_unit' => $sheetRoot, 'sheet_rollup_variance_pct' => $sheetRoot ? round(100 * ($full / $qty - $sheetRoot) / $sheetRoot, 2) : null,
            'components' => array_values($byComponent), 'by_cost_group' => $groupRows, 'by_section' => $secRows, 'labour_by_section' => $labourBySection,
            'flags' => $flags, 'flagged_components' => $flaggedCount, 'warnings' => $ex['warnings'],
            'overhead_source' => ['mfg' => $cfgMfg !== null ? 'configured rate per labour hour' : 'BOM MOVH rows', 'labour_overhead' => $cfgLbr !== null ? 'configured rate per labour hour' : 'BOM LOVH rows', 'material_overhead' => $matOvhPct !== null ? "$matOvhPct % of material" : 'BOM MTOVHD rows'],
        ];
    }

    private function overheadFromRates(array $bySection, array $ex, array $sections): ?float
    {
        if (!$bySection) return null;
        $configured = array_filter($bySection, fn($r) => !empty($r['configured']));
        if (!$configured) return null;
        $tot = 0.0;
        foreach ($ex['orders'] as $o) foreach ($o['processes'] as $p) if ($p['kind'] === 'LABOUR' && isset($bySection[$p['section_id']])) $tot += $p['hours_per_unit'] * $o['gross_qty'] * (float)$bySection[$p['section_id']]['rate_per_hour'];
        return $tot;
    }

    public function rates(): array
    {
        $out = [];
        foreach ($this->app->db->all('SELECT * FROM {p}cost_rates ORDER BY kind, section_id') as $r) {
            $r['configured'] = !str_starts_with((string)$r['notes'], 'Derived from BOM');
            if ($r['kind'] === 'MATERIAL_OVERHEAD') $out[$r['kind']][0] = $r; else $out[$r['kind']][(int)$r['section_id']] = $r;
        }
        return $out;
    }

    /** Approved cost update: history + audit; existing plan snapshots are untouched. */
    public function updateItemCost(string $code, float $newCost, string $reason): void
    {
        $db = $this->app->db;
        $item = $db->one('SELECT * FROM {p}items WHERE code=?', [$code]);
        if (!$item) throw new HttpException(404, 'Item not found');
        $user = $this->app->auth->currentUser();
        $db->transaction(function () use ($db, $item, $newCost, $reason, $user, $code) {
            $db->insert('item_cost_history', ['item_code' => $code, 'old_cost' => $item['std_cost'], 'new_cost' => $newCost, 'reason' => $reason, 'changed_by' => $user['username'] ?? 'system', 'changed_at' => $db->now()]);
            $db->update('items', ['std_cost' => $newCost, 'cost_status' => 'OK', 'cost_date' => gmdate('Y-m-d'), 'cost_updated_at' => $db->now(), 'cost_updated_by' => $user['username'] ?? 'system'], 'code=?', [$code]);
            $db->run("UPDATE {p}exceptions SET status='REVIEWED', reviewed_by=?, reviewed_at=? WHERE category='COST' AND ref_type='item' AND ref_id=? AND status='OPEN'", [$user['username'] ?? 'system', $db->now(), $code]);
            $this->app->audit->log('COST_UPDATED', 'item', $code, ['old' => $item['std_cost'], 'new' => $newCost, 'reason' => $reason]);
        });
    }

    /** Standard vs actual material consumption for a plan (actual = store issues linked to its orders). */
    public function variance(int $planId): array
    {
        $db = $this->app->db;
        $std = $db->all('SELECT component_code, component_name, unit, SUM(qty_required) std_qty, MAX(unit_cost) unit_cost, SUM(ext_cost) std_cost, SUM(issued_qty) issued FROM {p}materials WHERE plan_id=? GROUP BY component_code, component_name, unit', [$planId]);
        $actual = [];
        foreach ($db->all("SELECT item_code, SUM(CASE WHEN mtype='ISSUE' THEN qty WHEN mtype='RETURN' THEN -qty ELSE 0 END) q, SUM(CASE WHEN mtype='ISSUE' THEN qty*COALESCE(unit_cost,0) WHEN mtype='RETURN' THEN -qty*COALESCE(unit_cost,0) ELSE 0 END) c FROM {p}inventory_movements WHERE plan_id=? AND mtype IN ('ISSUE','RETURN') GROUP BY item_code", [$planId]) as $a) $actual[$a['item_code']] = $a;
        $rows = []; $ts = 0; $ta = 0;
        foreach ($std as $s) {
            $a = $actual[$s['component_code']] ?? null;
            $aq = $a ? (float)$a['q'] : 0.0; $ac = $a ? (float)$a['c'] : 0.0;
            if ($a && $ac == 0 && $aq > 0) $ac = $aq * (float)$s['unit_cost'];
            $rows[] = ['code' => $s['component_code'], 'name' => $s['component_name'], 'unit' => $s['unit'], 'std_qty' => round((float)$s['std_qty'], 3), 'actual_qty' => round($aq, 3), 'qty_variance' => round($aq - (float)$s['std_qty'], 3), 'unit_cost' => (float)$s['unit_cost'], 'std_cost' => round((float)$s['std_cost'], 2), 'actual_cost' => round($ac, 2), 'cost_variance' => round($ac - (float)$s['std_cost'], 2)];
            $ts += (float)$s['std_cost']; $ta += $ac;
        }
        usort($rows, fn($x, $y) => abs($y['cost_variance']) <=> abs($x['cost_variance']));
        return ['rows' => $rows, 'standard_total' => round($ts, 2), 'actual_total' => round($ta, 2), 'variance_total' => round($ta - $ts, 2), 'variance_pct' => $ts > 0 ? round(100 * ($ta - $ts) / $ts, 2) : null];
    }
}
