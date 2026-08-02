"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { CurrentUser } from "@/lib/auth";
import { LibraryNodeFlow, LibraryPreviewModal } from "./LibraryWorkflowPreview";

type Tab =
  | "overview"
  | "instances"
  | "workflows"
  | "monitoring"
  | "observability"
  | "n8n-credentials"
  | "credentials"
  | "kb"
  | "prompts"
  | "forms"
  | "email-templates"
  | "api-keys"
  | "webhooks"
  | "mcp"
  | "audit"
  | "users";

type Instance = {
  id: number;
  name: string;
  environment: string;
  base_url: string;
  is_default: boolean;
  owner_email?: string;
};

type DashboardData = {
  counts: Record<string, number>;
  n8n: {
    connected: boolean;
    totalWorkflows: number;
    activeWorkflows: number;
    recentExecutions: number;
  };
};

type WorkflowNode = {
  name?: string;
  type?: string;
  position?: [number, number];
};

type WorkflowTag = {
  id?: string;
  name?: string;
};

type Workflow = {
  id: string | number;
  name?: string;
  active?: boolean;
  archived?: boolean;
  isArchived?: boolean;
  status?: string;
  nodes?: WorkflowNode[];
  tags?: WorkflowTag[];
  updatedAt?: string;
  createdAt?: string;
  connections?: Record<string, unknown>;
};

type WorkflowSchema = {
  id: number;
  source_workflow_id: string;
  target_workflow_id?: string;
  execution_mode?: "user_n8n" | "admin_n8n";
  name: string;
  action?: string;
  webhook_url?: string;
  fields?: Array<{
    id: string;
    label: string;
    type?: string;
    required?: boolean;
    placeholder?: string;
    defaultValue?: string | number;
    min?: number;
    max?: number;
    helpText?: string;
    options?: Array<string | { label: string; value: string | number }>;
  }>;
};

type MissingWorkflowSchema = {
  source_workflow_id: string;
  target_workflow_id: string;
  target_base_url: string;
  created_at?: string;
};

type UserItem = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  is_active: boolean;
  n8n_instances: number;
  n8n_credentials?: Array<{
    id: number;
    name: string;
    environment: string;
    base_url: string;
    is_default: boolean;
    api_key_status: "Encrypted" | "Empty";
    created_at?: string;
  }>;
};

type WorkflowAccessItem = {
  id: number;
  source_workflow_id: string;
  target_workflow_id: string;
  target_instance_id: number;
  target_base_url: string;
  status: string;
  workflow_name: string;
  activation_warning?: string;
  created_at?: string;
};

type WorkflowAccessUser = {
  user_id: number;
  user_name: string;
  user_email: string;
  workflow_count: number;
  workflows: WorkflowAccessItem[];
};

type InternalToolSchema = {
  source_workflow_id: string;
  name: string;
  action?: string;
  webhook_url?: string;
  field_count?: number;
};

type InternalToolAccessUser = {
  user_id: number;
  user_name: string;
  user_email: string;
  tools: Array<InternalToolSchema & { id: number; created_at?: string }>;
};

type N8nCredentialItem = {
  id?: string | number;
  name?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  scopes?: unknown;
  projectId?: string;
  homeProject?: unknown;
  sharedWithProjects?: unknown;
  isManaged?: boolean;
};

type WorkflowCredentialRequirement = {
  type: string;
  currentId?: string;
  currentName?: string;
  nodes: string[];
};

type WorkflowCredentialSetup = {
  id: number;
  workflow_name: string;
  source_workflow_id: string;
  target_workflow_id: string;
  target_instance_id: number;
  target_base_url: string;
  activation_error?: string;
  requirements: WorkflowCredentialRequirement[];
};

type AuditRow = {
  id: number;
  action?: string;
  operation?: string;
  status?: string;
  message?: string;
  entity_type?: string;
  entity_id?: string;
  source_workflow_id?: string;
  target_workflow_id?: string;
  user_name?: string;
  user_email?: string;
  created_at?: string;
};

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
};

type ToastPayload = {
  message: string;
  type?: "success" | "error" | "info";
};

const tabs: Array<{ id: Tab; label: string; icon: string; group: "main" | "operations" | "content" | "administration"; adminOnly?: boolean }> = [
  { id: "overview", label: "Dashboard", icon: "▦", group: "main" },
  { id: "instances", label: "n8n Connections", icon: "⇄", group: "main" },
  { id: "workflows", label: "n8n Workflows", icon: "⚡", group: "main" },
  { id: "monitoring", label: "Monitoring", icon: "⌁", group: "operations" },
  { id: "observability", label: "Observability", icon: "▥", group: "operations" },
  { id: "n8n-credentials", label: "n8n Credentials", icon: "⚿", group: "operations" },
  { id: "credentials", label: "Credential Store", icon: "⬡", group: "operations" },
  { id: "kb", label: "Knowledge Base", icon: "▰", group: "content" },
  { id: "prompts", label: "Prompts", icon: "▤", group: "content" },
  { id: "forms", label: "Internal Tool Forms", icon: "▣", group: "content" },
  { id: "email-templates", label: "Email Templates", icon: "✉", group: "content" },
  { id: "api-keys", label: "API Keys", icon: "⚿", group: "administration" },
  { id: "webhooks", label: "Webhooks", icon: "↗", group: "administration" },
  { id: "mcp", label: "MCP", icon: "✦", group: "administration" },
  { id: "audit", label: "Audit Log", icon: "▧", group: "administration", adminOnly: true },
  { id: "users", label: "Users", icon: "◉", group: "administration", adminOnly: true },
];

const groupLabels = {
  main: "Workspace",
  operations: "Operations",
  content: "Content",
  administration: "Administration",
};

