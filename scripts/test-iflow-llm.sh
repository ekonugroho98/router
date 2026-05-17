#!/bin/bash
# Test iFlow LLM API key with proper HMAC-SHA256 signature
# Usage:
#   IFLOW_KEY="sk-xxx..." ./test-iflow-llm.sh
# Or paste from clipboard:
#   IFLOW_KEY="$(pbpaste)" ./test-iflow-llm.sh

set -euo pipefail

if [[ -z "${IFLOW_KEY:-}" ]]; then
  if command -v pbpaste >/dev/null 2>&1; then
    IFLOW_KEY="$(pbpaste)"
    echo "[info] using key from clipboard (length=${#IFLOW_KEY})"
  else
    echo "Error: set IFLOW_KEY env var or copy key to clipboard (macOS)"
    exit 1
  fi
fi

if [[ ! "$IFLOW_KEY" =~ ^sk- ]]; then
  echo "Error: key does not start with 'sk-' (got: ${IFLOW_KEY:0:6}...)"
  exit 1
fi

MODEL="${1:-kimi-k2}"
USER_AGENT="iFlow-Cli"
SESSION_ID="session-$(uuidgen | tr '[:upper:]' '[:lower:]')"
TIMESTAMP="$(node -e 'process.stdout.write(Date.now().toString())')"
PAYLOAD="${USER_AGENT}:${SESSION_ID}:${TIMESTAMP}"

# Generate HMAC-SHA256 signature (hex)
SIGNATURE="$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$IFLOW_KEY" | sed 's/^.*= //')"

echo "[info] Model: $MODEL"
echo "[info] Session: $SESSION_ID"
echo "[info] Timestamp: $TIMESTAMP"
echo "[info] Signature: ${SIGNATURE:0:16}..."
echo ""
echo "[info] Sending request..."
echo ""

curl -sS -w '\n[HTTP %{http_code}]\n' \
  -X POST 'https://apis.iflow.cn/v1/chat/completions' \
  -H "Authorization: Bearer $IFLOW_KEY" \
  -H "Content-Type: application/json" \
  -H "User-Agent: $USER_AGENT" \
  -H "session-id: $SESSION_ID" \
  -H "x-iflow-timestamp: $TIMESTAMP" \
  -H "x-iflow-signature: $SIGNATURE" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"say hi in one word\"}],
    \"max_tokens\": 20,
    \"stream\": false
  }"
