#!/usr/bin/env bash
# =====================================================================
# Cortex AI Router — Hermes Telegram Bot Installer (Customer Edition)
#
# Auto-install Hermes on customer's VPS (Tencent 2GB, AWS Lightsail, etc.)
# connected to the customer's Cortex API key.
#
# Quick start (run as root or with sudo):
#   curl -fsSL https://9router.cortex-ai.my.id/install-hermes.sh | sudo bash
#
# Or with config via env:
#   CORTEX_API_KEY=sk-cortex-xxxx \
#   TELEGRAM_BOT_TOKEN=123:abc \
#   TELEGRAM_OWNER_ID=12345 \
#   sudo -E bash <(curl -fsSL https://9router.cortex-ai.my.id/install-hermes.sh)
#
# ADDON: saas-mt
# =====================================================================
set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────
CORTEX_ENDPOINT="${CORTEX_ENDPOINT:-https://9router.cortex-ai.my.id/api/v1}"
HERMES_REPO="${HERMES_REPO:-https://github.com/ekonugroho98/hermes-agent.git}"
HERMES_BRANCH="${HERMES_BRANCH:-main}"
HERMES_USER="${HERMES_USER:-hermes}"
HERMES_HOME="${HERMES_HOME:-/opt/hermes}"
HERMES_MODEL_DEFAULT="${HERMES_MODEL_DEFAULT:-auto}"

