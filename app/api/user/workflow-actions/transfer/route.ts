import { z } from "zod";
import { pool, query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { getAccessibleInstance } from "@/lib/n8n";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-guards";
import { safeJson } from "@/lib/redact";

const TRANSFER_WEBHOOK_URL = process.env.TRANSFER_WEBHOOK_URL || "https://n8n.crewmadeautomate.online/webhook/transfer-submit-to-user";

const TransferSchema = z.object({
  sourceWorkflowId: z.string().min(1),
  name: z.string().optional(),
  activate: z.boolean().default(false),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseMessage(data: unknown, fallback: string) {
  if (typeof data === "string" && data) return data;
  if (isRecord(data)) return String(data.message || data.error || data.detail || data.activation_error || fallback);
  return fallback;
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
  if (Array.isArray(data)) return data.map(activationWarning).find(Boolean) || "";
  if (!isRecord(data)) return "";
  if (data.activated === false) return responseMessage(data, "Workflow transferred but activation failed");
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

async function callTransferWebhook(payload: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch(TRANSFER_WEBHOOK_URL, {
      method: "POST",
      signal: AbortSignal.timeout(120000),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw Object.assign(new Error(`Could not reach transfer webhook: ${error instanceof Error ? error.message : "network error"}`), { status: 502 });
  }
  const text = await response.text();
  let data: unknown = text;
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok && !extractCreatedWorkflowId(data)) {
    throw Object.assign(new Error(responseMessage(data, `Transfer webhook returned ${response.status}`)), { status: response.status });
  }
  return data;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(request, { key: "user-workflow-transfer", limit: 10, windowMs: 60_000 });
    const user = await requireUser();
    const body = TransferSchema.parse(await request.json());
    if (user.role !== "user") return Response.json({ error: "Only user accounts spend points for this action" }, { status: 403 });

    const existing = await query(
      `SELECT id, target_workflow_id FROM user_transferred_workflows
       WHERE user_id = $1 AND source_workflow_id = $2 AND status = 'transferred'
       LIMIT 1`,
      [user.id, body.sourceWorkflowId],
    );
    if (existing.rowCount) {
      return Response.json({ ok: true, skipped: true, message: "Workflow already transferred", pointsSpent: 0 });
    }

    const schemaResult = await query<{
      source_workflow_id: string;
      name: string;
      action: string;
      webhook_url: string;
      schema: unknown;
      fields: unknown;
      source_payload: unknown;
      transfer_cost: number;
    }>(
      `SELECT ws.source_workflow_id, ws.name, ws.action, ws.webhook_url, ws.schema, ws.fields, ws.source_payload,
        COALESCE(wp.transfer_cost, 5)::int AS transfer_cost
       FROM workflow_schemas ws
       LEFT JOIN workflow_pricing wp ON wp.source_workflow_id = ws.source_workflow_id
       WHERE ws.source_workflow_id = $1
        AND ws.is_active = TRUE
        AND COALESCE(wp.is_visible_to_users, TRUE) = TRUE
       LIMIT 1`,
      [body.sourceWorkflowId],
    );
    const schema = schemaResult.rows[0];
    if (!schema) return Response.json({ error: "Workflow is not available" }, { status: 404 });

    const target = await getAccessibleInstance(user);
    if (!target) return Response.json({ error: "Add your n8n base URL and API key before transfer" }, { status: 400 });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO user_wallets (user_id, points_balance)
         VALUES ($1, 10)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id],
      );
      const locked = await client.query<{ points_balance: number }>(
        "SELECT points_balance FROM user_wallets WHERE user_id = $1 FOR UPDATE",
        [user.id],
      );
      const existingLocked = await client.query(
        `SELECT id, target_workflow_id FROM user_transferred_workflows
         WHERE user_id = $1 AND source_workflow_id = $2 AND status = 'transferred'
         LIMIT 1`,
        [user.id, body.sourceWorkflowId],
      );
      if (existingLocked.rowCount) {
        await client.query("COMMIT");
        return Response.json({ ok: true, skipped: true, message: "Workflow already transferred", pointsSpent: 0 });
      }
      const currentBalance = locked.rows[0]?.points_balance ?? 0;
      if (currentBalance < schema.transfer_cost) {
        await client.query("ROLLBACK");
        return Response.json({ error: `Not enough points. Required: ${schema.transfer_cost}` }, { status: 402 });
      }

      const webhookResponse = await callTransferWebhook({
        "target-url": target.baseUrl,
        "target-api-key": target.apiKey,
        "user-name": user.name,
        "workflow_id": body.sourceWorkflowId,
        name: body.name,
        activate: body.activate,
      });
      const newWorkflowId = extractCreatedWorkflowId(webhookResponse);
      if (!newWorkflowId) {
        await client.query("ROLLBACK");
        return Response.json({ error: responseMessage(webhookResponse, "Transfer webhook did not return new workflow id") }, { status: 502 });
      }
      const warning = activationWarning(webhookResponse);

      const nextBalance = currentBalance - schema.transfer_cost;
      await client.query("UPDATE user_wallets SET points_balance = $2, updated_at = NOW() WHERE user_id = $1", [user.id, nextBalance]);
      const transfer = await client.query<{ id: number }>(
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
        [user.id, schema.source_workflow_id, newWorkflowId, target.id, target.baseUrl, safeJson(webhookResponse)],
      );
      await client.query(
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
          user.id,
          schema.source_workflow_id,
          newWorkflowId,
          target.id,
          body.name?.trim() || schema.name,
          schema.action || "",
          targetWebhookUrl(schema.webhook_url || "", target.baseUrl),
          JSON.stringify(schema.schema || {}),
          JSON.stringify(schema.fields || []),
          JSON.stringify(schema.source_payload || {}),
        ],
      );
      await client.query(
        `INSERT INTO point_transactions
          (user_id, workflow_id, action_type, points_delta, balance_after, message, details)
         VALUES ($1, $2, 'transfer_to_n8n', $3, $4, $5, $6)`,
        [
          user.id,
          schema.source_workflow_id,
          -schema.transfer_cost,
          nextBalance,
          `Transferred ${schema.name} to user n8n`,
          safeJson({ workflowAccessId: transfer.rows[0]?.id, targetWorkflowId: newWorkflowId, webhookResponse }),
        ],
      );
      await client.query(
        `INSERT INTO workflow_operation_attempts
          (user_id, workflow_access_id, source_workflow_id, target_workflow_id, target_instance_id, operation, status, message, details)
         VALUES ($1, $2, $3, $4, $5, 'paid_transfer', $6, $7, $8)`,
        [
          user.id,
          transfer.rows[0]?.id || null,
          schema.source_workflow_id,
          newWorkflowId,
          target.id,
          warning ? "warning" : "success",
          warning || "User transferred workflow with points",
          safeJson({ pointsSpent: schema.transfer_cost, webhookResponse }),
        ],
      );
      await client.query("COMMIT");
      return Response.json({ ok: true, balance: nextBalance, pointsSpent: schema.transfer_cost, warning, workflow: { id: newWorkflowId } }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return jsonError(error);
  }
}
