<?php
/**
 * Planner — the production planning engine.
 *
 *  explode()      multi-level BOM explosion for a finished product (rows recorded under that product in the BOM sheet)
 *  generate()     create a plan for a sales request: production orders per semi-finished item, operations per section,
 *                 material requirements, dependencies, finite-capacity schedule, critical path, bottleneck, expected date
 *  schedule()     forward, finite-capacity scheduling honouring existing approved plans, the working calendar,
 *                 item-specific productivity, partial transfers between sections and assembly dependencies
 *  recordDaily()  supervisor progress → remaining quantities → re-plan of the remaining work → revised completion date
 */
final class Planner
{
    private array $sections = [];     // id => row
    private array $resources = [];    // code => row
    private array $rateCache = [];
    private array $cutMinutes = [];   // family => machine => minutes per canopy
    private array $machines = [];     // code => row

    public function __construct(private App $app) { $this->loadMasters(); }

    private function loadMasters(): void
    {
        $db = $this->app->db;
        foreach ($db->all('SELECT * FROM {p}sections ORDER BY seq, id') as $s) $this->sections[(int)$s['id']] = $s;
        foreach ($db->all('SELECT * FROM {p}resources') as $r) $this->resources[$r['code']] = $r;
        foreach ($db->all('SELECT * FROM {p}machines WHERE active=1') as $m) $this->machines[$m['code']] = $m;
        foreach ($db->all('SELECT family, machine, minutes_per_canopy FROM {p}cutting_capacity WHERE minutes_per_canopy > 0') as $c) $this->cutMinutes[$c['family']][$c['machine']] = (float)$c['minutes_per_canopy'];
    }

    public function sections(): array { return $this->sections; }
    public function sectionByCode(string $code): ?array { foreach ($this->sections as $s) if ($s['code'] === $code) return $s; return null; }

    // =============================================================== BOM explosion
    /**
     * Returns the exploded tree for $product × $qty:
     *  ['root' => node, 'orders' => [code => order], 'materials' => [...], 'warnings' => [...]]
     *  node = ['code','name','qty_per','qty','level','type','children'=>[],'processes'=>[],'overheads'=>[],'materials'=>[]]
     */
    public function explode(string $product, float $qty, bool $considerInventory = false): array
    {
        $db = $this->app->db;
        $rows = $db->all('SELECT * FROM {p}bom_rows WHERE root_code=? ORDER BY level, line_no, id', [$product]);
        if (!$rows) throw new HttpException(404, "No BOM found for finished product $product");
        $byParent = [];
        $root = null;
        foreach ($rows as $r) {
            if ($r['parent_code'] === null || $r['parent_code'] === '') { if ($r['component_code'] === $product) $root = $r; continue; }
            $byParent[$r['parent_code']][] = $r;
        }
        $itemsNeeded = [];
        foreach ($rows as $r) $itemsNeeded[$r['component_code']] = true;
        $items = $this->items(array_keys($itemsNeeded));
        $warnings = [];
        $orders = [];      // item code => aggregated order info
        $materials = [];   // component => aggregated requirement
        $visiting = [];

        $walk = function (string $code, float $need, int $level, ?string $parentCode, array $path) use (&$walk, &$byParent, &$items, &$orders, &$materials, &$warnings, &$visiting): array {
            if (isset($visiting[$code])) { $warnings[] = "Circular BOM reference at $code (" . implode(' > ', $path) . ')'; return []; }
            $visiting[$code] = true;
            $item = $items[$code] ?? ['code' => $code, 'name' => $code, 'item_type' => 'SEMI', 'family' => null, 'model' => null];
            $node = ['code' => $code, 'name' => $item['name'], 'type' => $item['item_type'], 'level' => $level, 'qty' => $need, 'family' => $item['family'], 'model' => $item['model'],
                'children' => [], 'processes' => [], 'overheads' => [], 'materials' => [], 'cost_group' => $item['cost_group'] ?? null];
            $procByRes = [];
            foreach ($byParent[$code] ?? [] as $r) {
                $calc = $r['calc_type']; $comp = $r['component_code']; $qp = (float)$r['qty_per'];
                if ($calc === 'Process') {
                    $hours = $qp; // hours per unit of this item
                    $res = $this->resources[$comp] ?? null;
                    if (!$res) { $warnings[] = "Resource $comp on $code is not mapped to a section; operation skipped"; continue; }
                    $k = $comp;
                    if (!isset($procByRes[$k])) $procByRes[$k] = ['resource' => $comp, 'name' => $r['product_name'], 'kind' => $res['kind'], 'section_id' => (int)$res['section_id'], 'seq' => (int)$res['seq'], 'hours_per_unit' => 0.0, 'cost_per_unit' => 0.0, 'operation' => $r['operation']];
                    $procByRes[$k]['hours_per_unit'] += $hours;
                    $procByRes[$k]['cost_per_unit'] += (float)$r['cost_per_lot'] / max(1.0, (float)$r['lot_size']);
                    continue;
                }
                if ($calc === 'Rate' || $calc === 'Output unit based') {
                    $node['overheads'][] = ['code' => $comp, 'name' => $r['product_name'], 'type3' => $r['type3'], 'cost_group' => $r['cost_group'], 'qty_per' => $qp, 'cost_per_unit' => (float)$r['cost_per_lot'] / max(1.0, (float)$r['lot_size'])];
                    continue;
                }
                $cItem = $items[$comp] ?? null;
                $ctype = $cItem['item_type'] ?? ($calc === 'BOM' ? 'SEMI' : 'RAW');
                if ($ctype === 'PHANTOM') continue;
                $hasChildren = !empty($byParent[$comp]);
                if ($hasChildren && $ctype !== 'RAW') {
                    $childNeed = $need * $qp;
                    $child = $walk($comp, $childNeed, $level + 1, $code, array_merge($path, [$comp]));
                    if ($child) { $child['qty_per'] = $qp; $node['children'][] = $child; }
                    if (!isset($orders[$comp])) $orders[$comp] = ['code' => $comp, 'name' => $cItem['name'] ?? $r['product_name'], 'type' => $ctype, 'gross_qty' => 0.0, 'level' => $level + 1, 'parents' => [], 'family' => $cItem['family'] ?? null, 'model' => $cItem['model'] ?? null, 'cost_group' => $cItem['cost_group'] ?? $r['cost_group']];
                    $orders[$comp]['gross_qty'] += $childNeed;
                    $orders[$comp]['level'] = max($orders[$comp]['level'], $level + 1);
                    $orders[$comp]['parents'][$code] = ($orders[$comp]['parents'][$code] ?? 0) + $childNeed;
                    continue;
                }
                // material (raw / purchased sub-assembly without a BOM)
                $unitCost = $cItem ? (float)$cItem['std_cost'] : ((float)$r['cost_per_lot'] / max(1e-9, abs($qp)));
                $qtyReq = $need * $qp;
                $flags = [];
                if (!$cItem || (float)$cItem['std_cost'] <= 0) $flags[] = 'ZERO_COST';
                if ($cItem && in_array($cItem['cost_status'], ['OUTDATED', 'INCONSISTENT', 'PRICE_MOVED'], true)) $flags[] = $cItem['cost_status'];
                $mat = ['code' => $comp, 'name' => $cItem['name'] ?? $r['product_name'], 'qty_per' => $qp, 'qty' => $qtyReq, 'unit' => $r['unit'] ?: ($cItem['unit'] ?? null), 'unit_cost' => $unitCost,
                    'ext_cost' => $qtyReq * $unitCost, 'cost_group' => $r['cost_group'] ?: ($cItem['cost_group'] ?? null), 'warehouse' => $r['warehouse'], 'flags' => $flags, 'parent' => $code, 'calc_type' => $calc];
                $node['materials'][] = $mat;
                if (!isset($materials[$comp])) $materials[$comp] = $mat + ['parents' => []];
                else { $materials[$comp]['qty'] += $qtyReq; $materials[$comp]['ext_cost'] += $qtyReq * $unitCost; }
                $materials[$comp]['parents'][$code] = ($materials[$comp]['parents'][$code] ?? 0) + $qtyReq;
            }
            usort($procByRes, fn($a, $b) => [$a['seq'], $a['kind'] === 'LABOUR' ? 0 : 1] <=> [$b['seq'], $b['kind'] === 'LABOUR' ? 0 : 1]);
            $node['processes'] = array_values($procByRes);
            unset($visiting[$code]);
            return $node;
        };

        $tree = $walk($product, $qty, 0, null, [$product]);
        $rootItem = $items[$product] ?? null;
        $orders = [$product => ['code' => $product, 'name' => $rootItem['name'] ?? ($root['product_name'] ?? $product), 'type' => 'FINISHED', 'gross_qty' => $qty, 'level' => 0, 'parents' => [], 'family' => $rootItem['family'] ?? null, 'model' => $rootItem['model'] ?? null, 'cost_group' => $rootItem['cost_group'] ?? null]] + $orders;

        // attach the node (processes) to each order; a sub-assembly appearing under several parents has the same process list
        $nodesByCode = [];
        $collect = function (array $n) use (&$collect, &$nodesByCode) { $nodesByCode[$n['code']] = $n; foreach ($n['children'] as $c) $collect($c); };
        $collect($tree);
        foreach ($orders as $code => &$o) {
            $n = $nodesByCode[$code] ?? null;
            $o['processes'] = $n['processes'] ?? [];
            $o['overheads'] = $n['overheads'] ?? [];
            $o['materials'] = $n['materials'] ?? [];
            $o['inventory_available'] = 0.0;
            $o['net_qty'] = $o['gross_qty'];
            if ($considerInventory && $code !== $product) {
                $avail = $this->app->inventory->available($code);
                $o['inventory_available'] = $avail;
                $o['net_qty'] = max(0.0, $o['gross_qty'] - $avail);
            }
        }
        unset($o);
        // materials netted against stock (information only; production schedule assumes materials are supplied)
        foreach ($materials as $code => &$m) {
            $m['on_hand'] = $considerInventory ? $this->app->inventory->available($code) : 0.0;
            $m['net_qty'] = max(0.0, $m['qty'] - $m['on_hand']);
        }
        unset($m);
        return ['root' => $tree, 'orders' => $orders, 'materials' => $materials, 'warnings' => $warnings, 'sheet_root_cost' => $root ? (float)$root['cost_per_unit'] : null];
    }

