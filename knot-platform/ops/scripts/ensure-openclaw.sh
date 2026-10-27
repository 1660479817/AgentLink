#!/usr/bin/env bash
# 按仓库 ops/openclaw 同步 bot01 上的 OpenClaw 智能体、提示词和技能名单。
# OPENCLAW_ENABLE_PROCESS=1 时让 Knot Backend 拉起 knot-intel。
# 管理员 knot-admin 不由 Backend 拉起。脚本给它写本机令牌，并登记每天 09:00 的巡查。
# Internal Personal Agent 在同步前签发账户。已有授权码不换。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
knot_source_platform_env
APPLY="$KNOT_APP_DIR/ops/openclaw/apply-config.mjs"
# platform.env 里的 KNOT_NODE_BIN 是部署时解析出的绝对路径；没有就用 PATH 里的 node。
NODE="${KNOT_NODE_BIN:-node}"
# brew 的 npm 与 node 在同一个 bin 目录。非登录 shell（launchd、ssh 直接跑脚本）的 PATH
# 里没有 /opt/homebrew/bin：这时 command -v npm 找不到，可是 node 就在手边。
NPM="npm"
if [[ -x "$(dirname "$NODE")/npm" ]]; then
  NPM="$(dirname "$NODE")/npm"
fi
ENV_FILE="$KNOT_PLATFORM_ENV"
if [[ -z "${KNOT_AGENT_ENV_DIR:-}" ]]; then
  export KNOT_AGENT_ENV_DIR="$KNOT_SITE_DIR/agents"
fi
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
export OPENCLAW_STATE_DIR="$STATE_DIR"

# ---- 并发保护 ----
# 两份同步同时跑会互相覆盖 agents/ 与提示词，还会同时签发账户、同时改 openclaw.json，
# 最后谁的版本生效取决于谁后写——运维看到的是「同步成功但配置不对」。
# 锁放在站点目录：同一台机器上，一个站点同一时刻只该有一次同步。
# shellcheck source=lib/lock.sh
source "$SCRIPT_DIR/lib/lock.sh"
knot_lock "$KNOT_SITE_DIR/.ensure-openclaw.lock" "OpenClaw 同步" || exit 1
trap knot_unlock EXIT

if ! command -v "$NODE" >/dev/null 2>&1; then
  echo "需要 Node.js 22+（OpenClaw 源码要求 24+），找不到 ${NODE}。" >&2
  exit 1
fi
if ! command -v "$NPM" >/dev/null 2>&1; then
  echo "需要 npm（应和 node 一起装），找不到 ${NPM}。" >&2
  exit 1
fi
echo "==> node $("$NODE" -v), npm $("$NPM" -v)"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "==> install openclaw"
  npm_major="$("$NPM" -v | cut -d. -f1)"
  npm_minor="$("$NPM" -v | cut -d. -f2)"
  if [[ "$npm_major" -gt 11 ]] || [[ "$npm_major" -eq 11 && "$npm_minor" -ge 16 ]]; then
    "$NPM" install -g openclaw@latest --allow-scripts=openclaw
  else
    "$NPM" install -g openclaw@latest
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
"$NODE" "$APPLY" snapshot

# 下线与上线走同一条路：manifest 里已经删掉的平台 Agent，本机这条 entry 与它的工作区
# 由这里收掉。否则删掉代码之后，那台机器上还留着一个没有任何技能、却仍被 Gateway 认得的
# 智能体，连同它的工作区一起，谁也不会再想起它。
while IFS= read -r retired_id; do
  [[ -z "$retired_id" ]] && continue
  echo "==> delete retired agent $retired_id"
  openclaw agents delete "$retired_id" --force >/dev/null || echo "warn: $retired_id 没能删除，请手工确认"
done < <("$NODE" "$APPLY" retired-ids)

while IFS= read -r agent_id; do
  [[ -z "$agent_id" ]] && continue
  workspace="$STATE_DIR/workspace-$agent_id"
  echo "==> seed prompts $agent_id"
  "$NODE" "$APPLY" seed "$agent_id"
  if openclaw agents list 2>/dev/null | grep -q -w "$agent_id"; then
    echo "==> agent $agent_id already registered"
  else
    echo "==> add agent $agent_id"
    openclaw agents add "$agent_id" --workspace "$workspace" --non-interactive
  fi
done < <("$NODE" "$APPLY" ids; "$NODE" "$APPLY" internal-ids)

if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r agent_id; do
    [[ -z "$agent_id" ]] && continue
    echo "==> ensure internal agent $agent_id"
    "$KNOT_APP_DIR/ops/scripts/ensure-internal-agent.sh" "$agent_id"
  done < <("$NODE" "$APPLY" internal-ids)
else
  echo "没有 ${ENV_FILE}，Internal Personal Agent 账户这次不签发。"
fi

