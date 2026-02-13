-- Support guest carts alongside authenticated users

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Allow carts without a user_id by using a guest_token
ALTER TABLE carts
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS guest_token UUID;

-- Ensure a cart always has an owner reference (user or guest token)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'carts_owner_not_null'
      AND conrelid = 'carts'::regclass
  ) THEN
    ALTER TABLE carts
      ADD CONSTRAINT carts_owner_not_null
      CHECK (user_id IS NOT NULL OR guest_token IS NOT NULL);
  END IF;
END;
$$;

-- Limit to one open cart per user or guest
CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_user_open
  ON carts(user_id) WHERE status = 'open' AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_carts_guest_open
  ON carts(guest_token) WHERE status = 'open' AND guest_token IS NOT NULL;

-- Fast lookup by guest token
CREATE INDEX IF NOT EXISTS idx_carts_guest_token ON carts(guest_token);
