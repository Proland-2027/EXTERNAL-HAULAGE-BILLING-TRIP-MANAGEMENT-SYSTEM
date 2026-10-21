<?php
/**
 * Plugin Name: Proland Production Planning
 * Description: Integrated production planning, manufacturing tracking, BOM costing and Trip Log client-rate comparison for gensets and canopies. Uses the WordPress database and WordPress users; add the [proland_production] shortcode to a page or open Production Planning in the admin menu.
 * Version: 1.0.0
 * Requires PHP: 8.1
 * Author: Proland
 */
if (!defined('ABSPATH')) exit;

define('PROLAND_PP_DIR', __DIR__);
define('PROLAND_PP_URL', plugin_dir_url(__FILE__));

require_once PROLAND_PP_DIR . '/server/src/App.php';

/** WordPress role → application role. Edit to match your site's roles (or assign the pp_* capabilities). */
function proland_pp_role(WP_User $u): ?string
{
    $map = ['administrator' => 'ADMIN', 'pp_sales' => 'SALES', 'pp_planner' => 'PLANNER', 'pp_prod_manager' => 'PROD_MANAGER', 'pp_supervisor' => 'SUPERVISOR', 'pp_store' => 'STORE', 'pp_cost_accountant' => 'COST_ACCOUNTANT', 'pp_management' => 'MANAGEMENT', 'editor' => 'PROD_MANAGER', 'author' => 'SALES', 'subscriber' => 'MANAGEMENT'];
    foreach ($u->roles as $r) if (isset($map[$r])) return $map[$r];
    return null;
}

function proland_pp_app(): App
{
    static $app = null;
    if ($app) return $app;
    global $wpdb;
    $host = DB_HOST; $port = 3306;
    if (str_contains($host, ':')) { [$host, $port] = explode(':', $host, 2); }
    $cfg = App::loadConfig();
    $cfg['db'] = ['driver' => 'mysql', 'host' => $host, 'port' => (int)$port, 'database' => DB_NAME, 'user' => DB_USER, 'password' => DB_PASSWORD, 'prefix' => $wpdb->prefix . 'pp_'];
    $cfg['app']['workbook'] = PROLAND_PP_DIR . '/data/Prodction_Data.xlsx';
    $cfg['app']['backup_dir'] = WP_CONTENT_DIR . '/uploads/proland-pp-backups';
    $cfg['app']['base_url'] = home_url();
    $app = new App($cfg);
    if (!$app->db->tableExists('users')) $app->migrate();
    $wpUser = wp_get_current_user();
    if ($wpUser && $wpUser->ID) {
        $role = proland_pp_role($wpUser);
        if ($role) $app->auth->assumeUser($wpUser->user_login, $wpUser->display_name ?: $wpUser->user_login, $role, (int)$wpUser->ID);
        else $app->auth->setCurrentUser(null);
    } else $app->auth->setCurrentUser(null);
    return $app;
}

// ---------------------------------------------------------------- activation: tables, roles, import, cron
register_activation_hook(__FILE__, function () {
    foreach (['pp_sales' => 'Sales', 'pp_planner' => 'Production Planner', 'pp_prod_manager' => 'Production Manager', 'pp_supervisor' => 'Section Supervisor', 'pp_store' => 'Store Officer', 'pp_cost_accountant' => 'Cost Accountant', 'pp_management' => 'Management'] as $slug => $name) {
        if (!get_role($slug)) add_role($slug, $name, ['read' => true]);
    }
    $app = proland_pp_app();
    $app->migrate();
    if (!$app->db->val('SELECT COUNT(*) FROM {p}bom_rows')) { @set_time_limit(300); $app->importer->import(); }
    if (!wp_next_scheduled('proland_pp_daily_backup')) wp_schedule_event(time() + 3600, 'daily', 'proland_pp_daily_backup');
});
register_deactivation_hook(__FILE__, fn() => wp_clear_scheduled_hook('proland_pp_daily_backup'));
add_action('proland_pp_daily_backup', fn() => (new Backup(proland_pp_app()))->run());

