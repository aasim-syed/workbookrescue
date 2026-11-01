import { and, desc, eq } from "drizzle-orm";
import { schema, type DB } from "./db/client.js";
import type { AuthUser } from "./auth.js";
import type { ParsedFile } from "./core/types.js";
import { audit, touchProject } from "./store.js";

const { artifacts, artifactBlobs, cells } = schema;
const CHUNK = 1500;

export async function ingest(
  db: DB,
  user: AuthUser,
  projectId: string,
  filename: string,
  parsed: ParsedFile,
  digest: string,
  size: number,
  bytes: Uint8Array | null,
) {
  const [dup] = await db.select().from(artifacts).where(and(eq(artifacts.projectId, projectId), eq(artifacts.filename, filename), eq(artifacts.sha256, digest)));
  if (dup) return { artifact: dup, duplicate: true as const };

  const [prev] = await db.select({ version: artifacts.version }).from(artifacts).where(and(eq(artifacts.projectId, projectId), eq(artifacts.filename, filename))).orderBy(desc(artifacts.version)).limit(1);
  const [artifact] = await db
    .insert(artifacts)
    .values({
      projectId, filename, format: parsed.format, sha256: digest, sizeBytes: size, version: (prev?.version ?? 0) + 1,
      sheets: parsed.sheets, externalLinks: parsed.externalLinks, warnings: parsed.warnings, cellCount: parsed.cells.length, uploadedBy: user.id,
    })
    .returning();

  try {
    if (bytes) await db.insert(artifactBlobs).values({ artifactId: artifact.id, content: bytes });
    for (let i = 0; i < parsed.cells.length; i += CHUNK) {
      await db.insert(cells).values(parsed.cells.slice(i, i + CHUNK).map((c) => ({ artifactId: artifact.id, sheet: c.sheet, address: c.address, formula: c.formula, cached: c.cached })));
    }
  } catch (e) {
    await db.delete(artifacts).where(eq(artifacts.id, artifact.id)); // never leave a half-imported file behind
    throw e;
  }
  await audit(db, user, {
    projectId, action: "artifact.import", objectType: "artifact", objectId: artifact.id,
    summary: `Imported ${filename} v${artifact.version} (${parsed.cells.length} cells)`, payload: { sha256: digest },
  });
  await touchProject(db, projectId);
  return { artifact, duplicate: false as const };
}
