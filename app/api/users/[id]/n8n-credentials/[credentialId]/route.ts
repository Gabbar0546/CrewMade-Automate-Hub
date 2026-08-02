import { query } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; credentialId: string }> },
) {
  try {
    await requireAdmin();
    const { id, credentialId } = await params;
    const result = await query(
      "DELETE FROM n8n_instances WHERE id = $1 AND owner_user_id = $2 RETURNING id",
      [Number(credentialId), Number(id)],
    );
    if (result.rowCount === 0) {
      return Response.json({ error: "n8n credential not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
