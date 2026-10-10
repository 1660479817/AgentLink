ALTER TABLE persons
  ADD COLUMN IF NOT EXISTS label TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS persons_label_key ON persons (label) WHERE label IS NOT NULL;
