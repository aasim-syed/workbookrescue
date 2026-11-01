import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";
import { getDb, type DB } from "./db/client.js";
import type { AuthUser } from "./auth.js";
import { ownProject } from "./store.js";

export type Env = { Variables: { user: AuthUser } };

export async function body<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be JSON" });
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HTTPException(400, { message: r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
  return r.data;
}

export async function project(c: Context<Env>, param = "projectId") {
  const db = await getDb();
  const p = await ownProject(db, c.get("user"), c.req.param(param)!);
  if (!p) throw new HTTPException(404, { message: "Project not found" });
  return { db, p, user: c.get("user") };
}

export async function database(): Promise<DB> {
  return getDb();
}
