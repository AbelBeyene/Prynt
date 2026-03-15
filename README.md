# Prynt: Prompt-Native UX Design Editor (Full-Stack MVP)

Prynt is a browser-based UX editor with a structured JSON AST source of truth, patch-based edits, validation gates, and a React canvas.

## What is implemented

- Prompt-native editing with deterministic patch operations.
- Multi-modal editing paths:
  - Prompt bar
  - Layer tree selection
  - Property inspector edits
  - Source inspection (JSON AST + DSL)
  - Patch console (preview + apply)
- Validation and repair pipeline before apply.
- Version history with restore.
- Undo/redo.
- Mobile device previews: iPhone (390), Android (360), Tablet (768).

## Architecture

- `apps/api`:
  - Express API
  - Project/document state management
  - Prompt-to-patch generation (deterministic MVP rules)
  - Patch apply/preview, repair suggest/apply, version restore
- `apps/web`:
  - React + Vite editor UI
  - Canvas renderer, layer tree, inspector, prompt controls
- `packages/*` shared domain modules:
  - `ast`, `patches`, `validator`, `repair`, `dsl`, `tokens`, `component-registry`, `core`

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start API + web app:

```bash
npm run dev
```

3. Open:
- Web: `http://localhost:5173`
- API health: `http://localhost:4000/health`

### Testing with local AI keys from another project

The API will automatically try loading env values from:
- `/Users/abel/Documents/Projects/Adaptmycv/.env.local`

Supported vars:
- `OPENROUTER_API_KEY` or `VITE_OPENROUTER_API_KEY`
- `OPENROUTER_API_URL` or `VITE_OPENROUTER_API_URL`
- `OPENROUTER_MODEL` or `VITE_OPENROUTER_MODEL`

Optional:
- `PRYNT_AI_ENV_PATH` to override env file path
- `PRYNT_AI_DEBUG=1` to log when rule fallback is used

## Build and typecheck

```bash
npm run typecheck
npm run build
```

## API endpoints (MVP)

- `POST /projects`
- `GET /projects/:projectId`
- `POST /projects/:projectId/prompt`
- `POST /projects/:projectId/patch`
- `POST /projects/:projectId/patch/preview`
- `POST /projects/:projectId/undo`
- `POST /projects/:projectId/redo`
- `POST /projects/:projectId/repair/suggest`
- `POST /projects/:projectId/repair/apply`
- `GET /projects/:projectId/versions`
- `POST /projects/:projectId/versions/:versionId/restore`
- `GET /projects/:projectId/dsl`

## Notes

- Current persistence is in-memory for speed of iteration.
- The prompt engine is deterministic/rule-based in this MVP; easy to replace with an LLM backend using the existing patch contract.
- Collaboration/CRDT and export pipelines are intentionally deferred until after this single-user MVP.
