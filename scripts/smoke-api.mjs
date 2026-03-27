const base = process.env.PRYNT_API_URL || "http://localhost:4000";
const pid = `project-smoke-${Date.now()}`;

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body, text };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  let result;

  result = await request("/projects");
  assert(Array.isArray(result.body.projects), "Expected /projects to return a project list.");

  result = await request("/projects", { method: "POST", body: JSON.stringify({ projectId: pid }) });
  assert(result.response.status === 201, "Expected project creation to return 201.");
  assert(result.body.projectId === pid, "Project ID mismatch.");
  const file1 = result.body.files[0]?.fileId;
  assert(typeof file1 === "string", "Missing first file on project creation.");

  result = await request(`/projects/${pid}/files`, { method: "POST", body: JSON.stringify({ name: "Screen A", baseFileId: file1 }) });
  assert(result.response.status === 201, "Failed to create new file.");
  const file2 = result.body.fileId;
  assert(typeof file2 === "string", "Missing created fileId.");

  result = await request(`/projects/${pid}/files/${file2}/duplicate`, { method: "POST", body: JSON.stringify({ name: "Screen A Copy" }) });
  assert(result.response.status === 201, "Failed to duplicate file.");
  const file3 = result.body.fileId;

  result = await request("/templates");
  assert(Array.isArray(result.body.templates) && result.body.templates.length > 0, "Template list is empty.");
  const templateId = result.body.templates[0].id;

  result = await request("/components/blueprints");
  assert(Array.isArray(result.body.items) && result.body.items.length >= 110, "Blueprint list should contain at least 110 items.");
  const blueprintId = result.body.items[0]?.id;
  assert(typeof blueprintId === "string", "Blueprint list is missing id.");

  result = await request(`/projects/${pid}/templates/apply`, { method: "POST", body: JSON.stringify({ fileId: file2, templateId }) });
  assert(result.response.ok, "Failed to apply template.");

  result = await request(`/projects/${pid}/components/instantiate`, {
    method: "POST",
    body: JSON.stringify({ fileId: file2, parentId: "stack-1", blueprintId })
  });
  assert(result.response.ok && result.body.applied, "Blueprint instantiate failed.");

  result = await request(`/projects/${pid}/prompt/simulate`, {
    method: "POST",
    body: JSON.stringify({ fileId: file2, prompt: "Add a search bar above list" })
  });
  assert(result.response.ok, "Prompt simulation failed.");

  result = await request(`/projects/${pid}/prompt`, {
    method: "POST",
    body: JSON.stringify({ fileId: file2, prompt: "Add a search bar above list" })
  });
  assert(result.response.ok, "Prompt apply failed.");
  assert(Array.isArray(result.body.results) && result.body.results.length > 0, "Prompt apply produced no results.");

  result = await request(`/projects/${pid}/prompt/batch`, {
    method: "POST",
    body: JSON.stringify({ fileId: file2, prompt: "Make this section more premium", selectedNodeIds: ["screen-root"], selectedScope: "node" })
  });
  assert(result.response.ok, "Prompt batch apply failed.");
  assert(typeof result.body.appliedCount === "number", "Batch response missing appliedCount.");

  result = await request(`/projects/${pid}/prompt`, {
    method: "POST",
    body: JSON.stringify({ fileId: file2, prompt: "<script>alert(1)</script>" })
  });
  assert(result.response.status === 400, "Unsafe prompt should be rejected.");

  const patches = [{ opId: "smoke-1", type: "updateProps", targetId: "screen-root", props: { title: "Smoke Title" } }];
  result = await request(`/projects/${pid}/patch/preview`, {
    method: "POST",
    body: JSON.stringify({ fileId: file2, patches, reason: "smoke-preview" })
  });
  assert(result.response.ok, "Patch preview failed.");

  result = await request(`/projects/${pid}/patch`, {
    method: "POST",
    body: JSON.stringify({ fileId: file2, patches, reason: "smoke-apply" })
  });
  assert(result.response.ok && result.body.applied, "Patch apply failed.");

  result = await request(`/projects/${pid}/undo`, { method: "POST", body: JSON.stringify({ fileId: file2 }) });
  assert(result.response.ok, "Undo failed.");
  result = await request(`/projects/${pid}/redo`, { method: "POST", body: JSON.stringify({ fileId: file2 }) });
  assert(result.response.ok, "Redo failed.");

  result = await request(`/projects/${pid}/versions?fileId=${encodeURIComponent(file2)}`);
  assert(Array.isArray(result.body.versions) && result.body.versions.length > 0, "Versions list is empty.");
  const versionId = result.body.versions[0].id;

  result = await request(`/projects/${pid}/versions/${versionId}/restore`, { method: "POST", body: JSON.stringify({ fileId: file2 }) });
  assert(result.response.ok, "Version restore failed.");

  for (const format of ["json", "dsl", "react", "schema"]) {
    result = await request(`/projects/${pid}/export?fileId=${encodeURIComponent(file2)}&format=${format}`);
    assert(result.response.ok, `Export failed for ${format}.`);
    assert(typeof result.body.content === "string" && result.body.content.length > 0, `Export content empty for ${format}.`);
  }

  result = await request(`/projects/${pid}/files/${file3}`, { method: "DELETE" });
  assert(result.response.ok && result.body.deleted, "Delete file failed.");

  console.log(`SMOKE_OK ${pid}`);
}

run().catch((error) => {
  console.error(`SMOKE_FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
