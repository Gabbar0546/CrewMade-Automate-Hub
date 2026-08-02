import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

const ArticleSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  tags: z.array(z.string()).default([]),
});

export async function GET() {
  try {
    const user = await requireUser();
    const where = user.role === "admin" ? "" : "WHERE owner_user_id = $1";
    const params = user.role === "admin" ? [] : [user.id];
    const result = await query(`SELECT * FROM kb_articles ${where} ORDER BY updated_at DESC LIMIT 100`, params);
    return Response.json({ articles: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = ArticleSchema.parse(await request.json());
    const result = await query(
      `INSERT INTO kb_articles (owner_user_id, title, body, status, tags)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user.id, body.title, body.body, body.status, body.tags],
    );
    return Response.json({ article: result.rows[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
