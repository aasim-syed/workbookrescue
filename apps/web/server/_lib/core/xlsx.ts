import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { hasVolatile, parseAddress, toAddress, translateFormula } from "./refs.js";
import { ImportError, LIMITS, type ExternalLink, type ParsedCell, type ParsedFile, type Warning } from "./types.js";

const ARRAY_TAGS = new Set(["row", "c", "si", "sheet", "r", "definedName", "Relationship", "externalReference"]);
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ARRAY_TAGS.has(name),
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
});

const text = (n: unknown): string => {
  if (n == null) return "";
  if (typeof n === "string") return n;
  if (typeof n === "number") return String(n);
  const o = n as Record<string, unknown>;
  return o["#text"] != null ? String(o["#text"]) : "";
};

function parseSharedStrings(root: any): string[] {
  const sis: any[] = root?.sst?.si ?? [];
  return sis.map((si) => {
    if (si.t !== undefined) return text(si.t);
    const runs: any[] = si.r ?? [];
    return runs.map((r) => text(r.t)).join("");
  });
}

function normPath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function relsOf(files: Record<string, Uint8Array>, relsPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const raw = files[relsPath];
  if (!raw) return map;
  const doc: any = xml.parse(strFromU8(raw));
  for (const r of doc?.Relationships?.Relationship ?? []) map.set(r["@_Id"], r["@_Target"]);
  return map;
}

