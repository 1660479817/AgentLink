#!/usr/bin/env bash
# 部署脚本共用的站点配置读取。
#
# 一个站点一个目录：
#
#   sites/<站点>/site.env            站点拓扑（必填）
#   sites/<站点>/profile.json        自述区：名称、介绍、logo、主理人（主理人在 /admin 编辑）
#   sites/<站点>/platform.env        实例主机运行时值（部署脚本生成）
#   sites/<站点>/xknot.env           XKnot 接入（中枢签发，可选）
#   sites/<站点>/entry.<标签>.xknot.si.env    xknot.si 子域入口（可选，一个站点一份）
#
# 目录布局（部署根 KNOT_DEPLOY_ROOT）：
#
#   sites/<站点>/        配置。不进发布包，升级不动它。
#   releases/<版本>/     代码。每个发布包一份，可回滚。
#   current -> releases/<版本>
#   var/uploads/         数据。不进发布包，回滚不动它。
#   var/log/             日志。
#
# 代码目录 KNOT_APP_DIR 由脚本自身位置推出：
#   * 从源码目录跑           = 仓库里的 knot-platform/
#   * 从发布包跑             = <部署根>/releases/<版本>
# 部署根默认取代码目录的上一级（当代码在 releases/ 下），否则等于代码目录。
#
# 选择顺序：
#   1. KNOT_SITE_FILE 指向一份 site.env（测试或特殊布局）；
#   2. KNOT_SITE 指定站点目录名；
#   3. sites/ 下恰好一个站点时自动选中。
# 这里只做四件事：
#   1. 定位站点目录并读 site.env（不存在的旧机器仍读进程环境变量，保持兼容）；
#   2. 补默认值，所有站点相关取值都不在脚本里写死；
#   3. 提供渲染模板、写 env 文件、装 LaunchAgent 的小工具；
#   4. 把站点与平台两个文件的位置导出给其他脚本。
#
# 兼容 macOS 自带的 bash 3.2：不用关联数组、不用 mapfile、不用 ${var,,}。

KNOT_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
if [[ -z "${KNOT_DEPLOY_ROOT:-}" ]]; then
  if [[ "$(basename "$(dirname "$KNOT_APP_DIR")")" == "releases" ]]; then
    KNOT_DEPLOY_ROOT="$(dirname "$(dirname "$KNOT_APP_DIR")")"
  else
    KNOT_DEPLOY_ROOT="$KNOT_APP_DIR"
  fi
fi
KNOT_RELEASES_DIR="$KNOT_DEPLOY_ROOT/releases"
KNOT_SITES_DIR="$KNOT_DEPLOY_ROOT/sites"

knot_fail() {
  echo "错误：$*" >&2
  exit 1
}

knot_warn() {
  echo "警告：$*" >&2
}

knot_list_sites() {
  local dir name
  for dir in "$KNOT_SITES_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    name="$(basename "$dir")"
    case "$name" in _*) continue ;; esac
    [[ -f "$dir/site.env" ]] || continue
    printf '%s\n' "$name"
  done
}

knot_site_name_ok() {
  # 站点名会直接拼进 $KNOT_SITES_DIR/$KNOT_SITE 与远端 sites/$KNOT_SITE。
  # 只排除非法字符不够：`.` 与 `..` 都合法却不指向一个站点目录，
  # `--site ..` 会把站点目录指到部署根，`--site ../../x` 写到 sites/ 之外。
  case "${1:-}" in
    "" | .* | *[!A-Za-z0-9._-]*) return 1 ;;
    *) return 0 ;;
  esac
}

