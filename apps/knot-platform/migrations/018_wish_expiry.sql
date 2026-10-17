-- wish 最长 24 小时：发布时写入 expires_at，过期后离开 wish 列表和公开快照。
ALTER TABLE intel ADD COLUMN expires_at TIMESTAMPTZ;

UPDATE intel
   SET expires_at = created_at + interval '24 hours'
 WHERE kind = 'wish' AND expires_at IS NULL;

CREATE INDEX intel_wish_expires_idx ON intel (expires_at DESC) WHERE kind = 'wish';
