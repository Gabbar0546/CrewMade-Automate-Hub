import { z } from "zod";
import { query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { getAccessibleInstance } from "@/lib/n8n";

const TRANSFER_WEBHOOK_URL = "https://n8n.crewmadeautomate.online/webhook/transfer-submit-to-user";

const TransferSchema = z.object({
  sourceInstanceId: z.number(),
  workflowId: z.string().min(1),
  targetInstanceId: z.number().optional(),
  targetUserId: z.number().optional(),
  targetUserIds: z.array(z.number()).optional(),
  name: z.string().optional(),
  activate: z.boolean().default(false),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseMessage(data: unknown, fallback: string) {
  if (typeof data === "string" && data) return data;
  if (isRecord(data)) {
    return String(data.message || data.error || data.detail || data.activation_error || fallback);
  }
  return fallback;
}

async function callTransferWebhook(payload: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch(TRANSFER_WEBHOOK_URL, {
      method: "POST",
      signal: AbortSignal.timeout(120000),
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Transfer webhook timed out"
      : `Could not reach transfer webhook: ${error instanceof Error ? error.message : "network error"}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const text = await response.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    if (extractCreatedWorkflowId(data)) {
      return data;
    }
    const message = responseMessage(data, `Transfer webhook returned ${response.status}`);
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}

function extractCreatedWorkflowId(data: unknown): string {
  if (Array.isArray(data)) {
    for (const item of data) {
      const id = extractCreatedWorkflowId(item);
      if (id) return id;
    }
  }
  if (isRecord(data)) {
    for (const key of ["workflow_id", "workflowId", "new_workflow_id", "newWorkflowId", "id"]) {
      const value = data[key];
      if (typeof value === "string" || typeof value === "number") return String(value);
    }
    for (const value of Object.values(data)) {
      const id = extractCreatedWorkflowId(value);
      if (id) return id;
    }
  }
  return "";
}

function activationWarning(data: unknown): string {
  if (Array.isArray(data)) {
    return data.map(activationWarning).find(Boolean) || "";
  }
  if (!isRecord(data)) return "";
  if (data.activated === false) {
    return responseMessage(data, "Workflow transferred but activation failed");
  }
  for (const value of Object.values(data)) {
    const warning = activationWarning(value);
    if (warning) return warning;
  }
  return "";
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

async function ensureUserWorkflowSchema({
  userId,
  sourceWorkflowId,
  targetWorkflowId,
  targetInstanceId,
  targetBaseUrl,
  fallbackSchema,
}: {
  userId: number;
  sourceWorkflowId: string;
  targetWorkflowId: string;
  targetInstanceId: number;
  targetBaseUrl: string;
  fallbackSchema?: unknown;
}) {
  const source = await query<{
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
  const sourceSchema = source.rows[0];
  const fallback = isRecord(fallbackSchema) ? fallbackSchema : {};
  const fallbackFields = Array.isArray(fallback.fields) ? fallback.fields : [];
  const fallbackWebhookUrl = String(fallback.webhookUrl || fallback.webhook_url || "");
  const schema = sourceSchema || (
    fallbackFields.length || fallbackWebhookUrl
      ? {
          name: String(fallback.name || sourceWorkflowId),
          action: String(fallback.action || ""),
          webhook_url: fallbackWebhookUrl,
          schema: fallback,
          fields: fallbackFields,
          source_payload: fallback,
        }
      : null
  );
  if (!schema) return false;

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
      userId,
      sourceWorkflowId,
      targetWorkflowId,
      targetInstanceId,
      schema.name,
      schema.action || "",
      targetWebhookUrl(schema.webhook_url || "", targetBaseUrl),
      JSON.stringify(schema.schema || {}),
      JSON.stringify(schema.fields || []),
      JSON.stringify(schema.source_payload || {}),
    ],
  );
  return true;
}

async function fetchTargetWorkflow(target: { baseUrl: string; apiKey: string }, workflowId: string) {
  const response = await fetch(`${target.baseUrl}/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: "application/json",
      "X-N8N-API-KEY": target.apiKey,
    },
  });
  const text = await response.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) return null;
  return data;
}

function webhookPathFromWorkflow(workflow: unknown) {
  const record = isRecord(workflow) ? workflow : {};
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    if (!String(node.type || "").includes("webhook")) continue;
    const parameters = isRecord(node.parameters) ? node.parameters : {};
    const path = String(parameters.path || "").trim();
    if (path) return path.startsWith("/") ? path : `/webhook/${path}`;
  }
  return "";
}

