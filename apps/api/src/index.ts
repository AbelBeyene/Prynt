import { cloneDocument, findNodePath, type AstNode, type DocumentAst } from "@prynt/ast";
import { runEditPipeline } from "@prynt/core";
import { serializeDocumentToDsl } from "@prynt/dsl";
import type { PatchOp } from "@prynt/patches";
import { buildRepairPlan } from "@prynt/repair";
import { suggestRepairs, validateDocument } from "@prynt/validator";
import { canUseLlm, generatePatchesFromLlm } from "./ai.js";

export interface VersionSnapshot {
  id: number;
  reason: string;
  createdAt: string;
  document: DocumentAst;
}

export interface FileState {
  fileId: string;
  name: string;
  document: DocumentAst;
  versions: VersionSnapshot[];
  undoStack: DocumentAst[];
  redoStack: DocumentAst[];
  patchHistory: PatchOp[][];
}

export interface FileSummary {
  fileId: string;
  name: string;
  document: DocumentAst;
}

export interface ProjectState {
  files: Map<string, FileState>;
  fileOrder: string[];
}

export interface IntentSpec {
  prompt: string;
  action: "add" | "update" | "replace" | "remove" | "style" | "unknown";
  targetMode: "single" | "multiple";
  targetFileIds: string[];
  confidence: number;
  warnings: string[];
}

export interface ApplyPatchRequest {
  fileId?: string;
  patches: PatchOp[];
  reason?: string;
}

export interface ApplyPatchResponse {
  applied: boolean;
  fileId: string;
  document: DocumentAst;
  validationIssues: ReturnType<typeof validateDocument>["issues"];
  repairSuggestions: string[];
  confidence: number;
  warnings: string[];
  autoRepaired: boolean;
}

export interface PreviewPatchResponse extends ApplyPatchResponse {
  patches: PatchOp[];
}

export interface GenerateFromPromptRequest {
  fileId?: string;
  prompt: string;
  selectedNodeId?: string;
}

export interface PromptTargetResult {
  fileId: string;
  fileName: string;
  source: "llm" | "rule";
  patches: PatchOp[];
  response: ApplyPatchResponse;
}

export interface PromptResult {
  prompt: string;
  intent: IntentSpec;
  fileId: string;
  fileName: string;
  source: "llm" | "rule" | "mixed";
  patches: PatchOp[];
  response: ApplyPatchResponse;
  results: PromptTargetResult[];
}

export interface PromptSimulationResult {
  prompt: string;
  intent: IntentSpec;
  results: PromptTargetResult[];
}

export interface ValidateRequest {
  document: DocumentAst;
}

export interface RepairSuggestRequest {
  document: DocumentAst;
}

export interface RepairApplyResponse {
  applied: boolean;
  fileId: string;
  generatedPatches: PatchOp[];
  document: DocumentAst;
  validationIssues: ReturnType<typeof validateDocument>["issues"];
  confidence: number;
  warnings: string[];
  autoRepaired: boolean;
}

export interface CreateFileRequest {
  name?: string;
  baseFileId?: string;
}

export class EditorApiService {
  private readonly projects = new Map<string, ProjectState>();

  createProject(projectId: string, initialDocument: DocumentAst): ProjectState {
    const fileId = "file-1";
    const file = createFileState(fileId, "Main Screen", {
      ...cloneDocument(initialDocument),
      docId: fileId,
      version: 1
    });

    const project: ProjectState = {
      files: new Map([[fileId, file]]),
      fileOrder: [fileId]
    };

    this.projects.set(projectId, project);
    return project;
  }

  getProject(projectId: string): ProjectState {
    return this.requireProject(projectId);
  }

  listFiles(projectId: string): FileSummary[] {
    const project = this.requireProject(projectId);
    return project.fileOrder.map((fileId) => {
      const file = this.requireFile(project, fileId);
      return {
        fileId: file.fileId,
        name: file.name,
        document: cloneDocument(file.document)
      };
    });
  }

