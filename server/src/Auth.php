<?php
/**
 * Auth — users, roles and permissions.
 * Standalone mode: own users table + token cookie. WordPress mode: the plugin maps the logged-in WP user
 * (see wordpress/proland-production) onto an app user with the same username and a role derived from WP roles.
 */
final class Auth
{
    public const ROLES = [
        'ADMIN' => 'Administrator',
        'SALES' => 'Sales',
        'PLANNER' => 'Production Planner',
        'PROD_MANAGER' => 'Production Manager',
        'SUPERVISOR' => 'Section Supervisor',
        'STORE' => 'Store Officer',
        'COST_ACCOUNTANT' => 'Cost Accountant',
        'MANAGEMENT' => 'Management',
    ];

    /** Permission → roles allowed. ADMIN always allowed. */
    public const PERMS = [
        'sales.create' => ['SALES', 'PLANNER'],
        'sales.edit' => ['SALES', 'PLANNER'],
        'plan.generate' => ['PLANNER', 'PROD_MANAGER'],
        'plan.approve' => ['PLANNER', 'PROD_MANAGER'],
        'plan.adjust' => ['PLANNER', 'PROD_MANAGER'],
        'production.report' => ['SUPERVISOR', 'PROD_MANAGER', 'PLANNER'],
        'inventory.move' => ['STORE', 'PROD_MANAGER'],
        'cost.edit' => ['COST_ACCOUNTANT'],
        'cost.view' => ['COST_ACCOUNTANT', 'MANAGEMENT', 'PLANNER', 'PROD_MANAGER'],
        'reports.view' => ['MANAGEMENT', 'PROD_MANAGER', 'PLANNER', 'COST_ACCOUNTANT', 'SALES', 'STORE', 'SUPERVISOR'],
        'capacity.edit' => ['PLANNER', 'PROD_MANAGER'],
        'exceptions.review' => ['PLANNER', 'PROD_MANAGER', 'COST_ACCOUNTANT'],
        'haulage.edit' => ['SALES', 'MANAGEMENT', 'PLANNER', 'STORE'],
        'haulage.approve' => ['MANAGEMENT'],
        'admin' => [],
    ];

    private ?array $user = null;
    private bool $resolved = false;

    public function __construct(private App $app) {}

    public function hashPassword(string $p): string { return password_hash($p, PASSWORD_DEFAULT); }

    public function createUser(string $username, string $password, string $displayName, string $role, ?string $email = null, ?int $sectionId = null): int
    {
        if (!isset(self::ROLES[$role])) throw new InvalidArgumentException("Unknown role $role");
        return $this->app->db->insert('users', [
            'username' => strtolower(trim($username)), 'password_hash' => $this->hashPassword($password), 'display_name' => $displayName,
            'email' => $email, 'role' => $role, 'section_id' => $sectionId, 'active' => 1, 'created_at' => $this->app->db->now(),
        ]);
    }

    public function login(string $username, string $password): ?array
    {
        $u = $this->app->db->one('SELECT * FROM {p}users WHERE username=? AND active=1', [strtolower(trim($username))]);
        if (!$u || !password_verify($password, $u['password_hash'])) return null;
        $token = bin2hex(random_bytes(32));
        $hours = (int)($this->app->cfg['app']['session_hours'] ?? 12);
        $this->app->db->insert('sessions', ['token' => hash('sha256', $token), 'user_id' => $u['id'], 'expires_at' => gmdate('Y-m-d H:i:s', time() + $hours * 3600), 'created_at' => $this->app->db->now()]);
        $this->app->db->run('UPDATE {p}users SET last_login=? WHERE id=?', [$this->app->db->now(), $u['id']]);
        $this->app->db->run('DELETE FROM {p}sessions WHERE expires_at < ?', [$this->app->db->now()]);
        $this->user = $u; $this->resolved = true;
        $this->app->audit->log('LOGIN', 'user', $u['id'], null, $u);
        return ['token' => $token, 'user' => $this->publicUser($u)];
    }

    public function logout(string $token): void
    {
        $this->app->db->run('DELETE FROM {p}sessions WHERE token=?', [hash('sha256', $token)]);
    }

    public function userFromToken(?string $token): ?array
    {
        if (!$token) return null;
        $u = $this->app->db->one('SELECT u.* FROM {p}sessions s JOIN {p}users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>=? AND u.active=1', [hash('sha256', $token), $this->app->db->now()]);
        return $u ?: null;
    }

    /** Used by the WordPress bridge: trust an externally authenticated username, creating the app user if needed. */
    public function assumeUser(string $username, string $displayName, string $role, ?int $wpUserId = null): array
    {
        $u = $this->app->db->one('SELECT * FROM {p}users WHERE username=?', [strtolower($username)]);
        if (!$u) {
            $id = $this->createUser($username, bin2hex(random_bytes(8)), $displayName, $role);
            $this->app->db->run('UPDATE {p}users SET wp_user_id=? WHERE id=?', [$wpUserId, $id]);
            $u = $this->app->db->one('SELECT * FROM {p}users WHERE id=?', [$id]);
        } elseif ($u['role'] !== $role || $u['display_name'] !== $displayName) {
            $this->app->db->run('UPDATE {p}users SET role=?, display_name=?, wp_user_id=? WHERE id=?', [$role, $displayName, $wpUserId, $u['id']]);
            $u['role'] = $role; $u['display_name'] = $displayName;
        }
        $this->user = $u; $this->resolved = true;
        return $u;
    }

    public function setCurrentUser(?array $u): void { $this->user = $u; $this->resolved = true; }

    public function currentUser(): ?array
    {
        if (!$this->resolved) {
            $this->resolved = true;
            $token = $_COOKIE['pp_session'] ?? null;
            if (!$token && isset($_SERVER['HTTP_AUTHORIZATION']) && preg_match('/Bearer\s+(\S+)/', $_SERVER['HTTP_AUTHORIZATION'], $m)) $token = $m[1];
            $this->user = $this->userFromToken($token);
        }
        return $this->user;
    }

    public function can(string $perm, ?array $user = null): bool
    {
        $user = $user ?? $this->currentUser();
        if (!$user) return false;
        if ($user['role'] === 'ADMIN') return true;
        if (!isset(self::PERMS[$perm])) return false;
        return in_array($user['role'], self::PERMS[$perm], true);
    }

    public function require(string $perm): array
    {
        $u = $this->currentUser();
        if (!$u) throw new HttpException(401, 'Please sign in');
        if (!$this->can($perm, $u)) throw new HttpException(403, 'Your role (' . (self::ROLES[$u['role']] ?? $u['role']) . ') is not permitted to do this');
        return $u;
    }

    public function publicUser(array $u): array
    {
        $perms = [];
        foreach (array_keys(self::PERMS) as $p) if ($this->can($p, $u)) $perms[] = $p;
        return ['id' => (int)$u['id'], 'username' => $u['username'], 'display_name' => $u['display_name'], 'role' => $u['role'],
            'role_name' => self::ROLES[$u['role']] ?? $u['role'], 'section_id' => $u['section_id'] ? (int)$u['section_id'] : null, 'email' => $u['email'], 'perms' => $perms];
    }
}

final class HttpException extends RuntimeException
{
    public function __construct(public int $status, string $message, public $extra = null) { parent::__construct($message, $status); }
}
