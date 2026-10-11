CREATE TABLE intel_dismissals (
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intel_id)
);

CREATE INDEX intel_dismissals_user_idx ON intel_dismissals (user_id, created_at DESC);
