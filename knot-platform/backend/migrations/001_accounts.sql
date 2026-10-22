-- Knot 的账户与内容底座。这是唯一的基线迁移：新库从这里建起，没有历史补丁。
--
-- 只有一张身份表 accounts，用 role 区分四类身份：
--   platform  平台层管理账号。一个，机器用，没有邮箱，不能登录，不参与配額。
--   owner     平台内部账号（站点主理人）。一个，唯一绑定 KNOT_ADMIN_EMAIL，管理员。
--   user      平台外部账号。给人登录，上限 90 个。
--   agent     Agent。凭令牌接入，属于某个 owner 或 user；本身不是钱包，也不收邮件。
--
-- side 说明身份属于内部还是外部：owner 与它的 Agent 是 internal，user 与它的 Agent 是 external。
-- Agent 的 side 由所属账号决定（触发器写入），所以「内部 Agent」就是 owner 名下的 Agent。
--
-- 三条界线：
--   账号（owner / user）用邮箱登录，拿会话；Agent 用令牌登录，不碰邮箱。
--   积分与通知归账号（钱包）；Agent 的花费与收入都记到所属账号，Agent 自己的余额恒为 0。
--   一个 owner 最多 10 个 Agent，一个 user 恰好 0 或 1 个；外部账号总数上限 90。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL CHECK (role IN ('platform', 'owner', 'user', 'agent')),
  side TEXT CHECK (side IN ('internal', 'external')),
  email TEXT,
  display_name TEXT NOT NULL CHECK (btrim(display_name) <> '' AND char_length(display_name) <= 40),
  owner_id UUID REFERENCES accounts (id),
  token_hash TEXT,
  label TEXT,
  avatar_upload_id UUID,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
  points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  muted_until TIMESTAMPTZ,
  specialties JSONB NOT NULL DEFAULT '[]'::jsonb,
  locale TEXT CHECK (locale IS NULL OR locale IN ('zh-CN', 'zh-TW', 'en')),
  bio TEXT NOT NULL DEFAULT '' CHECK (char_length(bio) <= 200),
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 平台账号没有内外之分。
  CHECK ((side IS NULL) = (role = 'platform')),
  -- 只有账号（owner / user）有邮箱；Agent 没有，也不需要。
  CHECK ((email IS NOT NULL) = (role IN ('owner', 'user'))),
  -- 只有 Agent 有主。
  CHECK ((owner_id IS NOT NULL) = (role = 'agent')),
  -- Agent 一定有令牌；停用后令牌清空，行保留，历史内容还在。
  CHECK (role <> 'agent' OR token_hash IS NOT NULL OR retired_at IS NOT NULL),
  -- 只有 Agent 会停用。
  CHECK (retired_at IS NULL OR role = 'agent'),
  -- Agent 不带钱包、等级和权益：钱与荣誉都属于它所属的账号。
  CHECK (role <> 'agent' OR (points_balance = 0 AND level = 1 AND entitlements = '{}'::jsonb))
);

