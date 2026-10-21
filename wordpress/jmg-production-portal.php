<?php
/**
 * Plugin Name: JMG Production Planning Portal
 * Description: Embeds the Production Planning & Manufacturing Management application in WordPress and signs WordPress users into it (single sign-on, role-mapped). Shortcode: [proland_portal] — add it to any page. Settings: Settings → Production Portal.
 * Version: 1.0.0
 * Author: Proland Manufacturing
 * License: Proprietary
 */

if (!defined('ABSPATH')) { exit; }

final class Proland_Production_Portal {
    const OPT = 'proland_portal_settings';

    public static function init() {
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('admin_init', [__CLASS__, 'settings']);
        add_shortcode('proland_portal', [__CLASS__, 'shortcode']);
        add_action('admin_post_proland_portal_sso', [__CLASS__, 'sso_redirect']);
        add_action('admin_bar_menu', [__CLASS__, 'admin_bar'], 90);
    }

    public static function defaults() {
        return [
            'app_url'      => 'https://planning.example.com',
            'secret'       => '',
            'token_ttl'    => 120,
            'height'       => '85vh',
            'sync_role'    => '1',
            // WordPress role (or capability) → application role
            'role_map'     => "administrator=ADMIN\neditor=PRODUCTION_MANAGER\nauthor=PLANNER\ncontributor=SUPERVISOR\nsubscriber=MANAGEMENT",
            'default_role' => 'MANAGEMENT',
        ];
    }
    public static function get() { return wp_parse_args(get_option(self::OPT, []), self::defaults()); }

    /* ---------------------------------------------------------------- settings page */
    public static function menu() { add_options_page('Production Portal', 'Production Portal', 'manage_options', 'proland-portal', [__CLASS__, 'page']); }
    public static function settings() {
        register_setting('proland_portal', self::OPT, ['sanitize_callback' => [__CLASS__, 'sanitize']]);
    }
    public static function sanitize($in) {
        $d = self::defaults(); $out = [];
        $out['app_url'] = esc_url_raw(rtrim($in['app_url'] ?? $d['app_url'], '/'));
        $out['secret'] = sanitize_text_field($in['secret'] ?? '');
        $out['token_ttl'] = max(30, intval($in['token_ttl'] ?? 120));
        $out['height'] = sanitize_text_field($in['height'] ?? $d['height']);
        $out['sync_role'] = empty($in['sync_role']) ? '0' : '1';
        $out['role_map'] = sanitize_textarea_field($in['role_map'] ?? $d['role_map']);
        $out['default_role'] = sanitize_text_field($in['default_role'] ?? $d['default_role']);
        return $out;
    }
    public static function page() {
        if (!current_user_can('manage_options')) { return; }
        $o = self::get(); ?>
        <div class="wrap"><h1>JMG Production Planning Portal</h1>
        <p>Point this at the Node application (see <code>docs/DEPLOYMENT.md</code> in the repository). The shared secret must equal the <code>WP_SSO_SECRET</code> environment variable of the application. Logged-in WordPress users are signed into the application with the mapped role; the application keeps its own audit trail and record-level permissions.</p>
        <form method="post" action="options.php"><?php settings_fields('proland_portal'); ?>
        <table class="form-table">
          <tr><th><label>Application URL</label></th><td><input type="url" class="regular-text" name="<?php echo self::OPT; ?>[app_url]" value="<?php echo esc_attr($o['app_url']); ?>" required></td></tr>
          <tr><th><label>Shared secret (WP_SSO_SECRET)</label></th><td><input type="password" class="regular-text" name="<?php echo self::OPT; ?>[secret]" value="<?php echo esc_attr($o['secret']); ?>" autocomplete="new-password"> <p class="description">At least 32 random characters.</p></td></tr>
          <tr><th><label>Token lifetime (seconds)</label></th><td><input type="number" min="30" name="<?php echo self::OPT; ?>[token_ttl]" value="<?php echo esc_attr($o['token_ttl']); ?>"></td></tr>
          <tr><th><label>Embed height</label></th><td><input type="text" name="<?php echo self::OPT; ?>[height]" value="<?php echo esc_attr($o['height']); ?>"></td></tr>
          <tr><th><label>Role mapping</label></th><td><textarea class="large-text code" rows="7" name="<?php echo self::OPT; ?>[role_map]"><?php echo esc_textarea($o['role_map']); ?></textarea><p class="description">One <code>wordpress_role=APP_ROLE</code> per line. Application roles: SALES, PLANNER, PRODUCTION_MANAGER, SUPERVISOR, STORE, COST_ACCOUNTANT, MANAGEMENT, ADMIN. You can also create custom WordPress roles named e.g. <code>proland_sales</code> and map them here.</p></td></tr>
          <tr><th><label>Default application role</label></th><td><input type="text" name="<?php echo self::OPT; ?>[default_role]" value="<?php echo esc_attr($o['default_role']); ?>"></td></tr>
          <tr><th><label>Keep application role in sync with WordPress</label></th><td><label><input type="checkbox" name="<?php echo self::OPT; ?>[sync_role]" value="1" <?php checked($o['sync_role'], '1'); ?>> Update the application role on every sign-on</label></td></tr>
        </table><?php submit_button(); ?></form>
        <h2>Usage</h2><ol><li>Create a page and add the shortcode <code>[proland_portal]</code> (optionally <code>[proland_portal view="/sections"]</code> or <code>mode="button"</code>).</li><li>Restrict the page to logged-in users with your membership plugin or <code>[proland_portal]</code> shows a login prompt for guests.</li></ol>
        </div><?php
    }

