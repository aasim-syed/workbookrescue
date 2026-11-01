import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../_lib/db/client.js";
import { body, project, type Env } from "../_lib/http.js";
import { parseUpload, sha256 } from "../_lib/core/parse.js";
import { LIMITS } from "../_lib/core/types.js";
import { ingest } from "../_lib/ingest.js";
import { zipSync } from "fflate";
import { assertFileQuota, QUOTAS, rateLimit } from "../_lib/limits.js";
import { deleteOriginal, downloadUrl, getOriginal, storageEnabled } from "../_lib/storage.js";
import { rebuildFile } from "../_lib/rebuild.js";
import { allArtifacts, audit, latestArtifacts, loadContext, touchProject } from "../_lib/store.js";

const { artifacts, mappings, cells } = schema;
const app = new Hono<Env>();

app.get("/:projectId/files", async (c) => {
  const { db, p } = await project(c);
  const all = await allArtifacts(db, p.id);
  const latest = new Set((await latestArtifacts(db, p.id)).map((a) => a.id));
  return c.json({
    files: all.map(({ storageKey, ...a }) => ({ ...a, hasOriginal: !!storageKey, isLatest: latest.has(a.id) })),
    limits: { maxFileBytes: LIMITS.maxFileBytes },
  });
});

/** Raw file bytes in the body, name in ?filename=. Parsed read-only; macros are never executed. */
app.post("/:projectId/files", async (c) => {
  const { db, p, user } = await project(c);
  await rateLimit(db, c, "upload-org", user.orgId, (user.isGuest ? QUOTAS.guest : QUOTAS.user).uploadsPerHour, 3600);
  await assertFileQuota(db, user, p.id);
  const filename = (c.req.query("filename") ?? "").split(/[\\/]/).pop()!.trim();
  if (!filename || filename.length > 200) throw new HTTPException(400, { message: "filename query parameter is required" });
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > LIMITS.maxFileBytes) throw new HTTPException(413, { message: `File exceeds ${LIMITS.maxFileBytes / 1024 / 1024} MB` });
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const parsed = parseUpload(filename, bytes);
  const res = await ingest(db, user, p.id, filename, parsed, await sha256(bytes), bytes.byteLength, bytes);
  return c.json({ artifact: res.artifact, duplicate: res.duplicate }, res.duplicate ? 200 : 201);
});

app.delete("/:projectId/files/:artifactId", async (c) => {
  const { db, p, user } = await project(c);
  const [a] = await db.select().from(artifacts).where(and(eq(artifacts.id, c.req.param("artifactId")), eq(artifacts.projectId, p.id)));
  if (!a) throw new HTTPException(404, { message: "File not found" });
  await db.delete(artifacts).where(eq(artifacts.id, a.id));
  if (a.storageKey) await deleteOriginal(a.storageKey).catch((e) => console.error("object delete failed", e));
  await audit(db, user, { projectId: p.id, action: "artifact.delete", objectType: "artifact", objectId: a.id, summary: `Deleted ${a.filename} v${a.version}` });
  await touchProject(db, p.id);
  return c.json({ ok: true });
});

/** Cells of one file version, for the in-app sheet viewer. */
app.get("/:projectId/files/:artifactId/cells", async (c) => {
  const { db, p } = await project(c);
  const [a] = await db.select().from(artifacts).where(and(eq(artifacts.id, c.req.param("artifactId")), eq(artifacts.projectId, p.id)));
  if (!a) throw new HTTPException(404, { message: "File not found" });
  const rows = await db.select({ sheet: cells.sheet, address: cells.address, formula: cells.formula, cached: cells.cached }).from(cells).where(eq(cells.artifactId, a.id));
  const versions = (await db.select({ id: artifacts.id, version: artifacts.version }).from(artifacts).where(and(eq(artifacts.projectId, p.id), eq(artifacts.filename, a.filename)))).sort((x, y) => y.version - x.version);
  return c.json({ file: { id: a.id, filename: a.filename, format: a.format, version: a.version, sheets: a.sheets, externalLinks: a.externalLinks }, versions, cells: rows });
});

