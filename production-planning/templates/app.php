<?php
/** Application shell. */
if ( ! defined( 'ABSPATH' ) ) { exit; }
$pp_user = wp_get_current_user();
$pp_boot = array(
	'rest'     => esc_url_raw( rest_url( 'pp/v1/' ) ),
	'nonce'    => wp_create_nonce( 'wp_rest' ),
	'appUrl'   => PP_Frontend::app_url(),
	'logout'   => wp_logout_url( home_url( '/' ) ),
	'version'  => PP_VERSION,
	'assets'   => PP_PLUGIN_URL . 'assets/',
);
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Production Planning</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%231d4ed8'/><path d='M7 22h4v-8H7zm7 0h4V8h-4zm7 0h4v-5h-4z' fill='white'/></svg>">
<link rel="stylesheet" href="<?php echo esc_url( PP_PLUGIN_URL . 'assets/css/app.css?v=' . PP_VERSION ); ?>">
</head>
<body>
<div id="pp-app" class="pp-app">
	<div class="pp-loading">Loading Production Planning…</div>
</div>
<script>window.PP_BOOT = <?php echo wp_json_encode( $pp_boot ); ?>;</script>
<?php foreach ( array( 'core', 'dashboard', 'sales', 'planning', 'orders', 'workorders', 'daily', 'gantt', 'costing', 'reports', 'master' ) as $pp_js ) : ?>
<script src="<?php echo esc_url( PP_PLUGIN_URL . 'assets/js/' . $pp_js . '.js?v=' . PP_VERSION ); ?>"></script>
<?php endforeach; ?>
</body>
</html>
