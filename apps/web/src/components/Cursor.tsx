import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

export default function Cursor() {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const rx = useSpring(x, { stiffness: 220, damping: 22, mass: 0.4 });
  const ry = useSpring(y, { stiffness: 220, damping: 22, mass: 0.4 });
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const [label, setLabel] = useState("");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    setEnabled(true);
    document.documentElement.classList.add("has-cursor");
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      const t = (e.target as HTMLElement | null)?.closest<HTMLElement>("a,button,[data-cursor]");
      setHover(!!t);
      setLabel(t?.dataset.cursor ?? "");
    };
    const dn = () => setDown(true);
    const up = () => setDown(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", dn);
    window.addEventListener("pointerup", up);
    return () => {
      document.documentElement.classList.remove("has-cursor");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", dn);
      window.removeEventListener("pointerup", up);
    };
  }, [x, y]);

  if (!enabled) return null;
  return (
    <>
      <motion.div
        className="pointer-events-none fixed left-0 top-0 z-[100] h-1.5 w-1.5 rounded-full"
        style={{ x, y, translateX: "-50%", translateY: "-50%", background: "var(--fg)" }}
      />
      <motion.div
        className="mono pointer-events-none fixed left-0 top-0 z-[99] flex items-center justify-center rounded-full border text-[10px]"
        style={{ x: rx, y: ry, translateX: "-50%", translateY: "-50%", borderColor: "var(--fg)", color: "var(--bg)" }}
        animate={{
          width: hover ? (label ? 72 : 44) : 28,
          height: hover ? (label ? 72 : 44) : 28,
          scale: down ? 0.8 : 1,
          backgroundColor: label ? "var(--fg)" : "rgba(128,128,128,0)",
          opacity: hover ? 1 : 0.5,
        }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
      >
        {label}
      </motion.div>
    </>
  );
}
