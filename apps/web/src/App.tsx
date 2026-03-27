import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type MouseEventHandler } from "react";
import type { AstNode, DocumentAst } from "@prynt/ast";
import { serializeDocumentToDsl } from "@prynt/dsl";
import type { PatchOp } from "@prynt/patches";
import { Command } from "cmdk";
import { HexColorPicker } from "react-colorful";
import { Bot, Frame, GitBranch, Mic, MonitorSmartphone, Palette, ScanSearch, Sparkles, StickyNote } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import chroma from "chroma-js";

const API_URL = "http://localhost:4000";
const STAGE_WIDTH = 5000;
const STAGE_HEIGHT = 3200;

type DevicePreset = "iphone" | "android" | "tablet";
type InspectorMode = "props" | "source" | "patch";
type ThemeColorTarget = "accent" | "accent2" | "panel" | "canvas";
type UiVisualMode = "pro" | "glass";

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

interface TemplateDefinition {
  id: string;
  name: string;
  category: string;
  style: string;
  description: string;
}

interface ComponentBlueprint {
  id: string;
  name: string;
  family: string;
  category: "layout" | "navigation" | "content" | "input" | "data" | "commerce" | "marketing";
  style: "modern" | "minimal" | "enterprise" | "glass" | "dark";
  description: string;
  promptHint: string;
}

interface ExportResult {
  format: "json" | "dsl" | "react" | "schema";
  fileId: string;
  fileName: string;
  content: string;
}

interface ProjectSummary {
  projectId: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
}

interface ReusableSection {
  id: string;
  name: string;
  node: AstNode;
  createdAt: string;
}

interface StylePreset {
  id: string;
  name: string;
  props: Record<string, unknown>;
}

interface ContextPromptState {
  open: boolean;
  x: number;
  y: number;
  text: string;
  scope: "node" | "section" | "similar" | "screen" | "project";
}

interface ValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warning";
  repairHint?: string;
}

interface DragState {
  mode: "pan" | "item";
  startX: number;
  startY: number;
  startScrollLeft?: number;
  startScrollTop?: number;
  itemId?: string;
}

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

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

function buildDocumentDiffSummary(before: DocumentAst | null, after: DocumentAst | null): string[] {
  if (!before || !after) return [];
  const beforeNodes = flatten(before.root);
  const afterNodes = flatten(after.root);
  const beforeMap = new Map(beforeNodes.map((node) => [node.id, node]));
  const afterMap = new Map(afterNodes.map((node) => [node.id, node]));

  const added = afterNodes.filter((node) => !beforeMap.has(node.id));
  const removed = beforeNodes.filter((node) => !afterMap.has(node.id));
  const changed = afterNodes.filter((node) => {
    const prev = beforeMap.get(node.id);
    if (!prev) return false;
    return JSON.stringify(prev.props) !== JSON.stringify(node.props);
  });

  const lines: string[] = [];
  if (added.length > 0) lines.push(`+ ${added.length} nodes added`);
  if (removed.length > 0) lines.push(`- ${removed.length} nodes removed`);
  if (changed.length > 0) lines.push(`~ ${changed.length} nodes updated`);
  for (const node of changed.slice(0, 4)) {
    lines.push(`• ${node.type} (${node.id}) props changed`);
  }
  return lines;
}

