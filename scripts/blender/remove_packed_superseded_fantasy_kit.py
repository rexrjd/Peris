"""Remove superseded rigid source kit islands using armature-space measurements.

The incoming artist native is immutable. New portrait-kit collection parts are
excluded, while inherited joined meshes are measured after their object scale.
No rig, animation, rest transform, texture, or remaining vertex is modified.
"""
import argparse, hashlib, json, pathlib, sys
import bpy, bmesh

ROOT=pathlib.Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--race',required=True);p.add_argument('--source-edition',required=True);p.add_argument('--edition',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=ROOT/'assets/source/battle'/a.source_edition/f'peris-{a.race}-army.blend';out=ROOT/'assets/source/battle'/a.edition
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();original=sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False)
col=bpy.data.collections['PERIS_EXPORT'];new=set(bpy.data.collections['FANTASY_PORTRAIT_NEW_COMPONENTS'].all_objects)
records=[]
for role in ['line_infantry','spear_guard','elite']:
 for obj in list(col.all_objects):
  if obj.type!='MESH' or obj.get('peris_role')!=role or obj in new or str(obj.get('peris_atlas_partition','')).startswith('licensed-'):continue
  arms=[m.object for m in obj.modifiers if m.type=='ARMATURE' and m.object and 'hand_R' in m.object.data.bones]
  if not arms:continue
  arm=arms[0];matrix=arm.matrix_world.inverted()@obj.matrix_world
  bm=bmesh.new();bm.from_mesh(obj.data);layer=bm.verts.layers.deform.active
  if not layer:bm.free();continue
  names={g.index:g.name for g in obj.vertex_groups};pending=set(bm.verts);drop=[]
  while pending:
   seed=pending.pop();part={seed};todo=[seed]
   while todo:
    for edge in todo.pop().link_edges:
     for v in edge.verts:
      if v in pending:pending.remove(v);part.add(v);todo.append(v)
   weights={}
   for v in part:
    for index,weight in v[layer].items():weights[names[index]]=weights.get(names[index],0)+weight/len(part)
   points=[matrix@v.co for v in part];span=max(max(v[i] for v in points)-min(v[i] for v in points) for i in range(3))
   right=sum(weights.get(n,0) for n in ['hand_R','weapon_R','prop-weapon_R']);left=sum(weights.get(n,0) for n in ['hand_L','shield','prop-shield','shield_arm','prop-shield_arm'])
   if span>.60 and (right>.98 or (role=='elite' and left>.98)):
    drop.extend(part);records.append({'role':role,'object':obj.name,'vertices':len(part),'armatureSpaceSpan':span,'weightedSide':'R old weapon' if right>.98 else 'L old Elite field','averageWeights':weights})
  if drop:bmesh.ops.delete(bm,geom=drop,context='VERTS');bm.to_mesh(obj.data);obj.data.update()
  bm.free()
if not records:raise ValueError('No actual superseded rigid component found; refuse an unsupported repair claim')
out.mkdir(parents=True);native=out/f'peris-{a.race}-army.blend';bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
report={'sourceNative':str(source),'sourceSha256':original,'sourceUnchanged':sha(source)==original,'removedActualRigidIslands':records,'newPortraitComponentsExcluded':True,'measurement':'Object coordinates transformed to owning armature rest coordinates before .60 span selection','rigActionsRestMaterialsRemainingVerticesUnchanged':True,'runtimeApproved':False,'finishedUnitApproved':False,'files':{native.name:{'bytes':native.stat().st_size,'sha256':sha(native)}}}
(out/'provenance.json').write_text(json.dumps(report,indent=2)+'\n');print('PACKED_SUPERSEDED_KIT_REMOVED',json.dumps(report),flush=True)
