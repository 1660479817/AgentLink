#!/usr/bin/env bash
# 丢掉帖子和迁移历史，按当前结构重建。留下用户、会话、授权、头像和赞助。
# 用法：./ops/scripts/reset-knot.sh --yes
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [[ "${1:-}" != "--yes" ]]; then
  echo "这会清空帖子、通知和积分流水，并重建表结构。用户、会话、授权和头像保留。" >&2
  echo "确认执行：./ops/scripts/reset-knot.sh --yes" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/site-config.sh
source "$SCRIPT_DIR/lib/site-config.sh"
if [[ ! -f "$KNOT_PLATFORM_ENV" ]]; then
  echo "缺少 ${KNOT_PLATFORM_ENV}。先跑 ./ops/scripts/deploy-site.sh --site ${KNOT_SITE}。" >&2
  exit 1
fi
knot_source_platform_env

UPLOAD_DIR="${UPLOAD_DIR:-$KNOT_DEPLOY_ROOT/var/uploads}"
UID_NUM="$(id -u)"
SYSTEMD_UNIT="$KNOT_SYSTEMD_DIR/knot-backend.service"
PID_FILE="$KNOT_DEPLOY_ROOT/var/run/backend.pid"

stop_backend() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
    for _ in $(seq 1 50); do
      [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    rm -f "$PID_FILE"
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    launchctl bootout "gui/$UID_NUM/com.knot.platform" 2>/dev/null || true
  elif [[ -f "$SYSTEMD_UNIT" ]]; then
    if [[ "$(id -u)" == "0" ]]; then systemctl stop knot-backend 2>/dev/null || true; else sudo systemctl stop knot-backend 2>/dev/null || true; fi
  fi
}

restart_backend() {
  if [[ ! -f "$HOME/Library/LaunchAgents/com.knot.platform.plist" && ! -f "$SYSTEMD_UNIT" ]]; then
    # 没有服务管理器（deploy-site.sh --runtime none）：后台起一份，pid 记在 var/run。
    mkdir -p "$KNOT_DEPLOY_ROOT/var/log" "$KNOT_DEPLOY_ROOT/var/run"
    env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-en_US.UTF-8}" \
      KNOT_SITE="$KNOT_SITE" KNOT_DEPLOY_ROOT="$KNOT_DEPLOY_ROOT" \
      nohup "$KNOT_DEPLOY_ROOT/current/ops/scripts/run-knot-platform.sh" >>"$KNOT_DEPLOY_ROOT/var/log/knot-platform.log" 2>&1 &
    echo $! >"$PID_FILE"
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    launchctl bootstrap "gui/$UID_NUM" "$HOME/Library/LaunchAgents/com.knot.platform.plist" 2>/dev/null || true
    launchctl kickstart -k "gui/$UID_NUM/com.knot.platform" 2>/dev/null || true
  elif [[ -f "$SYSTEMD_UNIT" ]]; then
    if [[ "$(id -u)" == "0" ]]; then systemctl restart knot-backend; else sudo systemctl restart knot-backend; fi
  fi
}

stop_backend

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS knot_keep CASCADE;
CREATE SCHEMA knot_keep;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'locale'
  ) THEN
    EXECUTE $q$
      CREATE TABLE knot_keep.users AS
      SELECT id, email, display_name, avatar_upload_id, level, entitlements, points_balance, label, locale, created_at, updated_at
      FROM users
    $q$;
  ELSE
    EXECUTE $q$
      CREATE TABLE knot_keep.users AS
      SELECT id, email, display_name, avatar_upload_id, level, entitlements, points_balance, label,
             NULL::text AS locale, created_at, updated_at
      FROM users
    $q$;
  END IF;
END $$;

CREATE TABLE knot_keep.sessions AS
SELECT sid, user_id, expires_at, created_at FROM sessions;

CREATE TABLE knot_keep.delegations AS
SELECT user_id, token_hash, created_at FROM delegations;

CREATE TABLE knot_keep.login_keys AS
SELECT id, email, key_hash, expires_at, used_at, created_at FROM login_keys;

CREATE TABLE knot_keep.uploads AS
SELECT u.id, u.user_id, u.storage_name, u.mime, u.original_name, u.created_at,
       u.size, u.sha256, u.width, u.height
FROM uploads u
WHERE u.id IN (SELECT avatar_upload_id FROM users WHERE avatar_upload_id IS NOT NULL);

