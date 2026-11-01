import { and, eq } from "drizzle-orm";
import { schema, type DB } from "./db/client.js";
import type { AuthUser } from "./auth.js";
import { buildDemoFiles, CHANGED_AFTER_LABOR_CHANGE, LABOR_AFTER } from "./core/demo.js";
import { sha256 } from "./core/parse.js";
import { ingest } from "./ingest.js";
import { audit } from "./store.js";

const { projects } = schema;
export const DEMO_NAME = "Manufacturing quote (walkthrough)";
const HELD_BACK = "shipping_rates.xlsx"; // withheld so the walkthrough starts with a real unresolved link

async function addFile(db: DB, user: AuthUser, projectId: string, labor: number, filename: string) {
  const f = buildDemoFiles(labor).find((x) => x.filename === filename);
  if (!f) throw new Error(`Unknown demo file ${filename}`);
  const json = JSON.stringify([f.filename, f.cells]);
  return ingest(db, user, projectId, f.filename, f, await sha256(json), json.length, null);
}

export async function seedDemo(db: DB, user: AuthUser): Promise<string> {
  const [existing] = await db.select().from(projects).where(and(eq(projects.organizationId, user.orgId), eq(projects.isDemo, true)));
  if (existing) return existing.id;
  const [p] = await db
    .insert(projects)
    .values({ organizationId: user.orgId, name: DEMO_NAME, isDemo: true, description: "Synthetic data. 100 units, 20% markup. Follow the checklist to see lineage, a manual handoff, and a failing regression test." })
    .returning();
  await audit(db, user, { projectId: p.id, action: "project.create", objectType: "project", objectId: p.id, summary: "Created walkthrough project" });
  for (const f of buildDemoFiles(150)) if (f.filename !== HELD_BACK) await addFile(db, user, p.id, 150, f.filename);
  return p.id;
}

export const addDemoShipping = (db: DB, user: AuthUser, projectId: string) => addFile(db, user, projectId, 150, HELD_BACK);

/** Re-saves the workbooks the way they would look after someone raised the labour rate to 175. */
export async function simulateLaborChange(db: DB, user: AuthUser, projectId: string) {
  for (const name of CHANGED_AFTER_LABOR_CHANGE) await addFile(db, user, projectId, LABOR_AFTER, name);
}
