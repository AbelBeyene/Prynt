import type { AstNode, DocumentAst } from "@prynt/ast";
import { getComponentDefinition } from "@prynt/component-registry";
import type { PatchOp } from "@prynt/patches";
import { isValidToken } from "@prynt/tokens";

export interface RepairPlan {
  summary: string;
  patches: PatchOp[];
}

function nextOpId(prefix: string, counter: number): string {
  return `${prefix}-${counter}`;
}

function collectAutoFixes(node: AstNode, patches: PatchOp[], counterRef: { value: number }): void {
  const definition = getComponentDefinition(node.type);
  if (definition) {
    const propUpdates: Record<string, unknown> = {};

    for (const [propName, propDef] of Object.entries(definition.props)) {
      const current = node.props[propName];

      if (propDef.required && current === undefined) {
        propUpdates[propName] = definition.defaults[propName] ?? (propDef.type === "string" ? "" : propDef.type === "number" ? 0 : false);
      }

      if (propDef.tokenType && typeof current === "string" && !isValidToken(propDef.tokenType, current)) {
        propUpdates[propName] = definition.defaults[propName];
      }

      if (propDef.enum && typeof current === "string" && !propDef.enum.includes(current)) {
        propUpdates[propName] = definition.defaults[propName] ?? propDef.enum[0];
      }
    }

    if ((node.type === "Button" || node.type === "TextField") && typeof node.props.minHeight === "number" && node.props.minHeight < 44) {
      propUpdates.minHeight = 44;
    }

    if (Object.keys(propUpdates).length > 0) {
      counterRef.value += 1;
      patches.push({
        opId: nextOpId("repair-update-props", counterRef.value),
        type: "updateProps",
        targetId: node.id,
        props: propUpdates
      });
    }
  }

  for (const child of node.children) {
    collectAutoFixes(child, patches, counterRef);
  }
}

export function buildRepairPlan(document: DocumentAst): RepairPlan {
  const patches: PatchOp[] = [];
  const counterRef = { value: 0 };

  collectAutoFixes(document.root, patches, counterRef);

  return {
    summary: patches.length > 0 ? `Prepared ${patches.length} automatic repair patch(es).` : "No automatic repairs required.",
    patches
  };
}
