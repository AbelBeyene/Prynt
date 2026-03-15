import { cloneDocument, findNodePath, type AstNode, type DocumentAst } from "@prynt/ast";
import { runEditPipeline } from "@prynt/core";
import { serializeDocumentToDsl } from "@prynt/dsl";
import type { PatchOp } from "@prynt/patches";
import { buildRepairPlan } from "@prynt/repair";
import { suggestRepairs, validateDocument } from "@prynt/validator";
import { canUseLlm, generatePatchesFromLlm } from "./ai.js";
import Fuse from "fuse.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  projectId: string;
  createdAt: string;
  updatedAt: string;
  files: Map<string, FileState>;
  fileOrder: string[];
  promptHistory: PromptHistoryEntry[];
}

export interface ProjectSummary {
  projectId: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
}

export interface IntentSpec {
  prompt: string;
  action: "add" | "update" | "replace" | "remove" | "style" | "unknown";
  targetMode: "single" | "multiple";
  targetFileIds: string[];
  confidence: number;
  warnings: string[];
}

export interface PromptHistoryEntry {
  id: string;
  prompt: string;
  action: IntentSpec["action"];
  targetFileIds: string[];
  source: "llm" | "rule" | "mixed";
  createdAt: string;
}

export interface PromptSuggestion {
  id: string;
  text: string;
  category: "layout" | "content" | "style" | "navigation" | "input";
}

export interface TemplateDefinition {
  id: string;
  name: string;
  category: "mobile-app" | "dashboard" | "landing-page" | "admin" | "marketing" | "auth" | "onboarding" | "forms";
  style: "modern-saas" | "minimal" | "enterprise" | "glassmorphism" | "dark" | "light" | "mobile-native";
  description: string;
}

export interface ExportResult {
  format: "json" | "dsl" | "react" | "schema";
  fileId: string;
  fileName: string;
  content: string;
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

export interface RenameFileRequest {
  name: string;
}

export interface DuplicateFileRequest {
  name?: string;
}

export interface ApplyTemplateRequest {
  fileId?: string;
  templateId: string;
}

interface PersistedProjectState {
  projectId: string;
  createdAt: string;
  updatedAt: string;
  fileOrder: string[];
  promptHistory: PromptHistoryEntry[];
  files: FileState[];
}

export class EditorApiService {
  private readonly projects = new Map<string, ProjectState>();
  private readonly dataDir: string;

  constructor() {
    this.dataDir = process.env.PRYNT_DATA_DIR
      ? path.resolve(process.env.PRYNT_DATA_DIR)
      : path.resolve(process.cwd(), "data", "projects");
    mkdirSync(this.dataDir, { recursive: true });
    this.loadPersistedProjects();
  }

  createProject(projectId: string, initialDocument: DocumentAst): ProjectState {
    const existing = this.projects.get(projectId);
    if (existing) {
      return existing;
    }

    const fileId = "file-1";
    const file = createFileState(fileId, "Main Screen", {
      ...cloneDocument(initialDocument),
      docId: fileId,
      version: 1
    });

    const now = new Date().toISOString();
    const project: ProjectState = {
      projectId,
      createdAt: now,
      updatedAt: now,
      files: new Map([[fileId, file]]),
      fileOrder: [fileId],
      promptHistory: []
    };

    this.projects.set(projectId, project);
    this.persistProject(project);
    return project;
  }

  getProject(projectId: string): ProjectState {
    return this.requireProject(projectId);
  }

  listProjects(): ProjectSummary[] {
    return [...this.projects.values()].map((project) => ({
      projectId: project.projectId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      fileCount: project.fileOrder.length
    }));
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
    project.updatedAt = new Date().toISOString();
    this.persistProject(project);

    return {
      fileId,
      name: next.name,
      document: cloneDocument(next.document)
    };
  }

  renameFile(projectId: string, fileId: string, request: RenameFileRequest): FileSummary {
    const project = this.requireProject(projectId);
    const file = this.requireFile(project, fileId);
    const nextName = request.name.trim();
    if (!nextName) {
      throw new Error("File name cannot be empty.");
    }
    file.name = nextName;
    project.updatedAt = new Date().toISOString();
    this.persistProject(project);
    return {
      fileId: file.fileId,
      name: file.name,
      document: cloneDocument(file.document)
    };
  }

