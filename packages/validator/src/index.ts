import { collectNodeIds, type AstNode, type DocumentAst } from "@prynt/ast";
import { getComponentDefinition, isAllowedChild } from "@prynt/component-registry";
import { isValidToken } from "@prynt/tokens";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: ValidationSeverity;
  repairHint?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const primitiveTypeMap: Record<string, string> = {
  string: "string",
  number: "number",
  boolean: "boolean"
};

function validateNode(node: AstNode, path: string, issues: ValidationIssue[]): void {
  const definition = getComponentDefinition(node.type);
  if (!definition) {
    issues.push({
      code: "unknown_component",
      path,
      message: `Unknown component type '${node.type}'.`,
      severity: "error",
      repairHint: "Replace with a supported component from the registry."
    });
    return;
  }

  for (const [propName, propDef] of Object.entries(definition.props)) {
    const value = node.props[propName];

    if (propDef.required && value === undefined) {
      issues.push({
        code: "missing_required_prop",
        path,
        message: `Missing required prop '${propName}' on '${node.type}'.`,
        severity: "error",
        repairHint: "Provide this prop in inspector or apply default values."
      });
      continue;
    }

    if (value === undefined) {
      continue;
    }

    if (typeof value !== primitiveTypeMap[propDef.type]) {
      issues.push({
        code: "invalid_prop_type",
        path,
        message: `Prop '${propName}' on '${node.type}' must be ${propDef.type}.`,
        severity: "error",
        repairHint: "Fix the value type in source or inspector mode."
      });
      continue;
    }

    if (propDef.enum && typeof value === "string" && !propDef.enum.includes(value)) {
      issues.push({
        code: "invalid_prop_enum",
        path,
        message: `Prop '${propName}' on '${node.type}' must be one of: ${propDef.enum.join(", ")}.`,
        severity: "error",
        repairHint: "Pick an allowed value from the enum list."
      });
    }

    if (propDef.tokenType && typeof value === "string" && !isValidToken(propDef.tokenType, value)) {
      issues.push({
        code: "invalid_token",
        path,
        message: `Prop '${propName}' on '${node.type}' has invalid token '${value}'.`,
        severity: "error",
        repairHint: `Use a valid ${propDef.tokenType} token.`
      });
    }
  }

  for (const child of node.children) {
    if (!isAllowedChild(node.type, child.type)) {
      issues.push({
        code: "invalid_child",
        path,
        message: `Child '${child.type}' is not allowed under '${node.type}'.`,
        severity: "error",
        repairHint: "Move the child to a valid parent or convert node type."
      });
    }
  }

  for (const propName of Object.keys(node.props)) {
    if (!Object.prototype.hasOwnProperty.call(definition.props, propName)) {
      issues.push({
        code: "unknown_prop",
        path,
        message: `Unknown prop '${propName}' on '${node.type}'.`,
        severity: "error",
        repairHint: "Remove unsupported props or add them to the component schema."
      });
    }
  }
}

