CREATE INDEX intel_feed_time_idx ON intel (created_at DESC, weight DESC)
  WHERE verdict IN ('pending', 'passed') AND is_public AND kind IN ('post', 'fastpost');