    private function items(array $codes): array
    {
        $out = [];
        foreach (array_chunk($codes, 400) as $chunk) {
            $in = implode(',', array_fill(0, count($chunk), '?'));
            foreach ($this->app->db->all("SELECT * FROM {p}items WHERE code IN ($in)", $chunk) as $i) $out[$i['code']] = $i;
        }
        return $out;
    }

    // =============================================================== capacity lookup
    /** Daily capacity (units/day for the whole section) for an item at a section. Returns [units_per_day, source, minutes_per_unit]. */
    public function capacityFor(int $sectionId, string $itemCode, ?string $family, ?string $model, float $hoursPerUnit): array
    {
        $key = "$sectionId|$itemCode";
        if (isset($this->rateCache[$key])) return $this->rateCache[$key];
        $db = $this->app->db;
        $sec = $this->sections[$sectionId];
        $minutesDay = (int)$sec['minutes_per_day'] * max(1, (int)$sec['lines']);
        $rates = $db->all('SELECT * FROM {p}capacity_rates WHERE section_id=? AND is_primary=1 AND units_per_day>0', [$sectionId]);
        $pick = null; $src = null;
        foreach ($rates as $r) if (strcasecmp(trim($r['source_code']), $itemCode) === 0) { $pick = (float)$r['units_per_day']; $src = $r['source'] . ' [exact code ' . $r['source_code'] . ']'; break; }
        if ($pick === null && $model) {
            $cands = [];
            foreach ($rates as $r) { if (($r['model'] ?? '') === $model) $cands[] = $r; else { foreach (Families::expandModels((string)$r['source_code']) as $m) if ($m === $model) { $cands[] = $r; break; } } }
            if ($cands) { usort($cands, fn($a, $b) => $a['units_per_day'] <=> $b['units_per_day']); $pick = (float)$cands[0]['units_per_day']; $src = $cands[0]['source'] . ' [model ' . $model . ' via ' . $cands[0]['source_code'] . ']'; }
        }
        if ($pick === null && $family) {
            $cands = array_values(array_filter($rates, fn($r) => $r['family'] === $family));
            if ($cands) { usort($cands, fn($a, $b) => $a['units_per_day'] <=> $b['units_per_day']); $pick = (float)$cands[0]['units_per_day']; $src = $cands[0]['source'] . ' [family ' . $family . ' via ' . $cands[0]['source_code'] . ']'; }
        }
        if ($pick === null) {
            if ($hoursPerUnit > 0) { $pick = max(0.05, ((int)$sec['staff'] * (int)$sec['minutes_per_day']) / ($hoursPerUnit * 60)); $src = 'Derived from BOM labour hours (' . round($hoursPerUnit, 2) . ' h/unit × ' . $sec['staff'] . ' staff) — no productivity master row'; }
            else { $pick = 8.0; $src = 'DEFAULT 8/day — no productivity data'; }
        }
        $res = [$pick, $src, $minutesDay / $pick];
        $this->rateCache[$key] = $res;
        return $res;
    }

