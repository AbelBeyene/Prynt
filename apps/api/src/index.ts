import type { DocumentAst } from "@prynt/ast";
import { runEditPipeline } from "@prynt/core";
import type { PatchOp } from "@prynt/patches";
import { buildRepairPlan } from "@prynt/repair";
import { suggestRepairs, validateDocument } from "@prynt/validator";

export interface ProjectState {
  document: DocumentAst;
  history: DocumentAst[];
  patchHistory: PatchOp[][];
}

export interface ApplyPatchRequest {
  patches: PatchOp[];
}

export interface ApplyPatchResponse {
  applied: boolean;
  document: DocumentAst;
  validationIssues: ReturnType<typeof validateDocument>["issues"];
  repairSuggestions: string[];
}

export interface ValidateRequest {
  document: DocumentAst;
}

export interface RepairSuggestRequest {
  document: DocumentAst;
}

export interface RepairApplyResponse {
  applied: boolean;
  generatedPatches: PatchOp[];
  document: DocumentAst;
  validationIssues: ReturnType<typeof validateDocument>["issues"];
}

export class EditorApiService {
  private readonly projects = new Map<string, ProjectState>();

  createProject(projectId: string, initialDocument: DocumentAst): void {
    this.projects.set(projectId, {
      document: initialDocument,
      history: [initialDocument],
      patchHistory: []
    });
  }

  applyPatch(projectId: string, request: ApplyPatchRequest): ApplyPatchResponse {
    const project = this.requireProject(projectId);
    const result = runEditPipeline(project.document, request.patches);

    if (!result.applied) {
      return {
        applied: false,
        document: project.document,
        validationIssues: result.validation.issues,
        repairSuggestions: result.repairSuggestions
      };
    }

    project.document = {
      ...result.document,
      version: project.document.version + 1
    };
    project.history.push(project.document);
    project.patchHistory.push(request.patches);

    return {
      applied: true,
      document: project.document,
      validationIssues: [],
      repairSuggestions: []
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

  repairApply(projectId: string): RepairApplyResponse {
    const project = this.requireProject(projectId);
    const plan = buildRepairPlan(project.document);

    if (plan.patches.length === 0) {
      const validation = validateDocument(project.document);
      return {
        applied: false,
        generatedPatches: [],
        document: project.document,
        validationIssues: validation.issues
      };
    }

    const result = runEditPipeline(project.document, plan.patches);
    if (!result.applied) {
      return {
        applied: false,
        generatedPatches: plan.patches,
        document: project.document,
        validationIssues: result.validation.issues
      };
    }

    project.document = {
      ...result.document,
      version: project.document.version + 1
    };
    project.history.push(project.document);
    project.patchHistory.push(plan.patches);

    return {
      applied: true,
      generatedPatches: plan.patches,
      document: project.document,
      validationIssues: []
    };
  }

  private requireProject(projectId: string): ProjectState {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }
}

export function buildStubInitialDocument(projectId: string): DocumentAst {
  return {
    schemaVersion: "1.0.0",
    docId: projectId,
    version: 1,
    root: {
      id: "screen-root",
      type: "Screen",
      props: { title: "Home" },
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
