import { parseRangeText, rangeSize, rangesIntersect, rangeToString, tokenizeRefs, toAddress, type Range } from "./refs.js";
import type { CachedValue, ExternalLink, ParsedCell } from "./types.js";

export type Status = "Verified" | "User-declared" | "Inferred" | "Unresolved" | "Unsupported";

export interface ArtifactData {
  id: string;
  filename: string;
  version: number;
  sheets: string[];
  externalLinks: ExternalLink[];
  cells: Map<string, ParsedCell>; // key: `${sheet}!${address}`
}

export interface ManualEdge {
  id: string;
  kind: string; // manual_copy | export_import | override | documented_handoff
  label: string;
  owner: string | null;
  status: Status; // User-declared, or Verified once a reviewer confirms
  fromArtifactId: string | null;
  fromSheet: string | null;
  fromAddress: string | null;
  toArtifactId: string | null;
  toSheet: string | null;
  toAddress: string | null;
}

export interface GraphContext {
  artifacts: Map<string, ArtifactData>;
  /** filename → artifact id (latest versions, or pinned versions for a baseline). */
  byFilename: Map<string, string>;
  /** `${artifactId}|${link target}` → artifact id chosen by a reviewer. */
  mappings: Map<string, string>;
  manualEdges: ManualEdge[];
}

export interface GNode {
  id: string;
  kind: "cell" | "range" | "file" | "unresolved";
  role: "output" | "formula" | "input" | "range" | "file" | "unresolved";
  artifactId: string | null;
  filename: string;
  sheet: string;
  address: string;
  formula: string | null;
  cached: CachedValue;
  status: Status;
  note?: string;
}

export interface GEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  status: Status;
  method: string;
  label?: string;
}

export interface Unknown {
  code: string;
  status: Status;
  message: string;
  artifactId?: string;
  filename?: string;
  target?: string;
  nodeId?: string;
}

export interface Graph {
  root: string;
  nodes: GNode[];
  edges: GEdge[];
  unknowns: Unknown[];
  truncated: boolean;
}

export const nodeId = (artifactId: string, sheet: string, address: string) => `${artifactId}:${sheet}!${address}`;
const key = (sheet: string, address: string) => `${sheet}!${address}`;

export function resolveWorkbook(
  ctx: GraphContext,
  art: ArtifactData,
  ref: { externalIndex?: number; workbook?: string },
): { artifactId: string | null; target: string | null; method: string } {
  if (ref.externalIndex === undefined && ref.workbook === undefined) return { artifactId: art.id, target: null, method: "same_workbook" };
  const target = ref.workbook ?? art.externalLinks.find((l) => l.index === ref.externalIndex)?.target ?? null;
  if (!target) return { artifactId: null, target: `[${ref.externalIndex}]`, method: "missing_link_table" };
  const mapped = ctx.mappings.get(`${art.id}|${target}`);
  if (mapped && ctx.artifacts.has(mapped)) return { artifactId: mapped, target, method: "reviewer_mapping" };
  const byName = ctx.byFilename.get(target);
  if (byName && ctx.artifacts.has(byName)) return { artifactId: byName, target, method: "filename_match" };
  return { artifactId: null, target, method: "unresolved" };
}

