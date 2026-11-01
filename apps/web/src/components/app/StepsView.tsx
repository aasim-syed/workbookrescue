import { useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, ClipboardPaste, Footprints, MoreHorizontal, Pencil, Plus, Trash2, Undo2, Hand, FileOutput } from "lucide-react";
import { toast } from "sonner";
import { type OpenCell, projectApi, useFiles, useProjectMutation, useSteps, type Step } from "@/lib/api";
import StatusLabel from "@/components/StatusLabel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Prefill } from "./LineageView";

export const KINDS = {
  manual_copy: { label: "Copy / paste", icon: ClipboardPaste },
  export_import: { label: "Export → import", icon: FileOutput },
  override: { label: "Manual override", icon: Hand },
  documented_handoff: { label: "Other handoff", icon: Footprints },
} as const;
type Kind = keyof typeof KINDS;

export interface StepDraft {
  id?: string; kind: Kind; instructions: string; ownerRole: string; evidence: string;
  fromFilename: string; toFilename: string; toSheet: string; toAddress: string;
}
const blank: StepDraft = { kind: "manual_copy", instructions: "", ownerRole: "", evidence: "", fromFilename: "", toFilename: "", toSheet: "", toAddress: "" };
const NONE = "__none";

export function stepDraftFrom(p: Prefill & Partial<StepDraft>): StepDraft {
  return { ...blank, toFilename: p.filename ?? "", toSheet: p.sheet ?? "", toAddress: p.address ?? "", ...p, filename: undefined } as StepDraft;
}

