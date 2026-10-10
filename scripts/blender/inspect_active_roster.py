"""Read-only native roster inventory for deliberate derivative work."""
import argparse,json,pathlib,sys,bpy
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--native',required=True);p.add_argument('--out',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);bpy.ops.wm.open_mainfile(filepath=str(pathlib.Path(a.native).resolve()),use_scripts=False)
c=bpy.data.collections['PERIS_EXPORT']
for arm in [o for o in c.all_objects if o.type=='ARMATURE']:
 if arm.animation_data:
  arm.animation_data.action=None
  for t in arm.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
d=bpy.context.evaluated_depsgraph_get();rows=[]
for o in c.all_objects:
 if o.type!='MESH':continue
 arm=next((m.object for m in o.modifiers if m.type=='ARMATURE'),None)
 ev=o.evaluated_get(d);me=ev.to_mesh();pts=[ev.matrix_world@v.co for v in me.vertices];ev.to_mesh_clear()
 rows.append({'name':o.name,'role':o.get('peris_role'),'vertices':len(o.data.vertices),'arm':arm.name if arm else None,'parentArm':arm.parent.name if arm and arm.parent else None,'materials':[m.name for m in o.data.materials],'bounds':[[min(v[i] for v in pts) for i in range(3)],[max(v[i] for v in pts) for i in range(3)]],'properties':{k:v for k,v in o.items() if k.startswith('peris_') and len(str(v))<500}})
arms=[{'name':o.name,'parent':o.parent.name if o.parent else None,'parentBone':o.parent_bone,'bones':[{ 'name':b.name,'head':list(o.matrix_world@o.pose.bones[b.name].head),'tail':list(o.matrix_world@o.pose.bones[b.name].tail)} for b in o.data.bones]} for o in c.all_objects if o.type=='ARMATURE']
path=pathlib.Path(a.out);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps({'meshes':rows,'arms':arms},indent=2,default=list));print('INVENTORY_READY',str(path),len(rows),flush=True)
