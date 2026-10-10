"""Measured original humanoid soles, horse hooves and siege supports.

Save a new editable derivative; retain the prior authoring source. Each copied
action changes object.location.Z only, then the unsaved export clone captures
all 49 original halfstep poses with collision-free runtime node names.
"""
import argparse, pathlib, sys, hashlib, json, runpy, bpy
ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/blender'))
from prototype_contact_floor import normalize_role_ground
from prototype_export_sampling import bake_saved_baseline_export, DEFAULT_ROLES
from prototype_glb_names import namespace_exported_glb_nodes
p = argparse.ArgumentParser()
p.add_argument('--native', required=True); p.add_argument('--faction', required=True)
p.add_argument('--out', required=True)
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
if a.faction not in ('roman', 'spartan', 'persian', 'egyptian'): raise ValueError('Human factions only')
source = pathlib.Path(a.native).resolve(); out = ROOT / 'assets/source/battle' / a.out / a.faction
if out.exists(): raise FileExistsError('Preserve previous source derivative')
sha = lambda f: hashlib.sha256(f.read_bytes()).hexdigest()
source_hash = sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
collection = bpy.data.collections['PERIS_EXPORT']; contact = []
hoof = {'Horse_Hoof_L', 'Horse_Hoof_R', 'Horse_Hoof_back_L', 'Horse_Hoof_back_R',
        'Horse_Hand_L', 'Horse_Hand_R', 'Horse_Foot_L', 'Horse_Foot_R'}
for role in DEFAULT_ROLES:
    roots = [o for o in collection.all_objects if o.type == 'ARMATURE' and not o.parent
             and o.animation_data and any(t.name == role + '_idle' for t in o.animation_data.nla_tracks)]
    if len(roots) != 1: raise ValueError('One semantic root required: ' + role)
    supports = hoof if role in ('scout', 'light_cavalry', 'heavy_cavalry') else {'foot_L', 'foot_R'}
    if role == 'ram': supports = {'l_mid', 'l_front', 'l_back', 'r_mid', 'r_front', 'r_back'}
    if role == 'catapult': supports = {'onagermain'}
    present = {g.name for o in collection.all_objects if o.type == 'MESH' and o.get('peris_role') == role for g in o.vertex_groups}
    selected = sorted(supports & present)
    if not selected: raise ValueError('Explicit actual supports missing: ' + role)
    record = normalize_role_ground(collection, role, roots[0], selected, sample_step=.5,
                                  clearance=.025, allow_lowering=role in ('ram', 'catapult'), edition=a.out)
    contact.append(record); print('HUMAN_ACTUAL_CONTACT', a.faction, role, record['after']['minimumWorldZ'], flush=True)
for o in collection.all_objects:
    if o.type == 'ARMATURE' and o.animation_data:
        o.animation_data.action = None
        for t in o.animation_data.nla_tracks: t.mute = not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1); bpy.context.scene.frame_set(1); bpy.context.view_layer.update()
out.mkdir(parents=True); bpy.ops.file.pack_all()
native = out / ('peris-' + a.faction + '-army.blend')
bpy.ops.wm.save_as_mainfile(filepath=str(native), compress=True)
bpy.ops.wm.open_mainfile(filepath=str(native), load_ui=False, use_scripts=False)
sampling = bake_saved_baseline_export(bpy.data.collections['PERIS_EXPORT'])
raw = out / 'exports' / (a.faction + '-roster.glb')
source_names = raw.with_name(raw.stem + '-source-names.glb')
sys.argv = ['export_glb.py', '--', '--collection', 'PERIS_EXPORT', '--animation-mode', 'NLA_TRACKS', '--output', str(source_names)]
runpy.run_path(str(ROOT / 'scripts/blender/export_glb.py'), run_name='__main__')
sampling['runtimeNodeNamespace'] = namespace_exported_glb_nodes(source_names, raw)
if sha(source) != source_hash: raise ValueError('Prior authoring source changed')
record = {'edition': a.out, 'faction': a.faction, 'sourceNative': str(source), 'sourceNativeSha256': source_hash,
          'sourceNativeUnchanged': True, 'contact': contact, 'exportSampling': sampling,
          'native': {'path': str(native), 'sha256': sha(native)}, 'raw': {'path': str(raw), 'sha256': sha(raw)},
          'runtimeApproved': False, 'finishedUnitApproved': False}
(out / 'provenance.json').write_text(json.dumps(record, indent=2) + '\n')
print('HUMAN_EXACT_EXPORT_READY', json.dumps(record['raw']), flush=True)
