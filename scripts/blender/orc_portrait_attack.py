"""Original Peris one-handed diagonal axe attack on the existing humanoid rig.

Apply after the guard/equipment exists and before the canonical hip-only sole
fit. Only a copied attack action changes; no socket, prop, mesh or rig edits.
"""
import json
import math
import bpy
from mathutils import Quaternion, Vector


def _smooth(t):
    t=max(0.,min(1.,t))
    return t*t*t*(t*(t*6-15)+10)


def _segment(frame,knots):
    for (a,va),(b,vb) in zip(knots,knots[1:]):
        if frame<=b:
            t=_smooth((frame-a)/(b-a))
            return va*(1-t)+vb*t
    return knots[-1][1]


def _channels(bone):
    return {'location':bone.location.copy(),'scale':bone.scale.copy(),
            'rotation_mode':bone.rotation_mode,
            'rotation':bone.rotation_quaternion.copy() if bone.rotation_mode=='QUATERNION' else
                       bone.rotation_axis_angle[:] if bone.rotation_mode=='AXIS_ANGLE' else bone.rotation_euler.copy()}


def _restore(bone,channels):
    bone.location=channels['location'];bone.scale=channels['scale']
    mode=channels['rotation_mode']
    if bone.rotation_mode!=mode:raise ValueError('Preserve existing rotation mode')
    if mode=='QUATERNION':bone.rotation_quaternion=channels['rotation']
    elif mode=='AXIS_ANGLE':bone.rotation_axis_angle=channels['rotation']
    else:bone.rotation_euler=channels['rotation']


def _orient(bone,desired,location,scale):
    matrix=desired.copy();matrix.translation=bone.head
    kwargs=({'parent_matrix':bone.parent.matrix,'parent_matrix_local':bone.bone.parent.matrix_local} if bone.parent else {})
    basis=bone.bone.convert_local_to_pose(matrix,bone.bone.matrix_local,invert=True,**kwargs)
    if bone.rotation_mode!='QUATERNION':raise ValueError('Expected authored arm quaternion channels')
    q=basis.to_quaternion().normalized()
    if q.w<0:q.negate()
    bone.rotation_quaternion=q;bone.location=location;bone.scale=scale
    bpy.context.view_layer.update()


