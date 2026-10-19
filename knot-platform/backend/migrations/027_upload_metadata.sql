-- 上传文件的元数据：内容摘要、像素尺寸，以及按 upload_id 反查帖子的索引。
-- 已有行由 scripts/backfill-uploads.mjs 从磁盘回填，不在 SQL 里猜。
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS height INTEGER;

CREATE INDEX IF NOT EXISTS uploads_user_created_idx ON uploads (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS intel_files_upload_idx ON intel_files (upload_id);
