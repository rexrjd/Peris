"""Explicit field indices, fixed hand socket, pose-preserving hand binding.

Caller supplies actual field/rim indices from a source whose topology matches.
No hand/forearm guess, file I/O, rest-bone edits, or action authoring occurs.
"""
import bpy
from mathutils import Vector
from prototype_shield_fit import standing_body_height

def resize_bound_field(collection,role,field_indices,target_ratio=.60,hand_center=(0,.15,0),bind_to_hand=True,shield_bone='prop-shield'):
 objects={o.name:o for o in collection.all_objects};selected=[]
 for name,ids in field_indices.items():
  obj=objects[name];arm=next(m.object for m in obj.modifiers if m.type=='ARMATURE')
  selected.append((obj,arm,list(ids)))
 if not selected:return {'role':role,'changed':False,'reason':'No explicitly selected shield field'}
 arms={arm for _,arm,_ in selected}
 if len(arms)!=1:raise ValueError('Explicit field must share one rider/body rig')
 arm=next(iter(arms));B=arm.data.bones[shield_bone].matrix_local;H=arm.data.bones['hand_L'].matrix_local;inv=B.inverted();anchor=inv@H@Vector(hand_center);standing=standing_body_height(collection,role,arm)
 # Restore selected original prop-shield binding before sizing so the current
 # reference pose remains the original held shield angle. A previous derivative
 # may have made a rest-only hand binding without preserving this angle.
 for obj,_,ids in selected:
  group=obj.vertex_groups.get(shield_bone) or obj.vertex_groups.new(name=shield_bone)
  for i in ids:
   for g in list(obj.data.vertices[i].groups):obj.vertex_groups[g.group].remove([i])
   group.add([i],1,'REPLACE')
  obj.data.update()
 bpy.context.view_layer.update()
 original={obj.name:{i:obj.data.vertices[i].co.copy() for i in ids} for obj,_,ids in selected}
 def extent():
  points=[];deps=bpy.context.evaluated_depsgraph_get()
  for obj,_,ids in selected:
   ev=obj.evaluated_get(deps);m=ev.to_mesh();points.extend(ev.matrix_world@m.vertices[i].co for i in ids);ev.to_mesh_clear()
  lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)]);return hi-lo
 before=extent();target=standing['standingHeightWorld']*target_ratio;factor=target/before.z
 def apply(scale):
  for obj,_,ids in selected:
   T=arm.matrix_world.inverted()@obj.matrix_world;back=T.inverted()
   for i in ids:
    point=inv@T@original[obj.name][i];point.x=anchor.x+(point.x-anchor.x)*scale;point.z=anchor.z+(point.z-anchor.z)*scale;obj.data.vertices[i].co=back@B@point
   obj.data.update()
  bpy.context.view_layer.update()
 apply(factor);factor*=target/extent().z;apply(factor);after=extent()
 old_deform=arm.pose.bones[shield_bone].matrix@B.inverted();new_deform=arm.pose.bones['hand_L'].matrix@H.inverted();map_to_hand=new_deform.inverted()@old_deform
 if bind_to_hand:
  for obj,_,ids in selected:
   T=arm.matrix_world.inverted()@obj.matrix_world;back=T.inverted();group=obj.vertex_groups.get('hand_L') or obj.vertex_groups.new(name='hand_L')
   for i in ids:
    obj.data.vertices[i].co=back@map_to_hand@T@obj.data.vertices[i].co
    for g in list(obj.data.vertices[i].groups):obj.vertex_groups[g.group].remove([i])
    group.add([i],1,'REPLACE')
   obj.data.update()
 bpy.context.view_layer.update();bound=extent()
 if (bound-after).length>.00015:raise RuntimeError('Pose-preserving field binding changed actual reference silhouette')
 return {'role':role,'changed':True,'targetRatio':target_ratio,'actualBeforeWorldExtent':list(before),'actualAfterWorldExtent':list(bound),'actualAfterStandingRatio':bound.z/standing['standingHeightWorld'],'standingBody':standing,'planeScale':factor,'handSocket':list(hand_center),'selectedVertices':sum(len(ids) for _,_,ids in selected),'fieldIndices':field_indices,'originalShieldBone':shield_bone,'posePreservingHandBinding':bind_to_hand,'mapOriginalShieldRestToHandRest':[list(r) for r in map_to_hand],'anchorShieldRest':list(anchor),'referencePose':'saved baseline idle1','actionsBonesRestBindsUnchanged':True,'handleAndHandGeometryUnchanged':True,'finishedArtApproved':False}

