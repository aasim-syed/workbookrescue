import { cn } from "@/lib/utils";
import type { Outcome, Status } from "@/lib/api";

const statusColor: Record<Status, string> = {
  Verified: "var(--verified)",
  "User-declared": "var(--declared)",
  Inferred: "var(--inferred)",
  Unresolved: "var(--unresolved)",
  Unsupported: "var(--unsupported)",
};
const outcomeColor: Record<Outcome, string> = {
  PASS: "var(--verified)",
  FAIL: "var(--unresolved)",
  INCONCLUSIVE: "var(--inferred)",
  UNSUPPORTED: "var(--unsupported)",
  ERROR: "var(--unresolved)",
};

export function statusColorOf(s: Status) {
  return statusColor[s];
}

export default function StatusLabel({ status, className }: { status: Status | Outcome; className?: string }) {
  const color = (statusColor as Record<string, string>)[status] ?? (outcomeColor as Record<string, string>)[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)} style={{ color }}>
      <span className="inline-block size-1.5 rounded-full" style={{ background: color }} />
      {status}
    </span>
  );
}
