import { useEffect, useState } from "react";
import { ChevronDown, FlaskConical, MoreHorizontal, Play, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtValue, projectApi, useBaselines, useOutputs, useProjectMutation, type Baseline, type Run } from "@/lib/api";
import { dateTime } from "@/lib/time";
import StatusLabel from "@/components/StatusLabel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Prefill } from "./LineageView";

export function BaselineDialog({ projectId, open, prefill, onClose }: { projectId: string; open: boolean; prefill: Prefill | null; onClose: () => void }) {
  const outputs = useOutputs(projectId);
  const [name, setName] = useState("");
  const [tol, setTol] = useState("0.01");
  const [approve, setApprove] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const key = (o: { filename: string; sheet: string; address: string }) => `${o.filename}|${o.sheet}|${o.address}`;
  const all = outputs.data ?? [];

  useEffect(() => {
    if (!open) return;
    const first = prefill?.filename ? { filename: prefill.filename, sheet: prefill.sheet!, address: prefill.address! } : all[0];
    setPicked(new Set(first ? [key(first)] : []));
    setName(first ? `${first.sheet}!${first.address} golden` : "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useProjectMutation(projectId, () =>
    projectApi.addBaseline(projectId, {
      name, approve,
      assertions: [...picked].map((k) => {
        const [filename, sheet, address] = k.split("|");
        return { filename, sheet, address, mode: "number", absTolerance: tol };
      }),
    }),
  );
  // a prefilled cell that isn't a terminal output still needs to be offered
  const options = prefill?.filename && !all.some((o) => key(o) === key({ filename: prefill.filename!, sheet: prefill.sheet!, address: prefill.address! }))
    ? [{ filename: prefill.filename, sheet: prefill.sheet!, address: prefill.address!, cached: null as number | string | boolean | null }, ...all]
    : all;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined, { onSuccess: () => { toast.success("Baseline saved"); onClose(); }, onError: (err) => toast.error(err.message) });
          }}
        >
          <DialogHeader>
            <DialogTitle>Lock in a golden test</DialogTitle>
            <DialogDescription>Captures today's saved values and pins the exact file versions. Later runs compare against them.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bn">Name</Label>
            <Input id="bn" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Outputs to protect</Label>
            <div className="max-h-48 space-y-1 overflow-auto rounded-md border p-1.5">
              {options.map((o) => (
                <label key={key(o)} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                  <Checkbox
                    checked={picked.has(key(o))}
                    onCheckedChange={(c) => setPicked((s) => { const n = new Set(s); c ? n.add(key(o)) : n.delete(key(o)); return n; })}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{o.filename} · {o.sheet}!{o.address}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{fmtValue(o.cached)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-4">
            <div className="w-32 space-y-1.5">
              <Label htmlFor="tol">Tolerance ±</Label>
              <Input id="tol" inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} className="font-mono" />
            </div>
            <label className="flex flex-1 cursor-pointer items-center gap-2 pb-2 text-sm">
              <Checkbox checked={approve} onCheckedChange={(c) => setApprove(!!c)} />
              Approve these as the customer-approved values
            </label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || picked.size === 0}>Save baseline</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RunResult({ run }: { run: Run }) {
  return (
    <div className="space-y-2">
      {run.results.map((r) => (
        <div key={r.assertionId} className="rounded-md border bg-background p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusLabel status={r.outcome} />
            <span className="font-mono text-xs">{r.filename} · {r.sheet}!{r.address}</span>
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {r.reason}
            {r.actual !== null && <span className="ml-2 font-mono text-foreground">expected {fmtValue(Number(r.expected))} → got {fmtValue(Number(r.actual))}</span>}
          </div>
          {r.changedInputs.length > 0 && (
            <div className="mt-2 border-t pt-2">
              <div className="mb-1 text-xs font-medium">What changed upstream</div>
              <ul className="space-y-0.5">
                {r.changedInputs.map((c, i) => (
                  <li key={i} className="font-mono text-xs">
                    {c.filename} · {c.sheet}!{c.address}: <span className="text-muted-foreground">{fmtValue(c.was)}</span> → <span style={{ color: "var(--unresolved)" }}>{fmtValue(c.now)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BaselineCard({ projectId, b }: { projectId: string; b: Baseline }) {
  const [showAll, setShowAll] = useState(false);
  const run = useProjectMutation(projectId, () => projectApi.runBaseline(projectId, b.id));
  const approve = useProjectMutation(projectId, () => projectApi.approveBaseline(projectId, b.id));
  const del = useProjectMutation(projectId, () => projectApi.deleteBaseline(projectId, b.id));
  const last = b.runs[0];

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-3">
        <FlaskConical className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{b.name}</div>
          <div className="text-xs text-muted-foreground">
            {b.assertions.length} output{b.assertions.length > 1 ? "s" : ""} · pinned to {b.manifest.length} files · {b.approvalStatus === "approved" ? "approved" : "not approved"}
          </div>
        </div>
        {last && <StatusLabel status={last.status} />}
        {b.approvalStatus === "approved" ? (
          <Button size="sm" onClick={() => run.mutate(undefined, { onError: (e) => toast.error(e.message) })} disabled={run.isPending}><Play /> Run</Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => approve.mutate()}><ShieldCheck /> Approve</Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="Baseline actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={() => confirm("Delete this baseline and its runs?") && del.mutate()}><Trash2 /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="space-y-2 border-t p-3">
        <ul className="space-y-0.5">
          {b.assertions.map((a) => (
            <li key={a.id} className="flex justify-between font-mono text-xs text-muted-foreground">
              <span>{a.filename} · {a.sheet}!{a.address}</span>
              <span>{a.mode === "number" ? `${fmtValue(Number(a.expected))} ±${a.absTolerance}` : a.mode}</span>
            </li>
          ))}
        </ul>
        {last ? (
          <>
            <div className="pt-1 text-xs text-muted-foreground">Last run {dateTime(last.createdAt)}</div>
            <RunResult run={last} />
            {b.runs.length > 1 && (
              <div>
                <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll((s) => !s)}>
                  <ChevronDown className={`size-3 transition-transform ${showAll ? "rotate-180" : ""}`} /> {b.runs.length - 1} earlier run{b.runs.length > 2 ? "s" : ""}
                </button>
                {showAll && (
                  <ul className="mt-2 space-y-1">
                    {b.runs.slice(1).map((r) => (
                      <li key={r.id} className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{dateTime(r.createdAt)}</span><StatusLabel status={r.status} /></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Not run yet.</p>
        )}
      </div>
    </div>
  );
}

export default function TestsView({ projectId, onNew }: { projectId: string; onNew: () => void }) {
  const baselines = useBaselines(projectId);
  const list = baselines.data ?? [];
  return (
    <div className="mx-auto h-full max-w-3xl space-y-4 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Compare saved outputs against an approved snapshot. If a value moves, you see which input moved it.</p>
        <Button size="sm" onClick={onNew}><Plus /> New baseline</Button>
      </div>
      {list.length === 0 && !baselines.isLoading ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">No baselines yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Capture the outputs you trust today. Next time files change, run the test to see what moved.</p>
          <Button className="mt-4" onClick={onNew}><Plus /> Create a baseline</Button>
        </div>
      ) : (
        list.map((b) => <BaselineCard key={b.id} projectId={projectId} b={b} />)
      )}
    </div>
  );
}
