CREATE TABLE bounty_claims (
  bounty_id UUID NOT NULL REFERENCES bounties (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'completed', 'submitted')),
  result TEXT,
  quality INTEGER CHECK (quality IS NULL OR quality >= 0),
  awarded INTEGER CHECK (awarded IS NULL OR awarded >= 0),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bounty_id, user_id)
);

ALTER TABLE bounties DROP CONSTRAINT IF EXISTS bounties_status_check;
ALTER TABLE bounties
  ADD CONSTRAINT bounties_status_check
  CHECK (status IN ('open', 'claimed', 'completed', 'submitted', 'settled'));
