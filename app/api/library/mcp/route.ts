import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

const McpSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["http", "stdio"]).default("http"),
  url: z.string().optional().default(""),
  command: z.string().optional().default(""),
  args: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

export async function GET() {
  try {
    const user = await requireUser();
    const where = user.role === "admin" ? "" : "WHERE owner_user_id = $1";
    const params = user.role === "admin" ? [] : [user.id];
    const result = await query(`SELECT * FROM mcp_servers ${where} ORDER BY created_at DESC LIMIT 100`, params);
    return Response.json({ servers: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = McpSchema.parse(await request.json());
    const result = await query(
      `INSERT INTO mcp_servers (owner_user_id, name, type, url, command, args, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [user.id, body.name, body.type, body.url, body.command, JSON.stringify(body.args), body.enabled],
    );
    return Response.json({ server: result.rows[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
