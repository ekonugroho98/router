#!/usr/bin/env bash
# =====================================================
# verify-setup.sh — One-command verifier untuk addon-kiro-bulk.
#
# Auto-check:
#   1. 9router up & reachable
#   2. CLI token bisa di-generate
#   3. CLI token bypass auth (test against /api/providers)
#   4. /api/oauth/kiro/import accept request dari sidecar
#   5. Sidecar service (port 9100) up — info aja, gak auto-restart
#
# Output: pass/fail per step + ready-to-run command kalau ada yg perlu di-fix.
#
# Jalanin dari folder ini:
#   bash verify-setup.sh
# Atau dari root project:
#   bash addon-kiro-bulk/verify-setup.sh
# =====================================================
set -uo pipefail

# ─── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ─── Config (override via env) ─────────────────────────────────────────────
ROUTER_URL="${ROUTER_URL:-http://localhost:20128}"
SIDECAR_URL="${SIDECAR_URL:-http://localhost:9100}"

# ─── Resolve paths ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTER_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
GET_TOKEN_SCRIPT="${SCRIPT_DIR}/get-cli-token.js"

# ─── Helpers ────────────────────────────────────────────────────────────────
step_count=0
fail_count=0
pass()  { echo -e "  ${GREEN}✓${NC} $1"; }
fail()  { echo -e "  ${RED}✗${NC} $1"; fail_count=$((fail_count + 1)); }
warn()  { echo -e "  ${YELLOW}!${NC} $1"; }
info()  { echo -e "  ${DIM}$1${NC}"; }
hdr()   { step_count=$((step_count + 1)); echo -e "\n${BOLD}[$step_count] $1${NC}"; }

# ─── Pre-flight ────────────────────────────────────────────────────────────
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "${BOLD}  addon-kiro-bulk — Setup Verifier${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "${DIM}  Router URL:    ${ROUTER_URL}${NC}"
echo -e "${DIM}  Sidecar URL:   ${SIDECAR_URL}${NC}"
echo -e "${DIM}  Project root:  ${ROUTER_ROOT}${NC}"

# ─── Step 1: 9router reachable ─────────────────────────────────────────────
hdr "Checking 9router at ${ROUTER_URL}"
HTTP_CODE=$(curl -s -o /tmp/9r-root.txt -w "%{http_code}" --max-time 5 "${ROUTER_URL}/" 2>/dev/null || echo "000")

if [ "${HTTP_CODE}" = "000" ]; then
    fail "9router unreachable. Pastiin dev server jalan (npm run dev)"
    echo
    echo -e "${YELLOW}>>> Action needed:${NC}"
    echo "    cd ${ROUTER_ROOT}"
    echo "    npm run dev"
    exit 1
fi
if [ "${HTTP_CODE}" -ge 200 ] && [ "${HTTP_CODE}" -lt 500 ]; then
    pass "9router responded (HTTP ${HTTP_CODE})"
else
    fail "9router returned HTTP ${HTTP_CODE}"
    info "$(head -c 200 /tmp/9r-root.txt)"
fi

# ─── Step 2: Detect requireLogin setting ───────────────────────────────────
hdr "Detecting requireLogin setting"
REQUIRE_LOGIN=$(curl -s --max-time 5 "${ROUTER_URL}/api/settings/require-login" 2>/dev/null || echo "{}")
if echo "${REQUIRE_LOGIN}" | grep -q '"requireLogin":true'; then
    pass "requireLogin: ON (CLI token akan dibutuhin)"
    NEED_TOKEN=1
elif echo "${REQUIRE_LOGIN}" | grep -q '"requireLogin":false'; then
    pass "requireLogin: OFF (CLI token gak diperlukan, tapi tetap supported)"
    NEED_TOKEN=0
else
    warn "Gak bisa parse setting (${REQUIRE_LOGIN:0:80}). Asumsiin requireLogin=ON"
    NEED_TOKEN=1
fi

# ─── Step 3: Generate CLI token ────────────────────────────────────────────
hdr "Generating CLI token (machine ID based)"
if [ ! -f "${GET_TOKEN_SCRIPT}" ]; then
    fail "get-cli-token.js gak ada di ${GET_TOKEN_SCRIPT}"
    exit 1
fi

if [ ! -d "${ROUTER_ROOT}/node_modules/node-machine-id" ]; then
    fail "node-machine-id belum keinstall"
    echo
    echo -e "${YELLOW}>>> Action needed:${NC}"
    echo "    cd ${ROUTER_ROOT}"
    echo "    npm install"
    exit 1
fi

# Run from router root supaya node bisa nemuin node_modules
CLI_TOKEN=$(cd "${ROUTER_ROOT}" && node "${GET_TOKEN_SCRIPT}" 2>&1)
TOKEN_EXIT=$?

if [ ${TOKEN_EXIT} -ne 0 ] || [ -z "${CLI_TOKEN}" ]; then
    fail "Gagal generate token: ${CLI_TOKEN}"
    exit 1
fi
if [[ ! "${CLI_TOKEN}" =~ ^[a-f0-9]{16}$ ]]; then
    fail "Token format invalid: ${CLI_TOKEN}"
    exit 1
fi
pass "Token: ${BOLD}${CLI_TOKEN}${NC}"

# ─── Step 4: Test CLI token bypass auth ────────────────────────────────────
hdr "Testing CLI token bypass auth"
RESP_BODY=$(curl -s --max-time 5 \
    -H "x-9r-cli-token: ${CLI_TOKEN}" \
    "${ROUTER_URL}/api/providers?provider=kiro" 2>/dev/null || echo "{}")

if echo "${RESP_BODY}" | grep -q '"connections"'; then
    KIRO_COUNT=$(echo "${RESP_BODY}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('connections',[])))" 2>/dev/null || echo "?")
    pass "Token works! Got ${KIRO_COUNT} Kiro connection(s)"
