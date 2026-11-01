import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type DB } from "./db/client.js";
import type { AuthUser } from "./auth.js";
import { sha256 } from "./core/parse.js";
import type { ArtifactData, GraphContext, ManualEdge, Status } from "./core/graph.js";

const { artifacts, cells, mappings, steps, projects, auditEvents } = schema;

export type Manifest = { filename: string; artifactId: string; sha256: string; version: number }[];

export async function ownProject(db: DB, user: AuthUser, projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null;
  const [p] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, user.orgId)));
  return p ?? null;
}

export async function latestArtifacts(db: DB, projectId: string) {
  const rows = await db.select().from(artifacts).where(eq(artifacts.projectId, projectId)).orderBy(desc(artifacts.version), desc(artifacts.createdAt));
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.filename) ? false : (seen.add(r.filename), true)));
}

export async function allArtifacts(db: DB, projectId: string) {
  return db.select().from(artifacts).where(eq(artifacts.projectId, projectId)).orderBy(artifacts.filename, desc(artifacts.version));
}

/** Loads cells for the chosen artifact versions into a graph context. `pinned` fixes versions (baselines); otherwise latest. */
export async function loadContext(db: DB, projectId: string, pinned?: Manifest): Promise<GraphContext> {
  const rows = pinned
    ? await db.select().from(artifacts).where(and(eq(artifacts.projectId, projectId), inArray(artifacts.id, pinned.map((m) => m.artifactId))))
    : await latestArtifacts(db, projectId);
  const ids = rows.map((r) => r.id);
  const cellRows = ids.length ? await db.select().from(cells).where(inArray(cells.artifactId, ids)) : [];

  const data = new Map<string, ArtifactData>();
  const byFilename = new Map<string, string>();
  for (const r of rows) {
    data.set(r.id, { id: r.id, filename: r.filename, version: r.version, sheets: r.sheets.map((s) => s.name), externalLinks: r.externalLinks, cells: new Map() });
    byFilename.set(r.filename, r.id);
  }
  for (const c of cellRows) data.get(c.artifactId)!.cells.set(`${c.sheet}!${c.address}`, { sheet: c.sheet, address: c.address, formula: c.formula, cached: c.cached ?? null });

  const maps = await db.select().from(mappings).where(eq(mappings.projectId, projectId));
  const mapped = new Map<string, string>();
  for (const a of data.values())
    for (const m of maps.filter((x) => x.sourceFilename === a.filename)) {
      const to = byFilename.get(m.resolvedFilename);
      if (to) mapped.set(`${a.id}|${m.target}`, to);
    }

  const stepRows = await db.select().from(steps).where(eq(steps.projectId, projectId)).orderBy(steps.ordinal);
  const manualEdges: ManualEdge[] = stepRows
    .filter((s) => s.toFilename && byFilename.has(s.toFilename))
    .map((s) => ({
      id: s.id, kind: s.kind, label: s.instructions, owner: s.ownerRole, status: s.status as Status,
      fromArtifactId: s.fromFilename ? (byFilename.get(s.fromFilename) ?? null) : null,
      fromSheet: s.fromSheet, fromAddress: s.fromAddress,
      toArtifactId: byFilename.get(s.toFilename!) ?? null, toSheet: s.toSheet, toAddress: s.toAddress,
    }));

  return { artifacts: data, byFilename, mappings: mapped, manualEdges };
}

export async function audit(
  db: DB,
  user: AuthUser,
  e: { projectId?: string; action: string; objectType: string; objectId?: string; summary: string; payload?: unknown },
) {
  await db.insert(auditEvents).values({
    organizationId: user.orgId, projectId: e.projectId ?? null, actorId: user.id, actorEmail: user.email,
    action: e.action, objectType: e.objectType, objectId: e.objectId ?? null, summary: e.summary,
    payloadHash: e.payload === undefined ? null : await sha256(JSON.stringify(e.payload)),
  });
}

export async function touchProject(db: DB, projectId: string) {
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
}
