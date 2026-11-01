// Formula reference extraction. Spreadsheet content is untrusted input: this is a tokenizer, never an evaluator.

export interface Range {
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}

export interface FormulaRef {
  raw: string;
  start: number;
  end: number;
  /** `[1]` style external index (1-based), if any. */
  externalIndex?: number;
  /** `[file.xlsx]` style inline workbook name, if any. */
  workbook?: string;
  sheet?: string;
  range: Range;
}

export function colToNum(col: string): number {
  let n = 0;
  for (const ch of col.replace(/\$/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function parseAddress(a: string): { c: number; r: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(a.toUpperCase());
  if (!m) return null;
  return { c: colToNum(m[1]), r: Number(m[2]) };
}

export function toAddress(c: number, r: number): string {
  return `${numToCol(c)}${r}`;
}

export function rangeToString(r: Range): string {
  const a = toAddress(r.c1, r.r1);
  return r.c1 === r.c2 && r.r1 === r.r2 ? a : `${a}:${toAddress(r.c2, r.r2)}`;
}

export function rangeSize(r: Range): number {
  return (r.c2 - r.c1 + 1) * (r.r2 - r.r1 + 1);
}

export function rangesIntersect(a: Range, b: Range): boolean {
  return a.c1 <= b.c2 && b.c1 <= a.c2 && a.r1 <= b.r2 && b.r1 <= a.r2;
}

export function parseRangeText(text: string): Range | null {
  const [a, b] = text.split(":");
  const p1 = parseAddress(a);
  const p2 = b ? parseAddress(b) : p1;
  if (!p1 || !p2) return null;
  return { c1: Math.min(p1.c, p2.c), r1: Math.min(p1.r, p2.r), c2: Math.max(p1.c, p2.c), r2: Math.max(p1.r, p2.r) };
}

const CELL = String.raw`\$?[A-Z]{1,3}\$?\d+`;
const REF_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_.$])(?:(?:'(?:\[(?<wbq>[^\]]+)\])?(?<qs>(?:[^']|'')+)'|(?:\[(?<wbu>[^\]]+)\])?(?<us>[A-Za-z_][\w.]*))!)?(?<a>${CELL})(?::(?<b>${CELL}))?(?![\w(!])`,
  "g",
);

/** Blank out string literals so their contents are never mistaken for references. */
function maskStrings(f: string): string {
  return f.replace(/"(?:[^"]|"")*"/g, (m) => " ".repeat(m.length));
}

export function tokenizeRefs(formula: string): FormulaRef[] {
  const masked = maskStrings(formula);
  const out: FormulaRef[] = [];
  for (const m of masked.matchAll(REF_RE)) {
    const g = m.groups!;
    const range = parseRangeText(g.b ? `${g.a}:${g.b}` : g.a);
    if (!range) continue;
    const wb = g.wbq ?? g.wbu;
    const ref: FormulaRef = { raw: m[0], start: m.index!, end: m.index! + m[0].length, range };
    if (wb !== undefined) {
      if (/^\d+$/.test(wb)) ref.externalIndex = Number(wb);
      else ref.workbook = wb.split(/[\\/]/).pop();
    }
    const sheet = g.qs ?? g.us;
    if (sheet !== undefined) ref.sheet = sheet.replace(/''/g, "'");
    out.push(ref);
  }
  return out;
}

/** Shift relative parts of every A1 reference, used to expand shared formulas. */
export function translateFormula(formula: string, dCol: number, dRow: number): string {
  if (dCol === 0 && dRow === 0) return formula;
  const masked = maskStrings(formula);
  let out = "";
  let last = 0;
  const cellRe = /(\$?)([A-Z]{1,3})(\$?)(\d+)/g;
  for (const ref of tokenizeRefs(formula)) {
    out += formula.slice(last, ref.start);
    const rawMasked = masked.slice(ref.start, ref.end);
    out += rawMasked.replace(cellRe, (_m, dc: string, col: string, dr: string, row: string) => {
      const c = dc ? col : numToCol(colToNum(col) + dCol);
      const r = dr ? row : String(Number(row) + dRow);
      return `${dc}${c}${dr}${r}`;
    });
    last = ref.end;
  }
  return out + formula.slice(last);
}

const VOLATILE = /\b(NOW|TODAY|RAND|RANDBETWEEN|OFFSET|INDIRECT|INFO|CELL)\s*\(/i;
export function hasVolatile(formula: string): boolean {
  return VOLATILE.test(maskStrings(formula));
}
