import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, Circle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { projectApi, useBaselines, useFiles, useProjectMutation, useSteps, type Unknown } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stepDraftFrom, type StepDraft } from "./StepsView";
import type { Prefill } from "./LineageView";

/** A short checklist for the walkthrough project. Every item is derived from real data, so it can't drift from what the app did. */
export default function DemoGuide({
  projectId, unknowns, onStep, onBaseline, goTab,
}: {
  projectId: string;
  unknowns: Unknown[];
  onStep: (d: StepDraft) => void;
  onBaseline: (p: Prefill) => void;
  goTab: (t: string) => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const files = useFiles(projectId).data?.files ?? [];
  const steps = useSteps(projectId).data ?? [];
  const baselines = useBaselines(projectId).data ?? [];

  const ship = useProjectMutation(projectId, () => projectApi.demoShipping(projectId));
  const change = useProjectMutation(projectId, () => projectApi.demoChange(projectId));
  const run = useProjectMutation(projectId, () => projectApi.runBaseline(projectId, baselines[0].id));

  const items = [
    {
      title: "The shipping workbook is missing",
      hint: "The quote links to it, but it isn't imported. Add it and the link resolves.",
      done: !unknowns.some((u) => u.target === "shipping_rates.xlsx"),
      action: "Add shipping_rates.xlsx", busy: ship.isPending, run: () => ship.mutate(),
    },
    {
      title: "Someone pastes ERP data by hand",
      hint: "The files can't show that. Declare it so the runbook is honest.",
      done: steps.length > 0,
      action: "Declare the step", busy: false,
      run: () => onStep(stepDraftFrom({ kind: "manual_copy", instructions: "Paste the newest ERP export into the ERP_Import sheet", ownerRole: "Cost estimator", evidence: "Shown in the walkthrough", fromFilename: "erp_parts_2026-10.csv", filename: "cost_rollup.xlsx", sheet: "ERP_Import", address: "B2" })),
    },
    {
      title: "Lock in today's quote",
      hint: "Save ₹74,400 as the approved value and pin these file versions.",
      done: baselines.length > 0,
      action: "Create baseline", busy: false,
      run: () => onBaseline({ filename: "customer_quote.xlsx", sheet: "Quote", address: "G24" }),
    },
    {
      title: "Labour rate goes from 150 to 175",
      hint: "Four workbooks get re-saved, the way it happens in real life.",
      done: files.some((f) => f.filename === "labor_rates.xlsx" && f.version > 1),
      action: "Simulate the change", busy: change.isPending, run: () => change.mutate(),
    },
    {
      title: "Run the test",
      hint: "See what moved, and the exact cell that moved it.",
      done: baselines.some((b) => b.runs.some((r) => r.status === "FAIL")),
      action: "Run test", busy: run.isPending,
      run: () => run.mutate(undefined, { onSuccess: () => { goTab("tests"); toast.warning("The quote changed, and the test shows why."); } }),
    },
  ];
  const current = items.findIndex((i) => !i.done);
  const finished = current === -1;

  return (
    <div className="absolute bottom-4 right-4 z-20 w-80 rounded-lg border bg-popover text-popover-foreground shadow-lg">
      <button className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium" onClick={() => setOpen((o) => !o)}>
        <span>Walkthrough · {items.filter((i) => i.done).length}/{items.length}</span>
        <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="space-y-1 border-t p-2">
          {items.map((it, i) => (
            <div key={it.title} className={cn("rounded-md px-2 py-1.5", i === current && "bg-accent")}>
              <div className="flex items-start gap-2 text-sm">
                {it.done ? <Check className="mt-0.5 size-4 shrink-0" style={{ color: "var(--verified)" }} /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <span className={cn(it.done && "text-muted-foreground line-through")}>{it.title}</span>
              </div>
              {i === current && (
                <div className="ml-6 mt-1">
                  <p className="text-xs text-muted-foreground">{it.hint}</p>
                  <Button size="sm" className="mt-2 h-7" disabled={it.busy} onClick={it.run}>
                    {it.busy && <Loader2 className="animate-spin" />} {it.action}
                  </Button>
                </div>
              )}
            </div>
          ))}
          {finished && (
            <div className="px-2 pb-1 pt-2 text-xs text-muted-foreground">
              That's the loop: trace, declare, baseline, detect.
              <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => navigate("/app")}>Start your own project</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