    // =============================================================== plan generation
    public function generate(int $salesRequestId, array $opts = []): int
    {
        $db = $this->app->db;
        $sr = $db->one('SELECT * FROM {p}sales_requests WHERE id=?', [$salesRequestId]);
        if (!$sr) throw new HttpException(404, 'Sales request not found');
        $start = $opts['start_date'] ?? $this->app->calendar->nextWorkingDay(gmdate('Y-m-d'), 1);
        $start = $this->app->calendar->alignForward($start);
        $consider = !empty($opts['consider_inventory']);
        $scenario = !empty($opts['scenario']);
        $qty = isset($opts['qty']) ? (float)$opts['qty'] : (float)$sr['qty'];
        $ex = $this->explode($sr['product_code'], $qty, $consider);
        $user = $this->app->auth->currentUser();

        return $db->transaction(function () use ($db, $sr, $ex, $start, $consider, $scenario, $qty, $opts, $user) {
            $version = (int)$db->val('SELECT COALESCE(MAX(version),0)+1 FROM {p}plans WHERE sales_request_id=?', [$sr['id']]);
            $planId = $db->insert('plans', ['sales_request_id' => $sr['id'], 'version' => $version, 'status' => $scenario ? 'SCENARIO' : 'PROPOSED', 'product_code' => $sr['product_code'], 'qty' => $qty,
                'start_date' => $start, 'consider_inventory' => $consider ? 1 : 0, 'created_by' => $user['username'] ?? 'system', 'created_at' => $db->now(), 'notes' => $opts['notes'] ?? null]);
            $prefix = $this->app->setting('plan_number_prefix', 'PP');
            $orderIds = []; $n = 0;
            $sorted = $ex['orders'];
            uasort($sorted, fn($a, $b) => $a['level'] <=> $b['level']);
            foreach ($sorted as $code => $o) {
                $n++;
                $mainSection = null;
                if ($o['processes']) { $last = end($o['processes']); $mainSection = $last['section_id']; foreach ($o['processes'] as $p) if ($p['kind'] === 'LABOUR') $mainSection = $p['section_id']; }
                $orderIds[$code] = $db->insert('orders', ['plan_id' => $planId, 'number' => sprintf('%s-%05d-%02d', $prefix, $planId, $n), 'item_code' => $code, 'item_name' => $o['name'], 'parent_order_id' => null,
                    'level' => $o['level'], 'gross_qty' => $o['gross_qty'], 'inventory_used' => $o['gross_qty'] - $o['net_qty'], 'net_qty' => $o['net_qty'], 'family' => $o['family'], 'main_section_id' => $mainSection, 'status' => 'PLANNED']);
            }
            foreach ($ex['orders'] as $code => $o) {
                $first = true;
                foreach ($o['parents'] as $pcode => $q) {
                    if (!isset($orderIds[$pcode])) continue;
                    if ($first) { $db->run('UPDATE {p}orders SET parent_order_id=? WHERE id=?', [$orderIds[$pcode], $orderIds[$code]]); $first = false; }
                    $db->run('INSERT INTO {p}order_deps (order_id, requires_order_id) VALUES (?,?)', [$orderIds[$pcode], $orderIds[$code]]);
                }
            }
            // operations
            $fgDays = (int)($this->app->setting('fg_receipt_days') ?? 1);
            $fgSection = $this->sectionByCode('FG_RECEIPT');
            foreach ($ex['orders'] as $code => $o) {
                $oid = $orderIds[$code];
                if ($o['net_qty'] <= 0) { $db->run("UPDATE {p}orders SET status='COMPLETED', completed_qty=gross_qty WHERE id=?", [$oid]); continue; }
                $seq = 0; $bySection = [];
                foreach ($o['processes'] as $p) {
                    $sid = $p['section_id'];
                    if (!isset($bySection[$sid])) $bySection[$sid] = ['section_id' => $sid, 'seq' => $p['seq'], 'labour' => null, 'machine' => null, 'hours' => 0.0];
                    if ($p['kind'] === 'LABOUR') { $bySection[$sid]['labour'] = $p['resource']; $bySection[$sid]['hours'] += $p['hours_per_unit']; }
                    else { $bySection[$sid]['machine'] = $p['resource']; if ($bySection[$sid]['hours'] == 0) $bySection[$sid]['hours'] = $p['hours_per_unit']; }
                }
                usort($bySection, fn($a, $b) => $a['seq'] <=> $b['seq']);
                $prevOp = null;
                foreach ($bySection as $s) {
                    [$cap, $src, $mpu] = $this->capacityFor($s['section_id'], $code, $o['family'], $o['model'], $s['hours']);
                    $seq += 10;
                    $machineId = $s['machine'] && isset($this->machines[$s['machine']]) ? (int)$this->machines[$s['machine']]['id'] : null;
                    $opId = $db->insert('operations', ['plan_id' => $planId, 'order_id' => $oid, 'seq' => $seq, 'section_id' => $s['section_id'], 'resource_code' => $s['labour'] ?? $s['machine'], 'machine_resource_code' => $s['machine'],
                        'machine_id' => $machineId, 'item_code' => $code, 'required_qty' => $o['net_qty'], 'hours_per_unit' => $s['hours'], 'daily_capacity' => $cap, 'capacity_source' => $src, 'total_minutes' => $o['net_qty'] * $mpu, 'status' => 'PLANNED']);
                    if ($prevOp) $db->run('INSERT INTO {p}op_deps (op_id, depends_on, dep_type) VALUES (?,?,?)', [$opId, $prevOp, $this->sections[$s['section_id']]['allow_partial_transfer'] ? 'PT' : 'FS']);
                    $prevOp = $opId;
                }
                if ($o['level'] === 0 && $fgSection) {
                    $seq += 10;
                    $opId = $db->insert('operations', ['plan_id' => $planId, 'order_id' => $oid, 'seq' => $seq, 'section_id' => (int)$fgSection['id'], 'resource_code' => null, 'machine_resource_code' => null, 'machine_id' => null, 'item_code' => $code,
                        'required_qty' => $o['net_qty'], 'hours_per_unit' => 0, 'daily_capacity' => max(1.0, $o['net_qty'] / max(1, $fgDays)), 'capacity_source' => "Finished goods receipt ($fgDays working day)", 'total_minutes' => 0, 'status' => 'PLANNED']);
                    if ($prevOp) $db->run('INSERT INTO {p}op_deps (op_id, depends_on, dep_type) VALUES (?,?,?)', [$opId, $prevOp, 'FS']);
                }
            }
            // materials
            $rows = [];
            foreach ($ex['orders'] as $code => $o) {
                foreach ($o['materials'] as $m) {
                    $scale = $o['gross_qty'] > 0 ? $o['net_qty'] / $o['gross_qty'] : 0;
                    $qtyReq = $m['qty'] * $scale;
                    $rows[] = ['plan_id' => $planId, 'order_id' => $orderIds[$code], 'component_code' => $m['code'], 'component_name' => $m['name'], 'qty_per' => $m['qty_per'], 'qty_required' => $qtyReq, 'unit' => $m['unit'],
                        'unit_cost' => $m['unit_cost'], 'ext_cost' => $qtyReq * $m['unit_cost'], 'cost_group' => $m['cost_group'], 'warehouse' => $m['warehouse'], 'cost_flag' => $m['flags'] ? implode(',', $m['flags']) : null, 'issued_qty' => 0];
                }
            }
            $db->insertMany('materials', $rows);
            $this->schedule($planId, $start, false);
            $summary = $this->summarize($planId, $ex['warnings']);
            $cost = $this->app->costing->planCost($planId);
            $db->run('UPDATE {p}plans SET summary=?, cost_snapshot=? WHERE id=?', [json_encode($summary), json_encode($cost), $planId]);
            if (!$scenario) $db->run("UPDATE {p}sales_requests SET status='PLANNED', updated_at=? WHERE id=? AND status='SUBMITTED'", [$db->now(), $sr['id']]);
            $this->app->audit->log('PLAN_GENERATED', 'plan', $planId, ['sales_request' => $sr['number'], 'product' => $sr['product_code'], 'qty' => $qty, 'start' => $start, 'consider_inventory' => $consider]);
            return $planId;
        });
    }

