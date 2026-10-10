"""New .60-shield derivative with actual bare skull/foot stature and rigid grip.

Unjoined field/rim/device names are explicit. Hands and rear handle are untouched.
No animation, rest rig, body, head or source file changes. Repacking retains
licensed head partitions and mixed-source provenance.
"""
import argparse,pathlib,sys,bpy,json,hashlib,types
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from roster_atlas import pack
P=argparse.ArgumentParser();P.add_argument('--race',required=True);P.add_argument('--source-edition',required=True);P.add_argument('--edition',required=True);P.add_argument('--ratio',type=float,default=.60)
A=P.parse_args(sys.argv[sys.argv.index('--')+1:]);source=ROOT/'assets/source/battle'/A.source_edition/f'editable-{A.race}-study.blend';out=ROOT/'assets/source/battle'/A.edition
if out.exists():raise FileExistsError(out)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();oldsha=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);col=bpy.data.collections['PERIS_EXPORT'];new=bpy.data.collections['FANTASY_PORTRAIT_NEW_COMPONENTS'];rows=[]
roles=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','ram','catapult']
for role in roles:
 fields=[o for o in new.objects if o.get('peris_role')==role and 'shield' in o.name.lower() and 'grip' not in o.name.lower()]
 if not fields:continue
 arm=next(m.object for o in fields for m in o.modifiers if m.type=='ARMATURE');skull=[];foot=[]
 for o in col.all_objects:
  if o.type!='MESH' or o.get('peris_role')!=role or not any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers):continue
  transform=arm.matrix_world.inverted()@o.matrix_world;names={g.index:g.name for g in o.vertex_groups}
  if str(o.get('peris_atlas_partition','')).startswith('licensed-'):skull.extend(transform@v.co for v in o.data.vertices)
  foot.extend(transform@v.co for v in o.data.vertices if sum(g.weight for g in v.groups if names[g.group] in ['foot_L','foot_R','toe_L','toe_R'])>.5)
 if not skull or not foot:raise ValueError('Explicit credited bare skull / actual humanoid support required '+role)
 top=max(v.z for v in skull);bottom=min(v.z for v in foot);height=top-bottom;basis=arm.data.bones['prop-shield'].matrix_local;inverse=basis.inverted();anchor=inverse@(arm.data.bones['hand_L'].matrix_local@Vector((0,.15,0)));points=[]
 for o in fields:
  transform=arm.matrix_world.inverted()@o.matrix_world;points.extend(inverse@transform@v.co for v in o.data.vertices)
 extent=max(v.z for v in points)-min(v.z for v in points);body_world=(arm.matrix_world.to_3x3()@Vector((0,0,height))).length;axis_world=(arm.matrix_world.to_3x3()@basis.to_3x3()@Vector((0,0,1))).length;factor=A.ratio*body_world/(extent*axis_world)
 for o in fields:
  transform=arm.matrix_world.inverted()@o.matrix_world;undo=transform.inverted()
  for v in o.data.vertices:
   p=inverse@transform@v.co;p.x=anchor.x+(p.x-anchor.x)*factor;p.z=anchor.z+(p.z-anchor.z)*factor;v.co=undo@basis@p
  o.data.update();o['peris_actual_bare_body_shield_ratio']=A.ratio
 rows.append({'role':role,'actualBareHeadTopLocal':top,'actualFootSoleBottomLocal':bottom,'bodyHeightWorld':body_world,'shieldHeightBeforeWorld':extent*axis_world,'shieldHeightAfterWorld':A.ratio*body_world,'proportionateWidthHeightScale':factor,'targetRatio':A.ratio,'actualPalmAnchorUnchanged':True,'rearHandleAndHandsUnchanged':True,'planeDepthUnchanged':True,'rigActionsAndWeightsUnchanged':True})
out.mkdir(parents=True);editable=out/f'editable-{A.race}-study.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(editable),compress=True)
lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in roles if r!='ram'},PROFILE={'family':'spartan'});pack(lib,A.race+'-actual-body-shield-60',out/'textures',4096)
for o in new.all_objects:
 if o.name not in col.objects:col.objects.link(o)
native=out/f'peris-{A.race}-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
record={'source':str(source),'sourceSha256':oldsha,'sourceUnchanged':sha(source)==oldsha,'shieldSizeOperations':rows,'nativeFrames':[1,25],'exportRequiresFull49SavedBaselineCloneAndJSONNamespace':True,'runtimeApproved':False,'finishedUnitApproved':False,'files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in [editable,native]}}
(out/'provenance.json').write_text(json.dumps(record,indent=2));print('ACTUAL_BODY_SHIELDS_READY',json.dumps(record['files']),flush=True)
