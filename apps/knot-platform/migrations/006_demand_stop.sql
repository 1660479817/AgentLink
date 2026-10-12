ALTER TABLE demands DROP CONSTRAINT IF EXISTS demands_status_check;
ALTER TABLE demands
  ADD CONSTRAINT demands_status_check CHECK (status IN ('open', 'fulfilled', 'stopped'));

ALTER TABLE demands ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS stop_reason TEXT;

ALTER TABLE demands DROP CONSTRAINT IF EXISTS demands_stop_reason_check;
ALTER TABLE demands
  ADD CONSTRAINT demands_stop_reason_check
  CHECK (stop_reason IS NULL OR stop_reason IN ('user', 'timeout'));