  duplicateFile(projectId: string, fileId: string, request: DuplicateFileRequest): FileSummary {
    const project = this.requireProject(projectId);
    const source = this.requireFile(project, fileId);
    const nextIdValue = `file-${project.fileOrder.length + 1}`;
    const cloned = cloneDocument(source.document);
    cloned.docId = nextIdValue;
    cloned.version = 1;
    cloned.root = reIdTree(cloned.root, nextIdValue);
    const name = request.name?.trim() || `${source.name} Copy`;
    const next = createFileState(nextIdValue, name, cloned);
    project.files.set(nextIdValue, next);
    project.fileOrder.push(nextIdValue);
    project.updatedAt = new Date().toISOString();
    this.persistProject(project);
    return { fileId: next.fileId, name: next.name, document: cloneDocument(next.document) };
  }

  deleteFile(projectId: string, fileId: string): { deleted: boolean; fileId: string; nextActiveFileId: string | null } {
    const project = this.requireProject(projectId);
    if (!project.files.has(fileId)) {
      throw new Error(`File not found: ${fileId}`);
    }
    if (project.fileOrder.length <= 1) {
      throw new Error("At least one file is required in a project.");
    }
    project.files.delete(fileId);
    project.fileOrder = project.fileOrder.filter((id) => id !== fileId);
    project.updatedAt = new Date().toISOString();
    this.persistProject(project);
    return {
      deleted: true,
      fileId,
      nextActiveFileId: project.fileOrder[0] ?? null
    };
  }

  listTemplates(): TemplateDefinition[] {
    return [
      { id: "mobile-dashboard", name: "Mobile Dashboard", category: "mobile-app", style: "mobile-native", description: "Metrics overview with cards and activity list." },
      { id: "auth-login", name: "Authentication Login", category: "auth", style: "minimal", description: "Sign-in screen with form and social actions." },
      { id: "profile-settings", name: "Profile + Settings", category: "mobile-app", style: "modern-saas", description: "Profile header with settings and preferences." },
      { id: "saas-landing", name: "SaaS Landing", category: "landing-page", style: "modern-saas", description: "Hero, benefits, testimonials, and CTA." },
      { id: "admin-panel", name: "Admin Panel", category: "admin", style: "enterprise", description: "Data-driven admin layout with stats and table." },
      { id: "onboarding-flow", name: "Onboarding Flow", category: "onboarding", style: "mobile-native", description: "Welcome, value props, and account setup steps." },
      { id: "ecommerce-home", name: "E-commerce Home", category: "marketing", style: "modern-saas", description: "Product categories, featured items, and promotions." },
      { id: "form-heavy", name: "Form-Heavy Workspace", category: "forms", style: "light", description: "Long-form workflow with grouped input sections." }
    ];
  }

  applyTemplate(projectId: string, request: ApplyTemplateRequest): FileSummary {
    const { project, file } = this.resolveFile(projectId, request.fileId);
    const template = buildTemplateDocument(request.templateId, file.fileId);
    const validation = validateDocument(template);
    if (!validation.valid) {
      throw new Error(`Template '${request.templateId}' is invalid: ${validation.issues.map((i) => i.message).join(" | ")}`);
    }

    file.undoStack.push(cloneDocument(file.document));
    file.redoStack = [];
    file.document = template;
    file.versions.push({
      id: file.versions.length + 1,
      reason: `Template: ${request.templateId}`,
      createdAt: new Date().toISOString(),
      document: cloneDocument(file.document)
    });
    project.updatedAt = new Date().toISOString();
    this.persistProject(project);
    return { fileId: file.fileId, name: file.name, document: cloneDocument(file.document) };
  }

  exportFile(projectId: string, fileId: string | undefined, format: ExportResult["format"]): ExportResult {
    const { file } = this.resolveFile(projectId, fileId);
    if (format === "dsl") {
      return { format, fileId: file.fileId, fileName: file.name, content: serializeDocumentToDsl(file.document) };
    }
    if (format === "react") {
      return { format, fileId: file.fileId, fileName: file.name, content: renderReactExport(file.document) };
    }
    if (format === "schema") {
      return {
        format,
        fileId: file.fileId,
        fileName: file.name,
        content: JSON.stringify(
          {
            schemaVersion: file.document.schemaVersion,
            docId: file.document.docId,
            version: file.document.version,
            rootType: file.document.root.type
          },
          null,
          2
        )
      };
    }
    return {
      format: "json",
      fileId: file.fileId,
      fileName: file.name,
      content: JSON.stringify(file.document, null, 2)
    };
  }

