ALTER TABLE persons
  ADD COLUMN IF NOT EXISTS points_balance INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS contact TEXT;

ALTER TABLE expressions
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS card_image_id UUID,
  ADD COLUMN IF NOT EXISTS intel_reward INT,
  ADD COLUMN IF NOT EXISTS contact TEXT;

ALTER TABLE expressions DROP CONSTRAINT IF EXISTS expressions_review_status_check;
ALTER TABLE expressions ADD CONSTRAINT expressions_review_status_check
  CHECK (review_status IN ('pending', 'published', 'rejected'));

CREATE TABLE IF NOT EXISTS uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES persons (id),
  storage_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE expressions
  ADD CONSTRAINT expressions_card_image_id_fkey
  FOREIGN KEY (card_image_id) REFERENCES uploads (id);

CREATE TABLE IF NOT EXISTS expression_images (
  expression_id UUID NOT NULL REFERENCES expressions (id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (expression_id, upload_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES persons (id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  href TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_inbox_idx ON notifications (person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_expression_id UUID NOT NULL REFERENCES expressions (id),
  supply_expression_id UUID NOT NULL REFERENCES expressions (id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected')),
  connect_cost INT NOT NULL DEFAULT 1,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (demand_expression_id, supply_expression_id)
);

CREATE INDEX IF NOT EXISTS matches_demand_idx ON matches (demand_expression_id);
CREATE INDEX IF NOT EXISTS matches_supply_idx ON matches (supply_expression_id);

CREATE TABLE IF NOT EXISTS point_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES persons (id),
  delta INT NOT NULL,
  reason TEXT NOT NULL,
  ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS match_id UUID REFERENCES matches (id);

UPDATE expressions SET review_status = 'published' WHERE processed IS NOT NULL AND review_status = 'pending';
