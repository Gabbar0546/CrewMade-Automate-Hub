import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { encryptSecret } from "@/lib/secrets";

const CredentialStoreSchema = z.object({
  instanceId: z.number().optional().nullable(),
  name: z.string().min(1),
  credentialType: z.string().min(1),
  sharedData: z.record(z.string(), z.unknown()).default({}),
  userFields: z.array(z.string()).default([]),
  allowedRoles: z.array(z.enum(["admin", "user"])).default(["admin", "user"]),
});

export async function GET() {
  try {
    const user = await requireUser();
    const where = user.role === "admin" ? "" : "WHERE cs.owner_user_id = $1";
    const params = user.role === "admin" ? [] : [user.id];
    const result = await query(
      `SELECT cs.id, cs.owner_user_id, cs.instance_id, cs.name, cs.credential_type,
        cs.user_fields, cs.allowed_roles, cs.created_at, ni.name AS instance_name
       FROM credential_store cs
       LEFT JOIN n8n_instances ni ON ni.id = cs.instance_id
       ${where}
       ORDER BY cs.created_at DESC LIMIT 100`,
      params,
    );
    return Response.json({ credentials: result.rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = CredentialStoreSchema.parse(await request.json());
    const result = await query(
      `INSERT INTO credential_store
        (owner_user_id, instance_id, name, credential_type, shared_data_encrypted, user_fields, allowed_roles)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, credential_type, user_fields, allowed_roles, created_at`,
      [
        user.id,
        body.instanceId || null,
        body.name,
        body.credentialType,
        encryptSecret(JSON.stringify(body.sharedData)),
        body.userFields,
        body.allowedRoles,
      ],
    );
    return Response.json({ credential: result.rows[0] }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
