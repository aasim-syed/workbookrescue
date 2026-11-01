import { parseCsv } from "./csv.js";
import { parseXlsx } from "./xlsx.js";
import { ImportError, LIMITS, type ParsedFile } from "./types.js";

export function parseUpload(filename: string, bytes: Uint8Array): ParsedFile {
  if (bytes.byteLength === 0) throw new ImportError("IMPORT_EMPTY", "File is empty");
  if (bytes.byteLength > LIMITS.maxFileBytes) throw new ImportError("FILE_TOO_LARGE", `File exceeds ${LIMITS.maxFileBytes / 1024 / 1024} MB`);
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "csv") return parseCsv(bytes);
  if (ext === "xlsx" || ext === "xlsm") return parseXlsx(bytes);
  throw new ImportError("IMPORT_UNSUPPORTED_FORMAT", `Unsupported file type .${ext}. Use .xlsx, .xlsm or .csv`);
}

export async function sha256(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const buf = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
