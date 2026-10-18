-- 修订 lineage：一条内容可以有多个版本。
-- origin_id 指向首版（origin）；没有修订时为空，表示这条自己就是 origin。
-- version 从 1 起，修订时 +1。信息流和搜索每个 origin 只显示最新可见版。
ALTER TABLE intel ADD COLUMN origin_id UUID REFERENCES intel (id);
ALTER TABLE intel ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX intel_origin_idx ON intel (COALESCE(origin_id, id), version DESC);
