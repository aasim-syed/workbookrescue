import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { fmtValue, useFiles, useSheet, type CellRef, type SheetData } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const colName = (n: number) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colNum = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const split = (a: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(a);
  return m ? { c: colNum(m[1]), r: Number(m[2]) } : { c: 1, r: 1 };
};

const MAX_ROWS = 300;
const MAX_COLS = 26;

/** `[3]Inputs!B2` is how Excel stores an external link. Show the file it points at instead. */
const readable = (f: string, links: SheetData["file"]["externalLinks"]) => f.replace(/\[(\d+)\]/g, (m, n) => (links.find((l) => l.index === Number(n)) ? `[${links.find((l) => l.index === Number(n))!.target}]` : m));

function Grid({ data, sheet, selected, onSelect }: { data: SheetData; sheet: string; selected: string | null; onSelect: (a: string) => void }) {
  const cellMap = useMemo(() => new Map(data.cells.filter((c) => c.sheet === sheet).map((c) => [c.address, c])), [data, sheet]);
  const { rows, cols, truncated } = useMemo(() => {
    let r = 12, c = 8;
    for (const a of cellMap.keys()) { const p = split(a); r = Math.max(r, p.r + 2); c = Math.max(c, p.c + 1); }
    if (selected) { const p = split(selected); r = Math.max(r, p.r + 2); c = Math.max(c, p.c + 1); }
    return { rows: Math.min(r, MAX_ROWS), cols: Math.min(c, MAX_COLS), truncated: r > MAX_ROWS || c > MAX_COLS };
  }, [cellMap, selected]);
  const selRef = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: "center", inline: "center" });
  }, [selected, sheet]);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 h-6 w-10 border-b border-r bg-muted" />
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} className="sticky top-0 z-10 h-6 min-w-24 border-b border-r bg-muted px-2 text-center font-normal text-muted-foreground">{colName(i + 1)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <th className="sticky left-0 z-10 h-6 w-10 border-b border-r bg-muted px-1 text-center font-normal text-muted-foreground">{r + 1}</th>
              {Array.from({ length: cols }, (_, c) => {
                const addr = `${colName(c + 1)}${r + 1}`;
                const cell = cellMap.get(addr);
                const isSel = addr === selected;
                return (
                  <td
                    key={c}
                    ref={isSel ? selRef : undefined}
                    onClick={() => onSelect(addr)}
                    className={cn(
                      "h-6 max-w-64 cursor-cell truncate border-b border-r px-2 font-mono",
                      typeof cell?.cached === "number" && "text-right tabular-nums",
                      cell?.formula && "border-l-2 border-l-verified",
                      isSel && "bg-accent outline outline-2 -outline-offset-2 outline-ring",
                    )}
                  >
                    {cell ? (typeof cell.cached === "boolean" ? String(cell.cached).toUpperCase() : fmtValue(cell.cached)) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && <p className="p-3 text-xs text-muted-foreground">Showing the first {MAX_ROWS} rows and {MAX_COLS} columns.</p>}
    </div>
  );
}

/** Excel-style read-only view of an imported file: sheet tabs, formula bar, and the exact cell highlighted. */
export default function SheetViewer({ projectId, target, onClose }: { projectId: string; target: CellRef; onClose: () => void }) {
  const files = useFiles(projectId);
  const latest = files.data?.files.find((f) => f.filename === target.filename && f.isLatest);
  const [artifactId, setArtifactId] = useState<string | undefined>(target.artifactId);
  const id = artifactId ?? latest?.id;
  const sheet = useSheet(projectId, id);
  const data = sheet.data;
  const [tab, setTab] = useState<string | undefined>(target.sheet);
  const [selected, setSelected] = useState<string | null>(target.address?.split(":")[0] ?? null);

  const current = tab && data?.file.sheets.some((s) => s.name === tab) ? tab : data?.file.sheets[0]?.name;
  const cell = data?.cells.find((c) => c.sheet === current && c.address === selected);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[80vh] max-w-5xl flex-col gap-0 p-0 sm:max-w-5xl">
        <div className="flex items-center gap-3 border-b px-4 py-3 pr-12">
          {data?.file.format === "csv" ? <FileText className="size-4 text-muted-foreground" /> : <FileSpreadsheet className="size-4 text-muted-foreground" />}
          <DialogTitle className="truncate text-sm">{target.filename}</DialogTitle>
          <DialogDescription className="sr-only">Read-only view of the imported cells</DialogDescription>
          {data && data.versions.length > 1 && (
            <Select value={id} onValueChange={(v) => { setArtifactId(v); }}>
              <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{data.versions.map((v) => <SelectItem key={v.id} value={v.id} className="text-xs">Version {v.version}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <span className="ml-auto text-xs text-muted-foreground">Read only</span>
          {id && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => (window.location.href = `/api/projects/${projectId}/files/${id}/download`)}>
              <Download /> {data?.file.format === "csv" ? "Download .csv" : "Download .xlsx"}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 border-b px-3 py-1.5 font-mono text-xs">
          <span className="w-14 rounded bg-secondary px-1.5 py-0.5 text-center">{selected ?? "—"}</span>
          <span className="text-muted-foreground">fx</span>
          <span className="min-w-0 flex-1 truncate">
            {cell ? (cell.formula ? readable(cell.formula, data!.file.externalLinks) : fmtValue(cell.cached)) : <span className="text-muted-foreground">Click a cell</span>}
          </span>
          {cell?.formula && <span className="shrink-0 text-muted-foreground">= {fmtValue(cell.cached)}</span>}
        </div>

        {sheet.isLoading || !data || !current ? <Skeleton className="m-4 h-64" /> : <Grid data={data} sheet={current} selected={selected} onSelect={setSelected} />}

        {data && (
          <div className="flex items-center gap-1 border-t bg-muted/50 px-2 py-1">
            {data.file.sheets.map((s) => (
              <button
                key={s.name}
                onClick={() => { setTab(s.name); setSelected(null); }}
                className={cn("rounded px-3 py-1 text-xs", s.name === current ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {s.name}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">{data.cells.length} cells · v{data.file.version}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
