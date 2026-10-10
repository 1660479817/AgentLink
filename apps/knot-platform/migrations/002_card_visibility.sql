-- 披露档位：找信息可见性（交换权限仍由 API 单独要求注册）

ALTER TABLE information_cards
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'registered', 'verified'));

CREATE INDEX IF NOT EXISTS idx_cards_visibility_created
  ON information_cards (visibility, created_at DESC);
