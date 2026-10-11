CREATE TABLE bounties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body TEXT NOT NULL,
  reward INTEGER NOT NULL CHECK (reward > 0),
  bounty_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'completed', 'submitted')),
  user_id UUID REFERENCES users (id),
  result TEXT,
  demand_id UUID REFERENCES demands (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bounties_day_idx ON bounties (bounty_date, created_at);
CREATE INDEX bounties_created_idx ON bounties (created_at);
CREATE UNIQUE INDEX bounties_demand_idx ON bounties (demand_id) WHERE demand_id IS NOT NULL;
