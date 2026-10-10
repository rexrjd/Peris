"""Complete saved-baseline TRS sampling for an UNSAVED runtime export clone.

Call after opening an immutable artist native. Never save over that native after
this function: it replaces clone actions with complete 49-sample channels to
preserve unkeyed artist pose values when Blender's exporter resets pose bones.
Bones, meshes, rest matrices, inverse binds, and parent relationships stay put.
"""
import bpy,hashlib,json
from mathutils import Vector,Quaternion
import prototype_contact_floor as contact

DEFAULT_ROLES=('line_infantry','spear_guard','archer','elite','scout','light_cavalry','heavy_cavalry','ram','catapult')

def _flat(matrix):return [v for row in matrix for v in row]

def _rig_rest(arms):
 return hashlib.sha256(json.dumps([(a.name,_flat(a.matrix_basis),[(b.name,b.parent.name if b.parent else None,_flat(b.matrix_local)) for b in a.data.bones]) for a in arms],sort_keys=True).encode()).hexdigest()

def _action_channels(arms):
 return [(a.name,[(t.name,[(s.action.name,contact._curve_signature(s.action),[s.frame_start,s.frame_end,s.action_frame_start,s.action_frame_end,s.scale]) for s in t.strips]) for t in a.animation_data.nla_tracks]) for a in arms]

def _trs(matrix,previous=None):
 l,q,s=matrix.decompose()
 if previous is not None and q.dot(Quaternion(previous))<0:q.negate()
 return [list(l),list(q),list(s)]

def _curves(action,path,rows,times):
 for component in range(len(rows[0])):
  curve=action.fcurves.new(path,index=component,action_group='Exact saved-baseline export sampling')
  curve.keyframe_points.add(len(rows))
  for point,time,row in zip(curve.keyframe_points,times,rows):point.co=(time,row[component]);point.interpolation='LINEAR'
  curve.update()

def _unique_export_bones(collection,role_arms):
 """Avoid loader suffix collisions such as Horse_Spine / Horse_Spine_1.

 Native bones are untouched; only the unsaved clone receives names. Preserve a
 semantic suffix after '__' for inspection. All associated groups, animation
 paths, constraints and bone-parent references are updated explicitly.
 """
 objects=list(collection.all_objects);maps={};group_refs=[];curve_refs=[];parent_refs=[];constraint_refs=[];copies=[];rig_roles={};old_arm_names={a:a.name for arms in role_arms.values() for a in arms}
 for role,arms in role_arms.items():
  for index,arm in enumerate(arms):
   if arm.data.users>1:arm.data=arm.data.copy();copies.append(arm.name)
   rig_roles[arm]=role
   mapping={b.name:role+'_rig'+str(index)+'__'+b.name for b in arm.data.bones};maps[arm]=mapping
   for obj in objects:
    if obj.type=='MESH' and (obj.parent==arm or any(m.type=='ARMATURE' and m.object==arm for m in obj.modifiers)):
     group_refs += [(g,mapping[g.name]) for g in obj.vertex_groups if g.name in mapping]
    if obj.parent==arm and obj.parent_type=='BONE' and obj.parent_bone in mapping:parent_refs.append((obj,mapping[obj.parent_bone]))
   for track in arm.animation_data.nla_tracks:
    for strip in track.strips:
     for curve in strip.action.fcurves:
      for old,new in mapping.items():
       prefix='pose.bones['+json.dumps(old)+']'
       if curve.data_path.startswith(prefix):curve_refs.append((curve,'pose.bones['+json.dumps(new)+']'+curve.data_path[len(prefix):]));break
 for obj in objects:
  constraints=list(obj.constraints)
  if obj.type=='ARMATURE':constraints += [c for b in obj.pose.bones for c in b.constraints]
  for c in constraints:
   target=getattr(c,'target',None);sub=getattr(c,'subtarget',None)
   if target in maps and sub in maps[target]:constraint_refs.append((c,maps[target][sub]))
 for arm,mapping in maps.items():
  for old,new in mapping.items():arm.data.bones[old].name=new
 for group,new in group_refs:group.name=new
 for curve,new in curve_refs:curve.data_path=new
 for obj,new in parent_refs:obj.parent_bone=new
 for constraint,new in constraint_refs:constraint.subtarget=new
 # Assigning a shared Armature datablock copy can rebuild pose channels and
 # reset their rotation modes. Complete clone curves use quaternions.
 for arm in maps:
  arm.rotation_mode='QUATERNION'
  for bone in arm.pose.bones:bone.rotation_mode='QUATERNION'
 bpy.context.view_layer.update()
 names=[b.name for arm in maps for b in arm.data.bones]
 if len(names)!=len(set(names)):raise ValueError('Export bone names are not globally unique')
 object_names={}
 for index,obj in enumerate(objects):
  old=obj.name;role=rig_roles.get(obj,obj.get('peris_role')) or rig_roles.get(obj.parent,'export')
  # Prefixes are globally unique even if the loader sanitizes the suffix.
  suffix=''.join(c if c.isalnum() or c=='_' else '_' for c in old);new=role+'_obj'+str(index)+'__'+suffix;obj.name=new;object_names[old]=new
 if len({o.name for o in objects})!=len(objects):raise ValueError('Export object names are not unique')
 return {'method':'Unsaved export clone only: semantic role/rig prefix prevents GLTFLoader numeric suffix from colliding with original names such as Horse_Spine_1. Every object also receives a distinct role/index prefix.','semanticSeparator':'__','nativeBoneNamesChanged':False,'nativeObjectNamesChanged':False,'objectNames':object_names,'boneNames':{old_arm_names[arm]:m for arm,m in maps.items()},'vertexGroupReferencesUpdated':len(group_refs),'fcurvePathsUpdated':len(curve_refs),'boneParentReferencesUpdated':len(parent_refs),'constraintSubtargetsUpdated':len(constraint_refs),'sharedArmatureDataCopiedInClone':copies,'globallyUniqueBoneNames':True,'globallyUniqueObjectNames':True}

