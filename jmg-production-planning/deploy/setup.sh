#!/usr/bin/env bash
# One-time setup after `docker compose up -d`: installs WordPress, activates the plugin,
# sets permalinks and creates the demo accounts + acceptance scenario.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
wp() { docker compose run --rm -T cli wp "$@"; }
echo "Waiting for WordPress files..."
for i in $(seq 1 30); do wp core is-installed >/dev/null 2>&1 && break; wp core version >/dev/null 2>&1 && break; sleep 3; done
if ! wp core is-installed >/dev/null 2>&1; then
  PASS=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)
  wp core install --url="https://${DOMAIN}" --title="${WP_TITLE}" --admin_user="${WP_ADMIN_USER}" --admin_password="${PASS}" --admin_email="${WP_ADMIN_EMAIL}" --skip-email
  echo "================================================================"
  echo " WordPress administrator: ${WP_ADMIN_USER} / ${PASS}"
  echo "================================================================"
fi
wp rewrite structure '/%postname%/' --hard
wp plugin activate jmg-production-planning
wp eval 'print_r( JMG_Seed::scenario() );'
echo
echo "Application: https://${DOMAIN}/production-planning/"
echo "Login:       https://${DOMAIN}/wp-login.php"
echo "Demo accounts: sales.demo/Sales@2026  planner.demo/Planner@2026  supervisor.demo/Supervisor@2026  manager.demo/Manager@2026  costing.demo/Costing@2026"
