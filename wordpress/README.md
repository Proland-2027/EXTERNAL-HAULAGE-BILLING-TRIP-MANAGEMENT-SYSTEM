# WordPress integration

`jmg-production-portal.php` is a small WordPress plugin that

* adds **Settings → Production Portal** (application URL, shared secret, role mapping),
* adds the shortcode `[proland_portal]` which embeds the application for logged-in WordPress users
  (`mode="button"` renders a link instead, `view="/sections"` opens a specific screen),
* adds a **Production Planning** link to the WordPress admin bar,
* signs the WordPress user into the application with a short-lived HMAC-SHA256 token
  (`/sso?token=…`). The application verifies the token with `WP_SSO_SECRET`, creates or updates the
  user with the mapped role and starts a normal session. All record-level permissions, the audit
  trail and the planning engine stay in the application.

## Install

1. Copy `jmg-production-portal.php` to `wp-content/plugins/jmg-production-portal/` and activate it.
2. Generate a secret (`openssl rand -hex 32`), set it as `WP_SSO_SECRET` for the Node application
   and paste it in **Settings → Production Portal**. Set the application URL (HTTPS).
3. Map WordPress roles to application roles (SALES, PLANNER, PRODUCTION_MANAGER, SUPERVISOR, STORE,
   COST_ACCOUNTANT, MANAGEMENT, ADMIN). Custom WordPress roles (e.g. `proland_sales`) work too.
4. Create a page containing `[proland_portal]`.

Users who should only use the application (not WordPress) can still be created directly in
**Admin → Users** of the application and sign in with username and password.