async function ensureMinimalUserWorkflowSchema({
  userId,
  sourceWorkflowId,
  targetWorkflowId,
  targetInstanceId,
  targetBaseUrl,
  workflow,
}: {
  userId: number;
  sourceWorkflowId: string;
  targetWorkflowId: string;
  targetInstanceId: number;
  targetBaseUrl: string;
  workflow: unknown;
}) {
  const path = webhookPathFromWorkflow(workflow);
  if (!path) return false;
  const name = isRecord(workflow) ? String(workflow.name || sourceWorkflowId) : sourceWorkflowId;
  await query(
    `INSERT INTO user_workflow_schemas
      (user_id, source_workflow_id, target_workflow_id, target_instance_id, name, action, webhook_url, schema, fields, source_payload, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, '', $6, $7, '[]'::jsonb, $7, TRUE, NOW())
     ON CONFLICT (user_id, source_workflow_id)
     DO UPDATE SET
      target_workflow_id = EXCLUDED.target_workflow_id,
      target_instance_id = EXCLUDED.target_instance_id,
      name = EXCLUDED.name,
      webhook_url = EXCLUDED.webhook_url,
      schema = EXCLUDED.schema,
      fields = EXCLUDED.fields,
      source_payload = EXCLUDED.source_payload,
      is_active = TRUE,
      updated_at = NOW()`,
    [
      userId,
      sourceWorkflowId,
      targetWorkflowId,
      targetInstanceId,
      name,
      `${targetBaseUrl.replace(/\/+$/, "")}${path}`,
      JSON.stringify(workflow || {}),
    ],
  );
  return true;
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = TransferSchema.parse(await request.json());

    const targetUserIds = body.targetUserIds?.length ? body.targetUserIds : body.targetUserId ? [body.targetUserId] : [];
    if (targetUserIds.length === 0 && !body.targetInstanceId) {
      return Response.json({ error: "Select at least one target user" }, { status: 400 });
    }

    const targets: Array<{ userId: number; instanceId: number; userName?: string }> = [];
    if (body.targetInstanceId && body.targetUserId) {
      const targetCheck = await query<{ id: number; owner_user_id: number; user_name: string }>(
        `SELECT ni.id, ni.owner_user_id, u.name AS user_name
         FROM n8n_instances ni JOIN users u ON u.id = ni.owner_user_id
         WHERE ni.id = $1 AND ni.owner_user_id = $2`,
        [body.targetInstanceId, body.targetUserId],
      );
      if (targetCheck.rowCount === 0) {
        return Response.json({ error: "Target instance does not belong to selected user" }, { status: 400 });
      }
      targets.push({ userId: body.targetUserId, instanceId: body.targetInstanceId, userName: targetCheck.rows[0].user_name });
    } else {
      const result = await query<{ id: number; owner_user_id: number; user_name: string }>(
        `SELECT DISTINCT ON (ni.owner_user_id) ni.id, ni.owner_user_id, u.name AS user_name
         FROM n8n_instances ni JOIN users u ON u.id = ni.owner_user_id
         WHERE ni.owner_user_id = ANY($1)
         ORDER BY ni.owner_user_id, ni.is_default DESC, ni.created_at DESC`,
        [targetUserIds],
      );
      const found = new Set(result.rows.map((row) => row.owner_user_id));
      const missing = targetUserIds.filter((id) => !found.has(id));
      if (missing.length) {
        return Response.json({ error: `Users without n8n instance: ${missing.join(", ")}` }, { status: 400 });
      }
      targets.push(...result.rows.map((row) => ({ userId: row.owner_user_id, instanceId: row.id, userName: row.user_name })));
    }

    const results = [];
    for (const targetInfo of targets) {
      try {
        const existing = await query(
          `SELECT id, target_workflow_id FROM user_transferred_workflows
           WHERE user_id = $1 AND source_workflow_id = $2 AND status = 'transferred'
           LIMIT 1`,
          [targetInfo.userId, body.workflowId],
        );
        if (existing.rowCount) {
          const target = await getAccessibleInstance(admin, targetInfo.instanceId);
          if (target) {
            await ensureUserWorkflowSchema({
              userId: targetInfo.userId,
              sourceWorkflowId: body.workflowId,
              targetWorkflowId: existing.rows[0].target_workflow_id,
              targetInstanceId: targetInfo.instanceId,
              targetBaseUrl: target.baseUrl,
            });
          }
          results.push({
            userId: targetInfo.userId,
            instanceId: targetInfo.instanceId,
            ok: true,
            skipped: true,
            workflow: { id: existing.rows[0].target_workflow_id },
          });
          await query(
            `INSERT INTO workflow_operation_attempts
              (user_id, workflow_access_id, source_workflow_id, target_workflow_id, target_instance_id, operation, status, message, details)
             VALUES ($1, $2, $3, $4, $5, 'transfer', 'skipped', 'Workflow already transferred', $6)`,
            [
              targetInfo.userId,
              existing.rows[0].id,
              body.workflowId,
              existing.rows[0].target_workflow_id,
              targetInfo.instanceId,
              JSON.stringify({ skipped: true }),
            ],
          );
          continue;
        }

        const target = await getAccessibleInstance(admin, targetInfo.instanceId);
        if (!target) throw Object.assign(new Error("Target n8n instance not found"), { status: 404 });
        const webhookResponse = await callTransferWebhook({
          "target-url": target.baseUrl,
          "target-api-key": target.apiKey,
          "user-name": targetInfo.userName || "",
          "workflow_id": body.workflowId,
          activate: body.activate,
        });
        const newWorkflowId = extractCreatedWorkflowId(webhookResponse);
        if (!newWorkflowId) {
          throw Object.assign(new Error(responseMessage(webhookResponse, "Transfer webhook did not return new workflow id")), { status: 502 });
        }
        const warning = activationWarning(webhookResponse);

        const transferRow = await query<{ id: number }>(
          `INSERT INTO user_transferred_workflows
            (user_id, source_workflow_id, target_workflow_id, target_instance_id, target_base_url, status, transfer_response)
           VALUES ($1, $2, $3, $4, $5, 'transferred', $6)
           ON CONFLICT (user_id, source_workflow_id)
           DO UPDATE SET
            target_workflow_id = EXCLUDED.target_workflow_id,
            target_instance_id = EXCLUDED.target_instance_id,
            target_base_url = EXCLUDED.target_base_url,
            status = 'transferred',
            transfer_response = EXCLUDED.transfer_response,
            updated_at = NOW()
           RETURNING id`,
          [
            targetInfo.userId,
            body.workflowId,
            newWorkflowId,
            targetInfo.instanceId,
            target.baseUrl,
            JSON.stringify(webhookResponse),
          ],
        );
        const workflowAccessId = transferRow.rows[0]?.id;

        let schemaCopied = await ensureUserWorkflowSchema({
          userId: targetInfo.userId,
          sourceWorkflowId: body.workflowId,
          targetWorkflowId: newWorkflowId,
          targetInstanceId: targetInfo.instanceId,
          targetBaseUrl: target.baseUrl,
          fallbackSchema: webhookResponse,
        });
        if (!schemaCopied) {
          const targetWorkflow = await fetchTargetWorkflow(target, newWorkflowId);
          schemaCopied = await ensureMinimalUserWorkflowSchema({
            userId: targetInfo.userId,
            sourceWorkflowId: body.workflowId,
            targetWorkflowId: newWorkflowId,
            targetInstanceId: targetInfo.instanceId,
            targetBaseUrl: target.baseUrl,
            workflow: targetWorkflow,
          });
        }

        await query(
          `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
           VALUES ($1, 'transfer_workflow', 'workflow', $2, $3)`,
          [
            admin.id,
            newWorkflowId,
            JSON.stringify({
              sourceInstanceId: body.sourceInstanceId,
              targetInstanceId: targetInfo.instanceId,
              targetUserId: targetInfo.userId,
              sourceWorkflowId: body.workflowId,
              transferWebhook: TRANSFER_WEBHOOK_URL,
              userWorkflowSchemaCreated: schemaCopied,
            }),
          ],
        );
        await query(
          `INSERT INTO workflow_operation_attempts
            (user_id, workflow_access_id, source_workflow_id, target_workflow_id, target_instance_id, operation, status, message, details)
           VALUES ($1, $2, $3, $4, $5, 'transfer', $6, $7, $8)`,
          [
            targetInfo.userId,
            workflowAccessId || null,
            body.workflowId,
            newWorkflowId,
            targetInfo.instanceId,
            warning ? "warning" : "success",
            warning || responseMessage(webhookResponse, "Workflow transferred"),
            JSON.stringify({ webhookResponse, schemaCopied }),
          ],
        );
        results.push({
          userId: targetInfo.userId,
          instanceId: targetInfo.instanceId,
          ok: true,
          warning,
          schemaCopied,
          activated: warning ? false : undefined,
          workflow: { id: newWorkflowId },
        });
      } catch (error) {
        await query(
          `INSERT INTO workflow_operation_attempts
            (user_id, source_workflow_id, target_instance_id, operation, status, message, details)
           VALUES ($1, $2, $3, 'transfer', 'error', $4, $5)`,
          [
            targetInfo.userId,
            body.workflowId,
            targetInfo.instanceId,
            error instanceof Error ? error.message : "Transfer failed",
            JSON.stringify({ error: error instanceof Error ? error.message : error }),
          ],
        );
        results.push({
          userId: targetInfo.userId,
          instanceId: targetInfo.instanceId,
          ok: false,
          error: error instanceof Error ? error.message : "Transfer failed",
        });
      }
    }

    const transferred = results.filter((result) => result.ok).length;
    const failed = results.filter((result) => !result.ok).length;
    const skipped = results.filter((result) => result.skipped).length;
    const firstError = results.find((result) => !result.ok)?.error;

    return Response.json({
      error: failed && !transferred ? firstError || "Workflow transfer failed" : undefined,
      results,
      transferred,
      failed,
      skipped,
    }, { status: failed ? (transferred ? 207 : 502) : 201 });
  } catch (error) {
    return jsonError(error);
  }
}
