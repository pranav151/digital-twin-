import { useMemo, useRef, useEffect, useLayoutEffect, useState, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, ContactShadows, Environment, Lightformer, RoundedBox, useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import type { StationLive, StationKpi, Layout } from "../types";
import { STATE_COLOR, STATE_ICON, STATE_LABEL, type MachineState } from "../types";
import { MachineModel, Arm } from "./MachineModels";
import { MachineGLTF, ModelErrorBoundary } from "./MachineGLTF";

type XZ = [number, number];
const ACCEPTS = new Set<MachineState>(["running", "idle", "starved"]); // downstream can take a part
const isRobotCell = (t?: string) => /robot|weld|palletiz/i.test(t || "");

/** Andon stack light (red/amber/green tower) — the signature machine-status
 *  beacon on real equipment. Lights the lamp that matches the live state. */
function AndonLight({ state }: { state: MachineState }) {
  const lit = state === "running" ? 2
    : (state === "idle" || state === "starved") ? 1
    : (state === "offline") ? -1 : 0;              // 0 = red (down/blocked/maint)
  const lamps = ["#ff3b30", "#ffb020", "#35d06a"]; // index 0 top → 2 bottom
  return (
    <group position={[0, 1.14, 0]}>
      <mesh position={[0, -0.02, 0]}><cylinderGeometry args={[0.018, 0.018, 0.05, 8]} />
        <meshStandardMaterial color="#0b0f16" metalness={0.4} roughness={0.6} /></mesh>
      {lamps.map((c, i) => {
        const on = (2 - i) === lit;
        return (
          <mesh key={i} position={[0, 0.06 + (2 - i) * 0.075, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.07, 12]} />
            <meshStandardMaterial color={c} emissive={c}
              emissiveIntensity={on ? 1.5 : 0.02} toneMapped={!on}
              transparent opacity={on ? 1 : 0.45} />
          </mesh>
        );
      })}
    </group>
  );
}

function Machine({ pos, color, id, name, type, state, oee, rpm, source, model, selected, bottleneck, onClick }: {
  pos: XZ; color: string; id: string; name?: string; type?: string; state: MachineState; oee?: number;
  rpm?: number | null; source?: string; model?: string; selected: boolean; bottleneck: boolean; onClick: () => void;
}) {
  const isReal = !!source && source.startsWith("real_");
  const procedural = <MachineModel type={type} running={state === "running"} rpm={rpm} />;
  return (
    <group position={[pos[0], 0, pos[1]]} onClick={(e: any) => { e.stopPropagation(); onClick(); }}>
      {model ? (
        // real CAD/GLTF model, with the procedural machine as loading + error fallback
        <ModelErrorBoundary fallback={procedural}>
          <Suspense fallback={procedural}>
            <MachineGLTF url={model} running={state === "running"} />
          </Suspense>
        </ModelErrorBoundary>
      ) : procedural}

      {/* high-end dressing: machine plinth + a control cabinet with a glowing HMI panel */}
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <boxGeometry args={[1.86, 0.06, 1.86]} />
        <meshStandardMaterial color="#8b9099" metalness={0.2} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.28, 1.35, 40]} />
        <meshStandardMaterial color="#9aa0a8" metalness={0.3} roughness={0.6} />
      </mesh>
      <group position={[-0.98, 0, 0.6]}>
        <RoundedBox args={[0.42, 1.05, 0.5]} radius={0.04} smoothness={3} position={[0, 0.56, 0]} castShadow>
          <meshStandardMaterial color="#7e848d" metalness={0.55} roughness={0.4} />
        </RoundedBox>
        <mesh position={[0, 0.72, 0.26]}>
          <planeGeometry args={[0.3, 0.2]} />
          <meshStandardMaterial color="#1bd0ff" emissive="#2ad0ff" emissiveIntensity={1.1} toneMapped={false} />
        </mesh>
        {/* andon stack light on top of the control cabinet */}
        <AndonLight state={state} />
      </group>

      {/* safety-fenced cell for robots / welders / palletizers + painted floor border */}
      {isRobotCell(type) && (<>
        <lineSegments position={[0, 0.55, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(2.0, 1.1, 2.0)]} />
          <lineBasicMaterial color="#b7a13a" transparent opacity={0.5} />
        </lineSegments>
        <SafetyBorder s={2.4} />
      </>)}
      {/* state shown as a clean, flat floor ring (no floating beacons) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[1.32, 1.5, 44]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.7 : 0.4} side={THREE.DoubleSide} />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[1.35, 1.6, 44]} />
          <meshBasicMaterial color="#4a9eff" />
        </mesh>
      )}
      <Html position={[0, 2.7, 0]} center distanceFactor={selected || bottleneck ? 12 : 9} zIndexRange={[10, 0]}>
        {selected || bottleneck ? (
          <div className="lbl3d" style={{ borderColor: color }}>
            <b>{id}{name ? ` · ${name}` : ""}</b>
            <span style={{ color }}>{STATE_ICON[state]} {STATE_LABEL[state]}</span>
            {isReal
              ? <em>{rpm != null ? `${Math.round(rpm).toLocaleString()} rpm · ` : ""}◉ LIVE · MTCONNECT</em>
              : <em>OEE {Math.round((oee || 0) * 100)}%</em>}
          </div>
        ) : (
          <div className={"lbl3d compact" + (isReal ? " real" : "")} style={{ borderColor: color }}>
            <b>{id}</b><span style={{ color }}>{STATE_ICON[state]}</span>
            {isReal && <span className="livedot" title="live real machine">◉</span>}
          </div>
        )}
      </Html>
      {bottleneck && (
        <Html position={[0, 3.4, 0]} center distanceFactor={13}><div className="bott3d">▲ BOTTLENECK</div></Html>
      )}
    </group>
  );
}

/** Animated parts travelling A→B; freeze/queue when the segment is stalled. */
// What the part looks like AFTER a given station type has worked on it — so the
// part visibly transforms as it travels the line (raw → machined → … → packed).
function stageOf(type?: string): string {
  const t = (type || "").toLowerCase();
  if (/load|intake|destack/.test(t)) return "raw";
  if (/weld/.test(t)) return "welded";
  if (/mill|cnc|lathe|turn|wash|deburr/.test(t)) return "machined";
  if (/robot|assembl|palletiz|press|stamp|inspect|cmm|scan/.test(t)) return "assembled";
  if (/paint|oven|cure/.test(t)) return "painted";
  if (/pack/.test(t)) return "packed";
  return "raw";
}

/** A EUR-style wooden pallet (4 cheap meshes) — the realvirtual unit-load base. */
function PalletBase() {
  return (
    <group>
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 0.05, 0.46]} />
        <meshStandardMaterial color="#8a6a3f" roughness={0.92} metalness={0.02} />
      </mesh>
      <mesh position={[0, 0.128, 0]}>
        <boxGeometry args={[0.46, 0.01, 0.46]} />
        <meshStandardMaterial color="#9c7a48" roughness={0.9} metalness={0.02} />
      </mesh>
      {[-0.18, 0.18].map((x, i) => (
        <mesh key={i} position={[x, 0.035, 0]}>
          <boxGeometry args={[0.08, 0.07, 0.46]} />
          <meshStandardMaterial color="#6f5330" roughness={0.95} metalness={0.02} />
        </mesh>
      ))}
    </group>
  );
}

// Height of the pallet deck top — loads sit here.
const DECK = 0.135;

/**
 * The PRODUCT being built — a gear-motor / pump housing unit — shown at the stage
 * each station leaves it in, so the whole build story reads down the line:
 * raw casting → machined bored housing → welded mounting feet → assembled with
 * cover + shaft + bolts → painted finished unit → boxed cartons at pack-out.
 */
function Housing({ color, metalness = 0.72, roughness = 0.34 }: { color: string; metalness?: number; roughness?: number }) {
  return (
    <mesh position={[0, DECK + 0.13, 0]} castShadow>
      <cylinderGeometry args={[0.17, 0.18, 0.26, 24]} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
    </mesh>
  );
}

/** A recognizable SUV body (lower body + hood + raked greenhouse), origin at the
 *  wheels so it seats on the floor. ~0.95 m long at scale 1 (scaled up in use). */
function carShell(color: string, metalness = 0.55, roughness = 0.4) {
  return (<>
    {/* lower body / sills */}
    <mesh position={[0, 0.26, 0]} castShadow><boxGeometry args={[0.94, 0.26, 0.44]} /><meshStandardMaterial color={color} metalness={metalness} roughness={roughness} /></mesh>
    {/* hood / bonnet (front = +x) */}
    <mesh position={[0.36, 0.2, 0]} castShadow><boxGeometry args={[0.34, 0.14, 0.42]} /><meshStandardMaterial color={color} metalness={metalness} roughness={roughness} /></mesh>
    {/* greenhouse / cabin, set back and narrower */}
    <mesh position={[-0.06, 0.5, 0]} castShadow><boxGeometry args={[0.56, 0.24, 0.4]} /><meshStandardMaterial color={color} metalness={metalness} roughness={roughness} /></mesh>
    {/* roof rails hint */}
    <mesh position={[-0.06, 0.63, 0]}><boxGeometry args={[0.5, 0.03, 0.42]} /><meshStandardMaterial color={color} metalness={metalness} roughness={roughness} /></mesh>
  </>);
}

const CAR_WHEELS = ([[0.32, 0.24], [0.32, -0.24], [-0.34, 0.24], [-0.34, -0.24]] as [number, number][]);
function carWheels() {
  return (<>{CAR_WHEELS.map(([x, z], i) => (
    <group key={i} position={[x, 0.13, z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.13, 0.13, 0.09, 16]} /><meshStandardMaterial color="#15181e" metalness={0.3} roughness={0.7} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, z > 0 ? 0.045 : -0.045]}><cylinderGeometry args={[0.06, 0.06, 0.02, 12]} /><meshStandardMaterial color="#8b929c" metalness={0.85} roughness={0.3} /></mesh>
    </group>
  ))}</>);
}
function carGlass() {
  return (<mesh position={[-0.06, 0.5, 0]}><boxGeometry args={[0.5, 0.2, 0.42]} /><meshStandardMaterial color="#0a1a26" metalness={0.2} roughness={0.08} emissive="#0a1a2a" emissiveIntensity={0.15} /></mesh>);
}

/** Procedural fallback car (used while the GLB body loads, or if it fails). */
function ProceduralCar({ stage }: { stage: string }) {
  switch (stage) {
    case "raw": return (<group>{/* steel coil on the blanking line */}
      <mesh position={[0, 0.22, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.22, 0.22, 0.6, 22]} /><meshStandardMaterial color="#5b636d" metalness={0.6} roughness={0.72} /></mesh>
      <mesh position={[0, 0.22, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.07, 0.07, 0.62, 16]} /><meshStandardMaterial color="#20252c" metalness={0.5} roughness={0.6} /></mesh>
    </group>);
    case "stamped": return (<group>{/* stack of stamped body panels on a rack */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, 0.12 + i * 0.07, 0]} rotation={[0, 0, 0.06 * (i - 1.5)]} castShadow>
          <boxGeometry args={[0.7, 0.04, 0.44]} /><meshStandardMaterial color="#aab2bd" metalness={0.82} roughness={0.3} /></mesh>
      ))}
    </group>);
    case "welded": return (<group>{carShell("#8a929c", 0.78, 0.42)}{carWheels()}</group>);   // body-in-white shell
    case "painted": return (<group>{carShell("#2b6fc0", 0.55, 0.14)}{carWheels()}{carGlass()}</group>); // painted body
    default: return (<group>{/* finished car — paint, glass, lights, grille */}
      {carShell("#2b6fc0", 0.55, 0.18)}
      {carWheels()}
      {carGlass()}
      {/* headlights */}
      {([0.16, -0.16] as number[]).map((z, i) => (
        <mesh key={i} position={[0.53, 0.24, z]}><boxGeometry args={[0.04, 0.06, 0.1]} /><meshStandardMaterial color="#eef4ff" emissive="#dbe8ff" emissiveIntensity={1.2} toneMapped={false} /></mesh>
      ))}
      {/* BMW-style twin-kidney grille hint */}
      {([0.05, -0.05] as number[]).map((z, i) => (
        <mesh key={i} position={[0.55, 0.17, z]}><boxGeometry args={[0.02, 0.08, 0.06]} /><meshStandardMaterial color="#0b0e12" metalness={0.5} roughness={0.5} /></mesh>
      ))}
      {/* tail lights */}
      {([0.16, -0.16] as number[]).map((z, i) => (
        <mesh key={i} position={[-0.53, 0.28, z]}><boxGeometry args={[0.03, 0.06, 0.1]} /><meshStandardMaterial color="#c0212a" emissive="#c0212a" emissiveIntensity={0.5} /></mesh>
      ))}
    </group>);
  }
}

/** The real modeled SUV body GLB, aligned so its length runs along the line, sized
 *  to the car footprint, and tinted per build stage: bare steel (body-in-white) →
 *  blue (painted) → natural colours (finished, with its own wheels/glass/grille). */
const CAR_LEN = 1.05;
function CarBodyGLTF({ stage }: { stage: string }) {
  const { scene } = useGLTF("/models/bmw_m4.glb") as unknown as { scene: THREE.Group };
  const model = useMemo(() => {
    const s = scene.clone(true);
    // align the car's long axis with X (the travel direction)
    let box = new THREE.Box3().setFromObject(s); const size = new THREE.Vector3(); box.getSize(size);
    if (size.z > size.x) { s.rotation.y = Math.PI / 2; s.updateMatrixWorld(true); }
    box = new THREE.Box3().setFromObject(s); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const scale = CAR_LEN / Math.max(size.x, size.z, 1e-3);
    s.scale.setScalar(scale);
    s.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    // per-stage tint (flat colour overrides the low-poly vertex colours for the
    // unpainted/painted stages; finished keeps the model's natural colours)
    const tint = stage === "welded" ? new THREE.Color("#8b929c")
      : stage === "painted" ? new THREE.Color("#2b6fc0") : null;
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((m as any).isMesh) {
        m.castShadow = true; m.receiveShadow = true;
        const src = m.material as THREE.MeshStandardMaterial;
        if (src) {
          const c = src.clone();
          if (tint) { c.vertexColors = false; c.color = tint; c.metalness = stage === "welded" ? 0.7 : 0.45; c.roughness = stage === "welded" ? 0.45 : 0.18; c.needsUpdate = true; }
          m.material = c;
        }
      }
    });
    return s;
  }, [scene, stage]);
  return <group><primitive object={model} /></group>;
}
useGLTF.preload("/models/bmw_m4.glb");

/** Car product: coil/panels stay procedural; the body stages use the real GLB
 *  body-in-white (falling back to the procedural car while it loads / on error). */
function CarMesh({ stage }: { stage: string }) {
  if (stage === "raw" || stage === "stamped") return <ProceduralCar stage={stage} />;
  return (
    <ModelErrorBoundary fallback={<ProceduralCar stage={stage} />}>
      <Suspense fallback={<ProceduralCar stage={stage} />}>
        <CarBodyGLTF stage={stage} />
      </Suspense>
    </ModelErrorBoundary>
  );
}

/* ============================================================================
 *  BMW M4 PROCESS CELLS — the automation acting ON the car at each station.
 *  Each car-line station is a self-contained CELL: the real body at that build
 *  stage sits at the centre and the station's ACTUAL automation is arranged
 *  around it (weld-robot swarm w/ sparks, paint booth, curing oven, powertrain
 *  marriage, trim/wheel assembly, stamping press, CMM inspection) — so the floor
 *  reads as the real M4 line instead of a row of generic boxes. This is the
 *  faithful process replication (press → body-in-white → paint → assembly → EOL).
 * ========================================================================== */
const CELL_CAR_SCALE = 3.0;

/** Orange body-shop skid rails under the body (hidden for the coil/panel stages). */
function SkidRails() {
  return (<>
    {[-0.62, 0.62].map((z, i) => (
      <mesh key={i} position={[0, 0.1, z]} castShadow receiveShadow>
        <boxGeometry args={[3.5, 0.13, 0.2]} /><meshStandardMaterial color="#c8892e" metalness={0.4} roughness={0.5} />
      </mesh>
    ))}
    {[-1.5, 0, 1.5].map((x, i) => (
      <mesh key={`c${i}`} position={[x, 0.07, 0]}><boxGeometry args={[0.18, 0.09, 1.5]} /><meshStandardMaterial color="#8a5f22" metalness={0.4} roughness={0.6} /></mesh>
    ))}
  </>);
}

/** The staged body for a cell — on a skid at cell scale (coil/panels sit direct). */
function CellCar({ stage, y = 0 }: { stage: string; y?: number }) {
  const onSkid = !(stage === "raw" || stage === "stamped");
  return (
    <group position={[0, y, 0]}>
      {onSkid && <SkidRails />}
      <group position={[0, onSkid ? 0.17 : 0, 0]} scale={CELL_CAR_SCALE}><CarMesh stage={stage} /></group>
    </group>
  );
}

/** A blinking spot-weld flash (emissive core + light) where a torch meets the body. */
function WeldFlash({ position, phase }: { position: [number, number, number]; phase: number }) {
  const m = useRef<THREE.MeshBasicMaterial>(null);
  const l = useRef<THREE.PointLight>(null);
  useFrame((st) => {
    const f = Math.max(0, Math.sin((st.clock.elapsedTime + phase) * 11)) ** 4;
    if (m.current) m.current.opacity = 0.12 + f * 0.88;
    if (l.current) l.current.intensity = f * 3.2;
  });
  return (
    <group position={position}>
      <mesh><sphereGeometry args={[0.07, 8, 8]} /><meshBasicMaterial ref={m} color="#ffe6b0" transparent opacity={0.2} toneMapped={false} /></mesh>
      <pointLight ref={l} distance={2.2} color="#ffb060" intensity={0} />
    </group>
  );
}

/** A line operator — a simple human figure in a BMW-blue polo, one arm working
 *  on the car (the manual trim / inspection stations). Skin tones vary across the
 *  crew. Kept low-poly (a handful of boxes) so a dozen of them stay cheap. */
const SKIN = ["#c68642", "#8d5524", "#e0ac69", "#a9714b", "#f1c27d"];
function Worker({ pos = [0, 0, 0], rot = 0, tone = SKIN[0], phase = 0, working = true }: {
  pos?: [number, number, number]; rot?: number; tone?: string; phase?: number; working?: boolean;
}) {
  const arm = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime + phase;
    if (arm.current) arm.current.rotation.x = working ? -1.15 + Math.sin(t * 2.6) * 0.32 : -0.4;
    if (body.current) body.current.position.y = working ? Math.sin(t * 1.2) * 0.02 : 0;
  });
  const POLO = "#2f5c9e";
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <group ref={body}>
        {[-0.09, 0.09].map((x, i) => (
          <mesh key={i} position={[x, 0.4, 0]} castShadow><boxGeometry args={[0.13, 0.8, 0.16]} /><meshStandardMaterial color="#2a2f36" roughness={0.85} /></mesh>
        ))}
        <mesh position={[0, 1.02, 0]} castShadow><boxGeometry args={[0.34, 0.5, 0.2]} /><meshStandardMaterial color={POLO} roughness={0.7} /></mesh>
        <mesh position={[0, 1.4, 0]} castShadow><sphereGeometry args={[0.11, 16, 16]} /><meshStandardMaterial color={tone} roughness={0.6} /></mesh>
        {/* left arm rests; right arm reaches the car and works */}
        <mesh position={[-0.23, 1.0, 0.02]} rotation={[-0.35, 0, 0.15]} castShadow><boxGeometry args={[0.08, 0.44, 0.09]} /><meshStandardMaterial color={POLO} roughness={0.7} /></mesh>
        <group ref={arm} position={[0.22, 1.2, 0.04]}>
          <mesh position={[0, -0.18, 0.14]} castShadow><boxGeometry args={[0.08, 0.44, 0.09]} /><meshStandardMaterial color={POLO} roughness={0.7} /></mesh>
          <mesh position={[0, -0.38, 0.26]} castShadow><boxGeometry args={[0.07, 0.1, 0.16]} /><meshStandardMaterial color={tone} roughness={0.6} /></mesh>
        </group>
      </group>
    </group>
  );
}

/** BODY SHOP — the framing gate: yellow geo tooling that clamps down over the body
 *  while the robots weld (the "framing station" in the references). */
