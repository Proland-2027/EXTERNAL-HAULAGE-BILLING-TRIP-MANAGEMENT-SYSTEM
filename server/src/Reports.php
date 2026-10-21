<?php
/** Reports — management dashboard KPIs, section productivity, costing KPIs and chart series with filters. */
final class Reports
{
    public function __construct(private App $app) {}

    /**
     * $f: from, to (dates), product_code, section_id, plan_id, granularity (day|week|month)
     */
    public function dashboard(array $f): array
    {
        $db = $this->app->db;
        $from = $f['from'] ?? gmdate('Y-m-01'); $to = $f['to'] ?? gmdate('Y-m-t');
        $gran = $f['granularity'] ?? 'day'; if (!in_array($gran, ['day', 'week', 'month'], true)) $gran = 'day';
        $pw = []; $pp = [];
        if (!empty($f['product_code'])) { $pw[] = 'p.product_code=?'; $pp[] = $f['product_code']; }
        if (!empty($f['plan_id'])) { $pw[] = 'p.id=?'; $pp[] = (int)$f['plan_id']; }
        $planFilter = $pw ? ' AND ' . implode(' AND ', $pw) : '';
        $secFilter = !empty($f['section_id']) ? ' AND o.section_id=' . (int)$f['section_id'] : '';

        // finished products planned (FG receipt ops scheduled in the window) vs actual (FG receipt output reported in the window)
        $fgSec = (int)$db->val("SELECT id FROM {p}sections WHERE code='FG_RECEIPT'");
        $plannedFg = (float)$db->val("SELECT COALESCE(SUM(l.qty),0) FROM {p}op_loads l JOIN {p}operations o ON o.id=l.op_id JOIN {p}plans p ON p.id=l.plan_id WHERE l.machine_id IS NULL AND o.section_id=? AND p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND l.ldate BETWEEN ? AND ?$planFilter", array_merge([$fgSec, $from, $to], $pp));
        $actualFg = (float)$db->val("SELECT COALESCE(SUM(r.good_qty),0) FROM {p}daily_reports r JOIN {p}operations o ON o.id=r.op_id JOIN {p}plans p ON p.id=r.plan_id WHERE o.section_id=? AND r.rdate BETWEEN ? AND ?$planFilter", array_merge([$fgSec, $from, $to], $pp));
        $wo = $db->one("SELECT COUNT(*) total, SUM(CASE WHEN o.status='COMPLETED' THEN 1 ELSE 0 END) completed,
              SUM(CASE WHEN o.status<>'COMPLETED' AND o.baseline_finish IS NOT NULL AND o.planned_finish > o.baseline_finish AND EXISTS (SELECT 1 FROM {p}operations x WHERE x.order_id=o.id) THEN 1 ELSE 0 END) delayed,
              SUM(CASE WHEN o.status<>'COMPLETED' AND o.planned_finish < ? AND EXISTS (SELECT 1 FROM {p}operations x WHERE x.order_id=o.id) THEN 1 ELSE 0 END) overdue,
              SUM(CASE WHEN o.status IN ('RELEASED','IN_PROGRESS') THEN o.net_qty - o.completed_qty ELSE 0 END) wip_qty
            FROM {p}orders o JOIN {p}plans p ON p.id=o.plan_id WHERE p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND o.level>0 AND o.net_qty>0 AND ((o.planned_start BETWEEN ? AND ?) OR (o.planned_finish BETWEEN ? AND ?) OR (o.planned_start<=? AND o.planned_finish>=?))$planFilter", array_merge([gmdate('Y-m-d'), $from, $to, $from, $to, $from, $to], $pp));
        $lead = $db->all("SELECT p.start_date, p.expected_completion, p.baseline_completion, p.status FROM {p}plans p WHERE p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND ((p.start_date BETWEEN ? AND ?) OR (p.expected_completion BETWEEN ? AND ?) OR (p.start_date<=? AND p.expected_completion>=?))$planFilter", array_merge([$from, $to, $from, $to, $from, $to], $pp));
        $leadDays = []; foreach ($lead as $l) if ($l['start_date'] && $l['expected_completion']) $leadDays[] = $this->app->calendar->workingDaysBetween($l['start_date'], $l['expected_completion']);
        $plansDelayed = count(array_filter($lead, fn($l) => $l['baseline_completion'] && $l['expected_completion'] > $l['baseline_completion']));

        // section productivity: planned (loads) vs actual (reports) in the window
        $secRows = $db->all("SELECT s.id, s.code, s.name, s.activity, s.department,
              (SELECT COALESCE(SUM(l.qty),0) FROM {p}op_loads l JOIN {p}operations o ON o.id=l.op_id JOIN {p}plans p ON p.id=l.plan_id WHERE l.machine_id IS NULL AND l.section_id=s.id AND p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND l.ldate BETWEEN ? AND ?$planFilter) planned_qty,
              (SELECT COALESCE(SUM(l.minutes),0) FROM {p}op_loads l JOIN {p}plans p ON p.id=l.plan_id WHERE l.machine_id IS NULL AND l.section_id=s.id AND p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND l.ldate BETWEEN ? AND ?$planFilter) planned_minutes,
              (SELECT COALESCE(SUM(r.good_qty),0) FROM {p}daily_reports r JOIN {p}plans p ON p.id=r.plan_id WHERE r.section_id=s.id AND r.rdate BETWEEN ? AND ?$planFilter) good_qty,
              (SELECT COALESCE(SUM(r.planned_qty),0) FROM {p}daily_reports r JOIN {p}plans p ON p.id=r.plan_id WHERE r.section_id=s.id AND r.rdate BETWEEN ? AND ?$planFilter) reported_planned_qty,
              (SELECT COALESCE(SUM(r.rejected_qty),0) FROM {p}daily_reports r JOIN {p}plans p ON p.id=r.plan_id WHERE r.section_id=s.id AND r.rdate BETWEEN ? AND ?$planFilter) rejected_qty,
              (SELECT COALESCE(SUM(r.rework_qty),0) FROM {p}daily_reports r JOIN {p}plans p ON p.id=r.plan_id WHERE r.section_id=s.id AND r.rdate BETWEEN ? AND ?$planFilter) rework_qty,
              (SELECT COALESCE(SUM(r.downtime_min),0) FROM {p}daily_reports r JOIN {p}plans p ON p.id=r.plan_id WHERE r.section_id=s.id AND r.rdate BETWEEN ? AND ?$planFilter) downtime_min,
              (SELECT COUNT(*) FROM {p}daily_reports r JOIN {p}plans p ON p.id=r.plan_id WHERE r.section_id=s.id AND r.rdate BETWEEN ? AND ?$planFilter) reports
            FROM {p}sections s ORDER BY s.seq, s.id", array_merge(...array_fill(0, 8, array_merge([$from, $to], $pp))));
        $workDays = max(1, $this->app->calendar->workingDaysBetween($from, $to));
        foreach ($secRows as &$s) {
            $s['achievement_pct'] = (float)$s['reported_planned_qty'] > 0 ? round(100 * (float)$s['good_qty'] / (float)$s['reported_planned_qty'], 1) : null;
            $capMin = 480 * $workDays; // per line
            $s['planned_utilisation_pct'] = round(100 * (float)$s['planned_minutes'] / max(1, $capMin * max(1, (int)$db->val('SELECT lines FROM {p}sections WHERE id=?', [$s['id']]))), 1);
            $s['quality_pct'] = ((float)$s['good_qty'] + (float)$s['rejected_qty']) > 0 ? round(100 * (float)$s['good_qty'] / ((float)$s['good_qty'] + (float)$s['rejected_qty']), 1) : null;
        }
        unset($s);
        if (!empty($f['section_id'])) $secRows = array_values(array_filter($secRows, fn($s) => (int)$s['id'] === (int)$f['section_id']));

        // costing KPIs
        $plans = $db->all("SELECT p.id, p.product_code, p.qty, p.cost_snapshot, p.status, p.expected_completion FROM {p}plans p WHERE p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND ((p.start_date BETWEEN ? AND ?) OR (p.expected_completion BETWEEN ? AND ?) OR (p.start_date<=? AND p.expected_completion>=?))$planFilter", array_merge([$from, $to, $from, $to, $from, $to], $pp));
        $plannedCost = 0; $units = 0; $byModel = [];
        foreach ($plans as $p) { $c = json_decode($p['cost_snapshot'] ?? 'null', true); if (!$c) continue; $plannedCost += $c['material_cost_total']; $units += (float)$p['qty']; $byModel[$p['product_code']] = ['product' => $p['product_code'], 'qty' => ($byModel[$p['product_code']]['qty'] ?? 0) + (float)$p['qty'], 'material_cost' => ($byModel[$p['product_code']]['material_cost'] ?? 0) + $c['material_cost_total'], 'per_unit' => $c['material_cost_per_unit'], 'full_per_unit' => $c['full_cost_per_unit']]; }
        $actualCost = (float)$db->val("SELECT COALESCE(SUM(CASE WHEN m.mtype='ISSUE' THEN m.qty*COALESCE(m.unit_cost,0) WHEN m.mtype='RETURN' THEN -m.qty*COALESCE(m.unit_cost,0) ELSE 0 END),0) FROM {p}inventory_movements m LEFT JOIN {p}plans p ON p.id=m.plan_id WHERE m.mtype IN ('ISSUE','RETURN') AND m.mdate BETWEEN ? AND ?" . ($pw ? ' AND ' . implode(' AND ', $pw) : ''), array_merge([$from, $to], $pp));
        $monthCost = (float)$db->val("SELECT COALESCE(SUM(l.qty / NULLIF(o.required_qty,0) * mt.c),0) FROM {p}op_loads l JOIN {p}operations o ON o.id=l.op_id JOIN {p}plans p ON p.id=l.plan_id JOIN (SELECT order_id, SUM(ext_cost) c FROM {p}materials GROUP BY order_id) mt ON mt.order_id=o.order_id WHERE l.machine_id IS NULL AND o.seq=(SELECT MIN(seq) FROM {p}operations WHERE order_id=o.order_id) AND p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND l.ldate BETWEEN ? AND ?$planFilter", array_merge([$from, $to], $pp));

        // chart series: planned vs actual by period, per section optional
        $series = $this->series($from, $to, $gran, $planFilter, $pp, $secFilter);
        $delayed = $db->all("SELECT o.id, o.number, o.item_code, o.item_name, o.net_qty, o.completed_qty, o.baseline_finish, o.planned_finish, o.status, p.product_code, s.name section FROM {p}orders o JOIN {p}plans p ON p.id=o.plan_id LEFT JOIN {p}sections s ON s.id=o.main_section_id WHERE p.status IN ('APPROVED','IN_PROGRESS') AND o.status<>'COMPLETED' AND o.net_qty>0 AND o.baseline_finish IS NOT NULL AND o.planned_finish > o.baseline_finish AND EXISTS (SELECT 1 FROM {p}operations x WHERE x.order_id=o.id)$planFilter ORDER BY o.planned_finish LIMIT 100", $pp);
        foreach ($delayed as &$d) $d['delay_days'] = $this->app->planner->delayDays($d['baseline_finish'], $d['planned_finish']); unset($d);

        return [
            'from' => $from, 'to' => $to, 'granularity' => $gran, 'working_days' => $workDays,
            'kpis' => ['planned_finished' => round($plannedFg, 1), 'actual_finished' => round($actualFg, 1), 'achievement_pct' => $plannedFg > 0 ? round(100 * $actualFg / $plannedFg, 1) : null,
                'work_orders' => (int)$wo['total'], 'work_orders_completed' => (int)$wo['completed'], 'work_orders_delayed' => (int)$wo['delayed'], 'work_orders_overdue' => (int)$wo['overdue'], 'wip_qty' => round((float)$wo['wip_qty'], 1),
                'avg_lead_time_days' => $leadDays ? round(array_sum($leadDays) / count($leadDays), 1) : null, 'plans' => count($lead), 'plans_delayed' => $plansDelayed],
            'costing' => ['planned_bom_cost' => round($plannedCost, 2), 'bom_cost_per_unit' => $units > 0 ? round($plannedCost / $units, 2) : null, 'actual_material_cost' => round($actualCost, 2), 'material_cost_variance' => round($actualCost - $plannedCost, 2), 'monthly_production_material_cost' => round($monthCost, 2), 'by_model' => array_values($byModel), 'currency' => $this->app->setting('currency', 'NGN')],
            'sections' => $secRows, 'series' => $series, 'delayed_orders' => $delayed,
        ];
    }

    private function series(string $from, string $to, string $gran, string $planFilter, array $pp, string $secFilter): array
    {
        $db = $this->app->db;
        $planned = $db->all("SELECT l.ldate d, SUM(l.qty) q FROM {p}op_loads l JOIN {p}operations o ON o.id=l.op_id JOIN {p}plans p ON p.id=l.plan_id WHERE l.machine_id IS NULL AND p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') AND l.ldate BETWEEN ? AND ?$planFilter$secFilter GROUP BY l.ldate", array_merge([$from, $to], $pp));
        $actual = $db->all("SELECT r.rdate d, SUM(r.good_qty) q, SUM(r.rejected_qty) rj FROM {p}daily_reports r JOIN {p}operations o ON o.id=r.op_id JOIN {p}plans p ON p.id=r.plan_id WHERE r.rdate BETWEEN ? AND ?$planFilter$secFilter GROUP BY r.rdate", array_merge([$from, $to], $pp));
        $bucket = function (string $d) use ($gran): string {
            if ($gran === 'day') return $d;
            if ($gran === 'month') return substr($d, 0, 7);
            $dt = new DateTime($d); return $dt->format('o-\WW');
        };
        $out = [];
        for ($d = new DateTime($from); $d->format('Y-m-d') <= $to; $d->modify('+1 day')) { $b = $bucket($d->format('Y-m-d')); $out[$b] = $out[$b] ?? ['period' => $b, 'planned' => 0.0, 'actual' => 0.0, 'rejected' => 0.0]; }
        foreach ($planned as $r) { $b = $bucket($r['d']); $out[$b]['planned'] += (float)$r['q']; }
        foreach ($actual as $r) { $b = $bucket($r['d']); $out[$b]['actual'] += (float)$r['q']; $out[$b]['rejected'] += (float)$r['rj']; }
        foreach ($out as &$o) { $o['planned'] = round($o['planned'], 1); $o['actual'] = round($o['actual'], 1); } unset($o);
        return array_values($out);
    }

    /** Section dashboard: operations (with daily targets), today's load, reports. */
    public function sectionBoard(int $sectionId, ?string $date = null): array
    {
        $db = $this->app->db;
        $date = $date ?? gmdate('Y-m-d');
        $sec = $db->one('SELECT * FROM {p}sections WHERE id=?', [$sectionId]);
        if (!$sec) throw new HttpException(404, 'Section not found');
        $ops = $db->all("SELECT o.*, p.product_code, p.status plan_status, p.expected_completion, ord.number order_number, ord.item_name, ord.net_qty order_qty, s.number sr_number, s.customer, m.name machine_name,
              (SELECT COALESCE(SUM(l.qty),0) FROM {p}op_loads l WHERE l.op_id=o.id AND l.machine_id IS NULL AND l.ldate=?) today_target,
              (SELECT COALESCE(SUM(r.good_qty),0) FROM {p}daily_reports r WHERE r.op_id=o.id AND r.rdate=?) today_good,
              (SELECT COALESCE(SUM(pr.good_qty),0) FROM {p}operations pr JOIN {p}op_deps d ON d.depends_on=pr.id WHERE d.op_id=o.id) received_from_predecessor,
              (SELECT COUNT(*) FROM {p}op_deps d WHERE d.op_id=o.id) has_predecessor
            FROM {p}operations o JOIN {p}plans p ON p.id=o.plan_id JOIN {p}orders ord ON ord.id=o.order_id JOIN {p}sales_requests s ON s.id=p.sales_request_id LEFT JOIN {p}machines m ON m.id=o.machine_id
            WHERE o.section_id=? AND p.status IN ('APPROVED','IN_PROGRESS') ORDER BY o.status='COMPLETED', o.planned_start, o.id", [$date, $date, $sectionId]);
        foreach ($ops as &$o) {
            $o['remaining_qty'] = max(0, (float)$o['required_qty'] - (float)$o['good_qty']);
            $o['awaiting_from_predecessor'] = $o['has_predecessor'] ? max(0, (float)$o['required_qty'] - (float)$o['received_from_predecessor']) : 0;
            $o['available_to_process'] = $o['has_predecessor'] ? max(0, (float)$o['received_from_predecessor'] - (float)$o['good_qty'] - (float)$o['rejected_qty']) : $o['remaining_qty'];
        }
        unset($o);
        $loads = $db->all("SELECT l.ldate, SUM(l.minutes) minutes, SUM(l.qty) qty FROM {p}op_loads l JOIN {p}plans p ON p.id=l.plan_id WHERE l.section_id=? AND l.machine_id IS NULL AND p.status IN ('APPROVED','IN_PROGRESS') AND l.ldate BETWEEN ? AND ? GROUP BY l.ldate ORDER BY l.ldate", [$sectionId, (new DateTime($date))->modify('-7 days')->format('Y-m-d'), (new DateTime($date))->modify('+21 days')->format('Y-m-d')]);
        $cap = (int)$sec['minutes_per_day'] * max(1, (int)$sec['lines']);
        foreach ($loads as &$l) $l['utilisation_pct'] = round(100 * (float)$l['minutes'] / max(1, $cap * $this->app->calendar->minutes($l['ldate']) / 480), 1); unset($l);
        $reports = $db->all('SELECT r.*, o.item_code, ord.number order_number FROM {p}daily_reports r JOIN {p}operations o ON o.id=r.op_id JOIN {p}orders ord ON ord.id=r.order_id WHERE r.section_id=? ORDER BY r.rdate DESC, r.id DESC LIMIT 60', [$sectionId]);
        $machines = $db->all('SELECT * FROM {p}machines WHERE section_id=? AND active=1', [$sectionId]);
        $machineLoads = $db->all("SELECT l.machine_id, l.ldate, SUM(l.minutes) minutes FROM {p}op_loads l JOIN {p}plans p ON p.id=l.plan_id WHERE l.section_id=? AND l.machine_id IS NOT NULL AND p.status IN ('APPROVED','IN_PROGRESS') AND l.ldate BETWEEN ? AND ? GROUP BY l.machine_id, l.ldate", [$sectionId, $date, (new DateTime($date))->modify('+14 days')->format('Y-m-d')]);
        return ['section' => $sec, 'date' => $date, 'operations' => $ops, 'loads' => $loads, 'reports' => $reports, 'machines' => $machines, 'machine_loads' => $machineLoads, 'capacity_minutes' => $cap];
    }

    /** All sections in one view for the Production Manager, plus the planning board data (Gantt). */
    public function board(array $f = []): array
    {
        $db = $this->app->db;
        $statuses = !empty($f['include_proposed']) ? "('APPROVED','IN_PROGRESS','PROPOSED','SCENARIO')" : "('APPROVED','IN_PROGRESS')";
        $w = ''; $p = [];
        if (!empty($f['plan_id'])) { $w .= ' AND p.id=?'; $p[] = (int)$f['plan_id']; }
        $ops = $db->all("SELECT o.id, o.plan_id, o.order_id, o.seq, o.section_id, o.item_code, o.required_qty, o.good_qty, o.daily_capacity, o.planned_start, o.planned_finish, o.baseline_start, o.baseline_finish, o.status, o.is_critical, o.delay_days, o.machine_id,
              p.product_code, p.status plan_status, p.expected_completion, p.baseline_completion, ord.number order_number, ord.item_name, ord.level, s.number sr_number, s.customer, m.name machine_name
            FROM {p}operations o JOIN {p}plans p ON p.id=o.plan_id JOIN {p}orders ord ON ord.id=o.order_id JOIN {p}sales_requests s ON s.id=p.sales_request_id LEFT JOIN {p}machines m ON m.id=o.machine_id WHERE p.status IN $statuses$w ORDER BY o.section_id, o.planned_start", $p);
        $deps = $db->all("SELECT d.op_id, d.depends_on, d.dep_type FROM {p}op_deps d JOIN {p}operations o ON o.id=d.op_id JOIN {p}plans p ON p.id=o.plan_id WHERE p.status IN $statuses$w", $p);
        $orderDeps = $db->all("SELECT d.order_id, d.requires_order_id FROM {p}order_deps d JOIN {p}orders o ON o.id=d.order_id JOIN {p}plans p ON p.id=o.plan_id WHERE p.status IN $statuses$w", $p);
        $loads = $db->all("SELECT l.section_id, l.ldate, SUM(l.minutes) minutes FROM {p}op_loads l JOIN {p}plans p ON p.id=l.plan_id WHERE l.machine_id IS NULL AND p.status IN ('APPROVED','IN_PROGRESS') GROUP BY l.section_id, l.ldate");
        $sections = $db->all('SELECT * FROM {p}sections ORDER BY seq, id');
        $capById = []; foreach ($sections as $s) $capById[$s['id']] = (int)$s['minutes_per_day'] * max(1, (int)$s['lines']);
        foreach ($loads as &$l) $l['utilisation_pct'] = round(100 * (float)$l['minutes'] / max(1, $capById[$l['section_id']] * $this->app->calendar->minutes($l['ldate']) / 480), 1); unset($l);
        $plans = $db->all("SELECT p.id, p.product_code, p.qty, p.status, p.start_date, p.expected_completion, p.baseline_completion, p.bottleneck_section_id, s.number sr_number, s.customer, s.delivery_date FROM {p}plans p JOIN {p}sales_requests s ON s.id=p.sales_request_id WHERE p.status IN $statuses$w ORDER BY p.start_date", $p);
        return ['sections' => $sections, 'operations' => $ops, 'op_deps' => $deps, 'order_deps' => $orderDeps, 'loads' => $loads, 'plans' => $plans];
    }

    /** Capacity master with discrepancy view. */
    public function capacityMaster(): array
    {
        $db = $this->app->db;
        $rates = $db->all('SELECT r.*, s.code section_code, s.name section_name FROM {p}capacity_rates r JOIN {p}sections s ON s.id=r.section_id ORDER BY s.seq, r.family, r.model, r.is_primary DESC, r.id');
        $cutting = $db->all('SELECT * FROM {p}cutting_capacity ORDER BY family, machine');
        $files = $db->all('SELECT * FROM {p}cutting_files ORDER BY sheet_name, machine, id');
        $sections = $db->all('SELECT * FROM {p}sections ORDER BY seq, id');
        $machines = $db->all('SELECT m.*, s.name section_name FROM {p}machines m JOIN {p}sections s ON s.id=m.section_id ORDER BY s.seq, m.id');
        $disc = $db->all("SELECT * FROM {p}exceptions WHERE category='CAPACITY' ORDER BY status, id");
        return ['rates' => $rates, 'cutting' => $cutting, 'cutting_files' => $files, 'sections' => $sections, 'machines' => $machines, 'discrepancies' => $disc];
    }
}
