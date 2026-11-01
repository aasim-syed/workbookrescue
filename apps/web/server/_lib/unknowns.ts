import { desc, eq, inArray } from "drizzle-orm";
import { schema, type DB } from "./db/client.js";
import { findCycles, resolveWorkbook, type Status } from "./core/graph.js";
import { latestArtifacts, loadContext } from "./store.js";

const { steps, baselines, testRuns, unknownAcks, users } = schema;

export type Category = "link" | "cache" | "unsupported" | "cycle" | "step" | "test";

export interface UnknownItem {
  /** Stable across reloads and file versions, so decisions stick. */
  id: string;
  category: Category;
  code: string;
  status: Status;
  /** blocking: the process can't be called reproducible. review: a human should look. */
  severity: "blocking" | "review";
  title: string;
  detail: string;
  filename?: string;
  sheet?: string;
  address?: string;
  target?: string;
  suggestions?: { filename: string; method: string }[];
  samples?: { sheet: string; address: string }[];
  stepId?: string;
  baselineId?: string;
  acknowledgeable: boolean;
  ack?: { reason: string; by: string; at: string };
}

const UNSUPPORTED: Record<string, string> = {
  MACRO_PRESENT: "Contains VBA macros",
  POWER_QUERY_REFRESH: "Uses data connections or Power Query",
  VOLATILE_FORMULA: "Uses volatile functions",
  DYNAMIC_ARRAY: "Uses array or dynamic formulas",
  PIVOT_UNSUPPORTED: "Contains pivot tables",
  ENCODING_FALLBACK: "Text encoding was guessed",
};

/** `labor_rates_2026-10 (v2).xlsx` and `labor_rates.xlsx` share a stem once dates, versions and copy markers are dropped. */
const stem = (name: string) =>
  name.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/\(.*?\)/g, "").replace(/\b(copy|final|new|old|latest|backup)\b/g, "").replace(/[-_ ]?v?\d[\d\-_.]*/g, "").replace(/[^a-z]+/g, " ").trim();

/** Candidates only. Never applied automatically: a similar name is a hint, not evidence. */
export function suggestFor(target: string, files: string[]): { filename: string; method: string }[] {
  const t = stem(target);
  if (!t) return [];
  const tt = new Set(t.split(" "));
  const out: { filename: string; method: string; score: number }[] = [];
  for (const f of files) {
    const s = stem(f);
    if (!s) continue;
    if (s === t) { out.push({ filename: f, method: "Same name apart from date or version", score: 2 }); continue; }
    const ft = new Set(s.split(" "));
    const inter = [...tt].filter((w) => ft.has(w)).length;
    const jac = inter / (tt.size + ft.size - inter);
    if (jac >= 0.6) out.push({ filename: f, method: "Similar name", score: jac });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3).map(({ filename, method }) => ({ filename, method }));
}

/**
 * Everything that still needs a human decision, in one list. Items disappear when the underlying fact changes
 * (a file is added, a step is confirmed); acknowledged limitations stay listed but stop counting as open.
 */
