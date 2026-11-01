import { buildUpstream, type GraphContext } from "./graph.js";
import type { CachedValue } from "./types.js";

export type Outcome = "PASS" | "FAIL" | "INCONCLUSIVE" | "UNSUPPORTED" | "ERROR";

export interface AssertionSpec {
  id: string;
  filename: string;
  sheet: string;
  address: string;
  mode: "number" | "string" | "nonblank";
  expected: string | null;
  absTolerance: string | null; // stored as text: no float surprises in the manifest
}

export interface ChangedInput {
  filename: string;
  sheet: string;
  address: string;
  kind: "value" | "formula" | "removed";
  was: CachedValue | string;
  now: CachedValue | string;
}

export interface AssertionResult {
  assertionId: string;
  filename: string;
  sheet: string;
  address: string;
  outcome: Outcome;
  code?: string;
  reason: string;
  expected: string | null;
  actual: string | null;
  delta?: string;
  changedInputs: ChangedInput[];
}

const fmt = (v: CachedValue | undefined) => (v === null || v === undefined ? null : String(v));

/**
 * Mode A: compare observed outputs. This says whether saved values moved, never that Excel would calculate the same.
 * `baseline` pins the file versions captured at approval; `current` uses the latest versions.
 */
export function runAssertions(baseline: GraphContext, current: GraphContext, assertions: AssertionSpec[]): AssertionResult[] {
  return assertions.map((a) => {
    const base: AssertionResult = {
      assertionId: a.id, filename: a.filename, sheet: a.sheet, address: a.address,
      outcome: "ERROR", reason: "", expected: a.expected, actual: null, changedInputs: [],
    };
    const curId = current.byFilename.get(a.filename);
    const art = curId ? current.artifacts.get(curId) : undefined;
    if (!art) return { ...base, outcome: "INCONCLUSIVE", code: "FILE_MISSING", reason: `${a.filename} is not in the project` };
    const cell = art.cells.get(`${a.sheet}!${a.address}`);
    if (!cell) return { ...base, outcome: "INCONCLUSIVE", code: "CELL_MISSING", reason: `${a.sheet}!${a.address} is empty or missing in ${a.filename} v${art.version}` };
    if (cell.formula && cell.cached === null) return { ...base, outcome: "INCONCLUSIVE", code: "CACHE_MISSING", reason: "Formula has no saved result and evaluation is not supported" };
    if (cell.formula && /\b(NOW|TODAY|RAND|OFFSET|INDIRECT)\s*\(/i.test(cell.formula)) {
      return { ...base, outcome: "UNSUPPORTED", code: "FORMULA_UNSUPPORTED", reason: "Volatile function in output formula", actual: fmt(cell.cached) };
    }
    const actual = cell.cached;
    base.actual = fmt(actual);

    let outcome: Outcome;
    let reason: string;
    if (a.mode === "nonblank") {
      outcome = actual === null || actual === "" ? "FAIL" : "PASS";
      reason = outcome === "PASS" ? "Output is present" : "Output is blank";
    } else if (a.mode === "string") {
      outcome = String(actual).trim() === String(a.expected ?? "").trim() ? "PASS" : "FAIL";
      reason = outcome === "PASS" ? "Text matches" : "Text differs";
    } else {
      const exp = Number(a.expected);
      const act = typeof actual === "number" ? actual : Number(actual);
      if (!Number.isFinite(exp) || !Number.isFinite(act)) {
        return { ...base, outcome: "INCONCLUSIVE", code: "NOT_NUMERIC", reason: "Expected or actual value is not a number" };
      }
      const tol = Number(a.absTolerance ?? "0") || 0;
      const delta = act - exp;
      base.delta = delta.toFixed(4).replace(/\.?0+$/, "");
      outcome = Math.abs(delta) <= tol + 1e-9 ? "PASS" : "FAIL";
      reason = outcome === "PASS" ? `Within ±${tol}` : `Off by ${base.delta} (tolerance ±${tol})`;
    }

    // on failure, walk both lineages and report which upstream cells moved
    const changed: ChangedInput[] = [];
    if (outcome === "FAIL") {
      const baseId = baseline.byFilename.get(a.filename);
      if (baseId) {
        const g = buildUpstream(baseline, { artifactId: baseId, sheet: a.sheet, address: a.address });
        for (const n of g.nodes) {
          if (n.kind !== "cell" || n.id === g.root) continue;
          const curArtId = current.byFilename.get(n.filename);
          const ca = curArtId ? current.artifacts.get(curArtId) : undefined;
          const cc = ca?.cells.get(`${n.sheet}!${n.address}`);
          if (!cc) { changed.push({ filename: n.filename, sheet: n.sheet, address: n.address, kind: "removed", was: n.cached, now: null }); continue; }
          if ((cc.formula ?? null) !== (n.formula ?? null)) changed.push({ filename: n.filename, sheet: n.sheet, address: n.address, kind: "formula", was: n.formula, now: cc.formula });
          else if (cc.cached !== n.cached) changed.push({ filename: n.filename, sheet: n.sheet, address: n.address, kind: "value", was: n.cached, now: cc.cached });
        }
      }
    }
    return { ...base, outcome, reason, changedInputs: changed };
  });
}

export function overall(results: AssertionResult[]): Outcome {
  if (results.some((r) => r.outcome === "FAIL")) return "FAIL";
  if (results.some((r) => r.outcome === "ERROR")) return "ERROR";
  if (results.some((r) => r.outcome === "UNSUPPORTED")) return "UNSUPPORTED";
  if (results.some((r) => r.outcome === "INCONCLUSIVE") || results.length === 0) return "INCONCLUSIVE";
  return "PASS";
}