export function buildUpstream(
  ctx: GraphContext,
  start: { artifactId: string; sheet: string; address: string },
  maxNodes = 400,
): Graph {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const unknowns: Unknown[] = [];
  const state = new Map<string, "visiting" | "done">();
  let truncated = false;

  const addEdge = (from: string, to: string, type: string, status: Status, method: string, label?: string) => {
    const id = `${from}->${to}`;
    if (!edges.has(id)) edges.set(id, { id, from, to, type, status, method, label });
  };

  const cellNode = (art: ArtifactData, sheet: string, address: string, role?: GNode["role"]): GNode => {
    const id = nodeId(art.id, sheet, address);
    let n = nodes.get(id);
    if (!n) {
      const c = art.cells.get(key(sheet, address));
      n = {
        id, kind: "cell", artifactId: art.id, filename: art.filename, sheet, address,
        formula: c?.formula ?? null, cached: c?.cached ?? null, status: "Verified",
        role: role ?? (c?.formula ? "formula" : "input"),
      };
      if (!c) n.note = "Cell is empty in this version";
      nodes.set(id, n);
    }
    return n;
  };

  const visit = (art: ArtifactData, sheet: string, address: string, role?: GNode["role"]): string => {
    const node = cellNode(art, sheet, address, role);
    if (state.has(node.id)) {
      if (state.get(node.id) === "visiting") unknowns.push({ code: "CYCLIC_DEPENDENCY", status: "Unsupported", message: `Circular reference through ${art.filename}::${sheet}!${address}`, artifactId: art.id, nodeId: node.id });
      return node.id;
    }
    state.set(node.id, "visiting");
    const cell = art.cells.get(key(sheet, address));
    if (cell?.formula && nodes.size < maxNodes) {
      for (const ref of tokenizeRefs(cell.formula)) {
        const res = resolveWorkbook(ctx, art, ref);
        const tsheet = ref.sheet ?? sheet;
        if (!res.artifactId) {
          const uid = `unresolved:${art.id}:${res.target}`;
          if (!nodes.has(uid)) {
            nodes.set(uid, { id: uid, kind: "unresolved", role: "unresolved", artifactId: null, filename: res.target ?? "?", sheet: tsheet, address: rangeToString(ref.range), formula: null, cached: null, status: "Unresolved", note: "No file in this project matches this link" });
            unknowns.push({ code: "EXTERNAL_LINK_UNRESOLVED", status: "Unresolved", message: `${art.filename} links to ${res.target}, which isn't in this project`, artifactId: art.id, filename: art.filename, target: res.target ?? undefined, nodeId: uid });
          }
          addEdge(uid, node.id, "external_workbook_reference", "Unresolved", res.method);
          continue;
        }
        const tart = ctx.artifacts.get(res.artifactId)!;
        const type = tart.id === art.id ? "formula_reference" : "external_workbook_reference";
        if (!tart.sheets.includes(tsheet) && tart.sheets.length) {
          unknowns.push({ code: "SHEET_MISSING", status: "Unresolved", message: `${tart.filename} has no sheet "${tsheet}"`, artifactId: tart.id });
        }
        if (rangeSize(ref.range) === 1) {
          const tid = visit(tart, tsheet, toAddress(ref.range.c1, ref.range.r1));
          addEdge(tid, node.id, type, "Verified", res.method);
        } else {
          const rid = nodeId(tart.id, tsheet, rangeToString(ref.range));
          if (!nodes.has(rid)) {
            nodes.set(rid, { id: rid, kind: "range", role: "range", artifactId: tart.id, filename: tart.filename, sheet: tsheet, address: rangeToString(ref.range), formula: null, cached: null, status: "Verified", note: `${rangeSize(ref.range)} cells` });
          }
          addEdge(rid, node.id, type, "Verified", res.method);
          if (rangeSize(ref.range) <= 64) {
            for (let r = ref.range.r1; r <= ref.range.r2; r++)
              for (let c = ref.range.c1; c <= ref.range.c2; c++) {
                const a = toAddress(c, r);
                if (tart.cells.has(key(tsheet, a))) addEdge(visit(tart, tsheet, a), rid, "formula_reference", "Verified", "range_member");
              }
          } else {
            truncated = true; // large ranges stay as a single range node
          }
        }
      }
    } else if (cell?.formula) truncated = true;
    state.set(node.id, "done");
    return node.id;
  };

  const art = ctx.artifacts.get(start.artifactId);
  const rootId = nodeId(start.artifactId, start.sheet, start.address);
  if (!art) return { root: rootId, nodes: [], edges: [], unknowns: [], truncated: false };
  visit(art, start.sheet, start.address, "output");

  // reviewer-declared handoffs attach wherever their target is part of this lineage
  for (const m of ctx.manualEdges) {
    if (!m.toArtifactId) continue;
    const toRange: Range | null = m.toAddress ? parseRangeText(m.toAddress) : null;
    const hit = [...nodes.values()].filter((n) => {
      if (n.artifactId !== m.toArtifactId || n.kind === "unresolved") return false;
      if (m.toSheet && n.sheet !== m.toSheet) return false;
      if (!toRange) return true;
      const nr = parseRangeText(n.address);
      return !!nr && rangesIntersect(nr, toRange);
    });
    if (!hit.length) continue;
    let fromId: string;
    const fromArt = m.fromArtifactId ? ctx.artifacts.get(m.fromArtifactId) : null;
    if (fromArt && m.fromAddress && m.fromSheet) {
      fromId = cellNode(fromArt, m.fromSheet, m.fromAddress).id;
    } else {
      fromId = `file:${m.id}`;
      nodes.set(fromId, {
        id: fromId, kind: "file", role: "file", artifactId: fromArt?.id ?? null, filename: fromArt?.filename ?? m.label,
        sheet: "", address: "", formula: null, cached: null, status: m.status, note: m.owner ? `Owner: ${m.owner}` : undefined,
      });
    }
    for (const h of hit) addEdge(fromId, h.id, m.kind, m.status, "declared", m.label);
  }

  return { root: rootId, nodes: [...nodes.values()], edges: [...edges.values()], unknowns, truncated };
}

