CREATE TABLE IF NOT EXISTS user_wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  points_balance INTEGER NOT NULL DEFAULT 10 CHECK (points_balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO user_wallets (user_id, points_balance)
SELECT id, CASE WHEN role = 'user' THEN 10 ELSE 0 END
FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS workflow_pricing (
  source_workflow_id TEXT PRIMARY KEY REFERENCES workflow_schemas(source_workflow_id) ON DELETE CASCADE,
  run_cost INTEGER NOT NULL DEFAULT 2 CHECK (run_cost >= 0),
  transfer_cost INTEGER NOT NULL DEFAULT 5 CHECK (transfer_cost >= 0),
  is_visible_to_users BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO workflow_pricing (source_workflow_id)
SELECT source_workflow_id
FROM workflow_schemas
ON CONFLICT (source_workflow_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS point_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id TEXT REFERENCES workflow_schemas(source_workflow_id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('signup_bonus', 'admin_adjustment', 'run_internal', 'transfer_to_n8n')),
  points_delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'refunded')),
  message TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_transactions_user_created ON point_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_transactions_workflow ON point_transactions(workflow_id, created_at DESC);
