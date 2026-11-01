import { useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const COLS = 70;
const ROWS = 40;
const GAP = 0.62;

const makePalette = (p: Record<"bg" | "floor" | "hot" | "verified" | "declared" | "unresolved" | "grey" | "dead", string>, light: boolean) => ({
  bg: new THREE.Color(p.bg),
  floor: new THREE.Color(p.floor),
  hot: new THREE.Color(p.hot),
  verified: new THREE.Color(p.verified),
  declared: new THREE.Color(p.declared),
  unresolved: new THREE.Color(p.unresolved),
  grey: new THREE.Color(p.grey),
  dead: new THREE.Color(p.dead),
  // additive glows wash out on a light background
  blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
  haloOpacity: light ? 0.14 : 0.09,
  // brighter floor cells pop on dark; darker ones pop on light
  floorGain: (wave: number) => (light ? 1.15 - wave * 0.5 : 0.8 + wave * 0.9),
});
type Palette = ReturnType<typeof makePalette>;

const DARK = makePalette({ bg: "#06080a", floor: "#12261c", hot: "#38ff9c", verified: "#38ff9c", declared: "#6aa6ff", unresolved: "#ff5c5c", grey: "#5a6660", dead: "#2a2f2c" }, false);
const LIGHT = makePalette({ bg: "#fbfbfa", floor: "#9dbfac", hot: "#13803f", verified: "#13803f", declared: "#2c5fb3", unresolved: "#c0392b", grey: "#9aa39e", dead: "#c9cdca" }, true);

type S = "verified" | "declared" | "unresolved";
// The demo process. `p` is each file's place in the recovered lineage; chaos positions are generated below.
const NODES: { p: [number, number, number]; s: S; big?: boolean }[] = [
  { p: [-9, 3.6, 1.5], s: "verified" }, // 0 labor_rates
  { p: [-9, 1.6, 2.2], s: "verified" }, // 1 erp_parts
  { p: [-9, -0.4, 1.2], s: "verified" }, // 2 supplier_prices
  { p: [-9, -2.4, 2], s: "verified" }, // 3 fx_rates
  { p: [-5.5, 2.6, 1.8], s: "verified" }, // 4 materials_mapping
  { p: [-5.5, 0.4, 2.4], s: "verified" }, // 5 overhead
  { p: [-5.5, -1.8, 1.6], s: "unresolved" }, // 6 shipping (broken link)
  { p: [-2, 1.8, 2.6], s: "declared" }, // 7 ERP import (manual)
  { p: [-2, -1, 2], s: "declared" }, // 8 override (manual)
  { p: [1.5, 0.4, 2.2], s: "verified" }, // 9 cost_rollup
  { p: [5, 0.4, 2.6], s: "verified" }, // 10 margin_review
  { p: [9, 0.4, 2.4], s: "verified", big: true }, // 11 customer_quote
];
const EDGES: [number, number][] = [[1, 7], [2, 7], [3, 2], [4, 1], [0, 9], [5, 9], [6, 9], [7, 9], [8, 9], [9, 10], [10, 11]];

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(7);
const CHAOS = NODES.map(() => ({
  p: new THREE.Vector3((rand() - 0.5) * 26, (rand() - 0.5) * 11, rand() * 6 - 1),
  spin: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(1.6),
  phase: rand() * 6.28,
  red: rand() < 0.45,
}));
const TANGLE: [number, number][] = Array.from({ length: 16 }, () => [Math.floor(rand() * 12), Math.floor(rand() * 12)]);
// Shared between camera and nodes: 0 = chaos, 1 = lineage recovered. Driven by scroll.
const scene = { order: 0 };
const sstep = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

const camPath = new THREE.CatmullRomCurve3(
  [[-2, 0.5, 24], [0, 0.5, 19], [-4, 2, 8.5], [3, 2.5, 8.5], [9, 1.4, 6.5]].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
);
const lookPath = new THREE.CatmullRomCurve3(
  [[-8, -0.5, 0], [0, 0.4, 1], [-4, 0.5, 2], [3, 0.5, 2], [9, 0.5, 2.4]].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
);

function CameraRig() {
  const p = useRef(0);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const target = THREE.MathUtils.clamp(window.scrollY / max, 0, 1);
    p.current = THREE.MathUtils.damp(p.current, target, 2.8, dt);
    scene.order = sstep(0.02, 0.2, p.current);
    camPath.getPoint(p.current, pos);
    lookPath.getPoint(p.current, look);
    pos.x += state.pointer.x * 0.6;
    pos.y += state.pointer.y * 0.4;
    const cam = state.camera as THREE.PerspectiveCamera;
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    cam.fov = 52 + Math.sin(p.current * Math.PI) * 8;
    cam.updateProjectionMatrix();
  });
  return null;
}

