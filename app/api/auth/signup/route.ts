import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "@/lib/db";
import { setSessionCookie, jsonError } from "@/lib/auth";
import { encryptSecret } from "@/lib/secrets";

const SignupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  n8nBaseUrl: z.string().url().optional().or(z.literal("")),
  n8nApiKey: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = SignupSchema.parse(await request.json());
    const passwordHash = await bcrypt.hash(body.password, 12);

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
      if (body.n8nBaseUrl && body.n8nApiKey) {
        await client.query(
          `INSERT INTO n8n_instances (owner_user_id, name, base_url, api_key_encrypted, is_default)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [user.id, "My n8n", body.n8nBaseUrl.replace(/\/+$/, ""), encryptSecret(body.n8nApiKey)],
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
