ALTER TABLE expressions
  ADD COLUMN IF NOT EXISTS card JSONB,
  ADD COLUMN IF NOT EXISTS evaluation JSONB,
  ADD COLUMN IF NOT EXISTS reject_code TEXT,
  ADD COLUMN IF NOT EXISTS card_image_source TEXT;

ALTER TABLE expressions DROP CONSTRAINT IF EXISTS expressions_reject_code_check;
ALTER TABLE expressions ADD CONSTRAINT expressions_reject_code_check
  CHECK (reject_code IS NULL OR reject_code IN ('violation', 'low_quality', 'insufficient'));

ALTER TABLE expressions DROP CONSTRAINT IF EXISTS expressions_card_image_source_check;
ALTER TABLE expressions ADD CONSTRAINT expressions_card_image_source_check
  CHECK (card_image_source IS NULL OR card_image_source IN ('upload', 'generated'));

UPDATE expressions
SET card = jsonb_build_object('summary', processed, 'subject', processed)
WHERE processed IS NOT NULL AND card IS NULL;
