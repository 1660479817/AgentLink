-- Web 展示快照：刷新间隔等（与 platform 并列，专用于 webDisplay）

INSERT INTO system_config (key, value)
VALUES (
  'webDisplay',
  '{
    "refreshAfterMs": 60000,
    "statsTimezone": "Asia/Hong_Kong",
    "homePreviewSize": 5,
    "cardsTotalMode": "public_visible",
    "plazaDefaultLimit": 20
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
