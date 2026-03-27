import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import { buildStubInitialDocument, EditorApiService } from "./index.js";

function loadLocalAiEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps/api/.env.local"),
    path.resolve(process.cwd(), "apps/api/.env"),
    process.env.PRYNT_AI_ENV_PATH,
    "/Users/abel/Documents/Projects/Adaptmycv/.env.local",
    path.resolve(process.cwd(), "../Adaptmycv/.env.local"),
    path.resolve(process.cwd(), "../../Adaptmycv/.env.local")
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const envPath of candidates) {
    if (!existsSync(envPath)) {
      continue;
    }
    dotenv.config({ path: envPath, override: false });
    break;
  }
}

loadLocalAiEnv();

const app = express();
const api = new EditorApiService();
const PORT = Number(process.env.PORT ?? 4000);
const metrics = {
  requestsTotal: 0,
  requestsError: 0,
  promptRequests: 0,
  promptRejected: 0
};
const promptRate = new Map<string, { windowStart: number; count: number }>();
const projectPromptRate = new Map<string, { windowStart: number; count: number }>();
const PROMPT_WINDOW_MS = 60_000;
const PROMPT_MAX_PER_WINDOW = 60;
const PROJECT_PROMPT_MAX_PER_WINDOW = 180;

class ApiError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

function requestId(): string {
  return `req_${Math.random().toString(36).slice(2, 10)}`;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof Error && /not found/i.test(error.message)) {
    return new ApiError(error.message, 404);
  }
  return new ApiError(error instanceof Error ? error.message : "Unexpected server error", 400);
}

function route(handler: (req: Request, res: Response) => Promise<void> | void) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

function sanitizePrompt(raw: unknown): string {
  const prompt = String(raw ?? "").trim();
  if (!prompt) {
    throw new ApiError("Prompt cannot be empty.", 400);
  }
  if (prompt.length > 4000) {
    throw new ApiError("Prompt is too long (max 4000 characters).", 400);
  }
  if (/<script|<\/script>|javascript:/i.test(prompt)) {
    throw new ApiError("Prompt contains unsafe content.", 400);
  }
  return prompt;
}

