import type { AstNode } from "@prynt/ast";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";

export function LayerTree({
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

export function SortableArtboardItem({
  fileId,
  name,
  nodeCount,
  version,
  active,
  onSelect
}: {
  fileId: string;
  name: string;
  nodeCount: number;
  version: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: fileId });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      className={`artboard-item ${active ? "is-active" : ""}`}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      <span className="artboard-title">{name}</span>
      <span className="artboard-meta">Nodes {nodeCount} | V{version}</span>
    </button>
  );
}
