#!/usr/bin/env bash
# =====================================================
# Restore 9router data dari backup tarball ke server baru.
#
# Prerequisites di server baru:
#   - deploy-fork-full.sh udah dijalanin (Docker container running, sidecar installed)
#   - User same as source (karaya), atau sesuaikan
#
# Usage:
#   tar xzf 9router-migration-XXXX.tar.gz -C /tmp/migration
#   bash /tmp/migration/restore-from-migration.sh
# =====================================================
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

# Cari directory yang punya MANIFEST.txt
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "${SCRIPT_DIR}/MANIFEST.txt" ]; then
    err "Run dari folder hasil extract tarball (yang ada MANIFEST.txt)"
fi

log "Migration manifest:"
cat "${SCRIPT_DIR}/MANIFEST.txt" | head -10

read -p "Lanjut restore? (y/N): " -n 1 -r; echo
[[ $REPLY =~ ^[Yy]$ ]] || exit 0

# ── 1. Stop 9router container (preserve state restore) ────────────────────
log "Stop 9router container untuk restore data..."
sudo docker stop 9router 2>/dev/null || warn "Container not running"

# ── 2. Restore 9router data ───────────────────────────────────────────────
if [ -d "${SCRIPT_DIR}/9router-data" ]; then
    log "Restore /var/lib/9router-data..."
    sudo rm -rf /var/lib/9router-data
    sudo cp -a "${SCRIPT_DIR}/9router-data" /var/lib/9router-data
    sudo chown -R 1000:1000 /var/lib/9router-data  # match container UID
    log "  ✓ Restored"
fi

if [ -f "${SCRIPT_DIR}/9router.env" ]; then
    log "Restore /opt/9router/.env..."
    sudo mkdir -p /opt/9router
    sudo cp "${SCRIPT_DIR}/9router.env" /opt/9router/.env
    sudo chmod 600 /opt/9router/.env
    log "  ✓ Restored"
fi

# ── 3. Restore Docker volume ──────────────────────────────────────────────
if [ -f "${SCRIPT_DIR}/9router-usage.tar.gz" ]; then
    log "Restore Docker volume 9router-usage..."
    docker volume create 9router-usage >/dev/null
    docker run --rm \
        -v 9router-usage:/target \
        -v "${SCRIPT_DIR}":/backup:ro \
        alpine sh -c "cd /target && tar xzf /backup/9router-usage.tar.gz"
    log "  ✓ Restored"
fi

# ── 4. Sidecar sessions ───────────────────────────────────────────────────
if [ -f "${SCRIPT_DIR}/kiro-bulk-sessions.tar.gz" ]; then
    log "Restore sidecar sessions..."
    tar xzf "${SCRIPT_DIR}/kiro-bulk-sessions.tar.gz" -C "${HOME}"
    log "  ✓ Restored ~/.kiro-bulk"
fi

# ── 5. Hermes config ──────────────────────────────────────────────────────
if [ -f "${SCRIPT_DIR}/hermes-config.tar.gz" ]; then
    read -p "Restore Hermes config? (akan replace ~/.hermes existing) (y/N): " -n 1 -r; echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log "Restore Hermes config..."
        tar xzf "${SCRIPT_DIR}/hermes-config.tar.gz" -C "${HOME}"
        log "  ✓ Restored ~/.hermes"
    fi
fi

# ── 6. Restart container ──────────────────────────────────────────────────
log "Restart 9router container..."
sudo docker start 9router

# Wait & verify
log "Tunggu container ready..."
for i in {1..20}; do
    if curl -sf http://127.0.0.1:20128/ >/dev/null 2>&1; then
        log "Container UP"
        break
    fi
    sleep 2
done

# ── 7. Restart sidecar ────────────────────────────────────────────────────
if systemctl --user is-enabled kiro-bulk-sidecar &>/dev/null; then
    log "Restart sidecar..."
    systemctl --user restart kiro-bulk-sidecar
fi

# ── Final ─────────────────────────────────────────────────────────────────
echo
echo "============================================================"
log "RESTORE DONE"
echo "============================================================"
echo
echo "  Verify:"
echo "    docker ps | grep 9router"
echo "    curl -I http://localhost:20128/"
echo "    systemctl --user status kiro-bulk-sidecar"
echo
echo "  Next steps:"
echo "    1. Update DNS A record domain → IP server baru"
echo "    2. Re-issue SSL cert: sudo certbot --nginx -d your-domain.com"
echo "    3. Test customer connection dari VPS lain"
echo
echo "============================================================"
