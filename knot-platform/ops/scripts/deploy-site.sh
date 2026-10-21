#!/usr/bin/env bash
# 在一个已经装好 Node.js 的实例主机上安装一份**已经构建好的** Knot 发布包。
#
# 这里不做构建：不跑 npm ci，不跑 vite build。构建在开发机做（ops/scripts/build.sh），
# 产物是一个 tar.gz，解包后就是一个可运行的代码目录。
#
# 目录布局（部署根 = KNOT_DEPLOY_DIR）：
#   sites/<站点>/       配置，升级不动
#   releases/<版本>/    代码，一个发布包一份
#   current -> releases/<版本>
#   var/uploads/        数据，回滚不动
#   var/log/
#   deployed.json       当前版本、上一个版本
#
# 用法：
#   ./ops/scripts/deploy-site.sh --site wang                    # 在发布包目录里
#   ./ops/scripts/deploy-site.sh --site wang --artifact <tar.gz>
#   ./ops/scripts/deploy-site.sh --site wang --dry-run          # 只检查，不动手
#   ./ops/scripts/deploy-site.sh --site local --artifact <tar.gz> --deploy-root "$PWD"
#                                                                # local：目标就是本机
#   ./ops/scripts/deploy-site.sh --site wang --runtime systemd  # Linux 实例主机
#   ./ops/scripts/deploy-site.sh --site wang --runtime none     # 没有服务管理器时后台起
#
# 从开发机一步完成构建、传输和部署用 ./ops/scripts/push-deploy.sh。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SITE_ARG=""
ARTIFACT_ARG=""
DEPLOY_ROOT_ARG=""
RUNTIME_ARG=""
DRY_RUN=0
NO_ROLLBACK=0
ALLOW_PLATFORM_MISMATCH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--site 后面要跟站点名" >&2; exit 2; }
      SITE_ARG="$2"
      shift 2
      ;;
    --artifact)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--artifact 后面要跟 tar.gz 或发布包目录" >&2; exit 2; }
      ARTIFACT_ARG="$2"
      shift 2
      ;;
    --deploy-root)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--deploy-root 后面要跟目录" >&2; exit 2; }
      DEPLOY_ROOT_ARG="$2"
      shift 2
      ;;
    --runtime)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--runtime 后面要跟 launchd / systemd / none" >&2; exit 2; }
      RUNTIME_ARG="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --no-auto-rollback)
      NO_ROLLBACK=1
      shift
      ;;
    --allow-platform-mismatch)
      ALLOW_PLATFORM_MISMATCH=1
      shift
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 2
      ;;
  esac
done
[[ -n "$SITE_ARG" ]] && export KNOT_SITE="$SITE_ARG"
# 从解包出来的临时目录安装时，部署根还没法从脚本位置推出来，先显式给它。
[[ -n "$DEPLOY_ROOT_ARG" ]] && export KNOT_DEPLOY_ROOT="$DEPLOY_ROOT_ARG"

# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
CONFIG_ARGS=(--site "$KNOT_SITE")

# ---- 0. 发布包 ----
# 允许 --artifact 指 tar.gz：解到暂存区，再把代码目录切过去。
STAGING=""
cleanup() {
  if [[ -n "$STAGING" && -d "$STAGING" ]]; then
    rm -rf "$STAGING"
  fi
  return 0
}
trap cleanup EXIT

if [[ -n "$ARTIFACT_ARG" ]]; then
  [[ -e "$ARTIFACT_ARG" ]] || knot_fail "找不到发布包：$ARTIFACT_ARG"
  if [[ -d "$ARTIFACT_ARG" ]]; then
    KNOT_APP_DIR="$(cd "$ARTIFACT_ARG" && pwd -P)"
    export KNOT_APP_DIR
  else
    command -v node >/dev/null 2>&1 || knot_fail "需要 node 来校验发布包。"
    node "$SCRIPT_DIR/artifact.mjs" verify "$ARTIFACT_ARG" >/dev/null ||
      knot_fail "发布包校验失败：$ARTIFACT_ARG"
    STAGING="$(mktemp -d "${TMPDIR:-/tmp}/knot-release.XXXXXX")"
    tar -xzf "$ARTIFACT_ARG" -C "$STAGING"
    APP_IN_TAR="$(find "$STAGING" -maxdepth 1 -mindepth 1 -type d | head -n 1)"
    [[ -n "$APP_IN_TAR" ]] || knot_fail "发布包里没有目录：$ARTIFACT_ARG"
    KNOT_APP_DIR="$(cd "$APP_IN_TAR" && pwd -P)"
    export KNOT_APP_DIR
  fi
