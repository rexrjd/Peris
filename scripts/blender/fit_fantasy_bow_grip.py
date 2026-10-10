"""Fit the closed stationary archer glove to the actual animated bow handle.

Source bow/string/draw-hand channels and immutable input native are retained.
The new glove follows the existing bow prop; actual wrist overlap remains an
explicit visual check rather than an inferred socket-distance approval.
"""
import argparse,pathlib,sys,hashlib,json,types,bpy,bmesh,math
from mathutils import Vector,Matrix
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from roster_atlas import pack
p=argparse.ArgumentParser();p.add_argument('--race',required=True);p.add_argument('--source-edition',required=True);p.add_argument('--edition',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=ROOT/'assets/source/battle'/a.source_edition/f'editable-{a.race}-study.blend';out=ROOT/'assets/source/battle'/a.edition
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();old=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);col=bpy.data.collections['PERIS_EXPORT'];new=bpy.data.collections['FANTASY_PORTRAIT_NEW_COMPONENTS'];role='archer';arms=[o for o in col.all_objects if o.type=='ARMATURE'];baseline={r:{b.name:b.matrix_basis.copy() for b in r.pose.bones} for r in arms}
for r in arms:
 r.animation_data.action=None
 for n,m in baseline[r].items():r.pose.bones[n].matrix_basis=m.copy()
 for t in r.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
def owns(o,r):return o.type=='MESH' and any(m.type=='ARMATURE' and m.object==r for m in o.modifiers)
kit=[]
for rname in ['line_infantry','spear_guard','elite']:
 r=next(r for r in arms if 'hand_R' in r.data.bones and any(owns(o,r) and o.get('peris_role')==rname for o in col.all_objects));removed=[]
 for o in [o for o in col.all_objects if owns(o,r) and o.get('peris_role')==rname and o not in set(new.objects)]:
  bm=bmesh.new();bm.from_mesh(o.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in o.vertex_groups};pending=set(bm.verts);drop=[]
  while pending:
   seed=pending.pop();part={seed};todo=[seed]
   while todo:
    for e in todo.pop().link_edges:
     for v in e.verts:
      if v in pending:pending.remove(v);part.add(v);todo.append(v)
   weights={}
   for v in part:
    for i,w in v[layer].items():weights[names[i]]=weights.get(names[i],0)+w/len(part)
   pts=[v.co for v in part];span=max(max(v[i] for v in pts)-min(v[i] for v in pts) for i in range(3));pole=sum(weights.get(n,0) for n in ['hand_R','weapon_R','prop-weapon_R']);shield=sum(weights.get(n,0) for n in ['hand_L','shield','prop-shield','shield_arm','prop-shield_arm'])
   if span>.60 and (pole>.98 or (rname=='elite' and shield>.98)):
    drop.extend(part);removed.append({'mesh':o.name,'vertices':len(part),'spanArmLocal':span,'component':'superseded original pole' if pole>.98 else 'superseded original elite shield','weights':weights})
  if drop:bmesh.ops.delete(bm,geom=drop,context='VERTS');bm.to_mesh(o.data);o.data.update()
  bm.free()
 blade=next((o for o in new.objects if o.get('peris_role')==rname and 'Distinct ' in o.name and 'forged blade' in o.name),None)
 if blade:
  handRest=r.data.bones['hand_R'].matrix_local;inv=handRest.inverted();matrix=r.matrix_world.inverted()@blade.matrix_world;poly=blade.data.polygons[0];pa,pb,pc=[inv@matrix@blade.data.vertices[i].co for i in list(poly.vertices)[:3]];normal=(pb-pa).cross(pc-pa).normalized();target=(r.matrix_world.to_3x3()@r.pose.bones['hand_R'].matrix.to_3x3()).inverted()@Vector((.95,-1.15,.42));target.z=0;target.normalize();normal.z=0;normal.normalize();angle=math.atan2(normal.x*target.y-normal.y*target.x,normal.dot(target));rotation=Matrix.Rotation(angle,4,'Z')
  for o in new.objects:
   if o.get('peris_role')!=rname or 'Distinct ' not in o.name or not any(s in o.name for s in ['forged blade','honed cutting bevel']):continue
   matrix=r.matrix_world.inverted()@o.matrix_world;undo=matrix.inverted()
   for v in o.data.vertices:
    p=inv@matrix@v.co;v.co=undo@handRest@(Vector((0,.15,0))+rotation@(p-Vector((0,.15,0))))
   o.data.update()
  kit.append({'role':rname,'removedActualSupersededSourceComponents':removed,'newBladeActualFaceToHeroCameraTwistRadians':angle,'shaftGripUnchanged':True})
