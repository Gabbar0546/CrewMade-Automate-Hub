CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_action ON audit_log(user_id, action);
CREATE INDEX IF NOT EXISTS idx_workflow_schemas_active_name ON workflow_schemas(is_active, name);
CREATE INDEX IF NOT EXISTS idx_user_transferred_workflows_user_created ON user_transferred_workflows(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_transferred_workflows_target ON user_transferred_workflows(target_instance_id, target_workflow_id);
CREATE INDEX IF NOT EXISTS idx_user_workflow_schemas_user_active ON user_workflow_schemas(user_id, is_active, name);

CREATE TABLE IF NOT EXISTS workflow_operation_attempts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  workflow_access_id INTEGER REFERENCES user_transferred_workflows(id) ON DELETE SET NULL,
  source_workflow_id TEXT,
  target_workflow_id TEXT,
  target_instance_id INTEGER REFERENCES n8n_instances(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workflow_operation_attempts_access ON workflow_operation_attempts(workflow_access_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_operation_attempts_user ON workflow_operation_attempts(user_id, created_at DESC);
