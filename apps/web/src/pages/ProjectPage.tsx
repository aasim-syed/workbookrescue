import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Download, FileText, FlaskConical, Footprints, GitBranch, History, Files as FilesIcon } from "lucide-react";
import AppShell from "@/components/app/AppShell";
import ActivityView from "@/components/app/ActivityView";
import DemoGuide from "@/components/app/DemoGuide";
import FilesView from "@/components/app/FilesView";
import LineageView, { type Prefill } from "@/components/app/LineageView";
import StepsView, { StepDialog, stepDraftFrom, type StepDraft } from "@/components/app/StepsView";
import TestsView, { BaselineDialog } from "@/components/app/TestsView";
import UnknownsSheet from "@/components/app/UnknownsSheet";
import { useProject } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { id: "lineage", label: "Lineage", icon: GitBranch },
  { id: "files", label: "Files", icon: FilesIcon },
  { id: "steps", label: "Steps", icon: Footprints },
  { id: "tests", label: "Tests", icon: FlaskConical },
  { id: "activity", label: "Activity", icon: History },
] as const;

export default function ProjectPage() {
  const { id = "", tab = "lineage" } = useParams();
  const navigate = useNavigate();
  const project = useProject(id);
  const [unknownsOpen, setUnknownsOpen] = useState(false);
  const [stepDraft, setStepDraft] = useState<StepDraft | null>(null);
  const [baseline, setBaseline] = useState<{ open: boolean; prefill: Prefill | null }>({ open: false, prefill: null });

  const goTab = (t: string) => navigate(`/app/p/${id}/${t}`);
  const unknowns = project.data?.unknowns ?? [];
  const blocking = unknowns.filter((u) => u.status === "Unresolved").length;
  const exportAs = (format: "md" | "json") => (window.location.href = `/api/projects/${id}/export?format=${format}`);

  return (
    <AppShell crumb={project.data?.project.name}>
      <div className="relative flex h-full flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
          <Tabs value={tab} onValueChange={goTab}>
            <TabsList className="h-8 bg-transparent p-0">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="gap-1.5 data-[state=active]:bg-accent data-[state=active]:shadow-none">
                  <t.icon className="size-4" />
                  <span className="hidden sm:inline">{t.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            {project.data && (project.data.fileCount > 0) && (
              <Button variant="outline" size="sm" className="h-8" onClick={() => setUnknownsOpen(true)}>
                {blocking ? <AlertCircle style={{ color: "var(--unresolved)" }} /> : <CheckCircle2 style={{ color: "var(--verified)" }} />}
                {blocking ? `${blocking} to resolve` : "Resolved"}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8"><Download /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportAs("md")}><FileText /> Runbook (Markdown)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("json")}><FileText /> Lineage (JSON)</DropdownMenuItem>
                {blocking > 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Will be marked INCOMPLETE</div>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {tab === "lineage" && <LineageView projectId={id} onDeclare={(p) => setStepDraft(stepDraftFrom(p))} onTest={(p) => setBaseline({ open: true, prefill: p })} />}
          {tab === "files" && <FilesView projectId={id} />}
          {tab === "steps" && <StepsView projectId={id} onAdd={() => setStepDraft(stepDraftFrom({}))} onEdit={setStepDraft} />}
          {tab === "tests" && <TestsView projectId={id} onNew={() => setBaseline({ open: true, prefill: null })} />}
          {tab === "activity" && <ActivityView projectId={id} />}
          {project.data?.project.isDemo && (
            <DemoGuide
              projectId={id} unknowns={unknowns} goTab={goTab}
              onStep={(d) => { setStepDraft(d); }}
              onBaseline={(p) => setBaseline({ open: true, prefill: p })}
            />
          )}
        </div>
      </div>

      <UnknownsSheet projectId={id} open={unknownsOpen} onOpenChange={setUnknownsOpen} unknowns={unknowns} />
      <StepDialog projectId={id} draft={stepDraft} onClose={() => setStepDraft(null)} />
      <BaselineDialog projectId={id} open={baseline.open} prefill={baseline.prefill} onClose={() => setBaseline({ open: false, prefill: null })} />
    </AppShell>
  );
}
