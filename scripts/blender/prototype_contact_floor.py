"""Bounded, explicit root-height animation derivative for prototype contact.

No bones/rest/binds are changed. Only object location Z keys in copied existing
NLA actions are added/changed. A caller must identify the actual support feet,
not a weapon tip or held rock. Artist strips and exported clip names stay intact.
"""
import bpy,hashlib,json,math
from mathutils import Vector

def _curve_signature(action,exclude_z=False):
 return hashlib.sha256(json.dumps([(f.data_path,f.array_index,[(list(k.co),k.interpolation) for k in f.keyframe_points]) for f in action.fcurves if not (exclude_z and f.data_path=='location' and f.array_index==2)],sort_keys=True).encode()).hexdigest()

def _snapshot(collection):
 arms=[o for o in collection.all_objects if o.type=='ARMATURE']
 return arms,{a.name:{'matrix':a.matrix_basis.copy(),'location':a.location.copy(),'rotationMode':a.rotation_mode,'rotationEuler':a.rotation_euler.copy(),'rotationQuaternion':a.rotation_quaternion.copy(),'rotationAxisAngle':list(a.rotation_axis_angle),'scale':a.scale.copy(),'pose':{b.name:b.matrix_basis.copy() for b in a.pose.bones},'action':a.animation_data.action,'mutes':{t.name:t.mute for t in a.animation_data.nla_tracks}} for a in arms},bpy.context.scene.frame_current

def _restore_object_components(a,row):
 a.location=row['location'].copy();a.rotation_mode=row['rotationMode'];a.scale=row['scale'].copy()
 if a.rotation_mode=='QUATERNION':a.rotation_quaternion=row['rotationQuaternion'].copy()
 elif a.rotation_mode=='AXIS_ANGLE':a.rotation_axis_angle=row['rotationAxisAngle']
 else:a.rotation_euler=row['rotationEuler'].copy()

def _pose(arms,saved,role,state,frame):
 for a in arms:
  a.animation_data.action=None;_restore_object_components(a,saved[a.name])
  for b in a.pose.bones:b.matrix_basis=saved[a.name]['pose'][b.name].copy()
  for t in a.animation_data.nla_tracks:t.mute=t.name!=role+'_'+state
 bpy.context.scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update()

def _restore(arms,saved,frame):
 for a in arms:
  a.animation_data.action=saved[a.name]['action']
  for t in a.animation_data.nla_tracks:t.mute=saved[a.name]['mutes'][t.name]
 bpy.context.scene.frame_set(frame)
 for a in arms:
  _restore_object_components(a,saved[a.name])
  for b in a.pose.bones:b.matrix_basis=saved[a.name]['pose'][b.name].copy()
 bpy.context.view_layer.update()

def _support(collection,role,support_bones,vertex_selector):
 result=[]
 for o in collection.all_objects:
  if o.type!='MESH' or o.get('peris_role')!=role:continue
  groups={g.index for g in o.vertex_groups if g.name in (support_bones or [])}
  if vertex_selector:ids=[v.index for v in o.data.vertices if vertex_selector(o,v)]
  else:ids=[v.index for v in o.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.5]
  if ids:result.append((o,ids))
 if not result:raise ValueError('Explicit floor support selector returned no vertices for '+role)
 return result

def _minimum(support):
 deps=bpy.context.evaluated_depsgraph_get();best=None
 for o,ids in support:
  ev=o.evaluated_get(deps);mesh=ev.to_mesh()
  if len(mesh.vertices)!=len(o.data.vertices):raise ValueError('Topology-changing modifier needs an evaluated support selector')
  for i in ids:
   p=ev.matrix_world@mesh.vertices[i].co
   if best is None or p.z<best['minimumWorldZ']:best={'minimumWorldZ':p.z,'mesh':o.name,'vertex':i,'pointWorld':list(p),'bones':[(o.vertex_groups[g.group].name,g.weight) for g in o.data.vertices[i].groups]}
  ev.to_mesh_clear()
 return best

def sample_role_support(collection,role,root_armature,support_bones=None,vertex_selector=None,states=('idle','walk','attack'),frame_start=1,frame_end=25,sample_step=.5,body_anchor=None):
 """Read-only 49-sample native support/argmin and body-anchor report per clip."""
 arm=bpy.data.objects[root_armature] if isinstance(root_armature,str) else root_armature;arms,saved,oldframe=_snapshot(collection);support=_support(collection,role,support_bones,vertex_selector);rows=[]
 try:
  for state in states:
   count=round((frame_end-frame_start)/sample_step)
   for i in range(count+1):
    frame=frame_start+i*sample_step;_pose(arms,saved,role,state,frame);row={'state':state,'nativeFrame':frame,**_minimum(support),'rootWorldTranslation':list(arm.matrix_world.translation),'rootLocalLocationZ':arm.location.z}
    if body_anchor:row['bodyAnchorWorld']=list(arm.matrix_world@arm.pose.bones[body_anchor].matrix.translation)
    rows.append(row)
 finally:_restore(arms,saved,oldframe)
 return {'role':role,'rootArmature':arm.name,'sampleStep':sample_step,'supportVertices':sum(len(ids) for o,ids in support),'samples':rows,'minimumWorldZ':min(r['minimumWorldZ'] for r in rows),'allFinite':all(math.isfinite(r['minimumWorldZ']) for r in rows)}