export async function computeUnknowns(db: DB, projectId: string) {
  const arts = await latestArtifacts(db, projectId);
  const ctx = await loadContext(db, projectId);
  const items: UnknownItem[] = [];
  const names = arts.map((a) => a.filename);

  for (const a of arts) {
    const data = ctx.artifacts.get(a.id)!;
    for (const l of a.externalLinks) {
      if (resolveWorkbook(ctx, data, { externalIndex: l.index }).artifactId) continue;
      items.push({
        id: `link|${a.filename}|${l.target}`, category: "link", code: "EXTERNAL_LINK_UNRESOLVED", status: "Unresolved", severity: "blocking", acknowledgeable: false,
        title: `${l.target} is missing`,
        detail: `${a.filename} reads from it, but no file with that name is in this project. Numbers that depend on it can't be traced.`,
        filename: a.filename, target: l.target,
        suggestions: suggestFor(l.target, names.filter((n) => n !== a.filename)),
      });
    }
    for (const w of a.warnings) {
      if (w.code === "CACHE_MISSING") {
        const samples = [...data.cells.values()].filter((c) => c.formula && c.cached === null).slice(0, 6).map((c) => ({ sheet: c.sheet, address: c.address }));
        items.push({
          id: `cache|${a.filename}`, category: "cache", code: "CACHE_MISSING", status: "Unresolved", severity: "blocking", acknowledgeable: false,
          title: `${a.filename} has formulas with no saved result`,
          detail: `${w.count ?? samples.length} formula cell(s) were never calculated before saving, so tests on them can only be INCONCLUSIVE. Open it in Excel, save it, and upload it again.`,
          filename: a.filename, samples, sheet: samples[0]?.sheet, address: samples[0]?.address,
        });
      } else if (UNSUPPORTED[w.code]) {
        items.push({
          id: `unsupported|${a.filename}|${w.code}`, category: "unsupported", code: w.code, status: "Unsupported", severity: "review", acknowledgeable: true,
          title: `${a.filename}: ${UNSUPPORTED[w.code]}`, detail: w.message, filename: a.filename,
        });
      }
    }
  }

  for (const c of findCycles(ctx)) {
    items.push({
      id: `cycle|${c.filename}|${c.sheet}!${c.address}`, category: "cycle", code: "CYCLIC_DEPENDENCY", status: "Unsupported", severity: "blocking", acknowledgeable: false,
      title: `Circular reference in ${c.filename}`,
      detail: `${c.size} cell(s) depend on each other, starting around ${c.sheet}!${c.address}. These can't be traced or evaluated, and Excel needs iterative calculation to even open them cleanly.`,
      filename: c.filename, sheet: c.sheet, address: c.address,
    });
  }

  const stepRows = await db.select().from(steps).where(eq(steps.projectId, projectId)).orderBy(steps.ordinal);
  for (const s of stepRows.filter((x) => x.status !== "Verified")) {
    items.push({
      id: `step|${s.id}`, category: "step", code: "STEP_UNCONFIRMED", status: "User-declared", severity: "review", acknowledgeable: false,
      title: s.instructions, detail: `Declared by ${s.ownerRole} (${s.evidence}). Nobody has confirmed it yet, so the runbook marks it as declared.`,
      stepId: s.id, filename: s.toFilename ?? undefined, sheet: s.toSheet ?? undefined, address: s.toAddress ?? undefined,
    });
  }

  const bases = await db.select().from(baselines).where(eq(baselines.projectId, projectId));
  const runs = bases.length ? await db.select().from(testRuns).where(inArray(testRuns.baselineId, bases.map((b) => b.id))).orderBy(desc(testRuns.createdAt)) : [];
  for (const b of bases) {
    if (b.approvalStatus !== "approved") {
      items.push({ id: `test|approve|${b.id}`, category: "test", code: "BASELINE_NOT_APPROVED", status: "User-declared", severity: "review", acknowledgeable: false, title: `"${b.name}" isn't approved`, detail: "A baseline can't be run until someone approves its values as the customer-approved ones.", baselineId: b.id });
      continue;
    }
    const last = runs.find((r) => r.baselineId === b.id);
    if (last && ["INCONCLUSIVE", "UNSUPPORTED", "ERROR"].includes(last.status)) {
      const why = (last.results as { reason?: string; outcome?: string }[]).find((r) => r.outcome !== "PASS")?.reason ?? "The last run could not be evaluated.";
      items.push({ id: `test|run|${b.id}`, category: "test", code: `TEST_${last.status}`, status: "Unsupported", severity: "review", acknowledgeable: false, title: `"${b.name}" couldn't be evaluated`, detail: `${why} A test that can't be evaluated is never reported as passing.`, baselineId: b.id });
    }
  }

  const acks = await db.select({ key: unknownAcks.key, reason: unknownAcks.reason, at: unknownAcks.createdAt, email: users.email }).from(unknownAcks).leftJoin(users, eq(users.id, unknownAcks.reviewerId)).where(eq(unknownAcks.projectId, projectId));
  for (const it of items) {
    const a = acks.find((x) => x.key === it.id);
    if (a && it.acknowledgeable) it.ack = { reason: a.reason, by: !a.email ? "a former member" : a.email.endsWith("@guest.local") ? "Guest" : a.email, at: a.at.toISOString() };
  }

  const open = items.filter((i) => !i.ack);
  return {
    items,
    summary: { blocking: open.filter((i) => i.severity === "blocking").length, review: open.filter((i) => i.severity === "review").length, acknowledged: items.length - open.length },
  };
}
