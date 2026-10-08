"""Run inside Blender: blender scene.blend --background --python this.py -- --collection PERIS_EXPORT --output export.glb"""
import argparse
import json
import pathlib
import sys

import bpy


def main():
    parser = argparse.ArgumentParser(description="Export an explicit Peris collection without saving or modifying the .blend source.")
    parser.add_argument("--collection", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    output = pathlib.Path(args.output).resolve()
    if output.suffix.lower() != ".glb":
        raise ValueError("Output must end with .glb")
    if output.exists() and not args.overwrite:
        raise FileExistsError("Output exists. Choose a new filename or pass --overwrite.")
    collection = bpy.data.collections.get(args.collection)
    if collection is None:
        raise ValueError("Collection not found: " + args.collection)
    objects = list(collection.all_objects)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    if not meshes:
        raise ValueError("The collection has no meshes.")
    if any(obj.name not in bpy.context.view_layer.objects for obj in objects):
        raise ValueError("Include the whole export collection in the active view layer first.")
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        raise ValueError("Switch to Object Mode before exporting.")
    previous = list(bpy.context.selected_objects)
    active = bpy.context.view_layer.objects.active
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        result = bpy.ops.export_scene.gltf(
            filepath=str(output), export_format="GLB", use_selection=True,
            export_yup=True, export_apply=False, export_animations=True,
            export_skins=True, export_materials="EXPORT",
        )
        if "FINISHED" not in result:
            raise RuntimeError("Blender did not complete the export.")
    finally:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in previous:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = active
    print(json.dumps({"file": str(output), "collection": collection.name,
                      "meshes": len(meshes), "armatures": sum(obj.type == "ARMATURE" for obj in objects),
                      "bytes": output.stat().st_size, "blender": bpy.app.version_string}))


if __name__ == "__main__":
    main()
