"""Original bounded guard-derived pole motions; preserve source geometry/rig.

The inherited sword thrust crosses the long pole blade through the face. This
clone replaces only three attack actions with connected forward guard motions.
"""
import argparse,pathlib,sys,json,hashlib,math,bpy
from mathutils import Vector,Quaternion
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from orc_portrait_attack import _channels,_restore,_orient,_segment
from prototype_contact_floor import normalize_role_ground
p=argparse.ArgumentParser();p.add_argument('--race',required=True);p.add_argument('--source-edition',required=True);p.add_argument('--edition',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=ROOT/'assets/source/battle'/a.source_edition/f'peris-{a.race}-army.blend';out=ROOT/'assets/source/battle'/a.edition
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();old=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);col=bpy.data.collections['PERIS_EXPORT'];scene=bpy.context.scene;arms=[o for o in col.all_objects if o.type=='ARMATURE'];baseline={r:{b.name:_channels(b) for b in r.pose.bones} for r in arms};rows=[];floor=[]
def restore():
 for r in arms:
  r.animation_data.action=None
  for b in r.pose.bones:_restore(b,baseline[r][b.name])
def sample(role,state,frame):
 restore()
 for r in arms:
  for t in r.animation_data.nla_tracks:t.mute=t.name!=role+'_'+state
 scene.frame_set(-1);scene.frame_set(frame);bpy.context.view_layer.update()
