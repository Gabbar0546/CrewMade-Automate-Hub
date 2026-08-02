import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

function normalizeSchemaRow(row: Record<string, unknown>) {
  return {
    ...row,
    fields: Array.isArray(row.fields) ? row.fields : [],
    schema: row.schema || {},
  };
}

export async function GET() {
  try {
    const user = await requireUser();
    if (user.role === "admin") {
      const result = await query(
        `SELECT ws.*, NULL::text AS target_workflow_id, 'admin_n8n'::text AS execution_mode
         FROM workflow_schemas ws
         WHERE ws.is_active = TRUE
         ORDER BY ws.name ASC`,
      );
      return Response.json({ schemas: result.rows.map(normalizeSchemaRow) });
    }

    const result = await query(
      `SELECT uws.*, 'user_n8n'::text AS execution_mode
       FROM user_workflow_schemas uws
       WHERE uws.user_id = $1 AND uws.is_active = TRUE
       UNION ALL
       SELECT
        ws.id,
        uita.user_id,
        ws.source_workflow_id,
        NULL::text AS target_workflow_id,
        NULL::integer AS target_instance_id,
        ws.name,
        ws.action,
        ws.webhook_url,
        ws.schema,
        ws.fields,
        ws.source_payload,
        ws.is_active,
        uita.created_at,
        uita.updated_at,
        'admin_n8n'::text AS execution_mode
       FROM user_internal_tool_access uita
       JOIN workflow_schemas ws ON ws.source_workflow_id = uita.source_workflow_id
       LEFT JOIN user_workflow_schemas uws ON uws.user_id = uita.user_id
        AND uws.source_workflow_id = uita.source_workflow_id
        AND uws.is_active = TRUE
       WHERE uita.user_id = $1
        AND uita.is_active = TRUE
        AND ws.is_active = TRUE
        AND uws.id IS NULL
       ORDER BY name ASC`,
      [user.id],
    );
    const missing = await query(
      `SELECT utw.source_workflow_id, utw.target_workflow_id, utw.target_base_url, utw.created_at
       FROM user_transferred_workflows utw
       LEFT JOIN user_workflow_schemas uws ON uws.source_workflow_id = utw.source_workflow_id AND uws.user_id = utw.user_id AND uws.is_active = TRUE
       WHERE utw.user_id = $1 AND uws.id IS NULL
       ORDER BY utw.created_at DESC`,
      [user.id],
    );
    return Response.json({ schemas: result.rows.map(normalizeSchemaRow), missingSchemas: missing.rows });
  } catch (error) {
    return jsonError(error);
  }
}
