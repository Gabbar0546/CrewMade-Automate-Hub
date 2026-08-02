import { requireUser, jsonError } from "@/lib/auth";
import { n8nFetch } from "@/lib/n8n";

function isArchivedWorkflow(workflow: unknown) {
  if (!workflow || typeof workflow !== "object") return false;
  const item = workflow as Record<string, unknown>;
  if (item.isArchived === true || item.archived === true) return true;
  if (String(item.status || "").toLowerCase() === "archived") return true;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return tags.some((tag) => {
    if (!tag || typeof tag !== "object") return false;
    return String((tag as { name?: unknown }).name || "").toLowerCase() === "archived";
  });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instanceId");
    const name = url.searchParams.get("name");
    const active = url.searchParams.get("active");
    const includeArchived = url.searchParams.get("includeArchived") === "true";

    const params = new URLSearchParams({ limit: "250" });
    if (name) params.set("name", name);
    if (active) params.set("active", active);

    const data = await n8nFetch(user, `/api/v1/workflows?${params.toString()}`, instanceId) as { data?: unknown[] } | unknown[];
    if (!includeArchived) {
      if (Array.isArray(data)) {
        return Response.json({ data: data.filter((workflow) => !isArchivedWorkflow(workflow)) });
      }
      if (Array.isArray(data.data)) {
        return Response.json({ ...data, data: data.data.filter((workflow) => !isArchivedWorkflow(workflow)) });
      }
    }
    return Response.json(data);
  } catch (error) {
    return jsonError(error);
  }
}
