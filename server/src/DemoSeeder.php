<?php
/**
 * DemoSeeder — loads the five demonstration scenarios on top of the imported workbook:
 *   1. Production from scratch: 20 × MSPGP110, zero semi-finished stock, plan approved.
 *   2. Section productivity: actual output reported for Canopy Cutting, Welding and Powder Coating (and the rest of the past days).
 *   3. Production delay: Genset Assembly under-performs → remaining schedule and completion date recalculated.
 *   4. BOM costing: available for any finished product (plan 1 carries its cost snapshot).
 *   5. Monthly production: a second approved plan (SPGP33-OPT × 5) competing for the same sections, a proposed plan in the
 *      planning queue (SPGEY110 × 10), opening stock + store issues for material variance.
 * Dates are relative to today so the demo always shows work in progress.
 */
final class DemoSeeder
{
    public function __construct(private App $app) {}

    public function run(?callable $log = null): array
    {
        $log = $log ?? fn($m) => null;
        $db = $this->app->db;
        $this->app->seeder->seedUsers();
        $admin = $db->one("SELECT * FROM {p}users WHERE username='admin'");
        $this->app->auth->setCurrentUser($admin);
        $log('Clearing previous demo transactions');
        foreach (['daily_reports', 'op_loads', 'op_deps', 'order_deps', 'materials', 'operations', 'orders', 'plans', 'sales_requests', 'inventory_movements', 'haulage_state'] as $t) $db->run("DELETE FROM {p}$t");
        $db->run("DELETE FROM {p}audit_log WHERE action NOT IN ('WORKBOOK_IMPORTED')");

        $cal = $this->app->calendar;
        $today = gmdate('Y-m-d');
        $start = (new DateTime($today))->modify('monday this week')->modify('-7 days')->format('Y-m-d'); // Monday of last week
        $yesterday = (new DateTime($today))->modify('-1 day')->format('Y-m-d');
        $out = ['today' => $today, 'plan_start' => $start];

        // -------- Demo 1
        $log('Demo 1: 20 × MSPGP110 from scratch');
        $this->as('sales');
        $sr1 = $this->request('SR-' . gmdate('Y') . '-0001', 'SO-26-1001', 'Mainland Power Projects Ltd', 'MSPGP110', 20, (new DateTime($start))->modify('+6 weeks')->format('Y-m-d'), 'HIGH', 'Demo 1 — production from scratch, zero semi-finished stock');
        $this->as('planner');
        $plan1 = $this->app->planner->generate($sr1, ['start_date' => $start, 'consider_inventory' => false]);
        $this->app->planner->approve($plan1);
        $out['plan1'] = $plan1;
        $out['plan1_baseline_completion'] = $db->val('SELECT baseline_completion FROM {p}plans WHERE id=?', [$plan1]);

        // -------- Demo 5 (part): second approved order sharing the sections, and a proposed one in the queue
        $log('Demo 5: competing order SPGP33-OPT × 5 and a queued request');
        $this->as('sales');
        $sr2 = $this->request('SR-' . gmdate('Y') . '-0002', 'SO-26-1002', 'Delta Agro Processing', 'SPGP33-OPT', 5, (new DateTime($start))->modify('+5 weeks')->format('Y-m-d'), 'NORMAL', 'Demo 5 — second order competing for the same sections');
        $this->as('planner');
        $plan2 = $this->app->planner->generate($sr2, ['start_date' => $cal->nextWorkingDay($start, 2)]);
        $this->app->planner->approve($plan2);
        $out['plan2'] = $plan2;
        $this->as('sales');
        $sr3 = $this->request('SR-' . gmdate('Y') . '-0003', 'SO-26-1003', 'Northgate Estates', 'SPGEY110', 10, (new DateTime($today))->modify('+8 weeks')->format('Y-m-d'), 'NORMAL', 'Awaiting planner review — proposed plan generated automatically');
        $this->as('planner');
        $out['plan3_proposed'] = $this->app->planner->generate($sr3, ['start_date' => $cal->nextWorkingDay($today, 3)]);

        // -------- inventory: opening balances (raw materials + a few semi-finished panels) and store issues for plan 1
        $log('Store: opening balances and material issues');
        $this->as('store');
        $openingDate = (new DateTime($start))->modify('-3 days')->format('Y-m-d');
        $opening = ['MSH120001-H' => 120, 'MSH300001' => 60, 'MSH150X6X3' => 30, 'MSH400001' => 20, 'CHN100001' => 400, '1111931302-RAL-9001' => 300, 'AK3500' => 40, 'GRD400001' => 200, 'ELC250001' => 20, 'ELC350001' => 30, 'OPT-CPNL-S2' => 5, '143-0851' => 12];
        foreach ($opening as $code => $q) { if ($db->val('SELECT COUNT(*) FROM {p}items WHERE code=?', [$code])) $this->app->inventory->move(['item_code' => $code, 'mtype' => 'OPENING', 'qty' => $q, 'mdate' => $openingDate, 'reference' => 'Opening stock']); }
        // issue the steel for the canopy and base orders of plan 1 (actual slightly above standard on sheets → variance)
        $issues = [['SF-SPF-S3-OPT', 'MSH120001-H', 1.06], ['SF-SPF-S3-OPT', '1111931302-RAL-9001', 1.0], ['BASE-S3-OPT', 'MSH300001', 1.1], ['BASE-S3-OPT', 'MSH150X6X3', 1.0], ['BASE-S3-OPT', 'MSH400001', 0.95], ['SF-SPF-S3-OPT', 'AK3500', 1.0], ['SF-SPF-S3-OPT', 'ELC250001', 1.0]];
        foreach ($issues as [$orderItem, $mat, $factor]) {
            $o = $db->one('SELECT o.id FROM {p}orders o WHERE o.plan_id=? AND o.item_code=?', [$plan1, $orderItem]);
            $m = $db->one('SELECT * FROM {p}materials WHERE order_id=? AND component_code=?', [$o['id'], $mat]);
            if ($o && $m) { $q = round((float)$m['qty_required'] * $factor, 2); if ($q > 0) $this->app->inventory->move(['item_code' => $mat, 'mtype' => 'ISSUE', 'qty' => $q, 'order_id' => $o['id'], 'mdate' => $start, 'reference' => 'MRN-' . $o['id'], 'remarks' => 'Issued to ' . $orderItem, 'allow_negative' => true]); }
        }

        // -------- Demo 2 & 3: daily reports for every operation scheduled up to yesterday; Genset Assembly under-performs
        $log('Demo 2/3: daily production reports up to yesterday');
        $this->as('supervisor');
        $slowSection = $this->app->planner->sectionByCode('GENSET_ASSY');
        $weldSection = $this->app->planner->sectionByCode('CANOPY_WELD');
        $reports = 0;
        foreach ([$plan1, $plan2] as $pid) {
            // iterate day by day so each report sees the re-planned targets of the previous day
            for ($d = new DateTime($start); $d->format('Y-m-d') <= $yesterday; $d->modify('+1 day')) {
                $date = $d->format('Y-m-d');
                if (!$cal->isWorking($date)) continue;
                $rows = $db->all("SELECT l.op_id, SUM(l.qty) q, o.section_id, o.required_qty, o.good_qty FROM {p}op_loads l JOIN {p}operations o ON o.id=l.op_id WHERE l.plan_id=? AND l.ldate=? AND l.machine_id IS NULL AND o.status<>'COMPLETED' GROUP BY l.op_id, o.section_id, o.required_qty, o.good_qty", [$pid, $date]);
                foreach ($rows as $r) {
                    $planned = (float)$r['q']; if ($planned <= 0.01) continue;
                    $remaining = (float)$r['required_qty'] - (float)$r['good_qty'];
                    $good = min($remaining, round($planned)); $rej = 0; $rew = 0; $down = 0; $reason = null; $remarks = null;
                    if ($pid === $plan1 && (int)$r['section_id'] === (int)$slowSection['id']) { $good = min($remaining, 8); $down = 150; $reason = 'Material shortage'; $remarks = 'Engine CKD kits (RK-P110) short-delivered — only 8 sets available; balance expected next delivery'; }
                    if ($pid === $plan1 && (int)$r['section_id'] === (int)$weldSection['id'] && $reports % 3 === 1) { $rej = 1; $rew = 1; $good = max(0, $good - 1); $reason = 'Quality / rework'; $remarks = 'One door frame distorted during welding — sent for rework'; }
                    if ($good <= 0 && $rej <= 0) continue;
                    $this->app->planner->recordDaily(['op_id' => (int)$r['op_id'], 'date' => $date, 'planned_qty' => $planned, 'good_qty' => $good, 'rejected_qty' => $rej, 'rework_qty' => $rew, 'downtime_min' => $down, 'delay_reason' => $reason, 'remarks' => $remarks]);
                    $reports++;
                }
            }
        }
        $out['daily_reports'] = $reports;
        $p1 = $db->one('SELECT baseline_completion, expected_completion, summary FROM {p}plans WHERE id=?', [$plan1]);
        $out['plan1_expected_completion'] = $p1['expected_completion'];
        $out['plan1_delay_days'] = json_decode($p1['summary'], true)['delay_days'] ?? null;
        $this->app->auth->setCurrentUser($admin);
        $this->app->audit->log('DEMO_SEEDED', 'system', null, $out);
        return $out;
    }

    private function as(string $username): void
    {
        $u = $this->app->db->one('SELECT * FROM {p}users WHERE username=?', [$username]);
        if ($u) $this->app->auth->setCurrentUser($u);
    }

    private function request(string $number, string $ref, string $customer, string $code, float $qty, string $delivery, string $priority, string $remarks): int
    {
        $db = $this->app->db;
        $item = $db->one('SELECT * FROM {p}items WHERE code=?', [$code]);
        $u = $this->app->auth->currentUser();
        $id = $db->insert('sales_requests', ['number' => $number, 'sales_order_ref' => $ref, 'customer' => $customer, 'product_code' => $code, 'product_desc' => $item['name'] ?? $code, 'product_type' => $item['product_type'] ?? 'GENSET',
            'qty' => $qty, 'delivery_date' => $delivery, 'priority' => $priority, 'remarks' => $remarks, 'status' => 'SUBMITTED', 'created_by' => $u['username'] ?? 'sales', 'created_at' => $db->now()]);
        $this->app->audit->log('SALES_REQUEST_CREATED', 'sales_request', $id, ['number' => $number, 'product' => $code, 'qty' => $qty]);
        return $id;
    }
}
