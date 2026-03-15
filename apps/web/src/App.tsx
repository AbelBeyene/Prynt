import { useEffect, useMemo, useState, type MouseEventHandler } from "react";
import type { AstNode, DocumentAst } from "@prynt/ast";
import type { PatchOp } from "@prynt/patches";

const API_URL = "http://localhost:4000";

type DevicePreset = "iphone" | "android" | "tablet";

interface VersionSnapshot {
  id: number;
  reason: string;
  createdAt: string;
}

function parseValue(value: string): unknown {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && value.trim() !== "") {
    return asNumber;
  }
  return value;
}

function flatten(node: AstNode, output: AstNode[] = []): AstNode[] {
  output.push(node);
  for (const child of node.children) {
    flatten(child, output);
  }
  return output;
}

function findNode(root: AstNode, id: string): AstNode | null {
  const stack: AstNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.id === id) {
      return current;
    }
    stack.push(...current.children);
  }
  return null;
}

function renderNode(node: AstNode, selectedId: string | null, onSelect: (id: string) => void): JSX.Element {
  const selected = selectedId === node.id;
  const className = `node node-${node.type.toLowerCase()}${selected ? " selected" : ""}`;

  const onClick: MouseEventHandler = (event) => {
    event.stopPropagation();
    onSelect(node.id);
  };

  if (node.type === "Heading") {
    return (
      <h2 key={node.id} className={className} onClick={onClick}>
        {String(node.props.text ?? "Heading")}
      </h2>
    );
  }

  if (node.type === "Text") {
    return (
      <p key={node.id} className={className} onClick={onClick}>
        {String(node.props.text ?? "Text")}
      </p>
    );
  }

  if (node.type === "Button") {
    return (
      <button key={node.id} className={className} onClick={onClick} type="button">
        {String(node.props.text ?? "Button")}
      </button>
    );
  }

  if (node.type === "TopBar") {
    return (
      <div key={node.id} className={`${className} topbar`} onClick={onClick}>
        {String(node.props.title ?? "Top Bar")}
      </div>
    );
  }

  if (node.type === "BottomTabBar") {
    const tabs = Number(node.props.tabs ?? 4);
    return (
      <div key={node.id} className={`${className} tabbar`} onClick={onClick}>
        {Array.from({ length: tabs }).map((_, index) => (
          <span key={`${node.id}-${index}`} className="tab">
            Tab {index + 1}
          </span>
        ))}
      </div>
    );
  }

  if (node.type === "TextField") {
    return (
      <div key={node.id} className={className} onClick={onClick}>
        <label>{String(node.props.label ?? "Label")}</label>
        <input placeholder={String(node.props.placeholder ?? "Type...")} readOnly />
      </div>
    );
  }

  const containerType = node.type === "Card" ? "card" : node.type === "Stack" ? "stack" : node.type === "ScrollView" ? "scroll" : "container";

  return (
    <div key={node.id} className={`${className} ${containerType}`} onClick={onClick}>
      {node.type !== "Screen" && node.type !== "ScrollView" ? <div className="node-label">{node.type}</div> : null}
      {node.children.map((child) => renderNode(child, selectedId, onSelect))}
    </div>
  );
}

