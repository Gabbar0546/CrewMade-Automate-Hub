import { query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-guards";

export async function GET() {
  try {
    await requireAdmin();
    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
        COALESCE(uw.points_balance, 0)::int AS points_balance,
        COUNT(ni.id)::int AS n8n_instances,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', ni.id,
              'name', ni.name,
              'environment', ni.environment,
              'base_url', ni.base_url,
              'is_default', ni.is_default,
              'api_key_status', CASE WHEN ni.api_key_encrypted IS NULL THEN 'Empty' ELSE 'Encrypted' END,
              'created_at', ni.created_at
            )
            ORDER BY ni.is_default DESC, ni.created_at DESC
          ) FILTER (WHERE ni.id IS NOT NULL),
          '[]'::json
        ) AS n8n_credentials
       FROM users u
       LEFT JOIN n8n_instances ni ON ni.owner_user_id = u.id
       LEFT JOIN user_wallets uw ON uw.user_id = u.id
       GROUP BY u.id
       , uw.points_balance
       ORDER BY u.created_at DESC`,
    );
    return Response.json({ users: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

const UserCreateSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(["admin", "user"]).default("user"),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(request, { key: "admin-user-create", limit: 20, windowMs: 60_000 });
    const admin = await requireAdmin();
    const body = UserCreateSchema.parse(await request.json());
    const passwordHash = await bcrypt.hash(body.password, 12);
    const client = await (await import("@/lib/db")).pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, LOWER($2), $3, $4)
         RETURNING id, name, email, role, is_active, created_at`,
        [body.name.trim(), body.email, passwordHash, body.role],
      );
      const user = result.rows[0];
      const startingPoints = user.role === "user" ? 10 : 0;
      await client.query(
        `INSERT INTO user_wallets (user_id, points_balance)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id, startingPoints],
      );
      if (startingPoints > 0) {
        await client.query(
          `INSERT INTO point_transactions (user_id, action_type, points_delta, balance_after, message, details)
           VALUES ($1, 'signup_bonus', $2, $2, 'Admin-created user starting points', $3)`,
          [user.id, startingPoints, JSON.stringify({ createdBy: admin.id })],
        );
      }
      await client.query("COMMIT");
      return Response.json({ user: { ...user, points_balance: startingPoints } }, { status: 201 });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error && error.message.includes("duplicate key")
      ? Object.assign(new Error("A user with this email already exists"), { status: 409 })
      : error;
    return jsonError(message);
  }
}
