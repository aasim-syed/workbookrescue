import { beforeAll, describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { findCycles, type ArtifactData, type GraphContext } from "../server/_lib/core/graph.js";
import { suggestFor } from "../server/_lib/unknowns.js";
import { writeXlsx } from "../server/_lib/core/xlsxWriter.js";
import { buildDemoFiles } from "../server/_lib/core/demo.js";
import type { ParsedCell, ParsedFile } from "../server/_lib/core/types.js";

process.env.PGLITE_DIR = "memory";
let app: typeof import("../server/_app.js").default;

beforeAll(async () => {
  app = (await import("../server/_app.js")).default;
});

describe("cycle detection", () => {
  const ctxOf = (cells: ParsedCell[]): GraphContext => {
    const a: ArtifactData = { id: "a", filename: "loop.xlsx", version: 1, sheets: ["S"], externalLinks: [], cells: new Map(cells.map((c) => [`${c.sheet}!${c.address}`, c])) };
    return { artifacts: new Map([["a", a]]), byFilename: new Map([["loop.xlsx", "a"]]), mappings: new Map(), manualEdges: [] };
  };
  const f = (address: string, formula: string): ParsedCell => ({ sheet: "S", address, formula, cached: 1 });

  it("finds a two-cell loop and a self reference, and ignores plain chains", () => {
    expect(findCycles(ctxOf([f("A1", "=B1+1"), f("B1", "=A1+1")]))).toEqual([expect.objectContaining({ address: "A1", size: 2 })]);
    expect(findCycles(ctxOf([f("A1", "=A1+1")]))).toHaveLength(1);
    expect(findCycles(ctxOf([f("A1", "=B1+1"), f("B1", "=C1+1"), { sheet: "S", address: "C1", formula: null, cached: 5 }]))).toEqual([]);
  });
  it("copes with a long chain without overflowing the stack", () => {
    const cells = Array.from({ length: 5000 }, (_, i) => f(`A${i + 1}`, `=A${i + 2}+1`));
    expect(findCycles(ctxOf(cells))).toEqual([]);
  });
});

describe("link suggestions", () => {
  it("offers same-stem files with a reason, never matches unrelated ones", () => {
    expect(suggestFor("shipping_rates.xlsx", ["shipping_rates_2026-10.xlsx", "labor_rates.xlsx", "customer_quote.xlsx"])).toEqual([{ filename: "shipping_rates_2026-10.xlsx", method: "Same name apart from date or version" }]);
    expect(suggestFor("shipping_rates.xlsx", ["Shipping Rates (v2).xlsx"])[0]?.filename).toBe("Shipping Rates (v2).xlsx");
    expect(suggestFor("shipping_rates.xlsx", ["labor_rates.xlsx", "overhead_policy.xlsx"])).toEqual([]);
  });
});

type Res = { status: number; body: any; cookie: string };
let cookie = "";
async function call(method: string, path: string, json?: unknown, raw?: Uint8Array): Promise<Res> {
  const res = await app.request("/api" + path, {
    method,
    headers: { cookie, "x-forwarded-for": "10.77.0.1", ...(json ? { "content-type": "application/json" } : {}) },
    body: (raw as unknown as BodyInit | undefined) ?? (json ? JSON.stringify(json) : undefined),
  });
  const set = (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (set) cookie = set;
  const text = await res.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body, cookie: set };
}
const unknowns = async (pid: string) => (await call("GET", `/projects/${pid}/unknowns`)).body as { items: any[]; summary: { blocking: number; review: number; acknowledged: number } };
const upload = (pid: string, name: string, bytes: Uint8Array) => call("POST", `/projects/${pid}/files?filename=${encodeURIComponent(name)}`, undefined, bytes);

const file = (name: string, cells: ParsedCell[], sheets = ["S"]): ParsedFile => ({ format: "xlsx", sheets: sheets.map((n) => ({ name: n, hidden: false })), cells, externalLinks: [], definedNames: [], warnings: [] });

describe("the unknowns queue", () => {
  let pid = "";
  beforeAll(async () => {
    const g = await call("POST", "/auth/guest");
    pid = g.body.projectId;
  }, 30_000);

  it("starts with the demo's one blocking item, a missing file, and no auto-applied suggestion", async () => {
    const u = await unknowns(pid);
    const link = u.items.find((i) => i.category === "link");
    expect(link).toMatchObject({ target: "shipping_rates.xlsx", filename: "cost_rollup.xlsx", severity: "blocking", status: "Unresolved", acknowledgeable: false });
    expect(link.suggestions).toEqual([]);
    expect(u.summary.blocking).toBe(1);
  });

  it("offers a renamed file as an Inferred suggestion, and linking it records a reviewer decision and clears the item", async () => {
    const shipping = buildDemoFiles().find((f) => f.filename === "shipping_rates.xlsx")!;
    expect((await upload(pid, "shipping_rates_2026-10.xlsx", writeXlsx(shipping))).status).toBe(201);
    const link = (await unknowns(pid)).items.find((i) => i.category === "link");
    expect(link.suggestions).toEqual([{ filename: "shipping_rates_2026-10.xlsx", method: "Same name apart from date or version" }]);
    // still unresolved until a human accepts it
    expect((await unknowns(pid)).summary.blocking).toBe(1);

    const m = await call("POST", `/projects/${pid}/mappings`, { sourceFilename: link.filename, target: link.target, resolvedFilename: "shipping_rates_2026-10.xlsx", reason: "Accepted suggestion (same name apart from date or version)" });
    expect(m.status).toBe(201);
    const after = await unknowns(pid);
    expect(after.items.find((i) => i.category === "link")).toBeUndefined();
    expect(after.summary.blocking).toBe(0);
    const audit = (await call("GET", `/projects/${pid}/audit`)).body.events as { summary: string }[];
    expect(audit.some((e) => e.summary.includes("Mapped shipping_rates.xlsx"))).toBe(true);
  });

  it("reports formulas with no saved result as blocking, with the cells to open", async () => {
    const bytes = writeXlsx(file("nocache.xlsx", [{ sheet: "S", address: "A1", formula: "=1+1", cached: null }, { sheet: "S", address: "A2", formula: "=A1*2", cached: null }]));
    await upload(pid, "nocache.xlsx", bytes);
    const item = (await unknowns(pid)).items.find((i) => i.category === "cache");
    expect(item).toMatchObject({ filename: "nocache.xlsx", severity: "blocking", acknowledgeable: false });
    expect(item.samples).toEqual([{ sheet: "S", address: "A1" }, { sheet: "S", address: "A2" }]);
    // a blocking item cannot be waved through
    const r = await call("POST", `/projects/${pid}/unknowns/ack`, { key: item.id, reason: "ignore it" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("NOT_ACKNOWLEDGEABLE");
  });

  it("detects a circular reference across the project", async () => {
    await upload(pid, "loop.xlsx", writeXlsx(file("loop.xlsx", [{ sheet: "S", address: "A1", formula: "=B1+1", cached: 1 }, { sheet: "S", address: "B1", formula: "=A1+1", cached: 1 }])));
    const item = (await unknowns(pid)).items.find((i) => i.category === "cycle");
    expect(item).toMatchObject({ filename: "loop.xlsx", severity: "blocking", code: "CYCLIC_DEPENDENCY" });
  });

  it("lets a reviewer accept an unsupported feature with a reason, and reopen it", async () => {
    const zip = unzipSync(writeXlsx(file("macro.xlsx", [{ sheet: "S", address: "A1", formula: null, cached: 1 }])));
    zip["xl/vbaProject.bin"] = strToU8("not really vba");
    await upload(pid, "macro.xlsx", zipSync(zip));
    const before = await unknowns(pid);
    const item = before.items.find((i) => i.code === "MACRO_PRESENT");
    expect(item).toMatchObject({ severity: "review", acknowledgeable: true, status: "Unsupported" });

    expect((await call("POST", `/projects/${pid}/unknowns/ack`, { key: item.id, reason: "x" })).status).toBe(400); // a reason is required
    expect((await call("POST", `/projects/${pid}/unknowns/ack`, { key: item.id, reason: "Macro only formats the print layout" })).status).toBe(200);
    const acked = await unknowns(pid);
    const again = acked.items.find((i) => i.id === item.id);
    expect(again.ack).toMatchObject({ reason: "Macro only formats the print layout" });
    expect(acked.summary.review).toBe(before.summary.review - 1);
    expect(acked.summary.acknowledged).toBe(1);

    const exported = (await call("GET", `/projects/${pid}/export?format=md`)).body as string;
    expect(exported).toContain("Accepted limitations");
    expect(exported).toContain("Macro only formats the print layout");

    expect((await call("DELETE", `/projects/${pid}/unknowns/ack?key=${encodeURIComponent(item.id)}`)).status).toBe(200);
    expect((await unknowns(pid)).summary.acknowledged).toBe(0);
  });

  it("lists unconfirmed steps and unapproved baselines as review items that clear when handled", async () => {
    const step = (await call("POST", `/projects/${pid}/steps`, { kind: "manual_copy", instructions: "Paste ERP export", ownerRole: "Estimator", evidence: "Seen on a call", toFilename: "cost_rollup.xlsx", toSheet: "ERP_Import", toAddress: "B2" })).body.step;
    let u = await unknowns(pid);
    expect(u.items.find((i) => i.stepId === step.id)).toMatchObject({ category: "step", status: "User-declared", severity: "review", acknowledgeable: false });
    await call("PATCH", `/projects/${pid}/steps/${step.id}`, { status: "Verified" });
    expect((await unknowns(pid)).items.find((i) => i.stepId === step.id)).toBeUndefined();

    const b = (await call("POST", `/projects/${pid}/baselines`, { name: "Quote", approve: false, assertions: [{ filename: "customer_quote.xlsx", sheet: "Quote", address: "G24", mode: "number" }] })).body.baseline;
    u = await unknowns(pid);
    expect(u.items.find((i) => i.baselineId === b.id)).toMatchObject({ code: "BASELINE_NOT_APPROVED" });
    await call("POST", `/projects/${pid}/baselines/${b.id}/approve`);
    expect((await unknowns(pid)).items.find((i) => i.baselineId === b.id)).toBeUndefined();
  });

  it("flags a baseline whose run was inconclusive, never as a pass", async () => {
    const base = (await call("POST", `/projects/${pid}/baselines`, { name: "Quote total", approve: true, assertions: [{ filename: "customer_quote.xlsx", sheet: "Quote", address: "G24", mode: "number" }] })).body.baseline;
    // someone re-saves the quote without calculating: same formula, no saved result
    const quote = buildDemoFiles().find((f) => f.filename === "customer_quote.xlsx")!;
    const uncalculated = { ...quote, cells: quote.cells.map((c) => ({ ...c, cached: null })) };
    expect((await upload(pid, "customer_quote.xlsx", writeXlsx(uncalculated))).status).toBe(201);

    const run = (await call("POST", `/projects/${pid}/baselines/${base.id}/runs`)).body.run;
    expect(run.status).toBe("INCONCLUSIVE");
    const item = (await unknowns(pid)).items.find((i) => i.baselineId === base.id);
    expect(item).toMatchObject({ category: "test", code: "TEST_INCONCLUSIVE", severity: "review" });
    expect(item.detail).toContain("no saved result");
  });

  it("does not leak another workspace's queue", async () => {
    const owner = cookie;
    cookie = "";
    await call("POST", "/auth/guest");
    expect((await call("GET", `/projects/${pid}/unknowns`)).status).toBe(404);
    cookie = owner;
  });
});
