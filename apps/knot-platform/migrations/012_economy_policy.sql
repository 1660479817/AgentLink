CREATE TABLE price_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  default_price INT NOT NULL,
  price_min INT NOT NULL,
  price_max INT NOT NULL,
  publish_service_fee_per_mb INT NOT NULL,
  download_service_fee_per_mb INT NOT NULL,
  service_fee_cap INT NOT NULL,
  point_usd_cents INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  CHECK (price_min >= 0 AND price_min <= 100000),
  CHECK (price_max >= price_min AND price_max <= 100000),
  CHECK (default_price >= price_min AND default_price <= price_max),
  CHECK (publish_service_fee_per_mb >= 0 AND publish_service_fee_per_mb <= 1000),
  CHECK (download_service_fee_per_mb >= 0 AND download_service_fee_per_mb <= 1000),
  CHECK (service_fee_cap >= 0 AND service_fee_cap <= 100000),
  CHECK (point_usd_cents >= 0 AND point_usd_cents <= 100000)
);

CREATE UNIQUE INDEX price_proposals_one_pending_idx
  ON price_proposals ((true))
  WHERE status = 'pending';

CREATE TABLE economy_policy (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_price INT NOT NULL,
  price_min INT NOT NULL,
  price_max INT NOT NULL,
  publish_service_fee_per_mb INT NOT NULL,
  download_service_fee_per_mb INT NOT NULL,
  service_fee_cap INT NOT NULL,
  point_usd_cents INT NOT NULL,
  proposal_id UUID NOT NULL REFERENCES price_proposals (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (price_min >= 0 AND price_min <= 100000),
  CHECK (price_max >= price_min AND price_max <= 100000),
  CHECK (default_price >= price_min AND default_price <= price_max),
  CHECK (publish_service_fee_per_mb >= 0 AND publish_service_fee_per_mb <= 1000),
  CHECK (download_service_fee_per_mb >= 0 AND download_service_fee_per_mb <= 1000),
  CHECK (service_fee_cap >= 0 AND service_fee_cap <= 100000),
  CHECK (point_usd_cents >= 0 AND point_usd_cents <= 100000)
);
