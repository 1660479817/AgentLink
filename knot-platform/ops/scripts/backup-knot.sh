#!/usr/bin/env bash
# 备份 Knot 的数据库、上传目录、站点配置和 OpenClaw 状态。
#
# 一份快照（$KNOT_BACKUP_DIR/knot-<时间>/）：
#   knot.dump      pg_dump -Fc，可直接 pg_restore
#   uploads/       上传原件、转写、公开快照。卡片图、下载包、分享图能重新生成，不收
#   sites/         sites/<站点>/ 整个目录：site.env、platform.env、agents/
#   openclaw/      openclaw.json、config-journal-fingerprint.key、credentials/、agents/
#   manifest.txt   各部分文件数、字节数、校验和
#
# 目录权限 700，文件沿用源权限（platform.env 和凭据本来就是 600）。
# 同一次快照内用硬链接复用没变的文件，所以每天不会重写几百 MB。
#
# 用法：
#   ./ops/scripts/backup-knot.sh                 # 全量
#   ./ops/scripts/backup-knot.sh --config-only   # 只收配置和智能体状态，不碰数据库
#
# 定时执行：macOS 用 ops/launchd/com.knot.backup.plist，Linux 用 ops/systemd/knot-backup.timer。
set -euo pipefail

CONFIG_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-only) CONFIG_ONLY=1; shift ;;
    *)
      echo "未知参数：$1" >&2
      echo "用法：$0 [--config-only]" >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# PostgreSQL 的 bin 目录可在 site.env 里用 KNOT_PG_BIN 覆盖（Intel Homebrew 用 /usr/local）。
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
knot_source_platform_env
export PATH="$KNOT_PG_BIN:/opt/homebrew/bin:/usr/local/bin:$PATH"

BACKUP_DIR="$(knot_backup_dir "${KNOT_BACKUP_DIR:-}")"
if [[ -z "$BACKUP_DIR" ]]; then
  echo "KNOT_BACKUP_DIR 未配置或为 null，跳过备份"
  exit 0
fi

UPLOAD_DIR="${UPLOAD_DIR:-$KNOT_DEPLOY_ROOT/var/uploads}"
KEEP="${KNOT_BACKUP_KEEP:-7}"
BACKUP_SITES="${KNOT_BACKUP_SITES:-1}"
OPENCLAW_MODE="$(printf '%s' "${KNOT_BACKUP_OPENCLAW:-auto}" | tr '[:upper:]' '[:lower:]')"
# OpenClaw 自己的状态目录。不读 site.env：这是 openclaw 的约定，不是 Knot 的配置项。
OPENCLAW_DIR="$HOME/.openclaw"

# ---- 并发保护 ----
# 两份备份同时跑会同时写 latest 链接、同时按 KEEP 删目录，结果是快照数对不上、
# 甚至删掉对方刚写完的那一份。锁放在备份根，和快照文件同一个卷。
# shellcheck source=lib/lock.sh
source "$SCRIPT_DIR/lib/lock.sh"
knot_lock "$BACKUP_DIR/.backup.lock" "备份" || exit 1

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/knot-$STAMP"
LATEST="$BACKUP_DIR/latest"
DONE=0
cleanup() {
  knot_unlock
  if (( DONE == 0 )); then
    echo "备份未完成，清掉 $DEST" >&2
    rm -rf "$DEST"
  fi
}
trap cleanup EXIT

# ---- 小工具 ----
# 兼容 BSD 与 GNU：macOS 的 stat 和 Linux 的 sha256sum 参数不一样。
file_bytes() { wc -c <"$1" | tr -d ' '; }
dir_files() { find "$1" -type f 2>/dev/null | wc -l | tr -d ' '; }
dir_bytes() {
  find "$1" -type f -print0 2>/dev/null | xargs -0 wc -c 2>/dev/null | tail -1 | awk '{print $1+0}'
}
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | awk '{print $1}'
}

