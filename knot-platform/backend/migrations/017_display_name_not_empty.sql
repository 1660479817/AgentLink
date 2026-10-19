-- 称呼非空且全局唯一，比较忽略大小写（Paul Wang 与 paul wang 视为重名）。
-- 先解除旧的大小写敏感唯一索引，补空称呼，再消解只差大小写的重名，
-- 最后加非空约束并重建忽略大小写的唯一索引。

DROP INDEX IF EXISTS users_display_name_key;

-- 补空称呼：用邮箱前缀，邮箱缺省时用「用户」，冲突追加序号。
DO $$
DECLARE
  u RECORD;
  base TEXT;
  cand TEXT;
  seq INT;
BEGIN
  FOR u IN
    SELECT id, email
    FROM users
    WHERE btrim(display_name) = ''
    ORDER BY created_at ASC, id ASC
  LOOP
    base := btrim(split_part(COALESCE(u.email, ''), '@', 1));
    IF base = '' THEN
      base := '用户';
    END IF;
    base := left(base, 39);
    cand := base;
    seq := 0;
    WHILE EXISTS (
      SELECT 1 FROM users
      WHERE id <> u.id AND lower(btrim(display_name)) = lower(cand)
    ) LOOP
      seq := seq + 1;
      cand := left(base, 40 - length(seq::text) - 1) || ' ' || seq;
    END LOOP;
    UPDATE users SET display_name = cand WHERE id = u.id;
  END LOOP;
END $$;

-- 消解只差大小写的重名：保留最早一条，其余追加序号。
DO $$
DECLARE
  grp RECORD;
  u RECORD;
  base TEXT;
  cand TEXT;
  seq INT;
BEGIN
  FOR grp IN
    SELECT lower(btrim(display_name)) AS name_key
    FROM users
    WHERE btrim(display_name) <> ''
    GROUP BY lower(btrim(display_name))
    HAVING count(*) > 1
    ORDER BY name_key
  LOOP
    seq := 0;
    FOR u IN
      SELECT id, display_name
      FROM users
      WHERE lower(btrim(display_name)) = grp.name_key
      ORDER BY created_at ASC, id ASC
    LOOP
      seq := seq + 1;
      IF seq = 1 THEN
        CONTINUE;
      END IF;
      base := left(u.display_name, 39);
      cand := left(base, 40 - length(seq::text) - 1) || ' ' || seq;
      WHILE EXISTS (
        SELECT 1 FROM users
        WHERE id <> u.id AND lower(btrim(display_name)) = lower(cand)
      ) LOOP
        seq := seq + 1;
        cand := left(base, 40 - length(seq::text) - 1) || ' ' || seq;
      END LOOP;
      UPDATE users SET display_name = cand WHERE id = u.id;
    END LOOP;
  END LOOP;
END $$;

-- 称呼不允许为空。
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_display_name_not_empty;
ALTER TABLE users ADD CONSTRAINT users_display_name_not_empty
  CHECK (btrim(display_name) <> '');

-- 全局唯一，忽略大小写。
CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_key
  ON users (lower(btrim(display_name)));