def normalize_role_ground(collection,role,root_armature,support_bones=None,vertex_selector=None,states=('idle','walk','attack'),frame_start=1,frame_end=25,sample_step=.5,clearance=.025,floor_z=0,loop_states=('idle','walk'),body_anchor=None,edition='contact-fit',allow_lowering=False):
 """Copy each existing root action; bake measured support correction to location.Z.

 A root must have world-vertical local Z and no animated parent. Parented riders
 follow its existing transform naturally. Every other channel remains identical.
 Caller must validate final optimized GLB/GPU contact; native sampling alone is
 not a runtime/animation-quality approval.
 """
 arm=bpy.data.objects[root_armature] if isinstance(root_armature,str) else root_armature
 if arm.type!='ARMATURE':raise ValueError('Root must be the semantic armature')
 if arm.parent:raise ValueError('Pass the unparented role root; do not fit a child rider independently')
 axis=arm.matrix_world.to_3x3()@Vector((0,0,1))
 # The rig's own rotation can put deform-Z sideways. Object location.Z is
 # translated before that rotation; validate its effective translation below.
 # Object location is evaluated before its OWN rotation/scale. Its translation
 # axis is the effective parent transform, not matrix_world.col[2]. For an
 # unparented root, even one scaled3.7, location.Z is already world units.
 translation_axis=(arm.matrix_world@arm.matrix_basis.inverted()).to_3x3()@Vector((0,0,1))
 if translation_axis.z<=0 or abs(translation_axis.x)>1e-6 or abs(translation_axis.y)>1e-6:raise ValueError('Root location Z does not translate vertically in world space')
 world_per_location_z=translation_axis.z
 before=sample_role_support(collection,role,arm,support_bones,vertex_selector,states,frame_start,frame_end,sample_step,body_anchor);arms,saved,oldframe=_snapshot(collection);changes=[]
 try:
  for state in states:
   track=next((t for t in arm.animation_data.nla_tracks if t.name==role+'_'+state),None)
   if track is None or len(track.strips)!=1:raise ValueError('Expected one semantic source strip: '+role+'_'+state)
   strip=track.strips[0]
   if abs(strip.frame_start-frame_start)>1e-5 or abs(strip.frame_end-frame_end)>1e-5 or abs(strip.repeat-1)>1e-5:raise ValueError('Explicit artist strip interval required')
   source=strip.action;unchanged=_curve_signature(source,True);action=source.copy();action.name=source.name+' '+edition+' root-height';strip.action=action
   old=action.fcurves.find('location',index=2)
   if old:action.fcurves.remove(old)
   curve=action.fcurves.new('location',index=2,action_group='Intentional measured support root height')
   samples=[r for r in before['samples'] if r['state']==state];keys=[]
   for r in samples:
    correction=floor_z+clearance-r['minimumWorldZ']
    if not allow_lowering:correction=max(0.,correction)
    value=r['rootLocalLocationZ']+correction/world_per_location_z;af=strip.action_frame_start+(r['nativeFrame']-strip.frame_start)/strip.scale;keys.append([af,value,correction])
   if state in loop_states:
    # Source loop endpoints use the same height; choose the safe larger value.
    endvalue=max(keys[0][1],keys[-1][1]);keys[0][1]=endvalue;keys[-1][1]=endvalue
   curve.keyframe_points.add(len(keys))
   for k,(frame,value,correction) in zip(curve.keyframe_points,keys):k.co=(frame,value);k.interpolation='LINEAR'
   curve.update()
   if unchanged!=_curve_signature(action,True):raise ValueError('Non-root-Z source channels changed')
   changes.append({'state':state,'sourceAction':source.name,'derivedAction':action.name,'otherChannelsSignature':unchanged,'intentionalChangedChannel':'object.location[2] only','keys':keys,'artistStrip':[strip.frame_start,strip.frame_end],'sourceActionMapping':[strip.action_frame_start,strip.action_frame_end,strip.scale],'maximumHeightCorrection':max(k[2] for k in keys),'loopEndpointRootZDifference':abs(keys[-1][1]-keys[0][1])})
 finally:_restore(arms,saved,oldframe)
 after=sample_role_support(collection,role,arm,support_bones,vertex_selector,states,frame_start,frame_end,sample_step,body_anchor)
 regressions=[r for r in after['samples'] if r['minimumWorldZ']<floor_z-1e-5];continuity=[]
 for state in states:
  rs=[r for r in after['samples'] if r['state']==state]
  continuity.append({'state':state,'startEndSupportDifference':rs[-1]['minimumWorldZ']-rs[0]['minimumWorldZ'],'startEndRootWorldDifference':(Vector(rs[-1]['rootWorldTranslation'])-Vector(rs[0]['rootWorldTranslation'])).length,'startEndBodyAnchorDifference':(Vector(rs[-1]['bodyAnchorWorld'])-Vector(rs[0]['bodyAnchorWorld'])).length if body_anchor else None,'maxHalfstepBodyAnchorMovement':max((Vector(b['bodyAnchorWorld'])-Vector(a['bodyAnchorWorld'])).length for a,b in zip(rs,rs[1:])) if body_anchor else None})
 result={'role':role,'rootArmature':arm.name,'method':'Measured support minima per original role clip; copied original action with object.location[2] derivative only. Rest matrices/binds, bones and non-root channels unchanged. Parented riders retain their relative contacts.','before':before,'after':after,'intentionalRootCurveChanges':changes,'continuity':continuity,'negativeSupportSamples':regressions,'nativeAllSamplesGroundSafe':not regressions,'floorWorldZ':floor_z,'clearance':clearance,'allowLoweringExplicitlyEnabled':allow_lowering,'worldUnitsPerObjectLocationZ':world_per_location_z,'rootDeformAxisWorld':list(axis),'newBones':0,'exportedClipNamesPreserved':True,'runtimeApproved':False,'motionArtApproved':False}
 if regressions:raise ValueError('Native support remains below floor: '+json.dumps(regressions))
 return result
