#!/usr/bin/env bash
# 部署脚本共用的配置读取与默认值。
#
# 只做三件事：
#   1. 读 ops/deploy.env（不存在的旧机器仍读进程环境变量，保持兼容）；
#   2. 补默认值，所有站点相关取值都不在脚本里写死；
#   3. 提供渲染模板、写 env 文件、装 LaunchAgent 的小工具。
#
# 兼容 macOS 自带的 bash 3.2：不用关联数组、不用 mapfile、不用 ${var,,}。

KNOT_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
KNOT_DEPLOY_ENV="${KNOT_DEPLOY_ENV:-$KNOT_REPO_ROOT/ops/deploy.env}"

if [[ -f "$KNOT_DEPLOY_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$KNOT_DEPLOY_ENV"
  set +a
fi

# ---- 站点 ----
KNOT_SITE_NAME="${KNOT_SITE_NAME:-Knot}"
KNOT_SITE_TAGLINE="${KNOT_SITE_TAGLINE:-面向 AI 时代、服务于 Agent 的信息交换网。}"
# 站点自己的 logo 地址，可以留空；XKnot 那一份不在这里。
KNOT_SITE_LOGO="${KNOT_SITE_LOGO:-}"
KNOT_PORT="${KNOT_PORT:-8080}"
KNOT_BIND_HOST="${KNOT_BIND_HOST:-0.0.0.0}"
KNOT_SESSION_COOKIE_NAME="${KNOT_SESSION_COOKIE_NAME:-knot_sid}"
KNOT_PUBLIC_ORIGIN="${KNOT_PUBLIC_ORIGIN:-http://127.0.0.1:$KNOT_PORT}"

knot_origin_host() {
  local value="${1:-}"
  value="${value#*://}"
  value="${value%%/*}"
  value="${value%%:*}"
  printf '%s' "$value"
}

KNOT_DOMAIN="${KNOT_DOMAIN:-$(knot_origin_host "$KNOT_PUBLIC_ORIGIN")}"

# ---- 平台主机 ----
KNOT_DB_MODE="${KNOT_DB_MODE:-local}"
KNOT_DATABASE_URL="${KNOT_DATABASE_URL:-${DATABASE_URL:-}}"
KNOT_PGPORT="${KNOT_PGPORT:-5433}"
KNOT_PGDATA="${KNOT_PGDATA:-$HOME/knot/pgdata}"
KNOT_PGLOG="${KNOT_PGLOG:-$HOME/knot/pg.log}"
# Homebrew 在 Apple Silicon 装到 /opt/homebrew，Intel 在 /usr/local。
KNOT_PG_BIN="${KNOT_PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
KNOT_UPLOAD_DIR="${KNOT_UPLOAD_DIR:-$KNOT_REPO_ROOT/var/uploads}"
KNOT_BACKUP_DIR="${KNOT_BACKUP_DIR:-}"
KNOT_BACKUP_KEEP="${KNOT_BACKUP_KEEP:-7}"
KNOT_OPENCLAW="${KNOT_OPENCLAW:-auto}"

# ---- 远程发布 ----
KNOT_DEPLOY_SSH="${KNOT_DEPLOY_SSH:-}"
# 远端路径：`~/...` 按目标机的 home 展开，不按本机。op/deploy.env 里写 `~`
# 会被 source 成本机 home，push-deploy.sh 会再换回远端 home。
KNOT_DEPLOY_DIR="${KNOT_DEPLOY_DIR:-~/knot/AgentLink}"
KNOT_DEPLOY_SSH_KEY="${KNOT_DEPLOY_SSH_KEY:-}"
KNOT_DEPLOY_VERIFY_URL="${KNOT_DEPLOY_VERIFY_URL:-}"

# ---- 云端边缘 ----
KNOT_EDGE="${KNOT_EDGE:-0}"
KNOT_EDGE_SSH="${KNOT_EDGE_SSH:-}"
# 从开发机推页面用的私钥
KNOT_EDGE_SSH_KEY="${KNOT_EDGE_SSH_KEY:-$HOME/.ssh/id_rsa}"
# 平台主机上推公开快照用的私钥（和开发机不是同一把）
KNOT_EDGE_PUSH_KEY="${KNOT_EDGE_PUSH_KEY:-$HOME/.ssh/knot-edge-publish}"
KNOT_EDGE_WEB_ROOT="${KNOT_EDGE_WEB_ROOT:-/var/www/knot}"
KNOT_EDGE_CONF="${KNOT_EDGE_CONF:-/etc/nginx/conf.d/knot.conf}"
KNOT_EDGE_WEB_OWNER="${KNOT_EDGE_WEB_OWNER:-nginx:nginx}"
KNOT_EDGE_CACHE_DIR="${KNOT_EDGE_CACHE_DIR:-/var/cache/nginx/knot_uploads}"
KNOT_EDGE_CACHE_ZONE="${KNOT_EDGE_CACHE_ZONE:-knot_uploads}"
KNOT_EDGE_CACHE_SIZE="${KNOT_EDGE_CACHE_SIZE:-2g}"
KNOT_EDGE_MAX_BODY="${KNOT_EDGE_MAX_BODY:-52m}"
KNOT_EDGE_PROXY_PORT="${KNOT_EDGE_PROXY_PORT:-18080}"
KNOT_EDGE_SSL="${KNOT_EDGE_SSL:-1}"
if [[ -n "$KNOT_DOMAIN" ]]; then
  KNOT_EDGE_CERT="${KNOT_EDGE_CERT:-/etc/letsencrypt/live/$KNOT_DOMAIN/fullchain.pem}"
  KNOT_EDGE_KEY="${KNOT_EDGE_KEY:-/etc/letsencrypt/live/$KNOT_DOMAIN/privkey.pem}"
else
  KNOT_EDGE_CERT="${KNOT_EDGE_CERT:-}"
  KNOT_EDGE_KEY="${KNOT_EDGE_KEY:-}"
fi
KNOT_EDGE_RELOAD_CMD="${KNOT_EDGE_RELOAD_CMD:-sudo systemctl reload nginx}"
KNOT_EDGE_HOST="${KNOT_EDGE_SSH#*@}"

# ---- 隧道 ----
KNOT_TUNNEL="${KNOT_TUNNEL:-1}"
KNOT_TUNNEL_SSH="${KNOT_TUNNEL_SSH:-knot-tunnel@$KNOT_EDGE_HOST}"
KNOT_TUNNEL_KEY="${KNOT_TUNNEL_KEY:-$HOME/.ssh/knot-edge}"
KNOT_TUNNEL_LOCAL_PORT="${KNOT_TUNNEL_LOCAL_PORT:-$KNOT_PORT}"
KNOT_TUNNEL_REMOTE_PORT="${KNOT_TUNNEL_REMOTE_PORT:-$KNOT_EDGE_PROXY_PORT}"
KNOT_TUNNEL_USER="${KNOT_TUNNEL_USER:-${KNOT_TUNNEL_SSH%%@*}}"

# ---- 工具 ----

knot_fail() {
  echo "错误：$*" >&2
  exit 1
}

knot_warn() {
  echo "警告：$*" >&2
}

knot_require() {
  local name="$1"
  local hint="${2:-在 $KNOT_DEPLOY_ENV 里配置 $name}"
  if [[ -z "${!name:-}" ]]; then
    knot_fail "缺少 $name。$hint"
  fi
}

knot_enabled() {
  case "$(printf '%s' "${!1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

knot_expand_path() {
  case "${1:-}" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s/%s' "$HOME" "${1#\~/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# 用 ops/scripts/render-config.mjs 渲染 {{VAR}} 与 {{#VAR}}…{{/VAR}}。
knot_render() {
  local template="$1"
  local dest="${2:--}"
  node "$KNOT_REPO_ROOT/ops/scripts/render-config.mjs" "$template" "$dest"
}

# 改写 env 文件里的一行，保留其他行和注释。
# 值里有空格、$、引号等 shell 特殊字符时用单引号包起来，
# 否则 run-knot-platform.sh / backup-knot.sh source 时会拆词或展开。
knot_env_set() {
  local file="$1"
  local key="$2"
  local value="$3"
  local out
  value="${value//$'\n'/ }"
  case "$value" in
    "" | *[!A-Za-z0-9_./:@%+=,-]*)
      value="${value//\'/\'\\\'\'}"
      out="'$value'"
      ;;
    *) out="$value" ;;
  esac
  local tmp="${file}.tmp.$$"
  touch "$file"
  awk -v key="$key" -v value="$out" '
    BEGIN { done = 0 }
    index($0, key "=") == 1 { print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$file" >"$tmp"
  mv "$tmp" "$file"
  # 运行时文件里有 SMTP 密码和管理令牌，只给属主读写。
  chmod 600 "$file"
}

knot_env_get() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 0
  # 在子 shell 里 source，拿到的就是展开、去引号后的真实值。
  (
    set -a
    # shellcheck source=/dev/null
    source "$file" >/dev/null 2>&1 || true
    set +a
    printf '%s' "${!key:-}"
  )
}

# 装一个 LaunchAgent。plist 里的 __KNOT_HOME__ 替换成仓库路径。
knot_install_launchd() {
  local src="$1"
  local label="$2"
  local domain="gui/$(id -u)"
  local dest="$HOME/Library/LaunchAgents/$label.plist"
  local attempt=1
  mkdir -p "$(dirname "$dest")"
  sed "s|__KNOT_HOME__|$KNOT_REPO_ROOT|g" "$src" >"$dest"
  launchctl bootout "$domain/$label" 2>/dev/null || true
  # bootout 是异步的，紧接着 bootstrap 偶发 "Input/output error"。
  # 已经加载上了也算成功，最多等 10 秒再放弃。
  while ! launchctl bootstrap "$domain" "$dest" 2>/dev/null; do
    if launchctl print "$domain/$label" >/dev/null 2>&1; then break; fi
    if (( attempt >= 10 )); then
      # 最后一次不吞错误，让调用方看到真实原因。
      launchctl bootstrap "$domain" "$dest"
      break
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  launchctl kickstart -k "$domain/$label" 2>/dev/null || true
}

knot_bootout_launchd() {
  local label="$1"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
}

# 默认值也要进环境，模板渲染和远端命令都从环境里取。
for __knot_name in $(compgen -v | grep '^KNOT_'); do
  export "$__knot_name"
done
unset __knot_name
