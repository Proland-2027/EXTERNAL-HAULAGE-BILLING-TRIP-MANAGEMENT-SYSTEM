# Deploying Production Planning online (shareable HTTPS link)

The application is a standard WordPress plugin, so any WordPress host works. Deployment from this
repository could not be performed automatically because no hosting account, WordPress site or
deployment credentials were provided. Choose one of the options below and the live URL will be
`https://<your-domain>/production-planning/`.

## Option A – existing WordPress site (fastest)

1. Log in to WordPress as an administrator.
2. **Plugins → Add New → Upload Plugin** → choose `dist/production-planning.zip` → *Install Now* →
   *Activate*. Activation imports the production workbook (10–30 s).
3. Open `https://<your-domain>/production-planning/`.
4. **Master Data & Settings → Users → Create demo users** (password `Demo#2026!`) and add the real
   team members with their roles.

What is needed from you if you want this done for you: the WordPress admin URL plus an administrator
login (or an application password), or SFTP/SSH access to `wp-content/plugins/`.

## Option B – new managed WordPress hosting (~15 minutes)

Any managed WordPress provider (for example WordPress.com Business, Kinsta, WP Engine, Cloudways,
SiteGround, Hostinger) provides HTTPS, daily backups and a MySQL database.

1. Create the WordPress site and note the admin login.
2. Follow Option A.
3. Recommended host settings: PHP 8.1+, `max_execution_time` ≥ 120 and `upload_max_filesize` ≥ 16 MB
   (only needed for workbook imports; the bundled workbook is 4.5 MB).

What is needed from you: a provider account (or authorisation to create one) and the domain name.

## Option C – self-hosted VPS with Docker

```bash
docker run -d --name pp-db -e MYSQL_ROOT_PASSWORD=change-me -e MYSQL_DATABASE=wp mysql:8
docker run -d --name pp-wp --link pp-db:mysql -p 80:80 -e WORDPRESS_DB_HOST=mysql \
  -e WORDPRESS_DB_USER=root -e WORDPRESS_DB_PASSWORD=change-me -e WORDPRESS_DB_NAME=wp wordpress:latest
docker cp production-planning pp-wp:/var/www/html/wp-content/plugins/
```

Put a reverse proxy with a TLS certificate in front (Caddy / nginx + Let's Encrypt), complete the
WordPress installer, then activate the plugin. What is needed from you: a server with a public IP
and a DNS name.

## After deployment – checklist

| Item | Where |
|---|---|
| Administrator access | WordPress admin account; the app menu *Production Planning* appears in wp-admin |
| Test users for Sales, Planning, Production, Management, Costing | *Master Data → Users → Create demo users* (`sales.demo`, `planner.demo`, `supervisor.demo`, `cutting.demo`, `manager.demo`, `costing.demo` / `Demo#2026!`) |
| Adding team members | *Master Data → Users → Add team member* (username, password, role, optional sections) or WordPress → Users with a `pp_*` role |
| Persistent multi-user data | All data lives in the site's MySQL database (`wp_pp_*` tables); use the host's backup feature or a backup plugin |
| Importing updated Excel | *Master Data → Excel Import* (Update keeps manual edits; Replace reloads everything) |
| Daily re-forecast | WP-Cron event `pp_daily_reforecast` (05:00 site time); run `wp cron event run pp_daily_reforecast` or *Dashboard → Recalculate forecasts* manually |

## Demo scenario (section 18 of the brief)

1. Sales: *New Production Request* → `SPGEY18` (ELETROMAK GENSET/YTO/EY18/16KVA/DIESEL/SOUNDPROOFED), quantity 20, delivery date, priority Normal → submit (BOM preview shows the 11 semi-finished components).
2. Planner: *Production Planning → Plan* → **Generate Production Plan** → review completion date, bottleneck (Gbagada Canopy Bending at the workbook routing rate), 28 departmental work orders, daily targets, material list (152 materials) and estimated BOM cost → **Confirm Production Plan**.
3. Add a second, urgent request (e.g. `SPGEY22` × 10) and generate: it competes for the same cutting, bending, welding, assembly and canopy sections; the schedule shows it taking capacity first and the first order's forecast is unchanged until re-forecast.
4. Supervisor (cutting): *Department Work Orders* → start → record 20 good → *Transfer completed qty* to bending (partial transfers allowed) → bending supervisor receives in *Work in Progress*.
5. Bending records 2 good / 1 rejected / 90 min downtime → the system flags the shortfall, recalculates the remaining work, updates forecast dates and raises an alert.
6. Dashboard, Gantt, WIP, Daily Productivity, BOM Costing and the Monthly Report reflect the live state; export to Excel or print to PDF.