    // =============================================================== scheduling
    /**
     * Finite-capacity forward scheduler.
     * $fromDate: nothing is scheduled before this working day. $replan: keep baseline, reschedule remaining quantities only.
     */
    public function schedule(int $planId, string $fromDate, bool $replan): void
    {
        $db = $this->app->db;
        $cal = $this->app->calendar;
        $fromDate = $cal->alignForward($fromDate);
        $plan = $db->one('SELECT * FROM {p}plans WHERE id=?', [$planId]);
        $orders = []; foreach ($db->all('SELECT * FROM {p}orders WHERE plan_id=?', [$planId]) as $o) $orders[(int)$o['id']] = $o;
        $ops = []; foreach ($db->all('SELECT * FROM {p}operations WHERE plan_id=? ORDER BY order_id, seq', [$planId]) as $o) $ops[(int)$o['id']] = $o;
        $opsByOrder = []; foreach ($ops as $id => $o) $opsByOrder[(int)$o['order_id']][] = $id;
        $opDeps = []; foreach ($db->all('SELECT d.* FROM {p}op_deps d JOIN {p}operations o ON o.id=d.op_id WHERE o.plan_id=?', [$planId]) as $d) $opDeps[(int)$d['op_id']][] = [(int)$d['depends_on'], $d['dep_type']];
        $orderDeps = []; foreach ($db->all('SELECT d.* FROM {p}order_deps d JOIN {p}orders o ON o.id=d.order_id WHERE o.plan_id=?', [$planId]) as $d) $orderDeps[(int)$d['order_id']][] = (int)$d['requires_order_id'];

        // existing committed load from other active plans (and, when re-planning, this plan's history before $fromDate)
        $load = [];      // key => date => minutes
        $others = $db->all("SELECT l.section_id, l.machine_id, l.ldate, SUM(l.minutes) m FROM {p}op_loads l JOIN {p}plans p ON p.id=l.plan_id WHERE p.id<>? AND p.status IN ('APPROVED','IN_PROGRESS') AND l.ldate>=? GROUP BY l.section_id, l.machine_id, l.ldate", [$planId, $fromDate]);
        foreach ($others as $r) { $load['S' . $r['section_id']][$r['ldate']] = ($load['S' . $r['section_id']][$r['ldate']] ?? 0) + (float)$r['m']; if ($r['machine_id']) $load['M' . $r['machine_id']][$r['ldate']] = ($load['M' . $r['machine_id']][$r['ldate']] ?? 0) + (float)$r['m']; }
        $db->run('DELETE FROM {p}op_loads WHERE plan_id=? AND ldate>=?', [$planId, $fromDate]);
        if (!$replan) $db->run('DELETE FROM {p}op_loads WHERE plan_id=?', [$planId]);

        // produced so far per op. Re-planning policy: an operation that has reported output is taken at its actual figure;
        // an operation with scheduled output before $fromDate but no report yet is assumed to have run to plan (flagged as
        // "unreported" on the dashboards) — this avoids pushing every other section out when the first report of a day arrives.
        $cum = [];       // op id => date => cumulative qty available at END of that date
        $done = [];      // op id => qty already completed before fromDate
        $hasReport = [];
        if ($replan) {
            foreach ($db->all('SELECT op_id, ldate, qty FROM {p}op_loads WHERE plan_id=? AND ldate<? AND machine_id IS NULL ORDER BY ldate', [$planId, $fromDate]) as $l) $cum[(int)$l['op_id']][$l['ldate']] = ($cum[(int)$l['op_id']][$l['ldate']] ?? 0) + (float)$l['qty'];
            foreach ($db->all('SELECT op_id, rdate, SUM(good_qty) g FROM {p}daily_reports WHERE plan_id=? GROUP BY op_id, rdate', [$planId]) as $r) { $hasReport[(int)$r['op_id']] = true; $cum[(int)$r['op_id']]['_actual'][$r['rdate']] = (float)$r['g']; }
            foreach ($cum as $id => &$byDate) {
                $actual = $byDate['_actual'] ?? []; unset($byDate['_actual']);
                if ($actual) $byDate = $actual;
                ksort($byDate); $run = 0.0; foreach ($byDate as $d => $q) { $run += $q; $byDate[$d] = $run; }
            }
            unset($byDate);
        }
        foreach ($ops as $id => $o) {
            if (!$replan) { $done[$id] = 0.0; continue; }
            if (isset($hasReport[$id])) $done[$id] = min((float)$o['required_qty'], (float)$o['good_qty']);
            else { $hist = $cum[$id] ?? []; $done[$id] = $hist ? min((float)$o['required_qty'], (float)end($hist)) : 0.0; }
        }
        $cumAt = function (int $opId, string $date) use (&$cum): float { $best = 0.0; foreach ($cum[$opId] ?? [] as $d => $v) if ($d <= $date) $best = $v; return $best; };
        $finishOf = []; $startOf = [];
        foreach ($ops as $id => $o) {
            if ($replan && $o['status'] === 'COMPLETED') { $finishOf[$id] = $o['actual_finish'] ?? $o['planned_finish']; $startOf[$id] = $o['actual_start'] ?? $o['planned_start']; }
        }
        $orderFinish = []; // order id => finish date (or null when nothing to do)
        $horizon = (new DateTime($fromDate))->modify('+3 years')->format('Y-m-d');

        // process orders children-first (topological by order_deps), longest first among ready ones
        $remainingOrders = array_keys($orders);
        $scheduledOrders = [];
        $guard = 0;
        while ($remainingOrders && $guard++ < 10000) {
            $ready = array_values(array_filter($remainingOrders, function ($oid) use (&$orderDeps, &$scheduledOrders) { foreach ($orderDeps[$oid] ?? [] as $req) if (!isset($scheduledOrders[$req])) return false; return true; }));
            if (!$ready) { $ready = [$remainingOrders[0]]; }
            usort($ready, function ($a, $b) use (&$ops, &$opsByOrder, &$orders) {
                $ta = 0; foreach ($opsByOrder[$a] ?? [] as $id) $ta += (float)$ops[$id]['total_minutes'];
                $tb = 0; foreach ($opsByOrder[$b] ?? [] as $id) $tb += (float)$ops[$id]['total_minutes'];
                return [$orders[$b]['level'], $tb] <=> [$orders[$a]['level'], $ta];
            });
            $oid = $ready[0];
            $remainingOrders = array_values(array_diff($remainingOrders, [$oid]));
            $scheduledOrders[$oid] = true;
            $order = $orders[$oid];
            // earliest start: all required child orders finished (next working day)
            $earliest = $fromDate;
            foreach ($orderDeps[$oid] ?? [] as $req) if (!empty($orderFinish[$req])) $earliest = max($earliest, $cal->nextWorkingDay($orderFinish[$req], 1));
            if ($order['status'] === 'COMPLETED' || (float)$order['net_qty'] <= 0) { $orderFinish[$oid] = $order['actual_finish'] ?? null; continue; }
            if (empty($opsByOrder[$oid])) { // kit / purchased assembly: no section work, available when its parts are
                $orderFinish[$oid] = null;
                if (!$replan) $db->run('UPDATE {p}orders SET planned_start=?, planned_finish=?, baseline_start=?, baseline_finish=? WHERE id=?', [$earliest, $earliest, $earliest, $earliest, $oid]);
                continue;
            }
            $orderStart = null; $orderEnd = null;
            foreach ($opsByOrder[$oid] as $opId) {
                $op = $ops[$opId];
                if ($replan && $op['status'] === 'COMPLETED') { $orderEnd = max($orderEnd ?? '', $finishOf[$opId] ?? ''); $orderStart = $orderStart ?? $startOf[$opId]; continue; }
                $required = (float)$op['required_qty'];
                $remaining = max(0.0, $required - $done[$opId]);
                $start = $earliest;
                $preds = $opDeps[$opId] ?? [];
                $streamFrom = null;
                foreach ($preds as [$pid, $type]) {
                    $pfin = $finishOf[$pid] ?? null;
                    $predDone = $this->isComplete($pid, $ops, $done);
                    if ($type === 'PT' && isset($startOf[$pid]) && !$predDone) { $start = max($start, $cal->nextWorkingDay($startOf[$pid], 1)); $streamFrom = $pid; }
                    elseif ($pfin && !$predDone) { $start = max($start, $cal->nextWorkingDay($pfin, 1)); }
                    elseif ($predDone && $pfin && $pfin >= $fromDate) { $start = max($start, $cal->nextWorkingDay($pfin, 1)); }
                }
                if ($remaining <= 1e-6) {
                    $hist = $cum[$opId] ?? [];
                    $finishOf[$opId] = $op['actual_finish'] ?? ($hist ? array_key_last($hist) : ($op['planned_finish'] ?? $start));
                    $startOf[$opId] = $op['actual_start'] ?? ($hist ? array_key_first($hist) : ($op['planned_start'] ?? $start));
                    $orderStart = $orderStart === null ? $startOf[$opId] : min($orderStart, $startOf[$opId]);
                    $orderEnd = max($orderEnd ?? '', $finishOf[$opId]);
                    $db->update('operations', ['planned_start' => $startOf[$opId], 'planned_finish' => $finishOf[$opId], 'delay_days' => $op['baseline_finish'] ? $this->delayDays($op['baseline_finish'], $finishOf[$opId]) : 0], 'id=?', [$opId]);
                    continue;
                }
                $keys = $this->loadKeys($op);  // [key => [minutes per unit, capacity minutes per day]]
                $sectionKey = 'S' . $op['section_id'];
                $date = $cal->alignForward($start);
                $produced = $done[$opId];
                $firstDay = null; $lastDay = null; $loads = [];
                while ($remaining > 1e-6 && $date <= $horizon) {
                    $dayMin = $cal->minutes($date);
                    if ($dayMin <= 0) { $date = $cal->nextWorkingDay($date, 1); continue; }
                    $possible = INF;
                    foreach ($keys as $key => [$mpu, $capMin]) {
                        $avail = max(0.0, $capMin * ($dayMin / 480) - ($load[$key][$date] ?? 0.0));
                        $possible = min($possible, $mpu > 0 ? $avail / $mpu : $remaining);
                    }
                    if ($streamFrom !== null) {
                        $prevDay = (new DateTime($date))->modify('-1 day')->format('Y-m-d');
                        $possible = min($possible, max(0.0, $cumAt($streamFrom, $prevDay) - $produced));
                    }
                    $q = min($remaining, $possible);
                    if ($q > 1e-6) {
                        $firstDay = $firstDay ?? $date; $lastDay = $date;
                        foreach ($keys as $key => [$mpu, $capMin]) {
                            $load[$key][$date] = ($load[$key][$date] ?? 0.0) + $q * $mpu;
                            $loads[] = ['op_id' => $opId, 'plan_id' => $planId, 'section_id' => (int)$op['section_id'], 'machine_id' => $key[0] === 'M' ? (int)substr($key, 1) : null, 'ldate' => $date, 'minutes' => $q * $mpu, 'qty' => $q];
                        }
                        $produced += $q; $remaining -= $q;
                        $cum[$opId][$date] = $produced;
                    }
                    if ($remaining > 1e-6) $date = $cal->nextWorkingDay($date, 1);
                }
                $db->insertMany('op_loads', $loads);
                $planStart = $firstDay ?? $start; $planFinish = $lastDay ?? $start;
                $finishOf[$opId] = $planFinish; $startOf[$opId] = $replan && $op['actual_start'] ? $op['actual_start'] : $planStart;
                $upd = ['planned_start' => $startOf[$opId], 'planned_finish' => $planFinish];
                if (!$replan) { $upd['baseline_start'] = $planStart; $upd['baseline_finish'] = $planFinish; }
                else { $upd['delay_days'] = $op['baseline_finish'] ? $this->delayDays($op['baseline_finish'], $planFinish) : 0; }
                $db->update('operations', $upd, 'id=?', [$opId]);
                $orderStart = $orderStart === null ? $startOf[$opId] : min($orderStart, $startOf[$opId]);
                $orderEnd = max($orderEnd ?? '', $planFinish);
            }
            $orderFinish[$oid] = $orderEnd;
            $upd = ['planned_start' => $orderStart, 'planned_finish' => $orderEnd];
            if (!$replan) { $upd['baseline_start'] = $orderStart; $upd['baseline_finish'] = $orderEnd; }
            $db->update('orders', $upd, 'id=?', [$oid]);
        }
        // plan dates
        $top = null; foreach ($orders as $o) if ((int)$o['level'] === 0) $top = $o;
        $completion = $top ? ($orderFinish[(int)$top['id']] ?? null) : null;
        $upd = ['expected_completion' => $completion];
        if (!$replan) $upd['baseline_completion'] = $completion; else $upd['revised_completion'] = $completion;
        $db->update('plans', $upd, 'id=?', [$planId]);
        $this->markCriticalPath($planId);
    }

