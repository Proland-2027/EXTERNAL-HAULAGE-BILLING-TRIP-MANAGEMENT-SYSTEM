# Local test stack

1. Download WordPress and the [SQLite Database Integration](https://github.com/WordPress/sqlite-database-integration) plugin (or use a normal MySQL install).
2. Symlink or copy `production-planning/` into `wp-content/plugins/` and activate it.
3. Serve with `php -S 127.0.0.1:8081 -t /path/to/wordpress tests/dev-router.php`.
4. Create an administrator `admin` / `Admin#2026!` (or edit `e2e.js`) and run
   `mkdir shots && node tests/e2e.js` (requires `npm i playwright`).

The script walks the full demo: 20 × SPGEY18 request → plan → confirm → competing urgent order →
Gantt → record output in cutting → transfer to bending → receipt → shortfall with re-forecast →
every screen → Excel export → role restrictions.
