# Deployment guide

The application is a WordPress plugin. It runs on any WordPress host (shared hosting, managed
WordPress, a VPS) and needs nothing installed on users' computers: team members open the HTTPS
address in Chrome, Edge, Firefox or Safari and log in.

## Hosted edition available now

A working multi-user edition is published at https://claude.ai/artifact/4eqdTG5R9fhNfmkZcn7HBG (private to the
owner until shared from the page's Share menu; give colleagues Contributor or Editor access so they can save).
It runs the same planning engine in the browser against the workbook data, with a shared database on the
claude.ai platform. The steps below are for your own WordPress server.

## Deployment status and what is required

The plugin is complete and tested on a local WordPress 6.8 installation, but **it has not been
published to a public HTTPS site from this delivery**: publishing needs a hosting account (or a
server) that only the team can provide. To put the demo online, one of the following is needed:

| Option | What you provide | Time |
|---|---|---|
| A. Existing WordPress site | Administrator login of the site (must allow plugin uploads) | 10 minutes |
| B. Managed / shared WordPress hosting | A hosting plan with one-click WordPress (e.g. any cPanel host, WordPress.com Business, Kinsta, SiteGround, Hostinger …) and its admin login | 20 minutes |
| C. VPS / cloud VM (recommended for a private production system) | A Linux VM (2 vCPU, 2 GB RAM, Docker installed) and a DNS name such as `planning.jmg.example` pointing at it | 30 minutes using `deploy/docker-compose.yml` (automatic HTTPS) |

Once access is granted the steps below give the application URL `https://<site>/production-planning/`.

## A / B. Install on a WordPress site

1. Build the plugin zip (or use the one in the repository): `deploy/build-zip.sh` → `jmg-production-planning.zip`.
2. WordPress admin → Plugins → Add New → Upload Plugin → choose the zip → Install → **Activate**.
   Activation creates the database tables and imports the bundled workbook (about 30–60 s;
   PHP `max_execution_time` ≥ 120 s and `memory_limit` ≥ 256 M are recommended).
3. Settings → Permalinks → choose "Post name" and save (gives the clean `/production-planning/` URL;
   otherwise the application is at `/?jmg_app=1`).
4. WordPress admin menu → **Production Planning** → Open. The administrator account already has all rights.
5. Production Planning → Administration → **Demo scenario** → "Create / reset demo scenario":
   creates the five test accounts and the acceptance-test orders.
6. Make sure the site is served over HTTPS (all mainstream hosts provide free Let's Encrypt
   certificates in their control panel).

## C. Docker on a VPS with automatic HTTPS

```
git clone <this repository>
cd jmg-production-planning/deploy
cp .env.example .env            # set DOMAIN, passwords
docker compose up -d            # WordPress + MariaDB + Caddy (automatic Let's Encrypt HTTPS)
./setup.sh                      # installs WordPress, activates the plugin, creates demo accounts and scenario
```

`setup.sh` prints the administrator password. The application is then available at
`https://$DOMAIN/production-planning/`.

## After installation

### Administrator login
* WordPress login page: `https://<site>/wp-login.php`
* Users with a production-planning role are redirected to the application after login.
* The administrator account (created at WordPress installation, or by `setup.sh`) has every capability.

### Test accounts (created by the Demo scenario)

| Account | Password | Role | Can |
|---|---|---|---|
| `sales.demo` | `Sales@2026` | Sales | create and monitor sales production requests |
| `planner.demo` | `Planner@2026` | Production Planner | generate schedules, adjust, confirm plans, replan, record production |
| `supervisor.demo` | `Supervisor@2026` | Section Supervisor | record daily output for assigned sections (all sections by default) |
| `manager.demo` | `Manager@2026` | Production Manager | dashboards, reports, alerts, replanning approval, audit |
| `costing.demo` | `Costing@2026` | Costing / Finance | material prices, labour and processing rates, costing |

Change these passwords in Administration → Users before inviting real users.

### Inviting team members
Administration → Users & roles → "Invite a team member": username, e-mail, role, optional section
assignment for supervisors. The generated password is shown once; the user signs in at
`/wp-login.php`. Roles can be changed and passwords reset from the same screen. (Standard
WordPress Users screen works too; the production planning roles appear in the role list.)

### Multiple users, one live database
All screens read and write the WordPress database through the REST API; nothing operational is kept in
the browser. Two people on different computers see the same requests, orders, schedules and daily
logs; every change is recorded in the audit log with user and timestamp.

### Importing or updating Excel data
Administration → Excel import: upload a workbook with the same sheet layout as `Prodction Data.xlsx`
(sheets `BOM`, `Finished Product`, `Canopy Assembly`, `Genset Assembly`, `Cutting Capacity`,
`Capacity S1`…`Capacity500`). Products, BOM lines, sections, capacity rows and machine times are
replaced; manually maintained prices, overrides, calendar, orders and tracking history are kept.
Tick "re-plan confirmed orders afterwards" to apply new capacities to open orders. Gaps are listed
under Masters → Data issues.

### Backup and restore
Administration → Backup downloads all planning tables as JSON; Restore reloads them. Use it together
with the host's normal WordPress/database backup.

## Technical notes
* Tables are prefixed `wp_jmg_*` (22 tables); the BOM table holds ~26,700 rows for the current workbook.
* REST API base: `/wp-json/jmg/v1/` (cookie authentication + nonce, capability checks per route).
* No external build tools; the only optional external resource is the SheetJS library loaded from a CDN for
  Excel export (CSV fallback when offline).
* Tested with PHP 8.3, WordPress 6.8, MariaDB-compatible SQL (verified through the SQLite integration layer).