    /** Working days a revised finish is later (+) or earlier (−) than the baseline finish. */
    public function delayDays(string $baseline, string $revised): int
    {
        if ($revised === $baseline) return 0;
        $cal = $this->app->calendar;
        return $revised > $baseline ? $cal->workingDaysBetween($baseline, $revised) - 1 : -($cal->workingDaysBetween($revised, $baseline) - 1);
    }

    private function isComplete(int $opId, array $ops, array $done): bool { return isset($ops[$opId]) && $done[$opId] >= (float)$ops[$opId]['required_qty'] - 1e-6; }

    /** Capacity keys an operation consumes: the section (minutes/day × lines) and, for canopy cutting, each machine. */
    private function loadKeys(array $op): array
    {
        $sec = $this->sections[(int)$op['section_id']];
        $capMin = (int)$sec['minutes_per_day'] * max(1, (int)$sec['lines']);
        $mpu = $capMin / max(1e-6, (float)$op['daily_capacity']);
        $keys = ['S' . $op['section_id'] => [$mpu, $capMin]];
        if ($sec['code'] === 'CANOPY_CUT') {
            $item = $this->app->db->one('SELECT family FROM {p}items WHERE code=?', [$op['item_code']]);
            $fam = $item['family'] ?? null;
            if ($fam && isset($this->cutMinutes[$fam])) {
                foreach ($this->cutMinutes[$fam] as $machine => $minutes) {
                    $mcode = strtoupper(str_replace(' ', '', $machine));
                    if (isset($this->machines[$mcode])) $keys['M' . $this->machines[$mcode]['id']] = [$minutes, (int)$this->machines[$mcode]['minutes_per_shift']];
                }
            }
        } elseif ($op['machine_id']) {
            $m = null; foreach ($this->machines as $mm) if ((int)$mm['id'] === (int)$op['machine_id']) $m = $mm;
            if ($m) $keys['M' . $m['id']] = [$mpu, (int)$m['minutes_per_shift'] * max(1, (int)$sec['lines'])];
        }
        return $keys;
    }

