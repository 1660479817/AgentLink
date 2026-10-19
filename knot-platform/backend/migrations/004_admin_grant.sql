DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'admin_actions'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%action%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE admin_actions DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE admin_actions
  ADD CONSTRAINT admin_actions_action_check
  CHECK (action IN ('remove', 'warn', 'patrol', 'grant', 'mute', 'unmute', 'entitle', 'level'));
