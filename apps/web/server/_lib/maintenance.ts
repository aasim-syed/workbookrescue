import { and, eq, inArray, lt } from "drizzle-orm";
import { schema, type DB } from "./db/client.js";
import { GUEST_TTL_HOURS } from "./limits.js";
import { deletePrefix, storageEnabled } from "./storage.js";

const { users, organizations, projects, rateLimits } = schema;

/** Removes guest sandboxes past their TTL, with their database rows (by cascade) and stored originals, plus stale rate-limit counters. */
export async function runMaintenance(db: DB, now = new Date()) {
  const cutoff = new Date(now.getTime() - GUEST_TTL_HOURS * 3600_000);
  const expired = await db.select({ orgId: users.organizationId }).from(users).where(and(eq(users.isGuest, true), lt(users.createdAt, cutoff)));
  const orgIds = [...new Set(expired.map((u) => u.orgId))];
  let objectPrefixes = 0;
  if (orgIds.length) {
    if (storageEnabled()) {
      const ps = await db.select({ id: projects.id }).from(projects).where(inArray(projects.organizationId, orgIds));
      for (const p of ps) { await deletePrefix(`${p.id}/`); objectPrefixes++; }
    }
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  const staleBefore = new Date(now.getTime() - 2 * 24 * 3600_000);
  await db.delete(rateLimits).where(lt(rateLimits.updatedAt, staleBefore));
  return { guestWorkspacesRemoved: orgIds.length, objectPrefixesCleared: objectPrefixes };
}