function FramingGate({ running }: { running: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame((st) => { if (g.current) g.current.position.y = running ? -Math.max(0, Math.sin(st.clock.elapsedTime * 0.8)) * 0.22 : 0.22; });
  return (
    <group ref={g}>
      {[-1.2, 1.2].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 1.95, 0]} castShadow><boxGeometry args={[0.2, 1.7, 2.5]} /><meshStandardMaterial color="#d9a020" metalness={0.4} roughness={0.5} /></mesh>
          {[-0.75, 0.75].map((z, j) => (
            <mesh key={j} position={[x < 0 ? 0.28 : -0.28, 1.25, z]} castShadow><boxGeometry args={[0.34, 0.34, 0.34]} /><meshStandardMaterial color="#3a4048" metalness={0.6} roughness={0.4} /></mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 2.85, 0]} castShadow><boxGeometry args={[2.8, 0.22, 2.6]} /><meshStandardMaterial color="#c9962e" metalness={0.4} roughness={0.5} /></mesh>
    </group>
  );
}

/** BODY SHOP — a swarm of orange KUKA robots framing/spot-welding the body-in-white,
 *  under a descending framing gate (the iconic body-shop station). */
function WeldCell({ stage, running }: { stage: string; running: boolean }) {
  const arms: { pos: [number, number, number]; rot: number; ph: number }[] = [
    { pos: [-1.05, 0, 1.4], rot: -Math.PI / 2, ph: 0 },
    { pos: [1.05, 0, 1.4], rot: -Math.PI / 2, ph: 1.1 },
    { pos: [-1.05, 0, -1.4], rot: Math.PI / 2, ph: 2.0 },
    { pos: [1.05, 0, -1.4], rot: Math.PI / 2, ph: 3.2 },
  ];
  const flashes: [number, number, number][] = [[-0.9, 0.95, 0.55], [0.9, 0.95, -0.55], [0.1, 0.95, 0.6], [-0.4, 0.95, -0.6]];
  return (
    <group>
      <CellCar stage={stage} />
      <FramingGate running={running} />
      {arms.map((a, i) => (
        <group key={i} position={a.pos} rotation={[0, a.rot, 0]} scale={0.95}>
          <Arm running={running} accent="#d9691e" weld phase={a.ph} />
        </group>
      ))}
      {running && flashes.map((p, i) => <WeldFlash key={i} position={p} phase={i * 0.7} />)}
    </group>
  );
}

/** PAINT SHOP — the body in a clean WHITE booth, four white paint robots sweeping
 *  both sides, mist tinted to the coat being applied (references: white booth,
 *  white robots, doors held open). */
function PaintCell({ stage, running }: { stage: string; running: boolean }) {
  const mist = useRef<THREE.Mesh>(null);
  useFrame((st) => { if (mist.current) { mist.current.visible = running; mist.current.scale.setScalar(0.8 + Math.abs(Math.sin(st.clock.elapsedTime * 3)) * 0.5); } });
  const coat = stage === "painted" ? "#2f6fc0" : "#9aa2ad"; // colour coat vs primer/e-coat
  return (
    <group>
      <CellCar stage={stage} />
      {/* clean white booth: top canopy + back wall + partial side walls, front open */}
      <mesh position={[0, 2.3, 0]} castShadow><boxGeometry args={[4.7, 0.22, 2.9]} /><meshStandardMaterial color="#eef1f4" metalness={0.1} roughness={0.5} /></mesh>
      <mesh position={[0, 1.2, -1.45]}><boxGeometry args={[4.7, 2.4, 0.12]} /><meshStandardMaterial color="#e6eaee" metalness={0.1} roughness={0.5} /></mesh>
      {[-2.35, 2.35].map((x, i) => (<mesh key={i} position={[x, 1.2, -0.55]}><boxGeometry args={[0.12, 2.4, 1.8]} /><meshStandardMaterial color="#e6eaee" metalness={0.1} roughness={0.5} /></mesh>))}
      {/* light strips inside the booth */}
      {[-1.4, 1.4].map((z, i) => (<mesh key={i} position={[0, 2.15, z]}><boxGeometry args={[4.2, 0.06, 0.18]} /><meshStandardMaterial color="#ffffff" emissive="#eaf2ff" emissiveIntensity={0.8} toneMapped={false} /></mesh>))}
      {/* four white paint robots, two per side, reaching in */}
      {([[-1.55, 1.15, -Math.PI / 2, 0], [1.55, 1.15, -Math.PI / 2, 1.0], [-1.55, -1.15, Math.PI / 2, 2.0], [1.55, -1.15, Math.PI / 2, 3.0]] as number[][]).map((a, i) => (
        <group key={i} position={[a[0], 0.4, a[1]]} rotation={[0, a[2], 0]} scale={0.8}><Arm running={running} accent="#eef1f4" phase={a[3]} /></group>
      ))}
      <mesh ref={mist} position={[0, 0.95, 0]}><sphereGeometry args={[1.5, 12, 12]} /><meshStandardMaterial color={coat} transparent opacity={0.17} depthWrite={false} /></mesh>
    </group>
  );
}

/** PAINT-CURE — the body under a glowing curing-oven canopy. */
function OvenCell({ stage, running }: { stage: string; running: boolean }) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((st) => { if (glow.current) glow.current.emissiveIntensity = running ? 0.7 + Math.sin(st.clock.elapsedTime * 3) * 0.3 : 0.1; });
  return (
    <group>
      <CellCar stage={stage} />
      <mesh position={[0, 2.25, 0]} castShadow><boxGeometry args={[4.3, 0.45, 2.7]} /><meshStandardMaterial color="#8a9098" metalness={0.3} roughness={0.7} /></mesh>
      <mesh position={[0, 1.25, -1.4]}><boxGeometry args={[4.3, 2.0, 0.16]} /><meshStandardMaterial color="#7e848d" metalness={0.3} roughness={0.7} /></mesh>
      <mesh position={[0, 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[3.9, 2.3]} /><meshStandardMaterial ref={glow} color="#ff7a2f" emissive="#ff5a1a" emissiveIntensity={0.8} transparent opacity={0.55} side={THREE.DoubleSide} /></mesh>
      {running && <pointLight position={[0, 1.0, 0]} distance={4.5} intensity={2.2} color="#ff7a3a" />}
    </group>
  );
}

/** FINAL ASSEMBLY — powertrain "marriage": the body is held HIGH under a white arch
 *  gantry while the drivetrain rises on a lift to meet it; blue KUKA robots torque
 *  it up and an operator guides it (references: arch gantry + blue robots + skid). */
function MarriageCell({ stage, running }: { stage: string; running: boolean }) {
  const lift = useRef<THREE.Group>(null);
  useFrame((st) => { if (lift.current) lift.current.position.y = running ? 0.1 + Math.abs(Math.sin(st.clock.elapsedTime * 0.7)) * 0.5 : 0.1; });
  return (
    <group>
      <CellCar stage={stage} y={0.8} />
      {/* white arch gantry straddling the body */}
      {[-1.3, 1.3].map((z, i) => (<mesh key={i} position={[0, 1.45, z]} castShadow><boxGeometry args={[0.2, 2.9, 0.2]} /><meshStandardMaterial color="#e8ebef" metalness={0.2} roughness={0.5} /></mesh>))}
      <mesh position={[0, 2.95, 0]} castShadow><boxGeometry args={[0.24, 0.24, 2.8]} /><meshStandardMaterial color="#e8ebef" metalness={0.2} roughness={0.5} /></mesh>
      <mesh position={[0, 2.82, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.95, 0.07, 8, 24, Math.PI]} /><meshStandardMaterial color="#dfe3e8" metalness={0.2} roughness={0.5} /></mesh>
      {/* skid marked "01" carrying the drivetrain up to the body */}
      <mesh position={[0, 0.05, 0]}><boxGeometry args={[1.9, 0.1, 1.3]} /><meshStandardMaterial color="#c8892e" metalness={0.3} roughness={0.6} /></mesh>
      <group ref={lift}>
        <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[1.7, 0.35, 1.1]} /><meshStandardMaterial color="#3a4048" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0.45, 0.6, 0]} castShadow><boxGeometry args={[0.7, 0.5, 0.7]} /><meshStandardMaterial color="#2a2f36" metalness={0.5} roughness={0.5} /></mesh>
        <mesh position={[-0.55, 0.34, 0.22]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.05, 0.05, 0.95, 10]} /><meshStandardMaterial color="#9aa0a8" metalness={0.7} roughness={0.3} /></mesh>
      </group>
      {/* blue KUKA robots each side */}
      {([[1.7, 0.95, -Math.PI * 0.65, 0], [-1.7, -0.95, Math.PI * 0.35, 1.5]] as number[][]).map((a, i) => (
        <group key={i} position={[a[0], 0, a[1]]} rotation={[0, a[2], 0]} scale={0.9}><Arm running={running} accent="#2f7fd6" phase={a[3]} /></group>
      ))}
      <Worker pos={[-1.95, 0, 1.35]} rot={-Math.PI * 0.72} tone={SKIN[1]} working={running} phase={0.6} />
    </group>
  );
}

/** FINAL ASSEMBLY — trim / wheels: the MANUAL side of the line. One assist robot,
 *  human operators fitting parts (dash, doors, wheels), and a staged parts rack. */
function AssemblyCell({ stage, running }: { stage: string; running: boolean }) {
  return (
    <group>
      <CellCar stage={stage} />
      {/* one assist robot (heavy lifts) + two human operators on the trim line */}
      <group position={[1.75, 0, -1.15]} rotation={[0, Math.PI * 0.4, 0]} scale={0.85}><Arm running={running} accent="#d9691e" phase={0} /></group>
      <Worker pos={[-1.5, 0, 1.35]} rot={Math.PI} tone={SKIN[0]} working={running} phase={0} />
      <Worker pos={[1.25, 0, 1.35]} rot={Math.PI} tone={SKIN[3]} working={running} phase={1.3} />
      <Worker pos={[-1.25, 0, -1.4]} rot={0} tone={SKIN[2]} working={running} phase={2.1} />
      {/* staged parts rack (wheels/doors) at the lineside */}
      <group position={[0, 0, 2.0]}>
        <mesh position={[0, 0.55, 0]}><boxGeometry args={[1.5, 1.1, 0.12]} /><meshStandardMaterial color="#6b727b" metalness={0.4} roughness={0.5} /></mesh>
        {[-0.45, 0.45].map((x, i) => (<mesh key={i} position={[x, 0.75, 0.16]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.22, 0.22, 0.13, 18]} /><meshStandardMaterial color="#15181e" metalness={0.3} roughness={0.7} /></mesh>))}
      </group>
    </group>
  );
}

/** CMM inspection — a measuring gantry traversing the body with a scan plane. */
function InspectCell({ stage, running }: { stage: string; running: boolean }) {
  const bridge = useRef<THREE.Group>(null);
  useFrame((st) => { if (running && bridge.current) bridge.current.position.x = Math.sin(st.clock.elapsedTime * 0.8) * 1.5; });
  return (
    <group>
      <CellCar stage={stage} />
      {[-1.3, 1.3].map((z, i) => (
        <mesh key={i} position={[0, 0.03, z]}><boxGeometry args={[4.6, 0.06, 0.12]} /><meshStandardMaterial color="#5b626b" metalness={0.5} roughness={0.4} /></mesh>
      ))}
      <group ref={bridge}>
        {[-1.3, 1.3].map((z, i) => (<mesh key={i} position={[0, 1.15, z]}><boxGeometry args={[0.12, 2.3, 0.12]} /><meshStandardMaterial color="#6b727b" metalness={0.5} roughness={0.4} /></mesh>))}
        <mesh position={[0, 2.3, 0]}><boxGeometry args={[0.14, 0.14, 2.8]} /><meshStandardMaterial color="#aab0b8" metalness={0.6} roughness={0.35} /></mesh>
        {running && <mesh position={[0, 1.1, 0]}><boxGeometry args={[0.03, 1.7, 2.5]} /><meshBasicMaterial color="#5dd0ff" transparent opacity={0.22} toneMapped={false} /></mesh>}
      </group>
      {/* a QA operator walking the body */}
      <Worker pos={[-1.95, 0, 1.3]} rot={-Math.PI * 0.72} tone={SKIN[4]} working={running} phase={0.9} />
    </group>
  );
}

/** PRESS SHOP — a stamping press straddling the line, ram cycling on the panel. */
function StampCell({ stage, running }: { stage: string; running: boolean }) {
  const ram = useRef<THREE.Mesh>(null);
  useFrame((st) => { if (ram.current) { const t = st.clock.elapsedTime * 2.5; ram.current.position.y = running ? 1.75 + Math.min(0, Math.sin(t)) * 0.5 : 1.75; } });
  return (
    <group>
      <CellCar stage={stage} />
      {[-1.35, 1.35].map((x, i) => (<mesh key={i} position={[x, 1.45, 0]} castShadow><boxGeometry args={[0.42, 2.9, 1.3]} /><meshStandardMaterial color="#7e848d" metalness={0.6} roughness={0.4} /></mesh>))}
      <mesh position={[0, 3.0, 0]} castShadow><boxGeometry args={[3.1, 0.5, 1.4]} /><meshStandardMaterial color="#929aa3" metalness={0.6} roughness={0.4} /></mesh>
      <mesh ref={ram} position={[0, 1.75, 0]} castShadow><boxGeometry args={[1.9, 0.6, 1.05]} /><meshStandardMaterial color="#6b727b" metalness={0.6} roughness={0.35} /></mesh>
      <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[2.1, 0.3, 1.15]} /><meshStandardMaterial color="#aab0b8" metalness={0.6} roughness={0.4} /></mesh>
    </group>
  );
}

/** PRESS SHOP infeed — steel coil on an uncoiler with feed rollers. */
function CoilCell({ stage }: { stage: string; running?: boolean }) {
  return (
    <group>
      <CellCar stage={stage} />
      <mesh position={[0, 0.9, 0]} castShadow><boxGeometry args={[0.42, 1.8, 1.7]} /><meshStandardMaterial color="#7e848d" metalness={0.5} roughness={0.45} /></mesh>
      {[-0.65, 0.65].map((x, i) => (<mesh key={i} position={[x, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.12, 0.12, 1.5, 12]} /><meshStandardMaterial color="#aab0b8" metalness={0.7} roughness={0.3} /></mesh>))}
    </group>
  );
}

/** Route a car-line station to its process cell by operation type / name. */
function carCellKind(type?: string, name?: string): string {
  const t = (type || "").toLowerCase(), nm = (name || "").toLowerCase();
  if (t.includes("paint")) return "paint";
  if (t.includes("oven") || t.includes("cur")) return "oven";
  if (t.includes("weld")) return "weld";
  if (t.includes("press") || t.includes("stamp")) return "stamp";
  if (t.includes("inspect") || t.includes("scan") || t.includes("cmm")) return "inspect";
  if (nm.includes("marriage")) return "marriage";
  if (nm.includes("framing") || nm.includes("biw") || nm.includes("body")) return "weld";
  if (t.includes("load") || nm.includes("coil") || nm.includes("blank")) return "coil";
  return "assembly";
}

/** One car-line station rendered as a full process cell + its live status chrome
 *  (floor ring, andon light, label, click-to-inspect, bottleneck flag). */
function CarAutoCell({ pos, state, color, id, name, type, oee, stage, selected, bottleneck, onClick }: {
  pos: XZ; state: MachineState; color: string; id: string; name?: string; type?: string;
  oee?: number; stage: string; selected: boolean; bottleneck: boolean; onClick: () => void;
}) {
  const running = state === "running";
  const kind = carCellKind(type, name);
  return (
    <group position={[pos[0], 0, pos[1]]} onClick={(e: any) => { e.stopPropagation(); onClick(); }}>
      {kind === "weld" && <WeldCell stage={stage} running={running} />}
      {kind === "paint" && <PaintCell stage={stage} running={running} />}
      {kind === "oven" && <OvenCell stage={stage} running={running} />}
      {kind === "marriage" && <MarriageCell stage={stage} running={running} />}
      {kind === "assembly" && <AssemblyCell stage={stage} running={running} />}
      {kind === "inspect" && <InspectCell stage={stage} running={running} />}
      {kind === "stamp" && <StampCell stage={stage} running={running} />}
      {kind === "coil" && <CoilCell stage={stage} />}

      {/* live-state floor ring around the whole cell */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
        <ringGeometry args={[2.05, 2.35, 48]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.75 : 0.42} side={THREE.DoubleSide} />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
          <ringGeometry args={[2.35, 2.6, 48]} /><meshBasicMaterial color="#4a9eff" />
        </mesh>
      )}
      <group position={[2.0, 0, -1.7]}><AndonLight state={state} /></group>
      <Html position={[0, 3.1, 0]} center distanceFactor={selected || bottleneck ? 15 : 12} zIndexRange={[10, 0]}>
        {selected || bottleneck ? (
          <div className="lbl3d" style={{ borderColor: color }}>
            <b>{id}{name ? ` · ${name}` : ""}</b>
            <span style={{ color }}>{STATE_ICON[state]} {STATE_LABEL[state]}</span>
            <em>OEE {Math.round((oee || 0) * 100)}%</em>
          </div>
        ) : (
          <div className="lbl3d compact" style={{ borderColor: color }}><b>{id}</b><span style={{ color }}>{STATE_ICON[state]}</span></div>
        )}
      </Html>
      {bottleneck && (<Html position={[0, 3.8, 0]} center distanceFactor={16}><div className="bott3d">▲ BOTTLENECK</div></Html>)}
    </group>
  );
}

function PartMesh({ stage, product }: { stage: string; product?: string | null }) {
  if (product === "car") return <CarMesh stage={stage} />;
  if (product === "engine") return <EngineMesh stage={stage} />;
  const B = DECK;
  switch (stage) {
    case "machined": return (<group><PalletBase />
      <Housing color="#b8c0cb" metalness={0.88} roughness={0.2} />
      {/* machined bore in the top face */}
      <mesh position={[0, B + 0.27, 0]}><cylinderGeometry args={[0.08, 0.08, 0.04, 20]} /><meshStandardMaterial color="#20252c" metalness={0.5} roughness={0.6} /></mesh>
      <mesh position={[0, B + 0.265, 0]}><torusGeometry args={[0.12, 0.012, 8, 24]} /><meshStandardMaterial color="#d6dbe2" metalness={0.9} roughness={0.15} /></mesh>
    </group>);
    case "welded": return (<group><PalletBase />
      <Housing color="#9aa2ad" />
      {/* welded mounting feet + glowing weld bead */}
      {[-1, 1].map((s, i) => (
        <mesh key={i} position={[s * 0.2, B + 0.05, 0]} castShadow><boxGeometry args={[0.12, 0.06, 0.3]} /><meshStandardMaterial color="#8b939e" metalness={0.6} roughness={0.4} /></mesh>
      ))}
      <mesh position={[0, B + 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.18, 0.014, 8, 24]} /><meshStandardMaterial color="#ffb060" emissive="#ff6a1a" emissiveIntensity={0.7} /></mesh>
    </group>);
    case "assembled": return (<group><PalletBase />
      <Housing color="#8f98a4" metalness={0.62} roughness={0.4} />
      {/* bolted end cover + output shaft + bolt heads */}
      <mesh position={[0, B + 0.28, 0]} castShadow><cylinderGeometry args={[0.19, 0.19, 0.04, 24]} /><meshStandardMaterial color="#5b636d" metalness={0.6} roughness={0.4} /></mesh>
      <mesh position={[0, B + 0.4, 0]} castShadow><cylinderGeometry args={[0.035, 0.035, 0.18, 12]} /><meshStandardMaterial color="#ccd2da" metalness={0.9} roughness={0.18} /></mesh>
      {[[0.13, 0.13], [-0.13, 0.13], [0.13, -0.13], [-0.13, -0.13]].map(([x, z], i) => (
        <mesh key={i} position={[x, B + 0.305, z]}><cylinderGeometry args={[0.02, 0.02, 0.03, 6]} /><meshStandardMaterial color="#33393f" metalness={0.7} roughness={0.4} /></mesh>
      ))}
    </group>);
    case "painted": return (<group><PalletBase />
      <Housing color="#2f6fb0" metalness={0.34} roughness={0.16} />
      <mesh position={[0, B + 0.28, 0]} castShadow><cylinderGeometry args={[0.19, 0.19, 0.04, 24]} /><meshStandardMaterial color="#2960a0" metalness={0.34} roughness={0.16} envMapIntensity={1.1} /></mesh>
      <mesh position={[0, B + 0.4, 0]} castShadow><cylinderGeometry args={[0.035, 0.035, 0.18, 12]} /><meshStandardMaterial color="#ccd2da" metalness={0.9} roughness={0.18} /></mesh>
    </group>);
    case "packed": return (<group><PalletBase />
      {/* stacked kraft cartons with tape — the pack-out unit load */}
      {[[-0.11, DECK + 0.11, 0], [0.11, DECK + 0.11, 0], [0, DECK + 0.32, 0]].map((p, i) => (
        <group key={i} position={p as [number, number, number]}>
          <mesh castShadow><boxGeometry args={[0.2, 0.2, 0.42]} /><meshStandardMaterial color="#c69a5e" roughness={0.86} metalness={0.02} /></mesh>
          <mesh position={[0, 0.005, 0]}><boxGeometry args={[0.205, 0.03, 0.06]} /><meshStandardMaterial color="#e6cc9a" roughness={0.7} /></mesh>
        </group>
      ))}
    </group>);
    case "raw": return (<group><PalletBase />
      {/* rough sand-cast blank — unmachined */}
      <mesh position={[0, B + 0.12, 0]} castShadow rotation={[0, 0.3, 0.04]}><boxGeometry args={[0.34, 0.24, 0.3]} /><meshStandardMaterial color="#565d67" metalness={0.4} roughness={0.92} /></mesh>
    </group>);
    default: return (<group><PalletBase />
      <mesh position={[0, B + 0.12, 0]} castShadow><boxGeometry args={[0.3, 0.22, 0.3]} /><meshStandardMaterial color="#7d858f" metalness={0.3} roughness={0.68} /></mesh>
    </group>);
  }
}

function FlowParticles({ a, b, flowing, speed, stage, product }: { a: XZ; b: XZ; flowing: boolean; speed: number; stage: string; product?: string | null }) {
  const N = (product === "car" || product === "engine") ? 1 : 3;   // heavy hero products — one per belt
  const grp = useRef<THREE.Group>(null);
  const ts = useRef<number[]>(Array.from({ length: N }, (_, i) => i / N));
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  useFrame((_, dt) => {
    const g = grp.current; if (!g) return;
    const v = flowing ? speed : 0;
    for (let i = 0; i < N; i++) {
      let t = ts.current[i] + v * dt;
      if (t > 1) t -= 1;
      ts.current[i] = t;
      const ch = g.children[i] as THREE.Object3D;
      ch.position.set(a[0] + (b[0] - a[0]) * t, 0.53, a[1] + (b[1] - a[1]) * t);
      ch.rotation.y = -angle;
    }
  });
  return (
    <group ref={grp}>
      {Array.from({ length: N }).map((_, i) => (
        <group key={i} scale={product === "car" ? 0.62 : product === "engine" ? 0.5 : 1}><PartMesh stage={stage} product={product} /></group>
      ))}
    </group>
  );
}

