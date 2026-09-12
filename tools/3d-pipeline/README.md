# 3D asset pipeline — real machine models

The floor view renders **procedural** machine geometry by default and can load a
**real GLTF/GLB CAD model** per station instead (see `MachineGLTF`). This is the
pipeline for turning vendor CAD into web-ready models.

```
 vendor / GrabCAD CAD (STEP/IGES/JT)
      │  ① convert
      ▼
   OBJ / glTF
      │  ② optimize (Draco + WebP)   ← tools/3d-pipeline/optimize_glb.sh  (verified)
      ▼
   MyMachine.glb  (small, web-ready)
      │  ③ drop into frontend/public/models/
      ▼
   ④ wire in config/assets.yaml:  model: "/models/MyMachine.glb"
```

## ① Source CAD
Free, high-quality machine models: **GrabCAD**, manufacturer download portals
(FANUC/KUKA/ABB robots, Haas/Mazak/DMG CNC), the **NIST/Khronos** sample sets, or
CC0/CC-BY libraries (Sketchfab-filtered, Poly Haven). **Check each model's license**
before bundling — see `frontend/public/models/CREDITS.md` for how we attribute ours.

## ② Convert STEP → glTF (needs FreeCAD and/or Blender — not run in this repo's CI)
```bash
# FreeCAD (STEP/IGES → mesh):
freecad.cmd -c "import Import,Mesh; Import.open('part.step'); \
  Mesh.export(App.ActiveDocument.Objects, 'part.obj')"

# Blender (OBJ/USD → GLB), headless:
blender -b -P - <<'PY'
import bpy, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath="part.obj")
bpy.ops.export_scene.gltf(filepath="part.glb", export_format="GLB")
PY
```
(The reference `factory-twin-connector/3d-pipeline/` scripts do the same batch
conversion; they are API-correct but were never test-run — treat as a starting point.)

## ③ Optimize (this step IS verified here)
```bash
tools/3d-pipeline/optimize_glb.sh part.glb frontend/public/models/MyMachine.glb 1024
```
Draco geometry compression + WebP textures typically cuts 80–95% of the file size.

## ④ Wire it up
Add a `model:` field to the station in `config/assets.yaml`:
```yaml
- {id: S6, name: "Welding Robot", type: "welding robot cell", x: 9, z: -4,
   model: "/models/KUKA_KR16.glb"}
```
The loader auto-scales the model to the station footprint, seats it on the floor,
enables shadows, and **falls back to procedural geometry** if the file is missing
or fails to decode. The live status beacon/OEE still float above it (ISA-101).

## Notes
- The Draco **decoder** is pulled from the gstatic CDN in dev (`useGLTF(url, true)`).
  For a fully offline/production build, host the decoder locally and point
  `DRACOLoader.setDecoderPath()` at it.
- Keep individual models under ~2 MB after optimization for snappy first paint.
