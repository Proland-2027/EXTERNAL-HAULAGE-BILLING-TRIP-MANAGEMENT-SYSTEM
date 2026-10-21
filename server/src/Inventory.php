<?php
/** Inventory — movements per item, balances by category, automatic WIP / finished-goods receipts from production. */
final class Inventory
{
    public const CATEGORIES = ['RAW' => 'Raw Materials', 'CUT' => 'Cut Parts', 'WELDED' => 'Welded Parts', 'COATED' => 'Powder-Coated Parts', 'BASE' => 'Base Frames', 'PANEL' => 'Panels', 'SEMI' => 'Other Semi-Finished Components', 'FG' => 'Finished Goods'];
    public const IN_TYPES = ['OPENING', 'RECEIPT', 'WIP_IN', 'FG_RECEIPT', 'RETURN', 'ADJUST_IN'];
    public const OUT_TYPES = ['ISSUE', 'WIP_OUT', 'REJECT', 'ADJUST_OUT', 'DISPATCH'];

    public function __construct(private App $app) {}

    public function available(string $itemCode): float
    {
        $r = $this->app->db->one("SELECT SUM(CASE WHEN mtype IN ('OPENING','RECEIPT','WIP_IN','FG_RECEIPT','RETURN','ADJUST_IN') THEN qty ELSE -qty END) q FROM {p}inventory_movements WHERE item_code=?", [$itemCode]);
        return max(0.0, (float)($r['q'] ?? 0));
    }

    public function categoryFor(array $item): string
    {
        if ($item['item_type'] === 'FINISHED') return 'FG';
        if ($item['item_type'] === 'RAW') return 'RAW';
        $cg = (string)($item['cost_group'] ?? ''); $code = $item['code'];
        if ($cg === 'SF-BASE' || str_starts_with($code, 'BASE')) return 'BASE';
        if ($cg === 'SF-PANEL' || str_contains($code, 'CPNL') || str_contains($code, 'CBB') || str_contains($code, 'RELAY') || str_starts_with($code, 'BB-') || str_starts_with($code, 'RB-')) return 'PANEL';
        return 'SEMI';
    }

    public function move(array $m): int
    {
        $db = $this->app->db;
        if (!in_array($m['mtype'], array_merge(self::IN_TYPES, self::OUT_TYPES), true)) throw new HttpException(422, 'Unknown movement type ' . $m['mtype']);
        $item = $db->one('SELECT * FROM {p}items WHERE code=?', [$m['item_code']]);
        if (!$item) throw new HttpException(404, 'Item ' . $m['item_code'] . ' not found');
        $qty = (float)$m['qty'];
        if ($qty <= 0) throw new HttpException(422, 'Quantity must be positive');
        if (in_array($m['mtype'], self::OUT_TYPES, true) && $this->available($item['code']) + 1e-9 < $qty && empty($m['allow_negative'])) throw new HttpException(422, 'Only ' . $this->available($item['code']) . ' ' . $item['code'] . ' available');
        $user = $this->app->auth->currentUser();
        $orderId = !empty($m['order_id']) ? (int)$m['order_id'] : null; $planId = null;
        if ($orderId) { $planId = (int)$db->val('SELECT plan_id FROM {p}orders WHERE id=?', [$orderId]) ?: null; }
        $id = $db->insert('inventory_movements', ['item_code' => $item['code'], 'category' => $m['category'] ?? $this->categoryFor($item), 'mtype' => $m['mtype'], 'qty' => $qty, 'unit' => $item['unit'], 'unit_cost' => isset($m['unit_cost']) && $m['unit_cost'] !== '' ? (float)$m['unit_cost'] : (float)$item['std_cost'],
            'order_id' => $orderId, 'op_id' => !empty($m['op_id']) ? (int)$m['op_id'] : null, 'plan_id' => $planId, 'reference' => $m['reference'] ?? null, 'remarks' => $m['remarks'] ?? null, 'created_by' => $user['username'] ?? 'system', 'created_at' => $db->now(), 'mdate' => $m['mdate'] ?? gmdate('Y-m-d')]);
        if ($orderId && $m['mtype'] === 'ISSUE') $db->run('UPDATE {p}materials SET issued_qty = issued_qty + ? WHERE order_id=? AND component_code=?', [$qty, $orderId, $item['code']]);
        $this->app->audit->log('INVENTORY_' . $m['mtype'], 'item', $item['code'], ['qty' => $qty, 'order_id' => $orderId, 'ref' => $m['reference'] ?? null]);
        return $id;
    }

