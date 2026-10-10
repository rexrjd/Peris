"""Original planted boulder throw on the credited siege giant rig.

Existing rest bones, geometry and original idle/walk channels remain intact.
One original release control shrinks only the carried stone after release;
the game projectile remains a separate runtime effect.
"""
import bpy, json, math
import numpy as np
from mathutils import Vector, Matrix
from mathutils import Quaternion
from orc_portrait_attack import _channels, _restore, _orient, _segment


def fit_giant_ground(arm, meshes, role='catapult'):
    """Canonical bare-foot fit before original throw authoring, no runtime lift."""
    if role!='catapult' or arm.get('peris_original_giant_ground_fit'):
        raise ValueError('Fit a fresh scaled giant exactly once')
    scene=bpy.context.scene;animation=arm.animation_data
    baseline={b.name:b.matrix_basis.copy() for b in arm.pose.bones}
    initial_action=animation.action;initial_frame=scene.frame_current;mutes=[(t,t.mute) for t in animation.nla_tracks]
    feet=[]
    for obj in meshes:
        names={g.index:g.name for g in obj.vertex_groups}
        ids=[v.index for v in obj.data.vertices if sum(g.weight for g in v.groups if names.get(g.group) in ['foot_L','toe_L','foot_R','toe_R'])>=.5]
        if ids:feet.append((obj,ids))
    if not feet:raise ValueError('Measured actual giant bare-foot geometry required')
    def reset():
        for name,basis in baseline.items():arm.pose.bones[name].matrix_basis=basis.copy()
    def sole():
        bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();points=[]
        for obj,ids in feet:
            ev=obj.evaluated_get(deps);mesh=ev.to_mesh();points.extend((ev.matrix_world@mesh.vertices[i].co).z for i in ids);ev.to_mesh_clear()
        return min(points)
    inverse=arm.matrix_world.to_3x3().inverted();records=[]
    for t,_ in mutes:t.mute=True
    for state in ['idle','walk','attack']:
        track=next(t for t in animation.nla_tracks if t.name==role+'_'+state);prior=track.strips[0].action
        action=prior.copy();action.name='Peris giant '+state+' canonical bare-foot fit';track.strips[0].action=action;animation.action=action
        samples=[]
        for frame in range(1,26):reset();scene.frame_set(frame);bpy.context.view_layer.update();samples.append((frame,sole(),arm.pose.bones['hip'].matrix.copy()))
        rows=[]
        for frame,before,hip in samples:
            reset();scene.frame_set(frame);arm.pose.bones['hip'].matrix=Matrix.Translation(inverse@Vector((0,0,-before)))@hip
            arm.pose.bones['hip'].keyframe_insert('location',frame=frame,group='hip');rows.append({'frame':frame,'before':before,'worldHipZShift':-before})
        for row in rows:
            reset();scene.frame_set(row['frame']);row['completedAfter']=sole()
            if abs(row['completedAfter'])>.0001:raise ValueError('Completed giant foot fit failed')
        records.append({'state':state,'sourceAction':prior.name,'samples':rows})
    animation.action=initial_action
    for t,mute in mutes:t.mute=mute
    reset();scene.frame_set(initial_frame);bpy.context.view_layer.update()
    report={'operation':'Only per-frame hip worldZ offsets; actual final-scaled semantic bare foot placed at zero before throw authoring',
            'semanticParts':[{'name':obj.name,'vertices':len(ids)} for obj,ids in feet],'states':records,
            'runtimeApproved':False,'finishedUnitApproved':False}
    arm['peris_original_giant_ground_fit']=json.dumps(report)
    return report


