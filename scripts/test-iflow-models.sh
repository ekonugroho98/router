#!/bin/bash
# Test iFlow LLM API key against multiple model name variants
# Usage:
#   IFLOW_KEY="sk-xxx..." ./test-iflow-models.sh

set -euo pipefail

if [[ -z "${IFLOW_KEY:-}" ]]; then
  echo "Error: set IFLOW_KEY env var"
  exit 1
fi

# Model variants to try (from search docs)
MODELS=(
  "kimi-k2-0905"
  "kimi-k2-thinking"
  "kimi-k2-instruct"
  "Kimi-K2-Instruct"
  "moonshotai/kimi-k2"
  "glm-4.6"
  "glm-4.5"
  "zhipuai/glm-4.6"
  "deepseek-v3.1"
  "deepseek-v3.1-terminus"
  "deepseek/deepseek-v3.1"
  "qwen3-coder-plus"
  "qwen3-vl-plus"
  "qwen3-max"
  "qwen/qwen3-max"
  "iflowcn/deepseek-r1"
  "iflowcn/qwen3-vl-plus"
)

USER_AGENT="iFlow-Cli"

for MODEL in "${MODELS[@]}"; do
  SESSION_ID="session-$(uuidgen | tr '[:upper:]' '[:lower:]')"
  TIMESTAMP="$(node -e 'process.stdout.write(Date.now().toString())')"
  PAYLOAD="${USER_AGENT}:${SESSION_ID}:${TIMESTAMP}"
  SIGNATURE="$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$IFLOW_KEY" | sed 's/^.*= //')"

  RESPONSE=$(curl -sS -m 15 -w '\n[HTTP %{http_code}]' \
    -X POST 'https://apis.iflow.cn/v1/chat/completions' \
    -H "Authorization: Bearer $IFLOW_KEY" \
    -H "Content-Type: application/json" \
    -H "User-Agent: $USER_AGENT" \
    -H "session-id: $SESSION_ID" \
    -H "x-iflow-timestamp: $TIMESTAMP" \
    -H "x-iflow-signature: $SIGNATURE" \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":5,\"stream\":false}")

  # Compact response: keep just status code and msg
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  # Extract msg or check for content
  if echo "$BODY" | grep -q '"choices"'; then
    STATUS="✅ OK"
    PREVIEW=$(echo "$BODY" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['choices'][0]['message']['content'][:50])" 2>/dev/null || echo "")
  elif echo "$BODY" | grep -q '"Model not support"'; then
    STATUS="❌ Model not support"
    PREVIEW=""
  elif echo "$BODY" | grep -q '"Invalid"'; then
    STATUS="❌ Invalid"
    PREVIEW=""
  else
    STATUS="? unknown"
    PREVIEW="$(echo "$BODY" | head -c 80)"
  fi

  printf "%-40s %s %s\n" "$MODEL" "$STATUS" "$PREVIEW"
done
