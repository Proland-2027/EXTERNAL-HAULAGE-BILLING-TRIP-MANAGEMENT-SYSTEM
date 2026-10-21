<?php
/** App — configuration + service container. One instance per request / CLI run. */
final class App
{
    public array $cfg;
    public Db $db;
    private array $services = [];

    public function __construct(?array $cfg = null)
    {
        $this->cfg = $cfg ?? self::loadConfig();
        $this->db = new Db($this->cfg['db']);
    }

    public static function loadConfig(): array
    {
        $base = dirname(__DIR__);
        $cfg = file_exists($base . '/config.php') ? require $base . '/config.php' : require $base . '/config.example.php';
        $env = fn(string $k, $d = null) => ($v = getenv($k)) !== false && $v !== '' ? $v : $d;
        $cfg['db']['driver'] = $env('PP_DB_DRIVER', $cfg['db']['driver']);
        $cfg['db']['host'] = $env('PP_DB_HOST', $cfg['db']['host']);
        $cfg['db']['port'] = (int)$env('PP_DB_PORT', $cfg['db']['port']);
        $cfg['db']['database'] = $env('PP_DB_NAME', $cfg['db']['database']);
        $cfg['db']['user'] = $env('PP_DB_USER', $cfg['db']['user']);
        $cfg['db']['password'] = $env('PP_DB_PASSWORD', $cfg['db']['password']);
        $cfg['db']['prefix'] = $env('PP_DB_PREFIX', $cfg['db']['prefix']);
        $cfg['db']['sqlite_path'] = $env('PP_SQLITE_PATH', $cfg['db']['sqlite_path']);
        $cfg['app']['base_url'] = $env('PP_BASE_URL', $cfg['app']['base_url']);
        $cfg['app']['workbook'] = $env('PP_WORKBOOK', $cfg['app']['workbook']);
        return $cfg;
    }

    public function migrate(): void
    {
        $this->db->migrate(dirname(__DIR__) . '/schema/schema.sql');
        if (!$this->db->val('SELECT COUNT(*) FROM {p}sections')) (new Seeder($this))->seedMasterData();
    }

    public function setting(string $key, $default = null)
    {
        $v = $this->db->val('SELECT svalue FROM {p}settings WHERE skey=?', [$key]);
        if ($v === null) return $default;
        $d = json_decode($v, true);
        return $d === null && $v !== 'null' ? $v : $d;
    }

    public function setSetting(string $key, $value): void
    {
        $json = json_encode($value);
        if ($this->db->val('SELECT COUNT(*) FROM {p}settings WHERE skey=?', [$key])) $this->db->run('UPDATE {p}settings SET svalue=? WHERE skey=?', [$json, $key]);
        else $this->db->insert('settings', ['skey' => $key, 'svalue' => $json]);
    }

    public function __get(string $name)
    {
        if (!isset($this->services[$name])) {
            $map = ['auth' => Auth::class, 'audit' => Audit::class, 'importer' => Importer::class, 'planner' => Planner::class,
                'costing' => Costing::class, 'inventory' => Inventory::class, 'reports' => Reports::class, 'seeder' => Seeder::class, 'calendar' => Calendar::class];
            if (!isset($map[$name])) throw new RuntimeException("Unknown service $name");
            $this->services[$name] = new $map[$name]($this);
        }
        return $this->services[$name];
    }
}

spl_autoload_register(function (string $class) {
    $f = __DIR__ . '/' . $class . '.php';
    if (is_file($f)) require $f;
});