// Realistic gravity roller conveyor: steel side frames, a bed of turning rollers,
// and support legs — the realvirtual/industrial look, built procedurally.
function Conveyor({ a, b }: { a: XZ; b: XZ }) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const nRollers = Math.max(4, Math.round(len / 0.4));
  const nLegs = Math.max(2, Math.round(len / 2));
  return (
    <group position={[(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2]} rotation={[0, -angle, 0]}>
      {/* side frames (no shadow-cast — hundreds of these across the line) */}
      {[-0.34, 0.34].map((z, i) => (
        <mesh key={i} position={[0, 0.44, z]}>
          <boxGeometry args={[len, 0.14, 0.07]} />
          <meshStandardMaterial color="#3a4658" metalness={0.72} roughness={0.34} />
        </mesh>
      ))}
      {/* roller bed */}
      {Array.from({ length: nRollers }).map((_, i) => (
        <mesh key={i} position={[-len / 2 + (i + 0.5) * (len / nRollers), 0.47, 0]}
          rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 0.64, 10]} />
          <meshStandardMaterial color="#aeb4be" metalness={0.9} roughness={0.26} />
        </mesh>
      ))}
      {/* support legs */}
      {Array.from({ length: nLegs }).map((_, i) => {
        const x = -len / 2 + (nLegs === 1 ? 0.5 : i / (nLegs - 1)) * len;
        return (
          <group key={i}>
            {[-0.3, 0.3].map((z, j) => (
              <mesh key={j} position={[x, 0.2, z]}>
                <boxGeometry args={[0.07, 0.42, 0.07]} />
                <meshStandardMaterial color="#2a3648" metalness={0.6} roughness={0.42} />
              </mesh>
            ))}
            <mesh position={[x, 0.4, 0]}><boxGeometry args={[0.1, 0.05, 0.64]} /><meshStandardMaterial color="#2a3648" metalness={0.6} roughness={0.42} /></mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Buffer / WIP indicator at the segment midpoint — stacked cubes = parts in transit. */
function Buffer({ a, b, wip }: { a: XZ; b: XZ; wip: number }) {
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const n = Math.max(0, Math.min(6, wip));
  if (n === 0) return null;
  return (
    <group position={[mx, 0, mz - 0.9]}>
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[0.9, 0.08, 0.9]} />
        <meshStandardMaterial color="#141c28" />
      </mesh>
      {Array.from({ length: n }).map((_, i) => (
        <mesh key={i} position={[0, 0.2 + i * 0.22, 0]} castShadow>
          <boxGeometry args={[0.34, 0.2, 0.34]} />
          <meshStandardMaterial color="#33506e" metalness={0.2} roughness={0.6} />
        </mesh>
      ))}
      <Html position={[0, 0.2 + Math.max(1, n) * 0.22 + 0.2, 0]} center distanceFactor={14}>
        <div className="wip3d">WIP {wip}</div>
      </Html>
    </group>
  );
}

function Zone({ x, z, w, d, label }: { x: number; z: number; w: number; d: number; label: string }) {
  return (
    <group position={[x + w / 2, 0, z + d / 2]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <planeGeometry args={[w - 0.3, d - 0.3]} />
        <meshStandardMaterial color="#111a29" roughness={1} transparent opacity={0.85} />
      </mesh>
      <Html position={[-(w / 2) + 0.5, 0.02, -(d / 2) + 0.5]} distanceFactor={16}>
        <div className="zone3d">{label}</div>
      </Html>
    </group>
  );
}

/** Industrial pallet racking along the back wall — blue steel uprights, safety-
 *  orange load beams, and mixed pallet loads (kraft cartons / shrink-wrapped). */
function Racks({ x0, x1, z }: { x0: number; x1: number; z: number }) {
  const bays = Math.max(3, Math.round((x1 - x0) / 3));
  return (
    <group>
      {Array.from({ length: bays }).map((_, i) => {
        const x = x0 + (i + 0.5) * ((x1 - x0) / bays);
        return (
          <group key={i} position={[x, 0, z]}>
            {/* blue steel uprights with a diagonal brace */}
            {[-1, 1].map((s) => (
              <group key={s}>
                <mesh position={[s * 0.7, 1.1, 0]} castShadow>
                  <boxGeometry args={[0.1, 2.2, 0.14]} />
                  <meshStandardMaterial color="#2f4d74" metalness={0.5} roughness={0.5} />
                </mesh>
                <mesh position={[s * 0.7, 1.1, -0.28]} rotation={[0.5, 0, 0]}>
                  <boxGeometry args={[0.04, 2.3, 0.03]} />
                  <meshStandardMaterial color="#28405f" metalness={0.5} roughness={0.55} />
                </mesh>
              </group>
            ))}
            {[0.5, 1.2, 1.9].map((y, k) => (
              <group key={k}>
                {/* safety-orange load beams (front + back) */}
                {[-0.3, 0.3].map((zz, j) => (
                  <mesh key={j} position={[0, y, zz]}>
                    <boxGeometry args={[1.6, 0.09, 0.06]} />
                    <meshStandardMaterial color="#c76a18" metalness={0.35} roughness={0.55} />
                  </mesh>
                ))}
                {(i + k) % 3 !== 0 && (
                  <group position={[0, y + 0.04, 0]}>
                    {/* wooden pallet + a load (kraft cartons or shrink-wrapped) */}
                    <mesh position={[0, 0.05, 0]}><boxGeometry args={[1.2, 0.08, 0.66]} />
                      <meshStandardMaterial color="#7a5c33" roughness={0.9} /></mesh>
                    {(i + k) % 2 === 0 ? (
                      <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[1.06, 0.42, 0.58]} />
                        <meshStandardMaterial color="#bb8d54" roughness={0.85} /></mesh>
                    ) : (
                      <mesh position={[0, 0.32, 0]} castShadow><boxGeometry args={[1.02, 0.46, 0.56]} />
                        <meshStandardMaterial color="#9aa3ae" metalness={0.1} roughness={0.35}
                          transparent opacity={0.9} /></mesh>
                    )}
                  </group>
                )}
              </group>
            ))}
          </group>
        );
      })}
    </group>
  );
}

/** Overhead gantry crane bridging the floor; slowly traverses along X. */
function GantryCrane({ x0, x1, z0, z1 }: { x0: number; x1: number; z0: number; z1: number }) {
  const bridge = useRef<THREE.Group>(null);
  const trolley = useRef<THREE.Group>(null);
  const span = z1 - z0, mid = (z0 + z1) / 2, y = 6.2;
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    if (bridge.current) bridge.current.position.x = (x0 + x1) / 2 + Math.sin(t * 0.18) * (x1 - x0) * 0.4;
    if (trolley.current) trolley.current.position.z = mid + Math.sin(t * 0.5) * span * 0.32;
  });
  return (
    <>
      {/* runway rails on the two long walls */}
      {[z0, z1].map((z, i) => (
        <mesh key={i} position={[(x0 + x1) / 2, y + 0.3, z]}>
          <boxGeometry args={[x1 - x0 + 2, 0.18, 0.18]} />
          <meshStandardMaterial color="#2a3852" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
      <group ref={bridge}>
        <mesh position={[0, y, mid]} castShadow>
          <boxGeometry args={[0.3, 0.3, span + 1]} />
          <meshStandardMaterial color="#c0902f" metalness={0.3} roughness={0.6} />
        </mesh>
        <group ref={trolley}>
          <mesh position={[0, y - 0.15, mid]} castShadow>
            <boxGeometry args={[0.45, 0.3, 0.45]} />
            <meshStandardMaterial color="#3a475f" metalness={0.5} roughness={0.4} />
          </mesh>
          {/* hoist line + hook */}
          <mesh position={[0, y - 1.1, mid]}>
            <cylinderGeometry args={[0.02, 0.02, 1.7, 6]} />
            <meshStandardMaterial color="#1a2333" />
          </mesh>
          <mesh position={[0, y - 2.0, mid]} castShadow>
            <boxGeometry args={[0.22, 0.22, 0.22]} />
            <meshStandardMaterial color="#9aa7bd" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      </group>
    </>
  );
}

/** One AGV (automated guided vehicle) carrying a tote, looping a waypoint circuit. */
function AGVFleet({ loop, count, speed, color }: { loop: XZ[]; count: number; speed: number; color: string }) {
  const grp = useRef<THREE.Group>(null);
  const segs = useMemo(() => {
    const s: { a: XZ; b: XZ; len: number; head: number }[] = [];
    let total = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      s.push({ a, b, len, head: Math.atan2(b[1] - a[1], b[0] - a[0]) });
      total += len;
    }
    return { s, total };
  }, [loop]);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current = (t.current + (dt * speed) / segs.total) % 1;
    const g = grp.current; if (!g) return;
    for (let i = 0; i < count; i++) {
      const u = (t.current + i / count) % 1;
      let dist = u * segs.total;
      let seg = segs.s[0];
      for (const sg of segs.s) { if (dist <= sg.len) { seg = sg; break; } dist -= sg.len; }
      const f = seg.len ? dist / seg.len : 0;
      const child = g.children[i] as THREE.Group;
      child.position.set(seg.a[0] + (seg.b[0] - seg.a[0]) * f, 0, seg.a[1] + (seg.b[1] - seg.a[1]) * f);
      child.rotation.y = -seg.head;
    }
  });
  return (
    <group ref={grp}>
      {Array.from({ length: count }).map((_, i) => (
        <group key={i}>
          {/* chassis */}
          <mesh position={[0, 0.2, 0]} castShadow>
            <boxGeometry args={[0.9, 0.28, 0.6]} />
            <meshStandardMaterial color={color} metalness={0.3} roughness={0.6} />
          </mesh>
          {/* carried tote */}
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[0.5, 0.36, 0.44]} />
            <meshStandardMaterial color="#5a6b82" metalness={0.2} roughness={0.6} />
          </mesh>
          {/* guidance beacon */}
          <mesh position={[0.4, 0.42, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color="#39d0ff" emissive="#39d0ff" emissiveIntensity={1.2} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Painted floor guideways for the AGV circuit. */
function AisleLines({ loop }: { loop: XZ[] }) {
  return (
    <group>
      {loop.map((a, i) => {
        const b = loop[(i + 1) % loop.length];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, Math.atan2(dz, dx)]}
                position={[(a[0] + b[0]) / 2, 0.025, (a[1] + b[1]) / 2]}>
            <planeGeometry args={[len, 0.12]} />
            <meshBasicMaterial color="#caa63a" transparent opacity={0.5} />
          </mesh>
        );
      })}
    </group>
  );
}

// ---- plant hall: structure & dressing (high-end layout) -------------------
function Column({ x, z, h }: { x: number; z: number; h: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.1, 0]} receiveShadow>
        <boxGeometry args={[0.95, 0.2, 0.95]} />
        <meshStandardMaterial color="#141d29" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, h / 2 + 0.2, 0]} castShadow>
        <boxGeometry args={[0.4, h, 0.4]} />
        <meshStandardMaterial color="#26344a" metalness={0.62} roughness={0.38} />
      </mesh>
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[0.42, 0.6, 0.42]} />
        <meshStandardMaterial color="#c9a13b" metalness={0.25} roughness={0.65} />
      </mesh>
      <mesh position={[0, h + 0.12, 0]}>
        <boxGeometry args={[0.72, 0.2, 0.72]} />
        <meshStandardMaterial color="#26344a" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

function RoofTrusses({ x0, x1, z0, z1, y }: { x0: number; x1: number; z0: number; z1: number; y: number }) {
  const spanX = x1 - x0, spanZ = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const nx = Math.max(2, Math.round(spanX / 8)), nz = Math.max(2, Math.round(spanZ / 6));
  return (
    <>
      {Array.from({ length: nx + 1 }).map((_, i) => {
        const x = x0 + (i / nx) * spanX;
        return (
          <mesh key={`t${i}`} position={[x, y, cz]}>
            <boxGeometry args={[0.2, 0.34, spanZ + 1.5]} />
            <meshStandardMaterial color="#141d29" metalness={0.5} roughness={0.5} />
          </mesh>
        );
      })}
      {Array.from({ length: nz + 1 }).map((_, j) => {
        const z = z0 + (j / nz) * spanZ;
        return (
          <mesh key={`l${j}`} position={[cx, y + 0.36, z]}>
            <boxGeometry args={[spanX + 1.5, 0.18, 0.16]} />
            <meshStandardMaterial color="#101823" metalness={0.5} roughness={0.5} />
          </mesh>
        );
      })}
    </>
  );
}

function HighBay({ x, z, y }: { x: number; z: number; y: number }) {
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.45, 0]}><cylinderGeometry args={[0.02, 0.02, 0.9, 6]} /><meshStandardMaterial color="#1a2333" /></mesh>
      <mesh><boxGeometry args={[0.82, 0.2, 0.82]} /><meshStandardMaterial color="#2a3648" metalness={0.55} roughness={0.45} /></mesh>
      <mesh position={[0, -0.13, 0]}>
        <boxGeometry args={[0.64, 0.05, 0.64]} />
        <meshStandardMaterial color="#eef4ff" emissive="#dbe8ff" emissiveIntensity={1.7} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Yellow painted safety border (square outline) around a robot cell footprint. */
function SafetyBorder({ s = 2.5 }: { s?: number }) {
  const h = s / 2, w = 0.1;
  const bar = (px: number, pz: number, lx: number, lz: number, k: string) => (
    <mesh key={k} rotation={[-Math.PI / 2, 0, 0]} position={[px, 0.032, pz]}>
      <planeGeometry args={[lx, lz]} />
      <meshBasicMaterial color="#d9b13a" transparent opacity={0.55} />
    </mesh>
  );
  return <group>{[bar(0, -h, s, w, "n"), bar(0, h, s, w, "s"), bar(-h, 0, w, s, "w"), bar(h, 0, w, s, "e")]}</group>;
}

/** A stacked pallet of finished goods. */
function Pallet({ x, z, r = 0 }: { x: number; z: number; r?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, r, 0]}>
      <mesh position={[0, 0.08, 0]} castShadow><boxGeometry args={[1.0, 0.12, 1.0]} /><meshStandardMaterial color="#5f4527" roughness={0.9} /></mesh>
      {[[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]].map(([dx, dz], i) => (
        <mesh key={i} position={[dx, 0.34, dz]} castShadow>
          <boxGeometry args={[0.42, 0.4, 0.42]} /><meshStandardMaterial color="#a8823f" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** Safety bollard (yellow post). */
function Bollard({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x, 0.35, z]} castShadow>
      <cylinderGeometry args={[0.08, 0.1, 0.7, 12]} />
      <meshStandardMaterial color="#d9b13a" metalness={0.2} roughness={0.6} emissive="#3a2e08" emissiveIntensity={0.3} />
    </mesh>
  );
}

/** Lineside logistics — a colored parts tote on a wheeled dolly (the teal/magenta
 *  containers staged beside the line in the BMW/NVIDIA references). */
function LogisticsTote({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.11, 0]} castShadow><boxGeometry args={[0.7, 0.14, 0.5]} /><meshStandardMaterial color="#2f5c86" metalness={0.4} roughness={0.5} /></mesh>
      <mesh position={[0, 0.03, 0]}><boxGeometry args={[0.72, 0.05, 0.52]} /><meshStandardMaterial color="#d9b13a" roughness={0.6} /></mesh>
      {([[-0.28, 0.2], [0.28, 0.2], [-0.28, -0.2], [0.28, -0.2]] as [number, number][]).map(([wx, wz], i) => (
        <mesh key={i} position={[wx, 0.05, wz]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.05, 0.05, 0.04, 10]} /><meshStandardMaterial color="#111417" /></mesh>
      ))}
      <mesh position={[0, 0.42, 0]} castShadow><boxGeometry args={[0.64, 0.44, 0.46]} /><meshStandardMaterial color={color} metalness={0.12} roughness={0.6} /></mesh>
      <mesh position={[0, 0.42, 0]}><boxGeometry args={[0.66, 0.06, 0.48]} /><meshStandardMaterial color="#e6e0d0" roughness={0.7} /></mesh>
    </group>
  );
}

/* ============================================================================
 *  BMW S58 ENGINE LINE — a procedural inline-six that ASSEMBLES progressively as
 *  it moves down the line (components -> block -> crank -> pistons -> head ->
 *  timing -> turbo/aux -> final), on rotating carrier fixtures, worked by torque
 *  tools + operators, then a camera Q-gate, a hot-test cell and EOL. Same grey-
 *  clay style; drives the same live status data as every other cell.
 * ========================================================================== */
const ENG_SCALE = 1.5;

// realistic PBR material tokens for the engine — metalness/roughness + envMap so
// the studio environment reflects off the aluminium and polished parts.
const EM = {
  cast:    { color: "#8f969e", metalness: 0.62, roughness: 0.52, envMapIntensity: 0.8 },
  castDk:  { color: "#7c828a", metalness: 0.6, roughness: 0.58, envMapIntensity: 0.7 },
  mach:    { color: "#c4cad1", metalness: 0.85, roughness: 0.28, envMapIntensity: 1.0 },
  polish:  { color: "#dadfe5", metalness: 0.95, roughness: 0.14, envMapIntensity: 1.15 },
  steel:   { color: "#8a9199", metalness: 0.82, roughness: 0.36, envMapIntensity: 1.0 },
  blk:     { color: "#1b1e23", metalness: 0.25, roughness: 0.66 },
  crinkle: { color: "#25282d", metalness: 0.38, roughness: 0.58 },
  gold:    { color: "#b48a2c", metalness: 0.9, roughness: 0.32, envMapIntensity: 1.0 },
  hose:    { color: "#131518", metalness: 0.1, roughness: 0.85 },
  copper:  { color: "#9c6a3c", metalness: 0.7, roughness: 0.45 },
  yellow:  { color: "#d9b13a", metalness: 0.3, roughness: 0.5 },
  silver:  { color: "#c9cdd3", metalness: 0.9, roughness: 0.33, envMapIntensity: 1.15 }, // bright cast turbo/exhaust
  interc:  { color: "#b9bec6", metalness: 0.7, roughness: 0.4, envMapIntensity: 1.0 },   // charge-air cooler
  cover:   { color: "#2a2d31", metalness: 0.28, roughness: 0.56 },                        // S58 plastic engine cover
} as const;

const ENGINE_STAGES = ["components", "block", "crank", "pistons", "head", "timing", "turbo", "final"];
function engStageIdx(s: string) { const i = ENGINE_STAGES.indexOf(s); return i < 0 ? ENGINE_STAGES.length - 1 : i; }

/** A short row of hex bolt heads — cheap mechanical detail along a flange. */
function Bolts({ from, to, y, z, r = 0.017 }: { from: number; to: number; y: number; z: number; r?: number }) {
  const n = Math.max(2, Math.round((to - from) / 0.14));
  return (<>{Array.from({ length: n }).map((_, i) => {
    const x = from + (i / (n - 1)) * (to - from);
    return <mesh key={i} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[r, r, 0.02, 6]} /><meshStandardMaterial {...EM.steel} /></mesh>;
  })}</>);
}

/** The signature S58 two-tier plastic engine cover (fitted last): sculpted black
 *  cover with angular fin ridges + the "BMW M Power" M-tricolour badge — the most
 *  recognizable feature from the reference photos. Sits on top and hides the
 *  cam cover / coils. */
function EngineCover() {
  const Mcols = [["#4aa3e0", -0.03], ["#20408f", 0.0], ["#d62828", 0.03]] as [string, number][];
  return (
    <group position={[0, 1.0, 0]}>
      {/* main cover slab */}
      <RoundedBox args={[1.12, 0.15, 0.46]} radius={0.05} smoothness={3} castShadow><meshStandardMaterial {...EM.cover} /></RoundedBox>
      {/* raised rear pod */}
      <RoundedBox args={[0.46, 0.1, 0.44]} radius={0.04} smoothness={3} position={[-0.3, 0.1, 0]} castShadow><meshStandardMaterial {...EM.cover} /></RoundedBox>
      {/* angular fin ridges on the two pods (the S58 cover motif) */}
      {[-0.42, -0.24, 0.14, 0.3].map((x, i) => (
        <mesh key={i} position={[x, i < 2 ? 0.17 : 0.09, 0]} rotation={[0, 0, 0.55]} castShadow><boxGeometry args={[0.055, 0.09, 0.32]} /><meshStandardMaterial color="#1b1e22" metalness={0.3} roughness={0.55} /></mesh>
      ))}
      {/* front-face (+Z) badge plate: M tricolour + a light "M Power" bar */}
      <mesh position={[0.02, -0.005, 0.234]}><boxGeometry args={[0.42, 0.08, 0.006]} /><meshStandardMaterial color="#0b0d10" metalness={0.35} roughness={0.5} /></mesh>
      {Mcols.map(([c, dx], i) => (<mesh key={i} position={[-0.14 + dx, 0.0, 0.238]}><boxGeometry args={[0.026, 0.05, 0.006]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.15} /></mesh>))}
      <mesh position={[0.08, 0.0, 0.238]}><boxGeometry args={[0.22, 0.028, 0.006]} /><meshStandardMaterial color="#c8ccd2" metalness={0.4} roughness={0.4} /></mesh>
    </group>
  );
}

/** BMW S58 3.0L twin-turbo inline-six — modeled from the three CC reference photos,
 *  built up cumulatively by stage. Crankshaft axis = X; +X = front/accessory end,
 *  -X = flywheel; -Z = exhaust/turbo (hot) side, +Z = intake (cold) side. */
