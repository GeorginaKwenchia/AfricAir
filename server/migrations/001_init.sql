-- Bookings made through the AfricAir site. `payload` keeps the full booking document
-- (src/lib/types.ts → Booking); the other columns exist for querying and reporting.
CREATE TABLE IF NOT EXISTS bookings (
  reference    char(6)       PRIMARY KEY,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  status       text          NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  origin       char(3)       NOT NULL,
  destination  char(3)       NOT NULL,
  depart_date  date          NOT NULL,
  return_date  date,
  cabin        text          NOT NULL CHECK (cabin IN ('economy', 'premium', 'business', 'first')),
  passengers   integer       NOT NULL CHECK (passengers BETWEEN 1 AND 9),
  last_names   text[]        NOT NULL,
  total_usd    numeric(10,2) NOT NULL,
  currency     char(3)       NOT NULL,
  promo_code   text,
  payload      jsonb         NOT NULL
);

CREATE INDEX IF NOT EXISTS bookings_created_at_idx ON bookings (created_at DESC);