knot_resolve_site() {
  local requested="${KNOT_SITE:-}"
  local file="${KNOT_SITE_FILE:-}"

  if [[ -n "$file" ]]; then
    [[ -f "$file" ]] || knot_fail "找不到站点配置：$file"
    KNOT_SITE_ENV="$file"
    KNOT_SITE_DIR="$(cd "$(dirname "$file")" && pwd)"
    KNOT_SITE="${requested:-$(basename "$KNOT_SITE_DIR")}"
  elif [[ -n "$requested" ]]; then
    knot_site_name_ok "$requested" || knot_fail "站点名只能用字母、数字、点、下划线和短横线：$requested"
    KNOT_SITE="$requested"
    KNOT_SITE_DIR="$KNOT_SITES_DIR/$KNOT_SITE"
    KNOT_SITE_ENV="$KNOT_SITE_DIR/site.env"
  else
    local names name
    names=""
    while IFS= read -r name; do
      [[ -n "$name" ]] || continue
      names="${names}${names:+、}${name}"
    done <<EOF
$(knot_list_sites)
EOF
    case "$names" in
      "")
        knot_fail "sites/ 下没有站点配置。先创建：mkdir -p sites/<站点> && cp sites/_template/site.env sites/<站点>/site.env"
        ;;
      *、*)
        knot_fail "sites/ 下有多个站点，请用 --site 指定或设置 KNOT_SITE。候选：$names"
        ;;
      *)
        KNOT_SITE="$names"
        KNOT_SITE_DIR="$KNOT_SITES_DIR/$KNOT_SITE"
        KNOT_SITE_ENV="$KNOT_SITE_DIR/site.env"
        ;;
    esac
  fi

  [[ -f "$KNOT_SITE_ENV" ]] || knot_fail "找不到站点配置：$KNOT_SITE_ENV"

  KNOT_PLATFORM_ENV="${KNOT_ENV:-$KNOT_SITE_DIR/platform.env}"
  # 接入文件由中枢签发，可以不存在：缺了它站点照样部署和运行。
  KNOT_XKNOT_ENV="${KNOT_XKNOT_ENV:-$KNOT_SITE_DIR/xknot.env}"

  set -a
  # shellcheck source=/dev/null
  source "$KNOT_SITE_ENV"
  set +a

  export KNOT_SITE KNOT_SITE_DIR KNOT_SITE_ENV
  export KNOT_PLATFORM_ENV KNOT_XKNOT_ENV
}

knot_resolve_site

# 读实例主机的运行时文件。文件不存在时保持 site.env 与默认值。
knot_source_platform_env() {
  [[ -f "$KNOT_PLATFORM_ENV" ]] || return 0
  set -a
  # shellcheck source=/dev/null
  source "$KNOT_PLATFORM_ENV"
  set +a
}

# ---- 站点 ----
# 站点身份（名称、介绍、logo、主理人）不在这里：它在 sites/<站点>/profile.json，
# 由主理人在 /admin 里编辑。见 docs/PROFILE.md。
KNOT_PORT="${KNOT_PORT:-8080}"
KNOT_BIND_HOST="${KNOT_BIND_HOST:-127.0.0.1}"
KNOT_SESSION_COOKIE_NAME="${KNOT_SESSION_COOKIE_NAME:-knot_sid}"
KNOT_PUBLIC_ORIGIN="${KNOT_PUBLIC_ORIGIN:-http://127.0.0.1:$KNOT_PORT}"

knot_origin_host() {
  local value="${1:-}"
  value="${value#*://}"
  value="${value%%/*}"
  value="${value%%:*}"
  printf '%s' "$value"
}

KNOT_DOMAIN="${KNOT_DOMAIN:-}"

