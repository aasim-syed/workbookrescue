import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, count, eq, sql } from "drizzle-orm";
import { schema, type DB } from "./db/client.js";
import type { AuthUser } from "./auth.js";

const { rateLimits, projects, artifacts } = schema;

/** Per-workspace caps. Guest sandboxes are small and short-lived. */
export const QUOTAS = {
  guest: { projects: 3, filesPerProject: 20, uploadsPerHour: 20 },
  user: { projects: 50, filesPerProject: 200, uploadsPerHour: 200 },
} as const;
export const GUEST_TTL_HOURS = 24;

export const clientIp = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || "unknown";

/**
 * Fixed-window counter in Postgres, so the limit holds across serverless instances.
 * Throws 429 with Retry-After once `limit` hits inside the window are used up.
 */
export async function rateLimit(db: DB, c: Context, name: string, id: string, limit: number, windowSec: number) {
  const now = Date.now();
  const bucket = Math.floor(now / (windowSec * 1000));
  const [row] = await db
    .insert(rateLimits)
    .values({ key: `${name}:${id}`, bucket, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.bucket], set: { count: sql`${rateLimits.count} + 1`, updatedAt: new Date() } })
    .returning({ count: rateLimits.count });
  if (row.count > limit) {
    const retry = Math.max(1, Math.ceil(((bucket + 1) * windowSec * 1000 - now) / 1000));
    c.header("Retry-After", String(retry));
    throw new HTTPException(429, { message: `RATE_LIMITED: Too many requests. Try again in ${retry < 90 ? `${retry}s` : `${Math.ceil(retry / 60)} min`}.` });
  }
}

export async function assertProjectQuota(db: DB, user: AuthUser) {
  const q = user.isGuest ? QUOTAS.guest : QUOTAS.user;
  const [{ n }] = await db.select({ n: count() }).from(projects).where(eq(projects.organizationId, user.orgId));
  if (n >= q.projects) throw new HTTPException(403, { message: `QUOTA_EXCEEDED: ${user.isGuest ? "Guest sandboxes" : "Workspaces"} are limited to ${q.projects} projects.${user.isGuest ? " Create an account for more." : ""}` });
}

export async function assertFileQuota(db: DB, user: AuthUser, projectId: string) {
  const q = user.isGuest ? QUOTAS.guest : QUOTAS.user;
  const [{ n }] = await db.select({ n: count() }).from(artifacts).where(and(eq(artifacts.projectId, projectId)));
  if (n >= q.filesPerProject) throw new HTTPException(403, { message: `QUOTA_EXCEEDED: A project can hold ${q.filesPerProject} file versions.${user.isGuest ? " Create an account for more." : ""}` });
}
