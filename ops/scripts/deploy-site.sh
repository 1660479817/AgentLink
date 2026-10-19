#!/usr/bin/env bash
# 在 macOS 平台主机上部署 Knot：装依赖、建库、迁移、构建 WebUI、装 LaunchAgent。
#
# 所有站点相关取值来自 ops/deploy.env（见 ops/deploy.env.example）。
# 不在本脚本里写死 IP、域名、目录或端口。
#
# 用法：
#   cp ops/deploy.env.example ops/deploy.env
#   编辑 ops/deploy.env
#   ./ops/scripts/deploy-site.sh
#
# 从开发机发布用 ./ops/scripts/push-deploy.sh。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/deploy-config.sh
source "$SCRIPT_DIR/lib/deploy-config.sh"
cd "$KNOT_REPO_ROOT"

case "$(knot_origin_host "$KNOT_PUBLIC_ORIGIN")" in
  127.0.0.1 | localhost | "")
    knot_warn "KNOT_PUBLIC_ORIGIN 还是本机地址；分享图和二维码会指向 $KNOT_PUBLIC_ORIGIN。局域网部署请改成 http://<本机 IP>:$KNOT_PORT。"
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  knot_fail "deploy-site.sh 面向 macOS（Homebrew + launchd）。Linux 请用容器，或自行接 systemd。"
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  knot_fail "需要 Node.js 和 npm（建议 Node 22+）。"
fi

# 配置先过一遍：类型、必填、跨键矛盾。有问题在动数据库和 LaunchAgent 之前停下。
echo "==> check $KNOT_DEPLOY_ENV"
node "$SCRIPT_DIR/config.mjs" check --deploy "$KNOT_DEPLOY_ENV"

if [[ "$KNOT_DB_MODE" == "local" && ! -x "$KNOT_PG_BIN/pg_ctl" ]]; then
  knot_fail "缺少 postgresql@16：brew install postgresql@16（或把 KNOT_PG_BIN 指向它的 bin 目录）。也可用 KNOT_DB_MODE=external 接已有数据库。"
fi
if knot_enabled KNOT_EDGE; then
  knot_require KNOT_EDGE_SSH "KNOT_EDGE=1 时要配置 KNOT_EDGE_SSH=user@edge-host。只部署本机请设 KNOT_EDGE=0。"
  if knot_enabled KNOT_TUNNEL; then
    knot_require KNOT_TUNNEL_SSH "KNOT_TUNNEL=1 时要有隧道账号；留空会自动用 knot-tunnel@<边缘主机>。"
    TUNNEL_KEY="$(knot_expand_path "$KNOT_TUNNEL_KEY")"
    if [[ ! -f "$TUNNEL_KEY" ]]; then
      knot_warn "隧道私钥不存在：$TUNNEL_KEY。先把公钥装到边缘的 $KNOT_TUNNEL_USER 账号，否则隧道起不来。"
    fi
  fi
  PUSH_KEY="$(knot_expand_path "$KNOT_EDGE_PUSH_KEY")"
  if [[ ! -f "$PUSH_KEY" ]]; then
    knot_warn "快照推送私钥不存在：$PUSH_KEY。没有它，/discover.json 不会被推到边缘。"
  fi
fi

mkdir -p "$KNOT_REPO_ROOT/var/log"
chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

APP_ENV="$KNOT_REPO_ROOT/ops/env/knot-platform.local.env"
mkdir -p "$(dirname "$APP_ENV")" "$KNOT_REPO_ROOT/ops/env"

# 旧机器把备份目录写在环境文件里；部署配置没写时沿用，避免升级后备份悄悄停掉。
if [[ -z "$KNOT_BACKUP_DIR" ]]; then
  KNOT_BACKUP_DIR="$(knot_env_get "$APP_ENV" KNOT_BACKUP_DIR)"
fi
KNOT_UPLOAD_DIR="$(knot_expand_path "$KNOT_UPLOAD_DIR")"

# ---- 数据库 ----
if [[ "$KNOT_DB_MODE" == "external" ]]; then
  [[ -n "$KNOT_DATABASE_URL" ]] || knot_fail "KNOT_DB_MODE=external 时必须配置 KNOT_DATABASE_URL。"
  DATABASE_URL="$KNOT_DATABASE_URL"
elif [[ -n "$KNOT_DATABASE_URL" ]]; then
  DATABASE_URL="$KNOT_DATABASE_URL"
else
  if "$KNOT_PG_BIN/pg_isready" -h 127.0.0.1 -p "$KNOT_PGPORT" >/dev/null 2>&1; then
    echo "==> postgres already on $KNOT_PGPORT"
  else
    echo "==> ensure local postgres ($KNOT_PGDATA)"
    KNOT_PGPORT="$KNOT_PGPORT" KNOT_PGDATA="$KNOT_PGDATA" KNOT_PGLOG="$KNOT_PGLOG" KNOT_PG_BIN="$KNOT_PG_BIN" \
      "$SCRIPT_DIR/ensure-knot-postgres.sh"
  fi
  # 端口上已经有库时也要确保 knot 这个库存在；已存在就忽略。
  "$KNOT_PG_BIN/createdb" -h 127.0.0.1 -p "$KNOT_PGPORT" -U knot knot 2>/dev/null || true
  DATABASE_URL="postgres://knot@127.0.0.1:$KNOT_PGPORT/knot"