fi

[[ -f "$KNOT_APP_DIR/BUILD.json" ]] || knot_fail "这是源码目录，不是发布包。
先在开发机构建：  ./ops/scripts/build.sh
或者一步到位：    ./ops/scripts/push-deploy.sh --site $KNOT_SITE
从 tar.gz 安装：  ./ops/scripts/deploy-site.sh --site $KNOT_SITE --artifact <tar.gz>"

command -v node >/dev/null 2>&1 || knot_fail "需要 Node.js 22+。发布包里已经带生产依赖，但运行时仍要有 node。"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 22 ]] || knot_fail "Node.js 版本太低（$(node -v)），需要 22+。"

MANIFEST="$KNOT_APP_DIR/BUILD.json"
REL_NAME="$(node "$SCRIPT_DIR/artifact.mjs" field release "$MANIFEST")"
REL_VERSION="$(node "$SCRIPT_DIR/artifact.mjs" field version "$MANIFEST")"
REL_COMMIT="$(node "$SCRIPT_DIR/artifact.mjs" field commit "$MANIFEST")"
REL_PLATFORM="$(node "$SCRIPT_DIR/artifact.mjs" field platform "$MANIFEST")"
HOST_PLATFORM="$(node "$SCRIPT_DIR/artifact.mjs" platform)"
if [[ "$REL_PLATFORM" != "$HOST_PLATFORM" && "$ALLOW_PLATFORM_MISMATCH" != 1 ]]; then
  knot_fail "发布包是 ${REL_PLATFORM}，这台机器是 ${HOST_PLATFORM}。
   原生模块（如 sharp）不能跨平台。请在这台机器同平台的环境里重新构建。
确知没问题时加 --allow-platform-mismatch。"
fi

# ---- 1. 站点配置 ----
echo "==> check sites/$KNOT_SITE/site.env"
node "$SCRIPT_DIR/config.mjs" check "${CONFIG_ARGS[@]}"

RUNTIME="${RUNTIME_ARG:-}"
if [[ -z "$RUNTIME" ]]; then
  case "$(uname -s)" in
    Darwin) RUNTIME=launchd ;;
    Linux) RUNTIME=systemd ;;
    *) RUNTIME=none ;;
  esac
fi
case "$RUNTIME" in
  launchd | systemd | none) ;;
  *) knot_fail "--runtime 只能是 launchd、systemd 或 none。" ;;
esac

if [[ "$RUNTIME" == "systemd" && "$KNOT_DB_MODE" == "local" ]]; then
  knot_fail "KNOT_DB_MODE=local 只支持 macOS + Homebrew Postgres。
Linux 实例主机请用 KNOT_DB_MODE=external 接已有数据库。"
fi
if [[ "$RUNTIME" == "launchd" ]] && [[ "$KNOT_DB_MODE" == "local" && ! -x "$KNOT_PG_BIN/pg_ctl" ]]; then
  knot_fail "缺少 postgresql@16：brew install postgresql@16（或把 KNOT_PG_BIN 指向它的 bin 目录）。也可用 KNOT_DB_MODE=external 接已有数据库。"
fi
if [[ "$RUNTIME" == "systemd" ]]; then
  if ! id "$KNOT_SERVICE_USER" >/dev/null 2>&1; then
    knot_warn "系统账号 $KNOT_SERVICE_USER 不存在。systemd 会起不来：先 useradd，或把 KNOT_SERVICE_USER 改成部署账号。"
  elif [[ "$(id -un)" != "$KNOT_SERVICE_USER" ]]; then
    knot_warn "当前是 $(id -un)，服务要跑成 ${KNOT_SERVICE_USER}。确认它能读 ${KNOT_DEPLOY_ROOT}、能写 $KNOT_DEPLOY_ROOT/var。"
  fi
