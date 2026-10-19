ALTER TABLE users ADD COLUMN IF NOT EXISTS specialties JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS users_specialties_idx ON users USING GIN (specialties);
