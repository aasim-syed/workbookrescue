import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "@/lib/time";
import { FolderPlus, MoreHorizontal, PlayCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/app/AppShell";
import { api, useProjects, type Project } from "@/lib/api";
import { startDemo } from "@/lib/demo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export default function Projects() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  const create = useMutation({
    mutationFn: () => api<{ project: Project }>("POST", "/projects", form),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/app/p/${r.project.id}/files`);
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api("DELETE", `/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
    },
  });
  const demo = useMutation({ mutationFn: () => startDemo(qc), onSuccess: (to) => navigate(to), onError: (e) => toast.error(e.message) });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  const list = projects.data ?? [];

  return (
    <AppShell>
      <div className="mx-auto h-full max-w-4xl overflow-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Projects</h1>
          <div className="flex gap-2">
            {list.length > 0 && !list.some((p) => p.isDemo) && (
              <Button variant="outline" onClick={() => demo.mutate()} disabled={demo.isPending}>
                <PlayCircle /> Walkthrough
              </Button>
            )}
            <Button onClick={() => setCreating(true)}>
              <FolderPlus /> New project
            </Button>
          </div>
        </div>

        {projects.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : list.length === 0 ? (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <h2 className="font-medium">Nothing here yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Create a project and drop in the workbooks behind one process, or see a worked example first.</p>
            <div className="mt-5 flex justify-center gap-2">
              <Button onClick={() => setCreating(true)}>
                <FolderPlus /> New project
              </Button>
              <Button variant="outline" onClick={() => demo.mutate()} disabled={demo.isPending}>
                <PlayCircle /> Open the walkthrough
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24">Files</TableHead>
                  <TableHead className="w-36">Status</TableHead>
                  <TableHead className="w-32">Updated</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/app/p/${p.id}`)}>
                    <TableCell className="font-medium">
                      {p.name} {p.isDemo && <Badge variant="secondary" className="ml-2">walkthrough</Badge>}
                    </TableCell>
                    <TableCell>{p.files}</TableCell>
                    <TableCell>
                      {p.files === 0 ? (
                        <span className="text-sm text-muted-foreground">Empty</span>
                      ) : p.unresolved ? (
                        <span className="text-sm" style={{ color: "var(--unresolved)" }}>{p.unresolved} unresolved</span>
                      ) : (
                        <span className="text-sm" style={{ color: "var(--verified)" }}>Resolved</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDistanceToNowStrict(p.updatedAt)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" aria-label="Project actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem variant="destructive" onClick={() => confirm(`Delete "${p.name}" and everything in it?`) && remove.mutate(p.id)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <form onSubmit={onCreate} className="space-y-4">
            <DialogHeader>
              <DialogTitle>New project</DialogTitle>
              <DialogDescription>One project per business process, such as "Customer quotation".</DialogDescription>
            </DialogHeader>
            <Input autoFocus required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Textarea placeholder="What does this process produce? (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>Create and add files</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
