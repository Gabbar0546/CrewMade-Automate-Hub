import { z } from "zod";
import { pool, query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-guards";
import { safeJson } from "@/lib/redact";

const SettingsSchema = z.object({
  action: z.literal("settings"),
  paymentName: z.string().trim().min(1).max(80),
  qrImageUrl: z.string().trim().max(1000).optional().default(""),
  amountPerPoint: z.number().min(0).max(100000),
  currency: z.string().trim().min(1).max(12).default("INR"),
  instructions: z.string().trim().max(500).optional().default(""),
});

const ReviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  requestId: z.number().int().positive(),
  adminNote: z.string().trim().max(500).optional().default(""),
});

export async function GET() {
  try {
    await requireAdmin();
    const settings = await query(
      `SELECT payment_name, qr_image_url, amount_per_point::float AS amount_per_point, currency, instructions, updated_at
       FROM wallet_payment_settings
       WHERE id = 1`,
    );
    const requests = await query(
      `SELECT wtr.id, wtr.user_id, u.name AS user_name, u.email AS user_email,
        wtr.requested_points, wtr.amount::float AS amount, wtr.currency, wtr.payment_reference,
        wtr.status, wtr.admin_note, wtr.reviewed_at, reviewer.name AS reviewed_by_name, wtr.created_at
       FROM wallet_topup_requests wtr
       JOIN users u ON u.id = wtr.user_id
       LEFT JOIN users reviewer ON reviewer.id = wtr.reviewed_by
       ORDER BY CASE WHEN wtr.status = 'pending' THEN 0 ELSE 1 END, wtr.created_at DESC
       LIMIT 100`,
    );
    return Response.json({
      settings: settings.rows[0] || {
        payment_name: "Payment",
        qr_image_url: "",
        amount_per_point: 1,
        currency: "INR",
        instructions: "Scan the QR and submit your payment reference number.",
      },
      requests: requests.rows,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(request, { key: "admin-wallet", limit: 40, windowMs: 60_000 });
    const admin = await requireAdmin();
    const raw = await request.json();
    if (raw?.action === "settings") {
      const body = SettingsSchema.parse(raw);
      const result = await query(
        `INSERT INTO wallet_payment_settings
          (id, payment_name, qr_image_url, amount_per_point, currency, instructions, updated_by, updated_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id)
         DO UPDATE SET payment_name = EXCLUDED.payment_name,
          qr_image_url = EXCLUDED.qr_image_url,
          amount_per_point = EXCLUDED.amount_per_point,
          currency = EXCLUDED.currency,
          instructions = EXCLUDED.instructions,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
         RETURNING payment_name, qr_image_url, amount_per_point::float AS amount_per_point, currency, instructions, updated_at`,
        [body.paymentName, body.qrImageUrl, body.amountPerPoint, body.currency, body.instructions, admin.id],
      );
      return Response.json({ settings: result.rows[0] });
    }

    const body = ReviewSchema.parse(raw);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const requestResult = await client.query<{
        id: number;
        user_id: number;
        requested_points: number;
        amount: number;
        currency: string;
        payment_reference: string;
        status: string;
      }>(
        `SELECT id, user_id, requested_points, amount, currency, payment_reference, status
         FROM wallet_topup_requests
         WHERE id = $1
         FOR UPDATE`,
        [body.requestId],
      );
      const topup = requestResult.rows[0];
      if (!topup) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Top-up request not found" }, { status: 404 });
      }
      if (topup.status !== "pending") {
        await client.query("ROLLBACK");
        return Response.json({ error: "Top-up request already reviewed" }, { status: 400 });
      }

      let balance: number | null = null;
      if (body.action === "approve") {
        await client.query(
          `INSERT INTO user_wallets (user_id, points_balance)
           VALUES ($1, 0)
           ON CONFLICT (user_id) DO NOTHING`,
          [topup.user_id],
        );
        const wallet = await client.query<{ points_balance: number }>(
          `UPDATE user_wallets
           SET points_balance = points_balance + $2, updated_at = NOW()
           WHERE user_id = $1
           RETURNING points_balance`,
          [topup.user_id, topup.requested_points],
        );
        balance = wallet.rows[0]?.points_balance ?? 0;
        await client.query(
          `INSERT INTO point_transactions
            (user_id, action_type, points_delta, balance_after, message, details)
           VALUES ($1, 'wallet_topup', $2, $3, $4, $5)`,
          [
            topup.user_id,
            topup.requested_points,
            balance,
            "Wallet top-up approved",
            safeJson({
              adminId: admin.id,
              topupRequestId: topup.id,
              paymentReference: topup.payment_reference,
              amount: topup.amount,
              currency: topup.currency,
            }),
          ],
        );
      }

      await client.query(
        `UPDATE wallet_topup_requests
         SET status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [body.requestId, body.action === "approve" ? "approved" : "rejected", body.adminNote, admin.id],
      );
      await client.query("COMMIT");
      return Response.json({ ok: true, status: body.action === "approve" ? "approved" : "rejected", balance });
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
