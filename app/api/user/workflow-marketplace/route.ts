import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireUser();
    const wallet = await query<{ points_balance: number }>(
      `INSERT INTO user_wallets (user_id, points_balance)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING points_balance`,
      [user.id, user.role === "user" ? 10 : 0],
    );
    const existingWallet = wallet.rows[0] || (await query<{ points_balance: number }>("SELECT points_balance FROM user_wallets WHERE user_id = $1", [user.id])).rows[0];
    const workflows = await query(
      `SELECT ws.source_workflow_id, ws.name, ws.action, ws.webhook_url, ws.fields, ws.source_payload,
        COALESCE(wp.run_cost, 2)::int AS run_cost,
        COALESCE(wp.transfer_cost, 5)::int AS transfer_cost,
        COALESCE(wp.is_visible_to_users, TRUE) AS is_visible_to_users,
        utw.target_workflow_id,
        utw.target_base_url,
        EXISTS (
          SELECT 1 FROM n8n_instances ni WHERE ni.owner_user_id = $1
        ) AS has_user_n8n
       FROM workflow_schemas ws
       LEFT JOIN workflow_pricing wp ON wp.source_workflow_id = ws.source_workflow_id
       LEFT JOIN user_transferred_workflows utw ON utw.user_id = $1
        AND utw.source_workflow_id = ws.source_workflow_id
        AND utw.status = 'transferred'
       WHERE ws.is_active = TRUE
        AND COALESCE(wp.is_visible_to_users, TRUE) = TRUE
       ORDER BY ws.name ASC`,
      [user.id],
    );
    const transactions = await query(
      `SELECT pt.*, ws.name AS workflow_name
       FROM point_transactions pt
       LEFT JOIN workflow_schemas ws ON ws.source_workflow_id = pt.workflow_id
       WHERE pt.user_id = $1
       ORDER BY pt.created_at DESC
       LIMIT 20`,
      [user.id],
    );
    return Response.json({
      balance: existingWallet?.points_balance ?? 0,
      workflows: workflows.rows,
      transactions: transactions.rows,
    });
  } catch (error) {
    return jsonError(error);
  }
}