fi
export DATABASE_URL

# ---- 构建 ----
echo "==> npm ci"
npm --prefix "$KNOT_REPO_ROOT/knot-platform" ci

echo "==> build web"
npm --prefix "$KNOT_REPO_ROOT/knot-platform" run build:web

# ---- 迁移 ----
knot_bootout_launchd com.knot.platform

echo "==> migrate"
migrated=0
for _ in $(seq 1 20); do
  if npm --prefix "$KNOT_REPO_ROOT/knot-platform" run migrate; then
    migrated=1
    break
  fi
  sleep 2
done
if [[ "$migrated" != 1 ]]; then
  knot_fail "迁移失败。检查 DATABASE_URL 和数据库是否已启动。"
fi

echo "==> move uploads into blobs/ and derived/"
# migrate-storage-layout 通过 UPLOAD_DIR 找目录；默认的 data/uploads 不是部署路径。
UPLOAD_DIR="$KNOT_UPLOAD_DIR" node knot-platform/backend/scripts/migrate-storage-layout.mjs --apply

# ---- 运行时环境文件 ----
# 值从哪里来、哪些键会被写，全在 ops/config/schema.mjs 里定义。
# 已有的注释和运维改过的邮件、价格键都会保留，只更新部署相关的值。
echo "==> write $APP_ENV"
export KNOT_BACKUP_DIR KNOT_UPLOAD_DIR DATABASE_URL
node "$SCRIPT_DIR/config.mjs" env --deploy "$KNOT_DEPLOY_ENV" --out "$APP_ENV" --root "$KNOT_REPO_ROOT"
node "$SCRIPT_DIR/config.mjs" check --runtime "$APP_ENV"

# ---- LaunchAgent ----
echo "==> install LaunchAgents"
if [[ "$KNOT_DB_MODE" == "local" ]]; then
  knot_install_launchd "$KNOT_REPO_ROOT/ops/launchd/com.knot.postgres.plist" com.knot.postgres
else
  knot_bootout_launchd com.knot.postgres
fi
knot_install_launchd "$KNOT_REPO_ROOT/ops/launchd/com.knot.platform.plist" com.knot.platform

chmod +x "$SCRIPT_DIR/backup-knot.sh" "$SCRIPT_DIR/audit-knot-storage.sh" "$SCRIPT_DIR/gc-knot-storage.sh"
if [[ -n "$KNOT_BACKUP_DIR" ]]; then
  knot_install_launchd "$KNOT_REPO_ROOT/ops/launchd/com.knot.backup.plist" com.knot.backup
else
  echo "==> KNOT_BACKUP_DIR 未配置，不装备份 LaunchAgent"
  knot_bootout_launchd com.knot.backup
fi

# 每月 1 日 04:45 只出回收报告，不删。要真删得人工加 --apply。
knot_install_launchd "$KNOT_REPO_ROOT/ops/launchd/com.knot.gc.plist" com.knot.gc

# ---- 边缘隧道 ----
if knot_enabled KNOT_EDGE && knot_enabled KNOT_TUNNEL; then
  echo "==> install edge tunnel LaunchAgent"
  knot_install_launchd "$KNOT_REPO_ROOT/ops/launchd/com.knot.edge-tunnel.plist" com.knot.edge-tunnel
else
  knot_bootout_launchd com.knot.edge-tunnel
fi

# ---- OpenClaw（可选） ----
openclaw_mode="$(printf '%s' "$KNOT_OPENCLAW" | tr '[:upper:]' '[:lower:]')"
case "$openclaw_mode" in
  0|false|no|off)
    echo "==> KNOT_OPENCLAW=0，跳过 OpenClaw"
    ;;
  auto|"")
    if command -v openclaw >/dev/null 2>&1; then
      echo "==> openclaw"
      chmod +x "$SCRIPT_DIR/ensure-openclaw.sh"
      OPENCLAW_ENABLE_PROCESS=1 "$SCRIPT_DIR/ensure-openclaw.sh"
    else
      echo "==> 未安装 openclaw，跳过（KNOT_OPENCLAW=auto）"
    fi
    ;;
  *)
    echo "==> openclaw"
    chmod +x "$SCRIPT_DIR/ensure-openclaw.sh"
    OPENCLAW_ENABLE_PROCESS=1 "$SCRIPT_DIR/ensure-openclaw.sh"
    ;;
esac

# ---- 健康检查 ----
healthy=0
for _ in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:$KNOT_PORT/api/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  knot_fail "Backend 没有在 127.0.0.1:$KNOT_PORT 起来。看 var/log/knot-platform.err.log。"
fi

echo "OK: $KNOT_PUBLIC_ORIGIN"
echo "    本机 http://127.0.0.1:$KNOT_PORT"
