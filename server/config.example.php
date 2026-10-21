<?php
/**
 * Copy to config.php and adjust. Environment variables override these values (PP_DB_DRIVER, PP_DB_HOST,
 * PP_DB_NAME, PP_DB_USER, PP_DB_PASSWORD, PP_DB_PREFIX, PP_SQLITE_PATH, PP_BASE_URL, PP_SECRET).
 */
return [
    'db' => [
        'driver' => 'sqlite',                       // sqlite | mysql
        'sqlite_path' => __DIR__ . '/data/production.sqlite',
        'host' => '127.0.0.1', 'port' => 3306,
        'database' => 'proland_production', 'user' => 'proland', 'password' => 'change-me',
        'prefix' => 'pp_',
    ],
    'app' => [
        'name' => 'Proland Production Planning',
        'base_url' => '',                            // e.g. https://planning.example.com (used in links / exports)
        'session_hours' => 12,
        'cookie_secure' => null,                     // null = auto (secure when the request is HTTPS)
        'workbook' => __DIR__ . '/../data/Prodction_Data.xlsx',
        'backup_dir' => __DIR__ . '/data/backups',
        'cost_outdated_months' => 12,                // costs older than this are flagged OUTDATED
    ],
];
