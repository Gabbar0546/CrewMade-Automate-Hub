import { z } from "zod";
import { query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

const PricingSchema = z.object({
  sourceWorkflowId: z.string().min(1),
  runCost: z.number().int().min(0),
  transferCost: z.number().int().min(0),
  isVisibleToUsers: z.boolean(),
});

export async function GET() {
  try {
    await requireAdmin();
    await query(
      `INSERT INTO workflow_pricing (source_workflow_id)
       SELECT source_workflow_id FROM workflow_schemas
       ON CONFLICT (source_workflow_id) DO NOTHING`,
    );
    const result = await query(
      `SELECT ws.source_workflow_id, ws.name, ws.action, jsonb_array_length(ws.fields) AS field_count,
        COALESCE(wp.run_cost, 2)::int AS run_cost,
        COALESCE(wp.transfer_cost, 5)::int AS transfer_cost,
        COALESCE(wp.is_visible_to_users, TRUE) AS is_visible_to_users
       FROM workflow_schemas ws
       LEFT JOIN workflow_pricing wp ON wp.source_workflow_id = ws.source_workflow_id
       WHERE ws.is_active = TRUE
       ORDER BY ws.name ASC`,
    );
    return Response.json({ workflows: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = PricingSchema.parse(await request.json());
    const result = await query(
      `INSERT INTO workflow_pricing
        (source_workflow_id, run_cost, transfer_cost, is_visible_to_users, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (source_workflow_id)
       DO UPDATE SET
        run_cost = EXCLUDED.run_cost,
        transfer_cost = EXCLUDED.transfer_cost,
        is_visible_to_users = EXCLUDED.is_visible_to_users,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
       RETURNING *`,
      [body.sourceWorkflowId, body.runCost, body.transferCost, body.isVisibleToUsers, admin.id],
    );
    return Response.json({ pricing: result.rows[0] });
  } catch (error) {
    return jsonError(error);
  }
}