    /** When an order's last operation completes, receive its output into stock (WIP_IN for semi-finished, FG_RECEIPT for finished). */
    public function autoReceiveOrder(int $orderId): void
    {
        $db = $this->app->db;
        $o = $db->one('SELECT * FROM {p}orders WHERE id=?', [$orderId]);
        if (!$o || (float)$o['completed_qty'] <= 0) return;
        if ($db->val("SELECT COUNT(*) FROM {p}inventory_movements WHERE order_id=? AND mtype IN ('WIP_IN','FG_RECEIPT') AND reference='AUTO'", [$orderId])) return;
        $item = $db->one('SELECT * FROM {p}items WHERE code=?', [$o['item_code']]);
        $type = $o['level'] == 0 ? 'FG_RECEIPT' : 'WIP_IN';
        $db->insert('inventory_movements', ['item_code' => $o['item_code'], 'category' => $item ? $this->categoryFor($item) : 'SEMI', 'mtype' => $type, 'qty' => (float)$o['completed_qty'], 'unit' => $item['unit'] ?? 'PCS', 'unit_cost' => $item['std_cost'] ?? null,
            'order_id' => $orderId, 'op_id' => null, 'plan_id' => $o['plan_id'], 'reference' => 'AUTO', 'remarks' => 'Automatic receipt on completion of ' . $o['number'], 'created_by' => 'system', 'created_at' => $db->now(), 'mdate' => $o['actual_finish'] ?? gmdate('Y-m-d')]);
        // semi-finished output consumed by the parent order when the parent starts is recorded as WIP_OUT by the store; here we only receive
    }

    public function balances(?string $category = null, ?string $search = null): array
    {
        $w = ['1=1']; $p = [];
        if ($category) { $w[] = 'm.category=?'; $p[] = $category; }
        if ($search) { $w[] = '(m.item_code LIKE ? OR i.name LIKE ?)'; $p[] = "%$search%"; $p[] = "%$search%"; }
        $sql = "SELECT m.item_code, i.name, i.unit, m.category, i.std_cost,
            SUM(CASE WHEN m.mtype='OPENING' THEN m.qty ELSE 0 END) opening,
            SUM(CASE WHEN m.mtype IN ('RECEIPT','WIP_IN','FG_RECEIPT','RETURN','ADJUST_IN') THEN m.qty ELSE 0 END) receipts,
            SUM(CASE WHEN m.mtype IN ('ISSUE','WIP_OUT','DISPATCH','ADJUST_OUT') THEN m.qty ELSE 0 END) issues,
            SUM(CASE WHEN m.mtype='REJECT' THEN m.qty ELSE 0 END) rejected,
            SUM(CASE WHEN m.mtype IN ('OPENING','RECEIPT','WIP_IN','FG_RECEIPT','RETURN','ADJUST_IN') THEN m.qty ELSE -m.qty END) available
            FROM {p}inventory_movements m LEFT JOIN {p}items i ON i.code=m.item_code WHERE " . implode(' AND ', $w) . ' GROUP BY m.item_code, i.name, i.unit, m.category, i.std_cost ORDER BY m.category, m.item_code';
        $rows = $this->app->db->all($sql, $p);
        // work in progress per item: quantities released to orders not yet completed
        $wip = [];
        foreach ($this->app->db->all("SELECT o.item_code, SUM(o.net_qty - o.completed_qty) q FROM {p}orders o JOIN {p}plans p ON p.id=o.plan_id WHERE p.status IN ('APPROVED','IN_PROGRESS') AND o.status IN ('RELEASED','IN_PROGRESS') GROUP BY o.item_code") as $r) $wip[$r['item_code']] = (float)$r['q'];
        foreach ($rows as &$r) { $r['wip'] = $wip[$r['item_code']] ?? 0; $r['value'] = round((float)$r['available'] * (float)$r['std_cost'], 2); } unset($r);
        return $rows;
    }

    public function movements(array $f = []): array
    {
        $w = ['1=1']; $p = [];
        if (!empty($f['item_code'])) { $w[] = 'm.item_code=?'; $p[] = $f['item_code']; }
        if (!empty($f['order_id'])) { $w[] = 'm.order_id=?'; $p[] = (int)$f['order_id']; }
        if (!empty($f['from'])) { $w[] = 'm.mdate>=?'; $p[] = $f['from']; }
        if (!empty($f['to'])) { $w[] = 'm.mdate<=?'; $p[] = $f['to']; }
        return $this->app->db->all('SELECT m.*, o.number order_number FROM {p}inventory_movements m LEFT JOIN {p}orders o ON o.id=m.order_id WHERE ' . implode(' AND ', $w) . ' ORDER BY m.mdate DESC, m.id DESC LIMIT 500', $p);
    }
}
