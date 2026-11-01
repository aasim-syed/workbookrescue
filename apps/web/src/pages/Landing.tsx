import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useInView, useMotionValueEvent, useScroll, useSpring, useTransform } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { TLink as Link, useGo } from "../components/Transition";
import Cursor from "../components/Cursor";
import SmoothScroll from "../components/SmoothScroll";
import { toast } from "sonner";
import { startDemo } from "../lib/demo";
import { useMe, type Status } from "../lib/api";
import GridScene from "../components/GridScene";
import { Magnetic, Reveal, SplitText } from "../components/Motion";
import StatusLabel from "../components/StatusLabel";

const files = [
  "erp_parts_2026-10.csv", "supplier_prices_2026-10.csv", "labor_rates.xlsx", "machine_cycle_times.xlsx",
  "materials_mapping.xlsx", "overhead_policy.xlsx", "shipping_rates.xlsx", "fx_rates.csv",
  "quote_inputs.xlsx", "cost_rollup.xlsx", "margin_review.xlsx", "customer_quote.xlsx",
];

const steps = [
  ["Import", "Read-only .xlsx, .xlsm and .csv. Every file hashed and immutable. Macros never run."],
  ["Trace", "A cross-file lineage graph where every edge points to file → sheet → cell → formula."],
  ["Declare", "Reviewers record the human handoffs files can't show, each with an owner and evidence."],
  ["Test", "Golden runs flag a changed output and walk it back to the exact upstream cell."],
  ["Export", "JSON lineage, a runbook and fixtures, stamped INCOMPLETE until the unknowns close."],
  ["Audit", "An append-only history of every mapping, approval and test run."],
];

const stats: [number, string, string][] = [
  [12, "", "linked files in the demo"],
  [5, "", "trust labels, never blurred"],
  [0, "", "macros ever executed"],
  [0, "", "false PASS on incomplete runs"],
];

const statuses: [Status, string][] = [
  ["Verified", "Extracted from a formula or confirmed by a reviewer."],
  ["User-declared", "A human handoff with an accountable owner."],
  ["Inferred", "A candidate from names or values. Never truth."],
  ["Unresolved", "The target or dependency can't be found."],
  ["Unsupported", "A feature we refuse to pretend we handle."],
];

function Counter({ to, from = 0, duration = 1.6, format = (n: number) => String(Math.round(n)) }: {
  to: number; from?: number; duration?: number; format?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView) return;
    const c = animate(from, to, { duration, ease: "easeOut", onUpdate: (v) => ref.current && (ref.current.textContent = format(v)) });
    return () => c.stop();
  }, [inView]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref}>{format(from)}</span>;
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN") + ".00";

