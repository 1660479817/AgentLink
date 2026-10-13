#!/usr/bin/env bash
# 按仓库 ops/openclaw 同步 bot01 上的 OpenClaw 员工、提示词和技能名单。
# OPENCLAW_ENABLE_PROCESS=1 时让 Knot Backend 拉起 knot-intel、knot-brief 与 knot-demand。
# 管理员 knot-admin 不由 Backend 按数据包拉起。脚本给它写本机令牌，并登记每天 09:00 的巡查。
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

ensure_admin_token() {
  if ! grep -E -q '^KNOT_ADMIN_TOKEN=.+' "$ENV_FILE"; then
    printf 'KNOT_ADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" >>"$ENV_FILE"
  fi
  local token dest
  token="$(grep '^KNOT_ADMIN_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  dest="$STATE_DIR/workspace-knot-admin/.admin-token"
  printf '%s\n' "$token" >"$dest"
  chmod 600 "$dest"
  echo "==> 管理员令牌已写入工作区"
}

ensure_admin_cron() {
  local list
  list="$(openclaw cron list --all 2>/dev/null || openclaw cron list 2>/dev/null || true)"
  if printf '%s\n' "$list" | grep -q 'knot-admin-patrol'; then
    echo "==> cron knot-admin-patrol already registered"
    return 0
  fi
  echo "==> add cron knot-admin-patrol"
  openclaw cron add "0 9 * * *" \
    "执行每日巡查。读工作区的 AGENTS.md、ORDERS.md 和技能 knot-admin。只处理本机管理接口给出的新帖。违法、欺诈、隐私或骚扰，以及 ORDERS.md 写明的对象，才删除并警告。拿不准的不要动。巡查结束把记录交给管理接口。" \
    --name "knot-admin-patrol" \
    --tz "Asia/Shanghai" \
    --session isolated \
    --agent knot-admin \
    --no-deliver \
    --timeout-seconds 300
}

if [[ -f "$ENV_FILE" ]]; then
  ensure_admin_token
else
  echo "没有 $ENV_FILE，管理员令牌这次不写。"
fi
ensure_admin_cron

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
echo "OK: Knot Backend 拉起 knot-intel、knot-brief、knot-demand。管理员 knot-admin 接受指令，并在每天 09:00 巡查。"
