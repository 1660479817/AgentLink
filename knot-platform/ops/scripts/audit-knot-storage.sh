#!/usr/bin/env bash
# 只读巡检：上传目录和 uploads 表是否还对得上。不删任何文件。
#
# 在目标机上执行：
#   cd <仓库目录> && ./ops/scripts/audit-knot-storage.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# PostgreSQL 的 bin 目录可在 site.env 里用 KNOT_PG_BIN 覆盖（Intel Homebrew 用 /usr/local）。
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
knot_source_platform_env
export PATH="$KNOT_PG_BIN:/opt/homebrew/bin:/usr/local/bin:$PATH"

UPLOAD_DIR="${UPLOAD_DIR:-$KNOT_DEPLOY_ROOT/var/uploads}"
UPLOAD_DIR="$(cd "$UPLOAD_DIR" 2>/dev/null && pwd)" || {
  echo "上传目录不存在：$UPLOAD_DIR" >&2
  exit 1
}

echo "== 目录 =="
echo "根：$UPLOAD_DIR"
# 旧位置原件的字节数用 wc 累加：`stat -f%z` 是 BSD 语法，Linux 上恒报错，
# 被 2>/dev/null 吞掉之后汇总永远显示 0.0 MB，巡检结论就失真了。
OLD_BYTES=0
while IFS= read -r -d '' old_file; do
  OLD_BYTES=$(( OLD_BYTES + $(wc -c <"${old_file}" | tr -d ' ') ))
done < <(find "$UPLOAD_DIR" -maxdepth 1 -type f -print0)
OLD_SIZE="$(awk -v bytes="$OLD_BYTES" 'BEGIN { printf "%.1f MB", bytes / 1048576 }')"
find "$UPLOAD_DIR" -maxdepth 1 -mindepth 1 -type d -print0 | while IFS= read -r -d '' dir; do
  printf '  %-24s %8s  %s 个文件\n' "$(basename "$dir")" \
    "$(du -sh "$dir" | cut -f1 | tr -d ' ')" \
    "$(find "$dir" -type f | wc -l | tr -d ' ')"
done
printf '  %-24s %8s  %s 个文件\n' "（旧位置原件）" \
  "$OLD_SIZE" \
  "$(find "$UPLOAD_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')"
for kind in display packets extracts shares; do
  if [[ -d "$UPLOAD_DIR/derived/$kind" ]]; then
    printf '  %-24s %8s  %s 个文件\n' "derived/$kind" \
      "$(du -sh "$UPLOAD_DIR/derived/$kind" | cut -f1 | tr -d ' ')" \
      "$(find "$UPLOAD_DIR/derived/$kind" -type f | wc -l | tr -d ' ')"
  fi
done

echo
echo "== 库 =="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
WITH poster_uploads AS (
  SELECT DISTINCT (regexp_match(video->>'poster',
    '/api/web/uploads/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/display'))[1]::uuid AS id
  FROM intel i
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(i.videos) = 'array' THEN i.videos ELSE '[]'::jsonb END
  ) AS video
),
used AS (
  SELECT upload_id AS id FROM intel_files
  UNION SELECT avatar_upload_id FROM accounts WHERE avatar_upload_id IS NOT NULL
  UNION SELECT image_upload_id FROM sponsors WHERE image_upload_id IS NOT NULL
  UNION SELECT id FROM poster_uploads WHERE id IS NOT NULL
)
SELECT count(*) AS rows,
       pg_size_pretty(COALESCE(sum(size), 0)) AS 记录字节,
       count(*) FILTER (WHERE size = 0) AS size为零,
       count(*) FILTER (WHERE sha256 IS NULL) AS 缺摘要,
       count(*) FILTER (WHERE mime LIKE 'image/%' AND width IS NULL) AS 缺像素
FROM uploads;

