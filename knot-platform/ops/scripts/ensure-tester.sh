#!/usr/bin/env bash
# 在当前站点库里确保测试员账号和长期会话。可重复执行。
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TESTER_ID="23737bf5-537f-441f-bc86-bf230d1cf9ed"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
TESTER_FILE="$KNOT_SITE_DIR/tester.env"

if [[ ! -f "$KNOT_PLATFORM_ENV" ]]; then
  echo "缺少 $KNOT_PLATFORM_ENV。先跑 ./ops/scripts/deploy-site.sh --site $KNOT_SITE。" >&2
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

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO users (id, display_name, label, points_balance)
VALUES ('${TESTER_ID}', '测试员', 'tester', 100)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;
INSERT INTO sessions (sid, user_id, expires_at)
VALUES ('${TESTER_SID}', '${TESTER_ID}', now() + interval '10 years')
ON CONFLICT (sid) DO UPDATE
  SET user_id = EXCLUDED.user_id, expires_at = now() + interval '10 years';
SQL

echo "tester ${TESTER_ID}"