  createFile(projectId: string, request: CreateFileRequest): FileSummary {
    const project = this.requireProject(projectId);
    const baseFileId = request.baseFileId ?? project.fileOrder[0];
    if (!baseFileId) {
      throw new Error("Project has no base file to clone.");
    }

    const base = this.requireFile(project, baseFileId);
    const fileId = `file-${project.fileOrder.length + 1}`;
    const cloned = cloneDocument(base.document);
    cloned.docId = fileId;
    cloned.version = 1;
    cloned.root = reIdTree(cloned.root, fileId);

    if (typeof cloned.root.props.title === "string") {
      cloned.root.props.title = `${cloned.root.props.title} Copy`;
    }

    const next = createFileState(fileId, request.name ?? `Screen ${project.fileOrder.length + 1}`, cloned);
    project.files.set(fileId, next);
    project.fileOrder.push(fileId);

    return {
      fileId,
      name: next.name,
      document: cloneDocument(next.document)
    };
  }

  listVersions(projectId: string, fileId?: string): VersionSnapshot[] {
    const { file } = this.resolveFile(projectId, fileId);
    return file.versions;
  }

  restoreVersion(projectId: string, versionId: number, fileId?: string): ApplyPatchResponse {
    const { file } = this.resolveFile(projectId, fileId);
    const version = file.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new Error(`Version not found: ${versionId}`);
    }

    file.undoStack.push(cloneDocument(file.document));
    file.redoStack = [];
    file.document = cloneDocument(version.document);

