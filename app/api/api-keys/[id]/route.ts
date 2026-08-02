import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const result = user.role === "admin"
      ? await query("DELETE FROM app_api_keys WHERE id = $1 RETURNING id", [Number(id)])
      : await query("DELETE FROM app_api_keys WHERE id = $1 AND user_id = $2 RETURNING id", [Number(id), user.id]);
    if (result.rowCount === 0) throw Object.assign(new Error("API key not found"), { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
