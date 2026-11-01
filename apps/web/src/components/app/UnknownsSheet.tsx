import { useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { projectApi, useFiles, useProjectMutation, type Unknown } from "@/lib/api";
import StatusLabel from "@/components/StatusLabel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

function LinkRow({ projectId, u }: { projectId: string; u: Unknown }) {
  const files = useFiles(projectId);
  const [target, setTarget] = useState<string>();
  const map = useProjectMutation(projectId, () => projectApi.map(projectId, { sourceFilename: u.filename!, target: u.target!, resolvedFilename: target!, reason: "Linked from open items" }));
  const options = (files.data?.files ?? []).filter((f) => f.isLatest && f.filename !== u.filename);
  return (
    <div className="mt-2 flex gap-2">
      <Select value={target} onValueChange={setTarget}>
        <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="It's actually…" /></SelectTrigger>
        <SelectContent>{options.map((f) => <SelectItem key={f.id} value={f.filename} className="text-xs">{f.filename}</SelectItem>)}</SelectContent>
      </Select>
      <Button size="sm" className="h-8" disabled={!target || map.isPending} onClick={() => map.mutate(undefined, { onSuccess: () => toast.success("Link recorded") })}>
        <Link2 /> Link
      </Button>
    </div>
  );
}

export default function UnknownsSheet({ projectId, open, onOpenChange, unknowns }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void; unknowns: Unknown[] }) {
  const blocking = unknowns.filter((u) => u.status === "Unresolved");
  const rest = unknowns.filter((u) => u.status !== "Unresolved");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{blocking.length ? `${blocking.length} to resolve` : "Nothing blocking"}</SheetTitle>
          <SheetDescription>{blocking.length ? "Exports stay marked INCOMPLETE until these are resolved." : "Exports are not marked incomplete."}</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6">
          {blocking.map((u, i) => (
            <div key={i} className="rounded-md border p-3 text-sm">
              <StatusLabel status={u.status} />
              <p className="mt-1">{u.message}</p>
              {u.code === "EXTERNAL_LINK_UNRESOLVED" && u.filename && u.target ? (
                <>
                  <LinkRow projectId={projectId} u={u} />
                  <p className="mt-2 text-xs text-muted-foreground">Or add <span className="font-mono">{u.target}</span> in Files and it links itself.</p>
                </>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Re-save the workbook with calculated values, then upload it again.</p>
              )}
            </div>
          ))}
          {rest.length > 0 && <h3 className="pt-2 text-xs font-medium text-muted-foreground">Limits to be aware of</h3>}
          {rest.map((u, i) => (
            <div key={i} className="rounded-md border p-3 text-sm">
              <StatusLabel status={u.status} />
              <p className="mt-1 text-muted-foreground">{u.message}</p>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
