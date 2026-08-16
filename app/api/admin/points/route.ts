import { z } from "zod";
import { pool, query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

const AdjustSchema = z.object({
  userId: z.number(),
  points: z.number().int(),
  message: z.string().optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, COALESCE(uw.points_balance, 0)::int AS points_balance
       FROM users u
       LEFT JOIN user_wallets uw ON uw.user_id = u.id
       ORDER BY u.created_at DESC`,
    );
    const transactions = await query(
      `SELECT pt.*, u.name AS user_name, u.email AS user_email, ws.name AS workflow_name
       FROM point_transactions pt
       JOIN users u ON u.id = pt.user_id
       LEFT JOIN workflow_schemas ws ON ws.source_workflow_id = pt.workflow_id
       ORDER BY pt.created_at DESC
       LIMIT 80`,
    );
    return Response.json({ users: result.rows, transactions: transactions.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = AdjustSchema.parse(await request.json());
    if (body.points === 0) return Response.json({ error: "Points adjustment cannot be zero" }, { status: 400 });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO user_wallets (user_id, points_balance)
         VALUES ($1, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [body.userId],
      );
      const wallet = await client.query<{ points_balance: number }>(
        `UPDATE user_wallets
         SET points_balance = GREATEST(0, points_balance + $2), updated_at = NOW()
         WHERE user_id = $1
         RETURNING points_balance`,
        [body.userId, body.points],
      );
      const balance = wallet.rows[0]?.points_balance ?? 0;
      await client.query(
        `INSERT INTO point_transactions
          (user_id, action_type, points_delta, balance_after, message, details)
         VALUES ($1, 'admin_adjustment', $2, $3, $4, $5)`,
        [
          body.userId,
          body.points,
          balance,
          body.message || (body.points > 0 ? "Admin added points" : "Admin removed points"),
          JSON.stringify({ adminId: admin.id }),
        ],
      );
      await client.query("COMMIT");
      return Response.json({ balance });
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
