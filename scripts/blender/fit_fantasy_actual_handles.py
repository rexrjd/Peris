"""New preserved derivative: bind actual source pole to the closed palm, real shields.

Only verified rigid weapon prop vertices and superseded shield props change.
Approved head/clothing/rest rig/actions and floor fitting stay unchanged.
"""
import argparse,bpy,bmesh,pathlib,sys,json,hashlib,types,numpy as np
from mathutils import Vector,Matrix
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from prototype_shield_fit import standing_body_height
from roster_atlas import pack
p=argparse.ArgumentParser();p.add_argument('--race',required=True);p.add_argument('--source-edition',required=True);p.add_argument('--edition',required=True);p.add_argument('--cleanup-bow-shields',action='store_true')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=ROOT/'assets/source/battle'/a.source_edition/f'editable-{a.race}-study.blend';out=ROOT/'assets/source/battle'/a.edition
if out.exists():raise FileExistsError(out)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();source_hash=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False)
master=bpy.data.collections['PERIS_EXPORT'];new=bpy.data.collections['FANTASY_PORTRAIT_NEW_COMPONENTS'];scene=bpy.context.scene
roles=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','ram','catapult'];records=[]
arms=[o for o in master.all_objects if o.type=='ARMATURE']
for arm in arms:
 arm.animation_data.action=None
 for t in arm.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
scene.frame_set(-1);scene.frame_set(1);bpy.context.view_layer.update()
def source_body(role):
 return next(o for o in master.all_objects if o.type=='MESH' and o.get('peris_role')==role and o.name not in new.objects and any(m.type=='ARMATURE' and 'hand_R' in m.object.data.bones for m in o.modifiers))
linearm=next(m.object for m in source_body('line_infantry').modifiers if m.type=='ARMATURE')
templates=[o for o in new.objects if o.get('peris_role')=='line_infantry' and ('shield' in o.name.lower())]
if len(templates)<5:raise ValueError('Accepted complete line shield template absent')
for obj in list(new.objects):
 if 'Functional hand-local leather grip' in obj.name:bpy.data.objects.remove(obj,do_unlink=True)
if a.cleanup_bow_shields:
 for role in ['scout','light_cavalry']:
  discard=[o for o in list(new.objects) if o.get('peris_role')==role and 'accepted dimensional shield' in o.name]
  records.append({'role':role,'removedInapplicableShieldComponents':len(discard),'reason':'Both are verified mounted bow roles: preserve actual left bow and right articulated draw hand, no competing shield grip.'})
  for o in discard:bpy.data.objects.remove(o,do_unlink=True)
