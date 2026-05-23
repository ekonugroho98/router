#!/usr/bin/env bash
# =====================================================
# Auto-provision daemon — polls DB for pending provisions
# and creates Incus containers automatically.
#
# Run as systemd service or cron:
#   * * * * * /opt/9router/auto-provision.sh
#
# Checks customers with metadata.provisionStatus = 'pending'
# and provisions Incus container for each.
# =====================================================
set -euo pipefail

DB="/var/lib/9router-data/db/data.sqlite"
PROVISION_SCRIPT="/opt/9router/provision-hermes.sh"
LOG="/var/log/hermes-provision.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; echo "$*"; }

# Find customers pending provision
PENDING=$(sqlite3 "$DB" "
  SELECT id, email,
    json_extract(metadata, '$.telegram.botToken') as botToken,
    json_extract(metadata, '$.telegram.ownerId') as ownerId
  FROM customers
  WHERE isActive = 1
    AND json_extract(metadata, '$.provisionStatus') = 'pending'
  LIMIT 3
" 2>/dev/null)

if [ -z "$PENDING" ]; then
  exit 0
fi

while IFS='|' read -r id email botToken ownerId; do
  [ -z "$id" ] && continue

  CONTAINER="hermes-${id:0:8}"

  # Skip if container already exists
  if incus info "$CONTAINER" &>/dev/null; then
    log "Container $CONTAINER already exists for $email, marking as provisioned"
    sqlite3 "$DB" "UPDATE customers SET metadata = json_set(metadata, '$.provisionStatus', 'active') WHERE id = '$id'"
    continue
  fi

  log "Auto-provisioning: $email ($id)"

  # Get API key
  API_KEY=$(sqlite3 "$DB" "SELECT key FROM customerApiKeys WHERE customerId='$id' AND isActive=1 LIMIT 1")
  if [ -z "$API_KEY" ]; then
    log "ERROR: No API key for $email"
    sqlite3 "$DB" "UPDATE customers SET metadata = json_set(metadata, '$.provisionStatus', 'error', '$.provisionError', 'No API key') WHERE id = '$id'"
    continue
  fi

  # Mark as provisioning
  sqlite3 "$DB" "UPDATE customers SET metadata = json_set(metadata, '$.provisionStatus', 'provisioning') WHERE id = '$id'"

  # Provision
  PROVISION_ARGS="--customer-id $id --api-key $API_KEY"
  if [ -n "$botToken" ] && [ "$botToken" != "" ]; then
    PROVISION_ARGS="$PROVISION_ARGS --bot-token $botToken --owner-id $ownerId"
  fi

  if bash "$PROVISION_SCRIPT" $PROVISION_ARGS >> "$LOG" 2>&1; then
    # Get SSH password from provision output
    SSH_PASS=$(tail -20 "$LOG" | grep "SSH Password:" | awk '{print $NF}')

    # Mark as active + store SSH password
    sqlite3 "$DB" "UPDATE customers SET metadata = json_set(metadata, '$.provisionStatus', 'active', '$.container', '$CONTAINER', '$.sshPassword', '$SSH_PASS') WHERE id = '$id'"

    log "SUCCESS: $email → $CONTAINER"

    # Notify admin
    ADMIN_TOKEN=$(grep ADMIN_TG_BOT_TOKEN /opt/9router/.env 2>/dev/null | cut -d= -f2)
    ADMIN_CHAT=$(grep ADMIN_TG_CHAT_ID /opt/9router/.env 2>/dev/null | cut -d= -f2)
    if [ -n "$ADMIN_TOKEN" ] && [ -n "$ADMIN_CHAT" ]; then
      curl -s "https://api.telegram.org/bot${ADMIN_TOKEN}/sendMessage" \
        -d "chat_id=${ADMIN_CHAT}" \
        -d "text=✅ Auto-provisioned: ${email} → ${CONTAINER}" \
        -d "parse_mode=Markdown" > /dev/null 2>&1
    fi
  else
    sqlite3 "$DB" "UPDATE customers SET metadata = json_set(metadata, '$.provisionStatus', 'error', '$.provisionError', 'Provision script failed') WHERE id = '$id'"
    log "ERROR: Provision failed for $email"
  fi
done <<< "$PENDING"
