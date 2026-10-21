<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Front-end application shell: /production-planning/ (login required), admin menu and shortcode. */
class JMG_App {

	public static function init() {
		self::add_rewrite();
		add_filter( 'query_vars', function( $vars ) { $vars[] = 'jmg_app'; return $vars; } );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_render' ) );
		add_shortcode( 'jmg_production_planning', array( __CLASS__, 'shortcode' ) );
		add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ) );
		add_action( 'admin_bar_menu', array( __CLASS__, 'admin_bar' ), 90 );
		add_filter( 'login_redirect', array( __CLASS__, 'login_redirect' ), 10, 3 );
		if ( ! get_option( 'jmg_pp_rewrite_flushed' ) ) { flush_rewrite_rules(); update_option( 'jmg_pp_rewrite_flushed', 1 ); }
	}

	public static function add_rewrite() {
		add_rewrite_rule( '^production-planning/?$', 'index.php?jmg_app=1', 'top' );
	}

	public static function deactivate() { flush_rewrite_rules(); }

	public static function app_url() {
		return get_option( 'permalink_structure' ) ? home_url( '/production-planning/' ) : home_url( '/?jmg_app=1' );
	}

	public static function login_redirect( $redirect_to, $requested, $user ) {
		if ( $user instanceof WP_User && ! is_wp_error( $user ) && ( $requested === admin_url() || '' === $requested || $requested === home_url( '/wp-admin/' ) ) ) {
			foreach ( $user->roles as $r ) { if ( 0 === strpos( $r, 'jmg_' ) ) { return self::app_url(); } }
		}
		return $redirect_to;
	}

	public static function admin_menu() {
		add_menu_page( 'Production Planning', 'Production Planning', 'jmg_view', 'jmg-production-planning', array( __CLASS__, 'admin_page' ), 'dashicons-chart-area', 3 );
	}

	public static function admin_bar( $bar ) {
		if ( current_user_can( 'jmg_view' ) ) { $bar->add_node( array( 'id' => 'jmg-pp', 'title' => 'Production Planning', 'href' => self::app_url() ) ); }
	}

	public static function admin_page() {
		echo '<div class="wrap"><h1>Production Planning</h1><p>The application runs in its own full-screen interface.</p><p><a class="button button-primary" href="' . esc_url( self::app_url() ) . '">Open Production Planning</a></p>';
		$err = get_option( 'jmg_pp_import_error' );
		if ( $err ) { echo '<div class="notice notice-error"><p>Workbook import error at activation: ' . esc_html( $err ) . '</p></div>'; }
		echo '<p>Shortcode for embedding in a page: <code>[jmg_production_planning]</code></p></div>';
	}

	public static function shortcode() {
		if ( ! is_user_logged_in() || ! current_user_can( 'jmg_view' ) ) { return '<p>Please <a href="' . esc_url( wp_login_url( get_permalink() ) ) . '">log in</a> with a production planning account.</p>'; }
		self::enqueue();
		return '<div id="jmg-app" class="jmg-embedded"></div>';
	}

	public static function maybe_render() {
		if ( ! get_query_var( 'jmg_app' ) ) { return; }
		if ( ! is_user_logged_in() ) { wp_safe_redirect( wp_login_url( self::app_url() ) ); exit; }
		if ( ! current_user_can( 'jmg_view' ) ) { wp_die( 'Your account has no production planning role. Ask the administrator to assign one.', 'Production Planning', array( 'response' => 403 ) ); }
		self::enqueue();
		status_header( 200 );
		nocache_headers();
		?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Production Planning</title>
<?php wp_print_styles( array( 'jmg-pp-app' ) ); ?>
</head>
<body class="jmg-body">
<div id="jmg-app"></div>
<?php wp_print_scripts( array( 'jmg-pp-app' ) ); ?>
</body>
</html>
		<?php
		exit;
	}

	public static function enqueue() {
		wp_register_style( 'jmg-pp-app', JMG_PP_URL . 'assets/app.css', array(), JMG_PP_VERSION );
		wp_register_script( 'jmg-pp-app', JMG_PP_URL . 'assets/app.js', array(), JMG_PP_VERSION, true );
		wp_localize_script( 'jmg-pp-app', 'JMG_CONFIG', array(
			'rest' => esc_url_raw( rest_url( 'jmg/v1/' ) ), 'nonce' => wp_create_nonce( 'wp_rest' ), 'logout' => wp_logout_url( home_url( '/' ) ), 'version' => JMG_PP_VERSION,
			'assets' => JMG_PP_URL . 'assets/',
		) );
		wp_enqueue_style( 'jmg-pp-app' );
		wp_enqueue_script( 'jmg-pp-app' );
	}
}
