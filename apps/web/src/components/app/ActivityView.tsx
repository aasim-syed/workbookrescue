import { useAudit } from "@/lib/api";
import { dateTime } from "@/lib/time";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function ActivityView({ projectId }: { projectId: string }) {
  const audit = useAudit(projectId);
  return (
    <div className="mx-auto h-full max-w-4xl space-y-3 overflow-auto p-4">
      <p className="text-sm text-muted-foreground">Every import, mapping, approval and test run. This log is append-only.</p>
      {audit.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">When</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead className="w-48">Who</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(audit.data ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground">{dateTime(e.createdAt)}</TableCell>
                  <TableCell>{e.summary}</TableCell>
                  <TableCell className="truncate text-muted-foreground">{e.actorEmail.endsWith("@guest.local") ? "Guest" : e.actorEmail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
