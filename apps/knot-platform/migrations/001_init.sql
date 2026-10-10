CREATE TABLE persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  person_id UUID NOT NULL REFERENCES persons (id),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE delegations (
  person_id UUID PRIMARY KEY REFERENCES persons (id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE expressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES persons (id),
  actor TEXT NOT NULL CHECK (actor IN ('person', 'personal_agent')),
  door TEXT NOT NULL CHECK (door IN ('webui', 'agent_api')),
  role TEXT NOT NULL CHECK (role IN ('demand', 'supply')),
  body TEXT NOT NULL,
  processed TEXT,
  source_result TEXT,
  match_id UUID REFERENCES expressions (id),
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX expressions_door_person_idx ON expressions (door, person_id, created_at DESC);
CREATE INDEX expressions_role_idx ON expressions (role) WHERE match_id IS NULL;
