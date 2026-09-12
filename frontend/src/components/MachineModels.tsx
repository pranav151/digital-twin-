import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";

/* Procedural machine geometry per station type. Bodies stay neutral metal — the
   live STATE colour lives on the status band/beacon in Floor3D (ISA-101: colour =
   state only). Shape conveys the machine; motion conveys "running". */

// Grey-clay studio palette (NVIDIA/Omniverse look): neutral grey machine bodies,
// selective colour reserved for robots (orange), car bodies, safety and logistics.
const BODY = "#7e848d";
const BODY2 = "#929aa3";
const METAL = "#6b727b";
const STEEL = "#aab0b8";
const DARK = "#4c5158";
const ROBOT_Y = "#d9691e"; // industrial-robot orange (KUKA), pops against the grey

function Base({ w = 1.6, d = 1.6 }: { w?: number; d?: number }) {
  return (
    <mesh position={[0, 0.06, 0]} receiveShadow>
      <boxGeometry args={[w, 0.12, d]} />
      <meshStandardMaterial color={DARK} metalness={0.3} roughness={0.7} />
    </mesh>
  );
}

/** A wall-mounted HMI touchscreen (glows so the bloom pass makes it read as "on"). */
function HMIPanel({ position, rotation, w = 0.4, h = 0.28 }: {
  position: [number, number, number]; rotation?: [number, number, number]; w?: number; h?: number;
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[w + 0.06, h + 0.06, 0.05]} />
        <meshStandardMaterial color="#0e1622" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.032]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#18c6ff" emissive="#25ccff" emissiveIntensity={1.05} toneMapped={false} />
      </mesh>
    </group>
  );
}

// Map a real spindle RPM to a visible (and sane) angular velocity in rad/s.
// Falls back to a fixed rate when no real telemetry is present.
function spinRate(rpm: number | null | undefined, fallback: number): number {
  if (rpm == null) return fallback;
  return Math.max(0, Math.min(45, rpm / 300));
}

/** CNC mill: enclosure + viewing window + top gantry with a spinning spindle. */
function Mill({ running, fiveAxis, rpm }: { running: boolean; fiveAxis?: boolean; rpm?: number | null }) {
  const spindle = useRef<THREE.Mesh>(null);
  const table = useRef<THREE.Mesh>(null);
  useFrame((st, dt) => {
    const rate = spinRate(rpm, 10);
    if (running && spindle.current) spindle.current.rotation.y += dt * rate;
    if (running && table.current) table.current.position.x = Math.sin(st.clock.elapsedTime * 1.3) * 0.18;
  });
  return (
    <group>
      <Base />
      <RoundedBox args={[1.42, 1.0, 1.42]} radius={0.06} smoothness={4} position={[0, 0.62, 0]} castShadow>
        <meshStandardMaterial color={BODY} metalness={0.72} roughness={0.34} />
      </RoundedBox>
      {/* viewing window — backlit interior glow when running */}
      <mesh position={[0, 0.66, 0.72]}>
        <boxGeometry args={[1.0, 0.6, 0.03]} />
        <meshStandardMaterial color="#0a2233" metalness={0.1} roughness={0.2}
          emissive={running ? "#1e9fd6" : "#0a1a2a"} emissiveIntensity={running ? 0.9 : 0.3} />
      </mesh>
      <HMIPanel position={[0.66, 0.85, 0.5]} rotation={[0, -0.5, 0]} w={0.26} h={0.2} />
      {/* work table */}
      <mesh ref={table} position={[0, 1.14, 0]} castShadow>
        <boxGeometry args={[0.6, 0.06, 0.6]} />
        <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.3} />
      </mesh>
      {/* gantry */}
      <mesh position={[0, 1.3, 0]} castShadow>
        <boxGeometry args={[1.5, 0.16, 0.35]} />
        <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh ref={spindle} position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.06, 0.4, 12]} />
        <meshStandardMaterial color={STEEL} metalness={0.8} roughness={0.25} />
      </mesh>
      {fiveAxis && (
        <mesh position={[0.72, 0.9, 0]} castShadow>
          <boxGeometry args={[0.12, 0.5, 0.5]} />
          <meshStandardMaterial color={ROBOT_Y} metalness={0.72} roughness={0.34} />
        </mesh>
      )}
      {/* rear electrical cabinet — the tall control enclosure on real CNCs */}
      <mesh position={[0, 0.78, -0.72]} castShadow>
        <boxGeometry args={[1.15, 1.25, 0.2]} />
        <meshStandardMaterial color={BODY2} metalness={0.62} roughness={0.4} />
      </mesh>
      {/* sloped sheet-metal canopy over the enclosure */}
      <mesh position={[0, 1.16, -0.02]} rotation={[-0.18, 0, 0]} castShadow>
        <boxGeometry args={[1.46, 0.05, 1.5]} />
        <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.45} />
      </mesh>
      {/* red E-stop mushroom on the front fascia */}
      <mesh position={[-0.5, 0.48, 0.74]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.05, 12]} />
        <meshStandardMaterial color="#d62828" metalness={0.2} roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Articulated 6-axis arm: yawing base, shoulder, upper arm, forearm, wrist + gripper.
    `accent` tints the arm (welder = ochre); `weld` adds a torch tip. */