  listVersions(projectId: string, fileId?: string): VersionSnapshot[] {
    const { file } = this.resolveFile(projectId, fileId);
    return file.versions;
  }

  listPromptHistory(projectId: string, limit = 24, query = ""): PromptHistoryEntry[] {
    const project = this.requireProject(projectId);
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? project.promptHistory.filter((item) => item.prompt.toLowerCase().includes(needle))
      : project.promptHistory;
    return filtered.slice(-Math.max(1, limit)).reverse();
  }

  suggestPrompts(projectId: string, fileId?: string, query = ""): PromptSuggestion[] {
    const { file } = this.resolveFile(projectId, fileId);
    const staticSuggestions: PromptSuggestion[] = [
      { id: "s-layout-1", text: "Add a sticky CTA at the bottom of this screen", category: "layout" },
      { id: "s-content-1", text: "Add a compact summary card below the top section", category: "content" },
      { id: "s-input-1", text: "Place a search field above the list", category: "input" },
      { id: "s-nav-1", text: "Convert this flow to use a bottom tab bar", category: "navigation" },
      { id: "s-style-1", text: "Make the screen feel more premium with better spacing", category: "style" }
    ];

    const rootTitle = String(file.document.root.props.title ?? file.name);
    const dynamicSuggestions: PromptSuggestion[] = [
      { id: `d-${file.fileId}-1`, text: `On ${file.name}, add a primary action button`, category: "input" },
      { id: `d-${file.fileId}-2`, text: `Restyle ${rootTitle} with stronger hierarchy`, category: "style" },
      { id: `d-${file.fileId}-3`, text: `Add a secondary info section in ${file.name}`, category: "content" }
    ];

    const all = [...dynamicSuggestions, ...staticSuggestions];
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return all;
    }
    return all.filter((item) => item.text.toLowerCase().includes(needle));
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
    const project = this.requireProject(projectId);
    project.updatedAt = new Date().toISOString();
    this.persistProject(project);

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
    const project = this.requireProject(projectId);
    project.updatedAt = new Date().toISOString();
    this.persistProject(project);

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
    const project = this.requireProject(projectId);
    project.updatedAt = new Date().toISOString();
    this.persistProject(project);

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
    project.promptHistory.push({
      id: nextId("prompt"),
      prompt: request.prompt,
      action: intent.action,
      targetFileIds: intent.targetFileIds,
      source,
      createdAt: new Date().toISOString()
    });
    if (project.promptHistory.length > 200) {
      project.promptHistory = project.promptHistory.slice(-200);
    }
    project.updatedAt = new Date().toISOString();
    this.persistProject(project);

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
      const candidates = project.fileOrder.map((fileId) => {
        const file = this.requireFile(project, fileId);
        return { fileId: file.fileId, name: file.name };
      });
      const fuse = new Fuse(candidates, { keys: ["name"], threshold: 0.35, includeScore: true });
      const fuzzy = fuse.search(prompt, { limit: 2 });
      for (const match of fuzzy) {
        if ((match.score ?? 1) <= 0.35) {
          targetFileIds.add(match.item.fileId);
        }
      }
      if (fuzzy.length > 0 && targetFileIds.size > 0) {
        warnings.push("Used fuzzy target matching from screen names.");
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
        const project = [...this.projects.values()].find((entry) => entry.files.has(file.fileId));
        if (project) {
          project.updatedAt = new Date().toISOString();
          this.persistProject(project);
        }
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
            const project = [...this.projects.values()].find((entry) => entry.files.has(file.fileId));
            if (project) {
              project.updatedAt = new Date().toISOString();
              this.persistProject(project);
            }
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

  private loadPersistedProjects(): void {
    const files = existsSync(this.dataDir) ? readdirSync(this.dataDir) : [];
    for (const fileName of files) {
      if (!fileName.endsWith(".json")) continue;
      const filePath = path.join(this.dataDir, fileName);
      try {
        const raw = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as PersistedProjectState;
        if (!parsed.projectId || !Array.isArray(parsed.files) || !Array.isArray(parsed.fileOrder)) {
          continue;
        }
        const fileMap = new Map<string, FileState>();
        for (const entry of parsed.files) {
          fileMap.set(entry.fileId, {
            ...entry,
            document: cloneDocument(entry.document),
            versions: entry.versions.map((version) => ({ ...version, document: cloneDocument(version.document) })),
            undoStack: (entry.undoStack ?? []).map((doc) => cloneDocument(doc)),
            redoStack: (entry.redoStack ?? []).map((doc) => cloneDocument(doc)),
            patchHistory: entry.patchHistory ?? []
          });
        }
        this.projects.set(parsed.projectId, {
          projectId: parsed.projectId,
          createdAt: parsed.createdAt ?? new Date().toISOString(),
          updatedAt: parsed.updatedAt ?? new Date().toISOString(),
          fileOrder: parsed.fileOrder.filter((id) => fileMap.has(id)),
          promptHistory: parsed.promptHistory ?? [],
          files: fileMap
        });
      } catch {
        // skip invalid persisted files
      }
    }
  }

  private persistProject(project: ProjectState): void {
    const filePath = path.join(this.dataDir, `${project.projectId}.json`);
    const payload: PersistedProjectState = {
      projectId: project.projectId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      fileOrder: [...project.fileOrder],
      promptHistory: [...project.promptHistory],
      files: project.fileOrder
        .map((fileId) => project.files.get(fileId))
        .filter((file): file is FileState => Boolean(file))
        .map((file) => ({
          ...file,
          document: cloneDocument(file.document),
          versions: file.versions.map((version) => ({ ...version, document: cloneDocument(version.document) })),
          undoStack: file.undoStack.map((doc) => cloneDocument(doc)),
          redoStack: file.redoStack.map((doc) => cloneDocument(doc)),
          patchHistory: file.patchHistory.map((entry) => [...entry])
        }))
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
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

function containsAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function pickFirst(text: string, words: string[]): string | null {
  for (const word of words) {
    if (text.includes(word)) return word;
  }
  return null;
}

function buildDashboardStack(): AstNode {
  return createNode("Stack", nextId("stack"), { gap: "lg", padding: "lg" }, [
    createNode("Card", nextId("card"), { tone: "surface", radius: "lg" }, [
      createNode("Heading", nextId("heading"), { text: "Overview", size: "xl" }),
      createNode("Text", nextId("text"), { text: "Your weekly metrics at a glance." }),
      createNode("Badge", nextId("badge"), { text: "Live", tone: "accent" })
    ]),
    createNode("Grid", nextId("grid"), { columns: 2, gap: "md" }, [
      createNode("Card", nextId("card"), { tone: "surface", radius: "lg" }, [
        createNode("Heading", nextId("heading"), { text: "Revenue", size: "lg" }),
        createNode("Text", nextId("text"), { text: "$42,300" })
      ]),
      createNode("Card", nextId("card"), { tone: "surface", radius: "lg" }, [
        createNode("Heading", nextId("heading"), { text: "Orders", size: "lg" }),
        createNode("Text", nextId("text"), { text: "1,294" })
      ])
    ]),
    createNode("List", nextId("list"), { dense: false }, [
      createNode("ListItem", nextId("li"), { title: "New signups", subtitle: "24 today" }),
      createNode("ListItem", nextId("li"), { title: "Churn risk", subtitle: "4 accounts" })
    ])
  ]);
}

function buildLoginStack(): AstNode {
  return createNode("Stack", nextId("stack"), { gap: "md", padding: "lg" }, [
    createNode("Heading", nextId("heading"), { text: "Welcome back", size: "2xl" }),
    createNode("Text", nextId("text"), { text: "Sign in to continue." }),
    createNode("Form", nextId("form"), { title: "Sign in" }, [
      createNode("TextField", nextId("email"), { label: "Email", placeholder: "you@company.com", minHeight: 44 }),
      createNode("TextField", nextId("password"), { label: "Password", placeholder: "••••••••", minHeight: 44 }),
      createNode("Checkbox", nextId("remember"), { label: "Remember me", checked: true }),
      createNode("Button", nextId("signin"), { text: "Sign In", tone: "primary", size: "md", minHeight: 44 })
    ])
  ]);
}

function buildProfileStack(): AstNode {
  return createNode("Stack", nextId("stack"), { gap: "md", padding: "lg" }, [
    createNode("Card", nextId("card"), { tone: "surface", radius: "xl" }, [
      createNode("Avatar", nextId("avatar"), { initials: "AB", size: "lg" }),
      createNode("Heading", nextId("heading"), { text: "Alex Brown", size: "xl" }),
      createNode("Text", nextId("text"), { text: "Product Designer" }),
      createNode("Badge", nextId("badge"), { text: "Pro", tone: "primary" })
    ]),
    createNode("List", nextId("list"), {}, [
      createNode("ListItem", nextId("li"), { title: "Orders", subtitle: "View purchase history" }),
      createNode("ListItem", nextId("li"), { title: "Notifications", subtitle: "Manage alerts" }),
      createNode("ListItem", nextId("li"), { title: "Privacy", subtitle: "Security settings" })
    ])
  ]);
}

function buildCommerceStack(): AstNode {
  return createNode("Stack", nextId("stack"), { gap: "lg", padding: "lg" }, [
    createNode("SearchBar", nextId("search"), { placeholder: "Search restaurants", minHeight: 44 }),
    createNode("Grid", nextId("grid"), { columns: 2, gap: "md" }, [
      createNode("Card", nextId("card"), { tone: "surface", radius: "lg" }, [
        createNode("Heading", nextId("heading"), { text: "Burgers", size: "lg" }),
        createNode("Text", nextId("text"), { text: "24 places" })
      ]),
      createNode("Card", nextId("card"), { tone: "surface", radius: "lg" }, [
        createNode("Heading", nextId("heading"), { text: "Sushi", size: "lg" }),
        createNode("Text", nextId("text"), { text: "18 places" })
      ])
    ]),
    createNode("List", nextId("list"), {}, [
      createNode("ListItem", nextId("li"), { title: "Urban Slice", subtitle: "25-35 min" }),
      createNode("ListItem", nextId("li"), { title: "Green Bowl", subtitle: "15-20 min" })
    ])
  ]);
}

function buildPatchesFromPrompt(document: DocumentAst, prompt: string, selectedNodeId?: string): PatchOp[] {
  const lower = prompt.toLowerCase();
  const patches: PatchOp[] = [];
  const stackTarget = findFirstNodeByType(document.root, "Stack");
  const scrollTarget = findFirstNodeByType(document.root, "ScrollView");
  const targetParent = selectedNodeId ?? stackTarget?.id ?? scrollTarget?.id ?? document.root.id;
  const selectedNode = selectedNodeId ? findNodePath(document.root, selectedNodeId)?.node ?? null : null;

  if (selectedNode) {
    if (containsAny(lower, ["delete this", "remove this"])) {
      patches.push({ opId: nextId("selected-remove"), type: "removeNode", targetId: selectedNode.id });
    }

    const tone = pickFirst(lower, ["primary", "secondary", "accent", "surface", "muted", "danger"]);
    if (tone && "tone" in selectedNode.props) {
      patches.push({
        opId: nextId("selected-tone"),
        type: "updateProps",
        targetId: selectedNode.id,
        props: { tone }
      });
    }

    if (containsAny(lower, ["rounded", "rounder"])) {
      patches.push({
        opId: nextId("selected-radius"),
        type: "updateProps",
        targetId: selectedNode.id,
        props: { radius: "xl" }
      });
    }
    if (containsAny(lower, ["less rounded", "sharper"])) {
      patches.push({
        opId: nextId("selected-radius"),
        type: "updateProps",
        targetId: selectedNode.id,
        props: { radius: "sm" }
      });
    }

    if (containsAny(lower, ["increase padding", "more padding"])) {
      patches.push({
        opId: nextId("selected-padding"),
        type: "updateProps",
        targetId: selectedNode.id,
        props: { padding: "lg" }
      });
    }
    if (containsAny(lower, ["reduce padding", "less padding"])) {
      patches.push({
        opId: nextId("selected-padding"),
        type: "updateProps",
        targetId: selectedNode.id,
        props: { padding: "sm" }
      });
    }

    if (containsAny(lower, ["bigger", "larger", "increase size"])) {
      patches.push({
        opId: nextId("selected-size"),
        type: "updateProps",
        targetId: selectedNode.id,
        props: { size: "lg" }
      });
    }
    if (containsAny(lower, ["smaller", "decrease size"])) {
      patches.push({
        opId: nextId("selected-size"),
        type: "updateProps",
        targetId: selectedNode.id,
        props: { size: "sm" }
      });
    }

    const textMatch = prompt.match(/(?:text|title|label)\s+to\s+["']([^"']+)["']/i);
    if (textMatch?.[1]) {
      const key = selectedNode.props.text !== undefined ? "text" : selectedNode.props.title !== undefined ? "title" : "label";
      patches.push({
        opId: nextId("selected-text"),
        type: "updateProps",
        targetId: selectedNode.id,
        props: { [key]: textMatch[1] }
      });
    }
  }

  if (containsAny(lower, ["dashboard", "analytics", "overview"])) {
    if (stackTarget) {
      patches.push({ opId: nextId("replace"), type: "replaceNode", targetId: stackTarget.id, node: buildDashboardStack() });
    }
    patches.push({ opId: nextId("title"), type: "updateProps", targetId: document.root.id, props: { title: "Dashboard" } });
  }

  if (containsAny(lower, ["login", "sign in", "auth", "authentication"])) {
    if (stackTarget) {
      patches.push({ opId: nextId("replace"), type: "replaceNode", targetId: stackTarget.id, node: buildLoginStack() });
    }
    patches.push({ opId: nextId("title"), type: "updateProps", targetId: document.root.id, props: { title: "Sign In" } });
  }

  if (containsAny(lower, ["profile", "account", "user page"])) {
    if (stackTarget) {
      patches.push({ opId: nextId("replace"), type: "replaceNode", targetId: stackTarget.id, node: buildProfileStack() });
    }
    patches.push({ opId: nextId("title"), type: "updateProps", targetId: document.root.id, props: { title: "Profile" } });
  }

  if (containsAny(lower, ["food", "delivery", "restaurant", "shop", "ecommerce", "store"])) {
    if (stackTarget) {
      patches.push({ opId: nextId("replace"), type: "replaceNode", targetId: stackTarget.id, node: buildCommerceStack() });
    }
    patches.push({ opId: nextId("title"), type: "updateProps", targetId: document.root.id, props: { title: "Discover" } });
  }

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
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: targetParent,
      node: createNode("SearchBar", nextId("search"), { placeholder: "Search...", minHeight: 44 })
    });
  }

  if (lower.includes("add") && lower.includes("button")) {
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: targetParent,
      node: createNode("Button", nextId("button"), { text: "Continue", tone: "primary", size: "md", minHeight: 44 })
    });
  }

