-- 打赏：读者把积分直接转给这条信息的作者，平台不抽成。
-- 一条记录可以被同一个人打赏多次，所以不设唯一键；合计按 intel_id 聚合。
CREATE TABLE intel_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id),
  intel_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users (id),
  amount INT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX intel_tips_intel_idx ON intel_tips (intel_id, created_at DESC);
CREATE INDEX intel_tips_giver_idx ON intel_tips (user_id, created_at DESC);
