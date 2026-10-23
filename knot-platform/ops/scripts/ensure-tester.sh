#!/usr/bin/env bash
# 在当前站点库里确保测试员账号和长期会话。可重复执行。
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TESTER_ID="23737bf5-537f-441f-bc86-bf230d1cf9ed"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
TESTER_FILE="$KNOT_SITE_DIR/tester.env"

if [[ ! -f "$KNOT_PLATFORM_ENV" ]]; then
  echo "缺少 ${KNOT_PLATFORM_ENV}。先跑 ./ops/scripts/deploy-site.sh --site ${KNOT_SITE}。" >&2
  exit 1
fi
knot_source_platform_env
if [[ -f "$TESTER_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$TESTER_FILE"
  set +a
fi

if [[ -z "${TESTER_SID:-}" ]]; then
  echo "缺少 TESTER_SID（写在 sites/$KNOT_SITE/tester.env）" >&2
  exit 1
fi
# 会话值直接进 SQL 的话，里面一个单引号就能把语句截断。会话是十六进制串，
# 只认这个字符集；不认的拒绝，不要带着可疑值去拼 SQL。
case "$TESTER_SID" in
  *[!A-Za-z0-9_-]*)
    echo "TESTER_SID 只允许字母、数字、下划线和短横线：拒绝写入。" >&2
    exit 1
    ;;
esac

# 用站点自己配的 Postgres 版本，别假设实例主机上装的是 16。
PSQL="psql"
[[ -x "${KNOT_PG_BIN:-}/psql" ]] && PSQL="$KNOT_PG_BIN/psql"
command -v "$PSQL" >/dev/null 2>&1 || { echo "找不到 psql。装 postgresql 或把 KNOT_PG_BIN 指向它的 bin 目录。" >&2; exit 1; }

# 值走 psql 变量（:'sid' 由 psql 负责引用），不拼进 SQL 文本。
"$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -v tester_id="$TESTER_ID" -v sid="$TESTER_SID" <<'SQL'
-- 测试员是外部账号，带 label：有 label 的账号不占 90 个外部名额，也不参与注册统计。
INSERT INTO accounts (id, role, side, email, display_name, label, points_balance)
VALUES (:'tester_id'::uuid, 'user', 'external', 'tester@knot.local', '测试员', 'tester', 100)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;
INSERT INTO sessions (sid, account_id, expires_at)
VALUES (:'sid', :'tester_id'::uuid, now() + interval '10 years')
ON CONFLICT (sid) DO UPDATE
  SET account_id = EXCLUDED.account_id, expires_at = now() + interval '10 years';
SQL

echo "tester ${TESTER_ID}"
