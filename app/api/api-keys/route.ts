import crypto from "crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

const ApiKeySchema = z.object({
  name: z.string().min(1),
  expiresAt: z.string().datetime().optional().nullable(),
});

function hashKey(key: string) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function GET() {
  try {
    const user = await requireUser();
    const where = user.role === "admin" ? "" : "WHERE user_id = $1";
    const params = user.role === "admin" ? [] : [user.id];
    const result = await query(
      `SELECT id, user_id, name, key_prefix, last_used_at, expires_at, created_at
       FROM app_api_keys ${where}
       ORDER BY created_at DESC LIMIT 100`,
      params,
    );
    return Response.json({ keys: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = ApiKeySchema.parse(await request.json());
    const key = `nexus_${crypto.randomBytes(24).toString("base64url")}`;
    const result = await query(
      `INSERT INTO app_api_keys (user_id, name, key_prefix, key_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, name, key_prefix, last_used_at, expires_at, created_at`,
      [user.id, body.name, key.slice(0, 12), hashKey(key), body.expiresAt || null],
    );
    return Response.json({ key, record: result.rows[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
