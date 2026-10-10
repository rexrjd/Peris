"""Bounded shield-plane sizing around an unchanged actual hand/socket anchor.

Caller saves a NEW native edition and inspects actual idle/attack body, weapon
and mount clearance. No actions, rigs, rest/binds, handles or skin weights change.
"""
import bpy,math
from mathutils import Vector

def _rest_to_arm(obj,arm):return arm.matrix_world.inverted()@obj.matrix_world

def _weighted(obj,vertex,names,minimum=.5):
 ids={g.index for g in obj.vertex_groups if g.name in names}
 return sum(g.weight for g in vertex.groups if g.group in ids)>minimum

def standing_body_height(collection,role,arm):
 """Use skeletal rest landmarks and an actual credited head when available.

 The rest body height is independent of seated pose and mounted parent height.
 Helmet/shield/cloth objects are excluded. The bare credited anatomy is preferred
 for the skull top; pure bone rest endpoints provide an explicit fallback.
 """
 head_names=[n for n in ['prop-head','head','Head'] if n in arm.data.bones]
 foot_names=[n for n in ['foot_L','foot_R','Foot_L','Foot_R'] if n in arm.data.bones]
 if not head_names or not foot_names:raise ValueError('Explicit humanoid head/foot rest bones required for '+role)
 top=max(p.z for n in head_names for p in [arm.data.bones[n].head_local,arm.data.bones[n].tail_local]);bottom=min(p.z for n in foot_names for p in [arm.data.bones[n].head_local,arm.data.bones[n].tail_local]);head_sources=[]
 for obj in collection.all_objects:
  if obj.type!='MESH' or obj.get('peris_role')!=role or obj.parent!=arm:continue
  partition=str(obj.get('peris_atlas_partition',''))
  if not (partition.startswith('licensed-') or obj.get('asset_license')=='CC-BY-4.0' or obj.get('peris_component_credit')):continue
  if obj.get('original_peris_equipment',False):continue
  transform=_rest_to_arm(obj,arm);points=[transform@v.co for v in obj.data.vertices if _weighted(obj,v,head_names,.9)]
  if points:
   measured=max(p.z for p in points);top=max(top,measured);head_sources.append({'mesh':obj.name,'selectedBareHeadVertices':len(points),'maximumRestLocalZ':measured})
 height=top-bottom
 if height<=0 or not math.isfinite(height):raise ValueError('Invalid humanoid standing height')
 world_scale=(arm.matrix_world.to_3x3()@Vector((0,0,1))).length
 return {'role':role,'rig':arm.name,'standingHeightRestLocal':height,'standingHeightWorld':height*world_scale,'restSkullTopLocalZ':top,'restFootLandmarkBottomLocalZ':bottom,'worldScaleAlongRestBodyUp':world_scale,'headRestBones':head_names,'footRestBones':foot_names,'bareCreditedHeadMeasurements':head_sources,'method':'Bare credited head rest vertices where available; explicit humanoid head/foot rest endpoints. Armor, helm, mounted seat pose and mount elevation excluded.','headGeometryFallbackToSkeletalEndpoints':not bool(head_sources)}

def fit_role_shield(collection,role,target_ratio=.775,hand_center=(0,.15,0),shield_selector=None,body_height=None):
 """Scale field/rim/boss in the shield plane; retain depth and the hand shaft.

 Default selector: actual prop-shield weights>.9 on humanoid rider/body meshes.
 Generated hands/handle bound to hand_L remain untouched. A caller with explicit
 unjoined field/rim/device semantics may pass selector(object,vertex)->bool.
 Optional body_height accepts a measured local rest body height. No file I/O.
 """
 if not .10<=target_ratio<=.95:raise ValueError('Requested shield ratio must be a practical positive fraction of standing height (.10–.95)')
 meshes=[o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role and o.parent and o.parent.type=='ARMATURE' and 'hand_L' in o.parent.data.bones]
 if not meshes:return {'role':role,'changed':False,'reason':'No humanoid left-hand semantic rig'}
 arms=list({o.parent for o in meshes})
 if len(arms)!=1:raise ValueError('Ambiguous humanoid shield rig in '+role)
 arm=arms[0]
 if 'prop-shield' not in arm.data.bones:return {'role':role,'changed':False,'reason':'No prop-shield bone; caller must provide a semantic plane adapter'}
 basis=arm.data.bones['prop-shield'].matrix_local;inverse=basis.inverted();anchor_arm=arm.data.bones['hand_L'].matrix_local@Vector(hand_center);anchor=inverse@anchor_arm;selected=[];points=[]
 for obj in meshes:
  transform=_rest_to_arm(obj,arm);items=[]
  for vertex in obj.data.vertices:
   choose=shield_selector(obj,vertex) if shield_selector else _weighted(obj,vertex,['prop-shield'],.9)
   if choose:
    point=inverse@transform@vertex.co;items.append((vertex.index,point.copy()));points.append(point)
  if items:selected.append((obj,transform,items))
 if not points:return {'role':role,'changed':False,'reason':'No actual prop-shield geometry; never scale the whole hand/forearm by guessing'}
 lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)]);dimensions=hi-lo
 if dimensions.z<=.01 or dimensions.x<=.01:raise ValueError('Degenerate selected shield field')
 standing=standing_body_height(collection,role,arm)
 if body_height is not None:standing['standingHeightRestLocal']=float(body_height);standing['standingHeightWorld']=float(body_height)*standing['worldScaleAlongRestBodyUp'];standing['callerExplicitHeightOverride']=True
 plane_z_world=(arm.matrix_world.to_3x3()@basis.to_3x3()@Vector((0,0,1))).length;plane_x_world=(arm.matrix_world.to_3x3()@basis.to_3x3()@Vector((1,0,0))).length;target_world=standing['standingHeightWorld']*target_ratio;target_local=target_world/plane_z_world;scale=target_local/dimensions.z
 before={'heightLocal':dimensions.z,'widthLocal':dimensions.x,'depthLocal':dimensions.y,'heightWorld':dimensions.z*plane_z_world,'widthWorld':dimensions.x*plane_x_world,'ratioToStandingHeight':dimensions.z*plane_z_world/standing['standingHeightWorld']}
 changed=0
 for obj,transform,items in selected:
  to_mesh=transform.inverted()
  for index,point in items:
   point.x=anchor.x+(point.x-anchor.x)*scale;point.z=anchor.z+(point.z-anchor.z)*scale;obj.data.vertices[index].co=to_mesh@basis@point;changed+=1
  obj.data.update()
 after={'heightLocal':dimensions.z*scale,'widthLocal':dimensions.x*scale,'depthLocal':dimensions.y,'heightWorld':target_world,'widthWorld':dimensions.x*scale*plane_x_world,'ratioToStandingHeight':target_ratio}
 return {'role':role,'changed':True,'method':'Actual shield-bone field/rim/boss selection scaled uniformly in plane around unchanged actual hand socket. Normal/depth coordinates preserved; hand_L handle/body geometry untouched.','targetRatio':target_ratio,'standingBody':standing,'before':before,'after':after,'planeScale':scale,'shieldRestBone':'prop-shield','handRestBone':'hand_L','handLocalSocket':list(hand_center),'anchorArmRest':list(anchor_arm),'anchorShieldRest':list(anchor),'verticesChanged':changed,'selectedMeshes':[o.name for o,_,_ in selected],'newBones':0,'actionsChanged':False,'skinWeightsChanged':False,'bindMatricesChanged':False,'handleGeometryChanged':False,'requiresActualIdleAttackClearanceReview':True,'runtimeApproved':False,'finishedArtApproved':False}