    return {
      applied: true,
      fileId: file.fileId,
      document: file.document,
      validationIssues: [],
      repairSuggestions: [],
      confidence: 1,
      warnings: [],
      autoRepaired: false
    };
  }

  undo(projectId: string, fileId?: string): ApplyPatchResponse {
    const { file } = this.resolveFile(projectId, fileId);
    const previous = file.undoStack.pop();
    if (!previous) {
      return {
        applied: false,
        fileId: file.fileId,
        document: file.document,
        validationIssues: [],
        repairSuggestions: ["Nothing to undo."],
        confidence: 1,
        warnings: ["Nothing to undo."],
        autoRepaired: false
      };
    }

    file.redoStack.push(cloneDocument(file.document));
    file.document = previous;

    return {
      applied: true,
      fileId: file.fileId,
      document: file.document,
      validationIssues: [],
      repairSuggestions: [],
      confidence: 1,
      warnings: [],
      autoRepaired: false
    };
  }

  redo(projectId: string, fileId?: string): ApplyPatchResponse {
    const { file } = this.resolveFile(projectId, fileId);
    const next = file.redoStack.pop();
    if (!next) {
      return {
        applied: false,
        fileId: file.fileId,
        document: file.document,
        validationIssues: [],
        repairSuggestions: ["Nothing to redo."],
        confidence: 1,
        warnings: ["Nothing to redo."],
        autoRepaired: false
      };
    }

    file.undoStack.push(cloneDocument(file.document));
    file.document = next;

    return {
      applied: true,
      fileId: file.fileId,
      document: file.document,
      validationIssues: [],
      repairSuggestions: [],
      confidence: 1,
      warnings: [],
      autoRepaired: false
    };
  }

  applyPatch(projectId: string, request: ApplyPatchRequest): ApplyPatchResponse {
    const { file } = this.resolveFile(projectId, request.fileId);
    return this.applyWithAutoRepair(file, request.patches, request.reason ?? "Edit", true);
  }

  previewPatch(projectId: string, request: ApplyPatchRequest): PreviewPatchResponse {
    const { file } = this.resolveFile(projectId, request.fileId);
    const response = this.applyWithAutoRepair(file, request.patches, request.reason ?? "Preview", false);
    return {
      ...response,
      patches: request.patches
    };
  }

  parseIntent(projectId: string, prompt: string, fileId?: string): IntentSpec {
    const { project, file } = this.resolveFile(projectId, fileId);
    return this.buildIntentSpec(project, prompt, file);
  }

  async simulatePrompt(projectId: string, request: GenerateFromPromptRequest): Promise<PromptSimulationResult> {
    const { project, file: initialFile } = this.resolveFile(projectId, request.fileId);
    const intent = this.buildIntentSpec(project, request.prompt, initialFile);

    const results: PromptTargetResult[] = [];
    for (const targetFileId of intent.targetFileIds) {
      const target = this.requireFile(project, targetFileId);
      const generated = await this.generatePatchesForFile(projectId, target, request.prompt, request.selectedNodeId, false);
      results.push(generated);
    }

    return {
      prompt: request.prompt,
      intent,
      results
    };
  }

  async generateFromPrompt(projectId: string, request: GenerateFromPromptRequest): Promise<PromptResult> {
    const { project, file: initialFile } = this.resolveFile(projectId, request.fileId);
    const intent = this.buildIntentSpec(project, request.prompt, initialFile);

    const results: PromptTargetResult[] = [];
    for (const targetFileId of intent.targetFileIds) {
      const target = this.requireFile(project, targetFileId);
      const generated = await this.generatePatchesForFile(projectId, target, request.prompt, request.selectedNodeId, true);
      results.push(generated);
    }

    const primary = results[0];
    if (!primary) {
      throw new Error("No target files resolved for prompt.");
    }

    const source = results.every((result) => result.source === primary.source) ? primary.source : "mixed";

    return {
      prompt: request.prompt,
      intent,
      fileId: primary.fileId,
      fileName: primary.fileName,
      source,
      patches: primary.patches,
      response: primary.response,
      results
    };
  }

  validate(request: ValidateRequest) {
    return validateDocument(request.document);
  }

  repairSuggest(request: RepairSuggestRequest) {
    const validation = validateDocument(request.document);
    const plan = buildRepairPlan(request.document);
    return {
      issues: validation.issues,
      suggestions: suggestRepairs(validation.issues),
      patches: plan.patches,
      summary: plan.summary
    };
  }

  repairApply(projectId: string, fileId?: string): RepairApplyResponse {
    const { file } = this.resolveFile(projectId, fileId);
    const plan = buildRepairPlan(file.document);

    if (plan.patches.length === 0) {
      const validation = validateDocument(file.document);
      return {
        applied: false,
        fileId: file.fileId,
        generatedPatches: [],
        document: file.document,
        validationIssues: validation.issues,
        confidence: 1,
        warnings: ["No repair patches generated."],
        autoRepaired: false
      };
    }

    const response = this.applyWithAutoRepair(file, plan.patches, "Auto repair", true);
    return {
      applied: response.applied,
      fileId: response.fileId,
      generatedPatches: plan.patches,
      document: response.document,
      validationIssues: response.validationIssues,
      confidence: response.confidence,
      warnings: response.warnings,
      autoRepaired: response.autoRepaired
    };
  }

  getDsl(projectId: string, fileId?: string): string {
    const { file } = this.resolveFile(projectId, fileId);
    return serializeDocumentToDsl(file.document);
  }

  private resolveFile(projectId: string, fileId?: string): { project: ProjectState; file: FileState } {
    const project = this.requireProject(projectId);
    const resolvedFileId = fileId ?? project.fileOrder[0];
    if (!resolvedFileId) {
      throw new Error("Project has no files.");
    }
    const file = this.requireFile(project, resolvedFileId);
    return { project, file };
  }

  private buildIntentSpec(project: ProjectState, prompt: string, fallback: FileState): IntentSpec {
    const lower = prompt.toLowerCase();
    const targetFileIds = new Set<string>();
    const warnings: string[] = [];

    const allScreens = /\b(all screens|all artboards|every screen|all files)\b/.test(lower);
    if (allScreens) {
      for (const fileId of project.fileOrder) {
        targetFileIds.add(fileId);
      }
    }

    const fileIdMatches = lower.match(/\bfile-(\d+)\b/g) ?? [];
    for (const match of fileIdMatches) {
      if (project.files.has(match)) {
        targetFileIds.add(match);
      }
    }

    const screenMatches = [...lower.matchAll(/\bscreen\s+(\d+)\b/g)];
    for (const match of screenMatches) {
      const id = `file-${match[1]}`;
      if (project.files.has(id)) {
        targetFileIds.add(id);
      }
    }

    for (const fileId of project.fileOrder) {
      const file = this.requireFile(project, fileId);
      if (lower.includes(file.name.toLowerCase())) {
        targetFileIds.add(file.fileId);
      }
    }

    if (targetFileIds.size === 0) {
      targetFileIds.add(fallback.fileId);
    }

    if (targetFileIds.size > 1 && !allScreens && fileIdMatches.length === 0 && screenMatches.length === 0) {
      warnings.push("Prompt matched multiple screens by name. Confirm target if this was unintentional.");
    }

    let action: IntentSpec["action"] = "unknown";
    if (/(\badd\b|\binsert\b|\bcreate\b)/.test(lower)) action = "add";
    if (/(\bupdate\b|\bchange\b|\bmodify\b)/.test(lower)) action = "update";
    if (/\breplace\b/.test(lower)) action = "replace";
    if (/(\bremove\b|\bdelete\b)/.test(lower)) action = "remove";
    if (/(\brestyle\b|\bpolish\b|\bpremium\b|\bmodern\b)/.test(lower)) action = "style";

    let confidence = 0.6;
    if (allScreens || fileIdMatches.length > 0 || screenMatches.length > 0) confidence += 0.2;
    if (action !== "unknown") confidence += 0.1;
    if (warnings.length > 0) confidence -= 0.15;
    confidence = Math.max(0.1, Math.min(0.98, confidence));

    return {
      prompt,
      action,
      targetMode: targetFileIds.size > 1 ? "multiple" : "single",
      targetFileIds: [...targetFileIds],
      confidence,
      warnings
    };
  }

  private async generatePatchesForFile(
    projectId: string,
    file: FileState,
    prompt: string,
    selectedNodeId: string | undefined,
    commit: boolean
  ): Promise<PromptTargetResult> {
    if (canUseLlm()) {
      try {
        const llmPatches = await generatePatchesFromLlm(prompt, file.document, selectedNodeId);
        const llmResponse = this.applyWithAutoRepair(file, llmPatches, `Prompt: ${prompt}`, commit);
        if (llmResponse.applied) {
          return {
            fileId: file.fileId,
            fileName: file.name,
            source: "llm",
            patches: llmPatches,
            response: llmResponse
          };
        }
      } catch {
        if (process.env.PRYNT_AI_DEBUG === "1") {
          console.warn("LLM prompt generation failed, using rule fallback.");
        }
      }
    }

    const rulePatches = buildPatchesFromPrompt(file.document, prompt, selectedNodeId);
    const ruleResponse = this.applyWithAutoRepair(file, rulePatches, `Prompt: ${prompt}`, commit);
    return {
      fileId: file.fileId,
      fileName: file.name,
      source: "rule",
      patches: rulePatches,
      response: ruleResponse
    };
  }

  private applyWithAutoRepair(file: FileState, patches: PatchOp[], reason: string, commit: boolean): ApplyPatchResponse {
    let result;
    try {
      result = runEditPipeline(file.document, patches);
    } catch (error) {
      return {
        applied: false,
        fileId: file.fileId,
        document: file.document,
        validationIssues: [],
        repairSuggestions: [String((error as Error).message)],
        confidence: 0.2,
        warnings: ["Patch application failed before validation."],
        autoRepaired: false
      };
    }

    if (result.applied) {
      const nextDocument = {
        ...result.document,
        version: commit ? file.document.version + 1 : file.document.version
      };

      if (commit) {
        file.undoStack.push(cloneDocument(file.document));
        file.redoStack = [];
        file.document = nextDocument;
        file.patchHistory.push(patches);
        file.versions.push({
          id: file.versions.length + 1,
          reason,
          createdAt: new Date().toISOString(),
          document: cloneDocument(file.document)
        });
      }

      return {
        applied: true,
        fileId: file.fileId,
        document: nextDocument,
        validationIssues: [],
        repairSuggestions: [],
        confidence: scoreConfidence(patches.length, false, true),
        warnings: [],
        autoRepaired: false
      };
    }

    const repairPlan = buildRepairPlan(result.document);
    if (repairPlan.patches.length > 0) {
      try {
        const repaired = runEditPipeline(result.document, repairPlan.patches);
        if (repaired.applied) {
          const nextDocument = {
            ...repaired.document,
            version: commit ? file.document.version + 1 : file.document.version
          };

          if (commit) {
            file.undoStack.push(cloneDocument(file.document));
            file.redoStack = [];
            file.document = nextDocument;
            file.patchHistory.push([...patches, ...repairPlan.patches]);
            file.versions.push({
              id: file.versions.length + 1,
              reason: `${reason} (auto-repaired)`,
              createdAt: new Date().toISOString(),
              document: cloneDocument(file.document)
            });
          }

          return {
            applied: true,
            fileId: file.fileId,
            document: nextDocument,
            validationIssues: [],
            repairSuggestions: [],
            confidence: scoreConfidence(patches.length + repairPlan.patches.length, true, true),
            warnings: ["Invalid patch auto-repaired before apply."],
            autoRepaired: true
          };
        }
      } catch {
        // continue to final failed response
      }
    }

    return {
      applied: false,
      fileId: file.fileId,
      document: file.document,
      validationIssues: result.validation.issues,
      repairSuggestions: result.repairSuggestions,
      confidence: scoreConfidence(patches.length, false, false),
      warnings: ["Patch failed validation and could not be repaired."],
      autoRepaired: false
    };
  }

  private requireProject(projectId: string): ProjectState {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireFile(project: ProjectState, fileId: string): FileState {
    const file = project.files.get(fileId);
    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }
    return file;
  }
}

