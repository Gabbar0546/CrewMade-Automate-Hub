import { query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);

    const [audit, attempts] = await Promise.all([
      query(
        `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
          u.name AS user_name, u.email AS user_email
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC
         LIMIT $1`,
        [limit],
      ),
      query(
        `SELECT woa.id, woa.operation, woa.status, woa.message, woa.source_workflow_id,
          woa.target_workflow_id, woa.target_instance_id, woa.details, woa.created_at,
          u.name AS user_name, u.email AS user_email
         FROM workflow_operation_attempts woa
         LEFT JOIN users u ON u.id = woa.user_id
         ORDER BY woa.created_at DESC
         LIMIT $1`,
        [limit],
      ),
    ]);

    return Response.json({ audit: audit.rows, attempts: attempts.rows });
  } catch (error) {
    return jsonError(error);
  }
}
