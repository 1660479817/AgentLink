ALTER TABLE users ADD COLUMN IF NOT EXISTS side TEXT NOT NULL DEFAULT 'external';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_side_check' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_side_check CHECK (side IN ('internal', 'external'));
  END IF;
END $$;

DROP INDEX IF EXISTS users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_external_key
  ON users (lower(email))
  WHERE email IS NOT NULL AND side = 'external';