WITH poster_uploads AS (
  SELECT DISTINCT (regexp_match(video->>'poster',
    '/api/web/uploads/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/display'))[1]::uuid AS id
  FROM intel i
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(i.videos) = 'array' THEN i.videos ELSE '[]'::jsonb END
  ) AS video
),
used AS (
  SELECT upload_id AS id FROM intel_files
  UNION SELECT avatar_upload_id FROM accounts WHERE avatar_upload_id IS NOT NULL
  UNION SELECT image_upload_id FROM sponsors WHERE image_upload_id IS NOT NULL
  UNION SELECT id FROM poster_uploads WHERE id IS NOT NULL
)
SELECT count(*) AS 无引用行,
       pg_size_pretty(COALESCE(sum(u.size), 0)) AS 无引用字节
FROM uploads u WHERE NOT EXISTS (SELECT 1 FROM used x WHERE x.id = u.id);

SELECT mime, count(*) AS 行数, pg_size_pretty(COALESCE(sum(size), 0)) AS 字节
FROM uploads GROUP BY mime ORDER BY 2 DESC;
SQL

echo
echo "== 无引用的最新 10 行 =="
psql "$DATABASE_URL" -Atc "
WITH poster_uploads AS (
  SELECT DISTINCT (regexp_match(video->>'poster',
    '/api/web/uploads/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/display'))[1]::uuid AS id
  FROM intel i
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(i.videos) = 'array' THEN i.videos ELSE '[]'::jsonb END
  ) AS video
),
used AS (
  SELECT upload_id AS id FROM intel_files
  UNION SELECT avatar_upload_id FROM accounts WHERE avatar_upload_id IS NOT NULL
  UNION SELECT image_upload_id FROM sponsors WHERE image_upload_id IS NOT NULL
  UNION SELECT id FROM poster_uploads WHERE id IS NOT NULL
)
SELECT to_char(u.created_at, 'MM-DD HH24:MI') || '  ' || u.storage_name || '  ' || COALESCE(u.mime, '')
FROM uploads u WHERE NOT EXISTS (SELECT 1 FROM used x WHERE x.id = u.id)
ORDER BY u.created_at DESC LIMIT 10" | sed 's/^/  /'

echo
echo "== 库里有行、磁盘没有文件 =="
DB_NAMES="$(mktemp)"
DISK_NAMES="$(mktemp)"
trap 'rm -f "$DB_NAMES" "$DISK_NAMES"' EXIT
psql "$DATABASE_URL" -Atc "SELECT storage_name FROM uploads" | sort >"$DB_NAMES"
{
  find "$UPLOAD_DIR/blobs" -type f -exec basename {} \; 2>/dev/null
  find "$UPLOAD_DIR" -maxdepth 1 -type f -exec basename {} \; 2>/dev/null
} | sort >"$DISK_NAMES"
comm -23 "$DB_NAMES" "$DISK_NAMES" | sed 's/^/  /'
echo "  合计 $(comm -23 "$DB_NAMES" "$DISK_NAMES" | wc -l | tr -d ' ') 个"

echo
echo "== 磁盘有文件、库里没有行 =="
comm -13 "$DB_NAMES" "$DISK_NAMES" | sed 's/^/  /'
echo "  合计 $(comm -13 "$DB_NAMES" "$DISK_NAMES" | wc -l | tr -d ' ') 个"

echo
echo "== 派生件 =="
echo "  display $(find "$UPLOAD_DIR/derived/display" -type f 2>/dev/null | wc -l | tr -d ' ') / packets $(find "$UPLOAD_DIR/derived/packets" -type f 2>/dev/null | wc -l | tr -d ' ') / shares $(find "$UPLOAD_DIR/derived/shares" -type f 2>/dev/null | wc -l | tr -d ' ') / extracts $(find "$UPLOAD_DIR/derived/extracts" -type f 2>/dev/null | wc -l | tr -d ' ')"
echo "  tmp：$(find "$UPLOAD_DIR/tmp" -type f 2>/dev/null | wc -l | tr -d ' ') 个文件（入库后应为 0）"