fi

# 启停就这一个入口：迁移失败回滚和正常启动都走它。
restart_backend() {
  case "$RUNTIME" in
    launchd)
      knot_install_launchd "$KNOT_APP_DIR/ops/launchd/com.knot.platform.plist" com.knot.platform
      ;;
    systemd)
      knot_install_systemd_unit "$KNOT_APP_DIR/ops/systemd/knot-backend.service" knot-backend.service
      knot_systemctl daemon-reload
      knot_systemctl enable knot-backend >/dev/null 2>&1 || true
      knot_systemctl restart knot-backend
      ;;
    *)
      # 没有服务管理器时自己拉起后台进程：KNOT_SITE 决定读哪份 platform.env，
      # pid 记在 var/run/backend.pid，回滚时也走这里先把上一个进程停掉。
      MANUAL_LOG_DIR="$KNOT_DEPLOY_ROOT/var/log"
      MANUAL_RUN_DIR="$KNOT_DEPLOY_ROOT/var/run"
      mkdir -p "$MANUAL_LOG_DIR" "$MANUAL_RUN_DIR"
      MANUAL_PID_FILE="$MANUAL_RUN_DIR/backend.pid"
      if [[ -f "$MANUAL_PID_FILE" ]]; then
        OLD_PID="$(cat "$MANUAL_PID_FILE" 2>/dev/null || true)"
        if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
          echo "==> stop backend (pid $OLD_PID)"
          kill "$OLD_PID" 2>/dev/null || true
          for _ in $(seq 1 50); do
            kill -0 "$OLD_PID" 2>/dev/null || break
            sleep 0.1
          done
        fi
        rm -f "$MANUAL_PID_FILE"
      fi
      echo "==> start backend in background (pid → var/run/backend.pid)"
      # 用干净环境启动，和 launchd/systemd 一样只认 platform.env，不要继承部署脚本导出的 site 键。
      # 新开会话：部署脚本退出后它要还在。
      knot_start_detached "$MANUAL_PID_FILE" "$MANUAL_LOG_DIR/knot-platform.log" \
        env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" \
        KNOT_SITE="$KNOT_SITE" KNOT_DEPLOY_ROOT="$KNOT_DEPLOY_ROOT" \
        "$KNOT_APP_DIR/ops/scripts/run-knot-platform.sh"
      # 等它把 pid 写进来，不要立刻探活。
      for _ in $(seq 1 50); do
        [[ -s "$MANUAL_PID_FILE" ]] && break
        sleep 0.1
      done
      ;;
  esac
}

# 对外地址还写 127.0.0.1 时提醒一次：别人通过这个地址拿分享图和二维码会打不开。
# 但只绑回环地址的站点（开发者的本机实例）本来就只在自己这台机器上看，不算问题。
case "$(knot_origin_host "$KNOT_PUBLIC_ORIGIN")" in
  127.0.0.1 | localhost | "")
    case "${KNOT_BIND_HOST:-127.0.0.1}" in
      127.0.0.1 | localhost | ::1 | "")
        ;;
      *)
        knot_warn "KNOT_PUBLIC_ORIGIN 还是本机地址；分享图和二维码会指向 ${KNOT_PUBLIC_ORIGIN}。要让别人访问，请走 xknot.si 子域部署。"
        ;;
    esac
    ;;
esac

