import { toAddress } from "./refs.js";
import { ImportError, LIMITS, type ParsedCell, type ParsedFile, type Warning } from "./types.js";

function parseRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** CSV cells are always literals. A leading `=` is kept as text, never treated as a formula. */
export function parseCsv(bytes: Uint8Array): ParsedFile {
  const warnings: Warning[] = [];
  let src: string;
  try {
    src = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    src = new TextDecoder("latin1").decode(bytes);
    warnings.push({ code: "ENCODING_FALLBACK", severity: "warning", message: "File is not valid UTF-8; decoded as Latin-1." });
  }
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const cells: ParsedCell[] = [];
  parseRows(src).forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === "") return;
      const n = Number(v);
      cells.push({ sheet: "CSV", address: toAddress(c + 1, r + 1), formula: null, cached: v.trim() !== "" && Number.isFinite(n) ? n : v });
    }),
  );
  if (cells.length > LIMITS.maxCells) throw new ImportError("TOO_MANY_CELLS", `More than ${LIMITS.maxCells} non-empty cells`);
  return { format: "csv", sheets: [{ name: "CSV", hidden: false }], cells, externalLinks: [], definedNames: [], warnings };
}
