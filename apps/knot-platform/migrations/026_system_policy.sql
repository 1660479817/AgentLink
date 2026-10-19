-- 系统层开关。只有 id = 1 这一行，和 economy_policy 一样盖过代码里的初值。
-- 迁移写入的这一行按产品要求把站内浏览和公开快照都关掉：未登录只停在登录/注册页。
-- 没有这一行时，代码用同样的初值（见 src/system.js）。
CREATE TABLE system_policy (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  guest_browsing BOOLEAN NOT NULL DEFAULT false,
  registration_mode TEXT NOT NULL DEFAULT 'open'
    CHECK (registration_mode IN ('open', 'invite', 'closed')),
  public_board BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 邀请码。open 模式不用；invite 模式下新账户注册时校验并原子扣一次。
-- code 统一大写、去掉分隔符后保存，方便口头或聊天里传递。
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

-- 谁用哪一把码开的户。管理端据此回看拉新来源。
CREATE TABLE invite_redemptions (
  invite_id UUID NOT NULL REFERENCES invite_codes (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invite_id, user_id)
);

CREATE INDEX invite_redemptions_user_idx ON invite_redemptions (user_id);

-- 请求登录密钥时把当时校验过的邀请码记下来，兑换密钥时不用再传一次。
ALTER TABLE login_keys
  ADD COLUMN invite_code_id UUID REFERENCES invite_codes (id);

-- 管理动作多两类：改系统开关、签发邀请码。
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'admin_actions'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%action%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE admin_actions DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE admin_actions
  ADD CONSTRAINT admin_actions_action_check
  CHECK (action IN ('remove', 'warn', 'patrol', 'grant', 'mute', 'unmute', 'entitle', 'level', 'issue', 'config', 'invite'));