export function Arm({ running, accent = ROBOT_Y, weld = false, torchRef, phase = 0 }: {
  running: boolean; accent?: string; weld?: boolean; torchRef?: RefObject<THREE.Object3D>; phase?: number;
}) {
  const yaw = useRef<THREE.Group>(null);
  const upper = useRef<THREE.Group>(null);
  const fore = useRef<THREE.Group>(null);
  const wrist = useRef<THREE.Group>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime + phase;
    const k = running ? 1 : 0;
    if (yaw.current) yaw.current.rotation.y = Math.sin(t * 0.6) * 0.7 * k;
    if (upper.current) upper.current.rotation.z = -0.5 + Math.sin(t * 1.5) * 0.32 * k;
    if (fore.current) fore.current.rotation.z = 0.95 + Math.cos(t * 1.5) * 0.4 * k;
    if (wrist.current) wrist.current.rotation.z = Math.sin(t * 2.1) * 0.5 * k;
  });
  const arm = accent, joint = "#4a5568";
  return (
    <group ref={yaw} position={[0, 0.2, 0]}>
      {/* pedestal */}
      <mesh position={[0, 0.12, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.4, 0.28, 20]} />
        <meshStandardMaterial color={BODY2} metalness={0.55} roughness={0.4} />
      </mesh>
      <group ref={upper} position={[0, 0.28, 0]}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[0.22, 0.8, 0.26]} />
          <meshStandardMaterial color={arm} metalness={0.45} roughness={0.5} />
        </mesh>
        <group ref={fore} position={[0, 0.8, 0]}>
          <mesh position={[0, 0.34, 0]} castShadow>
            <boxGeometry args={[0.17, 0.68, 0.2]} />
            <meshStandardMaterial color={arm} metalness={0.45} roughness={0.5} />
          </mesh>
          <group ref={wrist} position={[0, 0.68, 0]}>
            <mesh position={[0, 0.08, 0]} castShadow>
              <cylinderGeometry args={[0.1, 0.1, 0.16, 12]} />
              <meshStandardMaterial color={joint} metalness={0.6} roughness={0.35} />
            </mesh>
            {weld ? (
              <group position={[0, 0.2, 0]}>
                <mesh castShadow>
                  <coneGeometry args={[0.05, 0.24, 10]} />
                  <meshStandardMaterial color={STEEL} metalness={0.8} roughness={0.25} />
                </mesh>
                <object3D ref={torchRef as any} position={[0, -0.14, 0]} />
              </group>
            ) : (
              // two-finger gripper
              <group position={[0, 0.18, 0]}>
                {[-0.07, 0.07].map((x, i) => (
                  <mesh key={i} position={[x, 0, 0]} castShadow>
                    <boxGeometry args={[0.04, 0.16, 0.1]} />
                    <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.3} />
                  </mesh>
                ))}
              </group>
            )}
          </group>
        </group>
      </group>
    </group>
  );
}

