import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { buildStubInitialDocument, EditorApiService } from "./index.js";

function loadLocalAiEnv(): void {
  const candidates = [
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

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "prynt-api" });
});

app.post("/projects", (req, res) => {
  const projectId = String(req.body?.projectId ?? `project-${Date.now()}`);
  const document = buildStubInitialDocument(projectId);
  api.createProject(projectId, document);

  res.status(201).json({
    projectId,
    files: api.listFiles(projectId),
    versions: api.listVersions(projectId)
  });
});

app.get("/projects/:projectId", (req, res) => {
  try {
    res.json({
      projectId: req.params.projectId,
      files: api.listFiles(req.params.projectId)
    });
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

app.get("/projects/:projectId/files", (req, res) => {
  try {
    res.json({ files: api.listFiles(req.params.projectId) });
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/files", (req, res) => {
  try {
    const file = api.createFile(req.params.projectId, req.body ?? {});
    res.status(201).json(file);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/patch", (req, res) => {
  try {
    const response = api.applyPatch(req.params.projectId, req.body);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/patch/preview", (req, res) => {
  try {
    const response = api.previewPatch(req.params.projectId, req.body);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/prompt", async (req, res) => {
  try {
    const response = await api.generateFromPrompt(req.params.projectId, req.body);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/undo", (req, res) => {
  try {
    const response = api.undo(req.params.projectId, req.body?.fileId);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/redo", (req, res) => {
  try {
    const response = api.redo(req.params.projectId, req.body?.fileId);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/repair/suggest", (req, res) => {
  try {
    const response = api.repairSuggest({ document: req.body.document });
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/repair/apply", (req, res) => {
  try {
    const response = api.repairApply(req.params.projectId, req.body?.fileId);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/projects/:projectId/versions", (req, res) => {
  try {
    const fileId = typeof req.query.fileId === "string" ? req.query.fileId : undefined;
    const versions = api.listVersions(req.params.projectId, fileId);
    res.json({ versions });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/projects/:projectId/dsl", (req, res) => {
  try {
    const fileId = typeof req.query.fileId === "string" ? req.query.fileId : undefined;
    const dsl = api.getDsl(req.params.projectId, fileId);
    res.json({ dsl });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/versions/:versionId/restore", (req, res) => {
  try {
    const versionId = Number(req.params.versionId);
    const response = api.restoreVersion(req.params.projectId, versionId, req.body?.fileId);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`Prynt API listening on http://localhost:${PORT}`);
});
