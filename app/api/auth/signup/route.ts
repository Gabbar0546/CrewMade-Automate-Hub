import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "@/lib/db";
import { setSessionCookie, jsonError } from "@/lib/auth";
import { encryptSecret } from "@/lib/secrets";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-guards";

const SignupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  n8nBaseUrl: z.string().url().optional().or(z.literal("")),
  n8nApiKey: z.string().optional(),
});

async function verifyN8nConnection(baseUrl: string, apiKey: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${normalizedBaseUrl}/api/v1/workflows?limit=1`, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/json", "X-N8N-API-KEY": apiKey },
    });
  } catch (error) {
    throw Object.assign(
      new Error(`Could not verify n8n connection: ${error instanceof Error ? error.message : "network error"}`),
      { status: 400 },
    );
  }
  if (!response.ok) {
    throw Object.assign(new Error(`n8n connection verification failed (${response.status})`), { status: 400 });
  }
  return normalizedBaseUrl;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(request, { key: "auth-signup", limit: 8, windowMs: 60_000 });
    const body = SignupSchema.parse(await request.json());
    const passwordHash = await bcrypt.hash(body.password, 12);
    const normalizedN8nBaseUrl = body.n8nBaseUrl && body.n8nApiKey
      ? await verifyN8nConnection(body.n8nBaseUrl, body.n8nApiKey)
      : "";

    const roleResult = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM users");
    const role = Number(roleResult.rows[0]?.count || 0) === 0 ? "admin" : "user";

    const client = await (await import("@/lib/db")).pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query<{ id: number; name: string; email: string; role: "admin" | "user" }>(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, LOWER($2), $3, $4)
         RETURNING id, name, email, role`,
        [body.name.trim(), body.email, passwordHash, role],
      );

      const user = created.rows[0];
      await client.query(
        `INSERT INTO user_wallets (user_id, points_balance)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id, user.role === "user" ? 10 : 0],
      );
      if (user.role === "user") {
        await client.query(
          `INSERT INTO point_transactions (user_id, action_type, points_delta, balance_after, message)
           VALUES ($1, 'signup_bonus', 10, 10, 'Signup bonus')`,
          [user.id],
        );
      }
      if (normalizedN8nBaseUrl && body.n8nApiKey) {
        await client.query(
          `INSERT INTO n8n_instances (owner_user_id, name, base_url, api_key_encrypted, is_default)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [user.id, "My n8n", normalizedN8nBaseUrl, encryptSecret(body.n8nApiKey)],
        );
      }

      await client.query("COMMIT");
      await setSessionCookie(user);
      return Response.json({ user });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error && error.message.includes("duplicate key")
      ? "An account with this email already exists"
      : error;
    return jsonError(message);
  }
}
