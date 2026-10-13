ALTER TABLE intel ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'share';

ALTER TABLE intel DROP CONSTRAINT IF EXISTS intel_kind_check;

ALTER TABLE intel
  ADD CONSTRAINT intel_kind_check CHECK (kind IN ('share', 'request', 'response'));

ALTER TABLE intel ADD COLUMN IF NOT EXISTS responds_to UUID REFERENCES intel (id);

CREATE INDEX IF NOT EXISTS intel_requests_idx ON intel (created_at DESC) WHERE kind = 'request' AND verdict = 'passed';

CREATE INDEX IF NOT EXISTS intel_responses_idx ON intel (responds_to, created_at) WHERE kind = 'response';

CREATE TABLE IF NOT EXISTS request_unlocks (
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intel_id)
);
