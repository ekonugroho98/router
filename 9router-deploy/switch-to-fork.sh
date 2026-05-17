#!/usr/bin/env bash
# =====================================================
# Switch VPS 9router dari decolua/9router → ekonugroho98/router fork
#
# Preserves: data volumes, .env, SSL certs, Nginx config
# Rebuild: Docker image dari fork repo
#
# Jalanin di VPS:
#   curl -fsSL https://raw.githubusercontent.com/ekonugroho98/router/master/9router-deploy/switch-to-fork.sh | sudo bash
# Atau upload + run:
#   scp switch-to-fork.sh karaya@vps:~/
#   ssh karaya@vps "sudo bash ~/switch-to-fork.sh"
# =====================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ekonugroho98/router.git}"
BRANCH="${BRANCH:-master}"
APP_DIR="/opt/9router"
DATA_DIR_HOST="/var/lib/9router-data"
CONTAINER_NAME="9router"
IMAGE_NAME="9router"
IMAGE_TAG="latest"
APP_PORT="20128"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

[ "$EUID" -eq 0 ] || err "Run as root (sudo bash $0)"

log "Switching 9router → fork: ${REPO_URL} (${BRANCH})"

# ── 1. Backup current image (rollback insurance) ───────────────────────────
log "Backup current image as 'backup'..."
docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${IMAGE_NAME}:backup-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || \
    warn "No existing image to backup"

# ── 2. Clone fork ──────────────────────────────────────────────────────────
log "Clone fork from ${REPO_URL}..."
rm -rf /tmp/router-fork
git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" /tmp/router-fork

# ── 3. Build new image from fork ───────────────────────────────────────────
log "Build Docker image (3-5 menit)..."
cd /tmp/router-fork
docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

# ── 4. Stop & remove old container ─────────────────────────────────────────
log "Stop old container..."
docker stop "${CONTAINER_NAME}" 2>/dev/null || warn "No running container"
docker rm "${CONTAINER_NAME}" 2>/dev/null || true
fuser -k ${APP_PORT}/tcp 2>/dev/null || true

# ── 5. Run new container (preserve volumes & env) ──────────────────────────
log "Start new container from fork image..."
docker run -d \
    --name "${CONTAINER_NAME}" \
    --restart unless-stopped \
    -p 127.0.0.1:${APP_PORT}:${APP_PORT} \
    --env-file "${APP_DIR}/.env" \
    -v "${DATA_DIR_HOST}":/app/data \
    -v 9router-usage:/root/.9router \
    "${IMAGE_NAME}:${IMAGE_TAG}"

# ── 6. Wait & verify ───────────────────────────────────────────────────────
log "Tunggu container ready..."
for i in {1..30}; do
    if curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
        log "Container responsive!"
        break
    fi
    sleep 2
    [ "$i" -eq 30 ] && err "Container gak respond setelah 60s. Cek: docker logs ${CONTAINER_NAME}"
done

# ── 7. Cleanup ─────────────────────────────────────────────────────────────
log "Cleanup temp..."
rm -rf /tmp/router-fork

# ── Final ──────────────────────────────────────────────────────────────────
echo
echo "============================================================"
log "DONE! 9router switched to fork."
echo "============================================================"
echo
echo "  Container:    ${CONTAINER_NAME}"
echo "  Image:        ${IMAGE_NAME}:${IMAGE_TAG}"
echo "  Source:       ${REPO_URL} (${BRANCH})"
echo "  Dashboard:    https://9router.cortex-ai.my.id/dashboard"
echo
echo "  Verify version:"
echo "    docker exec ${CONTAINER_NAME} cat package.json | grep version"
echo
echo "  Logs:"
echo "    docker logs -f ${CONTAINER_NAME}"
echo
echo "  Rollback (kalau perlu):"
echo "    docker stop ${CONTAINER_NAME} && docker rm ${CONTAINER_NAME}"
echo "    docker tag ${IMAGE_NAME}:backup-XXXX ${IMAGE_NAME}:latest"
echo "    sudo bash ${APP_DIR}/deploy.sh  # rerun deploy with backup image"
echo
echo "============================================================"