    /** Walk back from the finished-product receipt through the constraining predecessors; flag ops & orders. */
    private function markCriticalPath(int $planId): void
    {
        $db = $this->app->db;
        $cal = $this->app->calendar;
        $db->run('UPDATE {p}operations SET is_critical=0 WHERE plan_id=?', [$planId]);
        $db->run('UPDATE {p}orders SET is_critical=0 WHERE plan_id=?', [$planId]);
        $ops = []; foreach ($db->all('SELECT * FROM {p}operations WHERE plan_id=?', [$planId]) as $o) $ops[(int)$o['id']] = $o;
        $orders = []; foreach ($db->all('SELECT * FROM {p}orders WHERE plan_id=?', [$planId]) as $o) $orders[(int)$o['id']] = $o;
        $opDeps = []; foreach ($db->all('SELECT d.* FROM {p}op_deps d JOIN {p}operations o ON o.id=d.op_id WHERE o.plan_id=?', [$planId]) as $d) $opDeps[(int)$d['op_id']][] = (int)$d['depends_on'];
        $orderDeps = []; foreach ($db->all('SELECT d.* FROM {p}order_deps d JOIN {p}orders o ON o.id=d.order_id WHERE o.plan_id=?', [$planId]) as $d) $orderDeps[(int)$d['order_id']][] = (int)$d['requires_order_id'];
        $lastOpOfOrder = []; $firstOpOfOrder = [];
        foreach ($ops as $id => $o) { $oid = (int)$o['order_id']; if (!isset($lastOpOfOrder[$oid]) || $o['seq'] > $ops[$lastOpOfOrder[$oid]]['seq']) $lastOpOfOrder[$oid] = $id; if (!isset($firstOpOfOrder[$oid]) || $o['seq'] < $ops[$firstOpOfOrder[$oid]]['seq']) $firstOpOfOrder[$oid] = $id; }
        $top = null; foreach ($orders as $o) if ((int)$o['level'] === 0) $top = (int)$o['id'];
        if ($top === null || !isset($lastOpOfOrder[$top])) return;
        $path = []; $cur = $lastOpOfOrder[$top]; $guard = 0;
        while ($cur !== null && $guard++ < 500) {
            $op = $ops[$cur];
            $path[] = $cur;
            $start = $op['planned_start'];
            $cand = null; $candFinish = null; $reason = 'start of plan';
            foreach ($opDeps[$cur] ?? [] as $pid) { $f = $ops[$pid]['planned_finish'] ?? null; if ($f && ($candFinish === null || $f > $candFinish)) { $cand = $pid; $candFinish = $f; } }
            if ($cur === ($firstOpOfOrder[(int)$op['order_id']] ?? null)) {
                foreach ($orderDeps[(int)$op['order_id']] ?? [] as $req) { $f = $orders[$req]['planned_finish'] ?? null; if ($f && isset($lastOpOfOrder[$req]) && ($candFinish === null || $f > $candFinish)) { $cand = $lastOpOfOrder[$req]; $candFinish = $f; } }
            }
            if ($cand !== null) {
                $db->run('UPDATE {p}operations SET is_critical=1 WHERE id=?', [$cur]);
                $cur = $cand;
            } else { $db->run('UPDATE {p}operations SET is_critical=1 WHERE id=?', [$cur]); $cur = null; }
        }
        $pathInfo = [];
        foreach (array_reverse($path) as $id) {
            $o = $ops[$id]; $sec = $this->sections[(int)$o['section_id']];
            $db->run('UPDATE {p}orders SET is_critical=1 WHERE id=?', [$o['order_id']]);
            $pathInfo[] = ['op_id' => $id, 'order_id' => (int)$o['order_id'], 'item_code' => $o['item_code'], 'section' => $sec['name'], 'section_code' => $sec['code'], 'section_id' => (int)$sec['id'], 'start' => $o['planned_start'], 'finish' => $o['planned_finish'], 'qty' => (float)$o['required_qty'], 'daily_capacity' => (float)$o['daily_capacity'], 'days' => $o['planned_start'] && $o['planned_finish'] ? $cal->workingDaysBetween($o['planned_start'], $o['planned_finish']) : 0];
        }
        $db->run('UPDATE {p}plans SET critical_path=? WHERE id=?', [json_encode($pathInfo), $planId]);
    }

    /** Utilisation per section over the plan window, bottleneck, counts, warnings → summary JSON. */
    public function summarize(int $planId, array $warnings = []): array
    {
        $db = $this->app->db; $cal = $this->app->calendar;
        $plan = $db->one('SELECT * FROM {p}plans WHERE id=?', [$planId]);
        $window = $db->one('SELECT MIN(ldate) a, MAX(ldate) b FROM {p}op_loads WHERE plan_id=?', [$planId]);
        $util = [];
        if ($window && $window['a']) {
            $days = $cal->workingDaysBetween($window['a'], $window['b']);
            foreach ($db->all('SELECT section_id, SUM(minutes) m, MIN(ldate) a, MAX(ldate) b, COUNT(DISTINCT ldate) d FROM {p}op_loads WHERE plan_id=? AND machine_id IS NULL GROUP BY section_id', [$planId]) as $r) {
                $sec = $this->sections[(int)$r['section_id']];
                $capDay = (int)$sec['minutes_per_day'] * max(1, (int)$sec['lines']);
                $activeDays = max(1, $cal->workingDaysBetween($r['a'], $r['b']));
                $otherLoad = (float)$db->val("SELECT COALESCE(SUM(l.minutes),0) FROM {p}op_loads l JOIN {p}plans p ON p.id=l.plan_id WHERE l.section_id=? AND l.machine_id IS NULL AND l.plan_id<>? AND p.status IN ('APPROVED','IN_PROGRESS') AND l.ldate BETWEEN ? AND ?", [$r['section_id'], $planId, $r['a'], $r['b']]);
                $util[] = ['section_id' => (int)$r['section_id'], 'section' => $sec['name'], 'code' => $sec['code'], 'minutes' => round((float)$r['m']), 'other_plans_minutes' => round($otherLoad), 'from' => $r['a'], 'to' => $r['b'], 'active_days' => $activeDays,
                    'utilisation_pct' => round(100 * ((float)$r['m'] + $otherLoad) / ($capDay * $activeDays), 1), 'busy_days' => (int)$r['d']];
            }
            usort($util, fn($a, $b) => $b['utilisation_pct'] <=> $a['utilisation_pct']);
        }
        $critical = json_decode($plan['critical_path'] ?? '[]', true) ?: [];
        $cpDays = []; foreach ($critical as $c) $cpDays[$c['section_code']] = ($cpDays[$c['section_code']] ?? 0) + $c['days'];
        $bottleneck = null;
        if ($critical) {
            // the critical-path operation that takes the most working days; ties go to the lowest daily capacity (most constraining section)
            $ops = $critical; usort($ops, fn($a, $b) => [$b['days'], $a['daily_capacity'] ?? INF] <=> [$a['days'], $b['daily_capacity'] ?? INF]);
            $c = $ops[0]; $sec = $this->sectionByCode($c['section_code']);
            $bottleneck = ['section_id' => (int)$sec['id'], 'section' => $sec['name'], 'code' => $c['section_code'], 'critical_days' => $cpDays[$c['section_code']], 'item_code' => $c['item_code'], 'daily_capacity' => $c['daily_capacity'] ?? null,
                'reason' => "{$c['days']} working day(s) on the critical path for {$c['item_code']} at " . round((float)($c['daily_capacity'] ?? 0), 1) . ' units/day'];
        }
        foreach ($util as $u) if ($u['utilisation_pct'] >= 95 && $u['active_days'] >= 3) { $bottleneck = ['section_id' => $u['section_id'], 'section' => $u['section'], 'code' => $u['code'], 'critical_days' => $cpDays[$u['code']] ?? 0, 'reason' => 'section loaded at ' . $u['utilisation_pct'] . '% for ' . $u['active_days'] . ' working days (including other approved plans)']; break; }
        if ($bottleneck) $db->run('UPDATE {p}plans SET bottleneck_section_id=? WHERE id=?', [$bottleneck['section_id'], $planId]);
        $counts = $db->one("SELECT COUNT(*) orders, SUM(CASE WHEN net_qty<=0 THEN 1 ELSE 0 END) covered_by_stock FROM {p}orders WHERE plan_id=? AND level>0", [$planId]);
        $opsCount = (int)$db->val('SELECT COUNT(*) FROM {p}operations WHERE plan_id=?', [$planId]);
        $mat = $db->one('SELECT COUNT(DISTINCT component_code) n, SUM(ext_cost) c, SUM(CASE WHEN cost_flag IS NOT NULL THEN 1 ELSE 0 END) flagged FROM {p}materials WHERE plan_id=?', [$planId]);
        $fallback = $db->all("SELECT item_code, section_id, capacity_source FROM {p}operations WHERE plan_id=? AND (capacity_source LIKE 'Derived%' OR capacity_source LIKE 'DEFAULT%')", [$planId]);
        foreach ($fallback as $f) $warnings[] = "No productivity master for {$f['item_code']} at {$this->sections[(int)$f['section_id']]['name']}: {$f['capacity_source']}";
        $lead = $plan['start_date'] && $plan['expected_completion'] ? $cal->workingDaysBetween($plan['start_date'], $plan['expected_completion']) : null;
        return ['orders' => (int)$counts['orders'], 'orders_covered_by_stock' => (int)$counts['covered_by_stock'], 'operations' => $opsCount, 'materials' => (int)$mat['n'], 'material_cost' => round((float)$mat['c'], 2), 'materials_flagged' => (int)$mat['flagged'],
            'lead_time_days' => $lead, 'window' => $window, 'utilisation' => $util, 'bottleneck' => $bottleneck, 'critical_path' => $critical, 'warnings' => array_values(array_unique($warnings))];
    }

