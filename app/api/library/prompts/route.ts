import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

const PromptSchema = z.object({
  name: z.string().min(1),
  content: z.string().default(""),
  variables: z.array(z.string()).default([]),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
});

export async function GET() {
  try {
    const user = await requireUser();
    const where = user.role === "admin" ? "" : "WHERE owner_user_id = $1";
    const params = user.role === "admin" ? [] : [user.id];
    const result = await query(`SELECT * FROM prompts ${where} ORDER BY updated_at DESC LIMIT 100`, params);
    return Response.json({ prompts: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = PromptSchema.parse(await request.json());
    const result = await query(
      `INSERT INTO prompts (owner_user_id, name, content, variables, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user.id, body.name, body.content, JSON.stringify(body.variables), body.status],
    );
    return Response.json({ prompt: result.rows[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