    /* ---------------------------------------------------------------- SSO token */
    public static function app_role_for(WP_User $user) {
        $o = self::get(); $map = [];
        foreach (preg_split('/\r?\n/', $o['role_map']) as $line) {
            if (strpos($line, '=') === false) { continue; }
            [$wp, $app] = array_map('trim', explode('=', $line, 2));
            if ($wp !== '') { $map[strtolower($wp)] = strtoupper($app); }
        }
        foreach ((array) $user->roles as $r) { if (isset($map[strtolower($r)])) { return $map[strtolower($r)]; } }
        return strtoupper($o['default_role']);
    }
    public static function token_for(WP_User $user, $redirect = '/') {
        $o = self::get();
        if ($o['secret'] === '') { return new WP_Error('no_secret', 'Shared secret not configured'); }
        $payload = [
            'username'   => sanitize_user($user->user_login, true),
            'name'       => $user->display_name,
            'email'      => $user->user_email,
            'role'       => self::app_role_for($user),
            'wp_user_id' => (string) $user->ID,
            'sync_role'  => $o['sync_role'] === '1',
            'redirect'   => $redirect,
            'iat'        => time(),
            'exp'        => time() + intval($o['token_ttl']),
        ];
        $body = self::b64(wp_json_encode($payload));
        $sig = self::b64(hash_hmac('sha256', $body, $o['secret'], true));
        return $body . '.' . $sig;
    }
    private static function b64($bin) { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }

    public static function sso_url($redirect = '/') {
        $o = self::get(); $u = wp_get_current_user();
        if (!$u || !$u->exists()) { return null; }
        $t = self::token_for($u, $redirect);
        if (is_wp_error($t)) { return null; }
        return $o['app_url'] . '/sso?token=' . rawurlencode($t);
    }
    /** admin-post.php?action=proland_portal_sso&view=/plans — opens the app signed in (used by the admin bar link). */
    public static function sso_redirect() {
        if (!is_user_logged_in()) { auth_redirect(); }
        check_admin_referer('proland_portal_sso');
        $view = isset($_GET['view']) ? sanitize_text_field(wp_unslash($_GET['view'])) : '/';
        $url = self::sso_url($view);
        if (!$url) { wp_die('Production portal is not configured (missing shared secret).'); }
        wp_redirect($url); exit;
    }
    public static function admin_bar($bar) {
        if (!is_user_logged_in() || self::get()['secret'] === '') { return; }
        $bar->add_node(['id' => 'proland-portal', 'title' => 'Production Planning', 'href' => wp_nonce_url(admin_url('admin-post.php?action=proland_portal_sso'), 'proland_portal_sso'), 'meta' => ['target' => '_blank']]);
    }

    /* ---------------------------------------------------------------- shortcode */
    public static function shortcode($atts) {
        $a = shortcode_atts(['view' => '/', 'mode' => 'embed', 'label' => 'Open Production Planning'], $atts, 'proland_portal');
        if (!is_user_logged_in()) {
            return '<div class="proland-portal-login"><p>Please <a href="' . esc_url(wp_login_url(get_permalink())) . '">sign in</a> to open the production planning application.</p></div>';
        }
        $url = self::sso_url($a['view']);
        if (!$url) { return '<p><em>Production portal is not configured. Set the shared secret under Settings → Production Portal.</em></p>'; }
        if ($a['mode'] === 'button') {
            return '<p><a class="button button-primary proland-portal-button" target="_blank" rel="noopener" href="' . esc_url($url) . '">' . esc_html($a['label']) . '</a></p>';
        }
        $h = esc_attr(self::get()['height']);
        return '<div class="proland-portal-embed" style="width:100%;height:' . $h . ';border:1px solid #ddd;border-radius:8px;overflow:hidden"><iframe src="' . esc_url($url) . '" style="width:100%;height:100%;border:0" allow="clipboard-write" title="Production Planning"></iframe></div>'
             . '<p style="font-size:.85em"><a target="_blank" rel="noopener" href="' . esc_url($url) . '">Open in a new tab</a></p>';
    }
}
Proland_Production_Portal::init();
