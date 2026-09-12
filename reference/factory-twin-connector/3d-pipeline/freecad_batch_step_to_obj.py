"""
Run with:  freecad -c freecad_batch_step_to_obj.py  (or FreeCADCmd on Windows)

Why OBJ and not glTF directly: FreeCAD's built-in glTF exporter is NOT
available in headless/console mode as of 0.20.x (confirmed against the
freecad-to-gltf project's own README, which exists specifically to work
around this), and its GUI-only exporter drops mirrored parts, transforms,
and wires. OBJ export via the Mesh module IS fully scriptable headless and
has none of those gaps, so: STEP -> OBJ here, then OBJ -> GLB in Blender
(next script). Two boring, reliable steps beat one fragile one.

Point INPUT_DIR at a folder of GrabCAD STEP downloads (conveyors, robot
cells, workstations) and it batch-converts all of them.
"""
import os
import FreeCAD
import Part
import Mesh

INPUT_DIR = "./step_models"
OUTPUT_DIR = "./obj_models"
LINEAR_DEFLECTION = 0.5   # mm — mesh tessellation tolerance; lower = more triangles/fidelity
ANGULAR_DEFLECTION = 0.3  # radians

os.makedirs(OUTPUT_DIR, exist_ok=True)

for fname in os.listdir(INPUT_DIR):
    if not fname.lower().endswith((".step", ".stp")):
        continue
    step_path = os.path.join(INPUT_DIR, fname)
    obj_path = os.path.join(OUTPUT_DIR, os.path.splitext(fname)[0] + ".obj")

    doc = FreeCAD.newDocument("conv")
    Part.insert(step_path, doc.Name)
    doc.recompute()

    all_shapes = [obj for obj in doc.Objects if hasattr(obj, "Shape")]
    if not all_shapes:
        print(f"[skip] {fname}: no shapes found")
        FreeCAD.closeDocument(doc.Name)
        continue

    Mesh.export(all_shapes, obj_path)
    # If you need per-part fidelity control instead of Mesh.export's defaults:
    #   m = Mesh.Mesh()
    #   for obj in all_shapes:
    #       m.addFacets(obj.Shape.tessellate(LINEAR_DEFLECTION))
    #   m.write(obj_path)

    print(f"[ok] {fname} -> {obj_path}")
    FreeCAD.closeDocument(doc.Name)

print("Done. Next: blender --background --python blender_batch_obj_to_glb.py")
