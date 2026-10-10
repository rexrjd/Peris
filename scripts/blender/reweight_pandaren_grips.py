"""Fit new bear digits to the retained articulated source finger chains."""
import argparse,bpy,pathlib,sys,json,hashlib
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--native',required=True);p.add_argument('--out',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
source=pathlib.Path(a.native).resolve();out=ROOT/'assets/source/battle'/a.out
if out.exists():raise FileExistsError(str(out))
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();before=sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False);collection=bpy.data.collections['PERIS_EXPORT'];records=[]
for obj in list(collection.all_objects):
 if obj.type!='MESH' or obj.get('peris_atlas_partition')!='original-bear-detail' or obj.get('peris_role') in ('ram','catapult'):continue
 arm=next(m.object for m in obj.modifiers if m.type=='ARMATURE');transform=arm.matrix_world.inverted()@obj.matrix_world
 for side in ('L','R'):
  hand=arm.data.bones['hand_'+side];finger=arm.data.bones['finger_'+side];tip=arm.data.bones['fingertip_'+side]
  group=obj.vertex_groups.get(hand.name)
  if not group:continue
  ids=[v.index for v in obj.data.vertices if any(g.group==group.index and g.weight>.99 for g in v.groups)]
  direction=(finger.head_local-hand.head_local).normalized();cross=Vector((1,0,0));cross=(cross-direction*cross.dot(direction)).normalized()
  first=(finger.head_local-hand.head_local).length;second=max(.01,(tip.head_local-finger.head_local).dot(direction));changed=0
  target={n:obj.vertex_groups.get(n) or obj.vertex_groups.new(name=n) for n in (hand.name,finger.name,tip.name)}
  for i in ids:
   position=transform@obj.data.vertices[i].co;d=position-hand.head_local;projection=d.dot(direction)
   if abs(d.dot(cross))>.115 or projection<first*.55:continue
   to_finger=max(0,min(1,(projection-first*.55)/max(.01,first*.45)))
   to_tip=max(0,min(1,(projection-first-second*.55)/max(.01,second*.45)))
   weights={hand.name:1-to_finger,finger.name:to_finger*(1-to_tip),tip.name:to_finger*to_tip}
   for name,g in target.items():
    g.remove([i])
    if weights[name]>1e-6:g.add([i],weights[name],'REPLACE')
   changed+=1
  records.append({'role':obj.get('peris_role'),'mesh':obj.name,'side':side,'reweightedNewDigitVertices':changed,'originalHandBone':hand.name,'originalFingerBone':finger.name,'originalFingertipBone':tip.name,'newBones':0,'originalActionsChanged':False});print('ARTICULATED_BEAR_GRIP',records[-1],flush=True)
for obj in collection.all_objects:
 if obj.type=='ARMATURE':
  obj.animation_data.action=None
  for t in obj.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update();out.mkdir(parents=True);native=out/'peris-pandaren-army.blend';bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
if sha(source)!=before:raise ValueError('Original source changed')
(out/'native-provenance.json').write_text(json.dumps({'edition':a.out,'sourceNative':str(source),'sourceNativeSha256':before,'sourceNativeUnchanged':True,'grips':records,'native':{'path':str(native),'sha256':sha(native)},'runtimeApproved':False},indent=2)+'\n');print('PANDA_ARTICULATED_GRIPS_READY',str(native),flush=True)
