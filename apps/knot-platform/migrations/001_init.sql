CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_upload_id UUID,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
  points_balance INTEGER NOT NULL DEFAULT 10 CHECK (points_balance >= 0),
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_label_key ON users (label) WHERE label IS NOT NULL;

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
  body TEXT NOT NULL DEFAULT '',
  verdict TEXT NOT NULL DEFAULT 'pending' CHECK (verdict IN ('pending', 'passed', 'rejected')),
  reject_reason TEXT,
  detail JSONB,
  weight INTEGER NOT NULL DEFAULT 0 CHECK (weight >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX intel_feed_idx ON intel (weight DESC, created_at DESC) WHERE verdict = 'passed';
CREATE INDEX intel_user_idx ON intel (user_id, door, created_at DESC);

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

INSERT INTO users (id, display_name, label, points_balance)
VALUES ('00000000-0000-4000-8000-000000000001', 'Knot', 'platform', 0);

CREATE TABLE demands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  actor TEXT NOT NULL CHECK (actor IN ('person', 'personal_agent')),
  door TEXT NOT NULL CHECK (door IN ('webui', 'agent_api')),
  brief TEXT NOT NULL,
  citation_limit INT NOT NULL DEFAULT 10 CHECK (citation_limit BETWEEN 1 AND 10),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX demands_user_idx ON demands (user_id, door, created_at DESC);

CREATE TABLE demand_files (
  demand_id UUID NOT NULL REFERENCES demands (id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (demand_id, upload_id)
);

CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id UUID NOT NULL UNIQUE REFERENCES demands (id),
  body TEXT NOT NULL DEFAULT '',
  citation_count INT NOT NULL,
  cost INT NOT NULL,
  emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE delivery_citations (
  delivery_id UUID NOT NULL REFERENCES deliveries (id) ON DELETE CASCADE,
  intel_id UUID NOT NULL REFERENCES intel (id),
  PRIMARY KEY (delivery_id, intel_id)
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
