import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

const WebhookSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  events: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

export async function GET() {
  try {
    const user = await requireUser();
    const where = user.role === "admin" ? "" : "WHERE owner_user_id = $1";
    const params = user.role === "admin" ? [] : [user.id];
    const result = await query(`SELECT * FROM outbound_webhooks ${where} ORDER BY created_at DESC LIMIT 100`, params);
    return Response.json({ webhooks: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = WebhookSchema.parse(await request.json());
    const result = await query(
      `INSERT INTO outbound_webhooks (owner_user_id, name, url, events, enabled)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user.id, body.name, body.url, JSON.stringify(body.events), body.enabled],
    );
    return Response.json({ webhook: result.rows[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
