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

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v admin_email="${KNOT_ADMIN_EMAIL:-}" <<'SQL'
-- 上一次重建可能死在半路：那时 public 已经清掉，knot_keep 里是唯一一份账号、会话
-- 与上传记录。无条件 DROP 会把它一起删掉，数据就再也找不回来了。
-- 所以先看一眼：已经有内容就停下来，让人确认那是残留还是需要救的东西。
DO $$
DECLARE kept bigint;
BEGIN
  IF to_regclass('knot_keep.accounts') IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO kept FROM knot_keep.accounts;
  IF kept > 0 THEN
    RAISE EXCEPTION 'knot_keep 里已经有上一次重建留下的 % 个账号，上一次很可能没跑完。', kept
      USING HINT = '这是 public 被清掉之后唯一的备份。先查：SELECT id, email, role FROM knot_keep.accounts; 确认不再需要它，才执行 DROP SCHEMA knot_keep CASCADE; 然后重跑。';
  END IF;
END $$;
DROP SCHEMA IF EXISTS knot_keep CASCADE;
CREATE SCHEMA knot_keep;

-- 账户只有一张表。重建前后都按 accounts 原样搬运：人、Agent、主理人、平台账号
-- 的角色与归属都在这一行里，不再分 users / delegations 两张表拼。
--
-- 0.3.x 还是 users 结构：人、内部 Agent 都在 users 里，主理人是 email = KNOT_ADMIN_EMAIL
-- 且 side = 'external' 的那一行；内部 Agent 的 email 也是同一个地址，靠 side = 'internal'
-- 区分。这里拼成新表的一行，否则从旧库升级就只剩「清空重建」一条路。
CREATE TABLE knot_keep.meta AS SELECT :'admin_email'::text AS admin_email;

DO $$
DECLARE
  has_accounts boolean := to_regclass('public.accounts') IS NOT NULL;
  has_locale boolean := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'locale'
  );