if knot_enabled KNOT_ENTRY_ENABLED; then
  knot_require KNOT_ENTRY_SSH "KNOT_ENTRY_ENABLED=1 时要配置 KNOT_ENTRY_SSH=user@entry-host。只部署本机请设 KNOT_ENTRY_ENABLED=0。"
  if knot_enabled KNOT_TUNNEL; then
    knot_require KNOT_TUNNEL_SSH "KNOT_TUNNEL=1 时要有隧道账号；留空会自动用 knot-tunnel@<入口主机>。"
    TUNNEL_KEY="$(knot_expand_path "$KNOT_TUNNEL_KEY")"
    if [[ ! -f "$TUNNEL_KEY" ]]; then
      knot_warn "隧道私钥不存在：${TUNNEL_KEY}。先把公钥装到入口主机的 $KNOT_TUNNEL_USER 账号，否则隧道起不来。"
    fi
  fi
  PUSH_KEY="$(knot_expand_path "$KNOT_ENTRY_PUSH_KEY")"
  if [[ ! -f "$PUSH_KEY" ]]; then
    knot_warn "快照推送私钥不存在：${PUSH_KEY}。没有它，/discover.json 不会被推到入口主机。"
  fi
fi

REL_DIR="$KNOT_RELEASES_DIR/$REL_NAME"
UPGRADE=0
PREV_TARGET=""
if [[ -e "$KNOT_DEPLOY_ROOT/current" ]]; then
  PREV_TARGET="$(readlink "$KNOT_DEPLOY_ROOT/current" 2>/dev/null || true)"
  [[ "$PREV_TARGET" == "releases/$REL_NAME" ]] || UPGRADE=1
fi

if [[ "$DRY_RUN" == 1 ]]; then
  echo
  echo "dry-run：检查通过，没有改动任何文件。"
  echo "  发布包    $REL_NAME  ($REL_VERSION $REL_COMMIT, $REL_PLATFORM)"
  echo "  部署根    $KNOT_DEPLOY_ROOT"
  echo "  装到      $REL_DIR"
  echo "  当前版本  ${PREV_TARGET:-(未安装)}"
  echo "  运行时    $RUNTIME"
  echo "  数据目录  $KNOT_UPLOAD_DIR"
  echo "  配置      $KNOT_PLATFORM_ENV"
  echo "  接入      $([[ -f "$KNOT_XKNOT_ENV" ]] && echo "$KNOT_XKNOT_ENV" || echo "未接入 XKnot（可选）")"
  exit 0
fi

# ---- 2. 装发布包 ----
mkdir -p "$KNOT_RELEASES_DIR"
APP_PHYSICAL="$(cd "$KNOT_APP_DIR" && pwd -P)"
if [[ "$APP_PHYSICAL" != "$(cd "$KNOT_RELEASES_DIR" && pwd -P)/$REL_NAME" ]]; then
  echo "==> install $REL_DIR"
  TMP_REL="$KNOT_RELEASES_DIR/.$REL_NAME.$$"
  rm -rf "$TMP_REL"
  mkdir -p "$TMP_REL"
  rsync -a --delete "$KNOT_APP_DIR/" "$TMP_REL/"
  chmod +x "$TMP_REL/ops/scripts/"*.sh 2>/dev/null || true
  rm -rf "$REL_DIR"
  mv "$TMP_REL" "$REL_DIR"
else
  echo "==> already installed $REL_DIR"
fi
# 后面所有步骤都用装好的那一份，不用暂存区。
KNOT_APP_DIR="$(cd "$REL_DIR" && pwd -P)"
export KNOT_APP_DIR

VENV_SCRIPTS="$KNOT_APP_DIR/ops/scripts"
mkdir -p "$KNOT_DEPLOY_ROOT/var/log" "$KNOT_DEPLOY_ROOT/var/uploads" "$KNOT_SITE_DIR/agents"
chmod 700 "$KNOT_SITE_DIR" "$KNOT_SITE_DIR/agents"
chmod +x "$VENV_SCRIPTS/"*.sh 2>/dev/null || true

APP_ENV="$KNOT_PLATFORM_ENV"

# 旧机器把备份目录写在环境文件里；部署配置没写时沿用，避免升级后备份悄悄停掉。
if [[ -z "$KNOT_BACKUP_DIR" ]]; then
  KNOT_BACKUP_DIR="$(knot_env_get "$APP_ENV" KNOT_BACKUP_DIR)"