function validateMobileRules(document: DocumentAst, issues: ValidationIssue[]): void {
  if (document.root.type !== "Screen") {
    issues.push({
      code: "root_not_screen",
      path: "root",
      message: "Document root should be 'Screen' for mobile-first generation.",
      severity: "warning",
      repairHint: "Convert root component to Screen."
    });
  }

  const stack: AstNode[] = [document.root];
  let interactiveCount = 0;
  let mutedActionCount = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

    const touchCritical = new Set(["Button", "TextField", "SearchBar", "Input", "Select", "Picker"]);
    if (touchCritical.has(node.type) && typeof node.props.minHeight === "number" && node.props.minHeight < 44) {
      issues.push({
        code: "touch_target_small",
        path: `node:${node.id}`,
        message: `${node.type} minHeight should be at least 44 for touch targets.`,
        severity: "warning",
        repairHint: "Set minHeight to 44 or higher."
      });
    }
    if (touchCritical.has(node.type)) {
      interactiveCount += 1;
    }
    if (node.type === "Button" && node.props.tone === "muted") {
      mutedActionCount += 1;
    }
    if (node.type === "BottomTabBar" && typeof node.props.tabs === "number" && node.props.tabs > 5) {
      issues.push({
        code: "mobile_tabs_exceeded",
        path: `node:${node.id}`,
        message: "BottomTabBar should not have more than 5 tabs.",
        severity: "warning",
        repairHint: "Reduce tab count to 5 or fewer."
      });
    }
    if (node.type === "Grid" && typeof node.props.columns === "number" && node.props.columns > 2) {
      issues.push({
        code: "mobile_grid_dense",
        path: `node:${node.id}`,
        message: "Grid columns above 2 can reduce readability on mobile.",
        severity: "warning",
        repairHint: "Use at most 2 columns for mobile screens."
      });
    }
    if ((node.type === "Heading" || node.type === "Text") && typeof node.props.text === "string" && node.props.text.length > 160) {
      issues.push({
        code: "text_density_risk",
        path: `node:${node.id}`,
        message: `${node.type} text is long and may truncate or overwhelm small screens.`,
        severity: "warning",
        repairHint: "Split text into shorter blocks or reduce content length."
      });
    }
    if ((node.type === "Card" || node.type === "Container" || node.type === "Stack") && node.props.padding === "xs") {
      issues.push({
        code: "spacing_rhythm_tight",
        path: `node:${node.id}`,
        message: `${node.type} uses very tight spacing token 'xs'.`,
        severity: "warning",
        repairHint: "Prefer sm/md padding for better visual rhythm."
      });
    }

    stack.push(...node.children);
  }

  if (interactiveCount > 16) {
    issues.push({
      code: "interaction_density_high",
      path: "root",
      message: "Screen has many interactive controls and may feel crowded.",
      severity: "warning",
      repairHint: "Group controls into sections or split flow across screens."
    });
  }
  if (mutedActionCount > 0) {
    issues.push({
      code: "contrast_risk_muted_action",
      path: "root",
      message: "Muted-tone action buttons may have weak visual contrast for primary actions.",
      severity: "warning",
      repairHint: "Use primary/secondary tone for critical action buttons."
    });
  }
}

export function validateDocument(document: DocumentAst): ValidationResult {
  const issues: ValidationIssue[] = [];
  const MAX_NODES = 1200;
  const MAX_DEPTH = 32;

  const ids = collectNodeIds(document.root);
  if (ids.size === 0) {
    issues.push({
      code: "empty_document",
      path: "root",
      message: "Document has no nodes.",
      severity: "error"
    });
  }

  const duplicateIdCheck = new Set<string>();
  const stack: Array<{ node: AstNode; path: string; depth: number }> = [{ node: document.root, path: "root", depth: 1 }];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    visited += 1;
    if (visited > MAX_NODES) {
      issues.push({
        code: "document_too_large",
        path: current.path,
        message: `Document exceeds ${MAX_NODES} nodes.`,
        severity: "error",
        repairHint: "Split this design into multiple files or reduce repeated sections."
      });
      break;
    }
    if (current.depth > MAX_DEPTH) {
      issues.push({
        code: "document_too_deep",
        path: current.path,
        message: `Document nesting exceeds max depth of ${MAX_DEPTH}.`,
        severity: "error",
        repairHint: "Flatten deep container nesting."
      });
    }

    if (duplicateIdCheck.has(current.node.id)) {
      issues.push({
        code: "duplicate_id",
        path: current.path,
        message: `Duplicate node id '${current.node.id}'.`,
        severity: "error",
        repairHint: "Regenerate stable ids for duplicates."
      });
    }
    duplicateIdCheck.add(current.node.id);

    validateNode(current.node, current.path, issues);

    for (const [index, child] of current.node.children.entries()) {
      stack.push({
        node: child,
        path: `${current.path}.children[${index}]`,
        depth: current.depth + 1
      });
    }
  }

  validateMobileRules(document, issues);

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    issues
  };
}

export function suggestRepairs(issues: ValidationIssue[]): string[] {
  const suggestions = new Set<string>();
  for (const issue of issues) {
    if (issue.repairHint) {
      suggestions.add(issue.repairHint);
    }
  }
  return [...suggestions];
}