# 复制一棵目录树。上一份快照里有的文件用硬链接，不重复占空间。
#   copy_tree <源目录> <目标目录> <上一份快照里的相对位置> [额外 --exclude 模式...]
copy_tree() {
  local src="$1" dest="$2" rel="$3"
  shift 3
  local -a opts=(-a --delete)
  if [[ -d "$LATEST/$rel" ]]; then
    opts+=("--link-dest=$(cd "$LATEST/$rel" && pwd -P)")
  fi
  local pattern
  for pattern in "$@"; do opts+=(--exclude "$pattern"); done
  mkdir -p "$dest"
  rsync "${opts[@]}" "$src/" "$dest/"
}

mkdir -p "$BACKUP_DIR"
# 同一秒内跑两次（手工 + 定时撞上）时加后缀，不要覆盖或删掉上一份。
if [[ -e "$DEST" ]]; then
  base="$DEST"
  n=1
  while [[ -e "$DEST" ]]; do
    DEST="$base-$n"
    n=$((n + 1))
  done
fi
# 快照里有密钥，整个目录只给属主。
mkdir -m 700 "$DEST"

DATABASE_BYTES=""
DATABASE_SHA=""
UPLOAD_FILES=0
UPLOAD_BYTES=0
SITES_STATUS=skipped
SITES_FILES=0
SITES_BYTES=0
OPENCLAW_STATUS=skipped
OPENCLAW_FILES=0
OPENCLAW_BYTES=0

if [[ "$CONFIG_ONLY" == 1 ]]; then
  echo "==> --config-only：跳过数据库和上传目录"
else
  DATABASE_URL="${DATABASE_URL:?缺少 DATABASE_URL}"

  echo "==> 数据库 → $DEST/knot.dump"
  pg_dump -Fc -f "$DEST/knot.dump" "$DATABASE_URL"
  pg_restore --list "$DEST/knot.dump" >/dev/null
  DATABASE_BYTES="$(file_bytes "$DEST/knot.dump")"
  DATABASE_SHA="$(sha256_of "$DEST/knot.dump")"

  echo "==> 上传目录 → $DEST/uploads"
  if [[ -d "$UPLOAD_DIR" ]]; then
    # 只备份原件、转写和公开快照。卡片图、下载包、分享图和 tmp 都能重新生成。
    copy_tree "$UPLOAD_DIR" "$DEST/uploads" uploads \
      tmp/ derived/display/ derived/packets/ derived/shares/
    UPLOAD_FILES="$(dir_files "$DEST/uploads")"
    UPLOAD_BYTES="$(dir_bytes "$DEST/uploads")"
  else
    echo "上传目录不存在：$UPLOAD_DIR" >&2
    exit 1
  fi
fi

# ---- 站点配置 ----
# platform.env 里有 SMTP 密码和管理令牌，agents/ 里是智能体凭据。
# 不备份它们，换台机器就只能恢复帖子和文件，登录邮件和智能体都得重配。
if knot_enabled BACKUP_SITES; then
  if [[ -d "$KNOT_SITES_DIR" ]]; then
    echo "==> 站点配置 → $DEST/sites"
    copy_tree "$KNOT_SITES_DIR" "$DEST/sites" sites
    SITES_STATUS=backed-up
    SITES_FILES="$(dir_files "$DEST/sites")"
    SITES_BYTES="$(dir_bytes "$DEST/sites")"
  else
    echo "==> 没有 ${KNOT_SITES_DIR}，跳过站点配置" >&2
  fi
else
  echo "==> KNOT_BACKUP_SITES=0，只备份数据库和上传目录"
fi

