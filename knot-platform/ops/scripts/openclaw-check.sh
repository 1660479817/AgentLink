#!/usr/bin/env bash
# 旁路体检：只报告，不判定。
#
# 这台机器上没有 OpenClaw 是合法状态，不是故障。所以本文件里没有 exit 1，
# 结尾固定 exit 0，也不开 set -e——任何一行坏掉都不该让调用方失败。
#
# 它刻意不并入 doctor.sh：那份脚本的退出码决定部署成不成，为了多打印几行
# 去改它，是这件事里唯一可以完全避免的风险。重复的十几行打印是有意的、临时的。
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APPLY="$APP_DIR/openclaw/apply-config.mjs"

# 与 ensure-openclaw.sh 同一套取值：它没把 state 目录导出去，两边都按同一个默认推。
STATE_DIR="${OPENCLAW_STATE_DIR:-${HOME:-}/.openclaw}"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
MIN_VERSION="${KNOT_OPENCLAW_MIN_VERSION:-2026.10.1}"

row() {
  # row <ok|warn|off> <名称> <说明>
  printf '  %-5s %-12s %s\n' "$1" "$2" "$3"
}

echo "旁路体检（不进退出码）：站点 ${KNOT_SITE:-未指定}"

installed=0
if command -v openclaw >/dev/null 2>&1; then
  installed=1
fi

# ---- 1. 状态目录 ----
# 打印出它真正读的地方。写错的 OPENCLAW_STATE_DIR 在部署日志里就该看得见，
# 而不是一周后表现为一个沉默的 unknown。
if [[ -f "$STATE_DIR/openclaw.json" ]]; then
  row ok "state dir" "$STATE_DIR"
else
  row warn "state dir" "${STATE_DIR} 下没有 openclaw.json（模型与 Gateway 都未配置）"
fi

# ---- 2. 版本 ----
if [[ "$installed" != 1 ]]; then
  row off "version" "未安装 openclaw；审核 / 管理 / 检索智能体不会运行，站点其余部分照常"
else
  version="$(openclaw --version 2>/dev/null | grep -oE '[0-9]{4}\.[0-9]+\.[0-9]+' | head -1 || true)"
  if [[ -z "$version" ]]; then
    row warn "version" "openclaw --version 的输出无法解析"
  elif node -e '
    const toParts = (value) => value.split(".").map(Number);
    const left = toParts(process.argv[1]);
    const right = toParts(process.argv[2]);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      const delta = (left[i] || 0) - (right[i] || 0);
      if (delta !== 0) process.exit(delta < 0 ? 1 : 0);
    }
    process.exit(0);
  ' "$version" "$MIN_VERSION" 2>/dev/null; then
    row ok "version" "${version}（门槛 ${MIN_VERSION}）"
  else
    row warn "version" "${version} 低于门槛 ${MIN_VERSION}（可用 KNOT_OPENCLAW_MIN_VERSION 覆盖）"
  fi
fi

# ---- 3. 模型 ----
# 三条与 check-openclaw-env.mjs 一致：provider 声明了模型清单、配了凭据，才算配好。
if [[ ! -f "$STATE_DIR/openclaw.json" ]]; then
  row warn "model" "没有 openclaw.json，模型尚未配置"
else
  model_state="$(node -e '
    const fs = require("node:fs");
    let state = "unreadable";
    try {
      const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const providers = (cfg.models && cfg.models.providers) || {};
      const hasModel = Object.values(providers).some((p) => Array.isArray(p.models) && p.models.length > 0);
      const hasAuth = !!(cfg.auth && cfg.auth.profiles && Object.keys(cfg.auth.profiles).length > 0);
      state = hasModel && hasAuth ? "ok" : hasModel ? "noauth" : "nomodel";
    } catch {
      state = "unreadable";
    }
    process.stdout.write(state);
  ' "$STATE_DIR/openclaw.json" 2>/dev/null || true)"
  case "$model_state" in
    ok) row ok "model" "有模型清单，也有凭据" ;;
    noauth) row warn "model" "有模型清单，但没有凭据（auth.profiles 为空）" ;;
    nomodel) row warn "model" "没有 provider 声明模型（models.providers 为空）" ;;
    *) row warn "model" "openclaw.json 读不了或不是 JSON" ;;
  esac
fi

# ---- 4. Gateway ----
if [[ "$installed" != 1 ]]; then
  row off "gateway" "未安装 openclaw"
elif openclaw gateway health --port "$PORT" >/dev/null 2>&1; then
  row ok "gateway" "127.0.0.1:${PORT} 健康"
else
  row warn "gateway" "127.0.0.1:${PORT} 不健康；智能体这次不会被拉起"
fi

# ---- 5. 注册的 Agent ----
# 该在的 Agent 名单来自 manifest 与 internal_agent，与本机实际注册的比。
# 少一个就说明「同步过但没生效」，这比 Gateway 活着更容易被忽略。
if [[ "$installed" != 1 ]]; then
  row off "agents" "未安装 openclaw，无法比对"
else
  registered="$(openclaw agents list 2>/dev/null || true)"
  missing=""
  missing_count=0
  while IFS= read -r agent_id; do
    [[ -z "$agent_id" ]] && continue
    if ! printf '%s\n' "$registered" | grep -qw -- "$agent_id"; then
      missing="${missing}${missing:+ }${agent_id}"
      missing_count=$((missing_count + 1))
    fi
  done < <(node "$APPLY" ids 2>/dev/null || true; node "$APPLY" internal-ids 2>/dev/null || true)
  if [[ "$missing_count" == 0 ]]; then
    row ok "agents" "名单里的 Agent 都已注册"
  else
    row warn "agents" "没有注册：${missing}（同步没生效，看上面的日志）"
  fi
fi

# ---- 6. 巡查 ----
if [[ "$installed" != 1 ]]; then
  row off "patrol" "未安装 openclaw"
elif openclaw cron list --all --json 2>/dev/null | grep -q 'knot-admin-patrol'; then
  row ok "patrol" "knot-admin-patrol 已登记"
else
  row warn "patrol" "没有 knot-admin-patrol 这个任务；管理员不会自己巡查"
fi

# 这一行是契约：本脚本永远不让调用方失败。
exit 0