function scoreConfidence(patchCount: number, autoRepaired: boolean, valid: boolean): number {
  if (!valid) {
    return 0.25;
  }
  let score = 0.92;
  if (patchCount > 4) score -= 0.12;
  if (patchCount > 8) score -= 0.15;
  if (autoRepaired) score -= 0.2;
  return Math.max(0.3, Math.min(0.99, score));
}

function createFileState(fileId: string, name: string, document: DocumentAst): FileState {
  const firstVersion: VersionSnapshot = {
    id: 1,
    reason: "Initial",
    createdAt: new Date().toISOString(),
    document: cloneDocument(document)
  };

  return {
    fileId,
    name,
    document,
    versions: [firstVersion],
    undoStack: [],
    redoStack: [],
    patchHistory: []
  };
}

function reIdTree(node: AstNode, fileId: string): AstNode {
  const clone: AstNode = {
    ...node,
    id: `${node.id}-${fileId}`,
    props: { ...node.props },
    children: node.children.map((child) => reIdTree(child, fileId))
  };
  return clone;
}

function findFirstNodeByType(root: AstNode, type: string): AstNode | null {
  const stack: AstNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.type === type) {
      return current;
    }
    stack.push(...current.children);
  }
  return null;
}

function createNode(type: string, id: string, props: Record<string, unknown>, children: AstNode[] = []): AstNode {
  return { id, type, props, children };
}

