#!/usr/bin/env bash
# =====================================================
# Backup full 9router state + sidecar config buat migration ke server lain.
#
# Yang di-backup:
#   - 9router DB & config (/var/lib/9router-data, /opt/9router/.env)
#   - Docker volumes (9router-usage)
#   - Nginx config & SSL certs
#   - Sidecar config (~/.config/systemd/user/, addon-kiro-bulk session data)
#
# Output: timestamped tarball siap di-restore di server baru.
#
# Usage di HK server:
#   bash backup-for-migration.sh
# Output: ~/9router-migration-YYYYMMDD-HHMMSS.tar.gz
# =====================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$(mktemp -d)"
OUTPUT="${HOME}/9router-migration-${TIMESTAMP}.tar.gz"

log "Building backup in ${BACKUP_DIR}..."

# ── 1. 9router data + config ──────────────────────────────────────────────
log "Backup 9router data..."
if [ -d /var/lib/9router-data ]; then
    sudo cp -a /var/lib/9router-data "${BACKUP_DIR}/9router-data"
    sudo chown -R "$(id -u):$(id -g)" "${BACKUP_DIR}/9router-data"
    log "  ✓ /var/lib/9router-data ($(du -sh ${BACKUP_DIR}/9router-data | cut -f1))"
fi

if [ -f /opt/9router/.env ]; then
    sudo cp /opt/9router/.env "${BACKUP_DIR}/9router.env"
    sudo chown "$(id -u):$(id -g)" "${BACKUP_DIR}/9router.env"
    chmod 600 "${BACKUP_DIR}/9router.env"
    log "  ✓ /opt/9router/.env"
fi

# ── 2. Docker named volume (usage history) ────────────────────────────────
if docker volume inspect 9router-usage >/dev/null 2>&1; then
    log "Backup Docker volume 9router-usage..."
    docker run --rm \
        -v 9router-usage:/source:ro \
        -v "${BACKUP_DIR}":/backup \
        alpine tar czf /backup/9router-usage.tar.gz -C /source . 2>/dev/null
    log "  ✓ Docker volume → ${BACKUP_DIR}/9router-usage.tar.gz"
fi

# ── 3. Nginx config ───────────────────────────────────────────────────────
NGINX_SITE="/etc/nginx/sites-available/9router.cortex-ai.my.id"
if [ -f "${NGINX_SITE}" ]; then
    log "Backup Nginx config..."
    sudo cp "${NGINX_SITE}" "${BACKUP_DIR}/nginx-9router.conf"
    sudo chown "$(id -u):$(id -g)" "${BACKUP_DIR}/nginx-9router.conf"
    log "  ✓ Nginx site config"
fi

# ── 4. SSL certs (Let's Encrypt) ──────────────────────────────────────────
SSL_DIR="/etc/letsencrypt"
if [ -d "${SSL_DIR}" ]; then
    log "Backup SSL certs (Let's Encrypt)..."
    sudo tar czf "${BACKUP_DIR}/letsencrypt.tar.gz" -C / etc/letsencrypt 2>/dev/null
    sudo chown "$(id -u):$(id -g)" "${BACKUP_DIR}/letsencrypt.tar.gz"
    log "  ✓ /etc/letsencrypt"
    warn "  Catatan: cert akan re-issue di US server (Let's Encrypt validate per-domain per-IP). Backup ini cuma reference."
fi

# ── 5. Sidecar config + sessions ──────────────────────────────────────────
if [ -d "${HOME}/.kiro-bulk" ]; then
    log "Backup sidecar sessions..."
    tar czf "${BACKUP_DIR}/kiro-bulk-sessions.tar.gz" -C "${HOME}" .kiro-bulk 2>/dev/null
    log "  ✓ ~/.kiro-bulk ($(du -sh ${HOME}/.kiro-bulk | cut -f1))"
fi

if [ -f "${HOME}/.config/systemd/user/kiro-bulk-sidecar.service" ]; then
    cp "${HOME}/.config/systemd/user/kiro-bulk-sidecar.service" \
       "${BACKUP_DIR}/kiro-bulk-sidecar.service"
    log "  ✓ systemd user service"
fi

# ── 6. Hermes config (kalau ada) ──────────────────────────────────────────
if [ -d "${HOME}/.hermes" ]; then
    log "Backup Hermes config (sebagian — exclude session DB besar)..."
    tar czf "${BACKUP_DIR}/hermes-config.tar.gz" \
        --exclude="state.db*" \
        --exclude="sessions" \
        --exclude="cache" \
        --exclude="audio_cache" \
        --exclude="image_cache" \
        -C "${HOME}" .hermes 2>/dev/null
    log "  ✓ ~/.hermes (excluding heavy state.db)"
fi

# ── 7. Manifest (apa aja yang di-backup) ──────────────────────────────────
cat > "${BACKUP_DIR}/MANIFEST.txt" <<EOF
9router Migration Backup
Created: $(date)
Source server: $(hostname)
Source IP: $(curl -s --max-time 5 ifconfig.me 2>/dev/null || echo "unknown")
Source OS: $(grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '"')

Contents:
$(ls -la "${BACKUP_DIR}/")

Restore instructions:
  1. Upload tarball ke server baru
  2. tar xzf 9router-migration-*.tar.gz
  3. bash restore-from-migration.sh   # bakal handle restore otomatis
EOF

# ── 8. Build final tarball ────────────────────────────────────────────────
log "Build final tarball..."
cd "$(dirname ${BACKUP_DIR})"
tar czf "${OUTPUT}" -C "${BACKUP_DIR}" .

# Cleanup
rm -rf "${BACKUP_DIR}"

SIZE=$(du -h "${OUTPUT}" | cut -f1)

echo
echo "============================================================"
log "BACKUP DONE!"
echo "============================================================"
echo
echo "  File:  ${OUTPUT}"
echo "  Size:  ${SIZE}"
echo
echo "  Contents preview:"
tar tzf "${OUTPUT}" | head -20
echo "  ..."
echo
echo "  Cara pindah ke US server:"
echo "    scp ${OUTPUT} karaya@US-SERVER-IP:~/"
echo
echo "  Di US server (setelah deploy fresh dulu pake deploy-fork-full.sh):"
echo "    tar xzf 9router-migration-*.tar.gz -C /tmp/migration"
echo "    bash /tmp/migration/MANIFEST.txt  # ikuti instruksi"
echo
echo "============================================================"
