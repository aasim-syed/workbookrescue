import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type Status = "Verified" | "User-declared" | "Inferred" | "Unresolved" | "Unsupported";
export type Outcome = "PASS" | "FAIL" | "INCONCLUSIVE" | "UNSUPPORTED" | "ERROR";

export interface User { id: string; orgId: string; email: string; name: string; isGuest: boolean }
export interface Project { id: string; name: string; description: string; isDemo: boolean; updatedAt: string; createdAt: string; files?: number; unresolved?: number }
export interface Unknown { code: string; status: Status; message: string; artifactId?: string; filename?: string; target?: string; nodeId?: string }
export interface Warning { code: string; severity: string; message: string }
export interface FileRow {
  id: string; filename: string; format: string; sha256: string; sizeBytes: number; version: number;
  sheets: { name: string; hidden: boolean }[]; warnings: Warning[]; cellCount: number; createdAt: string; isLatest: boolean;
}
export interface GNode {
  id: string; kind: "cell" | "range" | "file" | "unresolved"; role: string; artifactId: string | null; filename: string;
  sheet: string; address: string; formula: string | null; cached: number | string | boolean | null; status: Status; note?: string;
}
export interface GEdge { id: string; from: string; to: string; type: string; status: Status; method: string; label?: string }
export interface Graph { root: string; nodes: GNode[]; edges: GEdge[]; unknowns: Unknown[]; truncated: boolean }
export interface OutputRef { artifactId: string; filename: string; sheet: string; address: string; cached: number | string | boolean | null }
export interface Step {
  id: string; ordinal: number; kind: string; instructions: string; ownerRole: string; evidence: string; status: "User-declared" | "Verified";
  fromFilename: string | null; toFilename: string | null; toSheet: string | null; toAddress: string | null;
}
export interface ChangedInput { filename: string; sheet: string; address: string; kind: string; was: unknown; now: unknown }
export interface AssertionResult { assertionId: string; filename: string; sheet: string; address: string; outcome: Outcome; reason: string; expected: string | null; actual: string | null; delta?: string; changedInputs: ChangedInput[] }
export interface Run { id: string; status: Outcome; results: AssertionResult[]; createdAt: string }
export interface Baseline {
  id: string; name: string; approvalStatus: "pending" | "approved"; createdAt: string;
  manifest: { filename: string; version: number }[];
  assertions: { id: string; filename: string; sheet: string; address: string; mode: string; expected: string | null; absTolerance: string | null }[];
  runs: Run[];
}
export interface AuditEvent { id: string; actorEmail: string; action: string; summary: string; createdAt: string }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown, raw?: { bytes: Blob; type?: string }): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : raw ? { "Content-Type": raw.type ?? "application/octet-stream" } : undefined,
    body: raw ? raw.bytes : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, data?.code ?? `HTTP_${res.status}`, data?.detail ?? data?.message ?? "Request failed");
  return data as T;
}

const P = (id: string) => `/projects/${id}`;

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<{ user: User | null }>("GET", "/auth/me").then((r) => r.user), staleTime: 60_000 });
export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => api<{ projects: Project[] }>("GET", "/projects").then((r) => r.projects) });
export const useProject = (id: string) => useQuery({ queryKey: ["project", id], queryFn: () => api<{ project: Project; unknowns: Unknown[]; fileCount: number }>("GET", P(id)) });
export const useFiles = (id: string) => useQuery({ queryKey: ["files", id], queryFn: () => api<{ files: FileRow[]; limits: { maxFileBytes: number } }>("GET", `${P(id)}/files`) });
export const useOutputs = (id: string) => useQuery({ queryKey: ["outputs", id], queryFn: () => api<{ outputs: OutputRef[] }>("GET", `${P(id)}/outputs`).then((r) => r.outputs) });
export const useGraph = (id: string, o?: { artifactId: string; sheet: string; address: string }) =>
  useQuery({
    queryKey: ["graph", id, o?.artifactId, o?.sheet, o?.address],
    queryFn: () => api<{ graph: Graph | null }>("GET", `${P(id)}/graph${o ? `?artifactId=${o.artifactId}&sheet=${encodeURIComponent(o.sheet)}&address=${o.address}` : ""}`).then((r) => r.graph),
  });
export const useSteps = (id: string) => useQuery({ queryKey: ["steps", id], queryFn: () => api<{ steps: Step[] }>("GET", `${P(id)}/steps`).then((r) => r.steps) });
export const useBaselines = (id: string) => useQuery({ queryKey: ["baselines", id], queryFn: () => api<{ baselines: Baseline[] }>("GET", `${P(id)}/baselines`).then((r) => r.baselines) });
export const useAudit = (id: string) => useQuery({ queryKey: ["audit", id], queryFn: () => api<{ events: AuditEvent[] }>("GET", `${P(id)}/audit`).then((r) => r.events) });

/** Any write can change lineage, unknowns, tests and the audit log, so refresh everything for that project. */
export function useProjectMutation<V = void, R = unknown>(projectId: string, fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of ["project", "files", "outputs", "graph", "steps", "baselines", "audit"]) qc.invalidateQueries({ queryKey: [k, projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export const projectApi = {
  upload: (id: string, file: File) => api<{ duplicate: boolean }>("POST", `${P(id)}/files?filename=${encodeURIComponent(file.name)}`, undefined, { bytes: file }),
  deleteFile: (id: string, fileId: string) => api("DELETE", `${P(id)}/files/${fileId}`),
  map: (id: string, v: { sourceFilename: string; target: string; resolvedFilename: string; reason: string }) => api("POST", `${P(id)}/mappings`, v),
  addStep: (id: string, v: Record<string, unknown>) => api("POST", `${P(id)}/steps`, v),
  editStep: (id: string, stepId: string, v: Record<string, unknown>) => api("PATCH", `${P(id)}/steps/${stepId}`, v),
  moveStep: (id: string, stepId: string, direction: "up" | "down") => api("POST", `${P(id)}/steps/${stepId}/move`, { direction }),
  deleteStep: (id: string, stepId: string) => api("DELETE", `${P(id)}/steps/${stepId}`),
  addBaseline: (id: string, v: Record<string, unknown>) => api("POST", `${P(id)}/baselines`, v),
  approveBaseline: (id: string, bid: string) => api("POST", `${P(id)}/baselines/${bid}/approve`),
  deleteBaseline: (id: string, bid: string) => api("DELETE", `${P(id)}/baselines/${bid}`),
  runBaseline: (id: string, bid: string) => api<{ run: Run }>("POST", `${P(id)}/baselines/${bid}/runs`),
  demoShipping: (id: string) => api("POST", `${P(id)}/demo/shipping`),
  demoChange: (id: string) => api("POST", `${P(id)}/demo/simulate-change`),
};

export const fmtValue = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 4 }) : String(v));
export const cellRef = (n: { filename: string; sheet: string; address: string }) => `${n.filename}${n.sheet ? `::${n.sheet}!${n.address}` : ""}`;