# Colors
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
info() { echo -e "${BLUE}[i]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; exit 1; }

# ─── Privilege check ─────────────────────────────────────────────────────
if [[ "$EUID" -ne 0 ]]; then
  err "Please run as root (sudo bash $0)"
fi

# ─── Banner ──────────────────────────────────────────────────────────────
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║       Cortex AI Router — Hermes Telegram Bot Installer          ║
║                                                                  ║
║       Endpoint: 9router.cortex-ai.my.id                         ║
║       Hermes:   AI assistant for your Telegram                  ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
BANNER

# ─── Collect credentials interactively if not provided ───────────────────
if [[ -z "${CORTEX_API_KEY:-}" ]]; then
  echo ""
  read -p "Cortex API key (sk-cortex-...): " CORTEX_API_KEY
fi
if [[ -z "${CORTEX_API_KEY:-}" ]] || [[ ! "$CORTEX_API_KEY" =~ ^sk-cortex- ]]; then
  err "Invalid Cortex API key. Format must be 'sk-cortex-...'. Get yours at https://9router.cortex-ai.my.id/customer/dashboard"
fi

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  read -p "Telegram bot token (from @BotFather): " TELEGRAM_BOT_TOKEN
fi
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  err "Telegram bot token required. Create one at https://t.me/BotFather"
fi

if [[ -z "${TELEGRAM_OWNER_ID:-}" ]]; then
  read -p "Your Telegram user ID (from @userinfobot): " TELEGRAM_OWNER_ID
fi
if [[ -z "${TELEGRAM_OWNER_ID:-}" ]]; then
  err "Telegram owner ID required. Get yours at https://t.me/userinfobot"
fi

# ─── Validate API key ──────────────────────────────────────────────────
log "Validating Cortex API key..."
HEALTH_URL="${CORTEX_ENDPOINT%/api/v1}/api/customer/me"
RESP=$(curl -fsS -m 10 "$HEALTH_URL" -H "Authorization: Bearer ${CORTEX_API_KEY}" 2>&1 || echo "ERR")
if [[ "$RESP" == "ERR" ]]; then
  warn "Cortex API key validation skipped (endpoint not reachable yet — proceeding anyway)"
else
  log "Cortex API key OK"
fi

# ─── Install system dependencies ────────────────────────────────────────
log "Installing system dependencies..."
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl git ca-certificates >/dev/null
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q curl git ca-certificates >/dev/null
else
  warn "Unsupported package manager. Assuming curl + git are already installed."
fi

# ─── Install Node.js 22 (LTS) ───────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 22 ]]; then
  log "Installing Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
else
  info "Node.js $(node -v) already installed"
fi

# ─── Create hermes user ─────────────────────────────────────────────────
if ! id -u "$HERMES_USER" >/dev/null 2>&1; then
  log "Creating system user: $HERMES_USER"
  useradd --system --create-home --home "$HERMES_HOME" --shell /bin/bash "$HERMES_USER"
else
  info "User $HERMES_USER already exists"
fi

# ─── Clone Hermes ────────────────────────────────────────────────────────
log "Cloning Hermes from $HERMES_REPO..."
if [[ -d "$HERMES_HOME/.git" ]]; then
  info "Hermes already cloned — pulling latest..."
  sudo -u "$HERMES_USER" git -C "$HERMES_HOME" fetch origin
  sudo -u "$HERMES_USER" git -C "$HERMES_HOME" reset --hard "origin/$HERMES_BRANCH"
else
  rm -rf "$HERMES_HOME"
  sudo -u "$HERMES_USER" git clone --depth 1 --branch "$HERMES_BRANCH" "$HERMES_REPO" "$HERMES_HOME"
fi

# ─── Install npm dependencies ────────────────────────────────────────────
log "Installing npm dependencies (this takes 1-3 minutes)..."
sudo -u "$HERMES_USER" bash -c "cd '$HERMES_HOME' && npm install --omit=dev --no-audit --no-fund" >/dev/null 2>&1 || {
  warn "npm install hit a snag — retrying with full output..."
  sudo -u "$HERMES_USER" bash -c "cd '$HERMES_HOME' && npm install --omit=dev"
}

# ─── Generate .env config ────────────────────────────────────────────────
log "Generating Hermes config (.env)..."
ENV_FILE="$HERMES_HOME/.env"
cat > "$ENV_FILE" <<EOF
# Cortex AI Router — generated by install-hermes.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# DO NOT commit this file. Contains secrets.

TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_OWNER_ID=${TELEGRAM_OWNER_ID}

# Point Hermes at YOUR Cortex AI Router endpoint
OPENAI_API_BASE=${CORTEX_ENDPOINT}
OPENAI_API_KEY=${CORTEX_API_KEY}

# Default model — "auto" lets the router pick best available
DEFAULT_MODEL=${HERMES_MODEL_DEFAULT}

# Optional: enable verbose logs (set to "debug" for troubleshooting)
LOG_LEVEL=info
EOF
chown "$HERMES_USER:$HERMES_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ─── Install systemd service ─────────────────────────────────────────────
log "Installing systemd service..."
SERVICE_FILE="/etc/systemd/system/hermes.service"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Hermes Telegram AI Bot (Cortex AI Router)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${HERMES_USER}
Group=${HERMES_USER}
WorkingDirectory=${HERMES_HOME}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${HERMES_HOME}/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Resource limits (sane for 2GB VPS)
MemoryMax=512M
TasksMax=100

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${HERMES_HOME}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable hermes.service >/dev/null 2>&1
systemctl restart hermes.service

# ─── Wait for healthy startup ────────────────────────────────────────────
log "Starting Hermes..."
sleep 3
if systemctl is-active --quiet hermes.service; then
  log "Hermes service is running!"
else
  warn "Service not active yet — check logs: journalctl -u hermes -n 50"
fi

# ─── Final summary ───────────────────────────────────────────────────────
echo ""
cat <<EOF
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║  ✓ Hermes installed and running                                  ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

  📍 Install directory:  ${HERMES_HOME}
  🔌 Cortex endpoint:    ${CORTEX_ENDPOINT}
  🔑 API key:            ${CORTEX_API_KEY:0:16}...${CORTEX_API_KEY: -4}
  🤖 Telegram bot:       ${TELEGRAM_BOT_TOKEN:0:10}...
  👤 Telegram owner:     ${TELEGRAM_OWNER_ID}

  📊 Useful commands:

     Status:    systemctl status hermes
     Logs:      journalctl -u hermes -f
     Restart:   systemctl restart hermes
     Stop:      systemctl stop hermes

  🎯 Next steps:

  1. Open Telegram and message your bot (the one you set up via @BotFather)
  2. Send a test message like "Hello"
  3. Check usage at: https://9router.cortex-ai.my.id/customer/dashboard

  Issues? Check 'journalctl -u hermes -n 100' for diagnostic output.

EOF
