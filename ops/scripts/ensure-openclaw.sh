#!/usr/bin/env bash
# 按仓库 ops/openclaw 同步 bot01 上的 OpenClaw 员工、提示词和技能名单。
# OPENCLAW_ENABLE_PROCESS=1 时让 Knot Backend 拉起 knot-intel、knot-brief 与 knot-demand。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
APPLY="$KNOT_HOME/ops/openclaw/apply-config.mjs"
ENV_FILE="$KNOT_HOME/ops/env/knot-platform.local.env"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
export OPENCLAW_STATE_DIR="$STATE_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "需要 Node.js 和 npm（建议 Node 22+，OpenClaw 源码要求 24+）" >&2
  exit 1
fi
echo "==> node $(node -v), npm $(npm -v)"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "==> install openclaw"
  npm_major="$(npm -v | cut -d. -f1)"
  npm_minor="$(npm -v | cut -d. -f2)"
  if [[ "$npm_major" -gt 11 ]] || [[ "$npm_major" -eq 11 && "$npm_minor" -ge 16 ]]; then
    npm install -g openclaw@latest --allow-scripts=openclaw
  else
    npm install -g openclaw@latest
  fi
fi
echo "==> openclaw $(openclaw --version)"

if [[ ! -f "$STATE_DIR/openclaw.json" ]]; then
  echo "==> baseline config"
  openclaw setup --baseline
  openclaw config set gateway.bind loopback || echo "warn: gateway.bind 未写入，请确认 Gateway 只监听本机"
  openclaw config set gateway.port "$PORT" || true
fi

if ! openclaw gateway health --port "$PORT" >/dev/null 2>&1; then
  echo "==> install gateway on 127.0.0.1:${PORT}"
  openclaw gateway install --port "$PORT" --runtime node
fi

echo "==> snapshot routing"
node "$APPLY" snapshot

while IFS= read -r agent_id; do
  [[ -z "$agent_id" ]] && continue
  workspace="$STATE_DIR/workspace-$agent_id"
  mkdir -p "$workspace"
  if openclaw agents list 2>/dev/null | grep -q "$agent_id"; then
    echo "==> agent $agent_id already registered"
  else
    echo "==> add agent $agent_id"
    openclaw agents add "$agent_id" --workspace "$workspace" --non-interactive
  fi
done < <(node "$APPLY" ids)

echo "==> sync prompts and skills"
node "$APPLY" sync

echo "==> restart gateway"
openclaw gateway restart
healthy=0
for _ in $(seq 1 20); do
  if openclaw gateway health --port "$PORT" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  echo "Gateway 重启后没有恢复" >&2
  exit 1
fi
openclaw gateway health --port "$PORT"
openclaw agents list

if [[ "${OPENCLAW_ENABLE_PROCESS:-}" != 1 ]]; then
  echo "员工已按 ops/openclaw 同步。Knot Backend 尚未切换。"
  echo "确认 Process 能跑通后执行：OPENCLAW_ENABLE_PROCESS=1 ./ops/scripts/ensure-openclaw.sh"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 $ENV_FILE，无法写入 OPENCLAW_INTEL_AGENT" >&2
  exit 1
fi
ensure_line() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}
ensure_line OPENCLAW_INTEL_AGENT knot-intel
ensure_line OPENCLAW_BRIEF_AGENT knot-brief
ensure_line OPENCLAW_DEMAND_AGENT knot-demand
ensure_line OPENCLAW_BIN openclaw
ensure_line OPENCLAW_PROCESS_TIMEOUT 90
ensure_line OPENCLAW_AGENT_TIMEOUT 45
uid="$(id -u)"
launchctl kickstart -k "gui/$uid/com.knot.platform" 2>/dev/null || true
echo "OK: Knot Backend 拉起 knot-intel、knot-brief、knot-demand"
