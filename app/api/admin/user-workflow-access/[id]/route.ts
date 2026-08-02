import { query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { getAccessibleInstance } from "@/lib/n8n";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function deleteTargetWorkflow(instanceId: number, workflowId: string) {
  const admin = await requireAdmin();
  const instance = await getAccessibleInstance(admin, instanceId);
  if (!instance) {
    throw Object.assign(new Error("Target n8n instance not found"), { status: 404 });
  }

  const response = await fetch(`${instance.baseUrl}/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: "application/json",
      "X-N8N-API-KEY": instance.apiKey,
    },
  });
  const text = await response.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}

  if (!response.ok && response.status !== 404) {
    const message = typeof data === "object" && data && "message" in data
      ? String((data as { message: unknown }).message)
      : `Target n8n returned ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }

  return { deletedFromN8n: response.ok, n8nResponse: data };
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    const accessId = Number(id);
    if (!Number.isFinite(accessId)) {
      return Response.json({ error: "Invalid workflow access id" }, { status: 400 });
    }

    const access = await query<{
      id: number;
      user_id: number;
      source_workflow_id: string;
      target_workflow_id: string;
      target_instance_id: number | null;
    }>(
      `SELECT id, user_id, source_workflow_id, target_workflow_id, target_instance_id
       FROM user_transferred_workflows
       WHERE id = $1
       LIMIT 1`,
      [accessId],
    );
    const row = access.rows[0];
    if (!row) return Response.json({ error: "Workflow access not found" }, { status: 404 });
    if (!row.target_instance_id) return Response.json({ error: "Workflow access has no target n8n instance" }, { status: 400 });

    const deleteResult = await deleteTargetWorkflow(row.target_instance_id, row.target_workflow_id);
    await query("DELETE FROM user_workflow_schemas WHERE user_id = $1 AND source_workflow_id = $2", [row.user_id, row.source_workflow_id]);
    await query("DELETE FROM user_transferred_workflows WHERE id = $1", [accessId]);
    await query(
      `INSERT INTO workflow_operation_attempts
        (user_id, workflow_access_id, source_workflow_id, target_workflow_id, target_instance_id, operation, status, message, details)
       VALUES ($1, $2, $3, $4, $5, 'delete_transferred_workflow', $6, $7, $8)`,
      [
        row.user_id,
        row.id,
        row.source_workflow_id,
        row.target_workflow_id,
        row.target_instance_id,
        deleteResult.deletedFromN8n ? "success" : "warning",
        deleteResult.deletedFromN8n ? "Deleted transferred workflow from target n8n" : "Target workflow was already missing in n8n",
        JSON.stringify(deleteResult.n8nResponse),
      ],
    );
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'delete_transferred_workflow', 'workflow', $2, $3)`,
      [
        admin.id,
        row.target_workflow_id,
        JSON.stringify({
          workflowAccessId: row.id,
          targetInstanceId: row.target_instance_id,
          deletedFromN8n: deleteResult.deletedFromN8n,
        }),
      ],
    );

    return Response.json({ ok: true, ...deleteResult });
  } catch (error) {
    return jsonError(error);
  }
}