/** The original from Neon Object Storage when we have it (signed URL), otherwise a file rebuilt from the imported cells. */
app.get("/:projectId/files/:artifactId/download", async (c) => {
  const { db, p, user } = await project(c);
  const [a] = await db.select().from(artifacts).where(and(eq(artifacts.id, c.req.param("artifactId")), eq(artifacts.projectId, p.id)));
  if (!a) throw new HTTPException(404, { message: "File not found" });
  await audit(db, user, { projectId: p.id, action: "artifact.download", objectType: "artifact", objectId: a.id, summary: `Downloaded ${a.filename} v${a.version}` });
  if (a.storageKey && storageEnabled()) return c.redirect(await downloadUrl(a.storageKey, a.filename), 302);
  const rows = await db.select({ sheet: cells.sheet, address: cells.address, formula: cells.formula, cached: cells.cached }).from(cells).where(eq(cells.artifactId, a.id));
  const out = rebuildFile(a, rows);
  return c.body(out.bytes as Uint8Array<ArrayBuffer>, 200, { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${a.filename.replace(/"/g, "")}"` });
});

/** Every file in its latest version as one zip: the originals where stored, rebuilt .xlsx/.csv otherwise. */
app.get("/:projectId/files.zip", async (c) => {
  const { db, p, user } = await project(c);
  const latest = await latestArtifacts(db, p.id);
  if (!latest.length) throw new HTTPException(404, { message: "No files to download" });
  const entries: Record<string, Uint8Array> = {};
  for (const a of latest) {
    if (a.storageKey && storageEnabled()) {
      entries[a.filename] = await getOriginal(a.storageKey);
    } else {
      const rows = await db.select({ sheet: cells.sheet, address: cells.address, formula: cells.formula, cached: cells.cached }).from(cells).where(eq(cells.artifactId, a.id));
      entries[a.filename] = rebuildFile(a, rows).bytes;
    }
  }
  await audit(db, user, { projectId: p.id, action: "artifact.download", objectType: "project", objectId: p.id, summary: `Downloaded ${latest.length} files as a zip` });
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workbooks";
  return c.body(zipSync(entries, { level: 0 }) as Uint8Array<ArrayBuffer>, 200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${slug}.zip"` });
});

const mapInput = z.object({ sourceFilename: z.string().min(1), target: z.string().min(1), resolvedFilename: z.string().min(1), reason: z.string().max(500).default("") });

/** A reviewer says: links to `target` inside `sourceFilename` mean `resolvedFilename`. Recorded with who and why. */
app.post("/:projectId/mappings", async (c) => {
  const { db, p, user } = await project(c);
  const v = await body(c, mapInput);
  const ctx = await loadContext(db, p.id);
  if (!ctx.byFilename.has(v.resolvedFilename)) throw new HTTPException(400, { message: `${v.resolvedFilename} is not in this project` });
  const [m] = await db
    .insert(mappings)
    .values({ projectId: p.id, ...v, reviewerId: user.id })
    .onConflictDoUpdate({ target: [mappings.projectId, mappings.sourceFilename, mappings.target], set: { resolvedFilename: v.resolvedFilename, reason: v.reason, reviewerId: user.id } })
    .returning();
  await audit(db, user, { projectId: p.id, action: "mapping.set", objectType: "mapping", objectId: m.id, summary: `Mapped ${v.target} (in ${v.sourceFilename}) to ${v.resolvedFilename}`, payload: v });
  await touchProject(db, p.id);
  return c.json({ mapping: m }, 201);
});

app.get("/:projectId/mappings", async (c) => {
  const { db, p } = await project(c);
  return c.json({ mappings: await db.select().from(mappings).where(eq(mappings.projectId, p.id)) });
});

app.delete("/:projectId/mappings/:id", async (c) => {
  const { db, p, user } = await project(c);
  const [m] = await db.delete(mappings).where(and(eq(mappings.id, c.req.param("id")), eq(mappings.projectId, p.id))).returning();
  if (!m) throw new HTTPException(404, { message: "Mapping not found" });
  await audit(db, user, { projectId: p.id, action: "mapping.remove", objectType: "mapping", objectId: m.id, summary: `Removed mapping of ${m.target} in ${m.sourceFilename}` });
  return c.json({ ok: true });
});

export default app;