def field_point_after_fit(arm,point,record):
 from mathutils import Matrix
 B=arm.data.bones[record.get('originalShieldBone','prop-shield')].matrix_local;p=B.inverted()@Vector(point);a=Vector(record['anchorShieldRest']);scale=record['planeScale'];p.x=a.x+(p.x-a.x)*scale;p.z=a.z+(p.z-a.z)*scale;p=B@p
 return Matrix(record['mapOriginalShieldRestToHandRest'])@p if record['posePreservingHandBinding'] else p

def fit_existing_brackets(collection,role,arm,anchors,hand_center,record,partition,shaft_half_length=.12,radius=.035):
 """Move the existing bracket field ends while preserving its hand ends.

 Selection is restricted to an explicit bracket partition and the original
 small-radius segments, excluding the larger central handle shaft and glove.
 """
 H=arm.data.bones['hand_L'].matrix_local;center=H@Vector(hand_center);axis=(H.to_3x3()@Vector((0,0,1))).normalized();rows=[]
 for obj in list(collection.all_objects):
  if obj.type!='MESH' or obj.get('peris_role')!=role or obj.get('peris_atlas_partition')!=partition:continue
  T=arm.matrix_world.inverted()@obj.matrix_world;back=T.inverted();names={g.index:g.name for g in obj.vertex_groups};count=0
  for v in obj.data.vertices:
   if sum(g.weight for g in v.groups if names[g.group]=='hand_L')<.95:continue
   point=T@v.co;candidates=[]
   for k,anchor in enumerate(anchors):
    anchor=Vector(anchor);end=center+axis*((-1 if k==0 else 1)*shaft_half_length);delta=anchor-end;t=(point-end).dot(delta)/delta.length_squared;nearest=end+delta*max(0,min(1,t))
    if -.05<t<1.05 and (point-nearest).length<radius:candidates.append(((point-nearest).length,k,max(0,min(1,t)),anchor))
   if candidates:
    _,k,t,anchor=min(candidates);point+=(field_point_after_fit(arm,anchor,record)-anchor)*t;v.co=back@point;count+=1
  obj.data.update();rows.append({'mesh':obj.name,'bracketVerticesAdjusted':count,'handleEndsUnchanged':True})
 return rows

def clone_field_part(collection,source,ids,target_arm,role,target_bone='prop-shield',source_bone='prop-shield',name='reused shield field'):
 from mathutils import Matrix
 source_arm=next(m.object for m in source.modifiers if m.type=='ARMATURE');T=source_arm.matrix_world.inverted()@source.matrix_world;mapping=target_arm.data.bones[target_bone].matrix_local@source_arm.data.bones[source_bone].matrix_local.inverted()@T;allowed=set(ids);faces=[f for f in source.data.polygons if all(i in allowed for i in f.vertices)];used=sorted({i for f in faces for i in f.vertices});index={old:new for new,old in enumerate(used)};data=bpy.data.meshes.new(name);data.from_pydata([mapping@source.data.vertices[i].co for i in used],[],[tuple(index[i] for i in f.vertices) for f in faces]);data.update();obj=bpy.data.objects.new(role+' '+name,data);collection.objects.link(obj);obj.parent=target_arm;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_basis=Matrix.Identity(4);obj.vertex_groups.new(name=target_bone).add(list(range(len(used))),1,'REPLACE');modifier=obj.modifiers.new('Existing shield support rig','ARMATURE');modifier.object=target_arm
 for mat in source.data.materials:data.materials.append(mat)
 uv=data.uv_layers.new(name='Source field preserved UV');old_uv=source.data.uv_layers.active
 for newface,oldface in zip(data.polygons,faces):
  newface.material_index=oldface.material_index;newface.use_smooth=oldface.use_smooth
  for li,oldli in zip(newface.loop_indices,oldface.loop_indices):uv.data[li].uv=old_uv.data[oldli].uv
 obj['peris_role']=role;obj['peris_atlas_partition']='original-reused-shield-field';obj['asset_author']='Peris original shield and Wildfire Games retained rig';obj['asset_license']='CC-BY-SA-3.0';obj['original_peris_equipment']=True;obj['peris_unit_finished']=False;obj['runtime_approved']=False
 return obj,list(range(len(used)))
