DROP INDEX IF EXISTS intel_feed_idx;

CREATE INDEX intel_feed_idx ON intel (weight DESC, created_at DESC)
  WHERE verdict IN ('pending', 'passed') AND is_public AND kind IN ('post', 'fastpost');
