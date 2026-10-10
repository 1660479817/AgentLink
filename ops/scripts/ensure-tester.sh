#!/usr/bin/env bash
# 在 bot01 的 Knot 库里确保测试员账号和长期会话。可重复执行。
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${KNOT_ENV:-$KNOT_HOME/ops/env/knot-platform.local.env}"
TESTER_ID="23737bf5-537f-441f-bc86-bf230d1cf9ed"
TESTER_FILE="$KNOT_HOME/ops/env/tester.local.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 $ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
if [[ -f "$TESTER_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$TESTER_FILE"
fi
set +a

if [[ -z "${TESTER_SID:-}" ]]; then
  echo "缺少 TESTER_SID（写在 ops/env/tester.local.env）" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
ALTER TABLE persons ADD COLUMN IF NOT EXISTS label TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS persons_label_key ON persons (label) WHERE label IS NOT NULL;
INSERT INTO persons (id, label, points_balance)
VALUES ('${TESTER_ID}', 'tester', 100)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;
INSERT INTO sessions (sid, person_id, expires_at)
VALUES ('${TESTER_SID}', '${TESTER_ID}', now() + interval '10 years')
ON CONFLICT (sid) DO UPDATE
  SET person_id = EXCLUDED.person_id, expires_at = now() + interval '10 years';
SQL

echo "tester ${TESTER_ID}"
