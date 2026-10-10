"""Give the unarmed Roman elite the validated line sword and closed grip.

Copy only rigid right-hand faces and their existing atlas UVs, then fit them in
the elite's hand rest space. All other equipment, source actions and rig binds
stay intact. Save a new native and export all 49 original halfstep poses.
"""
import bpy, bmesh, pathlib, sys, hashlib, json, runpy
from mathutils import Matrix
ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/blender'))
from prototype_export_sampling import bake_saved_baseline_export
from prototype_glb_names import namespace_exported_glb_nodes
source = ROOT / 'assets/source/battle/human-portrait-quality-v13/roman/peris-roman-army.blend'
out = ROOT / 'assets/source/battle/human-portrait-quality-v14/roman'
if out.exists(): raise FileExistsError('Preserve earlier source editions')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
source_sha = sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source), use_scripts=False)
C = bpy.data.collections['PERIS_EXPORT']
def arm(role):
    return next(o for o in C.all_objects if o.type == 'ARMATURE' and not o.parent
                and any(t.name == role + '_idle' for t in o.animation_data.nla_tracks))
S, T = arm('line_infantry'), arm('elite')
parts = [o for o in C.all_objects if o.type == 'MESH' and o.get('peris_role') == 'line_infantry'
         and any(m.type == 'ARMATURE' and m.object == S for m in o.modifiers)]
family = {'hand_R', 'finger_R', 'fingertip_R'}
for target in [o for o in C.all_objects if o.type == 'MESH' and o.get('peris_role') == 'elite'
               and any(m.type == 'ARMATURE' and m.object == T for m in o.modifiers)]:
    bm = bmesh.new(); bm.from_mesh(target.data); layer = bm.verts.layers.deform.active
    groups = {g.index: g.name for g in target.vertex_groups}
    faces = [f for f in bm.faces if layer and sum(sum(w for i, w in v[layer].items()
             if groups.get(i) in family) for v in f.verts) / len(f.verts) > .64]
    bmesh.ops.delete(bm, geom=faces, context='FACES')
    bm.to_mesh(target.data); bm.free(); target.data.update()
added = []
for original in parts:
    clone = original.copy(); clone.data = original.data.copy(); C.objects.link(clone)
    bm = bmesh.new(); bm.from_mesh(clone.data); layer = bm.verts.layers.deform.active
    groups = {g.index: g.name for g in clone.vertex_groups}
    def right(v): return layer and sum(w for i, w in v[layer].items() if groups.get(i) == 'hand_R') > .999
    keep = [f for f in bm.faces if all(right(v) for v in f.verts)]
    if not keep:
        bm.free(); bpy.data.objects.remove(clone, do_unlink=True); continue
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in keep], context='FACES')
    bm.to_mesh(clone.data); bm.free()
    rest = T.data.bones['hand_R'].matrix_local @ S.data.bones['hand_R'].matrix_local.inverted()
    clone.data.transform(rest @ S.matrix_world.inverted() @ original.matrix_world)
    clone.parent = T; clone.matrix_parent_inverse = Matrix.Identity(4); clone.matrix_basis = Matrix.Identity(4)
    for vg in list(clone.vertex_groups): clone.vertex_groups.remove(vg)
    clone.vertex_groups.new(name='hand_R').add(list(range(len(clone.data.vertices))), 1, 'REPLACE')
    for m in clone.modifiers:
        if m.type == 'ARMATURE': m.object = T
    clone.name = 'elite fitted gladius and connected gripping glove'; clone['peris_role'] = 'elite'
    clone['peris_original_hand_weapon_derivative'] = 'Validated line sword/glove geometry; existing shared Roman atlas and UVs retained'
    added.append({'mesh': clone.name, 'vertices': len(clone.data.vertices), 'faces': len(clone.data.polygons)})
if not added: raise ValueError('No actual sword/grip faces selected')
for a in C.all_objects:
    if a.type == 'ARMATURE' and a.animation_data:
        a.animation_data.action = None
        for t in a.animation_data.nla_tracks: t.mute = not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1); bpy.context.scene.frame_set(1); bpy.context.view_layer.update()
out.mkdir(parents=True); bpy.ops.file.pack_all()
native = out / 'peris-roman-army.blend'; bpy.ops.wm.save_as_mainfile(filepath=str(native), compress=True)
bpy.ops.wm.open_mainfile(filepath=str(native), use_scripts=False)
sampling = bake_saved_baseline_export(bpy.data.collections['PERIS_EXPORT'])
raw = out / 'exports/roman-roster.glb'; names = raw.with_name('roman-source-names.glb')
sys.argv = ['export_glb.py', '--', '--collection', 'PERIS_EXPORT', '--animation-mode', 'NLA_TRACKS', '--output', str(names)]
runpy.run_path(str(ROOT / 'scripts/blender/export_glb.py'), run_name='__main__')
sampling['namespace'] = namespace_exported_glb_nodes(names, raw)
if sha(source) != source_sha: raise ValueError('Prior source changed')
(out / 'provenance.json').write_text(json.dumps({'source': str(source), 'sourceSha256': source_sha,
    'sourceUnchanged': True, 'change': 'Roman elite right hand and fitted gladius only', 'added': added,
    'native': str(native), 'nativeSha256': sha(native), 'raw': str(raw), 'rawSha256': sha(raw),
    'exportSampling': sampling, 'finishedArtApproved': False}, indent=2) + '\n')
print('ROMAN_ELITE_SWORD_READY', sha(raw), flush=True)
