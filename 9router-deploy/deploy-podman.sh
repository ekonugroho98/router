#!/usr/bin/env bash
# =====================================================
# Deploy 9router via PODMAN (rootless, daemon-less).
#
# Pros vs Docker:
#   - Rootless by default → security better
#   - No daemon → save ~30-50MB RAM
#   - Native systemd integration via quadlet
#   - Same Dockerfile works (OCI standard)
#
# Pros vs PM2 Native:
#   - Reproducible builds (containerize semua deps)
#   - Easy upgrade (rebuild image, swap)
#   - Auto-managed via systemd user service
#
# Run as user (karaya), bukan root. Script panggil sudo cuma buat install Podman.
# =====================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ekonugroho98/router.git}"
BRANCH="${BRANCH:-master}"
INSTALL_DIR="${HOME}/router-fork"
DATA_DIR="${HOME}/9router-data"  # rootless = pakai $HOME, bukan /var/lib/
APP_PORT=20128
ENV_FILE="/opt/9router/.env"
CONTAINER_NAME="9router"
IMAGE_NAME="localhost/9router"
IMAGE_TAG="latest"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

[ "$EUID" -ne 0 ] || err "Run as user (karaya), bukan root. Podman = rootless."

# ── 1. Install Podman kalau belum ada ──────────────────────────────────────
if ! command -v podman &>/dev/null; then
    log "Install Podman..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq podman uidmap slirp4netns fuse-overlayfs
fi
log "Podman: $(podman --version)"

# ── 2. Enable lingering biar service tetep jalan tanpa SSH ─────────────────
log "Enable user lingering (systemd run tanpa SSH login)..."
sudo loginctl enable-linger "${USER}" 2>/dev/null || true

# ── 3. Stop Docker 9router kalau ada (port conflict) ───────────────────────
if command -v docker &>/dev/null; then
    if docker ps --filter name=9router --filter status=running -q 2>/dev/null | grep -q .; then
        warn "Detected Docker container '9router' running. Stop dulu?"
        read -p "  Stop Docker 9router? (y/N): " -n 1 -r; echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo docker stop 9router && sudo docker rm 9router
            log "Docker 9router stopped & removed"
            warn "Container hapus, tapi DATA aman di volume Docker. Kalau mau migrate ke Podman:"
            warn "  sudo docker run --rm -v /var/lib/9router-data:/from -v ${DATA_DIR}:/to alpine cp -av /from/. /to/"
        else
            err "Port ${APP_PORT} masih dipake Docker"
        fi
    fi
fi

# ── 4. Migrate data dari Docker volume kalau perlu ─────────────────────────
mkdir -p "${DATA_DIR}"
if [ -d "/var/lib/9router-data" ] && [ -z "$(ls -A ${DATA_DIR} 2>/dev/null)" ]; then
    log "Migrate data dari /var/lib/9router-data → ${DATA_DIR}..."
    sudo cp -av /var/lib/9router-data/. "${DATA_DIR}/" 2>&1 | tail -5
    sudo chown -R "$(id -u):$(id -g)" "${DATA_DIR}"
    log "Data migrated. Original /var/lib/9router-data masih ada sebagai backup."
fi

# ── 5. Clone/update fork ───────────────────────────────────────────────────
if [ -d "${INSTALL_DIR}" ]; then
    log "Update fork..."
    cd "${INSTALL_DIR}"
    git fetch origin && git checkout "${BRANCH}" && git reset --hard "origin/${BRANCH}"
else
    log "Clone fork..."
    git clone --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
fi
cd "${INSTALL_DIR}"
log "Commit: $(git log -1 --oneline)"

# ── 6. Build image ─────────────────────────────────────────────────────────
log "Build image (3-5 menit)..."
podman build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

# ── 7. Stop existing Podman container ──────────────────────────────────────
podman stop "${CONTAINER_NAME}" 2>/dev/null || true
podman rm "${CONTAINER_NAME}" 2>/dev/null || true

# ── 8. Run container (rootless) ────────────────────────────────────────────
log "Start Podman container (rootless)..."

# Note: rootless podman bind mount = SElinux context handled via :Z
# Tapi Ubuntu gak SELinux jadi gak perlu :Z. Tetap include buat compat.
podman run -d \
    --name "${CONTAINER_NAME}" \
    --restart on-failure:5 \
    -p 127.0.0.1:${APP_PORT}:${APP_PORT} \
    --env-file "${ENV_FILE}" \
    -v "${DATA_DIR}":/app/data:Z \
    -v "${HOME}/.9router-usage":/root/.9router:Z \
    "${IMAGE_NAME}:${IMAGE_TAG}"

# ── 9. Generate systemd user service ───────────────────────────────────────
log "Generate systemd user service..."
mkdir -p "${HOME}/.config/systemd/user"
cd "${HOME}/.config/systemd/user"
podman generate systemd --new --name "${CONTAINER_NAME}" --files

# Format: container-9router.service
SYSTEMD_FILE="container-${CONTAINER_NAME}.service"
log "Service: ${SYSTEMD_FILE}"

systemctl --user daemon-reload
systemctl --user enable "${SYSTEMD_FILE}"

# Test reload via systemd (lebih reliable daripada manual `podman run`)
log "Restart via systemd buat verify..."
systemctl --user restart "${SYSTEMD_FILE}"

# ── 10. Wait & verify ──────────────────────────────────────────────────────
log "Tunggu container ready..."
for i in {1..30}; do
    if curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
        log "Container UP"
        break
    fi
    sleep 2
    [ "$i" -eq 30 ] && err "Container gak respond setelah 60s. Cek: podman logs ${CONTAINER_NAME}"
done

# ── Final ──────────────────────────────────────────────────────────────────
echo
echo "============================================================"
log "PODMAN DEPLOYMENT DONE (rootless)"
echo "============================================================"
echo
echo "  User:         $(whoami) (rootless)"
echo "  Container:    ${CONTAINER_NAME}"
echo "  Image:        ${IMAGE_NAME}:${IMAGE_TAG}"
echo "  Data dir:     ${DATA_DIR} (user-owned, no sudo needed)"
echo "  Service:      ${SYSTEMD_FILE}"
echo
echo "  Manage (no sudo!):"
echo "    podman ps                              # list containers"
echo "    podman logs -f ${CONTAINER_NAME}      # logs realtime"
echo "    podman exec -it ${CONTAINER_NAME} sh  # shell"
echo "    podman stats ${CONTAINER_NAME}        # CPU + RAM live"
echo
echo "    systemctl --user status ${SYSTEMD_FILE}"
echo "    systemctl --user restart ${SYSTEMD_FILE}"
echo "    journalctl --user -u ${SYSTEMD_FILE} -f"
echo
echo "  Update fork:"
echo "    cd ${INSTALL_DIR} && git pull && podman build -t ${IMAGE_NAME}:${IMAGE_TAG} ."
echo "    systemctl --user restart ${SYSTEMD_FILE}"
echo
echo "  Memory check:"
echo "    podman stats ${CONTAINER_NAME} --no-stream"
echo
echo "============================================================"
