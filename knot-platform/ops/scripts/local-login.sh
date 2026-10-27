#!/usr/bin/env bash
# 给本机站点造一个可以登录的会话，不经过邮件。
#
# 只用于目标在本机的站点（对外地址是回环地址）。公网站点拒绝执行：
# 能在这里凭空造管理员会话，就不该留着一个公网入口。
#
# 用法：
#   ./ops/scripts/local-login.sh --site local
#   ./ops/scripts/local-login.sh --site local --email someone@example.com
#   ./ops/scripts/local-login.sh --site local --url          # 只打印带 cookie 的地址
#
# 默认邮箱是 KNOT_ADMIN_EMAIL，所以造出来的是管理员；用 --email 指定别人就是普通账户。
# 可重复执行：账户已存在就只续一个会话。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

SITE_ARG=""
EMAIL_ARG=""
URL_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --site)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--site 后面要跟站点名" >&2; exit 2; }
      SITE_ARG="$2"
      shift 2
      ;;
    --email)
      [[ $# -ge 2 && -n "${2:-}" ]] || { echo "--email 后面要跟邮箱" >&2; exit 2; }
      EMAIL_ARG="$2"
      shift 2
      ;;
    --url)
      URL_ONLY=1
      shift
      ;;
    *)
      echo "未知参数：$1" >&2
      exit 2
      ;;
  esac
done
[[ -n "$SITE_ARG" ]] && export KNOT_SITE="$SITE_ARG"

# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
# platform.env 里有部署时解析出的 node 绝对路径：造会话不依赖调用者 PATH。
knot_source_platform_env
NODE_BIN="${KNOT_NODE_BIN:-node}"

if [[ ! -f "$KNOT_PLATFORM_ENV" ]]; then
  echo "缺少 ${KNOT_PLATFORM_ENV}。先跑 ./ops/scripts/push-deploy.sh --site ${KNOT_SITE}。" >&2
  exit 1
fi
knot_source_platform_env

# 只给本机站点开这扇门。判断依据和部署脚本一致：对外地址的主机名。
case "$(knot_origin_host "$KNOT_PUBLIC_ORIGIN")" in
  127.0.0.1 | localhost | ::1) ;;
  *)
    knot_fail "KNOT_PUBLIC_ORIGIN=${KNOT_PUBLIC_ORIGIN} 不是本机地址。这个脚本只给 local 站点用；公网站点请走邮件登录。"
    ;;
esac

EMAIL="${EMAIL_ARG:-${KNOT_ADMIN_EMAIL:-}}"
[[ -n "$EMAIL" ]] || knot_fail "没有邮箱：在 site.env 里配 KNOT_ADMIN_EMAIL，或用 --email 指定。"

PSQL="psql"
[[ -x "${KNOT_PG_BIN:-}/psql" ]] && PSQL="$KNOT_PG_BIN/psql"
command -v "$PSQL" >/dev/null 2>&1 || knot_fail "找不到 psql。装 postgresql 或把 KNOT_PG_BIN 指向它的 bin 目录。"

SID="$("$NODE_BIN" -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
DAYS="${KNOT_SESSION_TTL_DAYS:-30}"
# 这个值经 psql -v 文本替换拼进 SQL（make_interval(days => :days)），
# 带 `)` 或 `;` 就能改语句。来源是 platform.env，风险低但机制成立：
# 只认 1 到 3650 的整数。
case "$DAYS" in
  "" | *[!0-9]*) knot_fail "KNOT_SESSION_TTL_DAYS 只能是整数天，现在是 '${DAYS}'。" ;;
esac
(( DAYS >= 1 && DAYS <= 3650 )) || knot_fail "KNOT_SESSION_TTL_DAYS 要在 1 到 3650 之间，现在是 ${DAYS}。"
# 显示名不能为空，也不能和已有账户重名；取邮箱前缀，重了就用整串补上。
NAME="${EMAIL%%@*}"

"$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v email="$EMAIL" -v name="$NAME" -v sid="$SID" -v days="$DAYS" \
  -v admin_email="${KNOT_ADMIN_EMAIL:-}" <<'SQL' >/dev/null
-- 主理人邮箱建的是 owner（一个站点只有一个），其余邮箱建外部账号。
-- owner 通常已经由启动时的 ensureOwner 建好，这里只是补「库比配置旧」的情况。
INSERT INTO accounts (role, email, display_name, side)
SELECT CASE WHEN lower(:'email') = lower(:'admin_email') THEN 'owner' ELSE 'user' END,
       :'email', :'name',
       CASE WHEN lower(:'email') = lower(:'admin_email') THEN 'internal' ELSE 'external' END
WHERE NOT EXISTS (
  SELECT 1 FROM accounts WHERE lower(email) = lower(:'email')
);

-- owner 的 side 是 internal，不能像旧版那样按 side='external' 找会话主体。
INSERT INTO sessions (sid, account_id, expires_at)
SELECT :'sid', u.id, now() + make_interval(days => :days)
FROM accounts u
WHERE lower(u.email) = lower(:'email') AND u.role IN ('owner', 'user');
SQL

COOKIE="${KNOT_SESSION_COOKIE_NAME:-knot_sid}"
BASE="${KNOT_PUBLIC_ORIGIN%/}"
ROLE="普通账户"
[[ "$EMAIL" == "${KNOT_ADMIN_EMAIL:-}" ]] && ROLE="管理员"

if [[ "$URL_ONLY" == 1 ]]; then
  echo "注意：下面这一行就是一枚可用的管理员会话，不要贴进工单、聊天或截图。"
  echo "${BASE}/?${COOKIE}=${SID}"
  exit 0
fi

cat <<EOF
登录已经造好，不用等邮件。
  站点    ${BASE}（${KNOT_SITE}）
  账户    ${EMAIL}  ${ROLE}
  有效期  ${DAYS} 天

注意：下面的 cookie 就是这枚会话本身，拿到它的人就是以这个账户登录。
不要贴进工单、聊天或截图；用完整份就再跑一次这个脚本换一枚。

浏览器里执行一次（或者开一个无痕窗口，用下面的地址）：
  document.cookie = "${COOKIE}=${SID}; path=/"

也可以直接带上 Cookie 访问：
  curl -s -b "${COOKIE}=${SID}" ${BASE}/api/web/me
EOF
