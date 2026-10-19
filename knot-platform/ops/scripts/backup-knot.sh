#!/usr/bin/env bash
# 备份 Knot 的数据库和上传目录。目标目录由 KNOT_BACKUP_DIR 指定，留空就不备份。
# 每天一份，同一份快照内用硬链接复用没变的文件，所以不会每天复制 400MB。
#
# 在目标机上手动执行：
#   cd <仓库目录> && ./ops/scripts/backup-knot.sh
# 定时执行由 ops/launchd/com.knot.backup.plist 负责（仅当 KNOT_BACKUP_DIR 已配置）。
set -euo pipefail

KNOT_HOME="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# PostgreSQL 的 bin 目录可在 site.env 里用 KNOT_PG_BIN 覆盖（Intel Homebrew 用 /usr/local）。
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
knot_source_platform_env
export PATH="$KNOT_PG_BIN:/opt/homebrew/bin:/usr/local/bin:$PATH"

BACKUP_DIR="${KNOT_BACKUP_DIR:-}"
if [[ -z "$BACKUP_DIR" ]]; then
  echo "KNOT_BACKUP_DIR 未配置，跳过备份"
  exit 0
fi

UPLOAD_DIR="${UPLOAD_DIR:-$KNOT_HOME/var/uploads}"
KEEP="${KNOT_BACKUP_KEEP:-7}"
DATABASE_URL="${DATABASE_URL:?缺少 DATABASE_URL}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/knot-$STAMP"
LATEST="$BACKUP_DIR/latest"
DONE=0
cleanup() {
  if (( DONE == 0 )); then
    echo "备份未完成，清掉 $DEST" >&2
    rm -rf "$DEST"
  fi
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"
if [[ -e "$DEST" ]]; then
  echo "目标已存在：$DEST" >&2
  exit 1
fi
mkdir -p "$DEST/uploads"

echo "==> 数据库 → $DEST/knot.dump"
pg_dump -Fc -f "$DEST/knot.dump" "$DATABASE_URL"
pg_restore --list "$DEST/knot.dump" >/dev/null

echo "==> 上传目录 → $DEST/uploads"
if [[ -d "$UPLOAD_DIR" ]]; then
  # 只备份原件、转写和公开快照。卡片图、下载包、分享图和 tmp 都能重新生成。
  EXCLUDES=(--exclude tmp/ --exclude previews/
    --exclude derived/display/ --exclude derived/packets/ --exclude derived/shares/)
  if [[ -d "$LATEST/uploads" ]]; then
    rsync -a --delete --link-dest="$(cd "$LATEST/uploads" && pwd)" "${EXCLUDES[@]}" "$UPLOAD_DIR/" "$DEST/uploads/"
  else
    rsync -a "${EXCLUDES[@]}" "$UPLOAD_DIR/" "$DEST/uploads/"
  fi
else
  echo "上传目录不存在：$UPLOAD_DIR" >&2
  exit 1
fi

{
  echo "stamp=$STAMP"
  echo "database_bytes=$(stat -f%z "$DEST/knot.dump")"
  echo "database_sha256=$(shasum -a 256 "$DEST/knot.dump" | awk '{print $1}')"
  echo "upload_dir=$UPLOAD_DIR"
  echo "upload_files=$(find "$DEST/uploads" -type f | wc -l | tr -d ' ')"
  echo "upload_bytes=$(find "$DEST/uploads" -type f -exec stat -f%z {} + 2>/dev/null | awk '{s+=$1} END {print s+0}')"
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$DEST/manifest.txt"

ln -sfn "knot-$STAMP" "$LATEST"
DONE=1
echo "==> 完成：$DEST"
cat "$DEST/manifest.txt"

if [[ "$KEEP" =~ ^[0-9]+$ ]] && (( KEEP > 0 )); then
  # 只删 knot-* 快照目录，latest 是符号链接。
  find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name 'knot-*' | sort -r | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
    echo "==> 清理旧快照 $old"
    rm -rf "$old"
  done
fi
