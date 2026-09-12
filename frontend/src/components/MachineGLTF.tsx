import { Component, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

/* Real CAD/GLTF machine models — the "next tier" beyond procedural geometry.
   Loads a Draco-compressed .glb, normalizes it to the same footprint the
   procedural machines use (fit the largest horizontal dimension to ~1.7 m and
   seat it on the floor), and renders it. Any load/decode failure is caught by
   the boundary below and falls back to the procedural model — so a missing or
   broken asset never blanks a station. */

const TARGET = 1.9; // metres — the footprint a station occupies on the floor

export function MachineGLTF({ url, running }: { url: string; running?: boolean }) {
  // second arg = use the Draco decoder (drei points it at the gstatic CDN in dev;
  // host the decoder locally for a fully offline build).
  const { scene } = useGLTF(url, true) as unknown as { scene: THREE.Group };
  const ref = useRef<THREE.Group>(null);
  const isRobot = /robot/i.test(url);

  // subtle "working" sway for robot arms while running (they're single meshes, so
  // we animate the whole model rather than individual joints)
  useFrame((st) => {
    if (!ref.current || !isRobot) return;
    ref.current.rotation.y = running ? Math.sin(st.clock.elapsedTime * 0.9) * 0.22 : 0;
  });

  const model = useMemo(() => {
    const s = scene.clone(true);
    const box = new THREE.Box3().setFromObject(s);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const scale = TARGET / Math.max(size.x, size.z, size.y * 0.7, 1e-3);
    s.scale.setScalar(scale);
    // centre horizontally, seat the base on y=0
    s.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = true;
        // industrial robots read as KUKA-orange in real body shops
        if (isRobot && m.material) {
          const src = m.material as THREE.MeshStandardMaterial;
          if (/arm|robot|ochre/i.test(src.name || "")) {
            const c = src.clone(); c.color = new THREE.Color("#e0671a"); c.metalness = 0.4; c.roughness = 0.45;
            m.material = c;
          }
        }
      }
    });
    return s;
  }, [scene, isRobot]);

  // Blender +Y (the machine's detailed front) exports to glTF -Z, which faces
  // AWAY from the scene's default +Z camera — so turn the model 180° to present
  // its front (window/controls/chuck) to the viewer. Seating/centering unaffected.
  return <group ref={ref}><group rotation={[0, Math.PI, 0]}><primitive object={model} /></group></group>;
}

/** Renders `fallback` (the procedural machine) if its children throw — i.e. the
    GLTF failed to load or decode. */
export class ModelErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn("[MachineGLTF] model load failed, using procedural fallback:", err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

// warm the cache for the models we ship so first paint is instant
["/models/cnc.glb", "/models/robot.glb", "/models/lathe.glb"]
  .forEach((u) => useGLTF.preload(u, true));
