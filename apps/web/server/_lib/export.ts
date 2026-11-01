import { eq, inArray } from "drizzle-orm";
import { schema, type DB } from "./db/client.js";
import { buildUpstream, findOutputs } from "./core/graph.js";
import { latestArtifacts, loadContext } from "./store.js";
import { computeUnknowns } from "./unknowns.js";

const { steps, baselines, assertions, testRuns } = schema;

const KIND: Record<string, string> = { manual_copy: "Copy/paste", export_import: "Export → import", override: "Manual override", documented_handoff: "Handoff" };

/** Runbook + lineage. Anything unresolved is stated on the first line: the export never claims more than the evidence. */
export async function buildExport(db: DB, p: typeof schema.projects.$inferSelect) {
  const arts = await latestArtifacts(db, p.id);
  const ctx = await loadContext(db, p.id);
  const { items: unknowns, summary } = await computeUnknowns(db, p.id);
  const open = unknowns.filter((u) => !u.ack);
  const blocking = open.filter((u) => u.severity === "blocking");
  const incomplete = blocking.length > 0;
  const stepRows = await db.select().from(steps).where(eq(steps.projectId, p.id)).orderBy(steps.ordinal);
  const bases = await db.select().from(baselines).where(eq(baselines.projectId, p.id));
  const asserts = bases.length ? await db.select().from(assertions).where(inArray(assertions.baselineId, bases.map((b) => b.id))) : [];
  const runs = bases.length ? await db.select().from(testRuns).where(inArray(testRuns.baselineId, bases.map((b) => b.id))) : [];
  const outputs = findOutputs(ctx, 10).map((o) => ({ ...o, graph: buildUpstream(ctx, o) }));

  const json = {
    project: p.name,
    generatedAt: new Date().toISOString(),
    status: incomplete ? "INCOMPLETE" : "COMPLETE",
    safeToClaimReproducible: !incomplete && stepRows.length > 0,
    files: arts.map((a) => ({ filename: a.filename, version: a.version, sha256: a.sha256 })),
    unknowns,
    unknownsSummary: summary,
    steps: stepRows,
    lineage: outputs.map((o) => ({ output: `${o.filename}::${o.sheet}!${o.address}`, nodes: o.graph.nodes, edges: o.graph.edges })),
    baselines: bases.map((b) => ({ ...b, assertions: asserts.filter((a) => a.baselineId === b.id), lastRun: runs.filter((r) => r.baselineId === b.id).sort((a, b) => +b.createdAt - +a.createdAt)[0]?.status ?? null })),
  };

  const md: string[] = [];
  md.push(`# Runbook: ${p.name}`, "");
  md.push(incomplete ? `> **INCOMPLETE.** ${blocking.length} unresolved item(s) below. Do not treat this process as reproducible yet.` : "> All known dependencies are resolved. Declared human steps are as stated by their owners.", "");
  md.push(`Generated ${json.generatedAt}`, "");
  md.push("## Files", "", ...arts.map((a) => `- \`${a.filename}\` v${a.version} (sha256 \`${a.sha256.slice(0, 12)}…\`)`), "");
  md.push("## Steps", "");
  if (!stepRows.length) md.push("_No human steps declared. If anyone copies, pastes or overrides anything by hand, it is missing here._", "");
  stepRows.forEach((s, i) => {
    const where = s.toFilename ? ` → \`${s.toFilename}${s.toSheet ? `::${s.toSheet}` : ""}${s.toAddress ? `!${s.toAddress}` : ""}\`` : "";
    md.push(`${i + 1}. **${KIND[s.kind] ?? s.kind}**: ${s.instructions}${where}`, `   - Owner: ${s.ownerRole} · ${s.status}${s.evidence ? ` · Evidence: ${s.evidence}` : ""}`);
  });
  md.push("", "## Outputs and what feeds them", "");
  for (const o of outputs) {
    md.push(`### \`${o.filename}::${o.sheet}!${o.address}\` = ${o.cached ?? "no saved value"}`, "");
    const inputs = o.graph.nodes.filter((n) => n.role === "input" || n.role === "file" || n.role === "unresolved");
    md.push(...inputs.map((n) => `- ${n.role === "file" ? "Declared source" : "Input"} \`${n.filename}${n.sheet ? `::${n.sheet}!${n.address}` : ""}\`${n.cached !== null ? ` = ${n.cached}` : ""} · ${n.status}`), "");
  }
  md.push("## Open items", "", ...(open.length ? open.map((u) => `- [${u.status}${u.severity === "blocking" ? ", blocking" : ""}] \`${u.code}\` ${u.title}. ${u.detail}`) : ["None."]), "");
  const accepted = unknowns.filter((u) => u.ack);
  if (accepted.length) md.push("## Accepted limitations", "", ...accepted.map((u) => `- \`${u.code}\` ${u.title}. Accepted by ${u.ack!.by}: ${u.ack!.reason}`), "");
  if (bases.length) md.push("## Regression baselines", "", ...bases.map((b) => `- ${b.name}: ${b.approvalStatus}, last run ${json.baselines.find((x) => x.id === b.id)?.lastRun ?? "never"}`), "");
  return { json, markdown: md.join("\n"), incomplete };
}
