import type { DocumentAst } from "@prynt/ast";
import { applyPatches, type PatchOp } from "@prynt/patches";
import { suggestRepairs, validateDocument, type ValidationResult } from "@prynt/validator";

export interface EditPipelineResult {
  document: DocumentAst;
  validation: ValidationResult;
  inversePatches: PatchOp[];
  applied: boolean;
  repairSuggestions: string[];
}

export function runEditPipeline(document: DocumentAst, patches: PatchOp[]): EditPipelineResult {
  const patched = applyPatches(document, patches);
  const validation = validateDocument(patched.document);

  return {
    document: patched.document,
    validation,
    inversePatches: patched.inversePatches,
    applied: validation.valid,
    repairSuggestions: suggestRepairs(validation.issues)
  };
}