BEGIN
  IF NOT has_accounts AND to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION '库里既没有 accounts 也没有 users：空库请先跑 backend/scripts/migrate.js，不要用 reset-knot.sh 初始化。';
  END IF;
  IF has_accounts THEN
    CREATE TABLE knot_keep.accounts AS
    SELECT id, role, side, email, display_name, owner_id, token_hash, label, avatar_upload_id,
           level, entitlements, points_balance, muted_until, specialties, locale, bio, retired_at,
           created_at, updated_at
    FROM accounts
    WHERE role <> 'platform';
  ELSE
    IF has_locale THEN
      EXECUTE $q$
        CREATE TABLE knot_keep.accounts AS
        SELECT u.id,
               CASE WHEN u.side = 'internal' THEN 'agent'
                    WHEN lower(u.email) = lower((SELECT admin_email FROM knot_keep.meta)) THEN 'owner'
                    ELSE 'user' END AS role,
               CASE WHEN u.side = 'internal'
                      OR lower(u.email) = lower((SELECT admin_email FROM knot_keep.meta)) THEN 'internal'
                    ELSE 'external' END AS side,
               CASE WHEN u.side = 'internal' THEN NULL
                    WHEN u.label = 'tester' THEN 'tester@knot.local'
                    WHEN u.email IS NOT NULL THEN u.email
                    ELSE 'legacy-' || u.id::text || '@knot.local' END AS email,
               u.display_name,
               NULL::uuid AS owner_id,
               d.token_hash,
               u.label, u.avatar_upload_id, u.level, u.entitlements, u.points_balance,
               u.muted_until, u.specialties,
               -- 旧库的语种没经过新约束校验：认不出来的就留空，交给站点默认。
               CASE WHEN u.locale IN ('zh-CN', 'zh-TW', 'en') THEN u.locale ELSE NULL END AS locale,
               left(COALESCE(u.bio, ''), 200) AS bio,
               CASE WHEN u.side = 'internal' AND d.token_hash IS NULL THEN now() ELSE NULL END AS retired_at,
               u.created_at, u.updated_at
        FROM users u
        LEFT JOIN delegations d ON d.user_id = u.id
        -- 平台账号在旧库里也是一行 users（label = 'platform'）。新基线会自己插那一行，
        -- 带着它搬过去会撞主键，也会把机器身份变成一个人。
        WHERE COALESCE(u.label, '') <> 'platform'
      $q$;
    ELSE
      EXECUTE $q$
        CREATE TABLE knot_keep.accounts AS
        SELECT u.id,
               CASE WHEN u.side = 'internal' THEN 'agent'
                    WHEN lower(u.email) = lower((SELECT admin_email FROM knot_keep.meta)) THEN 'owner'
                    ELSE 'user' END AS role,
               CASE WHEN u.side = 'internal'
                      OR lower(u.email) = lower((SELECT admin_email FROM knot_keep.meta)) THEN 'internal'
                    ELSE 'external' END AS side,
               CASE WHEN u.side = 'internal' THEN NULL
                    WHEN u.label = 'tester' THEN 'tester@knot.local'
                    WHEN u.email IS NOT NULL THEN u.email
                    ELSE 'legacy-' || u.id::text || '@knot.local' END AS email,
               u.display_name,
               NULL::uuid AS owner_id,
               d.token_hash,
               u.label, u.avatar_upload_id, u.level, u.entitlements, u.points_balance,
               u.muted_until, u.specialties,
               NULL::text AS locale, left(COALESCE(u.bio, ''), 200) AS bio,
               CASE WHEN u.side = 'internal' AND d.token_hash IS NULL THEN now() ELSE NULL END AS retired_at,
               u.created_at, u.updated_at
        FROM users u
        LEFT JOIN delegations d ON d.user_id = u.id
        WHERE COALESCE(u.label, '') <> 'platform'
      $q$;
    END IF;
    -- 内部 Agent 必须挂在主理人名下。旧库里没有主理人行时，别等到 DROP 之后才失败。
    IF EXISTS (SELECT 1 FROM knot_keep.accounts WHERE role = 'agent')
       AND NOT EXISTS (SELECT 1 FROM knot_keep.accounts WHERE role = 'owner') THEN
      RAISE EXCEPTION '旧库里没有主理人账号（email = KNOT_ADMIN_EMAIL 且 side = external）。先用主理人登录一次，或手动补一行 owner，再重跑。';
    END IF;
    UPDATE knot_keep.accounts
    SET owner_id = (SELECT id FROM knot_keep.accounts WHERE role = 'owner' LIMIT 1)
    WHERE role = 'agent' AND owner_id IS NULL;
    -- 旧模型里 Agent 自己也有钱包，新模型的钱归主人：先把 Agent 余额并回主理人。
    -- 新库要求 Agent 行余额为 0、不带等级与权益，清零这一步不做，插入会被 CHECK 挡住。
    UPDATE knot_keep.accounts o
    SET points_balance = o.points_balance + COALESCE((
      SELECT sum(a.points_balance) FROM knot_keep.accounts a WHERE a.role = 'agent'
    ), 0)
    WHERE o.role = 'owner';
    UPDATE knot_keep.accounts
    SET points_balance = 0, level = 1, entitlements = '{}'::jsonb
    WHERE role = 'agent';
    -- 新库的称呼唯一性不看大小写，旧库只管大小写敏感的重名。补一次去重，
    -- 只改大小写撞车的那几行，后缀取自 id，不会再撞到别的称呼。
    -- 平台账号的称呼（Knot）由新基线插进来，和它同名的行也要让开。
    -- 先按新库的长度上限截断，再谈重名；截断可能造出新的重名，所以排在去重之前。
    UPDATE knot_keep.accounts
    SET display_name = left(btrim(display_name), 40)
    WHERE char_length(btrim(display_name)) > 40;
    UPDATE knot_keep.accounts
    SET display_name = left(btrim(display_name), 30) || ' ' || substr(replace(id::text, '-', ''), 1, 4)
    WHERE lower(btrim(display_name)) = 'knot';
    UPDATE knot_keep.accounts a
    SET display_name = left(btrim(a.display_name), 30) || ' ' || substr(replace(a.id::text, '-', ''), 1, 4)
    FROM (
      SELECT id, row_number() OVER (
               PARTITION BY lower(btrim(display_name)) ORDER BY created_at ASC, id ASC
             ) AS n
      FROM knot_keep.accounts
    ) d
    WHERE a.id = d.id AND d.n > 1;
    -- 旧模型不数名额，新库的触发器最多只收 10 个在岗 Agent。
    -- 超出的是历史遗留，保留行、清令牌，按停用处理，不让整次重建失败。
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY created_at ASC) AS n
      FROM knot_keep.accounts WHERE role = 'agent' AND retired_at IS NULL
    )
    UPDATE knot_keep.accounts a
    SET retired_at = now(), token_hash = NULL
    FROM ranked r
    WHERE a.id = r.id AND r.n > 10;
  END IF;

  -- 旧模型允许人给自己签发一枚令牌，用「本人」身份调 Agent 接口。新模型只有 Agent 有令牌；
  -- 人的那一行留着哈希没有读者，清掉，免得看起来像一枚还能用的凭据。
  UPDATE knot_keep.accounts SET token_hash = NULL WHERE role <> 'agent';
