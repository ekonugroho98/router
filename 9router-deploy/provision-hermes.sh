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
#     --model "gc/gemini-2.5-flash"
#
# Or via env vars:
#   CUSTOMER_ID=uuid API_KEY=sk-cortex-xxx BOT_TOKEN=7123:AAA... \
#   OWNER_ID=1433 sudo -E bash provision-hermes.sh
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
MODEL="${MODEL:-gc/gemini-2.5-flash}"
ROUTER_URL="${ROUTER_URL:-https://9router.cortex-ai.my.id/v1}"
SSH_PASSWORD="${SSH_PASSWORD:-}"
TEMPLATE="${TEMPLATE:-hermes-template-v1}"

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
# Assign sequential IP based on existing containers
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
incus exec "$CONTAINER_NAME" -- su - hermes -c "
mkdir -p ~/.hermes
cat > ~/.hermes/config.yaml << YAML
model:
  default: ${MODEL}
  provider: custom
  base_url: ${ROUTER_URL}
  api_key: ${API_KEY}
agent:
  max_turns: 30
  image_input_mode: native
  api_max_retries: 2
  gateway_timeout: 1800
auxiliary:
  vision:
    provider: custom
    model: gc/gemini-2.5-flash
    base_url: ${ROUTER_URL}
    api_key: ${API_KEY}
YAML
"

# ── 5. Setup Telegram bot (if provided) ──────────────────────────────
if [ -n "$BOT_TOKEN" ] && [ -n "$OWNER_ID" ]; then
  log "Configuring Telegram bot..."
  incus exec "$CONTAINER_NAME" -- su - hermes -c "
    cd ~/.hermes/hermes-agent
    source venv/bin/activate
    python -c \"
from hermes_cli.config import load_config, save_config
cfg = load_config()
cfg.setdefault('gateway', {})
cfg['gateway']['platform'] = 'telegram'
cfg['gateway']['telegram_token'] = '${BOT_TOKEN}'
cfg['gateway']['telegram_owner_id'] = '${OWNER_ID}'
save_config(cfg)
print('Telegram configured')
\" 2>/dev/null || echo 'Manual telegram config needed'
  "
fi

# ── 6. Start Hermes gateway ──────────────────────────────────────────
log "Starting Hermes gateway..."
incus exec "$CONTAINER_NAME" -- systemctl start hermes-gateway
sleep 3

# ── 7. Health check ──────────────────────────────────────────────────
log "Health check..."
HERMES_STATUS=$(incus exec "$CONTAINER_NAME" -- systemctl is-active hermes-gateway 2>/dev/null || echo "failed")

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
echo "  SSH:          ssh hermes@<host> -p <port>"
echo "  SSH Password: $SSH_PASSWORD"
echo "  API Key:      ${API_KEY:0:15}..."
echo "  Model:        $MODEL"
echo "  Bot Token:    ${BOT_TOKEN:+configured}"
echo "  Status:       $HERMES_STATUS"
echo
echo "  Manage:"
echo "    incus exec $CONTAINER_NAME -- hermes status"
echo "    incus exec $CONTAINER_NAME -- hermes logs"
echo "    incus exec $CONTAINER_NAME -- hermes restart"
echo "    incus stop $CONTAINER_NAME   # suspend"
echo "    incus start $CONTAINER_NAME  # resume"
echo "    incus delete $CONTAINER_NAME --force  # destroy"
echo
echo "============================================================"
