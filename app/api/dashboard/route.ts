import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { n8nFetch } from "@/lib/n8n";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instanceId");
    const ownerFilter = user.role === "admin" ? "" : "WHERE owner_user_id = $1";
    const ownerParams = user.role === "admin" ? [] : [user.id];

    const [instances, kb, prompts, webhooks, mcp] = await Promise.all([
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM n8n_instances ${ownerFilter}`, ownerParams),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM kb_articles ${ownerFilter}`, ownerParams),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM prompts ${ownerFilter}`, ownerParams),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM outbound_webhooks ${ownerFilter}`, ownerParams),
      query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM mcp_servers ${ownerFilter}`, ownerParams),
    ]);

    let n8n = { connected: false, totalWorkflows: 0, activeWorkflows: 0, recentExecutions: 0 };
    try {
      const workflows = (await n8nFetch(user, "/api/v1/workflows?limit=250", instanceId)) as { data?: Array<{ active?: boolean }> };
      const executions = (await n8nFetch(user, "/api/v1/executions?limit=50", instanceId)) as { data?: unknown[] };
      n8n = {
        connected: true,
        totalWorkflows: workflows.data?.length || 0,
        activeWorkflows: workflows.data?.filter((workflow) => workflow.active).length || 0,
        recentExecutions: executions.data?.length || 0,
      };
    } catch {}

    return Response.json({
      counts: {
        instances: Number(instances.rows[0]?.count || 0),
        kb: Number(kb.rows[0]?.count || 0),
        prompts: Number(prompts.rows[0]?.count || 0),
        webhooks: Number(webhooks.rows[0]?.count || 0),
        mcp: Number(mcp.rows[0]?.count || 0),
      },
      n8n,
    });
  } catch (error) {
    return jsonError(error);
  }
}
