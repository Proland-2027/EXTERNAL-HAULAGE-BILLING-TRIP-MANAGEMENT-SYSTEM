# Hosted edition (claude.ai artifact)

The same application, running entirely in the browser on the claude.ai artifact platform with a
shared database (`db` capability) and viewer identity (`user`), so the JMG team can use it from any
browser without hosting. Live link (private, share from its Share menu):
https://claude.ai/artifact/4eqdTG5R9fhNfmkZcn7HBG

* `engine.js`  – JavaScript port of the plugin's BOM explosion, cost roll-up, routing resolver,
  calendar and finite-capacity scheduler (`includes/class-jmg-bom.php`, `class-jmg-routing.php`,
  `class-jmg-scheduler.php`, `class-jmg-calendar.php`).
* `server.js`  – port of orders, tracking, reports and the REST routes (`class-jmg-orders.php`,
  `class-jmg-tracking.php`, `class-jmg-reports.php`, `class-jmg-api.php`) on top of the shared store.
* `build.py`   – derives the hosted front-end from `assets/app.js` (in-page navigation, dialogs,
  downloads through the platform, role selector).
* `build_index.py` – inlines CSS and scripts into the publishable page; `shim.js` emulates the runtime
  for local testing (`test.html`).
* `export-masters.php` – exports the imported workbook masters (products, BOM, prices, sections,
  capacities, machines, series, stage map, data issues) to `data/masters.json` and `data/bom.json`,
  which the page loads at start.

Differences from the WordPress edition: roles are chosen by the viewer ("Acting as") until the owner
assigns fixed roles; the stage map and size classes are read-only; workbook re-import, PDF print view
and WordPress user accounts are only in the WordPress edition. Writes need Contributor or Editor
access to the artifact.
