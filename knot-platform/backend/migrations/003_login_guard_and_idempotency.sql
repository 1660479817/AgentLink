-- 登录码试错的计数，从进程内存挪进库：重启不清零，多进程共用同一份。
--
-- 一个邮箱两行：ip = '' 的是这个邮箱被所有地址试错的总量，另一行是每个地址各自的。
-- 只按地址记，换 IP 就清零；只按邮箱记，看不出是谁在试，两个都要。
CREATE TABLE IF NOT EXISTS login_failures (
  email TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, ip)
);

-- 查锁只按 (email, ip) 与 (email, '') 两种组合，主键已经覆盖；
-- 这个索引给的是「哪些邮箱现在还在锁里」这类排查用。
CREATE INDEX IF NOT EXISTS login_failures_locked_idx
  ON login_failures (locked_until)
  WHERE locked_until IS NOT NULL;

-- 管理端一次性动作的幂等键。
-- /points 原来按「同收件人 + 同金额 + 同理由，10 分钟内算重放」去重，那是猜的：
-- 十分钟内真要给同一个人发两笔一样的，第二笔会被静默吞掉。改成由客户端带一个
-- 只属于这一次提交的键，重试复用同一个键、重新填表就换一个。
ALTER TABLE admin_actions ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS admin_actions_request_id_idx
  ON admin_actions (request_id)
  WHERE request_id IS NOT NULL;
