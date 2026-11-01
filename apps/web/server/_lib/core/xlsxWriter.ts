import { strToU8, zipSync } from "fflate";
import type { ParsedFile } from "./types.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Minimal .xlsx writer: formulas with saved results, inline strings and an external-link table. Used for fixtures and tests. */
export function writeXlsx(file: ParsedFile): Uint8Array {
  const parts: Record<string, Uint8Array> = {};
  const add = (name: string, body: string) => (parts[name] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`));
  const sheets = file.sheets.map((s) => s.name);
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  add(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}${file.externalLinks.map((l) => `<Override PartName="/xl/externalLinks/externalLink${l.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>`).join("")}</Types>`,
  );
  add("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);

  const sheetRels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
  const extRels = file.externalLinks.map((l) => `<Relationship Id="rIdE${l.index}" Type="${rel}/externalLink" Target="externalLinks/externalLink${l.index}.xml"/>`);
  add("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...sheetRels, ...extRels].join("")}</Relationships>`);
  add(
    "xl/workbook.xml",
    `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${file.externalLinks.length ? `<externalReferences>${file.externalLinks.map((l) => `<externalReference r:id="rIdE${l.index}"/>`).join("")}</externalReferences>` : ""}</workbook>`,
  );

  for (const l of file.externalLinks) {
    add(`xl/externalLinks/externalLink${l.index}.xml`, `<externalLink xmlns="${ns}"><externalBook xmlns:r="${rel}" r:id="rId1"/></externalLink>`);
    add(`xl/externalLinks/_rels/externalLink${l.index}.xml.rels`, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/externalLinkPath" Target="${esc(l.target)}" TargetMode="External"/></Relationships>`);
  }

  sheets.forEach((name, i) => {
    const rows = new Map<number, string[]>();
    for (const c of file.cells.filter((x) => x.sheet === name)) {
      const rowNum = Number(/\d+/.exec(c.address)![0]);
      let formula = c.formula?.replace(/^=/, "") ?? null;
      if (formula) for (const l of file.externalLinks) formula = formula.split(`[${l.target}]`).join(`[${l.index}]`);
      const v = c.cached;
      let attrs = "";
      let inner = "";
      if (formula !== null) {
        inner += `<f>${esc(formula)}</f>`;
        if (typeof v === "string") { attrs = ' t="str"'; inner += `<v>${esc(v)}</v>`; }
        else if (v !== null) inner += `<v>${v}</v>`;
      } else if (typeof v === "string") { attrs = ' t="inlineStr"'; inner = `<is><t>${esc(v)}</t></is>`; }
      else if (v !== null) inner = `<v>${v}</v>`;
      (rows.get(rowNum) ?? rows.set(rowNum, []).get(rowNum)!).push(`<c r="${c.address}"${attrs}>${inner}</c>`);
    }
    const body = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) => `<row r="${r}">${cs.join("")}</row>`).join("");
    add(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="${ns}"><sheetData>${body}</sheetData></worksheet>`);
  });
  return zipSync(parts);
}