# 管理后台链接的地址由 Backend 按「它自己监听在哪」现算（backend/src/adminHosts.js）：
# 绑回环就得到 http://127.0.0.1:<端口>，绑通配就枚举本机私有 IPv4。
#
# 站点对外是域名、页面在别人的设备上打得开，后端却只绑回环时，/mine 上那枚
# 复制出去的管理后台链接仍然以 127.0.0.1 开头——在别的设备上点开，连的是它自己，
# 那台机器上也没人在听这个端口。绑定是运维的决定（开发者本机实例就该绑回环），
# 所以这里只把后果写出来，不改绑定。
knot_admin_link_hint() {
  # 运维写死了链接地址时，Backend 照它生成，绑定方式不再决定链接。
  if [[ -n "${KNOT_ADMIN_ORIGIN:-}" ]]; then return 0; fi
  # 不能直接用 knot_origin_host：它按第一个冒号截端口，IPv6 的 [::1] 会截成 "["。
  local origin="${KNOT_PUBLIC_ORIGIN:-}"
  local host="${origin#*://}"
  host="${host%%/*}"
  if [[ "$host" == \[* ]]; then
    host="${host%%]*}"
    host="${host#[}"
  else
    host="${host%%:*}"
  fi
  case "$host" in
    127.* | localhost | ::1 | "") return 0 ;;
  esac
  case "${KNOT_BIND_HOST:-127.0.0.1}" in
    127.* | localhost | ::1 | "") ;;
    *) return 0 ;;
  esac
  printf '%s\n' "站点对外是 ${KNOT_PUBLIC_ORIGIN}，但 Backend 只绑了 ${KNOT_BIND_HOST:-127.0.0.1}：/mine 上生成的管理后台链接会指向 http://127.0.0.1:${KNOT_PORT}/admin/，只在实例这台机器上打得开。要在同一内网的其它设备上进管理后台，把 KNOT_BIND_HOST 设成 0.0.0.0 再部署一次（入口回源仍走 127.0.0.1，隧道不受影响）。"
}

# ---- 实例主机 ----
KNOT_DB_MODE="${KNOT_DB_MODE:-local}"
KNOT_DATABASE_URL="${KNOT_DATABASE_URL:-${DATABASE_URL:-}}"
KNOT_PGPORT="${KNOT_PGPORT:-5433}"
KNOT_PGDATA="${KNOT_PGDATA:-$HOME/knot/pgdata}"
KNOT_PGLOG="${KNOT_PGLOG:-$HOME/knot/pg.log}"
# Homebrew 在 Apple Silicon 装到 /opt/homebrew，Intel 在 /usr/local。
KNOT_PG_BIN="${KNOT_PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
KNOT_UPLOAD_DIR="${KNOT_UPLOAD_DIR:-$KNOT_DEPLOY_ROOT/var/uploads}"
KNOT_BACKUP_DIR="${KNOT_BACKUP_DIR:-}"
KNOT_BACKUP_KEEP="${KNOT_BACKUP_KEEP:-7}"
KNOT_OPENCLAW="${KNOT_OPENCLAW:-auto}"

# ---- 远程发布 ----
KNOT_DEPLOY_SSH="${KNOT_DEPLOY_SSH:-}"
# 远端路径：`~/...` 按目标机的 home 展开，不按本机。site.env 里写 `~`
# 会被 source 成本机 home，push-deploy.sh 会再换回远端 home。
KNOT_DEPLOY_DIR="${KNOT_DEPLOY_DIR:-~/knot/AgentLink/knot-platform}"
KNOT_DEPLOY_SSH_KEY="${KNOT_DEPLOY_SSH_KEY:-}"
KNOT_DEPLOY_VERIFY_URL="${KNOT_DEPLOY_VERIFY_URL:-}"
KNOT_DEPLOY_KEEP="${KNOT_DEPLOY_KEEP:-5}"
KNOT_ARTIFACT_DIR="${KNOT_ARTIFACT_DIR:-$KNOT_APP_DIR/artifacts}"

# ---- 公网入口 ----
KNOT_ENTRY_ENABLED="${KNOT_ENTRY_ENABLED:-0}"
KNOT_ENTRY_SSH="${KNOT_ENTRY_SSH:-}"
# 从开发机推页面用的私钥
KNOT_ENTRY_SSH_KEY="${KNOT_ENTRY_SSH_KEY:-$HOME/.ssh/id_rsa}"
# 实例主机上推公开快照用的私钥（和开发机不是同一把）
KNOT_ENTRY_PUSH_KEY="${KNOT_ENTRY_PUSH_KEY:-$HOME/.ssh/knot-entry-publish}"
KNOT_ENTRY_WEB_OWNER="${KNOT_ENTRY_WEB_OWNER:-nginx:nginx}"
KNOT_ENTRY_CACHE_DIR="${KNOT_ENTRY_CACHE_DIR:-/var/cache/nginx/knot_uploads}"
KNOT_ENTRY_CACHE_ZONE="${KNOT_ENTRY_CACHE_ZONE:-knot_uploads}"
KNOT_ENTRY_CACHE_SIZE="${KNOT_ENTRY_CACHE_SIZE:-2g}"
KNOT_ENTRY_MAX_BODY="${KNOT_ENTRY_MAX_BODY:-52m}"
KNOT_ENTRY_PROXY_PORT="${KNOT_ENTRY_PROXY_PORT:-18080}"
KNOT_ENTRY_RELOAD_CMD="${KNOT_ENTRY_RELOAD_CMD:-sudo systemctl reload nginx}"
KNOT_ENTRY_HOST="${KNOT_ENTRY_SSH#*@}"

