# Deployment

The application is a plain HTML/JavaScript front end with three interchangeable back ends. The same code runs in each; the front end detects which one is available when it starts.

| Mode | Where data lives | Multi-user | Permissions enforced | How to use |
|---|---|---|---|---|
| **Shared database (demo link)** | claude.ai artifact database | Yes, live | In the app (every signed-in viewer with write access shares one database) | Open the published link |
| **Application server** | SQLite file on your server (`data/haulage.db`) | Yes, polled every 4 s | On the server, per role and per field | `node server/server.js` behind HTTPS |
| **Local** | This browser's storage only | No | In the app | Open `index.html` without a server |

## 1. Demo link (claude.ai artifact)

The demo at the link given with the delivery is published from `index.html` with the `db`, `user` and `downloads` capabilities and seeded with the workbook data (`tools/build_artifact_seed.js` produces the documents).

Sharing: the artifact is private to its owner until shared from the page's **Share** menu. People given access open the same link and sign in with the application accounts. Viewers who are only allowed to *view* the artifact can read every record but their saves are refused by the platform; give team members **Contributor** (or higher) access so they can write.

Data layout in the shared database: `tripchunks/<YYYY-MM>` (one document per dispatch month, trips keyed by id and merged on write so concurrent edits to different trips never collide), `clients`, `assets`, `rates`, `invoices`, `payments`, `users`, `settings/main`, `meta/locations`, `audit/<YYYY-MM-DD>`.

## 2. Your own server (recommended for production)

Requirements: Node.js 22 or newer (uses the built-in `node:sqlite`; no npm packages).

```bash
git clone <repository>
cd EXTERNAL-HAULAGE-BILLING-TRIP-MANAGEMENT-SYSTEM
node server/seed.js            # loads the workbook data, demo accounts and sample rates into data/haulage.db
PORT=8080 node server/server.js
```

Open `http://localhost:8080`. For the internet, put the server behind an HTTPS reverse proxy (nginx, Caddy, or a platform such as Render, Railway or Fly.io) and start it with `SECURE_COOKIE=1` so session cookies are HTTPS-only. Example Caddyfile:

```
billing.example.com {
  reverse_proxy localhost:8080
}
```

Environment variables: `PORT` (default 8080), `DB` (SQLite path, default `data/haulage.db`), `SECURE_COOKIE=1`.

Security built in: salted PBKDF2 password hashes, HttpOnly SameSite session cookies with 12-hour expiry, origin check on every write, per-role and per-field permission checks on the server, optimistic version check (HTTP 409 when someone else saved first), full audit table, no financial data served without a session.

Backups: the database is a single file; copy `data/haulage.db` (and `-wal`/`-shm` files) on a schedule, or run `sqlite3 data/haulage.db ".backup backup.db"`. The original workbook is kept unchanged in `data/workbook/`.

## 3. WordPress

The brief suggested a WordPress plugin. The delivered architecture is a stand-alone Node service because it needs no PHP/MySQL setup, enforces permissions in one place and ships with its own tests. It can live under a WordPress site either by reverse-proxying `/haulage/` to the Node service or by embedding `index.html` in a page and pointing the API base at the service; a native plugin port would reuse `js/core/engine.js` unchanged and replace `server/server.js` with REST routes in PHP.

## Tests

```bash
npm test          # engine tests: VAT/billing totals vs the workbook, status rules, rate lookup, numbering, permissions, import mapping
```
