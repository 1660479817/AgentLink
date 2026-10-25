-- 004: 内容与交易彻底分家。
--
-- 这一版之后库里只有三种记录：post、fastpost 是内容，item 是 Knot Store 里的商品。
-- wish / wishRespond 与整套检索、解锁、下载计费的表和列一起消失，没有兼容层。

-- 1. 旧交易链路整条移除 ------------------------------------------------------

-- 检索任务引用 intel 与 accounts，先删表再删记录，避免级联把顺序写死在迁移里。
DROP TABLE IF EXISTS retrieval_jobs;
DROP TABLE IF EXISTS request_looks;
DROP TABLE IF EXISTS request_unlocks;
DROP TABLE IF EXISTS packet_downloads;

DELETE FROM intel WHERE kind IN ('wish', 'wishRespond');

DROP INDEX IF EXISTS intel_wishes_idx;
DROP INDEX IF EXISTS intel_wish_expires_idx;
DROP INDEX IF EXISTS intel_responses_idx;

ALTER TABLE intel DROP COLUMN IF EXISTS responds_to;
ALTER TABLE intel DROP COLUMN IF EXISTS expires_at;

-- 2. 内容不带价 --------------------------------------------------------------

-- 存量帖子上的标价一律归零：附件下载从此免费，价格只在 Store 里出现。
UPDATE intel SET price = 0 WHERE kind IN ('post', 'fastpost') AND price <> 0;

ALTER TABLE intel DROP CONSTRAINT IF EXISTS intel_kind_check;
ALTER TABLE intel
  ADD CONSTRAINT intel_kind_check CHECK (kind IN ('post', 'fastpost', 'item'));

ALTER TABLE intel DROP CONSTRAINT IF EXISTS post_never_sells;
ALTER TABLE intel
  ADD CONSTRAINT post_never_sells CHECK (kind NOT IN ('post', 'fastpost') OR price = 0);

ALTER TABLE intel DROP CONSTRAINT IF EXISTS item_always_priced;
ALTER TABLE intel
  ADD CONSTRAINT item_always_priced CHECK (kind <> 'item' OR price >= 1);

-- 商品不进信息流、搜索和公开快照；这里把「不进」写进库，任何一条查询漏改都不会漏出去。
ALTER TABLE intel DROP CONSTRAINT IF EXISTS item_never_public;
ALTER TABLE intel
  ADD CONSTRAINT item_never_public CHECK (kind <> 'item' OR is_public = false);

-- 3. Store 的两张表 ----------------------------------------------------------

-- store_items 是 intel 上的一行货架状态。复合外键把「货架行只能挂在 item 上」
-- 交给库来保证：kind 列钉死 'item'，(intel_id, kind) 必须指向一条 item 记录。
ALTER TABLE intel DROP CONSTRAINT IF EXISTS intel_id_kind_key;
ALTER TABLE intel ADD CONSTRAINT intel_id_kind_key UNIQUE (id, kind);

CREATE TABLE IF NOT EXISTS store_items (
  intel_id UUID PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'item' CHECK (kind = 'item'),
  state TEXT NOT NULL DEFAULT 'on_sale' CHECK (state IN ('on_sale', 'withdrawn')),
  listed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  withdrawn_by UUID REFERENCES accounts (id),
  FOREIGN KEY (intel_id, kind) REFERENCES intel (id, kind) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS store_items_shelf_idx
  ON store_items (listed_at DESC) WHERE state = 'on_sale';

-- 一笔订单。买卖双方都记钱包（人本人），Agent 代买代卖都归到主人账上，
-- 所以 UNIQUE (item_id, buyer_id) 天然挡住「人买过、Agent 再买一次」。
CREATE TABLE IF NOT EXISTS store_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES intel (id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES accounts (id),
  seller_id UUID NOT NULL REFERENCES accounts (id),
  price INT NOT NULL CHECK (price >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS store_orders_buyer_idx ON store_orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_orders_seller_idx ON store_orders (seller_id, created_at DESC);

-- 4. 经济表里与检索、下载费相关的列 ------------------------------------------

ALTER TABLE price_proposals DROP COLUMN IF EXISTS retrieval_price;
ALTER TABLE price_proposals DROP COLUMN IF EXISTS download_service_fee_per_mb;
ALTER TABLE economy_policy DROP COLUMN IF EXISTS retrieval_price;
ALTER TABLE economy_policy DROP COLUMN IF EXISTS download_service_fee_per_mb;

-- 5. 入口默认赞助位原来指向 /wish --------------------------------------------

UPDATE sponsors SET title = 'store', href = '/store' WHERE href = '/wish';

-- 6. 里程碑 ------------------------------------------------------------------

UPDATE schema_milestone SET version = '2026-10-0.8.0' WHERE id = 1;
