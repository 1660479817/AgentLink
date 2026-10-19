-- 站内浏览与公开快照改为默认开启：未登录也能看公开内容，快照同时可用。
-- 026 建表时两者默认关闭，已装好的站已经写下了那一行；这里把默认值和已有行一起改过来。
-- 管理端仍可随时关掉，关掉 guest_browsing 时 public_board 跟着关（见 src/system.js）。
ALTER TABLE system_policy ALTER COLUMN guest_browsing SET DEFAULT true;
ALTER TABLE system_policy ALTER COLUMN public_board SET DEFAULT true;

UPDATE system_policy
SET guest_browsing = true,
    public_board = true,
    updated_at = now()
WHERE id = 1;
