<?php
final class Audit
{
    public function __construct(private App $app) {}

    public function log(string $action, string $entity, $entityId = null, $details = null, ?array $user = null): void
    {
        $user = $user ?? $this->app->auth->currentUser();
        $this->app->db->insert('audit_log', [
            'user_id' => $user['id'] ?? null,
            'username' => $user['username'] ?? 'system',
            'action' => $action,
            'entity' => $entity,
            'entity_id' => $entityId === null ? null : (string)$entityId,
            'details' => $details === null ? null : (is_string($details) ? $details : json_encode($details)),
            'created_at' => $this->app->db->now(),
        ]);
    }

    public function recent(int $limit = 200, ?string $entity = null, ?string $entityId = null): array
    {
        $w = []; $p = [];
        if ($entity) { $w[] = 'entity=?'; $p[] = $entity; }
        if ($entityId) { $w[] = 'entity_id=?'; $p[] = $entityId; }
        $sql = 'SELECT * FROM {p}audit_log' . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . ' ORDER BY id DESC LIMIT ' . (int)$limit;
        return $this->app->db->all($sql, $p);
    }
}
