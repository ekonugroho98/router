#!/usr/bin/env bash
# =====================================================
# Audit server spec & capability — run pas first login.
# Verify klaim spec, geo location, OS, dependencies.
#
# Usage: bash audit-server.sh
# =====================================================
set -uo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'

hdr()  { echo -e "\n${BLUE}═══ $* ═══${NC}"; }
pass() { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
info() { echo -e "  • $*"; }

# ─── OS ─────────────────────────────────────────────────────────────────────
hdr "Operating System"
info "Distro:      $(grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '\"')"
info "Kernel:      $(uname -r)"
info "Arch:        $(uname -m)"
info "Hostname:    $(hostname)"
info "Uptime:      $(uptime -p 2>/dev/null || uptime)"

# Cek apakah systemd available
if command -v systemctl &>/dev/null; then
    pass "systemd available (good for service management)"
else
    warn "No systemd — perlu alternatif (init.d / supervisor)"
fi

# ─── CPU ────────────────────────────────────────────────────────────────────
hdr "CPU"
info "Model:       $(grep "model name" /proc/cpuinfo | head -1 | cut -d: -f2 | sed 's/^[ \t]*//')"
info "Cores:       $(nproc) ($(grep -c "physical id" /proc/cpuinfo) physical)"
info "MHz:         $(grep "cpu MHz" /proc/cpuinfo | head -1 | cut -d: -f2 | sed 's/^[ \t]*//')"

# ─── RAM ────────────────────────────────────────────────────────────────────
hdr "RAM"
free -h | head -3
echo ""
RAM_TOTAL_GB=$(free -g | awk '/^Mem:/ {print $2}')
info "Total: ${RAM_TOTAL_GB}GB"
if [ "${RAM_TOTAL_GB}" -ge 32 ]; then
    pass "Plenty RAM untuk multi-tenant + Camoufox parallel 10+"
elif [ "${RAM_TOTAL_GB}" -ge 8 ]; then
    pass "Cukup untuk 9router + bulk parallel 3-5"
elif [ "${RAM_TOTAL_GB}" -ge 4 ]; then
    warn "Tight — max parallel 2-3"
else
    warn "Very tight — parallel 1 only"
fi

# ─── Disk ───────────────────────────────────────────────────────────────────
hdr "Disk"
df -h / | tail -1 | awk '{printf "  • Total: %s · Used: %s (%s) · Free: %s\n", $2, $3, $5, $4}'

# IOPS quick test
info "Disk write speed (1GB random write):"
TEST_FILE="/tmp/iotest-$$"
DD_OUT=$(dd if=/dev/zero of="${TEST_FILE}" bs=1M count=1024 conv=fdatasync 2>&1 | tail -1)
echo "  $DD_OUT"
rm -f "${TEST_FILE}"

# ─── Network & Geo ──────────────────────────────────────────────────────────
hdr "Network & Geo Location"
PUBLIC_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null || curl -s --max-time 5 ipinfo.io/ip 2>/dev/null || echo "unknown")
info "Public IP:   ${PUBLIC_IP}"

GEO=$(curl -s --max-time 5 "https://ipapi.co/${PUBLIC_IP}/json/" 2>/dev/null || echo "{}")
if [ -n "${GEO}" ] && echo "${GEO}" | grep -q "country_name"; then
    info "Country:     $(echo "${GEO}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('country_name', '?'))")"
    info "City:        $(echo "${GEO}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('city', '?'))")"
    info "ISP:         $(echo "${GEO}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('org', '?'))")"
    info "Region:      $(echo "${GEO}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('region', '?'))")"
fi

# ─── Test geo-block ────────────────────────────────────────────────────────
hdr "Geo-block test (critical untuk Kiro!)"

# Test Google (always work)
G=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://www.google.com)
info "Google.com:           HTTP ${G}"

# Test Kiro Builder ID
K=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://app.kiro.dev)
info "app.kiro.dev:         HTTP ${K}"

# Test OpenAI (most strict)
O=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://api.openai.com)
info "api.openai.com:       HTTP ${O}"

# Test Anthropic
A=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://api.anthropic.com)
info "api.anthropic.com:    HTTP ${A}"

# Verdict
if [ "${O}" = "403" ] || [ "${A}" = "403" ]; then
    warn "⚠ OpenAI/Anthropic 403 = GEO-BLOCKED. Kiro/Codex bulk akan fail."
    warn "  Mitigasi: pakai outbound proxy (residential US/EU)"
elif [ "${O}" = "401" ] || [ "${A}" = "401" ]; then
    pass "OpenAI/Anthropic reachable (401 = need auth, server can REACH them)"
fi

# ─── Bandwidth test ────────────────────────────────────────────────────────
hdr "Bandwidth test"
info "Downloading 100MB test file..."
BW_TEST=$(curl -s --max-time 30 -o /dev/null -w "%{speed_download}" \
    "http://speedtest.tele2.net/100MB.zip" 2>/dev/null || echo "0")
BW_MBPS=$(echo "${BW_TEST}" | awk '{printf "%.0f", $1*8/1000000}')
info "Download speed: ~${BW_MBPS} Mbps"

# ─── Required deps ─────────────────────────────────────────────────────────
hdr "Software dependencies"
for cmd in docker podman git node npm python3 nginx curl; do
    if command -v "${cmd}" &>/dev/null; then
        pass "${cmd}:  $(command -v ${cmd})"
    else
        info "${cmd}: not installed (we'll install if needed)"
    fi
done

# ─── Verdict ────────────────────────────────────────────────────────────────
hdr "Verdict & Recommendation"

if [ "${RAM_TOTAL_GB}" -ge 32 ]; then
    pass "READY untuk full multi-tenant 9router + Camoufox bulk + DB + monitoring"
    info "  Suggested next: deploy 9router Docker fork + sidecar"
elif [ "${RAM_TOTAL_GB}" -ge 8 ]; then
    pass "READY untuk 9router + bulk parallel 3-5"
elif [ "${RAM_TOTAL_GB}" -ge 4 ]; then
    warn "OK untuk single-tenant deploy + bulk parallel 2-3"
fi

if [ "${O}" = "403" ]; then
    warn "Geo-block detected — perlu plan untuk proxy"
fi

echo ""
echo "Done. Save output ini buat reference."
