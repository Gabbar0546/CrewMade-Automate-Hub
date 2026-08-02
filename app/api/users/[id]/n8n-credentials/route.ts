import { z } from "zod";
import { query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const UserCredentialSchema = z.object({
  name: z.string().min(1),
  environment: z.string().default("production"),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  isDefault: z.boolean().default(true),
});

const UserCredentialUpdateSchema = z.object({
  credentialId: z.number(),
  name: z.string().min(1),
  environment: z.string().default("production"),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  isDefault: z.boolean().default(true),
});

async function verifyN8nConnection(baseUrl: string, apiKey: string) {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${cleanBaseUrl}/api/v1/workflows?limit=1`, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "Accept": "application/json",
        "X-N8N-API-KEY": apiKey,
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? `Could not verify n8n connection ${cleanBaseUrl}: request timed out`
      : `Could not verify n8n connection ${cleanBaseUrl}: ${error instanceof Error ? error.message : "network error"}`;
    throw Object.assign(new Error(message), { status: 502 });
  }

  if (!response.ok) {
    const text = await response.text();
    let details = text;
    try {
      const data = text ? JSON.parse(text) : {};
      details = typeof data === "object" && data && "message" in data ? String((data as { message: unknown }).message) : text;
    } catch {}
    throw Object.assign(new Error(`n8n verification failed (${response.status}): ${details || response.statusText}`), { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const userId = Number(id);
    const body = UserCredentialSchema.parse(await request.json());

    const userCheck = await query("SELECT id FROM users WHERE id = $1 AND role = 'user'", [userId]);
    if (userCheck.rowCount === 0) {
      return Response.json({ error: "Target user not found" }, { status: 404 });
    }

    if (body.isDefault) {
      await query("UPDATE n8n_instances SET is_default = FALSE WHERE owner_user_id = $1", [userId]);
    }

    await verifyN8nConnection(body.baseUrl, body.apiKey);

    const result = await query(
      `INSERT INTO n8n_instances (owner_user_id, name, environment, base_url, api_key_encrypted, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, environment, base_url, is_default, created_at`,
      [
        userId,
        body.name.trim(),
        body.environment.trim() || "production",
        body.baseUrl.replace(/\/+$/, ""),
        encryptSecret(body.apiKey),
        body.isDefault,
      ],
    );

    return Response.json({ credential: { ...result.rows[0], api_key_status: "Encrypted" } }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const userId = Number(id);
    const body = UserCredentialUpdateSchema.parse(await request.json());

    const existing = await query<{ api_key_encrypted: string }>(
      "SELECT api_key_encrypted FROM n8n_instances WHERE id = $1 AND owner_user_id = $2",
      [body.credentialId, userId],
    );
    if (existing.rowCount === 0) {
      return Response.json({ error: "n8n credential not found" }, { status: 404 });
    }

    const apiKey = body.apiKey?.trim() ? body.apiKey : decryptSecret(existing.rows[0].api_key_encrypted);
    await verifyN8nConnection(body.baseUrl, apiKey);

    if (body.isDefault) {
      await query("UPDATE n8n_instances SET is_default = FALSE WHERE owner_user_id = $1", [userId]);
    }

    const result = await query(
      `UPDATE n8n_instances
       SET name = $1, environment = $2, base_url = $3, api_key_encrypted = $4, is_default = $5, updated_at = NOW()
       WHERE id = $6 AND owner_user_id = $7
       RETURNING id, name, environment, base_url, is_default, created_at`,
      [
        body.name.trim(),
        body.environment.trim() || "production",
        body.baseUrl.replace(/\/+$/, ""),
        encryptSecret(apiKey),
        body.isDefault,
        body.credentialId,
        userId,
      ],
    );

    return Response.json({ credential: { ...result.rows[0], api_key_status: "Encrypted" } });
  } catch (error) {
    return jsonError(error);
  }
}