def bake_saved_baseline_export(collection,roles=DEFAULT_ROLES,states=('idle','walk','attack'),frame_start=1,frame_end=25,sample_step=.5,export_fps=48,verify=True,tolerance=.00015,experimental_blender_namespace=False):
 """Bake exact 49 native samples to all bone/object TRS in an unsaved clone.

 Same semantic NLA names, one-second clips, original evaluated saved pose basis
 restored before EVERY sample. Native actions are never altered: fresh clone
 actions replace strips after sampling is complete. Object/pose rotation modes
 switch to quaternion only in the clone. Verify compares every evaluated bone
 world matrix and rig object world matrix against the sampled native, including
 child rider transforms. Use the normal explicit-collection GLB exporter after.
 """
 arms,saved,oldframe=contact._snapshot(collection);rest_before=_rig_rest(arms);source_channels=_action_channels(arms);count=round((frame_end-frame_start)/sample_step)
 if count!=48 or export_fps!=48:raise ValueError('This export gate expects 49 samples / 48 FPS / one second')
 samples={};role_arms={}
 try:
  for role in roles:
   selected=[a for a in arms if any(t.name==role+'_'+states[0] for t in a.animation_data.nla_tracks)]
   if not selected:raise ValueError('No semantic source rigs for '+role)
   role_arms[role]=selected
   for state in states:
    key=role+'_'+state;samples[key]={a.name:[] for a in selected}
    for i in range(count+1):
     native_frame=frame_start+i*sample_step;contact._pose(arms,saved,role,state,native_frame)
     for a in selected:
      previous=samples[key][a.name][-1] if samples[key][a.name] else None
      row={'objectTRS':_trs(a.matrix_basis,previous['objectTRS'][1] if previous else None),'objectWorld':_flat(a.matrix_world),'bones':{}}
      for b in a.pose.bones:
       row['bones'][b.name]={'trs':_trs(b.matrix_basis,previous['bones'][b.name]['trs'][1] if previous else None),'world':_flat(a.matrix_world@b.matrix)}
      samples[key][a.name].append(row)
    print('EXPORT_BASELINE_SAMPLED',key,len(selected),count+1,flush=True)
 finally:contact._restore(arms,saved,oldframe)
 if rest_before!=_rig_rest(arms) or source_channels!=_action_channels(arms):raise ValueError('Sampling altered native rest or actions')
 for a in arms:
  a.animation_data.action=None
  for t in list(a.animation_data.nla_tracks):a.animation_data.nla_tracks.remove(t)
  a.rotation_mode='QUATERNION'
  for b in a.pose.bones:b.rotation_mode='QUATERNION'
 times=list(range(49));actions=[]
 for role in roles:
  for state in states:
   key=role+'_'+state
   for a in role_arms[role]:
    rows=samples[key][a.name];action=bpy.data.actions.new(a.name+' '+key+' exact 49 export samples')
    for path,index in [('location',0),('rotation_quaternion',1),('scale',2)]:_curves(action,path,[r['objectTRS'][index] for r in rows],times)
    for bone in a.pose.bones:
     prefix=bone.path_from_id()
     for path,index in [('location',0),('rotation_quaternion',1),('scale',2)]:_curves(action,prefix+'.'+path,[r['bones'][bone.name]['trs'][index] for r in rows],times)
    track=a.animation_data.nla_tracks.new();track.name=key;strip=track.strips.new(key,0,action);strip.action_frame_start=0;strip.action_frame_end=48;strip.frame_start=0;strip.frame_end=48;track.mute=True
    actions.append({'rig':a.name,'track':key,'exportAction':action.name,'nativeFrames':[frame_start,frame_end],'exportFrames':[0,48],'fps':48,'samples':49,'completeBoneTRS':len(a.pose.bones),'completeObjectTRS':True})
 clone_saved=contact._snapshot(collection)[1]
 for a in arms:
  base=_trs(saved[a.name]['matrix']);clone_saved[a.name]['location']=Vector(base[0]);clone_saved[a.name]['rotationMode']='QUATERNION';clone_saved[a.name]['rotationQuaternion']=Quaternion(base[1]);clone_saved[a.name]['scale']=Vector(base[2])
 errors=[];maximum=0.
 if verify:
  for role in roles:
   for state in states:
    key=role+'_'+state
    for i in range(49):
     contact._pose(arms,clone_saved,role,state,i)
     for a in role_arms[role]:
      expected=samples[key][a.name][i];err=max(abs(x-y) for x,y in zip(_flat(a.matrix_world),expected['objectWorld']))
      for b in a.pose.bones:err=max(err,max(abs(x-y) for x,y in zip(_flat(a.matrix_world@b.matrix),expected['bones'][b.name]['world'])))
      maximum=max(maximum,err)
      if err>tolerance:errors.append({'track':key,'rig':a.name,'sample':i,'nativeFrame':frame_start+i*sample_step,'maximumWorldMatrixError':err})
    print('EXPORT_BASELINE_VERIFIED',key,maximum,flush=True)
  if errors:raise ValueError('Export clone differs from native saved baseline: '+json.dumps(errors[:10]))
 for a in arms:
  a.animation_data.action=None
  for t in a.animation_data.nla_tracks:t.mute=True
 bpy.context.scene.render.fps=export_fps;bpy.context.scene.frame_start=0;bpy.context.scene.frame_end=48;bpy.context.scene.frame_set(0)
 if not experimental_blender_namespace:
  return {'method':'Unsaved clone: full object and every bone TRS sampled from saved-baseline native poses, restored before every native halfstep; same semantic clip names and one-second durations. Geometry, rig rest/binds and native original actions preserved. Namespace node names AFTER export using prototype_glb_names.namespace_exported_glb_nodes; no Blender bone-parent names are changed.','sourceNativeRestSignature':rest_before,'sourceNativeActions':source_channels,'cloneTracks':actions,'samplesPerClip':49,'maximumWorldMatrixError':maximum,'nativePoseEqualityVerified':verify and not errors,'cloneActionDerivativeOnly':True,'nativeActionsModifiedByThisHelper':False,'requiresPostExportNameNamespace':True,'runtimeGPUApproved':False}
 old_names={a:a.name for a in arms};name_report=_unique_export_bones(collection,role_arms);renamed_saved={}
 for a in arms:
  old=old_names[a];row=clone_saved[old].copy();mapping=name_report['boneNames'][old];row['pose']={mapping[n]:v for n,v in row['pose'].items()};renamed_saved[a.name]=row
 renamed_maximum=0.
 if verify:
  for role in roles:
   for state in states:
    key=role+'_'+state
    for i in [0,12,24,36,48]:
     contact._pose(arms,renamed_saved,role,state,i)
     for a in role_arms[role]:
      old=old_names[a];expected=samples[key][old][i];err=max(abs(x-y) for x,y in zip(_flat(a.matrix_world),expected['objectWorld']))
      for original,new in name_report['boneNames'][old].items():err=max(err,max(abs(x-y) for x,y in zip(_flat(a.matrix_world@a.pose.bones[new].matrix),expected['bones'][original]['world'])))
      renamed_maximum=max(renamed_maximum,err)
      if err>tolerance:raise ValueError('Export prefix remapping changed actual pose: '+key+' '+old+' '+str(i)+' '+str(err))
   print('EXPORT_NAMES_VERIFIED',role,renamed_maximum,flush=True)
 for a in arms:
  a.animation_data.action=None
  for t in a.animation_data.nla_tracks:t.mute=True
 bpy.context.scene.frame_set(0)
 return {'method':'Unsaved clone: full object and every bone TRS sampled from saved-baseline native poses, restored before every native halfstep; same semantic clip names and one-second durations. Geometry, rig rest/binds and native original actions preserved. Export bone/object names receive unique role/rig prefixes to prevent runtime name collisions.','sourceNativeRestSignature':rest_before,'sourceNativeActions':source_channels,'cloneTracks':actions,'samplesPerClip':49,'maximumWorldMatrixError':maximum,'nativePoseEqualityVerified':verify and not errors,'postNameRemappingMaximumWorldMatrixError':renamed_maximum,'postNameRemappingVerifiedFrames':[0,12,24,36,48] if verify else [],'cloneActionDerivativeOnly':True,'nativeActionsModifiedByThisHelper':False,'exportBoneNames':name_report,'runtimeGPUApproved':False}