/** Formula cells nothing else refers to: the likely deliverables of the process. */
export function findOutputs(ctx: GraphContext, limit = 100): { artifactId: string; filename: string; sheet: string; address: string; cached: CachedValue }[] {
  const latest = new Set(ctx.byFilename.values());
  const referenced = new Map<string, Range[]>(); // `${artifactId}|${sheet}` → ranges
  const formulaCells: { art: ArtifactData; cell: ParsedCell }[] = [];
  for (const art of ctx.artifacts.values()) {
    if (!latest.has(art.id)) continue;
    for (const cell of art.cells.values()) {
      if (!cell.formula) continue;
      formulaCells.push({ art, cell });
      for (const ref of tokenizeRefs(cell.formula)) {
        const res = resolveWorkbook(ctx, art, ref);
        if (!res.artifactId) continue;
        const k = `${res.artifactId}|${ref.sheet ?? cell.sheet}`;
        (referenced.get(k) ?? referenced.set(k, []).get(k)!).push(ref.range);
      }
    }
  }
  const out = formulaCells.filter(({ art, cell }) => {
    const p = cell.address.match(/^([A-Z]+)(\d+)$/)!;
    const rs = referenced.get(`${art.id}|${cell.sheet}`);
    if (!rs) return true;
    const pos = parseRangeText(cell.address)!;
    return !rs.some((r) => rangesIntersect(r, pos)) && !!p;
  });
  // files nobody links to first (the deliverables), then by position
  const linkedFiles = new Set<string>();
  for (const k of referenced.keys()) linkedFiles.add(k.split("|")[0]);
  out.sort((a, b) => Number(linkedFiles.has(a.art.id)) - Number(linkedFiles.has(b.art.id)) || a.art.filename.localeCompare(b.art.filename));
  return out.slice(0, limit).map(({ art, cell }) => ({ artifactId: art.id, filename: art.filename, sheet: cell.sheet, address: cell.address, cached: cell.cached }));
}

/**
 * Circular references anywhere in the project, not just under one output.
 * Strongly connected components over formula cells (Tarjan, iterative so deep chains can't overflow the stack).
 * Ranges larger than 64 cells are not expanded, so a cycle hidden behind one will not be found.
 */
export function findCycles(ctx: GraphContext, maxFormulaCells = 20000): { artifactId: string; filename: string; sheet: string; address: string; size: number }[] {
  const adj = new Map<string, string[]>();
  const info = new Map<string, { artifactId: string; filename: string; sheet: string; address: string }>();
  const latest = new Set(ctx.byFilename.values());
  let formulas = 0;
  for (const art of ctx.artifacts.values()) {
    if (!latest.has(art.id)) continue;
    for (const cell of art.cells.values()) {
      if (!cell.formula || ++formulas > maxFormulaCells) continue;
      const id = nodeId(art.id, cell.sheet, cell.address);
      info.set(id, { artifactId: art.id, filename: art.filename, sheet: cell.sheet, address: cell.address });
      const out: string[] = [];
      for (const ref of tokenizeRefs(cell.formula)) {
        const res = resolveWorkbook(ctx, art, ref);
        const tart = res.artifactId ? ctx.artifacts.get(res.artifactId) : undefined;
        if (!tart || rangeSize(ref.range) > 64) continue;
        const sheet = ref.sheet ?? cell.sheet;
        for (let r = ref.range.r1; r <= ref.range.r2; r++)
          for (let c = ref.range.c1; c <= ref.range.c2; c++) {
            const a = toAddress(c, r);
            if (tart.cells.get(key(sheet, a))?.formula) out.push(nodeId(tart.id, sheet, a));
          }
      }
      adj.set(id, out);
    }
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const found: { artifactId: string; filename: string; sheet: string; address: string; size: number }[] = [];
  let counter = 0;
  for (const start of adj.keys()) {
    if (index.has(start)) continue;
    const work: { v: string; i: number }[] = [{ v: start, i: 0 }];
    index.set(start, counter); low.set(start, counter++); stack.push(start); onStack.add(start);
    while (work.length) {
      const top = work[work.length - 1];
      const nbrs = adj.get(top.v) ?? [];
      if (top.i < nbrs.length) {
        const w = nbrs[top.i++];
        if (!adj.has(w)) continue;
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter++); stack.push(w); onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) low.set(top.v, Math.min(low.get(top.v)!, index.get(w)!));
      } else {
        work.pop();
        if (work.length) { const p = work[work.length - 1].v; low.set(p, Math.min(low.get(p)!, low.get(top.v)!)); }
        if (low.get(top.v) === index.get(top.v)) {
          const comp: string[] = [];
          let w: string;
          do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== top.v);
          if (comp.length > 1 || (adj.get(top.v) ?? []).includes(top.v)) {
            comp.sort();
            found.push({ ...info.get(comp[0])!, size: comp.length });
          }
        }
      }
    }
  }
  return found;
}
