CREATE TABLE IF NOT EXISTS user_internal_tool_access (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_workflow_id TEXT NOT NULL REFERENCES workflow_schemas(source_workflow_id) ON DELETE CASCADE,
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, source_workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_user_internal_tool_access_user ON user_internal_tool_access(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_user_internal_tool_access_source ON user_internal_tool_access(source_workflow_id, is_active);
