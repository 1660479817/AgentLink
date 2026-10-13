DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'intel'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%verdict%'
  LOOP
    EXECUTE format('ALTER TABLE intel DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE intel ADD CONSTRAINT intel_verdict_check
  CHECK (verdict IN ('pending', 'passed', 'rejected', 'removed'));

CREATE TABLE admin_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL CHECK (action IN ('remove', 'warn', 'patrol')),
  user_id UUID REFERENCES users (id),
  intel_id UUID REFERENCES intel (id),
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_actions_patrol_idx ON admin_actions (created_at DESC) WHERE action = 'patrol';
