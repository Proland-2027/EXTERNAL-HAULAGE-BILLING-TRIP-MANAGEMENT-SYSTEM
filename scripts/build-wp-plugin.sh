#!/bin/sh
# Assembles the WordPress plugin zip: wordpress/proland-production + engine (server/src, schema, bin) + front-ends + workbook.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/proland-production"
rm -rf "$OUT" && mkdir -p "$OUT/server" "$OUT/app" "$OUT/haulage" "$OUT/data"
cp -r "$ROOT/wordpress/proland-production/." "$OUT/"
cp -r "$ROOT/server/src" "$ROOT/server/schema" "$ROOT/server/bin" "$ROOT/server/config.example.php" "$OUT/server/"
mkdir -p "$OUT/server/data/backups" && printf "Require all denied\n" > "$OUT/server/.htaccess" && printf "Require all denied\n" > "$OUT/data/.htaccess"
cp -r "$ROOT/app/." "$OUT/app/"
cp "$ROOT/index.html" "$OUT/haulage/" && cp -r "$ROOT/js" "$ROOT/css" "$OUT/haulage/"
cp "$ROOT/data/Prodction_Data.xlsx" "$OUT/data/"
cp -r "$ROOT/docs" "$OUT/docs"
(cd "$ROOT/dist" && rm -f proland-production.zip && zip -qr proland-production.zip proland-production)
echo "Built $ROOT/dist/proland-production.zip"
