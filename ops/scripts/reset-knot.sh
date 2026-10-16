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
UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/com.knot.platform" 2>/dev/null || true

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
SELECT u.id, u.user_id, u.storage_name, u.mime, u.original_name, u.created_at
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
      INSERT INTO knot_keep.uploads
      SELECT u.id, u.user_id, u.storage_name, u.mime, u.original_name, u.created_at
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
cd "$KNOT_HOME"
npm run migrate

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

INSERT INTO uploads (id, user_id, storage_name, mime, original_name, created_at)
SELECT id, user_id, storage_name, mime, original_name, created_at
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
  rm -rf "$UPLOAD_DIR/packets" "$UPLOAD_DIR/previews" "$UPLOAD_DIR/shares" "$UPLOAD_DIR/extracts"
fi

if [[ -x "$KNOT_HOME/ops/scripts/ensure-tester.sh" ]]; then
  "$KNOT_HOME/ops/scripts/ensure-tester.sh"
fi

echo "reset ok, removed files ${removed}"