function EngineMesh({ stage }: { stage: string }) {
  const idx = engStageIdx(stage);
  const has = (name: string) => idx >= ENGINE_STAGES.indexOf(name);
  const bores = [-0.475, -0.285, -0.095, 0.095, 0.285, 0.475]; // 6 cylinders along X
  if (stage === "components") {
    // rough sand-cast block blank arriving from the foundry, on a dunnage tray
    return (
      <group>
        <RoundedBox args={[1.02, 0.44, 0.42]} radius={0.03} smoothness={3} position={[0, 0.32, 0]} rotation={[0, 0.12, 0]} castShadow>
          <meshStandardMaterial color="#6f757d" metalness={0.35} roughness={0.92} />
        </RoundedBox>
        {bores.map((x, i) => (<mesh key={i} position={[x * 0.85, 0.55, 0]} rotation={[0, 0.12, 0]}><cylinderGeometry args={[0.055, 0.055, 0.03, 16]} /><meshStandardMaterial color="#4a4f55" metalness={0.3} roughness={0.85} /></mesh>))}
      </group>
    );
  }
  return (
    <group>
      {/* ===== BLOCK (closed-deck aluminium crankcase) ===== */}
      <RoundedBox args={[1.15, 0.46, 0.44]} radius={0.03} smoothness={3} position={[0, 0.41, 0]} castShadow receiveShadow>
        <meshStandardMaterial {...EM.cast} />
      </RoundedBox>
      {/* deck plate + head-bolt bosses */}
      <RoundedBox args={[1.12, 0.05, 0.42]} radius={0.01} smoothness={2} position={[0, 0.64, 0]}><meshStandardMaterial {...EM.mach} /></RoundedBox>
      {/* cast side ribs (both faces) */}
      {[-0.23, 0.23].map((z, s) => [-0.4, -0.13, 0.13, 0.4].map((x, i) => (
        <mesh key={`${s}-${i}`} position={[x, 0.32, z]}><boxGeometry args={[0.05, 0.34, 0.02]} /><meshStandardMaterial {...EM.castDk} /></mesh>
      )))}
      {/* core/freeze plugs on the exhaust face */}
      {[-0.3, 0, 0.3].map((x, i) => (<mesh key={i} position={[x, 0.42, -0.225]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.05, 0.05, 0.02, 16]} /><meshStandardMaterial {...EM.castDk} /></mesh>))}
      {/* open bores on the deck — visible until the head goes on */}
      {!has("head") && bores.map((x, i) => (
        <group key={i}>
          <mesh position={[x, 0.655, 0]}><cylinderGeometry args={[0.058, 0.058, 0.04, 20]} /><meshStandardMaterial color="#2b3036" metalness={0.5} roughness={0.5} /></mesh>
          <mesh position={[x, 0.65, 0]}><torusGeometry args={[0.062, 0.008, 8, 20]} /><meshStandardMaterial {...EM.mach} /></mesh>
        </group>
      ))}
      <Bolts from={-0.5} to={0.5} y={0.66} z={0.19} />
      <Bolts from={-0.5} to={0.5} y={0.66} z={-0.19} />

      {/* ===== CRANK — sculpted oil pan + front damper/pulley ===== */}
      {has("crank") && (<>
        <RoundedBox args={[0.9, 0.14, 0.38]} radius={0.02} smoothness={2} position={[0, 0.14, 0]} castShadow><meshStandardMaterial {...EM.castDk} /></RoundedBox>
        <RoundedBox args={[0.5, 0.12, 0.34]} radius={0.02} smoothness={2} position={[-0.28, 0.05, 0]} castShadow><meshStandardMaterial {...EM.castDk} /></RoundedBox>
        <mesh position={[-0.28, 0.02, 0.1]}><cylinderGeometry args={[0.018, 0.018, 0.03, 8]} /><meshStandardMaterial {...EM.steel} /></mesh>{/* drain plug */}
        {/* crank damper: stacked pulley grooves at the front (+X) */}
        <group position={[0.605, 0.32, 0]} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow><cylinderGeometry args={[0.12, 0.12, 0.05, 24]} /><meshStandardMaterial {...EM.steel} /></mesh>
          <mesh position={[0, 0.04, 0]}><cylinderGeometry args={[0.1, 0.1, 0.04, 24]} /><meshStandardMaterial color="#2b2f34" metalness={0.5} roughness={0.5} /></mesh>
          <mesh position={[0, 0.075, 0]}><cylinderGeometry args={[0.045, 0.045, 0.04, 16]} /><meshStandardMaterial {...EM.polish} /></mesh>
        </group>
        {/* flywheel / flexplate + ring gear at the transmission end (-X) — a big
            toothed disc, very prominent in the reference photos */}
        <group position={[-0.62, 0.4, 0]} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow><cylinderGeometry args={[0.26, 0.26, 0.05, 32]} /><meshStandardMaterial {...EM.steel} /></mesh>
          <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[0.285, 0.285, 0.035, 72]} /><meshStandardMaterial {...EM.mach} /></mesh>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = i / 8 * Math.PI * 2; return <mesh key={i} position={[Math.cos(a) * 0.13, 0.04, Math.sin(a) * 0.13]}><cylinderGeometry args={[0.022, 0.022, 0.05, 8]} /><meshStandardMaterial color="#20242a" metalness={0.5} roughness={0.5} /></mesh>; })}
        </group>
      </>)}

      {/* ===== PISTONS — crowns + rods in the bores (only before the head) ===== */}
      {has("pistons") && !has("head") && bores.map((x, i) => (
        <group key={i}>
          <mesh position={[x, 0.6, 0]} castShadow><cylinderGeometry args={[0.052, 0.052, 0.09, 20]} /><meshStandardMaterial {...EM.polish} /></mesh>
          <mesh position={[x, 0.62, 0]}><torusGeometry args={[0.05, 0.006, 6, 20]} /><meshStandardMaterial color="#4a4f55" metalness={0.6} roughness={0.4} /></mesh>
        </group>
      ))}

      {/* ===== HEAD casting (always) + cam cover/coils (hidden once the engine cover is fitted) ===== */}
      {has("head") && (<>
        <RoundedBox args={[1.12, 0.2, 0.44]} radius={0.025} smoothness={3} position={[0, 0.755, 0]} castShadow><meshStandardMaterial {...EM.cast} /></RoundedBox>
        {/* exhaust ports on the -Z (hot) face */}
        {bores.map((x, i) => (<mesh key={i} position={[x, 0.74, -0.235]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.035, 0.035, 0.04, 12]} /><meshStandardMaterial {...EM.castDk} /></mesh>))}
        {!has("final") && (<>
          {/* magnesium cam cover with ribs + oil filler + coils (visible until the cover is fitted) */}
          <RoundedBox args={[1.06, 0.13, 0.34]} radius={0.03} smoothness={3} position={[0, 0.92, 0]} castShadow><meshStandardMaterial {...EM.crinkle} /></RoundedBox>
          {[-0.1, 0.1].map((z, i) => (<mesh key={i} position={[0, 0.985, z]}><boxGeometry args={[1.0, 0.02, 0.06]} /><meshStandardMaterial color="#15181c" metalness={0.35} roughness={0.55} /></mesh>))}
          <Bolts from={-0.48} to={0.48} y={0.985} z={0.16} r={0.012} />
          <Bolts from={-0.48} to={0.48} y={0.985} z={-0.16} r={0.012} />
          <mesh position={[-0.42, 1.0, 0.05]}><cylinderGeometry args={[0.05, 0.05, 0.04, 20]} /><meshStandardMaterial {...EM.blk} /></mesh>
          {bores.map((x, i) => (
            <group key={i} position={[x, 1.0, 0]}>
              <mesh castShadow><boxGeometry args={[0.07, 0.09, 0.11]} /><meshStandardMaterial color="#111417" metalness={0.2} roughness={0.55} /></mesh>
              <mesh position={[0, 0.05, -0.05]}><boxGeometry args={[0.05, 0.03, 0.04]} /><meshStandardMaterial color="#2a2e33" metalness={0.2} roughness={0.6} /></mesh>
            </group>
          ))}
        </>)}
      </>)}

      {/* ===== TIMING drive cover + VANOS solenoids (front +X) ===== */}
      {has("timing") && (<>
        <RoundedBox args={[0.1, 0.78, 0.44]} radius={0.02} smoothness={2} position={[0.6, 0.62, 0]} castShadow><meshStandardMaterial {...EM.cast} /></RoundedBox>
        <Bolts from={0} to={0} y={0.62} z={0.19} />
        {[0.12, -0.12].map((z, i) => (<mesh key={i} position={[0.66, 0.95, z]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.05, 0.05, 0.1, 16]} /><meshStandardMaterial {...EM.steel} /></mesh>))}
        <mesh position={[0.6, 1.02, 0]}><boxGeometry args={[0.12, 0.06, 0.3]} /><meshStandardMaterial {...EM.blk} /></mesh>
      </>)}

      {/* ===== TWIN TURBOS + silver exhaust manifold + twin braided downpipes (-Z hot side) ===== */}
      {has("turbo") && (<>
        {/* silver cast manifold: 6 runners from the head merging to a collector log */}
        {bores.map((x, i) => (<mesh key={i} position={[x, 0.62, -0.3]} rotation={[-Math.PI / 2.3, 0, 0]}><cylinderGeometry args={[0.034, 0.034, 0.22, 12]} /><meshStandardMaterial {...EM.silver} /></mesh>))}
        <mesh position={[0, 0.5, -0.36]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.05, 0.05, 1.02, 14]} /><meshStandardMaterial {...EM.silver} /></mesh>
        {/* two close-coupled turbine housings side by side */}
        {[-0.26, 0.26].map((x, i) => (
          <group key={i} position={[x, 0.34, -0.42]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow><torusGeometry args={[0.1, 0.062, 12, 24]} /><meshStandardMaterial {...EM.silver} /></mesh>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.075, 0.09, 0.14, 20]} /><meshStandardMaterial {...EM.silver} /></mesh>
            <mesh position={[0, 0.02, 0.12]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.06, 0.075, 0.1, 18]} /><meshStandardMaterial {...EM.mach} /></mesh>
            <mesh position={[0, 0.14, 0]}><cylinderGeometry args={[0.012, 0.012, 0.16, 8]} /><meshStandardMaterial {...EM.polish} /></mesh>
          </group>
        ))}
        {/* twin downpipes with braided flex sections -> twin round outlet flanges */}
        {[-0.22, 0.22].map((x, i) => (
          <group key={i}>
            <mesh position={[x, 0.16, -0.46]} rotation={[0.32, 0, 0]} castShadow><cylinderGeometry args={[0.046, 0.046, 0.3, 14]} /><meshStandardMaterial {...EM.silver} /></mesh>
            {[0.24, 0.2, 0.16].map((y, k) => (<mesh key={k} position={[x, y, -0.42]}><torusGeometry args={[0.05, 0.013, 6, 16]} /><meshStandardMaterial color="#b6bbc2" metalness={0.7} roughness={0.5} /></mesh>))}
            <mesh position={[x, 0.03, -0.34]} rotation={[Math.PI / 2.4, 0, 0]} castShadow><cylinderGeometry args={[0.055, 0.055, 0.04, 20]} /><meshStandardMaterial {...EM.mach} /></mesh>
            <mesh position={[x, 0.01, -0.31]} rotation={[Math.PI / 2.4, 0, 0]}><torusGeometry args={[0.05, 0.012, 8, 20]} /><meshStandardMaterial color="#7d2222" metalness={0.4} roughness={0.5} /></mesh>
          </group>
        ))}
        {/* wastegate actuators */}
        {[-0.26, 0.26].map((x, i) => (<mesh key={i} position={[x, 0.5, -0.34]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.035, 0.035, 0.07, 14]} /><meshStandardMaterial {...EM.blk} /></mesh>))}
      </>)}

      {/* ===== FINAL dress — top-mount charge cooler, intake, ancillaries + COVER ===== */}
      {has("final") && (<>
        {/* silver top-mount charge-air cooler (S58 water-to-air) sitting on the head,
            just under the engine cover */}
        <RoundedBox args={[0.98, 0.14, 0.4]} radius={0.03} smoothness={3} position={[0, 0.88, 0]} castShadow><meshStandardMaterial {...EM.interc} /></RoundedBox>
        {/* intake plenum + throttle body feeding it from the +Z (cold) side */}
        <RoundedBox args={[0.7, 0.16, 0.16]} radius={0.03} smoothness={2} position={[0.15, 0.72, 0.32]} castShadow><meshStandardMaterial {...EM.blk} /></RoundedBox>
        <mesh position={[0.56, 0.72, 0.32]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.06, 0.06, 0.1, 20]} /><meshStandardMaterial {...EM.mach} /></mesh>
        {/* big corrugated intake duct sweeping off the front toward the airbox */}
        {[0, 1, 2, 3, 4].map((i) => (<mesh key={i} position={[0.55 - i * 0.11, 0.62 - i * 0.02, 0.34]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.072, 0.022, 8, 16]} /><meshStandardMaterial {...EM.hose} /></mesh>))}
        <mesh position={[0.02, 0.56, 0.34]} rotation={[0, 0, Math.PI / 2.1]} castShadow><cylinderGeometry args={[0.08, 0.1, 0.24, 16]} /><meshStandardMaterial {...EM.hose} /></mesh>
        {/* oil filter housing (vertical, +Z cold side) */}
        <mesh position={[-0.15, 0.52, 0.28]} castShadow><cylinderGeometry args={[0.06, 0.06, 0.22, 20]} /><meshStandardMaterial {...EM.blk} /></mesh>
        <mesh position={[-0.15, 0.65, 0.28]}><cylinderGeometry args={[0.055, 0.055, 0.05, 20]} /><meshStandardMaterial {...EM.mach} /></mesh>
        {/* alternator (front, belt-driven) */}
        <group position={[0.5, 0.28, 0.14]} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow><cylinderGeometry args={[0.08, 0.08, 0.15, 20]} /><meshStandardMaterial {...EM.steel} /></mesh>
          <mesh position={[0, 0.09, 0]}><cylinderGeometry args={[0.05, 0.05, 0.03, 16]} /><meshStandardMaterial {...EM.polish} /></mesh>
        </group>
        {/* coolant hoses + harness spine */}
        <mesh position={[0.55, 0.5, 0.08]} rotation={[0.5, 0.4, 0.4]}><cylinderGeometry args={[0.032, 0.032, 0.34, 12]} /><meshStandardMaterial {...EM.hose} /></mesh>
        <mesh position={[-0.5, 0.56, 0.36]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.022, 0.022, 0.7, 10]} /><meshStandardMaterial color="#0e0f12" roughness={0.8} /></mesh>
        {/* engine mount brackets */}
        {[-0.24, 0.24].map((z, i) => (<mesh key={i} position={[0.2, 0.34, z]} castShadow><boxGeometry args={[0.14, 0.16, 0.06]} /><meshStandardMaterial {...EM.mach} /></mesh>))}
        {/* the signature S58 engine cover, fitted last */}
        <EngineCover />
      </>)}
    </group>
  );
}


/** Overhead nutrunner on a spring balancer — the hanging torque tool. */
function TorqueTool({ x = 0, z = 0, running }: { x?: number; z?: number; running: boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame((st) => { if (g.current) g.current.position.y = 2.0 - (running ? Math.abs(Math.sin(st.clock.elapsedTime * 2)) * 0.18 : 0); });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 2.75, 0]}><cylinderGeometry args={[0.015, 0.015, 1.4, 6]} /><meshStandardMaterial color="#1a1d22" /></mesh>
      <group ref={g}>
        <mesh castShadow><boxGeometry args={[0.1, 0.28, 0.1]} /><meshStandardMaterial color="#1c1f24" metalness={0.3} roughness={0.6} /></mesh>
        <mesh position={[0, -0.2, 0]}><cylinderGeometry args={[0.02, 0.02, 0.14, 8]} /><meshStandardMaterial color="#9aa0a8" metalness={0.7} roughness={0.3} /></mesh>
        <mesh position={[0.09, 0, 0]}><boxGeometry args={[0.08, 0.1, 0.06]} /><meshStandardMaterial color="#c0392b" /></mesh>
      </group>
    </group>
  );
}

/** A KLT parts tote on a stand (the blue bins lineside in the references). */
function PartsBin({ x = 0, z = 0, color = "#2f5c9e" }: { x?: number; z?: number; color?: string }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.35, 0]}><boxGeometry args={[0.6, 0.7, 0.42]} /><meshStandardMaterial color="#6b727b" metalness={0.4} roughness={0.5} /></mesh>
      <mesh position={[0, 0.82, 0]} castShadow><boxGeometry args={[0.56, 0.26, 0.4]} /><meshStandardMaterial color={color} roughness={0.6} /></mesh>
      <mesh position={[0, 0.9, 0]}><boxGeometry args={[0.58, 0.06, 0.42]} /><meshStandardMaterial color={color} roughness={0.6} /></mesh>
    </group>
  );
}

/** Torque / assembly station: engine on its fixture, an overhead tool and an
 *  operator torquing it down, with parts bins lineside. Used for block → dress. */
function EngineAssemblyCell({ running }: { running: boolean }) {
  return (
    <group>
      {/* engine arrives on the overhead carrier; the station works it in place */}
      <TorqueTool x={0.35} z={0.55} running={running} />
      <Worker pos={[0.1, 0, 1.55]} rot={Math.PI} tone={SKIN[2]} working={running} phase={0.4} />
      <PartsBin x={-2.0} z={1.2} color="#2f5c9e" />
      <PartsBin x={-2.0} z={0.5} color="#3a6ea5" />
    </group>
  );
}

/** Component kitting / staging: a rough block casting on the fixture, a shelved
 *  parts rack of bins, and an operator picking a kit. */
function EngineKittingCell({ running }: { running: boolean }) {
  return (
    <group>
      {/* blocks enter here on the overhead carrier; operator kits the components */}
      <group position={[0, 0, -1.7]}>
        <mesh position={[0, 1.0, 0]}><boxGeometry args={[2.4, 2.0, 0.1]} /><meshStandardMaterial color="#6b727b" metalness={0.4} roughness={0.5} /></mesh>
        {[0.5, 1.1, 1.7].map((y, r) => [-0.8, -0.2, 0.4, 1.0].map((x, c) => (
          <mesh key={`${r}-${c}`} position={[x - 0.1, y, 0.14]} castShadow><boxGeometry args={[0.42, 0.28, 0.3]} /><meshStandardMaterial color={(r + c) % 2 ? "#2f5c9e" : "#c0a040"} roughness={0.6} /></mesh>
        )))}
      </group>
      <PartsBin x={1.9} z={0.9} />
      <PartsBin x={1.9} z={0.2} color="#3a6ea5" />
      <Worker pos={[-1.7, 0, 1.2]} rot={-Math.PI * 0.7} tone={SKIN[0]} working={running} phase={0} />
    </group>
  );
}

/** Camera Q-Gate: two orange ABB robots with camera heads scan the finished
 *  engine on its carrier, inside a fenced cell with a gate sign. */
function EngineQGateCell({ running }: { running: boolean }) {
  const flash = useRef<THREE.PointLight>(null);
  useFrame((st) => { if (flash.current) flash.current.intensity = running ? (Math.sin(st.clock.elapsedTime * 6) > 0.6 ? 2 : 0.1) : 0; });
  return (
    <group>
      {/* the carried engine is scanned in place by the two camera robots */}
      {([[1.35, 1.35, -Math.PI / 2, 0], [-1.35, -1.35, Math.PI / 2, 1.3]] as number[][]).map((a, i) => (
        <group key={i} position={[a[0], 0.5, a[1]]} rotation={[0, a[2], 0]} scale={0.75}><Arm running={running} accent="#d9691e" phase={a[3]} /></group>
      ))}
      {/* fenced Q-gate frame */}
      <lineSegments position={[0, 1.3, 0]}><edgesGeometry args={[new THREE.BoxGeometry(4.2, 2.6, 3.0)]} /><lineBasicMaterial color="#aab0b8" transparent opacity={0.4} /></lineSegments>
      <pointLight ref={flash} position={[0, 1.6, 0]} distance={2.5} color="#8fe0ff" intensity={0} />
    </group>
  );
}

/** Hot-test cell: the engine inside a grey acoustic test booth with a glass front
 *  and a live monitor — the powertrain hot/cold test before ship. */
function EngineTestCell({ running }: { running: boolean }) {
  return (
    <group>
      {/* the carried engine dwells inside the booth for the hot test */}
      {/* acoustic booth: back + sides + top, translucent glass front */}
      <mesh position={[0, 1.45, -1.45]} castShadow><boxGeometry args={[3.6, 2.9, 0.14]} /><meshStandardMaterial color="#6b727b" metalness={0.3} roughness={0.6} /></mesh>
      {[-1.8, 1.8].map((x, i) => (<mesh key={i} position={[x, 1.45, -0.4]}><boxGeometry args={[0.14, 2.9, 2.2]} /><meshStandardMaterial color="#767c85" metalness={0.3} roughness={0.6} /></mesh>))}
      <mesh position={[0, 2.9, -0.4]}><boxGeometry args={[3.6, 0.14, 2.2]} /><meshStandardMaterial color="#767c85" metalness={0.3} roughness={0.6} /></mesh>
      <mesh position={[0, 1.4, 0.7]}><boxGeometry args={[3.5, 2.6, 0.05]} /><meshStandardMaterial color="#8fb4c8" metalness={0.1} roughness={0.1} transparent opacity={0.16} /></mesh>
      {/* control monitor on the booth */}
      <mesh position={[1.45, 1.7, 0.75]}><planeGeometry args={[0.5, 0.34]} /><meshStandardMaterial color="#18c6ff" emissive="#25ccff" emissiveIntensity={running ? 1.1 : 0.3} toneMapped={false} /></mesh>
      {running && <pointLight position={[0, 1.4, 0]} distance={3.2} intensity={1.3} color="#88ccff" />}
    </group>
  );
}

/** Route an engine-line station to its cell kind. */
function engineCellKind(type?: string, name?: string): string {
  const t = (type || "").toLowerCase(), nm = (name || "").toLowerCase();
  if (t.includes("test")) return "test";
  if (t.includes("inspect") || t.includes("scan") || nm.includes("q-gate") || nm.includes("gate")) return "qgate";
  if (t.includes("kitting") || t.includes("load") || nm.includes("component") || nm.includes("kit")) return "kitting";
  return "assembly";
}

/** One engine-line station as a full process cell + live status chrome. */
function EngineAutoCell({ pos, state, color, id, name, type, oee, selected, bottleneck, onClick }: {
  pos: XZ; state: MachineState; color: string; id: string; name?: string; type?: string;
  oee?: number; selected: boolean; bottleneck: boolean; onClick: () => void;
}) {
  const running = state === "running";
  const kind = engineCellKind(type, name);
  return (
    <group position={[pos[0], 0, pos[1]]} onClick={(e: any) => { e.stopPropagation(); onClick(); }}>
      {kind === "kitting" && <EngineKittingCell running={running} />}
      {kind === "qgate" && <EngineQGateCell running={running} />}
      {kind === "test" && <EngineTestCell running={running} />}
      {kind === "assembly" && <EngineAssemblyCell running={running} />}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
        <ringGeometry args={[2.05, 2.35, 48]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.75 : 0.42} side={THREE.DoubleSide} />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
          <ringGeometry args={[2.35, 2.6, 48]} /><meshBasicMaterial color="#4a9eff" />
        </mesh>
      )}
      <group position={[2.0, 0, -1.7]}><AndonLight state={state} /></group>
      <Html position={[0, 3.1, 0]} center distanceFactor={selected || bottleneck ? 15 : 12} zIndexRange={[10, 0]}>
        {selected || bottleneck ? (
          <div className="lbl3d" style={{ borderColor: color }}>
            <b>{id}{name ? ` · ${name}` : ""}</b>
            <span style={{ color }}>{STATE_ICON[state]} {STATE_LABEL[state]}</span>
            <em>OEE {Math.round((oee || 0) * 100)}%</em>
          </div>
        ) : (
          <div className="lbl3d compact" style={{ borderColor: color }}><b>{id}</b><span style={{ color }}>{STATE_ICON[state]}</span></div>
        )}
      </Html>
      {bottleneck && (<Html position={[0, 3.8, 0]} center distanceFactor={16}><div className="bott3d">▲ BOTTLENECK</div></Html>)}
    </group>
  );
}

function smoother(x: number) { x = Math.max(0, Math.min(1, x)); return x * x * x * (x * (x * 6 - 15) + 10); }

/** Overhead POWER-AND-FREE carrier line — the real engine transport: engines hang
 *  from trolleys on an overhead rail and INDEX from station to station. They dwell
 *  at a station (worked on + slowly rotated into position), then the whole line
 *  advances one station together; the finished engine ships at EOL and the empty
 *  hook returns. No ground conveyor — the carrier IS the transport. The engine at
 *  each station shows that station's build stage, so the assembly reads down the line. */
function EngineCarrierLine({ nodes, stages }: { nodes: XZ[]; stages: string[] }) {
  const M = nodes.length;
  const YRAIL = 4.3, YENG = 1.2, STEP = 4.5;
  const [tick, setTick] = useState(0);
  const cRefs = useRef<(THREE.Group | null)[]>([]);
  const eRefs = useRef<(THREE.Group | null)[]>([]);
  const last = useRef(-1);
  useFrame((st) => {
    const g0 = st.clock.elapsedTime / STEP;
    const base = Math.floor(g0);
    if (base !== last.current) { last.current = base; setTick(base); }
    const move = smoother((g0 - base - 0.62) / 0.38);   // dwell 62%, index 38%
    for (let i = 0; i < M; i++) {
      const c = cRefs.current[i]; if (!c) continue;
      const from = (base + i) % M, to = (from + 1) % M;
      const a = nodes[from], b = nodes[to];
      const wrap = to === 0;                              // last -> first = return leg
      const t = wrap ? 0 : move;
      c.position.x = a[0] + (b[0] - a[0]) * t;
      c.position.z = a[1] + (b[1] - a[1]) * t;
      c.visible = from !== M - 1;                         // EOL engine ships; empty hook return hidden
      const e = eRefs.current[i];
      if (e) e.rotation.y = (1 - move) * Math.sin(st.clock.elapsedTime * 0.6 + i * 1.7) * 0.5; // positioned/rotated at dwell
    }
  });
  const top = YRAIL + 0.15, bot = YENG - 0.03;
  return (
    <group>
      {/* overhead rail through every station + return leg, on ceiling posts */}
      {nodes.map((a, i) => {
        const b = nodes[(i + 1) % nodes.length];
        const dx = b[0] - a[0], dz = b[1] - a[1]; const len = Math.hypot(dx, dz);
        return (
          <group key={i}>
            <mesh position={[(a[0] + b[0]) / 2, top, (a[1] + b[1]) / 2]} rotation={[0, -Math.atan2(dz, dx), 0]}>
              <boxGeometry args={[len, 0.12, 0.14]} /><meshStandardMaterial color="#3a4658" metalness={0.6} roughness={0.4} />
            </mesh>
            <mesh position={[a[0], top + 1.0, a[1]]}><boxGeometry args={[0.08, 2.0, 0.08]} /><meshStandardMaterial color="#2a3648" metalness={0.5} roughness={0.5} /></mesh>
          </group>
        );
      })}
      {/* engine carriers (one per station slot) */}
      {nodes.map((_, i) => {
        const from = (tick + i) % M;
        return (
          <group key={i} ref={(el) => (cRefs.current[i] = el)}>
            <mesh position={[0, top, 0]} castShadow><boxGeometry args={[0.36, 0.18, 0.36]} /><meshStandardMaterial color="#4a5568" metalness={0.5} roughness={0.4} /></mesh>
            {[-0.16, 0.16].map((z, k) => (<mesh key={k} position={[0, (top + bot) / 2, z]}><cylinderGeometry args={[0.022, 0.022, top - bot, 6]} /><meshStandardMaterial color="#1a2333" /></mesh>))}
            <mesh position={[0, bot, 0]} castShadow><boxGeometry args={[0.78, 0.1, 0.5]} /><meshStandardMaterial color="#5a6270" metalness={0.5} roughness={0.45} /></mesh>
            <group ref={(el) => (eRefs.current[i] = el)} position={[0, YENG, 0]} scale={ENG_SCALE}>
              <EngineMesh stage={stages[from]} />
            </group>
          </group>
        );
      })}
    </group>
  );
}

/** Live cross-line DATA LINK: at the X5 powertrain-marriage station, a delivery
 *  cart of finished engines fed by the engine line, labelled with that line's
 *  live throughput — the S58 engine line's EOL output feeding vehicle assembly. */
function PowertrainSupply({ pos, uph }: { pos: XZ; uph: number }) {
  return (
    <group position={[pos[0] + 2.8, 0, pos[1]]}>
      {/* tugger cart carrying two finished engines */}
      <mesh position={[0, 0.24, 0]} castShadow><boxGeometry args={[1.5, 0.4, 1.0]} /><meshStandardMaterial color="#4a5568" metalness={0.4} roughness={0.5} /></mesh>
      {([[-0.34, 0.28], [0.34, 0.28], [-0.34, -0.28], [0.34, -0.28]] as [number, number][]).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.06, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.08, 0.08, 0.06, 12]} /><meshStandardMaterial color="#111417" /></mesh>
      ))}
      {[-0.36, 0.36].map((x, i) => (<group key={i} position={[x, 0.46, 0]} scale={0.5}><EngineMesh stage="final" /></group>))}
      <Html position={[0, 2.0, 0]} center distanceFactor={14} zIndexRange={[10, 0]}>
        <div className="lbl3d" style={{ borderColor: "#39d0ff" }}>
          <b>◄ Powertrain supply</b>
          <span style={{ color: "#39d0ff" }}>◉ {Math.max(0, uph).toFixed(0)} eng/hr · S58 line</span>
          <em>feeds marriage</em>
        </div>
      </Html>
    </group>
  );
}

/* ============================================================================
 *  TOYOTA PARTS DEPOT — a two-level order-fulfilment WAREHOUSE (not a line).
 *  Small parts on the MEZZANINE (1st floor), large parts on the GROUND directly
 *  below; goods lift + staging + pack + truck docks. Racking is drawn with
 *  InstancedMesh (one draw call for thousands of bins/boxes) so the ~95×102 m
 *  footprint stays fast in WebGL. A floor toggle shows Ground / Mezzanine / Both.
 * ========================================================================== */

