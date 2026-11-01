import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, CircleHelp, Download, FileText, FlaskConical, Footprints, GitBranch, History, Files as FilesIcon } from "lucide-react";
import AppShell from "@/components/app/AppShell";
import ActivityView from "@/components/app/ActivityView";
import DemoGuide from "@/components/app/DemoGuide";
import FilesView from "@/components/app/FilesView";
import LineageView, { type Prefill } from "@/components/app/LineageView";
import SheetViewer from "@/components/app/SheetViewer";
import StepsView, { StepDialog, stepDraftFrom, type StepDraft } from "@/components/app/StepsView";
import TestsView, { BaselineDialog } from "@/components/app/TestsView";
import UnknownsView from "@/components/app/UnknownsView";
import { type CellRef, useProject } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { id: "lineage", label: "Lineage", icon: GitBranch },
  { id: "unknowns", label: "Unknowns", icon: CircleHelp },
  { id: "files", label: "Files", icon: FilesIcon },
  { id: "steps", label: "Steps", icon: Footprints },
  { id: "tests", label: "Tests", icon: FlaskConical },
  { id: "activity", label: "Activity", icon: History },
] as const;

export default function ProjectPage() {
  const { id = "", tab = "lineage" } = useParams();
  const navigate = useNavigate();
  const project = useProject(id);
  const [sheet, setSheet] = useState<CellRef | null>(null);
  const [viewed, setViewed] = useState(false);
  const openCell = (r: CellRef) => {
    setSheet(r);
    setViewed(true);
  };
  const [stepDraft, setStepDraft] = useState<StepDraft | null>(null);
  const [baseline, setBaseline] = useState<{ open: boolean; prefill: Prefill | null }>({ open: false, prefill: null });

  const goTab = (t: string) => navigate(`/app/p/${id}/${t}`);
  const unknowns = project.data?.unknowns ?? [];
  const blocking = project.data?.summary.blocking ?? 0;
  const review = project.data?.summary.review ?? 0;
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
                  {t.id === "unknowns" && blocking + review > 0 && (
                    <span className="rounded-full px-1.5 text-[10px] font-medium text-white" style={{ background: blocking ? "var(--unresolved)" : "var(--inferred)" }}>
                      {blocking + review}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            {project.data && project.data.fileCount > 0 && (
              <Button variant="outline" size="sm" className="h-8" onClick={() => goTab("unknowns")}>
                {blocking ? (
                  <AlertCircle style={{ color: "var(--unresolved)" }} />
                ) : review ? (
                  <AlertCircle style={{ color: "var(--inferred)" }} />
                ) : (
                  <CheckCircle2 style={{ color: "var(--verified)" }} />
                )}
                {blocking ? `${blocking} to resolve` : review ? `${review} to review` : "Resolved"}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8">
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportAs("md")}>
                  <FileText /> Runbook (Markdown)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportAs("json")}>
                  <FileText /> Lineage (JSON)
                </DropdownMenuItem>
                {blocking > 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Will be marked INCOMPLETE</div>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {tab === "lineage" && (
            <LineageView projectId={id} onOpen={openCell} onDeclare={(p) => setStepDraft(stepDraftFrom(p))} onTest={(p) => setBaseline({ open: true, prefill: p })} />
          )}
          {tab === "unknowns" && <UnknownsView projectId={id} onOpen={openCell} goTab={goTab} />}
          {tab === "files" && <FilesView projectId={id} onOpen={openCell} />}
          {tab === "steps" && <StepsView projectId={id} onOpen={openCell} onAdd={() => setStepDraft(stepDraftFrom({}))} onEdit={setStepDraft} />}
          {tab === "tests" && <TestsView projectId={id} onOpen={openCell} onNew={() => setBaseline({ open: true, prefill: null })} />}
          {tab === "activity" && <ActivityView projectId={id} />}
          {project.data?.project.isDemo && (
            <DemoGuide
              projectId={id}
              unknowns={unknowns}
              goTab={goTab}
              onOpen={openCell}
              viewed={viewed}
              onStep={(d) => setStepDraft(d)}
              onBaseline={(p) => setBaseline({ open: true, prefill: p })}
            />
          )}
        </div>
      </div>

      {sheet && <SheetViewer key={`${sheet.filename}|${sheet.artifactId}|${sheet.sheet}|${sheet.address}`} projectId={id} target={sheet} onClose={() => setSheet(null)} />}
      <StepDialog projectId={id} draft={stepDraft} onClose={() => setStepDraft(null)} />
      <BaselineDialog projectId={id} open={baseline.open} prefill={baseline.prefill} onClose={() => setBaseline({ open: false, prefill: null })} />
    </AppShell>
  );
}
