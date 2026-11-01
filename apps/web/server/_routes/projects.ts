import { Hono } from "hono";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../_lib/db/client.js";
import { body, database, project, type Env } from "../_lib/http.js";
import { audit, latestArtifacts, loadContext, projectUnknowns } from "../_lib/store.js";
import { addDemoShipping, seedDemo, simulateLaborChange } from "../_lib/seed.js";
import { buildExport } from "../_lib/export.js";
import { assertProjectQuota, rateLimit } from "../_lib/limits.js";
import { deletePrefix, storageEnabled } from "../_lib/storage.js";

const { projects, artifacts, auditEvents } = schema;
const app = new Hono<Env>();

const input = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).optional() });

app.get("/", async (c) => {
  const db = await database();
  const user = c.get("user");
  const rows = await db.select().from(projects).where(eq(projects.organizationId, user.orgId)).orderBy(desc(projects.updatedAt));
  const counts = rows.length
    ? await db.select({ projectId: artifacts.projectId, n: sql<number>`count(distinct ${artifacts.filename})::int` }).from(artifacts).where(inArray(artifacts.projectId, rows.map((r) => r.id))).groupBy(artifacts.projectId)
    : [];
  const unknowns = new Map<string, number>();
  for (const r of rows) {
    const arts = await latestArtifacts(db, r.id);
    if (!arts.length) continue;
    const ctx = await loadContext(db, r.id);
    unknowns.set(r.id, projectUnknowns(ctx, new Map(arts.map((a) => [a.id, a.warnings]))).filter((u) => u.status === "Unresolved").length);
  }
  return c.json({ projects: rows.map((r) => ({ ...r, files: counts.find((x) => x.projectId === r.id)?.n ?? 0, unresolved: unknowns.get(r.id) ?? 0 })) });
});

app.post("/", async (c) => {
  const db = await database();
  const user = c.get("user");
  const v = await body(c, input);
  await assertProjectQuota(db, user);
  const [p] = await db.insert(projects).values({ organizationId: user.orgId, name: v.name, description: v.description ?? "" }).returning();
  await audit(db, user, { projectId: p.id, action: "project.create", objectType: "project", objectId: p.id, summary: `Created project "${p.name}"` });
  return c.json({ project: p }, 201);
});

/** Opens (creating if needed) the walkthrough project in this workspace. */
app.post("/demo", async (c) => {
  const db = await database();
  await rateLimit(db, c, "demo-org", c.get("user").orgId, 10, 3600);
  return c.json({ projectId: await seedDemo(db, c.get("user")) });
});

app.get("/:projectId", async (c) => {
  const { db, p } = await project(c);
  const arts = await latestArtifacts(db, p.id);
  const ctx = await loadContext(db, p.id);
  const unknowns = projectUnknowns(ctx, new Map(arts.map((a) => [a.id, a.warnings])));
  return c.json({ project: p, unknowns, fileCount: arts.length });
});

app.patch("/:projectId", async (c) => {
  const { db, p, user } = await project(c);
  const v = await body(c, input.partial());
  const [u] = await db.update(projects).set({ ...v, updatedAt: new Date() }).where(eq(projects.id, p.id)).returning();
  await audit(db, user, { projectId: p.id, action: "project.update", objectType: "project", objectId: p.id, summary: `Updated project "${u.name}"`, payload: v });
  return c.json({ project: u });
});

app.delete("/:projectId", async (c) => {
  const { db, p, user } = await project(c);
  if (storageEnabled()) await deletePrefix(`${p.id}/`).catch((e) => console.error("object cleanup failed", e));
  await db.delete(projects).where(eq(projects.id, p.id));
  // project-scoped audit rows cascade; keep a workspace-level record that it happened
  await audit(db, user, { action: "project.delete", objectType: "project", objectId: p.id, summary: `Deleted project "${p.name}"` });
  return c.json({ ok: true });
});

app.get("/:projectId/audit", async (c) => {
  const { db, p } = await project(c);
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.projectId, p.id)).orderBy(desc(auditEvents.createdAt)).limit(200);
  return c.json({ events: rows });
});

app.get("/:projectId/export", async (c) => {
  const { db, p, user } = await project(c);
  const format = c.req.query("format") === "json" ? "json" : "md";
  const out = await buildExport(db, p);
  await audit(db, user, { projectId: p.id, action: "export.create", objectType: "project", objectId: p.id, summary: `Exported ${format.toUpperCase()}${out.incomplete ? " (INCOMPLETE)" : ""}` });
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  c.header("Content-Disposition", `attachment; filename="${slug}-runbook.${format}"`);
  return format === "json" ? c.json(out.json) : c.text(out.markdown, 200, { "Content-Type": "text/markdown; charset=utf-8" });
});

// walkthrough helpers: only meaningful for the demo project
app.post("/:projectId/demo/shipping", async (c) => {
  const { db, p, user } = await project(c);
  if (!p.isDemo) return c.json({ error: "Not a walkthrough project" }, 400);
  await addDemoShipping(db, user, p.id);
  return c.json({ ok: true });
});

app.post("/:projectId/demo/simulate-change", async (c) => {
  const { db, p, user } = await project(c);
  if (!p.isDemo) return c.json({ error: "Not a walkthrough project" }, 400);
  await simulateLaborChange(db, user, p.id);
  await audit(db, user, { projectId: p.id, action: "demo.simulate", objectType: "project", objectId: p.id, summary: "Simulated labour rate change 150 → 175 (re-saved 4 workbooks)" });
  return c.json({ ok: true });
});

export default app;