fi
KNOT_UPLOAD_DIR="$(knot_expand_path "$KNOT_UPLOAD_DIR")"

# ---- 3. 数据库 ----
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
      "$VENV_SCRIPTS/ensure-knot-postgres.sh"
  fi
  # 端口上已经有库时也要确保 knot 这个库存在；已存在就忽略。
  "$KNOT_PG_BIN/createdb" -h 127.0.0.1 -p "$KNOT_PGPORT" -U knot knot 2>/dev/null || true
  DATABASE_URL="postgres://knot@127.0.0.1:$KNOT_PGPORT/knot"
fi
export DATABASE_URL

# ---- 4. 停服务 → 迁移 ----
case "$RUNTIME" in
  launchd) knot_bootout_launchd com.knot.platform ;;
  systemd) knot_systemctl stop knot-backend 2>/dev/null || true ;;
  *) ;;
esac

echo "==> migrate"
migrated=0
MIGRATE_LOG="$(mktemp "${TMPDIR:-/tmp}/knot-migrate.XXXXXX")"
for _ in $(seq 1 5); do
  if DATABASE_URL="$DATABASE_URL" node "$KNOT_APP_DIR/backend/scripts/migrate.js" >"$MIGRATE_LOG" 2>&1; then
    migrated=1
    break
  fi
  sleep 2
done
cat "$MIGRATE_LOG"
rm -f "$MIGRATE_LOG"
if [[ "$migrated" != 1 ]]; then
  # 迁移失败时把旧版本拉回来，别让站点空着。
  if [[ -n "$PREV_TARGET" ]]; then
    knot_warn "迁移失败。当前版本仍是 ${PREV_TARGET}。"
    ln -sfn "$PREV_TARGET" "$KNOT_DEPLOY_ROOT/current"
    restart_backend
  fi
  knot_fail "迁移失败。检查 DATABASE_URL 和数据库是否已启动。"
fi

echo "==> move uploads into blobs/ and derived/"
if [[ -f "$KNOT_APP_DIR/backend/scripts/migrate-storage-layout.mjs" ]]; then
  UPLOAD_DIR="$KNOT_UPLOAD_DIR" node "$KNOT_APP_DIR/backend/scripts/migrate-storage-layout.mjs" --apply
fi

# ---- 5. 切换版本 ----
if [[ "$UPGRADE" == 1 ]]; then
  echo "==> current: ${PREV_TARGET:-无} → releases/$REL_NAME"
else
  echo "==> current: releases/$REL_NAME"
fi
ln -sfn "releases/$REL_NAME" "$KNOT_DEPLOY_ROOT/current"

# ---- 6. 运行时环境文件 ----
# 值从哪里来、哪些键会被写，全在 packages/knot-config/src/schema.mjs 里定义。
# 已有的注释和运维改过的邮件、价格键都会保留，只更新部署相关的值。
echo "==> write $APP_ENV"
export KNOT_BACKUP_DIR KNOT_UPLOAD_DIR DATABASE_URL
node "$KNOT_APP_DIR/ops/scripts/config.mjs" env "${CONFIG_ARGS[@]}" \
  --out "$APP_ENV" --root "$KNOT_DEPLOY_ROOT/current" --deploy-root "$KNOT_DEPLOY_ROOT"
node "$KNOT_APP_DIR/ops/scripts/config.mjs" check --platform --site "$KNOT_SITE"
# 接入文件可选；存在就一并校验，缺失只提示不报错。
node "$KNOT_APP_DIR/ops/scripts/config.mjs" check --xknot --site "$KNOT_SITE"
if [[ -f "$KNOT_XKNOT_ENV" ]]; then
  chmod 600 "$KNOT_XKNOT_ENV"
fi

