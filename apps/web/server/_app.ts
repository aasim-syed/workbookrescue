import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ImportError } from "./_lib/core/types.js";
import { requireAuth } from "./_lib/auth.js";
import type { Env } from "./_lib/http.js";
import auth from "./_routes/auth.js";
import projects from "./_routes/projects.js";
import files from "./_routes/files.js";
import lineage from "./_routes/lineage.js";
import workflow from "./_routes/workflow.js";
import tests from "./_routes/tests.js";

const app = new Hono<Env>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.route("/auth", auth);

app.use("/projects/*", requireAuth);
app.use("/projects", requireAuth);
for (const r of [projects, files, lineage, workflow, tests]) app.route("/projects", r);

// RFC 9457-style problem responses
app.onError((err, c) => {
  const problem = (status: number, code: string, detail: string) =>
    c.json({ type: "about:blank", title: code, status, code, detail }, status as 400, { "Content-Type": "application/problem+json" });
  if (err instanceof ImportError) return problem(422, err.code, err.message);
  if (err instanceof HTTPException) {
    const m = /^([A-Z_]{4,}):\s*(.*)$/.exec(err.message);
    return problem(err.status, m?.[1] ?? `HTTP_${err.status}`, m?.[2] ?? err.message);
  }
  console.error(err);
  return problem(500, "INTERNAL_ERROR", "Something went wrong on our side");
});
app.notFound((c) => c.json({ type: "about:blank", title: "NOT_FOUND", status: 404, code: "NOT_FOUND", detail: "No such route" }, 404));

export default app;