# ---- OpenClaw 状态 ----
# 只收重建智能体要用的：配置、凭据、agent 工作区（skill、AGENTS.md、记忆库）。
# cache/、browser/、npm/、logs/ 都能重建，收了只会让备份变胖。
backup_openclaw() {
  echo "==> OpenClaw → $DEST/openclaw"
  local -a opts=(-a --delete)
  if [[ -d "$LATEST/openclaw" ]]; then
    opts+=("--link-dest=$(cd "$LATEST/openclaw" && pwd -P)")
  fi
  mkdir -p "$DEST/openclaw"
  # 顺序有意义：rsync 用第一条命中的规则。
  # 先排掉运行中的 sqlite 锁文件和纯缓存，再按白名单收，最后排掉其余。
  # -wal 要跟着 db 走（最近的提交在里面）；-shm 是缓存，恢复时重建。
  rsync "${opts[@]}" \
    --exclude '*-lock.sqlite' \
    --exclude '*.sqlite-shm' \
    --include '/openclaw.json' \
    --include '/config-journal-fingerprint.key' \
    --include '/credentials/' \
    --include '/credentials/***' \
    --include '/agents/' \
    --include '/agents/***' \
    --exclude '*' \
    "$OPENCLAW_DIR/" "$DEST/openclaw/"
  OPENCLAW_STATUS=backed-up
  OPENCLAW_FILES="$(dir_files "$DEST/openclaw")"
  OPENCLAW_BYTES="$(dir_bytes "$DEST/openclaw")"
}

case "$OPENCLAW_MODE" in
  0 | false | no | off)
    echo "==> KNOT_BACKUP_OPENCLAW=0，跳过 OpenClaw"
    ;;
  auto | "")
    if [[ -d "$OPENCLAW_DIR" ]]; then
      backup_openclaw
    else
      echo "==> 没有 ${OPENCLAW_DIR}，跳过 OpenClaw（KNOT_BACKUP_OPENCLAW=auto）"
    fi
    ;;
  *)
    [[ -d "$OPENCLAW_DIR" ]] || {
      echo "KNOT_BACKUP_OPENCLAW=1 但没有 $OPENCLAW_DIR" >&2
      exit 1
    }
    backup_openclaw
    ;;
esac

# ---- 清单 ----
{
  echo "stamp=$STAMP"
  echo "config_only=$CONFIG_ONLY"
  if [[ -n "$DATABASE_BYTES" ]]; then
    echo "database_bytes=$DATABASE_BYTES"
    echo "database_sha256=$DATABASE_SHA"
  fi
  echo "upload_dir=$UPLOAD_DIR"
  echo "upload_files=$UPLOAD_FILES"
  echo "upload_bytes=$UPLOAD_BYTES"
  echo "sites_status=$SITES_STATUS"
  echo "sites_dir=$KNOT_SITES_DIR"
  echo "sites_files=$SITES_FILES"
  echo "sites_bytes=$SITES_BYTES"
  echo "openclaw_status=$OPENCLAW_STATUS"
  echo "openclaw_dir=$OPENCLAW_DIR"
  echo "openclaw_files=$OPENCLAW_FILES"
  echo "openclaw_bytes=$OPENCLAW_BYTES"
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$DEST/manifest.txt"

ln -sfn "$(basename "$DEST")" "$LATEST"
DONE=1
echo "==> 完成：$DEST"
cat "$DEST/manifest.txt"

if [[ "$KEEP" =~ ^[0-9]+$ ]] && (( KEEP > 0 )); then
  # 只删 knot-* 快照目录，latest 是符号链接。时间戳命名，字典序就是时间序。
  # 但按目录数清理不分类型：--config-only 的快照和全量快照同名同目录，升级前
  # 顺手跑几次只含配置的，就能把唯一一份带 knot.dump 的全量快照挤出 KEEP 之外。
  # 所以先挑出最近一份全量快照，清到它时跳过——至少总留一份能恢复数据库的。
  FULL_KEEP=""
  while IFS= read -r old; do
    [[ -n "$old" ]] || continue
    if [[ -f "$old/knot.dump" ]]; then
      FULL_KEEP="$old"
      break
    fi
  done <<EOF
$(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name 'knot-*' | sort -r)
EOF
  find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name 'knot-*' | sort -r | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
    if [[ -n "$FULL_KEEP" && "$old" == "$FULL_KEEP" ]]; then
      echo "==> 保留最近一份全量快照 $(basename "$old")（不在 KEEP 计数内）"
      continue
    fi
    echo "==> 清理旧快照 $old"
    rm -rf "$old"
  done
fi
