import { createContext, MouseEvent, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Link, LinkProps, useNavigate } from "react-router-dom";
import { animate } from "framer-motion";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const COLS = 18;
const Ctx = createContext<(to: string) => void>(() => {});

/** Grid of squares that sweeps in diagonally (p: 0→1), then sweeps out (p: 1→2). */
function Tiles({ progress }: { progress: { v: number } }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const { size } = useThree();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const cell = size.width / COLS;
  const rows = Math.ceil(size.height / cell);
  const fg = useMemo(
    () => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--fg").trim() || "#111"),
    [],
  );

  useFrame(() => {
    const p = progress.v;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        const delay = ((c + r) / (COLS + rows)) * 0.55;
        const local = p <= 1 ? (p - delay) / 0.45 : 1 - (p - 1 - delay) / 0.45;
        const s = THREE.MathUtils.smoothstep(local, 0, 1);
        dummy.position.set((c + 0.5) * cell - size.width / 2, size.height / 2 - (r + 0.5) * cell, 0);
        dummy.scale.set(cell * s * 1.02, cell * s * 1.02, 1);
        dummy.updateMatrix();
        mesh.current.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COLS * rows]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color={fg} toneMapped={false} />
    </instancedMesh>
  );
}

export function TransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const progress = useRef({ v: 0 });
  const busy = useRef(false);

  const go = useCallback(
    async (to: string) => {
      if (busy.current) return;
      busy.current = true;
      progress.current.v = 0;
      setActive(true);
      await animate(0, 1, { duration: 0.7, ease: "easeInOut", onUpdate: (v) => (progress.current.v = v) });
      navigate(to);
      window.scrollTo(0, 0);
      await animate(1, 2, { duration: 0.7, ease: "easeInOut", onUpdate: (v) => (progress.current.v = v) });
      setActive(false);
      busy.current = false;
    },
    [navigate],
  );

  return (
    <Ctx.Provider value={go}>
      {children}
      {active && (
        <div className="fixed inset-0 z-[90]">
          <Canvas orthographic camera={{ position: [0, 0, 10], zoom: 1 }} gl={{ alpha: true }}>
            <Tiles progress={progress.current} />
          </Canvas>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function TLink({ to, onClick, ...rest }: LinkProps & { to: string }) {
  const go = useContext(Ctx);
  return (
    <Link
      to={to}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        go(to);
      }}
    />
  );
}

export const useGo = () => useContext(Ctx);