elif echo "${RESP_BODY}" | grep -q '"Unauthorized"'; then
    fail "Token rejected (Unauthorized). Salt mismatch?"
    info "Cek MACHINE_ID_SALT env di 9router (default 'endpoint-proxy-salt')"
    info "Token salt-nya '9r-cli-auth' — hardcoded di dashboardGuard.js"
    info "Response: ${RESP_BODY:0:200}"
else
    fail "Unexpected response: ${RESP_BODY:0:200}"
fi

# ─── Step 5: Test /api/oauth/kiro/import endpoint ──────────────────────────
hdr "Testing /api/oauth/kiro/import endpoint accessibility"
# Test pake invalid token — kalau dapet 400/500 (validation error), endpoint accessible.
# Kalau dapet 401, auth masih block.
RESP_BODY=$(curl -s --max-time 10 \
    -H "x-9r-cli-token: ${CLI_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"refreshToken":"INVALID_TEST_TOKEN_aorAAAAAGxx"}' \
    "${ROUTER_URL}/api/oauth/kiro/import" 2>/dev/null || echo "{}")

if echo "${RESP_BODY}" | grep -q '"Unauthorized"'; then
    fail "Import endpoint masih blocked (token gak diterima)"
elif echo "${RESP_BODY}" | grep -qE '"error"|"success":false' && ! echo "${RESP_BODY}" | grep -q '"Unauthorized"'; then
    pass "Endpoint accessible (return validation error as expected for fake token)"
    info "Response: ${RESP_BODY:0:120}"
elif echo "${RESP_BODY}" | grep -q '"success":true'; then
    pass "Endpoint accepted (success — but kita kirim fake token, ini aneh)"
else
    pass "Endpoint reached"
    info "Response: ${RESP_BODY:0:120}"
fi

# ─── Step 6: Cek sidecar running? ──────────────────────────────────────────
hdr "Checking sidecar service at ${SIDECAR_URL}"
SIDE_RESP=$(curl -s --max-time 3 "${SIDECAR_URL}/health" 2>/dev/null || echo "")
SIDECAR_RUNNING=0
SIDECAR_HAS_TOKEN=0
if [ -z "${SIDE_RESP}" ]; then
    warn "Sidecar belum jalan di ${SIDECAR_URL}"
else
    # Pakai Python parser supaya tahan terhadap spacing di JSON
    STATUS=$(echo "${SIDE_RESP}" | python3 -c "import sys,json
try: d=json.load(sys.stdin); print(d.get('status','?'))
except: print('parse_error')" 2>/dev/null || echo "parse_error")

    if [ "${STATUS}" = "ok" ]; then
        SIDECAR_RUNNING=1
        pass "Sidecar running (status=ok)"
        # Cek apakah sidecar pakai CLI token
        SIDECAR_TOKEN_HINT=$(echo "${SIDE_RESP}" | python3 -c "import sys,json
try:
    d=json.load(sys.stdin)
    cfg=d.get('config',{})
    print('configured' if cfg.get('cli_token') else 'empty')
except: print('unknown')" 2>/dev/null || echo "unknown")

        if [ "${SIDECAR_TOKEN_HINT}" = "configured" ]; then
            SIDECAR_HAS_TOKEN=1
            pass "Sidecar pakai CLI token (auth-aware mode)"
        else
            warn "Sidecar jalan TANPA CLI token — bakal gagal save kalau requireLogin=ON"
        fi
    else
        warn "Sidecar response unexpected (status=${STATUS})"
        info "Body: ${SIDE_RESP:0:120}"
    fi
fi

# ─── Summary & next steps ──────────────────────────────────────────────────
echo
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
if [ ${fail_count} -eq 0 ]; then
    echo -e "${GREEN}${BOLD}  ✓ Setup OK — siap bulk!${NC}"
else
    echo -e "${RED}${BOLD}  ✗ ${fail_count} step(s) failed — fix dulu sebelum bulk.${NC}"
fi
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo
echo -e "${BOLD}Token kamu (simpen aja):${NC}"
echo -e "  ${GREEN}${CLI_TOKEN}${NC}"
echo

if [ ${SIDECAR_RUNNING} -eq 0 ]; then
    echo -e "${BOLD}>>> Sidecar belum jalan. Start dengan:${NC}"
    echo "    cd ${SCRIPT_DIR}"
    echo "    source .venv/bin/activate"
    echo "    KIRO_BULK_CLI_TOKEN=${CLI_TOKEN} python server.py"
elif [ ${NEED_TOKEN} -eq 1 ] && [ ${SIDECAR_HAS_TOKEN} -eq 0 ]; then
    echo -e "${YELLOW}>>> Sidecar jalan tapi TANPA CLI token. Restart dengan token:${NC}"
    echo "    Stop dulu (Ctrl+C di terminal sidecar), terus:"
    echo "    cd ${SCRIPT_DIR}"
    echo "    source .venv/bin/activate"
    echo "    KIRO_BULK_CLI_TOKEN=${CLI_TOKEN} python server.py"
else
    echo -e "${GREEN}>>> Sidecar siap dengan auth. Bulk via UI sekarang!${NC}"
    echo "    Open http://localhost:20128/dashboard/providers/kiro"
    echo "    Click 'Bulk Add' button"
fi

echo
echo -e "${DIM}Quick test pake curl (1 akun):${NC}"
cat <<EOF
  curl -X POST http://localhost:9100/login \\
    -H "Content-Type: application/json" \\
    -d '{
      "email": "test@gmail.com",
      "password": "xxx",
      "headless": false,
      "save_to_router": true
    }' | python3 -m json.tool
EOF
echo

exit ${fail_count}
