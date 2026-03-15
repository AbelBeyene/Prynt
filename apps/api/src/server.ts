import cors from "cors";
import express from "express";
import { buildStubInitialDocument, EditorApiService } from "./index.js";

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
  const project = api.createProject(projectId, document);
  res.status(201).json({
    projectId,
    document: project.document,
    versions: project.versions
  });
});

app.get("/projects/:projectId", (req, res) => {
  try {
    const project = api.getProject(req.params.projectId);
    res.json({
      projectId: req.params.projectId,
      document: project.document,
      versions: project.versions
    });
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
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

app.post("/projects/:projectId/prompt", (req, res) => {
  try {
    const response = api.generateFromPrompt(req.params.projectId, req.body);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/undo", (req, res) => {
  try {
    const response = api.undo(req.params.projectId);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/redo", (req, res) => {
  try {
    const response = api.redo(req.params.projectId);
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
    const response = api.repairApply(req.params.projectId);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/projects/:projectId/versions", (req, res) => {
  try {
    const versions = api.listVersions(req.params.projectId);
    res.json({ versions });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.get("/projects/:projectId/dsl", (req, res) => {
  try {
    const dsl = api.getDsl(req.params.projectId);
    res.json({ dsl });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/projects/:projectId/versions/:versionId/restore", (req, res) => {
  try {
    const versionId = Number(req.params.versionId);
    const response = api.restoreVersion(req.params.projectId, versionId);
    res.json(response);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`Prynt API listening on http://localhost:${PORT}`);
});
