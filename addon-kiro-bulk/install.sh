#!/usr/bin/env bash
# Install dependencies untuk kiro-bulk-service (Camoufox + aiohttp).
# Bisa dijalanin di Mac atau Linux VPS.
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }

# 1. Cek Python 3.10+
PY=python3
if ! command -v $PY &>/dev/null; then
    echo "Python 3 belum keinstall. Install dulu: brew install python@3.11 (Mac) atau apt install python3 python3-venv (Linux)"
    exit 1
fi
PYVER=$($PY -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
log "Python detected: ${PYVER}"

# 2. Bikin venv local biar gak nyampur sama system Python
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="${SCRIPT_DIR}/.venv"
if [ ! -d "$VENV" ]; then
    log "Bikin venv di ${VENV}..."
    $PY -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

log "Upgrade pip..."
pip install --upgrade pip -q

# 3. Install camoufox + aiohttp
log "Install dependencies (camoufox, aiohttp)..."
pip install -q -r "${SCRIPT_DIR}/requirements.txt"

# 4. Download Camoufox browser binary
log "Download Camoufox Firefox binary (sekali aja, ~150MB)..."
python -m camoufox fetch

# 5. Optional: install Playwright deps (Linux kadang butuh)
if [ "$(uname)" = "Linux" ]; then
    log "Linux detected — install system deps untuk headless browser (butuh sudo)..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq \
        libgtk-3-0 libdbus-glib-1-2 libxt6 libpci-dev \
        libxrender1 libasound2 libnss3 libxshmfence1 \
        xvfb \
        2>/dev/null || warn "Beberapa package gagal install — kalau pas test ada error library missing, install manual"
fi

log "Setup selesai!"
echo ""
echo "Cara test 1 akun (run dari folder ini):"
echo "  source .venv/bin/activate"
echo "  python kiro_login.py --email YOUR@gmail.com --password YOUR_PASS"
echo ""
echo "Opsi tambahan:"
echo "  --headless           : run tanpa GUI (lebih cepet, lebih mudah ke-detect Google)"
echo "  --proxy http://...   : pake proxy"
echo "  --geoip              : enable MaxMind GeoIP (default OFF)"
echo "  --retries 5          : max retry attempt (default 3)"
echo ""
echo "Di VPS headless, kalau headed-mode butuh display, install xvfb dulu lalu:"
echo "  xvfb-run -a python kiro_login.py --email ... --password ..."
