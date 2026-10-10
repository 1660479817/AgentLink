ALTER TABLE expressions DROP CONSTRAINT expressions_role_check;
ALTER TABLE expressions
  ADD CONSTRAINT expressions_role_check CHECK (role IN ('demand', 'supply', 'intel'));
