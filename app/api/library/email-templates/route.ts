import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

const defaults = {
  welcome: {
    label: "Welcome email",
    subject: "Welcome to Automation Hub",
    body: "<p>Hello {{username}},</p><p>Your Automation Hub workspace is ready.</p>",
  },
  password_reset: {
    label: "Password reset",
    subject: "Reset your Automation Hub password",
    body: "<p>Hello {{username}},</p><p>Use this link to reset your password: {{reset_url}}</p>",
  },
  workflow_transfer: {
    label: "Workflow transfer",
    subject: "A workflow was transferred to your n8n instance",
    body: "<p>Hello {{username}},</p><p>{{workflow_name}} has been copied to your n8n workspace.</p>",
  },
  daily_summary: {
    label: "Daily summary",
    subject: "Automation Hub daily summary",
    body: "<p>Hello {{username}},</p><p>Here is your automation summary for today.</p>",
  },
};

const TemplateSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().default(""),
});

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_key TEXT NOT NULL,
      label TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(owner_user_id, template_key)
    )
  `);
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureTable();
    const where = user.role === "admin" ? "" : "WHERE owner_user_id = $1";
    const params = user.role === "admin" ? [] : [user.id];
    const result = await query(`SELECT * FROM email_templates ${where} ORDER BY updated_at DESC`, params);
    return Response.json({ defaults, templates: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await ensureTable();
    const body = TemplateSchema.parse(await request.json());
    const result = await query(
      `INSERT INTO email_templates (owner_user_id, template_key, label, subject, body)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner_user_id, template_key)
       DO UPDATE SET label = EXCLUDED.label, subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = NOW()
       RETURNING *`,
      [user.id, body.key, body.label, body.subject, body.body],
    );
    return Response.json({ template: result.rows[0] });
  } catch (error) {
    return jsonError(error);
  }
}
