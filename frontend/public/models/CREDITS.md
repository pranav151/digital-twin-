# 3D model credits & licenses

## In use — vehicle (third-party, CC-BY-4.0) — ATTRIBUTION REQUIRED

`bmw_m4.glb` — the car product on the automotive (BMW X5 / AUTO) line.
- **Model:** BMW M4 Competition M Package
- **Author:** 𝙎𝙍𝙏 𝙋𝙚𝙧𝙛𝙤𝙢𝙖𝙣𝙘𝙚™ — https://sketchfab.com/TheRealSRT
- **License:** CC-BY-4.0 — https://creativecommons.org/licenses/by/4.0/
- **Source:** https://sketchfab.com/3d-models/bmw-m4-competition-m-package-5c0a2dafb1ad408d9fc9eeef9aee531b
- **Attribution (keep in any distributed build):** "author: 𝙎𝙍𝙏 𝙋𝙚𝙧𝙛𝙤𝙢𝙖𝙣𝙘𝙚™ (https://sketchfab.com/TheRealSRT), license: CC-BY-4.0, source: Sketchfab"
- Obtained pre-optimized (meshopt/WebP, ~3.9 MB) from the public repo
  `lukaizj/car-mod-saas`; we further **welded + simplified (179k→~70k tris) + Draco**
  compressed it to ~0.55 MB for WebGL via gltf-transform.
- **Trademark note:** this is a fan model of a trademarked BMW vehicle. Fine for
  internal demo/development; review BMW trademark before any commercial release.

## In use — custom machine models (self-authored)

`cnc.glb`, `robot.glb`, `lathe.glb` are **original models we authored** for this
project (modeled procedurally in Blender 5.2 and exported to glTF 2.0). They are
our own IP — **no third-party license or attribution applies**, which keeps the
asset library clean for the commercial/patent strategy.

- **cnc.glb** — CNC machining centre (enclosure, viewing window, control pendant,
  rear electrical cabinet, andon stack light). Used by the mill stations
  (S2, S3, S16, S17, S19).
- **robot.glb** — 6-axis articulated robot arm + controller cabinet, in a working
  pose. Used by the assembly-robot stations (S7, S8, S22). `MachineGLTF` sways any
  url matching `/robot/` while the station is running.
- **lathe.glb** — CNC turning lathe (enclosure, window, headstock + chuck,
  tailstock, control pendant). Used by the lathe stations (S4, S15, S20).

Each is ~80–95 KB. `MachineGLTF` normalizes any model to the station footprint,
seats it on the floor, and turns it 180° so its detailed front faces the default
camera. Any load/decode failure falls back to the procedural machine automatically.

To regenerate or add machine types: the Blender build scripts run through the
scene-builder 3D tool (project "Factory Twin Machine Assets"); export the GLB,
drop it in this folder, and add a `model:` field to the station in
`config/assets.yaml`.

## Reference photos used to model the S58 engine (procedural, our own IP)

The BMW **S58 inline-six** on the engine line (`EngineMesh` in `Floor3D.tsx`) is an
**original procedural model we authored** — no third-party mesh is used. It was
modeled by studying three CC-licensed reference photographs of the real S58 for
correct proportions and component layout (block, twin-turbo/exhaust, intake,
cylinder head, cover). The 3D model is a new work, not a copy of the images, but
the reference sources are credited here:

- **File:S58_Engine.jpg** — CC BY 4.0 —
  https://commons.wikimedia.org/wiki/File:S58_Engine.jpg
- **File:2023-04-08_BMW_S58_straight-6-engine_2nd-view.jpg** — CC BY-SA 4.0 —
  https://commons.wikimedia.org/wiki/File:2023-04-08_BMW_S58_straight-6-engine_2nd-view.jpg
- **File:2023-04-08_BMW_S58_straight-6-engine_3rd_view.jpg** — CC BY-SA 4.0 —
  https://commons.wikimedia.org/wiki/File:2023-04-08_BMW_S58_straight-6-engine_3rd_view.jpg

**Trademark note:** "BMW", "M", "S58" and "M Power" are BMW trademarks; the cover
badge is a stylized fan depiction. Fine for internal demo/development; review
before any commercial release.

## Unused demo assets (kept for reference, NOT referenced by assets.yaml)

- **CommercialRefrigerator.glb** — CC-BY-4.0 (Sean Thomas / Khronos). Attribution
  required *only if* re-referenced in a build.
- **AntiqueCamera.glb** — CC0 1.0 (UX3D / Khronos).
- **kenney-*.glb** — CC0 1.0 (Kenney Factory Kit).

These were earlier demo stand-ins (the "juice fridge" etc.) and are no longer
wired to any station. Safe to delete if you want to slim the folder.
