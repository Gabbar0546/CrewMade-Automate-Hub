const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const email = process.env.SMOKE_EMAIL || "admin@localhost.local";
const password = process.env.SMOKE_PASSWORD || "admin123";

let cookie = "";
const created = [];

function pass(name) {
  console.log(`PASS ${name}`);
}

function fail(name, error) {
  console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}
  if (!response.ok) {
    throw new Error(typeof data === "object" && data && "error" in data ? data.error : `HTTP ${response.status}`);
  }
  return data;
}

async function check(name, fn) {
  try {
    const result = await fn();
    pass(name);
    return result;
  } catch (error) {
    fail(name, error);
    return null;
  }
}

async function main() {
  await check("auth login", () => request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }));

  const instances = await check("n8n instances list", () => request("/api/instances"));
  const instanceId = instances?.instances?.[0]?.id;
  if (!instanceId) throw new Error("No n8n instance available for smoke test");

  await check("dashboard summary", () => request(`/api/dashboard?instanceId=${instanceId}`));
  const workflows = await check("n8n workflows fetch", () => request(`/api/n8n/workflows?instanceId=${instanceId}`));
  await check("n8n workflows fetch with archived", () => request(`/api/n8n/workflows?instanceId=${instanceId}&includeArchived=true`));
  await check("n8n executions fetch", () => request(`/api/n8n/executions?instanceId=${instanceId}&limit=10`));
  await check("n8n credentials fetch", () => request(`/api/n8n/credentials?instanceId=${instanceId}`));
  await check("workflow schemas list", () => request("/api/workflow-schemas"));
  await check("workflow credential setup list", () => request(`/api/user/workflow-credential-setup?instanceId=${instanceId}`));
  await check("users list", () => request("/api/users"));
  await check("user workflow access list", () => request("/api/admin/user-workflow-access"));
  await check("internal tool access list", () => request("/api/admin/internal-tool-access"));
  await check("audit log list", () => request("/api/admin/audit?limit=20"));

  const stamp = Date.now();
  const kb = await check("knowledge base create", () => request("/api/library/kb", {
    method: "POST",
    body: JSON.stringify({ title: `Smoke KB ${stamp}`, body: "Smoke test article", status: "draft", tags: ["smoke"] }),
  }));
  if (kb?.article?.id) created.push(["/api/library/kb", kb.article.id]);
  await check("knowledge base list", () => request("/api/library/kb"));

  const prompt = await check("prompts create", () => request("/api/library/prompts", {
    method: "POST",
    body: JSON.stringify({ name: `Smoke Prompt ${stamp}`, content: "Write a status for {{workflow}}", variables: ["workflow"], status: "draft" }),
  }));
  if (prompt?.prompt?.id) created.push(["/api/library/prompts", prompt.prompt.id]);
  await check("prompts list", () => request("/api/library/prompts"));

  const webhook = await check("webhooks create", () => request("/api/library/webhooks", {
    method: "POST",
    body: JSON.stringify({ name: `Smoke Webhook ${stamp}`, url: "https://example.com/nexus-smoke", events: ["workflow.failed"], enabled: true }),
  }));
  if (webhook?.webhook?.id) created.push(["/api/library/webhooks", webhook.webhook.id]);
  await check("webhooks list", () => request("/api/library/webhooks"));

  const mcp = await check("mcp create", () => request("/api/library/mcp", {
    method: "POST",
    body: JSON.stringify({ name: `Smoke MCP ${stamp}`, type: "http", url: "https://example.com/mcp", command: "", args: [], enabled: true }),
  }));
  if (mcp?.server?.id) created.push(["/api/library/mcp", mcp.server.id]);
  await check("mcp list", () => request("/api/library/mcp"));

  const credential = await check("credential store create", () => request("/api/library/credential-store", {
    method: "POST",
    body: JSON.stringify({
      name: `Smoke Credential ${stamp}`,
      credentialType: "generic",
      sharedData: { smoke: true },
      userFields: ["apiKey"],
      allowedRoles: ["admin", "user"],
    }),
  }));
  if (credential?.credential?.id) created.push(["/api/library/credential-store", credential.credential.id]);
  await check("credential store list", () => request("/api/library/credential-store"));

  const template = await check("email template save", () => request("/api/library/email-templates", {
    method: "POST",
    body: JSON.stringify({
      key: `smoke_${stamp}`,
      label: "Smoke Template",
      subject: "Smoke {{app_name}}",
      body: "<p>Hello {{username}}</p>",
    }),
  }));
  if (template?.template?.id) created.push(["/api/library/email-templates", template.template.id]);
  await check("email templates list", () => request("/api/library/email-templates"));

  const apiKey = await check("api key create", () => request("/api/api-keys", {
    method: "POST",
    body: JSON.stringify({ name: `Smoke API Key ${stamp}`, expiresAt: null }),
  }));
  if (apiKey?.record?.id) created.push(["/api/api-keys", apiKey.record.id]);
  await check("api keys list", () => request("/api/api-keys"));

  if (process.env.RUN_TRANSFER === "1") {
    const workflowId = workflows?.data?.[0]?.id;
    const users = await request("/api/users");
    const targetUser = users.users?.find((user) => user.role === "user" && user.n8n_instances > 0);
    if (!workflowId || !targetUser) throw new Error("Need at least one workflow and one connected user for transfer");
    await check("workflow transfer", () => request("/api/admin/transfer-workflow", {
      method: "POST",
      body: JSON.stringify({
        sourceInstanceId: Number(instanceId),
        workflowId: String(workflowId),
        targetUserIds: [targetUser.id],
        name: `Smoke transfer ${stamp}`,
        activate: false,
      }),
    }));
  } else {
    console.log("SKIP workflow transfer mutation (set RUN_TRANSFER=1 to create a real copied workflow in n8n)");
  }
}

main()
  .finally(async () => {
    for (const [path, id] of created.reverse()) {
      await check(`cleanup ${path}/${id}`, () => request(`${path}/${id}`, { method: "DELETE" }));
    }
  });