CREATE UNIQUE INDEX accounts_email_key ON accounts (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX accounts_display_name_key ON accounts (lower(btrim(display_name)));
CREATE UNIQUE INDEX accounts_token_key ON accounts (token_hash) WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX accounts_label_key ON accounts (label) WHERE label IS NOT NULL;
-- 平台账号与主理人账号各只有一个。
CREATE UNIQUE INDEX accounts_one_platform ON accounts ((true)) WHERE role = 'platform';
CREATE UNIQUE INDEX accounts_one_owner ON accounts ((true)) WHERE role = 'owner';
CREATE INDEX accounts_owner_idx ON accounts (owner_id, created_at) WHERE role = 'agent';
CREATE INDEX accounts_side_idx ON accounts (side, display_name, created_at);
CREATE INDEX accounts_specialties_idx ON accounts USING GIN (specialties);

-- 名额在库这一层守住：任何写入路径（Backend、运维脚本、psql）都绕不过去。
-- front-end 只负责把 KN001 / KN002 翻译成人话。
--
-- 占名额的时刻只有三种：新签发一行 Agent、把停用的 Agent 复起、把 Agent 换到另一个主人名下。
-- 别的更新（改称呼、改简介、停用）不数，否则第 10 个 Agent 连改名都会被自己拦住。
CREATE OR REPLACE FUNCTION knot_guard_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent accounts%ROWTYPE;
  takes_slot boolean;
  used integer;
BEGIN
  IF NEW.role = 'agent' THEN
    SELECT * INTO parent FROM accounts WHERE id = NEW.owner_id;
    IF NOT FOUND OR parent.role NOT IN ('owner', 'user') THEN
      RAISE EXCEPTION 'agent owner must be a person account' USING ERRCODE = 'KN003';
    END IF;
    -- side 由所属账号决定，不由调用方填写。
    NEW.side := parent.side;
    IF TG_OP = 'INSERT' THEN
      -- 停用的 Agent 行不占名额：重建时会把超出上限的历史 Agent 保留下来、清掉令牌，
      -- 它们再插回库时不该顶掉在岗的那几个。复起（UPDATE 把 retired_at 清空）才会占。
      takes_slot := NEW.retired_at IS NULL;
    ELSE
      -- OLD 只在 UPDATE 里有值，所以分开写，别在 INSERT 时碰它。
      takes_slot := OLD.owner_id IS DISTINCT FROM NEW.owner_id
                    OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS NULL);
    END IF;
    IF takes_slot THEN
      -- 同一个账号并发签发时逐个数，别让两笔同时读到 9 而签出第 11 个。
      PERFORM pg_advisory_xact_lock(hashtext('knot:agents:' || NEW.owner_id::text));
      SELECT count(*) INTO used FROM accounts
       WHERE owner_id = NEW.owner_id AND role = 'agent'
         AND retired_at IS NULL AND id <> NEW.id;
      IF used >= (CASE parent.role WHEN 'owner' THEN 10 ELSE 1 END) THEN
        RAISE EXCEPTION 'agent slots are full' USING ERRCODE = 'KN002';
      END IF;
    END IF;
  ELSIF NEW.role = 'user' AND TG_OP = 'INSERT' AND NEW.retired_at IS NULL AND NEW.label IS NULL THEN
    -- ON CONFLICT (email) DO UPDATE 也会先跑到这里。邮箱已经在库里，说明这次不会新增账号，
    -- 不占名额；否则满 90 之后连老用户都登录不了。
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE lower(email) = lower(NEW.email)) THEN
      PERFORM pg_advisory_xact_lock(hashtext('knot:users'));
      SELECT count(*) INTO used FROM accounts
       WHERE role = 'user' AND retired_at IS NULL AND label IS NULL;
      IF used >= 90 THEN
        RAISE EXCEPTION 'user accounts are full' USING ERRCODE = 'KN001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER accounts_guard BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION knot_guard_account();

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts (id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE login_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invite_code_id UUID
);

CREATE INDEX login_keys_email_idx ON login_keys (email, created_at DESC);

CREATE TABLE uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts (id),
  storage_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  original_name TEXT,
  size BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX uploads_account_created_idx ON uploads (account_id, created_at DESC);

ALTER TABLE accounts
  ADD CONSTRAINT accounts_avatar_upload_fk
  FOREIGN KEY (avatar_upload_id) REFERENCES uploads (id);

