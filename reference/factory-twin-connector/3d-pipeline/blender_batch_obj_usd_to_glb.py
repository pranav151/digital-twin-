"""
Run with:  blender --background --python blender_batch_obj_usd_to_glb.py

Blender is the right bridge tool because glTF 2.0 import/export has been
built into Blender core since 2.80 (Khronos' official glTF-Blender-IO,
bundled — no add-on install needed), and Blender's USD importer has been a
bundled, built-in feature since the 3.x series — so both your two source
formats (OBJ from the STEP pipeline, USD from NVIDIA's Omniverse asset
packs) land in the same scene and export through the identical, native glTF
exporter. Confirm the USD importer is present in your installed Blender
version (Edit > Preferences > Add-ons, search "USD") before relying on it —
I haven't pinned an exact version number here.

This does the minimum needed to get a factory-floor-ready GLB: import,
apply a uniform scale (STEP/USD often come in mm or cm; Three.js/R3F scenes
are usually most comfortable in meters), and export as a single binary GLB
per source file — one GLB per machine, which you then position using your
Part 10 layout config rather than baking positions into the mesh.
"""
import os
import bpy

OBJ_DIR = "./obj_models"
USD_DIR = "./usd_assets"
OUTPUT_DIR = "./glb_models"
SCALE_TO_METERS = 0.001  # adjust to your source units (e.g. 0.001 if source is millimeters)

os.makedirs(OUTPUT_DIR, exist_ok=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export_glb(name: str) -> None:
    for obj in bpy.context.scene.objects:
        obj.select_set(True)
        obj.scale = (obj.scale[0] * SCALE_TO_METERS,
                     obj.scale[1] * SCALE_TO_METERS,
                     obj.scale[2] * SCALE_TO_METERS)
    out_path = os.path.join(OUTPUT_DIR, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", use_selection=False)
    print(f"[ok] -> {out_path}")


if os.path.isdir(OBJ_DIR):
    for fname in os.listdir(OBJ_DIR):
        if not fname.lower().endswith(".obj"):
            continue
        reset_scene()
        bpy.ops.wm.obj_import(filepath=os.path.join(OBJ_DIR, fname))  # Blender 4.x import operator
        export_glb(os.path.splitext(fname)[0])

if os.path.isdir(USD_DIR):
    for fname in os.listdir(USD_DIR):
        if not fname.lower().endswith((".usd", ".usda", ".usdc", ".usdz")):
            continue
        reset_scene()
        bpy.ops.wm.usd_import(filepath=os.path.join(USD_DIR, fname))
        export_glb(os.path.splitext(fname)[0])

print("Done. glb_models/ now has one GLB per source machine, ready for R3F <primitive> / useGLTF().")
