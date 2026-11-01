import type { QueryClient } from "@tanstack/react-query";
import { api, type User } from "./api";

/** Signed in: open (or create) the walkthrough project. Signed out: create a private guest workspace with it loaded. */
export async function startDemo(qc: QueryClient): Promise<string> {
  const me = await api<{ user: User | null }>("GET", "/auth/me");
  if (me.user) {
    const r = await api<{ projectId: string }>("POST", "/projects/demo");
    qc.invalidateQueries({ queryKey: ["projects"] });
    return `/app/p/${r.projectId}`;
  }
  const r = await api<{ user: User; projectId: string }>("POST", "/auth/guest");
  qc.setQueryData(["me"], r.user);
  return `/app/p/${r.projectId}`;
}
