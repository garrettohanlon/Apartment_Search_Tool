#!/bin/bash
# Push the day's dataset to the deployed UI.
#
# The agent runs here, on the machine with the credentials and the schedule.
# Vercel has no filesystem to write to, so the dataset has to be sent up. This
# POSTs it to /api/inventory, which stores it in Vercel Blob and serves it to the
# UI without needing a redeploy.
#
# Requires two values, either exported or in .env.publish beside this script:
#   DEPLOY_URL     e.g. https://apartment-search-tool.vercel.app
#   INGEST_SECRET  the same value set in the Vercel project's env vars
#
# Usage: ./publish.sh [YYYY-MM-DD]

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATE="${1:-$(date +%Y-%m-%d)}"

# .env.publish is gitignored; keep the secret there rather than in the shell history.
[ -f "$SCRIPT_DIR/.env.publish" ] && . "$SCRIPT_DIR/.env.publish"

if [ -z "${DEPLOY_URL:-}" ] || [ -z "${INGEST_SECRET:-}" ]; then
  echo "DEPLOY_URL and INGEST_SECRET must be set (export them, or put them in .env.publish)." >&2
  exit 1
fi

# Find the dataset. build_inventory.py writes it into the day's output folder.
OUTPUT_ROOT="${OUTPUT_ROOT:-$HOME/Desktop/Claude Work Flows/NYC Apartment Watch}"
for candidate in \
  "$OUTPUT_ROOT/$DATE/inventory-$DATE.json" \
  "$OUTPUT_ROOT/$DATE/inventory-latest.json" \
  "$SCRIPT_DIR/data/inventory-$DATE.json"
do
  [ -f "$candidate" ] && PAYLOAD="$candidate" && break
done

if [ -z "${PAYLOAD:-}" ]; then
  echo "No dataset found for $DATE. Run run.sh first." >&2
  exit 1
fi

echo "Publishing $PAYLOAD to $DEPLOY_URL/api/inventory"
HTTP=$(curl -sS -o /tmp/aw-publish-body -w '%{http_code}' \
  -X POST "$DEPLOY_URL/api/inventory" \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -H 'Content-Type: application/json' \
  --data-binary "@$PAYLOAD")

echo "HTTP $HTTP"
cat /tmp/aw-publish-body; echo
rm -f /tmp/aw-publish-body

# 2xx only. Anything else is a real failure worth a non-zero exit so a scheduled
# run surfaces it in the log rather than looking like it worked.
case "$HTTP" in
  2*) exit 0 ;;
  *)  echo "Publish failed." >&2; exit 1 ;;
esac
