import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { database, type Env } from "../_lib/http.js";
import { runMaintenance } from "../_lib/maintenance.js";

const app = new Hono<Env>();

/** Called by Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`. Disabled when no secret is configured. */
app.get("/cleanup", async (c) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HTTPException(503, { message: "CRON_DISABLED: CRON_SECRET is not configured" });
  const given = Buffer.from(c.req.header("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new HTTPException(401, { message: "Not authorised" });
  return c.json(await runMaintenance(await database()));
});

export default app;
