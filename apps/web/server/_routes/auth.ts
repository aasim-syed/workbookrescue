import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { currentUser, endSession, hashPassword, startSession, verifyPassword, type AuthUser } from "../_lib/auth.js";
import { schema } from "../_lib/db/client.js";
import { body, database, type Env } from "../_lib/http.js";
import { seedDemo } from "../_lib/seed.js";
import { clientIp, rateLimit } from "../_lib/limits.js";

const { users, organizations } = schema;
const creds = z.object({ email: z.string().email().max(200).transform((s) => s.toLowerCase()), password: z.string().min(8).max(200) });
const signup = creds.extend({ name: z.string().trim().min(1).max(100) });

const app = new Hono<Env>();
const toUser = (u: typeof users.$inferSelect): AuthUser => ({ id: u.id, orgId: u.organizationId, email: u.email, name: u.name, isGuest: u.isGuest });

app.get("/me", async (c) => {
  const u = await currentUser(c);
  return c.json({ user: u });
});

app.post("/signup", async (c) => {
  const input = await body(c, signup);
  const db = await database();
  await rateLimit(db, c, "signup-ip", clientIp(c), 10, 3600);
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (exists) throw new HTTPException(409, { message: "An account with this email already exists" });
  const [org] = await db.insert(organizations).values({ name: `${input.name}'s workspace` }).returning();
  const [u] = await db.insert(users).values({ organizationId: org.id, email: input.email, name: input.name, passwordHash: await hashPassword(input.password) }).returning();
  await startSession(c, toUser(u));
  return c.json({ user: toUser(u) }, 201);
});

app.post("/login", async (c) => {
  const input = await body(c, creds);
  const db = await database();
  // per-IP to slow credential stuffing, per-email so one account can't be hammered from many IPs
  await rateLimit(db, c, "login-ip", clientIp(c), 30, 600);
  await rateLimit(db, c, "login-email", input.email, 10, 600);
  const [u] = await db.select().from(users).where(eq(users.email, input.email));
  // same response for unknown email and wrong password
  if (!u || !(await verifyPassword(input.password, u.passwordHash))) throw new HTTPException(401, { message: "Wrong email or password" });
  await startSession(c, toUser(u));
  return c.json({ user: toUser(u) });
});

/** One click into a private sandbox workspace with the walkthrough project already loaded. */
app.post("/guest", async (c) => {
  const db = await database();
  await rateLimit(db, c, "guest-ip", clientIp(c), 5, 3600);
  await rateLimit(db, c, "guest-all", "global", 300, 3600); // backstop if the abuse is spread over many IPs
  const tag = randomBytes(5).toString("hex");
  const [org] = await db.insert(organizations).values({ name: "Guest workspace" }).returning();
  const [u] = await db.insert(users).values({ organizationId: org.id, email: `guest-${tag}@guest.local`, name: "Guest", isGuest: true, passwordHash: await hashPassword(randomBytes(16).toString("hex")) }).returning();
  const user = toUser(u);
  await startSession(c, user);
  const projectId = await seedDemo(db, user);
  return c.json({ user, projectId }, 201);
});

app.post("/logout", (c) => {
  endSession(c);
  return c.json({ ok: true });
});

export default app;
