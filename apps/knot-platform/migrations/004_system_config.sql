-- 系统配置唯一真源（SMTP、对外 URL 等；启动/bootstrap 仍用 DATABASE_URL 等 env）

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_config (key, value)
VALUES (
  'platform',
  '{"publicWebOrigin":"http://127.0.0.1:5173","smtp":{"host":"","port":465,"secure":true,"user":"","pass":"","from":""}}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