    // =============================================================== lifecycle
    public function approve(int $planId): void
    {
        $db = $this->app->db;
        $plan = $db->one('SELECT * FROM {p}plans WHERE id=?', [$planId]);
        if (!$plan) throw new HttpException(404, 'Plan not found');
        if (!in_array($plan['status'], ['PROPOSED', 'SCENARIO'], true)) throw new HttpException(409, 'Only proposed plans can be approved');
        $user = $this->app->auth->currentUser();
        $db->transaction(function () use ($db, $plan, $planId, $user) {
            // re-run the schedule so the approved plan reflects every other approved plan's load as of now
            $this->schedule($planId, $plan['start_date'], false);
            $db->run("UPDATE {p}plans SET status='SUPERSEDED' WHERE sales_request_id=? AND id<>? AND status IN ('PROPOSED','APPROVED','SCENARIO')", [$plan['sales_request_id'], $planId]);
            $summary = $this->summarize($planId);
            $cost = $this->app->costing->planCost($planId);
            $db->run("UPDATE {p}plans SET status='APPROVED', approved_by=?, approved_at=?, summary=?, cost_snapshot=? WHERE id=?", [$user['username'] ?? 'system', $db->now(), json_encode($summary), json_encode($cost), $planId]);
            $db->run("UPDATE {p}orders SET status='RELEASED' WHERE plan_id=? AND status='PLANNED'", [$planId]);
            $db->run("UPDATE {p}sales_requests SET status='APPROVED', updated_at=? WHERE id=?", [$db->now(), $plan['sales_request_id']]);
            $this->app->audit->log('PLAN_APPROVED', 'plan', $planId, ['expected_completion' => $db->val('SELECT expected_completion FROM {p}plans WHERE id=?', [$planId])]);
        });
    }

    /** Planner adjustment: new start date and/or capacity overrides per operation, then reschedule. */
    public function adjust(int $planId, array $changes): void
    {
        $db = $this->app->db;
        $plan = $db->one('SELECT * FROM {p}plans WHERE id=?', [$planId]);
        if (!$plan) throw new HttpException(404, 'Plan not found');
        if ($plan['status'] === 'COMPLETED' || $plan['status'] === 'SUPERSEDED') throw new HttpException(409, 'This plan can no longer be changed');
        $db->transaction(function () use ($db, $plan, $planId, $changes) {
            $start = $changes['start_date'] ?? $plan['start_date'];
            foreach ($changes['operations'] ?? [] as $c) {
                $op = $db->one('SELECT * FROM {p}operations WHERE id=? AND plan_id=?', [(int)$c['id'], $planId]);
                if (!$op) continue;
                $upd = [];
                if (isset($c['daily_capacity']) && (float)$c['daily_capacity'] > 0) { $upd['daily_capacity'] = (float)$c['daily_capacity']; $upd['capacity_source'] = 'Planner override (' . ($c['reason'] ?? 'manual') . ')'; $sec = $this->sections[(int)$op['section_id']]; $upd['total_minutes'] = (float)$op['required_qty'] * ((int)$sec['minutes_per_day'] * max(1, (int)$sec['lines'])) / (float)$c['daily_capacity']; }
                if (isset($c['machine_id'])) $upd['machine_id'] = $c['machine_id'] ? (int)$c['machine_id'] : null;
                if (isset($c['section_id']) && isset($this->sections[(int)$c['section_id']])) $upd['section_id'] = (int)$c['section_id'];
                if ($upd) $db->update('operations', $upd, 'id=?', [$op['id']]);
            }
            $inProgress = (bool)$db->val("SELECT COUNT(*) FROM {p}operations WHERE plan_id=? AND status IN ('IN_PROGRESS','COMPLETED')", [$planId]);
            if ($inProgress) { $from = $this->app->calendar->nextWorkingDay(gmdate('Y-m-d'), 1); $this->schedule($planId, $from, true); }
            else { $db->run('UPDATE {p}plans SET start_date=? WHERE id=?', [$this->app->calendar->alignForward($start), $planId]); $this->schedule($planId, $start, false); }
            $db->run('UPDATE {p}plans SET summary=? WHERE id=?', [json_encode($this->summarize($planId)), $planId]);
            $this->app->audit->log('PLAN_ADJUSTED', 'plan', $planId, $changes);
        });
    }

    /** Capacity conflicts a proposed/scenario plan would create against approved plans (>100% section load on any day). */
    public function conflicts(int $planId): array
    {
        $db = $this->app->db;
        $rows = $db->all("SELECT l.section_id, l.ldate, SUM(l.minutes) m FROM {p}op_loads l JOIN {p}plans p ON p.id=l.plan_id WHERE l.machine_id IS NULL AND (p.id=? OR p.status IN ('APPROVED','IN_PROGRESS')) AND l.ldate >= (SELECT MIN(ldate) FROM {p}op_loads WHERE plan_id=?) GROUP BY l.section_id, l.ldate", [$planId, $planId]);
        $out = [];
        foreach ($rows as $r) {
            $sec = $this->sections[(int)$r['section_id']]; $cap = (int)$sec['minutes_per_day'] * max(1, (int)$sec['lines']) * ($this->app->calendar->minutes($r['ldate']) / 480);
            if ((float)$r['m'] > $cap * 1.001) $out[] = ['section' => $sec['name'], 'date' => $r['ldate'], 'load_pct' => round(100 * (float)$r['m'] / max(1, $cap), 1)];
        }
        return $out;
    }

