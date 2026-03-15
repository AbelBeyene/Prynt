import type { AstNode, DocumentAst } from "@prynt/ast";

function serializeNode(node: AstNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const props = Object.entries(node.props)
    .map(([key, value]) => `${key}="${String(value)}"`)
    .join(" ");

  if (node.children.length === 0) {
    return `${indent}<${node.type}${props ? ` ${props}` : ""} />`;
  }

  const children = node.children.map((child) => serializeNode(child, depth + 1)).join("\n");
  return `${indent}<${node.type}${props ? ` ${props}` : ""}>\n${children}\n${indent}</${node.type}>`;
}

export function serializeDocumentToDsl(document: DocumentAst): string {
  return serializeNode(document.root, 0);
}

export function parseDslToDocument(dsl: string, documentId = "draft", version = 1): DocumentAst {
  if (!dsl.includes("<Screen")) {
    throw new Error("Only basic Screen-root DSL is supported in this bootstrap parser.");
  }

  return {
    schemaVersion: "1.0.0",
    docId: documentId,
    version,
    root: {
      id: "screen-root",
      type: "Screen",
      props: { title: "Imported" },
      children: []
    }
  };
}
