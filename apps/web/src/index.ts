import type { DocumentAst } from "@prynt/ast";
import { runEditPipeline } from "@prynt/core";
import type { PatchOp } from "@prynt/patches";

export type EditorMode = "prompt" | "visual" | "inspector" | "structure" | "source" | "patch";

export interface EditorState {
  mode: EditorMode;
  document: DocumentAst;
  selectedNodeId: string | null;
  undoStack: PatchOp[][];
  redoStack: PatchOp[][];
}

export class EditorEngine {
  private state: EditorState;

  constructor(initialDocument: DocumentAst) {
    this.state = {
      mode: "visual",
      document: initialDocument,
      selectedNodeId: null,
      undoStack: [],
      redoStack: []
    };
  }

  setMode(mode: EditorMode): void {
    this.state.mode = mode;
  }

  select(nodeId: string | null): void {
    this.state.selectedNodeId = nodeId;
  }

  applyUserChange(patches: PatchOp[]): { applied: boolean; issues: string[] } {
    const result = runEditPipeline(this.state.document, patches);
    if (!result.applied) {
      return {
        applied: false,
        issues: result.validation.issues.map((issue) => issue.message)
      };
    }

    this.state.document = {
      ...result.document,
      version: this.state.document.version + 1
    };
    this.state.undoStack.push(result.inversePatches);
    this.state.redoStack = [];
    return { applied: true, issues: [] };
  }

  applyPromptChange(patches: PatchOp[]): { applied: boolean; issues: string[] } {
    this.setMode("prompt");
    return this.applyUserChange(patches);
  }

  applyVisualChange(patches: PatchOp[]): { applied: boolean; issues: string[] } {
    this.setMode("visual");
    return this.applyUserChange(patches);
  }

  applyInspectorChange(patches: PatchOp[]): { applied: boolean; issues: string[] } {
    this.setMode("inspector");
    return this.applyUserChange(patches);
  }

  applySourceChange(patches: PatchOp[]): { applied: boolean; issues: string[] } {
    this.setMode("source");
    return this.applyUserChange(patches);
  }

  applyPatchConsoleChange(patches: PatchOp[]): { applied: boolean; issues: string[] } {
    this.setMode("patch");
    return this.applyUserChange(patches);
  }

  undo(): boolean {
    const inverse = this.state.undoStack.pop();
    if (!inverse) {
      return false;
    }
    const result = runEditPipeline(this.state.document, inverse);
    if (!result.applied) {
      return false;
    }
    this.state.document = {
      ...result.document,
      version: this.state.document.version + 1
    };
    this.state.redoStack.push(result.inversePatches);
    return true;
  }

  redo(): boolean {
    const redoPatches = this.state.redoStack.pop();
    if (!redoPatches) {
      return false;
    }

    const result = runEditPipeline(this.state.document, redoPatches);
    if (!result.applied) {
      return false;
    }

    this.state.document = {
      ...result.document,
      version: this.state.document.version + 1
    };
    this.state.undoStack.push(result.inversePatches);
    return true;
  }

  getState(): EditorState {
    return this.state;
  }
}
