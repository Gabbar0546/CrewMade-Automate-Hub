import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

const SubmitSchema = z.object({
  sourceWorkflowId: z.string().min(1),
  values: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = SubmitSchema.parse(await request.json());
    const params: unknown[] = [body.sourceWorkflowId];
    if (user.role !== "admin") params.push(user.id);

    const result = await query<{ webhook_url: string; action: string; execution_mode?: string }>(
      user.role === "admin"
        ? `SELECT webhook_url, action, 'admin_n8n'::text AS execution_mode
           FROM workflow_schemas ws
           WHERE source_workflow_id = $1
           LIMIT 1`
        : `SELECT webhook_url, action, 'user_n8n'::text AS execution_mode
           FROM user_workflow_schemas
           WHERE source_workflow_id = $1 AND user_id = $2 AND is_active = TRUE
           UNION ALL
           SELECT ws.webhook_url, ws.action, 'admin_n8n'::text AS execution_mode
           FROM user_internal_tool_access uita
           JOIN workflow_schemas ws ON ws.source_workflow_id = uita.source_workflow_id
           LEFT JOIN user_workflow_schemas uws ON uws.user_id = uita.user_id
            AND uws.source_workflow_id = uita.source_workflow_id
            AND uws.is_active = TRUE
           WHERE uita.source_workflow_id = $1
            AND uita.user_id = $2
            AND uita.is_active = TRUE
            AND ws.is_active = TRUE
            AND uws.id IS NULL
           LIMIT 1`,
      params,
    );
    const schema = result.rows[0];
    if (!schema) return Response.json({ error: "Workflow schema not available for this user" }, { status: 404 });
    if (!schema.webhook_url) return Response.json({ error: "Workflow schema has no submit webhook URL" }, { status: 400 });

    const payload = { action: schema.action, executionMode: schema.execution_mode || "user_n8n", submittedBy: user.email, ...body.values };
    const response = await fetch(schema.webhook_url, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let data: unknown = text;
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) {
      return Response.json({ error: typeof data === "string" ? data : `Submit webhook failed (${response.status})` }, { status: 502 });
    }
    return Response.json({ ok: true, response: data });
  } catch (error) {
    return jsonError(error);
  }
}
