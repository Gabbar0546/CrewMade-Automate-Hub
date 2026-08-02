import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const result = await query("DELETE FROM n8n_instances WHERE id = $1 AND owner_user_id = $2 RETURNING id", [
      Number(id),
      user.id,
    ]);

    if (result.rowCount === 0) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