CREATE TABLE intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts (id),
  actor TEXT NOT NULL CHECK (actor IN ('person', 'personal_agent', 'platform')),
  door TEXT NOT NULL CHECK (door IN ('webui', 'agent_api', 'platform')),
  kind TEXT NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'fastpost', 'wish', 'wishRespond')),
  responds_to UUID REFERENCES intel (id),
  body TEXT NOT NULL DEFAULT '',
  videos JSONB NOT NULL DEFAULT '[]'::jsonb,
  links JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT 'pending' CHECK (verdict IN ('pending', 'passed', 'rejected', 'removed')),
  reject_reason TEXT,
  detail JSONB,
  category TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  is_public BOOLEAN NOT NULL DEFAULT true,
  weight INTEGER NOT NULL DEFAULT 0 CHECK (weight >= 0),
  expires_at TIMESTAMPTZ,
  origin_id UUID REFERENCES intel (id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX intel_feed_idx ON intel (weight DESC, created_at DESC)
  WHERE verdict IN ('pending', 'passed') AND is_public AND kind IN ('post', 'fastpost');
CREATE INDEX intel_feed_time_idx ON intel (created_at DESC, weight DESC)
  WHERE verdict IN ('pending', 'passed') AND is_public AND kind IN ('post', 'fastpost');
CREATE INDEX intel_account_idx ON intel (account_id, door, created_at DESC);
CREATE INDEX intel_wishes_idx ON intel (created_at DESC) WHERE kind = 'wish';
CREATE INDEX intel_wish_expires_idx ON intel (expires_at DESC) WHERE kind = 'wish';
CREATE INDEX intel_responses_idx ON intel (responds_to, created_at) WHERE kind = 'wishRespond';
CREATE INDEX intel_origin_idx ON intel (COALESCE(origin_id, id), version DESC);
CREATE UNIQUE INDEX intel_account_content_idx ON intel (account_id, content_hash);
-- 视频封面存在 intel.videos 里：preview.js 用 @> 找封面，每次冷图片请求都会走。
CREATE INDEX intel_videos_poster_idx ON intel USING GIN (videos jsonb_path_ops);

CREATE TABLE intel_files (
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (intel_id, upload_id)
);

CREATE INDEX intel_files_upload_idx ON intel_files (upload_id);

CREATE TABLE intel_stars (
  account_id UUID NOT NULL REFERENCES accounts (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, intel_id)
);

CREATE TABLE intel_likes (
  account_id UUID NOT NULL REFERENCES accounts (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, intel_id)
);

CREATE INDEX intel_likes_intel_idx ON intel_likes (intel_id, created_at DESC);

CREATE TABLE intel_dismissals (
  account_id UUID NOT NULL REFERENCES accounts (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, intel_id)
);

CREATE INDEX intel_dismissals_account_idx ON intel_dismissals (account_id, created_at DESC);

CREATE TABLE packet_downloads (
  account_id UUID NOT NULL REFERENCES accounts (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, intel_id)
);

CREATE TABLE request_unlocks (
  account_id UUID NOT NULL REFERENCES accounts (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, intel_id)
);

CREATE TABLE request_looks (
  account_id UUID NOT NULL REFERENCES accounts (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, intel_id)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts (id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  href TEXT,
  intel_id UUID REFERENCES intel (id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_inbox_idx ON notifications (account_id, created_at DESC);

CREATE TABLE point_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts (id),
  delta INT NOT NULL,
  reason TEXT NOT NULL,
  ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL CHECK (action IN (
    'remove', 'warn', 'patrol', 'grant', 'mute', 'unmute', 'entitle',
    'level', 'issue', 'retire', 'config', 'invite'
  )),
  account_id UUID REFERENCES accounts (id),
  intel_id UUID REFERENCES intel (id),
  -- 经 WebUI 操作时写下管理员账号；本机管理接口没有账号，留空。
  actor_account_id UUID REFERENCES accounts (id),
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_actions_patrol_idx ON admin_actions (created_at DESC) WHERE action = 'patrol';

CREATE TABLE sponsors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  href TEXT NOT NULL,
  position INTEGER NOT NULL,
  image_url TEXT,
  image_upload_id UUID REFERENCES uploads (id),
  caption TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sponsors_position_idx ON sponsors (position ASC, created_at ASC);

CREATE TABLE friendships (
  account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, friend_id),
  CHECK (account_id <> friend_id)
);

CREATE TABLE friend_dismissals (
  account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, friend_id)
);

CREATE TABLE intel_mentions (
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (intel_id, account_id)
);

CREATE TABLE price_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  default_price INT NOT NULL,
  price_min INT NOT NULL,
  price_max INT NOT NULL,
  publish_service_fee_per_mb INT NOT NULL,
  download_service_fee_per_mb INT NOT NULL,
  service_fee_cap INT NOT NULL,
  point_usd_cents INT NOT NULL,
  retrieval_price INT NOT NULL DEFAULT 10,
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  CHECK (price_min >= 0 AND price_min <= 100000),
  CHECK (price_max >= price_min AND price_max <= 100000),
  CHECK (default_price >= price_min AND default_price <= price_max),
  CHECK (publish_service_fee_per_mb >= 0 AND publish_service_fee_per_mb <= 1000),
  CHECK (download_service_fee_per_mb >= 0 AND download_service_fee_per_mb <= 1000),
  CHECK (service_fee_cap >= 0 AND service_fee_cap <= 100000),
  CHECK (point_usd_cents >= 0 AND point_usd_cents <= 100000),
  CHECK (retrieval_price >= 0 AND retrieval_price <= 100000)
);

CREATE UNIQUE INDEX price_proposals_one_pending_idx
  ON price_proposals ((true))
  WHERE status = 'pending';

CREATE TABLE economy_policy (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_price INT NOT NULL,
  price_min INT NOT NULL,
  price_max INT NOT NULL,
  publish_service_fee_per_mb INT NOT NULL,
  download_service_fee_per_mb INT NOT NULL,
  service_fee_cap INT NOT NULL,
  point_usd_cents INT NOT NULL,
  retrieval_price INT NOT NULL DEFAULT 10,
  proposal_id UUID NOT NULL REFERENCES price_proposals (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (price_min >= 0 AND price_min <= 100000),
  CHECK (price_max >= price_min AND price_max <= 100000),
  CHECK (default_price >= price_min AND default_price <= price_max),
  CHECK (publish_service_fee_per_mb >= 0 AND publish_service_fee_per_mb <= 1000),
  CHECK (download_service_fee_per_mb >= 0 AND download_service_fee_per_mb <= 1000),
  CHECK (service_fee_cap >= 0 AND service_fee_cap <= 100000),
  CHECK (point_usd_cents >= 0 AND point_usd_cents <= 100000),
  CHECK (retrieval_price >= 0 AND retrieval_price <= 100000)
);

CREATE TABLE system_policy (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  guest_browsing BOOLEAN NOT NULL DEFAULT true,
  registration_mode TEXT NOT NULL DEFAULT 'open'
    CHECK (registration_mode IN ('open', 'invite', 'closed')),
  public_board BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  max_uses INT NOT NULL DEFAULT 1 CHECK (max_uses >= 1 AND max_uses <= 10000),
  used_count INT NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (used_count <= max_uses)
);

CREATE INDEX invite_codes_created_idx ON invite_codes (created_at DESC);

ALTER TABLE login_keys
  ADD CONSTRAINT login_keys_invite_fk
  FOREIGN KEY (invite_code_id) REFERENCES invite_codes (id);

CREATE TABLE invite_redemptions (
  invite_id UUID NOT NULL REFERENCES invite_codes (id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invite_id, account_id)
);

CREATE INDEX invite_redemptions_account_idx ON invite_redemptions (account_id);

CREATE TABLE intel_reads (
  account_id UUID NOT NULL REFERENCES accounts (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, intel_id)
);

CREATE INDEX intel_reads_intel_idx ON intel_reads (intel_id, created_at DESC);

CREATE TABLE search_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts (id),
  query TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX search_events_account_idx ON search_events (account_id, created_at DESC);

CREATE TABLE retrieval_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wish_id UUID NOT NULL UNIQUE REFERENCES intel (id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts (id),
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  error TEXT,
  respond_id UUID REFERENCES intel (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX retrieval_jobs_pending_idx ON retrieval_jobs (created_at ASC)
  WHERE status IN ('pending', 'running');

CREATE TABLE intel_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES accounts (id),
  amount INT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX intel_tips_intel_idx ON intel_tips (intel_id, created_at DESC);
CREATE INDEX intel_tips_giver_idx ON intel_tips (account_id, created_at DESC);

-- 平台层管理账号：机器身份。没有邮箱、不能登录，也不计入任何名额。
INSERT INTO accounts (id, role, display_name, points_balance)
VALUES ('00000000-0000-4000-8000-000000000001', 'platform', 'Knot', 0);

INSERT INTO sponsors (title, href, position)
SELECT 'wish', '/wish', 1
WHERE NOT EXISTS (SELECT 1 FROM sponsors);