export function StepDialog({ projectId, draft, onClose }: { projectId: string; draft: StepDraft | null; onClose: () => void }) {
  const files = useFiles(projectId);
  const [form, setForm] = useState<StepDraft>(draft ?? blank);
  const [seen, setSeen] = useState<StepDraft | null>(null);
  if (draft !== seen) {
    setSeen(draft);
    if (draft) setForm(draft);
  }
  const latest = (files.data?.files ?? []).filter((f) => f.isLatest);
  const sheets = latest.find((f) => f.filename === form.toFilename)?.sheets ?? [];
  const save = useProjectMutation(projectId, () => {
    const payload = { kind: form.kind, instructions: form.instructions, ownerRole: form.ownerRole, evidence: form.evidence, fromFilename: form.fromFilename, toFilename: form.toFilename, toSheet: form.toSheet, toAddress: form.toAddress };
    return form.id ? projectApi.editStep(projectId, form.id, payload) : projectApi.addStep(projectId, payload);
  });
  const set = (k: keyof StepDraft, v: string) => setForm((f) => ({ ...f, [k]: v === NONE ? "" : v }));

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined, { onSuccess: () => { toast.success("Step saved"); onClose(); }, onError: (err) => toast.error(err.message) });
          }}
        >
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit step" : "Declare a human step"}</DialogTitle>
            <DialogDescription>Something a person does that the files can't show. It is recorded as declared, not verified, until someone confirms it.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[9rem_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.kind} onValueChange={(v) => set("kind", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner">Who does it</Label>
              <Input id="owner" required placeholder="e.g. Cost estimator" value={form.ownerRole} onChange={(e) => set("ownerRole", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="what">What happens</Label>
            <Textarea id="what" required rows={2} placeholder="Paste the newest ERP export into the ERP_Import sheet" value={form.instructions} onChange={(e) => set("instructions", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev">How do you know</Label>
            <Input id="ev" required placeholder="e.g. Seen on screen share, 2 Nov" value={form.evidence} onChange={(e) => set("evidence", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Where the data comes from <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Select value={form.fromFilename || NONE} onValueChange={(v) => set("fromFilename", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not from a file</SelectItem>
                {latest.map((f) => <SelectItem key={f.id} value={f.filename}>{f.filename}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Where it lands</Label>
            <div className="grid grid-cols-[1fr_8rem_6rem] gap-2">
              <Select value={form.toFilename || NONE} onValueChange={(v) => setForm((f) => ({ ...f, toFilename: v === NONE ? "" : v, toSheet: "" }))}>
                <SelectTrigger><SelectValue placeholder="File" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No specific cell</SelectItem>
                  {latest.map((f) => <SelectItem key={f.id} value={f.filename}>{f.filename}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={form.toSheet || NONE} onValueChange={(v) => set("toSheet", v)} disabled={!sheets.length}>
                <SelectTrigger><SelectValue placeholder="Sheet" /></SelectTrigger>
                <SelectContent>{sheets.map((s) => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input aria-label="Cell or range" placeholder="B2:B90" value={form.toAddress} disabled={!form.toFilename} onChange={(e) => set("toAddress", e.target.value.toUpperCase())} className="font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>{form.id ? "Save changes" : "Add step"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function StepsView({ projectId, onAdd, onEdit, onOpen }: { projectId: string; onAdd: () => void; onEdit: (s: StepDraft) => void; onOpen: OpenCell }) {
  const steps = useSteps(projectId);
  const edit = useProjectMutation(projectId, (v: { id: string; body: Record<string, unknown> }) => projectApi.editStep(projectId, v.id, v.body));
  const move = useProjectMutation(projectId, (v: { id: string; dir: "up" | "down" }) => projectApi.moveStep(projectId, v.id, v.dir));
  const del = useProjectMutation(projectId, (id: string) => projectApi.deleteStep(projectId, id));
  const list = steps.data ?? [];

  const toDraft = (s: Step): StepDraft => ({
    id: s.id, kind: s.kind as Kind, instructions: s.instructions, ownerRole: s.ownerRole, evidence: s.evidence,
    fromFilename: s.fromFilename ?? "", toFilename: s.toFilename ?? "", toSheet: s.toSheet ?? "", toAddress: s.toAddress ?? "",
  });

  return (
    <div className="mx-auto h-full max-w-3xl space-y-4 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Everything a person does between the files, in order.</p>
        <Button size="sm" onClick={onAdd}><Plus /> Add step</Button>
      </div>
      {list.length === 0 && !steps.isLoading ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">No human steps yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">If anyone copies, pastes or overrides anything by hand, it isn't in the files. Declare it here so the runbook is honest.</p>
          <Button className="mt-4" onClick={onAdd}><Plus /> Add the first step</Button>
        </div>
      ) : (
        <ol className="space-y-2">
          {list.map((s, i) => {
            const K = KINDS[s.kind as Kind] ?? KINDS.documented_handoff;
            return (
              <li key={s.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><K.icon className="size-3.5" />{K.label}</span>
                    <StatusLabel status={s.status} />
                  </div>
                  <p className="mt-1 text-sm">{s.instructions}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.ownerRole} · {s.evidence}
                    {s.toFilename && (
                      <button className="ml-1 font-mono hover:underline" onClick={() => onOpen({ filename: s.toFilename!, sheet: s.toSheet ?? undefined, address: s.toAddress ?? undefined })}>
                        → {s.toFilename}{s.toSheet ? `::${s.toSheet}` : ""}{s.toAddress ? `!${s.toAddress}` : ""}
                      </button>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button
                    variant="ghost" size="sm" className="h-8 gap-1.5 text-xs"
                    onClick={() => edit.mutate({ id: s.id, body: { status: s.status === "Verified" ? "User-declared" : "Verified" } })}
                  >
                    {s.status === "Verified" ? <><Undo2 className="size-3.5" /> Unconfirm</> : <><CheckCircle2 className="size-3.5" /> Confirm</>}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="Step actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(toDraft(s))}><Pencil /> Edit</DropdownMenuItem>
                      <DropdownMenuItem disabled={i === 0} onClick={() => move.mutate({ id: s.id, dir: "up" })}><ArrowUp /> Move up</DropdownMenuItem>
                      <DropdownMenuItem disabled={i === list.length - 1} onClick={() => move.mutate({ id: s.id, dir: "down" })}><ArrowDown /> Move down</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => confirm("Remove this step?") && del.mutate(s.id)}><Trash2 /> Remove</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
