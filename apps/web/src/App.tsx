import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type MouseEventHandler } from "react";
import type { AstNode, DocumentAst } from "@prynt/ast";
import { serializeDocumentToDsl } from "@prynt/dsl";
import type { PatchOp } from "@prynt/patches";
import { Command } from "cmdk";
import { HexColorPicker } from "react-colorful";
import { Bot, Frame, MonitorSmartphone, Palette, ScanSearch, Sparkles, StickyNote } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import chroma from "chroma-js";

const API_URL = "http://localhost:4000";
const STAGE_WIDTH = 5000;
const STAGE_HEIGHT = 3200;

type DevicePreset = "iphone" | "android" | "tablet";
type InspectorMode = "props" | "source" | "patch";
type ThemeColorTarget = "accent" | "accent2" | "panel" | "canvas";

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

function spacingToPx(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const map: Record<string, number> = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28 };
  return map[value];
}

function fontSizeToPx(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const map: Record<string, number> = { xs: 12, sm: 13, md: 14, lg: 18, xl: 22, "2xl": 28, "3xl": 34, "4xl": 40, "5xl": 46 };
  return map[value];
}

function toneClass(value: unknown): string {
  if (typeof value !== "string") return "tone-surface";
  return `tone-${value}`;
}

function collectVisibleLayerIds(root: AstNode, query: string): Set<string> {
  const q = query.trim().toLowerCase();
  const all = flatten(root);
  if (!q) {
    return new Set(all.map((node) => node.id));
  }

  const parentById = new Map<string, string | null>();
  const stack: Array<{ node: AstNode; parentId: string | null }> = [{ node: root, parentId: null }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    parentById.set(current.node.id, current.parentId);
    for (const child of current.node.children) {
      stack.push({ node: child, parentId: current.node.id });
    }
  }

  const matched = all.filter((node) => node.type.toLowerCase().includes(q) || node.id.toLowerCase().includes(q));
  const visible = new Set<string>();

  for (const node of matched) {
    let cursor: string | null | undefined = node.id;
    while (cursor) {
      visible.add(cursor);
      cursor = parentById.get(cursor);
    }
  }

  return visible;
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
      <h2 key={node.id} className={className} onClick={onClick} style={{ fontSize: fontSizeToPx(node.props.size) }}>
        {String(node.props.text ?? "Heading")}
      </h2>
    );
  }
  if (node.type === "Text") return <p key={node.id} className={className} onClick={onClick}>{String(node.props.text ?? "Text")}</p>;
  if (node.type === "Badge") return <span key={node.id} className={`${className} badge ${toneClass(node.props.tone)}`} onClick={onClick}>{String(node.props.text ?? "Badge")}</span>;
  if (node.type === "Avatar") return <div key={node.id} className={`${className} avatar`} onClick={onClick}>{String(node.props.initials ?? "AB")}</div>;
  if (node.type === "Icon") return <div key={node.id} className={`${className} icon ${toneClass(node.props.tone)}`} onClick={onClick}>{String(node.props.name ?? "icon")}</div>;
  if (node.type === "Divider") return <hr key={node.id} className={className} onClick={onClick} />;
  if (node.type === "Spacer") return <div key={node.id} className={className} onClick={onClick} style={{ height: spacingToPx(node.props.size) ?? 14 }} />;
  if (node.type === "Image") {
    return <img key={node.id} className={className} onClick={onClick} src={String(node.props.src ?? "https://placehold.co/640x360")} alt={String(node.props.alt ?? "Image")} style={{ height: Number(node.props.height ?? 180), objectFit: "cover", width: "100%" }} />;
  }
  if (node.type === "Button" || node.type === "FloatingActionButton") {
    return <button key={node.id} className={`${className} ${toneClass(node.props.tone)}`} onClick={onClick} type="button">{String(node.props.text ?? node.props.icon ?? "Button")}</button>;
  }

  if (node.type === "TopBar") {
    return <div key={node.id} className={`${className} topbar`} onClick={onClick}>{String(node.props.title ?? "Top Bar")}</div>;
  }
  if (node.type === "Navbar") {
    return <div key={node.id} className={`${className} topbar`} onClick={onClick}>{String(node.props.title ?? "Navbar")}</div>;
  }

  if (node.type === "BottomTabBar") {
    const childTabs = node.children.filter((child) => child.type === "Tabs");
    const tabs = childTabs.length > 0 ? childTabs.length : Number(node.props.tabs ?? 4);
    return (
      <div key={node.id} className={`${className} tabbar`} onClick={onClick}>
        {Array.from({ length: tabs }).map((_, index) => <span key={`${node.id}-${index}`} className="tab">{childTabs[index] ? String(childTabs[index].props.label ?? `Tab ${index + 1}`) : `Tab ${index + 1}`}</span>)}
      </div>
    );
  }

  if (node.type === "TextField" || node.type === "Input") {
    return (
      <div key={node.id} className={className} onClick={onClick}>
        <label>{String(node.props.label ?? "Label")}</label>
        <input placeholder={String(node.props.placeholder ?? "Type...")} readOnly style={{ minHeight: Number(node.props.minHeight ?? 44) }} />
      </div>
    );
  }
  if (node.type === "SearchBar") {
    return <input key={node.id} className={`${className} search`} onClick={onClick} readOnly placeholder={String(node.props.placeholder ?? "Search")} style={{ minHeight: Number(node.props.minHeight ?? 44) }} />;
  }
  if (node.type === "TextArea") {
    return <textarea key={node.id} className={className} onClick={onClick} readOnly rows={Number(node.props.rows ?? 4)} placeholder={String(node.props.placeholder ?? "Write here...")} />;
  }
  if (node.type === "Checkbox" || node.type === "Toggle") {
    return <label key={node.id} className={className} onClick={onClick}><input type="checkbox" checked={Boolean(node.props.checked)} readOnly /> {String(node.props.label ?? "Option")}</label>;
  }
  if (node.type === "Select" || node.type === "Picker" || node.type === "RadioGroup") {
    const options = String(node.props.options ?? "One|Two|Three").split("|").map((item) => item.trim()).filter(Boolean);
    return (
      <div key={node.id} className={className} onClick={onClick}>
        <label>{String(node.props.label ?? "Select")}</label>
        <select disabled>{options.map((option) => <option key={option}>{option}</option>)}</select>
      </div>
    );
  }
  if (node.type === "List") {
    return <ul key={node.id} className={className} onClick={onClick}>{node.children.map((child) => renderNode(child, selectedId, onSelect))}</ul>;
  }
  if (node.type === "ListItem") {
    return (
      <li key={node.id} className={`${className} list-item`} onClick={onClick}>
        <span>{String(node.props.title ?? "Item")}</span>
        {node.props.subtitle ? <small>{String(node.props.subtitle)}</small> : null}
      </li>
    );
  }
  if (node.type === "Table") {
    const rows = Math.max(1, Number(node.props.rows ?? 3));
    const cols = Math.max(1, Number(node.props.columns ?? 3));
    return (
      <table key={node.id} className={className} onClick={onClick}>
        <tbody>
          {Array.from({ length: rows }).map((_, row) => (
            <tr key={`${node.id}-${row}`}>
              {Array.from({ length: cols }).map((__, col) => <td key={`${node.id}-${row}-${col}`}>R{row + 1} C{col + 1}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (node.type === "Modal") {
    return (
      <div key={node.id} className={`${className} modal-shell`} onClick={onClick}>
        <div className="modal-card">
          <strong>{String(node.props.title ?? "Modal")}</strong>
          {node.children.map((child) => renderNode(child, selectedId, onSelect))}
        </div>
      </div>
    );
  }

  const containerType =
    node.type === "Card"
      ? "card"
      : node.type === "Stack"
        ? "stack"
        : node.type === "ScrollView"
          ? "scroll"
          : node.type === "Grid"
            ? "grid"
            : node.type === "Sidebar"
              ? "sidebar"
              : node.type === "Form"
                ? "form"
                : "container";
  const customStyle: CSSProperties = {
    gap: spacingToPx(node.props.gap),
    padding: spacingToPx(node.props.padding),
    gridTemplateColumns: node.type === "Grid" ? `repeat(${Math.max(1, Number(node.props.columns ?? 2))}, minmax(0, 1fr))` : undefined
  };

  return (
    <div key={node.id} className={`${className} ${containerType} ${toneClass(node.props.tone)}`} onClick={onClick} style={customStyle}>
      {node.type !== "Screen" && node.type !== "ScrollView" ? <div className="node-label">{node.type}</div> : null}
      {node.children.map((child) => renderNode(child, selectedId, onSelect))}
    </div>
  );
}

function LayerTree({
  node,
  selectedId,
  onSelect,
  visibleIds
}: {
  node: AstNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  visibleIds: Set<string>;
}) {
  if (!visibleIds.has(node.id)) return null;

  return (
    <div className="layer-item">
      <button type="button" className={selectedId === node.id ? "layer-selected" : ""} onClick={() => onSelect(node.id)}>
        {node.type} ({node.id})
      </button>
      <div className="layer-children">
        {node.children.map((child) => <LayerTree key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} visibleIds={visibleIds} />)}
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

function buildNodePreset(type: string): AstNode {
  const id = uid(type.toLowerCase());
  if (type === "Card") {
    return {
      id,
      type: "Card",
      props: { tone: "surface", radius: "lg" },
      children: [
        { id: uid("heading"), type: "Heading", props: { text: "Card title", size: "lg" }, children: [] },
        { id: uid("text"), type: "Text", props: { text: "Card content" }, children: [] }
      ]
    };
  }
  if (type === "Button") return { id, type: "Button", props: { text: "Action", tone: "primary", minHeight: 44, size: "md" }, children: [] };
  if (type === "Text") return { id, type: "Text", props: { text: "New text" }, children: [] };
  if (type === "Heading") return { id, type: "Heading", props: { text: "Heading", size: "xl" }, children: [] };
  if (type === "Image") return { id, type: "Image", props: { src: "https://placehold.co/640x360", alt: "Image", height: 180 }, children: [] };
  if (type === "List") {
    return {
      id,
      type: "List",
      props: {},
      children: [
        { id: uid("li"), type: "ListItem", props: { title: "Item one", subtitle: "Details" }, children: [] },
        { id: uid("li"), type: "ListItem", props: { title: "Item two", subtitle: "Details" }, children: [] }
      ]
    };
  }
  if (type === "TextField") return { id, type: "TextField", props: { label: "Label", placeholder: "Type...", minHeight: 44 }, children: [] };
  if (type === "SearchBar") return { id, type: "SearchBar", props: { placeholder: "Search...", minHeight: 44 }, children: [] };
  if (type === "Checkbox") return { id, type: "Checkbox", props: { label: "Option", checked: false }, children: [] };
  if (type === "Toggle") return { id, type: "Toggle", props: { label: "Enabled", checked: false }, children: [] };
  if (type === "Select") return { id, type: "Select", props: { label: "Select", options: "One|Two|Three" }, children: [] };
  if (type === "Table") return { id, type: "Table", props: { rows: 3, columns: 3 }, children: [] };
  if (type === "Modal") return { id, type: "Modal", props: { title: "Modal", open: true }, children: [{ id: uid("text"), type: "Text", props: { text: "Modal body" }, children: [] }] };
  if (type === "Badge") return { id, type: "Badge", props: { text: "New", tone: "accent" }, children: [] };
  if (type === "Avatar") return { id, type: "Avatar", props: { initials: "AB", size: "md" }, children: [] };
  if (type === "Spacer") return { id, type: "Spacer", props: { size: "md" }, children: [] };
  if (type === "Grid") return { id, type: "Grid", props: { columns: 2, gap: "md" }, children: [] };
  if (type === "Container") return { id, type: "Container", props: { padding: "md", tone: "surface", radius: "md" }, children: [] };
  if (type === "Form") return { id, type: "Form", props: { title: "Form" }, children: [] };
  return { id, type: "Text", props: { text: `Unsupported preset for ${type}` }, children: [] };
}

function buildThemeFromAccent(accent: string) {
  const base = chroma(accent);
  const accent2 = base.set("hsl.h", (base.get("hsl.h") + 38) % 360).saturate(0.4).hex();
  const panel = base.darken(2.8).desaturate(1.2).hex();
  const canvas = base.darken(3.6).desaturate(1.5).hex();
  return { accent, accent2, panel, canvas };
}

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("Create a modern mobile dashboard");
  const [isApplyingPrompt, setIsApplyingPrompt] = useState(false);
  const [isSimulatingPrompt, setIsSimulatingPrompt] = useState(false);
  const [artboardSearch, setArtboardSearch] = useState("");
  const [layerSearch, setLayerSearch] = useState("");
  const [artboardRename, setArtboardRename] = useState("");
  const [uiAccent, setUiAccent] = useState("#5eead4");
  const [uiAccent2, setUiAccent2] = useState("#60a5fa");
  const [uiPanelTone, setUiPanelTone] = useState("#151b27");
  const [canvasTone, setCanvasTone] = useState("#0e1420");
  const [themeColorTarget, setThemeColorTarget] = useState<ThemeColorTarget>("accent");
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
  const [insertComponentType, setInsertComponentType] = useState("Card");
  const [previewDocument, setPreviewDocument] = useState<DocumentAst | null>(null);
  const [zoom, setZoom] = useState(1);
  const [spacePressed, setSpacePressed] = useState(false);
  const [selectedCanvasItemId, setSelectedCanvasItemId] = useState<string | null>("phone-main");
  const [canvasItems, setCanvasItems] = useState<CanvasItem[]>([]);
  const [isCommandOpen, setIsCommandOpen] = useState(false);

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
  const insertComponentOptions = useMemo(
    () => [
      "Card", "Container", "Grid", "Spacer",
      "Heading", "Text", "Image", "Badge", "Avatar", "List",
      "Button", "TextField", "SearchBar", "Checkbox", "Toggle", "Select",
      "Form", "Table", "Modal"
    ],
    []
  );

  const selectedNode = useMemo(() => {
    if (!activeDocument || !selectedId) return null;
    return findNode(activeDocument.root, selectedId);
  }, [activeDocument, selectedId]);
  const visibleLayerIds = useMemo(
    () => (activeDocument ? collectVisibleLayerIds(activeDocument.root, layerSearch) : new Set<string>()),
    [activeDocument, layerSearch]
  );
  const activeThemeColor = useMemo(() => {
    if (themeColorTarget === "accent2") return uiAccent2;
    if (themeColorTarget === "panel") return uiPanelTone;
    if (themeColorTarget === "canvas") return canvasTone;
    return uiAccent;
  }, [themeColorTarget, uiAccent, uiAccent2, uiPanelTone, canvasTone]);
  const commandItems = useMemo(
    () => [
      { id: "apply", label: "Apply Prompt", icon: Bot, action: () => void handlePrompt() },
      { id: "simulate", label: "Simulate Prompt", icon: Sparkles, action: () => void handleSimulatePrompt() },
      { id: "new-screen", label: "Add Screen", icon: MonitorSmartphone, action: () => void addCanvasItem("phone") },
      { id: "new-note", label: "Add Sticky Note", icon: StickyNote, action: () => void addCanvasItem("note") },
      { id: "new-frame", label: "Add Frame", icon: Frame, action: () => void addCanvasItem("frame") },
      { id: "fit-canvas", label: "Fit Canvas", icon: ScanSearch, action: () => fitToViewport() },
      { id: "theme-teal", label: "Theme: Teal", icon: Palette, action: () => applyThemePreset("teal") },
      { id: "theme-violet", label: "Theme: Violet", icon: Palette, action: () => applyThemePreset("violet") },
      { id: "theme-amber", label: "Theme: Amber", icon: Palette, action: () => applyThemePreset("amber") },
      { id: "theme-mono", label: "Theme: Mono", icon: Palette, action: () => applyThemePreset("mono") }
    ],
    [handlePrompt, handleSimulatePrompt, fitToViewport, applyThemePreset]
  );

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

  async function addNode(type: string) {
    if (!selectedId) return;
    const node = buildNodePreset(type);

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

  function applyAccentHarmony() {
    const next = buildThemeFromAccent(uiAccent);
    setUiAccent2(next.accent2);
    setUiPanelTone(next.panel);
    setCanvasTone(next.canvas);
    setStatus("Generated theme harmony from accent.");
  }

  function setThemeColor(value: string) {
    if (themeColorTarget === "accent") {
      setUiAccent(value);
      return;
    }
    if (themeColorTarget === "accent2") {
      setUiAccent2(value);
      return;
    }
    if (themeColorTarget === "panel") {
      setUiPanelTone(value);
      return;
    }
    setCanvasTone(value);
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
        if (event.key.toLowerCase() === "k") {
          event.preventDefault();
          setIsCommandOpen((open) => !open);
        }
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
    size: ["sm", "md", "lg", "xl", "2xl"],
    gap: ["xs", "sm", "md", "lg", "xl"],
    padding: ["xs", "sm", "md", "lg", "xl"]
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
          <button type="button" onClick={() => setIsCommandOpen(true)}>Command</button>
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
          <input className="artboard-search" value={layerSearch} onChange={(event) => setLayerSearch(event.target.value)} placeholder="Search layers..." />
          <LayerTree node={activeDocument.root} selectedId={selectedId} onSelect={setSelectedId} visibleIds={visibleLayerIds} />
        </aside>

        <section className="panel canvas-panel">
          <div className="canvas-toolbar">
            <h2>{previewDocument ? "Canvas (Preview)" : "Canvas"}</h2>
            <Tooltip.Provider delayDuration={200}>
              <div className="canvas-controls">
                <button type="button" onClick={() => setZoom((v) => clampZoom(v - 0.1))}>-</button>
                <span>{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom((v) => clampZoom(v + 0.1))}>+</button>
                <button type="button" onClick={() => setZoom(1)}>100%</button>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button type="button" onClick={() => fitToViewport()}>Fit</button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="ui-tooltip" sideOffset={6}>Fit all content in view</Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button type="button" onClick={() => void addCanvasItem("note")}>Add Note</button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="ui-tooltip" sideOffset={6}>Create a sticky note</Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button type="button" onClick={() => void addCanvasItem("frame")}>Add Frame</button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="ui-tooltip" sideOffset={6}>Create a loose wireframe area</Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button type="button" onClick={() => void addCanvasItem("phone")}>Add Screen</button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="ui-tooltip" sideOffset={6}>Add another mobile artboard</Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
                <button type="button" className="btn-danger" onClick={() => removeSelectedCanvasItem()}>Delete Item</button>
              </div>
            </Tooltip.Provider>
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
                  <select value={insertComponentType} onChange={(event) => setInsertComponentType(event.target.value)}>
                    {insertComponentOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn-soft" onClick={() => void addNode(insertComponentType)}>Add Selected</button>
                  <button type="button" className="btn-soft" onClick={() => void addNode("Card")}>Quick Card</button>
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
            <div className="theme-target-tabs">
              <button type="button" className={themeColorTarget === "accent" ? "tab-active" : ""} onClick={() => setThemeColorTarget("accent")}>Accent</button>
              <button type="button" className={themeColorTarget === "accent2" ? "tab-active" : ""} onClick={() => setThemeColorTarget("accent2")}>Accent 2</button>
              <button type="button" className={themeColorTarget === "panel" ? "tab-active" : ""} onClick={() => setThemeColorTarget("panel")}>Panel</button>
              <button type="button" className={themeColorTarget === "canvas" ? "tab-active" : ""} onClick={() => setThemeColorTarget("canvas")}>Canvas</button>
            </div>
            <HexColorPicker color={activeThemeColor} onChange={setThemeColor} />
            <div className="theme-color-readout">{activeThemeColor.toUpperCase()}</div>
          </div>
          <div className="theme-presets">
            <button type="button" className="btn-soft" onClick={() => applyThemePreset("teal")}>Teal</button>
            <button type="button" className="btn-soft" onClick={() => applyThemePreset("violet")}>Violet</button>
            <button type="button" className="btn-soft" onClick={() => applyThemePreset("amber")}>Amber</button>
            <button type="button" className="btn-soft" onClick={() => applyThemePreset("mono")}>Mono</button>
            <button type="button" className="btn-primary theme-generate" onClick={() => applyAccentHarmony()}>Generate From Accent</button>
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

      {isCommandOpen ? (
        <div className="command-overlay" onClick={() => setIsCommandOpen(false)}>
          <Command className="command-panel" onClick={(event) => event.stopPropagation()}>
            <Command.Input autoFocus placeholder="Search commands..." />
            <Command.List>
              <Command.Empty>No commands found.</Command.Empty>
              <Command.Group heading="Actions">
                {commandItems.map((item) => (
                  <Command.Item
                    key={item.id}
                    onSelect={() => {
                      item.action();
                      setIsCommandOpen(false);
                    }}
                  >
                    <item.icon size={14} />
                    <span>{item.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </div>
      ) : null}

      <footer className="footer">Files: {files.length} | Nodes: {flatten(activeDocument.root).length} | Version: {activeDocument.version}</footer>
    </div>
  );
}