arm=next(r for r in arms if 'hand_L' in r.data.bones and any(owns(o,r) and o.get('peris_role')==role for o in col.all_objects));hand=arm.pose.bones['hand_L'].matrix.copy();bow=arm.pose.bones['prop-weapon_bow'].matrix.copy();hinv=(arm.matrix_world@hand).inverted();points=[]
for o in col.all_objects:
 if o.get('peris_role')!=role or not owns(o,arm) or o in set(new.objects):continue
 names={g.index:g.name for g in o.vertex_groups};ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());posed=ev.to_mesh()
 for v in o.data.vertices:
  weight=sum(g.weight for g in v.groups if 'bow' in names[g.group].lower())
  if weight>.9:points.append(hinv@o.matrix_world@posed.vertices[v.index].co)
 ev.to_mesh_clear()
near=[v for v in points if abs(v.z)<.1 and (v-Vector((0,.15,0))).length<.4]
if len(near)<4:raise ValueError('No measured actual source bow handle')
center=sum(near,Vector())/len(near);axis=(hand.inverted()@bow).to_3x3()@Vector((0,0,1));rotation=Vector((0,0,1)).rotation_difference(axis.normalized()).to_matrix().to_4x4();fit=Matrix.Translation(center)@rotation@Matrix.Translation((0,-.15,0));restHand=arm.data.bones['hand_L'].matrix_local;restBow=arm.data.bones['prop-weapon_bow'].matrix_local;correction=restBow@bow.inverted()@hand@fit@restHand.inverted();changed=[]
for o in list(new.objects):
 if o.get('peris_role')!=role or not owns(o,arm):continue
 if 'anatomical closed L grip' not in o.name and not ('Individual curved dorsal knuckle guard' in o.name and o.vertex_groups.get('hand_L')):continue
 if o.get('peris_bow_handle_fit'):continue
 # These new parts are in the armature rest coordinates with identity basis.
 matrix=arm.matrix_world.inverted()@o.matrix_world;local=matrix.inverted()@correction@matrix;o.data.transform(local);o.data.update();o.vertex_groups.clear();g=o.vertex_groups.new(name='prop-weapon_bow');g.add(list(range(len(o.data.vertices))),1,'REPLACE');o['peris_bow_handle_fit']='Actual evaluated idle centerline and source bow axis; glove rigidly follows unchanged existing prop-weapon_bow';o['peris_grip_triangle_test']='Previous pole-axis test superseded by measured source bow-axis fit; actual wrist/contact review required';changed.append(o.name)
if not changed and not any(o.get('peris_role')==role and o.get('peris_bow_handle_fit') for o in new.objects):raise ValueError('No connected stationary archer glove')
out.mkdir(parents=True);editable=out/f'editable-{a.race}-study.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(editable),compress=True)
roles=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','catapult'];lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in roles},PROFILE={'family':'spartan'});pack(lib,a.race+'-measured-bow-grip',out/'textures',4096)
native=out/f'peris-{a.race}-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True);record={'sourceNative':str(source),'sourceSha256':old,'sourceUnchanged':sha(source)==old,'role':role,'actualSourceBowHandleCenterHandLocal':list(center),'actualSourceBowHandleAxisHandLocal':list(axis.normalized()),'sourceHandleSamples':len(near),'modifiedOriginalBowStringDrawHandChannels':False,'restRigUnchanged':True,'changedOriginalPerisGloveObjects':changed,'newGloveExistingBoneOwner':'prop-weapon_bow','wristContinuityRequiresActualReview':True,'actualSourceWeaponCleanupAndBladeReview':kit,'nativeFrames':[1,25],'runtimeApproved':False,'finishedUnitApproved':False,'files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in [editable,native]}};(out/'provenance.json').write_text(json.dumps(record,indent=2));print('FANTASY_ACTUAL_BOW_GRIP_READY',json.dumps(record['files']),flush=True)
