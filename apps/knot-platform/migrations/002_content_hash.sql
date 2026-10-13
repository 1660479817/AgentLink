CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE intel ADD COLUMN IF NOT EXISTS content_hash TEXT;
UPDATE intel
SET content_hash = encode(digest(id::text, 'sha256'), 'hex')
WHERE content_hash IS NULL OR content_hash = '';
ALTER TABLE intel ALTER COLUMN content_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS intel_user_content_idx ON intel (user_id, content_hash);