/** Many identical boxes in ONE draw call (instanced). Positions in world/local. */
function InstancedBoxes({ items, args, color, metalness = 0.4, roughness = 0.6, emissive, emissiveIntensity = 0, transparent, opacity = 1, cast }: {
  items: [number, number, number][]; args: [number, number, number]; color: string;
  metalness?: number; roughness?: number; emissive?: string; emissiveIntensity?: number;
  transparent?: boolean; opacity?: number; cast?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    items.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); ref.current!.setMatrixAt(i, m); });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[undefined as any, undefined as any, items.length]} castShadow={!!cast} receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness}
        emissive={emissive as any} emissiveIntensity={emissiveIntensity} toneMapped={!emissive}
        transparent={transparent} opacity={opacity} />
    </instancedMesh>
  );
}

// Warehouse footprint (metres, scene units) — the mezzanine + the area below it.
const WHc = { x0: -20, x1: 15, zS0: -24, zS1: 4, rowGap: 4.0, mezY: 4.6 };

/** All the racking geometry, precomputed once and drawn instanced. */
function useWarehouseRacks() {
  return useMemo(() => {
    const rowXs: number[] = [];
    for (let x = WHc.x0 + 2; x <= WHc.x1 - 2; x += WHc.rowGap) rowXs.push(x);
    const z0 = WHc.zS0 + 1, z1 = WHc.zS1 - 1, len = z1 - z0, cz = (z0 + z1) / 2;
    const gUp: [number, number, number][] = [], gBeam: [number, number, number][] = [], gBox: [number, number, number][] = [];
    const mUp: [number, number, number][] = [], mShelf: [number, number, number][] = [], mBin: [number, number, number][] = [], mLight: [number, number, number][] = [];
    const gLevels = [0.95, 2.05, 3.15];
    const bays = Math.max(3, Math.round(len / 2.4));
    const mLevels = [WHc.mezY + 0.55, WHc.mezY + 1.15, WHc.mezY + 1.75, WHc.mezY + 2.35];
    const mbins = Math.max(6, Math.round(len / 1.15));
    rowXs.forEach((x) => {
      for (let i = 0; i <= bays; i++) { const z = z0 + (i / bays) * len; gUp.push([x - 0.55, 1.95, z]); gUp.push([x + 0.55, 1.95, z]); }
      gLevels.forEach((y) => { gBeam.push([x - 0.5, y, cz]); gBeam.push([x + 0.5, y, cz]); });
      gLevels.forEach((y, li) => { for (let i = 0; i < bays; i++) { if ((i + li) % 4 === 0) continue; const z = z0 + ((i + 0.5) / bays) * len; gBox.push([x, y + 0.32, z]); } });
      [z0, z1].forEach((zz) => { mUp.push([x - 0.42, WHc.mezY + 1.35, zz]); mUp.push([x + 0.42, WHc.mezY + 1.35, zz]); });
      mLevels.forEach((y) => mShelf.push([x, y - 0.13, cz]));
      mLevels.forEach((y, li) => { for (let i = 0; i < mbins; i++) { const z = z0 + ((i + 0.5) / mbins) * len; mBin.push([x, y, z]); if ((i + li) % 3 === 0) mLight.push([x + 0.38, y, z]); } });
    });
    return { rowXs, len, cz, z0, z1, bays, gUp, gBeam, gBox, mUp, mShelf, mBin, mLight };
  }, []);
}

function WarehouseBuild({ whFloor }: { whFloor: "both" | "ground" | "mezz" }) {
  const R = useWarehouseRacks();
  const showGround = whFloor !== "mezz";
  const showMezz = whFloor !== "ground";
  const cxS = (WHc.x0 + WHc.x1) / 2, deckW = (WHc.x1 - WHc.x0) + 2, deckD = (R.z1 - R.z0) + 3;
  return (
    <group>
      {/* ===== GROUND — large-parts pallet racking (blue uprights / orange beams) ===== */}
      {showGround && (<>
        <InstancedBoxes items={R.gUp} args={[0.1, 3.9, 0.1]} color="#2f4d74" metalness={0.5} roughness={0.5} cast />
        <InstancedBoxes items={R.gBeam} args={[0.09, 0.09, R.len]} color="#c76a18" metalness={0.35} roughness={0.55} />
        <InstancedBoxes items={R.gBox} args={[0.95, 0.5, (R.len / R.bays) * 0.82]} color="#b1854a" roughness={0.86} cast />
      </>)}

      {/* ===== MEZZANINE deck + small-parts bin shelving + pick-to-light ===== */}
      {showMezz && (<>
        {/* semi-transparent steel deck so you can see the ground below it */}
        <mesh position={[cxS, WHc.mezY, R.cz]} receiveShadow>
          <boxGeometry args={[deckW, 0.16, deckD]} />
          <meshStandardMaterial color="#9aa1aa" metalness={0.3} roughness={0.6} transparent opacity={whFloor === "both" ? 0.34 : 0.96} />
        </mesh>
        {/* support columns under the deck */}
        <InstancedBoxes items={R.rowXs.flatMap((x) => [[x, WHc.mezY / 2, R.z0] as [number, number, number], [x, WHc.mezY / 2, R.z1] as [number, number, number]])}
          args={[0.18, WHc.mezY, 0.18]} color="#3a4658" metalness={0.5} roughness={0.5} />
        {/* perimeter railing (front edge) */}
        <mesh position={[cxS, WHc.mezY + 0.5, R.z1 + 1.4]}><boxGeometry args={[deckW, 1.0, 0.05]} /><meshStandardMaterial color="#c9c2a8" metalness={0.2} roughness={0.6} /></mesh>
        {/* shelving */}
        <InstancedBoxes items={R.mUp} args={[0.06, 2.5, 0.06]} color="#8a9099" metalness={0.4} roughness={0.5} />
        <InstancedBoxes items={R.mShelf} args={[0.82, 0.03, R.len]} color="#d8cdb6" roughness={0.82} />
        <InstancedBoxes items={R.mBin} args={[0.72, 0.22, (R.len / (R.mBin.length / (R.rowXs.length * 4) || 1)) * 0.82]} color="#c9b48c" roughness={0.85} cast />
        <InstancedBoxes items={R.mLight} args={[0.04, 0.07, 0.06]} color="#35d06a" emissive="#35d06a" emissiveIntensity={1.2} />
      </>)}

      {/* ===== TWO GOODS LIFTS right at the conveyor feed — small parts ride down,
              the landing doors open and a loaded dolly rolls out onto staging ===== */}
      <GoodsLift x={-4.5} z={6.6} phase={0} />
      <GoodsLift x={4.5} z={6.6} phase={0.5} />

      {/* ===== STAGING (3 conveyors) + PACK + TRUCK DOCKS (open, no canopy) ===== */}
      {[-9, 0, 9].map((x, i) => <Conveyor key={`sc${i}`} a={[x, 8]} b={[x, 15.5]} />)}
      <mesh position={[0, 0.45, 16.4]} castShadow><boxGeometry args={[3.0, 0.9, 1.4]} /><meshStandardMaterial color="#7e848d" metalness={0.35} roughness={0.55} /></mesh>
      {[-9, 0, 9].map((x, i) => (
        <group key={`dock${i}`} position={[x, 0, 22]}>
          {/* dock door frame */}
          {[-1.9, 1.9].map((dx, j) => (<mesh key={j} position={[dx, 1.6, 0]}><boxGeometry args={[0.2, 3.2, 0.2]} /><meshStandardMaterial color="#4a5568" metalness={0.4} roughness={0.5} /></mesh>))}
          <mesh position={[0, 3.3, 0]}><boxGeometry args={[4.2, 0.25, 0.25]} /><meshStandardMaterial color="#4a5568" metalness={0.4} roughness={0.5} /></mesh>
          {/* the truck backed into the dock */}
          <DepotTruck color={i === 0 ? "#8a3b3b" : i === 1 ? "#3b5a8a" : "#3b7a5a"} />
        </group>
      ))}
      {/* labels from architectural plan */}
      <ZoneTag x={-2.5} z={-10} y={WHc.mezY + 1.2} text="Mezzanine" />
      <ZoneTag x={-2.5} z={-10} y={0.5} text="Lower floor" />
      <ZoneTag x={-6} z={16} text="Depot shipping area" />
      <ZoneTag x={6} z={16} text="Local receiving area" />
      <ZoneTag x={0} z={25} text="Truck Bays" />
    </group>
  );
}

/** A warehouse zone status marker (floor ring + andon + label), lifted to its
 *  floor level (0 ground, 1 mezzanine). No heavy machine geometry. */
/** A subtle warehouse zone marker — just a flat floor ring for status + a label
 *  that only appears when selected or flagged as the bottleneck (no tall andon
 *  posts, so the depot reads like a real floor, not a field of machines). */
function WarehouseZone({ pos, level, state, color, id, name, oee, selected, bottleneck, onClick }: {
  pos: XZ; level: number; state: MachineState; color: string; id: string; name?: string;
  oee?: number; selected: boolean; bottleneck: boolean; onClick: () => void;
}) {
  const y = level >= 1 ? WHc.mezY + 0.18 : 0;
  const show = selected || bottleneck;
  return (
    <group position={[pos[0], y, pos[1]]} onClick={(e: any) => { e.stopPropagation(); onClick(); }}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.85, 1.12, 36]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.85 : bottleneck ? 0.7 : 0.2} side={THREE.DoubleSide} />
      </mesh>
      {/* invisible, larger click target */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} visible={false}><circleGeometry args={[1.5, 12]} /></mesh>
      {show && (
        <Html position={[0, 1.5, 0]} center distanceFactor={14} zIndexRange={[10, 0]}>
          <div className="lbl3d" style={{ borderColor: color }}>
            <b>{id}{name ? ` · ${name}` : ""}</b>
            <span style={{ color }}>{STATE_ICON[state]} {STATE_LABEL[state]}</span>
            <em>{bottleneck ? "▲ bottleneck · " : ""}OEE {Math.round((oee || 0) * 100)}%</em>
          </div>
        </Html>
      )}
    </group>
  );
}

/** A handheld RF barcode gun (what pickers carry). */
function Scanner() {
  return (
    <group rotation={[0.3, 0, 0]}>
      <mesh castShadow><boxGeometry args={[0.07, 0.11, 0.16]} /><meshStandardMaterial color="#15181c" metalness={0.3} roughness={0.6} /></mesh>
      <mesh position={[0, -0.09, 0.02]} rotation={[0.3, 0, 0]}><boxGeometry args={[0.055, 0.11, 0.06]} /><meshStandardMaterial color="#f4c430" roughness={0.6} /></mesh>{/* yellow grip */}
      <mesh position={[0, 0.03, 0.085]}><planeGeometry args={[0.05, 0.06]} /><meshStandardMaterial color="#35d06a" emissive="#35d06a" emissiveIntensity={0.9} toneMapped={false} /></mesh>{/* screen */}
    </group>
  );
}

/** A warehouse operator: white hard hat, hi-vis vest with reflective bands,
 *  rounded limbs, a free arm that swings while walking, a scanner arm raised. */
function WarehouseWorker({ walking = false, movingRef, tone = SKIN[0], phase = 0, vest = "#f28c1e" }: { walking?: boolean; movingRef?: { current: boolean }; tone?: string; phase?: number; vest?: string }) {
  const legL = useRef<THREE.Group>(null), legR = useRef<THREE.Group>(null), arm = useRef<THREE.Group>(null), armL = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null);
  useFrame((st) => {
    const w = movingRef ? movingRef.current : walking;
    const t = st.clock.elapsedTime * 2.2 + phase;
    const s = w ? Math.sin(t) * 0.42 : 0;
    if (legL.current) legL.current.rotation.x = s;
    if (legR.current) legR.current.rotation.x = -s;
    if (armL.current) armL.current.rotation.x = w ? -s * 0.85 : -0.08;
    if (body.current) { body.current.position.y = w ? Math.abs(Math.sin(t)) * 0.02 : 0; body.current.rotation.x = w ? 0.03 : 0; }
    if (arm.current) arm.current.rotation.x = -1.05 + Math.sin(st.clock.elapsedTime * 1.1 + phase) * (w ? 0.04 : 0.14);
  });
  return (
    <group>
      {/* legs — hip pivot: tapered trousers + safety boots */}
      <group ref={legL} position={[-0.1, 0.82, 0]}>
        <mesh position={[0, -0.36, 0]} castShadow><cylinderGeometry args={[0.08, 0.065, 0.72, 10]} /><meshStandardMaterial color="#2b3038" roughness={0.85} /></mesh>
        <mesh position={[0, -0.74, 0.04]} castShadow><boxGeometry args={[0.14, 0.11, 0.26]} /><meshStandardMaterial color="#141619" roughness={0.7} /></mesh>
      </group>
      <group ref={legR} position={[0.1, 0.82, 0]}>
        <mesh position={[0, -0.36, 0]} castShadow><cylinderGeometry args={[0.08, 0.065, 0.72, 10]} /><meshStandardMaterial color="#2b3038" roughness={0.85} /></mesh>
        <mesh position={[0, -0.74, 0.04]} castShadow><boxGeometry args={[0.14, 0.11, 0.26]} /><meshStandardMaterial color="#141619" roughness={0.7} /></mesh>
      </group>
      <group ref={body}>
        {/* torso base + hi-vis vest */}
        <mesh position={[0, 1.08, 0]} castShadow><cylinderGeometry args={[0.16, 0.185, 0.54, 14]} /><meshStandardMaterial color="#33383f" roughness={0.8} /></mesh>
        <mesh position={[0, 1.07, 0]} castShadow><cylinderGeometry args={[0.195, 0.205, 0.48, 14]} /><meshStandardMaterial color={vest} roughness={0.5} emissive={vest} emissiveIntensity={0.14} /></mesh>
        {/* two reflective bands */}
        {[1.17, 0.99].map((y, i) => (<mesh key={i} position={[0, y, 0]}><cylinderGeometry args={[0.2, 0.2, 0.05, 14]} /><meshStandardMaterial color="#e8eef5" emissive="#d7e6ff" emissiveIntensity={0.4} roughness={0.35} metalness={0.1} /></mesh>))}
        {/* shoulders */}
        <mesh position={[0, 1.33, 0]}><sphereGeometry args={[0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={vest} roughness={0.5} /></mesh>
        {/* neck + head */}
        <mesh position={[0, 1.42, 0]}><cylinderGeometry args={[0.055, 0.07, 0.08, 8]} /><meshStandardMaterial color={tone} roughness={0.6} /></mesh>
        <mesh position={[0, 1.53, 0]} castShadow><sphereGeometry args={[0.115, 18, 16]} /><meshStandardMaterial color={tone} roughness={0.65} /></mesh>
        {/* WHITE hard hat: dome + brim */}
        <mesh position={[0, 1.585, 0]} castShadow><sphereGeometry args={[0.132, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#eef1f4" roughness={0.35} metalness={0.05} /></mesh>
        <mesh position={[0, 1.585, 0.04]}><cylinderGeometry args={[0.17, 0.17, 0.02, 18]} /><meshStandardMaterial color="#e6e9ec" roughness={0.4} /></mesh>
        {/* left arm — swings freely while walking */}
        <group ref={armL} position={[-0.21, 1.3, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow><cylinderGeometry args={[0.055, 0.048, 0.46, 8]} /><meshStandardMaterial color={vest} roughness={0.55} /></mesh>
          <mesh position={[0, -0.45, 0]}><sphereGeometry args={[0.05, 8, 8]} /><meshStandardMaterial color={tone} roughness={0.6} /></mesh>
        </group>
        {/* right arm — raised, holding the scanner */}
        <group ref={arm} position={[0.21, 1.32, 0.02]}>
          <mesh position={[0, -0.15, 0.12]} rotation={[0.55, 0, 0]} castShadow><cylinderGeometry args={[0.055, 0.048, 0.42, 8]} /><meshStandardMaterial color={vest} roughness={0.55} /></mesh>
          <group position={[0, -0.32, 0.26]}><Scanner /></group>
        </group>
      </group>
    </group>
  );
}

/** A wheel + hub. */
function TruckWheel({ x, z, r = 0.42 }: { x: number; z: number; r?: number }) {
  return (
    <group position={[x, r, z]} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow><cylinderGeometry args={[r, r, 0.34, 20]} /><meshStandardMaterial color="#14171c" roughness={0.82} /></mesh>
      <mesh position={[0, 0.18 * Math.sign(x || 1), 0]}><cylinderGeometry args={[r * 0.5, r * 0.5, 0.06, 14]} /><meshStandardMaterial color="#c9ced6" metalness={0.75} roughness={0.28} /></mesh>
    </group>
  );
}

/** A detailed articulated semi backed into a dock: corrugated trailer with rear
 *  doors toward the dock, a proper tractor (sleeper cab, hood, grille, chrome
 *  stacks + tanks, lights, mirrors) and tandem axles. */
function DepotTruck({ color = "#3b5a8a" }: { color?: string }) {
  const chrome = "#c9ced6", tyre = "#14171c", glass = "#0a1622";
  return (
    <group>
      {/* ===================== TRAILER ===================== */}
      <mesh position={[0, 1.8, 3.1]} castShadow receiveShadow><boxGeometry args={[2.6, 2.7, 5.6]} /><meshStandardMaterial color={color} metalness={0.35} roughness={0.5} /></mesh>
      <mesh position={[0, 3.18, 3.1]}><boxGeometry args={[2.66, 0.1, 5.72]} /><meshStandardMaterial color="#e7ebf0" metalness={0.4} roughness={0.4} /></mesh>
      {/* corrugation ribs */}
      {Array.from({ length: 7 }).map((_, i) => { const z = 0.7 + i * 0.72; return [-1.33, 1.33].map((x, j) => (<mesh key={`${i}-${j}`} position={[x, 1.8, z]}><boxGeometry args={[0.03, 2.5, 0.1]} /><meshStandardMaterial color={color} metalness={0.4} roughness={0.45} /></mesh>)); })}
      {/* reflective side band */}
      {[-1.33, 1.33].map((x, i) => (<mesh key={i} position={[x, 1.15, 3.1]}><boxGeometry args={[0.02, 0.28, 5.4]} /><meshStandardMaterial color="#e6ebf2" emissive="#9fb4d0" emissiveIntensity={0.2} roughness={0.4} /></mesh>))}
      {/* rear door frame + two doors ajar toward the dock (-z), with locking bars */}
      <mesh position={[0, 1.8, 0.36]}><boxGeometry args={[2.64, 2.72, 0.06]} /><meshStandardMaterial color="#2b3038" metalness={0.4} roughness={0.5} /></mesh>
      {([[-0.66, 0.38], [0.66, -0.38]] as [number, number][]).map(([dx, rot], i) => (
        <group key={i} position={[dx, 1.8, 0.28]} rotation={[0, rot, 0]}>
          <mesh castShadow><boxGeometry args={[1.28, 2.5, 0.08]} /><meshStandardMaterial color="#cfd3d9" metalness={0.35} roughness={0.5} /></mesh>
          {[-0.42, 0.42].map((bx, k) => (<mesh key={k} position={[bx, 0, 0.07]}><cylinderGeometry args={[0.03, 0.03, 2.3, 8]} /><meshStandardMaterial color={chrome} metalness={0.75} roughness={0.28} /></mesh>))}
        </group>
      ))}
      {/* rear bumper + red tail lights */}
      <mesh position={[0, 0.5, 0.08]}><boxGeometry args={[2.5, 0.12, 0.1]} /><meshStandardMaterial color="#20242a" metalness={0.5} roughness={0.5} /></mesh>
      {[-1.0, 1.0].map((x, i) => (<mesh key={i} position={[x, 0.62, 0.06]}><boxGeometry args={[0.28, 0.18, 0.05]} /><meshStandardMaterial color="#e23" emissive="#ff2a2a" emissiveIntensity={1.4} toneMapped={false} /></mesh>))}
      {/* amber marker lights along the roof edge */}
      {[0.9, 2.7, 4.5].map((z, i) => [-1.35, 1.35].map((x, j) => (<mesh key={`${i}-${j}`} position={[x, 3.06, z]}><boxGeometry args={[0.04, 0.06, 0.12]} /><meshStandardMaterial color="#ffb02a" emissive="#ffb02a" emissiveIntensity={0.9} toneMapped={false} /></mesh>)))}
      {/* landing gear + chassis + side skirts */}
      {[-0.9, 0.9].map((x, i) => (<mesh key={i} position={[x, 0.38, 5.5]}><boxGeometry args={[0.12, 0.72, 0.12]} /><meshStandardMaterial color="#3a3f47" metalness={0.4} roughness={0.5} /></mesh>))}
      <mesh position={[0, 0.5, 3.3]}><boxGeometry args={[1.4, 0.28, 5.6]} /><meshStandardMaterial color="#1c2026" metalness={0.4} roughness={0.6} /></mesh>
      {[-1.28, 1.28].map((x, i) => (<mesh key={i} position={[x, 0.56, 3.5]}><boxGeometry args={[0.04, 0.5, 4.0]} /><meshStandardMaterial color="#2a2f36" roughness={0.6} /></mesh>))}

      {/* ===================== TRACTOR ===================== */}
      <mesh position={[0, 0.55, 7.4]}><boxGeometry args={[1.3, 0.26, 3.2]} /><meshStandardMaterial color="#1c2026" metalness={0.4} roughness={0.6} /></mesh>
      {/* chrome fuel tanks */}
      {[-1.2, 1.2].map((x, i) => (<mesh key={i} position={[x, 0.75, 7.1]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.34, 0.34, 1.3, 16]} /><meshStandardMaterial color={chrome} metalness={0.82} roughness={0.24} /></mesh>))}
      {/* sleeper cab + hood */}
      <mesh position={[0, 1.6, 8.0]} castShadow><boxGeometry args={[2.5, 2.6, 1.9]} /><meshStandardMaterial color={color} metalness={0.42} roughness={0.38} /></mesh>
      <mesh position={[0, 1.02, 9.2]} castShadow><boxGeometry args={[2.42, 1.5, 0.95]} /><meshStandardMaterial color={color} metalness={0.42} roughness={0.38} /></mesh>
      {/* roof aero fairing */}
      <mesh position={[0, 3.05, 8.0]}><boxGeometry args={[2.35, 0.5, 1.7]} /><meshStandardMaterial color={color} metalness={0.4} roughness={0.4} /></mesh>
      {/* windshield + side windows */}
      <mesh position={[0, 2.1, 8.98]} rotation={[0.14, 0, 0]}><boxGeometry args={[2.2, 0.95, 0.05]} /><meshStandardMaterial color={glass} metalness={0.5} roughness={0.08} envMapIntensity={1.4} /></mesh>
      {[-1.26, 1.26].map((x, i) => (<mesh key={i} position={[x, 1.95, 8.2]}><boxGeometry args={[0.04, 0.7, 1.0]} /><meshStandardMaterial color={glass} metalness={0.5} roughness={0.08} /></mesh>))}
      {/* grille, chrome bumper, headlights */}
      <mesh position={[0, 0.98, 9.66]}><boxGeometry args={[2.0, 1.0, 0.08]} /><meshStandardMaterial color="#1a1d22" metalness={0.6} roughness={0.4} /></mesh>
      <mesh position={[0, 0.5, 9.72]}><boxGeometry args={[2.42, 0.3, 0.14]} /><meshStandardMaterial color={chrome} metalness={0.82} roughness={0.24} /></mesh>
      {[-0.8, 0.8].map((x, i) => (<mesh key={i} position={[x, 0.86, 9.7]}><boxGeometry args={[0.32, 0.24, 0.06]} /><meshStandardMaterial color="#fff8e6" emissive="#fff2cc" emissiveIntensity={1.7} toneMapped={false} /></mesh>))}
      {/* twin chrome exhaust stacks */}
      {[-1.22, 1.22].map((x, i) => (<mesh key={i} position={[x, 2.3, 7.3]}><cylinderGeometry args={[0.1, 0.1, 2.6, 12]} /><meshStandardMaterial color={chrome} metalness={0.85} roughness={0.2} /></mesh>))}
      {/* mirrors */}
      {[-1.42, 1.42].map((x, i) => (<mesh key={i} position={[x, 2.2, 8.85]}><boxGeometry args={[0.06, 0.5, 0.2]} /><meshStandardMaterial color="#20242a" roughness={0.5} /></mesh>))}

      {/* ===================== WHEELS (tandem trailer + tractor drive + steer) ===================== */}
      {([1.9, 3.05] as number[]).flatMap((z) => [-1.15, 1.15].map((x) => [x, z] as [number, number])).map(([x, z], i) => <TruckWheel key={`tw${i}`} x={x} z={z} />)}
      {([6.9, 7.95] as number[]).flatMap((z) => [-1.15, 1.15].map((x) => [x, z] as [number, number])).map(([x, z], i) => <TruckWheel key={`dw${i}`} x={x} z={z} />)}
      {[-1.15, 1.15].map((x, i) => <TruckWheel key={`sw${i}`} x={x} z={9.35} />)}
    </group>
  );
}

// Representative truck-loading cycle — MUST stay in step with Overview.tsx
// truckLoad(): a truck fills over ~30 s, hits 100 % at u=0.9, then holds "full".
const TRUCK_CYCLE_S = 30;
function truckLoadPct(tSec: number) {
  const u = (((tSec % TRUCK_CYCLE_S) + TRUCK_CYCLE_S) % TRUCK_CYCLE_S) / TRUCK_CYCLE_S;
  return Math.min(100, (u / 0.9) * 100);
}

/** A goods lift at the conveyor feed. An open-platform car cycles between the
 *  mezzanine deck and the staging floor; the landing doors slide open when the
 *  car arrives, and a loaded dolly rides down inside the car and rolls out onto
 *  the floor toward the conveyor — then the empty car returns and doors close. */
function GoodsLift({ x, z, phase = 0 }: { x: number; z: number; phase?: number }) {
  const car = useRef<THREE.Group>(null);
  const dolly = useRef<THREE.Group>(null);
  const doorL = useRef<THREE.Mesh>(null);
  const doorR = useRef<THREE.Mesh>(null);
  const period = 11;
  const carBot = 0.1, carTop = WHc.mezY;              // car-floor Y at the two landings
  useFrame((st) => {
    const u = ((((st.clock.elapsedTime + phase * period) % period) + period) % period) / period;
    // car vertical travel: dwell top → descend → dwell floor → ascend empty
    let cy: number;
    if (u < 0.10) cy = carTop;
    else if (u < 0.40) cy = carTop + (carBot - carTop) * ((u - 0.10) / 0.30);
    else if (u < 0.70) cy = carBot;
    else if (u < 0.95) cy = carBot + (carTop - carBot) * ((u - 0.70) / 0.25);
    else cy = carTop;
    if (car.current) car.current.position.y = cy;
    // landing doors open (slide apart) only while the car is at the floor unloading
    const open = u >= 0.40 && u < 0.70;
    if (doorL.current) doorL.current.position.x = THREE.MathUtils.lerp(doorL.current.position.x, open ? -1.08 : -0.55, 0.18);
    if (doorR.current) doorR.current.position.x = THREE.MathUtils.lerp(doorR.current.position.x, open ? 1.08 : 0.55, 0.18);
    // the dolly: rides down on the platform, then rolls out the front (+z)
    const d = dolly.current;
    if (d) {
      if (u < 0.42) { d.visible = true; d.position.set(0, cy + 0.07, 0); }
      else if (u < 0.66) { d.visible = true; d.position.set(0, 0.05, ((u - 0.42) / 0.24) * 3.2); }
      else d.visible = false;
    }
  });
  const H = WHc.mezY + 1.2;
  return (
    <group position={[x, 0, z]}>
      {/* four guide rails + top head-frame */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dz], i) => (
        <mesh key={i} position={[dx, H / 2, dz]}><boxGeometry args={[0.14, H, 0.14]} /><meshStandardMaterial color="#2f4d74" metalness={0.5} roughness={0.5} /></mesh>
      ))}
      <mesh position={[0, WHc.mezY + 1.05, 0]}><boxGeometry args={[2.3, 0.16, 2.3]} /><meshStandardMaterial color="#2f4d74" metalness={0.5} roughness={0.5} /></mesh>
      {/* back wall of the shaft (-z, away from the conveyor) */}
      <mesh position={[0, (WHc.mezY + 1) / 2, -1.12]}><boxGeometry args={[2.3, WHc.mezY + 1, 0.08]} /><meshStandardMaterial color="#33415a" metalness={0.4} roughness={0.55} /></mesh>
      {/* landing door frame + two sliding panels on the +z (conveyor) face */}
      <mesh position={[0, 2.4, 1.14]}><boxGeometry args={[2.5, 0.12, 0.12]} /><meshStandardMaterial color="#20303f" metalness={0.4} roughness={0.5} /></mesh>
      <mesh ref={doorL} position={[-0.55, 1.15, 1.12]} castShadow><boxGeometry args={[1.05, 2.3, 0.08]} /><meshStandardMaterial color="#c7b23f" metalness={0.35} roughness={0.55} /></mesh>
      <mesh ref={doorR} position={[0.55, 1.15, 1.12]} castShadow><boxGeometry args={[1.05, 2.3, 0.08]} /><meshStandardMaterial color="#c7b23f" metalness={0.35} roughness={0.55} /></mesh>
      {/* the open-platform car (floor plate + low side rails) */}
      <group ref={car} position={[0, carTop, 0]}>
        <mesh castShadow receiveShadow><boxGeometry args={[2.1, 0.14, 2.1]} /><meshStandardMaterial color="#7e848d" metalness={0.4} roughness={0.5} /></mesh>
        {[-1.02, 1.02].map((sx, i) => (<mesh key={i} position={[sx, 0.45, -0.35]}><boxGeometry args={[0.06, 0.9, 1.4]} /><meshStandardMaterial color="#6a7078" metalness={0.4} roughness={0.5} /></mesh>))}
      </group>
      {/* the dolly that rides down + rolls out toward the conveyor */}
      <group ref={dolly}><DollyCage /></group>
    </group>
  );
}

/** A dock loader who pushes a loaded dolly from the conveyor end into the truck,
 *  then walks back empty for the next one. */
function DockLoader({ x, phase = 0 }: { x: number; phase?: number }) {
  const worker = useRef<THREE.Group>(null);
  const dolly = useRef<THREE.Group>(null);
  const z0 = 16.6, z1 = 21.2;              // conveyor end → truck rear opening
  const period = 15;
  useFrame((st) => {
    const u = ((((st.clock.elapsedTime + phase * period) % period) + period) % period) / period;
    let wz: number, face: number, pushing: boolean;
    if (u < 0.45) { wz = z0 + (z1 - z0) * (u / 0.45); face = 0; pushing = true; }               // push a load in (+z)
    else if (u < 0.55) { wz = z1; face = 0; pushing = true; }                                    // set it down in the truck
    else if (u < 0.95) { wz = z1 + (z0 - z1) * ((u - 0.55) / 0.40); face = Math.PI; pushing = false; } // walk back empty
    else { wz = z0; face = Math.PI; pushing = false; }
    if (worker.current) { worker.current.position.z = wz; worker.current.rotation.y = face; }
    if (dolly.current) { dolly.current.visible = pushing; dolly.current.position.z = wz + 0.95; } // dolly rides ahead of the pusher
  });
  return (
    <group position={[x, 0, 0]}>
      <group ref={worker} position={[0, 0, 16.6]}><WarehouseWorker phase={phase} /></group>
      <group ref={dolly} position={[0, 0, 17.55]}><DollyCage /></group>
    </group>
  );
}

/** Boxes accumulating inside a truck as it is loaded (synced to truckLoadPct). */
function TruckFill({ x, phase = 0 }: { x: number; phase?: number }) {
  const grp = useRef<THREE.Group>(null);
  const slots = useMemo(() => {
    const s: [number, number, number][] = [];
    for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 3; zi++) for (let xi = 0; xi < 2; xi++)
      s.push([-0.55 + xi * 1.1, 0.78 + yi * 0.72, 23.4 + zi * 1.25]);   // 2 wide × 3 deep × 2 high, inside the container
    return s;
  }, []);
  useFrame(() => {
    const shown = Math.round((truckLoadPct(Date.now() / 1000 + phase * TRUCK_CYCLE_S) / 100) * slots.length);
    if (grp.current) grp.current.children.forEach((c, i) => { c.visible = i < shown; });
  });
  return (
    <group ref={grp} position={[x, 0, 0]}>
      {slots.map((p, i) => (
        <mesh key={i} position={p} castShadow><boxGeometry args={[0.92, 0.62, 1.0]} /><meshStandardMaterial color={i % 2 ? "#bb8d54" : "#a8823f"} roughness={0.85} /></mesh>
      ))}
    </group>
  );
}

