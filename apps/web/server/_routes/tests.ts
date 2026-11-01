import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../_lib/db/client.js";
import { body, project, type Env } from "../_lib/http.js";
import { overall, runAssertions, type AssertionSpec } from "../_lib/core/compare.js";
import { audit, latestArtifacts, loadContext, touchProject, type Manifest } from "../_lib/store.js";

const { baselines, assertions, testRuns } = schema;
const app = new Hono<Env>();

const assertionInput = z.object({
  filename: z.string().min(1), sheet: z.string().min(1), address: z.string().min(1).transform((s) => s.toUpperCase()),
  mode: z.enum(["number", "string", "nonblank"]).default("number"),
  expected: z.string().max(100).nullish(), absTolerance: z.string().max(30).nullish(),
});
const baselineInput = z.object({
  name: z.string().trim().min(1).max(120), notes: z.string().max(500).optional(),
  approve: z.boolean().default(false),
  assertions: z.array(assertionInput).min(1).max(50),
});

async function owned(c: Parameters<typeof project>[0]) {
  const ctx = await project(c);
  const [b] = await ctx.db.select().from(baselines).where(and(eq(baselines.id, c.req.param("baselineId")!), eq(baselines.projectId, ctx.p.id)));
  if (!b) throw new HTTPException(404, { message: "Baseline not found" });
  return { ...ctx, b };
}

app.get("/:projectId/baselines", async (c) => {
  const { db, p } = await project(c);
  const rows = await db.select().from(baselines).where(eq(baselines.projectId, p.id)).orderBy(desc(baselines.createdAt));
  const ids = rows.map((r) => r.id);
  const asserts = ids.length ? await db.select().from(assertions).where(inArray(assertions.baselineId, ids)) : [];
  const runs = ids.length ? await db.select().from(testRuns).where(inArray(testRuns.baselineId, ids)).orderBy(desc(testRuns.createdAt)) : [];
  return c.json({
    baselines: rows.map((b) => ({ ...b, assertions: asserts.filter((a) => a.baselineId === b.id), runs: runs.filter((r) => r.baselineId === b.id).slice(0, 10) })),
  });
});

/** Captures the current saved values as the customer-approved golden outputs and pins the exact file versions. */
app.post("/:projectId/baselines", async (c) => {
  const { db, p, user } = await project(c);
  const v = await body(c, baselineInput);
  const ctx = await loadContext(db, p.id);
  const specs = v.assertions.map((a) => {
    const id = ctx.byFilename.get(a.filename);
    const cell = id ? ctx.artifacts.get(id)!.cells.get(`${a.sheet}!${a.address}`) : undefined;
    if (!cell) throw new HTTPException(400, { message: `${a.filename}::${a.sheet}!${a.address} has no value to baseline` });
    const expected = a.expected ?? (cell.cached === null ? null : String(cell.cached));
    if (a.mode !== "nonblank" && expected === null) throw new HTTPException(400, { message: `${a.filename}::${a.address} has no saved result, so there is nothing to capture` });
    return { ...a, expected: a.mode === "nonblank" ? null : expected, absTolerance: a.mode === "number" ? (a.absTolerance ?? "0.01") : null };
  });
  const manifest: Manifest = (await latestArtifacts(db, p.id)).map((a) => ({ filename: a.filename, artifactId: a.id, sha256: a.sha256, version: a.version }));
  const [b] = await db.insert(baselines).values({
    projectId: p.id, name: v.name, notes: v.notes ?? "", manifest, createdBy: user.id,
    approvalStatus: v.approve ? "approved" : "pending", approvedBy: v.approve ? user.id : null, approvedAt: v.approve ? new Date() : null,
  }).returning();
  await db.insert(assertions).values(specs.map((s) => ({ baselineId: b.id, filename: s.filename, sheet: s.sheet, address: s.address, mode: s.mode, expected: s.expected, absTolerance: s.absTolerance })));
  await audit(db, user, { projectId: p.id, action: "baseline.create", objectType: "baseline", objectId: b.id, summary: `Created baseline "${b.name}" (${specs.length} output${specs.length > 1 ? "s" : ""})${v.approve ? ", approved" : ""}`, payload: { manifest, specs } });
  await touchProject(db, p.id);
  return c.json({ baseline: b }, 201);
});

app.post("/:projectId/baselines/:baselineId/approve", async (c) => {
  const { db, p, user, b } = await owned(c);
  await db.update(baselines).set({ approvalStatus: "approved", approvedBy: user.id, approvedAt: new Date() }).where(eq(baselines.id, b.id));
  await audit(db, user, { projectId: p.id, action: "baseline.approve", objectType: "baseline", objectId: b.id, summary: `Approved baseline "${b.name}"`, payload: { manifest: b.manifest } });
  return c.json({ ok: true });
});

app.delete("/:projectId/baselines/:baselineId", async (c) => {
  const { db, p, user, b } = await owned(c);
  await db.delete(baselines).where(eq(baselines.id, b.id));
  await audit(db, user, { projectId: p.id, action: "baseline.delete", objectType: "baseline", objectId: b.id, summary: `Deleted baseline "${b.name}"` });
  return c.json({ ok: true });
});

app.post("/:projectId/baselines/:baselineId/runs", async (c) => {
  const { db, p, user, b } = await owned(c);
  if (b.approvalStatus !== "approved") throw new HTTPException(409, { message: "BASELINE_NOT_APPROVED: approve this baseline before running it" });
  const specs = (await db.select().from(assertions).where(eq(assertions.baselineId, b.id))) as AssertionSpec[];
  const [baseline, current] = [await loadContext(db, p.id, b.manifest), await loadContext(db, p.id)];
  const results = runAssertions(baseline, current, specs);
  const status = overall(results);
  const manifest: Manifest = [...current.artifacts.values()].map((a) => ({ filename: a.filename, artifactId: a.id, sha256: "", version: a.version }));
  const [run] = await db.insert(testRuns).values({ baselineId: b.id, status, results, manifest, createdBy: user.id }).returning();
  await audit(db, user, { projectId: p.id, action: "test.run", objectType: "test_run", objectId: run.id, summary: `Ran "${b.name}": ${status}`, payload: { status, results } });
  return c.json({ run }, 201);
});

export default app;
