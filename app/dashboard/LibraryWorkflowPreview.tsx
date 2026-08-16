"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface LibraryNodeData {
  type?: string;
  name?: string;
  displayName?: string;
  group?: string;
  position?: number[];
  iconData?: { type?: string; fileBuffer?: string; icon?: string };
  icon?: string;
}

const TRIGGER_KW = ["trigger", "webhook", "cron", "schedule", "start", "event", "formtrigger", "chattrigger"];

function isTrigger(node: LibraryNodeData) {
  const group = (node.group || "").toLowerCase();
  if (group.includes("trigger")) return true;
  const search = `${node.type || ""}${node.name || ""}`.toLowerCase();
  return TRIGGER_KW.some((keyword) => search.includes(keyword));
}

function nodeLabel(node: LibraryNodeData) {
  const raw = node.displayName || node.name || node.type?.split(".").pop() || "?";
  return raw.length > 16 ? `${raw.slice(0, 14)}…` : raw;
}

function iconFor(node: LibraryNodeData) {
  const source = `${node.type || ""} ${node.name || ""}`.toLowerCase();
  if (source.includes("webhook")) return "♨";
  if (source.includes("http") || source.includes("request")) return "◎";
  if (source.includes("openai")) return "✺";
  if (source.includes("agent")) return "🤖";
  if (source.includes("html") || source.includes("code")) return "{}";
  return "⚙";
}

function buildCanvasNodes(nodes: LibraryNodeData[]) {
  const sorted = [...nodes].sort((a, b) => {
    const ax = a.position?.[0] ?? 0;
    const bx = b.position?.[0] ?? 0;
    if (ax !== bx) return ax - bx;
    return (a.position?.[1] ?? 0) - (b.position?.[1] ?? 0);
  });
  const normalized = sorted.map((node, index) => ({
    node,
    x: typeof node.position?.[0] === "number" ? node.position[0] : index * 260,
    y: typeof node.position?.[1] === "number" ? node.position[1] : (index % 3) * 150,
  }));
  const xs = normalized.map((item) => item.x);
  const ys = normalized.map((item) => item.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return normalized.map((item, index) => ({
    ...item,
    index,
    left: 4 + ((item.x - minX) / width) * 70,
    top: 8 + ((item.y - minY) / height) * 70,
  }));
}

export function LibraryNodeFlow({
  nodes,
  maxShow = 12,
  onClick,
  compact = false,
}: {
  nodes: LibraryNodeData[];
  maxShow?: number;
  onClick?: () => void;
  compact?: boolean;
}) {
  if (nodes.length === 0) {
    return <div className={compact ? "lib-node-empty compact" : "lib-node-empty"}>No nodes</div>;
  }

  const sorted = [...nodes].sort((a, b) => {
    const at = isTrigger(a) ? 0 : 1;
    const bt = isTrigger(b) ? 0 : 1;
    if (at !== bt) return at - bt;
    return (a.position?.[0] ?? 0) - (b.position?.[0] ?? 0);
  });

  const visible = sorted.slice(0, maxShow);
  const remaining = nodes.length - maxShow;

  if (!compact) {
    const canvasNodes = buildCanvasNodes(visible);
    return (
      <div className="lib-node-canvas" onClick={onClick}>
        <svg className="lib-node-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {canvasNodes.slice(0, -1).map((item, index) => {
            const next = canvasNodes[index + 1];
            return (
              <line
                key={`${item.node.name || item.node.type}-${index}`}
                x1={Math.min(96, item.left + 9)}
                y1={Math.min(96, item.top + 5)}
                x2={Math.max(4, next.left)}
                y2={Math.min(96, next.top + 5)}
              />
            );
          })}
        </svg>
        {canvasNodes.map(({ node, left, top, index }) => {
          const trigger = isTrigger(node);
          return (
            <span
              className={trigger ? "lib-canvas-node trigger" : "lib-canvas-node"}
              key={`${node.name || node.type}-${index}`}
              style={{ left: `${left}%`, top: `${top}%` }}
            >
              <span className={trigger ? "lib-canvas-icon trigger" : "lib-canvas-icon"}>{iconFor(node)}</span>
              <small>{nodeLabel(node)}</small>
            </span>
          );
        })}
        {remaining > 0 && <span className="lib-node-more canvas-more">+{remaining} more</span>}
        {onClick && <span className="lib-preview-hover">Preview</span>}
      </div>
    );
  }

  return (
    <div className={compact ? "lib-node-flow compact" : "lib-node-flow"} onClick={onClick}>
      {visible.map((node, index) => {
        const trigger = isTrigger(node);
        return (
          <div className="lib-flow-piece" key={`${node.name || node.type}-${index}`}>
            <span className={trigger ? "lib-node-badge trigger" : "lib-node-badge"}>
              <span className={trigger ? "lib-node-icon trigger" : "lib-node-icon"}>{iconFor(node)}</span>
              {nodeLabel(node)}
            </span>
            {index < visible.length - 1 && !compact && <span className="lib-flow-arrow">→</span>}
          </div>
        );
      })}
      {remaining > 0 && <span className="lib-node-more">+{remaining} more</span>}
      {onClick && !compact && <span className="lib-preview-hover">Preview</span>}
    </div>
  );
}

function useN8nDemoScript() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (customElements.get("n8n-demo")) {
      setReady(true);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-n8n-demo="true"]');
    if (existing) {
      existing.addEventListener("load", () => setReady(true), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.src = "/n8n-demo.bundled.js";
    script.async = true;
    script.dataset.n8nDemo = "true";
    script.onload = () => setReady(true);
    document.body.appendChild(script);
  }, []);

  return ready;
}

export function N8nDemoPreview({
  workflow,
  minHeight = "80vh",
}: {
  workflow: { nodes: unknown[]; connections: unknown };
  minHeight?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ready = useN8nDemoScript();
  const workflowJson = useMemo(() => JSON.stringify(workflow), [workflow]);

  useEffect(() => {
    if (!ready || !containerRef.current) return;
    containerRef.current.innerHTML = "";
    const demo = document.createElement("n8n-demo");
    demo.setAttribute("workflow", workflowJson);
    demo.setAttribute("frame", "true");
    demo.style.cssText =
      `display:block;width:100%;height:100%;--n8n-workflow-min-height:${minHeight};` +
      "--n8n-iframe-border-radius:0;--n8n-frame-background-color:#f5f5f5;";
    containerRef.current.appendChild(demo);

    const style = document.createElement("style");
    style.textContent = "n8n-demo iframe { width:100%!important; height:100%!important; min-height:0!important; border:none!important; }";
    containerRef.current.appendChild(style);

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  }, [ready, workflowJson, minHeight]);

  return <div ref={containerRef} className="n8n-demo-container">{!ready && <div className="canvas-empty">Loading preview…</div>}</div>;
}

export function LibraryPreviewModal({
  title,
  workflowData,
  onClose,
}: {
  title: string;
  workflowData: { nodes: unknown[]; connections: unknown };
  onClose: () => void;
}) {
  return (
    <div className="library-modal-backdrop" onClick={onClose}>
      <div className="library-preview-modal exact" onClick={(event) => event.stopPropagation()}>
        <div className="modal-titlebar">
          <h2>{title}</h2>
          <button className="close-btn" onClick={onClose}>Close</button>
        </div>
        <div className="exact-demo-wrap">
          <N8nDemoPreview workflow={workflowData} />
        </div>
      </div>
    </div>
  );
}
