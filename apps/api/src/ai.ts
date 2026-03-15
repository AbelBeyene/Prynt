import type { DocumentAst } from "@prynt/ast";
import type { PatchOp } from "@prynt/patches";

const allowedOps = new Set(["addNode", "removeNode", "moveNode", "updateProps", "replaceNode", "wrapNode"]);

export interface PromptAiResult {
  patches: PatchOp[];
  source: "llm" | "rule";
}

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

function sanitizePatches(value: unknown): PatchOp[] {
  const candidate = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.patches)
      ? value.patches
      : [];

  const valid: PatchOp[] = [];
  for (const raw of candidate) {
    if (!isObject(raw)) {
      continue;
    }

    const type = raw.type;
    if (typeof type !== "string" || !allowedOps.has(type)) {
      continue;
    }

    if (typeof raw.opId !== "string" || raw.opId.length === 0) {
      continue;
    }

    if (type === "addNode" && (typeof raw.parentId !== "string" || !isObject(raw.node))) {
      continue;
    }
    if ((type === "removeNode" || type === "replaceNode" || type === "wrapNode" || type === "updateProps" || type === "moveNode") && typeof raw.targetId !== "string") {
      continue;
    }
    if (type === "moveNode" && typeof raw.toParentId !== "string") {
      continue;
    }
    if (type === "updateProps" && !isObject(raw.props)) {
      continue;
    }
    if ((type === "replaceNode" || type === "wrapNode") && !isObject(raw.node ?? raw.wrapper)) {
      continue;
    }

    valid.push(raw as unknown as PatchOp);
  }

  return valid;
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
    "You are an AI UI patch generator for a constrained AST editor.",
    "Return ONLY valid JSON. No markdown, no prose.",
    "Output MUST be either: [PatchOp] OR {\"patches\":[PatchOp]}",
    "PatchOp types allowed: addNode, removeNode, moveNode, updateProps, replaceNode, wrapNode.",
    "Never use op/path/value formats.",
    "For updateProps use: {\"opId\":\"id\",\"type\":\"updateProps\",\"targetId\":\"node-id\",\"props\":{...}}",
    "For addNode use: {\"opId\":\"id\",\"type\":\"addNode\",\"parentId\":\"node-id\",\"node\":{\"id\":\"new-id\",\"type\":\"Component\",\"props\":{},\"children\":[]}}",
    "Prefer minimal incremental patches over full rewrites.",
    "Use existing node ids from the document.",
    "If unsure, return one updateProps patch for root title."
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: prompt,
      selectedNodeId: selectedNodeId ?? null,
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
      temperature: 0.2,
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

  const jsonPayload = extractJsonPayload(content);
  const parsed = JSON.parse(jsonPayload) as unknown;
  const patches = sanitizePatches(parsed);

  if (patches.length === 0) {
    throw new Error("Model returned no valid patches.");
  }

  return patches;
}
