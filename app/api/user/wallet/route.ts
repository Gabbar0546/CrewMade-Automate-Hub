import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-guards";

const TopupSchema = z.object({
  points: z.number().int().positive().max(100000),
  paymentReference: z.string().trim().min(3).max(160),
});

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
    const settings = await query(
      `SELECT payment_name, qr_image_url, amount_per_point::float AS amount_per_point, currency, instructions
       FROM wallet_payment_settings
       WHERE id = 1`,
    );
    const requests = await query(
      `SELECT id, requested_points, amount::float AS amount, currency, payment_reference, status, admin_note, reviewed_at, created_at
       FROM wallet_topup_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [user.id],
    );
    const transactions = await query(
      `SELECT id, action_type, points_delta, balance_after, status, message, details, created_at
       FROM point_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [user.id],
    );
    return Response.json({
      balance: existingWallet?.points_balance ?? 0,
      settings: settings.rows[0] || {
        payment_name: "Payment",
        qr_image_url: "",
        amount_per_point: 1,
        currency: "INR",
        instructions: "Scan the QR and submit your payment reference number.",
      },
      requests: requests.rows,
      transactions: transactions.rows,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(request, { key: "wallet-topup", limit: 10, windowMs: 60_000 });
    const user = await requireUser();
    const body = TopupSchema.parse(await request.json());
    const settings = await query<{ amount_per_point: number; currency: string }>(
      `SELECT amount_per_point::float AS amount_per_point, currency
       FROM wallet_payment_settings
       WHERE id = 1`,
    );
    const amountPerPoint = Number(settings.rows[0]?.amount_per_point ?? 1);
    const currency = settings.rows[0]?.currency || "INR";
    const amount = Number((body.points * amountPerPoint).toFixed(2));
    const duplicate = await query(
      "SELECT id FROM wallet_topup_requests WHERE LOWER(payment_reference) = LOWER($1) LIMIT 1",
      [body.paymentReference],
    );
    if (duplicate.rowCount) {
      return Response.json({ error: "This payment reference was already submitted" }, { status: 409 });
    }
    const result = await query(
      `INSERT INTO wallet_topup_requests (user_id, requested_points, amount, currency, payment_reference)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, requested_points, amount::float AS amount, currency, payment_reference, status, created_at`,
      [user.id, body.points, amount, currency, body.paymentReference],
    );
    return Response.json({ request: result.rows[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
