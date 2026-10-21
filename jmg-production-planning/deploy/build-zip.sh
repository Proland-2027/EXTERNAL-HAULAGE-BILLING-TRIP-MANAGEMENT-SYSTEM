#!/usr/bin/env bash
# Builds jmg-production-planning.zip for upload through WordPress > Plugins > Add New > Upload.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-$(pwd)/../jmg-production-planning.zip}"
rm -f "$OUT"
cd ..
zip -qr "$OUT" jmg-production-planning -x 'jmg-production-planning/deploy/.env' 'jmg-production-planning/tests/*' 'jmg-production-planning/.git*' 'jmg-production-planning/node_modules/*'
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
