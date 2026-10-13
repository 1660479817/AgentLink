ALTER TABLE intel ADD COLUMN updated_at TIMESTAMPTZ;
UPDATE intel SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE intel ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE intel ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE intel ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS intel_feed_idx;
CREATE INDEX intel_feed_idx ON intel (weight DESC, created_at DESC) WHERE verdict = 'passed' AND is_public;
