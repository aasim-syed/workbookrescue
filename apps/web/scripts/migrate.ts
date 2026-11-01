// Applies SQL migrations to the database in DATABASE_URL (Neon). Local dev migrates PGlite automatically.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { migrationsFolder } from "../server/_lib/db/client.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to your Neon connection string first.");
  process.exit(1);
}
await migrate(drizzle(neon(url)), { migrationsFolder });
console.log("Migrations applied.");
