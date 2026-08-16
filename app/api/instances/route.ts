import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { encryptSecret } from "@/lib/secrets";
import { listInstancesForUser } from "@/lib/n8n";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-guards";

const InstanceSchema = z.object({
  name: z.string().min(1),
  environment: z.string().default("production"),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  isDefault: z.boolean().default(false),
});

async function verifyN8nConnection(baseUrl: string, apiKey: string) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/v1/workflows?limit=1`, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json", "X-N8N-API-KEY": apiKey },
    });
  } catch (error) {
    throw Object.assign(new Error(`Could not reach n8n: ${error instanceof Error ? error.message : "network error"}`), { status: 400 });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`n8n verification failed (${response.status})`), { status: 400 });
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ instances: await listInstancesForUser(user) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(request, { key: "n8n-instance-create", limit: 12, windowMs: 60_000 });
    const user = await requireUser();
    const body = InstanceSchema.parse(await request.json());
    await verifyN8nConnection(body.baseUrl, body.apiKey);
    if (body.isDefault) {
      await query("UPDATE n8n_instances SET is_default = FALSE WHERE owner_user_id = $1", [user.id]);
    }
    const result = await query(
      `INSERT INTO n8n_instances (owner_user_id, name, environment, base_url, api_key_encrypted, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, environment, base_url, is_default, created_at`,
      [
        user.id,
        body.name.trim(),
        body.environment,
        body.baseUrl.replace(/\/+$/, ""),
        encryptSecret(body.apiKey),
        body.isDefault,
      ],
    );
    return Response.json({ instance: result.rows[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
