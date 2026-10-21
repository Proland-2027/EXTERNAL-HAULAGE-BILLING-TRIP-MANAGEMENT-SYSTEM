<?php
/**
 * Serves the application at /production-planning/ (login required).
 */
class PP_Frontend {

	public static function init() {
		add_rewrite_rule( '^' . PP_APP_SLUG . '/?$', 'index.php?pp_app=1', 'top' );
		add_rewrite_tag( '%pp_app%', '1' );
		add_action( 'template_redirect', array( __CLASS__, 'maybe_render' ) );
		if ( get_transient( 'pp_activated' ) ) {
			delete_transient( 'pp_activated' );
			flush_rewrite_rules();
		}
	}

	public static function app_url() {
		return home_url( '/' . PP_APP_SLUG . '/' );
	}

	public static function maybe_render() {
		$is_app = get_query_var( 'pp_app' ) || ( isset( $_GET['pp_app'] ) && '1' === $_GET['pp_app'] ) || preg_match( '#^/' . PP_APP_SLUG . '/?($|\?)#', $_SERVER['REQUEST_URI'] ?? '' );
		if ( ! $is_app ) {
			return;
		}
		if ( ! is_user_logged_in() ) {
			wp_safe_redirect( wp_login_url( self::app_url() ) );
			exit;
		}
		if ( ! current_user_can( 'pp_view' ) ) {
			wp_die( 'Your account has no Production Planning role. Ask an administrator to assign one (Sales, Production Planner, Department Supervisor, Production Manager, Costing / Finance).', 'Production Planning', array( 'response' => 403 ) );
		}
		nocache_headers();
		status_header( 200 );
		include PP_PLUGIN_DIR . 'templates/app.php';
		exit;
	}

	public static function admin_menu() {
		add_menu_page( 'Production Planning', 'Production Planning', 'pp_view', 'production-planning', array( __CLASS__, 'admin_page' ), 'dashicons-chart-area', 3 );
	}

	public static function admin_page() {
		echo '<div class="wrap"><h1>Production Planning</h1><p><a class="button button-primary" href="' . esc_url( self::app_url() ) . '">Open the application</a></p>';
		echo '<p>Shareable link for the team: <code>' . esc_html( self::app_url() ) . '</code></p>';
		echo '<p>Last workbook import: ' . esc_html( get_option( 'pp_last_import', 'never' ) ) . '</p>';
		$err = get_option( 'pp_import_error' );
		if ( $err ) {
			echo '<div class="notice notice-error"><p>Import error: ' . esc_html( $err ) . '</p></div>';
		}
		echo '</div>';
	}

	public static function admin_bar( $bar ) {
		if ( current_user_can( 'pp_view' ) ) {
			$bar->add_node( array( 'id' => 'pp-app', 'title' => 'Production Planning', 'href' => self::app_url() ) );
		}
	}

	/** Send planning roles straight into the application after login. */
	public static function login_redirect( $redirect_to, $requested, $user ) {
		if ( $user instanceof WP_User && user_can( $user, 'pp_view' ) && ! user_can( $user, 'manage_options' ) ) {
			if ( empty( $requested ) || admin_url() === $requested || false !== strpos( $requested, 'wp-admin' ) ) {
				return self::app_url();
			}
		}
		return $redirect_to;
	}
}