# ---- 7. 服务 ----
case "$RUNTIME" in
  launchd)
    echo "==> install LaunchAgents"
    if [[ "$KNOT_DB_MODE" == "local" ]]; then
      knot_install_launchd "$KNOT_APP_DIR/ops/launchd/com.knot.postgres.plist" com.knot.postgres
    else
      knot_bootout_launchd com.knot.postgres
    fi
    chmod +x "$VENV_SCRIPTS/backup-knot.sh" "$VENV_SCRIPTS/audit-knot-storage.sh" "$VENV_SCRIPTS/gc-knot-storage.sh"
    if [[ -n "$KNOT_BACKUP_DIR" ]]; then
      knot_install_launchd "$KNOT_APP_DIR/ops/launchd/com.knot.backup.plist" com.knot.backup
    else
      echo "==> KNOT_BACKUP_DIR 未配置，不装备份 LaunchAgent"
      knot_bootout_launchd com.knot.backup
    fi
    # 每月 1 日 04:45 只出回收报告，不删。要真删得人工加 --apply。
    knot_install_launchd "$KNOT_APP_DIR/ops/launchd/com.knot.gc.plist" com.knot.gc
    # 0.3.0 之前这个常驻服务叫 com.knot.edge-tunnel。改名后必须把旧 job 和 plist 清掉，
    # 否则它会反复去执行已不存在的 run-edge-tunnel.sh。
    knot_bootout_launchd com.knot.edge-tunnel
    rm -f "$HOME/Library/LaunchAgents/com.knot.edge-tunnel.plist"
    if knot_enabled KNOT_ENTRY_ENABLED && knot_enabled KNOT_TUNNEL; then
      echo "==> install entry tunnel LaunchAgent"
      knot_install_launchd "$KNOT_APP_DIR/ops/launchd/com.knot.entry-tunnel.plist" com.knot.entry-tunnel
    else
      knot_bootout_launchd com.knot.entry-tunnel
    fi
    ;;
  systemd)
    echo "==> install systemd units"
    knot_install_systemd_unit "$KNOT_APP_DIR/ops/systemd/knot-backend.service" knot-backend.service
    if [[ -n "$KNOT_BACKUP_DIR" ]]; then
      knot_install_systemd_unit "$KNOT_APP_DIR/ops/systemd/knot-backup.service" knot-backup.service
      knot_install_systemd_unit "$KNOT_APP_DIR/ops/systemd/knot-backup.timer" knot-backup.timer
      knot_systemctl enable --now knot-backup.timer
    fi
    knot_install_systemd_unit "$KNOT_APP_DIR/ops/systemd/knot-gc.service" knot-gc.service
    knot_install_systemd_unit "$KNOT_APP_DIR/ops/systemd/knot-gc.timer" knot-gc.timer
    knot_systemctl daemon-reload
    knot_systemctl enable --now knot-gc.timer
    ;;
  *) ;;
esac

echo "==> start backend"
restart_backend

# ---- 8. 探活（失败自动回滚代码，数据库不回滚） ----
healthy=0
BODY=""
for _ in $(seq 1 30); do
  BODY="$(curl -sf "http://127.0.0.1:$KNOT_PORT/api/health" 2>/dev/null || true)"
  if [[ -n "$BODY" ]]; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "$healthy" == 1 ]]; then
  RUNNING_VERSION="$(node -e 'try { process.stdout.write(String(JSON.parse(process.argv[1]).version || "")) } catch {}' "$BODY")"
  RUNNING_RELEASE="$(node -e 'try { process.stdout.write(String(JSON.parse(process.argv[1]).release || "")) } catch {}' "$BODY")"
  RUNNING_COMMIT="$(node -e 'try { process.stdout.write(String(JSON.parse(process.argv[1]).commit || "")) } catch {}' "$BODY")"
  # 发布包名以 BUILD.json 为准；老版本没有 release 字段时退回比版本号。
  if [[ -n "$RUNNING_RELEASE" ]]; then
    if [[ "$RUNNING_RELEASE" != "$REL_NAME" ]]; then
      knot_warn "探活报的发布包是 ${RUNNING_RELEASE}，本次装的是 ${REL_NAME}。可能还有一个旧进程占着端口。"
    fi
  elif [[ -n "$RUNNING_VERSION" && "$RUNNING_VERSION" != "$REL_VERSION" ]]; then
    knot_warn "探活报的版本是 ${RUNNING_VERSION}，发布包是 ${REL_VERSION}。可能还有一个旧进程占着端口。"
  fi
  if [[ -n "$RUNNING_COMMIT" && "$RUNNING_COMMIT" != "$REL_COMMIT" ]]; then
    knot_warn "探活报的提交是 ${RUNNING_COMMIT}，发布包是 ${REL_COMMIT}。"
  fi