// ---------------------------------------------------------------- REST API: /wp-json/proland/v1/...
add_action('rest_api_init', function () {
    register_rest_route('proland/v1', '/(?P<path>.*)', [
        'methods' => ['GET', 'POST', 'PUT', 'DELETE'],
        'permission_callback' => '__return_true', // the application enforces its own role permissions
        'callback' => function (WP_REST_Request $req) {
            $app = proland_pp_app();
            $path = '/' . $req->get_param('path');
            $body = $req->get_json_params() ?: $req->get_body_params();
            $query = $req->get_query_params(); unset($query['path'], $query['_wpnonce']);
            if ($path === '/auth/login') return new WP_REST_Response(['error' => 'Sign in through WordPress'], 400);
            if ($path === '/auth/logout') { wp_logout(); return new WP_REST_Response(['ok' => true, 'redirect' => wp_login_url()], 200); }
            [$status, $payload] = (new Api($app))->dispatch($req->get_method(), $path, $query, is_array($body) ? $body : []);
            return new WP_REST_Response($payload, $status);
        },
    ]);
});

// ---------------------------------------------------------------- front-end: shortcode + admin page
function proland_pp_render(string $which = 'app'): string
{
    if (!is_user_logged_in()) return '<p>Please <a href="' . esc_url(wp_login_url(get_permalink())) . '">sign in</a> to use the production planning system.</p>';
    if (!proland_pp_role(wp_get_current_user())) return '<p>Your WordPress account has no production planning role. Ask an administrator to assign one (Sales, Production Planner, Production Manager, Section Supervisor, Store Officer, Cost Accountant, Management).</p>';
    $base = PROLAND_PP_URL . ($which === 'haulage' ? 'haulage/' : 'app/');
    $html = file_get_contents(PROLAND_PP_DIR . ($which === 'haulage' ? '/haulage/index.html' : '/app/index.html'));
    // rewrite root-relative asset paths to the plugin folder and inject the API base + nonce
    $html = preg_replace('#(src|href)="/(js|css)/#', '$1="' . $base . '$2/', $html);
    $html = str_replace(['src="js/', 'href="css/'], ['src="' . $base . 'js/', 'href="' . $base . 'css/'], $html);
    $inject = '<script>window.PP_API_BASE=' . json_encode(rest_url('proland/v1')) . ';window.PP_WP_NONCE=' . json_encode(wp_create_nonce('wp_rest')) . ';window.PP_HAULAGE_URL=' . json_encode(add_query_arg('pp', 'haulage')) . ';window.PP_DOCS_URL=' . json_encode(PROLAND_PP_URL . 'docs/USER_GUIDE.md') . ';</script>';
    $html = str_replace('</head>', $inject . '</head>', $html);
    // the app owns the whole page: render it in an iframe-free full page by replacing the WordPress output
    return '<div id="proland-pp-root" style="margin:-1rem">' . preg_replace('#^.*?<body[^>]*>|</body>.*$#s', '', $html) . '</div>';
}
add_shortcode('proland_production', fn($atts) => proland_pp_render(($atts['app'] ?? '') === 'haulage' || ($_GET['pp'] ?? '') === 'haulage' ? 'haulage' : 'app'));

add_action('admin_menu', function () {
    add_menu_page('Production Planning', 'Production Planning', 'read', 'proland-production', function () { echo '<div class="wrap">'; echo proland_pp_render(($_GET['pp'] ?? '') === 'haulage' ? 'haulage' : 'app'); echo '</div>'; }, 'dashicons-chart-bar', 3);
    add_submenu_page('proland-production', 'Trip Log', 'Trip Log', 'read', 'proland-production&pp=haulage', '__return_null');
});

// Serve the bundled application assets (the plugin folder is web-accessible, nothing else is needed), but block the engine sources.
add_action('init', function () { if (isset($_GET['proland_pp_backup']) && current_user_can('administrator')) { echo esc_html((new Backup(proland_pp_app()))->run()); exit; } });
