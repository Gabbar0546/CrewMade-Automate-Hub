import { z } from "zod";
import { query } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { n8nFetch } from "@/lib/n8n";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-guards";
import { safeJson } from "@/lib/redact";

const ApplySchema = z.object({
  accessId: z.number(),
  mappings: z.record(z.string(), z.string().min(1)),
  activate: z.boolean().default(true),
});

type CredentialMeta = {
  id?: string | number;
  name?: string;
  type?: string;
};

function sanitizeCredential(item: unknown): CredentialMeta {
  const source = typeof item === "object" && item ? item as Record<string, unknown> : {};
  return {
    id: source.id as string | number | undefined,
    name: source.name as string | undefined,
    type: source.type as string | undefined,
  };
}

function patchWorkflowCredentials(workflow: unknown, credentialsById: Map<string, CredentialMeta>, mappings: Record<string, string>) {
  const record = typeof workflow === "object" && workflow ? workflow as Record<string, unknown> : {};
  const nodes = Array.isArray(record.nodes) ? record.nodes.map((node) => {
    const nodeRecord = typeof node === "object" && node ? { ...(node as Record<string, unknown>) } : {};
    const credentials = typeof nodeRecord.credentials === "object" && nodeRecord.credentials
      ? { ...(nodeRecord.credentials as Record<string, unknown>) }
      : {};
    for (const [credentialType, credentialId] of Object.entries(mappings)) {
      if (!(credentialType in credentials)) continue;
      const credential = credentialsById.get(String(credentialId));
      if (!credential) continue;
      credentials[credentialType] = { id: String(credential.id), name: credential.name || String(credential.id) };
    }
    return { ...nodeRecord, credentials };
  }) : [];

  return {
    name: record.name,
    nodes,
    connections: record.connections || {},
    settings: record.settings || {},
    staticData: record.staticData || null,
    pinData: record.pinData || {},
  };
}

function responseMessage(data: unknown, fallback: string) {
  if (typeof data === "string" && data) return data;
  if (typeof data === "object" && data) {
    const record = data as Record<string, unknown>;
    return String(record.message || record.error || record.detail || fallback);
  }
  return fallback;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(request, { key: "credential-map-activate", limit: 20, windowMs: 60_000 });
    const user = await requireUser();
    const body = ApplySchema.parse(await request.json());
    const access = await query<{
      id: number;
      source_workflow_id: string;
      target_workflow_id: string;
      target_instance_id: number;
      transfer_response: Record<string, unknown>;
    }>(
      `SELECT id, source_workflow_id, target_workflow_id, target_instance_id, transfer_response
       FROM user_transferred_workflows
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [body.accessId, user.id],
    );
    const transfer = access.rows[0];
    if (!transfer) return Response.json({ error: "Transferred workflow not found" }, { status: 404 });

    const credentialsData = await n8nFetch(user, "/api/v1/credentials?limit=250", transfer.target_instance_id) as { data?: unknown[] } | unknown[];
    const credentials = Array.isArray(credentialsData)
      ? credentialsData.map(sanitizeCredential)
      : Array.isArray(credentialsData.data)
        ? credentialsData.data.map(sanitizeCredential)
        : [];
    const credentialsById = new Map(credentials.map((credential) => [String(credential.id), credential]));

    for (const credentialId of Object.values(body.mappings)) {
      if (!credentialsById.has(String(credentialId))) {
        return Response.json({ error: `Credential ${credentialId} is not available in this n8n instance` }, { status: 400 });
      }
    }

    const workflow = await n8nFetch(user, `/api/v1/workflows/${encodeURIComponent(transfer.target_workflow_id)}`, transfer.target_instance_id);
    const patchedWorkflow = patchWorkflowCredentials(workflow, credentialsById, body.mappings);
    const updateResponse = await n8nFetch(user, `/api/v1/workflows/${encodeURIComponent(transfer.target_workflow_id)}`, transfer.target_instance_id, {
      method: "PATCH",
      body: JSON.stringify(patchedWorkflow),
    });

    let activated = false;
    let activationError = "";
    let activationResponse: unknown = null;
    if (body.activate) {
      try {
        activationResponse = await n8nFetch(user, `/api/v1/workflows/${encodeURIComponent(transfer.target_workflow_id)}/activate`, transfer.target_instance_id, {
          method: "POST",
        });
        activated = true;
      } catch (error) {
        activationError = error instanceof Error ? error.message : "Workflow activation failed";
      }
    }

    await query(
      `UPDATE user_transferred_workflows
       SET transfer_response = COALESCE(transfer_response, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [
        safeJson({
          credential_mapping: body.mappings,
          credential_mapping_updated_at: new Date().toISOString(),
          activation_error: activationError,
          activated,
        }),
        transfer.id,
      ],
    );
    await query(
      `INSERT INTO workflow_operation_attempts
        (user_id, workflow_access_id, source_workflow_id, target_workflow_id, target_instance_id, operation, status, message, details)
       VALUES ($1, $2, $3, $4, $5, 'credential_mapping_activate', $6, $7, $8)`,
      [
        user.id,
        transfer.id,
        transfer.source_workflow_id,
        transfer.target_workflow_id,
        transfer.target_instance_id,
        activationError ? "warning" : "success",
        activationError || "Credentials mapped and workflow activated",
        safeJson({ mappings: body.mappings, updateResponse, activationResponse }),
      ],
    );

    return Response.json({
      ok: activated || !body.activate,
      activated,
      activationError,
      updateResponse,
      activationResponse,
      message: activated ? "Credentials mapped and workflow activated." : responseMessage(activationResponse, activationError || "Credentials mapped."),
    });
  } catch (error) {
    return jsonError(error);
  }
}
