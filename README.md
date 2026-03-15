# Prynt - Prompt-Native UX Editor Foundation

This repository now contains a production-fit foundation for a prompt-native UX design editor where edits are not prompt-only.

## Implemented Architecture

- Monorepo (`apps/*`, `packages/*`)
- Canonical source of truth: `DocumentAst` JSON
- Unified edit pipeline: `PatchOps -> Validate -> (Repair) -> Apply`
- Multi-mode editing support (prompt, visual, inspector, structure, source, patch)
- Mobile-first constraints in validator

## Workspace Layout

- `apps/api`: in-memory API service with patch/validate/repair flows
- `apps/web`: editor engine/state model for multi-modal editing
- `packages/ast`: AST contracts + traversal + cloning
- `packages/dsl`: AST -> DSL serializer and bootstrap DSL parser
- `packages/patches`: reversible patch application engine
- `packages/validator`: schema + child + token + mobile rule validation
- `packages/repair`: automatic repair patch planning
- `packages/tokens`: design token definitions and validation helpers
- `packages/component-registry`: typed component contracts and child rules
- `packages/core`: unified edit pipeline orchestration

## Key Flows

- Prompt edits -> patch ops -> shared pipeline
- Visual/inspector/source edits -> patch ops -> same pipeline
- Invalid edits -> repair suggestions + generated repair patch candidates
- Undo/redo powered by inverse patch generation

## Scripts

- `npm run typecheck`
- `npm run build`

## Notes

- This is a foundation slice designed for safe iteration.
- Persistence is currently in-memory at API layer.
- DSL parser is intentionally minimal in this first pass and should be expanded in the next milestone.
