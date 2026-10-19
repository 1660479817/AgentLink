CREATE TABLE IF NOT EXISTS request_looks (
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intel_id)
);
