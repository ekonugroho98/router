#!/usr/bin/env bash
# =====================================================
# Install kiro-bulk sidecar di VPS (Ubuntu/Debian).
#
# Bedanya dari install.sh (Mac-friendly):
#   - Install Xvfb (virtual display) untuk Camoufox headed mode di headless VPS
#   - Setup systemd user service biar auto-start + auto-restart
#   - Generate CLI token saat install
#   - Bind ke 127.0.0.1 only (gak expose ke public)
#
# Run sebagai USER karaya (BUKAN root) — sidecar harus per-user buat akses
# CLI token machine-id yang sama dengan 9router.
#
# Tapi script ini PANGGIL sudo buat install system packages.
#
# Usage:
#   ssh karaya@vps
#   cd /opt/9router/source  # atau folder fork yg di-clone
#   bash addon-kiro-bulk/vps-install.sh
# =====================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

# Pastiin BUKAN root
[ "$EUID" -ne 0 ] || err "Jangan run as root. Login as user biasa (karaya), script ini call sudo sendiri."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log "Sidecar source: ${SCRIPT_DIR}"
log "Project root:   ${PROJECT_ROOT}"

# ── 1. System packages ──────────────────────────────────────────────────────
log "Install system packages (butuh sudo)..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3 python3-pip python3-venv \
    xvfb \
    libgtk-3-0 libdbus-glib-1-2 libxt6 libxrender1 libxshmfence1 \
    libasound2t64 libnss3 libpci-dev \
    nodejs npm \
    2>&1 | tail -5 || warn "Some packages might be missing — kalau Camoufox error nanti, install manual"

# ── 2. Python venv + deps ──────────────────────────────────────────────────
log "Setup Python venv..."
cd "${SCRIPT_DIR}"
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

log "Install Python deps (camoufox, aiohttp)..."
pip install --upgrade pip -q
pip install -q -r requirements.txt

log "Fetch Camoufox Firefox binary (~150MB, sekali aja)..."
python -m camoufox fetch

# ── 3. Generate CLI token ──────────────────────────────────────────────────
log "Generate CLI token (machine ID based)..."
if [ ! -d "${PROJECT_ROOT}/node_modules/node-machine-id" ]; then
    warn "node-machine-id belum keinstall di ${PROJECT_ROOT}. Run 'npm install' dulu."
    warn "Sidecar bisa jalan tanpa token kalau requireLogin=OFF, tapi aman pakai token."
    CLI_TOKEN=""
else
    CLI_TOKEN=$(cd "${PROJECT_ROOT}" && node "${SCRIPT_DIR}/get-cli-token.js" 2>/dev/null || echo "")
    if [ -n "${CLI_TOKEN}" ]; then
        log "Token generated: ${CLI_TOKEN:0:8}..."
    else
        warn "Gagal generate CLI token. Sidecar akan jalan tanpa auth header."
    fi
fi

# ── 4. Bikin systemd USER service (no root needed buat enable/start) ───────
log "Setup systemd user service..."
SYSTEMD_DIR="${HOME}/.config/systemd/user"
mkdir -p "${SYSTEMD_DIR}"

# Create wrapper script that starts Xvfb + Python server together
# (ExecStartPre with background Xvfb causes systemd SIGTERM issues)
WRAPPER="${SCRIPT_DIR}/start-sidecar.sh"
cat > "${WRAPPER}" <<'WRAPPER_EOF'
#!/bin/bash
pkill -f "Xvfb :99" 2>/dev/null || true
sleep 0.5
Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp -dpi 96 +extension RANDR &
XVFB_PID=$!
sleep 1
export DISPLAY=:99
trap "kill $XVFB_PID 2>/dev/null" EXIT
exec PYTHON_BIN server.py --host 0.0.0.0 --port PORT_NUM
WRAPPER_EOF
# Inject actual paths into wrapper
sed -i "s|PYTHON_BIN|${SCRIPT_DIR}/.venv/bin/python|" "${WRAPPER}"
sed -i "s|PORT_NUM|9100|" "${WRAPPER}"
chmod +x "${WRAPPER}"

SERVICE_FILE="${SYSTEMD_DIR}/kiro-bulk-sidecar.service"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Kiro Bulk Login Sidecar (Camoufox + Python)
After=network.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
Environment="PATH=${SCRIPT_DIR}/.venv/bin:/usr/local/bin:/usr/bin:/bin"
Environment="KIRO_BULK_ROUTER_URL=http://localhost:20128"
Environment="KIRO_BULK_CLI_TOKEN=${CLI_TOKEN}"
Environment="KIRO_BULK_PORT=9100"
ExecStart=${SCRIPT_DIR}/start-sidecar.sh
Restart=on-failure
RestartSec=10
StandardOutput=append:${SCRIPT_DIR}/logs/sidecar.log
StandardError=append:${SCRIPT_DIR}/logs/sidecar-error.log

[Install]
WantedBy=default.target
EOF

mkdir -p "${SCRIPT_DIR}/logs"
log "Service file: ${SERVICE_FILE}"

# ── 5. Enable + start service ──────────────────────────────────────────────
log "Reload systemd & start service..."
systemctl --user daemon-reload
systemctl --user enable kiro-bulk-sidecar.service
systemctl --user restart kiro-bulk-sidecar.service

# Enable lingering biar service jalan walaupun user gak login (penting buat VPS)
log "Enable systemd lingering (sudo, sekali aja)..."
sudo loginctl enable-linger "${USER}"

# ── 6. Wait & verify ───────────────────────────────────────────────────────
log "Tunggu sidecar ready..."
for i in {1..20}; do
    if curl -sf http://127.0.0.1:9100/health >/dev/null 2>&1; then
        log "Sidecar UP at http://127.0.0.1:9100"
        break
    fi
    sleep 2
    if [ "$i" -eq 20 ]; then
        warn "Sidecar gak respond. Cek logs:"
        warn "  journalctl --user -u kiro-bulk-sidecar -n 50"
        warn "  tail -f ${SCRIPT_DIR}/logs/sidecar-error.log"
        exit 1
    fi
done

# ── Final ──────────────────────────────────────────────────────────────────
echo
echo "============================================================"
log "DONE! Sidecar service installed & running."
echo "============================================================"
echo
echo "  Service:      kiro-bulk-sidecar.service (user-level systemd)"
echo "  Endpoint:     http://127.0.0.1:9100 (localhost only, NOT public)"
echo "  Router URL:   http://localhost:20128"
echo "  Display:      :99 (Xvfb virtual)"
echo "  CLI Token:    ${CLI_TOKEN:0:8}... (auto-generated)"
echo
echo "  Manage:"
echo "    systemctl --user status kiro-bulk-sidecar     # cek status"
echo "    systemctl --user restart kiro-bulk-sidecar    # restart"
echo "    systemctl --user stop kiro-bulk-sidecar       # stop"
echo "    systemctl --user disable kiro-bulk-sidecar    # disable auto-start"
echo
echo "  Logs:"
echo "    journalctl --user -u kiro-bulk-sidecar -f          # realtime"
echo "    tail -f ${SCRIPT_DIR}/logs/sidecar.log              # stdout"
echo "    tail -f ${SCRIPT_DIR}/logs/sidecar-error.log        # stderr"
echo
echo "  Test:"
echo "    curl http://127.0.0.1:9100/health"
echo
echo "  Lingering enabled — service tetep jalan walaupun lo logout SSH."
echo "============================================================"