/** Robot cell: 6-axis arm + its controller cabinet and a workpiece on a fixture. */
function RobotCell({ running }: { running: boolean }) {
  return (
    <group>
      <Base />
      {/* robot controller cabinet (every real cell has one) with a status LED */}
      <group position={[0.62, 0, 0.5]}>
        <RoundedBox args={[0.42, 0.86, 0.44]} radius={0.03} smoothness={3} position={[0, 0.55, 0]} castShadow>
          <meshStandardMaterial color={BODY2} metalness={0.66} roughness={0.38} />
        </RoundedBox>
        <mesh position={[0, 0.72, 0.23]}>
          <planeGeometry args={[0.26, 0.16]} />
          <meshStandardMaterial color="#18c6ff" emissive="#25ccff" emissiveIntensity={1.0} toneMapped={false} />
        </mesh>
      </group>
      {/* workpiece fixture the arm services */}
      <mesh position={[-0.5, 0.42, 0.2]} castShadow>
        <boxGeometry args={[0.34, 0.5, 0.34]} />
        <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[-0.5, 0.72, 0.2]} castShadow>
        <boxGeometry args={[0.24, 0.14, 0.24]} />
        <meshStandardMaterial color={STEEL} metalness={0.75} roughness={0.28} />
      </mesh>
      <Arm running={running} />
    </group>
  );
}

/** Welding robot: ochre arm with a torch that throws sparks when running. */
function Welder({ running }: { running: boolean }) {
  const torch = useRef<THREE.Object3D>(null);
  const sparks = useRef<THREE.Points>(null);
  const N = 40;
  const { geom, vel } = useMemo(() => {
    const positions = new Float32Array(N * 3);
    const velocities: number[] = [];
    for (let i = 0; i < N; i++) {
      velocities.push((Math.random() - 0.5) * 2, Math.random() * 2 + 1, (Math.random() - 0.5) * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return { geom: g, vel: velocities };
  }, []);
  const life = useRef<number[]>(Array.from({ length: N }, () => Math.random()));
  const origin = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    if (!sparks.current) return;
    sparks.current.visible = running;
    if (!running) return;
    torch.current?.getWorldPosition(origin);
    const local = sparks.current.parent ? sparks.current.parent.worldToLocal(origin.clone()) : origin;
    const pos = geom.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < N; i++) {
      life.current[i] -= dt * 2.2;
      if (life.current[i] <= 0) {
        life.current[i] = 1;
        pos.setXYZ(i, local.x, local.y, local.z);
      } else {
        pos.setXYZ(i,
          pos.getX(i) + vel[i * 3] * dt,
          pos.getY(i) + (vel[i * 3 + 1] - 3) * dt * life.current[i],
          pos.getZ(i) + vel[i * 3 + 2] * dt);
      }
    }
    pos.needsUpdate = true;
  });
  return (
    <group>
      <Base />
      <Arm running={running} accent={ROBOT_Y} weld torchRef={torch} />
      <points ref={sparks} geometry={geom}>
        <pointsMaterial color="#ffd27a" size={0.07} sizeAttenuation transparent opacity={0.95} />
      </points>
      {running && <pointLight position={[0.2, 0.9, 0.2]} distance={2.2} intensity={2.2} color="#ffca66" />}
    </group>
  );
}