function nextId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildPatchesFromPrompt(document: DocumentAst, prompt: string, selectedNodeId?: string): PatchOp[] {
  const lower = prompt.toLowerCase();
  const patches: PatchOp[] = [];

  if (lower.includes("replace") && lower.includes("sidebar") && lower.includes("tabs")) {
    const sidebar = findFirstNodeByType(document.root, "Sidebar");
    if (sidebar) {
      patches.push({ opId: nextId("remove"), type: "removeNode", targetId: sidebar.id });
    }
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: document.root.id,
      node: createNode("BottomTabBar", nextId("tabbar"), { tabs: 4 })
    });
  }

  if (lower.includes("add") && lower.includes("search")) {
    const targetParent = selectedNodeId ?? findFirstNodeByType(document.root, "Stack")?.id ?? document.root.id;
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: targetParent,
      node: createNode("TextField", nextId("search"), { label: "Search", placeholder: "Search...", minHeight: 44 })
    });
  }

  if (lower.includes("add") && lower.includes("button")) {
    const targetParent = selectedNodeId ?? findFirstNodeByType(document.root, "Stack")?.id ?? document.root.id;
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: targetParent,
      node: createNode("Button", nextId("button"), { text: "Continue", tone: "primary", size: "md", minHeight: 44 })
    });
  }

  if (lower.includes("add") && lower.includes("card")) {
    const targetParent = selectedNodeId ?? findFirstNodeByType(document.root, "Stack")?.id ?? document.root.id;
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: targetParent,
      node: createNode("Card", nextId("card"), { tone: "surface", radius: "lg" }, [
        createNode("Heading", nextId("heading"), { text: "New Card", size: "lg" }),
        createNode("Text", nextId("text"), { text: "Generated from prompt" })
      ])
    });
  }

  if (lower.includes("premium") || lower.includes("modern")) {
    const stack: AstNode[] = [document.root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }

      if (node.type === "Card") {
        patches.push({
          opId: nextId("style"),
          type: "updateProps",
          targetId: node.id,
          props: { tone: "accent", radius: "xl" }
        });
      }
      if (node.type === "Heading") {
        patches.push({
          opId: nextId("style"),
          type: "updateProps",
          targetId: node.id,
          props: { size: "2xl" }
        });
      }

      stack.push(...node.children);
    }
  }

  if (lower.includes("mobile") && lower.includes("friendly")) {
    const stack: AstNode[] = [document.root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (node.type === "Grid") {
        patches.push({
          opId: nextId("mobile"),
          type: "updateProps",
          targetId: node.id,
          props: { columns: 1 }
        });
      }
      stack.push(...node.children);
    }
  }

  if (patches.length === 0) {
    const titleNode = findNodePath(document.root, document.root.id)?.node;
    if (titleNode) {
      patches.push({
        opId: nextId("fallback"),
        type: "updateProps",
        targetId: titleNode.id,
        props: { title: String(titleNode.props.title ?? "Screen") + " (updated)" }
      });
    }
  }

  return patches;
}

