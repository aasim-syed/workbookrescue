import { useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, FileQuestion, Link2, RotateCcw, ShieldCheck, Table2, Upload } from "lucide-react";
import { toast } from "sonner";
import { type OpenCell, projectApi, type UnknownItem, useFiles, useProjectMutation, useUnknowns } from "@/lib/api";
import { dateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import StatusLabel from "@/components/StatusLabel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface Shared {
  projectId: string;
  onOpen: OpenCell;
  goTab: (t: string) => void;
}

function Where({ u, onOpen }: { u: UnknownItem; onOpen: OpenCell }) {
  if (!u.filename || u.category === "link") return null;
  return (
    <button
      className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
      onClick={() => onOpen({ filename: u.filename!, sheet: u.sheet, address: u.address })}
    >
      <Table2 className="size-3" /> {u.filename}
      {u.sheet ? `::${u.sheet}` : ""}
      {u.address ? `!${u.address}` : ""}
    </button>
  );
}

function LinkActions({ projectId, u }: { projectId: string; u: UnknownItem }) {
  const files = useFiles(projectId);
  const [target, setTarget] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const map = useProjectMutation(projectId, (v: { to: string; reason: string }) =>
    projectApi.map(projectId, { sourceFilename: u.filename!, target: u.target!, resolvedFilename: v.to, reason: v.reason }),
  );
  const upload = useProjectMutation(projectId, (f: File) => projectApi.upload(projectId, f).then(() => f.name));
  const options = (files.data?.files ?? []).filter((f) => f.isLatest && f.filename !== u.filename);

  return (
    <div className="mt-3 space-y-3">
      {(u.suggestions ?? []).map((s) => (
        <div key={s.filename} className="flex items-center gap-3 rounded-md border bg-background p-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs">{s.filename}</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              <StatusLabel status="Inferred" /> {s.method}. Not applied until you accept it.
            </div>
          </div>
          <Button
            size="sm"
            disabled={map.isPending}
            onClick={() => map.mutate({ to: s.filename, reason: `Accepted suggestion (${s.method.toLowerCase()})` }, { onSuccess: () => toast.success("Link recorded") })}
          >
            <Link2 /> Use it
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder="It is actually another file" />
          </SelectTrigger>
          <SelectContent>
            {options.map((f) => (
              <SelectItem key={f.id} value={f.filename} className="text-xs">
                {f.filename}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={!target || map.isPending}
          onClick={() => map.mutate({ to: target!, reason: "Linked from the unknowns queue" }, { onSuccess: () => toast.success("Link recorded") })}
        >
          <Link2 /> Link
        </Button>
        <span className="text-xs text-muted-foreground">or</span>
        <input
          ref={input}
          type="file"
          hidden
          accept=".xlsx,.xlsm,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            upload.mutate(f, {
              onSuccess: (n) => (n === u.target ? toast.success(`${n} imported and linked`) : toast.info(`${n} imported. Its name differs from ${u.target}, so link it above.`)),
              onError: (err) => toast.error(err.message),
            });
          }}
        />
        <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
          <Upload /> Upload {u.target}
        </Button>
      </div>
    </div>
  );
}

function Accept({ projectId, u }: { projectId: string; u: UnknownItem }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ack = useProjectMutation(projectId, () => projectApi.ackUnknown(projectId, u.id, reason));
  if (!open) {
    return (
      <Button size="sm" variant="outline" className="mt-3" onClick={() => setOpen(true)}>
        <ShieldCheck /> Accept this limitation
      </Button>
    );
  }
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        ack.mutate(undefined, { onSuccess: () => toast.success("Accepted and recorded"), onError: (err) => toast.error(err.message) });
      }}
    >
      <Textarea autoFocus required rows={2} placeholder="Why is this acceptable? For example: the macro only formats the print layout." value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={ack.isPending || reason.trim().length < 3}>
          Accept
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Item({ projectId, u, onOpen, goTab }: Shared & { u: UnknownItem }) {
  const confirm = useProjectMutation(projectId, () => projectApi.editStep(projectId, u.stepId!, { status: "Verified" }));
  const approve = useProjectMutation(projectId, () => projectApi.approveBaseline(projectId, u.baselineId!));
  const reopen = useProjectMutation(projectId, () => projectApi.reopenUnknown(projectId, u.id));

  return (
    <li className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <StatusLabel status={u.status} />
          <h3 className="mt-1 text-sm font-medium">{u.title}</h3>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{u.code}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{u.detail}</p>
      <Where u={u} onOpen={onOpen} />

      {u.ack ? (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-md bg-muted/50 p-2.5 text-xs">
          <span>
            Accepted by {u.ack.by} on {dateTime(u.ack.at)}: <span className="text-muted-foreground">{u.ack.reason}</span>
          </span>
          <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-xs" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
            <RotateCcw className="size-3" /> Reopen
          </Button>
        </div>
      ) : (
        <>
          {u.category === "link" && <LinkActions projectId={projectId} u={u} />}
          {u.category === "cache" && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(u.samples ?? []).map((s) => (
                <button
                  key={`${s.sheet}!${s.address}`}
                  className="rounded border bg-background px-2 py-0.5 font-mono text-xs hover:bg-accent"
                  onClick={() => onOpen({ filename: u.filename!, sheet: s.sheet, address: s.address })}
                >
                  {s.sheet}!{s.address}
                </button>
              ))}
            </div>
          )}
          {u.category === "unsupported" && <Accept projectId={projectId} u={u} />}
          {u.category === "step" && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate(undefined, { onSuccess: () => toast.success("Step confirmed") })}>
                <CheckCircle2 /> Confirm it happens
              </Button>
              <Button size="sm" variant="ghost" onClick={() => goTab("steps")}>
                Open in Steps
              </Button>
            </div>
          )}
          {u.category === "test" && (
            <div className="mt-3 flex gap-2">
              {u.code === "BASELINE_NOT_APPROVED" && (
                <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(undefined, { onSuccess: () => toast.success("Baseline approved") })}>
                  <ShieldCheck /> Approve baseline
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => goTab("tests")}>
                Open in Tests
              </Button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

function Section({ title, hint, icon, items, ...shared }: Shared & { title: string; hint: string; icon: ReactNode; items: UnknownItem[] }) {
  if (!items.length) return null;
  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground">· {items.length}</span>
        </h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
      <ul className="space-y-3">
        {items.map((u) => (
          <Item key={u.id} u={u} {...shared} />
        ))}
      </ul>
    </section>
  );
}

export default function UnknownsView({ projectId, onOpen, goTab }: Shared) {
  const q = useUnknowns(projectId);
  const [showAccepted, setShowAccepted] = useState(false);
  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Skeleton className="h-40" />
      </div>
    );
  }
  const items = q.data?.items ?? [];
  const open = items.filter((i) => !i.ack);
  const blocking = open.filter((i) => i.severity === "blocking");
  const review = open.filter((i) => i.severity === "review");
  const accepted = items.filter((i) => i.ack);
  const shared = { projectId, onOpen, goTab };

  return (
    <div className="mx-auto h-full max-w-3xl space-y-7 overflow-auto p-4">
      {open.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <CheckCircle2 className="mx-auto size-6" style={{ color: "var(--verified)" }} />
          <p className="mt-2 font-medium">Nothing left to resolve</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Every dependency we can see is accounted for. That is not proof the process is complete: only the files and steps you have shown us are covered.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {blocking.length > 0 ? `${blocking.length} thing${blocking.length > 1 ? "s" : ""} stop this process from being called reproducible. ` : "Nothing blocks reproducibility. "}
          {review.length > 0 && `${review.length} more need a human look.`}
        </p>
      )}

      <Section {...shared} title="Blocking" icon={<AlertCircle className="size-4" style={{ color: "var(--unresolved)" }} />} hint="Fix these. Exports stay marked INCOMPLETE until they are gone." items={blocking} />
      <Section {...shared} title="Needs review" icon={<FileQuestion className="size-4" style={{ color: "var(--inferred)" }} />} hint="Not blocking, but nothing here is verified yet." items={review} />

      {accepted.length > 0 && (
        <section>
          <button className="mb-3 flex items-center gap-1.5 text-sm font-semibold" onClick={() => setShowAccepted((s) => !s)}>
            <ChevronDown className={cn("size-4 transition-transform", !showAccepted && "-rotate-90")} /> Accepted limitations <span className="font-normal text-muted-foreground">· {accepted.length}</span>
          </button>
          {showAccepted && (
            <ul className="space-y-3">
              {accepted.map((u) => (
                <Item key={u.id} u={u} {...shared} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
