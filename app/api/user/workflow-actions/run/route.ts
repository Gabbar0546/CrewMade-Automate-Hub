import { z } from "zod";
import { pool, query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-guards";
import { safeJson } from "@/lib/redact";

const RunSchema = z.object({
  sourceWorkflowId: z.string().min(1),
  values: z.record(z.string(), z.unknown()).default({}),
});

function responseMessage(data: unknown, fallback: string) {
  if (typeof data === "string" && data) return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    return String(record.message || record.error || record.detail || fallback);
  }
  return fallback;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(request, { key: "user-workflow-run", limit: 20, windowMs: 60_000 });
    const user = await requireUser();
    const body = RunSchema.parse(await request.json());
    if (user.role !== "user") return Response.json({ error: "Only user accounts spend points for this action" }, { status: 403 });

    const schemaResult = await query<{
      source_workflow_id: string;
      name: string;
      action: string;
      webhook_url: string;
      run_cost: number;
    }>(
      `SELECT ws.source_workflow_id, ws.name, ws.action, ws.webhook_url,
        COALESCE(wp.run_cost, 2)::int AS run_cost
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
    if (!schema.webhook_url) return Response.json({ error: "Workflow has no admin n8n webhook URL" }, { status: 400 });

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
      const currentBalance = locked.rows[0]?.points_balance ?? 0;
      if (currentBalance < schema.run_cost) {
        await client.query("ROLLBACK");
        return Response.json({ error: `Not enough points. Required: ${schema.run_cost}` }, { status: 402 });
      }

      const response = await fetch(schema.webhook_url, {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: schema.action,
          executionMode: "admin_n8n_paid",
          submittedBy: user.email,
          sourceWorkflowId: schema.source_workflow_id,
          ...body.values,
        }),
      });
      const text = await response.text();
      let data: unknown = text;
      try { data = text ? JSON.parse(text) : {}; } catch {}
      if (!response.ok) {
        await client.query("ROLLBACK");
        return Response.json({ error: responseMessage(data, `Workflow run failed (${response.status})`) }, { status: 502 });
      }

      const nextBalance = currentBalance - schema.run_cost;
      await client.query("UPDATE user_wallets SET points_balance = $2, updated_at = NOW() WHERE user_id = $1", [user.id, nextBalance]);
      await client.query(
        `INSERT INTO point_transactions
          (user_id, workflow_id, action_type, points_delta, balance_after, message, details)
         VALUES ($1, $2, 'run_internal', $3, $4, $5, $6)`,
        [
          user.id,
          schema.source_workflow_id,
          -schema.run_cost,
          nextBalance,
          `Ran ${schema.name} on admin n8n`,
          safeJson({ response: data }),
        ],
      );
      await client.query("COMMIT");
      return Response.json({ ok: true, balance: nextBalance, pointsSpent: schema.run_cost, response: data });
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
