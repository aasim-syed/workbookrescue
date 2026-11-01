// Local API server (the Vite dev server proxies /api here). On Vercel, api/index.ts serves the same app.
import { serve } from "@hono/node-server";
import app from "./_app.js";

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`API on http://localhost:${port}`));
