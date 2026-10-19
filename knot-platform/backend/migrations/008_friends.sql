CREATE TABLE IF NOT EXISTS friendships (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

CREATE TABLE IF NOT EXISTS friend_dismissals (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS intel_mentions (
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (intel_id, user_id)
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS intel_id UUID REFERENCES intel (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_internal_idx ON users (display_name, created_at) WHERE side = 'internal';