def owns(o,r):return o.type=='MESH' and any(m.type=='ARMATURE' and m.object==r for m in o.modifiers)
for role in ['line_infantry','spear_guard','elite']:
 arm=next(r for r in arms if not r.parent and 'hand_R' in r.data.bones and any(owns(o,r) and o.get('peris_role')==role for o in col.all_objects));idle=next(t for t in arm.animation_data.nla_tracks if t.name==role+'_idle');attack=next(t for t in arm.animation_data.nla_tracks if t.name==role+'_attack');original=attack.strips[0].action;records=[]
 for frame in range(1,26):
  sample(role,'idle',frame);records.append({'frame':frame,'local':{b.name:_channels(b) for b in arm.pose.bones},'matrices':{n:arm.pose.bones[n].matrix.copy() for n in ['forearm_R','hand_R']},'objectLocation':arm.location.copy(),'objectScale':arm.scale.copy(),'objectRotation':arm.rotation_quaternion.copy() if arm.rotation_mode=='QUATERNION' else arm.rotation_euler.copy()})
 action=idle.strips[0].action.copy();action.name=role+'_attack Peris original fitted forward pole motion';action['asset_author']='Peris: original guard-derived forward pole attack on Wildfire Games rig';action['asset_license']='CC-BY-SA-3.0';action['runtime_approved']=False;action['peris_unit_finished']=False
 for curve in list(action.fcurves):
  if curve.data_path.startswith('pose.bones[') or curve.data_path in ['location','scale','rotation_quaternion','rotation_euler','rotation_axis_angle']:action.fcurves.remove(curve)
 for t in arm.animation_data.nla_tracks:t.mute=True
 arm.animation_data.action=action
 if len(action.slots)!=1:raise ValueError('Explicit single humanoid action slot required')
 arm.animation_data.action_slot=action.slots[0]
 front=arm.matrix_world.to_3x3().inverted()@Vector((1,0,0));front.normalize();measure=[]
 for record in records:
  frame=record['frame'];scene.frame_set(frame);arm.location=record['objectLocation'];arm.scale=record['objectScale']
  if arm.rotation_mode=='QUATERNION':arm.rotation_quaternion=record['objectRotation']
  else:arm.rotation_euler=record['objectRotation']
  for path in ['location','scale','rotation_quaternion' if arm.rotation_mode=='QUATERNION' else 'rotation_euler']:arm.keyframe_insert(path,frame=frame)
  for b in arm.pose.bones:_restore(b,record['local'][b.name])
  bpy.context.view_layer.update();shaft=record['matrices']['hand_R'].to_3x3()@Vector((0,0,1))
  if shaft.z<0:shaft.negate()
  axis=shaft.cross(front).normalized();pitch=_segment(frame,[(1,0.),(4,0.),(11,12. if role=='spear_guard' else 27.),(16,18. if role=='spear_guard' else 36.),(23,0.),(25,0.)]);swing=Quaternion(axis,math.radians(pitch)).to_matrix().to_4x4()
  for name in ['forearm_R','hand_R']:_orient(arm.pose.bones[name],swing@record['matrices'][name],record['local'][name]['location'],record['local'][name]['scale'])
  for b in arm.pose.bones:
   b.keyframe_insert('location',frame=frame,group=b.name);rotation='rotation_quaternion' if b.rotation_mode=='QUATERNION' else 'rotation_axis_angle' if b.rotation_mode=='AXIS_ANGLE' else 'rotation_euler';b.keyframe_insert(rotation,frame=frame,group=b.name);b.keyframe_insert('scale',frame=frame,group=b.name)
  measure.append({'frame':frame,'forwardPitchDegrees':pitch})
 for curve in action.fcurves:
  for key in curve.keyframe_points:key.interpolation='LINEAR'
 arm.animation_data.action=None;strip=attack.strips[0];strip.action=action;strip.action_slot=action.slots[0];strip.action_frame_start=1;strip.action_frame_end=25;strip.scale=1;strip.repeat=1;strip.frame_start=1;strip.frame_end=25;rows.append({'role':role,'sourceAttack':original.name,'newAttack':action.name,'sourceIdleWalkUnchanged':True,'geometryRestRigWeightsMaterialsCreditsUnchanged':True,'operations':'Complete independently sampled guard transforms; modest connected forearm/hand forward swing, legs/shield/other limbs remain the actual guard; return to guard endpoints','measurements':measure})
 owned=[o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role];rigs={m.object for o in owned for m in o.modifiers if m.type=='ARMATURE'};flags={o:o.hide_viewport for o in col.all_objects}
 for o in list(col.all_objects):o.hide_viewport=o not in rigs and o not in owned
 floor.append(normalize_role_ground(col,role,arm,support_bones=['foot_L','foot_R','toe_L','toe_R'],states=('attack',),clearance=.025,sample_step=.5,allow_lowering=False,edition=a.edition))
 fitted=attack.strips[0].action
 if len(fitted.slots)!=1:raise ValueError('Explicit single fitted action slot required')
 attack.strips[0].action_slot=fitted.slots[0]
 sample(role,'attack',16);guard=records[15]['matrices']['forearm_R'].to_quaternion();posed=arm.pose.bones['forearm_R'].matrix.to_quaternion();actual_angle=math.degrees(guard.rotation_difference(posed).angle);actual_angle=min(actual_angle,360-actual_angle);rows[-1]['actualNlaForearmRotationAtFrame16Degrees']=actual_angle
 if actual_angle<(12 if role=='spear_guard' else 24):raise ValueError('Reject static or unbound attack: '+role+' '+str(actual_angle))
 for o,flag in flags.items():o.hide_viewport=flag
restore()
for r in arms:
 for t in r.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
scene.frame_set(-1);scene.frame_set(1);bpy.context.view_layer.update()
for o in col.all_objects:
 if o.type=='MESH':o['runtime_approved']=False;o['peris_unit_finished']=False
out.mkdir(parents=True);native=out/f'peris-{a.race}-army.blend';bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True);record={'sourceNative':str(source),'sourceSha256':old,'sourceUnchanged':sha(source)==old,'actionOnlyClone':True,'explicitAllMeshPrototypeFlags':True,'operations':rows,'groundContact':floor,'nativeArtistFrames':[1,25],'actualMotionAndRawChecksRequired':True,'runtimeApproved':False,'finishedUnitApproved':False,'files':{native.name:{'bytes':native.stat().st_size,'sha256':sha(native)}}};(out/'provenance.json').write_text(json.dumps(record,indent=2));print('FANTASY_FITTED_POLE_ACTION_READY',json.dumps(record['files']),flush=True)
