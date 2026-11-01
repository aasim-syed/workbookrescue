import { DragEvent, useRef, useState } from "react";
import { AlertTriangle, Download, Eye, FileSpreadsheet, FileText, Loader2, MoreHorizontal, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { ApiError, type OpenCell, projectApi, useFiles, useProjectMutation } from "@/lib/api";
import { formatDistanceToNowStrict } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function useUpload(projectId: string) {
  const m = useProjectMutation(projectId, async (files: File[]) => {
    for (const f of files) {
      try {
        const r = await projectApi.upload(projectId, f);
        toast[r.duplicate ? "info" : "success"](r.duplicate ? `${f.name} is already imported` : `Imported ${f.name}`);
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof ApiError ? e.message : "upload failed"}`);
      }
    }
  });
  return { upload: (files: File[]) => files.length && m.mutate(files), busy: m.isPending };
}

export function Dropzone({ projectId, compact }: { projectId: string; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { upload, busy } = useUpload(projectId);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    upload([...e.dataTransfer.files]);
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      className={cn("flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed text-center transition-colors hover:bg-accent/50", compact ? "gap-1 p-4" : "gap-2 p-10", over && "border-foreground bg-accent")}
    >
      <input ref={input} type="file" multiple hidden accept=".xlsx,.xlsm,.csv" onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
      {busy ? <Loader2 className="size-6 animate-spin text-muted-foreground" /> : <UploadCloud className="size-6 text-muted-foreground" />}
      <div className="text-sm font-medium">{busy ? "Importing…" : "Drop workbooks here, or click to choose"}</div>
      {!compact && <p className="text-xs text-muted-foreground">.xlsx, .xlsm and .csv up to 4 MB. Files are read only: macros are never run.</p>}
    </div>
  );
}

export default function FilesView({ projectId, onOpen }: { projectId: string; onOpen: OpenCell }) {
  const files = useFiles(projectId);
  const del = useProjectMutation(projectId, (id: string) => projectApi.deleteFile(projectId, id));
  const rows = files.data?.files ?? [];
  const latest = rows.filter((f) => f.isLatest);
  const older = (name: string) => rows.filter((f) => f.filename === name).length - 1;

  return (
    <div className="mx-auto h-full max-w-4xl space-y-5 overflow-auto p-4">
      <Dropzone projectId={projectId} compact={latest.length > 0} />
      {latest.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{latest.length} file{latest.length > 1 ? "s" : ""}. Click one to open it here.</span>
          <Button size="sm" variant="outline" onClick={() => (window.location.href = `/api/projects/${projectId}/files.zip`)}>
            <Download /> Download all (.zip)
          </Button>
        </div>
      )}
      {latest.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="w-24">Version</TableHead>
                <TableHead className="w-24">Cells</TableHead>
                <TableHead className="w-48">Notes</TableHead>
                <TableHead className="w-28">Imported</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {latest.map((f) => {
                const notes = f.warnings.filter((w) => w.code !== "EXTERNAL_LINKS");
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <button className="flex items-center gap-2 font-medium hover:underline" onClick={() => onOpen({ filename: f.filename, artifactId: f.id })}>
                        {f.format === "csv" ? <FileText className="size-4 text-muted-foreground" /> : <FileSpreadsheet className="size-4 text-muted-foreground" />}
                        {f.filename}
                      </button>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{f.sha256.slice(0, 12)}</div>
                    </TableCell>
                    <TableCell>
                      v{f.version}
                      {older(f.filename) > 0 && <span className="ml-1 text-xs text-muted-foreground">+{older(f.filename)}</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">{f.cellCount}</TableCell>
                    <TableCell>
                      {notes.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Clean</span>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="gap-1 font-normal">
                              <AlertTriangle className="size-3" style={{ color: "var(--inferred)" }} />
                              {notes.length} {notes.length === 1 ? "note" : "notes"}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <ul className="space-y-1">{notes.map((w) => <li key={w.code}>{w.message}</li>)}</ul>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDistanceToNowStrict(f.createdAt)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label="File actions"><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onOpen({ filename: f.filename, artifactId: f.id })}>
                            <Eye /> View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => (window.location.href = `/api/projects/${projectId}/files/${f.id}/download`)}>
                            <Download /> Download
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => confirm(`Delete ${f.filename} v${f.version}?`) && del.mutate(f.id)}>
                            <Trash2 /> Delete this version
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
