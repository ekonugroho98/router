#!/usr/bin/env bash
# =====================================================
# Check customer expiry and stop expired containers.
# Run via cron every hour:
#   0 * * * * /opt/9router/check-expiry.sh
# =====================================================
set -euo pipefail

DB="/var/lib/9router-data/db/data.sqlite"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S")

# Find expired customers
EXPIRED=$(sqlite3 "$DB" "
  SELECT id, email, json_extract(metadata, '$.expiresAt') as expiresAt
  FROM customers
  WHERE isActive = 1
    AND json_extract(metadata, '$.expiresAt') IS NOT NULL
    AND json_extract(metadata, '$.expiresAt') < '$NOW'
")

if [ -z "$EXPIRED" ]; then
  exit 0
fi

echo "[$(date)] Checking expired customers..."

while IFS='|' read -r id email expiresAt; do
  CONTAINER="hermes-${id:0:8}"
  echo "  Expiring: $email (expired: $expiresAt)"

  # Stop container if exists
  if incus info "$CONTAINER" &>/dev/null; then
    echo "    Stopping container: $CONTAINER"
    incus stop "$CONTAINER" --force 2>/dev/null || true
  fi

  # Deactivate customer
  sqlite3 "$DB" "
    UPDATE customers
    SET isActive = 0,
        suspendedReason = 'Plan expired on $expiresAt',
        updatedAt = '$NOW'
    WHERE id = '$id'
  "

  echo "    Customer deactivated"
done <<< "$EXPIRED"

echo "[$(date)] Expiry check complete."
