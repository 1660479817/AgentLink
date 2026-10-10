CREATE TABLE IF NOT EXISTS intel_classes (
  expression_id UUID PRIMARY KEY REFERENCES expressions (id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  fact TEXT NOT NULL,
  basis TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intel_classes_category_idx ON intel_classes (category);