/** Servo press: frame + a ram that stamps up/down when running. */
function Press({ running }: { running: boolean }) {
  const ram = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    if (ram.current) {
      const t = st.clock.elapsedTime * 3;
      ram.current.position.y = running ? 0.95 + Math.abs(Math.sin(t)) * -0.3 + 0.15 : 1.0;
    }
  });
  return (
    <group>
      <Base />
      {/* C-frame columns */}
      {[-0.5, 0.5].map((x, i) => (
        <mesh key={i} position={[x, 0.85, -0.3]} castShadow>
          <boxGeometry args={[0.2, 1.5, 0.2]} />
          <meshStandardMaterial color={BODY} metalness={0.72} roughness={0.34} />
        </mesh>
      ))}
      <mesh position={[0, 1.6, -0.3]} castShadow>
        <boxGeometry args={[1.3, 0.28, 0.4]} />
        <meshStandardMaterial color={BODY2} metalness={0.72} roughness={0.34} />
      </mesh>
      {/* ram */}
      <mesh ref={ram} position={[0, 1.0, 0]} castShadow>
        <boxGeometry args={[0.7, 0.4, 0.5]} />
        <meshStandardMaterial color={METAL} metalness={0.6} roughness={0.35} />
      </mesh>
      {/* bolster */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <boxGeometry args={[0.9, 0.2, 0.6]} />
        <meshStandardMaterial color={STEEL} metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** Turning lathe: bed + headstock with a spinning chuck + tailstock. */
function Lathe({ running, rpm }: { running: boolean; rpm?: number | null }) {
  const chuck = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => { if (running && chuck.current) chuck.current.rotation.x += dt * spinRate(rpm, 14); });
  return (
    <group>
      <Base />
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[1.5, 0.5, 0.9]} />
        <meshStandardMaterial color={BODY} metalness={0.72} roughness={0.34} />
      </mesh>
      {/* headstock */}
      <mesh position={[-0.55, 1.0, 0]} castShadow>
        <boxGeometry args={[0.4, 0.5, 0.6]} />
        <meshStandardMaterial color={BODY2} metalness={0.72} roughness={0.34} />
      </mesh>
      <mesh ref={chuck} position={[-0.25, 1.0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 0.12, 16]} />
        <meshStandardMaterial color={STEEL} metalness={0.8} roughness={0.25} />
      </mesh>
      {/* workpiece */}
      <mesh position={[0.15, 1.0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 0.7, 12]} />
        <meshStandardMaterial color="#8492a6" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* tailstock */}
      <mesh position={[0.62, 1.0, 0]} castShadow>
        <boxGeometry args={[0.3, 0.35, 0.4]} />
        <meshStandardMaterial color={BODY2} metalness={0.72} roughness={0.34} />
      </mesh>
    </group>
  );
}

