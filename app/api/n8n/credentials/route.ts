import { requireUser, jsonError } from "@/lib/auth";
import { n8nFetch } from "@/lib/n8n";

function sanitizeCredential(item: unknown) {
  const source = typeof item === "object" && item ? item as Record<string, unknown> : {};
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    createdAt: source.createdAt || source.created_at,
    updatedAt: source.updatedAt || source.updated_at,
    scopes: source.scopes,
    projectId: source.projectId,
    homeProject: source.homeProject,
    sharedWithProjects: source.sharedWithProjects,
    isManaged: source.isManaged,
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instanceId");

    const data = await n8nFetch(user, "/api/v1/credentials?limit=250", instanceId) as { data?: unknown[] } | unknown[];
    const credentials = Array.isArray(data)
      ? data.map(sanitizeCredential)
      : Array.isArray(data.data)
        ? data.data.map(sanitizeCredential)
        : [];

    return Response.json({ credentials });
  } catch (error) {
    return jsonError(error);
  }
}
