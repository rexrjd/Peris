"""Packed immutable derivative: actual shield field and handle share hand_L.

Rest positions, topology, UVs, normals, images, bones and all actions are kept.
Only fully rigid shield-prop vertex group ownership changes. Actual idle/attack
images and final export contact checks are separate required gates.
"""
import argparse,pathlib,sys,bpy,json,hashlib
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--race',required=True);p.add_argument('--source-edition',required=True);p.add_argument('--edition',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=ROOT/'assets/source/battle'/a.source_edition/f'peris-{a.race}-army.blend';out=ROOT/'assets/source/battle'/a.edition
if out.exists():raise FileExistsError(out)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();source_hash=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False)
col=bpy.data.collections['PERIS_EXPORT'];scene=bpy.context.scene;arms=[o for o in col.all_objects if o.type=='ARMATURE'];baseline={arm:{b.name:b.matrix_basis.copy() for b in arm.pose.bones} for arm in arms};rows=[]
def sample(state,frame):
 for arm in arms:
  arm.animation_data.action=None
  for n,m in baseline[arm].items():arm.pose.bones[n].matrix_basis=m.copy()
  for t in arm.animation_data.nla_tracks:t.mute=not t.name.endswith('_'+state)
 scene.frame_set(-1);scene.frame_set(frame);bpy.context.view_layer.update()
for role in ['line_infantry','spear_guard','elite','scout','light_cavalry','heavy_cavalry']:
 owned=[o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role];items=[]
 for obj in owned:
  arm=next((m.object for m in obj.modifiers if m.type=='ARMATURE' and 'hand_L' in m.object.data.bones),None)
  if not arm:continue
  ids={g.index for g in obj.vertex_groups if g.name.startswith('prop-shield') or g.name.startswith('prop_shield')};vertices=[v.index for v in obj.data.vertices if sum(g.weight for g in v.groups if g.group in ids)>.99]
  if vertices:items.append((obj,arm,ids,vertices))
 if not items:continue
 arm=items[0][1];fieldbone=next(arm.data.bones[g.name] for obj,_,ids,_ in items for g in obj.vertex_groups if g.index in ids and g.name in arm.data.bones);anchor=fieldbone.matrix_local.inverted()@(arm.data.bones['hand_L'].matrix_local@Vector((0,.15,0)));before=[]
 for state in ['idle','walk','attack']:
  for frame in [1,7,14,25]:
   sample(state,frame);field=arm.matrix_world@arm.pose.bones[fieldbone.name].matrix@anchor;handle=arm.matrix_world@arm.pose.bones['hand_L'].matrix@Vector((0,.15,0));before.append({'state':state,'frame':frame,'fieldHandleAnchorWorldError':(field-handle).length})
 changed=0
 for obj,arm,ids,vertices in items:
  target=obj.vertex_groups.get('hand_L') or obj.vertex_groups.new(name='hand_L')
  for i in vertices:
   for g in list(obj.data.vertices[i].groups):obj.vertex_groups[g.group].remove([i])
   target.add([i],1,'REPLACE')
  changed+=len(vertices)
 rows.append({'role':role,'fieldVerticesRebound':changed,'sourceFieldBone':fieldbone.name,'destinationBone':'hand_L','beforeAnchorSamples':before,'maximumBeforeFieldHandleAnchorError':max(r['fieldHandleAnchorWorldError'] for r in before),'afterSameBoneRelativeRigidity':True,'afterTheoreticalRelativeHandleDrift':0,'restPositionsTopologyUVNormalsAndImagesUnchanged':True,'sourceRigRestAndActionCurvesUnchanged':True,'requiresActualIdleAttackAppearanceReview':True,'runtimeApproved':False})
sample('idle',1);out.mkdir(parents=True);native=out/f'peris-{a.race}-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
if sha(source)!=source_hash:raise ValueError('Original frozen native changed')
record={'race':a.race,'sourceNative':str(source),'sourceSha256':source_hash,'sourceUnchanged':True,'nativeOriginalFrames':[1,25],'fieldHandleOwnership':rows,'rawExportRequired':'reexport_fantasy_saved_baseline.py: exact49TRS then JSONname-only namespace','runtimeApproved':False,'finishedUnitApproved':False,'files':{native.name:{'bytes':native.stat().st_size,'sha256':sha(native)}}}
(out/'provenance.json').write_text(json.dumps(record,indent=2));print('SHIELD_HAND_BIND_NATIVE_READY',json.dumps(record['files']),flush=True)