/** Orange Toyota electric tow tractor (tugger) with a seated driver. */
function TowTractor({ color = "#e0561a" }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.38, 0]} castShadow><boxGeometry args={[0.9, 0.5, 1.7]} /><meshStandardMaterial color={color} metalness={0.3} roughness={0.5} /></mesh>
      <mesh position={[0, 0.2, 0.75]} castShadow><boxGeometry args={[0.85, 0.3, 0.3]} /><meshStandardMaterial color="#20242a" metalness={0.4} roughness={0.5} /></mesh>
      <mesh position={[0, 0.78, -0.45]} castShadow><boxGeometry args={[0.7, 0.5, 0.12]} /><meshStandardMaterial color="#2a2f36" /></mesh>
      <mesh position={[0, 0.62, 0.35]} rotation={[0.5, 0, 0]}><cylinderGeometry args={[0.02, 0.02, 0.4, 8]} /><meshStandardMaterial color="#15181e" /></mesh>
      <mesh position={[0, 0.78, 0.5]} rotation={[Math.PI / 2.4, 0, 0]}><torusGeometry args={[0.11, 0.02, 8, 16]} /><meshStandardMaterial color="#111417" /></mesh>
      {/* seated driver */}
      <mesh position={[0, 0.78, -0.1]} castShadow><boxGeometry args={[0.3, 0.4, 0.24]} /><meshStandardMaterial color="#2f5c9e" roughness={0.7} /></mesh>
      <mesh position={[0, 1.06, -0.1]} castShadow><sphereGeometry args={[0.1, 14, 14]} /><meshStandardMaterial color={SKIN[2]} roughness={0.6} /></mesh>
      {[[-0.42, 0.62], [0.42, 0.62], [-0.42, -0.55], [0.42, -0.55]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.16, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.16, 0.16, 0.14, 14]} /><meshStandardMaterial color="#15181e" /></mesh>
      ))}
    </group>
  );
}

/** A blue mesh-cage dolly loaded with boxes (what the tugger tows). */
function DollyCage() {
  return (
    <group>
      <mesh position={[0, 0.14, 0]} castShadow><boxGeometry args={[0.95, 0.12, 1.15]} /><meshStandardMaterial color="#2f5c86" metalness={0.3} roughness={0.5} /></mesh>
      <lineSegments position={[0, 0.75, 0]}><edgesGeometry args={[new THREE.BoxGeometry(0.95, 1.2, 1.15)]} /><lineBasicMaterial color="#2f5c86" /></lineSegments>
      {([[0, 0.42, -0.22], [0, 0.42, 0.26], [0, 0.78, 0]] as [number, number, number][]).map((p, i) => (
        <mesh key={i} position={p} castShadow><boxGeometry args={[0.62, 0.34, 0.42]} /><meshStandardMaterial color={i % 2 ? "#bb8d54" : "#a8823f"} roughness={0.85} /></mesh>
      ))}
      {[[-0.36, 0.42], [0.36, 0.42], [-0.36, -0.42], [0.36, -0.42]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.045, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.06, 0.06, 0.05, 10]} /><meshStandardMaterial color="#111417" /></mesh>
      ))}
    </group>
  );
}

/** Tugger + 3 dollies indexing around a milk-run loop through the aisles. */
function Tugger({ loop, color }: { loop: XZ[]; color?: string }) {
  const grp = useRef<THREE.Group>(null);
  const segs = useMemo(() => {
    const s: { a: XZ; b: XZ; len: number; head: number }[] = []; let total = 0;
    for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); s.push({ a, b, len, head: Math.atan2(b[1] - a[1], b[0] - a[0]) }); total += len; }
    return { s, total };
  }, [loop]);
  const at = (u: number) => { let d = ((u % 1) + 1) % 1 * segs.total; for (const sg of segs.s) { if (d <= sg.len) { const f = sg.len ? d / sg.len : 0; return { x: sg.a[0] + (sg.b[0] - sg.a[0]) * f, z: sg.a[1] + (sg.b[1] - sg.a[1]) * f, head: sg.head }; } d -= sg.len; } const l = segs.s[segs.s.length - 1]; return { x: l.b[0], z: l.b[1], head: l.head }; };
  const t = useRef(0);
  const gap = 1.7 / segs.total;
  useFrame((_, dt) => { t.current = (t.current + dt * 1.5 / segs.total) % 1; const g = grp.current; if (!g) return; g.children.forEach((ch, i) => { const p = at(t.current - i * gap); ch.position.set(p.x, 0, p.z); ch.rotation.y = -p.head + Math.PI / 2; }); });
  return (<group ref={grp}><group><TowTractor color={color} /></group><group><DollyCage /></group><group><DollyCage /></group><group><DollyCage /></group><group><DollyCage /></group></group>);
}

/** An RF picker walking an aisle back and forth, scanner in hand. */
/** An RF picker that walks a single aisle: down to a bin, pause to scan/pick,
 *  walk back, pause — a clean, deliberate cycle strictly along the aisle centre. */
function WalkingPicker({ x, z0, z1, y = 0, phase = 0, tone }: { x: number; z0: number; z1: number; y?: number; phase?: number; tone?: string }) {
  const g = useRef<THREE.Group>(null);
  const moving = useRef(true);
  useFrame((st) => {
    const period = 18;
    const u = (((st.clock.elapsedTime + phase * 4) % period) + period) % period / period; // 0..1
    let f: number, mv: boolean, face: number;
    if (u < 0.38) { f = u / 0.38; mv = true; face = 0; }               // walk toward the bin (+z)
    else if (u < 0.5) { f = 1; mv = false; face = 0; }                 // scan / pick
    else if (u < 0.88) { f = 1 - (u - 0.5) / 0.38; mv = true; face = Math.PI; } // walk back (-z)
    else { f = 0; mv = false; face = Math.PI; }                        // stage at aisle head
    moving.current = mv;
    if (g.current) { g.current.position.set(x, y, z0 + (z1 - z0) * f); g.current.rotation.y = face; }
  });
  return <group ref={g}><WarehouseWorker movingRef={moving} tone={tone} phase={phase} /></group>;
}

/** A worker walking a clean straight LANE between two floor points (a→b→a),
 *  facing the direction of travel — keeps workers in aisles/lanes and never
 *  weaving in between the racks. */
function AisleWalker({ a, b, phase = 0, tone }: { a: XZ; b: XZ; phase?: number; tone?: string }) {
  const g = useRef<THREE.Group>(null);
  const moving = useRef(true);
  const head = Math.atan2(b[1] - a[1], b[0] - a[0]);
  useFrame((st) => {
    const period = 26;
    const u = ((((st.clock.elapsedTime + phase * period) % period) + period) % period) / period;
    let f: number, mv: boolean, fwd: boolean;
    if (u < 0.06) { f = 0; mv = false; fwd = true; }
    else if (u < 0.46) { f = (u - 0.06) / 0.40; mv = true; fwd = true; }
    else if (u < 0.54) { f = 1; mv = false; fwd = false; }
    else if (u < 0.94) { f = 1 - (u - 0.54) / 0.40; mv = true; fwd = false; }
    else { f = 0; mv = false; fwd = true; }
    moving.current = mv;
    if (g.current) {
      g.current.position.set(a[0] + (b[0] - a[0]) * f, 0, a[1] + (b[1] - a[1]) * f);
      g.current.rotation.y = Math.PI / 2 - (fwd ? head : head + Math.PI);
    }
  });
  return <group ref={g}><WarehouseWorker movingRef={moving} tone={tone} phase={phase} /></group>;
}

/** Industrial tote box for inbound material receiving. */
function InboundTote({ color = "#1d4ed8" }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.16, 0]}>
        <boxGeometry args={[0.66, 0.32, 0.66]} />
        <meshStandardMaterial color={color} roughness={0.65} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.31, 0]}>
        <boxGeometry args={[0.7, 0.04, 0.7]} />
        <meshStandardMaterial color="#1e293b" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.18, 0.332]}>
        <planeGeometry args={[0.24, 0.14]} />
        <meshBasicMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[-0.08, 0.22, 0]}>
        <boxGeometry args={[0.26, 0.16, 0.36]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.65} roughness={0.35} />
      </mesh>
      <mesh position={[0.13, 0.24, 0.06]}>
        <cylinderGeometry args={[0.07, 0.07, 0.22, 10]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.75} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Sealed corrugated shipping carton for outbound sending. */
function OutboundCarton({ type = 0 }: { type?: number }) {
  const c = type % 2 === 0 ? "#bb8d54" : "#b08449";
  return (
    <group>
      <mesh position={[0, 0.22, 0]}>
        <boxGeometry args={[0.7, 0.44, 0.7]} />
        <meshStandardMaterial color={c} roughness={0.88} />
      </mesh>
      <mesh position={[0, 0.442, 0]}>
        <boxGeometry args={[0.11, 0.005, 0.71]} />
        <meshStandardMaterial color="#8b5e28" roughness={0.65} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.15, 0.444, 0.12]}>
        <planeGeometry args={[0.22, 0.26]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0.24, 0.352]}>
        <planeGeometry args={[0.16, 0.12]} />
        <meshBasicMaterial color="#dc2626" />
      </mesh>
    </group>
  );
}

/** An open shipping box riding a staging conveyor, packed with mixed small +
 *  large parts (the consolidated order heading to the truck). */
function PackedBox() {
  return (
    <group>
      <mesh><boxGeometry args={[0.72, 0.5, 0.72]} /><meshStandardMaterial color="#bb8d54" roughness={0.85} /></mesh>
      {/* open flaps */}
      {[[-0.36, 0.35], [0.36, -0.35]].map(([x, r], i) => (<mesh key={i} position={[x, 0.27, 0]} rotation={[0, 0, r]}><boxGeometry args={[0.06, 0.34, 0.72]} /><meshStandardMaterial color="#c69a5e" roughness={0.8} /></mesh>))}
      {/* contents — mixed parts poking out */}
      <mesh position={[-0.14, 0.28, 0.1]}><boxGeometry args={[0.22, 0.2, 0.3]} /><meshStandardMaterial color="#d8d2c4" roughness={0.7} /></mesh>
      <mesh position={[0.16, 0.3, -0.12]}><boxGeometry args={[0.18, 0.24, 0.2]} /><meshStandardMaterial color="#8fa0b3" metalness={0.4} roughness={0.5} /></mesh>
      <mesh position={[0.1, 0.24, 0.2]}><cylinderGeometry args={[0.07, 0.07, 0.18, 12]} /><meshStandardMaterial color="#c0392b" roughness={0.6} /></mesh>
    </group>
  );
}
function ConveyorBoxes({ x, mode = "sending" }: { x: number; mode?: "receiving" | "sending" }) {
  const g = useRef<THREE.Group>(null); const N = 3;
  useFrame((st) => {
    if (!g.current) return;
    g.current.children.forEach((ch, i) => {
      const u = ((st.clock.elapsedTime * 0.045) + i / N) % 1;
      const z = mode === "receiving" ? 15.5 - (15.5 - 8) * u : 8 + (15.5 - 8) * u;
      ch.position.set(x, 0.62, z);
    });
  });
  return (
    <group ref={g}>
      {Array.from({ length: N }).map((_, i) => (
        <group key={i}>
          {mode === "receiving" ? (i % 2 === 0 ? <InboundTote color="#2563eb" /> : <InboundTote color="#059669" />) : <PackedBox />}
        </group>
      ))}
    </group>
  );
}

/** A big HVLS ceiling fan slowly turning. */
function HVLSFan({ x, z, y = 6.6 }: { x: number; z: number; y?: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (g.current) g.current.rotation.y += dt * 0.55; });
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.35, 0]}><cylinderGeometry args={[0.05, 0.05, 0.7, 8]} /><meshStandardMaterial color="#20242a" /></mesh>
      <mesh><cylinderGeometry args={[0.26, 0.26, 0.16, 14]} /><meshStandardMaterial color="#3a4048" metalness={0.5} roughness={0.5} /></mesh>
      <group ref={g}>{[0, 1, 2, 3, 4].map((i) => { const a = i / 5 * Math.PI * 2; return <mesh key={i} position={[Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4]} rotation={[0, -a, 0]}><boxGeometry args={[2.7, 0.04, 0.3]} /><meshStandardMaterial color="#c9ccd2" metalness={0.3} roughness={0.5} /></mesh>; })}</group>
    </group>
  );
}

/** All the live warehouse motion + floor markings + fans. */
function WarehouseActivity({ whFloor }: { whFloor: "both" | "ground" | "mezz" }) {
  // two tugger milk-runs on separate routes; pickers strictly one-per-aisle.
  const loop1: XZ[] = [[-16, -21], [12, -21], [12, 4], [-7, 9]];
  const loop2: XZ[] = [[10, -17], [-14, -17], [-14, 3], [5, 9]];
  const aisleG: [number, number, number, number][] = [[-12, -21, -6, 0], [-4, -20, -2, 0.5], [4, -21, -8, 1.0]];      // x, z0, z1, phase
  const aisleM: [number, number, number, number][] = [[-16, -21, -5, 0.3], [0, -20, -3, 0.8], [8, -21, -7, 1.3]];
  const staged: [number, number][] = [[-13, 8], [-11.2, 8], [11.2, 8], [13, 8]];
  const packers: [number, number, number][] = [[-9, 12.5, 0], [0, 12.5, 0.6], [9, 12.5, 1.2]];
  const docks: number[] = [-9, 0, 9];
  return (
    <group>
      {/* painted guide lanes (yellow) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-16, 0.02, -8]}><planeGeometry args={[0.16, 34]} /><meshBasicMaterial color="#caa63a" transparent opacity={0.7} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[13, 0.02, -8]}><planeGeometry args={[0.16, 34]} /><meshBasicMaterial color="#caa63a" transparent opacity={0.7} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 8.5]}><planeGeometry args={[30, 0.16]} /><meshBasicMaterial color="#caa63a" transparent opacity={0.7} /></mesh>
      {/* two tugger milk-runs */}
      <Tugger loop={loop1} />
      <Tugger loop={loop2} />
      {/* dollies staged at the shipping area */}
      {staged.map(([x, z], i) => (<group key={`sd${i}`} position={[x, 0, z]}><DollyCage /></group>))}
      {/* ground RF pickers — one per aisle, walking the aisle centre */}
      {whFloor !== "mezz" && aisleG.map(([x, z0, z1, ph], i) => (
        <WalkingPicker key={`gp${i}`} x={x} z0={z0} z1={z1} y={0} phase={ph} tone={SKIN[i % SKIN.length]} />
      ))}
      {/* mezzanine RF pickers — one per aisle */}
      {whFloor !== "ground" && aisleM.map(([x, z0, z1, ph], i) => (
        <WalkingPicker key={`mp${i}`} x={x} z0={z0} z1={z1} y={WHc.mezY + 0.2} phase={ph} tone={SKIN[(i + 2) % SKIN.length]} />
      ))}
      {/* packers standing BESIDE each conveyor (not on it), facing the belt so
          the boxes pass by them rather than through them */}
      {packers.map(([x, z, ph], i) => (
        <group key={`pk${i}`} position={[x + 1.25, 0, z]} rotation={[0, -Math.PI / 2, 0]}><WarehouseWorker tone={SKIN[(i + 1) % SKIN.length]} phase={ph} vest="#2f9e8f" /></group>
      ))}
      {/* a loader pushing a loaded dolly from the conveyor end into each truck */}
      {docks.map((x, i) => (<DockLoader key={`dl${i}`} x={x} phase={i * 0.33} />))}
      {/* each truck filling up with boxes as it is loaded */}
      {docks.map((x, i) => (<TruckFill key={`tf${i}`} x={x} phase={i / 3} />))}
      {/* boxes on the three staging conveyors: receiving at -9, sending at 0 and 9 */}
      <ConveyorBoxes key="cb-rec" x={-9} mode="receiving" />
      <ConveyorBoxes key="cb-send1" x={0} mode="sending" />
      <ConveyorBoxes key="cb-send2" x={9} mode="sending" />
      {/* HVLS fans overhead */}
      {([[-10, -14], [8, -14], [0, 2]] as [number, number][]).map(([x, z], i) => (<HVLSFan key={`fan${i}`} x={x} z={z} />))}
    </group>
  );
}

