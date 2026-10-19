-- 称呼全局唯一（非空）。已存在的重名保留最早一条，其余按创建顺序追加序号。

DO $$
DECLARE
  grp RECORD;
  u RECORD;
  seq INT;
  cand TEXT;
BEGIN
  FOR grp IN
    SELECT display_name
    FROM users
    WHERE btrim(display_name) <> ''
    GROUP BY display_name
    HAVING count(*) > 1
    ORDER BY display_name
  LOOP
    seq := 0;
    FOR u IN
      SELECT id
      FROM users
      WHERE display_name = grp.display_name
      ORDER BY created_at ASC, id ASC
    LOOP
      seq := seq + 1;
      IF seq = 1 THEN
        CONTINUE;
      END IF;
      cand := left(grp.display_name, 40 - length(seq::text) - 1) || ' ' || seq;
      WHILE EXISTS (SELECT 1 FROM users WHERE display_name = cand) LOOP
        seq := seq + 1;
        cand := left(grp.display_name, 40 - length(seq::text) - 1) || ' ' || seq;
      END LOOP;
      UPDATE users SET display_name = cand WHERE id = u.id;
    END LOOP;
  END LOOP;
END $$;

DROP INDEX IF EXISTS users_internal_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_key
  ON users (display_name)
  WHERE btrim(display_name) <> '';
