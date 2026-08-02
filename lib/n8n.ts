import { query } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import type { CurrentUser } from "@/lib/auth";

export type N8nInstance = {
  id: number;
  owner_user_id: number;
  name: string;
  environment: string;
  base_url: string;
  api_key_encrypted: string;
  is_default: boolean;
  workers: unknown[];
};

export async function listInstancesForUser(user: CurrentUser) {
  const result = await query(
    `SELECT ni.*, NULL AS owner_email, NULL AS owner_name
     FROM n8n_instances ni
     WHERE ni.owner_user_id = $1
     ORDER BY ni.is_default DESC, ni.created_at DESC`,
    [user.id],
  );
  return result.rows.map((row) => ({ ...row, api_key_encrypted: undefined, api_key_set: true }));
}

export async function getAccessibleInstance(user: CurrentUser, instanceId?: string | number | null) {
  const params: unknown[] = [];
  let where = "";

  if (user.role !== "admin") {
    params.push(user.id);
    where = `WHERE owner_user_id = $${params.length}`;
  }

  if (instanceId) {
    params.push(Number(instanceId));
    where += where ? ` AND id = $${params.length}` : `WHERE id = $${params.length}`;
  }

  const order = instanceId ? "" : "ORDER BY is_default DESC, created_at DESC LIMIT 1";
  const result = await query<N8nInstance>(`SELECT * FROM n8n_instances ${where} ${order}`, params);
  const instance = result.rows[0];
  if (!instance) return null;
  return {
    ...instance,
    apiKey: decryptSecret(instance.api_key_encrypted),
    baseUrl: instance.base_url.replace(/\/+$/, ""),
  };
}

export async function n8nFetch(user: CurrentUser, path: string, instanceId?: string | number | null, init?: RequestInit) {
  const instance = await getAccessibleInstance(user, instanceId);
  if (!instance) {
    throw Object.assign(new Error("No n8n instance configured"), { status: 400 });
  }

  const response = await fetch(`${instance.baseUrl}${path}`, {
    ...init,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-N8N-API-KEY": instance.apiKey,
      ...(init?.headers || {}),
    },
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {}

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : `n8n API returned ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status });
  }

  return body;
}
