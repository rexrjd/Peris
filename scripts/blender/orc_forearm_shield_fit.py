"""Resize the actual forearm-bound Orc shields in their construction frame.

The source portrait kit uses forearm_L for fields, hand_L for handles, and
mixed weights for connecting straps. A prop-shield selector does not apply.
This helper selects connected geometry in the known authored shield region;
it preserves all weights and adjusts straps by their forearm fraction, leaving
the hand-side boundary and handle unchanged. No source file I/O is performed.
"""
import bpy,math
from mathutils import Vector
from prototype_shield_fit import standing_body_height
ROLES=('line_infantry','spear_guard','elite','light_cavalry','heavy_cavalry')

def select_field(collection,role):
 objects=list(collection.all_objects);meshes=[o for o in objects if o.type=='MESH' and o.get('peris_role')==role]
 arm=next(m.object for o in meshes for m in o.modifiers if m.type=='ARMATURE' and 'hand_L' in m.object.data.bones)
 fore=arm.data.bones['forearm_L'];origin=fore.head_local.lerp(fore.tail_local,.72)+Vector((.10,-.37,-.20));result=[];records=[]
 for obj in meshes:
  if next((m.object for m in obj.modifiers if m.type=='ARMATURE'),None)!=arm:continue
  transform=arm.matrix_world.inverted()@obj.matrix_world;names={g.index:g.name for g in obj.vertex_groups}
  ids={v.index for v in obj.data.vertices if sum(g.weight for g in v.groups if names[g.group] in ('forearm_L','hand_L'))>.99};adj={i:set() for i in ids}
  for edge in obj.data.edges:
   a,b=edge.vertices
   if a in ids and b in ids:adj[a].add(b);adj[b].add(a)
  pending=set(ids);selected=[]
  while pending:
   todo=[pending.pop()];piece=[]
   while todo:
    index=todo.pop();piece.append(index)
    for other in adj[index]:
     if other in pending:pending.remove(other);todo.append(other)
   points=[transform@obj.data.vertices[i].co-origin for i in piece];mean=sum(points,Vector())/len(points)
   has_forearm=any(any(names[g.group]=='forearm_L' and g.weight>.001 for g in obj.data.vertices[i].groups) for i in piece)
   if has_forearm and -.3<mean.y<.14 and -.8<mean.x<.8 and -1.3<mean.z<1.4:
    selected.extend(piece);records.append({'mesh':obj.name,'vertices':len(piece),'centroidConstructionFrame':list(mean)})
  if selected:result.append((obj,transform,selected))
 return arm,origin,result,records

def evaluated_vertical(selection):
 deps=bpy.context.evaluated_depsgraph_get();points=[]
 for obj,_,ids in selection:
  evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh();points.extend(evaluated.matrix_world@mesh.vertices[i].co for i in ids);evaluated.to_mesh_clear()
 return max(p.z for p in points)-min(p.z for p in points)

def visible_standing_height(collection,role,arm):
 # Physical idle foot-role silhouette: bare credited head and foot supports.
 # Mounted rider crouch must not define standing height; use its rest anatomy.
 if role in ('light_cavalry','heavy_cavalry'):
  report=standing_body_height(collection,role,arm);return report['standingHeightWorld'],report
 deps=bpy.context.evaluated_depsgraph_get();head=[];foot=[]
 for obj in list(collection.all_objects):
  if obj.type!='MESH' or obj.get('peris_role')!=role or obj.parent!=arm:continue
  evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh();names={g.index:g.name for g in obj.vertex_groups}
  for vertex in obj.data.vertices:
   if str(obj.get('peris_atlas_partition','')).startswith('licensed') and sum(g.weight for g in vertex.groups if names[g.group] in ('head','prop-head'))>.9:head.append((evaluated.matrix_world@mesh.vertices[vertex.index].co).z)
   if sum(g.weight for g in vertex.groups if names[g.group] in ('foot_L','foot_R'))>.9:foot.append((evaluated.matrix_world@mesh.vertices[vertex.index].co).z)
  evaluated.to_mesh_clear()
 if not head or not foot:raise ValueError('Actual credited bare head/foot points required for '+role)
 height=max(head)-min(foot);return height,{'method':'Actual saved upright idle1 bare credited head top minus original boot/foot support bottom; excludes helmet, hair, weapon and shield','bareHeadTopWorldZ':max(head),'footSupportBottomWorldZ':min(foot),'standingHeightWorld':height}

def fit_actual_orc_shield(collection,role,target_ratio=.775):
 if role not in ROLES:return {'role':role,'changed':False,'reason':'No authored carried shield in this role'}
 arm,origin,selection,islands=select_field(collection,role)
 if not selection:raise ValueError('Actual forearm-bound shield not found for '+role)
 arms=[o for o in list(collection.all_objects) if o.type=='ARMATURE'];scene=bpy.context.scene
 for a in arms:
  a.animation_data.action=None
  for track in a.animation_data.nla_tracks:track.mute=track.name!=role+'_idle'
 scene.frame_set(-1);scene.frame_set(1);bpy.context.view_layer.update()
 before=evaluated_vertical(selection);body,body_report=visible_standing_height(collection,role,arm);target=body*target_ratio;factor=target/before;anchor=arm.data.bones['hand_L'].matrix_local@Vector((0,.15,0));original={obj.name:{i:obj.data.vertices[i].co.copy() for i in ids} for obj,_,ids in selection}
 def apply(scale):
  for obj,transform,ids in selection:
   names={g.index:g.name for g in obj.vertex_groups};inverse=transform.inverted()
   for i in ids:
    vertex=obj.data.vertices[i];point=transform@original[obj.name][i];forearm=sum(g.weight for g in vertex.groups if names[g.group]=='forearm_L');delta=point-anchor;point+=Vector((delta.x,0,delta.z))*((scale-1)*forearm);vertex.co=inverse@point
   obj.data.update()
  bpy.context.view_layer.update()
 apply(factor);after=evaluated_vertical(selection)
 # Convex depth remains unchanged; one bounded correction compensates its
 # small contribution to world vertical extent in the held pose.
 factor*=target/after;apply(factor);after=evaluated_vertical(selection)
 if abs(after/body-target_ratio)>.008:raise RuntimeError('Actual visible shield ratio did not converge')
 return {'role':role,'changed':True,'constructionFrameOriginRest':list(origin),'anchorActualHandRest':list(anchor),'handLocalSocket':[0,.15,0],'selectedVertices':sum(len(ids) for _,_,ids in selection),'islandSelection':islands,'standingBody':body_report,'beforeActualIdleWorldVerticalHeight':before,'beforeActualStandingRatio':before/body,'afterActualIdleWorldVerticalHeight':after,'afterActualStandingRatio':after/body,'requestedRatio':target_ratio,'planeScale':factor,'method':'Explicit original Orc forearm-bound field/rim/device/brace region; uniform X/Z plane scale around actual hand socket. Mixed strap displacement weighted by original forearm fraction, preserving hand end. Convex normal/depth retained. Calibration uses actual upright visible height (mounted standing rest anatomy) rather than a silently skipped prop-shield selector.','handleGeometryUnchanged':True,'skinWeightsAndBindMatricesUnchanged':True,'actionsAndBonesUnchanged':True,'requiresIdleAttackAndMountContactReview':True,'finishedArtApproved':False}
