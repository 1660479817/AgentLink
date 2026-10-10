CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES persons (id),
  expression_id UUID NOT NULL REFERENCES expressions (id),
  door TEXT NOT NULL CHECK (door IN ('webui', 'agent_api')),
  direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX messages_inbox_idx ON messages (person_id, door, created_at DESC);

INSERT INTO messages (person_id, expression_id, door, direction, body, read_at, created_at)
SELECT person_id, id, door, 'out', body, created_at, created_at FROM expressions;

INSERT INTO messages (person_id, expression_id, door, direction, body, created_at)
SELECT person_id, id, door, 'in', feedback, created_at
FROM expressions
WHERE feedback IS NOT NULL;