else
  if [[ -n "$PREV_TARGET" && "$NO_ROLLBACK" != 1 ]]; then
    knot_warn "新版本没有通过探活，回滚到 $PREV_TARGET"
    ln -sfn "$PREV_TARGET" "$KNOT_DEPLOY_ROOT/current"
    restart_backend
    if curl -sf "http://127.0.0.1:$KNOT_PORT/api/health" >/dev/null 2>&1; then
      knot_fail "新版本 $REL_NAME 未通过探活，已回滚到 ${PREV_TARGET}。看 var/log/knot-platform.err.log。"
    fi
    knot_fail "新版本未通过探活，回滚后仍不通。看 var/log/knot-platform.err.log。"
  fi
  knot_fail "Backend 没有在 127.0.0.1:$KNOT_PORT 起来。看 var/log/knot-platform.err.log。"
fi

# ---- 9. OpenClaw（可选） ----
openclaw_mode="$(printf '%s' "$KNOT_OPENCLAW" | tr '[:upper:]' '[:lower:]')"
case "$openclaw_mode" in
  0 | false | no | off)
    echo "==> KNOT_OPENCLAW=0，跳过 OpenClaw"
    ;;
  auto | "")
    if command -v openclaw >/dev/null 2>&1; then
      echo "==> openclaw"
      chmod +x "$KNOT_APP_DIR/ops/scripts/ensure-openclaw.sh"
      OPENCLAW_ENABLE_PROCESS=1 "$KNOT_APP_DIR/ops/scripts/ensure-openclaw.sh"
    else
      echo "==> 未安装 openclaw，跳过（KNOT_OPENCLAW=auto）"
    fi
    ;;
  *)
    echo "==> openclaw"
    chmod +x "$KNOT_APP_DIR/ops/scripts/ensure-openclaw.sh"
    OPENCLAW_ENABLE_PROCESS=1 "$KNOT_APP_DIR/ops/scripts/ensure-openclaw.sh"
    ;;
esac

# ---- 10. 记录与清理 ----
cat >"$KNOT_DEPLOY_ROOT/deployed.json" <<JSON
{
  "site": "$KNOT_SITE",
  "release": "$REL_NAME",
  "version": "$REL_VERSION",
  "commit": "$REL_COMMIT",
  "platform": "$REL_PLATFORM",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "previous": "${PREV_TARGET:-}"
}
JSON

KEEP="$KNOT_DEPLOY_KEEP"
[[ "$KEEP" =~ ^[0-9]+$ ]] || KEEP=5
if (( KEEP > 0 )) && [[ -d "$KNOT_RELEASES_DIR" ]]; then
  CURRENT_TARGET="releases/$REL_NAME"
  # 按安装时间从新到旧，先保住最近 KEEP 个，再清剩下的（当前版本和上一个永远不删）。
  ls -1dt "$KNOT_RELEASES_DIR"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) |
    while IFS= read -r dir; do
      name="$(basename "$dir")"
      [[ "releases/$name" == "$CURRENT_TARGET" ]] && continue
      [[ "releases/$name" == "${PREV_TARGET:-}" ]] && continue
      echo "==> 清理旧发布包 $name"
      rm -rf "$dir"
    done
fi

echo "OK: $KNOT_PUBLIC_ORIGIN"
echo "    版本 $REL_VERSION ($REL_COMMIT)  $REL_NAME"
echo "    本机 http://127.0.0.1:$KNOT_PORT"
[[ -n "$PREV_TARGET" ]] && echo "    回滚 $KNOT_DEPLOY_ROOT/current/ops/scripts/rollback.sh --site $KNOT_SITE"
