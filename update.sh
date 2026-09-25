#!/bin/sh
# Update the Xanderia AI Council on the server from GitHub, then rebuild and restart.
# Usage (on the server): ~/xanderia-council/update.sh
# The server pulls with a read-only deploy key; .env and the database volumes are never touched.
set -e
cd "$(dirname "$0")"
before=$(git rev-parse --short HEAD)
git fetch -q origin
git checkout -q -f -B main origin/main
after=$(git rev-parse --short HEAD)
if [ "$before" = "$after" ] && [ "$1" != "--force" ]; then
  echo "Already up to date ($after). Use --force to rebuild anyway."
  exit 0
fi
echo "Updating $before -> $after"
git log --oneline "$before..$after" 2>/dev/null | head -20
docker compose up -d --build
docker image prune -f >/dev/null
sleep 5
docker compose ps --format '{{.Service}}: {{.Status}}'
curl -sk -o /dev/null -w 'web: HTTP %{http_code}\n' "https://$(grep '^SITE_ADDRESS=' .env | cut -d= -f2)/api/health" || true
