#!/bin/sh
# Nightly database backup of the Xanderia AI Council; keeps 30 days.
set -e
cd "$HOME/xanderia-council"
f="$HOME/backups/council-$(date +%F).sql.gz"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$f.tmp" && mv "$f.tmp" "$f"
find "$HOME/backups" -name "council-*.sql.gz" -mtime +30 -delete
