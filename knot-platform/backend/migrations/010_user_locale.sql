ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_locale_check;

ALTER TABLE users ADD CONSTRAINT users_locale_check
  CHECK (locale IS NULL OR locale IN ('zh-CN', 'zh-TW', 'en'));