def apply_axe_attack(arm,role='line_infantry'):
    """Return inspectable action-only credit and sampled shaft/contact metadata."""
    if role!='line_infantry':raise ValueError('Only Axe Warrior attack currently authored')
    if arm.get('peris_original_axe_attack'):raise ValueError('Do not stack an attack adaptation')
    if not arm.get('peris_original_idle_guard_pose'):raise ValueError('Existing upright guard is required')
    animation=arm.animation_data
    idle=next(t for t in animation.nla_tracks if t.name==role+'_idle')
    attack=next(t for t in animation.nla_tracks if t.name==role+'_attack')
    if len(idle.strips)!=1 or len(attack.strips)!=1:raise ValueError('Expected one authored strip per state')
    required=['arm_R','forearm_R','hand_R','prop-weapon_R','chest','hip','arm_L','forearm_L','hand_L']
    if any(name not in arm.pose.bones for name in required):raise ValueError('Expected body and original grip sockets')
    if any(arm.pose.bones[name].rotation_mode!='QUATERNION' for name in ['arm_R','forearm_R','hand_R','chest']):raise ValueError('Preserve existing quaternion rotation modes')
    original=attack.strips[0].action;strip=attack.strips[0]
    if [round(float(strip.action_frame_start)),round(float(strip.action_frame_end))]!=[1,25]:raise ValueError('Expected1..25 native frames at24fps')
    scene=bpy.context.scene;old_frame=scene.frame_current;old_subframe=scene.frame_subframe;old_action=animation.action
    mutes=[(t,t.mute) for t in animation.nla_tracks]
    initial={b.name:_channels(b) for b in arm.pose.bones}
    frames=[];action=None
    try:
        animation.action=None
        for track,_ in mutes:track.mute=track!=idle
        for frame in range(1,26):
            # Never carry a sampled attack/other-frame basis into this pose.
            for bone in arm.pose.bones:_restore(bone,initial[bone.name])
            scene.frame_set(frame);bpy.context.view_layer.update()
            frames.append({'frame':frame,'local':{b.name:_channels(b) for b in arm.pose.bones},
                           'matrices':{name:arm.pose.bones[name].matrix.copy() for name in required}})
        action=original.copy();action.name=role+'_attack Peris original diagonal axe chop'
        action['asset_author']='Peris: original Orc Axe Warrior attack motion on credited humanoid rig'
        action['asset_license']='CC-BY-SA-3.0';action['peris_source_attack_action']=original.name
        action['peris_guard_baseline_action']=idle.strips[0].action.name
        action['runtime_approved']=False;action['peris_unit_finished']=False
        for key in ['peris_fitted_boot_ground','peris_ground_placement_edit']:
            if key in action:del action[key]
        for curve in list(action.fcurves):
            if curve.data_path.startswith('pose.bones['):action.fcurves.remove(curve)
        for track,_ in mutes:track.mute=True
        animation.action=action
        records=[]
        for record in frames:
            frame=record['frame'];scene.frame_set(frame)
            for bone in arm.pose.bones:_restore(bone,record['local'][bone.name])
            bpy.context.view_layer.update()
            pitch=_segment(frame,[(1,0.),(3,0.),(7,-28.),(15,140.),(23,0.),(25,0.)])
            diagonal=_segment(frame,[(1,0.),(3,0.),(7,-10.),(15,22.),(23,0.),(25,0.)])
            wind=_smooth((frame-3)/4) if frame<=7 else 1-_smooth((frame-7)/8) if frame<=15 else 0.
            chop=_smooth((frame-7)/8) if frame<=15 else 1-_smooth((frame-15)/8)
            torso=Quaternion((0,0,1),math.radians(4)*chop)@Quaternion((1,0,0),math.radians(2)*chop)
            chest=arm.pose.bones['chest'];base=record['matrices']['chest']
            _orient(chest,torso.to_matrix().to_4x4()@base,record['local']['chest']['location'],record['local']['chest']['scale'])
            upper=arm.pose.bones['arm_R'];base_upper=record['matrices']['arm_R']
            base_direction=(base_upper.to_3x3()@Vector((0,1,0))).normalized()
            raised=Vector((-.55,-.18,.36)).normalized();down=Vector((-.50,-.65,-.35)).normalized()
            direction=base_direction.lerp(raised,wind).lerp(down,chop).normalized()
            turn=base_direction.rotation_difference(direction)
            _orient(upper,turn.to_matrix().to_4x4()@base_upper,record['local']['arm_R']['location'],record['local']['arm_R']['scale'])
            swing=Quaternion((0,0,1),math.radians(diagonal))@Quaternion((1,0,0),math.radians(pitch))
            for name in ['forearm_R','hand_R']:
                _orient(arm.pose.bones[name],swing.to_matrix().to_4x4()@record['matrices'][name],record['local'][name]['location'],record['local'][name]['scale'])
            for bone in arm.pose.bones:
                bone.keyframe_insert('location',frame=frame,group=bone.name)
                rotation='rotation_quaternion' if bone.rotation_mode=='QUATERNION' else 'rotation_axis_angle' if bone.rotation_mode=='AXIS_ANGLE' else 'rotation_euler'
                bone.keyframe_insert(rotation,frame=frame,group=bone.name)
                bone.keyframe_insert('scale',frame=frame,group=bone.name)
            bpy.context.view_layer.update()
            socket=arm.pose.bones['prop-weapon_R'].matrix
            relative=arm.pose.bones['hand_R'].matrix.inverted()@socket
            baseline_relative=record['matrices']['hand_R'].inverted()@record['matrices']['prop-weapon_R']
            hand_direction=(arm.pose.bones['hand_R'].tail-arm.pose.bones['hand_R'].head).normalized()
            fore_direction=(arm.pose.bones['forearm_R'].tail-arm.pose.bones['forearm_R'].head).normalized()
            records.append({'frame':frame,'authoredShaftPitchDegrees':pitch,'authoredDiagonalDegrees':diagonal,
                            'shaftDirectionArmature':list((socket.to_3x3()@Vector((0,0,1))).normalized()),
                            'rightWristArmature':list(arm.pose.bones['hand_R'].head),
                            'rightElbowArmature':list(arm.pose.bones['forearm_R'].head),
                            'wristForearmAngleDegrees':math.degrees(hand_direction.angle(fore_direction)),
                            'propToHandRelativeMatrixMaxError':max(abs(relative[r][c]-baseline_relative[r][c]) for r in range(4) for c in range(4))})
        for curve in action.fcurves:
            for key in curve.keyframe_points:key.interpolation='LINEAR'
        animation.action=None;strip.action=action;strip.action_frame_start=1;strip.action_frame_end=25
        report={'author':'Peris: original axe attack motion on credited humanoid rig','variant':1,'role':role,
                'sourceAction':original.name,'newAction':action.name,'baselineGuardAction':idle.strips[0].action.name,
                'nativeFrames':[1,25],'fps':24,'timing':{'guardHold':[1,3],'windup':[3,7],'diagonalChop':[7,15],'recovery':[15,23],'endGuardHold':[23,25]},
                'operations':['Copy existing attack action and author complete sampled transforms from independent saved guard poses','Raise axe beside/outside head; connected diagonal chopping arc and recovery','Shield and legs retain guard-based transforms; modest4deg torso turn/2deg lean','Forearm and hand share the swing rotation to retain anatomical wrist angle','Remove only the copied attack ground-fit marker so the final canonical hip-only fit can run'],
                'preserved':['rest rig and bone hierarchy','mesh/UV/material/weights/source component credits','local palm/shaft/prop sockets','idle and walk action curves and markers'],
                'measurements':records,'runtimeApproved':False,'finishedUnitApproved':False,
                'limitations':['Contact and same-light motion review required; no finished motion or unit approval','Native source study uses existing guard sole keys; full fresh build must rerun canonical hip-only ground fit before export']}
        action['peris_original_axe_attack']=json.dumps(report);arm['peris_original_axe_attack']=json.dumps(report)
        return report
    finally:
        animation.action=old_action
        for track,muted in mutes:track.mute=muted
        for bone in arm.pose.bones:_restore(bone,initial[bone.name])
        scene.frame_set(old_frame,subframe=old_subframe);bpy.context.view_layer.update()
