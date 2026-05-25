#!/usr/bin/env bash
# =====================================================
# Provision a Hermes container for a customer.
#
# Usage:
#   sudo bash provision-hermes.sh \
#     --customer-id "uuid" \
#     --api-key "sk-cortex-xxx" \
#     --bot-token "7123:AAA..." \
#     --owner-id "1433257992" \
#     --model "auto"
# =====================================================
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
log() { echo -e "${GREEN}[+]${NC} $*"; }
err() { echo -e "${RED}[x]${NC} $*"; exit 1; }

# Parse args or env
CUSTOMER_ID="${CUSTOMER_ID:-}"
API_KEY="${API_KEY:-}"
BOT_TOKEN="${BOT_TOKEN:-}"
OWNER_ID="${OWNER_ID:-}"
MODEL="${MODEL:-auto}"
ROUTER_URL="${ROUTER_URL:-https://9router.cortex-ai.my.id/v1}"
SSH_PASSWORD="${SSH_PASSWORD:-}"
TEMPLATE="${TEMPLATE:-hermes-template-v2}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --customer-id) CUSTOMER_ID="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --bot-token) BOT_TOKEN="$2"; shift 2 ;;
    --owner-id) OWNER_ID="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --router-url) ROUTER_URL="$2"; shift 2 ;;
    --ssh-password) SSH_PASSWORD="$2"; shift 2 ;;
    --template) TEMPLATE="$2"; shift 2 ;;
    *) err "Unknown arg: $1" ;;
  esac
done

[ -n "$CUSTOMER_ID" ] || err "Missing --customer-id"
[ -n "$API_KEY" ] || err "Missing --api-key"

CONTAINER_NAME="hermes-${CUSTOMER_ID:0:8}"

# Generate SSH password if not provided
if [ -z "$SSH_PASSWORD" ]; then
  SSH_PASSWORD=$(head -c 12 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 12)
fi

log "Provisioning container: $CONTAINER_NAME"

# ── 1. Launch container from template ─────────────────────────────────
log "Launching from template: $TEMPLATE"
incus launch "$TEMPLATE" "$CONTAINER_NAME"
sleep 5

# ── 2. Setup networking ──────────────────────────────────────────────
log "Setting up network..."
EXISTING=$(incus list -f csv -c n | grep hermes- | wc -l)
IP_SUFFIX=$((100 + EXISTING))
incus exec "$CONTAINER_NAME" -- bash -c "
echo nameserver 8.8.8.8 > /etc/resolv.conf
echo nameserver 1.1.1.1 >> /etc/resolv.conf
ip addr add 10.10.10.${IP_SUFFIX}/24 dev eth0 2>/dev/null || true
ip route add default via 10.10.10.1 2>/dev/null || true
"

# ── 3. Set SSH password ──────────────────────────────────────────────
log "Setting SSH password..."
incus exec "$CONTAINER_NAME" -- bash -c "echo 'hermes:${SSH_PASSWORD}' | chpasswd"

# ── 4. Inject Hermes config ──────────────────────────────────────────
log "Injecting config (model: $MODEL)..."
incus exec "$CONTAINER_NAME" -- bash -c "
cat > /home/hermes/.hermes/config.yaml << YAML
model:
  default: ${MODEL}
  provider: custom
  base_url: ${ROUTER_URL}
  api_key: ${API_KEY}
agent:
  max_turns: 15
  image_input_mode: native
  api_max_retries: 1
  gateway_timeout: 300
display:
  streaming: true
  compact: false
  personality: kawaii
auxiliary:
  vision:
    provider: custom
    model: gc/gemini-2.5-flash
    base_url: ${ROUTER_URL}
    api_key: ${API_KEY}
streaming: true
YAML
chown hermes:hermes /home/hermes/.hermes/config.yaml
"

# ── 5. Setup Telegram bot ────────────────────────────────────────────
if [ -n "$BOT_TOKEN" ] && [ -n "$OWNER_ID" ]; then
  log "Configuring Telegram bot..."

  # Write .env file (Hermes reads via python-dotenv)
  incus exec "$CONTAINER_NAME" -- bash -c "
cat > /home/hermes/.hermes/.env << ENVEOF
TELEGRAM_BOT_TOKEN=${BOT_TOKEN}
TELEGRAM_ALLOWED_USERS=${OWNER_ID}
TELEGRAM_HOME_CHANNEL=${OWNER_ID}
ENVEOF
chown hermes:hermes /home/hermes/.hermes/.env
"

  # Also inline env vars in systemd service
  incus exec "$CONTAINER_NAME" -- bash -c "
cat > /etc/systemd/system/hermes-gateway.service << EOF
[Unit]
Description=Hermes Agent Gateway
After=network.target

[Service]
User=hermes
WorkingDirectory=/home/hermes/.hermes/hermes-agent
Environment=HOME=/home/hermes
Environment=TELEGRAM_BOT_TOKEN=${BOT_TOKEN}
Environment=TELEGRAM_ALLOWED_USERS=${OWNER_ID}
Environment=TELEGRAM_HOME_CHANNEL=${OWNER_ID}
ExecStart=/home/hermes/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main gateway run
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
"
  log "Telegram configured"
fi

# ── 6. Start Hermes gateway ──────────────────────────────────────────
log "Starting Hermes gateway..."
incus exec "$CONTAINER_NAME" -- systemctl start hermes-gateway
sleep 8

# ── 7. Health check ──────────────────────────────────────────────────
log "Health check..."
HERMES_STATUS=$(incus exec "$CONTAINER_NAME" -- systemctl is-active hermes-gateway 2>/dev/null || echo "failed")

# Check if Telegram connected
TG_STATUS="not configured"
if [ -n "$BOT_TOKEN" ]; then
  TG_CONNECTED=$(incus exec "$CONTAINER_NAME" -- grep -c "telegram connected" /home/hermes/.hermes/logs/gateway.log 2>/dev/null | tail -1 || echo "0")
  if [ "${TG_CONNECTED:-0}" -gt 0 ] 2>/dev/null; then
    TG_STATUS="connected"
  else
    TG_STATUS="starting..."
  fi
fi

# ── 8. Output ────────────────────────────────────────────────────────
echo
echo "============================================================"
if [ "$HERMES_STATUS" = "active" ]; then
  log "DONE! Container provisioned."
else
  echo -e "${RED}[!]${NC} Hermes may not have started. Check logs."
fi
echo "============================================================"
echo
echo "  Container:    $CONTAINER_NAME"
echo "  Customer ID:  $CUSTOMER_ID"
echo "  IP:           10.10.10.${IP_SUFFIX}"
echo "  SSH Password: $SSH_PASSWORD"
echo "  API Key:      ${API_KEY:0:15}..."
echo "  Model:        $MODEL"
echo "  Telegram:     $TG_STATUS"
echo "  Status:       $HERMES_STATUS"
echo
echo "  Manage:"
echo "    incus exec $CONTAINER_NAME -- hermes status"
echo "    incus exec $CONTAINER_NAME -- hermes logs"
echo "    incus stop $CONTAINER_NAME   # suspend"
echo "    incus start $CONTAINER_NAME  # resume"
echo "    incus delete $CONTAINER_NAME --force  # destroy"
echo
echo "============================================================"
