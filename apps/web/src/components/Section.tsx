import { ReactNode } from "react";
import { Reveal } from "./Motion";

export default function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-14">
      <Reveal>
        <h2 className="mono muted mb-3 border-b rule pb-2 text-sm">/ {title}</h2>
        {children}
      </Reveal>
    </section>
  );
}