function Floor({ pal }: { pal: Palette }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const normal = useMemo(() => new THREE.Vector3(), []);

  useLayoutEffect(() => {
    for (let i = 0; i < COLS * ROWS; i++) mesh.current.setColorAt(i, pal.floor);
  }, [pal]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    mesh.current.updateMatrixWorld();
    normal.set(0, 0, 1).transformDirection(mesh.current.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(normal, mesh.current.position);
    ray.setFromCamera(state.pointer, state.camera);
    let px = 1e3, py = 1e3;
    if (ray.ray.intersectPlane(plane, hit)) {
      mesh.current.worldToLocal(hit);
      px = hit.x;
      py = hit.y;
    }
    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = (c - COLS / 2) * GAP;
        const y = (r - ROWS / 2) * GAP;
        const d = Math.hypot(x - px, (y - py) * 1.2);
        const near = Math.max(0, 1 - d / 4);
        const wave = Math.sin(t * 0.9 + c * 0.3 + r * 0.22) * 0.5 + 0.5;
        dummy.position.set(x, y, wave * 0.18 + near * near * 1.2);
        const s = 0.13 + wave * 0.05 + near * 0.28;
        dummy.scale.set(s, s, 1);
        dummy.updateMatrix();
        mesh.current.setMatrixAt(i, dummy.matrix);
        tmp.copy(pal.floor).multiplyScalar(pal.floorGain(wave)).lerp(pal.hot, near * 0.95);
        mesh.current.setColorAt(i, tmp);
        i++;
      }
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} position={[0, -0.5, -2.5]} rotation={[-0.35, 0, 0]} args={[undefined, undefined, COLS * ROWS]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

function Lineage({ pal }: { pal: Palette }) {
  const nodes = useRef<THREE.InstancedMesh>(null!);
  const halos = useRef<THREE.InstancedMesh>(null!);
  const pulses = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const cur = useMemo(() => NODES.map(() => new THREE.Vector3()), []);
  const col = useMemo(() => new THREE.Color(), []);
  const PER = 6;
  const N_SEG = EDGES.length + TANGLE.length;

  const lines = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N_SEG * 6), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N_SEG * 6), 3).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, [N_SEG]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const o = scene.order;
    NODES.forEach((n, i) => {
      // staggered fly-in: each file leaves chaos slightly after the previous one
      const e = sstep(0, 0.6, o * 1.4 - (i / NODES.length) * 0.4);
      const ch = CHAOS[i];
      const drift = (1 - e) * 0.9;
      cur[i].set(
        THREE.MathUtils.lerp(ch.p.x + Math.sin(t * 0.7 + ch.phase) * drift, n.p[0], e),
        THREE.MathUtils.lerp(ch.p.y + Math.cos(t * 0.6 + ch.phase) * drift, n.p[1], e),
        THREE.MathUtils.lerp(ch.p.z + Math.sin(t * 0.5 + ch.phase * 2) * drift, n.p[2], e),
      );
      const chaosK = 1 - e;
      const breathe = 1 + Math.sin(t * 2 + i) * 0.04;
      const w = (n.big ? 2.6 : 1.6) * breathe;
      const h = (n.big ? 1.3 : 0.8) * breathe;
      dummy.position.copy(cur[i]);
      dummy.rotation.set(
        ch.spin.x * (t + ch.phase) * chaosK,
        ch.spin.y * (t + ch.phase) * chaosK + Math.sin(t * 0.5 + i) * 0.18 * e,
        ch.spin.z * (t + ch.phase) * chaosK,
      );
      dummy.scale.set(w, h, 0.14);
      dummy.updateMatrix();
      nodes.current.setMatrixAt(i, dummy.matrix);

      // chaos: dead grey (some red). Recovered: status colour. The quote stays dead until it is traced.
      const chaosCol = n.big ? pal.dead : ch.red ? pal.unresolved : pal.grey;
      col.copy(chaosCol).lerp(pal[n.s], e);
      nodes.current.setColorAt(i, col);
      const blink = n.s === "unresolved" || (ch.red && e < 0.5) ? 0.6 + Math.sin(t * 6 + i) * 0.4 : 0.55 + Math.sin(t * 2 + i) * 0.15;
      dummy.position.z -= 0.12;
      dummy.scale.set(w * (1.35 + blink * 0.25), h * (1.6 + blink * 0.3), 1);
      dummy.updateMatrix();
      halos.current.setMatrixAt(i, dummy.matrix);
      halos.current.setColorAt(i, col);
    });
    nodes.current.instanceMatrix.needsUpdate = true;
    halos.current.instanceMatrix.needsUpdate = true;
    if (nodes.current.instanceColor) nodes.current.instanceColor.needsUpdate = true;
    if (halos.current.instanceColor) halos.current.instanceColor.needsUpdate = true;

    // edges follow the nodes: real edges go dull red → clean status colour, the tangle fades out
    const pos = lines.attributes.position as THREE.BufferAttribute;
    const cl = lines.attributes.color as THREE.BufferAttribute;
    const seg = (k: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Color) => {
      pos.setXYZ(k * 2, a.x, a.y, a.z);
      pos.setXYZ(k * 2 + 1, b.x, b.y, b.z);
      cl.setXYZ(k * 2, c.r, c.g, c.b);
      cl.setXYZ(k * 2 + 1, c.r, c.g, c.b);
    };
    EDGES.forEach(([f, to], k) => {
      const clean = NODES[f].s === "unresolved" ? pal.unresolved : NODES[f].s === "declared" || NODES[to].s === "declared" ? pal.declared : pal.verified;
      col.copy(pal.bg).lerp(pal.unresolved, 0.45).lerp(clean, o);
      seg(k, cur[f], cur[to], col);
    });
    TANGLE.forEach(([f, to], k) => {
      col.copy(pal.bg).lerp(pal.unresolved, 0.5 * (1 - o) * (0.6 + Math.sin(t * 3 + k) * 0.4));
      seg(EDGES.length + k, cur[f], cur[to], col);
    });
    pos.needsUpdate = true;
    cl.needsUpdate = true;

    // data pulses only flow once the lineage is recovered
    for (let i = 0; i < EDGES.length * PER; i++) {
      const e = i % EDGES.length;
      const k = Math.floor(i / EDGES.length);
      const u = (t * 0.22 + k / PER + e * 0.13) % 1;
      dummy.position.lerpVectors(cur[EDGES[e][0]], cur[EDGES[e][1]], u);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar((0.1 + Math.sin(u * Math.PI) * 0.08) * o * o);
      dummy.updateMatrix();
      pulses.current.setMatrixAt(i, dummy.matrix);
      pulses.current.setColorAt(i, NODES[EDGES[e][0]].s === "unresolved" ? pal.unresolved : pal.hot);
    }
    pulses.current.instanceMatrix.needsUpdate = true;
    if (pulses.current.instanceColor) pulses.current.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <lineSegments geometry={lines} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.85} toneMapped={false} />
      </lineSegments>
      <instancedMesh ref={halos} args={[undefined, undefined, NODES.length]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={pal.haloOpacity} blending={pal.blending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={nodes} args={[undefined, undefined, NODES.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={pulses} args={[undefined, undefined, EDGES.length * PER]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial blending={pal.blending} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

export default function GridScene({ light = false }: { light?: boolean }) {
  const pal = light ? LIGHT : DARK;
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <Canvas
        camera={{ position: [-2, 0.5, 24], fov: 52 }}
        dpr={[1, 1.5]}
        eventSource={document.body}
        eventPrefix="client"
        gl={{ alpha: true, antialias: true }}
      >
        <CameraRig />
        <Floor pal={pal} />
        <Lineage pal={pal} />
      </Canvas>
    </div>
  );
}