/** A flat floor billboard label naming a warehouse zone. */
function ZoneTag({ x, z, text, y = 0.5 }: { x: number; z: number; text: string; y?: number }) {
  return (
    <Html position={[x, y, z]} center distanceFactor={40} zIndexRange={[6, 0]}>
      <div style={{ font: "600 12px/1 ui-monospace,monospace", letterSpacing: ".14em", color: "#cbd5e1", background: "rgba(12,16,22,.62)", border: "1px solid #2a323f", borderRadius: 6, padding: "5px 11px", whiteSpace: "nowrap", textTransform: "uppercase", pointerEvents: "none" }}>{text}</div>
    </Html>
  );
}

/** One labelled block of pallet racking (rows spaced along x, bays along z, N
 *  levels), drawn instanced. Lays out an enlarged storage zone (R&R, D22, VH …). */
function RackBlock({ x0, x1, z0, z1, levels = 4, label, labelZ, rowGap = 2.2 }: {
  x0: number; x1: number; z0: number; z1: number; levels?: number; label?: string; labelZ?: number; rowGap?: number;
}) {
  const g = useMemo(() => {
    const rowXs: number[] = [];
    for (let x = x0 + 1.4; x <= x1 - 1.4 + 1e-6; x += rowGap) rowXs.push(x);
    const len = z1 - z0, cz = (z0 + z1) / 2, bays = Math.max(3, Math.round(len / 2.4));
    const levelYs = levels >= 4 ? [0.95, 2.15, 3.35, 4.55] : [0.95, 2.05, 3.15];
    const uH = levels >= 4 ? 5.0 : 3.9, uY = uH / 2;
    const up: [number, number, number][] = [], beam: [number, number, number][] = [], boxA: [number, number, number][] = [], boxB: [number, number, number][] = [];
    rowXs.forEach((x) => {
      for (let i = 0; i <= bays; i++) { const z = z0 + (i / bays) * len; up.push([x - 0.55, uY, z]); up.push([x + 0.55, uY, z]); }
      levelYs.forEach((y) => { beam.push([x - 0.5, y, cz]); beam.push([x + 0.5, y, cz]); });
      levelYs.forEach((y, li) => { for (let i = 0; i < bays; i++) { if ((i + li) % 5 === 0) continue; const z = z0 + ((i + 0.5) / bays) * len; ((i * 2 + li) % 3 === 0 ? boxB : boxA).push([x, y + 0.32, z]); } });
    });
    return { up, beam, boxA, boxB, len, bays, uH };
  }, [x0, x1, z0, z1, levels, rowGap]);
  return (
    <group>
      <InstancedBoxes items={g.up} args={[0.1, g.uH, 0.1]} color="#2f4d74" metalness={0.5} roughness={0.5} />
      <InstancedBoxes items={g.beam} args={[0.09, 0.09, g.len]} color="#c76a18" metalness={0.35} roughness={0.55} />
      <InstancedBoxes items={g.boxA} args={[0.95, 0.5, (g.len / g.bays) * 0.82]} color="#b98a4e" roughness={0.88} />{/* cardboard */}
      <InstancedBoxes items={g.boxB} args={[0.9, 0.52, (g.len / g.bays) * 0.8]} color="#c3ced7" metalness={0.35} roughness={0.42} />{/* shrink-wrapped */}
      {label && <ZoneTag x={(x0 + x1) / 2} z={labelZ ?? (z0 + z1) / 2} text={label} />}
    </group>
  );
}

/** A counterbalance forklift: yellow chassis + grey counterweight, overhead guard
 *  cage, twin mast + carriage, forks, seat, steering wheel and an amber beacon. */
function Forklift({ x, z, rot = 0 }: { x: number; z: number; rot?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {/* lower chassis (yellow) */}
      <mesh position={[0, 0.32, -0.1]} castShadow><boxGeometry args={[1.12, 0.52, 1.9]} /><meshStandardMaterial color="#e3a72b" metalness={0.3} roughness={0.5} /></mesh>
      {/* counterweight (rear, grey) */}
      <mesh position={[0, 0.62, -0.72]} castShadow><boxGeometry args={[1.08, 0.86, 0.72]} /><meshStandardMaterial color="#c6c8cc" metalness={0.35} roughness={0.5} /></mesh>
      {/* hood over the powertrain */}
      <mesh position={[0, 0.92, -0.35]} castShadow><boxGeometry args={[0.92, 0.42, 0.85]} /><meshStandardMaterial color="#33383f" roughness={0.6} /></mesh>
      {/* seat + backrest */}
      <mesh position={[0, 1.16, -0.42]}><boxGeometry args={[0.48, 0.1, 0.46]} /><meshStandardMaterial color="#17191d" roughness={0.7} /></mesh>
      <mesh position={[0, 1.4, -0.64]}><boxGeometry args={[0.48, 0.44, 0.1]} /><meshStandardMaterial color="#17191d" roughness={0.7} /></mesh>
      {/* steering column + wheel */}
      <mesh position={[0, 1.2, 0.05]} rotation={[0.5, 0, 0]}><cylinderGeometry args={[0.025, 0.025, 0.5, 8]} /><meshStandardMaterial color="#22262c" /></mesh>
      <mesh position={[0, 1.4, 0.18]} rotation={[Math.PI / 2.3, 0, 0]}><torusGeometry args={[0.12, 0.02, 8, 18]} /><meshStandardMaterial color="#111417" /></mesh>
      {/* overhead guard cage: 4 posts + roof */}
      {([[-0.52, -0.78], [0.52, -0.78], [-0.52, 0.32], [0.52, 0.32]] as [number, number][]).map(([px, pz], i) => (
        <mesh key={i} position={[px, 1.62, pz]}><boxGeometry args={[0.06, 1.5, 0.06]} /><meshStandardMaterial color="#22262c" metalness={0.5} roughness={0.4} /></mesh>
      ))}
      <mesh position={[0, 2.38, -0.23]} castShadow><boxGeometry args={[1.1, 0.07, 1.25]} /><meshStandardMaterial color="#22262c" metalness={0.5} roughness={0.4} /></mesh>
      {/* amber beacon */}
      <mesh position={[0.42, 2.48, -0.23]}><sphereGeometry args={[0.06, 10, 8]} /><meshStandardMaterial color="#ffb02a" emissive="#ffb02a" emissiveIntensity={1.6} toneMapped={false} /></mesh>
      {/* twin mast + carriage at the front */}
      {[-0.33, 0.33].map((mx, i) => (<mesh key={i} position={[mx, 1.5, 0.92]} castShadow><boxGeometry args={[0.1, 3.0, 0.12]} /><meshStandardMaterial color="#20242a" metalness={0.55} roughness={0.4} /></mesh>))}
      <mesh position={[0, 0.85, 0.86]}><boxGeometry args={[0.78, 0.5, 0.08]} /><meshStandardMaterial color="#2a2f36" metalness={0.4} roughness={0.5} /></mesh>
      {/* forks */}
      {[-0.27, 0.27].map((fx, i) => (<mesh key={i} position={[fx, 0.12, 1.5]} castShadow><boxGeometry args={[0.12, 0.06, 1.1]} /><meshStandardMaterial color="#31363d" metalness={0.55} roughness={0.4} /></mesh>))}
      {/* wheels — front (drive, larger) + rear (steer) */}
      {([[-0.56, 0.5, 0.32], [0.56, 0.5, 0.32], [-0.5, -0.72, 0.26], [0.5, -0.72, 0.26]] as [number, number, number][]).map(([wx, wz, r], i) => (
        <mesh key={i} position={[wx, r, wz]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[r, r, 0.2, 16]} /><meshStandardMaterial color="#14171c" roughness={0.75} /></mesh>
      ))}
    </group>
  );
}

