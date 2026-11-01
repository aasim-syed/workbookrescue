import { parseAddress } from "./core/refs.js";
import { writeXlsx } from "./core/xlsxWriter.js";
import type { CachedValue, ExternalLink } from "./core/types.js";

interface FileMeta {
  filename: string;
  format: string;
  sheets: { name: string; hidden: boolean }[];
  externalLinks: ExternalLink[];
}
interface CellRow {
  sheet: string;
  address: string;
  formula: string | null;
  cached: CachedValue;
}

const csvField = (v: CachedValue) => {
  const s = v === null ? "" : String(v);
  // a leading = + - @ would be a formula in Excel; prefix so exports can't inject
  const safe = /^[=+\-@]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Rebuilds a downloadable file from the imported cells. Used when no original is stored (synthetic demo data). */
export function rebuildFile(meta: FileMeta, cells: CellRow[]): { bytes: Uint8Array; contentType: string } {
  if (meta.format === "csv") {
    const grid: string[][] = [];
    for (const c of cells) {
      const p = parseAddress(c.address);
      if (!p) continue;
      (grid[p.r - 1] ??= [])[p.c - 1] = csvField(c.cached);
    }
    const width = Math.max(0, ...grid.map((r) => r?.length ?? 0));
    const text = Array.from({ length: grid.length }, (_, i) => Array.from({ length: width }, (_, j) => grid[i]?.[j] ?? "").join(",")).join("\n") + "\n";
    return { bytes: new TextEncoder().encode(text), contentType: "text/csv; charset=utf-8" };
  }
  const bytes = writeXlsx({ format: "xlsx", sheets: meta.sheets, cells, externalLinks: meta.externalLinks, definedNames: [], warnings: [] });
  return { bytes, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
