"""Reuse the validated connected closed-hand sculpt for bear weapon grips.

The archer keeps its original articulated draw/finger chain and receives a
charcoal surface. Shield sizes, heads, kit, source sockets and actions stay put.
"""
import argparse,bpy,bmesh,pathlib,sys,json,hashlib,types
from mathutils import Matrix,Vector
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from orc_mounted_hand_geometry_v11 import _make_local
from pandaren_quality import material
import roster_atlas
p=argparse.ArgumentParser();p.add_argument('--native',required=True);p.add_argument('--out',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
source=pathlib.Path(a.native).resolve();out=ROOT/'assets/source/battle'/a.out
if out.exists():raise FileExistsError(str(out))
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();before=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False);collection=bpy.data.collections['PERIS_EXPORT'];records=[]
detail=bpy.data.collections.new('PERIS_CLOSED_BEAR_GRIPS');bpy.context.scene.collection.children.link(detail)
black=material('Original charcoal bear connected gripping glove',(.026,.025,.022))
cache={}
for side in ('L','R'):
 obj,report=_make_local(side,None,.045);cache[side]=(obj.data.copy(),report);bpy.data.objects.remove(obj,do_unlink=True)
family={'hand_L','hand_R','finger_L','finger_R','fingertip_L','fingertip_R'}
for role in ['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry']:
 parts=[o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role and o.get('peris_atlas_partition')=='original-bear-detail']
 arm=next(m.object for o in parts for m in o.modifiers if m.type=='ARMATURE')
 removed=0
 for obj in parts:
  bm=bmesh.new();bm.from_mesh(obj.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in obj.vertex_groups}
  vertices=[v for v in bm.verts if sum(w for i,w in v[layer].items() if names.get(i) in family)>.95]
  removed+=len(vertices);bmesh.ops.delete(bm,geom=vertices,context='VERTS');bm.to_mesh(obj.data);bm.free();obj.data.update()
 if role=='archer':
  body=next(o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role and o.get('peris_atlas_partition')!='original-bear-detail' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers))
  original=ROOT/'assets/source/battle/pandaren-quality-roster-v4/peris-pandaren-army.blend';mesh_name=body.data.name
  with bpy.data.libraries.load(str(original),link=False) as (available,loaded):
   if mesh_name not in available.meshes:raise ValueError('Original articulated archer mesh missing '+mesh_name)
   loaded.meshes=[mesh_name]
  body.data=loaded.meshes[0];body.data.materials.append(black);slot=len(body.data.materials)-1;names={g.index:g.name for g in body.vertex_groups};colored=0
  for face in body.data.polygons:
   if sum(sum(g.weight for g in body.data.vertices[i].groups if names[g.group] in family) for i in face.vertices)/len(face.vertices)>.55:face.material_index=slot;colored+=1
  records.append({'role':role,'removedNewRigidGripVertices':removed,'restoredArticulatedArcherSource':str(original),'sourceFingerActionsRetained':True,'charcoalSourceHandFaces':colored});continue
 for side in ('L','R'):
  data=cache[side][0].copy();data.transform(arm.data.bones['hand_'+side].matrix_local);obj=bpy.data.objects.new(role+' connected bear '+side+' weapon grip',data);detail.objects.link(obj);obj.parent=arm;obj.matrix_basis=Matrix.Identity(4);obj.matrix_parent_inverse=Matrix.Identity(4);data.materials.clear();data.materials.append(black)
  group=obj.vertex_groups.new(name='hand_'+side);group.add(list(range(len(data.vertices))),1,'REPLACE');mod=obj.modifiers.new('Unchanged existing hand socket','ARMATURE');mod.object=arm
  obj['peris_role']=role;obj['asset_license']='CC-BY-SA-3.0';obj['asset_author']='Peris: adapted original connected grip sculpt on retained Wildfire Games rig';obj['peris_atlas_partition']='original-connected-bear-grip';obj['runtime_approved']=False
 records.append({'role':role,'removedNewRigidGripVertices':removed,'closedConnectedGripConstruction':{s:cache[s][1] for s in cache},'gripShaftRadius':.045,'sourceWeaponsUnchanged':True,'sourceBonesAndActionsUnchanged':True});print('CLOSED_BEAR_ROLE_READY',role,flush=True)
out.mkdir(parents=True);lib=types.SimpleNamespace(collection=detail,groups={},PROFILE={'family':'egyptian'});roster_atlas.pack(lib,'pandaren',out/'textures/grips',size=1024)
for obj in list(detail.objects):detail.objects.unlink(obj);collection.objects.link(obj)
bpy.data.collections.remove(detail)
for obj in collection.all_objects:
 if obj.type=='ARMATURE':
  obj.animation_data.action=None
  for t in obj.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update();bpy.ops.file.pack_all();native=out/'peris-pandaren-army.blend';bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
if sha(source)!=before:raise ValueError('Original source changed')
(out/'native-provenance.json').write_text(json.dumps({'edition':a.out,'sourceNative':str(source),'sourceNativeSha256':before,'sourceNativeUnchanged':True,'grips':records,'native':{'path':str(native),'sha256':sha(native)},'runtimeApproved':False},indent=2)+'\n');print('PANDA_CLOSED_GRIPS_READY',str(native),flush=True)