function Marquee() {
  const row = [...files, ...files];
  return (
    <div className="relative overflow-hidden border-y rule bg-black/40 py-5 backdrop-blur-sm">
      <motion.div className="mono flex w-max gap-12 text-sm muted" animate={{ x: ["0%", "-50%"] }} transition={{ duration: 40, ease: "linear", repeat: Infinity }}>
        {row.map((f, i) => (
          <span key={i} className="flex items-center gap-12 whitespace-nowrap">
            {f}
            <span style={{ color: "var(--verified)" }}>→</span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

function PinnedSteps() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [idx, setIdx] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setIdx(Math.min(steps.length - 1, Math.floor(v * steps.length))));
  const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 26 });

  return (
    <div ref={ref} style={{ height: `${steps.length * 90}vh` }} className="relative">
      <div className="sticky top-0 flex h-screen items-center">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[auto_1fr] gap-8 px-6 md:gap-16">
          <div className="relative w-px bg-[var(--rule)]">
            <motion.div className="absolute left-0 top-0 w-px origin-top bg-[var(--verified)]" style={{ scaleY: fill, height: "100%" }} />
          </div>
          <div>
            <div className="mono muted mb-6 text-sm">
              / how it works · {String(idx + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 40, filter: "blur(10px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -40, filter: "blur(10px)" }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <h3 className="text-6xl font-semibold tracking-tight sm:text-8xl md:text-[10rem] md:leading-none">{steps[idx][0]}</h3>
                <p className="muted mt-6 max-w-xl text-lg md:text-xl">{steps[idx][1]}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function FailTerminal() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const lines = [
    <span key="a" className="muted">$ workbookrescue test --baseline quote_74400</span>,
    <span key="b">customer_quote.xlsx::Quote!G24</span>,
    <span key="c" className="muted">expected {inr(74400)}</span>,
    <span key="d">actual <b style={{ color: "var(--unresolved)" }}>{inView ? <Counter from={74400} to={77400} format={inr} /> : inr(74400)}</b></span>,
    <span key="e" style={{ color: "var(--unresolved)" }}>FAIL ← labor_rates.xlsx::Rates!C4 (150 → 175)</span>,
    <span key="f" className="muted">path: C4 → Costing!F17 → Margin!C5 → Quote!G24</span>,
  ];
  return (
    <motion.div
      ref={ref}
      className="mono relative overflow-hidden rounded-lg border rule bg-black/70 p-6 text-sm leading-8 backdrop-blur-md sm:p-8 sm:text-base"
      animate={inView ? { boxShadow: ["0 0 0 0 rgba(255,92,92,0)", "0 0 80px 0 rgba(255,92,92,.35)", "0 0 40px 0 rgba(255,92,92,.15)"] } : {}}
      transition={{ delay: 1.8, duration: 1.4 }}
    >
      <div className="mb-4 flex gap-1.5">
        {["#ff5c5c", "#ffc24a", "#38ff9c"].map((c) => <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />)}
      </div>
      {lines.map((l, i) => (
        <motion.div key={i} initial={{ opacity: 0, x: -12 }} animate={inView ? { opacity: 1, x: 0 } : {}} transition={{ delay: 0.25 + i * 0.28 }}>
          {l}
        </motion.div>
      ))}
    </motion.div>
  );
}

function TiltCard({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState({ x: 0, y: 0 });
  return (
    <motion.div
      className="rounded-lg border rule bg-black/50 p-6 backdrop-blur-md"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setT({ x: ((e.clientX - r.left) / r.width - 0.5) * 10, y: ((e.clientY - r.top) / r.height - 0.5) * -10 });
      }}
      onPointerLeave={() => setT({ x: 0, y: 0 })}
      animate={{ rotateY: t.x, rotateX: t.y }}
      whileHover={{ borderColor: "rgba(56,255,156,.6)" }}
      transition={{ type: "spring", stiffness: 200, damping: 18 }}
      style={{ transformPerspective: 700 }}
    >
      {children}
    </motion.div>
  );
}

function useTryDemo() {
  const qc = useQueryClient();
  const go = useGo();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    start: async () => {
      setBusy(true);
      try {
        go(await startDemo(qc));
      } catch (e) {
        toast.error((e as Error).message);
        setBusy(false);
        return;
      }
      setTimeout(() => setBusy(false), 1500);
    },
  };
}

export default function Landing() {
  const me = useMe();
  const demo = useTryDemo();
  const { scrollYProgress } = useScroll();
  const bar = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  const [stage, setStage] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setStage(v < 0.05 ? 0 : v < 0.2 ? 1 : 2));
  const scrim = useTransform(scrollYProgress, [0, 0.1], [1, 0]);

  useEffect(() => {
    document.documentElement.classList.add("stage");
    return () => document.documentElement.classList.remove("stage");
  }, []);

  return (
    <>
      <SmoothScroll />
      <Cursor />
      <GridScene />
      <motion.div className="pointer-events-none fixed inset-0 z-[1]" style={{ opacity: scrim, background: "linear-gradient(90deg, rgba(6,8,10,.92) 0%, rgba(6,8,10,.75) 40%, transparent 65%)" }} />
      <div className="pointer-events-none fixed inset-0 z-[1]" style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 30%, rgba(6,8,10,.85) 100%)" }} />
      <motion.div className="fixed left-0 right-0 top-0 z-50 h-0.5 origin-left" style={{ scaleX: bar, background: "var(--verified)" }} />

      <div className="mono pointer-events-none fixed bottom-6 right-6 z-40 text-right text-xs">
        <AnimatePresence mode="wait">
          <motion.div key={stage} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            style={{ color: ["var(--unresolved)", "var(--inferred)", "var(--verified)"][stage] }}>
            {["● today: 12 files, 3 hidden handoffs, 1 broken link", "● tracing every dependency…", "● recovered: every edge has evidence"][stage]}
          </motion.div>
        </AnimatePresence>
      </div>

      <header className="mono fixed inset-x-0 top-0 z-40 flex items-center justify-between px-6 py-4 text-sm backdrop-blur-sm">
        <a href="#top" className="font-medium">workbookrescue<span style={{ color: "var(--verified)" }}>_</span></a>
        <nav className="muted hidden gap-6 sm:flex">
          {["how it works", "demo", "trust"].map((n) => (
            <a key={n} className="link" href={`#${n.replace(/ /g, "-")}`}>{n}</a>
          ))}
        </nav>
        <Link to={me.data && !me.data.isGuest ? "/app" : "/login"} data-cursor="open" className="rounded-full border px-4 py-1.5" style={{ borderColor: "var(--verified)", color: "var(--verified)" }}>
          {me.data && !me.data.isGuest ? "open app →" : "sign in →"}
        </Link>
      </header>

      <main id="top" className="relative z-10">
        {/* HERO */}
        <section className="flex min-h-screen flex-col justify-end px-6 pb-20 pt-32 md:px-12">
          <motion.div className="mono mb-6 text-sm" style={{ color: "var(--verified)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            ● read-only · evidence-backed · testable
          </motion.div>
          <h1 className="max-w-[13ch] text-[clamp(2.5rem,6vw,5.75rem)] font-semibold leading-[1] tracking-tighter">
            <SplitText text="Rescue the spreadsheet process nobody can explain." delay={0.3} />
          </h1>
          <motion.p
            className="muted mt-8 max-w-md text-base md:text-lg"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 0.8 }}
          >
            Twelve linked workbooks, an ERP export and one person who knows the order to run them in. We trace every file and human step behind a quote, and make the next change testable.
          </motion.p>
          <motion.div className="mt-10 flex flex-wrap items-center gap-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}>
            <Magnetic>
              <button onClick={demo.start} disabled={demo.busy} data-cursor="go" className="inline-block rounded-full px-8 py-4 text-base font-medium text-black" style={{ background: "var(--verified)" }}>
                {demo.busy ? "Loading…" : "Try the walkthrough ↗"}
              </button>
            </Magnetic>
            <Link to="/signup" className="mono link text-sm">create an account</Link>
            <a href="#how-it-works" className="mono link text-sm">scroll to fly through ↓</a>
          </motion.div>
        </section>

        <Marquee />

        {/* STATS */}
        <section className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-6 py-28 md:grid-cols-4">
          {stats.map(([n, , label], i) => (
            <Reveal key={label} delay={i * 0.08}>
              <div className="text-7xl font-semibold tracking-tighter md:text-8xl" style={{ color: i > 1 ? "var(--verified)" : undefined }}>
                <Counter to={n} />
              </div>
              <div className="mono muted mt-2 text-xs">{label}</div>
            </Reveal>
          ))}
        </section>

        <section id="how-it-works"><PinnedSteps /></section>

        {/* DEMO */}
        <section id="demo" className="mx-auto max-w-4xl px-6 py-32">
          <Reveal>
            <div className="mono muted mb-4 text-sm">/ demo</div>
            <h2 className="mb-10 text-4xl font-semibold tracking-tight md:text-6xl">Change one rate.<br />See exactly what broke.</h2>
          </Reveal>
          <FailTerminal />
        </section>

        {/* TRUST */}
        <section id="trust" className="mx-auto max-w-6xl px-6 py-32">
          <Reveal>
            <div className="mono muted mb-4 text-sm">/ trust</div>
            <h2 className="mb-12 max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
              Five labels. <span className="muted">Inferred never becomes verified.</span>
            </h2>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" style={{ perspective: 1000 }}>
            {statuses.map(([s, d], i) => (
              <Reveal key={s} delay={i * 0.07}>
                <TiltCard>
                  <StatusLabel status={s} />
                  <p className="muted mt-3 text-sm">{d}</p>
                </TiltCard>
              </Reveal>
            ))}
            <Reveal delay={0.4}>
              <TiltCard>
                <span className="mono text-[11px]">INCONCLUSIVE</span>
                <p className="muted mt-3 text-sm">A check we can't evaluate says so. It never returns PASS.</p>
              </TiltCard>
            </Reveal>
          </div>
        </section>

        {/* CTA */}
        <section className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <Reveal>
            <h2 className="text-5xl font-semibold tracking-tighter md:text-8xl">Follow the quote<br />back to its source.</h2>
          </Reveal>
          <div className="mt-12">
            <Magnetic strength={0.5}>
              <Link to="/signup" data-cursor="go" className="inline-block rounded-full px-10 py-5 text-lg font-medium text-black" style={{ background: "var(--verified)" }}>
                Create your workspace ↗
              </Link>
            </Magnetic>
          </div>
          <p className="mono muted mt-16 text-xs">Looking for five pilot workflows · synthetic demo data</p>
        </section>
      </main>
    </>
  );
}
