import { z } from "zod";
import { query, pool } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

const AccessSchema = z.object({
  userId: z.number().int().positive(),
  sourceWorkflowIds: z.array(z.string().min(1)).default([]),
});

export async function GET() {
  try {
    await requireAdmin();
    const schemas = await query(
      `SELECT source_workflow_id, name, action, webhook_url, jsonb_array_length(fields) AS field_count
       FROM workflow_schemas
       WHERE is_active = TRUE
       ORDER BY name ASC`,
    );
    const users = await query(
      `SELECT
        u.id AS user_id,
        u.name AS user_name,
        u.email AS user_email,
        COALESCE(
          json_agg(
            json_build_object(
              'id', uita.id,
              'source_workflow_id', uita.source_workflow_id,
              'name', ws.name,
              'action', ws.action,
              'webhook_url', ws.webhook_url,
              'field_count', jsonb_array_length(ws.fields),
              'created_at', uita.created_at
            )
            ORDER BY ws.name ASC
          ) FILTER (WHERE uita.id IS NOT NULL AND uita.is_active = TRUE),
          '[]'::json
        ) AS tools
       FROM users u
       LEFT JOIN user_internal_tool_access uita ON uita.user_id = u.id AND uita.is_active = TRUE
       LEFT JOIN workflow_schemas ws ON ws.source_workflow_id = uita.source_workflow_id
       WHERE u.role = 'user'
       GROUP BY u.id, u.name, u.email
       ORDER BY u.name ASC`,
    );
    return Response.json({ schemas: schemas.rows, users: users.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    const admin = await requireAdmin();
    const body = AccessSchema.parse(await request.json());

    const user = await client.query("SELECT id FROM users WHERE id = $1 AND role = 'user' AND is_active = TRUE", [body.userId]);
    if (!user.rowCount) return Response.json({ error: "User not found" }, { status: 404 });

    const uniqueIds = Array.from(new Set(body.sourceWorkflowIds));
    if (uniqueIds.length) {
      const existingSchemas = await client.query<{ source_workflow_id: string }>(
        "SELECT source_workflow_id FROM workflow_schemas WHERE source_workflow_id = ANY($1::text[]) AND is_active = TRUE",
        [uniqueIds],
      );
      if (existingSchemas.rowCount !== uniqueIds.length) {
        return Response.json({ error: "One or more workflow schemas are not available" }, { status: 400 });
      }
    }

    await client.query("BEGIN");
    await client.query(
      `UPDATE user_internal_tool_access
       SET is_active = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND NOT (source_workflow_id = ANY($2::text[]))`,
      [body.userId, uniqueIds],
    );
    for (const sourceWorkflowId of uniqueIds) {
      await client.query(
        `INSERT INTO user_internal_tool_access (user_id, source_workflow_id, granted_by, is_active, updated_at)
         VALUES ($1, $2, $3, TRUE, NOW())
         ON CONFLICT (user_id, source_workflow_id)
         DO UPDATE SET is_active = TRUE, granted_by = EXCLUDED.granted_by, updated_at = NOW()`,
        [body.userId, sourceWorkflowId, admin.id],
      );
    }
    await client.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'update_internal_tool_access', 'user', $2, $3)`,
      [admin.id, String(body.userId), JSON.stringify({ sourceWorkflowIds: uniqueIds })],
    );
    await client.query("COMMIT");

    return Response.json({ ok: true, granted: uniqueIds.length });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return jsonError(error);
  } finally {
    client.release();
  }
}
