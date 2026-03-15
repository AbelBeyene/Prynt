import { cloneDocument, cloneNode, findNodePath, type AstNode, type DocumentAst } from "@prynt/ast";

export type PatchType = "addNode" | "removeNode" | "moveNode" | "updateProps" | "replaceNode" | "wrapNode";

interface BasePatchOp {
  opId: string;
  type: PatchType;
}

export interface AddNodePatch extends BasePatchOp {
  type: "addNode";
  parentId: string;
  index?: number;
  node: AstNode;
}

export interface RemoveNodePatch extends BasePatchOp {
  type: "removeNode";
  targetId: string;
}

export interface MoveNodePatch extends BasePatchOp {
  type: "moveNode";
  targetId: string;
  toParentId: string;
  index?: number;
}

export interface UpdatePropsPatch extends BasePatchOp {
  type: "updateProps";
  targetId: string;
  props: Record<string, unknown>;
}

export interface ReplaceNodePatch extends BasePatchOp {
  type: "replaceNode";
  targetId: string;
  node: AstNode;
}

export interface WrapNodePatch extends BasePatchOp {
  type: "wrapNode";
  targetId: string;
  wrapper: AstNode;
}

export type PatchOp = AddNodePatch | RemoveNodePatch | MoveNodePatch | UpdatePropsPatch | ReplaceNodePatch | WrapNodePatch;

export interface AppliedPatchResult {
  document: DocumentAst;
  inversePatches: PatchOp[];
}

export class PatchApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchApplyError";
  }
}

function insertAt(children: AstNode[], node: AstNode, index?: number): number {
  if (index === undefined || index < 0 || index > children.length) {
    children.push(node);
    return children.length - 1;
  }
  children.splice(index, 0, node);
  return index;
}

export function applyPatch(document: DocumentAst, patch: PatchOp): AppliedPatchResult {
  const next = cloneDocument(document);

  switch (patch.type) {
    case "addNode": {
      const parentPath = findNodePath(next.root, patch.parentId);
      if (!parentPath) {
        throw new PatchApplyError(`Parent node not found: ${patch.parentId}`);
      }

      const addedNode = cloneNode(patch.node);
      insertAt(parentPath.node.children, addedNode, patch.index);
      const inverse: RemoveNodePatch = { opId: `${patch.opId}:inverse`, type: "removeNode", targetId: addedNode.id };
      return { document: next, inversePatches: [inverse] };
    }

    case "removeNode": {
      if (patch.targetId === next.root.id) {
        throw new PatchApplyError("Cannot remove document root node.");
      }
      const targetPath = findNodePath(next.root, patch.targetId);
      if (!targetPath || !targetPath.parent) {
        throw new PatchApplyError(`Node not found: ${patch.targetId}`);
      }

      const removed = targetPath.parent.children.splice(targetPath.index, 1)[0];
      if (!removed) {
        throw new PatchApplyError(`Failed to remove node: ${patch.targetId}`);
      }

      const inverse: AddNodePatch = {
        opId: `${patch.opId}:inverse`,
        type: "addNode",
        parentId: targetPath.parent.id,
        index: targetPath.index,
        node: removed
      };
      return { document: next, inversePatches: [inverse] };
    }

    case "moveNode": {
      if (patch.targetId === next.root.id) {
        throw new PatchApplyError("Cannot move document root node.");
      }

      const sourcePath = findNodePath(next.root, patch.targetId);
      const destinationPath = findNodePath(next.root, patch.toParentId);
      if (!sourcePath || !sourcePath.parent) {
        throw new PatchApplyError(`Source node not found: ${patch.targetId}`);
      }
      if (!destinationPath) {
        throw new PatchApplyError(`Destination parent not found: ${patch.toParentId}`);
      }

      const [movingNode] = sourcePath.parent.children.splice(sourcePath.index, 1);
      if (!movingNode) {
        throw new PatchApplyError(`Could not move node: ${patch.targetId}`);
      }

      const insertedIndex = insertAt(destinationPath.node.children, movingNode, patch.index);
      const inverse: MoveNodePatch = {
        opId: `${patch.opId}:inverse`,
        type: "moveNode",
        targetId: patch.targetId,
        toParentId: sourcePath.parent.id,
        index: sourcePath.index
      };
      if (insertedIndex < 0) {
        throw new PatchApplyError(`Could not insert moved node: ${patch.targetId}`);
      }
      return { document: next, inversePatches: [inverse] };
    }

    case "updateProps": {
      const targetPath = findNodePath(next.root, patch.targetId);
      if (!targetPath) {
        throw new PatchApplyError(`Node not found: ${patch.targetId}`);
      }
      const previousProps: Record<string, unknown> = {};
      for (const key of Object.keys(patch.props)) {
        previousProps[key] = targetPath.node.props[key];
      }
      targetPath.node.props = { ...targetPath.node.props, ...patch.props };

      const inverse: UpdatePropsPatch = {
        opId: `${patch.opId}:inverse`,
        type: "updateProps",
        targetId: patch.targetId,
        props: previousProps
      };
      return { document: next, inversePatches: [inverse] };
    }

    case "replaceNode": {
      if (patch.targetId === next.root.id) {
        next.root = cloneNode(patch.node);
        const inverse: ReplaceNodePatch = {
          opId: `${patch.opId}:inverse`,
          type: "replaceNode",
          targetId: patch.node.id,
          node: cloneNode(document.root)
        };
        return { document: next, inversePatches: [inverse] };
      }

      const targetPath = findNodePath(next.root, patch.targetId);
      if (!targetPath || !targetPath.parent) {
        throw new PatchApplyError(`Node not found: ${patch.targetId}`);
      }

      const previous = targetPath.parent.children[targetPath.index];
      if (!previous) {
        throw new PatchApplyError(`Node not found at index for replace: ${patch.targetId}`);
      }
      targetPath.parent.children[targetPath.index] = cloneNode(patch.node);

      const inverse: ReplaceNodePatch = {
        opId: `${patch.opId}:inverse`,
        type: "replaceNode",
        targetId: patch.node.id,
        node: cloneNode(previous)
      };
      return { document: next, inversePatches: [inverse] };
    }

    case "wrapNode": {
      if (patch.targetId === next.root.id) {
        throw new PatchApplyError("Cannot wrap root node.");
      }
      const targetPath = findNodePath(next.root, patch.targetId);
      if (!targetPath || !targetPath.parent) {
        throw new PatchApplyError(`Node not found: ${patch.targetId}`);
      }

      const wrapper = cloneNode(patch.wrapper);
      const target = targetPath.parent.children[targetPath.index];
      if (!target) {
        throw new PatchApplyError(`Node not found at index for wrap: ${patch.targetId}`);
      }
      wrapper.children = [target];
      targetPath.parent.children[targetPath.index] = wrapper;

      const inverse: ReplaceNodePatch = {
        opId: `${patch.opId}:inverse`,
        type: "replaceNode",
        targetId: wrapper.id,
        node: cloneNode(target)
      };
      return { document: next, inversePatches: [inverse] };
    }
  }
}

export function applyPatches(document: DocumentAst, patches: PatchOp[]): AppliedPatchResult {
  let working = cloneDocument(document);
  const inverse: PatchOp[] = [];

  for (const patch of patches) {
    const result = applyPatch(working, patch);
    working = result.document;
    inverse.unshift(...result.inversePatches);
  }

  return { document: working, inversePatches: inverse };
}
