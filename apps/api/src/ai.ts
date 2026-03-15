import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import type { AstNode, DocumentAst } from "@prynt/ast";
import type { PatchOp } from "@prynt/patches";

const allowedOps = new Set(["addNode", "removeNode", "moveNode", "updateProps", "replaceNode", "wrapNode"]);
const opAliases: Record<string, PatchOp["type"]> = {
  add: "addNode",
  addnode: "addNode",
  insert: "addNode",
  remove: "removeNode",
  removenode: "removeNode",
  delete: "removeNode",
  movenode: "moveNode",
  move: "moveNode",
  update: "updateProps",
  updateprops: "updateProps",
  setprops: "updateProps",
  setvariant: "updateProps",
  replace: "replaceNode",
  replacenode: "replaceNode",
  wrap: "wrapNode",
  wrapnode: "wrapNode"
};

const patchTypeSchema = z.enum(["addNode", "removeNode", "moveNode", "updateProps", "replaceNode", "wrapNode"]);

const astNodeSchema: z.ZodType<AstNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.string(),
    props: z.record(z.unknown()),
    children: z.array(astNodeSchema)
  })
);

const addPatchSchema = z.object({
  opId: z.string(),
  type: z.literal("addNode"),
  parentId: z.string(),
  node: astNodeSchema,
  index: z.number().optional()
});

const removePatchSchema = z.object({
  opId: z.string(),
  type: z.literal("removeNode"),
  targetId: z.string()
});

const movePatchSchema = z.object({
  opId: z.string(),
  type: z.literal("moveNode"),
  targetId: z.string(),
  toParentId: z.string(),
  index: z.number().optional()
});

const updatePatchSchema = z.object({
  opId: z.string(),
  type: z.literal("updateProps"),
  targetId: z.string(),
  props: z.record(z.unknown())
});

const replacePatchSchema = z.object({
  opId: z.string(),
  type: z.literal("replaceNode"),
  targetId: z.string(),
  node: astNodeSchema
});

const wrapPatchSchema = z.object({
  opId: z.string(),
  type: z.literal("wrapNode"),
  targetId: z.string(),
  wrapper: astNodeSchema
});

const patchSchema = z.union([addPatchSchema, removePatchSchema, movePatchSchema, updatePatchSchema, replacePatchSchema, wrapPatchSchema]);

function extractJsonPayload(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return text.trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function coerceNode(input: unknown): AstNode | null {
  if (!isObject(input)) {
    return null;
  }

  const type = typeof input.type === "string" ? input.type : null;
  if (!type) {
    return null;
  }

  const id = typeof input.id === "string" && input.id.length > 0 ? input.id : uid(type.toLowerCase());
  const props = isObject(input.props) ? input.props : {};
  const rawChildren = Array.isArray(input.children) ? input.children : [];
  const children: AstNode[] = rawChildren.map((child) => coerceNode(child)).filter((child): child is AstNode => child !== null);

  return { id, type, props, children };
}

function parsePath(path: string): { targetId?: string; propKey?: string } {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) {
    return {};
  }

  const propsIndex = parts.lastIndexOf("props");
  if (propsIndex >= 0 && parts[propsIndex + 1]) {
    const targetId = propsIndex > 0 ? parts[propsIndex - 1] : undefined;
    const propKey = parts[propsIndex + 1];
    const out: { targetId?: string; propKey?: string } = {};
    if (propKey) {
      out.propKey = propKey;
    }
    if (targetId) {
      out.targetId = targetId;
    }
    return out;
  }

  const last = parts[parts.length - 1];
  return last ? { targetId: last } : {};
}

function resolveOpType(raw: Record<string, unknown>): PatchOp["type"] | null {
  const direct = typeof raw.type === "string" ? raw.type : typeof raw.op === "string" ? raw.op : null;
  if (!direct) {
    return null;
  }

  const normalized = direct.toLowerCase();
  const mapped = opAliases[normalized] ?? (allowedOps.has(direct as PatchOp["type"]) ? (direct as PatchOp["type"]) : null);
  if (!mapped || !allowedOps.has(mapped)) {
    return null;
  }
  return patchTypeSchema.safeParse(mapped).success ? mapped : null;
}