function findParentId(root: AstNode, targetId: string): string | null {
  const stack: Array<{ node: AstNode; parentId: string | null }> = [{ node: root, parentId: null }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.node.id === targetId) return current.parentId;
    for (const child of current.node.children) {
      stack.push({ node: child, parentId: current.node.id });
    }
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

function renderNode(node: AstNode, selectedIds: Set<string>, onSelect: (id: string, additive: boolean) => void): JSX.Element {
  const selected = selectedIds.has(node.id);
  const className = `node node-${node.type.toLowerCase()}${selected ? " selected" : ""}`;

  const onClick: MouseEventHandler = (event) => {
    event.stopPropagation();
    onSelect(node.id, event.shiftKey);
  };

  if (node.type === "Heading") {
    return (
      <h2 key={node.id} data-node-id={node.id} className={className} onClick={onClick} style={{ fontSize: fontSizeToPx(node.props.size) }}>
        {String(node.props.text ?? "Heading")}
      </h2>
    );
  }
  if (node.type === "Text") return <p key={node.id} data-node-id={node.id} className={className} onClick={onClick}>{String(node.props.text ?? "Text")}</p>;
  if (node.type === "Badge") return <span key={node.id} data-node-id={node.id} className={`${className} badge ${toneClass(node.props.tone)}`} onClick={onClick}>{String(node.props.text ?? "Badge")}</span>;
  if (node.type === "Avatar") return <div key={node.id} data-node-id={node.id} className={`${className} avatar`} onClick={onClick}>{String(node.props.initials ?? "AB")}</div>;
  if (node.type === "Icon") return <div key={node.id} data-node-id={node.id} className={`${className} icon ${toneClass(node.props.tone)}`} onClick={onClick}>{String(node.props.name ?? "icon")}</div>;
  if (node.type === "Divider") return <hr key={node.id} data-node-id={node.id} className={className} onClick={onClick} />;
  if (node.type === "Spacer") return <div key={node.id} data-node-id={node.id} className={className} onClick={onClick} style={{ height: spacingToPx(node.props.size) ?? 14 }} />;
  if (node.type === "Image") {
    return <img key={node.id} data-node-id={node.id} className={className} onClick={onClick} src={String(node.props.src ?? "https://placehold.co/640x360")} alt={String(node.props.alt ?? "Image")} style={{ height: Number(node.props.height ?? 180), objectFit: "cover", width: "100%" }} />;
  }
  if (node.type === "Button" || node.type === "FloatingActionButton") {
    return <button key={node.id} data-node-id={node.id} className={`${className} ${toneClass(node.props.tone)}`} onClick={onClick} type="button">{String(node.props.text ?? node.props.icon ?? "Button")}</button>;
  }

  if (node.type === "TopBar") {
    return <div key={node.id} data-node-id={node.id} className={`${className} topbar`} onClick={onClick}>{String(node.props.title ?? "Top Bar")}</div>;
  }
  if (node.type === "Navbar") {
    return <div key={node.id} data-node-id={node.id} className={`${className} topbar`} onClick={onClick}>{String(node.props.title ?? "Navbar")}</div>;
  }
  if (node.type === "AppBar") {
    return (
      <div key={node.id} data-node-id={node.id} className={`${className} topbar`} onClick={onClick}>
        <strong>{String(node.props.title ?? "App Bar")}</strong>
        <small>{String(node.props.variant ?? "standard")}</small>
      </div>
    );
  }

  if (node.type === "BottomTabBar") {
    const childTabs = node.children.filter((child) => child.type === "Tabs");
    const tabs = childTabs.length > 0 ? childTabs.length : Number(node.props.tabs ?? 4);
    return (
      <div key={node.id} data-node-id={node.id} className={`${className} tabbar`} onClick={onClick}>
        {Array.from({ length: tabs }).map((_, index) => <span key={`${node.id}-${index}`} className="tab">{childTabs[index] ? String(childTabs[index].props.label ?? `Tab ${index + 1}`) : `Tab ${index + 1}`}</span>)}
      </div>
    );
  }

  if (node.type === "TextField" || node.type === "Input") {
    return (
      <div key={node.id} data-node-id={node.id} className={className} onClick={onClick}>
        <label>{String(node.props.label ?? "Label")}</label>
        <input placeholder={String(node.props.placeholder ?? "Type...")} readOnly style={{ minHeight: Number(node.props.minHeight ?? 44) }} />
      </div>
    );
  }
  if (node.type === "PasswordField") {
    return (
      <div key={node.id} data-node-id={node.id} className={className} onClick={onClick}>
        <label>{String(node.props.label ?? "Password")}</label>
        <input type="password" placeholder={String(node.props.placeholder ?? "••••••••")} readOnly style={{ minHeight: Number(node.props.minHeight ?? 44) }} />
      </div>
    );
  }
  if (node.type === "OTPInput") {
    const length = Math.max(4, Number(node.props.length ?? 6));
    return (
      <div key={node.id} data-node-id={node.id} className={`${className} otp`} onClick={onClick}>
        {Array.from({ length }).map((_, index) => (
          <input key={`${node.id}-${index}`} readOnly value="" placeholder="•" />
        ))}
      </div>
    );
  }
  if (node.type === "SearchBar") {
    return <input key={node.id} data-node-id={node.id} className={`${className} search`} onClick={onClick} readOnly placeholder={String(node.props.placeholder ?? "Search")} style={{ minHeight: Number(node.props.minHeight ?? 44) }} />;
  }
  if (node.type === "TextArea") {
    return <textarea key={node.id} data-node-id={node.id} className={className} onClick={onClick} readOnly rows={Number(node.props.rows ?? 4)} placeholder={String(node.props.placeholder ?? "Write here...")} />;
  }
  if (node.type === "Checkbox" || node.type === "Toggle") {
    return <label key={node.id} data-node-id={node.id} className={className} onClick={onClick}><input type="checkbox" checked={Boolean(node.props.checked)} readOnly /> {String(node.props.label ?? "Option")}</label>;
  }
  if (node.type === "Select" || node.type === "Picker" || node.type === "RadioGroup") {
    const options = String(node.props.options ?? "One|Two|Three").split("|").map((item) => item.trim()).filter(Boolean);
    return (
      <div key={node.id} data-node-id={node.id} className={className} onClick={onClick}>
        <label>{String(node.props.label ?? "Select")}</label>
        <select disabled>{options.map((option) => <option key={option}>{option}</option>)}</select>
      </div>
    );
  }
  if (node.type === "DatePicker" || node.type === "TimePicker" || node.type === "FilePicker") {
    return (
      <div key={node.id} data-node-id={node.id} className={className} onClick={onClick}>
        <label>{String(node.props.label ?? node.type)}</label>
        <input
          readOnly
          value={String(node.props.value ?? node.props.accept ?? "")}
          placeholder={node.type === "FilePicker" ? "image/*" : ""}
        />
      </div>
    );
  }
  if (node.type === "Slider") {
    return (
      <div key={node.id} data-node-id={node.id} className={className} onClick={onClick}>
        <input type="range" min={Number(node.props.min ?? 0)} max={Number(node.props.max ?? 100)} value={Number(node.props.value ?? 50)} readOnly />
      </div>
    );
  }
  if (node.type === "SegmentedControl") {
    const options = String(node.props.options ?? "One|Two|Three").split("|").map((item) => item.trim()).filter(Boolean);
    const selected = Number(node.props.selected ?? 0);
    return (
      <div key={node.id} data-node-id={node.id} className={`${className} segmented`} onClick={onClick}>
        {options.map((option, index) => <span key={`${node.id}-${option}`} className={index === selected ? "active" : ""}>{option}</span>)}
      </div>
    );
  }
  if (node.type === "Breadcrumb") {
    const items = String(node.props.items ?? "Home|Section|Page").split("|").map((item) => item.trim()).filter(Boolean);
    return <div key={node.id} data-node-id={node.id} className={`${className} breadcrumb`} onClick={onClick}>{items.join(" / ")}</div>;
  }
  if (node.type === "Stepper") {
    const steps = Math.max(2, Number(node.props.steps ?? 4));
    const current = Math.max(1, Number(node.props.current ?? 1));
    return (
      <div key={node.id} data-node-id={node.id} className={`${className} stepper`} onClick={onClick}>
        {Array.from({ length: steps }).map((_, index) => (
          <span key={`${node.id}-${index}`} className={index + 1 <= current ? "active" : ""}>{index + 1}</span>
        ))}
      </div>
    );
  }
  if (node.type === "PaginationDots") {
    const count = Math.max(2, Number(node.props.count ?? 3));
    const active = Math.max(1, Number(node.props.active ?? 1));
    return (
      <div key={node.id} data-node-id={node.id} className={`${className} pagination-dots`} onClick={onClick}>
        {Array.from({ length: count }).map((_, index) => <span key={`${node.id}-${index}`} className={index + 1 === active ? "active" : ""} />)}
      </div>
    );
  }
  if (node.type === "AlertBanner" || node.type === "Snackbar" || node.type === "Toast" || node.type === "Chip" || node.type === "Tooltip") {
    const text = String(node.props.text ?? node.props.action ?? node.type);
    return <div key={node.id} data-node-id={node.id} className={`${className} tone-${String(node.props.tone ?? "surface")}`} onClick={onClick}>{text}</div>;
  }
  if (node.type === "ProgressBar") {
    const value = Math.max(0, Math.min(100, Number(node.props.value ?? 45)));
    return (
      <div key={node.id} data-node-id={node.id} className={`${className} progress`} onClick={onClick}>
        <div className="progress-inner" style={{ width: `${value}%` }} />
      </div>
    );
  }
  if (node.type === "CircularProgress") {
    const value = Math.max(0, Math.min(100, Number(node.props.value ?? 60)));
    return <div key={node.id} data-node-id={node.id} className={`${className} circular-progress`} onClick={onClick}>{value}%</div>;
  }
  if (node.type === "Skeleton") {
    const lines = Math.max(1, Number(node.props.lines ?? 3));
    return (
      <div key={node.id} data-node-id={node.id} className={className} onClick={onClick}>
        {Array.from({ length: lines }).map((_, index) => <div key={`${node.id}-${index}`} className="skeleton-line" />)}
      </div>
    );
  }
  if (node.type === "Chart" || node.type === "MapPreview" || node.type === "VideoPlayer" || node.type === "CalendarStrip" || node.type === "CommandPalette") {
    return <div key={node.id} data-node-id={node.id} className={`${className} widget-placeholder`} onClick={onClick}>{node.type}</div>;
  }
  if (node.type === "EmptyState") {
    return (
      <div key={node.id} data-node-id={node.id} className={className} onClick={onClick}>
        <strong>{String(node.props.title ?? "No data")}</strong>
        <p>{String(node.props.description ?? "Try again later.")}</p>
      </div>
    );
  }
  if (node.type === "NavigationRail") {
    const items = Math.max(3, Number(node.props.items ?? 4));
    return (
      <div key={node.id} data-node-id={node.id} className={`${className} nav-rail`} onClick={onClick}>
        {Array.from({ length: items }).map((_, index) => <span key={`${node.id}-${index}`}>•</span>)}
      </div>
    );
  }
  if (node.type === "Drawer") {
    return <div key={node.id} data-node-id={node.id} className={`${className} drawer`} onClick={onClick}>Drawer ({String(node.props.side ?? "left")})</div>;
  }
  if (node.type === "Carousel" || node.type === "Timeline" || node.type === "KanbanBoard" || node.type === "CommentThread" || node.type === "BottomSheet" || node.type === "ActionSheet" || node.type === "Popover") {
    return (
      <div key={node.id} data-node-id={node.id} className={`${className} widget-placeholder`} onClick={onClick}>
        <strong>{node.type}</strong>
        <small>{Object.entries(node.props).map(([key, value]) => `${key}:${String(value)}`).join(" | ")}</small>
        {node.children.map((child) => renderNode(child, selectedIds, onSelect))}
      </div>
    );
  }
  if (node.type === "List") {
    return <ul key={node.id} data-node-id={node.id} className={className} onClick={onClick}>{node.children.map((child) => renderNode(child, selectedIds, onSelect))}</ul>;
  }
  if (node.type === "ListItem") {
    return (
      <li key={node.id} data-node-id={node.id} className={`${className} list-item`} onClick={onClick}>
        <span>{String(node.props.title ?? "Item")}</span>
        {node.props.subtitle ? <small>{String(node.props.subtitle)}</small> : null}
      </li>
    );
  }
  if (node.type === "Table") {
    const rows = Math.max(1, Number(node.props.rows ?? 3));
    const cols = Math.max(1, Number(node.props.columns ?? 3));
    return (
      <table key={node.id} data-node-id={node.id} className={className} onClick={onClick}>
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
      <div key={node.id} data-node-id={node.id} className={`${className} modal-shell`} onClick={onClick}>
        <div className="modal-card">
          <strong>{String(node.props.title ?? "Modal")}</strong>
          {node.children.map((child) => renderNode(child, selectedIds, onSelect))}
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
    <div key={node.id} data-node-id={node.id} className={`${className} ${containerType} ${toneClass(node.props.tone)}`} onClick={onClick} style={customStyle}>
      {node.type !== "Screen" && node.type !== "ScrollView" ? <div className="node-label">{node.type}</div> : null}
      {node.children.map((child) => renderNode(child, selectedIds, onSelect))}
    </div>
  );
}

function LayerTree({
  node,
  selectedIds,
  onSelect,
  visibleIds
}: {
  node: AstNode;
  selectedIds: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  visibleIds: Set<string>;
}) {
  if (!visibleIds.has(node.id)) return null;

  return (
    <div className="layer-item">
      <button type="button" className={selectedIds.has(node.id) ? "layer-selected" : ""} onClick={(event) => onSelect(node.id, event.shiftKey)}>
        {node.type} ({node.id})
      </button>
      <div className="layer-children">
        {node.children.map((child) => <LayerTree key={child.id} node={child} selectedIds={selectedIds} onSelect={onSelect} visibleIds={visibleIds} />)}
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
  if (type === "AppBar") return { id, type: "AppBar", props: { title: "App Bar", variant: "standard" }, children: [] };
  if (type === "SegmentedControl") return { id, type: "SegmentedControl", props: { options: "Overview|Stats|Settings", selected: 0 }, children: [] };
  if (type === "NavigationRail") return { id, type: "NavigationRail", props: { items: 4 }, children: [] };
  if (type === "Drawer") return { id, type: "Drawer", props: { open: false, side: "left" }, children: [] };
  if (type === "Breadcrumb") return { id, type: "Breadcrumb", props: { items: "Home|Section|Page" }, children: [] };
  if (type === "Stepper") return { id, type: "Stepper", props: { steps: 4, current: 1 }, children: [] };
  if (type === "PaginationDots") return { id, type: "PaginationDots", props: { count: 3, active: 1 }, children: [] };
  if (type === "PasswordField") return { id, type: "PasswordField", props: { label: "Password", placeholder: "••••••••", minHeight: 44 }, children: [] };
  if (type === "OTPInput") return { id, type: "OTPInput", props: { length: 6 }, children: [] };
  if (type === "Slider") return { id, type: "Slider", props: { min: 0, max: 100, value: 50 }, children: [] };
  if (type === "DatePicker") return { id, type: "DatePicker", props: { label: "Date", value: "2026-03-25" }, children: [] };
  if (type === "TimePicker") return { id, type: "TimePicker", props: { label: "Time", value: "09:00" }, children: [] };
  if (type === "FilePicker") return { id, type: "FilePicker", props: { label: "Upload file", accept: "image/*" }, children: [] };
  if (type === "AlertBanner") return { id, type: "AlertBanner", props: { text: "Important alert", tone: "accent" }, children: [] };
  if (type === "Snackbar") return { id, type: "Snackbar", props: { text: "Changes saved", action: "Undo" }, children: [] };
  if (type === "Toast") return { id, type: "Toast", props: { text: "Saved" }, children: [] };
  if (type === "ProgressBar") return { id, type: "ProgressBar", props: { value: 45 }, children: [] };
  if (type === "CircularProgress") return { id, type: "CircularProgress", props: { value: 70 }, children: [] };
  if (type === "Skeleton") return { id, type: "Skeleton", props: { lines: 3 }, children: [] };
  if (type === "EmptyState") return { id, type: "EmptyState", props: { title: "No data", description: "Try another filter." }, children: [] };
  if (type === "Chip") return { id, type: "Chip", props: { text: "Chip", tone: "surface" }, children: [] };
  if (type === "Carousel") return { id, type: "Carousel", props: { slides: 3 }, children: [] };
  if (type === "Timeline") return { id, type: "Timeline", props: { items: 4 }, children: [] };
  if (type === "BottomSheet") return { id, type: "BottomSheet", props: { title: "Bottom Sheet", open: true }, children: [] };
  if (type === "ActionSheet") return { id, type: "ActionSheet", props: { title: "Actions" }, children: [] };
  if (type === "Popover") return { id, type: "Popover", props: { title: "Popover", open: true }, children: [] };
  if (type === "Tooltip") return { id, type: "Tooltip", props: { text: "Helpful hint" }, children: [] };
  if (type === "Chart") return { id, type: "Chart", props: { type: "line", points: 7 }, children: [] };
  if (type === "MapPreview") return { id, type: "MapPreview", props: { location: "Berlin" }, children: [] };
  if (type === "VideoPlayer") return { id, type: "VideoPlayer", props: { title: "Demo video", duration: "02:10" }, children: [] };
  if (type === "KanbanBoard") return { id, type: "KanbanBoard", props: { columns: 3 }, children: [] };
  if (type === "CalendarStrip") return { id, type: "CalendarStrip", props: { days: 7 }, children: [] };
  if (type === "CommentThread") return { id, type: "CommentThread", props: { comments: 4 }, children: [] };
  if (type === "CommandPalette") return { id, type: "CommandPalette", props: { placeholder: "Type a command", open: false }, children: [] };
  return { id, type: "Text", props: { text: `Unsupported preset for ${type}` }, children: [] };
}

function cloneNodeWithNewIds(node: AstNode): AstNode {
  return {
    ...node,
    id: uid(node.type.toLowerCase()),
    props: { ...node.props },
    children: node.children.map((child) => cloneNodeWithNewIds(child))
  };
}

function buildThemeFromAccent(accent: string) {
  const base = chroma(accent);
  const accent2 = base.set("hsl.h", (base.get("hsl.h") + 38) % 360).saturate(0.4).hex();
  const panel = base.darken(2.8).desaturate(1.2).hex();
  const canvas = base.darken(3.6).desaturate(1.5).hex();
  return { accent, accent2, panel, canvas };
}

function buildPromptWithBrief(basePrompt: string, designBrief: string): string {
  const brief = designBrief.trim();
  if (!brief) return basePrompt.trim();
  return `${basePrompt.trim()}\n\nDesign brief: ${brief}`;
}

function generateCritiqueSuggestions(document: DocumentAst | null): string[] {
  if (!document) return [];
  const nodes = flatten(document.root);
  const buttons = nodes.filter((node) => node.type === "Button").length;
  const headings = nodes.filter((node) => node.type === "Heading").length;
  const cards = nodes.filter((node) => node.type === "Card").length;
  const forms = nodes.filter((node) => node.type === "Form" || node.type === "TextField").length;
  const suggestions: string[] = [];
  if (headings === 0) suggestions.push("Add at least one clear heading to improve hierarchy.");
  if (buttons === 0) suggestions.push("Add one primary action button to clarify user intent.");
  if (buttons > 4) suggestions.push("Reduce visible actions; too many buttons can hurt decision clarity.");
  if (cards === 0 && forms === 0) suggestions.push("Group content into cards or form sections for better scanability.");
  if (nodes.length > 90) suggestions.push("Screen is dense; consider splitting into multiple screens or collapsible sections.");
  if (suggestions.length === 0) suggestions.push("Layout quality looks solid. Consider refining spacing rhythm for premium feel.");
  return suggestions;
}

export function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [availableProjects, setAvailableProjects] = useState<ProjectSummary[]>([]);
  const [projectSwitcherId, setProjectSwitcherId] = useState("");
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("Create a modern mobile dashboard");
  const [isApplyingPrompt, setIsApplyingPrompt] = useState(false);
  const [isSimulatingPrompt, setIsSimulatingPrompt] = useState(false);
  const [pendingPromptPreview, setPendingPromptPreview] = useState<{
    prompt: string;
    selectedNodeId?: string;
    selectedScope?: "node" | "section" | "similar" | "screen" | "project";
    summary: string;
  } | null>(null);
  const [previewOps, setPreviewOps] = useState<PatchOp[]>([]);
  const [enabledPreviewOpIds, setEnabledPreviewOpIds] = useState<string[]>([]);
  const [artboardSearch, setArtboardSearch] = useState("");
  const [layerSearch, setLayerSearch] = useState("");
  const [artboardRename, setArtboardRename] = useState("");
  const [uiAccent, setUiAccent] = useState("#5eead4");
  const [uiAccent2, setUiAccent2] = useState("#60a5fa");
  const [uiPanelTone, setUiPanelTone] = useState("#151b27");
  const [canvasTone, setCanvasTone] = useState("#0e1420");
  const [uiVisualMode, setUiVisualMode] = useState<UiVisualMode>("pro");
  const [themeColorTarget, setThemeColorTarget] = useState<ThemeColorTarget>("accent");
  const [device, setDevice] = useState<DevicePreset>("iphone");
  const [status, setStatus] = useState("Ready");
  const [promptConfidence, setPromptConfidence] = useState<number | null>(null);
  const [promptWarnings, setPromptWarnings] = useState<string[]>([]);
  const [lastPromptSummary, setLastPromptSummary] = useState("");
  const [contextPrompt, setContextPrompt] = useState<ContextPromptState>({ open: false, x: 240, y: 180, text: "", scope: "node" });
  const [promptLibraryQuery, setPromptLibraryQuery] = useState("");
  const [promptHistory, setPromptHistory] = useState<PromptHistoryEntry[]>([]);
  const [promptSuggestions, setPromptSuggestions] = useState<PromptSuggestion[]>([]);
  const [isRefreshingPromptLibrary, setIsRefreshingPromptLibrary] = useState(false);
  const [designBrief, setDesignBrief] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [critiqueSuggestions, setCritiqueSuggestions] = useState<string[]>([]);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [templates, setTemplates] = useState<TemplateDefinition[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("mobile-dashboard");
  const [blueprintQuery, setBlueprintQuery] = useState("");
  const [blueprints, setBlueprints] = useState<ComponentBlueprint[]>([]);
  const [selectedBlueprintId, setSelectedBlueprintId] = useState("");
  const [isLoadingBlueprints, setIsLoadingBlueprints] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportResult["format"]>("json");
  const [exportText, setExportText] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [sectionsLibrary, setSectionsLibrary] = useState<ReusableSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [stylePresets, setStylePresets] = useState<StylePreset[]>([]);
  const [selectedStylePresetId, setSelectedStylePresetId] = useState("");
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
  const [lintIssues, setLintIssues] = useState<ValidationIssue[]>([]);
  const [isLinting, setIsLinting] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const speechRef = useRef<BrowserSpeechRecognition | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const canvasHoverRef = useRef(false);
  const gestureScaleRef = useRef<number | null>(null);

  const phoneWidth = useMemo(() => (device === "android" ? 360 : device === "tablet" ? 768 : 390), [device]);
  const selectedIdsSet = useMemo(() => new Set(selectedIds), [selectedIds]);

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
      "Form", "Table", "Modal",
      "AppBar", "SegmentedControl", "NavigationRail", "Drawer", "Breadcrumb", "Stepper", "PaginationDots",
      "PasswordField", "OTPInput", "Slider", "DatePicker", "TimePicker", "FilePicker",
      "AlertBanner", "Snackbar", "Toast", "ProgressBar", "CircularProgress", "Skeleton", "EmptyState", "Chip",
      "Carousel", "Timeline", "BottomSheet", "ActionSheet", "Popover", "Tooltip",
      "Chart", "MapPreview", "VideoPlayer", "KanbanBoard", "CalendarStrip", "CommentThread", "CommandPalette"
    ],
    []
  );

  const selectedNode = useMemo(() => {
    if (!activeDocument || !selectedId) return null;
    return findNode(activeDocument.root, selectedId);
  }, [activeDocument, selectedId]);
  const previewDiffSummary = useMemo(
    () => buildDocumentDiffSummary(activeDocument, previewDocument),
    [activeDocument, previewDocument]
  );
  const selectedBlueprint = useMemo(
    () => blueprints.find((item) => item.id === selectedBlueprintId) ?? null,
    [blueprints, selectedBlueprintId]
  );
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
      { id: "duplicate-screen", label: "Duplicate Artboard", icon: MonitorSmartphone, action: () => void duplicateActiveArtboard() },
      { id: "save-section", label: "Save Selected Section", icon: Sparkles, action: () => saveSelectedAsSection() },
      { id: "insert-section", label: "Insert Saved Section", icon: Frame, action: () => void insertSelectedSection() },
      { id: "apply-template", label: "Apply Selected Template", icon: Sparkles, action: () => void applySelectedTemplate() },
      { id: "export", label: "Export Active File", icon: Palette, action: () => void exportActiveFile() },
      { id: "variants", label: "Generate Variants", icon: GitBranch, action: () => void generatePromptVariants() },
      { id: "next-screen", label: "Generate Next Screen", icon: MonitorSmartphone, action: () => void generateNextScreenFlow() },
      { id: "voice", label: "Voice Prompt", icon: Mic, action: () => toggleVoicePrompt() },
      { id: "theme-teal", label: "Theme: Teal", icon: Palette, action: () => applyThemePreset("teal") },
      { id: "theme-violet", label: "Theme: Violet", icon: Palette, action: () => applyThemePreset("violet") },
      { id: "theme-amber", label: "Theme: Amber", icon: Palette, action: () => applyThemePreset("amber") },
      { id: "theme-mono", label: "Theme: Mono", icon: Palette, action: () => applyThemePreset("mono") }
    ],
    [handlePrompt, handleSimulatePrompt, fitToViewport, applyThemePreset, duplicateActiveArtboard, applySelectedTemplate, exportActiveFile, selectedSectionId, sectionsLibrary, selectedId, isListening]
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
        visualMode?: UiVisualMode;
      };
      if (parsed.accent) setUiAccent(parsed.accent);
      if (parsed.accent2) setUiAccent2(parsed.accent2);
      if (parsed.panel) setUiPanelTone(parsed.panel);
      if (parsed.canvas) setCanvasTone(parsed.canvas);
      if (parsed.device) setDevice(parsed.device);
      if (parsed.visualMode) setUiVisualMode(parsed.visualMode);
    } catch {
      // ignore invalid persisted state
    }
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem("prynt-sections-library");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as ReusableSection[];
      setSectionsLibrary(parsed);
      if (parsed[0]) {
        setSelectedSectionId(parsed[0].id);
      }
    } catch {
      // ignore corrupt cache
    }
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem("prynt-design-brief");
    if (!raw) return;
    setDesignBrief(raw);
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem("prynt-style-presets");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as StylePreset[];
      setStylePresets(parsed);
      if (parsed[0]) setSelectedStylePresetId(parsed[0].id);
    } catch {
      // ignore corrupt cache
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
        device,
        visualMode: uiVisualMode
      })
    );
  }, [uiAccent, uiAccent2, uiPanelTone, canvasTone, device, uiVisualMode]);

  useEffect(() => {
    localStorage.setItem("prynt-sections-library", JSON.stringify(sectionsLibrary.slice(0, 100)));
  }, [sectionsLibrary]);

  useEffect(() => {
    localStorage.setItem("prynt-design-brief", designBrief.slice(0, 4000));
  }, [designBrief]);

  useEffect(() => {
    localStorage.setItem("prynt-style-presets", JSON.stringify(stylePresets.slice(0, 40)));
  }, [stylePresets]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", uiAccent);
    root.style.setProperty("--accent-2", uiAccent2);
    root.style.setProperty("--panel", uiPanelTone);
    root.style.setProperty("--canvas-tone", canvasTone);
  }, [uiAccent, uiAccent2, uiPanelTone, canvasTone]);

  function setPrimarySelection(id: string | null) {
    setSelectedId(id);
    setSelectedIds(id ? [id] : []);
  }

  function handleNodeSelect(id: string, additive: boolean) {
    if (!additive) {
      setSelectedId(id);
      setSelectedIds([id]);
      return;
    }
    setSelectedId(id);
    setSelectedIds((current) => {
      const has = current.includes(id);
      if (has) {
        const next = current.filter((item) => item !== id);
        return next.length > 0 ? next : [id];
      }
      return [...current, id];
    });
  }

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

  async function refreshTemplates() {
    try {
      const response = await apiRequest<{ templates: TemplateDefinition[] }>("/templates");
      setTemplates(response.templates);
      if (response.templates.length > 0) {
        setSelectedTemplateId((current) => (response.templates.some((item) => item.id === current) ? current : (response.templates[0]?.id ?? current)));
      }
    } catch {
      setTemplates([]);
    }
  }

  async function refreshBlueprints(query = "") {
    setIsLoadingBlueprints(true);
    try {
      const response = await apiRequest<{ items: ComponentBlueprint[] }>(
        `/components/blueprints?query=${encodeURIComponent(query)}`
      );
      setBlueprints(response.items);
      setSelectedBlueprintId((current) => {
        if (response.items.some((item) => item.id === current)) {
          return current;
        }
        return response.items[0]?.id ?? "";
      });
    } catch {
      setBlueprints([]);
    } finally {
      setIsLoadingBlueprints(false);
    }
  }

  async function refreshProjects() {
    try {
      const response = await apiRequest<{ projects: ProjectSummary[] }>("/projects");
      setAvailableProjects(response.projects);
    } catch {
      setAvailableProjects([]);
    }
  }

  async function openProject(targetProjectId?: string) {
    const created = await apiRequest<{ projectId: string; files: ProjectFile[] }>("/projects", {
      method: "POST",
      body: JSON.stringify(targetProjectId ? { projectId: targetProjectId } : {})
    });

    setProjectId(created.projectId);
    setProjectSwitcherId(created.projectId);
    setFiles(created.files);
    const phones = created.files.map((file, index) => ({
      id: index === 0 ? "phone-main" : uid("phone"),
      type: "phone" as const,
      fileId: file.fileId,
      x: 760 + index * 460,
      y: 380,
      width: phoneWidth,
      height: 760
    }));
    setCanvasItems(phones);
    setSelectedCanvasItemId(phones[0]?.id ?? null);
    setPrimarySelection(created.files[0]?.document.root.id ?? null);

    if (created.files[0]) {
      await refreshVersions(created.projectId, created.files[0].fileId);
      await refreshPromptLibrary(created.projectId, created.files[0].fileId);
    }
    await refreshTemplates();
    await refreshBlueprints("");
    await refreshProjects();
    setStatus(`Project ready: ${created.projectId}`);

    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollLeft = 520;
      viewport.scrollTop = 260;
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
      await openProject();
    })();
  }, []);

  useEffect(() => {
    setCanvasItems((current) => current.map((item) => (item.type === "phone" ? { ...item, width: phoneWidth } : item)));
  }, [phoneWidth]);

  useEffect(() => {
    if (!projectId || !activeFileId) return;
    void refreshVersions(projectId, activeFileId);
    const rootId = activeFile?.document.root.id;
    if (rootId) setPrimarySelection(rootId);
  }, [projectId, activeFileId]);

  useEffect(() => {
    if (!projectId || !activeFileId) return;
    const timer = window.setTimeout(() => {
      void refreshPromptLibrary(projectId, activeFileId, promptLibraryQuery);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [projectId, activeFileId, promptLibraryQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshBlueprints(blueprintQuery);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [blueprintQuery]);

  async function applyPatch(patches: PatchOp[], reason: string) {
    if (!projectId || !activeFileId) return;
    const expectedVersion = activeDocument?.version;

    const response = await apiRequest<{ applied: boolean; fileId: string; document: DocumentAst; repairSuggestions: string[] }>(`/projects/${projectId}/patch`, {
      method: "POST",
      body: JSON.stringify({ fileId: activeFileId, patches, reason, ...(typeof expectedVersion === "number" ? { expectedVersion } : {}) })
    });

    patchFileDocument(response.fileId, response.document);
    setPreviewDocument(null);
    setStatus(response.applied ? `Applied: ${reason}` : `Rejected: ${response.repairSuggestions.join(" | ")}`);
    await refreshVersions(projectId, response.fileId);
  }

  async function previewPatch(patches: PatchOp[]) {
    if (!projectId || !activeFileId) return;
    const expectedVersion = activeDocument?.version;

    const response = await apiRequest<{ applied: boolean; document: DocumentAst; repairSuggestions: string[] }>(`/projects/${projectId}/patch/preview`, {
      method: "POST",
      body: JSON.stringify({ fileId: activeFileId, patches, reason: "Preview", ...(typeof expectedVersion === "number" ? { expectedVersion } : {}) })
    });

    setPreviewDocument(response.document);
    setStatus(response.applied ? "Preview ready" : `Preview invalid: ${response.repairSuggestions.join(" | ")}`);
  }

  async function handlePrompt(
    overridePrompt?: string,
    options?: { selectedNodeId?: string; selectedScope?: "node" | "section" | "similar" | "screen" | "project" }
  ) {
    if (!projectId || !activeFileId) {
      setStatus("No active screen selected.");
      return;
    }

    const rawPrompt = (overridePrompt ?? prompt).trim();
    if (!rawPrompt) {
      setStatus("Type a prompt before applying.");
      return;
    }
    const finalPrompt = buildPromptWithBrief(rawPrompt, designBrief);

    setIsApplyingPrompt(true);
    setStatus("Applying prompt...");
    try {
      const response = await apiRequest<{
        intent: IntentSpec;
        source: "llm" | "rule" | "mixed";
        fileName: string;
        response: { fileId: string; document: DocumentAst; applied: boolean; repairSuggestions: string[] };
        results: Array<{ fileId: string; fileName: string; source: "llm" | "rule"; response: { document: DocumentAst; applied: boolean } }>;
      }>(`/projects/${projectId}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          fileId: activeFileId,
          prompt: finalPrompt,
          selectedNodeId: options?.selectedNodeId ?? selectedId ?? undefined,
          selectedScope: options?.selectedScope
        })
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
      setPendingPromptPreview(null);
      setPreviewOps([]);
      setEnabledPreviewOpIds([]);
      setPromptConfidence(response.intent.confidence);
      setPromptWarnings(response.intent.warnings);
      setLastPromptSummary(
        response.results
          .map((item) => `${item.fileName}: ${item.response.applied ? "applied" : "failed"} via ${item.source}`)
          .join(" | ")
      );
      setStatus(
        response.response.applied
          ? `Prompt applied on ${response.results.length} screen(s) (${response.source})`
          : response.response.repairSuggestions.join(" | ")
      );
      await refreshVersions(projectId, response.response.fileId);
      await refreshPromptLibrary(projectId, response.response.fileId, promptLibraryQuery);
      setCritiqueSuggestions(generateCritiqueSuggestions(response.response.document));
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

  async function handleSimulatePrompt(
    overridePrompt?: string,
    options?: { selectedNodeId?: string; selectedScope?: "node" | "section" | "similar" | "screen" | "project" }
  ) {
    if (!projectId || !activeFileId) {
      setStatus("No active screen selected.");
      return;
    }

    const rawPrompt = (overridePrompt ?? prompt).trim();
    if (!rawPrompt) {
      setStatus("Type a prompt before simulating.");
      return;
    }
    const finalPrompt = buildPromptWithBrief(rawPrompt, designBrief);

    setIsSimulatingPrompt(true);
    setStatus("Simulating prompt...");
    try {
      const response = await apiRequest<{
        intent: IntentSpec;
        results: Array<{ fileId: string; fileName: string; source: "llm" | "rule"; patches: PatchOp[]; response: { applied: boolean; warnings: string[]; document: DocumentAst } }>;
      }>(`/projects/${projectId}/prompt/simulate`, {
        method: "POST",
        body: JSON.stringify({
          fileId: activeFileId,
          prompt: finalPrompt,
          selectedNodeId: options?.selectedNodeId ?? selectedId ?? undefined,
          selectedScope: options?.selectedScope
        })
      });

      setPromptConfidence(response.intent.confidence);
      setPromptWarnings(response.intent.warnings);
      const okCount = response.results.filter((result) => result.response.applied).length;
      const activePreview = response.results.find((result) => result.fileId === activeFileId) ?? response.results[0];
      if (activePreview) {
        setPreviewDocument(activePreview.response.document);
      }
      const selectedNodeId = options?.selectedNodeId ?? selectedId ?? undefined;
      const selectedScope = options?.selectedScope;
      setPendingPromptPreview({
        prompt: finalPrompt,
        ...(selectedNodeId ? { selectedNodeId } : {}),
        ...(selectedScope ? { selectedScope } : {}),
        summary: `${okCount}/${response.results.length} screen(s) valid`
      });
      const ops = activePreview?.patches ?? [];
      setPreviewOps(ops);
      setEnabledPreviewOpIds(ops.map((op) => op.opId));
      setStatus(`Simulation ready: ${okCount}/${response.results.length} screen(s) valid`);
    } catch (error) {
      setStatus(`Simulation failed: ${(error as Error).message}`);
    } finally {
      setIsSimulatingPrompt(false);
    }
  }

  async function applyPromptToSelectedNodes() {
    if (!projectId || !activeFileId) return;
    if (selectedIds.length === 0) {
      setStatus("Select one or more nodes first.");
      return;
    }
    const text = prompt.trim();
    if (!text) {
      setStatus("Type a prompt first.");
      return;
    }
    setIsApplyingPrompt(true);
    try {
      const response = await apiRequest<{
        appliedCount: number;
        failedCount: number;
        document: DocumentAst;
      }>(`/projects/${projectId}/prompt/batch`, {
        method: "POST",
        body: JSON.stringify({
          fileId: activeFileId,
          prompt: buildPromptWithBrief(text, designBrief),
          selectedNodeIds: selectedIds,
          selectedScope: "node"
        })
      });
      patchFileDocument(activeFileId, response.document);
      setPreviewDocument(null);
      setPendingPromptPreview(null);
      setStatus(`Applied prompt to ${response.appliedCount}/${selectedIds.length} selected nodes (${response.failedCount} failed).`);
      await refreshVersions(projectId, activeFileId);
      await refreshPromptLibrary(projectId, activeFileId, promptLibraryQuery);
    } finally {
      setIsApplyingPrompt(false);
    }
  }

  function toggleVoicePrompt() {
    if (isListening && speechRef.current) {
      speechRef.current.stop();
      setIsListening(false);
      return;
    }
    const SpeechCtor = (window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition; webkitSpeechRecognition?: new () => BrowserSpeechRecognition }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => BrowserSpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechCtor) {
      setStatus("Voice input is not supported in this browser.");
      return;
    }
    const recognition = new SpeechCtor();
    speechRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const first = event.results[0];
      const transcript = first && first[0] ? first[0].transcript : "";
      if (transcript.trim()) {
        setPrompt((current) => (current.trim() ? `${current.trim()} ${transcript.trim()}` : transcript.trim()));
      }
    };
    recognition.onerror = (event) => {
      setStatus(`Voice input error: ${event.error}`);
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    setIsListening(true);
    recognition.start();
  }

  async function generatePromptVariants() {
    if (!projectId || !activeFileId || !activeFile) return;
    const basePrompt = prompt.trim();
    if (!basePrompt) {
      setStatus("Type a base prompt first.");
      return;
    }
    const variantStyles = ["minimal", "enterprise", "glassmorphism"];
    setIsGeneratingVariants(true);
    try {
      for (const style of variantStyles) {
        const file = await apiRequest<ProjectFile>(`/projects/${projectId}/files`, {
          method: "POST",
          body: JSON.stringify({ name: `${activeFile.name} ${style}`, baseFileId: activeFileId })
        });
        setFiles((current) => [...current, file]);
        const id = uid("phone");
        setCanvasItems((current) => [...current, { id, type: "phone", fileId: file.fileId, x: 1680 + Math.random() * 220, y: 420 + Math.random() * 140, width: phoneWidth, height: 760 }]);
        await apiRequest(`/projects/${projectId}/prompt`, {
          method: "POST",
          body: JSON.stringify({
            fileId: file.fileId,
            prompt: buildPromptWithBrief(`${basePrompt}. Style direction: ${style}.`, designBrief)
          })
        });
      }
      setStatus("Generated prompt style variants.");
    } catch (error) {
      setStatus(`Variant generation failed: ${(error as Error).message}`);
    } finally {
      setIsGeneratingVariants(false);
    }
  }

  async function generateNextScreenFlow() {
    if (!projectId || !activeFileId || !activeFile) return;
    try {
      const file = await apiRequest<ProjectFile>(`/projects/${projectId}/files`, {
        method: "POST",
        body: JSON.stringify({ name: `${activeFile.name} Next`, baseFileId: activeFileId })
      });
      setFiles((current) => [...current, file]);
      const id = uid("phone");
      setCanvasItems((current) => [...current, { id, type: "phone", fileId: file.fileId, x: 1760, y: 460, width: phoneWidth, height: 760 }]);
      await apiRequest(`/projects/${projectId}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          fileId: file.fileId,
          prompt: buildPromptWithBrief(`Create the next logical user-flow screen after '${activeFile.name}'. Keep navigation continuity.`, designBrief)
        })
      });
      setSelectedCanvasItemId(id);
      setStatus("Generated next-screen flow.");
    } catch (error) {
      setStatus(`Next-screen generation failed: ${(error as Error).message}`);
    }
  }

  async function runCritiqueCoach() {
    const local = generateCritiqueSuggestions(activeDocument);
    if (!projectId || !activeDocument) {
      setCritiqueSuggestions(local);
      setStatus("Design critique generated.");
      return;
    }
    try {
      const response = await apiRequest<{ suggestions: string[] }>(`/projects/${projectId}/repair/suggest`, {
        method: "POST",
        body: JSON.stringify({ document: activeDocument })
      });
      setCritiqueSuggestions([...local, ...response.suggestions].slice(0, 8));
      setStatus("Design critique generated.");
    } catch {
      setCritiqueSuggestions(local);
      setStatus("Design critique generated.");
    }
  }

  function selectSimilarNodes() {
    if (!activeDocument || !selectedNode) {
      setStatus("Select a node first.");
      return;
    }
    const nodes = flatten(activeDocument.root).filter((node) => node.type === selectedNode.type).map((node) => node.id);
    setSelectedIds(nodes);
    if (nodes[0]) {
      setSelectedId(nodes[0]);
    }
    setStatus(`Selected ${nodes.length} ${selectedNode.type} nodes.`);
  }

  async function runDesignLint() {
    if (!projectId || !activeDocument) return;
    setIsLinting(true);
    try {
      const response = await apiRequest<{ issues: ValidationIssue[]; suggestions: string[] }>(`/projects/${projectId}/repair/suggest`, {
        method: "POST",
        body: JSON.stringify({ document: activeDocument })
      });
      setLintIssues(response.issues);
      const errorCount = response.issues.filter((issue) => issue.severity === "error").length;
      const warningCount = response.issues.filter((issue) => issue.severity === "warning").length;
      setStatus(`Lint complete: ${errorCount} errors, ${warningCount} warnings.`);
    } catch (error) {
      setStatus(`Lint failed: ${(error as Error).message}`);
      setLintIssues([]);
    } finally {
      setIsLinting(false);
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
    setPrimarySelection(activeDocument.root.id);
  }

  async function duplicateSelected() {
    if (!selectedId || !activeDocument) return;
    if (selectedId === activeDocument.root.id) {
      setStatus("Duplicate root is not supported.");
      return;
    }
    const source = findNode(activeDocument.root, selectedId);
    const parentId = findParentId(activeDocument.root, selectedId);
    if (!source || !parentId) {
      setStatus("Unable to locate selected component.");
      return;
    }
    const clone = cloneNodeWithNewIds(source);
    await applyPatch([{ opId: uid("duplicate"), type: "addNode", parentId, node: clone }], `Duplicate ${source.type}`);
    setPrimarySelection(clone.id);
  }

  function saveSelectedAsSection() {
    if (!selectedNode) {
      setStatus("Select a node to save as reusable section.");
      return;
    }
    const section: ReusableSection = {
      id: uid("section"),
      name: `${selectedNode.type} ${new Date().toLocaleTimeString()}`,
      node: cloneNodeWithNewIds(selectedNode),
      createdAt: new Date().toISOString()
    };
    setSectionsLibrary((current) => [section, ...current].slice(0, 100));
    setSelectedSectionId(section.id);
    setStatus(`Saved reusable section: ${section.name}`);
  }

  async function insertSelectedSection() {
    if (!selectedId) {
      setStatus("Select a parent node before inserting a reusable section.");
      return;
    }
    const section = sectionsLibrary.find((item) => item.id === selectedSectionId);
    if (!section) {
      setStatus("Choose a reusable section first.");
      return;
    }
    const node = cloneNodeWithNewIds(section.node);
    await applyPatch([{ opId: uid("section"), type: "addNode", parentId: selectedId, node }], `Insert section: ${section.name}`);
  }

  function removeSavedSection() {
    if (!selectedSectionId) return;
    setSectionsLibrary((current) => {
      const next = current.filter((item) => item.id !== selectedSectionId);
      setSelectedSectionId(next[0]?.id ?? "");
      return next;
    });
  }

  async function updateProp(key: string, value: string) {
    if (!selectedId) return;
    await applyPatch([{ opId: uid("update"), type: "updateProps", targetId: selectedId, props: { [key]: parseValue(value) } }], `Update ${key}`);
  }

  async function applyComponentVariant(variant: "default" | "soft" | "bold" | "ghost") {
    if (!selectedId || !selectedNode) return;
    const common: Record<string, unknown> =
      variant === "bold"
        ? { tone: "primary", radius: "xl", size: "lg", padding: "lg", minHeight: 48 }
        : variant === "soft"
          ? { tone: "secondary", radius: "lg", size: "md", padding: "md", minHeight: 44 }
          : variant === "ghost"
            ? { tone: "muted", radius: "sm", size: "md", padding: "sm", minHeight: 40 }
            : { tone: "surface", radius: "md", size: "md", padding: "md", minHeight: 44 };

    const props = Object.fromEntries(Object.entries(common).filter(([key]) => Object.prototype.hasOwnProperty.call(selectedNode.props, key)));
    if (Object.keys(props).length === 0) {
      setStatus("No compatible style props on selected component.");
      return;
    }
    await applyPatch([{ opId: uid("variant"), type: "updateProps", targetId: selectedId, props }], `Apply ${variant} variant`);
  }

  function saveCurrentStylePreset() {
    if (!selectedNode) {
      setStatus("Select a component first.");
      return;
    }
    const eligibleKeys = ["tone", "radius", "size", "padding", "gap", "minHeight"];
    const props = Object.fromEntries(Object.entries(selectedNode.props).filter(([key]) => eligibleKeys.includes(key)));
    if (Object.keys(props).length === 0) {
      setStatus("Selected component has no style-token props to save.");
      return;
    }
    const preset: StylePreset = {
      id: uid("style"),
      name: `${selectedNode.type} style`,
      props
    };
    setStylePresets((current) => [preset, ...current].slice(0, 40));
    setSelectedStylePresetId(preset.id);
    setStatus(`Saved style preset: ${preset.name}`);
  }

  async function applySelectedStylePreset() {
    if (!selectedId) return;
    const preset = stylePresets.find((item) => item.id === selectedStylePresetId);
    if (!preset) {
      setStatus("Choose a style preset first.");
      return;
    }
    await applyPatch([{ opId: uid("style"), type: "updateProps", targetId: selectedId, props: preset.props }], `Apply style preset: ${preset.name}`);
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

  async function duplicateActiveArtboard() {
    if (!projectId || !activeFileId || !activeFile) return;
    try {
      const file = await apiRequest<ProjectFile>(`/projects/${projectId}/files/${activeFileId}/duplicate`, {
        method: "POST",
        body: JSON.stringify({ name: `${activeFile.name} Copy` })
      });
      const id = uid("phone");
      setFiles((current) => [...current, file]);
      setCanvasItems((current) => [...current, { id, type: "phone", fileId: file.fileId, x: 1540, y: 420, width: phoneWidth, height: 760 }]);
      setSelectedCanvasItemId(id);
      setPrimarySelection(file.document.root.id);
      await refreshVersions(projectId, file.fileId);
      setStatus(`Duplicated artboard: ${file.name}`);
    } catch (error) {
      setStatus(`Duplicate failed: ${(error as Error).message}`);
    }
  }

  async function deleteActiveArtboard() {
    if (!projectId || !activeFileId) return;
    try {
      const response = await apiRequest<{ deleted: boolean; fileId: string; nextActiveFileId: string | null }>(
        `/projects/${projectId}/files/${activeFileId}`,
        { method: "DELETE" }
      );
      if (!response.deleted) {
        setStatus("Delete request was ignored.");
        return;
      }
      setFiles((current) => current.filter((item) => item.fileId !== response.fileId));
      let nextSelection: string | null = null;
      setCanvasItems((current) => {
        const nextItems = current.filter((item) => !(item.type === "phone" && item.fileId === response.fileId));
        const nextPhone = nextItems.find((item) => item.type === "phone" && item.fileId === response.nextActiveFileId);
        nextSelection = nextPhone?.id ?? nextItems.find((item) => item.type === "phone")?.id ?? null;
        return nextItems;
      });
      setSelectedCanvasItemId(nextSelection);
      setStatus("Artboard deleted.");
    } catch (error) {
      setStatus(`Delete failed: ${(error as Error).message}`);
    }
  }

  async function applySelectedTemplate() {
    if (!projectId || !activeFileId || !selectedTemplateId) return;
    try {
      const file = await apiRequest<ProjectFile>(`/projects/${projectId}/templates/apply`, {
        method: "POST",
        body: JSON.stringify({ fileId: activeFileId, templateId: selectedTemplateId })
      });
      patchFileDocument(file.fileId, file.document);
      setPrimarySelection(file.document.root.id);
      setStatus(`Applied template: ${selectedTemplateId}`);
      await refreshVersions(projectId, file.fileId);
    } catch (error) {
      setStatus(`Template apply failed: ${(error as Error).message}`);
    }
  }

  async function instantiateSelectedBlueprint() {
    if (!projectId || !activeFileId || !selectedBlueprintId) return;
    const parentId = selectedId ?? activeDocument?.root.id;
    if (!parentId) {
      setStatus("Select a valid target before inserting a blueprint.");
      return;
    }
    try {
      const response = await apiRequest<{ applied: boolean; fileId: string; document: DocumentAst; repairSuggestions: string[] }>(
        `/projects/${projectId}/components/instantiate`,
        {
          method: "POST",
          body: JSON.stringify({
            fileId: activeFileId,
            parentId,
            blueprintId: selectedBlueprintId
          })
        }
      );
      patchFileDocument(response.fileId, response.document);
      setStatus(response.applied ? "Blueprint inserted." : response.repairSuggestions.join(" | "));
      setPreviewDocument(null);
      await refreshVersions(projectId, response.fileId);
    } catch (error) {
      setStatus(`Blueprint insert failed: ${(error as Error).message}`);
    }
  }

  async function exportActiveFile() {
    if (!projectId || !activeFileId) return;
    setIsExporting(true);
    try {
      const result = await apiRequest<ExportResult>(
        `/projects/${projectId}/export?fileId=${encodeURIComponent(activeFileId)}&format=${encodeURIComponent(exportFormat)}`
      );
      setExportText(result.content);
      try {
        await navigator.clipboard.writeText(result.content);
        setStatus(`Exported ${result.format.toUpperCase()} and copied to clipboard.`);
      } catch {
        setStatus(`Exported ${result.format.toUpperCase()}.`);
      }
    } catch (error) {
      setStatus(`Export failed: ${(error as Error).message}`);
    } finally {
      setIsExporting(false);
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
      setPrimarySelection(file.document.root.id);
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

  function openContextPrompt() {
    if (!selectedId) {
      setStatus("Select a node first, then press Shift+P.");
      return;
    }
    const target = document.querySelector(`[data-node-id="${selectedId}"]`) as HTMLElement | null;
    if (target) {
      const rect = target.getBoundingClientRect();
      setContextPrompt((current) => ({
        ...current,
        open: true,
        x: Math.min(window.innerWidth - 360, Math.max(12, rect.right + 10)),
        y: Math.min(window.innerHeight - 180, Math.max(12, rect.top)),
        text: "",
        scope: "node"
      }));
      return;
    }

    setContextPrompt((current) => ({
      ...current,
      open: true,
      x: Math.max(16, window.innerWidth / 2 - 150),
      y: Math.max(16, window.innerHeight / 2 - 60),
      text: "",
      scope: "node"
    }));
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

      if (!isTypingField && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        openContextPrompt();
        return;
      }

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
    <div className={`app-shell ${uiVisualMode === "glass" ? "theme-glass" : ""}`}>
      <header className="topbar-app">
        <h1>Prynt Prompt-Native UX Editor</h1>
        <p>{status}</p>
      </header>
      <section className="workspace-tools">
        <div className="workspace-tools-left">
          <button type="button" onClick={() => void handleUndo()}>Undo</button>
          <button type="button" onClick={() => void handleRedo()}>Redo</button>
          <button type="button" onClick={() => void handleRepair()}>Repair</button>
          <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void applySelectedTemplate()}>Apply Template</button>
        </div>
        <div className="workspace-tools-right">
          <button type="button" onClick={() => setUiVisualMode((mode) => (mode === "glass" ? "pro" : "glass"))}>
            {uiVisualMode === "glass" ? "Pro Mode" : "Glass Mode"}
          </button>
          <button type="button" onClick={() => setIsCommandOpen(true)}>Command</button>
          <select value={projectSwitcherId} onChange={(event) => setProjectSwitcherId(event.target.value)}>
            <option value="">Select Project</option>
            {availableProjects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.projectId} ({project.fileCount})
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void openProject(projectSwitcherId || undefined)}>Open</button>
          <button type="button" onClick={() => void openProject()}>New Project</button>
          <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportResult["format"])}>
            <option value="json">Export JSON</option>
            <option value="dsl">Export DSL</option>
            <option value="react">Export React</option>
            <option value="schema">Export Schema</option>
          </select>
          <button type="button" onClick={() => void exportActiveFile()} disabled={isExporting}>
            {isExporting ? "Exporting..." : "Export"}
          </button>
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
          <div className="artboard-actions-row">
            <button type="button" className="mini-action" onClick={() => void duplicateActiveArtboard()}>Duplicate</button>
            <button type="button" className="mini-action danger-outline" onClick={() => void deleteActiveArtboard()}>Delete</button>
          </div>

          <div className="panel-head">
            <h2>Layers</h2>
          </div>
          <input className="artboard-search" value={layerSearch} onChange={(event) => setLayerSearch(event.target.value)} placeholder="Search layers..." />
          <LayerTree node={activeDocument.root} selectedIds={selectedIdsSet} onSelect={handleNodeSelect} visibleIds={visibleLayerIds} />
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
                  const isActivePhone = item.type === "phone" && item.id === selectedCanvasItemId;
                  const itemDocument = isActivePhone && previewDocument ? previewDocument : fileForItem?.document;
                  return (
                    <div
                      key={item.id}
                      className={`canvas-item ${item.type} ${selectedCanvasItemId === item.id ? "active" : ""}`}
                      style={{ left: item.x, top: item.y, width: item.width, minHeight: item.height }}
                      onMouseDown={(event) => handleItemMouseDown(event, item)}
                    >
                      <div className="canvas-item-handle">{item.type.toUpperCase()} {fileForItem ? `- ${fileForItem.name}` : ""}</div>
                      {item.type === "phone" ? (
                        <div className="device-frame">
                          {itemDocument && isActivePhone ? (
                            renderNode(itemDocument.root, selectedIdsSet, handleNodeSelect)
                          ) : (
                            <div className="artboard-lite-preview">
                              <strong>{fileForItem?.name ?? "Artboard"}</strong>
                              <span>{fileForItem ? `${flatten(fileForItem.document.root).length} nodes` : ""}</span>
                              <small>Select artboard to fully render</small>
                            </div>
                          )}
                        </div>
                      ) : null}
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
                  <button type="button" className="btn-soft" onClick={() => void applyComponentVariant("default")}>Variant Default</button>
                  <button type="button" className="btn-soft" onClick={() => void applyComponentVariant("soft")}>Variant Soft</button>
                  <button type="button" className="btn-soft" onClick={() => void applyComponentVariant("bold")}>Variant Bold</button>
                  <button type="button" className="btn-soft" onClick={() => void applyComponentVariant("ghost")}>Variant Ghost</button>
                </div>
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
                  <button type="button" className="btn-soft" onClick={() => void duplicateSelected()}>Duplicate</button>
                  <button type="button" className="btn-danger" onClick={() => void removeSelected()}>Remove</button>
                </div>
                <div className="inspector-actions">
                  <button type="button" className="btn-soft" onClick={() => selectSimilarNodes()}>Select Similar</button>
                  <button type="button" className="btn-primary" onClick={() => void applyPromptToSelectedNodes()} disabled={isApplyingPrompt || selectedIds.length === 0}>
                    Prompt Selected ({selectedIds.length})
                  </button>
                </div>
                <div className="section-library">
                  <button type="button" className="btn-soft" onClick={() => saveCurrentStylePreset()}>Save Style Preset</button>
                  <select value={selectedStylePresetId} onChange={(event) => setSelectedStylePresetId(event.target.value)}>
                    <option value="">Select style preset</option>
                    {stylePresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn-primary" onClick={() => void applySelectedStylePreset()}>Apply Style Preset</button>
                </div>
                <div className="blueprint-library">
                  <div className="blueprint-library-head">
                    <span>Blueprint Library</span>
                    <span>{isLoadingBlueprints ? "Loading..." : `${blueprints.length} items`}</span>
                  </div>
                  <input
                    value={blueprintQuery}
                    onChange={(event) => setBlueprintQuery(event.target.value)}
                    placeholder="Search blueprint types..."
                  />
                  <select value={selectedBlueprintId} onChange={(event) => setSelectedBlueprintId(event.target.value)}>
                    {blueprints.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} - {item.family} ({item.style})
                      </option>
                    ))}
                  </select>
                  {selectedBlueprint ? (
                    <div className="blueprint-meta">
                      <div>{selectedBlueprint.description}</div>
                      <div className="blueprint-hint">{selectedBlueprint.promptHint}</div>
                    </div>
                  ) : null}
                  <button type="button" className="btn-primary" onClick={() => void instantiateSelectedBlueprint()} disabled={!selectedBlueprintId}>
                    Insert Blueprint
                  </button>
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
          <h3>Reusable Sections</h3>
          <div className="section-library">
            <button type="button" className="btn-soft" onClick={() => saveSelectedAsSection()}>Save Selected Section</button>
            <select value={selectedSectionId} onChange={(event) => setSelectedSectionId(event.target.value)}>
              <option value="">Select saved section</option>
              {sectionsLibrary.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
            <div className="section-library-actions">
              <button type="button" className="btn-soft" onClick={() => void insertSelectedSection()}>Insert Section</button>
              <button type="button" className="btn-danger" onClick={() => removeSavedSection()}>Delete Saved</button>
            </div>
          </div>
          <h3>Export Output</h3>
          <textarea className="source-box" readOnly value={exportText || "Use Export from the top toolbar."} />
          <h3>Design Lint</h3>
          <div className="section-library">
            <button type="button" className="btn-soft" onClick={() => void runDesignLint()} disabled={isLinting}>
              {isLinting ? "Running..." : "Run Lint"}
            </button>
            <button type="button" className="btn-primary" onClick={() => void handleRepair()}>
              Auto Fix
            </button>
            <div className="lint-list">
              {lintIssues.slice(0, 8).map((issue) => (
                <div key={`${issue.code}-${issue.path}`} className={`lint-item lint-${issue.severity}`}>
                  <strong>{issue.severity.toUpperCase()}</strong> {issue.message}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>

      <section className="prompt-dock">
        <div className="prompt-dock-head">
          <span>Prompt Assistant</span>
          <div className="prompt-head-actions">
            <span>Confidence: {promptConfidence !== null ? `${Math.round(promptConfidence * 100)}%` : "n/a"}</span>
            <button type="button" onClick={() => toggleVoicePrompt()}>{isListening ? "Stop Voice" : "Voice"}</button>
            <button type="button" onClick={() => void generatePromptVariants()} disabled={isGeneratingVariants}>
              {isGeneratingVariants ? "Variants..." : "Variants"}
            </button>
            <button type="button" onClick={() => void generateNextScreenFlow()}>Next Screen</button>
            <button type="button" onClick={() => runCritiqueCoach()}>Critique</button>
          </div>
        </div>
        <textarea
          className="brief-box"
          value={designBrief}
          onChange={(event) => setDesignBrief(event.target.value)}
          placeholder="Design brief context (product goals, audience, style, constraints)..."
        />
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
            {isSimulatingPrompt ? "Simulating..." : "Preview"}
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
          {promptWarnings.length > 0
            ? promptWarnings.join(" | ")
            : lastPromptSummary || "Tip: reference screens by name, screen number, or 'all screens'."}
        </div>
        {critiqueSuggestions.length > 0 ? (
          <div className="critique-list">
            {critiqueSuggestions.slice(0, 4).map((item) => <div key={item}>{item}</div>)}
          </div>
        ) : null}
        {pendingPromptPreview ? (
          <div className="preview-block">
            <div className="preview-actions">
              <span>Preview ready: {pendingPromptPreview.summary}</span>
              <button
                type="button"
                onClick={() => {
                  const filtered = previewOps.filter((op) => enabledPreviewOpIds.includes(op.opId));
                  if (filtered.length === 0) {
                    setStatus("No preview operations selected.");
                    return;
                  }
                  void applyPatch(filtered, "Prompt preview apply");
                  setPendingPromptPreview(null);
                  setPreviewOps([]);
                  setEnabledPreviewOpIds([]);
                }}
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingPromptPreview(null);
                  setPreviewDocument(null);
                  setPreviewOps([]);
                  setEnabledPreviewOpIds([]);
                  setStatus("Prompt preview discarded.");
                }}
              >
                Reject
              </button>
            </div>
            <div className="preview-ops-list">
              {previewOps.slice(0, 12).map((op) => (
                <label key={op.opId} className="preview-op-item">
                  <input
                    type="checkbox"
                    checked={enabledPreviewOpIds.includes(op.opId)}
                    onChange={(event) => {
                      setEnabledPreviewOpIds((current) =>
                        event.target.checked ? [...current, op.opId] : current.filter((id) => id !== op.opId)
                      );
                    }}
                  />
                  <span>{op.type}</span>
                  {"targetId" in op ? <small>{String(op.targetId)}</small> : null}
                </label>
              ))}
            </div>
            <div className="preview-diff-list">
              {previewDiffSummary.length > 0 ? previewDiffSummary.map((line) => <div key={line}>{line}</div>) : <div>No structural changes detected.</div>}
            </div>
          </div>
        ) : null}
      </section>

      {contextPrompt.open ? (
        <div className="context-prompt-popover" style={{ left: contextPrompt.x, top: contextPrompt.y }}>
          <div className="context-prompt-head">
            <span>Prompt Selected Node</span>
            <button type="button" onClick={() => setContextPrompt((current) => ({ ...current, open: false }))}>Close</button>
          </div>
          <div className="context-scope-row">
            {(["node", "section", "similar", "screen", "project"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                className={contextPrompt.scope === scope ? "context-scope-active" : ""}
                onClick={() => setContextPrompt((current) => ({ ...current, scope }))}
              >
                {scope}
              </button>
            ))}
          </div>
          <textarea
            value={contextPrompt.text}
            onChange={(event) => setContextPrompt((current) => ({ ...current, text: event.target.value }))}
            placeholder="e.g. Make this card premium and add a primary CTA"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                setPrompt(contextPrompt.text);
                void handlePrompt(contextPrompt.text, {
                  ...(selectedId ? { selectedNodeId: selectedId } : {}),
                  selectedScope: contextPrompt.scope
                });
                setContextPrompt((current) => ({ ...current, open: false }));
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setContextPrompt((current) => ({ ...current, open: false }));
              }
            }}
          />
          <div className="context-prompt-actions">
            <button
              type="button"
              className="context-preview-btn"
              onClick={() => {
                setPrompt(contextPrompt.text);
                void handleSimulatePrompt(contextPrompt.text, {
                  ...(selectedId ? { selectedNodeId: selectedId } : {}),
                  selectedScope: contextPrompt.scope
                });
              }}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => {
                setPrompt(contextPrompt.text);
                void handlePrompt(contextPrompt.text, {
                  ...(selectedId ? { selectedNodeId: selectedId } : {}),
                  selectedScope: contextPrompt.scope
                });
                setContextPrompt((current) => ({ ...current, open: false }));
              }}
            >
              Apply To Selection
            </button>
          </div>
        </div>
      ) : null}

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
