export type CachedValue = number | string | boolean | null;

export interface ParsedCell {
  sheet: string;
  address: string;
  formula: string | null;
  cached: CachedValue;
}

export interface Warning {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  sheet?: string;
  address?: string;
  count?: number;
}

export interface ExternalLink {
  index: number;
  /** File name the workbook says it links to. */
  target: string;
}

export interface ParsedFile {
  format: "xlsx" | "csv";
  sheets: { name: string; hidden: boolean }[];
  cells: ParsedCell[];
  externalLinks: ExternalLink[];
  definedNames: { name: string; ref: string }[];
  warnings: Warning[];
}

export const LIMITS = {
  maxFileBytes: 4 * 1024 * 1024, // Vercel Functions cap request bodies at 4.5 MB
  maxUncompressedBytes: 80 * 1024 * 1024,
  maxCells: 100_000,
};

export class ImportError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
