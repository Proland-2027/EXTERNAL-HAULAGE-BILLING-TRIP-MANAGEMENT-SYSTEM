<?php
/** Backup — JSON dump of every application table (+ a copy of the SQLite file when applicable). Scheduled through cron / WP-Cron. */
final class Backup
{
    public function __construct(private App $app) {}

    public function run(): string
    {
        $dir = $this->app->cfg['app']['backup_dir'];
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $stamp = gmdate('Ymd-His');
        $db = $this->app->db;
        $tables = ['settings', 'users', 'audit_log', 'sections', 'resources', 'items', 'bom_rows', 'item_cost_history', 'capacity_rates', 'machines', 'cutting_capacity', 'cutting_files', 'calendar', 'cost_rates',
            'sales_requests', 'plans', 'orders', 'order_deps', 'operations', 'op_loads', 'op_deps', 'materials', 'daily_reports', 'inventory_movements', 'exceptions', 'haulage_state'];
        $file = "$dir/backup-$stamp.json.gz";
        $gz = gzopen($file, 'w6');
        gzwrite($gz, '{"created_at":"' . $db->now() . '","driver":"' . $db->driver . '","tables":{');
        $first = true;
        foreach ($tables as $t) {
            gzwrite($gz, ($first ? '' : ',') . json_encode($t) . ':[');
            $first = false;
            $st = $db->run("SELECT * FROM {p}$t");
            $rowFirst = true;
            while ($row = $st->fetch()) { if ($t === 'users') unset($row['password_hash']); gzwrite($gz, ($rowFirst ? '' : ',') . json_encode($row)); $rowFirst = false; }
            gzwrite($gz, ']');
        }
        gzwrite($gz, '}}');
        gzclose($gz);
        if ($db->driver === 'sqlite') { $src = $this->app->cfg['db']['sqlite_path']; if (is_file($src)) { $db->pdo->exec('PRAGMA wal_checkpoint(TRUNCATE)'); copy($src, "$dir/production-$stamp.sqlite"); } }
        // keep the newest 30 backups
        $files = glob("$dir/backup-*.json.gz"); sort($files);
        foreach (array_slice($files, 0, max(0, count($files) - 30)) as $old) @unlink($old);
        $this->app->audit->log('BACKUP', 'system', null, ['file' => basename($file)]);
        return $file;
    }

    public function list(): array
    {
        $dir = $this->app->cfg['app']['backup_dir'];
        $out = [];
        foreach (glob("$dir/backup-*.json.gz") ?: [] as $f) $out[] = ['file' => basename($f), 'size' => filesize($f), 'created' => gmdate('Y-m-d H:i:s', filemtime($f))];
        usort($out, fn($a, $b) => strcmp($b['file'], $a['file']));
        return $out;
    }
}
