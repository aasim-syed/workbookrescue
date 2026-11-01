import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../_lib/db/client.js";
import { body, project, type Env } from "../_lib/http.js";
import { audit, touchProject } from "../_lib/store.js";
import { computeUnknowns } from "../_lib/unknowns.js";

const { unknownAcks } = schema;
const app = new Hono<Env>();

app.get("/:projectId/unknowns", async (c) => {
  const { db, p } = await project(c);
  return c.json(await computeUnknowns(db, p.id));
});

/** Accept a known limitation, with a reason. Unresolved dependencies can't be waved through: they have to be fixed. */
app.post("/:projectId/unknowns/ack", async (c) => {
  const { db, p, user } = await project(c);
  const v = await body(c, z.object({ key: z.string().min(1).max(400), reason: z.string().trim().min(3, "Say why this is acceptable").max(500) }));
  const item = (await computeUnknowns(db, p.id)).items.find((i) => i.id === v.key);
  if (!item) throw new HTTPException(404, { message: "That item no longer exists" });
  if (!item.acknowledgeable) throw new HTTPException(400, { message: "NOT_ACKNOWLEDGEABLE: this has to be resolved, not accepted" });
  await db.insert(unknownAcks).values({ projectId: p.id, key: v.key, reason: v.reason, reviewerId: user.id }).onConflictDoUpdate({ target: [unknownAcks.projectId, unknownAcks.key], set: { reason: v.reason, reviewerId: user.id } });
  await audit(db, user, { projectId: p.id, action: "unknown.acknowledge", objectType: "unknown", objectId: v.key, summary: `Accepted: ${item.title}. Reason: ${v.reason}`, payload: v });
  await touchProject(db, p.id);
  return c.json({ ok: true });
});

app.delete("/:projectId/unknowns/ack", async (c) => {
  const { db, p, user } = await project(c);
  const key = c.req.query("key") ?? "";
  const [row] = await db.delete(unknownAcks).where(and(eq(unknownAcks.projectId, p.id), eq(unknownAcks.key, key))).returning();
  if (!row) throw new HTTPException(404, { message: "No such acknowledgement" });
  await audit(db, user, { projectId: p.id, action: "unknown.reopen", objectType: "unknown", objectId: key, summary: `Reopened: ${key.split("|").slice(1).join(" · ")}` });
  return c.json({ ok: true });
});

export default app;
