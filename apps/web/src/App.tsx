import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MouseEventHandler } from "react";
import type { AstNode, DocumentAst } from "@prynt/ast";
import { serializeDocumentToDsl } from "@prynt/dsl";
import type { PatchOp } from "@prynt/patches";

const API_URL = "http://localhost:4000";
const STAGE_WIDTH = 5000;
const STAGE_HEIGHT = 3200;

type DevicePreset = "iphone" | "android" | "tablet";
type InspectorMode = "props" | "source" | "patch";

type CanvasItemType = "phone" | "note" | "frame";

interface CanvasItem {
  id: string;
  type: CanvasItemType;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fileId?: string;
}

interface ProjectFile {
  fileId: string;
  name: string;
  document: DocumentAst;
}

interface VersionSnapshot {
  id: number;
  reason: string;
  createdAt: string;
}

interface IntentSpec {
  prompt: string;
  action: "add" | "update" | "replace" | "remove" | "style" | "unknown";
  targetMode: "single" | "multiple";
  targetFileIds: string[];
  confidence: number;
  warnings: string[];
}

interface PromptHistoryEntry {
  id: string;
  prompt: string;
  action: IntentSpec["action"];
  targetFileIds: string[];
  source: "llm" | "rule" | "mixed";
  createdAt: string;
}

interface PromptSuggestion {
  id: string;
  text: string;
  category: "layout" | "content" | "style" | "navigation" | "input";
}

interface DragState {
  mode: "pan" | "item";
  startX: number;
  startY: number;
  startScrollLeft?: number;
  startScrollTop?: number;
  itemId?: string;
}

function parseValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && value.trim() !== "") return asNumber;
  return value;
}

function flatten(node: AstNode, output: AstNode[] = []): AstNode[] {
  output.push(node);
  for (const child of node.children) flatten(child, output);
  return output;
}

