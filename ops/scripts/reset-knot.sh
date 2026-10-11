#!/usr/bin/env bash
# 清空测试阶段写入的信息、对话、通知、积分流水和上传文件。
# 留下用户和会话。不碰 OpenClaw 的模型、密钥、飞书和员工。
# 用法：./ops/scripts/reset-knot.sh --yes
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [[ "${1:-}" != "--yes" ]]; then
  echo "这会清空信息、对话、通知、积分流水和上传文件。用户和会话保留。" >&2
  echo "确认执行：./ops/scripts/reset-knot.sh --yes" >&2
  exit 1
fi

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${KNOT_ENV:-$KNOT_HOME/ops/env/knot-platform.local.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 $ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

UPLOAD_DIR="${UPLOAD_DIR:-$KNOT_HOME/data/uploads}"
names="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt <<'SQL'
BEGIN;
DELETE FROM delivery_citations;
DELETE FROM deliveries;
DELETE FROM demand_files;
DELETE FROM demands;
DELETE FROM intel_stars;
DELETE FROM intel_files;
DELETE FROM intel;
DELETE FROM notifications;
DELETE FROM point_ledger;
DELETE FROM login_keys;
DELETE FROM delegations;
UPDATE users SET avatar_upload_id = NULL;
DELETE FROM uploads RETURNING storage_name;
UPDATE users
SET points_balance = CASE label
  WHEN 'platform' THEN 0
  WHEN 'tester' THEN 100
  ELSE 10
END;
COMMIT;
SQL
)"

removed=0
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  base="$(basename "$name")"
  if [[ "$base" != "$name" ]]; then
    echo "跳过异常文件名" >&2
    continue
  fi
  rm -f "$UPLOAD_DIR/$base"
  removed=$((removed + 1))
done <<<"$names"

echo "reset ok, files ${removed}"
