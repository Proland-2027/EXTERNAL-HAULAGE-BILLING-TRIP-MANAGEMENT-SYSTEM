<?php
/**
 * Api — JSON REST router. Mounted at /api (standalone, public/index.php) or /wp-json/proland/v1 (WordPress plugin).
 * Every handler receives ($params, $body, $query) and returns an array; exceptions become JSON errors.
 */
final class Api
{
    private array $routes = [];

    public function __construct(private App $app) { $this->register(); }

    private function on(string $method, string $pattern, callable $fn, ?string $perm = null): void
    {
        $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[^/]+)', $pattern) . '$#';
        $this->routes[] = [$method, $regex, $fn, $perm];
    }

    /** Dispatch a request; returns [status, payload]. */
    public function dispatch(string $method, string $path, array $query, array $body): array
    {
        $path = '/' . trim($path, '/');
        try {
            foreach ($this->routes as [$m, $regex, $fn, $perm]) {
                if ($m !== $method || !preg_match($regex, $path, $mm)) continue;
                if ($perm !== null) $this->app->auth->require($perm);
                $params = array_filter($mm, 'is_string', ARRAY_FILTER_USE_KEY);
                $params = array_map('urldecode', $params);
                $out = $fn($params, $body, $query);
                return [200, $out ?? ['ok' => true]];
            }
            return [404, ['error' => "No API route for $method $path"]];
        } catch (HttpException $e) {
            return [$e->status, ['error' => $e->getMessage(), 'details' => $e->extra]];
        } catch (PDOException $e) {
            return [500, ['error' => 'Database error', 'details' => $e->getMessage()]];
        } catch (Throwable $e) {
            return [500, ['error' => $e->getMessage(), 'type' => get_class($e), 'at' => basename($e->getFile()) . ':' . $e->getLine()]];
        }
    }

    private function user(): ?array { return $this->app->auth->currentUser(); }
    private function need(array $body, array $keys): void { foreach ($keys as $k) if (!isset($body[$k]) || $body[$k] === '') throw new HttpException(422, "Field '$k' is required"); }

    private function register(): void
    {
        $app = $this->app; $db = $app->db;

        // ---------------------------------------------------------------- auth / session
        $this->on('POST', '/auth/login', function ($p, $b) use ($app) {
            $this->need($b, ['username', 'password']);
            $r = $app->auth->login($b['username'], $b['password']);
            if (!$r) throw new HttpException(401, 'Invalid username or password');
            $secure = $app->cfg['app']['cookie_secure'] ?? null;
            if ($secure === null) $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
            if (!headers_sent()) setcookie('pp_session', $r['token'], ['expires' => time() + 3600 * (int)$app->cfg['app']['session_hours'], 'path' => '/', 'secure' => (bool)$secure, 'httponly' => true, 'samesite' => 'Lax']);
            return $r;
        });
        $this->on('POST', '/auth/logout', function () use ($app) { if (!empty($_COOKIE['pp_session'])) $app->auth->logout($_COOKIE['pp_session']); if (!headers_sent()) setcookie('pp_session', '', ['expires' => 1, 'path' => '/']); return ['ok' => true]; });
        $this->on('GET', '/auth/me', function () use ($app) {
            $u = $this->user();
            return ['user' => $u ? $app->auth->publicUser($u) : null, 'app' => ['name' => $app->cfg['app']['name'], 'currency' => $app->setting('currency', 'NGN'), 'company' => $app->setting('company'), 'last_import' => $app->setting('last_import'), 'roles' => Auth::ROLES, 'wordpress' => defined('ABSPATH')]];
        });
        $this->on('POST', '/auth/password', function ($p, $b) use ($app, $db) {
            $u = $app->auth->require('reports.view');
            $this->need($b, ['current', 'new']);
            if (!password_verify($b['current'], $u['password_hash'])) throw new HttpException(403, 'Current password is wrong');
            if (strlen($b['new']) < 8) throw new HttpException(422, 'New password must be at least 8 characters');
            $db->run('UPDATE {p}users SET password_hash=? WHERE id=?', [$app->auth->hashPassword($b['new']), $u['id']]);
            $app->audit->log('PASSWORD_CHANGED', 'user', $u['id']);
            return ['ok' => true];
        });

        // ---------------------------------------------------------------- master data
        $this->on('GET', '/meta', function () use ($app, $db) {
            return ['sections' => $db->all('SELECT * FROM {p}sections ORDER BY seq, id'), 'activities' => Seeder::ACTIVITIES, 'roles' => Auth::ROLES, 'settings' => $this->settings(),
                'finished_products' => $db->all('SELECT code, name, product_type, family, model, std_cost, cost_status FROM {p}items WHERE is_finished_product=1 ORDER BY code'),
                'inventory_categories' => Inventory::CATEGORIES, 'machines' => $db->all('SELECT m.*, s.code section_code FROM {p}machines m JOIN {p}sections s ON s.id=m.section_id ORDER BY s.seq, m.id')];
        }, 'reports.view');
        $this->on('GET', '/items', function ($p, $b, $q) use ($db) {
            $w = ['1=1']; $pp = [];
            if (!empty($q['type'])) { $w[] = 'item_type=?'; $pp[] = $q['type']; }
            if (!empty($q['search'])) { $w[] = '(code LIKE ? OR name LIKE ?)'; $pp[] = '%' . $q['search'] . '%'; $pp[] = '%' . $q['search'] . '%'; }
            if (!empty($q['cost_status'])) { $w[] = 'cost_status=?'; $pp[] = $q['cost_status']; }
            $limit = min(500, max(1, (int)($q['limit'] ?? 200)));
            return ['items' => $db->all('SELECT * FROM {p}items WHERE ' . implode(' AND ', $w) . " ORDER BY code LIMIT $limit", $pp), 'total' => (int)$db->val('SELECT COUNT(*) FROM {p}items WHERE ' . implode(' AND ', $w), $pp)];
        }, 'reports.view');
        $this->on('GET', '/items/{code}', function ($p) use ($db) {
            $item = $db->one('SELECT * FROM {p}items WHERE code=?', [$p['code']]);
            if (!$item) throw new HttpException(404, 'Item not found');
            return ['item' => $item, 'used_in' => $db->all('SELECT DISTINCT root_code, parent_code, qty_per, unit FROM {p}bom_rows WHERE component_code=? ORDER BY root_code LIMIT 200', [$p['code']]),
                'components' => $db->all('SELECT DISTINCT component_code, product_name, qty_per, unit, calc_type, cost_per_lot FROM {p}bom_rows WHERE parent_code=? ORDER BY calc_type, line_no LIMIT 300', [$p['code']]),
                'history' => $db->all('SELECT * FROM {p}item_cost_history WHERE item_code=? ORDER BY id DESC', [$p['code']])];
        }, 'reports.view');
        $this->on('GET', '/bom/{code}/explode', function ($p, $b, $q) use ($app) {
            $qty = (float)($q['qty'] ?? 1); $ex = $app->planner->explode($p['code'], $qty > 0 ? $qty : 1, !empty($q['inventory']));
            $strip = function (array $n) use (&$strip) { unset($n['materials']); $n['children'] = array_map($strip, $n['children']); $n['material_count'] = count($n['materials'] ?? []); return $n; };
            $orders = []; foreach ($ex['orders'] as $c => $o) { $o['material_count'] = count($o['materials']); unset($o['materials'], $o['overheads']); $orders[] = $o; }
            return ['tree' => $strip($ex['root']), 'orders' => $orders, 'materials' => array_values($ex['materials']), 'warnings' => $ex['warnings']];
        }, 'reports.view');

        // ---------------------------------------------------------------- sales requests
        $this->on('GET', '/sales-requests', function ($p, $b, $q) use ($db) {
            $w = ['1=1']; $pp = [];
            if (!empty($q['status'])) { $w[] = 's.status=?'; $pp[] = $q['status']; }
            if (!empty($q['search'])) { $w[] = '(s.number LIKE ? OR s.customer LIKE ? OR s.product_code LIKE ? OR s.sales_order_ref LIKE ?)'; for ($i = 0; $i < 4; $i++) $pp[] = '%' . $q['search'] . '%'; }
            return ['requests' => $db->all("SELECT s.*, (SELECT COUNT(*) FROM {p}plans p WHERE p.sales_request_id=s.id) plans, (SELECT p.id FROM {p}plans p WHERE p.sales_request_id=s.id AND p.status IN ('APPROVED','IN_PROGRESS','COMPLETED') ORDER BY p.id DESC LIMIT 1) active_plan_id,
                (SELECT p.id FROM {p}plans p WHERE p.sales_request_id=s.id ORDER BY p.id DESC LIMIT 1) latest_plan_id, (SELECT p.expected_completion FROM {p}plans p WHERE p.sales_request_id=s.id AND p.status<>'SUPERSEDED' ORDER BY p.id DESC LIMIT 1) expected_completion
                FROM {p}sales_requests s WHERE " . implode(' AND ', $w) . ' ORDER BY s.id DESC LIMIT 300', $pp)];
        }, 'reports.view');
        $this->on('POST', '/sales-requests', function ($p, $b) use ($app, $db) {
            $this->need($b, ['customer', 'product_code', 'qty']);
            $item = $db->one('SELECT * FROM {p}items WHERE code=? AND is_finished_product=1', [$b['product_code']]);
            if (!$item) throw new HttpException(422, 'Finished product code must come from the Finished Product worksheet');
            if ((float)$b['qty'] <= 0) throw new HttpException(422, 'Quantity must be greater than zero');
            $year = gmdate('Y'); $n = (int)$db->val('SELECT COUNT(*) FROM {p}sales_requests WHERE number LIKE ?', ["SR-$year-%"]) + 1;
            $number = sprintf('SR-%s-%04d', $year, $n);
            while ($db->val('SELECT COUNT(*) FROM {p}sales_requests WHERE number=?', [$number])) $number = sprintf('SR-%s-%04d', $year, ++$n);
            $u = $this->user();
            $id = $db->insert('sales_requests', ['number' => $number, 'sales_order_ref' => $b['sales_order_ref'] ?? null, 'customer' => $b['customer'], 'product_code' => $item['code'], 'product_desc' => $item['name'], 'product_type' => $b['product_type'] ?? $item['product_type'],
                'qty' => (float)$b['qty'], 'delivery_date' => $b['delivery_date'] ?? null, 'priority' => $b['priority'] ?? 'NORMAL', 'remarks' => $b['remarks'] ?? null, 'status' => 'SUBMITTED', 'created_by' => $u['username'], 'created_at' => $db->now()]);
            $app->audit->log('SALES_REQUEST_CREATED', 'sales_request', $id, $b);
            // automatically prepare the proposed plan (zero opening stock unless asked otherwise)
            $planId = null; $planError = null;
            try { $planId = $app->planner->generate($id, ['consider_inventory' => !empty($b['consider_inventory'])]); } catch (Throwable $e) { $planError = $e->getMessage(); }
            return ['id' => $id, 'number' => $number, 'plan_id' => $planId, 'plan_error' => $planError];
        }, 'sales.create');
        $this->on('PUT', '/sales-requests/{id}', function ($p, $b) use ($app, $db) {
            $sr = $db->one('SELECT * FROM {p}sales_requests WHERE id=?', [(int)$p['id']]);
            if (!$sr) throw new HttpException(404, 'Not found');
            $upd = [];
            foreach (['sales_order_ref', 'customer', 'delivery_date', 'priority', 'remarks', 'status'] as $k) if (array_key_exists($k, $b)) $upd[$k] = $b[$k];
            if (isset($b['qty']) && in_array($sr['status'], ['SUBMITTED', 'PLANNED'], true)) $upd['qty'] = (float)$b['qty'];
            if (isset($upd['status']) && $upd['status'] === 'CANCELLED') $db->run("UPDATE {p}plans SET status='SUPERSEDED' WHERE sales_request_id=? AND status IN ('PROPOSED','SCENARIO')", [$sr['id']]);
            $upd['updated_at'] = $db->now();
            $db->update('sales_requests', $upd, 'id=?', [$sr['id']]);
            $app->audit->log('SALES_REQUEST_UPDATED', 'sales_request', $sr['id'], $upd);
            return ['ok' => true];
        }, 'sales.edit');
        $this->on('GET', '/sales-requests/{id}', function ($p) use ($db) {
            $sr = $db->one('SELECT * FROM {p}sales_requests WHERE id=?', [(int)$p['id']]);
            if (!$sr) throw new HttpException(404, 'Not found');
            return ['request' => $sr, 'plans' => $db->all('SELECT id, version, status, start_date, expected_completion, baseline_completion, consider_inventory, created_by, created_at, approved_by, approved_at, qty FROM {p}plans WHERE sales_request_id=? ORDER BY id DESC', [$sr['id']])];
        }, 'reports.view');

        // ---------------------------------------------------------------- plans
        $this->on('POST', '/sales-requests/{id}/plan', function ($p, $b) use ($app) {
            $planId = $app->planner->generate((int)$p['id'], ['start_date' => $b['start_date'] ?? null, 'consider_inventory' => !empty($b['consider_inventory']), 'scenario' => !empty($b['scenario']), 'notes' => $b['notes'] ?? null, 'qty' => $b['qty'] ?? null]);
            return ['plan_id' => $planId];
        }, 'plan.generate');
        $this->on('GET', '/plans', function ($p, $b, $q) use ($db) {
            $w = ["p.status<>'SUPERSEDED'"]; $pp = [];
            if (!empty($q['status'])) { $w = ['p.status=?']; $pp[] = $q['status']; }
            return ['plans' => $db->all('SELECT p.id, p.version, p.status, p.product_code, p.qty, p.start_date, p.expected_completion, p.baseline_completion, p.created_at, p.approved_at, p.consider_inventory, s.number sr_number, s.customer, s.delivery_date, s.priority, sec.name bottleneck FROM {p}plans p JOIN {p}sales_requests s ON s.id=p.sales_request_id LEFT JOIN {p}sections sec ON sec.id=p.bottleneck_section_id WHERE ' . implode(' AND ', $w) . ' ORDER BY p.id DESC LIMIT 200', $pp)];
        }, 'reports.view');
        $this->on('GET', '/plans/{id}', fn($p) => $app->planner->planDetail((int)$p['id']), 'reports.view');
        $this->on('POST', '/plans/{id}/approve', function ($p) use ($app) { $app->planner->approve((int)$p['id']); return $app->planner->planDetail((int)$p['id']); }, 'plan.approve');
        $this->on('POST', '/plans/{id}/adjust', function ($p, $b) use ($app) { $app->planner->adjust((int)$p['id'], $b); return $app->planner->planDetail((int)$p['id']); }, 'plan.adjust');
        $this->on('POST', '/plans/{id}/replan', function ($p, $b) use ($app) { $app->planner->replan((int)$p['id'], $b['from'] ?? null); return $app->planner->planDetail((int)$p['id']); }, 'plan.adjust');
        $this->on('GET', '/plans/{id}/cost', function ($p) use ($app, $db) {
            $plan = $db->one('SELECT * FROM {p}plans WHERE id=?', [(int)$p['id']]);
            if (!$plan) throw new HttpException(404, 'Plan not found');
            return ['snapshot' => json_decode($plan['cost_snapshot'] ?? 'null', true), 'current' => $app->costing->planCost((int)$p['id']), 'variance' => $app->costing->variance((int)$p['id'])];
        }, 'cost.view');
        $this->on('DELETE', '/plans/{id}', function ($p) use ($app, $db) {
            $plan = $db->one('SELECT * FROM {p}plans WHERE id=?', [(int)$p['id']]);
            if (!$plan) throw new HttpException(404, 'Plan not found');
            if (!in_array($plan['status'], ['PROPOSED', 'SCENARIO'], true)) throw new HttpException(409, 'Only proposed plans and scenarios can be discarded');
            $db->transaction(function () use ($db, $plan) {
                foreach (['op_loads', 'materials', 'operations', 'orders'] as $t) $db->run("DELETE FROM {p}$t WHERE plan_id=?", [$plan['id']]);
                $db->run('DELETE FROM {p}op_deps WHERE op_id NOT IN (SELECT id FROM {p}operations)');
                $db->run('DELETE FROM {p}order_deps WHERE order_id NOT IN (SELECT id FROM {p}orders)');
                $db->run('DELETE FROM {p}plans WHERE id=?', [$plan['id']]);
            });
            $app->audit->log('PLAN_DISCARDED', 'plan', $plan['id']);
            return ['ok' => true];
        }, 'plan.adjust');

        // ---------------------------------------------------------------- production execution
        $this->on('GET', '/sections/{id}/board', fn($p, $b, $q) => $app->reports->sectionBoard((int)$p['id'], $q['date'] ?? null), 'reports.view');
        $this->on('GET', '/board', fn($p, $b, $q) => $app->reports->board($q), 'reports.view');
        $this->on('POST', '/daily-reports', function ($p, $b) use ($app) {
            $this->need($b, ['op_id', 'date']);
            $u = $this->user();
            if ($u['role'] === 'SUPERVISOR' && $u['section_id']) { $op = $app->db->one('SELECT section_id FROM {p}operations WHERE id=?', [(int)$b['op_id']]); if ($op && (int)$op['section_id'] !== (int)$u['section_id']) throw new HttpException(403, 'You can only report for your own section'); }
            $id = $app->planner->recordDaily($b);
            return ['id' => $id, 'plan' => $app->planner->planDetail((int)$app->db->val('SELECT plan_id FROM {p}operations WHERE id=?', [(int)$b['op_id']]))['plan']];
        }, 'production.report');
        $this->on('GET', '/daily-reports', function ($p, $b, $q) use ($db) {
            $w = ['1=1']; $pp = [];
            if (!empty($q['section_id'])) { $w[] = 'r.section_id=?'; $pp[] = (int)$q['section_id']; }
            if (!empty($q['plan_id'])) { $w[] = 'r.plan_id=?'; $pp[] = (int)$q['plan_id']; }
            if (!empty($q['from'])) { $w[] = 'r.rdate>=?'; $pp[] = $q['from']; }
            if (!empty($q['to'])) { $w[] = 'r.rdate<=?'; $pp[] = $q['to']; }
            return ['reports' => $db->all('SELECT r.*, o.item_code, ord.number order_number, s.name section_name, p.product_code FROM {p}daily_reports r JOIN {p}operations o ON o.id=r.op_id JOIN {p}orders ord ON ord.id=r.order_id JOIN {p}sections s ON s.id=r.section_id JOIN {p}plans p ON p.id=r.plan_id WHERE ' . implode(' AND ', $w) . ' ORDER BY r.rdate DESC, r.id DESC LIMIT 500', $pp)];
        }, 'reports.view');

        // ---------------------------------------------------------------- inventory
        $this->on('GET', '/inventory/balances', fn($p, $b, $q) => ['balances' => $app->inventory->balances($q['category'] ?? null, $q['search'] ?? null), 'categories' => Inventory::CATEGORIES], 'reports.view');
        $this->on('GET', '/inventory/movements', fn($p, $b, $q) => ['movements' => $app->inventory->movements($q)], 'reports.view');
        $this->on('POST', '/inventory/movements', function ($p, $b) use ($app) { $this->need($b, ['item_code', 'mtype', 'qty']); return ['id' => $app->inventory->move($b)]; }, 'inventory.move');

        // ---------------------------------------------------------------- costing
        $this->on('GET', '/costing/bom/{code}', fn($p, $b, $q) => $app->costing->bomCost($p['code'], max(0.0001, (float)($q['qty'] ?? 1))), 'cost.view');
        $this->on('GET', '/costing/rates', fn() => ['rates' => $db->all('SELECT r.*, s.name section_name, s.code section_code FROM {p}cost_rates r LEFT JOIN {p}sections s ON s.id=r.section_id ORDER BY r.kind, s.seq')], 'cost.view');
        $this->on('PUT', '/costing/rates/{id}', function ($p, $b) use ($app, $db) {
            $r = $db->one('SELECT * FROM {p}cost_rates WHERE id=?', [(int)$p['id']]);
            if (!$r) throw new HttpException(404, 'Rate not found');
            $upd = ['notes' => $b['notes'] ?? 'Configured by ' . ($this->user()['username'] ?? '')];
            if (isset($b['rate_per_hour'])) $upd['rate_per_hour'] = (float)$b['rate_per_hour'];
            if (isset($b['pct_of_material'])) $upd['pct_of_material'] = (float)$b['pct_of_material'];
            $upd['valid_from'] = $b['valid_from'] ?? gmdate('Y-m-d');
            $db->update('cost_rates', $upd, 'id=?', [$r['id']]);
            $app->audit->log('COST_RATE_UPDATED', 'cost_rate', $r['id'], ['old' => $r, 'new' => $upd]);
            return ['ok' => true];
        }, 'cost.edit');
        $this->on('POST', '/costing/rates', function ($p, $b) use ($app, $db) {
            $this->need($b, ['kind']);
            $id = $db->insert('cost_rates', ['kind' => $b['kind'], 'section_id' => $b['section_id'] ?? null, 'rate_per_hour' => isset($b['rate_per_hour']) ? (float)$b['rate_per_hour'] : null, 'pct_of_material' => isset($b['pct_of_material']) ? (float)$b['pct_of_material'] : null, 'valid_from' => $b['valid_from'] ?? gmdate('Y-m-d'), 'notes' => $b['notes'] ?? 'Configured']);
            $app->audit->log('COST_RATE_CREATED', 'cost_rate', $id, $b);
            return ['id' => $id];
        }, 'cost.edit');
        $this->on('PUT', '/items/{code}/cost', function ($p, $b) use ($app) { $this->need($b, ['std_cost', 'reason']); $app->costing->updateItemCost($p['code'], (float)$b['std_cost'], $b['reason']); return ['ok' => true]; }, 'cost.edit');

        // ---------------------------------------------------------------- reports & dashboards
        $this->on('GET', '/dashboard', fn($p, $b, $q) => $app->reports->dashboard($q), 'reports.view');
        $this->on('GET', '/capacity', fn() => $app->reports->capacityMaster(), 'reports.view');
        $this->on('PUT', '/capacity/rates/{id}', function ($p, $b) use ($app, $db) {
            $r = $db->one('SELECT * FROM {p}capacity_rates WHERE id=?', [(int)$p['id']]);
            if (!$r) throw new HttpException(404, 'Rate not found');
            $upd = [];
            if (isset($b['units_per_day'])) $upd['units_per_day'] = (float)$b['units_per_day'];
            if (isset($b['notes'])) $upd['notes'] = $b['notes'];
            if (!empty($b['is_primary'])) { $db->run('UPDATE {p}capacity_rates SET is_primary=0 WHERE section_id=? AND family=? AND COALESCE(model,\'\')=COALESCE(?,\'\')', [$r['section_id'], $r['family'], $r['model']]); $upd['is_primary'] = 1; }
            if ($upd) $db->update('capacity_rates', $upd, 'id=?', [$r['id']]);
            $app->audit->log('CAPACITY_RATE_UPDATED', 'capacity_rate', $r['id'], ['old' => $r, 'new' => $upd]);
            return ['ok' => true];
        }, 'capacity.edit');
        $this->on('POST', '/capacity/rates', function ($p, $b) use ($app, $db) {
            $this->need($b, ['section_id', 'family', 'units_per_day']);
            $cl = Families::classify($b['source_code'] ?? $b['family']);
            $id = $db->insert('capacity_rates', ['section_id' => (int)$b['section_id'], 'family' => $b['family'], 'model' => $b['model'] ?? $cl['model'], 'source' => 'Manual entry', 'source_code' => $b['source_code'] ?? $b['family'], 'units_per_day' => (float)$b['units_per_day'], 'per_unit_rate' => null, 'staff' => $b['staff'] ?? null, 'lines' => $b['lines'] ?? null, 'is_primary' => 0, 'notes' => $b['notes'] ?? null]);
            if (!empty($b['is_primary'])) { $db->run("UPDATE {p}capacity_rates SET is_primary=0 WHERE section_id=? AND family=? AND COALESCE(model,'')=COALESCE(?,'')", [(int)$b['section_id'], $b['family'], $b['model'] ?? $cl['model']]); $db->run('UPDATE {p}capacity_rates SET is_primary=1 WHERE id=?', [$id]); }
            $app->audit->log('CAPACITY_RATE_CREATED', 'capacity_rate', $id, $b);
            return ['id' => $id];
        }, 'capacity.edit');
        $this->on('PUT', '/sections/{id}', function ($p, $b) use ($app, $db) {
            $s = $db->one('SELECT * FROM {p}sections WHERE id=?', [(int)$p['id']]);
            if (!$s) throw new HttpException(404, 'Section not found');
            $upd = [];
            foreach (['lines', 'staff', 'minutes_per_day'] as $k) if (isset($b[$k])) $upd[$k] = max(0, (int)$b[$k]);
            if (isset($b['allow_partial_transfer'])) $upd['allow_partial_transfer'] = $b['allow_partial_transfer'] ? 1 : 0;
            if (isset($b['name'])) $upd['name'] = $b['name'];
            if ($upd) $db->update('sections', $upd, 'id=?', [$s['id']]);
            $app->audit->log('SECTION_UPDATED', 'section', $s['id'], ['old' => $s, 'new' => $upd]);
            return ['ok' => true];
        }, 'capacity.edit');
        $this->on('GET', '/calendar', function ($p, $b, $q) use ($db) { return ['days' => $db->all('SELECT * FROM {p}calendar WHERE cdate BETWEEN ? AND ? ORDER BY cdate', [$q['from'] ?? gmdate('Y-m-01'), $q['to'] ?? gmdate('Y-m-d', strtotime('+3 months'))])]; }, 'reports.view');
        $this->on('PUT', '/calendar/{date}', function ($p, $b) use ($app) { $app->calendar->setDay($p['date'], !empty($b['is_working']), (int)($b['minutes'] ?? 480), $b['note'] ?? null); $app->audit->log('CALENDAR_UPDATED', 'calendar', $p['date'], $b); return ['ok' => true]; }, 'capacity.edit');

        // ---------------------------------------------------------------- exceptions & audit & admin
        $this->on('GET', '/exceptions', function ($p, $b, $q) use ($db) {
            $w = ['1=1']; $pp = [];
            if (!empty($q['category'])) { $w[] = 'category=?'; $pp[] = $q['category']; }
            if (!empty($q['status'])) { $w[] = 'status=?'; $pp[] = $q['status']; }
            return ['exceptions' => $db->all('SELECT * FROM {p}exceptions WHERE ' . implode(' AND ', $w) . ' ORDER BY status, severity, id LIMIT 1000', $pp), 'counts' => $db->all("SELECT category, status, COUNT(*) n FROM {p}exceptions GROUP BY category, status")];
        }, 'reports.view');
        $this->on('POST', '/exceptions/{id}/review', function ($p) use ($app, $db) { $db->run("UPDATE {p}exceptions SET status='REVIEWED', reviewed_by=?, reviewed_at=? WHERE id=?", [$this->user()['username'], $db->now(), (int)$p['id']]); $app->audit->log('EXCEPTION_REVIEWED', 'exception', $p['id']); return ['ok' => true]; }, 'exceptions.review');
        $this->on('GET', '/audit', fn($p, $b, $q) => ['entries' => $app->audit->recent((int)($q['limit'] ?? 200), $q['entity'] ?? null, $q['entity_id'] ?? null)], 'reports.view');
        $this->on('GET', '/users', fn() => ['users' => $db->all('SELECT id, username, display_name, email, role, section_id, active, created_at, last_login FROM {p}users ORDER BY id')], 'admin');
        $this->on('POST', '/users', function ($p, $b) use ($app) { $this->need($b, ['username', 'password', 'display_name', 'role']); $id = $app->auth->createUser($b['username'], $b['password'], $b['display_name'], $b['role'], $b['email'] ?? null, !empty($b['section_id']) ? (int)$b['section_id'] : null); $app->audit->log('USER_CREATED', 'user', $id, ['username' => $b['username'], 'role' => $b['role']]); return ['id' => $id]; }, 'admin');
        $this->on('PUT', '/users/{id}', function ($p, $b) use ($app, $db) {
            $upd = [];
            foreach (['display_name', 'email', 'role'] as $k) if (isset($b[$k])) $upd[$k] = $b[$k];
            if (array_key_exists('section_id', $b)) $upd['section_id'] = $b['section_id'] ? (int)$b['section_id'] : null;
            if (isset($b['active'])) $upd['active'] = $b['active'] ? 1 : 0;
            if (!empty($b['password'])) $upd['password_hash'] = $app->auth->hashPassword($b['password']);
            if ($upd) $db->update('users', $upd, 'id=?', [(int)$p['id']]);
            $app->audit->log('USER_UPDATED', 'user', $p['id'], array_diff_key($upd, ['password_hash' => 1]));
            return ['ok' => true];
        }, 'admin');
        $this->on('GET', '/settings', fn() => ['settings' => $this->settings()], 'admin');
        $this->on('PUT', '/settings', function ($p, $b) use ($app) { foreach ($b as $k => $v) $app->setSetting($k, $v); $app->audit->log('SETTINGS_UPDATED', 'settings', null, $b); return ['settings' => $this->settings()]; }, 'admin');
        $this->on('POST', '/admin/import', function ($p, $b) use ($app) {
            $file = $app->cfg['app']['workbook'];
            if (!empty($_FILES['workbook']['tmp_name'])) { $dest = dirname(__DIR__) . '/data/uploaded-' . gmdate('Ymd-His') . '.xlsx'; move_uploaded_file($_FILES['workbook']['tmp_name'], $dest); $file = $dest; }
            $summary = $app->importer->import($file);
            $app->audit->log('WORKBOOK_IMPORTED', 'system', null, $summary);
            return ['summary' => $summary];
        }, 'admin');
        $this->on('POST', '/admin/backup', fn() => ['file' => basename((new Backup($app))->run()), 'backups' => (new Backup($app))->list()], 'admin');
        $this->on('GET', '/admin/backups', fn() => ['backups' => (new Backup($app))->list()], 'admin');
        $this->on('POST', '/admin/seed-demo', fn() => (new DemoSeeder($app))->run(), 'admin');

        // ---------------------------------------------------------------- Trip Log (haulage) shared dataset
        $this->on('GET', '/haulage/state', function () use ($db) {
            $r = $db->one('SELECT * FROM {p}haulage_state WHERE id=1');
            return $r ? ['version' => (int)$r['version'], 'updated_at' => $r['updated_at'], 'updated_by' => $r['updated_by'], 'state' => json_decode($r['payload'], true)] : ['version' => 0, 'state' => null];
        }, 'reports.view');
        $this->on('PUT', '/haulage/state', function ($p, $b) use ($app, $db) {
            $this->need($b, ['state']);
            $cur = $db->one('SELECT version FROM {p}haulage_state WHERE id=1');
            $ver = (int)($cur['version'] ?? 0);
            if (isset($b['version']) && (int)$b['version'] !== $ver) throw new HttpException(409, 'The Trip Log was changed by another user. Reload to get the latest data.', ['version' => $ver]);
            $u = $this->user();
            if ($cur) $db->run('UPDATE {p}haulage_state SET version=?, payload=?, updated_by=?, updated_at=? WHERE id=1', [$ver + 1, json_encode($b['state']), $u['username'], $db->now()]);
            else $db->insert('haulage_state', ['id' => 1, 'version' => 1, 'payload' => json_encode($b['state']), 'updated_by' => $u['username'], 'updated_at' => $db->now()]);
            if (!empty($b['audit'])) $app->audit->log('TRIPLOG_' . ($b['audit']['action'] ?? 'CHANGE'), 'triplog', $b['audit']['id'] ?? null, $b['audit']);
            return ['version' => $ver + 1];
        }, 'haulage.edit');
    }

    private function settings(): array
    {
        $out = [];
        foreach ($this->app->db->all('SELECT * FROM {p}settings') as $r) { if ($r['skey'] === 'last_import') continue; $out[$r['skey']] = json_decode($r['svalue'], true); }
        return $out;
    }
}
