import { query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

const SCHEMA_WEBHOOK_URL = "https://n8n.crewmadeautomate.online/webhook/get-tools-schema";

type ToolSchema = {
  id?: string;
  workflow_id?: string;
  workflowId?: string;
  name?: string;
  action?: string;
  webhookUrl?: string;
  webhook_url?: string;
  fields?: unknown[];
};

function getWorkflowId(tool: ToolSchema) {
  return String(tool.workflow_id || tool.workflowId || tool.id || "").trim();
}

function targetWebhookUrl(sourceWebhookUrl: string, targetBaseUrl: string) {
  if (!sourceWebhookUrl) return "";
  try {
    const url = new URL(sourceWebhookUrl);
    return `${targetBaseUrl.replace(/\/+$/, "")}${url.pathname}${url.search}`;
  } catch {
    return sourceWebhookUrl.startsWith("/")
      ? `${targetBaseUrl.replace(/\/+$/, "")}${sourceWebhookUrl}`
      : sourceWebhookUrl;
  }
}

async function backfillUserSchemas(sourceWorkflowId: string) {
  const transfers = await query<{
    user_id: number;
    source_workflow_id: string;
    target_workflow_id: string;
    target_instance_id: number | null;
    target_base_url: string;
  }>(
    `SELECT user_id, source_workflow_id, target_workflow_id, target_instance_id, target_base_url
     FROM user_transferred_workflows
     WHERE source_workflow_id = $1 AND status = 'transferred'`,
    [sourceWorkflowId],
  );
  if (!transfers.rowCount) return 0;

  const schemaResult = await query<{
    name: string;
    action: string;
    webhook_url: string;
    schema: unknown;
    fields: unknown;
    source_payload: unknown;
  }>(
    `SELECT name, action, webhook_url, schema, fields, source_payload
     FROM workflow_schemas
     WHERE source_workflow_id = $1 AND is_active = TRUE
     LIMIT 1`,
    [sourceWorkflowId],
  );
  const schema = schemaResult.rows[0];
  if (!schema) return 0;

  for (const transfer of transfers.rows) {
    await query(
      `INSERT INTO user_workflow_schemas
        (user_id, source_workflow_id, target_workflow_id, target_instance_id, name, action, webhook_url, schema, fields, source_payload, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, NOW())
       ON CONFLICT (user_id, source_workflow_id)
       DO UPDATE SET
        target_workflow_id = EXCLUDED.target_workflow_id,
        target_instance_id = EXCLUDED.target_instance_id,
        name = EXCLUDED.name,
        action = EXCLUDED.action,
        webhook_url = EXCLUDED.webhook_url,
        schema = EXCLUDED.schema,
        fields = EXCLUDED.fields,
        source_payload = EXCLUDED.source_payload,
        is_active = TRUE,
        updated_at = NOW()`,
      [
        transfer.user_id,
        transfer.source_workflow_id,
        transfer.target_workflow_id,
        transfer.target_instance_id,
        schema.name,
        schema.action || "",
        targetWebhookUrl(schema.webhook_url || "", transfer.target_base_url),
        JSON.stringify(schema.schema || {}),
        JSON.stringify(schema.fields || []),
        JSON.stringify(schema.source_payload || {}),
      ],
    );
  }
  return transfers.rowCount;
}

export async function POST() {
  try {
    await requireAdmin();
    const response = await fetch(SCHEMA_WEBHOOK_URL, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json" },
    });
    const text = await response.text();
    let data: unknown = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) {
      return Response.json({ error: `Schema webhook failed (${response.status}): ${text || response.statusText}` }, { status: 502 });
    }

    const tools = Array.isArray((data as { tools?: unknown[] }).tools)
      ? ((data as { tools: ToolSchema[] }).tools)
      : Array.isArray(data)
        ? (data as ToolSchema[])
        : [];

    if (!tools.length) {
      return Response.json({ error: "Schema webhook did not return tools" }, { status: 400 });
    }

    const saved = [];
    let userSchemasSynced = 0;
    for (const tool of tools) {
      const sourceWorkflowId = getWorkflowId(tool);
      if (!sourceWorkflowId) continue;
      const fields = Array.isArray(tool.fields) ? tool.fields : [];
      const result = await query(
        `INSERT INTO workflow_schemas
          (source_workflow_id, name, action, webhook_url, schema, fields, source_payload, synced_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (source_workflow_id)
         DO UPDATE SET
          name = EXCLUDED.name,
          action = EXCLUDED.action,
          webhook_url = EXCLUDED.webhook_url,
          schema = EXCLUDED.schema,
          fields = EXCLUDED.fields,
          source_payload = EXCLUDED.source_payload,
          is_active = TRUE,
          synced_at = NOW(),
          updated_at = NOW()
         RETURNING *`,
        [
          sourceWorkflowId,
          tool.name || sourceWorkflowId,
          tool.action || "",
          tool.webhookUrl || tool.webhook_url || "",
          JSON.stringify(tool),
          JSON.stringify(fields),
          JSON.stringify(tool),
        ],
      );
      saved.push(result.rows[0]);
      userSchemasSynced += await backfillUserSchemas(sourceWorkflowId);
    }

    return Response.json({ synced: saved.length, userSchemasSynced, schemas: saved });
  } catch (error) {
    return jsonError(error);
  }
}
