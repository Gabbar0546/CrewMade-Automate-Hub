ALTER TABLE point_transactions
  DROP CONSTRAINT IF EXISTS point_transactions_action_type_check;

ALTER TABLE point_transactions
  ADD CONSTRAINT point_transactions_action_type_check
  CHECK (action_type IN ('signup_bonus', 'admin_adjustment', 'run_internal', 'transfer_to_n8n', 'wallet_topup'));

CREATE TABLE IF NOT EXISTS wallet_payment_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payment_name TEXT NOT NULL DEFAULT 'Payment',
  qr_image_url TEXT NOT NULL DEFAULT '',
  amount_per_point NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (amount_per_point >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  instructions TEXT NOT NULL DEFAULT 'Scan the QR and submit your payment reference number.',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO wallet_payment_settings (id, payment_name)
VALUES (1, 'Payment')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS wallet_topup_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_points INTEGER NOT NULL CHECK (requested_points > 0),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT NOT NULL DEFAULT '',
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_topup_requests_user_created ON wallet_topup_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_topup_requests_status_created ON wallet_topup_requests(status, created_at DESC);