export function buildStubInitialDocument(projectId: string): DocumentAst {
  return {
    schemaVersion: "1.0.0",
    docId: projectId,
    version: 1,
    root: {
      id: "screen-root",
      type: "Screen",
      props: { title: "Dashboard" },
      children: [
        {
          id: "topbar-1",
          type: "TopBar",
          props: { title: "Dashboard" },
          children: []
        },
        {
          id: "scroll-1",
          type: "ScrollView",
          props: { padding: "md" },
          children: [
            {
              id: "stack-1",
              type: "Stack",
              props: { gap: "md", padding: "md" },
              children: [
                {
                  id: "card-1",
                  type: "Card",
                  props: { tone: "surface", radius: "lg" },
                  children: [
                    {
                      id: "heading-1",
                      type: "Heading",
                      props: { text: "Overview", size: "xl" },
                      children: []
                    },
                    {
                      id: "text-1",
                      type: "Text",
                      props: { text: "Today's activity and performance" },
                      children: []
                    },
                    {
                      id: "button-1",
                      type: "Button",
                      props: { text: "View details", tone: "primary", minHeight: 44, size: "md" },
                      children: []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          id: "tabbar-1",
          type: "BottomTabBar",
          props: { tabs: 4 },
          children: []
        }
      ]
    }
  };
}
