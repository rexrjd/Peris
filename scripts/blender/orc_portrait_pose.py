"""Original Peris Axe Warrior idle guard pose, authored on the existing rig.

Call apply_idle_guard after anatomy clip adaptation and before atlas/export or
optional root-ground correction. It copies and replaces ONLY the idle action;
walk/attack clips, bind bones, geometry and local palm/socket centers stay intact.
The copied idle keeps existing legs and chest breathing. This is an art study,
not approval of anatomy, contact, animation transitions or a finished unit.
"""
import json
import math
import bpy
from mathutils import Matrix, Quaternion, Vector


def _rotation_only(pose, desired, location, scale):
    """Solve orientation through the real parent, preserving local joint origin."""
    bone=pose.bone
    desired=desired.copy()
    desired.translation=pose.head
    kwargs=({'parent_matrix':pose.parent.matrix,
             'parent_matrix_local':bone.parent.matrix_local} if bone.parent else {})
    basis=bone.convert_local_to_pose(desired,bone.matrix_local,invert=True,**kwargs)
    pose.rotation_mode='QUATERNION'
    pose.rotation_quaternion=basis.to_quaternion().normalized()
    if pose.rotation_quaternion.w<0:pose.rotation_quaternion.negate()
    pose.location=location
    pose.scale=scale
    bpy.context.view_layer.update()


def apply_idle_guard(arm, role='line_infantry'):
    """Copy idle into a grounded upright-axe guard; return inspectable metadata."""
    if role not in {'line_infantry','spear_guard','elite'}:raise ValueError('Upright guard supports Orc axe and polearm infantry only')
    if role!='line_infantry' and not arm.get('peris_licensed_head_credit'):
        raise ValueError('Additional Orc guards require explicit licensed-head component provenance')
    weapon_label='axe' if role=='line_infantry' else 'polearm'
    animation=arm.animation_data
    if not animation:raise ValueError('Arm has no animation data')
    idle=next((t for t in animation.nla_tracks if t.name==role+'_idle'),None)
    if idle is None or len(idle.strips)!=1:raise ValueError('Expected one existing idle strip')
    if arm.get('peris_original_idle_guard_pose'):raise ValueError('Guard pose already applied; do not stack adaptations')
    strip=idle.strips[0]
    original=strip.action
    start,end=float(strip.action_frame_start),float(strip.action_frame_end)
    if abs(start-round(start))>1e-5 or abs(end-round(end))>1e-5:raise ValueError('Expected integer authored idle frames')
    required=['arm_R','forearm_R','hand_R','prop-weapon_R','chest','hand_L']
    if any(n not in arm.pose.bones for n in required):raise ValueError('Expected Orc humanoid arm and weapon sockets')
    scene=bpy.context.scene
    old_frame,old_subframe=scene.frame_current,scene.frame_subframe
    old_action=animation.action
    mutes=[(t,t.mute) for t in animation.nla_tracks]
    frames=[]
    try:
        animation.action=None
        for track,_ in mutes:track.mute=track!=idle
        for frame in range(round(start),round(end)+1):
            scene.frame_set(frame);bpy.context.view_layer.update()
            frames.append({'frame':frame,
                'matrices':{name:arm.pose.bones[name].matrix.copy() for name in required},
                'local':{name:(arm.pose.bones[name].location.copy(),arm.pose.bones[name].scale.copy())
                         for name in ['arm_R','forearm_R','hand_R']}})
        action=original.copy();action.name=role+'_idle Peris portrait upright '+weapon_label+' guard'
        action['asset_author']=('Peris: original Orc Axe Warrior guard pose on licensed humanoid rig' if role=='line_infantry'
                                else 'Peris: original Orc upright polearm guard adaptation on licensed humanoid rig')
        action['asset_license']='CC-BY-SA-3.0'
        action['peris_source_idle_action']=original.name
        action['runtime_approved']=False;action['peris_unit_finished']=False
        for track,_ in mutes:track.mute=True
        animation.action=action
        measurements=[]
        for record in frames:
            frame=record['frame'];scene.frame_set(frame);bpy.context.view_layer.update()
            socket=record['matrices']['prop-weapon_R']
            shaft=(socket.to_3x3()@Vector((0,0,1))).normalized()
            rotation=shaft.rotation_difference(Vector((0,0,1)))
            # ~7 degrees upperarm, ~26 additional elbow, ~13 wrist at v11.
            # Use actual socket orientation, so grip coordinates need no changes.
            axis,angle=rotation.to_axis_angle()
            for name,fraction in [('arm_R',.15),('forearm_R',.72),('hand_R',1.0)]:
                desired=Quaternion(axis,angle*fraction).to_matrix().to_4x4()@record['matrices'][name]
                location,scale=record['local'][name]
                _rotation_only(arm.pose.bones[name],desired,location,scale)
                arm.pose.bones[name].keyframe_insert('rotation_quaternion',frame=frame,group=name)
            bpy.context.view_layer.update()
            actual=(arm.pose.bones['prop-weapon_R'].matrix.to_3x3()@Vector((0,0,1))).normalized()
            measurements.append({'frame':frame,'shaftToVerticalDegrees':math.degrees(actual.angle(Vector((0,0,1)))),
                'measuredTotalShaftReorientationDegrees':math.degrees(angle),
                'rightPalmCenter':list(arm.pose.bones['hand_R'].matrix@Vector((0,.15,0))),
                'leftPalmCenter':list(arm.pose.bones['hand_L'].matrix@Vector((0,.15,0)))})
        # Linear sampled quaternion interpolation avoids handle overshoot between
        # the periodic keys. Existing chest/leg curves keep their original keys.
        for curve in action.fcurves:
            if any(curve.data_path==f'pose.bones["{name}"].rotation_quaternion'
                   for name in ['arm_R','forearm_R','hand_R']):
                for key in curve.keyframe_points:key.interpolation='LINEAR'
        animation.action=None;strip.action=action
        strip.action_frame_start=start;strip.action_frame_end=end
        report={'role':role,'weaponClass':weapon_label,'sourceAction':original.name,'newAction':action.name,
                'frames':[start,end],'rotationDistribution':{'upperarmCumulative':.15,'forearmCumulative':.72,'handCumulative':1.0},
                'unchanged':['walk action','attack action','rest bones','bone parents','geometry','materials','legs','chest breathing','left arm guard','local closed palm and shaft socket coordinates'],
                'measurements':measurements,'runtimeApproved':False,'finishedUnitApproved':False}
        arm['peris_original_idle_guard_pose']=json.dumps(report)
        return report
    finally:
        animation.action=old_action
        for track,muted in mutes:track.mute=muted
        scene.frame_set(old_frame,subframe=old_subframe);bpy.context.view_layer.update()