echo "==> sync prompts and skills"
"$NODE" "$APPLY" sync

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
  local token dest agent_id tmp
  token="$(grep '^KNOT_ADMIN_TOKEN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [[ -z "$token" ]]; then
    # 空值不能当成「已配置」：只判断「有没有非空行」的话，文件里留着
    # `KNOT_ADMIN_TOKEN=`（手改、上次写了一半）时会再追加一行，而 head -1
    # 取到的仍是那个空值——两个工作区都写成空令牌，智能体集体不可用。
    # 先把同名行全部去掉，再写一条新的，文件里只留一行。
    tmp="$(mktemp "${TMPDIR:-/tmp}/knot-env.XXXXXX")"
    chmod 600 "$tmp"
    grep -v '^KNOT_ADMIN_TOKEN=' "$ENV_FILE" >"$tmp" || true
    printf 'KNOT_ADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" >>"$tmp"
    cat "$tmp" >"$ENV_FILE"
    rm -f "$tmp"
    token="$(grep '^KNOT_ADMIN_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  fi
  if [[ -z "$token" ]]; then
    echo "错误：没能给 ${ENV_FILE} 写入 KNOT_ADMIN_TOKEN。这次不写空令牌，先把环境文件的权限和内容修好。" >&2
    exit 1
  fi
  # 管理员和精算师共用这把本机令牌，各自读自己工作区的那一份。
  for agent_id in knot-admin knot-actuary; do
    dest="$STATE_DIR/workspace-$agent_id/.admin-token"
    mkdir -p "$(dirname "$dest")"
    printf '%s\n' "$token" >"$dest"
    chmod 600 "$dest"
  done
  echo "==> 管理令牌已写入管理员和精算师的工作区"
}

PATROL_MESSAGE="执行每日巡查。读工作区的 AGENTS.md、ORDERS.md 和技能 knot-admin。用 skills/knot-admin/admin patrol 取新帖，只判断不处置：不要删除、不要警告。把每条可疑记录的 id、作者和原因（违法、欺诈、隐私或骚扰），以及 ORDERS.md 点名但这次没出现的对象，用 patrol-record 记成一条巡查记录。没有要处理的记「无」。删除与警告等主人在对话里确认后再做。不要自己发 HTTP。"

ensure_admin_cron() {
  local json id message
  json="$(openclaw cron list --all --json 2>/dev/null || printf '%s\n' '{"jobs":[]}')"
  id="$(printf '%s' "$json" | "$NODE" -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      const job = (JSON.parse(raw).jobs || []).find((item) => item.name === "knot-admin-patrol");
      process.stdout.write(job ? job.id : "");
    });
  ')"
  if [[ -z "$id" ]]; then
    echo "==> add cron knot-admin-patrol"
    openclaw cron add "0 9 * * *" \
      "$PATROL_MESSAGE" \
      --name "knot-admin-patrol" \
      --tz "Asia/Shanghai" \
      --session isolated \
      --agent knot-admin \
      --no-deliver \
      --timeout-seconds 300
    return 0
  fi
  message="$(printf '%s' "$json" | "$NODE" -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      const job = (JSON.parse(raw).jobs || []).find((item) => item.name === "knot-admin-patrol");
      process.stdout.write(job?.payload?.message || "");
    });
  ')"
  if [[ "$message" == "$PATROL_MESSAGE" ]]; then
    echo "==> cron knot-admin-patrol already current"
    return 0
  fi
  echo "==> update cron knot-admin-patrol"
  openclaw cron edit "$id" --message "$PATROL_MESSAGE"
}

if [[ -f "$ENV_FILE" ]]; then
  ensure_admin_token
else
  echo "没有 ${ENV_FILE}，管理员令牌这次不写。"
fi
ensure_admin_cron

# 记下这次同步的意图：哪些 Agent 该在、各自看哪些技能、巡查任务叫什么。
# 运行时拿它和本机实际注册的比，才能区分「掉了」和「故意下线」。
# 写不进去只提示——这是旁路的记录，不该影响这次同步的结果。
"$NODE" "$APPLY" sync-report --port "$PORT" --patrol knot-admin-patrol \
  || echo "warn: 同步状态文件没写成，运行时会把 OpenClaw 显示成 unknown"

# 给 main 放一份说明：部署根在哪、哪些命令可以只读地跑、哪些文件不许碰。
# 可见地跑，日志里能看出写了什么、跳过了什么；失败只是少一份说明。
"$NODE" "$APPLY" main-brief --port "$PORT" \
  || echo "warn: main 的说明没写成，旁路不受影响"

# 能走到这里说明 OpenClaw 是开着的：把 KNOT_OPENCLAW=0 那次留下的 off 清掉，
# 让探测重新成为运行时的写者。不清的话，页面会一直显示「已明确关闭」。
#
# 只清 off：一份写着 ok / degraded 的读数是运行时的证据，不是这次部署的决定。
# 一并删掉的话，控制台会空到下一个五分钟，看上去像探测坏了——而它什么都没坏。
STATUS_FILE="$KNOT_DEPLOY_ROOT/var/run/openclaw-status.json"
if grep -q '"state"[[:space:]]*:[[:space:]]*"off"' "$STATUS_FILE" 2>/dev/null; then
  rm -f "$STATUS_FILE" 2>/dev/null || true
fi

if [[ "${OPENCLAW_ENABLE_PROCESS:-}" != 1 ]]; then
  echo "智能体已按 ops/openclaw 同步。Knot Backend 尚未切换。"
  echo "确认 Process 能跑通后执行：OPENCLAW_ENABLE_PROCESS=1 ./ops/scripts/ensure-openclaw.sh"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 ${ENV_FILE}，无法写入 OPENCLAW_INTEL_AGENT" >&2
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
ensure_line OPENCLAW_BIN openclaw
ensure_line OPENCLAW_PROCESS_TIMEOUT 120
uid="$(id -u)"
launchctl kickstart -k "gui/$uid/com.knot.platform" 2>/dev/null || true
echo "OK: Knot Backend 拉起 knot-intel。管理员 knot-admin 接受指令，并在每天 09:00 巡查。"
