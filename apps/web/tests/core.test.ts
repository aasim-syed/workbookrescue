import { describe, expect, it } from "vitest";
import { tokenizeRefs, translateFormula } from "../server/_lib/core/refs.js";
import { parseXlsx } from "../server/_lib/core/xlsx.js";
import { parseCsv } from "../server/_lib/core/csv.js";
import { writeXlsx } from "../server/_lib/core/xlsxWriter.js";
import { buildDemoFiles } from "../server/_lib/core/demo.js";
import { buildUpstream, findOutputs, type ArtifactData, type GraphContext } from "../server/_lib/core/graph.js";
import { runAssertions, overall } from "../server/_lib/core/compare.js";

function ctxFrom(files: ReturnType<typeof buildDemoFiles>, tag: string): GraphContext {
  const artifacts = new Map<string, ArtifactData>();
  const byFilename = new Map<string, string>();
  for (const f of files) {
    const parsed = f.format === "csv" ? f : parseXlsx(writeXlsx(f));
    const id = `${tag}-${f.filename}`;
    artifacts.set(id, { id, filename: f.filename, version: 1, sheets: parsed.sheets.map((s) => s.name), externalLinks: parsed.externalLinks, cells: new Map(parsed.cells.map((c) => [`${c.sheet}!${c.address}`, c])) });
    byFilename.set(f.filename, id);
  }
  return { artifacts, byFilename, mappings: new Map(), manualEdges: [] };
}

describe("references", () => {
  it("finds cell, range, sheet and external refs, ignoring strings", () => {
    const refs = tokenizeRefs(`=SUM(C17:E17)*$B$3+'My Sheet'!A1+[2]Rates!C4+[lab.xlsx]S!D1&"A1"`);
    expect(refs.map((r) => r.raw)).toEqual(["C17:E17", "$B$3", "'My Sheet'!A1", "[2]Rates!C4", "[lab.xlsx]S!D1"]);
    expect(refs[3].externalIndex).toBe(2);
    expect(refs[4].workbook).toBe("lab.xlsx");
    expect(refs[2].sheet).toBe("My Sheet");
  });
  it("does not treat functions as refs", () => {
    expect(tokenizeRefs("=LOG10(A1)+ATAN2(B2,C3)").map((r) => r.raw)).toEqual(["A1", "B2", "C3"]);
  });
  it("translates shared formulas", () => {
    expect(translateFormula("=A1+$B$1+C1", 0, 2)).toBe("=A3+$B$1+C3");
  });
});

describe("import", () => {
  it("round-trips formulas, cached values and external links", () => {
    const f = buildDemoFiles().find((x) => x.filename === "cost_rollup.xlsx")!;
    const p = parseXlsx(writeXlsx(f));
    const c = p.cells.find((x) => x.address === "F17")!;
    expect(c.cached).toBe(62000);
    expect(c.formula).toContain("[3]Inputs!B2");
    expect(p.externalLinks.map((l) => l.target)).toContain("shipping_rates.xlsx");
  });
  it("rejects non-xlsx bytes", () => {
    expect(() => parseXlsx(new TextEncoder().encode("hello"))).toThrow();
  });
  it("keeps csv formulas as text", () => {
    const p = parseCsv(new TextEncoder().encode("a,b\n=1+1,2\n"));
    expect(p.cells.find((c) => c.address === "A2")).toMatchObject({ formula: null, cached: "=1+1" });
  });
});

describe("lineage and regression", () => {
  const before = ctxFrom(buildDemoFiles(150), "a");
  const quote = before.byFilename.get("customer_quote.xlsx")!;

  it("traces the quote back to the labour rate", () => {
    const g = buildUpstream(before, { artifactId: quote, sheet: "Quote", address: "G24" });
    const ids = g.nodes.map((n) => `${n.filename}::${n.sheet}!${n.address}`);
    expect(ids).toContain("labor_rates.xlsx::Rates!C4");
    expect(g.unknowns).toEqual([]);
  });
  it("flags a missing external file as unresolved, never inferred", () => {
    const files = buildDemoFiles().filter((f) => f.filename !== "shipping_rates.xlsx");
    const ctx = ctxFrom(files, "b");
    const g = buildUpstream(ctx, { artifactId: ctx.byFilename.get("customer_quote.xlsx")!, sheet: "Quote", address: "G24" });
    expect(g.unknowns.map((u) => u.code)).toContain("EXTERNAL_LINK_UNRESOLVED");
  });
  it("suggests the quote as the output", () => {
    expect(findOutputs(before)[0]).toMatchObject({ filename: "customer_quote.xlsx", address: "G24" });
  });
  it("FAILs when labour changes and names the moved input", () => {
    const after = ctxFrom(buildDemoFiles(175), "c");
    const res = runAssertions(before, after, [{ id: "1", filename: "customer_quote.xlsx", sheet: "Quote", address: "G24", mode: "number", expected: "74400", absTolerance: "0.01" }]);
    expect(overall(res)).toBe("FAIL");
    expect(res[0].actual).toBe("77400");
    expect(res[0].changedInputs.map((c) => `${c.filename}::${c.address}`)).toContain("labor_rates.xlsx::C4");
  });
  it("PASSes when nothing changed and is INCONCLUSIVE without a cached value", () => {
    const same = ctxFrom(buildDemoFiles(150), "d");
    const spec = { id: "1", filename: "customer_quote.xlsx", sheet: "Quote", address: "G24", mode: "number" as const, expected: "74400", absTolerance: "0.01" };
    expect(overall(runAssertions(before, same, [spec]))).toBe("PASS");
    same.artifacts.get(same.byFilename.get("customer_quote.xlsx")!)!.cells.get("Quote!G24")!.cached = null;
    expect(overall(runAssertions(before, same, [spec]))).toBe("INCONCLUSIVE");
  });
});
