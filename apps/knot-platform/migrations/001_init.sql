CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_upload_id UUID,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
  points_balance INTEGER NOT NULL DEFAULT 100 CHECK (points_balance >= 0),
  muted_until TIMESTAMPTZ,
  label TEXT,
  side TEXT NOT NULL DEFAULT 'external' CHECK (side IN ('internal', 'external')),
  specialties JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_external_key ON users (lower(email)) WHERE email IS NOT NULL AND side = 'external';
CREATE UNIQUE INDEX users_label_key ON users (label) WHERE label IS NOT NULL;
CREATE UNIQUE INDEX users_internal_name_key ON users (display_name) WHERE side = 'internal';
CREATE INDEX users_specialties_idx ON users USING GIN (specialties);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE login_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX login_keys_email_idx ON login_keys (email, created_at DESC);

CREATE TABLE delegations (
  user_id UUID PRIMARY KEY REFERENCES users (id),
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  storage_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  original_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD CONSTRAINT users_avatar_upload_fk
  FOREIGN KEY (avatar_upload_id) REFERENCES uploads (id);

CREATE TABLE intel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX intel_feed_idx ON intel (weight DESC, created_at DESC)
  WHERE verdict = 'passed' AND is_public AND kind IN ('post', 'fastpost');
CREATE INDEX intel_user_idx ON intel (user_id, door, created_at DESC);
CREATE INDEX intel_wishes_idx ON intel (created_at DESC) WHERE kind = 'wish';
CREATE INDEX intel_responses_idx ON intel (responds_to, created_at) WHERE kind = 'wishRespond';
CREATE UNIQUE INDEX intel_user_content_idx ON intel (user_id, content_hash);

CREATE TABLE intel_files (
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (intel_id, upload_id)
);

CREATE TABLE intel_stars (
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intel_id)
);

CREATE TABLE intel_dismissals (
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intel_id)
);

CREATE INDEX intel_dismissals_user_idx ON intel_dismissals (user_id, created_at DESC);

CREATE TABLE packet_downloads (
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intel_id)
);

CREATE TABLE request_unlocks (
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intel_id)
);

CREATE TABLE request_looks (
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intel_id)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  href TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_inbox_idx ON notifications (user_id, created_at DESC);

CREATE TABLE point_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  delta INT NOT NULL,
  reason TEXT NOT NULL,
  ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL CHECK (action IN ('remove', 'warn', 'patrol', 'grant', 'mute', 'unmute', 'entitle', 'level', 'issue')),
  user_id UUID REFERENCES users (id),
  intel_id UUID REFERENCES intel (id),
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

INSERT INTO users (id, display_name, label, points_balance)
VALUES ('00000000-0000-4000-8000-000000000001', 'Knot', 'platform', 0);

INSERT INTO sponsors (title, href, position)
SELECT 'wish', '/wish', 1
WHERE NOT EXISTS (SELECT 1 FROM sponsors);
