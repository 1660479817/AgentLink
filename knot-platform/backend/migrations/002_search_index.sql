-- 检索索引与检索员任务的可观测字段。
--
-- 001_accounts.sql 是基线，已执行过的库会校验 checksum，改基线等于让现有库必须重建。
-- 所以新增的东西都放在这里：纯增量、可重复执行、不改任何业务字段。
--
-- search_compact / search_bigrams 是派生列，由 Backend 的 searchIndex.js 计算：
--   * search_compact  归一化后的可检索文字（lower + 去掉非字母数字）；
--   * search_bigrams  它的去重二元组，GIN 索引据此给出候选集。
-- 存量行用 backend/scripts/reindex-search.mjs 回填。未回填的行两列为 NULL，
-- 检索语句对 NULL 保留兜底条件，所以回填到一半也不会让内容搜不到。

ALTER TABLE intel ADD COLUMN IF NOT EXISTS search_compact TEXT;
ALTER TABLE intel ADD COLUMN IF NOT EXISTS search_bigrams TEXT[];

-- 数组默认操作符类支持 &&（重叠判定），与打分的「有没有碰到」一致。
CREATE INDEX IF NOT EXISTS intel_search_bigrams_idx ON intel USING GIN (search_bigrams);

-- 回填未完成时，未索引的行要能被兜底条件找到。检索语句里写的是
-- `search_bigrams IS NULL OR search_bigrams && $n`，没有这一支的索引路径时，
-- 整条查询会因为一支不可索引而退化成全表顺序扫描。
-- 回填完成后这个部分索引是空的，维护成本接近零。
CREATE INDEX IF NOT EXISTS intel_search_unindexed_idx ON intel (id) WHERE search_bigrams IS NULL;

-- 检索员的尝试次数随行落库：原先只在进程内存里，重启就把上限清零。
ALTER TABLE retrieval_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