/** A yellow floor-tape loading-bay outline (like the taped truck bays on-site). */
function YellowBay({ x, z, w = 4, d = 3.4 }: { x: number; z: number; w?: number; d?: number }) {
  const t = 0.12;
  return (
    <group position={[x, 0.03, z]}>
      {[-d / 2, d / 2].map((oz, i) => (<mesh key={`h${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, oz]}><planeGeometry args={[w, t]} /><meshBasicMaterial color="#e8b21c" /></mesh>))}
      {[-w / 2, w / 2].map((ox, i) => (<mesh key={`v${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[ox, 0, 0]}><planeGeometry args={[t, d]} /><meshBasicMaterial color="#e8b21c" /></mesh>))}
    </group>
  );
}

/** A forklift working an aisle: drives in, lifts/places a pallet, drives out. */
function WorkingForklift({ x, z0, z1, phase = 0 }: { x: number; z0: number; z1: number; phase?: number }) {
  const g = useRef<THREE.Group>(null);
  const lift = useRef<THREE.Group>(null);
  useFrame((st) => {
    const period = 18;
    const u = ((((st.clock.elapsedTime + phase * period) % period) + period) % period) / period;
    let z: number, face: number, liftY = 0.32, load = true;
    if (u < 0.42) { z = z0 + (z1 - z0) * (u / 0.42); face = Math.PI; }                            // drive into the aisle (-z), forks low
    else if (u < 0.50) { z = z1; face = Math.PI; liftY = 0.32 + ((u - 0.42) / 0.08) * 2.6; }      // raise the load up the mast
    else if (u < 0.56) { z = z1; face = Math.PI; liftY = 2.9; }                                   // place into the rack
    else if (u < 0.62) { z = z1; face = Math.PI; load = false; }                                  // released — pull empty forks back
    else if (u < 0.98) { z = z1 + (z0 - z1) * ((u - 0.62) / 0.36); face = 0; load = false; }      // drive back out empty
    else { z = z0; face = 0; load = false; }
    if (g.current) { g.current.position.set(x, 0, z); g.current.rotation.y = face; }
    if (lift.current) { lift.current.position.y = liftY; lift.current.visible = load; }
  });
  return (
    <group ref={g}>
      <Forklift x={0} z={0} />
      {/* pallet + box that ride UP the mast and get placed into the rack */}
      <group ref={lift}>
        <mesh position={[0, 0, 1.5]} castShadow><boxGeometry args={[0.9, 0.14, 1.0]} /><meshStandardMaterial color="#8a6a3f" roughness={0.85} /></mesh>
        <mesh position={[0, 0.42, 1.5]} castShadow><boxGeometry args={[0.82, 0.6, 0.85]} /><meshStandardMaterial color="#c2d0da" metalness={0.35} roughness={0.42} /></mesh>
      </group>
    </group>
  );
}

// ============================================================
// NPCC Warehouse Layout Constants
// Warehouse: 255m × 120m (no canopy in 3D view)
// Scene scale: ~1 unit = 1 metre
//
// X-axis: right (+X near mezzanine) → left (−X away from mezzanine)
// Z-axis: back (−Z) → front (+Z, truck/dock side)
//
// Zone layout (right → left on X):
//   R & R Storage → D22 Storage → VH Storage → Hyundai Storage → SSP Storage
// Central gangway: Z = −3 to +3 (painted corridor lines)
// Staging/sorting/packing: Z = 4 to 14 (except R & R front which has 4-story racks)
// Truck docks: Z = 22 (open bays, no canopy)
// ============================================================

/** Animated boxes riding the NPCC staging conveyors (receiving or sending). */
function StagingConveyorBoxes({ x, z0, z1, mode }: {
  x: number; z0: number; z1: number; mode: "receiving" | "sending";
}) {
  const g = useRef<THREE.Group>(null);
  const N = 4;
  const len = z1 - z0;
  useFrame((st) => {
    if (!g.current) return;
    const speed = 0.045; // calm, steady logistics speed
    g.current.children.forEach((ch, i) => {
      const u = ((st.clock.elapsedTime * speed) + i / N) % 1;
      // receiving: incoming from dock end (z1) inward toward storage/gangway (z0)
      // sending: outbound from packing/staging (z0) forward toward dock end (z1)
      const z = mode === "receiving"
        ? (z1 - 0.7) - u * (len - 1.4)
        : (z0 + 0.7) + u * (len - 1.4);
      ch.position.set(x, 0.48, z);
    });
  });
  return (
    <group ref={g}>
      {Array.from({ length: N }).map((_, i) => (
        <group key={i}>
          {mode === "receiving" ? (
            i % 2 === 0 ? <InboundTote color="#2563eb" /> : <InboundTote color="#059669" />
          ) : (
            <OutboundCarton type={i} />
          )}
        </group>
      ))}
    </group>
  );
}

/** Staging conveyor — with active material flow (receiving vs sending), scanner portal, and flow indicators. */
function StagingConveyor({ x, z0, z1, mode = "sending" }: {
  x: number; z0: number; z1: number; mode?: "receiving" | "sending";
}) {
  const len = z1 - z0, cz = (z0 + z1) / 2;
  const isRec = mode === "receiving";
  const archZ = isRec ? z1 - 1.4 : z1 - 1.0;
  const laserColor = isRec ? "#00f0ff" : "#ff2a2a";

  return (
    <group>
      {/* belt surface */}
      <mesh position={[x, 0.46, cz]}>
        <boxGeometry args={[0.92, 0.08, len]} />
        <meshStandardMaterial color="#1e2329" metalness={0.4} roughness={0.65} />
      </mesh>
      {/* side guide rails */}
      {[-0.48, 0.48].map((dx, i) => (
        <mesh key={i} position={[x + dx, 0.53, cz]}>
          <boxGeometry args={[0.05, 0.18, len]} />
          <meshStandardMaterial color="#3a4050" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
      {/* directional LED strip along side rails */}
      {[-0.49, 0.49].map((dx, i) => (
        <mesh key={`led-${i}`} position={[x + dx, 0.58, cz]}>
          <boxGeometry args={[0.015, 0.02, len - 0.4]} />
          <meshStandardMaterial
            color={laserColor}
            emissive={laserColor}
            emissiveIntensity={1.2}
            toneMapped={false}
          />
        </mesh>
      ))}
      {/* support legs every 2m */}
      {Array.from({ length: Math.max(2, Math.round(len / 2.2)) }).map((_, i) => {
        const lz = z0 + ((i + 0.5) / Math.max(2, Math.round(len / 2.2))) * len;
        return (
          <mesh key={i} position={[x, 0.23, lz]}>
            <boxGeometry args={[0.82, 0.46, 0.06]} />
            <meshStandardMaterial color="#333a46" metalness={0.4} roughness={0.6} />
          </mesh>
        );
      })}

      {/* barcode scanner portal arch */}
      <mesh position={[x - 0.65, 0.9, archZ]}><boxGeometry args={[0.07, 1.4, 0.07]} /><meshStandardMaterial color="#1f2329" /></mesh>
      <mesh position={[x + 0.65, 0.9, archZ]}><boxGeometry args={[0.07, 1.4, 0.07]} /><meshStandardMaterial color="#1f2329" /></mesh>
      <mesh position={[x, 1.62, archZ]}><boxGeometry args={[1.4, 0.07, 0.07]} /><meshStandardMaterial color="#1f2329" /></mesh>
      {/* scanner laser line */}
      <mesh position={[x, 1.05, archZ]}>
        <boxGeometry args={[0.96, 0.018, 0.018]} />
        <meshStandardMaterial color={laserColor} emissive={laserColor} emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      {/* scanner portal sign badge */}
      <mesh position={[x, 1.82, archZ]}>
        <boxGeometry args={[1.05, 0.24, 0.04]} />
        <meshStandardMaterial color={isRec ? "#064e3b" : "#7c2d12"} roughness={0.5} />
      </mesh>
      <Html position={[x, 1.82, archZ]} center distanceFactor={35} zIndexRange={[5, 0]}>
        <div style={{
          font: "700 9px/1 ui-monospace,monospace",
          letterSpacing: ".1em",
          color: isRec ? "#6ee7b7" : "#fdba74",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          textTransform: "uppercase",
          textShadow: `0 0 6px ${isRec ? "rgba(16,185,129,0.8)" : "rgba(249,115,22,0.8)"}`,
        }}>
          {isRec ? "INBOUND · RECEIVING ↓" : "OUTBOUND · SENDING ↑"}
        </div>
      </Html>

      {/* active moving material boxes */}
      <StagingConveyorBoxes x={x} z0={z0} z1={z1} mode={mode} />
    </group>
  );
}

/** The NPCC warehouse — layout matching old plan and site drawing.
/** The NPCC warehouse — layout matching user's drawing strictly.
 *
 *  Storage side (all 4 stories high):
 *    - R & R Storage (full depth, Z: -24 to -4)
 *    - D22 Primary Storage (front depth, Z: -14 to -4)
 *    - D22 Reserve (front depth, Z: -14 to -4)
 *    - PMSP (back depth, Z: -24 to -15, behind D22 Reserve & Primary, ends at R&R)
 *  Middle:
 *    - Gangway (open corridor, painted boundary lines, Z: -3 to +3)
 *  Staging / Front side:
 *    - In front of R & R: Storage with racks (4-story) + Bumper receiving area + In house receiving
 *    - In front of D22 Primary: D22 unloading and receiving area
 *    - In front of D22 Reserve: D22 packing area + Bay 1, Bay 2, Bay 3
 *  Front edge:
 *    - Truck Bays (open bays at Z = 22)
 *  Perimeter:
 *    - Door 1, Door 2
 */
function WarehouseExtension({ whFloor }: { whFloor: "both" | "ground" | "mezz" }) {
  if (whFloor === "mezz") return null;

  // ── Coordinates strictly within building footprint ──────────────────────
  const zBackWall     = -24;   // back wall
  const zStorageFront =  -4;   // front of storage racks (facing gangway)
  const zGangwayBack  =  -3;   // gangway back boundary line
  const zGangwayFront =   3;   // gangway front boundary line
  const zStagingBack  =   4;   // staging back line (facing gangway)
  const zStagingFront =  14;   // staging front line
  const zDock         =  22;   // truck docks line

  // ── Storage zones matching user's drawing ────────────────────────────────
  // R & R Storage: full depth (abutting Mezzanine at -22)
  const rnrX0 = -44, rnrX1 = -22;
  // D22 Primary Storage: front depth (Z: -14 to -4)
  const d22pX0 = -66, d22pX1 = -46;
  // D22 Reserve: front depth (Z: -14 to -4)
  const d22rX0 = -86, d22rX1 = -68;
  // PMSP: back depth (Z: -24 to -15) behind D22 Reserve & Primary, ends at R & R
  const pmspX0 = -86, pmspX1 = -46;

  // ── Gangway corridor ──────────────────────────────────────────────────────
  const gangwayX0 = -88, gangwayX1 = -8;
  const gangwayLen = gangwayX1 - gangwayX0, gangwayCx = (gangwayX0 + gangwayX1) / 2;
  const gangwayCz  = (zGangwayBack + zGangwayFront) / 2;

  // ── Structural pillars (floor → roof, 8 m) ───────────────────────────────
  const pillars: [number, number, number][] = [];
  for (let px = -84; px <= -20; px += 14)
    for (let pz = zBackWall + 2; pz <= zStagingFront; pz += 12)
      pillars.push([px, 4.0, pz]);


  // ── Docks along front ────────────────────────────────────────────────────
  const dockXs = [-28, -56, -78];

  return (
    <group>

      {/* ═══════════════════════════════════════════════════════════════════
          STORAGE RACKS (4-story pallet racking)
          ═══════════════════════════════════════════════════════════════════ */}
      {/* 1. R & R Storage — full depth */}
      <RackBlock
        x0={rnrX0} x1={rnrX1}
        z0={zBackWall} z1={zStorageFront}
        levels={4} rowGap={2.2}
        label="R & R Storage"
        labelZ={zStorageFront + 1}
      />

      {/* 2. D22 Primary Storage — front depth (Z: -14 to -4) */}
      <RackBlock
        x0={d22pX0} x1={d22pX1}
        z0={-14} z1={zStorageFront}
        levels={4} rowGap={2.2}
        label="D22 Primary Storage"
        labelZ={zStorageFront + 1}
      />

      {/* 3. D22 Reserve — front depth (Z: -14 to -4) */}
      <RackBlock
        x0={d22rX0} x1={d22rX1}
        z0={-14} z1={zStorageFront}
        levels={4} rowGap={2.2}
        label="D22 Reserve"
        labelZ={zStorageFront + 1}
      />

      {/* 4. PMSP — back depth (Z: -24 to -15) behind D22 Reserve & Primary */}
      <RackBlock
        x0={pmspX0} x1={pmspX1}
        z0={zBackWall} z1={-15}
        levels={4} rowGap={2.0}
        label="PMSP"
        labelZ={-19.5}
      />

      {/* ═══════════════════════════════════════════════════════════════════
          STRUCTURAL PILLARS
          ═══════════════════════════════════════════════════════════════════ */}
      <InstancedBoxes items={pillars} args={[0.5, 8, 0.5]} color="#3f5170" metalness={0.4} roughness={0.6} cast />
      <InstancedBoxes
        items={pillars.map((p) => [p[0], 8.1, p[2]] as [number, number, number])}
        args={[0.9, 0.2, 0.9]} color="#2b3a52" metalness={0.4} roughness={0.6}
      />

      {/* ═══════════════════════════════════════════════════════════════════
          CENTRAL GANGWAY — open corridor (no asphalt road, no barricades)
          ═══════════════════════════════════════════════════════════════════ */}
      {/* painted yellow aisle boundary stripes on warehouse floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[gangwayCx, 0.02, zGangwayBack]}>
        <planeGeometry args={[gangwayLen, 0.14]} />
        <meshBasicMaterial color="#caa63a" transparent opacity={0.75} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[gangwayCx, 0.02, zGangwayFront]}>
        <planeGeometry args={[gangwayLen, 0.14]} />
        <meshBasicMaterial color="#caa63a" transparent opacity={0.75} />
      </mesh>
      <ZoneTag x={gangwayCx} z={gangwayCz} text="Gangway" />

      {/* ═══════════════════════════════════════════════════════════════════
          FRONT STAGING & RECEIVING ZONES (Z: 4 to 14)
          ═══════════════════════════════════════════════════════════════════ */}
      {/* floor stripe for D22 staging / sorting / packing area */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}
        position={[(d22pX1 + d22rX0) / 2, 0.015, (zStagingBack + zStagingFront) / 2]} receiveShadow>
        <planeGeometry args={[d22pX1 - d22rX0, zStagingFront - zStagingBack]} />
        <meshStandardMaterial color="#3a4a42" roughness={0.9} metalness={0.05} />
      </mesh>

      {/* In front of R & R Storage: "Storage with racks" */}
      <RackBlock
        x0={-44} x1={-34}
        z0={zStagingBack + 0.5} z1={zStagingFront}
        levels={4} rowGap={2.2}
        label="Storage with racks"
        labelZ={zStagingFront - 1}
      />
      {/* In front of R & R Storage: "Bumper receiving area" & "In house receiving" */}
      <ZoneTag x={-28} z={7} text="Bumper receiving area" />
      <ZoneTag x={-28} z={12} text="In house receiving" />

      {/* In front of D22 Primary: "D22 unloading and receiving area" */}
      <ZoneTag x={(d22pX0 + d22pX1) / 2} z={8} text="D22 unloading and receiving area" />
      {/* dual inbound receiving conveyors carrying materials inward from trucks */}
      <StagingConveyor x={-52} z0={zStagingBack + 0.6} z1={zStagingFront} mode="receiving" />
      <StagingConveyor x={-60} z0={zStagingBack + 0.6} z1={zStagingFront} mode="receiving" />
      {/* receiving operator checking incoming parts */}
      <group position={[-50.5, 0, 9]} rotation={[0, -Math.PI / 2, 0]}>
        <WarehouseWorker tone={SKIN[1]} phase={0.2} vest="#0284c7" />
      </group>

      {/* In front of D22 Reserve: "D22 packing area" + "Bay 1", "Bay 2", "Bay 3" */}
      <ZoneTag x={(d22rX0 + d22rX1) / 2} z={6.5} text="D22 packing area" />
      {/* dual outbound sending conveyors carrying packed cartons to shipping bays */}
      <StagingConveyor x={-74} z0={zStagingBack + 0.6} z1={zStagingFront} mode="sending" />
      <StagingConveyor x={-80} z0={zStagingBack + 0.6} z1={zStagingFront} mode="sending" />
      {/* packing tables (grey benches) with operators packing goods */}
      {([-71, -77, -84] as number[]).map((x, i) => (
        <group key={`ptg-${i}`}>
          <mesh position={[x, 0.9, 7.5]}>
            <boxGeometry args={[2.0, 0.08, 0.9]} />
            <meshStandardMaterial color="#7a8490" metalness={0.3} roughness={0.6} />
          </mesh>
          <group position={[x, 0, 6.7]}>
            <WarehouseWorker tone={SKIN[(i + 2) % SKIN.length]} phase={i * 0.4} vest="#d97706" />
          </group>
        </group>
      ))}
      <ZoneTag x={-70} z={13} text="Bay 1" />
      <ZoneTag x={-76} z={13} text="Bay 2" />
      <ZoneTag x={-82} z={13} text="Bay 3" />

      {/* dollies staged at receiving */}
      {([-28, -50, -62] as number[]).map((x, i) => (
        <group key={`dc-${i}`} position={[x, 0, 15]}><DollyCage /></group>
      ))}

      {/* ═══════════════════════════════════════════════════════════════════
          TRUCK BAYS (open bays at z=22, no canopy)
          ═══════════════════════════════════════════════════════════════════ */}
      {dockXs.map((x, i) => (
        <group key={`dock-${i}`} position={[x, 0, zDock]}>
          <DepotTruck color={["#8a3b3b", "#3b5a8a", "#3b7a5a"][i % 3]} />
          <YellowBay x={0} z={-5} />
        </group>
      ))}
      <ZoneTag x={(dockXs[0] + dockXs[dockXs.length - 1]) / 2} z={zDock + 4} text="Truck Bays" />

      {/* ═══════════════════════════════════════════════════════════════════
          DOORS (per drawing annotations)
          ═══════════════════════════════════════════════════════════════════ */}
      <ZoneTag x={-87} z={-7} text="Door 1" />
      <ZoneTag x={-87} z={-20} text="Door 2" />

      {/* ═══════════════════════════════════════════════════════════════════
          LIVE WORKERS + VEHICLES
          ═══════════════════════════════════════════════════════════════════ */}
      {/* workers in staging / receiving lanes */}
      <AisleWalker a={[-46, 7]} b={[-84, 7]} phase={0}   tone={SKIN[0]} />
      <AisleWalker a={[-84, 11]} b={[-46, 11]} phase={0.45} tone={SKIN[1]} />
      {/* workers at packing tables */}
      {([-72, -78, -84] as number[]).map((x, i) => (
        <group key={`pw-${i}`} position={[x, 0, 8.1]} rotation={[0, Math.PI / 2, 0]}>
          <WarehouseWorker tone={SKIN[(i + 2) % SKIN.length]} phase={i * 0.55} vest="#2f9e8f" />
        </group>
      ))}
      {/* workers at dock / receiving area */}
      {([[-28, 17], [-56, 17], [-78, 17]] as [number, number][]).map(([x, z], i) => (
        <group key={`dw-${i}`} position={[x, 0, z]} rotation={[0, -Math.PI / 2, 0]}>
          <WarehouseWorker tone={SKIN[(i + 1) % SKIN.length]} phase={i * 0.7} vest="#e8a12a" />
        </group>
      ))}
      {/* tow motor (tugger) moving through the gangway */}
      <Tugger
        loop={[[gangwayX0 + 4, gangwayCz], [gangwayX1 - 4, gangwayCz], [gangwayX1 - 4, gangwayCz - 0.8], [gangwayX0 + 4, gangwayCz - 0.8]]}
        color="#f5c518"
      />
      {/* forklift working in Storage with Racks aisle */}
      <WorkingForklift x={-39} z0={zStagingBack + 1} z1={zStagingFront - 1} phase={0.3} />
      {/* second forklift in D22 aisle */}
      <WorkingForklift x={-56} z0={-13} z1={-5} phase={0.7} />
    </group>
  );
}

function Scene({ stations, selected, onSelect, bottleneck, kpi, layout, flowRate, product, engineSupply, whFloor = "both" }: {
  stations: StationLive[]; selected: string | null; onSelect: (s: string) => void;
  bottleneck?: string | null; kpi: Record<string, StationKpi>; layout: Layout; flowRate: number;
  product?: string | null;
  engineSupply?: { units_per_hr: number } | null;
  whFloor?: "both" | "ground" | "mezz";
}) {
  const stateOf: Record<string, MachineState> = {};
  const countOf: Record<string, number> = {};
  const rpmOf: Record<string, number | null | undefined> = {};
  const sourceOf: Record<string, string | undefined> = {};
  stations.forEach((s) => {
    stateOf[s.station_id] = s.state; countOf[s.station_id] = s.part_count;
    rpmOf[s.station_id] = s.spindle_rpm; sourceOf[s.station_id] = s.source;
  });
  const typeOf: Record<string, string> = {};
  const nameOf: Record<string, string> = {};
  const modelOf: Record<string, string | undefined> = {};
  const levelOf: Record<string, number> = {};
  layout.stations.forEach((a) => { typeOf[a.id] = a.type; nameOf[a.id] = a.name; modelOf[a.id] = a.model; levelOf[a.id] = a.level ?? 0; });

  // Stage the product leaving each station. For a car line the stage follows the
  // station's POSITION in the flow (blank → stamped panels → body-in-white →
  // painted body → assembled car), since the same machine type (a robot) means
  // different things in the body shop vs final assembly. Other lines map by type.
  const order: string[] = [];
  layout.flow.forEach(([f, t]) => { if (!order.includes(f)) order.push(f); if (!order.includes(t)) order.push(t); });
  const orderIdx: Record<string, number> = {};
  order.forEach((id, i) => { orderIdx[id] = i; });
  const maxIdx = Math.max(1, order.length - 1);
  const stageFor = (from: string): string => {
    if (product === "car") {
      const f = (orderIdx[from] ?? 0) / maxIdx;
      if (f < 0.12) return "raw";       // steel blank / coil
      if (f < 0.22) return "stamped";   // stamped body panels
      if (f < 0.50) return "welded";    // body-in-white shell
      if (f < 0.74) return "painted";   // painted body
      return "assembled";               // final assembly → finished car
    }
    if (product === "engine") {
      // each station adds its part — map flow position to the build stage it LEAVES
      const seq = ["components", "block", "crank", "pistons", "head", "timing", "turbo", "final", "final", "final", "final"];
      return seq[Math.min(orderIdx[from] ?? 0, seq.length - 1)];
    }
    return stageOf(typeOf[from]);
  };

  // positions from the layout config (fallback: evenly spaced line)
  const n = layout.stations.length || stations.length || 1;
  const pos: Record<string, XZ> = {};
  layout.stations.forEach((a, i) => {
    pos[a.id] = [a.x ?? (i - (n - 1) / 2) * 6, a.z ?? 0];
  });
  stations.forEach((s, i) => { if (!pos[s.station_id]) pos[s.station_id] = [(i - (n - 1) / 2) * 6, 0]; });

  // bounds → ground / aisle / crane framing
  const xs = Object.values(pos).map((p) => p[0]);
  const zs = Object.values(pos).map((p) => p[1]);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minZ = Math.min(...zs), maxZ = Math.max(...zs);
  // the warehouse floor is far bigger than its station markers — size the ground,
  // roof trusses, high-bay lights and perimeter columns to the whole building so
  // the new storage hall gets a real floor + ceiling instead of floating on the bg.
  if (product === "warehouse") { minX = -90; maxX = 16; minZ = -34; maxZ = 26; }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const gw = (maxX - minX) + 12, gd = (maxZ - minZ) + 12;
  // central-corridor rectangle for the AGV loop (between the two bays)
  const midZ = (minZ + maxZ) / 2;
  const agvLoop: XZ[] = [
    [minX - 1.5, midZ - 1.6],
    [maxX + 1.5, midZ - 1.6],
    [maxX + 1.5, midZ + 1.6],
    [minX - 1.5, midZ + 1.6],
  ];

  const speed = Math.max(0.12, Math.min(0.6, flowRate / 130));

  return (
    <>
      <color attach="background" args={["#ccd0d6"]} />
      <fog attach="fog" args={["#ccd0d6", gw * 1.1, gw * 2.8]} />

      {/* image-based lighting — a soft studio environment so metal reads as metal
          and reflects. Built from Lightformers (no external HDR fetch). */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.6} position={[cx, 9, cz]} rotation={[Math.PI / 2, 0, 0]} scale={[gw, gd, 1]} color="#d4e2ff" />
        <Lightformer form="rect" intensity={1.3} position={[cx, 4, cz - gd]} scale={[gw, 6, 1]} color="#9ec1ff" />
        <Lightformer form="rect" intensity={1.0} position={[cx, 4, cz + gd]} rotation={[0, Math.PI, 0]} scale={[gw, 6, 1]} color="#ffcf9a" />
        <Lightformer form="rect" intensity={0.9} position={[cx - gw, 4, cz]} rotation={[0, Math.PI / 2, 0]} scale={[gd, 6, 1]} color="#8fd4ff" />
      </Environment>

      <ambientLight intensity={0.55} color="#eef1f5" />
      <directionalLight position={[cx + 14, 22, cz + 16]} intensity={1.9} color="#ffffff" castShadow
        shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-bias={-0.0005}
        shadow-camera-left={-gw / 2} shadow-camera-right={gw / 2}
        shadow-camera-top={gd / 2} shadow-camera-bottom={-gd / 2} shadow-camera-far={70} />
      <directionalLight position={[cx - 14, 11, cz - 12]} intensity={0.75} color="#cbd0d7" />

      {/* polished factory floor — glossy PBR that softly reflects the environment
          (no full mirror re-render, so it stays fast on big scenes) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[gw, gd]} />
        <meshStandardMaterial color={product === "warehouse" ? "#35594a" : "#a7acb3"} metalness={product === "warehouse" ? 0.12 : 0.05} roughness={product === "warehouse" ? 0.5 : 0.9} envMapIntensity={product === "warehouse" ? 0.9 : 0.5} />
      </mesh>
      <gridHelper args={[Math.max(gw, gd), Math.round(Math.max(gw, gd) / 2), "#8b919b", "#b7bcc3"]}
        position={[cx, 0.015, cz]} />

      {/* overhead: high-bay LED fixtures, roof trusses, structural steel columns */}
      {(() => {
        const cols = product === "warehouse" ? 9 : 4, rows = product === "warehouse" ? 4 : 2;
        return Array.from({ length: cols * rows }).map((_, i) => {
          const c = i % cols, r = Math.floor(i / cols);
          const x = (minX - 2) + ((c + 0.5) / cols) * ((maxX + 2) - (minX - 2));
          const z = (minZ - 2) + ((r + 0.5) / rows) * ((maxZ + 2) - (minZ - 2));
          return <HighBay key={`hb${i}`} x={x} z={z} y={6.9} />;
        });
      })()}
      <RoofTrusses x0={minX - 4} x1={maxX + 4} z0={minZ - 4} z1={maxZ + 4} y={7.5} />
      {Array.from({ length: 8 }).map((_, i) => {
        const z = i < 4 ? minZ - 4 : maxZ + 4;
        const x = (minX - 3) + ((i % 4) / 3) * ((maxX + 3) - (minX - 3));
        return <Column key={`col${i}`} x={x} z={z} h={7.4} />;
      })}

      {layout.zones.map((z) => <Zone key={z.id} {...z} />)}
      {product !== "warehouse" && <Racks x0={minX} x1={maxX} z={minZ - 3.2} />}
      {product !== "warehouse" && <GantryCrane x0={minX - 1} x1={maxX + 1} z0={minZ - 1.5} z1={maxZ + 1.5} />}
      {product === "warehouse" && <WarehouseBuild whFloor={whFloor} />}
      {product === "warehouse" && <WarehouseActivity whFloor={whFloor} />}
      {/* NPCC warehouse storage extension (R&R, D22 Primary, D22 Reserve, PMSP) */}
      {product === "warehouse" && <WarehouseExtension whFloor={whFloor} />}

      {/* overhead power-and-free carrier line — engines hang and index station to
          station (no ground conveyor). Built from the flow order + per-station stage. */}
      {product === "engine" && (() => {
        const seq = order.filter((id) => pos[id]);
        return seq.length ? <EngineCarrierLine nodes={seq.map((id) => pos[id])} stages={seq.map((id) => stageFor(id))} /> : null;
      })()}
      {/* live cross-line data link: S58 engine EOL output feeding the X5 marriage */}
      {product === "car" && engineSupply && (() => {
        const m = layout.stations.find((a) => /marriage/i.test(a.name || ""));
        const p = m && pos[m.id];
        return p ? <PowertrainSupply pos={p} uph={engineSupply.units_per_hr || 0} /> : null;
      })()}

      {/* floor dressing: staged pallets near shipping + safety bollards down the aisle */}
      {product !== "warehouse" && (<>
        {[0, 1, 2, 3].map((i) => (
          <Pallet key={`pal${i}`} x={minX - 2.4} z={maxZ + 2.5 - i * 1.15} r={(i % 2) * 0.2} />
        ))}
        {[0, 1, 2, 3, 4].map((i) => {
          const x = minX + (i / 4) * (maxX - minX);
          return <Bollard key={`bol${i}`} x={x} z={midZ + 2.1} />;
        })}
        {/* AGV material handling */}
        <AisleLines loop={agvLoop} />
        <AGVFleet loop={agvLoop} count={3} speed={3.2} color="#c8b24a" />
      </>)}

      {/* lineside logistics: colored parts totes on dollies staged along the aisle */}
      {product === "car" && [0, 1, 2, 3, 4, 5].map((i) => {
        const x = minX + ((i + 0.5) / 6) * (maxX - minX);
        return <LogisticsTote key={`tote${i}`} x={x} z={midZ + (i % 2 ? 1.9 : -1.9)} color={i % 2 ? "#b0338a" : "#2f9e8f"} />;
      })}

      {/* flow: ground conveyor + animated parts + buffer WIP per edge. The engine
          line has NO ground conveyor — engines ride the overhead carrier instead. */}
      {product !== "engine" && product !== "warehouse" && layout.flow.map(([from, to], i) => {
        const a = pos[from], b = pos[to];
        if (!a || !b) return null;
        const downAccepts = ACCEPTS.has(stateOf[to]);
        const srcProducing = stateOf[from] === "running" || stateOf[from] === "blocked";
        const wip = Math.max(0, (countOf[from] ?? 0) - (countOf[to] ?? 0));
        return (
          <group key={i}>
            <Conveyor a={a} b={b} />
            <FlowParticles a={a} b={b} flowing={srcProducing && downAccepts} speed={speed} stage={stageFor(from)} product={product} />
            <Buffer a={a} b={b} wip={wip} />
          </group>
        );
      })}

      {/* Stations. On the car line each is a full PROCESS CELL (automation acting
          on the body); every other line renders the per-type procedural machine. */}
      {stations.map((s) => {
        const p = pos[s.station_id] || [0, 0];
        const st = s.state as MachineState;
        const color = STATE_COLOR[st] || "#6b7482";
        const bott = !!bottleneck && bottleneck.split(",").includes(s.station_id);
        if (product === "car") {
          return (
            <CarAutoCell key={s.station_id} pos={p} state={st} color={color}
              id={s.station_id} name={nameOf[s.station_id]} type={typeOf[s.station_id]}
              oee={kpi[s.station_id]?.oee} stage={stageFor(s.station_id)}
              selected={selected === s.station_id} bottleneck={bott}
              onClick={() => onSelect(s.station_id)} />
          );
        }
        if (product === "engine") {
          return (
            <EngineAutoCell key={s.station_id} pos={p} state={st} color={color}
              id={s.station_id} name={nameOf[s.station_id]} type={typeOf[s.station_id]}
              oee={kpi[s.station_id]?.oee}
              selected={selected === s.station_id} bottleneck={bott}
              onClick={() => onSelect(s.station_id)} />
          );
        }
        if (product === "warehouse") {
          return (
            <WarehouseZone key={s.station_id} pos={p} level={levelOf[s.station_id] ?? 0} state={st} color={color}
              id={s.station_id} name={nameOf[s.station_id]} oee={kpi[s.station_id]?.oee}
              selected={selected === s.station_id} bottleneck={bott}
              onClick={() => onSelect(s.station_id)} />
          );
        }
        return (
          <Machine key={s.station_id} pos={p} color={color}
            id={s.station_id} name={nameOf[s.station_id]} type={typeOf[s.station_id]}
            state={st} oee={kpi[s.station_id]?.oee}
            rpm={rpmOf[s.station_id]} source={sourceOf[s.station_id]} model={modelOf[s.station_id]}
            selected={selected === s.station_id} bottleneck={bott}
            onClick={() => onSelect(s.station_id)} />
        );
      })}

      {product !== "warehouse" && (
        <ContactShadows frames={1} position={[cx, 0.03, cz]} opacity={0.35} scale={Math.max(gw, gd)} blur={2.0} far={6} />
      )}
      <OrbitControls makeDefault enablePan minDistance={8} maxDistance={90}
        maxPolarAngle={Math.PI / 2.1} target={[cx, 0.6, cz]} />
    </>
  );
}

/** Reframes the camera + orbit target when the selected line changes, WITHOUT
 *  remounting the Canvas. Remounting (the old `key={line_id}` approach) span up a
 *  fresh WebGL context on every switch and quickly exhausted Chrome's context
 *  limit → "Context Lost" → black floor. Keeping one Canvas and moving the camera
 *  imperatively (R3F's `camera` prop is initial-only) fixes that for good. */
function CameraRig({ position, cx, cz, ty = 0.6 }: { position: [number, number, number]; cx: number; cz: number; ty?: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as any;
  const key = `${position.join(",")}|${cx}|${cz}|${ty}`;
  useEffect(() => {
    camera.position.set(position[0], position[1], position[2]);
    camera.updateProjectionMatrix();
    if (controls && controls.target) {
      controls.target.set(cx, ty, cz);
      controls.update();
    } else {
      camera.lookAt(cx, ty, cz);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

export function Floor3D({ stations, selected, onSelect, bottleneck, kpi = {}, layout, flowRate = 0, product, engineSupply }: {
  stations: StationLive[]; selected: string | null; onSelect: (s: string) => void;
  bottleneck?: string | null; kpi?: Record<string, StationKpi>; layout: Layout; flowRate?: number;
  product?: string | null;
  engineSupply?: { units_per_hr: number } | null;
}) {
  // frame the camera to the layout extent — a 3/4 elevated view that fits the
  // whole plant (both lines) without shrinking it. Balances span in X and Z so a
  // deeper multi-line plant doesn't push the camera absurdly far back.
  const cam = useMemo(() => {
    const xs = layout.stations.map((a) => a.x ?? 0);
    const zs = layout.stations.map((a) => a.z ?? 0);
    if (!xs.length) return { position: [0, 12, 20] as [number, number, number], cx: 0, cz: 0, ty: 0.6 };
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    // Frame from the whole footprint, not just depth — a wide/shallow line (a car
    // plant) and a deep line (a machined line) both need to fit. Distance scales
    // with the larger span; camera sits back from the front edge and looks down.
    const isWh = product === "warehouse";
    const footprint = Math.max(maxX - minX, maxZ - minZ, 14);
    if (isWh) {
      // The NPCC warehouse spans:
      //   X: -90 (D22 Reserve left wall) to +16 (mezzanine right edge)
      //   Z: -34 (back wall) to +26 (truck dock front)
      // Elevated 3/4 overview looking toward the docks across the whole facility.
      const minX = -90, maxX = 16, minZ = -34, maxZ = 26;
      const wcx = (minX + maxX) / 2;
      const fp = Math.max(maxX - minX, maxZ - minZ, 20);
      const czT = -4;
      const d = fp * 0.44 + 12;
      return { position: [wcx + d * 0.34, d * 0.55, czT + d * 0.62] as [number, number, number], cx: wcx, cz: czT, ty: 1.8 };
    }
    const dist = footprint * 0.8 + 8;
    // 3/4 corner overview — close enough that the hero workpieces (car bodies) read
    // immediately on load, high/angled enough to keep the sightline off the glossy
    // floor and overhead lights and to show the whole line at a glance.
    return { position: [cx + dist * 0.6, dist * 0.9, cz + dist * 0.55] as [number, number, number], cx, cz, ty: 0.6 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, product]);

  const [whFloor, setWhFloor] = useState<"both" | "ground" | "mezz">("both");

  return (
    <div style={{ height: 520, position: "relative", borderRadius: 10, overflow: "hidden", background: "#070b11" }}>
      {product === "warehouse" && stations.length > 0 && (
        <div style={{ position: "absolute", top: 10, left: 10, zIndex: 5, display: "flex", gap: 4, background: "rgba(12,16,22,.72)", border: "1px solid #2a323f", borderRadius: 8, padding: 4, backdropFilter: "blur(6px)" }}>
          {([["both", "Both"], ["ground", "Ground · Large"], ["mezz", "Mezz · Small"]] as const).map(([f, lbl]) => (
            <button key={f} onClick={() => setWhFloor(f)} style={{
              font: "600 11px/1 ui-monospace,monospace", letterSpacing: ".04em", textTransform: "uppercase",
              padding: "6px 10px", borderRadius: 6, cursor: "pointer", border: "none",
              background: whFloor === f ? "#2ad0ff" : "transparent", color: whFloor === f ? "#04212c" : "#9aa5b4",
            }}>{lbl}</button>
          ))}
        </div>
      )}
      {!stations.length ? (
        <div className="dim" style={{ padding: 20 }}>waiting for live telemetry…</div>
      ) : (
        <Canvas shadows flat dpr={[1, 1.25]}
          gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
          camera={{ position: cam.position, fov: 44 }} onPointerMissed={() => { }}>
          <CameraRig position={cam.position} cx={cam.cx} cz={cam.cz} ty={(cam as any).ty ?? 0.6} />
          <Scene stations={stations} selected={selected} onSelect={onSelect} bottleneck={bottleneck}
            kpi={kpi} layout={layout} flowRate={flowRate} product={product} engineSupply={engineSupply} whFloor={whFloor} />
          {/* cinematic pass: selective bloom on emissives, ACES grade, vignette */}
          <EffectComposer multisampling={0}>
            <Bloom mipmapBlur luminanceThreshold={1.1} luminanceSmoothing={0.2} intensity={0.55} radius={0.7} />
            <Vignette offset={0.22} darkness={0.55} eskil={false} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            <SMAA />
          </EffectComposer>
        </Canvas>
      )}
    </div>
  );
}
