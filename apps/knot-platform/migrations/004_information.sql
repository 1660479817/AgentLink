CREATE TABLE bounty_claim_files (
  bounty_id UUID NOT NULL,
  user_id UUID NOT NULL,
  upload_id UUID NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (bounty_id, user_id, upload_id),
  FOREIGN KEY (bounty_id, user_id) REFERENCES bounty_claims (bounty_id, user_id) ON DELETE CASCADE
);
