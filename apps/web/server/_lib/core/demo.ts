import type { ParsedCell, ParsedFile } from "./types.js";

export interface DemoFile extends ParsedFile {
  filename: string;
}

const lit = (sheet: string, address: string, cached: string | number): ParsedCell => ({ sheet, address, formula: null, cached });
const fx = (sheet: string, address: string, formula: string, cached: number): ParsedCell => ({ sheet, address, formula, cached });

const base = (filename: string, format: "xlsx" | "csv", sheets: string[], cells: ParsedCell[], links: string[] = []): DemoFile => ({
  filename, format,
  sheets: sheets.map((name) => ({ name, hidden: false })),
  cells,
  externalLinks: links.map((target, i) => ({ index: i + 1, target })),
  definedNames: [],
  warnings: links.length ? [{ code: "EXTERNAL_LINKS", severity: "info", message: `References ${links.length} external workbook(s): ${links.join(", ")}`, count: links.length }] : [],
});

/**
 * Synthetic manufacturing quote. 100 units, material 400, labour `labor`, overhead 50, shipping 2000, 20% markup.
 * With labor = 150: cost 62,000, quote 74,400. With labor = 175: cost 64,500, quote 77,400.
 */
export function buildDemoFiles(labor = 150): DemoFile[] {
  const qty = 100, material = 400, overhead = 50, shipping = 2000, markup = 1.2;
  const cost = qty * (material + labor + overhead) + shipping;
  const quote = Math.round(cost * markup * 100) / 100;
  return [
    base("erp_parts_2026-10.csv", "csv", ["CSV"], [lit("CSV", "A1", "sku"), lit("CSV", "B1", "unit_cost"), lit("CSV", "A2", "SKU-100"), lit("CSV", "B2", material)]),
    base("labor_rates.xlsx", "xlsx", ["Rates"], [lit("Rates", "A4", "Machining"), lit("Rates", "C4", labor)]),
    base("overhead_policy.xlsx", "xlsx", ["Policy"], [lit("Policy", "A2", "Overhead per unit"), lit("Policy", "B2", overhead)]),
    base("shipping_rates.xlsx", "xlsx", ["Tiers"], [lit("Tiers", "A7", "100 units, Pune to Chennai"), lit("Tiers", "D7", shipping)]),
    base("quote_inputs.xlsx", "xlsx", ["Inputs", "Exceptions"], [lit("Inputs", "A2", "Quantity"), lit("Inputs", "B2", qty), lit("Inputs", "A3", "Markup (not margin)"), lit("Inputs", "B3", markup), lit("Exceptions", "B9", 0)]),
    base(
      "cost_rollup.xlsx", "xlsx", ["ERP_Import", "Costing"],
      [
        lit("ERP_Import", "A2", "SKU-100"), lit("ERP_Import", "B2", material),
        fx("Costing", "C17", "=ERP_Import!B2", material),
        fx("Costing", "D17", "=[labor_rates.xlsx]Rates!C4", labor),
        fx("Costing", "E17", "=[overhead_policy.xlsx]Policy!B2", overhead),
        fx("Costing", "F17", "=SUM(C17:E17)*[quote_inputs.xlsx]Inputs!B2+[shipping_rates.xlsx]Tiers!D7", cost),
      ],
      ["labor_rates.xlsx", "overhead_policy.xlsx", "quote_inputs.xlsx", "shipping_rates.xlsx"],
    ),
    base("margin_review.xlsx", "xlsx", ["Margin"], [fx("Margin", "C5", "=ROUND([cost_rollup.xlsx]Costing!F17*[quote_inputs.xlsx]Inputs!B3,2)", quote)], ["cost_rollup.xlsx", "quote_inputs.xlsx"]),
    base("customer_quote.xlsx", "xlsx", ["Quote"], [fx("Quote", "G24", "=[margin_review.xlsx]Margin!C5", quote)], ["margin_review.xlsx"]),
  ];
}

/** Files re-saved after the labour rate moved from 150 to 175 (only the ones whose saved values change). */
export const CHANGED_AFTER_LABOR_CHANGE = ["labor_rates.xlsx", "cost_rollup.xlsx", "margin_review.xlsx", "customer_quote.xlsx"];
export const LABOR_BEFORE = 150;
export const LABOR_AFTER = 175;
