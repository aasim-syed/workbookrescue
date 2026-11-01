import { defineConfig } from "vitest/config";

// Each API test file boots its own in-process Postgres and runs every migration, which is slow when files run in parallel.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