def apply_giant_throw(arm, meshes, role='catapult'):
    if role!='catapult' or arm.get('peris_original_giant_throw'):
        raise ValueError('Use a fresh giant siege derivative')
    scene=bpy.context.scene;animation=arm.animation_data
    tracks={state:next(t for t in animation.nla_tracks if t.name==role+'_'+state)
            for state in ['idle','walk','attack']}
    stones=[o for o in meshes if 'Held siege boulder' in o.name]
    if len(stones)!=1:raise ValueError('One explicit held siege stone required')
    stone=stones[0];center=sum((v.co for v in stone.data.vertices),Vector())/len(stone.data.vertices)
    source_basis={b.name:_channels(b) for b in arm.pose.bones}
    old_frame=scene.frame_current;old_action=animation.action;mutes=[(t,t.mute) for t in animation.nla_tracks]
    source_actions={s:tracks[s].strips[0].action for s in tracks}
    # The new stone control is a rigid child at the actual held mesh center.
    bpy.ops.object.select_all(action='DESELECT');arm.select_set(True);bpy.context.view_layer.objects.active=arm
    bpy.ops.object.mode_set(mode='EDIT')
    control_name='peris_giant_stone_release'
    bone=arm.data.edit_bones.new(control_name);bone.head=center
    bone.tail=center+Vector((0,0,.15));bone.parent=arm.data.edit_bones['hand_R'];bone.use_connect=False
    bpy.ops.object.mode_set(mode='OBJECT')
    control=arm.pose.bones[control_name];control.rotation_mode='QUATERNION'
    group=stone.vertex_groups.new(name=control.name)
    for old in list(stone.vertex_groups):
        if old!=group:stone.vertex_groups.remove(old)
    group.add(list(range(len(stone.data.vertices))),1.,'REPLACE')
    baseline={b.name:_channels(b) for b in arm.pose.bones}
    frames=[]
    animation.action=None
    for t,_ in mutes:t.mute=t!=tracks['idle']
    for frame in range(1,26):
        for b in arm.pose.bones:_restore(b,baseline[b.name])
        scene.frame_set(frame);bpy.context.view_layer.update()
        frames.append({'frame':frame,'local':{b.name:_channels(b) for b in arm.pose.bones},
                       'matrices':{n:arm.pose.bones[n].matrix.copy() for n in ['arm_R','forearm_R','hand_R']},
                       'heads':{n:arm.pose.bones[n].head.copy() for n in ['arm_R','forearm_R','hand_R']}})
    # New property is explicitly restored in every state; old channels copied.
    for state in ['idle','walk']:
        action=source_actions[state].copy();action.name='Peris giant '+state+' with held-stone visibility'
        animation.action=action
        for t,_ in mutes:t.mute=True
        for frame in [1,25]:
            control.scale=(1,1,1);control.keyframe_insert('scale',frame=frame,group=control.name)
        tracks[state].strips[0].action=action
    action=source_actions['attack'].copy();action.name='catapult_attack Peris planted boulder throw'
    for curve in list(action.fcurves):
        if curve.data_path.startswith('pose.bones['):action.fcurves.remove(curve)
    animation.action=action
    for t,_ in mutes:t.mute=True
    rows=[]
    for sample in frames:
        frame=sample['frame'];scene.frame_set(frame)
        for b in arm.pose.bones:_restore(b,sample['local'][b.name])
        bpy.context.view_layer.update()
        s=sample['heads']['arm_R'];e0=sample['heads']['forearm_R'];h0=sample['heads']['hand_R']
        wind=Vector((-1.12,.52,4.55));release=Vector((-.98,-1.20,3.99));follow=Vector((-.98,-1.19,3.57))
        target=_segment(frame,[(1,h0),(3,h0),(8,wind),(12,release),(15,follow),(23,h0),(25,h0)])
        a=(e0-s).length;b=(h0-e0).length;d=(target-s).length
        axis=(target-s).normalized();d=min(max(d,abs(a-b)+.001),a+b-.012);target=s+axis*d
        along=(a*a-b*b+d*d)/(2*d);height=math.sqrt(max(0,a*a-along*along))
        pole=Vector((-2.2,.05,4.15))-s;pole=(pole-axis*pole.dot(axis)).normalized()
        elbow=s+axis*along+pole*height
        upper=arm.pose.bones['arm_R'];fore=arm.pose.bones['forearm_R'];hand=arm.pose.bones['hand_R']
        if 3<frame<23:
            turn=(e0-s).normalized().rotation_difference((elbow-s).normalized())
            _orient(upper,turn.to_matrix().to_4x4()@sample['matrices']['arm_R'],sample['local']['arm_R']['location'],sample['local']['arm_R']['scale'])
            actual_elbow=fore.head.copy()
            turn=(h0-e0).normalized().rotation_difference((target-actual_elbow).normalized())
            _orient(fore,turn.to_matrix().to_4x4()@sample['matrices']['forearm_R'],sample['local']['forearm_R']['location'],sample['local']['forearm_R']['scale'])
            # Nonuniform inherited source scales make the simple two-bone
            # approximation inexact. Correct the measured wrist position by
            # rotation only; retain every source location/scale and local hand
            # orientation instead of stretching limbs toward the target.
            for iteration in range(18):
                bpy.context.view_layer.update();actual=hand.head.copy();error=target-actual
                if error.length<.001:break
                columns=[]
                for joint in [upper,fore]:
                    q=joint.rotation_quaternion.copy()
                    for axis in [(1,0,0),(0,1,0),(0,0,1)]:
                        joint.rotation_quaternion=q@Quaternion(axis,.002)
                        bpy.context.view_layer.update();columns.append(np.asarray(tuple((hand.head-actual)/.002)))
                        joint.rotation_quaternion=q
                        bpy.context.view_layer.update()
                jacobian=np.asarray(columns).T
                delta=jacobian.T@np.linalg.solve(jacobian@jacobian.T+np.eye(3)*.0004,np.asarray(tuple(error)))
                maximum=max(abs(delta));delta*=min(1.,.16/max(maximum,1e-8))
                for index,joint in enumerate([upper,fore]):
                    vector=Vector(tuple(delta[index*3:index*3+3]));angle=vector.length
                    if angle>1e-8:joint.rotation_quaternion=joint.rotation_quaternion@Quaternion(vector.normalized(),angle)
                bpy.context.view_layer.update()
        # Small positive scale avoids singular skin matrices during release.
        visible=frame<=11 or frame>=21;control.scale=(1,1,1) if visible else (.001,.001,.001)
        for bone in arm.pose.bones:
            bone.keyframe_insert('location',frame=frame,group=bone.name)
            rotation='rotation_quaternion' if bone.rotation_mode=='QUATERNION' else 'rotation_euler'
            bone.keyframe_insert(rotation,frame=frame,group=bone.name);bone.keyframe_insert('scale',frame=frame,group=bone.name)
        bpy.context.view_layer.update()
        rows.append({'frame':frame,'handTargetArmature':list(target),'handActualArmature':list(hand.head),
                     'targetErrorArmature':(hand.head-target).length,'stoneVisible':visible,
                     'heldStoneWorldCenter':list(arm.matrix_world@control.head)})
    for curve in action.fcurves:
        for key in curve.keyframe_points:key.interpolation='LINEAR'
    tracks['attack'].strips[0].action=action
    record={'author':'Peris: original planted siege giant throw motion on credited 0 A.D. rig',
            'role':role,'nativeFrames':[1,25],'fps':24,'sourceAttack':source_actions['attack'].name,
            'attack':action.name,'releaseBone':control.name,'releaseFrames':[12,20],
            'operations':['Independent existing idle poses anchor planted feet and head',
                          'Measured two-bone arm reach: side carry, high windup, forward throw, follow-through and recover',
                          'One original child control shrinks only held stone at release; explicit visible keys in other states'],
            'preserved':['all existing rest bones','body/cloth/head/material/UV geometry','source idle/walk transform channels'],
            'runtimeProjectileImplemented':False,'runtimeApproved':False,'finishedUnitApproved':False,
            'samples':rows}
    arm['peris_original_giant_throw']=json.dumps(record);action['peris_original_giant_throw']=json.dumps(record)
    action['asset_author']=record['author'];action['asset_license']='CC-BY-SA-3.0'
    action['runtime_approved']=False;action['peris_unit_finished']=False
    animation.action=old_action
    for t,mute in mutes:t.mute=mute
    for bone in arm.pose.bones:_restore(bone,baseline[bone.name])
    scene.frame_set(old_frame);bpy.context.view_layer.update()
    return record
