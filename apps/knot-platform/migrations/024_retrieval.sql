-- 信息检索：平台管理 Agent「信息检索员」把自然语言检索请求变成 wish，
-- 检索结果打包成 wishRespond（带附件）供请求方下载。检索是收费服务，
-- 价格由平台统一设定，下载检索结果时扣费。

-- 检索任务：一条检索请求（wish）对应一行，跟踪执行状态。重启后据此恢复未完成的任务。
CREATE TABLE retrieval_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wish_id UUID NOT NULL UNIQUE REFERENCES intel (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id),
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  error TEXT,
  respond_id UUID REFERENCES intel (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX retrieval_jobs_pending_idx ON retrieval_jobs (created_at ASC) WHERE status IN ('pending', 'running');

-- 检索价：平台统一服务价，独立于作者标价的 min/max。下载检索结果时加在下载服务费之上。
ALTER TABLE price_proposals ADD COLUMN retrieval_price INT NOT NULL DEFAULT 10;
ALTER TABLE price_proposals ADD CONSTRAINT price_proposals_retrieval_price_check
  CHECK (retrieval_price >= 0 AND retrieval_price <= 100000);

ALTER TABLE economy_policy ADD COLUMN retrieval_price INT NOT NULL DEFAULT 10;
ALTER TABLE economy_policy ADD CONSTRAINT economy_policy_retrieval_price_check
  CHECK (retrieval_price >= 0 AND retrieval_price <= 100000);