function LayerTree({ node, selectedId, onSelect }: { node: AstNode; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="layer-item">
      <button type="button" className={selectedId === node.id ? "layer-selected" : ""} onClick={() => onSelect(node.id)}>
        {node.type} ({node.id})
      </button>
      <div className="layer-children">
        {node.children.map((child) => (
          <LayerTree key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [document, setDocument] = useState<DocumentAst | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("Create a modern mobile dashboard");
  const [device, setDevice] = useState<DevicePreset>("iphone");
  const [status, setStatus] = useState("Ready");
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);

  const width = useMemo(() => {
    if (device === "android") {
      return 360;
    }
    if (device === "tablet") {
      return 768;
    }
    return 390;
  }, [device]);

  const selectedNode = useMemo(() => {
    if (!document || !selectedId) {
      return null;
    }
    return findNode(document.root, selectedId);
  }, [document, selectedId]);

  async function refreshVersions(activeProjectId: string) {
    const response = await apiRequest<{ versions: VersionSnapshot[] }>(`/projects/${activeProjectId}/versions`);
    setVersions(response.versions.slice().reverse());
  }

  useEffect(() => {
    void (async () => {
      const created = await apiRequest<{ projectId: string; document: DocumentAst; versions: VersionSnapshot[] }>("/projects", {
        method: "POST",
        body: JSON.stringify({})
      });
      setProjectId(created.projectId);
      setDocument(created.document);
      setSelectedId(created.document.root.id);
      setVersions(created.versions);
      setStatus("Project ready");
    })();
  }, []);

  async function applyPatch(patches: PatchOp[], reason: string) {
    if (!projectId) {
      return;
    }
    const response = await apiRequest<{ applied: boolean; document: DocumentAst; repairSuggestions: string[] }>(`/projects/${projectId}/patch`, {
      method: "POST",
      body: JSON.stringify({ patches, reason })
    });
    setDocument(response.document);
    setStatus(response.applied ? `Applied: ${reason}` : `Rejected: ${response.repairSuggestions.join(" | ")}`);
    await refreshVersions(projectId);
  }

  async function handlePrompt() {
    if (!projectId) {
      return;
    }
    const response = await apiRequest<{ response: { document: DocumentAst; applied: boolean; repairSuggestions: string[] } }>(`/projects/${projectId}/prompt`, {
      method: "POST",
      body: JSON.stringify({ prompt, selectedNodeId: selectedId ?? undefined })
    });
    setDocument(response.response.document);
    setStatus(response.response.applied ? "Prompt applied" : response.response.repairSuggestions.join(" | "));
    await refreshVersions(projectId);
  }

  async function handleUndo() {
    if (!projectId) {
      return;
    }
    const response = await apiRequest<{ document: DocumentAst; applied: boolean; repairSuggestions: string[] }>(`/projects/${projectId}/undo`, {
      method: "POST"
    });
    setDocument(response.document);
    setStatus(response.applied ? "Undo" : response.repairSuggestions.join(" | "));
  }

  async function handleRedo() {
    if (!projectId) {
      return;
    }
    const response = await apiRequest<{ document: DocumentAst; applied: boolean; repairSuggestions: string[] }>(`/projects/${projectId}/redo`, {
      method: "POST"
    });
    setDocument(response.document);
    setStatus(response.applied ? "Redo" : response.repairSuggestions.join(" | "));
  }

  async function handleRepair() {
    if (!projectId) {
      return;
    }
    const response = await apiRequest<{ document: DocumentAst; applied: boolean }>(`/projects/${projectId}/repair/apply`, {
      method: "POST"
    });
    setDocument(response.document);
    setStatus(response.applied ? "Auto repair applied" : "No repairs needed");
    await refreshVersions(projectId);
  }

  async function addNode(type: "Card" | "Button" | "Text") {
    if (!selectedId) {
      return;
    }
    const id = `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
    const node: AstNode =
      type === "Card"
        ? {
            id,
            type: "Card",
            props: { tone: "surface", radius: "lg" },
            children: [
              { id: `heading-${id}`, type: "Heading", props: { text: "Card title", size: "lg" }, children: [] },
              { id: `text-${id}`, type: "Text", props: { text: "Card content" }, children: [] }
            ]
          }
        : type === "Button"
          ? { id, type: "Button", props: { text: "Action", tone: "primary", minHeight: 44, size: "md" }, children: [] }
          : { id, type: "Text", props: { text: "New text" }, children: [] };

    await applyPatch(
      [
        {
          opId: `add-${id}`,
          type: "addNode",
          parentId: selectedId,
          node
        }
      ],
      `Add ${type}`
    );
  }

  async function removeSelected() {
    if (!selectedId || !document || selectedId === document.root.id) {
      return;
    }
    await applyPatch(
      [
        {
          opId: `remove-${selectedId}`,
          type: "removeNode",
          targetId: selectedId
        }
      ],
      "Remove node"
    );
    setSelectedId(document.root.id);
  }

  async function updateProp(key: string, value: string) {
    if (!selectedId) {
      return;
    }
    await applyPatch(
      [
        {
          opId: `update-${selectedId}-${key}`,
          type: "updateProps",
          targetId: selectedId,
          props: { [key]: parseValue(value) }
        }
      ],
      `Update ${key}`
    );
  }

  async function restoreVersion(versionId: number) {
    if (!projectId) {
      return;
    }
    const response = await apiRequest<{ document: DocumentAst }>(`/projects/${projectId}/versions/${versionId}/restore`, {
      method: "POST"
    });
    setDocument(response.document);
    setStatus(`Restored version ${versionId}`);
  }

  if (!document) {
    return <div className="loading">Loading project...</div>;
  }

  return (
    <div className="app-shell">
      <header className="topbar-app">
        <h1>Prynt Prompt-Native UX Editor</h1>
        <p>{status}</p>
      </header>

      <section className="prompt-row">
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe your UI change..." />
        <button type="button" onClick={() => void handlePrompt()}>
          Apply Prompt
        </button>
        <button type="button" onClick={() => void handleRepair()}>
          Repair
        </button>
        <button type="button" onClick={() => void handleUndo()}>
          Undo
        </button>
        <button type="button" onClick={() => void handleRedo()}>
          Redo
        </button>
        <select value={device} onChange={(event) => setDevice(event.target.value as DevicePreset)}>
          <option value="iphone">iPhone (390)</option>
          <option value="android">Android (360)</option>
          <option value="tablet">Tablet (768)</option>
        </select>
      </section>

      <main className="layout-grid">
        <aside className="panel layer-panel">
          <h2>Layers</h2>
          <LayerTree node={document.root} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>

        <section className="panel canvas-panel">
          <h2>Canvas</h2>
          <div className="device-frame" style={{ width }}>
            {renderNode(document.root, selectedId, setSelectedId)}
          </div>
        </section>

        <aside className="panel inspector-panel">
          <h2>Inspector</h2>
          {selectedNode ? (
            <>
              <p>
                <strong>{selectedNode.type}</strong> - {selectedNode.id}
              </p>
              {Object.entries(selectedNode.props).map(([key, value]) => (
                <label key={key} className="prop-field">
                  {key}
                  <input defaultValue={String(value)} onBlur={(event) => void updateProp(key, event.target.value)} />
                </label>
              ))}
              <div className="inspector-actions">
                <button type="button" onClick={() => void addNode("Card")}>Add Card</button>
                <button type="button" onClick={() => void addNode("Button")}>Add Button</button>
                <button type="button" onClick={() => void addNode("Text")}>Add Text</button>
                <button type="button" onClick={() => void removeSelected()}>Remove</button>
              </div>
            </>
          ) : (
            <p>Select a node.</p>
          )}

          <h3>Versions</h3>
          <div className="versions">
            {versions.map((version) => (
              <button key={version.id} type="button" onClick={() => void restoreVersion(version.id)}>
                V{version.id} - {version.reason}
              </button>
            ))}
          </div>
        </aside>
      </main>

      <footer className="footer">
        Nodes: {flatten(document.root).length} | Version: {document.version}
      </footer>
    </div>
  );
}
