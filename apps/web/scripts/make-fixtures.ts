// Writes the synthetic demo workbooks as real .xlsx/.csv files so the upload path can be tried with them.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildDemoFiles, LABOR_AFTER } from "../server/_lib/core/demo.js";
import { writeXlsx } from "../server/_lib/core/xlsxWriter.js";

const root = path.resolve(process.cwd(), "../../fixtures/manufacturing_quote");
for (const [dir, labor] of [["inputs", 150], ["scenarios/labor_rate_changed", LABOR_AFTER]] as const) {
  mkdirSync(path.join(root, dir), { recursive: true });
  for (const f of buildDemoFiles(labor)) {
    if (labor !== 150 && !["labor_rates.xlsx", "cost_rollup.xlsx", "margin_review.xlsx", "customer_quote.xlsx"].includes(f.filename)) continue;
    const out = path.join(root, dir, f.filename);
    if (f.format === "csv") writeFileSync(out, "sku,unit_cost\nSKU-100," + f.cells.find((c) => c.address === "B2")!.cached + "\n");
    else writeFileSync(out, writeXlsx(f));
  }
}
console.log("Fixtures written to", root);
