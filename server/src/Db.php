<?php
/**
 * Db — thin PDO wrapper that runs the same schema and queries on SQLite (development / demo)
 * and MySQL / MariaDB (production, including a WordPress host's database).
 *
 * Portable SQL rules used throughout the application:
 *   - placeholders only (`?`), never string-interpolated values
 *   - `{p}` is replaced by the configured table prefix (default `pp_`)
 *   - DDL uses the pseudo-types AUTOINC, TEXT, DATETIME, BOOL which are translated per driver
 */
final class Db
{
    public PDO $pdo;
    public string $driver;
    public string $prefix;

    public function __construct(array $cfg)
    {
        $this->driver = $cfg['driver'] ?? 'sqlite';
        $this->prefix = $cfg['prefix'] ?? 'pp_';
        if ($this->driver === 'sqlite') {
            $path = $cfg['sqlite_path'];
            $dir = dirname($path);
            if (!is_dir($dir)) mkdir($dir, 0775, true);
            $this->pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $this->pdo->exec('PRAGMA journal_mode=WAL');
            $this->pdo->exec('PRAGMA foreign_keys=ON');
            $this->pdo->exec('PRAGMA busy_timeout=10000');
            $this->pdo->sqliteCreateFunction('CEILX', fn($v) => (float)ceil((float)$v), 1);
        } else {
            $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $cfg['host'] ?? '127.0.0.1', (int)($cfg['port'] ?? 3306), $cfg['database']);
            $this->pdo = new PDO($dsn, $cfg['user'], $cfg['password'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET sql_mode='STRICT_ALL_TABLES', time_zone='+00:00'",
            ]);
        }
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    }

    public function sql(string $sql): string
    {
        return str_replace('{p}', $this->prefix, $sql);
    }

    public function run(string $sql, array $params = []): PDOStatement
    {
        $st = $this->pdo->prepare($this->sql($sql));
        $st->execute(array_values($params));
        return $st;
    }

    public function all(string $sql, array $params = []): array { return $this->run($sql, $params)->fetchAll(); }
    public function one(string $sql, array $params = []): ?array { $r = $this->run($sql, $params)->fetch(); return $r === false ? null : $r; }
    public function val(string $sql, array $params = []) { $r = $this->run($sql, $params)->fetch(PDO::FETCH_NUM); return $r === false ? null : $r[0]; }

    public function insert(string $table, array $row): int
    {
        $cols = array_keys($row);
        $sql = sprintf('INSERT INTO {p}%s (%s) VALUES (%s)', $table, implode(',', array_map(fn($c) => $this->q($c), $cols)), implode(',', array_fill(0, count($cols), '?')));
        $this->run($sql, $row);
        return (int)$this->pdo->lastInsertId();
    }

    public function update(string $table, array $row, string $where, array $params = []): int
    {
        $sets = implode(',', array_map(fn($c) => $this->q($c) . '=?', array_keys($row)));
        return $this->run(sprintf('UPDATE {p}%s SET %s WHERE %s', $table, $sets, $where), array_merge(array_values($row), $params))->rowCount();
    }

    /** Insert many rows in one prepared statement, chunked. Rows must share the same keys. */
    public function insertMany(string $table, array $rows, int $chunk = 500): void
    {
        if (!$rows) return;
        $cols = array_keys($rows[0]);
        $colSql = implode(',', array_map(fn($c) => $this->q($c), $cols));
        $one = '(' . implode(',', array_fill(0, count($cols), '?')) . ')';
        foreach (array_chunk($rows, $chunk) as $part) {
            $sql = sprintf('INSERT INTO {p}%s (%s) VALUES %s', $table, $colSql, implode(',', array_fill(0, count($part), $one)));
            $params = [];
            foreach ($part as $r) foreach ($cols as $c) $params[] = $r[$c] ?? null;
            $this->run($sql, $params);
        }
    }

    public function q(string $ident): string { return $this->driver === 'sqlite' ? '"' . $ident . '"' : '`' . $ident . '`'; }

    public function begin(): void { if (!$this->pdo->inTransaction()) $this->pdo->beginTransaction(); }
    public function commit(): void { if ($this->pdo->inTransaction()) $this->pdo->commit(); }
    public function rollback(): void { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); }

    public function transaction(callable $fn)
    {
        $outer = $this->pdo->inTransaction();
        if (!$outer) $this->pdo->beginTransaction();
        try { $r = $fn($this); if (!$outer) $this->pdo->commit(); return $r; }
        catch (Throwable $e) { if (!$outer && $this->pdo->inTransaction()) $this->pdo->rollBack(); throw $e; }
    }

    public function now(): string { return gmdate('Y-m-d H:i:s'); }

    /** Run the DDL in schema.sql, translating pseudo-types for the current driver. */
    public function migrate(string $schemaFile): void
    {
        $ddl = file_get_contents($schemaFile);
        $ddl = $this->sql($ddl);
        if ($this->driver === 'sqlite') {
            $ddl = str_replace(['AUTOINC', ' DATETIME', ' BOOL', ' LONGTXT', ' DOUBLE'], ['INTEGER PRIMARY KEY AUTOINCREMENT', ' TEXT', ' INTEGER', ' TEXT', ' REAL'], $ddl);
            $ddl = preg_replace('/ ENGINE=InnoDB[^;]*/', '', $ddl);
        } else {
            $ddl = str_replace(' LONGTXT', ' LONGTEXT', $ddl); // explicit long text columns (JSON, remarks)
            $ddl = str_replace(['AUTOINC', ' TEXT NOT NULL', ' TEXT'], ['BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY', ' VARCHAR(190) NOT NULL', ' VARCHAR(190)'], $ddl);
        }
        $ddl = preg_replace('/--[^\n]*/', '', $ddl); // strip comments before splitting statements
        foreach (array_filter(array_map('trim', explode(';', $ddl))) as $stmt) {
            if ($stmt === '') continue;
            $this->pdo->exec($stmt);
        }
    }

    public function tableExists(string $table): bool
    {
        $t = $this->prefix . $table;
        if ($this->driver === 'sqlite') return (bool)$this->val("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", [$t]);
        return (bool)$this->val('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [$t]);
    }
}
