"""Explicit plane adapter for original separate Dwarf/Gnome field parts."""
import bpy,json
from mathutils import Vector
import prototype_shield_fit as fit
import dwarf_gnome_quality as q

def actual_standing_body_height(col,role,arm):
 """Visible bare skull and actual boot soles; no bone endpoints or animals."""
 head=[];feet=[];sources=[];faction=json.loads(arm['peris_dwarf_gnome_head_fit'])['faction'];idle_head=[];idle_feet=[];deps=bpy.context.evaluated_depsgraph_get()
 for o in col.all_objects:
  if o.type!='MESH' or o.get('peris_role')!=role or o.parent!=arm:continue
  transform=arm.matrix_world.inverted()@o.matrix_world;names={g.index:g.name for g in o.vertex_groups}
  licensed=str(o.get('peris_atlas_partition','')).startswith('licensed-') and not o.get('original_peris_equipment',False)
  if faction=='dwarf':licensed=licensed and 'adapted Body_low' in o.name
  ev=o.evaluated_get(deps);em=ev.to_mesh()
  for v in o.data.vertices:
   p=transform@v.co
   if licensed and sum(w.weight for w in v.groups if names.get(w.group) in ['head','prop-head'])>.9:head.append(p.z);idle_head.append((ev.matrix_world@em.vertices[v.index].co).z)
   if sum(w.weight for w in v.groups if names.get(w.group,'').lower().startswith(('foot','toe')))>.35:feet.append(p.z);idle_feet.append((ev.matrix_world@em.vertices[v.index].co).z)
  ev.to_mesh_clear()
  if licensed:sources.append(o.name)
 if not head or not feet:raise ValueError('Require actual visible bare head and foot geometry '+role)
 top=max(head);bottom=min(feet);height=top-bottom;worldscale=(arm.matrix_world.to_3x3()@Vector((0,0,1))).length
 return {'role':role,'rig':arm.name,'standingHeightRestLocal':height,'standingHeightWorld':height*worldscale,'actualBareSkullTopRestLocalZ':top,'actualBootSoleRestLocalZ':bottom,'actualHeadVertices':len(head),'actualFootSoleVertices':len(feet),'bareHeadMeshes':sources,'actualCurrentIdleSkullToSoleWorldHeight':max(idle_head)-min(idle_feet),'method':'Actual credited bare skin skull geometry (Dwarf hair/braids/eyes excluded) plus visible boot/sole vertices weighted to this humanoid foot/toe joints in standing-rest coordinates. Current idle world-height independently recorded. No empty bone endpoints, helmet, carried equipment or mount.'}

def apply_shield_size(col,role,faction,target_ratio=.60):
 field=next((o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and 'Convex thick portrait shield continuous field' in o.name),None)
 if field is None:return {'role':role,'changed':False,'reason':'No carried shield; scout/bow/siege source retained'}
 arm=field.parent;bone=arm.data.bones['hand_L'];basis=bone.matrix_local;inv=basis.inverted();c=Vector((0,.15,0));p=[inv@v.co for v in field.data.vertices];n=(len(p)-2)//2
 up=((p[4]-(p[1]+p[7])*.5) if faction=='dwarf' else p[1]-p[17]).normalized();front=(p[0]-p[n+1]).normalized();across=up.cross(front).normalized()
 height=max((v-c).dot(up) for v in p)-min((v-c).dot(up) for v in p);width=max((v-c).dot(across) for v in p)-min((v-c).dot(across) for v in p);standing=actual_standing_body_height(col,role,arm);target=target_ratio*standing['standingHeightRestLocal'];scale=target/height
 actual=(arm.matrix_world@arm.pose.bones['hand_L'].matrix).to_3x3();newup=up.copy();newfront=front.copy();mounted=role in ['light_cavalry','heavy_cavalry']
 if mounted:
  handworld=arm.matrix_world@arm.pose.bones['hand_L'].matrix@c;mount=arm.parent;sign=1 if handworld.y>=mount.matrix_world.translation.y else -1;newup=(actual.inverted()@Vector((0,0,1))).normalized();newfront=(actual.inverted()@Vector((0,sign,0))).normalized();newacross=newup.cross(newfront).normalized();newfront=newacross.cross(newup).normalized()
 else:newacross=across.copy()
 glove=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and 'connected fitted hand_L glove' in o.name);extent=max((inv@v.co-c).dot(newfront) for v in glove.data.vertices);rear=min((v-c).dot(front) for v in p);shift=max(0,extent+.025-rear)
 selected=[o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and any(term in o.name for term in ['Convex thick portrait shield continuous field','Shield substantial exposed bent copper rim','Raised dimensional shield clan diamond'])]
 for o in selected:
  for v in o.data.vertices:
   d=inv@v.co-c;v.co=basis@(c+newacross*d.dot(across)*scale+newup*d.dot(up)*scale+newfront*(d.dot(front)+shift))
  o.data.update();o['peris_requested_shield_ratio']=target_ratio
 bracket_names=['Shield real rear grip support bracket','Shield requested-height actual rear grip support']
 trim=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and any(term in o.name for term in bracket_names)).data.materials[0];oldbrackets=[]
 for o in list(col.all_objects):
  if o.type=='MESH' and o.get('peris_role')==role and any(term in o.name for term in bracket_names):oldbrackets.append(o.name);bpy.data.objects.remove(o,do_unlink=True)
 for z in [-.15,.15]:q.curve('Shield requested-height actual rear grip support bracket',[basis@(c+Vector((0,0,z))),basis@(c+newup*(z*scale)+newfront*(rear+shift))],.014,arm,role,'hand_L',trim,col)
 report={'role':role,'changed':True,'targetRatio':target_ratio,'standingBody':standing,'before':{'heightRestLocal':height,'widthRestLocal':width,'ratio':height/standing['standingHeightRestLocal']},'after':{'heightRestLocal':target,'widthRestLocal':width*scale,'ratio':target_ratio},'uniformPlaneScale':scale,'selectedFieldRimDevice':[o.name for o in selected],'handLocalSocket':list(c),'handShaftAndGloveGeometryUnchanged':True,'sourceActionsRigRestAndWeightsUnchanged':True,'fieldDepthUnchanged':True,'additionalRearGloveClearance':shift,'minimumRearGloveClearance':rear+shift-extent,'mountedOutwardGuardPlane':mounted,'oldIdleUpWorld':list((actual@up).normalized()),'newIdleUpWorld':list((actual@newup).normalized()),'originalBracketsReplaced':oldbrackets,'physicalContinuousRearSupportBrackets':2,'runtimeApproved':False,'finishedArtApproved':False,'requiresActualIdleAttackBodyMountClearanceReview':True};arm['peris_dwarf_gnome_shield_size']=json.dumps(report);return report
