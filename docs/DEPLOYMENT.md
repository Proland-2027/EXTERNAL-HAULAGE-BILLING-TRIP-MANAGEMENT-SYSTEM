# Deployment Guide

The system is a PHP 8.1+ application (no build step) with a browser front-end. It runs in three ways:

| Option | Database | Best for |
|---|---|---|
| **A. Docker** (`docker compose up`) | MariaDB (bundled) | fastest way to a shared HTTPS site on any VPS |
| **B. Plain PHP host** (cPanel, Plesk, any Apache/Nginx with PHP) | MySQL or SQLite | existing web hosting |
| **C. WordPress plugin** | the WordPress MySQL database | sites that already run WordPress; WordPress users & login |

All three serve the same code: `server/` (engine + JSON API), `app/` (production planning UI),
the repository root (`index.html`, `js/`, `css/` — the Trip Log) and `data/Prodction_Data.xlsx`.

> A public HTTPS URL requires a server or hosting account under your control. The repository contains everything needed
> to put it online in minutes with any of the options below; nothing in it can be published to the internet from the
> development sandbox itself.

## A. Docker (recommended for a staging URL)

Requirements: a Linux VPS with Docker, a DNS name pointing at it (e.g. `planning.example.com`), ports 80/443 open.

```bash
git clone <this repository> proland && cd proland
cp .env.example .env            # set DB_PASSWORD, DB_ROOT_PASSWORD, DOMAIN, SEED_DEMO
docker compose --profile https up -d --build
```

Caddy obtains a Let's Encrypt certificate automatically and proxies `https://$DOMAIN` to the app. Without the
`https` profile the app listens on `http://<host>:8080` (put it behind your own Nginx/Cloudflare for TLS).

On first start the container creates the tables, imports the workbook, creates the test accounts and (when
`SEED_DEMO=1`) the demonstration scenarios. Data lives in the `db-data` and `app-data` volumes; a JSON backup is
written daily to `server/data/backups` inside `app-data` (`docker compose exec app php bin/console backup` on demand;
add `mysqldump` of the `db` service to your off-site backup).

## B. Plain PHP hosting

1. Upload the repository to the host (keep the folder structure). Point the **document root** at `server/public`
   (`public/.htaccess` routes everything through `index.php`; for Nginx use `try_files $uri /index.php?$args;`).
   If the document root cannot be changed, upload to a sub-folder and create a small `index.php` in the web root that
   `require`s `server/public/index.php` — the engine folders are protected by `.htaccess`.
2. Copy `server/config.example.php` to `server/config.php` and set the database (`mysql` with host/name/user/password,
   or leave `sqlite` for a single-server install — make `server/data` writable by the web server).
3. From a shell (or the host's cron/task runner):
   ```bash
   php server/bin/console migrate && php server/bin/console import && php server/bin/console seed-users
   php server/bin/console seed-demo        # optional demonstration data
   ```
   Without shell access: open the site, sign in as `admin` after creating it with
   `create-user` … or use *Administration → Workbook import* once the first admin exists.
4. Enable HTTPS on the host (Let's Encrypt / AutoSSL). Cookies are marked `Secure` automatically behind HTTPS.
5. Schedule `php server/bin/console backup` daily (cron) and change the demo passwords.

PHP extensions needed: `pdo_mysql` (or `pdo_sqlite`), `zip`, `xmlreader`, `simplexml`, `mbstring`.

## C. WordPress plugin

1. Build the plugin: `./scripts/build-wp-plugin.sh` → `dist/proland-production.zip` (contains the engine, both
   front-ends, the workbook and these docs).
2. WordPress → Plugins → Add New → Upload → activate. Activation creates the tables (prefix `wp_pp_`), imports the
   workbook and schedules a daily backup through WP-Cron.
3. Create a page containing the shortcode `[proland_production]` (the Trip Log is reached from the app menu or with
   `[proland_production app="haulage"]`). *Production Planning* also appears in the WordPress admin menu.
4. Assign roles: the plugin adds WordPress roles *Sales, Production Planner, Production Manager, Section Supervisor,
   Store Officer, Cost Accountant, Management*; WordPress administrators are application administrators. Users sign in
   with their normal WordPress credentials; the application maps the WordPress role to its own permissions.
5. The REST API is served at `/wp-json/proland/v1/…` with the WordPress nonce; `server/` and `data/` inside the plugin
   folder are blocked from direct web access.

## Accounts created by `seed-users` (change immediately)

| Username | Role | Password |
|---|---|---|
| admin | Administrator | Admin@2026 |
| sales | Sales | Sales@2026 |
| planner | Production Planner | Planner@2026 |
| prodmgr | Production Manager | Manager@2026 |
| supervisor | Section Supervisor (all sections) | Super@2026 |
| store | Store Officer | Store@2026 |
| costacct | Cost Accountant | Cost@2026 |
| mgmt | Management | Mgmt@2026 |

Reset any password with `php server/bin/console reset-password <username> <new-password>` or from Administration → Users.

## Security notes

* Passwords are hashed (bcrypt); sessions are random tokens in an HttpOnly, SameSite cookie, expiring after 12 h.
* Write requests require the `X-Requested-With` header (CSRF protection); every API route checks the role.
* All SQL uses prepared statements; uploaded workbooks are parsed with XMLReader (no macros/formulas executed).
* Keep `server/` and `data/` outside the document root (or protected by the provided `.htaccess`).

## Operations

* `php server/bin/console import [file]` re-imports a workbook (users, plans, history and approved costs are kept).
* `php server/bin/console backup` writes `server/data/backups/backup-<timestamp>.json.gz` (+ SQLite copy).
* Tests: `npm test` (Trip Log engine) and `php server/tests/run.php` (planning engine, 44 checks).
* Development server: `npm start` → http://localhost:8080 (uses SQLite in `server/data`).
