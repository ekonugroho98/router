#!/usr/bin/env bash
# =====================================================
# Deploy 9router NATIVE di VPS (no Docker, pakai PM2).
#
# Pros vs Docker:
#   - ~50MB RAM lebih ringan (no container runtime overhead)
#   - Startup lebih cepat (~2s vs ~5s)
#   - Direct access ke DATA_DIR di host
#   - PM2 logs lebih gampang baca
#
# Cons vs Docker:
#   - Manual dependency management (Node version, native deps)
#   - Upgrade lebih ribet (git pull + npm install + restart)
#   - Kurang isolasi dari sistem
#
# Run sebagai user biasa (karaya). Script call sudo sendiri.
# =====================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ekonugroho98/router.git}"
BRANCH="${BRANCH:-master}"
INSTALL_DIR="${HOME}/router-fork"
DATA_DIR="/var/lib/9router-data"
APP_PORT=20128

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

[ "$EUID" -ne 0 ] || err "Run as user biasa (karaya), bukan root"

# ── 1. Node 22 LTS (9router butuh Node 20+) ────────────────────────────────
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
    log "Install Node 22 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
log "Node: $(node -v), npm: $(npm -v)"

# ── 2. PM2 (process manager) ───────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
    log "Install PM2 globally..."
    sudo npm install -g pm2
fi

# ── 3. Stop existing Docker container (kalau ada) ──────────────────────────
if docker ps --filter name=9router --filter status=running -q 2>/dev/null | grep -q .; then
    warn "Detected Docker 9router running — stop dulu sebelum lanjut?"
    read -p "  Stop & remove Docker container? (y/N): " -n 1 -r; echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo docker stop 9router
        sudo docker rm 9router
        log "Docker container stopped & removed"
    else
        err "Cannot continue while Docker 9router uses port ${APP_PORT}"
    fi
fi

# ── 4. Clone/update fork ───────────────────────────────────────────────────
if [ -d "${INSTALL_DIR}" ]; then
    log "Update existing clone..."
    cd "${INSTALL_DIR}"
    git fetch origin && git checkout "${BRANCH}" && git reset --hard "origin/${BRANCH}"
else
    log "Clone fork..."
    git clone --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
fi
cd "${INSTALL_DIR}"

# ── 5. Install deps + build ────────────────────────────────────────────────
log "npm install (3-5 menit)..."
npm install --no-audit --no-fund 2>&1 | tail -10

log "npm run build..."
npm run build 2>&1 | tail -5

# ── 6. Setup DATA_DIR (preserve old data kalau ada) ────────────────────────
sudo mkdir -p "${DATA_DIR}"
sudo chown -R "$(id -u):$(id -g)" "${DATA_DIR}"
log "DATA_DIR: ${DATA_DIR}"

# ── 7. Load env vars dari /opt/9router/.env (yang dibuat deploy.sh awal) ───
ENV_FILE="/opt/9router/.env"
if [ ! -f "${ENV_FILE}" ]; then
    err ".env gak ada di ${ENV_FILE}. Run deploy.sh awal dulu buat generate."
fi

# ── 8. Start dengan PM2 ────────────────────────────────────────────────────
log "Stop existing PM2 process kalau ada..."
pm2 delete 9router 2>/dev/null || true

log "Start 9router via PM2..."
# Load env file ke PM2
export $(grep -v '^#' "${ENV_FILE}" | xargs)
export DATA_DIR="${DATA_DIR}"

cd "${INSTALL_DIR}"
PORT=${APP_PORT} HOSTNAME=127.0.0.1 \
    pm2 start npm --name 9router -- run start

pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$(whoami)" --hp "${HOME}" 2>&1 | tail -3 || \
    warn "PM2 startup script gagal — manual: sudo pm2 startup"

# ── 9. Verify ──────────────────────────────────────────────────────────────
log "Tunggu 9router ready..."
for i in {1..20}; do
    if curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
        log "9router UP"
        break
    fi
    sleep 2
done

echo
echo "============================================================"
log "9router NATIVE deployed via PM2"
echo "============================================================"
echo
echo "  Source:       ${INSTALL_DIR}"
echo "  DATA_DIR:     ${DATA_DIR}"
echo "  Endpoint:     http://127.0.0.1:${APP_PORT}"
echo
echo "  PM2 commands:"
echo "    pm2 status                       # cek semua process"
echo "    pm2 logs 9router                 # logs realtime"
echo "    pm2 restart 9router              # restart"
echo "    pm2 stop 9router                 # stop"
echo "    pm2 monit                        # CPU + RAM live"
echo
echo "  Update fork:"
echo "    cd ${INSTALL_DIR}"
echo "    git pull && npm install && npm run build"
echo "    pm2 restart 9router"
echo "============================================================"
