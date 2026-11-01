import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.PGLITE_DIR = "memory";
process.env.CRON_SECRET = "test-cron-secret";

let app: typeof import("../server/_app.js").default;
let db: Awaited<ReturnType<typeof import("../server/_lib/db/client.js").getDb>>;
let schema: typeof import("../server/_lib/db/client.js").schema;

beforeAll(async () => {
  const client = await import("../server/_lib/db/client.js");
  db = await client.getDb();
  schema = client.schema;
  app = (await import("../server/_app.js")).default;
});

type Res = { status: number; body: any; headers: Headers; cookie: string };
async function call(method: string, path: string, opts: { ip?: string; cookie?: string; json?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  const res = await app.request("/api" + path, {
    method,
    headers: { ...(opts.json ? { "content-type": "application/json" } : {}), ...(opts.ip ? { "x-forwarded-for": opts.ip } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
    body: opts.json ? JSON.stringify(opts.json) : undefined,
  });
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body, headers: res.headers, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}

describe("request ids and 500s", () => {
  it("puts a request id on every response, including 404s and errors", async () => {
    const ok = await call("GET", "/health");
    const missing = await call("GET", "/nope");
    expect(ok.headers.get("x-request-id")).toBeTruthy();
    expect(missing.headers.get("x-request-id")).toBeTruthy();
    expect(missing.body.requestId).toBe(missing.headers.get("x-request-id"));
  });

  it("logs one structured line for a 500 and returns the same id to the user", async () => {
    const guest = await call("POST", "/auth/guest", { ip: "10.9.0.1" });
    expect(guest.status).toBe(201);
    const store = await import("../server/_lib/store.js");
    const boom = vi.spyOn(store, "ownProject").mockRejectedValueOnce(Object.assign(new Error("connection terminated"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND base"), { code: "ENOTFOUND" }) }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await call("GET", `/projects/${guest.body.projectId}`, { cookie: guest.cookie, headers: { "x-vercel-id": "bom1::abc123" } });
    const logged = log.mock.calls.map((c) => c[0] as string); // read before restoring: restore clears the recorded calls
    boom.mockRestore();
    log.mockRestore();

    expect(r.status).toBe(500);
    expect(r.body.code).toBe("INTERNAL_ERROR");
    expect(r.body.requestId).toBe("bom1::abc123");
    expect(r.body.detail).toContain("bom1::abc123");
    expect(r.body.detail).not.toMatch(/ENOTFOUND|connection/); // internals stay out of the response

    const line = JSON.parse(logged[0]);
    expect(line).toMatchObject({ level: "error", requestId: "bom1::abc123", method: "GET" });
    expect(line.chain.map((c: any) => c.code)).toContain("ENOTFOUND"); // root cause is visible in the log
    expect(JSON.stringify(line)).not.toContain(guest.cookie.split("=")[1]); // no session token in logs
  });
});

describe("abuse protection", () => {
  it("limits guest sandboxes per IP and sends Retry-After", async () => {
    const results: number[] = [];
    for (let i = 0; i < 6; i++) results.push((await call("POST", "/auth/guest", { ip: "10.1.0.1" })).status);
    expect(results).toEqual([201, 201, 201, 201, 201, 429]);
    const blocked = await call("POST", "/auth/guest", { ip: "10.1.0.1" });
    expect(blocked.body.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call("POST", "/auth/guest", { ip: "10.1.0.2" })).status).toBe(201); // other IPs unaffected
  }, 60_000);

  it("limits login attempts per email, even from different IPs", async () => {
    const email = "victim@example.com";
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await call("POST", "/auth/login", { ip: `10.2.0.${i}`, json: { email, password: "wrong-password-1" } })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("caps projects in a guest sandbox but not account holders at the same count", async () => {
    const g = await call("POST", "/auth/guest", { ip: "10.3.0.1" }); // owns the demo project already
    expect((await call("POST", "/projects", { cookie: g.cookie, json: { name: "A" } })).status).toBe(201);
    expect((await call("POST", "/projects", { cookie: g.cookie, json: { name: "B" } })).status).toBe(201);
    const over = await call("POST", "/projects", { cookie: g.cookie, json: { name: "C" } });
    expect(over.status).toBe(403);
    expect(over.body.code).toBe("QUOTA_EXCEEDED");

    const u = await call("POST", "/auth/signup", { ip: "10.3.0.2", json: { name: "Real", email: "real@example.com", password: "long enough pw" } });
    for (const n of ["A", "B", "C", "D"]) expect((await call("POST", "/projects", { cookie: u.cookie, json: { name: n } })).status).toBe(201);
  }, 30_000);

  it("caps uploads per hour and file versions per project", async () => {
    const g = await call("POST", "/auth/guest", { ip: "10.4.0.1" });
    const csv = (i: number) => new TextEncoder().encode(`a,b\n${i},2\n`);
    const up = (i: number) =>
      app.request(`/api/projects/${g.body.projectId}/files?filename=f.csv`, { method: "POST", headers: { cookie: g.cookie, "x-forwarded-for": "10.4.0.1" }, body: csv(i) });
    // the demo already holds 7 versions; the cap is 20 per project
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await up(i)).status);
    expect(codes.slice(0, 13).every((s) => s === 201)).toBe(true);
    const last = await up(99);
    expect(last.status).toBe(403);
    expect((await last.json()).code).toBe("QUOTA_EXCEEDED");
  }, 60_000);
});

describe("maintenance", () => {
  it("rejects the cron endpoint without the secret and stays off when unconfigured", async () => {
    expect((await call("GET", "/cron/cleanup")).status).toBe(401);
    expect((await call("GET", "/cron/cleanup", { headers: { authorization: "Bearer wrong-secret-xx" } })).status).toBe(401);
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect((await call("GET", "/cron/cleanup", { headers: { authorization: "Bearer anything" } })).status).toBe(503);
    process.env.CRON_SECRET = saved;
  });

  it("expires old guest sandboxes with everything in them, and leaves real accounts and fresh guests alone", async () => {
    const old = await call("POST", "/auth/guest", { ip: "10.5.0.1" });
    const fresh = await call("POST", "/auth/guest", { ip: "10.5.0.2" });
    const real = await call("POST", "/auth/signup", { ip: "10.5.0.3", json: { name: "Keep", email: "keep@example.com", password: "long enough pw" } });
    const realProject = (await call("POST", "/projects", { cookie: real.cookie, json: { name: "Mine" } })).body.project.id;

    // backdate the old guest by 25 hours (older than the 24h TTL)
    const { eq } = await import("drizzle-orm");
    await db.update(schema.users).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.users.id, old.body.user.id));
    // and an ancient rate-limit counter
    await db.insert(schema.rateLimits).values({ key: "stale:x", bucket: 1, count: 3, updatedAt: new Date(Date.now() - 3 * 24 * 3600_000) });

    const r = await call("GET", "/cron/cleanup", { headers: { authorization: "Bearer test-cron-secret" } });
    expect(r.status).toBe(200);
    expect(r.body.guestWorkspacesRemoved).toBeGreaterThanOrEqual(1);

    expect((await call("GET", `/projects/${old.body.projectId}`, { cookie: old.cookie })).status).toBe(404); // gone
    const orphans = await db.select().from(schema.artifacts).where(eq(schema.artifacts.projectId, old.body.projectId));
    expect(orphans).toHaveLength(0); // cascaded
    expect((await call("GET", `/projects/${fresh.body.projectId}`, { cookie: fresh.cookie })).status).toBe(200);
    expect((await call("GET", `/projects/${realProject}`, { cookie: real.cookie })).status).toBe(200);
    expect((await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, "stale:x")))).toHaveLength(0);
  }, 60_000);
});
