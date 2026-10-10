"""Read-only exact retained weapon components near the actual posed palm."""
import bpy,bmesh,json,sys,pathlib
from mathutils import Vector
out=pathlib.Path(sys.argv[sys.argv.index('--')+1]);col=bpy.data.collections['PERIS_EXPORT'];rows=[]
for role in ['spear_guard','elite','scout','light_cavalry','heavy_cavalry']:
 body=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and ('textured anatomy' in o.name or 'mounted rider' in o.name) and any(m.type=='ARMATURE' and 'hand_R' in m.object.data.bones for m in o.modifiers))
 arm=next(m.object for m in body.modifiers if m.type=='ARMATURE');arm.animation_data.action=None
 for t in arm.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
 bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();ev=body.evaluated_get(deps);posed=ev.to_mesh()
 names={g.index:g.name for g in body.vertex_groups};bm=bmesh.new();bm.from_mesh(body.data);bm.verts.ensure_lookup_table();pending=set(bm.verts)
 while pending:
  seed=pending.pop();part={seed};todo=[seed]
  while todo:
   for e in todo.pop().link_edges:
    for v in e.verts:
     if v in pending:pending.remove(v);part.add(v);todo.append(v)
  ids=[v.index for v in part];weights={}
  for i in ids:
   for g in body.data.vertices[i].groups:weights[names[g.group]]=weights.get(names[g.group],0)+g.weight/len(ids)
  dominant=max(weights,key=weights.get) if weights else ''
  if not (weights.get(dominant,0)>.95):continue
  r={'role':role,'body':body.name,'dominant':dominant,'weight':weights.get(dominant),'vertices':len(ids),'firstVertex':ids[0]}
  for side in ['R','L']:
   inv=(arm.matrix_world@arm.pose.bones['hand_'+side].matrix).inverted();ps=[inv@body.matrix_world@posed.vertices[i].co for i in ids]
   r[side]={'min':[min(p[j] for p in ps) for j in range(3)],'max':[max(p[j] for p in ps) for j in range(3)],'nearest':min((p-Vector((0,.15,0))).length for p in ps)}
  rows.append(r)
 bm.free();ev.to_mesh_clear()
allmesh=[]
for o in col.all_objects:
 if o.type=='MESH' and o.get('peris_role') in ['spear_guard','light_cavalry']:
  allmesh.append({'name':o.name,'vertices':len(o.data.vertices),'groups':[g.name for g in o.vertex_groups if any(vg.group==g.index and vg.weight>.1 for v in o.data.vertices for vg in v.groups)],'newComponent':o.name in bpy.data.collections['FANTASY_PORTRAIT_NEW_COMPONENTS'].objects})
out.write_text(json.dumps({'components':rows,'meshes':allmesh},indent=2));print('GRIP_COMPONENT_PROBE',len(rows),flush=True)