  if (lower.includes("add") && lower.includes("card")) {
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

  if (lower.includes("add") && lower.includes("list")) {
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: targetParent,
      node: createNode("List", nextId("list"), {}, [
        createNode("ListItem", nextId("li"), { title: "First item", subtitle: "Details" }),
        createNode("ListItem", nextId("li"), { title: "Second item", subtitle: "Details" })
      ])
    });
  }

  if (lower.includes("add") && lower.includes("form")) {
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: targetParent,
      node: createNode("Form", nextId("form"), { title: "Contact" }, [
        createNode("TextField", nextId("name"), { label: "Name", placeholder: "Jane Doe", minHeight: 44 }),
        createNode("TextArea", nextId("message"), { placeholder: "Message", rows: 4 }),
        createNode("Button", nextId("submit"), { text: "Submit", tone: "primary", size: "md", minHeight: 44 })
      ])
    });
  }

  if (lower.includes("add") && lower.includes("table")) {
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: targetParent,
      node: createNode("Table", nextId("table"), { rows: 4, columns: 3 })
    });
  }

  if (lower.includes("add") && lower.includes("modal")) {
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: document.root.id,
      node: createNode("Modal", nextId("modal"), { title: "Details", open: true }, [
        createNode("Text", nextId("text"), { text: "Modal content" }),
        createNode("Button", nextId("close"), { text: "Close", tone: "secondary", size: "md", minHeight: 44 })
      ])
    });
  }

  if (lower.includes("add") && lower.includes("badge")) {
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: targetParent,
      node: createNode("Badge", nextId("badge"), { text: "New", tone: "accent" })
    });
  }

  if (lower.includes("add") && lower.includes("avatar")) {
    patches.push({
      opId: nextId("add"),
      type: "addNode",
      parentId: targetParent,
      node: createNode("Avatar", nextId("avatar"), { initials: "AB", size: "lg" })
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
      if (node.type === "Button") {
        patches.push({
          opId: nextId("style"),
          type: "updateProps",
          targetId: node.id,
          props: { tone: "primary", size: "lg", minHeight: 48 }
        });
      }
      if (node.type === "Stack") {
        patches.push({
          opId: nextId("style"),
          type: "updateProps",
          targetId: node.id,
          props: { gap: "lg", padding: "lg" }
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
          id: "safearea-1",
          type: "SafeArea",
          props: {},
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
                      id: "search-1",
                      type: "SearchBar",
                      props: { placeholder: "Search metrics", minHeight: 44 },
                      children: []
                    },
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
                    },
                    {
                      id: "list-1",
                      type: "List",
                      props: {},
                      children: [
                        { id: "li-1", type: "ListItem", props: { title: "Visitors", subtitle: "2,340 today" }, children: [] },
                        { id: "li-2", type: "ListItem", props: { title: "Conversion", subtitle: "4.8%" }, children: [] }
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
      ]
    }
  };
}

function renderReactExport(document: DocumentAst): string {
  function renderNode(node: AstNode, depth: number): string {
    const indent = "  ".repeat(depth);
    const propEntries = Object.entries(node.props).filter(([, value]) => value !== undefined);
    const props = propEntries.length
      ? " " + propEntries.map(([key, value]) => `${key}={${JSON.stringify(value)}}`).join(" ")
      : "";
    if (node.children.length === 0) {
      return `${indent}<${node.type}${props} />`;
    }
    const children = node.children.map((child) => renderNode(child, depth + 1)).join("\n");
    return `${indent}<${node.type}${props}>\n${children}\n${indent}</${node.type}>`;
  }

  return [
    "import React from \"react\";",
    "",
    "export function GeneratedScreen() {",
    "  return (",
    renderNode(document.root, 2),
    "  );",
    "}",
    ""
  ].join("\n");
}

function createTemplateRoot(title: string, bodyChildren: AstNode[], includeTabs = true): AstNode {
  return createNode("Screen", "screen-root", { title }, [
    createNode("SafeArea", "safearea-1", {}, [
      createNode("TopBar", "topbar-1", { title }),
      createNode("ScrollView", "scroll-1", { padding: "md" }, [
        createNode("Stack", "stack-1", { gap: "md", padding: "md" }, bodyChildren)
      ]),
      ...(includeTabs ? [createNode("BottomTabBar", "tabbar-1", { tabs: 4 })] : [])
    ])
  ]);
}

function buildTemplateDocument(templateId: string, fileId: string): DocumentAst {
  const nowVersion = 1;
  if (templateId === "auth-login") {
    return {
      schemaVersion: "1.0.0",
      docId: fileId,
      version: nowVersion,
      root: createTemplateRoot("Sign In", [
        createNode("Heading", "heading-1", { text: "Welcome back", size: "2xl" }),
        createNode("Text", "text-1", { text: "Sign in to continue." }),
        createNode("Form", "form-1", { title: "Login" }, [
          createNode("TextField", "email-1", { label: "Email", placeholder: "you@company.com", minHeight: 44 }),
          createNode("TextField", "password-1", { label: "Password", placeholder: "••••••••", minHeight: 44 }),
          createNode("Button", "signin-1", { text: "Sign In", tone: "primary", size: "md", minHeight: 44 })
        ])
      ], false)
    };
  }

  if (templateId === "profile-settings") {
    return {
      schemaVersion: "1.0.0",
      docId: fileId,
      version: nowVersion,
      root: createTemplateRoot("Profile", [
        createNode("Card", "card-1", { tone: "surface", radius: "xl" }, [
          createNode("Avatar", "avatar-1", { initials: "AB", size: "lg" }),
          createNode("Heading", "heading-1", { text: "Alex Brown", size: "xl" }),
          createNode("Badge", "badge-1", { text: "Pro", tone: "primary" })
        ]),
        createNode("List", "list-1", {}, [
          createNode("ListItem", "li-1", { title: "Notifications", subtitle: "Push and email alerts" }),
          createNode("ListItem", "li-2", { title: "Privacy", subtitle: "Security controls" }),
          createNode("ListItem", "li-3", { title: "Subscription", subtitle: "Manage billing" })
        ])
      ])
    };
  }

  if (templateId === "saas-landing") {
    return {
      schemaVersion: "1.0.0",
      docId: fileId,
      version: nowVersion,
      root: createTemplateRoot("Launch Faster", [
        createNode("Card", "hero-1", { tone: "primary", radius: "xl" }, [
          createNode("Heading", "heading-1", { text: "Build your product in days", size: "3xl" }),
          createNode("Text", "text-1", { text: "A modern platform for teams shipping fast." }),
          createNode("Button", "cta-1", { text: "Start Free Trial", tone: "accent", size: "lg", minHeight: 48 })
        ]),
        createNode("Grid", "grid-1", { columns: 2, gap: "md" }, [
          createNode("Card", "card-1", { tone: "surface", radius: "lg" }, [createNode("Text", "text-2", { text: "No-code workflows" })]),
          createNode("Card", "card-2", { tone: "surface", radius: "lg" }, [createNode("Text", "text-3", { text: "AI-assisted layout generation" })])
        ]),
        createNode("PricingTable", "pricing-1", { tier: "Pro", tone: "primary" })
      ], false)
    };
  }

  if (templateId === "admin-panel") {
    return {
      schemaVersion: "1.0.0",
      docId: fileId,
      version: nowVersion,
      root: createTemplateRoot("Admin Panel", [
        createNode("Grid", "stats-grid-1", { columns: 2, gap: "md" }, [
          createNode("Card", "stat-1", { tone: "surface", radius: "lg" }, [createNode("Heading", "h1", { text: "Users", size: "lg" }), createNode("Text", "t1", { text: "12,941" })]),
          createNode("Card", "stat-2", { tone: "surface", radius: "lg" }, [createNode("Heading", "h2", { text: "Revenue", size: "lg" }), createNode("Text", "t2", { text: "$82,300" })])
        ]),
        createNode("Table", "table-1", { rows: 6, columns: 4 })
      ])
    };
  }

  if (templateId === "onboarding-flow") {
    return {
      schemaVersion: "1.0.0",
      docId: fileId,
      version: nowVersion,
      root: createTemplateRoot("Get Started", [
        createNode("Card", "card-1", { tone: "surface", radius: "xl" }, [
          createNode("Heading", "heading-1", { text: "Welcome to Prynt", size: "2xl" }),
          createNode("Text", "text-1", { text: "Create your first project in under a minute." }),
          createNode("Button", "btn-1", { text: "Continue", tone: "primary", size: "md", minHeight: 44 })
        ]),
        createNode("List", "list-1", {}, [
          createNode("ListItem", "li-1", { title: "Create workspace", subtitle: "Set team and brand defaults" }),
          createNode("ListItem", "li-2", { title: "Pick templates", subtitle: "Start from best-practice screens" }),
          createNode("ListItem", "li-3", { title: "Generate with AI", subtitle: "Prompt and iterate" })
        ])
      ])
    };
  }

  if (templateId === "ecommerce-home") {
    return {
      schemaVersion: "1.0.0",
      docId: fileId,
      version: nowVersion,
      root: createTemplateRoot("Shop", [
        createNode("SearchBar", "search-1", { placeholder: "Search products", minHeight: 44 }),
        createNode("Grid", "grid-1", { columns: 2, gap: "md" }, [
          createNode("Card", "cat-1", { tone: "surface", radius: "lg" }, [createNode("Heading", "h1", { text: "Apparel", size: "lg" })]),
          createNode("Card", "cat-2", { tone: "surface", radius: "lg" }, [createNode("Heading", "h2", { text: "Accessories", size: "lg" })])
        ]),
        createNode("List", "list-1", {}, [
          createNode("ListItem", "p1", { title: "Classic Tee", subtitle: "$29" }),
          createNode("ListItem", "p2", { title: "Urban Cap", subtitle: "$19" })
        ])
      ])
    };
  }

  if (templateId === "form-heavy") {
    return {
      schemaVersion: "1.0.0",
      docId: fileId,
      version: nowVersion,
      root: createTemplateRoot("Workspace Setup", [
        createNode("Form", "form-1", { title: "Project Setup" }, [
          createNode("TextField", "name-1", { label: "Project Name", placeholder: "Acme Revamp", minHeight: 44 }),
          createNode("Select", "sel-1", { label: "Industry", options: "SaaS|E-commerce|Healthcare" }),
          createNode("RadioGroup", "rg-1", { label: "Target Platform", options: "Mobile|Web|Both" }),
          createNode("TextArea", "ta-1", { placeholder: "Describe your objectives", rows: 5 }),
          createNode("Button", "btn-1", { text: "Save and Continue", tone: "primary", size: "lg", minHeight: 48 })
        ])
      ], false)
    };
  }

  return {
    schemaVersion: "1.0.0",
    docId: fileId,
    version: nowVersion,
    root: createTemplateRoot("Dashboard", buildDashboardStack().children)
  };
}
