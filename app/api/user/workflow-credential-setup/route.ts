import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { n8nFetch } from "@/lib/n8n";

type CredentialMeta = {
  id?: string | number;
  name?: string;
  type?: string;
};

function sanitizeCredential(item: unknown): CredentialMeta {
  const source = typeof item === "object" && item ? item as Record<string, unknown> : {};
  return {
    id: source.id as string | number | undefined,
    name: source.name as string | undefined,
    type: source.type as string | undefined,
  };
}

function credentialRequirements(workflow: unknown) {
  const source = typeof workflow === "object" && workflow ? workflow as { nodes?: unknown[] } : {};
  const requirements = new Map<string, { type: string; currentId: string; currentName: string; nodes: string[] }>();
  for (const node of source.nodes || []) {
    const record = typeof node === "object" && node ? node as Record<string, unknown> : {};
    const credentials = typeof record.credentials === "object" && record.credentials ? record.credentials as Record<string, unknown> : {};
    for (const [type, value] of Object.entries(credentials)) {
      const credential = typeof value === "object" && value ? value as Record<string, unknown> : {};
      const existing = requirements.get(type) || { type, currentId: "", currentName: "", nodes: [] };
      existing.currentId ||= String(credential.id || "");
      existing.currentName ||= String(credential.name || "");
      existing.nodes.push(String(record.name || "Unnamed node"));
      requirements.set(type, existing);
    }
  }
  return Array.from(requirements.values());
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instanceId");
    const params: unknown[] = [user.id];
    const instanceSql = instanceId ? "AND utw.target_instance_id = $2" : "";
    if (instanceId) params.push(Number(instanceId));

    const transfers = await query<{
      id: number;
      source_workflow_id: string;
      target_workflow_id: string;
      target_instance_id: number;
      target_base_url: string;
      transfer_response: Record<string, unknown>;
      workflow_name: string;
    }>(
      `SELECT utw.id, utw.source_workflow_id, utw.target_workflow_id, utw.target_instance_id,
        utw.target_base_url, utw.transfer_response, COALESCE(uws.name, ws.name, utw.source_workflow_id) AS workflow_name
       FROM user_transferred_workflows utw
       LEFT JOIN user_workflow_schemas uws ON uws.user_id = utw.user_id AND uws.source_workflow_id = utw.source_workflow_id
       LEFT JOIN workflow_schemas ws ON ws.source_workflow_id = utw.source_workflow_id
       WHERE utw.user_id = $1 ${instanceSql}
       ORDER BY utw.created_at DESC`,
      params,
    );

    const credentialsData = instanceId
      ? await n8nFetch(user, "/api/v1/credentials?limit=250", instanceId) as { data?: unknown[] } | unknown[]
      : { data: [] };
    const credentials = Array.isArray(credentialsData)
      ? credentialsData.map(sanitizeCredential)
      : Array.isArray(credentialsData.data)
        ? credentialsData.data.map(sanitizeCredential)
        : [];

    const workflows = [];
    for (const transfer of transfers.rows) {
      try {
        const workflow = await n8nFetch(user, `/api/v1/workflows/${encodeURIComponent(transfer.target_workflow_id)}`, transfer.target_instance_id);
        workflows.push({
          ...transfer,
          activation_error: String(transfer.transfer_response?.activation_error || ""),
          requirements: credentialRequirements(workflow),
        });
      } catch (error) {
        workflows.push({
          ...transfer,
          activation_error: error instanceof Error ? error.message : "Could not read transferred workflow",
          requirements: [],
        });
      }
    }

    return Response.json({ credentials, workflows });
  } catch (error) {
    return jsonError(error);
  }
}