# 入口项的默认值与推导。
#
# 单独成函数，是因为入口文件会覆盖 KNOT_DOMAIN，证书要跟着这个入口的域名重新推导。
knot_entry_defaults() {
  KNOT_ENTRY_WEB_ROOT="${KNOT_ENTRY_WEB_ROOT:-/var/www/knot}"
  KNOT_ENTRY_CONF="${KNOT_ENTRY_CONF:-/etc/nginx/conf.d/knot.conf}"
  KNOT_ENTRY_SSL="${KNOT_ENTRY_SSL:-1}"
  # 访问日志一份文件、按 $host 分：同一台入口主机上的子域共用一个聚合入口。
  KNOT_ENTRY_ACCESS_LOG="${KNOT_ENTRY_ACCESS_LOG:-/var/log/nginx/knot-access.log}"
  if [[ -n "${KNOT_DOMAIN:-}" ]]; then
    KNOT_ENTRY_CERT="${KNOT_ENTRY_CERT:-/etc/letsencrypt/live/$KNOT_DOMAIN/fullchain.pem}"
    KNOT_ENTRY_KEY="${KNOT_ENTRY_KEY:-/etc/letsencrypt/live/$KNOT_DOMAIN/privkey.pem}"
  else
    KNOT_ENTRY_CERT="${KNOT_ENTRY_CERT:-}"
    KNOT_ENTRY_KEY="${KNOT_ENTRY_KEY:-}"
  fi
}
knot_entry_defaults

# ---- 隧道 ----
KNOT_TUNNEL="${KNOT_TUNNEL:-0}"
KNOT_TUNNEL_SSH="${KNOT_TUNNEL_SSH:-knot-tunnel@$KNOT_ENTRY_HOST}"
KNOT_TUNNEL_KEY="${KNOT_TUNNEL_KEY:-$HOME/.ssh/knot-entry}"
KNOT_TUNNEL_LOCAL_PORT="${KNOT_TUNNEL_LOCAL_PORT:-$KNOT_PORT}"
KNOT_TUNNEL_REMOTE_PORT="${KNOT_TUNNEL_REMOTE_PORT:-$KNOT_ENTRY_PROXY_PORT}"
KNOT_TUNNEL_USER="${KNOT_TUNNEL_USER:-${KNOT_TUNNEL_SSH%%@*}}"