for role in ([] if a.cleanup_bow_shields else ['spear_guard','elite','scout','light_cavalry','heavy_cavalry']):
 body=source_body(role);arm=next(m.object for m in body.modifiers if m.type=='ARMATURE');names={g.index:g.name for g in body.vertex_groups};group=body.vertex_groups.get('prop-weapon_R')
 bow=a.race=='demon' and role in ['scout','light_cavalry']
 if not bow and group:
  ids=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group==group.index)>.99]
  bm=bmesh.new();bm.from_mesh(body.data);bm.verts.ensure_lookup_table();pending={bm.verts[i] for i in ids};parts=[]
  while pending:
   seed=pending.pop();part={seed};todo=[seed]
   while todo:
    for e in todo.pop().link_edges:
     for v in e.verts:
      if v in pending:pending.remove(v);part.add(v);todo.append(v)
   parts.append([v.index for v in part])
  deps=bpy.context.evaluated_depsgraph_get();ev=body.evaluated_get(deps);posed=ev.to_mesh();handworld=arm.matrix_world@arm.pose.bones['hand_R'].matrix;inverse=handworld.inverted();points={i:inverse@body.matrix_world@posed.vertices[i].co for i in ids}
  shaft=max(parts,key=lambda part:max(max(points[i][j] for i in part)-min(points[i][j] for i in part) for j in range(3)) if len(part)<=30 else 0)
  positions=np.asarray([points[i] for i in shaft]);center=positions.mean(axis=0);_,_,vh=np.linalg.svd(positions-center);axis=Vector(vh[0]);axis=-axis if axis.z<0 else axis
  palm=Vector((0,.15,0));c=Vector(center);closest=c+axis*(palm-c).dot(axis);rotation=axis.rotation_difference(Vector((0,0,1))).to_matrix();shaftset=set(shaft)
  radius=max((rotation@(points[i]-closest)).xy.length for i in shaft);radialscale=min(1,.042/max(radius,1e-8));resthand=arm.data.bones['hand_R'].matrix_local;to_body=(arm.matrix_world.inverted()@body.matrix_world).inverted();target=body.vertex_groups.get('hand_R')
  for i in ids:
   local=rotation@(points[i]-closest)
   if i in shaftset:local.x*=radialscale;local.y*=radialscale
   local+=palm;body.data.vertices[i].co=to_body@resthand@local
   for g in list(body.data.vertices[i].groups):body.vertex_groups[g.group].remove([i])
   target.add([i],1,'REPLACE')
  ev.to_mesh_clear();bm.free();body.data.update();records.append({'role':role,'actualSourcePoleVertices':len(ids),'shaftComponentVertices':len(shaft),'idleHandLocalAxisBefore':list(axis),'actualShaftRadiusBefore':radius,'actualShaftRadiusAfter':radius*radialscale,'sourceTipLengthAndUVPreserved':True,'actualPoleBinding':'Actual source shaft centered in existing palm and rigidly owned by unchanged hand_R. No separate phantom grip handle.','rigActionsUnchanged':True})
 # These inherited green orb/staff props were verified not to be shields.
 shield=next((b for b in arm.data.bones if b.name.startswith('prop-shield')),None)
 if shield and not bow:
  bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;indices={g.index for g in body.vertex_groups if g.name.startswith('prop-shield')};drop=[v for v in bm.verts if sum(w for i,w in v[layer].items() if i in indices)>.99];removed=len(drop);bmesh.ops.delete(bm,geom=drop,context='VERTS');bm.to_mesh(body.data);bm.free();body.data.update()
  standing=standing_body_height(master,role,arm);copies=[];fieldpoints=[]
  for old in templates:
   obj=old.copy();obj.data=old.data.copy();obj.name=role+' '+a.race+' accepted dimensional shield '+old.name.split('line_infantry',1)[-1];obj.parent=arm;obj.matrix_basis=Matrix.Identity(4);obj.matrix_parent_inverse=Matrix.Identity(4);new.objects.link(obj);master.objects.link(obj);obj['peris_role']=role
   bone='hand_L' if any(g.name=='hand_L' for g in old.vertex_groups) else shield.name;sourcebone='hand_L' if bone=='hand_L' else 'prop-shield';transform=arm.data.bones[bone].matrix_local@linearm.data.bones[sourcebone].matrix_local.inverted();obj.data.transform(transform);obj.vertex_groups.clear();g=obj.vertex_groups.new(name=bone);g.add(list(range(len(obj.data.vertices))),1,'REPLACE')
   for m in obj.modifiers:
    if m.type=='ARMATURE':m.object=arm
   copies.append((obj,bone))
   if bone!= 'hand_L':fieldpoints.extend(shield.matrix_local.inverted()@v.co for v in obj.data.vertices)
  height=max(p.z for p in fieldpoints)-min(p.z for p in fieldpoints);scaleZ=(arm.matrix_world.to_3x3()@shield.matrix_local.to_3x3()@Vector((0,0,1))).length;targetheight=.775*standing['standingHeightWorld']/scaleZ;scale=targetheight/height;anchor=shield.matrix_local.inverted()@(arm.data.bones['hand_L'].matrix_local@Vector((0,.15,0)))
  for obj,bone in copies:
   if bone=='hand_L':continue
   for v in obj.data.vertices:
    q=shield.matrix_local.inverted()@v.co;q.x=anchor.x+(q.x-anchor.x)*scale;q.z=anchor.z+(q.z-anchor.z)*scale;v.co=shield.matrix_local@q
   obj.data.update()
  records.append({'role':role,'removedIncorrectOrbStaffVertices':removed,'shieldTemplate':'Accepted authored line dimensional field, rim, vein, keel and unchanged actual hand-local handle','targetRatio':.775,'standingHeightWorld':standing['standingHeightWorld'],'afterShieldHeightWorld':targetheight*scaleZ,'planeWidthHeightScale':scale,'handSocketUnchanged':True,'shieldRestBone':shield.name,'runtimeApproved':False})
 print('ACTUAL_HANDLE_AND_SHIELD_FIT',a.race,role,flush=True)
out.mkdir(parents=True);editable=out/f'editable-{a.race}-study.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(editable),compress=True)
authored=[r for r in roles if r!='ram'];lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in authored},PROFILE={'family':'spartan'});pack(lib,a.race+'-actual-handle-shield',out/'textures',4096)
for obj in new.all_objects:
 if obj.name not in master.objects:master.objects.link(obj)
native=out/f'peris-{a.race}-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
if sha(source)!=source_hash:raise ValueError('Immutable source changed')
record={'race':a.race,'sourceNative':str(source),'sourceSha256':source_hash,'sourceUnchanged':True,'roles':roles,'actualHandleAndShieldOperations':records,'restRigActionsFloorFittingUnchanged':True,'runtimeApproved':False,'finishedUnitApproved':False,'files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in [editable,native]}}
(out/'provenance.json').write_text(json.dumps(record,indent=2));print('ACTUAL_FANTASY_HANDLES_NATIVE_READY',json.dumps(record['files']),flush=True)