const sectionDescriptions: Record<Tab, string> = {
  overview: "A control room for users, connected n8n instances, transfers, and automation health.",
  instances: "Connect admin and user n8n workspaces with API keys and base URLs.",
  workflows: "Browse workflow templates, preview node maps, and transfer workflows to selected users.",
  monitoring: "Track executions and workflow run history from the selected n8n instance.",
  observability: "Review infrastructure signals, worker health, queues, and operational telemetry.",
  "n8n-credentials": "View credential metadata from the selected n8n instance without exposing secret values.",
  credentials: "Store reusable credential metadata and shared setup notes for teams.",
  kb: "Maintain internal articles, SOPs, and automation handover notes.",
  prompts: "Manage reusable prompt assets for AI-assisted workflow modules.",
  forms: "Run database schema-driven forms for transferred workflows and internal tools.",
  "email-templates": "Prepare transactional and operational email templates for Automation Hub flows.",
  "api-keys": "Issue, expire, and revoke application-level API access.",
  webhooks: "Configure outbound hooks for workflow alerts and business events.",
  mcp: "Register MCP servers used by automation and assistant workflows.",
  audit: "Review workflow transfer, activation, credential mapping, and admin operation history.",
  users: "Create users, review account status, and confirm n8n connection coverage.",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function pushToast(message: string, type: ToastPayload["type"] = "info") {
  if (typeof window === "undefined" || !message) return;
  window.dispatchEvent(new CustomEvent<ToastPayload>("nexus-toast", { detail: { message, type } }));
}

function ToastHost() {
  const [toasts, setToasts] = useState<Array<ToastPayload & { id: number }>>([]);

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<ToastPayload>).detail;
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-3), { id, message: detail.message, type: detail.type || "info" }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 4200);
    }
    window.addEventListener("nexus-toast", onToast);
    return () => window.removeEventListener("nexus-toast", onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.type || "info"}`} key={toast.id}>
          <strong>{toast.type === "error" ? "Error" : toast.type === "success" ? "Done" : "Notice"}</strong>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

function useConfirmDialog() {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  function requestConfirm(options: ConfirmState) {
    setConfirmState(options);
  }

  const confirmDialog = confirmState ? (
    <div className="library-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setConfirmState(null);
    }}>
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-icon">{confirmState.danger ? "!" : "?"}</div>
        <div>
          <h2 id="confirm-title">{confirmState.title}</h2>
          <p>{confirmState.message}</p>
        </div>
        <div className="confirm-actions">
          <button className="btn secondary" type="button" onClick={() => setConfirmState(null)}>Cancel</button>
          <button
            className={confirmState.danger ? "btn danger" : "btn"}
            type="button"
            onClick={async () => {
              const action = confirmState.onConfirm;
              setConfirmState(null);
              await action();
            }}
          >
            {confirmState.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { requestConfirm, confirmDialog };
}

function readTabFromUrl(fallback: Tab = "overview"): Tab {
  if (typeof window === "undefined") return fallback;
  const value = new URLSearchParams(window.location.search).get("section");
  return tabs.some((item) => item.id === value) ? (value as Tab) : fallback;
}

export default function DashboardClient({ initialUser }: { initialUser: CurrentUser }) {
  const [user] = useState(initialUser);
  const [tab, setTab] = useState<Tab>("overview");
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState("");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const visibleTabs = useMemo(() => tabs.filter((item) => !item.adminOnly || user.role === "admin"), [user.role]);

  async function refreshInstances() {
    const data = await api<{ instances: Instance[] }>("/api/instances");
    setInstances(data.instances);
    if (data.instances.length === 0) {
      setSelectedInstance("");
    } else if (!selectedInstance || !data.instances.some((instance) => String(instance.id) === selectedInstance)) {
      setSelectedInstance(String(data.instances[0].id));
    }
  }

  async function refreshDashboard(instanceId = selectedInstance) {
    const suffix = instanceId ? `?instanceId=${instanceId}` : "";
    setDashboard(await api<DashboardData>(`/api/dashboard${suffix}`));
  }

  useEffect(() => {
    refreshInstances().catch(console.error);
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("automation-hub-theme");
    const nextTheme = savedTheme === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    const nextTab = readTabFromUrl();
    if (visibleTabs.some((item) => item.id === nextTab)) {
      setTab(nextTab);
    } else {
      setDashboardTab("overview", true);
    }
  }, [visibleTabs]);

  useEffect(() => {
    if (!visibleTabs.some((item) => item.id === tab)) {
      setDashboardTab("overview", true);
    }
  }, [tab, visibleTabs]);

  useEffect(() => {
    const onPopState = () => setTab(readTabFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    refreshDashboard().catch(console.error);
  }, [selectedInstance]);

  function setDashboardTab(nextTab: Tab, replace = false) {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "overview") {
      url.searchParams.delete("section");
    } else {
      url.searchParams.set("section", nextTab);
    }
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (replace) {
      window.history.replaceState(null, "", nextUrl);
    } else {
      window.history.pushState(null, "", nextUrl);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function toggleTheme() {
    setTheme((current) => {
      const nextTheme = current === "dark" ? "light" : "dark";
      window.localStorage.setItem("automation-hub-theme", nextTheme);
      document.documentElement.dataset.theme = nextTheme;
      return nextTheme;
    });
  }

  const activeTab = visibleTabs.find((item) => item.id === tab);

  return (
    <div className="library-shell">
      <ToastHost />
      <aside className="library-sidebar">
        <div className="sidebar-head">
          <div>
            <div className="library-brand">Automation Hub</div>
            <div className="brand-subtitle">Automation command center</div>
          </div>
          <button className="collapse-btn" type="button">NX</button>
        </div>
        <nav className="library-nav">
          {(["main", "operations", "content", "administration"] as const).map((group) => (
            <div key={group} className="nav-group">
              {groupLabels[group] && <div className="nav-label">{groupLabels[group]}</div>}
              {visibleTabs.filter((item) => item.group === group).map((item) => (
                <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setDashboardTab(item.id)}>
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-profile">
          <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
          <button className="icon-btn" type="button">♢</button>
          <button className="icon-btn" type="button" onClick={logout}>↪</button>
        </div>
      </aside>

      <main className="library-main">
        <header className="library-topbar">
          <div className="topbar-context">
            <strong>{activeTab?.label}</strong>
            <span>{activeTab ? sectionDescriptions[activeTab.id] : "Automation command center"}</span>
          </div>
          <div className="topbar-actions">
            <select className="instance-select" value={selectedInstance} onChange={(event) => setSelectedInstance(event.target.value)}>
              <option value="">No n8n selected</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name} {instance.owner_email ? `(${instance.owner_email})` : ""}
                </option>
              ))}
            </select>
            <button className="icon-btn" type="button" onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
              {theme === "dark" ? "☾" : "☼"}
            </button>
            <button className="icon-btn" type="button">♧</button>
            <div className="topbar-user">
              <strong>{user.name}</strong>
              <span>{user.role}</span>
            </div>
          </div>
        </header>

        <section className="page-surface">
          {tab !== "workflows" && tab !== "monitoring" && (
            <div className="page-title">
              <h1>{activeTab?.label}</h1>
              <p>{activeTab ? sectionDescriptions[activeTab.id] : ""}</p>
            </div>
          )}
          {tab === "overview" && <Overview dashboard={dashboard} />}
          {tab === "instances" && <Instances onSaved={refreshInstances} instances={instances} />}
          {tab === "workflows" && <Workflows instanceId={selectedInstance} currentUser={user} />}
          {tab === "monitoring" && <Monitoring instanceId={selectedInstance} />}
          {tab === "observability" && <Observability instanceId={selectedInstance} />}
          {tab === "n8n-credentials" && <N8nCredentials instanceId={selectedInstance} />}
          {tab === "credentials" && <SimpleLibrary kind="credential-store" title="Credential Store" />}
          {tab === "kb" && <SimpleLibrary kind="kb" title="Knowledge Base" />}
          {tab === "prompts" && <SimpleLibrary kind="prompts" title="Prompts" />}
          {tab === "forms" && <WorkflowForms currentUser={user} />}
          {tab === "email-templates" && <EmailTemplates />}
          {tab === "api-keys" && <ApiKeys />}
          {tab === "webhooks" && <SimpleLibrary kind="webhooks" title="Webhooks" />}
          {tab === "mcp" && <SimpleLibrary kind="mcp" title="MCP Servers" />}
          {tab === "audit" && user.role === "admin" && <AuditLog />}
          {tab === "users" && user.role === "admin" && <Users />}
        </section>
      </main>
    </div>
  );
}

function FeatureBoard({ title, cards }: { title: string; cards: string[] }) {
  return (
    <section className="feature-board">
      {cards.map((card, index) => (
        <article className="feature-card" key={card}>
          <div className="feature-icon">{index + 1}</div>
          <h3>{card}</h3>
          <p>Configure this {title.toLowerCase()} capability for your Automation Hub workspace.</p>
        </article>
      ))}
    </section>
  );
}

function Overview({ dashboard }: { dashboard: DashboardData | null }) {
  const cards = [
    ["n8n connected", dashboard?.n8n.connected ? "Yes" : "No"],
    ["Workflows", dashboard?.n8n.totalWorkflows ?? 0],
    ["Active workflows", dashboard?.n8n.activeWorkflows ?? 0],
    ["Recent executions", dashboard?.n8n.recentExecutions ?? 0],
    ["Connections", dashboard?.counts.instances ?? 0],
    ["KB articles", dashboard?.counts.kb ?? 0],
    ["Prompts", dashboard?.counts.prompts ?? 0],
    ["MCP servers", dashboard?.counts.mcp ?? 0],
  ];
  return (
    <section className="grid">
      {cards.map(([label, value]) => (
        <div className="card" key={label}>
          <div className="muted">{label}</div>
          <div className="kpi">{value}</div>
        </div>
      ))}
    </section>
  );
}

function Instances({ instances, onSaved }: { instances: Instance[]; onSaved: () => void }) {
  const [message, setMessage] = useState("");
  const { requestConfirm, confirmDialog } = useConfirmDialog();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api("/api/instances", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          environment: form.get("environment"),
          baseUrl: form.get("baseUrl"),
          apiKey: form.get("apiKey"),
          isDefault: form.get("isDefault") === "on",
        }),
      });
      formElement.reset();
      setMessage("Connection saved.");
      pushToast("Connection saved.", "success");
      onSaved();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not save connection";
      setMessage(text);
      pushToast(text, "error");
    }
  }

  async function deleteInstance(instance: Instance) {
    requestConfirm({
      title: "Delete n8n connection",
      message: `Delete "${instance.name}" from this Automation Hub workspace? This does not delete anything inside n8n.`,
      confirmLabel: "Delete connection",
      danger: true,
      onConfirm: async () => {
        setMessage("");
        try {
          await api(`/api/instances/${instance.id}`, { method: "DELETE" });
          setMessage("Connection deleted.");
          pushToast("Connection deleted.", "success");
          onSaved();
        } catch (error) {
          const text = error instanceof Error ? error.message : "Could not delete connection";
          setMessage(text);
          pushToast(text, "error");
        }
      },
    });
  }

  return (
    <section className="two-col">
      {confirmDialog}
      <form className="card" onSubmit={submit}>
        <h2>Add n8n connection</h2>
        <label className="field"><span>Name</span><input className="input" name="name" required placeholder="Production" /></label>
        <label className="field"><span>Environment</span><input className="input" name="environment" defaultValue="production" /></label>
        <label className="field"><span>Base URL</span><input className="input" name="baseUrl" required placeholder="https://n8n.example.com" /></label>
        <label className="field"><span>API Key</span><input className="input" name="apiKey" type="password" required placeholder="n8n_api_..." /></label>
        <label className="toolbar"><input type="checkbox" name="isDefault" /> Make default</label>
        <div className="error">{message}</div>
        <button className="btn" type="submit">Save connection</button>
      </form>
      <div className="table-card">
        <h2>Connected instances</h2>
        <table className="table">
          <thead><tr><th>Name</th><th>URL</th><th>Default</th><th></th></tr></thead>
          <tbody>
            {instances.map((instance) => (
              <tr key={instance.id}>
                <td>{instance.name}<br /><span className="muted">{instance.environment}</span></td>
                <td>{instance.base_url}</td>
                <td>{instance.is_default ? <span className="pill ok">Default</span> : <span className="pill">No</span>}</td>
                <td><button className="btn danger small" onClick={() => deleteInstance(instance)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Workflows({ instanceId, currentUser }: { instanceId: string; currentUser: CurrentUser }) {
  const [rows, setRows] = useState<Workflow[]>([]);
  const [preview, setPreview] = useState<Workflow | null>(null);
  const [transferWorkflow, setTransferWorkflow] = useState<Workflow | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [showArchived, setShowArchived] = useState(false);

  async function load() {
    setError("");
    try {
      const params = new URLSearchParams({ instanceId });
      if (showArchived) params.set("includeArchived", "true");
      const data = await api<{ data?: Workflow[] }>(`/api/n8n/workflows?${params.toString()}`);
      setRows(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch workflows");
    }
  }

  useEffect(() => {
    if (instanceId) load();
  }, [instanceId, showArchived]);

  const filtered = rows.filter((workflow) => {
    const matchesSearch = (workflow.name || "").toLowerCase().includes(search.toLowerCase());
    const archived = isWorkflowArchived(workflow);
    const matchesStatus =
      status === "all" ||
      (status === "active" && workflow.active) ||
      (status === "inactive" && !workflow.active);
    return matchesSearch && matchesStatus && (showArchived || !archived);
  });

  return (
    <section className="workflow-page">
      <div className="workflow-controls">
        <div className="workflow-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search workflows..." />
        </div>
        <span className="workflow-count">{filtered.length} workflows</span>
        <button className="library-btn" onClick={load} disabled={!instanceId}>Refresh</button>
      </div>
      <div className="filter-row">
        {(["all", "active", "inactive"] as const).map((item) => (
          <button key={item} className={status === item ? "filter-chip active" : "filter-chip"} onClick={() => setStatus(item)}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
        <button className={showArchived ? "filter-chip active" : "filter-chip"} onClick={() => setShowArchived((current) => !current)}>
          {showArchived ? "Hide Archived" : "Show Archived"}
        </button>
        <button className="filter-chip">◇ Tags⌄</button>
        <span className="error">{error}</span>
      </div>
      <div className="workflow-grid">
        {filtered.map((workflow) => (
          <WorkflowCard
            key={String(workflow.id)}
            workflow={workflow}
            canTransfer={currentUser.role === "admin"}
            onPreview={() => setPreview(workflow)}
            onTransfer={() => setTransferWorkflow(workflow)}
          />
        ))}
      </div>
      {filtered.length === 0 && <div className="empty-card">No workflows loaded yet. Select a connection and refresh.</div>}
      {preview && (
        <LibraryPreviewModal
          title={preview.name || "Workflow preview"}
          workflowData={{ nodes: preview.nodes || [], connections: preview.connections || {} }}
          onClose={() => setPreview(null)}
        />
      )}
      {transferWorkflow && (
        <TransferWorkflowModal
          workflow={transferWorkflow}
          sourceInstanceId={instanceId}
          onClose={() => setTransferWorkflow(null)}
        />
      )}
    </section>
  );
}

function isWorkflowArchived(workflow: Workflow) {
  if (workflow.archived || workflow.isArchived) return true;
  if (String(workflow.status || "").toLowerCase() === "archived") return true;
  return (workflow.tags || []).some((tag) => String(tag.name || "").toLowerCase() === "archived");
}

function WorkflowCard({
  workflow,
  canTransfer,
  onPreview,
  onTransfer,
}: {
  workflow: Workflow;
  canTransfer: boolean;
  onPreview: () => void;
  onTransfer: () => void;
}) {
  const nodes = workflow.nodes || [];
  const tags = workflow.tags || [];
  return (
    <article className="workflow-card">
      <button className="node-preview" onClick={onPreview} aria-label={`Preview ${workflow.name || "workflow"}`}>
        <LibraryNodeFlow nodes={nodes.slice(0, 12)} onClick={onPreview} />
      </button>
      <div className="workflow-head">
        <h3>{workflow.name || "Untitled workflow"}</h3>
        {isWorkflowArchived(workflow)
          ? <span className="pill warn">Archived</span>
          : workflow.active ? <span className="pill ok">Active</span> : <span className="pill warn">Inactive</span>}
      </div>
      <div className="muted">{nodes.length} node{nodes.length === 1 ? "" : "s"} · Updated {formatDate(workflow.updatedAt || workflow.createdAt)}</div>
      {tags.length > 0 && (
        <div className="tag-row">
          {tags.slice(0, 4).map((tag, index) => <span className="pill" key={tag.id || `${tag.name}-${index}`}>{tag.name}</span>)}
        </div>
      )}
      <div className="workflow-actions">
        <button className="import-btn" type="button">Import to Library</button>
        {canTransfer && !isWorkflowArchived(workflow) && <button className="transfer-btn" type="button" onClick={onTransfer}>Transfer</button>}
        <button className="preview-btn" onClick={onPreview}>Preview</button>
      </div>
    </article>
  );
}

function TransferWorkflowModal({
  workflow,
  sourceInstanceId,
  onClose,
}: {
  workflow: Workflow;
  sourceInstanceId: string;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [activate, setActivate] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  useEffect(() => {
    api<{ users: UserItem[] }>("/api/users")
      .then((data) => setUsers(data.users.filter((user) => user.role === "user")))
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load users"));
  }, []);

  function toggleUser(id: number) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(query));
  }, [users, userSearch]);

  function selectVisibleUsers() {
    setSelected((current) => Array.from(new Set([...current, ...filteredUsers.map((user) => user.id)])));
  }

  async function submit() {
    if (!sourceInstanceId) return setMessage("Select source n8n instance first.");
    if (selected.length === 0) return setMessage("Select at least one user.");
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{
        transferred: number;
        failed: number;
        skipped?: number;
        results: Array<{ ok: boolean; error?: string; warning?: string; workflow?: { id?: string | number } }>;
      }>("/api/admin/transfer-workflow", {
        method: "POST",
        body: JSON.stringify({
          sourceInstanceId: Number(sourceInstanceId),
          workflowId: String(workflow.id),
          targetUserIds: selected,
          name: name || undefined,
          activate,
        }),
      });
      const failedDetails = result.results.filter((item) => !item.ok).map((item) => item.error).filter(Boolean).join("; ");
      const warnings = result.results.filter((item) => item.ok && item.warning).map((item) => item.warning).filter(Boolean).join("; ");
      const text = `Transferred: ${result.transferred} user(s). Already transferred: ${result.skipped || 0}. Failed: ${result.failed}${warnings ? `. Warning: ${warnings}` : ""}${failedDetails ? ` - ${failedDetails}` : ""}`;
      setMessage(text);
      pushToast(text, result.failed ? "error" : warnings ? "info" : "success");
      if (result.failed === 0) {
        setTimeout(onClose, 900);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Transfer failed";
      setMessage(text);
      pushToast(text, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library-modal-backdrop" onClick={onClose}>
      <div className="transfer-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-titlebar">
          <h2>Transfer: {workflow.name || "Workflow"}</h2>
          <button className="close-btn" onClick={onClose}>Close</button>
        </div>
        <div className="transfer-body">
          <label className="field"><span>New workflow name optional</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={`${workflow.name || "Workflow"} - copy`} /></label>
          <label className="toolbar"><input type="checkbox" checked={activate} onChange={(event) => setActivate(event.target.checked)} /> Activate after transfer</label>
          <div className="transfer-picker">
            <div className="transfer-picker-head">
              <div>
                <strong>Select users</strong>
                <span>{selected.length} selected · {filteredUsers.length} shown</span>
              </div>
              <div className="transfer-picker-actions">
                <button className="table-action" type="button" onClick={selectVisibleUsers} disabled={filteredUsers.length === 0}>Select visible</button>
                <button className="table-action" type="button" onClick={() => setSelected([])} disabled={selected.length === 0}>Clear</button>
              </div>
            </div>
            <label className="transfer-search">
              <span>⌕</span>
              <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search user name or email..." />
            </label>
          </div>
          <div className="transfer-users">
            {filteredUsers.map((user) => (
              <label className={selected.includes(user.id) ? "transfer-user selected" : "transfer-user"} key={user.id}>
                <input type="checkbox" checked={selected.includes(user.id)} onChange={() => toggleUser(user.id)} />
                <span>
                  <strong>{user.name}</strong>
                  <small>{user.email} · {user.n8n_instances} n8n connection(s)</small>
                </span>
              </label>
            ))}
            {filteredUsers.length === 0 && <div className="empty-card">No users match this search.</div>}
          </div>
          <div className="notice">{message || "Users without an n8n connection cannot receive workflow transfers."}</div>
          <button className="btn success" onClick={submit} disabled={busy || selected.length === 0}>{busy ? "Transferring..." : `Transfer to ${selected.length} user(s)`}</button>
        </div>
      </div>
    </div>
  );
}

function Monitoring({ instanceId }: { instanceId: string }) {
  const [executions, setExecutions] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState("off");
  const [statusFilter, setStatusFilter] = useState("all");
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"executions" | "workflows">("executions");

  async function load() {
    setError("");
    try {
      const data = await api<{ data?: Array<Record<string, unknown>> }>(`/api/n8n/executions?instanceId=${instanceId}&limit=50`);
      setExecutions(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch executions");
    }
  }

  useEffect(() => {
    if (instanceId) load();
  }, [instanceId]);

  useEffect(() => {
    if (autoRefresh === "off" || !instanceId) return;
    const seconds = Number(autoRefresh);
    const timer = window.setInterval(() => load(), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, instanceId]);

  const metrics = useMemo(() => {
    const success = executions.filter((execution) => getExecutionStatus(execution) === "success").length;
    const errorCount = executions.filter((execution) => getExecutionStatus(execution) === "error").length;
    const running = executions.filter((execution) => getExecutionStatus(execution) === "running").length;
    const waiting = executions.filter((execution) => getExecutionStatus(execution) === "waiting").length;
    const finished = success + errorCount;
    const activeWorkflows = new Set(executions.map((execution) => String(execution.workflowId || getNestedName(execution, "workflow") || "")).filter(Boolean)).size;
    const durations = executions.map(getExecutionDuration).filter((duration) => duration > 0);
    const avgDuration = durations.length ? Math.round(durations.reduce((total, duration) => total + duration, 0) / durations.length) : 0;
    return {
      health: error ? "Unreachable" : instanceId ? "Reachable" : "No instance",
      success,
      error: errorCount,
      running,
      waiting,
      successRate: finished ? Math.round((success / finished) * 100) : 0,
      activeWorkflows,
      totalWorkflows: Math.max(activeWorkflows, 0),
      avgDuration,
      total: executions.length,
    };
  }, [executions, error, instanceId]);

  const workflowOptions = useMemo(() => {
    return Array.from(new Set(executions.map((execution) => getWorkflowName(execution)).filter(Boolean))).sort();
  }, [executions]);

  const filteredExecutions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return executions.filter((execution) => {
      const status = getExecutionStatus(execution);
      const workflow = getWorkflowName(execution);
      const haystack = `${execution.id || ""} ${workflow} ${status} ${execution.mode || ""} ${execution.workflowId || ""}`.toLowerCase();
      return (
        (statusFilter === "all" || status === statusFilter) &&
        (workflowFilter === "all" || workflow === workflowFilter) &&
        (!query || haystack.includes(query))
      );
    });
  }, [executions, statusFilter, workflowFilter, search]);

  const history = useMemo(() => buildExecutionHistory(executions), [executions]);
  const chartPoints = history.map((item, index) => `${index * 48},${120 - Math.min(item.total, 6) * 18}`).join(" ");
  const successAngle = metrics.total ? Math.round((metrics.success / metrics.total) * 360) : 0;
  const errorAngle = metrics.total ? Math.round((metrics.error / metrics.total) * 360) : 0;
  const runningAngle = metrics.total ? Math.round((metrics.running / metrics.total) * 360) : 0;

  return (
    <section className="monitor-page">
      <div className="monitor-kpis">
        <MetricCard value={metrics.health} label="Health" tone={metrics.health === "Reachable" ? "success" : "danger"} dot />
        <MetricCard value={metrics.success} label="Success" tone="success" />
        <MetricCard value={metrics.error} label="Error" tone="danger" />
        <MetricCard value={metrics.running} label="Running" tone="danger" />
        <MetricCard value={metrics.waiting} label="Waiting" tone="warning" />
        <MetricCard value={`${metrics.successRate}%`} label="Success Rate" tone="warning" />
        <MetricCard value={`${metrics.activeWorkflows} / ${metrics.totalWorkflows}`} label="Active / Total" tone="danger" />
        <MetricCard value={`${metrics.avgDuration}ms`} label="Avg Duration" tone="neutral" />
        <MetricCard value={metrics.total} label="Total Executions" tone="neutral" />
      </div>

      <div className="monitor-controls">
        <select className="monitor-select" value={autoRefresh} onChange={(event) => setAutoRefresh(event.target.value)}>
          <option value="off">Auto-refresh: Off</option>
          <option value="10">Auto-refresh: 10s</option>
          <option value="30">Auto-refresh: 30s</option>
          <option value="60">Auto-refresh: 60s</option>
        </select>
        <button className="monitor-refresh" type="button" onClick={load} disabled={!instanceId}>⟳ Refresh</button>
        <span className="error">{error}</span>
      </div>

      <div className="monitor-charts">
        <div className="monitor-panel history-panel">
          <h3>Execution History (24h)</h3>
          <div className="history-chart">
            <div className="chart-grid" />
            <svg className="chart-line" viewBox="0 0 1104 140" preserveAspectRatio="none">
              <polyline points={chartPoints} fill="none" stroke="#7ccf95" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="chart-y">
              <span>1.0</span><span>0.8</span><span>0.6</span><span>0.4</span><span>0.2</span><span>0</span>
            </div>
            <div className="chart-x">
              {history.map((item) => <span key={item.label}>{item.label}</span>)}
            </div>
          </div>
          <div className="monitor-legend">
            <span><i className="legend-success" />Success</span>
            <span><i className="legend-error" />Error</span>
            <span><i className="legend-running" />Running</span>
          </div>
        </div>

        <div className="monitor-panel status-panel">
          <h3>Status Breakdown</h3>
          <div
            className="status-donut"
            style={{
              background: `conic-gradient(#22c55e 0 ${successAngle}deg, #ef4444 ${successAngle}deg ${successAngle + errorAngle}deg, #3b82f6 ${successAngle + errorAngle}deg ${successAngle + errorAngle + runningAngle}deg, #f59e0b ${successAngle + errorAngle + runningAngle}deg 360deg)`,
            }}
          >
            <span />
          </div>
          <div className="donut-legend">
            <span><i className="legend-success" />Success</span>
            <span><i className="legend-error" />Error</span>
            <span><i className="legend-running" />Running</span>
            <span><i className="legend-waiting" />Waiting</span>
          </div>
        </div>
      </div>

      <div className="monitor-tabs">
        <button className={view === "executions" ? "active" : ""} onClick={() => setView("executions")}>Executions</button>
        <button className={view === "workflows" ? "active" : ""} onClick={() => setView("workflows")}>Workflows</button>
      </div>

      <div className="monitor-filters">
        <label className="module-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search executions..." />
        </label>
        <select className="monitor-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All Statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="running">Running</option>
          <option value="waiting">Waiting</option>
        </select>
        <select className="monitor-select" value={workflowFilter} onChange={(event) => setWorkflowFilter(event.target.value)}>
          <option value="all">All Workflows</option>
          {workflowOptions.map((workflow) => <option key={workflow} value={workflow}>{workflow}</option>)}
        </select>
        <span className="module-count">{filteredExecutions.length} result{filteredExecutions.length === 1 ? "" : "s"}</span>
      </div>

      <div className="monitor-table-wrap">
        <table className="monitor-table">
          <thead><tr><th>Status</th><th>ID</th><th>Workflow</th><th>Mode</th><th>Duration</th><th>Started</th><th>Actions</th></tr></thead>
          <tbody>
            {(view === "executions" ? filteredExecutions : workflowSummaryRows(filteredExecutions)).map((execution) => {
              const status = getExecutionStatus(execution);
              return (
                <tr key={String(execution.id)}>
                  <td><span className={`status-mark ${status}`}>{status === "success" ? "✓" : status === "error" ? "!" : "•"}</span></td>
                  <td>#{String(execution.id || "").replace(/^#/, "")}</td>
                  <td>{getWorkflowName(execution)}</td>
                  <td>{String(execution.mode || "Webhook")}</td>
                  <td>{formatDuration(getExecutionDuration(execution))}</td>
                  <td>{formatRelativeTime(execution.startedAt || execution.createdAt || execution.stoppedAt)}</td>
                  <td><button className="table-action" type="button">View</button></td>
                </tr>
              );
            })}
            {filteredExecutions.length === 0 && <tr><td colSpan={7} className="empty-cell">No executions match this search.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricCard({ value, label, tone, dot }: { value: string | number; label: string; tone: "success" | "danger" | "warning" | "neutral"; dot?: boolean }) {
  return (
    <div className="monitor-metric">
      {dot && <span className={`metric-dot ${tone}`} />}
      <strong className={tone}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Observability({ instanceId }: { instanceId: string }) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [executions, setExecutions] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const suffix = instanceId ? `?instanceId=${instanceId}` : "";
      const [dashboardData, executionData] = await Promise.all([
        api<DashboardData>(`/api/dashboard${suffix}`),
        instanceId
          ? api<{ data?: Array<Record<string, unknown>> }>(`/api/n8n/executions?instanceId=${instanceId}&limit=25`)
          : Promise.resolve({ data: [] }),
      ]);
      setDashboard(dashboardData);
      setExecutions(executionData.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load observability data");
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, [instanceId]);

  const durations = executions.map(getExecutionDuration).filter((duration) => duration > 0);
  const avgDuration = durations.length ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : 0;
  const errors = executions.filter((execution) => getExecutionStatus(execution) === "error").length;
  const success = executions.filter((execution) => getExecutionStatus(execution) === "success").length;
  const successRate = success + errors ? Math.round((success / (success + errors)) * 100) : 0;
  const queueHealth = executions.filter((execution) => ["running", "waiting"].includes(getExecutionStatus(execution))).length;

  return (
    <section className="observability-page">
      <div className="observability-hero">
        <div>
          <span className={dashboard?.n8n.connected ? "obs-state ok" : "obs-state danger"}>{dashboard?.n8n.connected ? "n8n reachable" : "n8n unavailable"}</span>
          <h2>Operational Signals</h2>
          <p>Live health indicators from Automation Hub records and the selected n8n instance.</p>
        </div>
        <button className="monitor-refresh" type="button" onClick={load}>⟳ Refresh</button>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="obs-grid">
        <div className="obs-card">
          <span>Instance Health</span>
          <strong>{dashboard?.n8n.connected ? "Online" : "Offline"}</strong>
          <p>{dashboard?.n8n.totalWorkflows || 0} workflows discovered</p>
        </div>
        <div className="obs-card">
          <span>Success Rate</span>
          <strong>{successRate}%</strong>
          <p>{success} success / {errors} error in recent executions</p>
        </div>
        <div className="obs-card">
          <span>Queue Signal</span>
          <strong>{queueHealth}</strong>
          <p>Running or waiting executions</p>
        </div>
        <div className="obs-card">
          <span>Latency</span>
          <strong>{avgDuration}ms</strong>
          <p>Average recent execution duration</p>
        </div>
      </div>
      <div className="module-card">
        <div className="module-card-head">
          <div className="module-icon alt">O</div>
          <div>
            <h2>Recent Signals</h2>
            <p>Latest n8n execution state used for observability checks.</p>
          </div>
        </div>
        <table className="module-table">
          <thead><tr><th>Status</th><th>Workflow</th><th>Duration</th><th>Started</th></tr></thead>
          <tbody>
            {executions.slice(0, 10).map((execution) => {
              const status = getExecutionStatus(execution);
              return (
                <tr key={String(execution.id)}>
                  <td><span className={`status-mark ${status}`}>{status === "success" ? "✓" : status === "error" ? "!" : "•"}</span></td>
                  <td>{getWorkflowName(execution)}</td>
                  <td>{formatDuration(getExecutionDuration(execution))}</td>
                  <td>{formatRelativeTime(execution.startedAt || execution.createdAt || execution.stoppedAt)}</td>
                </tr>
              );
            })}
            {executions.length === 0 && <tr><td colSpan={4} className="empty-cell">No recent execution signals found.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function N8nCredentials({ instanceId }: { instanceId: string }) {
  const [credentials, setCredentials] = useState<N8nCredentialItem[]>([]);
  const [workflowSetups, setWorkflowSetups] = useState<WorkflowCredentialSetup[]>([]);
  const [mappings, setMappings] = useState<Record<number, Record<string, string>>>({});
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);

  async function load() {
    if (!instanceId) {
      setCredentials([]);
      setWorkflowSetups([]);
      setError("Select an n8n instance to view credentials.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api<{ credentials: N8nCredentialItem[]; workflows: WorkflowCredentialSetup[] }>(`/api/user/workflow-credential-setup?instanceId=${instanceId}`);
      setCredentials(data.credentials);
      setWorkflowSetups(data.workflows);
      const nextMappings: Record<number, Record<string, string>> = {};
      for (const workflow of data.workflows) {
        nextMappings[workflow.id] = {};
        for (const requirement of workflow.requirements) {
          const matchingCredential = data.credentials.find((credential) => credential.type === requirement.type);
          if (matchingCredential?.id) nextMappings[workflow.id][requirement.type] = String(matchingCredential.id);
        }
      }
      setMappings(nextMappings);
    } catch (err) {
      setCredentials([]);
      setWorkflowSetups([]);
      setError(err instanceof Error ? err.message : "Could not load n8n credentials");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, [instanceId]);

  const typeOptions = useMemo(() => Array.from(new Set(credentials.map((item) => item.type).filter(Boolean))) as string[], [credentials]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return credentials.filter((item) => {
      const matchesType = typeFilter === "all" || item.type === typeFilter;
      const haystack = `${item.name || ""} ${item.type || ""} ${item.id || ""}`.toLowerCase();
      return matchesType && (!query || haystack.includes(query));
    });
  }, [credentials, search, typeFilter]);
  const managedCount = credentials.filter((item) => item.isManaged).length;

  function credentialOptionsFor(type: string) {
    const exact = credentials.filter((credential) => credential.type === type);
    return exact.length ? exact : credentials;
  }

  async function applyWorkflowMapping(workflow: WorkflowCredentialSetup) {
    const mapping = mappings[workflow.id] || {};
    const missing = workflow.requirements.filter((requirement) => !mapping[requirement.type]);
    if (missing.length) {
      setMessage(`Select credentials for: ${missing.map((item) => formatCredentialType(item.type)).join(", ")}`);
      return;
    }
    setApplyingId(workflow.id);
    setMessage("");
    setError("");
    try {
      const result = await api<{ message?: string; activationError?: string; activated?: boolean }>("/api/user/workflow-credential-setup/apply", {
        method: "POST",
        body: JSON.stringify({ accessId: workflow.id, mappings: mapping, activate: true }),
      });
      setMessage(result.activationError || result.message || "Credentials mapped.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not map credentials");
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <section className="n8n-credentials-page">
      <div className="monitor-strip">
        <MetricCard value={credentials.length} label="Credentials" tone="neutral" />
        <MetricCard value={typeOptions.length} label="Credential Types" tone="success" />
        <MetricCard value={managedCount} label="Managed" tone="warning" />
        <MetricCard value={instanceId ? "Selected" : "Missing"} label="n8n Instance" tone={instanceId ? "success" : "danger"} />
      </div>

      <div className="module-toolbar">
        <label className="module-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search credentials..." />
        </label>
        <select className="monitor-select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="all">All types</option>
          {typeOptions.map((type) => <option key={type} value={type}>{formatCredentialType(type)}</option>)}
        </select>
        <button className="btn" type="button" onClick={load} disabled={busy || !instanceId}>{busy ? "Loading..." : "Refresh"}</button>
      </div>

      {error && <div className="notice">{error}</div>}
      {message && <div className="form-status ok">{message}</div>}
      <div className="module-card">
        <div className="module-card-head">
          <div className="module-icon">C</div>
          <div>
            <h2>n8n Credential Metadata</h2>
            <p>Read-only credentials from the selected n8n instance. Secret values are never displayed.</p>
          </div>
        </div>
        <table className="module-table">
          <thead><tr><th>Name</th><th>Type</th><th>ID</th><th>Project</th><th>Updated</th></tr></thead>
          <tbody>
            {filtered.map((credential) => (
              <tr key={String(credential.id || `${credential.name}-${credential.type}`)}>
                <td>
                  <strong>{credential.name || "Untitled credential"}</strong>
                  {credential.isManaged && <small className="warning-text">Managed credential</small>}
                </td>
                <td><span className="pill">{formatCredentialType(credential.type)}</span></td>
                <td><code>{String(credential.id || "unknown")}</code></td>
                <td>{formatProjectName(credential)}</td>
                <td>{formatRelativeTime(credential.updatedAt || credential.createdAt)}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} className="empty-cell">No n8n credentials found for this instance.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="module-card">
        <div className="module-card-head">
          <div className="module-icon alt">M</div>
          <div>
            <h2>Transferred Workflow Credential Setup</h2>
            <p>Choose this n8n instance's credentials for transferred workflows, then activate them.</p>
          </div>
        </div>
        <div className="credential-map-list">
          {workflowSetups.map((workflow) => (
            <article className="credential-map-card" key={workflow.id}>
              <div className="credential-map-head">
                <div>
                  <strong>{workflow.workflow_name}</strong>
                  <small>Target workflow: {workflow.target_workflow_id}</small>
                  {workflow.activation_error && <small className="warning-text">{workflow.activation_error}</small>}
                </div>
                <span className={workflow.requirements.length ? "pill" : "pill ok"}>{workflow.requirements.length} credential type(s)</span>
              </div>
              {workflow.requirements.length === 0 ? (
                <div className="credential-empty">No credential requirements detected in this workflow.</div>
              ) : (
                <div className="credential-map-grid">
                  {workflow.requirements.map((requirement) => {
                    const options = credentialOptionsFor(requirement.type);
                    return (
                      <label className="field" key={requirement.type}>
                        <span>{formatCredentialType(requirement.type)}</span>
                        <select
                          className="input"
                          value={mappings[workflow.id]?.[requirement.type] || ""}
                          onChange={(event) => setMappings((current) => ({
                            ...current,
                            [workflow.id]: { ...(current[workflow.id] || {}), [requirement.type]: event.target.value },
                          }))}
                        >
                          <option value="">Select credential</option>
                          {options.map((credential) => (
                            <option key={String(credential.id)} value={String(credential.id)}>
                              {credential.name || credential.id}{credential.type !== requirement.type ? ` (${formatCredentialType(credential.type)})` : ""}
                            </option>
                          ))}
                        </select>
                        <small className="field-help">Used by: {requirement.nodes.join(", ")}</small>
                      </label>
                    );
                  })}
                </div>
              )}
              <button className="btn success" type="button" onClick={() => applyWorkflowMapping(workflow)} disabled={applyingId === workflow.id || workflow.requirements.length === 0}>
                {applyingId === workflow.id ? "Activating..." : "Map Credentials & Activate"}
              </button>
            </article>
          ))}
          {workflowSetups.length === 0 && <div className="empty-card">No transferred workflows found for this n8n instance.</div>}
        </div>
      </div>
    </section>
  );
}

function formatCredentialType(type?: string) {
  return String(type || "unknown")
    .replace(/^n8n-nodes-base\./, "")
    .replace(/^@n8n\/n8n-nodes-langchain\./, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatProjectName(credential: N8nCredentialItem) {
  const homeProject = credential.homeProject;
  if (homeProject && typeof homeProject === "object" && "name" in homeProject) {
    return String((homeProject as { name?: unknown }).name || "Home project");
  }
  return credential.projectId || "Default";
}

function getExecutionStatus(execution: Record<string, unknown>) {
  const raw = String(execution.status || "").toLowerCase();
  if (raw.includes("success") || raw === "completed" || execution.finished === true) return "success";
  if (raw.includes("error") || raw.includes("failed") || execution.finished === false) return "error";
  if (raw.includes("running")) return "running";
  if (raw.includes("wait")) return "waiting";
  return raw || "success";
}

function getNestedName(execution: Record<string, unknown>, key: string) {
  const nested = execution[key];
  if (nested && typeof nested === "object" && "name" in nested) {
    return String((nested as { name?: unknown }).name || "");
  }
  return "";
}

function getWorkflowName(execution: Record<string, unknown>) {
  return String(execution.workflowName || getNestedName(execution, "workflow") || execution.workflowId || "Untitled workflow");
}

function getExecutionDuration(execution: Record<string, unknown>) {
  const direct = Number(execution.duration || execution.executionTime || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const start = new Date(String(execution.startedAt || execution.createdAt || "")).getTime();
  const stop = new Date(String(execution.stoppedAt || execution.finishedAt || "")).getTime();
  if (Number.isFinite(start) && Number.isFinite(stop) && stop > start) return stop - start;
  return 0;
}

function formatDuration(duration: number) {
  if (!duration) return "0ms";
  if (duration < 1000) return `${duration}ms`;
  return `${(duration / 1000).toFixed(1)}s`;
}

function formatRelativeTime(value: unknown) {
  const timestamp = new Date(String(value || "")).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}

function buildExecutionHistory(executions: Array<Record<string, unknown>>) {
  const now = new Date();
  return Array.from({ length: 24 }, (_, index) => {
    const hour = new Date(now.getTime() - (23 - index) * 60 * 60 * 1000);
    const label = `${String(hour.getHours()).padStart(2, "0")}:00`;
    const total = executions.filter((execution) => {
      const timestamp = new Date(String(execution.startedAt || execution.createdAt || "")).getTime();
      return Number.isFinite(timestamp) && new Date(timestamp).getHours() === hour.getHours();
    }).length;
    return { label, total };
  });
}

function workflowSummaryRows(executions: Array<Record<string, unknown>>) {
  const map = new Map<string, Record<string, unknown>>();
  executions.forEach((execution) => {
    const name = getWorkflowName(execution);
    if (!map.has(name)) {
      map.set(name, { ...execution, id: execution.workflowId || execution.id, workflowName: name });
    }
  });
  return Array.from(map.values());
}

function findDeepString(data: unknown, keys: string[]): string {
  if (Array.isArray(data)) {
    for (const item of data) {
      const value = findDeepString(item, keys);
      if (value) return value;
    }
  }
  if (typeof data === "object" && data) {
    const record = data as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" || typeof value === "number") return String(value);
    }
    for (const value of Object.values(record)) {
      const nested = findDeepString(value, keys);
      if (nested) return nested;
    }
  }
  return "";
}

function WorkflowForms({ currentUser }: { currentUser: CurrentUser }) {
  const [schemas, setSchemas] = useState<WorkflowSchema[]>([]);
  const [missingSchemas, setMissingSchemas] = useState<MissingWorkflowSchema[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"idle" | "info" | "ok" | "err">("idle");
  const [resultLink, setResultLink] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadSchemas() {
    const data = await api<{ schemas: WorkflowSchema[]; missingSchemas?: MissingWorkflowSchema[] }>("/api/workflow-schemas");
    setSchemas(data.schemas);
    setMissingSchemas(data.missingSchemas || []);
    if (!selectedId && data.schemas[0]) setSelectedId(data.schemas[0].source_workflow_id);
  }

  useEffect(() => {
    loadSchemas().catch((error) => setMessage(error instanceof Error ? error.message : "Could not load workflow schemas"));
  }, []);

  const selectedSchema = schemas.find((schema) => schema.source_workflow_id === selectedId) || null;

  useEffect(() => {
    const next: Record<string, string> = {};
    (selectedSchema?.fields || []).forEach((field) => {
      next[field.id] = field.defaultValue !== undefined ? String(field.defaultValue) : "";
    });
    setValues(next);
  }, [selectedSchema?.source_workflow_id]);

  async function syncSchemas() {
    setBusy(true);
    setMessage("");
    setResultLink("");
    setStatusTone("info");
    try {
      const result = await api<{ synced: number }>("/api/workflow-schemas/sync", { method: "POST", body: JSON.stringify({}) });
      setMessage(`Synced ${result.synced} workflow schema(s).`);
      pushToast(`Synced ${result.synced} workflow schema(s).`, "success");
      setStatusTone("ok");
      await loadSchemas();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Schema sync failed";
      setMessage(text);
      pushToast(text, "error");
      setStatusTone("err");
    } finally {
      setBusy(false);
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSchema) return;
    const missing = (selectedSchema.fields || []).filter((field) => field.required && !values[field.id]?.trim());
    if (missing.length) {
      setMessage(`Missing required fields: ${missing.map((field) => field.label).join(", ")}`);
      setStatusTone("err");
      return;
    }
    setBusy(true);
    setMessage("Sending to workflow...");
    setResultLink("");
    setStatusTone("info");
    try {
      const result = await api<{ ok: boolean; response?: unknown }>("/api/workflow-schemas/submit", {
        method: "POST",
        body: JSON.stringify({ sourceWorkflowId: selectedSchema.source_workflow_id, values }),
      });
      const responseMessage = findDeepString(result.response, ["message", "status", "result"]);
      const googleSheetUrl = findDeepString(result.response, ["googleSheetUrl", "google_sheet_url", "sheetUrl", "spreadsheetUrl"]);
      const text = responseMessage || "Workflow triggered. Check the output destination configured in n8n.";
      setMessage(text);
      pushToast(text, "success");
      setResultLink(googleSheetUrl);
      setStatusTone("ok");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Workflow form submit failed";
      setMessage(text);
      pushToast(text, "error");
      setStatusTone("err");
    } finally {
      setBusy(false);
    }
  }

  function renderField(field: NonNullable<WorkflowSchema["fields"]>[number]) {
    const commonProps = {
      className: "input",
      value: values[field.id] || "",
      placeholder: field.placeholder || "",
      required: Boolean(field.required),
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues((current) => ({ ...current, [field.id]: event.target.value })),
    };
    if (field.type === "textarea") {
      return <textarea {...commonProps} rows={4} />;
    }
    if (field.type === "select" && field.options?.length) {
      return (
        <select {...commonProps}>
          <option value="">Select {field.label}</option>
          {field.options.map((option) => {
            const label = typeof option === "string" ? option : option.label;
            const value = typeof option === "string" ? option : String(option.value);
            return <option key={value} value={value}>{label}</option>;
          })}
        </select>
      );
    }
    return <input {...commonProps} type={field.type || "text"} min={field.min} max={field.max} />;
  }

  return (
    <section className="workflow-form-page">
      <div className="module-toolbar">
        <label className="module-search">
          <span>▣</span>
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            <option value="">Select workflow form</option>
            {schemas.map((schema) => (
              <option key={schema.source_workflow_id} value={schema.source_workflow_id}>
                {schema.name}{schema.execution_mode === "admin_n8n" ? " (admin n8n)" : schema.target_workflow_id ? ` (${schema.target_workflow_id})` : ""}
              </option>
            ))}
          </select>
        </label>
        {currentUser.role === "admin" && <button className="btn" type="button" onClick={syncSchemas} disabled={busy}>Sync schemas from n8n</button>}
        <span className="module-count">{schemas.length} available</span>
      </div>

      <div className="module-layout email-layout">
        <form className="module-card" onSubmit={submitForm}>
          <div className="module-card-head">
            <div className="module-icon">F</div>
            <div>
              <h2>{selectedSchema?.name || "Workflow Form"}</h2>
              <p>{currentUser.role === "admin" ? "Admin sees every synced schema." : "Transferred workflows and admin-granted tools are available here."}</p>
            </div>
          </div>

          {!selectedSchema && (
            <div className="empty-card">
              {missingSchemas.length
                ? "You have transferred workflows, but their form schemas are not synced in Postgres yet."
                : "No workflow schema available. Admin can sync schemas from n8n."}
            </div>
          )}
          {(selectedSchema?.fields || []).map((field) => (
            <label className="field" key={field.id}>
              <span>{field.label}{field.required ? " *" : ""}</span>
              {renderField(field)}
              {field.helpText && <small className="field-help">{field.helpText}</small>}
            </label>
          ))}
          {(message || resultLink) && (
            <div className={`form-status ${statusTone}`}>
              <span>{message}</span>
              {resultLink && <a href={resultLink} target="_blank" rel="noreferrer">Open Google Sheet</a>}
            </div>
          )}
          <button className="btn success" type="submit" disabled={busy || !selectedSchema}>{busy ? "Running..." : "Run Selected Workflow"}</button>
        </form>

        <div className="module-card preview-card">
          <div className="module-card-head">
            <div className="module-icon alt">S</div>
            <div>
              <h2>Schema Details</h2>
              <p>Stored in Postgres from the admin n8n schema source.</p>
            </div>
          </div>
          {selectedSchema ? (
            <table className="module-table">
              <tbody>
                <tr><th>Source workflow</th><td>{selectedSchema.source_workflow_id}</td></tr>
                <tr><th>Target workflow</th><td>{selectedSchema.target_workflow_id || "Admin schema"}</td></tr>
                <tr><th>Execution</th><td>{selectedSchema.execution_mode === "admin_n8n" ? "Admin n8n" : selectedSchema.target_workflow_id ? "User n8n" : "Admin n8n"}</td></tr>
                <tr><th>Action</th><td>{selectedSchema.action || "Not set"}</td></tr>
                <tr><th>Webhook</th><td>{selectedSchema.webhook_url || "Not set"}</td></tr>
                <tr><th>Fields</th><td>{selectedSchema.fields?.length || 0}</td></tr>
              </tbody>
            </table>
          ) : (
            <div className="empty-card">
              {missingSchemas.length ? (
                <>
                  <strong>Missing form schema</strong>
                  {missingSchemas.map((item) => (
                    <small key={`${item.source_workflow_id}-${item.target_workflow_id}`}>
                      Source {item.source_workflow_id} → Target {item.target_workflow_id} on {item.target_base_url}
                    </small>
                  ))}
                </>
              ) : "Select a workflow form to inspect its schema."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

type LibraryKind = "kb" | "prompts" | "webhooks" | "mcp" | "credential-store";

const libraryConfig: Record<LibraryKind, {
  collectionKey: string;
  primaryLabel: string;
  secondaryLabel: string;
  valueLabel: string;
  valuePlaceholder: string;
  statusOptions?: string[];
}> = {
  kb: {
    collectionKey: "articles",
    primaryLabel: "Article",
    secondaryLabel: "Status",
    valueLabel: "Article body",
    valuePlaceholder: "Write SOP, setup notes, or internal documentation...",
    statusOptions: ["draft", "published", "archived"],
  },
  prompts: {
    collectionKey: "prompts",
    primaryLabel: "Prompt",
    secondaryLabel: "Status",
    valueLabel: "Prompt content",
    valuePlaceholder: "Paste the reusable prompt text...",
    statusOptions: ["draft", "published", "archived"],
  },
  webhooks: {
    collectionKey: "webhooks",
    primaryLabel: "Webhook",
    secondaryLabel: "Events",
    valueLabel: "Destination URL",
    valuePlaceholder: "https://hooks.example.com/nexus",
  },
  mcp: {
    collectionKey: "servers",
    primaryLabel: "MCP Server",
    secondaryLabel: "Type",
    valueLabel: "URL or command",
    valuePlaceholder: "https://mcp.example.com or npx -y server",
  },
  "credential-store": {
    collectionKey: "credentials",
    primaryLabel: "Credential",
    secondaryLabel: "Type",
    valueLabel: "Credential type",
    valuePlaceholder: "slackApi, openAiApi, postgres, custom...",
  },
};

function SimpleLibrary({ kind, title }: { kind: LibraryKind; title: string }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const { requestConfirm, confirmDialog } = useConfirmDialog();
  const endpoint = `/api/library/${kind}`;
  const config = libraryConfig[kind];

  async function load() {
    const data = await api<Record<string, Array<Record<string, unknown>>>>(endpoint);
    setItems(data[config.collectionKey] || []);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") || "");
    const value = String(form.get("value") || "");
    const status = String(form.get("status") || "");
    const body = buildLibraryPayload(kind, name, value, status);
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify(body) });
      formElement.reset();
      setMessage("Saved.");
      pushToast(`${title} saved.`, "success");
      load();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Save failed";
      setMessage(text);
      pushToast(text, "error");
    }
  }

  async function removeItem(item: Record<string, unknown>) {
    requestConfirm({
      title: `Delete ${title}`,
      message: `Delete "${String(item.title || item.name)}" from ${title}?`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        setMessage("");
        try {
          await api(`${endpoint}/${item.id}`, { method: "DELETE" });
          setMessage("Deleted.");
          pushToast(`${title} deleted.`, "success");
          load();
        } catch (error) {
          const text = error instanceof Error ? error.message : "Delete failed";
          setMessage(text);
          pushToast(text, "error");
        }
      },
    });
  }

  useEffect(() => {
    load().catch(console.error);
  }, [kind]);

  const filteredItems = items.filter((item) => {
    const haystack = JSON.stringify(item).toLowerCase();
    const status = String(item.status || "").toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (!statusFilter || status === statusFilter);
  });

  return (
    <section className="library-module">
      {confirmDialog}
      <div className="module-toolbar">
        <label className="module-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} />
        </label>
        {config.statusOptions && (
          <select className="monitor-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All Statuses</option>
            {config.statusOptions.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
          </select>
        )}
        <span className="module-count">{filteredItems.length} item{filteredItems.length === 1 ? "" : "s"}</span>
      </div>

      <div className="module-layout">
        <form className="module-card" onSubmit={submit}>
          <div className="module-card-head">
            <div className="module-icon">{title.slice(0, 1)}</div>
            <div>
              <h2>Add {config.primaryLabel}</h2>
              <p>{sectionDescriptions[kind === "credential-store" ? "credentials" : kind]}</p>
            </div>
          </div>
          <label className="field"><span>Name / Title</span><input className="input" name="name" required /></label>
          {config.statusOptions && (
            <label className="field">
              <span>Status</span>
              <select className="input" name="status" defaultValue={kind === "kb" ? "published" : "draft"}>
                {config.statusOptions.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
              </select>
            </label>
          )}
          <label className="field">
            <span>{config.valueLabel}</span>
            <textarea className="input" name="value" rows={kind === "webhooks" || kind === "mcp" || kind === "credential-store" ? 3 : 8} placeholder={config.valuePlaceholder} />
          </label>
          <div className="error">{message}</div>
          <button className="btn" type="submit">Save {config.primaryLabel}</button>
        </form>

        <div className="module-card module-list-card">
          <div className="module-card-head">
            <div className="module-icon alt">{filteredItems.length}</div>
            <div>
              <h2>{title}</h2>
              <p>Search, review, and manage saved records.</p>
            </div>
          </div>
          <table className="module-table">
            <thead><tr><th>Name</th><th>{config.secondaryLabel}</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={String(item.id)}>
                  <td>
                    <strong>{String(item.title || item.name)}</strong>
                    <small>{itemSummary(kind, item)}</small>
                  </td>
                  <td>{renderLibraryBadge(kind, item)}</td>
                  <td>{formatDate(String(item.updated_at || item.created_at || ""))}</td>
                  <td><button className="table-action danger-action" type="button" onClick={() => removeItem(item)}>Delete</button></td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr><td colSpan={4} className="empty-cell">No records found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function buildLibraryPayload(kind: string, name: string, value: string, status = "") {
  if (kind === "kb") return { title: name, body: value, status: status || "published", tags: [] };
  if (kind === "prompts") return { name, content: value, variables: extractVariables(value), status: status || "draft" };
  if (kind === "webhooks") return { name, url: value, events: ["workflow.failed"], enabled: true };
  if (kind === "mcp") return { name, type: value.startsWith("http") ? "http" : "stdio", url: value.startsWith("http") ? value : "", command: value.startsWith("http") ? "" : value, args: [], enabled: true };
  return { name, credentialType: value || "generic", sharedData: { note: "Add encrypted fields here" }, userFields: [], allowedRoles: ["admin", "user"] };
}

function extractVariables(value: string) {
  return Array.from(new Set(Array.from(value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)).map((match) => match[1])));
}

function itemSummary(kind: LibraryKind, item: Record<string, unknown>) {
  if (kind === "kb") return String(item.body || "").slice(0, 120) || "No article body yet";
  if (kind === "prompts") return String(item.content || "").slice(0, 120) || "No prompt content yet";
  if (kind === "webhooks") return String(item.url || "");
  if (kind === "mcp") return String(item.url || item.command || "");
  return String(item.credential_type || "");
}

function renderLibraryBadge(kind: LibraryKind, item: Record<string, unknown>) {
  if (kind === "webhooks") return <span className={item.enabled ? "pill ok" : "pill warn"}>{item.enabled ? "Enabled" : "Disabled"}</span>;
  if (kind === "mcp") return <span className={item.enabled ? "pill ok" : "pill warn"}>{String(item.type || "http")}</span>;
  if (kind === "credential-store") return <span className="pill">{String(item.credential_type || "generic")}</span>;
  const status = String(item.status || "draft");
  return <span className={status === "published" ? "pill ok" : "pill warn"}>{titleCase(status)}</span>;
}

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

type EmailTemplateRow = {
  id?: number;
  template_key: string;
  key?: string;
  label: string;
  subject: string;
  body: string;
  updated_at?: string;
};

function EmailTemplates() {
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([]);
  const [selectedKey, setSelectedKey] = useState("welcome");
  const [label, setLabel] = useState("Welcome email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const variables = ["{{app_name}}", "{{username}}", "{{reset_url}}", "{{workflow_name}}", "{{primary_color}}"];

  async function load() {
    const data = await api<{ defaults: Record<string, { label: string; subject: string; body: string }>; templates: EmailTemplateRow[] }>("/api/library/email-templates");
    const custom = new Map(data.templates.map((template) => [template.template_key, template]));
    const merged = Object.entries(data.defaults).map(([key, value]) => ({ key, template_key: key, ...value, ...(custom.get(key) || {}) }));
    setTemplates(merged);
    const active = merged.find((template) => template.template_key === selectedKey) || merged[0];
    if (active) applyTemplate(active);
  }

  function applyTemplate(template: EmailTemplateRow) {
    setSelectedKey(template.template_key || template.key || "welcome");
    setLabel(template.label);
    setSubject(template.subject);
    setBody(template.body);
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await api("/api/library/email-templates", {
        method: "POST",
        body: JSON.stringify({ key: selectedKey, label, subject, body }),
      });
      setMessage("Template saved.");
      pushToast("Email template saved.", "success");
      load();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Save failed";
      setMessage(text);
      pushToast(text, "error");
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <section className="module-layout email-layout">
      <form className="module-card" onSubmit={saveTemplate}>
        <div className="module-card-head">
          <div className="module-icon">E</div>
          <div>
            <h2>Email Templates</h2>
            <p>Customize reusable notification content.</p>
          </div>
        </div>
        <label className="field">
          <span>Template</span>
          <select className="input" value={selectedKey} onChange={(event) => {
            const next = templates.find((template) => template.template_key === event.target.value);
            if (next) applyTemplate(next);
          }}>
            {templates.map((template) => <option key={template.template_key} value={template.template_key}>{template.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Label</span><input className="input" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <label className="field"><span>Subject</span><input className="input" value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <label className="field"><span>Body HTML</span><textarea className="input mono-input" rows={12} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        <div className="variable-row">
          {variables.map((variable) => <button key={variable} className="table-action" type="button" onClick={() => setBody((current) => `${current}${variable}`)}>{variable}</button>)}
        </div>
        <div className="error">{message}</div>
        <button className="btn" type="submit">Save Template</button>
      </form>

      <div className="module-card preview-card">
        <div className="module-card-head">
          <div className="module-icon alt">P</div>
          <div>
            <h2>Preview</h2>
            <p>Rendered sample with Automation Hub variables.</p>
          </div>
        </div>
        <div className="email-preview">
          <strong>{renderTemplate(subject)}</strong>
          <div dangerouslySetInnerHTML={{ __html: renderTemplate(body) }} />
        </div>
      </div>
    </section>
  );
}

function renderTemplate(value: string) {
  return value
    .replaceAll("{{app_name}}", "Automation Hub")
    .replaceAll("{{username}}", "Shekhar")
    .replaceAll("{{reset_url}}", "https://nexus.local/reset")
    .replaceAll("{{workflow_name}}", "Template for YouTube transcript")
    .replaceAll("{{primary_color}}", "#10a7a7");
}

type ApiKeyRow = {
  id: number;
  name: string;
  key_prefix: string;
  last_used_at?: string;
  expires_at?: string;
  created_at?: string;
};

function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [newKey, setNewKey] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const { requestConfirm, confirmDialog } = useConfirmDialog();

  async function load() {
    const data = await api<{ keys: ApiKeyRow[] }>("/api/api-keys");
    setKeys(data.keys);
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const expires = String(form.get("expires") || "");
    try {
      const result = await api<{ key: string }>("/api/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
        }),
      });
      setNewKey(result.key);
      setMessage("API key created. Copy it now.");
      pushToast("API key created. Copy it now.", "success");
      event.currentTarget.reset();
      load();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not create API key";
      setMessage(text);
      pushToast(text, "error");
    }
  }

  async function deleteKey(key: ApiKeyRow) {
    requestConfirm({
      title: "Revoke API key",
      message: `Revoke "${key.name}"? Any client using this key will lose access immediately.`,
      confirmLabel: "Revoke key",
      danger: true,
      onConfirm: async () => {
        await api(`/api/api-keys/${key.id}`, { method: "DELETE" });
        setMessage("API key revoked.");
        pushToast("API key revoked.", "success");
        load();
      },
    });
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const filtered = keys.filter((key) => `${key.name} ${key.key_prefix}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <section className="library-module">
      {confirmDialog}
      <div className="module-toolbar">
        <label className="module-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search API keys..." /></label>
        <span className="module-count">{filtered.length} key{filtered.length === 1 ? "" : "s"}</span>
      </div>
      {newKey && (
        <div className="copy-banner">
          <span><strong>API key created:</strong> <code>{newKey}</code></span>
          <button className="table-action" type="button" onClick={() => navigator.clipboard.writeText(newKey)}>Copy</button>
          <button className="table-action" type="button" onClick={() => setNewKey("")}>Dismiss</button>
        </div>
      )}
      <div className="module-layout">
        <form className="module-card" onSubmit={createKey}>
          <div className="module-card-head">
            <div className="module-icon">K</div>
            <div>
              <h2>New API Key</h2>
              <p>Generate keys for programmatic Automation Hub API access.</p>
            </div>
          </div>
          <label className="field"><span>Name</span><input className="input" name="name" required placeholder="Production sync key" /></label>
          <label className="field"><span>Expires optional</span><input className="input" name="expires" type="date" /></label>
          <div className="error">{message}</div>
          <button className="btn" type="submit">Create Key</button>
        </form>
        <div className="module-card module-list-card">
          <div className="module-card-head">
            <div className="module-icon alt">{filtered.length}</div>
            <div>
              <h2>API Keys</h2>
              <p>Review prefixes, expiry, usage, and revoke access.</p>
            </div>
          </div>
          <table className="module-table">
            <thead><tr><th>Name</th><th>Prefix</th><th>Last Used</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {filtered.map((key) => (
                <tr key={key.id}>
                  <td><strong>{key.name}</strong><small>Created {formatDate(key.created_at)}</small></td>
                  <td><code>{key.key_prefix}...</code></td>
                  <td>{key.last_used_at ? formatDate(key.last_used_at) : "Never"}</td>
                  <td>{key.expires_at ? formatDate(key.expires_at) : "No expiry"}</td>
                  <td><button className="table-action danger-action" type="button" onClick={() => deleteKey(key)}>Revoke</button></td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={5} className="empty-cell">No API keys found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function AuditLog() {
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [attempts, setAttempts] = useState<AuditRow[]>([]);
  const [view, setView] = useState<"attempts" | "audit">("attempts");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const pageSize = 10;

  async function load() {
    setMessage("");
    try {
      const data = await api<{ audit: AuditRow[]; attempts: AuditRow[] }>("/api/admin/audit?limit=100");
      setAudit(data.audit);
      setAttempts(data.attempts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load audit log");
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const rows = view === "attempts" ? attempts : audit;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <section className="library-module">
      <div className="module-toolbar">
        <button className={view === "attempts" ? "filter-chip active" : "filter-chip"} type="button" onClick={() => { setView("attempts"); setPage(1); }}>Workflow Attempts</button>
        <button className={view === "audit" ? "filter-chip active" : "filter-chip"} type="button" onClick={() => { setView("audit"); setPage(1); }}>Audit Records</button>
        <button className="btn" type="button" onClick={load}>Refresh</button>
        <span className="module-count">{rows.length} record(s)</span>
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="module-card">
        <div className="module-card-head">
          <div className="module-icon">A</div>
          <div>
            <h2>{view === "attempts" ? "Workflow Operation Attempts" : "Application Audit Log"}</h2>
            <p>Recent transfer, activation, credential mapping, delete, and admin operations.</p>
          </div>
        </div>
        <table className="module-table">
          <thead><tr><th>Status</th><th>Action</th><th>User</th><th>Workflow</th><th>Message</th><th>Time</th></tr></thead>
          <tbody>
            {visible.map((row) => (
              <tr key={`${view}-${row.id}`}>
                <td><span className={row.status === "error" ? "pill warn" : row.status === "success" ? "pill ok" : "pill"}>{row.status || "record"}</span></td>
                <td>{row.operation || row.action}</td>
                <td><strong>{row.user_name || "System"}</strong><small>{row.user_email || ""}</small></td>
                <td><code>{row.target_workflow_id || row.source_workflow_id || row.entity_id || "n/a"}</code></td>
                <td>{row.message || row.entity_type || "Recorded"}</td>
                <td>{formatRelativeTime(row.created_at)}</td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={6} className="empty-cell">No audit records found.</td></tr>}
          </tbody>
        </table>
        <div className="pagination-row">
          <button className="table-action" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="table-action" type="button" onClick={() => setPage((current) => Math.min(pages, current + 1))} disabled={page === pages}>Next</button>
        </div>
      </div>
    </section>
  );
}

function formatDate(value?: string) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString();
}

function shortNodeName(value: string) {
  const cleaned = value
    .replace(/^n8n-nodes-base\./, "")
    .replace(/^@n8n\/n8n-nodes-langchain\./, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return cleaned.length > 16 ? `${cleaned.slice(0, 14)}...` : cleaned;
}

function Users() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [workflowAccessUsers, setWorkflowAccessUsers] = useState<WorkflowAccessUser[]>([]);
  const [toolSchemas, setToolSchemas] = useState<InternalToolSchema[]>([]);
  const [internalToolUsers, setInternalToolUsers] = useState<InternalToolAccessUser[]>([]);
  const [toolAccessDraft, setToolAccessDraft] = useState({ userId: "", sourceWorkflowIds: [] as string[] });
  const [toolSearch, setToolSearch] = useState("");
  const [accessUserSearch, setAccessUserSearch] = useState("");
  const [credentialUserSearch, setCredentialUserSearch] = useState("");
  const [workflowAccessSearch, setWorkflowAccessSearch] = useState("");
  const [usersTableSearch, setUsersTableSearch] = useState("");
  const [accessPage, setAccessPage] = useState(1);
  const [message, setMessage] = useState("");
  const [credentialDraft, setCredentialDraft] = useState({
    userId: "",
    credentialId: "",
    connectionName: "",
    environment: "production",
    baseUrl: "",
    apiKey: "",
    isDefault: true,
  });
  const { requestConfirm, confirmDialog } = useConfirmDialog();

  async function loadUsers() {
    const data = await api<{ users: UserItem[] }>("/api/users");
    setUsers(data.users);
  }

  async function loadWorkflowAccess() {
    const data = await api<{ users: WorkflowAccessUser[] }>("/api/admin/user-workflow-access");
    setWorkflowAccessUsers(data.users);
  }

  async function loadInternalToolAccess() {
    const data = await api<{ schemas: InternalToolSchema[]; users: InternalToolAccessUser[] }>("/api/admin/internal-tool-access");
    setToolSchemas(data.schemas);
    setInternalToolUsers(data.users);
  }

  useEffect(() => {
    loadUsers().catch(console.error);
    loadWorkflowAccess().catch(console.error);
    loadInternalToolAccess().catch(console.error);
  }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ user: UserItem }>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          role: form.get("role"),
          password: form.get("password") || undefined,
        }),
      });
      setMessage(`Created user ${result.user.email}.`);
      pushToast(`Created user ${result.user.email}.`, "success");
      event.currentTarget.reset();
      loadUsers();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not create user";
      setMessage(text);
      pushToast(text, "error");
    }
  }

  async function saveUserN8nCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const isEditing = Boolean(credentialDraft.credentialId);
    try {
      await api(`/api/users/${credentialDraft.userId}/n8n-credentials`, {
        method: isEditing ? "PUT" : "POST",
        body: JSON.stringify({
          credentialId: isEditing ? Number(credentialDraft.credentialId) : undefined,
          name: credentialDraft.connectionName,
          environment: credentialDraft.environment,
          baseUrl: credentialDraft.baseUrl,
          apiKey: credentialDraft.apiKey || undefined,
          isDefault: credentialDraft.isDefault,
        }),
      });
      const text = isEditing ? "User n8n credentials updated and verified." : "User n8n credentials verified and saved encrypted.";
      setMessage(text);
      pushToast(text, "success");
      resetCredentialDraft();
      loadUsers();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not save n8n credentials";
      setMessage(text);
      pushToast(text, "error");
    }
  }

  function resetCredentialDraft() {
    setCredentialDraft({
      userId: "",
      credentialId: "",
      connectionName: "",
      environment: "production",
      baseUrl: "",
      apiKey: "",
      isDefault: true,
    });
  }

  function editCredential(user: UserItem, credential: NonNullable<UserItem["n8n_credentials"]>[number]) {
    setCredentialDraft({
      userId: String(user.id),
      credentialId: String(credential.id),
      connectionName: credential.name,
      environment: credential.environment,
      baseUrl: credential.base_url,
      apiKey: "",
      isDefault: credential.is_default,
    });
    setMessage("Editing credential. Leave API key blank to keep existing key.");
  }

  function editInternalToolAccess(userId: number) {
    const access = internalToolUsers.find((item) => item.user_id === userId);
    setToolAccessDraft({
      userId: String(userId),
      sourceWorkflowIds: access?.tools.map((tool) => tool.source_workflow_id) || [],
    });
    setMessage("Editing internal tool access for selected user.");
  }

  async function saveInternalToolAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const result = await api<{ granted: number }>("/api/admin/internal-tool-access", {
        method: "POST",
        body: JSON.stringify({
          userId: Number(toolAccessDraft.userId),
          sourceWorkflowIds: toolAccessDraft.sourceWorkflowIds,
        }),
      });
      const text = `Internal tool access updated. ${result.granted} tool(s) granted.`;
      setMessage(text);
      pushToast(text, "success");
      await loadInternalToolAccess();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not update internal tool access";
      setMessage(text);
      pushToast(text, "error");
    }
  }

  function toggleToolAccess(sourceWorkflowId: string) {
    setToolAccessDraft((draft) => ({
      ...draft,
      sourceWorkflowIds: draft.sourceWorkflowIds.includes(sourceWorkflowId)
        ? draft.sourceWorkflowIds.filter((id) => id !== sourceWorkflowId)
        : [...draft.sourceWorkflowIds, sourceWorkflowId],
    }));
  }

  async function deleteCredential(user: UserItem, credential: NonNullable<UserItem["n8n_credentials"]>[number]) {
    requestConfirm({
      title: "Delete user n8n credentials",
      message: `Delete "${credential.name}" for ${user.name}? The encrypted API key will be removed from Automation Hub.`,
      confirmLabel: "Delete credentials",
      danger: true,
      onConfirm: async () => {
        setMessage("");
        try {
          await api(`/api/users/${user.id}/n8n-credentials/${credential.id}`, { method: "DELETE" });
          setMessage("User n8n credential deleted.");
          pushToast("User n8n credential deleted.", "success");
          if (credentialDraft.credentialId === String(credential.id)) resetCredentialDraft();
          loadUsers();
        } catch (error) {
          const text = error instanceof Error ? error.message : "Could not delete n8n credential";
          setMessage(text);
          pushToast(text, "error");
        }
      },
    });
  }

  async function deleteTransferredWorkflow(access: WorkflowAccessItem, userName: string) {
    requestConfirm({
      title: "Delete transferred workflow",
      message: `Delete "${access.workflow_name}" from ${userName}'s n8n and remove this user's access record?`,
      confirmLabel: "Delete from n8n",
      danger: true,
      onConfirm: async () => {
        setMessage("");
        try {
          await api(`/api/admin/user-workflow-access/${access.id}`, { method: "DELETE" });
          const text = `Deleted transferred workflow ${access.target_workflow_id} from ${userName}'s n8n and removed access.`;
          setMessage(text);
          pushToast(text, "success");
          await loadWorkflowAccess();
        } catch (error) {
          const text = error instanceof Error ? error.message : "Could not delete transferred workflow";
          setMessage(text);
          pushToast(text, "error");
        }
      },
    });
  }

  const filteredToolSchemas = toolSchemas.filter((schema) => {
    const haystack = `${schema.name} ${schema.source_workflow_id} ${schema.action || ""}`.toLowerCase();
    return !toolSearch || haystack.includes(toolSearch.toLowerCase());
  });
  const userAccounts = useMemo(() => users.filter((user) => user.role === "user"), [users]);
  const filteredCredentialUsers = useMemo(() => {
    const query = credentialUserSearch.trim().toLowerCase();
    if (!query) return userAccounts;
    return userAccounts.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(query));
  }, [credentialUserSearch, userAccounts]);
  const filteredWorkflowAccessUsers = useMemo(() => {
    const query = workflowAccessSearch.trim().toLowerCase();
    if (!query) return workflowAccessUsers;
    return workflowAccessUsers.filter((item) => {
      const haystack = `${item.user_name} ${item.user_email} ${item.workflows.map((workflow) => `${workflow.workflow_name} ${workflow.source_workflow_id} ${workflow.target_workflow_id} ${workflow.target_base_url}`).join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [workflowAccessSearch, workflowAccessUsers]);
  const filteredUsersTable = useMemo(() => {
    const query = usersTableSearch.trim().toLowerCase();
    if (!query) return users;
    return users.filter((item) => {
      const haystack = `${item.name} ${item.email} ${item.role} ${item.is_active ? "active" : "disabled"} ${(item.n8n_credentials || []).map((credential) => `${credential.name} ${credential.environment} ${credential.base_url}`).join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [usersTableSearch, users]);
  const accessPageSize = 6;
  const filteredInternalToolUsers = internalToolUsers.filter((item) => {
    const haystack = `${item.user_name} ${item.user_email} ${item.tools.map((tool) => tool.name).join(" ")}`.toLowerCase();
    return !accessUserSearch || haystack.includes(accessUserSearch.toLowerCase());
  });
  const accessPages = Math.max(1, Math.ceil(filteredInternalToolUsers.length / accessPageSize));
  const visibleInternalToolUsers = filteredInternalToolUsers.slice((accessPage - 1) * accessPageSize, accessPage * accessPageSize);

  return (
    <section className="section">
      {confirmDialog}
      <div className="two-col">
        <form className="card" onSubmit={createUser}>
          <h2>Create user account</h2>
          <label className="field"><span>Name</span><input className="input" name="name" required /></label>
          <label className="field"><span>Email</span><input className="input" name="email" type="email" required /></label>
          <label className="field">
            <span>Role</span>
            <select className="input" name="role" defaultValue="user">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="field"><span>Password</span><input className="input" name="password" type="password" minLength={8} required placeholder="Set password for this user" /></label>
          <button className="btn" type="submit">Create user</button>
        </form>

        <form className="card" onSubmit={saveUserN8nCredentials}>
          <h2>{credentialDraft.credentialId ? "Update user n8n credentials" : "Add user n8n credentials"}</h2>
          <div className="field">
            <span>User</span>
            <label className="module-search full-search">
              <span>⌕</span>
              <input value={credentialUserSearch} onChange={(event) => setCredentialUserSearch(event.target.value)} placeholder="Search users..." />
            </label>
            <select className="input" value={credentialDraft.userId} onChange={(event) => setCredentialDraft((draft) => ({ ...draft, userId: event.target.value }))} required disabled={Boolean(credentialDraft.credentialId)}>
              <option value="">Select user</option>
              {filteredCredentialUsers.map((user) => (
                <option key={user.id} value={user.id}>{user.name} - {user.email}</option>
              ))}
            </select>
          </div>
          <label className="field"><span>Connection name</span><input className="input" value={credentialDraft.connectionName} onChange={(event) => setCredentialDraft((draft) => ({ ...draft, connectionName: event.target.value }))} required placeholder="User production n8n" /></label>
          <label className="field"><span>Environment</span><input className="input" value={credentialDraft.environment} onChange={(event) => setCredentialDraft((draft) => ({ ...draft, environment: event.target.value }))} /></label>
          <label className="field"><span>Base URL</span><input className="input" value={credentialDraft.baseUrl} onChange={(event) => setCredentialDraft((draft) => ({ ...draft, baseUrl: event.target.value }))} type="url" required placeholder="https://n8n.example.com" /></label>
          <label className="field"><span>API Key</span><input className="input" value={credentialDraft.apiKey} onChange={(event) => setCredentialDraft((draft) => ({ ...draft, apiKey: event.target.value }))} type="password" required={!credentialDraft.credentialId} placeholder={credentialDraft.credentialId ? "Leave blank to keep existing key" : "n8n_api_..."} /></label>
          <label className="toolbar"><input type="checkbox" checked={credentialDraft.isDefault} onChange={(event) => setCredentialDraft((draft) => ({ ...draft, isDefault: event.target.checked }))} /> Make default for this user</label>
          <div className="toolbar">
            <button className="btn" type="submit">{credentialDraft.credentialId ? "Update and verify credentials" : "Verify and save credentials"}</button>
            {credentialDraft.credentialId && <button className="btn secondary" type="button" onClick={resetCredentialDraft}>Cancel edit</button>}
          </div>
        </form>
      </div>

      <div className="notice">{message}</div>
      <div className="access-manager">
        <form className="card access-editor" onSubmit={saveInternalToolAccess}>
          <div className="access-card-head">
            <div>
              <h2>Internal tool access</h2>
              <p className="muted">Grant admin n8n-powered forms to users without their own n8n.</p>
            </div>
            <span className="pill ok">{toolAccessDraft.sourceWorkflowIds.length} selected</span>
          </div>
          <div className="access-editor-controls">
            <label className="field compact-field">
              <span>User</span>
              <select
                className="input"
                value={toolAccessDraft.userId}
                onChange={(event) => {
                  if (!event.target.value) return setToolAccessDraft({ userId: "", sourceWorkflowIds: [] });
                  editInternalToolAccess(Number(event.target.value));
                }}
                required
              >
                <option value="">Select user</option>
                {userAccounts.map((user) => (
                  <option key={user.id} value={user.id}>{user.name} - {user.email}</option>
                ))}
              </select>
            </label>
            <label className="module-search access-search">
              <span>⌕</span>
              <input value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} placeholder="Search tools..." />
            </label>
          </div>
          <div className="access-picker-list">
            {filteredToolSchemas.map((schema) => (
              <label className={toolAccessDraft.sourceWorkflowIds.includes(schema.source_workflow_id) ? "access-tool-row selected" : "access-tool-row"} key={schema.source_workflow_id}>
                <input
                  type="checkbox"
                  checked={toolAccessDraft.sourceWorkflowIds.includes(schema.source_workflow_id)}
                  onChange={() => toggleToolAccess(schema.source_workflow_id)}
                />
                <span>
                  <strong>{schema.name}</strong>
                  <small>{schema.source_workflow_id} · {schema.field_count || 0} field(s)</small>
                </span>
                <em>Admin n8n</em>
              </label>
            ))}
            {filteredToolSchemas.length === 0 && <div className="empty-card">No synced workflow schemas found. Sync schemas from Internal Tool Forms first.</div>}
          </div>
          <div className="access-sticky-actions">
            <button className="btn" type="submit" disabled={!toolAccessDraft.userId}>Save access</button>
            <button className="btn secondary" type="button" onClick={() => setToolAccessDraft((draft) => ({ ...draft, sourceWorkflowIds: [] }))} disabled={!toolAccessDraft.userId}>Clear</button>
          </div>
        </form>
        <div className="table-card access-summary-card">
          <div className="access-card-head">
            <div>
              <h2>Admin n8n tool access</h2>
              <p className="muted">{filteredInternalToolUsers.length} user(s)</p>
            </div>
            <label className="module-search access-search">
              <span>⌕</span>
              <input value={accessUserSearch} onChange={(event) => { setAccessUserSearch(event.target.value); setAccessPage(1); }} placeholder="Search users..." />
            </label>
          </div>
          <div className="access-user-list">
            {visibleInternalToolUsers.map((item) => (
              <div className="access-user-card" key={item.user_id}>
                <div className="access-user-meta">
                  <strong>{item.user_name}</strong>
                  <small>{item.user_email}</small>
                  <span className={item.tools.length ? "pill ok" : "pill"}>{item.tools.length} tool(s)</span>
                </div>
                <div className="access-tool-chips">
                  {item.tools.length === 0 && <span className="credential-empty">No admin n8n tools granted</span>}
                  {item.tools.map((tool) => (
                    <span className="access-chip" key={tool.source_workflow_id} title={`${tool.name} · ${tool.source_workflow_id}`}>
                      <strong>{tool.name}</strong>
                      <small>{tool.field_count || 0} field(s)</small>
                    </span>
                  ))}
                </div>
                <button className="table-action" type="button" onClick={() => editInternalToolAccess(item.user_id)}>Edit</button>
              </div>
            ))}
            {visibleInternalToolUsers.length === 0 && <div className="empty-card">No users match this search.</div>}
          </div>
          <div className="pagination-row">
            <button className="table-action" type="button" onClick={() => setAccessPage((current) => Math.max(1, current - 1))} disabled={accessPage === 1}>Previous</button>
            <span>Page {accessPage} of {accessPages}</span>
            <button className="table-action" type="button" onClick={() => setAccessPage((current) => Math.min(accessPages, current + 1))} disabled={accessPage === accessPages}>Next</button>
          </div>
        </div>
      </div>
      <div className="table-card">
        <div className="table-card-head">
          <div>
            <h2>User workflow access</h2>
            <p className="muted">{filteredWorkflowAccessUsers.length} user(s)</p>
          </div>
          <label className="module-search access-search">
            <span>⌕</span>
            <input value={workflowAccessSearch} onChange={(event) => setWorkflowAccessSearch(event.target.value)} placeholder="Search workflow access..." />
          </label>
        </div>
        <table className="table access-table">
          <thead><tr><th>User</th><th>Access</th><th>Transferred workflows</th></tr></thead>
          <tbody>
            {filteredWorkflowAccessUsers.map((item) => (
              <tr key={item.user_id}>
                <td>
                  <strong>{item.user_name}</strong>
                  <small>{item.user_email}</small>
                </td>
                <td><span className={item.workflow_count ? "pill ok" : "pill"}>{item.workflow_count} workflow(s)</span></td>
                <td>
                  <div className="workflow-access-list">
                    {item.workflows.length === 0 && <span className="credential-empty">No workflow access</span>}
                    {item.workflows.map((access) => (
                      <div className="workflow-access-row" key={access.id}>
                        <div>
                          <strong>{access.workflow_name}</strong>
                          <small>Target: {access.target_workflow_id} · {access.target_base_url}</small>
                          {access.activation_warning && <small className="warning-text">{access.activation_warning}</small>}
                        </div>
                        <button className="table-action danger-action" type="button" onClick={() => deleteTransferredWorkflow(access, item.user_name)}>Delete from n8n</button>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {filteredWorkflowAccessUsers.length === 0 && <tr><td colSpan={3} className="empty-cell">No workflow access records match this search.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="table-card">
        <div className="table-card-head">
          <div>
            <h2>Users</h2>
            <p className="muted">{filteredUsersTable.length} account(s)</p>
          </div>
          <label className="module-search access-search">
            <span>⌕</span>
            <input value={usersTableSearch} onChange={(event) => setUsersTableSearch(event.target.value)} placeholder="Search users or credentials..." />
          </label>
        </div>
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>User n8n Credentials</th><th>Status</th></tr></thead>
          <tbody>
            {filteredUsersTable.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.email}</td>
                <td><span className={item.role === "admin" ? "pill ok" : "pill"}>{item.role}</span></td>
                <td>
                  <div className="user-credentials">
                    {(item.n8n_credentials || []).length === 0 && <span className="credential-empty">No n8n credentials</span>}
                    {(item.n8n_credentials || []).map((credential) => (
                      <div className="credential-row" key={credential.id}>
                        <div>
                          <strong>{credential.name}</strong>
                          <small>{credential.environment} · {credential.base_url}</small>
                        </div>
                        <span className="pill">{credential.api_key_status}</span>
                        {credential.is_default && <span className="pill ok">Default</span>}
                        <div className="credential-actions">
                          <button className="table-action" type="button" onClick={() => editCredential(item, credential)}>Edit</button>
                          <button className="table-action danger-action" type="button" onClick={() => deleteCredential(item, credential)}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </td>
                <td>{item.is_active ? "Active" : "Disabled"}</td>
              </tr>
            ))}
            {filteredUsersTable.length === 0 && <tr><td colSpan={5} className="empty-cell">No users match this search.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
