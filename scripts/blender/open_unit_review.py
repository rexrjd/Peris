"""Open the first two prototypes side by side without changing their export source.

Run in interactive Blender with the packed prototype .blend already loaded.
The review copy is saved under ignored artifacts, and its playback uses idle clips.
Pass -- --connect to enable MCP, start the live server, and save addon preferences.
"""
import argparse
import bpy
from pathlib import Path
import sys
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--connect', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
ROOT = Path(__file__).resolve().parents[2]
scene = bpy.context.scene
infantry = bpy.data.objects.get('line_infantry rig')
horse = bpy.data.objects.get('heavy_cavalry horse rig')
if infantry is None or horse is None:
    raise RuntimeError('Load peris-reference-prototypes.blend before this script')
infantry.location.y = -7
horse.location.y = 7
scene.frame_set(1)

target = Vector((0, 0, 6))
eye = Vector((27, -38, 22))
rotation = (target - eye).to_track_quat('-Z', 'Y')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.shading.type = 'MATERIAL'
            space.overlay.show_overlays = False
            space.region_3d.view_location = target
            space.region_3d.view_rotation = rotation
            space.region_3d.view_distance = 33
            space.region_3d.view_perspective = 'ORTHO'
bpy.ops.object.select_all(action='DESELECT')
if args.connect:
    try:
        bpy.ops.preferences.addon_enable(module='blender_mcp')
        bpy.ops.blendermcp.start_server()
        bpy.ops.wm.save_userpref()
        print('PERIS_LIVE_CONNECTION', scene.blendermcp_server_running, flush=True)
    except Exception as error:
        print('PERIS_LIVE_CONNECTION_UNAVAILABLE', str(error), flush=True)
out = ROOT / 'artifacts' / 'battle-preview' / 'peris-unit-review.blend'
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out))
print('PERIS_REVIEW_READY', out, flush=True)
