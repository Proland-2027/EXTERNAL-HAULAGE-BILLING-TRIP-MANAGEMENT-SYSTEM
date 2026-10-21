#!/bin/sh
# First start: create tables, import the workbook, create the test accounts (and, when PP_SEED_DEMO=1, the demo scenarios).
set -e
cd /var/www/app/server
if [ "${PP_DB_DRIVER:-sqlite}" = "mysql" ]; then
  echo "Waiting for MySQL at ${PP_DB_HOST}..."
  for i in $(seq 1 60); do php -r 'try { new PDO("mysql:host=".getenv("PP_DB_HOST").";port=".(getenv("PP_DB_PORT")?:3306), getenv("PP_DB_USER"), getenv("PP_DB_PASSWORD")); exit(0);} catch (Exception $e) { exit(1);}' && break; sleep 2; done
fi
php bin/console migrate
if [ "$(php -r 'require "src/App.php"; $a=new App(); echo (int)$a->db->val("SELECT COUNT(*) FROM {p}bom_rows");')" = "0" ]; then
  echo "Importing workbook..."; php bin/console import
  php bin/console seed-users
  if [ "${PP_SEED_DEMO:-0}" = "1" ]; then php bin/console seed-demo; fi
fi
chown -R www-data:www-data /var/www/app/server/data
# daily backup at 02:00 (container local time)
( while true; do sleep 86400; php bin/console backup || true; done ) &
exec "$@"
