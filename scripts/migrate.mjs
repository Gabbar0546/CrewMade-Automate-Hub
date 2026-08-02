import pg from "pg";
import bcrypt from "bcryptjs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/crewmade_nexus",
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runVersionedMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, "migrations");
  let files = [];
  try {
    files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  } catch {
    return;
  }

  for (const file of files) {
    const applied = await pool.query("SELECT id FROM schema_migrations WHERE filename = $1", [file]);
    if (applied.rowCount) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await pool.query("COMMIT");
      console.log(`Applied migration ${file}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS n8n_instances (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'production',
      base_url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      workers JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_n8n_instances_owner ON n8n_instances(owner_user_id);

    CREATE TABLE IF NOT EXISTS app_api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS kb_articles (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      tags TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      variables JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS outbound_webhooks (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      events JSONB NOT NULL DEFAULT '[]',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_key TEXT NOT NULL,
      label TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(owner_user_id, template_key)
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'http' CHECK (type IN ('http', 'stdio')),
      url TEXT DEFAULT '',
      command TEXT DEFAULT '',
      args JSONB NOT NULL DEFAULT '[]',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS credential_store (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      instance_id INTEGER REFERENCES n8n_instances(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      shared_data_encrypted TEXT NOT NULL,
      user_fields TEXT[] NOT NULL DEFAULT '{}',
      allowed_roles TEXT[] NOT NULL DEFAULT '{admin,user}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workflow_schemas (
      id SERIAL PRIMARY KEY,
      source_workflow_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      action TEXT DEFAULT '',
      webhook_url TEXT DEFAULT '',
      schema JSONB NOT NULL DEFAULT '{}',
      fields JSONB NOT NULL DEFAULT '[]',
      source_payload JSONB NOT NULL DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_transferred_workflows (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_workflow_id TEXT NOT NULL,
      target_workflow_id TEXT NOT NULL,
      target_instance_id INTEGER REFERENCES n8n_instances(id) ON DELETE SET NULL,
      target_base_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'transferred',
      transfer_response JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, source_workflow_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_transferred_workflows_user ON user_transferred_workflows(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_transferred_workflows_source ON user_transferred_workflows(source_workflow_id);

    CREATE TABLE IF NOT EXISTS user_workflow_schemas (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_workflow_id TEXT NOT NULL,
      target_workflow_id TEXT NOT NULL,
      target_instance_id INTEGER REFERENCES n8n_instances(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      action TEXT DEFAULT '',
      webhook_url TEXT DEFAULT '',
      schema JSONB NOT NULL DEFAULT '{}',
      fields JSONB NOT NULL DEFAULT '[]',
      source_payload JSONB NOT NULL DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, source_workflow_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_workflow_schemas_user ON user_workflow_schemas(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_workflow_schemas_source ON user_workflow_schemas(source_workflow_id);
  `);

  const existing = await pool.query("SELECT id FROM users LIMIT 1");
  if (existing.rowCount === 0) {
    const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@localhost.local";
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";
    const hash = await bcrypt.hash(adminPassword, 12);
    await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')",
      ["Admin", adminEmail, hash],
    );
    console.log(`Seeded admin user: ${adminEmail}`);
  }

  await runVersionedMigrations();

  console.log("Database migration complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