/** Deburr & wash: tunnel enclosure with roller infeed; misty when running. */
function Wash({ running }: { running: boolean }) {
  const mist = useRef<THREE.Mesh>(null);
  useFrame((st) => { if (mist.current) { mist.current.visible = running;
    (mist.current.material as THREE.MeshStandardMaterial).opacity = 0.18 + Math.abs(Math.sin(st.clock.elapsedTime * 2)) * 0.14; } });
  return (
    <group>
      <Base />
      <mesh position={[0, 0.7, 0]} castShadow>
        <boxGeometry args={[1.4, 0.9, 1.0]} />
        <meshStandardMaterial color={BODY} metalness={0.3} roughness={0.6} />
      </mesh>
      {/* tunnel opening */}
      <mesh position={[0, 0.7, 0.52]}>
        <boxGeometry args={[0.9, 0.6, 0.05]} />
        <meshStandardMaterial color={DARK} metalness={0.2} roughness={0.4} emissive="#0a2230" emissiveIntensity={0.3} />
      </mesh>
      {[-0.35, -0.1, 0.15, 0.4].map((z, i) => (
        <mesh key={i} position={[0, 1.18, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 1.1, 8]} />
          <meshStandardMaterial color={METAL} metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      <mesh ref={mist} position={[0, 0.9, 0.6]}>
        <sphereGeometry args={[0.4, 12, 12]} />
        <meshStandardMaterial color="#cfe6f2" transparent opacity={0.22} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** CMM inspection: granite table + a gantry that traverses with a scanning laser. */
function Inspection({ running }: { running: boolean }) {
  const bridge = useRef<THREE.Group>(null);
  useFrame((st) => { if (running && bridge.current) bridge.current.position.z = Math.sin(st.clock.elapsedTime * 1.1) * 0.4; });
  return (
    <group>
      <Base />
      {/* granite table */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1.4, 0.4, 1.2]} />
        <meshStandardMaterial color="#20262e" metalness={0.2} roughness={0.6} />
      </mesh>
      <group ref={bridge}>
        <mesh position={[0, 1.1, 0]} castShadow>
          <boxGeometry args={[1.4, 0.12, 0.12]} />
          <meshStandardMaterial color={STEEL} metalness={0.6} roughness={0.4} />
        </mesh>
        {[-0.64, 0.64].map((x, i) => (
          <mesh key={i} position={[x, 0.85, 0]} castShadow>
            <boxGeometry args={[0.1, 0.6, 0.1]} />
            <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        {/* probe + scanning laser */}
        <mesh position={[0, 0.95, 0]}>
          <boxGeometry args={[0.08, 0.2, 0.08]} />
          <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.3} />
        </mesh>
        {running && (
          <mesh position={[0, 0.72, 0]}>
            <cylinderGeometry args={[0.006, 0.05, 0.4, 8]} />
            <meshBasicMaterial color="#ff5d5d" transparent opacity={0.6} />
          </mesh>
        )}
      </group>
    </group>
  );
}

/** Paint booth: glass enclosure with a nozzle; coloured mist when running. */
function PaintBooth({ running }: { running: boolean }) {
  const mist = useRef<THREE.Mesh>(null);
  useFrame((st) => { if (mist.current) { mist.current.visible = running;
    mist.current.scale.setScalar(0.6 + Math.abs(Math.sin(st.clock.elapsedTime * 3)) * 0.5); } });
  return (
    <group>
      <Base />
      <mesh position={[0, 0.85, 0]}>
        <boxGeometry args={[1.5, 1.5, 1.4]} />
        <meshStandardMaterial color="#3a5566" metalness={0.1} roughness={0.15} transparent opacity={0.22} />
      </mesh>
      <lineSegments position={[0, 0.85, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(1.5, 1.5, 1.4)]} />
        <lineBasicMaterial color="#4a6b80" />
      </lineSegments>
      {/* spray nozzle on a small gantry */}
      <mesh position={[0, 1.45, 0]} castShadow>
        <boxGeometry args={[0.6, 0.1, 0.1]} />
        <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.2, 0]}>
        <coneGeometry args={[0.06, 0.16, 10]} />
        <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh ref={mist} position={[0, 0.85, 0]}>
        <sphereGeometry args={[0.45, 12, 12]} />
        <meshStandardMaterial color="#5aa9ff" transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Curing oven: insulated box with a slotted opening that glows when running. */
function Oven({ running }: { running: boolean }) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((st) => { if (glow.current) glow.current.emissiveIntensity = running ? 0.9 + Math.sin(st.clock.elapsedTime * 4) * 0.25 : 0.05; });
  return (
    <group>
      <Base />
      <mesh position={[0, 0.8, 0]} castShadow>
        <boxGeometry args={[1.5, 1.3, 1.3]} />
        <meshStandardMaterial color={BODY} metalness={0.3} roughness={0.7} />
      </mesh>
      {/* glowing slot */}
      <mesh position={[0, 0.7, 0.66]}>
        <boxGeometry args={[1.1, 0.4, 0.04]} />
        <meshStandardMaterial ref={glow} color="#ff7a2f" emissive="#ff5a1a" emissiveIntensity={0.9} />
      </mesh>
      {running && <pointLight position={[0, 0.7, 0.9]} distance={2.4} intensity={1.6} color="#ff7a3a" />}
      {/* stack */}
      <mesh position={[0.55, 1.7, -0.4]} castShadow>
        <cylinderGeometry args={[0.12, 0.12, 0.6, 12]} />
        <meshStandardMaterial color={METAL} metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Case packer: body + slanted output chute with stacked cartons. */
function Packer() {
  return (
    <group>
      <Base />
      <RoundedBox args={[1.42, 0.95, 1.32]} radius={0.05} smoothness={4} position={[0, 0.6, 0]} castShadow>
        <meshStandardMaterial color={BODY} metalness={0.72} roughness={0.34} />
      </RoundedBox>
      <HMIPanel position={[-0.5, 0.82, 0.66]} w={0.24} h={0.18} />
      <mesh position={[0, 0.55, 0.75]} rotation={[0.25, 0, 0]} castShadow>
        <boxGeometry args={[1.0, 0.06, 0.7]} />
        <meshStandardMaterial color={METAL} metalness={0.72} roughness={0.34} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-0.3 + i * 0.3, 0.42, 0.95]} castShadow>
          <boxGeometry args={[0.24, 0.22, 0.24]} />
          <meshStandardMaterial color="#b8905a" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** Palletizer: arm stacking cartons onto a pallet of finished goods. */
function Palletizer({ running }: { running: boolean }) {
  return (
    <group>
      <Base />
      <Arm running={running} accent={BODY2} />
      {/* pallet with a stack of cartons */}
      <group position={[0.6, 0, 0.55]}>
        <mesh position={[0, 0.12, 0]} castShadow>
          <boxGeometry args={[0.7, 0.1, 0.7]} />
          <meshStandardMaterial color="#6b4f2a" roughness={0.9} />
        </mesh>
        {[[0, 0], [0.28, 0], [0, 0.28], [0.28, 0.28]].map(([dx, dz], i) => (
          <mesh key={i} position={[-0.14 + dx, 0.32, -0.14 + dz]} castShadow>
            <boxGeometry args={[0.26, 0.26, 0.26]} />
            <meshStandardMaterial color="#b8905a" roughness={0.85} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Load / intake station: infeed table with rollers + a small pick post. */
function Loader() {
  return (
    <group>
      <Base />
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1.3, 0.7, 1.1]} />
        <meshStandardMaterial color={BODY} metalness={0.7} roughness={0.36} />
      </mesh>
      {[-0.4, -0.13, 0.14, 0.41].map((z, i) => (
        <mesh key={i} position={[0, 0.9, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.06, 0.06, 1.1, 10]} />
          <meshStandardMaterial color={METAL} metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      <mesh position={[0.55, 1.0, 0]} castShadow>
        <boxGeometry args={[0.12, 1.0, 0.12]} />
        <meshStandardMaterial color={BODY2} metalness={0.5} roughness={0.4} />
      </mesh>
      {/* stack of raw blanks */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-0.35, 0.9 + i * 0.12, 0]} castShadow>
          <boxGeometry args={[0.4, 0.1, 0.5]} />
          <meshStandardMaterial color="#7d8794" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function Generic() {
  return (
    <group>
      <Base />
      <RoundedBox args={[1.42, 1.05, 1.42]} radius={0.06} smoothness={4} position={[0, 0.6, 0]} castShadow>
        <meshStandardMaterial color={BODY} metalness={0.72} roughness={0.34} />
      </RoundedBox>
      {/* recessed panel seam + a glowing HMI */}
      <mesh position={[0, 0.62, 0.72]}>
        <boxGeometry args={[1.1, 0.7, 0.02]} />
        <meshStandardMaterial color={BODY2} metalness={0.5} roughness={0.45} />
      </mesh>
      <HMIPanel position={[0.42, 0.78, 0.74]} />
      <mesh position={[-0.35, 0.95, 0.73]}>
        <sphereGeometry args={[0.04, 10, 10]} />
        <meshStandardMaterial color="#3fb950" emissive="#3fb950" emissiveIntensity={1.3} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function MachineModel({ type, running, rpm }: { type?: string; running: boolean; rpm?: number | null }) {
  const t = (type || "").toLowerCase();
  if (t.includes("weld")) return <Welder running={running} />;
  if (t.includes("palletiz")) return <Palletizer running={running} />;
  if (t.includes("robot")) return <RobotCell running={running} />;
  if (t.includes("lathe") || t.includes("turn")) return <Lathe running={running} rpm={rpm} />;
  if (t.includes("mill") || t.includes("cnc")) return <Mill running={running} fiveAxis={t.includes("5-axis")} rpm={rpm} />;
  if (t.includes("press") || t.includes("stamp")) return <Press running={running} />;
  if (t.includes("inspect") || t.includes("cmm") || t.includes("scan")) return <Inspection running={running} />;
  if (t.includes("paint")) return <PaintBooth running={running} />;
  if (t.includes("oven") || t.includes("cure") || t.includes("cur")) return <Oven running={running} />;
  if (t.includes("wash") || t.includes("deburr")) return <Wash running={running} />;
  if (t.includes("pack")) return <Packer />;
  if (t.includes("load") || t.includes("intake") || t.includes("destack")) return <Loader />;
  return <Generic />;
}
