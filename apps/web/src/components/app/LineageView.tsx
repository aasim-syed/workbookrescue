import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Footprints, Link2, Table2, X } from "lucide-react";
import { toast } from "sonner";
import { cellRef, fmtValue, type OpenCell, projectApi, useFiles, useGraph, useOutputs, useProjectMutation, type GNode } from "@/lib/api";
import StatusLabel from "@/components/StatusLabel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dropzone } from "./FilesView";
import LineageGraph from "./LineageGraph";

export interface Prefill { filename?: string; sheet?: string; address?: string }

export default function LineageView({
  projectId, onDeclare, onTest, onOpen,
}: {
  projectId: string;
  onOpen: OpenCell;
  onDeclare: (p: Prefill) => void;
  onTest: (p: Prefill) => void;
}) {
  const outputs = useOutputs(projectId);
  const files = useFiles(projectId);
  const [pick, setPick] = useState<string | undefined>();
  const out = useMemo(() => outputs.data?.find((o) => `${o.artifactId}|${o.sheet}|${o.address}` === pick), [outputs.data, pick]);
  const graph = useGraph(projectId, out);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [pick, projectId]);

  const empty = !files.isLoading && (files.data?.files.length ?? 0) === 0;
  if (empty) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <h2 className="mb-1 text-lg font-semibold">Start with your workbooks</h2>
        <p className="mb-4 text-sm text-muted-foreground">Drop every file behind one process. We'll trace how the final numbers are built.</p>
        <Dropzone projectId={projectId} />
      </div>
    );
  }

  const g = graph.data;
  const node = g?.nodes.find((n) => n.id === selected) ?? null;
  const current = out ?? (g ? outputs.data?.find((o) => g.root === `${o.artifactId}:${o.sheet}!${o.address}`) : undefined);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <span className="text-sm text-muted-foreground">Trace</span>
        <Select value={pick ?? (current ? `${current.artifactId}|${current.sheet}|${current.address}` : undefined)} onValueChange={setPick}>
          <SelectTrigger className="h-8 w-[min(420px,60vw)] font-mono text-xs">
            <SelectValue placeholder="Choose an output" />
          </SelectTrigger>
          <SelectContent>
            {(outputs.data ?? []).map((o) => (
              <SelectItem key={`${o.artifactId}|${o.sheet}|${o.address}`} value={`${o.artifactId}|${o.sheet}|${o.address}`} className="font-mono text-xs">
                {o.filename} · {o.sheet}!{o.address} = {fmtValue(o.cached)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Legend />
      </div>

      <div className="relative min-h-0 flex-1">
        {graph.isLoading ? (
          <Skeleton className="m-4 h-64" />
        ) : !g ? (
          <p className="p-8 text-sm text-muted-foreground">No formula outputs found yet. Import workbooks that contain formulas.</p>
        ) : (
          <>
            <LineageGraph graph={g} selected={selected} onSelect={setSelected} />
            {g.truncated && <p className="absolute bottom-3 left-12 rounded bg-card px-2 py-1 text-xs text-muted-foreground shadow">Large ranges are shown as one node.</p>}
            {node && <Inspector key={node.id} projectId={projectId} node={node} onClose={() => setSelected(null)} onDeclare={onDeclare} onTest={onTest} onOpen={onOpen} />}
          </>
        )}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="ml-auto hidden items-center gap-3 md:flex">
      {(["Verified", "User-declared", "Unresolved"] as const).map((s) => <StatusLabel key={s} status={s} className="text-muted-foreground" />)}
    </div>
  );
}

function Inspector({ projectId, node, onClose, onDeclare, onTest, onOpen }: { projectId: string; node: GNode; onClose: () => void; onDeclare: (p: Prefill) => void; onTest: (p: Prefill) => void; onOpen: OpenCell }) {
  const files = useFiles(projectId);
  const [target, setTarget] = useState<string>();
  const map = useProjectMutation(projectId, (v: { sourceFilename: string; target: string; resolvedFilename: string }) => projectApi.map(projectId, { ...v, reason: "Linked from lineage view" }));
  const latest = (files.data?.files ?? []).filter((f) => f.isLatest);
  const isCell = node.kind === "cell";
  const loc: Prefill = { filename: node.filename, sheet: node.sheet, address: node.address };

  return (
    <Card className="absolute right-3 top-3 z-10 w-80 gap-3 py-4 shadow-lg">
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs text-muted-foreground">{node.filename}</div>
            <div className="font-mono text-sm font-medium">{node.kind === "file" ? "Declared handoff" : `${node.sheet}!${node.address}`}</div>
          </div>
          <Button variant="ghost" size="icon" className="-mr-2 -mt-1 size-7" onClick={onClose} aria-label="Close"><X /></Button>
        </div>
        <StatusLabel status={node.status} />
        {isCell && (
          <dl className="space-y-2 text-xs">
            <div><dt className="text-muted-foreground">Saved value</dt><dd className="font-mono text-sm">{fmtValue(node.cached)}</dd></div>
            <div><dt className="text-muted-foreground">Formula</dt><dd className="break-all font-mono">{node.formula ?? "Typed in, no formula"}</dd></div>
          </dl>
        )}
        {node.note && <p className="text-xs text-muted-foreground">{node.note}</p>}

        {node.kind === "unresolved" && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs">Is this one of your files under a different name?</p>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose a file" /></SelectTrigger>
              <SelectContent>{latest.map((f) => <SelectItem key={f.id} value={f.filename} className="text-xs">{f.filename}</SelectItem>)}</SelectContent>
            </Select>
            <Button
              size="sm" className="w-full" disabled={!target || map.isPending}
              onClick={() => {
                const src = node.id.split(":")[1];
                const srcFile = (files.data?.files ?? []).find((f) => f.id === src)?.filename;
                if (srcFile) map.mutate({ sourceFilename: srcFile, target: node.filename, resolvedFilename: target! }, { onSuccess: () => toast.success("Link recorded") });
              }}
            >
              <Link2 /> Link it
            </Button>
            <p className="text-xs text-muted-foreground">Or drop <span className="font-mono">{node.filename}</span> in Files and it links itself.</p>
          </div>
        )}

        {(isCell || node.kind === "range") && node.artifactId && (
          <Button size="sm" variant="secondary" className="w-full" onClick={() => onOpen({ filename: node.filename, sheet: node.sheet, address: node.address, artifactId: node.artifactId! })}>
            <Table2 /> Open in sheet
          </Button>
        )}
        {isCell && (
          <div className="flex gap-2 border-t pt-3">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => onDeclare(loc)}><Footprints /> Handoff here</Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => onTest(loc)}><FlaskConical /> Test this</Button>
          </div>
        )}
        <span className="sr-only">{cellRef(node)}</span>
      </CardContent>
    </Card>
  );
}
