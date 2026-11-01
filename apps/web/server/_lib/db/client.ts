import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.js";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

export const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

let cached: Promise<DB> | undefined;

/** Neon (pooled node-postgres) when DATABASE_URL is set; otherwise an in-process Postgres (PGlite) for local development. */
export function getDb(): Promise<DB> {
  cached ??= connect();
  return cached;
}

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    if (process.env.VERCEL) {
      // Fluid compute: lets Vercel close idle pool clients before the instance is suspended
      const { attachDatabasePool } = await import("@vercel/functions");
      attachDatabasePool(pool);
    }
    return pgDrizzle(pool, { schema }) as unknown as DB;
  }

  if (process.env.VERCEL) throw new Error("DATABASE_URL is not set");
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? path.resolve(process.cwd(), ".data/pglite");
  const db = drizzle(new PGlite(dir === "memory" ? undefined : dir), { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as DB;
}
