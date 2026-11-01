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
import cron from "./_routes/cron.js";

const app = new Hono<Env>().basePath("/api");

// every response carries a request id the user can quote; errors are logged with it
app.use("*", async (c, next) => {
  const id = c.req.header("x-vercel-id") ?? crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/cron", cron);
app.route("/auth", auth);

app.use("/projects/*", requireAuth);
app.use("/projects", requireAuth);
for (const r of [projects, files, lineage, workflow, tests]) app.route("/projects", r);

// RFC 9457-style problem responses
app.onError((err, c) => {
  const requestId = c.get("requestId");
  const problem = (status: number, code: string, detail: string) =>
    c.json({ type: "about:blank", title: code, status, code, detail, requestId }, status as 400, { "Content-Type": "application/problem+json" });
  if (err instanceof ImportError) return problem(422, err.code, err.message);
  if (err instanceof HTTPException) {
    const m = /^([A-Z_]{4,}):\s*(.*)$/.exec(err.message);
    return problem(err.status, m?.[1] ?? `HTTP_${err.status}`, m?.[2] ?? err.message);
  }
  // one JSON line per failure: searchable by requestId, no request bodies or secrets
  const chain: { name: string; message: string; code?: string }[] = [];
  for (let e: any = err, i = 0; e && i < 4; e = e.cause, i++) chain.push({ name: e.name, message: String(e.message).slice(0, 300), code: e.code });
  let user: string | undefined;
  try { user = c.get("user")?.id; } catch { /* not authenticated */ }
  console.error(JSON.stringify({ level: "error", requestId, method: c.req.method, path: new URL(c.req.url).pathname, user, chain, stack: String((err as Error).stack ?? "").split("\n").slice(0, 6) }));
  return problem(500, "INTERNAL_ERROR", `Something went wrong on our side. Quote request ${requestId} if you report it.`);
});
app.notFound((c) => c.json({ type: "about:blank", title: "NOT_FOUND", status: 404, code: "NOT_FOUND", detail: "No such route", requestId: c.get("requestId") }, 404));

export default app;
