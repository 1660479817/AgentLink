ALTER TABLE bounties DROP CONSTRAINT IF EXISTS bounties_hours_check;
ALTER TABLE bounties ADD CONSTRAINT bounties_hours_check CHECK (hours IS NULL OR hours >= 1);

ALTER TABLE demands DROP CONSTRAINT IF EXISTS demands_citation_limit_check;
ALTER TABLE demands ADD CONSTRAINT demands_citation_limit_check CHECK (citation_limit >= 1);
