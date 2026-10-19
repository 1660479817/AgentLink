-- 注意力打点（只记不扣费）：先量化「筛选与压缩消耗的注意力」，供精算师看，
-- 数据够了再决定是否计价。读痕迹和检索事件都只追加。

-- 谁读过哪条公开记录。主键同一对只一行，重复读不重复记。
CREATE TABLE intel_reads (
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intel_id)
);

CREATE INDEX intel_reads_intel_idx ON intel_reads (intel_id, created_at DESC);

-- 谁搜过什么。检索是代理替人「筛选」的计费候选点。
CREATE TABLE search_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  query TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX search_events_user_idx ON search_events (user_id, created_at DESC);