END $$;

-- 旧库这两张表还叫 user_id。统一成 account_id 之后再写回。
DO $$
BEGIN
  IF to_regclass('public.accounts') IS NOT NULL THEN
    -- 只留人的会话；平台账号没有会话，Agent 靠令牌。
    CREATE TABLE knot_keep.sessions AS
    SELECT sid, account_id, expires_at, created_at FROM sessions
    WHERE account_id IN (SELECT id FROM knot_keep.accounts);
    CREATE TABLE knot_keep.uploads AS
    SELECT u.id, u.account_id, u.storage_name, u.mime, u.original_name, u.created_at,
           u.size, u.sha256, u.width, u.height
    FROM uploads u
    WHERE u.id IN (SELECT avatar_upload_id FROM accounts WHERE avatar_upload_id IS NOT NULL);
  ELSE
    CREATE TABLE knot_keep.sessions AS
    SELECT sid, user_id AS account_id, expires_at, created_at FROM sessions
    WHERE user_id IN (SELECT id FROM knot_keep.accounts);
    CREATE TABLE knot_keep.uploads AS
    SELECT u.id, u.user_id AS account_id, u.storage_name, u.mime, u.original_name, u.created_at,
           u.size, u.sha256, u.width, u.height
    FROM uploads u
    WHERE u.id IN (SELECT avatar_upload_id FROM users WHERE avatar_upload_id IS NOT NULL);
  END IF;
END $$;

CREATE TABLE knot_keep.login_keys AS
SELECT id, email, key_hash, expires_at, used_at, created_at FROM login_keys;

DO $$
DECLARE
  has_accounts boolean := to_regclass('public.accounts') IS NOT NULL;
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
    IF has_accounts THEN
      EXECUTE $q$
        INSERT INTO knot_keep.uploads (id, account_id, storage_name, mime, original_name, created_at, size, sha256, width, height)
        SELECT u.id, u.account_id, u.storage_name, u.mime, u.original_name, u.created_at,
               u.size, u.sha256, u.width, u.height
        FROM uploads u
        WHERE u.id IN (SELECT image_upload_id FROM sponsors WHERE image_upload_id IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM knot_keep.uploads k WHERE k.id = u.id)
      $q$;
    ELSE
      EXECUTE $q$
        INSERT INTO knot_keep.uploads (id, account_id, storage_name, mime, original_name, created_at, size, sha256, width, height)
        SELECT u.id, u.user_id, u.storage_name, u.mime, u.original_name, u.created_at,
               u.size, u.sha256, u.width, u.height
        FROM uploads u
        WHERE u.id IN (SELECT image_upload_id FROM sponsors WHERE image_upload_id IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM knot_keep.uploads k WHERE k.id = u.id)
      $q$;
    END IF;
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
-- 先人后 Agent：Agent 的 owner_id 指向已经存在的账号。
INSERT INTO accounts (id, role, side, email, display_name, owner_id, token_hash, label, avatar_upload_id,
                      level, entitlements, points_balance, muted_until, specialties, locale, bio, retired_at,
                      created_at, updated_at)
SELECT id, role, side, email, display_name, owner_id, token_hash, label, NULL,
       level, entitlements, points_balance, muted_until, specialties, locale, bio, retired_at,
       created_at, updated_at
FROM knot_keep.accounts
ORDER BY (role = 'agent') ASC, created_at ASC;

-- 头像外键指向 uploads，所以上传行必须先落库，再回填 accounts.avatar_upload_id。
INSERT INTO uploads (id, account_id, storage_name, mime, original_name, created_at, size, sha256, width, height)
SELECT id, account_id, storage_name, mime, original_name, created_at, size, sha256, width, height
FROM knot_keep.uploads;

UPDATE accounts AS a
SET avatar_upload_id = k.avatar_upload_id
FROM knot_keep.accounts AS k
WHERE a.id = k.id AND k.avatar_upload_id IS NOT NULL;

INSERT INTO sessions (sid, account_id, expires_at, created_at)
SELECT sid, account_id, expires_at, created_at FROM knot_keep.sessions;

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
  rm -rf "$UPLOAD_DIR/derived" "$UPLOAD_DIR/tmp"
  # 快照是重建前拍出来的，重建后先撤掉，等下一次内容变动再生成。
  rm -f "$UPLOAD_DIR/board/discover.json"
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
