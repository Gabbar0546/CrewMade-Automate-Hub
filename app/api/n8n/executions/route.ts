import { requireUser, jsonError } from "@/lib/auth";
import { n8nFetch } from "@/lib/n8n";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instanceId");
    const params = new URLSearchParams({ limit: url.searchParams.get("limit") || "50" });
    const status = url.searchParams.get("status");
    const workflowId = url.searchParams.get("workflowId");
    if (status) params.set("status", status);
    if (workflowId) params.set("workflowId", workflowId);

    const data = await n8nFetch(user, `/api/v1/executions?${params.toString()}`, instanceId);
    return Response.json(data);
  } catch (error) {
    return jsonError(error);
  }
}
