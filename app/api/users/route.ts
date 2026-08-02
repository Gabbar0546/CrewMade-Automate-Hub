import { query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export async function GET() {
  try {
    await requireAdmin();
    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
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
       GROUP BY u.id
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
  password: z.string().min(8).optional(),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = UserCreateSchema.parse(await request.json());
    const password = body.password || crypto.randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, LOWER($2), $3, $4)
       RETURNING id, name, email, role, is_active, created_at`,
      [body.name.trim(), body.email, passwordHash, body.role],
    );
    return Response.json({ user: result.rows[0] }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("duplicate key")
      ? Object.assign(new Error("A user with this email already exists"), { status: 409 })
      : error;
    return jsonError(message);
  }
}
