#!/usr/bin/env bash
# =====================================================
# Master deploy script — full fork deployment ke VPS.
#
# Yang dilakuin:
#   1. Pull fork source dari GitHub
#   2. Build & replace Docker container (preserve data)
#   3. npm install (untuk node-machine-id buat CLI token)
#   4. Install sidecar (Python venv + Camoufox + Xvfb + systemd)
#   5. Verify semua running
#
# Jalanin di VPS sebagai user biasa (karaya). Script call sudo sendiri.
#
# Usage:
#   ssh karaya@vps
#   bash <(curl -fsSL https://raw.githubusercontent.com/ekonugroho98/router/master/9router-deploy/deploy-fork-full.sh)
# =====================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ekonugroho98/router.git}"
BRANCH="${BRANCH:-master}"
INSTALL_DIR="${HOME}/router-fork"   # source code clone location

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
hdr()  { echo -e "\n${BLUE}═══ $* ═══${NC}"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

[ "$EUID" -ne 0 ] || err "Jangan run as root. Login as user biasa, script call sudo sendiri."

hdr "Pre-flight"
log "Repo: ${REPO_URL} (${BRANCH})"
log "Install dir: ${INSTALL_DIR}"
log "User: $(whoami)"

# Cek prerequisite
for cmd in git docker curl; do
    command -v "${cmd}" &>/dev/null || err "${cmd} not installed. Run 9router-deploy/deploy.sh dulu."
done

# ─── Phase 1: Clone fork ──────────────────────────────────────────────────
hdr "Phase 1: Clone fork"
if [ -d "${INSTALL_DIR}" ]; then
    log "Update existing clone..."
    cd "${INSTALL_DIR}"
    git fetch origin
    git checkout "${BRANCH}"
    git reset --hard "origin/${BRANCH}"
else
    log "Clone fresh..."
    git clone --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"
log "Latest commit: $(git log -1 --oneline)"

# ─── Phase 2: Switch Docker container ─────────────────────────────────────
hdr "Phase 2: Switch 9router container ke fork"
sudo bash "${INSTALL_DIR}/9router-deploy/switch-to-fork.sh"

# ─── Phase 3: npm install (buat node-machine-id) ──────────────────────────
hdr "Phase 3: npm install (sebagian buat get-cli-token.js)"
# Cek apakah node ada
if ! command -v node &>/dev/null; then
    log "Install Node.js..."
    sudo apt-get install -y -qq nodejs npm
fi

log "npm install di ${INSTALL_DIR}..."
cd "${INSTALL_DIR}"
# Pakai --omit=optional --omit=dev biar lebih cepet (kita cuma butuh node-machine-id buat token)
npm install --omit=optional --omit=dev --no-audit --no-fund 2>&1 | tail -10 || \
    warn "npm install ada warning — kalau cuma about peer deps, abaikan"

# ─── Phase 4: Install sidecar ─────────────────────────────────────────────
hdr "Phase 4: Install sidecar (Python + Camoufox + Xvfb + systemd)"
bash "${INSTALL_DIR}/addon-kiro-bulk/vps-install.sh"

# ─── Phase 5: Verify ──────────────────────────────────────────────────────
hdr "Phase 5: Verify"
log "9router container:"
docker ps --filter name=9router --format "  - {{.Names}}: {{.Status}} ({{.Image}})"

log "Sidecar service:"
systemctl --user is-active kiro-bulk-sidecar && echo "  - kiro-bulk-sidecar: active"

log "Test sidecar health..."
curl -s http://127.0.0.1:9100/health | python3 -m json.tool || warn "Sidecar health gak respond"

log "Test 9router localhost..."
curl -sI http://localhost:20128/ | head -3

echo
echo "============================================================"
log "DEPLOYMENT FORK SELESAI"
echo "============================================================"
echo
echo "  Dashboard: https://9router.cortex-ai.my.id/dashboard"
echo "  Versi:     $(docker exec 9router cat package.json 2>/dev/null | grep version | head -1 || echo '?')"
echo
echo "  Buka dashboard → Providers → Kiro AI → klik 'Bulk Add'"
echo "  Sidecar bakal handle browser automation di VPS dengan Xvfb."
echo
echo "  Manage sidecar:"
echo "    systemctl --user status kiro-bulk-sidecar"
echo "    journalctl --user -u kiro-bulk-sidecar -f"
echo
echo "  Update fork ke versi terbaru:"
echo "    cd ${INSTALL_DIR} && git pull && bash 9router-deploy/deploy-fork-full.sh"
echo "============================================================"