# 隧道私钥的绝对路径。
#
# 托管段（sites/<站点>/tunnel.env，由 /admin 的 XKnot 栏写）只存文件名
# `tunnel_ed25519`，相对路径按站点目录解析：站点目录整体搬家（仓库 ↔ 部署根、
# 换机器、复制一份调试）时，隧道跟着读它自己旁边那把钥匙，不会指到别处去。
# 绝对路径仍然认，手工配置沿用 `$HOME/.ssh/knot-entry` 这类写法。
knot_tunnel_key_path() {
  local value
  value="$(knot_expand_path "${KNOT_TUNNEL_KEY:-}")"
  case "$value" in
    "") printf '%s/%s' "$KNOT_SITE_DIR" "tunnel_ed25519" ;;
    /*) printf '%s' "$value" ;;
    *) printf '%s/%s' "$KNOT_SITE_DIR" "$value" ;;
  esac
}

# ---- 工具 ----

knot_require() {
  local name="$1"
  local hint="${2:-在 sites/$KNOT_SITE/site.env 里配置 $name}"
  if [[ -z "${!name:-}" ]]; then
    knot_fail "缺少 ${name}。$hint"
  fi
}

knot_enabled() {
  case "$(printf '%s' "${!1:-}" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

# 备份目录取值的归一：null / none / off 与留空同义——不备份。
# 区别只体现在部署时的提醒上：留空是「还没决定」，null 是「决定了不备份」。
# 归一之后 backup-knot.sh 不会把 null 当成目录名去 mkdir。
knot_backup_dir() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    null | none | off) printf '' ;;
    *) printf '%s' "${1:-}" ;;
  esac
}

knot_expand_path() {
  case "${1:-}" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s/%s' "$HOME" "${1#\~/}" ;;
    *) printf '%s' "$1" ;;
  esac
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

# 转义 sed 替换串里会被特殊解释的字符。
# 部署根或站点名里出现 `&` 时，sed 会把它换成匹配到的整段（`__KNOT_HOME__` 原样留着），
# 装出来的 plist / unit 就是坏的；分隔符 `|` 同理会把整句拆断。
knot_sed_value() {
  printf '%s' "${1:-}" | sed -e 's/[\\&|]/\\&/g'
}

# 装一个 LaunchAgent。
# plist 模板里的占位符：
#   __KNOT_HOME__         部署根（放 sites/、var/、releases/）
#   __KNOT_CURRENT__      代码入口 current，跟着发布包走；回滚只改这个软链
#   __KNOT_DEPLOY_ROOT__  部署根，给脚本自己读配置用
#   __KNOT_SITE__         站点名
knot_install_launchd() {
  local src="$1"
  local label="$2"
  local domain="gui/$(id -u)"
  local dest="$HOME/Library/LaunchAgents/$label.plist"
  local attempt=1
  local home_value current_value root_value site_value
  home_value="$(knot_sed_value "$KNOT_DEPLOY_ROOT")"
  current_value="$(knot_sed_value "$KNOT_DEPLOY_ROOT/current")"
  root_value="$(knot_sed_value "$KNOT_DEPLOY_ROOT")"
  site_value="$(knot_sed_value "$KNOT_SITE")"
  mkdir -p "$(dirname "$dest")" "$KNOT_DEPLOY_ROOT/var/log"
  sed -e "s|__KNOT_HOME__|$home_value|g" \
    -e "s|__KNOT_CURRENT__|$current_value|g" \
    -e "s|__KNOT_DEPLOY_ROOT__|$root_value|g" \
    -e "s|__KNOT_SITE__|$site_value|g" "$src" >"$dest"
  # 先记下旧进程：bootout 是异步的，函数返回时它可能还活着、还占着端口。
  # launchctl print 在标签没加载时返回非零，这里必须吞掉：脚本是 set -e + pipefail，
  # 一次探测失败就会让整个安装过程在这里静默中断（部署停在 "start backend"）。
  local old_pid=""
  old_pid="$(launchctl print "$domain/$label" 2>/dev/null | awk '/pid = /{print $3; exit}' || true)"
  launchctl bootout "$domain/$label" 2>/dev/null || true
  # 等旧进程真的退出再 bootstrap。否则新进程起来时端口还占着，listen 直接 EADDRINUSE
  # 崩掉，探活循环等 30 秒也等不到它，发布就被误判为失败、白白回滚一次。
  if [[ -n "$old_pid" ]]; then
    local waited=0
    while kill -0 "$old_pid" 2>/dev/null && (( waited < 100 )); do
      sleep 0.1
      waited=$((waited + 1))
    done
  fi
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

# 读某个公网入口文件里的一个键。
#
# 入口文件是叠加层：同一个键在 site.env 里有、入口里也有时，入口的赢。
knot_entry_value() {
  local entry_file="$1" key="$2"
  (
    set -a
    # shellcheck source=/dev/null
    source "$KNOT_SITE_ENV"
    # shellcheck source=/dev/null
    source "$entry_file"
    # 与渲染时一致：入口换了 KNOT_DOMAIN，证书等默认值按这个域名重新推导。
    knot_entry_defaults
    set +a
    printf '%s' "${!key:-}"
  )
}

# 入口的静态根与 nginx conf 必须一个子域一份。
#
# 缺省值 /var/www/knot 与 /etc/nginx/conf.d/knot.conf 不带域名，是同一台入口主机上
# 所有子域共用的：第二个子域照模板留空推上去，rsync --delete 会把第一个子域的静态根
# 清成自己的 dist，cp 再把它的 nginx conf 换掉——前一个站点直接换品牌或停站。
# 所以这两项留空不是「用默认」，是配错：推到入口之前就拒绝，别让 rsync 动手。
knot_require_entry_paths() {
  local web_root="${1:-}" conf="${2:-}" domain="${3:-}"
  local key value example
  for key in KNOT_ENTRY_WEB_ROOT KNOT_ENTRY_CONF; do
    case "$key" in
      KNOT_ENTRY_WEB_ROOT)
        value="$web_root"
        example="/var/www/<标签>"
        ;;
      *)
        value="$conf"
        example="/etc/nginx/conf.d/<标签>.xknot.si.conf"
        ;;
    esac
    case "$value" in
      "")
        knot_fail "入口 ${domain} 的 ${key} 是空的。在 sites/${KNOT_SITE}/entry.${domain}.env 里写成这个子域自己的路径，例如 ${example}。"
        ;;
      /var/www/knot | /etc/nginx/conf.d/knot.conf)
        knot_fail "入口 ${domain} 的 ${key} 还是共用的缺省值 ${value}。
同一台入口主机上的每个子域都要有自己的路径，否则后推的会覆盖前一个。写成 ${example}。"
        ;;
      /*) ;;
      *)
        knot_fail "入口 ${domain} 的 ${key} 必须是绝对路径：${value}"
        ;;
    esac
  done
}

# 规范入口的域名来自 KNOT_DOMAIN（local 为空，xknot.si 为签发的二级子域）。
# 在后台起一个进程，并让它脱离调用者的会话和进程组。
#
# 只 nohup 是不够的：nohup 只挡 SIGHUP。调用者（CI、后台 shell、终端复用器）
# 收尾时对整个进程组发 SIGTERM/SIGKILL，同组的孩子一样会被带走，
# 于是「部署成功、进程随后消失」。这里新开一个会话，组和会话都换掉。
#
# macOS 没有 setsid(1)，用 perl 的 fork + POSIX::setsid；两个都不可用时退回
# nohup，至少把进程起来（挡不住进程组被收，部署输出里会说清）。
#
# 用法：knot_start_detached <pid 文件> <日志文件> <命令...>
# 返回后 pid 文件里是进程本身的 pid（不是启动器的 pid）。
knot_start_detached() {
  local pid_file="$1" log_file="$2"
  shift 2
  mkdir -p "$(dirname "$pid_file")" "$(dirname "$log_file")"

  if command -v perl >/dev/null 2>&1; then
    # fork 之后在子进程里 setsid，再把真实 pid 写下来。
    perl -MPOSIX -e '
      my ($pidfile, @cmd) = @ARGV;
      exit 0 if fork();
      POSIX::setsid();
      open(my $fh, ">", $pidfile) or die "pid file $pidfile: $!";
      print {$fh} "$$\n";
      close $fh;
      exec { $cmd[0] } @cmd or die "exec $cmd[0]: $!";
    ' "$pid_file" "$@" >>"$log_file" 2>&1 </dev/null &
    return 0
  fi

  # 两个都没有：只能 nohup，挡不住进程组被收。至少把进程起来。
  nohup "$@" >>"$log_file" 2>&1 </dev/null &
  echo $! >"$pid_file"
}

# 默认值也要进环境，模板渲染和远端命令都从环境里取。
for __knot_name in $(compgen -v | grep '^KNOT_'); do
  export "$__knot_name"
done
unset __knot_name
