import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/_lib/db/schema.ts",
  out: "./server/_lib/db/migrations",
});