function cellValue(c: any, shared: string[]): ParsedCell["cached"] {
  const t = c["@_t"];
  const v = c.v !== undefined ? text(c.v) : undefined;
  if (t === "inlineStr") return text(c.is?.t ?? (c.is?.r ?? []).map((r: any) => text(r.t)).join(""));
  if (v === undefined || v === "") return null;
  if (t === "s") return shared[Number(v)] ?? null;
  if (t === "b") return v === "1";
  if (t === "e" || t === "str") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

export function parseXlsx(bytes: Uint8Array): ParsedFile {
  const wanted = (name: string) =>
    name === "xl/workbook.xml" ||
    name === "xl/_rels/workbook.xml.rels" ||
    name === "xl/sharedStrings.xml" ||
    /^xl\/worksheets\/[^/]+\.xml$/.test(name) ||
    /^xl\/externalLinks\/(_rels\/)?[^/]+\.(xml|rels)$/.test(name) ||
    name === "xl/vbaProject.bin" ||
    name === "xl/connections.xml" ||
    name.startsWith("xl/queries/") ||
    name.startsWith("customXml/") ||
    name.startsWith("xl/pivotCache/");

  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > LIMITS.maxUncompressedBytes) throw new ImportError("ARCHIVE_TOO_LARGE", "Archive expands beyond the safe limit");
        return wanted(f.name) && f.originalSize < 40 * 1024 * 1024;
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError("IMPORT_UNSUPPORTED_FORMAT", "Not a valid .xlsx/.xlsm file");
  }
  if (!files["xl/workbook.xml"]) throw new ImportError("IMPORT_UNSUPPORTED_FORMAT", "Missing xl/workbook.xml; is this a .xls or other format?");

  const warnings: Warning[] = [];
  const wb: any = xml.parse(strFromU8(files["xl/workbook.xml"]));
  const wbRels = relsOf(files, "xl/_rels/workbook.xml.rels");
  const shared = files["xl/sharedStrings.xml"] ? parseSharedStrings(xml.parse(strFromU8(files["xl/sharedStrings.xml"]))) : [];

  // external links, in workbook order: `[1]` refers to the first
  const externalLinks: ExternalLink[] = [];
  (wb.workbook?.externalReferences?.externalReference ?? []).forEach((er: any, i: number) => {
    const target = wbRels.get(er["@_r:id"]);
    if (!target) return;
    const path = normPath("xl/workbook.xml", target);
    const rels = relsOf(files, path.replace(/([^/]+)$/, "_rels/$1.rels"));
    const ext = [...rels.values()][0];
    const name = ext ? decodeURIComponent(ext).split(/[\\/]/).pop()! : `external-${i + 1}`;
    externalLinks.push({ index: i + 1, target: name });
  });

  const definedNames = (wb.workbook?.definedNames?.definedName ?? []).map((d: any) => ({ name: d["@_name"], ref: text(d) }));
  if (files["xl/vbaProject.bin"]) {
    warnings.push({ code: "MACRO_PRESENT", severity: "warning", message: "Workbook contains VBA macros. They were not read or executed." });
  }
  if (files["xl/connections.xml"] || Object.keys(files).some((f) => f.startsWith("xl/queries/"))) {
    warnings.push({ code: "POWER_QUERY_REFRESH", severity: "warning", message: "Data connections or Power Query present. Refresh is not performed; values are as last saved." });
  }
  if (Object.keys(files).some((f) => f.startsWith("xl/pivotCache/"))) {
    warnings.push({ code: "PIVOT_UNSUPPORTED", severity: "info", message: "Pivot tables are present and not analysed." });
  }

  const sheets: ParsedFile["sheets"] = [];
  const cells: ParsedCell[] = [];
  let volatile = 0;
  let missingCache = 0;
  let dynamic = 0;

  for (const s of wb.workbook?.sheets?.sheet ?? []) {
    const name: string = s["@_name"];
    sheets.push({ name, hidden: s["@_state"] === "hidden" || s["@_state"] === "veryHidden" });
    const target = wbRels.get(s["@_r:id"]);
    const path = target ? normPath("xl/workbook.xml", target) : "";
    const raw = files[path];
    if (!raw) continue;
    const doc: any = xml.parse(strFromU8(raw));
    const masters = new Map<string, { formula: string; c: number; r: number }>();

    for (const row of doc.worksheet?.sheetData?.row ?? []) {
      for (const c of row.c ?? []) {
        const address: string = c["@_r"];
        let formula: string | null = null;
        if (c.f !== undefined) {
          const f = c.f;
          const ftext = text(f);
          const t = typeof f === "object" ? f["@_t"] : undefined;
          const si = typeof f === "object" ? f["@_si"] : undefined;
          const pos = parseAddress(address);
          if (t === "shared" && si !== undefined && pos) {
            if (ftext) {
              masters.set(si, { formula: ftext, c: pos.c, r: pos.r });
              formula = ftext;
            } else {
              const m = masters.get(si);
              if (m) formula = translateFormula(m.formula, pos.c - m.c, pos.r - m.r);
            }
          } else if (ftext) formula = ftext;
          if (typeof f === "object" && (f["@_t"] === "array" || c["@_cm"])) dynamic++;
        }
        const cached = cellValue(c, shared);
        if (formula === null && cached === null) continue;
        if (formula !== null) {
          if (hasVolatile(formula)) volatile++;
          if (cached === null) missingCache++;
        }
        cells.push({ sheet: name, address, formula: formula ? "=" + formula : null, cached });
        if (cells.length > LIMITS.maxCells) throw new ImportError("TOO_MANY_CELLS", `More than ${LIMITS.maxCells} non-empty cells`);
      }
    }
  }

  if (externalLinks.length) {
    warnings.push({ code: "EXTERNAL_LINKS", severity: "info", message: `References ${externalLinks.length} external workbook(s): ${externalLinks.map((l) => l.target).join(", ")}`, count: externalLinks.length });
  }
  if (volatile) warnings.push({ code: "VOLATILE_FORMULA", severity: "warning", message: `${volatile} formula(s) use volatile functions and cannot be evaluated deterministically.`, count: volatile });
  if (missingCache) warnings.push({ code: "CACHE_MISSING", severity: "warning", message: `${missingCache} formula cell(s) have no cached value. Comparisons on them will be INCONCLUSIVE.`, count: missingCache });
  if (dynamic) warnings.push({ code: "DYNAMIC_ARRAY", severity: "warning", message: `${dynamic} array/dynamic formula(s) are not expanded.`, count: dynamic });

  return { format: "xlsx", sheets, cells, externalLinks, definedNames, warnings };
}

export { toAddress };
