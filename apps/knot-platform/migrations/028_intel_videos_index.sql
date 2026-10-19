-- 视频封面存在 intel.videos 里，不进 intel_files。判断「这张图能不能被看」时，
-- preview.js 会用 `videos @> '[{"poster": "/api/web/uploads/{id}/display"}]'` 找封面。
-- 没有索引时这是全表扫描，而它跑在每一次冷图片请求上（一屏 30 条 × 最多 9 张图）。
-- jsonb_path_ops 只支持 @>、体积更小，正好覆盖这一种查询。
CREATE INDEX IF NOT EXISTS intel_videos_poster_idx ON intel USING GIN (videos jsonb_path_ops);
