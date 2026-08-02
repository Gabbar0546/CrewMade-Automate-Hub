import { query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export async function GET() {
  try {
    await requireAdmin();
    const result = await query(
      `SELECT
        u.id AS user_id,
        u.name AS user_name,
        u.email AS user_email,
        COUNT(utw.id)::int AS workflow_count,
        COALESCE(
          json_agg(
            json_build_object(
              'id', utw.id,
              'source_workflow_id', utw.source_workflow_id,
              'target_workflow_id', utw.target_workflow_id,
              'target_instance_id', utw.target_instance_id,
              'target_base_url', utw.target_base_url,
              'status', utw.status,
              'created_at', utw.created_at,
              'workflow_name', COALESCE(ws.name, utw.source_workflow_id),
              'activation_warning', COALESCE(utw.transfer_response->>'activation_error', '')
            )
            ORDER BY utw.created_at DESC
          ) FILTER (WHERE utw.id IS NOT NULL),
          '[]'::json
        ) AS workflows
       FROM users u
       LEFT JOIN user_transferred_workflows utw ON utw.user_id = u.id
       LEFT JOIN workflow_schemas ws ON ws.source_workflow_id = utw.source_workflow_id
       WHERE u.role = 'user'
       GROUP BY u.id, u.name, u.email
       ORDER BY u.name ASC`,
    );
    return Response.json({ users: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}