function findNode(root: AstNode, id: string): AstNode | null {
  const stack: AstNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.id === id) return current;
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

  if (node.type === "Heading") return <h2 key={node.id} className={className} onClick={onClick}>{String(node.props.text ?? "Heading")}</h2>;
  if (node.type === "Text") return <p key={node.id} className={className} onClick={onClick}>{String(node.props.text ?? "Text")}</p>;
  if (node.type === "Button") return <button key={node.id} className={className} onClick={onClick} type="button">{String(node.props.text ?? "Button")}</button>;

  if (node.type === "TopBar") {
    return <div key={node.id} className={`${className} topbar`} onClick={onClick}>{String(node.props.title ?? "Top Bar")}</div>;
  }

  if (node.type === "BottomTabBar") {
    const tabs = Number(node.props.tabs ?? 4);
    return (
      <div key={node.id} className={`${className} tabbar`} onClick={onClick}>
        {Array.from({ length: tabs }).map((_, index) => <span key={`${node.id}-${index}`} className="tab">Tab {index + 1}</span>)}
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
        {node.children.map((child) => <LayerTree key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />)}
      </div>
    </div>
  );
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

function clampZoom(value: number): number {
  return Math.min(2.5, Math.max(0.3, value));
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("Create a modern mobile dashboard");
  const [isApplyingPrompt, setIsApplyingPrompt] = useState(false);
  const [isSimulatingPrompt, setIsSimulatingPrompt] = useState(false);
  const [artboardSearch, setArtboardSearch] = useState("");
  const [artboardRename, setArtboardRename] = useState("");
  const [uiAccent, setUiAccent] = useState("#5eead4");
  const [uiAccent2, setUiAccent2] = useState("#60a5fa");
  const [uiPanelTone, setUiPanelTone] = useState("#151b27");
  const [canvasTone, setCanvasTone] = useState("#0e1420");
  const [device, setDevice] = useState<DevicePreset>("iphone");
  const [status, setStatus] = useState("Ready");
  const [promptConfidence, setPromptConfidence] = useState<number | null>(null);
  const [promptWarnings, setPromptWarnings] = useState<string[]>([]);
  const [promptLibraryQuery, setPromptLibraryQuery] = useState("");
  const [promptHistory, setPromptHistory] = useState<PromptHistoryEntry[]>([]);
  const [promptSuggestions, setPromptSuggestions] = useState<PromptSuggestion[]>([]);
  const [isRefreshingPromptLibrary, setIsRefreshingPromptLibrary] = useState(false);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("props");
  const [patchText, setPatchText] = useState('[{\n  "opId": "manual-1",\n  "type": "updateProps",\n  "targetId": "screen-root",\n  "props": { "title": "Updated" }\n}]');
  const [previewDocument, setPreviewDocument] = useState<DocumentAst | null>(null);
  const [zoom, setZoom] = useState(1);
  const [spacePressed, setSpacePressed] = useState(false);
  const [selectedCanvasItemId, setSelectedCanvasItemId] = useState<string | null>("phone-main");
  const [canvasItems, setCanvasItems] = useState<CanvasItem[]>([]);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const canvasHoverRef = useRef(false);
  const gestureScaleRef = useRef<number | null>(null);

  const phoneWidth = useMemo(() => (device === "android" ? 360 : device === "tablet" ? 768 : 390), [device]);

  const selectedCanvasItem = useMemo(() => canvasItems.find((item) => item.id === selectedCanvasItemId) ?? null, [canvasItems, selectedCanvasItemId]);
  const activeFileId = selectedCanvasItem?.type === "phone" && selectedCanvasItem.fileId ? selectedCanvasItem.fileId : files[0]?.fileId;
  const activeFile = useMemo(() => files.find((file) => file.fileId === activeFileId) ?? null, [files, activeFileId]);
  const activeDocument = activeFile?.document ?? null;
  const artboardSummaries = useMemo(
    () =>
      files.map((file) => ({
        fileId: file.fileId,
        name: file.name,
        nodeCount: flatten(file.document.root).length,
        version: file.document.version
      })),
    [files]
  );
  const filteredArtboardSummaries = useMemo(() => {
    const q = artboardSearch.trim().toLowerCase();
    if (!q) return artboardSummaries;
    return artboardSummaries.filter((item) => item.name.toLowerCase().includes(q) || item.fileId.toLowerCase().includes(q));
  }, [artboardSummaries, artboardSearch]);
  const quickPrompts = useMemo(
    () => [
      "On this screen, add a search bar above cards",
      "Make this screen look more premium",
      "On all screens, increase heading hierarchy",
      "On screen 2, add a CTA button at the bottom"
    ],
    []
  );

  const selectedNode = useMemo(() => {
    if (!activeDocument || !selectedId) return null;
    return findNode(activeDocument.root, selectedId);
  }, [activeDocument, selectedId]);

  useEffect(() => {
    setArtboardRename(activeFile?.name ?? "");
  }, [activeFile?.fileId]);

  useEffect(() => {
    const raw = localStorage.getItem("prynt-ui-settings");
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as {
        accent?: string;
        accent2?: string;
        panel?: string;
        canvas?: string;
        device?: DevicePreset;
      };
      if (parsed.accent) setUiAccent(parsed.accent);
      if (parsed.accent2) setUiAccent2(parsed.accent2);
      if (parsed.panel) setUiPanelTone(parsed.panel);
      if (parsed.canvas) setCanvasTone(parsed.canvas);
      if (parsed.device) setDevice(parsed.device);
    } catch {
      // ignore invalid persisted state
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "prynt-ui-settings",
      JSON.stringify({
        accent: uiAccent,
        accent2: uiAccent2,
        panel: uiPanelTone,
        canvas: canvasTone,
        device
      })
    );
  }, [uiAccent, uiAccent2, uiPanelTone, canvasTone, device]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", uiAccent);
    root.style.setProperty("--accent-2", uiAccent2);
    root.style.setProperty("--panel", uiPanelTone);
    root.style.setProperty("--canvas-tone", canvasTone);
  }, [uiAccent, uiAccent2, uiPanelTone, canvasTone]);

  function patchFileDocument(fileId: string, document: DocumentAst) {
    setFiles((current) => current.map((file) => (file.fileId === fileId ? { ...file, document } : file)));
  }

  async function refreshVersions(currentProjectId: string, fileId: string) {
    const response = await apiRequest<{ versions: VersionSnapshot[] }>(`/projects/${currentProjectId}/versions?fileId=${encodeURIComponent(fileId)}`);
    setVersions(response.versions.slice().reverse());
  }

  async function refreshPromptLibrary(currentProjectId: string, fileId?: string, query = "") {
    setIsRefreshingPromptLibrary(true);
    try {
      const [history, suggestions] = await Promise.all([
        apiRequest<{ items: PromptHistoryEntry[] }>(
          `/projects/${currentProjectId}/prompt/history?limit=24&query=${encodeURIComponent(query)}`
        ),
        apiRequest<{ items: PromptSuggestion[] }>(
          `/projects/${currentProjectId}/prompt/suggestions?fileId=${encodeURIComponent(fileId ?? "")}&query=${encodeURIComponent(query)}`
        )
      ]);
      setPromptHistory(history.items);
      setPromptSuggestions(suggestions.items);
    } catch {
      setPromptHistory([]);
      setPromptSuggestions([]);
    } finally {
      setIsRefreshingPromptLibrary(false);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const dragging = dragRef.current;
      if (!dragging) return;

      if (dragging.mode === "pan") {
        const viewport = viewportRef.current;
        if (!viewport || dragging.startScrollLeft === undefined || dragging.startScrollTop === undefined) return;
        viewport.scrollLeft = dragging.startScrollLeft - (event.clientX - dragging.startX);
        viewport.scrollTop = dragging.startScrollTop - (event.clientY - dragging.startY);
      }

      if (dragging.mode === "item" && dragging.itemId) {
        const dx = (event.clientX - dragging.startX) / zoom;
        const dy = (event.clientY - dragging.startY) / zoom;
        setCanvasItems((current) =>
          current.map((item) =>
            item.id === dragging.itemId
              ? { ...item, x: Math.max(0, item.x + dx), y: Math.max(0, item.y + dy) }
              : item
          )
        );
        dragRef.current = { ...dragging, startX: event.clientX, startY: event.clientY };
      }
    };

    const onMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [zoom]);

  useEffect(() => {
    void (async () => {
      const created = await apiRequest<{ projectId: string; files: ProjectFile[] }>("/projects", {
        method: "POST",
        body: JSON.stringify({})
      });

      setProjectId(created.projectId);
      setFiles(created.files);

      const firstFile = created.files[0];
      if (firstFile) {
        setSelectedId(firstFile.document.root.id);
        setCanvasItems([
          { id: "phone-main", type: "phone", fileId: firstFile.fileId, x: 760, y: 380, width: phoneWidth, height: 760 }
        ]);
        await refreshVersions(created.projectId, firstFile.fileId);
        await refreshPromptLibrary(created.projectId, firstFile.fileId);
      }

      setStatus("Project ready");

      const viewport = viewportRef.current;
      if (viewport) {
        viewport.scrollLeft = 520;
        viewport.scrollTop = 260;
      }
    })();
  }, []);

  useEffect(() => {
    setCanvasItems((current) => current.map((item) => (item.type === "phone" ? { ...item, width: phoneWidth } : item)));
  }, [phoneWidth]);

  useEffect(() => {
    if (!projectId || !activeFileId) return;
    void refreshVersions(projectId, activeFileId);
    const rootId = activeFile?.document.root.id;
    if (rootId) setSelectedId(rootId);
  }, [projectId, activeFileId]);

  useEffect(() => {
    if (!projectId || !activeFileId) return;
    const timer = window.setTimeout(() => {
      void refreshPromptLibrary(projectId, activeFileId, promptLibraryQuery);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [projectId, activeFileId, promptLibraryQuery]);

  async function applyPatch(patches: PatchOp[], reason: string) {
    if (!projectId || !activeFileId) return;

    const response = await apiRequest<{ applied: boolean; fileId: string; document: DocumentAst; repairSuggestions: string[] }>(`/projects/${projectId}/patch`, {
      method: "POST",
      body: JSON.stringify({ fileId: activeFileId, patches, reason })
    });

    patchFileDocument(response.fileId, response.document);
    setPreviewDocument(null);
    setStatus(response.applied ? `Applied: ${reason}` : `Rejected: ${response.repairSuggestions.join(" | ")}`);
    await refreshVersions(projectId, response.fileId);
  }

  async function previewPatch(patches: PatchOp[]) {
    if (!projectId || !activeFileId) return;

    const response = await apiRequest<{ applied: boolean; document: DocumentAst; repairSuggestions: string[] }>(`/projects/${projectId}/patch/preview`, {
      method: "POST",
      body: JSON.stringify({ fileId: activeFileId, patches, reason: "Preview" })
    });

    setPreviewDocument(response.document);
    setStatus(response.applied ? "Preview ready" : `Preview invalid: ${response.repairSuggestions.join(" | ")}`);
  }

  async function handlePrompt(overridePrompt?: string) {
    if (!projectId || !activeFileId) {
      setStatus("No active screen selected.");
      return;
    }

    const trimmedPrompt = (overridePrompt ?? prompt).trim();
    if (!trimmedPrompt) {
      setStatus("Type a prompt before applying.");
      return;
    }

    setIsApplyingPrompt(true);
    setStatus("Applying prompt...");
    try {
      const response = await apiRequest<{
        intent: IntentSpec;
        source: "llm" | "rule" | "mixed";
        fileName: string;
        response: { fileId: string; document: DocumentAst; applied: boolean; repairSuggestions: string[] };
        results: Array<{ fileId: string; fileName: string; response: { document: DocumentAst; applied: boolean } }>;
      }>(`/projects/${projectId}/prompt`, {
        method: "POST",
        body: JSON.stringify({ fileId: activeFileId, prompt: trimmedPrompt, selectedNodeId: selectedId ?? undefined })
      });

      for (const result of response.results) {
        patchFileDocument(result.fileId, result.response.document);
      }
      if (response.response.fileId !== activeFileId) {
        const targetPhone = canvasItems.find((item) => item.type === "phone" && item.fileId === response.response.fileId);
        if (targetPhone) {
          setSelectedCanvasItemId(targetPhone.id);
        }
      }
      setPreviewDocument(null);
      setPromptConfidence(response.intent.confidence);
      setPromptWarnings(response.intent.warnings);
      setStatus(
        response.response.applied
          ? `Prompt applied on ${response.results.length} screen(s) (${response.source})`
          : response.response.repairSuggestions.join(" | ")
      );
      await refreshVersions(projectId, response.response.fileId);
      await refreshPromptLibrary(projectId, response.response.fileId, promptLibraryQuery);
    } catch (error) {
      setStatus(`Prompt failed: ${(error as Error).message}`);
    } finally {
      setIsApplyingPrompt(false);
    }
  }

  async function runQuickPrompt(text: string) {
    setPrompt(text);
    await handlePrompt(text);
  }

  async function handleSimulatePrompt() {
    if (!projectId || !activeFileId) {
      setStatus("No active screen selected.");
      return;
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setStatus("Type a prompt before simulating.");
      return;
    }

    setIsSimulatingPrompt(true);
    setStatus("Simulating prompt...");
    try {
      const response = await apiRequest<{
        intent: IntentSpec;
        results: Array<{ fileId: string; fileName: string; source: "llm" | "rule"; response: { applied: boolean; warnings: string[] } }>;
      }>(`/projects/${projectId}/prompt/simulate`, {
        method: "POST",
        body: JSON.stringify({ fileId: activeFileId, prompt: trimmedPrompt, selectedNodeId: selectedId ?? undefined })
      });

      setPromptConfidence(response.intent.confidence);
      setPromptWarnings(response.intent.warnings);
      const okCount = response.results.filter((result) => result.response.applied).length;
      setStatus(`Simulation ready: ${okCount}/${response.results.length} screen(s) valid`);
    } catch (error) {
      setStatus(`Simulation failed: ${(error as Error).message}`);
    } finally {
      setIsSimulatingPrompt(false);
    }
  }

  async function handleUndo() {
    if (!projectId || !activeFileId) return;

    const response = await apiRequest<{ fileId: string; document: DocumentAst; applied: boolean; repairSuggestions: string[] }>(`/projects/${projectId}/undo`, {
      method: "POST",
      body: JSON.stringify({ fileId: activeFileId })
    });

    patchFileDocument(response.fileId, response.document);
    setPreviewDocument(null);
    setStatus(response.applied ? "Undo" : response.repairSuggestions.join(" | "));
  }

  async function handleRedo() {
    if (!projectId || !activeFileId) return;

    const response = await apiRequest<{ fileId: string; document: DocumentAst; applied: boolean; repairSuggestions: string[] }>(`/projects/${projectId}/redo`, {
      method: "POST",
      body: JSON.stringify({ fileId: activeFileId })
    });

    patchFileDocument(response.fileId, response.document);
    setPreviewDocument(null);
    setStatus(response.applied ? "Redo" : response.repairSuggestions.join(" | "));
  }

  async function handleRepair() {
    if (!projectId || !activeFileId) return;

    const response = await apiRequest<{ fileId: string; document: DocumentAst; applied: boolean }>(`/projects/${projectId}/repair/apply`, {
      method: "POST",
      body: JSON.stringify({ fileId: activeFileId })
    });

    patchFileDocument(response.fileId, response.document);
    setPreviewDocument(null);
    setStatus(response.applied ? "Auto repair applied" : "No repairs needed");
    await refreshVersions(projectId, response.fileId);
  }

  async function addNode(type: "Card" | "Button" | "Text") {
    if (!selectedId) return;

    const id = uid(type.toLowerCase());
    const node: AstNode =
      type === "Card"
        ? {
            id,
            type: "Card",
            props: { tone: "surface", radius: "lg" },
            children: [
              { id: uid("heading"), type: "Heading", props: { text: "Card title", size: "lg" }, children: [] },
              { id: uid("text"), type: "Text", props: { text: "Card content" }, children: [] }
            ]
          }
        : type === "Button"
          ? { id, type: "Button", props: { text: "Action", tone: "primary", minHeight: 44, size: "md" }, children: [] }
          : { id, type: "Text", props: { text: "New text" }, children: [] };

    await applyPatch([{ opId: uid("add"), type: "addNode", parentId: selectedId, node }], `Add ${type}`);
  }

  async function removeSelected() {
    if (!selectedId || !activeDocument || selectedId === activeDocument.root.id) return;
    await applyPatch([{ opId: uid("remove"), type: "removeNode", targetId: selectedId }], "Remove node");
    setSelectedId(activeDocument.root.id);
  }

  async function updateProp(key: string, value: string) {
    if (!selectedId) return;
    await applyPatch([{ opId: uid("update"), type: "updateProps", targetId: selectedId, props: { [key]: parseValue(value) } }], `Update ${key}`);
  }

  async function restoreVersion(versionId: number) {
    if (!projectId || !activeFileId) return;

    const response = await apiRequest<{ fileId: string; document: DocumentAst }>(`/projects/${projectId}/versions/${versionId}/restore`, {
      method: "POST",
      body: JSON.stringify({ fileId: activeFileId })
    });

    patchFileDocument(response.fileId, response.document);
    setPreviewDocument(null);
    setStatus(`Restored version ${versionId}`);
  }

  async function renameActiveArtboard() {
    if (!projectId || !activeFileId) return;
    const name = artboardRename.trim();
    if (!name) {
      setStatus("Artboard name cannot be empty.");
      return;
    }
    try {
      const file = await apiRequest<ProjectFile>(`/projects/${projectId}/files/${activeFileId}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      });
      setFiles((current) => current.map((item) => (item.fileId === file.fileId ? file : item)));
      setStatus(`Renamed artboard to ${file.name}`);
    } catch (error) {
      setStatus(`Rename failed: ${(error as Error).message}`);
    }
  }

  async function runPatchPreview() {
    try {
      await previewPatch(JSON.parse(patchText) as PatchOp[]);
    } catch (error) {
      setStatus(`Invalid patch JSON: ${(error as Error).message}`);
    }
  }

  async function applyPatchFromConsole() {
    try {
      await applyPatch(JSON.parse(patchText) as PatchOp[], "Patch console apply");
    } catch (error) {
      setStatus(`Invalid patch JSON: ${(error as Error).message}`);
    }
  }

  async function addCanvasItem(type: CanvasItemType) {
    if (!projectId) return;

    if (type === "phone") {
      const file = await apiRequest<ProjectFile>(`/projects/${projectId}/files`, {
        method: "POST",
        body: JSON.stringify({ name: `Screen ${files.length + 1}`, baseFileId: activeFileId })
      });

      setFiles((current) => [...current, file]);
      const id = uid("phone");
      setCanvasItems((current) => [...current, { id, type: "phone", fileId: file.fileId, x: 1400, y: 420, width: phoneWidth, height: 760 }]);
      setSelectedCanvasItemId(id);
      setSelectedId(file.document.root.id);
      await refreshVersions(projectId, file.fileId);
      setStatus(`Created new artboard: ${file.name}`);
      return;
    }

    const id = uid(type);
    const defaults: Record<"note" | "frame", CanvasItem> = {
      note: { id, type: "note", x: 360, y: 340, width: 260, height: 180, text: "Sticky note\nWrite ideas here" },
      frame: { id, type: "frame", x: 320, y: 640, width: 520, height: 320, text: "Wireframe Area" }
    };

    setCanvasItems((current) => [...current, defaults[type]]);
    setSelectedCanvasItemId(id);
  }

  function removeSelectedCanvasItem() {
    if (!selectedCanvasItemId) return;
    const current = canvasItems.find((item) => item.id === selectedCanvasItemId);
    if (!current) return;
    if (current.type === "phone") {
      setStatus("Use artboard controls to manage screens.");
      return;
    }
    setCanvasItems((items) => items.filter((item) => item.id !== selectedCanvasItemId));
    setSelectedCanvasItemId(canvasItems.find((item) => item.type === "phone")?.id ?? null);
  }

  function fitToViewport() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fit = Math.min(viewport.clientWidth / 1100, viewport.clientHeight / 900);
    const nextZoom = clampZoom(fit);
    setZoom(nextZoom);
    viewport.scrollLeft = 520;
    viewport.scrollTop = 220;
  }

  function applyThemePreset(preset: "teal" | "violet" | "amber" | "mono") {
    if (preset === "teal") {
      setUiAccent("#5eead4");
      setUiAccent2("#60a5fa");
      setUiPanelTone("#151b27");
      setCanvasTone("#0e1420");
      return;
    }
    if (preset === "violet") {
      setUiAccent("#a78bfa");
      setUiAccent2("#38bdf8");
      setUiPanelTone("#1a1832");
      setCanvasTone("#101028");
      return;
    }
    if (preset === "amber") {
      setUiAccent("#fbbf24");
      setUiAccent2("#f97316");
      setUiPanelTone("#2b1f18");
      setCanvasTone("#201811");
      return;
    }
    setUiAccent("#93c5fd");
    setUiAccent2("#94a3b8");
    setUiPanelTone("#1b202b");
    setCanvasTone("#10141d");
  }

  function handleCanvasBackgroundMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (!(spacePressed || event.button === 1)) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    dragRef.current = {
      mode: "pan",
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop
    };
    event.preventDefault();
  }

  function handleItemMouseDown(event: ReactMouseEvent<HTMLDivElement>, item: CanvasItem) {
    if (event.button !== 0) return;
    dragRef.current = { mode: "item", startX: event.clientX, startY: event.clientY, itemId: item.id };
    setSelectedCanvasItemId(item.id);
    event.stopPropagation();
  }

  useEffect(() => {
    const onWheelCapture = (event: WheelEvent) => {
      if (!canvasHoverRef.current) {
        return;
      }
      const isZoomGesture = event.ctrlKey || event.metaKey || Math.abs(event.deltaZ) > 0;
      if (!isZoomGesture) {
        return;
      }
      event.preventDefault();
      setZoom((current) => clampZoom(current + (event.deltaY < 0 ? 0.08 : -0.08)));
    };

    const onGestureStart = (event: Event) => {
      if (!canvasHoverRef.current) {
        return;
      }
      event.preventDefault();
      const scale = (event as { scale?: number }).scale;
      gestureScaleRef.current = typeof scale === "number" ? scale : 1;
    };

    const onGestureChange = (event: Event) => {
      if (!canvasHoverRef.current) {
        return;
      }
      event.preventDefault();
      const scale = (event as { scale?: number }).scale;
      if (typeof scale !== "number") {
        return;
      }
      const previous = gestureScaleRef.current ?? scale;
      const diff = scale - previous;
      if (Math.abs(diff) > 0.01) {
        setZoom((current) => clampZoom(current + diff * 0.4));
        gestureScaleRef.current = scale;
      }
    };

    const onGestureEnd = () => {
      gestureScaleRef.current = null;
    };

    window.addEventListener("wheel", onWheelCapture, { passive: false, capture: true });
    window.addEventListener("gesturestart", onGestureStart, { passive: false, capture: true });
    window.addEventListener("gesturechange", onGestureChange, { passive: false, capture: true });
    window.addEventListener("gestureend", onGestureEnd, { passive: false, capture: true });

    return () => {
      window.removeEventListener("wheel", onWheelCapture, true);
      window.removeEventListener("gesturestart", onGestureStart, true);
      window.removeEventListener("gesturechange", onGestureChange, true);
      window.removeEventListener("gestureend", onGestureEnd, true);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingField = target ? target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable : false;

      if (!isTypingField && event.key === "/") {
        event.preventDefault();
        promptInputRef.current?.focus();
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        if (event.key === "Enter") {
          event.preventDefault();
          void handlePrompt();
        }
        if (event.key === "=" || event.key === "+") {
          event.preventDefault();
          setZoom((current) => clampZoom(current + 0.1));
        }
        if (event.key === "-") {
          event.preventDefault();
          setZoom((current) => clampZoom(current - 0.1));
        }
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (canvasHoverRef.current) {
          removeSelectedCanvasItem();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const canvasDocument = (previewDocument ?? activeDocument) as DocumentAst | null;

  const tokenSelects: Record<string, string[]> = {
    tone: ["primary", "secondary", "accent", "surface", "muted", "danger"],
    radius: ["none", "sm", "md", "lg", "xl"],
    size: ["sm", "md", "lg", "xl", "2xl"]
  };

  if (!activeDocument) return <div className="loading">Loading project...</div>;

  return (
    <div className="app-shell">
      <header className="topbar-app">
        <h1>Prynt Prompt-Native UX Editor</h1>
        <p>{status}</p>
      </header>
      <section className="workspace-tools">
        <div className="workspace-tools-left">
          <button type="button" onClick={() => void handleUndo()}>Undo</button>
          <button type="button" onClick={() => void handleRedo()}>Redo</button>
          <button type="button" onClick={() => void handleRepair()}>Repair</button>
        </div>
        <div className="workspace-tools-right">
          <span className="active-target">Target: {activeFile?.name ?? "n/a"}</span>
          <select value={device} onChange={(event) => setDevice(event.target.value as DevicePreset)}>
            <option value="iphone">iPhone (390)</option>
            <option value="android">Android (360)</option>
            <option value="tablet">Tablet (768)</option>
          </select>
        </div>
      </section>

      <main className="layout-grid">
        <aside className="panel layer-panel">
          <div className="panel-head">
            <h2>Artboards</h2>
            <button type="button" className="mini-action" onClick={() => void addCanvasItem("phone")}>+ New</button>
          </div>
          <input className="artboard-search" value={artboardSearch} onChange={(event) => setArtboardSearch(event.target.value)} placeholder="Search artboards..." />
          <div className="artboard-list">
            {filteredArtboardSummaries.map((file) => (
              <button
                key={file.fileId}
                type="button"
                className={`artboard-item ${activeFileId === file.fileId ? "is-active" : ""}`}
                onClick={() => {
                  const phone = canvasItems.find((item) => item.type === "phone" && item.fileId === file.fileId);
                  if (phone) {
                    setSelectedCanvasItemId(phone.id);
                  }
                }}
              >
                <span className="artboard-title">{file.name}</span>
                <span className="artboard-meta">Nodes {file.nodeCount} | V{file.version}</span>
              </button>
            ))}
          </div>
          <div className="artboard-rename-row">
            <input value={artboardRename} onChange={(event) => setArtboardRename(event.target.value)} placeholder="Rename selected artboard" />
            <button type="button" className="mini-action" onClick={() => void renameActiveArtboard()}>Save</button>
          </div>

          <div className="panel-head">
            <h2>Layers</h2>
          </div>
          <LayerTree node={activeDocument.root} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>

        <section className="panel canvas-panel">
          <div className="canvas-toolbar">
            <h2>{previewDocument ? "Canvas (Preview)" : "Canvas"}</h2>
            <div className="canvas-controls">
              <button type="button" onClick={() => setZoom((v) => clampZoom(v - 0.1))}>-</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((v) => clampZoom(v + 0.1))}>+</button>
              <button type="button" onClick={() => setZoom(1)}>100%</button>
              <button type="button" onClick={() => fitToViewport()}>Fit</button>
              <button type="button" onClick={() => void addCanvasItem("note")}>Add Note</button>
              <button type="button" onClick={() => void addCanvasItem("frame")}>Add Frame</button>
              <button type="button" onClick={() => void addCanvasItem("phone")}>Add Screen</button>
              <button type="button" className="btn-danger" onClick={() => removeSelectedCanvasItem()}>Delete Item</button>
            </div>
          </div>

          <div
            ref={viewportRef}
            className={`canvas-viewport ${spacePressed ? "space-pan" : ""}`}
            onMouseEnter={() => {
              canvasHoverRef.current = true;
            }}
            onMouseLeave={() => {
              canvasHoverRef.current = false;
              gestureScaleRef.current = null;
            }}
            onMouseDown={handleCanvasBackgroundMouseDown}
          >
            <div className="canvas-stage" style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}>
              <div className="canvas-zoom-layer" style={{ transform: `scale(${zoom})` }}>
                {canvasItems.map((item) => {
                  const fileForItem = item.type === "phone" ? files.find((file) => file.fileId === item.fileId) : null;
                  const itemDocument = item.id === selectedCanvasItemId && previewDocument ? previewDocument : fileForItem?.document;
                  return (
                    <div
                      key={item.id}
                      className={`canvas-item ${item.type} ${selectedCanvasItemId === item.id ? "active" : ""}`}
                      style={{ left: item.x, top: item.y, width: item.width, minHeight: item.height }}
                      onMouseDown={(event) => handleItemMouseDown(event, item)}
                    >
                      <div className="canvas-item-handle">{item.type.toUpperCase()} {fileForItem ? `- ${fileForItem.name}` : ""}</div>
                      {item.type === "phone" ? <div className="device-frame">{itemDocument ? renderNode(itemDocument.root, selectedId, setSelectedId) : null}</div> : null}
                      {item.type === "note" ? <pre className="note-content">{item.text}</pre> : null}
                      {item.type === "frame" ? <div className="frame-content">{item.text}</div> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="canvas-hint">Hold Space and drag to pan. Use +/- or Ctrl/Cmd + wheel to zoom.</p>
        </section>

        <aside className="panel inspector-panel">
          <div className="panel-head">
            <h2>Inspector</h2>
          </div>
          <div className="mode-tabs">
            <button type="button" className={inspectorMode === "props" ? "tab-active" : ""} onClick={() => setInspectorMode("props")}>Props</button>
            <button type="button" className={inspectorMode === "source" ? "tab-active" : ""} onClick={() => setInspectorMode("source")}>Source</button>
            <button type="button" className={inspectorMode === "patch" ? "tab-active" : ""} onClick={() => setInspectorMode("patch")}>Patch</button>
          </div>

          {inspectorMode === "props" ? (
            selectedNode ? (
              <>
                <div className="inspector-node-summary">
                  <span className="node-chip">{selectedNode.type}</span>
                  <span className="node-id">{selectedNode.id}</span>
                </div>
                {Object.entries(selectedNode.props).map(([key, value]) => (
                  <label key={key} className="prop-field">
                    <span className="prop-label">{key}</span>
                    {typeof value === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(event) => void updateProp(key, String(event.target.checked))}
                      />
                    ) : tokenSelects[key] ? (
                      <select value={String(value)} onChange={(event) => void updateProp(key, event.target.value)}>
                        {tokenSelects[key].map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={typeof value === "number" ? "number" : "text"}
                        defaultValue={String(value)}
                        onBlur={(event) => void updateProp(key, event.target.value)}
                      />
                    )}
                  </label>
                ))}
                {Object.prototype.hasOwnProperty.call(selectedNode.props, "tone") ? (
                  <div className="tone-quick-row">
                    {["primary", "secondary", "accent", "surface", "muted", "danger"].map((tone) => (
                      <button key={tone} type="button" className="tone-chip" onClick={() => void updateProp("tone", tone)}>
                        {tone}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="inspector-actions">
                  <button type="button" className="btn-soft" onClick={() => void addNode("Card")}>Add Card</button>
                  <button type="button" className="btn-soft" onClick={() => void addNode("Button")}>Add Button</button>
                  <button type="button" className="btn-soft" onClick={() => void addNode("Text")}>Add Text</button>
                  <button type="button" className="btn-danger" onClick={() => void removeSelected()}>Remove</button>
                </div>
              </>
            ) : <p>Select a node.</p>
          ) : null}

          {inspectorMode === "source" ? (
            <>
              <h3>JSON AST</h3>
              <textarea className="source-box" readOnly value={JSON.stringify(activeDocument, null, 2)} />
              <h3>DSL</h3>
              <textarea className="source-box" readOnly value={serializeDocumentToDsl(activeDocument)} />
            </>
          ) : null}

          {inspectorMode === "patch" ? (
            <>
              <textarea className="source-box" value={patchText} onChange={(event) => setPatchText(event.target.value)} />
              <div className="inspector-actions">
                <button type="button" className="btn-soft" onClick={() => void runPatchPreview()}>Preview Patch</button>
                <button type="button" className="btn-primary" onClick={() => void applyPatchFromConsole()}>Apply Patch</button>
              </div>
            </>
          ) : null}

          <h3>Design Lab</h3>
          <div className="design-lab">
            <label className="prop-field">
              <span className="prop-label">Accent</span>
              <input type="color" value={uiAccent} onChange={(event) => setUiAccent(event.target.value)} />
            </label>
            <label className="prop-field">
              <span className="prop-label">Accent 2</span>
              <input type="color" value={uiAccent2} onChange={(event) => setUiAccent2(event.target.value)} />
            </label>
            <label className="prop-field">
              <span className="prop-label">Panel Tone</span>
              <input type="color" value={uiPanelTone} onChange={(event) => setUiPanelTone(event.target.value)} />
            </label>
            <label className="prop-field">
              <span className="prop-label">Canvas Tone</span>
              <input type="color" value={canvasTone} onChange={(event) => setCanvasTone(event.target.value)} />
            </label>
          </div>
          <div className="theme-presets">
            <button type="button" className="btn-soft" onClick={() => applyThemePreset("teal")}>Teal</button>
            <button type="button" className="btn-soft" onClick={() => applyThemePreset("violet")}>Violet</button>
            <button type="button" className="btn-soft" onClick={() => applyThemePreset("amber")}>Amber</button>
            <button type="button" className="btn-soft" onClick={() => applyThemePreset("mono")}>Mono</button>
          </div>

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

      <section className="prompt-dock">
        <div className="prompt-dock-head">
          <span>Prompt Assistant</span>
          <span>Confidence: {promptConfidence !== null ? `${Math.round(promptConfidence * 100)}%` : "n/a"}</span>
        </div>
        <div className="prompt-dock-main">
          <input
            ref={promptInputRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handlePrompt();
              }
            }}
            placeholder="Ask for a change (e.g. On screen 2, add a pricing card and CTA)..."
          />
          <button type="button" onClick={() => void handleSimulatePrompt()} disabled={isSimulatingPrompt}>
            {isSimulatingPrompt ? "Simulating..." : "Simulate"}
          </button>
          <button type="button" onClick={() => void handlePrompt()} disabled={isApplyingPrompt}>
            {isApplyingPrompt ? "Applying..." : "Apply"}
          </button>
        </div>
        <div className="prompt-library-search">
          <input
            value={promptLibraryQuery}
            onChange={(event) => setPromptLibraryQuery(event.target.value)}
            placeholder="Search prompt history and suggestions..."
          />
          <span>{isRefreshingPromptLibrary ? "Updating..." : `${promptSuggestions.length} suggestions`}</span>
        </div>
        <div className="prompt-chip-row">
          {quickPrompts.map((chip) => (
            <button key={chip} type="button" className="prompt-chip" onClick={() => void runQuickPrompt(chip)}>
              {chip}
            </button>
          ))}
          {promptSuggestions.slice(0, 6).map((item) => (
            <button key={item.id} type="button" className="prompt-chip prompt-chip-suggested" onClick={() => void runQuickPrompt(item.text)}>
              {item.text}
            </button>
          ))}
        </div>
        <div className="prompt-history-row">
          {promptHistory.slice(0, 4).map((item) => (
            <button key={item.id} type="button" className="history-chip" onClick={() => setPrompt(item.prompt)}>
              {item.prompt}
            </button>
          ))}
        </div>
        <div className="prompt-dock-foot">
          {promptWarnings.length > 0 ? promptWarnings.join(" | ") : "Tip: reference screens by name, screen number, or 'all screens'."}
        </div>
      </section>

      <footer className="footer">Files: {files.length} | Nodes: {flatten(activeDocument.root).length} | Version: {activeDocument.version}</footer>
    </div>
  );
}
