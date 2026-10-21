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

Data layout in the shared database: `tripchunks/<YYYY-MM>` (one document per dispatch month, trips keyed by id and merged on write so concurrent edits to different trips never collide), `clients`, `assets`, `rates`, `invoices`, `payments`, `users`, `settings/main`, `meta/locations`, `meta/zones`, `meta/planning` (fleet-planning setup), `fleet`, `routes`, `requests`, `allocations`, `waybilldocs` (attached waybill scans, ≤ ~500 KB each), `lostsales`, `distances` (Route Distance Master), `dieselreqs` (Diesel Request Forms), `roadslips` (Road Expense Payment Slips), `extraexpenses` (Additional Trip Expense Requests), `contractors` and `quotes` (3PL), `jobcards`, `stockmoves` (receipts, issues, returns, adjustments), `postings` (immutable ledger entries), `rateexceptions`, `incidents` (Incident & Breakdown Log), `importlogs` (Excel import log), `meta/incidentcats` (incident category master, seeded from `data/workbook/incidentcats.json`) (commercial exceptions with their immutable history), `auditfindings` (audit register entries, comments and documents), `meta/locationmaster`, `meta/tripseq` (Trip ID counter per year), `meta/accountmap` (expense type → GL account mapping), `meta/routezones`, `meta/turnaround` (Turnaround Table and planner parameters), `meta/auditpolicy` (commercial control policy and approval matrix), `audit/<YYYY-MM-DD>`. Reference masters that rarely change (`staff`, `costcenters`, `lob`, `accounts`, `items`, `suppliers`, `ratecard`, `tplrates`) are read from the published `data/workbook/*.json` files first; documents edited in the app override them by id. The Client Rate Comparison baseline (`data/workbook/ratecomparison.json`) and the TripLog reconciliation (`data/workbook/triplog_reconciliation.json`) are static reference files. Routes (the Route Master) are read from the published `data/workbook/routes.json` and then from `routes` documents, so routes approved in the app override the published file. The Client Rate Card (`data/workbook/rates.json`, 1,000+ lanes) is loaded the same way, with rates edited in the app merged over the static file by id. The Asset List (`data/workbook/assets.json`, 127 assets with cost centers) and the FMR fleet register (`data/workbook/fleet.json`, 69 trucks) are loaded the same way; an `assets` or `fleet` document saved in the app is merged over the static record with the same id, so fields the document never carried (the cost center imported from `Setup_Haulage.xlsx`, the driver) still come from the import.

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

### Trip ID generation

Trip IDs are generated by the system in the format `JMG-TRP-YYYY-NNNNNN` (year of dispatch + six-digit sequence) when an approved allocation is converted into a trip, or when a 3PL request is assigned. They are never typed, overwritten, blanked or reused; cancelled trips keep theirs. On the server the sequence lives in the `counters` table (`tripseq:<year>`) and is taken inside the same transaction that writes the trip; the `trips` table has a unique index on `trip_id` for generated IDs, so concurrent conversions can never produce a duplicate. The shared-database demo keeps the counter in `meta/tripseq` and re-checks the Trip Log for duplicates before saving (best effort under simultaneous conversions). Legacy Journey Plan IDs from the workbook stay on historical trips; the pattern in Settings → Fleet planning only governs those legacy values.

Server endpoints involved (signed-in users only):

* `POST /api/trips/from-allocation` (`{ allocationId, split?, reason? }`, right *trip.fromPlanning*): checks the approved route and fleet plan, generates the Trip ID and builds the Trip Log entry from the allocation; a second trip for one allocation needs `split: true`, a reason and the *allocation.split* right.
* `POST /api/trips/tpl` (`{ requestId, dateDispatched?, plates[] }`, rights *tpl.manage* or *tpl.approve*): creates one contractor trip per unit for a cost-approved 3PL request, each with its own Trip ID.
* `PUT /api/trips/:id` with `finStatus: "Closed"` is the financial closure (right *finance.close*): refused while the trip is not invoiced, has a balance or unpaid additional expenses unless `finNote` gives the reason; operational closure never changes it.
* `PUT /api/:collection/:id` enforces the stage rules per collection: jobcards (workflow order, *workshop.approve* for approval, quality inspection before release), stockmoves (immutable, issues only against approved job cards, duplicate and negative-stock checks), postings (immutable, *finance.post*, GL account and cost center mandatory, one posting per ledger line), masters (*master.manage*; Finance may set cost-center budgets and the account mapping, Station Supervisors and the 3PL coordinator may enter 3PL rates), requests (CRM creates; plan approval needs *plan.approve*; truck release needs *allocation.release*; unmapped routes cannot be submitted or planned), allocations (within the approved quantity and category, double booking, substitution needs *plan.override*), dieselreqs / roadslips (prepare, approve, finance, issue), extraexpenses (request, Operations Manager decision, finance payment), invoices (document override by Operations Manager and Finance; issue blocked without documents), routes (approval needs *route.manage*), meta/planning (tracking may only stamp the FMR upload).

Relationship kept in the database: **Request ID → Approved plan → Allocation ID → Trip ID → Trip Log entry → Invoice ID**, visible on every allocation (*chain stage*) and in Reports → Trip-to-billing pipeline.

### Road-routing service for the Route Distance Master

Set `OSRM_URL=https://router.project-osrm.org` (or your own OSRM / OpenRouteService-compatible endpoint) when starting the server; *Suggest from routing service* in Settings → Route Distance Master then fetches the road distance through `GET /api/routing/distance?from=lat,lng&to=lat,lng`. In the shared-database demo the browser calls the public OSRM endpoint directly when it can. Suggested distances are never used operationally until an administrator approves them.

## 3. WordPress

The brief suggested a WordPress plugin. The delivered architecture is a stand-alone Node service because it needs no PHP/MySQL setup, enforces permissions in one place and ships with its own tests. It can live under a WordPress site either by reverse-proxying `/haulage/` to the Node service or by embedding `index.html` in a page and pointing the API base at the service; a native plugin port would reuse `js/core/engine.js` unchanged and replace `server/server.js` with REST routes in PHP.

## Tests

```bash
npm test          # engine, planning, dispatch, workflow, finance, workshop, audit and incident / Brief 8 tests (80): VAT/billing totals vs the workbook, status rules, rate lookup, numbering, FMR availability, planner ranking, double booking, waybill/invoice automation, request stages, Route Master validation, Trip ID sequence, TAT, slips, additional expenses, 3PL margin

The FMR upload scenario uses a CSV file because the browser run blocks the CDN that serves the Excel library; the workbook reader falls back to CSV automatically.
BASE=http://localhost:8099 node tests/e2e.acceptance.js                 # browser acceptance run (Playwright) against a seeded local server: the 17 workflow scenarios (A1–A17), the Setup brief scenarios (B1–B10), the Brief 8 demo tests (D1–D22: CRM origin / rate mapping and GM approval, FMR Free anywhere, 3PL suppliers, Finance disbursements, Excel masters, Trip ID formats, incidents end to end) plus retained FMR, role and credit-note checks; 48 steps
MOCK_ARTIFACT=1 BASE=http://localhost:8099 node tests/e2e.acceptance.js # the same steps through the shared-database store with an in-page mock of the claude.ai runtime
```
