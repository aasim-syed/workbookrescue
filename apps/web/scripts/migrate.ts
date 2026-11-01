// Applies SQL migrations to Neon. Uses the direct (non-pooled) connection, as Neon recommends for migrations.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { migrationsFolder } from "../server/_lib/db/client.js";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL_UNPOOLED or DATABASE_URL. Run `neon env pull` or set it first.");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
await migrate(drizzle(pool), { migrationsFolder });
await pool.end();
console.log("Migrations applied.");