function normalizePatch(raw: Record<string, unknown>, selectedNodeId: string | undefined, rootId: string): PatchOp | null {
  const type = resolveOpType(raw);
  if (!type) {
    return null;
  }

  const pathInfo = typeof raw.path === "string" ? parsePath(raw.path) : {};
  const opId = typeof raw.opId === "string" && raw.opId.length > 0 ? raw.opId : uid(type.toLowerCase());

  if (type === "addNode") {
    const node = coerceNode(raw.node ?? raw.value);
    if (!node) {
      return null;
    }
    const parentId =
      (typeof raw.parentId === "string" && raw.parentId) ||
      (typeof raw.parent === "string" && raw.parent) ||
      (typeof raw.targetId === "string" && raw.targetId) ||
      selectedNodeId ||
      rootId;

    const candidate: unknown = {
      opId,
      type,
      parentId,
      node,
      ...(typeof raw.index === "number" ? { index: raw.index } : {})
    };
    const parsed = addPatchSchema.safeParse(candidate);
    return parsed.success ? (parsed.data as PatchOp) : null;
  }

  if (type === "removeNode") {
    const targetId = (typeof raw.targetId === "string" && raw.targetId) || (typeof raw.target === "string" && raw.target) || pathInfo.targetId;
    if (!targetId) {
      return null;
    }
    const parsed = removePatchSchema.safeParse({ opId, type, targetId });
    return parsed.success ? (parsed.data as PatchOp) : null;
  }

  if (type === "moveNode") {
    const targetId =
      (typeof raw.targetId === "string" && raw.targetId) ||
      (typeof raw.target === "string" && raw.target) ||
      pathInfo.targetId;
    const toParentId =
      (typeof raw.toParentId === "string" && raw.toParentId) ||
      (typeof raw.parentId === "string" && raw.parentId) ||
      (typeof raw.to === "string" && raw.to) ||
      selectedNodeId ||
      rootId;

    if (!targetId) {
      return null;
    }

    const candidate: unknown = {
      opId,
      type,
      targetId,
      toParentId,
      ...(typeof raw.index === "number" ? { index: raw.index } : {})
    };
    const parsed = movePatchSchema.safeParse(candidate);
    return parsed.success ? (parsed.data as PatchOp) : null;
  }

  if (type === "updateProps") {
    const targetId =
      (typeof raw.targetId === "string" && raw.targetId) ||
      (typeof raw.target === "string" && raw.target) ||
      pathInfo.targetId ||
      selectedNodeId ||
      rootId;

    const props = isObject(raw.props)
      ? raw.props
      : isObject(raw.value) && !Array.isArray(raw.value)
        ? raw.value
        : pathInfo.propKey
          ? { [pathInfo.propKey]: raw.value }
          : null;

    if (!targetId || !props) {
      return null;
    }

    const parsed = updatePatchSchema.safeParse({ opId, type, targetId, props });
    return parsed.success ? (parsed.data as PatchOp) : null;
  }

  if (type === "replaceNode") {
    const targetId = (typeof raw.targetId === "string" && raw.targetId) || (typeof raw.target === "string" && raw.target) || pathInfo.targetId;
    const node = coerceNode(raw.node ?? raw.value);
    if (!targetId || !node) {
      return null;
    }
    const parsed = replacePatchSchema.safeParse({ opId, type, targetId, node });
    return parsed.success ? (parsed.data as PatchOp) : null;
  }

  if (type === "wrapNode") {
    const targetId = (typeof raw.targetId === "string" && raw.targetId) || (typeof raw.target === "string" && raw.target) || pathInfo.targetId;
    const wrapper = coerceNode(raw.wrapper ?? raw.node ?? raw.value);
    if (!targetId || !wrapper) {
      return null;
    }
    const parsed = wrapPatchSchema.safeParse({ opId, type, targetId, wrapper });
    return parsed.success ? (parsed.data as PatchOp) : null;
  }

  return null;
}

function toPatchList(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (isObject(value) && Array.isArray(value.patches)) {
    return value.patches;
  }
  if (isObject(value)) {
    return [value];
  }
  return [];
}

function sanitizePatches(value: unknown, selectedNodeId: string | undefined, rootId: string): PatchOp[] {
  const rawPatches = toPatchList(value);
  const valid: PatchOp[] = [];

  for (const raw of rawPatches) {
    if (!isObject(raw)) {
      continue;
    }
    const normalized = normalizePatch(raw, selectedNodeId, rootId);
    if (normalized) {
      const parsed = patchSchema.safeParse(normalized);
      if (parsed.success) {
        valid.push(parsed.data as PatchOp);
      }
    }
  }

  return valid;
}

function summarizeNodes(root: AstNode): Array<{ id: string; type: string; parentId: string | null }> {
  const out: Array<{ id: string; type: string; parentId: string | null }> = [];
  const stack: Array<{ node: AstNode; parentId: string | null }> = [{ node: root, parentId: null }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    out.push({ id: current.node.id, type: current.node.type, parentId: current.parentId });
    for (const child of current.node.children) {
      stack.push({ node: child, parentId: current.node.id });
    }
  }

  return out;
}

export function canUseLlm(): boolean {
  const key = process.env.OPENROUTER_API_KEY ?? process.env.VITE_OPENROUTER_API_KEY;
  return Boolean(key);
}

export async function generatePatchesFromLlm(prompt: string, document: DocumentAst, selectedNodeId?: string): Promise<PatchOp[]> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.VITE_OPENROUTER_API_KEY;
  const apiUrl = process.env.OPENROUTER_API_URL ?? process.env.VITE_OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
  const model = process.env.OPENROUTER_MODEL ?? process.env.VITE_OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

  if (!apiKey) {
    throw new Error("OpenRouter API key is not configured.");
  }

  const systemPrompt = [
    "You are an AI patch generator for a constrained mobile UI AST editor.",
    "Output ONLY valid JSON.",
    "Preferred output shape: {\"patches\":[PatchOp,...]}.",
    "PatchOp fields:",
    "- addNode: opId,type,parentId,node{id,type,props,children}",
    "- removeNode: opId,type,targetId",
    "- moveNode: opId,type,targetId,toParentId,index(optional)",
    "- updateProps: opId,type,targetId,props",
    "- replaceNode: opId,type,targetId,node",
    "- wrapNode: opId,type,targetId,wrapper",
    "Use existing ids from the provided node index.",
    "Prefer one to three minimal patches.",
    "Never return explanations, markdown, or code fences."
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: prompt,
      selectedNodeId: selectedNodeId ?? null,
      rootId: document.root.id,
      nodeIndex: summarizeNodes(document.root),
      document
    },
    null,
    2
  );

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Model returned empty content.");
  }

  const repaired = jsonrepair(extractJsonPayload(content));
  const parsed = JSON.parse(repaired) as unknown;
  const patches = sanitizePatches(parsed, selectedNodeId, document.root.id);

  if (patches.length === 0) {
    throw new Error("Model returned no valid patches.");
  }

  return patches;
}
