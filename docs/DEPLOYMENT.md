# Deployment

The application is a single Node.js 22 process with an embedded SQLite database. It needs no
external database, cache or build step, so it runs on any host that can run Node 22: a Docker host,
Render, Fly.io, Railway, a VPS, or the same server that hosts your WordPress site.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 8080 | Listening port |
| `DATA_DIR` | `./data` | Where `ppm.sqlite`, `backups/` and `uploads/` live — **must be persistent** |
| `ADMIN_PASSWORD` | Admin@2026 | Initial administrator password (first start only) |
| `SEED_DEMO_USERS` | 1 | `0` = create only the administrator |
| `WP_SSO_SECRET` | – | Shared secret for the WordPress single sign-on plugin |
| `COOKIE_SECURE` | on in production | Mark the session cookie `Secure` (keep on behind HTTPS) |
| `SOURCE_WORKBOOK` | `data/source/Prodction Data.xlsx` | Workbook imported on first start |

## Option A — Docker (any VPS or cloud)

```bash
docker compose up -d --build        # http://<server>:8080
```
Put nginx (or Caddy / Traefik) in front for HTTPS; `deploy/nginx.conf` is a ready reverse-proxy
block for certbot certificates. The named volume `ppm-data` holds the database and backups.

## Option B — Render.com (fastest shareable HTTPS URL)

1. Push this repository to GitHub (already done).
2. In Render choose **New → Blueprint**, select the repository; `render.yaml` provisions a Docker
   web service with a 5 GB persistent disk mounted at `/data`, generates `ADMIN_PASSWORD` and
   `WP_SSO_SECRET`, and enables the `/healthz` health check.
3. After the first deploy open `https://<service>.onrender.com`, sign in as `admin` with the
   generated password (Render → Environment) and change it under Account.

## Option C — Fly.io

```bash
fly launch --copy-config --no-deploy
fly volumes create ppm_data --size 5 --region lhr
fly secrets set ADMIN_PASSWORD=... WP_SSO_SECRET=...
fly deploy
```

## Option D — VPS with systemd

```bash
sudo useradd -r -m -d /opt/ppm ppm
sudo -u ppm git clone <repo> /opt/ppm && cd /opt/ppm
sudo mkdir -p /var/lib/ppm && sudo chown ppm /var/lib/ppm
sudo cp deploy/ppm.service /etc/systemd/system/ && echo "ADMIN_PASSWORD=..." | sudo tee /etc/ppm.env
sudo systemctl enable --now ppm
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ppm && sudo ln -s ../sites-available/ppm /etc/nginx/sites-enabled/
sudo certbot --nginx -d planning.example.com
```

## WordPress

Install `wordpress/jmg-production-portal.php` (see `wordpress/README.md`). Set the same secret
as `WP_SSO_SECRET`, map WordPress roles to application roles, and add `[proland_portal]` to a page.
WordPress users then open the application already signed in; the application still enforces its own
permissions and audit trail. Users who do not have WordPress accounts can be created in
Admin → Users and sign in with username/password.

## Backups and restore

* A backup (`VACUUM INTO`) is taken at first start and daily at the configured hour
  (Masters → Settings), keeping the last N copies in `DATA_DIR/backups`. Admin → Backups can create
  and download one at any time; the files are complete SQLite databases.
* Restore: stop the service, copy the backup over `DATA_DIR/ppm.sqlite` (remove `-wal`/`-shm`
  files), start the service.
* Also keep off-server copies (e.g. a nightly `scp` of the backups folder or the provider's disk snapshots).

## Updating master data

Admin → Data import accepts a new workbook with the same worksheets. Master data is replaced, the
exception report regenerated, and approved cost overrides, lead times, open plans, their snapshots
and all history are preserved. Re-plan open orders if productivity or BOM content changed.

## Security notes

* Passwords are stored with scrypt; sessions are HttpOnly, SameSite=Lax cookies; state-changing
  requests are origin-checked; every important change is written to the audit trail.
* Run behind HTTPS only. Rotate the demo passwords (or start with `SEED_DEMO_USERS=0`).
* The server never executes workbook content; import is a pure parse of the XML inside the file.
