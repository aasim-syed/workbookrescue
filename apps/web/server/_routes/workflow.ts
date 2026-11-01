import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../_lib/db/client.js";
import { body, project, type Env } from "../_lib/http.js";
import { audit, touchProject } from "../_lib/store.js";

const { steps } = schema;
const app = new Hono<Env>();

const opt = z.string().trim().max(200).nullish().transform((v) => v || null);
const stepInput = z.object({
  kind: z.enum(["manual_copy", "export_import", "override", "documented_handoff"]),
  instructions: z.string().trim().min(3).max(1000),
  ownerRole: z.string().trim().min(1, "Every human step needs an owner").max(100),
  evidence: z.string().trim().min(1, "Say how you know this happens").max(500),
  fromFilename: opt, fromSheet: opt, fromAddress: opt,
  toFilename: opt, toSheet: opt, toAddress: opt,
});

app.get("/:projectId/steps", async (c) => {
  const { db, p } = await project(c);
  return c.json({ steps: await db.select().from(steps).where(eq(steps.projectId, p.id)).orderBy(steps.ordinal) });
});

app.post("/:projectId/steps", async (c) => {
  const { db, p, user } = await project(c);
  const v = await body(c, stepInput);
  const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${steps.ordinal}), 0) + 1` }).from(steps).where(eq(steps.projectId, p.id));
  const [s] = await db.insert(steps).values({ projectId: p.id, ordinal: next, createdBy: user.id, ...v }).returning();
  await audit(db, user, { projectId: p.id, action: "step.create", objectType: "step", objectId: s.id, summary: `Declared step: ${s.instructions}`, payload: v });
  await touchProject(db, p.id);
  return c.json({ step: s }, 201);
});

app.patch("/:projectId/steps/:id", async (c) => {
  const { db, p, user } = await project(c);
  const v = await body(c, stepInput.partial().extend({ status: z.enum(["User-declared", "Verified"]).optional() }));
  const [s] = await db.update(steps).set(v).where(and(eq(steps.id, c.req.param("id")), eq(steps.projectId, p.id))).returning();
  if (!s) throw new HTTPException(404, { message: "Step not found" });
  await audit(db, user, { projectId: p.id, action: v.status ? `step.${v.status === "Verified" ? "confirm" : "unconfirm"}` : "step.update", objectType: "step", objectId: s.id, summary: v.status ? `${v.status === "Verified" ? "Confirmed" : "Unconfirmed"} step: ${s.instructions}` : `Updated step: ${s.instructions}`, payload: v });
  await touchProject(db, p.id);
  return c.json({ step: s });
});

app.post("/:projectId/steps/:id/move", async (c) => {
  const { db, p, user } = await project(c);
  const { direction } = await body(c, z.object({ direction: z.enum(["up", "down"]) }));
  const all = await db.select().from(steps).where(eq(steps.projectId, p.id)).orderBy(steps.ordinal);
  const i = all.findIndex((s) => s.id === c.req.param("id"));
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0) throw new HTTPException(404, { message: "Step not found" });
  if (j >= 0 && j < all.length) {
    await db.update(steps).set({ ordinal: all[j].ordinal }).where(eq(steps.id, all[i].id));
    await db.update(steps).set({ ordinal: all[i].ordinal }).where(eq(steps.id, all[j].id));
    await audit(db, user, { projectId: p.id, action: "step.reorder", objectType: "step", objectId: all[i].id, summary: `Moved step ${direction}: ${all[i].instructions}` });
  }
  return c.json({ ok: true });
});

app.delete("/:projectId/steps/:id", async (c) => {
  const { db, p, user } = await project(c);
  const [s] = await db.delete(steps).where(and(eq(steps.id, c.req.param("id")), eq(steps.projectId, p.id))).returning();
  if (!s) throw new HTTPException(404, { message: "Step not found" });
  await audit(db, user, { projectId: p.id, action: "step.delete", objectType: "step", objectId: s.id, summary: `Removed step: ${s.instructions}` });
  await touchProject(db, p.id);
  return c.json({ ok: true });
});

export default app;
