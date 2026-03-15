export interface AstNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: AstNode[];
  meta?: {
    locked?: boolean;
    name?: string;
  };
}

export interface DocumentAst {
  schemaVersion: string;
  docId: string;
  version: number;
  root: AstNode;
}

export interface NodePath {
  node: AstNode;
  parent: AstNode | null;
  index: number;
}

export function walk(node: AstNode, visit: (node: AstNode, parent: AstNode | null, index: number) => void, parent: AstNode | null = null): void {
  for (const child of node.children) {
    walk(child, visit, node);
  }
  const index = parent ? parent.children.findIndex((child) => child.id === node.id) : 0;
  visit(node, parent, index);
}

export function findNodePath(root: AstNode, id: string): NodePath | null {
  if (root.id === id) {
    return { node: root, parent: null, index: 0 };
  }

  const stack: Array<{ node: AstNode; parent: AstNode | null }> = [{ node: root, parent: null }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const [index, child] of current.node.children.entries()) {
      if (child.id === id) {
        return { node: child, parent: current.node, index };
      }
      stack.push({ node: child, parent: current.node });
    }
  }
  return null;
}

export function cloneNode<T extends AstNode>(node: T): T {
  return {
    ...node,
    props: { ...node.props },
    children: node.children.map((child) => cloneNode(child))
  } as T;
}

export function cloneDocument(doc: DocumentAst): DocumentAst {
  return {
    ...doc,
    root: cloneNode(doc.root)
  };
}

export function collectNodeIds(root: AstNode): Set<string> {
  const ids = new Set<string>();
  const stack: AstNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    ids.add(node.id);
    stack.push(...node.children);
  }
  return ids;
}