DO $$
BEGIN
  IF to_regclass('public.sponsors') IS NULL THEN
    EXECUTE $q$
      CREATE TABLE knot_keep.sponsors (
        id uuid, title text, href text, position integer,
        image_url text, image_upload_id uuid, caption text, source text,
        created_at timestamptz, updated_at timestamptz
      )
    $q$;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sponsors' AND column_name = 'image_upload_id'
  ) THEN
    EXECUTE $q$
      CREATE TABLE knot_keep.sponsors AS
      SELECT id, title, href, position, image_url, image_upload_id,
             COALESCE(caption, '') AS caption, COALESCE(source, '') AS source,
             created_at, updated_at
      FROM sponsors
    $q$;
    EXECUTE $q$
      INSERT INTO knot_keep.uploads (id, user_id, storage_name, mime, original_name, created_at, size, sha256, width, height)
      SELECT u.id, u.user_id, u.storage_name, u.mime, u.original_name, u.created_at,
             u.size, u.sha256, u.width, u.height
      FROM uploads u
      WHERE u.id IN (SELECT image_upload_id FROM sponsors WHERE image_upload_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM knot_keep.uploads k WHERE k.id = u.id)
    $q$;
  ELSE
    EXECUTE $q$
      CREATE TABLE knot_keep.sponsors AS
      SELECT id, title, href, position,
             NULL::text AS image_url, NULL::uuid AS image_upload_id,
             ''::text AS caption, ''::text AS source, created_at, updated_at
      FROM sponsors
    $q$;
  END IF;
END $$;

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
SQL

echo "==> migrate"
cd "$KNOT_APP_DIR"
node "$KNOT_APP_DIR/backend/scripts/migrate.js" --reset

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users (id, email, display_name, avatar_upload_id, level, entitlements, points_balance, label, locale, created_at, updated_at)
SELECT id, email, display_name, NULL, level, entitlements, points_balance, label, locale, created_at, updated_at
FROM knot_keep.users
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  level = EXCLUDED.level,
  entitlements = EXCLUDED.entitlements,
  points_balance = EXCLUDED.points_balance,
  label = EXCLUDED.label,
  locale = EXCLUDED.locale,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO uploads (id, user_id, storage_name, mime, original_name, created_at, size, sha256, width, height)
SELECT id, user_id, storage_name, mime, original_name, created_at, size, sha256, width, height
FROM knot_keep.uploads;

UPDATE users AS u
SET avatar_upload_id = k.avatar_upload_id
FROM knot_keep.users AS k
WHERE u.id = k.id AND k.avatar_upload_id IS NOT NULL;

INSERT INTO sessions (sid, user_id, expires_at, created_at)
SELECT sid, user_id, expires_at, created_at FROM knot_keep.sessions;

INSERT INTO delegations (user_id, token_hash, created_at)
SELECT user_id, token_hash, created_at FROM knot_keep.delegations;

INSERT INTO login_keys (id, email, key_hash, expires_at, used_at, created_at)
SELECT id, email, key_hash, expires_at, used_at, created_at FROM knot_keep.login_keys;

DELETE FROM sponsors;
INSERT INTO sponsors (id, title, href, position, image_url, image_upload_id, caption, source, created_at, updated_at)
SELECT id, title, href, position, image_url, image_upload_id, caption, source, created_at, updated_at
FROM knot_keep.sponsors;

DROP SCHEMA knot_keep CASCADE;
SQL

kept="$(psql "$DATABASE_URL" -qAt -c "SELECT storage_name FROM uploads")"
removed=0
if [[ -d "$UPLOAD_DIR" ]]; then
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    base="$(basename "$file")"
    if ! grep -Fxq "$base" <<<"$kept"; then
      rm -f "$file"
      removed=$((removed + 1))
    fi
  done < <(find "$UPLOAD_DIR" -maxdepth 1 -type f)
  rm -rf "$UPLOAD_DIR/derived" "$UPLOAD_DIR/tmp" "$UPLOAD_DIR/packets" "$UPLOAD_DIR/previews" "$UPLOAD_DIR/shares" "$UPLOAD_DIR/extracts"
  # 快照是按旧库拍出来的，重建后先撤掉，等下一次内容变动再生成。
  rm -f "$UPLOAD_DIR/board/discover.json"
  # 0.3.0 之前放在快照目录里的拼图，一并清掉。
  rm -rf "$UPLOAD_DIR/board/media/previews"
  # blobs 分片里的原件按库里的保留清单再扫一遍，刚被删的帖子才真正落下。
  if [[ -d "$UPLOAD_DIR/blobs" ]]; then
    while IFS= read -r file; do
      [[ -z "$file" ]] && continue
      base="$(basename "$file")"
      if ! grep -Fxq "$base" <<<"$kept"; then
        rm -f "$file"
        removed=$((removed + 1))
      fi
    done < <(find "$UPLOAD_DIR/blobs" -type f)
  fi
  # 删完文件后清掉空的分片目录，别留下五百个空壳。
  find "$UPLOAD_DIR/blobs" -mindepth 1 -type d -empty -delete 2>/dev/null || true
fi

if [[ -x "$KNOT_APP_DIR/ops/scripts/ensure-tester.sh" ]]; then
  "$KNOT_APP_DIR/ops/scripts/ensure-tester.sh"
fi

# 上面已经把服务停了。按装过的运行时把它拉起来，别让重建后的站点空着。
restart_backend

echo "reset ok, removed files ${removed}"
