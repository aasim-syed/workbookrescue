import { useMemo } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FileInput, FunctionSquare, HelpCircle, Layers, Pencil, Target } from "lucide-react";
import { fmtValue, type GEdge, type GNode, type Graph } from "@/lib/api";
import { statusColorOf } from "@/components/StatusLabel";

const W = 200;
const H = 66;

function levels(nodes: GNode[], edges: GEdge[]): Map<string, number> {
  const preds = new Map<string, string[]>();
  for (const e of edges) (preds.get(e.to) ?? preds.set(e.to, []).get(e.to)!).push(e.from);
  const memo = new Map<string, number>();
  const depth = (id: string, path: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (path.has(id)) return 0; // cycle: don't recurse forever
    path.add(id);
    const d = Math.max(-1, ...(preds.get(id) ?? []).map((p) => depth(p, path))) + 1;
    path.delete(id);
    memo.set(id, d);
    return d;
  };
  nodes.forEach((n) => depth(n.id, new Set()));
  return memo;
}

const ICON: Record<string, typeof Target> = { output: Target, formula: FunctionSquare, input: Pencil, range: Layers, file: FileInput, unresolved: HelpCircle };

function CellNode({ data, selected }: NodeProps<Node<{ n: GNode }>>) {
  const n = data.n;
  const Icon = ICON[n.role] ?? Pencil;
  const color = statusColorOf(n.status);
  return (
    <div
      className="rounded-md border bg-card px-3 py-2 text-card-foreground shadow-sm transition-shadow"
      style={{ width: W, height: H, borderLeft: `3px solid ${color}`, outline: selected ? "2px solid var(--ring)" : undefined, borderStyle: n.status === "Unresolved" ? "dashed" : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-muted-foreground/60" />
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="size-3 shrink-0" style={{ color }} />
        <span className="truncate">{n.filename}</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-xs font-medium">{n.kind === "file" ? "handoff" : `${n.sheet}!${n.address}`}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums">{n.kind === "cell" ? fmtValue(n.cached) : ""}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-muted-foreground/60" />
    </div>
  );
}

const nodeTypes = { cell: CellNode };

export default function LineageGraph({ graph, selected, onSelect }: { graph: Graph; selected: string | null; onSelect: (id: string | null) => void }) {
  const { nodes, edges } = useMemo(() => {
    const lv = levels(graph.nodes, graph.edges);
    const maxLv = Math.max(0, ...lv.values());
    const rows = new Map<number, number>();
    const ordered = [...graph.nodes].sort((a, b) => (lv.get(a.id) ?? 0) - (lv.get(b.id) ?? 0) || a.filename.localeCompare(b.filename) || a.address.localeCompare(b.address));
    const perLevel = new Map<number, number>();
    ordered.forEach((n) => perLevel.set(lv.get(n.id) ?? 0, (perLevel.get(lv.get(n.id) ?? 0) ?? 0) + 1));
    const tallest = Math.max(...perLevel.values(), 1);

    const nodes: Node[] = ordered.map((n) => {
      const l = lv.get(n.id) ?? 0;
      const r = rows.get(l) ?? 0;
      rows.set(l, r + 1);
      const offset = ((tallest - (perLevel.get(l) ?? 1)) * (H + 24)) / 2; // centre short columns
      return { id: n.id, type: "cell", position: { x: l * (W + 56), y: offset + r * (H + 24) }, data: { n }, selected: n.id === selected, draggable: false };
    });
    const hot = new Set<string>();
    if (selected) {
      const stack = [selected];
      while (stack.length) {
        const cur = stack.pop()!;
        if (hot.has(cur)) continue;
        hot.add(cur);
        graph.edges.filter((e) => e.to === cur).forEach((e) => stack.push(e.from));
      }
    }
    const edges: Edge[] = graph.edges.map((e) => {
      const color = statusColorOf(e.status);
      const dim = selected && !(hot.has(e.from) && hot.has(e.to));
      return {
        id: e.id, source: e.from, target: e.to, type: "default",
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: 1.5, strokeDasharray: e.status === "Unresolved" ? "5 4" : undefined, opacity: dim ? 0.15 : 0.85 },
      };
    });
    void maxLv;
    return { nodes, edges };
  }, [graph, selected]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      colorMode="system"
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.2}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, n) => onSelect(n.id)}
      onPaneClick={() => onSelect(null)}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