    // =============================================================== daily production reporting
    public function recordDaily(array $d): int
    {
        $db = $this->app->db;
        $op = $db->one('SELECT * FROM {p}operations WHERE id=?', [(int)$d['op_id']]);
        if (!$op) throw new HttpException(404, 'Operation not found');
        $plan = $db->one('SELECT * FROM {p}plans WHERE id=?', [$op['plan_id']]);
        if (!in_array($plan['status'], ['APPROVED', 'IN_PROGRESS'], true)) throw new HttpException(409, 'Production can only be reported against an approved plan');
        $user = $this->app->auth->currentUser();
        $date = $d['date'] ?? gmdate('Y-m-d');
        $good = max(0, (float)($d['good_qty'] ?? 0)); $rej = max(0, (float)($d['rejected_qty'] ?? 0)); $rew = max(0, (float)($d['rework_qty'] ?? 0));
        return $db->transaction(function () use ($db, $op, $plan, $user, $date, $good, $rej, $rew, $d) {
            $planned = (float)($d['planned_qty'] ?? $db->val('SELECT COALESCE(SUM(qty),0) FROM {p}op_loads WHERE op_id=? AND ldate=? AND machine_id IS NULL', [$op['id'], $date]));
            $id = $db->insert('daily_reports', ['op_id' => $op['id'], 'plan_id' => $op['plan_id'], 'order_id' => $op['order_id'], 'section_id' => $op['section_id'], 'rdate' => $date, 'planned_qty' => $planned,
                'good_qty' => $good, 'rejected_qty' => $rej, 'rework_qty' => $rew, 'downtime_min' => (float)($d['downtime_min'] ?? 0), 'delay_reason' => $d['delay_reason'] ?? null, 'remarks' => $d['remarks'] ?? null,
                'supervisor' => $user['username'] ?? 'system', 'created_at' => $db->now()]);
            $tot = $db->one('SELECT SUM(good_qty) g, SUM(rejected_qty) r, SUM(rework_qty) w, MIN(rdate) a, MAX(rdate) b FROM {p}daily_reports WHERE op_id=?', [$op['id']]);
            $completed = (float)$tot['g'] >= (float)$op['required_qty'] - 1e-6;
            $db->update('operations', ['good_qty' => (float)$tot['g'], 'rejected_qty' => (float)$tot['r'], 'rework_qty' => (float)$tot['w'], 'actual_start' => $tot['a'], 'actual_finish' => $completed ? $tot['b'] : null, 'status' => $completed ? 'COMPLETED' : 'IN_PROGRESS'], 'id=?', [$op['id']]);
            // order status / completed qty = output of the order's last operation
            $last = $db->one('SELECT * FROM {p}operations WHERE order_id=? ORDER BY seq DESC LIMIT 1', [$op['order_id']]);
            $allDone = !(bool)$db->val("SELECT COUNT(*) FROM {p}operations WHERE order_id=? AND status<>'COMPLETED'", [$op['order_id']]);
            $db->update('orders', ['completed_qty' => (float)$last['good_qty'], 'status' => $allDone ? 'COMPLETED' : 'IN_PROGRESS', 'actual_finish' => $allDone ? $last['actual_finish'] : null], 'id=?', [$op['order_id']]);
            if ($allDone) $this->app->inventory->autoReceiveOrder((int)$op['order_id']);
            if ($plan['status'] === 'APPROVED') $db->run("UPDATE {p}plans SET status='IN_PROGRESS' WHERE id=?", [$plan['id']]);
            $this->app->audit->log('DAILY_REPORT', 'operation', $op['id'], ['date' => $date, 'good' => $good, 'rejected' => $rej, 'rework' => $rew, 'planned' => $planned, 'reason' => $d['delay_reason'] ?? null]);
            // re-plan the remaining work from the next working day after the report
            $this->replan((int)$plan['id'], $this->app->calendar->nextWorkingDay($date, 1));
            return $id;
        });
    }

    public function replan(int $planId, ?string $from = null): void
    {
        $db = $this->app->db;
        $from = $from ?? $this->app->calendar->nextWorkingDay(gmdate('Y-m-d'), 1);
        $this->schedule($planId, $from, true);
        $plan = $db->one('SELECT * FROM {p}plans WHERE id=?', [$planId]);
        $allDone = !(bool)$db->val("SELECT COUNT(*) FROM {p}orders WHERE plan_id=? AND status<>'COMPLETED' AND net_qty>0", [$planId]);
        $summary = $this->summarize($planId);
        $summary['delay_days'] = $plan['baseline_completion'] && $plan['expected_completion'] ? $this->delayDays($plan['baseline_completion'], $plan['expected_completion']) : 0;
        $db->run('UPDATE {p}plans SET summary=?' . ($allDone ? ", status='COMPLETED'" : '') . ' WHERE id=?', [json_encode($summary), $planId]);
        if ($allDone) $db->run("UPDATE {p}sales_requests SET status='COMPLETED', updated_at=? WHERE id=?", [$db->now(), $plan['sales_request_id']]);
    }

    /** Full plan payload for the UI. */
    public function planDetail(int $planId): array
    {
        $db = $this->app->db;
        $plan = $db->one('SELECT p.*, s.number sr_number, s.customer, s.delivery_date, s.priority, s.product_desc FROM {p}plans p JOIN {p}sales_requests s ON s.id=p.sales_request_id WHERE p.id=?', [$planId]);
        if (!$plan) throw new HttpException(404, 'Plan not found');
        $plan['summary'] = json_decode($plan['summary'] ?? 'null', true);
        $plan['critical_path'] = json_decode($plan['critical_path'] ?? '[]', true);
        $plan['cost_snapshot'] = json_decode($plan['cost_snapshot'] ?? 'null', true);
        $orders = $db->all('SELECT o.*, s.name main_section FROM {p}orders o LEFT JOIN {p}sections s ON s.id=o.main_section_id WHERE o.plan_id=? ORDER BY o.level, o.id', [$planId]);
        $ops = $db->all('SELECT o.*, s.name section_name, s.code section_code, s.color, s.activity, m.name machine_name FROM {p}operations o JOIN {p}sections s ON s.id=o.section_id LEFT JOIN {p}machines m ON m.id=o.machine_id WHERE o.plan_id=? ORDER BY o.order_id, o.seq', [$planId]);
        $today = gmdate('Y-m-d');
        $assumed = []; foreach ($db->all('SELECT l.op_id, SUM(l.qty) q FROM {p}op_loads l WHERE l.plan_id=? AND l.machine_id IS NULL AND l.ldate<? AND NOT EXISTS (SELECT 1 FROM {p}daily_reports r WHERE r.op_id=l.op_id) GROUP BY l.op_id', [$planId, $today]) as $a) $assumed[(int)$a['op_id']] = (float)$a['q'];
        foreach ($ops as &$o) { $o['remaining_qty'] = max(0, (float)$o['required_qty'] - (float)$o['good_qty']); $o['progress_pct'] = $o['required_qty'] > 0 ? round(100 * (float)$o['good_qty'] / (float)$o['required_qty'], 1) : 0; $o['unreported_qty'] = $assumed[(int)$o['id']] ?? 0; } unset($o);
        $deps = $db->all('SELECT d.* FROM {p}op_deps d JOIN {p}operations o ON o.id=d.op_id WHERE o.plan_id=?', [$planId]);
        $orderDeps = $db->all('SELECT d.* FROM {p}order_deps d JOIN {p}orders o ON o.id=d.order_id WHERE o.plan_id=?', [$planId]);
        $materials = $db->all('SELECT m.*, o.item_code parent_code FROM {p}materials m JOIN {p}orders o ON o.id=m.order_id WHERE m.plan_id=? ORDER BY m.cost_group, m.component_code', [$planId]);
        $loads = $db->all('SELECT op_id, ldate, SUM(qty) qty, SUM(minutes) minutes FROM {p}op_loads WHERE plan_id=? AND machine_id IS NULL GROUP BY op_id, ldate ORDER BY ldate', [$planId]);
        $reports = $db->all('SELECT * FROM {p}daily_reports WHERE plan_id=? ORDER BY rdate, id', [$planId]);
        return ['plan' => $plan, 'orders' => $orders, 'operations' => $ops, 'op_deps' => $deps, 'order_deps' => $orderDeps, 'materials' => $materials, 'loads' => $loads, 'reports' => $reports, 'conflicts' => $plan['status'] === 'PROPOSED' || $plan['status'] === 'SCENARIO' ? $this->conflicts($planId) : []];
    }
}
