ALTER TABLE users ALTER COLUMN points_balance SET DEFAULT 100;

ALTER TABLE intel ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intel DROP CONSTRAINT IF EXISTS intel_price_check;
ALTER TABLE intel ADD CONSTRAINT intel_price_check CHECK (price >= 0);

ALTER TABLE intel ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';
ALTER TABLE intel ADD COLUMN IF NOT EXISTS bounty_id UUID REFERENCES bounties (id);

UPDATE intel
SET price = 10
WHERE price = 0
  AND EXISTS (SELECT 1 FROM intel_files f WHERE f.intel_id = intel.id);

ALTER TABLE demands ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';

ALTER TABLE demands DROP CONSTRAINT IF EXISTS demands_stop_reason_check;
ALTER TABLE demands
  ADD CONSTRAINT demands_stop_reason_check
  CHECK (stop_reason IS NULL OR stop_reason IN ('user', 'timeout', 'review'));

CREATE TABLE IF NOT EXISTS packet_downloads (
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intel_id)
);

ALTER TABLE bounties DROP CONSTRAINT IF EXISTS bounties_reward_check;
ALTER TABLE bounties ALTER COLUMN reward SET DEFAULT 0;
ALTER TABLE bounties DROP CONSTRAINT IF EXISTS bounties_reward_nonneg;
ALTER TABLE bounties ADD CONSTRAINT bounties_reward_nonneg CHECK (reward >= 0);

ALTER TABLE bounties ADD COLUMN IF NOT EXISTS hours INTEGER;
ALTER TABLE bounties DROP CONSTRAINT IF EXISTS bounties_hours_check;
ALTER TABLE bounties ADD CONSTRAINT bounties_hours_check CHECK (hours IS NULL OR hours BETWEEN 1 AND 72);

ALTER TABLE bounties ADD COLUMN IF NOT EXISTS completed_intel_id UUID REFERENCES intel (id);