function enforcePromptRateLimit(ip: string): void {
  const now = Date.now();
  const bucket = promptRate.get(ip);
  if (!bucket || now - bucket.windowStart > PROMPT_WINDOW_MS) {
    promptRate.set(ip, { windowStart: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > PROMPT_MAX_PER_WINDOW) {
    throw new ApiError("Rate limit exceeded for prompt operations. Try again in one minute.", 429);
  }
}

function enforceProjectPromptRateLimit(projectId: string, ip: string): void {
  const key = `${projectId}:${ip}`;
  const now = Date.now();
  const bucket = projectPromptRate.get(key);
  if (!bucket || now - bucket.windowStart > PROMPT_WINDOW_MS) {
    projectPromptRate.set(key, { windowStart: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > PROJECT_PROMPT_MAX_PER_WINDOW) {
    throw new ApiError("Rate limit exceeded for this project prompt stream. Try again in one minute.", 429);
  }
}

function audit(event: string, payload: Record<string, unknown>): void {
  console.log(`[AUDIT] ${JSON.stringify({ event, at: new Date().toISOString(), ...payload })}`);
}

const allowedOrigins = (process.env.PRYNT_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS origin blocked."));
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const started = Date.now();
  const id = requestId();
  metrics.requestsTotal += 1;
  res.setHeader("x-request-id", id);
  res.locals.requestId = id;
  res.on("finish", () => {
    const ms = Date.now() - started;
    const line = `[${new Date().toISOString()}] ${id} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`;
    if (res.statusCode >= 500) {
      console.error(line);
    } else {
      console.log(line);
    }
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "prynt-api" });
});

app.get("/metrics", (_req, res) => {
  res.json({
    ok: true,
    metrics: {
      ...metrics,
      uptimeSec: Math.round(process.uptime())
    }
  });
});

app.get("/projects", route((_req, res) => {
  res.json({ projects: api.listProjects() });
}));

app.post("/projects", route((req, res) => {
  const projectId = String(req.body?.projectId ?? `project-${Date.now()}`);
  const document = buildStubInitialDocument(projectId);
  api.createProject(projectId, document);

  res.status(201).json({
    projectId,
    files: api.listFiles(projectId),
    versions: api.listVersions(projectId)
  });
}));

app.get("/projects/:projectId", route((req, res) => {
  res.json({
    projectId: req.params.projectId!,
    files: api.listFiles(req.params.projectId!)
  });
}));

app.get("/projects/:projectId/files", route((req, res) => {
  res.json({ files: api.listFiles(req.params.projectId!) });
}));

app.post("/projects/:projectId/files", route((req, res) => {
  const file = api.createFile(req.params.projectId!, req.body ?? {});
  res.status(201).json(file);
}));

app.post("/projects/:projectId/files/:fileId/duplicate", route((req, res) => {
  const file = api.duplicateFile(req.params.projectId!, req.params.fileId!, req.body ?? {});
  res.status(201).json(file);
}));

app.delete("/projects/:projectId/files/:fileId", route((req, res) => {
  const response = api.deleteFile(req.params.projectId!, req.params.fileId!);
  res.json(response);
}));

app.patch("/projects/:projectId/files/:fileId", route((req, res) => {
  const file = api.renameFile(req.params.projectId!, req.params.fileId!, req.body);
  res.json(file);
}));

app.post("/projects/:projectId/patch", route((req, res) => {
  const response = api.applyPatch(req.params.projectId!, req.body);
  res.json(response);
}));

app.post("/projects/:projectId/patch/preview", route((req, res) => {
  const response = api.previewPatch(req.params.projectId!, req.body);
  res.json(response);
}));

app.post("/projects/:projectId/prompt", route(async (req, res) => {
  enforcePromptRateLimit(req.ip || "unknown");
  enforceProjectPromptRateLimit(req.params.projectId!, req.ip || "unknown");
  metrics.promptRequests += 1;
  try {
    req.body.prompt = sanitizePrompt(req.body?.prompt);
  } catch (error) {
    metrics.promptRejected += 1;
    throw error;
  }
  const response = await api.generateFromPrompt(req.params.projectId!, req.body);
  audit("prompt_apply", {
    requestId: res.locals.requestId,
    projectId: req.params.projectId,
    fileId: req.body?.fileId,
    promptChars: String(req.body?.prompt ?? "").length
  });
  res.json(response);
}));

app.post("/projects/:projectId/prompt/simulate", route(async (req, res) => {
  enforcePromptRateLimit(req.ip || "unknown");
  enforceProjectPromptRateLimit(req.params.projectId!, req.ip || "unknown");
  metrics.promptRequests += 1;
  try {
    req.body.prompt = sanitizePrompt(req.body?.prompt);
  } catch (error) {
    metrics.promptRejected += 1;
    throw error;
  }
  const response = await api.simulatePrompt(req.params.projectId!, req.body);
  audit("prompt_simulate", {
    requestId: res.locals.requestId,
    projectId: req.params.projectId,
    fileId: req.body?.fileId,
    promptChars: String(req.body?.prompt ?? "").length
  });
  res.json(response);
}));

app.post("/projects/:projectId/prompt/batch", route(async (req, res) => {
  enforcePromptRateLimit(req.ip || "unknown");
  enforceProjectPromptRateLimit(req.params.projectId!, req.ip || "unknown");
  metrics.promptRequests += 1;
  try {
    req.body.prompt = sanitizePrompt(req.body?.prompt);
  } catch (error) {
    metrics.promptRejected += 1;
    throw error;
  }
  const response = await api.generateBatchFromPrompt(req.params.projectId!, req.body);
  audit("prompt_batch_apply", {
    requestId: res.locals.requestId,
    projectId: req.params.projectId,
    fileId: req.body?.fileId,
    nodeCount: Array.isArray(req.body?.selectedNodeIds) ? req.body.selectedNodeIds.length : 0
  });
  res.json(response);
}));

app.get("/projects/:projectId/prompt/history", route((req, res) => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 24;
  const query = typeof req.query.query === "string" ? req.query.query : "";
  const items = api.listPromptHistory(req.params.projectId!, Number.isFinite(limit) ? limit : 24, query);
  res.json({ items });
}));

app.get("/projects/:projectId/prompt/suggestions", route((req, res) => {
  const query = typeof req.query.query === "string" ? req.query.query : "";
  const fileId = typeof req.query.fileId === "string" ? req.query.fileId : undefined;
  const items = api.suggestPrompts(req.params.projectId!, fileId, query);
  res.json({ items });
}));

app.get("/templates", route((_req, res) => {
  res.json({ templates: api.listTemplates() });
}));

app.get("/components/blueprints", route((req, res) => {
  const query = typeof req.query.query === "string" ? req.query.query : "";
  res.json({ items: api.listComponentBlueprints(query) });
}));

app.post("/projects/:projectId/components/instantiate", route((req, res) => {
  const response = api.instantiateComponentBlueprint(req.params.projectId!, req.body);
  res.json(response);
}));

app.post("/projects/:projectId/templates/apply", route((req, res) => {
  const file = api.applyTemplate(req.params.projectId!, req.body);
  res.json(file);
}));

app.post("/projects/:projectId/intent", route((req, res) => {
  const intent = api.parseIntent(req.params.projectId!, String(req.body?.prompt ?? ""), req.body?.fileId);
  res.json(intent);
}));

app.post("/projects/:projectId/undo", route((req, res) => {
  const response = api.undo(req.params.projectId!, req.body?.fileId);
  res.json(response);
}));

app.post("/projects/:projectId/redo", route((req, res) => {
  const response = api.redo(req.params.projectId!, req.body?.fileId);
  res.json(response);
}));

app.post("/projects/:projectId/repair/suggest", route((req, res) => {
  const response = api.repairSuggest({ document: req.body.document });
  res.json(response);
}));

app.post("/projects/:projectId/repair/apply", route((req, res) => {
  const response = api.repairApply(req.params.projectId!, req.body?.fileId);
  res.json(response);
}));

app.get("/projects/:projectId/versions", route((req, res) => {
  const fileId = typeof req.query.fileId === "string" ? req.query.fileId : undefined;
  const versions = api.listVersions(req.params.projectId!, fileId);
  res.json({ versions });
}));

app.get("/projects/:projectId/dsl", route((req, res) => {
  const fileId = typeof req.query.fileId === "string" ? req.query.fileId : undefined;
  const dsl = api.getDsl(req.params.projectId!, fileId);
  res.json({ dsl });
}));

app.get("/projects/:projectId/export", route((req, res) => {
  const fileId = typeof req.query.fileId === "string" ? req.query.fileId : undefined;
  const format = typeof req.query.format === "string" ? req.query.format : "json";
  if (!["json", "dsl", "react", "schema"].includes(format)) {
    throw new ApiError("Invalid export format.", 400);
  }
  const exported = api.exportFile(req.params.projectId!, fileId, format as "json" | "dsl" | "react" | "schema");
  res.json(exported);
}));

app.post("/projects/:projectId/versions/:versionId/restore", route((req, res) => {
  const versionId = Number(req.params.versionId);
  const response = api.restoreVersion(req.params.projectId!, versionId, req.body?.fileId);
  res.json(response);
}));

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  metrics.requestsError += 1;
  const apiError = toApiError(error);
  res.status(apiError.statusCode).json({
    error: apiError.message,
    requestId: res.locals.requestId ?? "unknown",
    path: req.originalUrl
  });
});

app.listen(PORT, () => {
  console.log(`Prynt API listening on http://localhost:${PORT}`);
});
