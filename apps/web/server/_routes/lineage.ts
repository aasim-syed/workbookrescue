import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { buildUpstream, findOutputs } from "../_lib/core/graph.js";
import { project, type Env } from "../_lib/http.js";
import { loadContext } from "../_lib/store.js";

const app = new Hono<Env>();

app.get("/:projectId/outputs", async (c) => {
  const { db, p } = await project(c);
  return c.json({ outputs: findOutputs(await loadContext(db, p.id)) });
});

/** Upstream lineage of one cell. With no cell given, the most likely deliverable is chosen so the page opens on something useful. */
app.get("/:projectId/graph", async (c) => {
  const { db, p } = await project(c);
  const ctx = await loadContext(db, p.id);
  let artifactId = c.req.query("artifactId");
  let sheet = c.req.query("sheet");
  let address = c.req.query("address");
  if (!artifactId || !sheet || !address) {
    const first = findOutputs(ctx, 1)[0];
    if (!first) return c.json({ graph: null });
    ({ artifactId, sheet, address } = first);
  }
  if (!ctx.artifacts.has(artifactId)) throw new HTTPException(404, { message: "File not found" });
  return c.json({ graph: buildUpstream(ctx, { artifactId, sheet, address }) });
});

/** Current saved value of one cell: used to prefill baseline expectations. */
app.get("/:projectId/cell", async (c) => {
  const { db, p } = await project(c);
  const ctx = await loadContext(db, p.id);
  const id = ctx.byFilename.get(c.req.query("filename") ?? "");
  const cell = id ? ctx.artifacts.get(id)!.cells.get(`${c.req.query("sheet")}!${(c.req.query("address") ?? "").toUpperCase()}`) : undefined;
  return c.json({ cell: cell ?? null });
});

export default app;
