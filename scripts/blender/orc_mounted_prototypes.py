"""Scoped gross-fit corrections for the owned Orc mounted prototype edition.

Existing rest bones and hand sockets are retained. New authored seated pose
keys use each source strip's original action slot/time mapping. Source files
are handled by the caller and are never overwritten by this module.
"""
import json, math, re, pathlib
import bpy
from mathutils import Vector, Matrix
import orc_mounted_fit as fit


def attached(arm):
    return [o for o in bpy.data.objects if o.type=='MESH' and
            (o.parent==arm or any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers))]


def material(name,color,metal=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=.75
    return m


def _rest_from_world(arm,bone,point):
    b=arm.data.bones[bone]
    return b.matrix_local @ arm.pose.bones[bone].matrix.inverted() @ arm.matrix_world.inverted() @ point


def prop_mesh(name,world_vertices,faces,arm,bone,role,mat,weights=None):
    verts=[_rest_from_world(arm,bone,Vector(p)) for p in world_vertices]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(role+' '+name,mesh);bpy.data.collections['PERIS_EXPORT'].objects.link(obj)
    obj.parent=arm;mesh.materials.append(mat)
    if weights:
        for index,entries in enumerate(weights):
            for bn,w in entries:
                group=obj.vertex_groups.get(bn) or obj.vertex_groups.new(name=bn)
                group.add([index],w,'REPLACE')
    else:
        obj.vertex_groups.new(name=bone).add(list(range(len(verts))),1,'REPLACE')
    mod=obj.modifiers.new('Original Peris mounted tack','ARMATURE');mod.object=arm
    obj['peris_role']=role;obj['asset_author']='Peris, with Wildfire Games body/rig adaptation'
    obj['asset_license']='CC-BY-SA-3.0';obj['original_peris_equipment']=True
    obj['runtime_approved']=False;obj['peris_unit_finished']=False
    uv=mesh.uv_layers.new(name='Original tack UV')
    for poly in mesh.polygons:
        poly.use_smooth=True
        for li in poly.loop_indices:
            p=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=(p.x*.2+.5,p.y*.2+.5)
    return obj


def cushion(arm,bone,role,center,length,width,height,mat,name='Fitted rounded riding saddle'):
    cols,rows=24,12;verts=[]
    for r in range(rows+1):
        phi=math.pi*r/rows
        for c in range(cols):
            theta=math.tau*c/cols
            verts.append(center+Vector((math.cos(theta)*math.sin(phi)*length/2,
                                        math.sin(theta)*math.sin(phi)*width/2,
                                        math.cos(phi)*height/2)))
    faces=[(r*cols+c,r*cols+(c+1)%cols,(r+1)*cols+(c+1)%cols,(r+1)*cols+c)
           for r in range(rows) for c in range(cols)]
    return prop_mesh(name,verts,faces,arm,bone,role,mat)


def rope(arm,role,bone,points,radius,mat,name,head_bone=None):
    cols=8;verts=[];weights=[]
    for row,p in enumerate(points):
        tangent=(points[min(row+1,len(points)-1)]-points[max(0,row-1)]).normalized()
        side=tangent.cross(Vector((0,0,1)))
        if side.length<.01:side=tangent.cross(Vector((0,1,0)))
        side.normalize();up=tangent.cross(side).normalized()
        t=row/(len(points)-1)
        for c in range(cols):
            a=math.tau*c/cols;verts.append(p+radius*(side*math.cos(a)+up*math.sin(a)))
            weights.append([(head_bone,1-t),(bone,t)] if head_bone else [(bone,1)])
    faces=[tuple(range(cols-1,-1,-1)),tuple(range((len(points)-1)*cols,len(points)*cols))]
    faces += [(r*cols+c,r*cols+(c+1)%cols,(r+1)*cols+(c+1)%cols,(r+1)*cols+c)
              for r in range(len(points)-1) for c in range(cols)]
    # Different weights need coordinates which coincide in the authored idle.
    obj=prop_mesh(name,verts,faces,arm,bone,role,mat,weights)
    if head_bone:
        # Skinning rest offsets differ per influencing bone. At idle, both
        # transforms must reproduce each same world-space witness exactly.
        for i,v in enumerate(obj.data.vertices):
            t=(i//cols)/(len(points)-1)
            transforms=[]
            for bn,w in [(bone,t),(head_bone,1-t)]:
                transforms.append((arm.matrix_world@arm.pose.bones[bn].matrix@arm.data.bones[bn].matrix_local.inverted(),w))
            blended=Matrix([[sum(m[r][c]*w for m,w in transforms) for c in range(4)] for r in range(4)])
            v.co=blended.inverted()@verts[i]
    return obj


def _pose_matrix(bone,head,direction):
    return Matrix.LocRotScale(head,Vector(direction).to_track_quat('Y','Z'),Vector((1,1,1)))


def _basis(arm,name,desired,parents):
    bone=arm.data.bones[name]
    if bone.parent:
        parent=parents.get(bone.parent.name,arm.pose.bones[bone.parent.name].matrix)
        return bone.convert_local_to_pose(desired,bone.matrix_local,parent_matrix=parent,
                                          parent_matrix_local=bone.parent.matrix_local,invert=True)
    return bone.convert_local_to_pose(desired,bone.matrix_local,invert=True)


def _key_matrices(arm,strip,samples,names):
    action=strip.action;slot=strip.action_slot
    # Preserve original arm/hand attack channels except explicit seated limbs.
    curves=action.layers[0].strips[0].channelbag(slot).fcurves if action.is_action_layered else action.fcurves
    for curve in list(curves):
        if any(curve.data_path.startswith('pose.bones["'+n+'"]') for n in names):curves.remove(curve)
    for track in arm.animation_data.nla_tracks:track.mute=True
    arm.animation_data.action=action;arm.animation_data.action_slot=slot
    for time,matrices in samples:
        for name,matrix in matrices.items():
            b=arm.pose.bones[name];b.rotation_mode='QUATERNION';b.matrix_basis=matrix
            for prop in ['location','rotation_quaternion','scale']:b.keyframe_insert(prop,frame=time,group=name)
    for curve in curves:
        if any(curve.data_path.startswith('pose.bones["'+n+'"]') for n in names):
            for key in curve.keyframe_points:key.interpolation='LINEAR'
    arm.animation_data.action=None


def seated_rider(mount,rider,role,hip_target_world,width,hold_reins=False):
    arms=[mount,rider];baseline=fit.snapshot_pose_baseline(arms)
    socket=rider.parent_bone
    local_target=(mount.matrix_world@mount.pose.bones[socket].matrix).inverted()@hip_target_world
    names=['hip','thigh_L','thigh_R','leg_L','leg_R','foot_L','foot_R']
    if hold_reins:names+=['arm_L','arm_R','forearm_L','forearm_R','hand_L','hand_R']
    all_samples=[]
    for state in ['idle','walk','attack']:
        track=rider.animation_data.nla_tracks[role+'_'+state];strip=track.strips[0];samples=[]
        exact={a.name:{'nla_track':role+'_'+state} for a in arms}
        for frame in range(1,26):
            fit.restore_and_sample(arms,role,exact,frame,baseline)
            hip_world=mount.matrix_world@mount.pose.bones[socket].matrix@local_target
            inv=rider.matrix_world.inverted();hip=inv@hip_world
            hpose=rider.pose.bones['hip'].matrix.copy();hpose.translation=hip
            desired={'hip':hpose};basis={'hip':_basis(rider,'hip',hpose,desired)}
            rider.pose.bones['hip'].matrix_basis=basis['hip'];bpy.context.view_layer.update()
            for side in ['L','R']:
                sign=1 if side=='L' else -1
                tn,ln,fn='thigh_'+side,'leg_'+side,'foot_'+side
                thigh,shin,foot=[rider.data.bones[n] for n in [tn,ln,fn]]
                start_world=rider.matrix_world@rider.pose.bones[tn].head
                thigh_world=(rider.matrix_world.to_3x3()@Vector((0,thigh.length,0))).length
                lateral=max(.55,width/2+.28-abs(start_world.y-hip_world.y))
                direction=Vector((math.sqrt(max(.1,thigh_world**2-lateral**2-(thigh_world*.18)**2)),sign*lateral,-thigh_world*.18)).normalized()
                knee_world=start_world+direction*thigh_world
                shin_world=(rider.matrix_world.to_3x3()@Vector((0,shin.length,0))).length
                ankle_world=knee_world+Vector((-.06,sign*.035,-1)).normalized()*shin_world
                start,knee,ankle=inv@start_world,inv@knee_world,inv@ankle_world
                desired[tn]=_pose_matrix(thigh,start,knee-start)
                desired[ln]=_pose_matrix(shin,knee,ankle-knee)
                toe_direction=inv.to_3x3()@Vector((1,0,-.07))
                desired[fn]=_pose_matrix(foot,ankle,toe_direction)
            if hold_reins:
                for side in ['L','R']:
                    sign=1 if side=='L' else -1;an,fn,hn='arm_'+side,'forearm_'+side,'hand_'+side
                    shoulder=rider.matrix_world@rider.pose.bones[an].head
                    wrist=hip_world+Vector((.95,sign*.78,.55));delta=wrist-shoulder;unit=delta.normalized()
                    length1=(rider.matrix_world.to_3x3()@Vector((0,rider.data.bones[an].length,0))).length
                    length2=(rider.matrix_world.to_3x3()@Vector((0,rider.data.bones[fn].length,0))).length
                    dist=min(delta.length,length1+length2-.02);along=(length1**2-length2**2+dist**2)/(2*dist)
                    bend=Vector((.35,sign,0));bend=(bend-unit*bend.dot(unit)).normalized()
                    elbow=shoulder+unit*along+bend*math.sqrt(max(0,length1**2-along**2))
                    s,e,w=inv@shoulder,inv@elbow,inv@wrist
                    desired[an]=_pose_matrix(rider.data.bones[an],s,e-s)
                    desired[fn]=_pose_matrix(rider.data.bones[fn],e,w-e)
                    desired[hn]=_pose_matrix(rider.data.bones[hn],w,inv.to_3x3()@Vector((1,0,-.22)))
            for name in names:basis[name]=_basis(rider,name,desired[name],desired)
            time=strip.action_frame_start+(strip.action_frame_end-strip.action_frame_start)*(frame-1)/24
            samples.append((time,basis))
        all_samples.append((strip,samples))
    fit.restore_pose_baseline(arms,baseline)
    for strip,samples in all_samples:_key_matrices(rider,strip,samples,names)
    rider['peris_mounted_prototype_pose']=json.dumps({'role':role,'operation':'original seated hip/thigh/knee pose in existing source clips; scout hands held at reins',
                                                   'source_strip_time_mapping_preserved':True,'existing_rest_bones_retained':True,'sampled_frames':list(range(1,26)),
                                                   'hip_target_idle_world':list(hip_target_world),'back_flank_width_world':width,'runtimeApproved':False})
    return local_target


def floor_fit(mount,rider,role):
    """Copy and bake a world Z correction in the existing mount action slot."""
    arms=[mount,rider];baseline=fit.snapshot_pose_baseline(arms);meshes=attached(mount);stored=[]
    original_location_z=mount.location.z
    for state in ['idle','walk','attack']:
        strip=mount.animation_data.nla_tracks[role+'_'+state].strips[0]
        exact={a.name:{'nla_track':role+'_'+state} for a in arms};samples=[]
        for frame in range(1,26):
            fit.restore_and_sample(arms,role,exact,frame,baseline)
            data=fit._evaluated_meshes(meshes,bpy.context.evaluated_depsgraph_get())
            lowest=min(p.z for d in data.values() for p in d['vertices'])
            time=strip.action_frame_start+(strip.action_frame_end-strip.action_frame_start)*(frame-1)/24
            samples.append((time,mount.location.z+.018-lowest,lowest))
        stored.append((strip,samples))
    fit.restore_pose_baseline(arms,baseline)
    for strip,samples in stored:
        ad=mount.animation_data;ad.action=strip.action;ad.action_slot=strip.action_slot
        for track in ad.nla_tracks:track.mute=True
        for time,z,lowest in samples:
            mount.location.z=z;mount.keyframe_insert('location',index=2,frame=time,group='Peris mounted floor correction')
        ad.action=None
    mount.location.z=original_location_z
    # Restore the actual saved object location explicitly; pose helper restores
    # pose/NLA, while floor authoring is intentionally a new object channel.
    mount['peris_mounted_floor_correction']=json.dumps({'role':role,'operation':'World Z correction only; mount and bone-parented rider move together',
                                                      'floor_z':0,'clearance':.018,'all_vertex_not_sole_contact':True,
                                                      'original_strip_mapping':True,'states':[{ 'state':state,'samples':[[t,z,low] for t,z,low in samples]}
                                                      for state,(_,samples) in zip(['idle','walk','attack'],stored)],'runtimeApproved':False})
    return stored


def copy_accepted_palette(source_path):
    """Reuse immutable accepted V19 color materials; no new paint/sculpt pass."""
    old_objects=list(bpy.data.objects)
    with bpy.data.libraries.load(str(source_path),link=False) as (source,target):
        target.materials=[n for n in source.materials if ' Peris portrait surface study' in n or n.startswith('Peris portrait charcoal iron') or n.startswith('Peris portrait copper')]
    accepted=[m for m in target.materials if m]
    canonical=lambda n:re.sub(r'\.\d{3}$','',n)
    painted={canonical(m.name.split(' Peris portrait surface study')[0]):m for m in accepted if ' Peris portrait surface study' in m.name}
    iron=next((m for m in accepted if 'charcoal iron' in m.name and 'worn field' in m.name),None)
    changed=[]
    for obj in old_objects:
        if obj.type!='MESH':continue
        for index,old in enumerate(obj.data.materials):
            new=painted.get(canonical(old.name))
            if old.name.startswith('Orc rusted hammered iron') and iron:new=iron
            if new:obj.data.materials[index]=new;changed.append([obj.name,old.name,new.name])
    return changed


def hand_bound_reins(mount,rider,role,mat,name_prefix='Scout rein'):
    """Bake an original muzzle anchor in the rider rig for one-skinned reins.

    Existing rest bones and clips are preserved. A new original tack bone is
    sampled from the real mount head, while each distal ring is rigid to the
    actual rider hand. This avoids using a seat-bone proxy for the grip.
    """
    arms=[mount,rider]
    baseline=fit.snapshot_pose_baseline(arms)
    exact={a.name:{'nla_track':role+'_idle'} for a in arms}
    fit.restore_and_sample(arms,role,exact,1,baseline)
    head=next(b.name for b in mount.data.bones if 'head' in b.name.lower())
    anchor_names={side:'peris_original_rein_muzzle_'+side for side in ['L','R']}
    idle_head=mount.matrix_world@mount.pose.bones[head].matrix
    idle_anchor_world={}
    rest_matrices={}
    for side in ['L','R']:
        idle=rider.matrix_world@rider.pose.bones['hand_'+side].matrix
        idle.translation=idle_head.translation
        idle_anchor_world[side]=idle
        rest=rider.data.bones['hand_'+side].matrix_local.copy()
        rest.translation=(rider.matrix_world.inverted()@idle).translation
        rest_matrices[side]=rest
    bpy.context.view_layer.objects.active=rider
    bpy.ops.object.mode_set(mode='EDIT')
    for side,anchor_name in anchor_names.items():
        anchor=rider.data.edit_bones.new(anchor_name)
        anchor.matrix=rest_matrices[side]
        anchor.length=1
    bpy.ops.object.mode_set(mode='OBJECT')
    for anchor_name in anchor_names.values():rider.pose.bones[anchor_name].rotation_mode='QUATERNION'
    baseline=fit.snapshot_pose_baseline(arms)
    samples_by_strip=[]
    for state in ['idle','walk','attack']:
        strip=rider.animation_data.nla_tracks[role+'_'+state].strips[0]
        exact={a.name:{'nla_track':role+'_'+state} for a in arms};samples=[]
        for frame in range(1,26):
            fit.restore_and_sample(arms,role,exact,frame,baseline)
            head_delta=(mount.matrix_world@mount.pose.bones[head].matrix)@idle_head.inverted()
            matrices={anchor_names[side]:_basis(rider,anchor_names[side],rider.matrix_world.inverted()@head_delta@idle_anchor_world[side],{}) for side in ['L','R']}
            time=strip.action_frame_start+(strip.action_frame_end-strip.action_frame_start)*(frame-1)/24
            samples.append((time,matrices))
        samples_by_strip.append((strip,samples))
    fit.restore_pose_baseline(arms,baseline)
    for strip,samples in samples_by_strip:_key_matrices(rider,strip,samples,list(anchor_names.values()))
    baseline=fit.snapshot_pose_baseline(arms)
    fit.restore_and_sample(arms,role,{a.name:{'nla_track':role+'_idle'} for a in arms},1,baseline)
    head_world=mount.matrix_world@mount.pose.bones[head].head
    created=[]
    for side in ['L','R']:
        name=role+' '+name_prefix+' '+side
        old=bpy.data.objects.get(name)
        if old:bpy.data.objects.remove(old,do_unlink=True)
        sign=1 if side=='L' else -1
        grip=rider.matrix_world@rider.pose.bones['hand_'+side].matrix@Vector((0,.15,0))
        start=head_world+Vector((.6,sign*.58,-.45))
        points=[start.lerp(grip,t/12)+Vector((0,0,-.25*4*(t/12)*(1-t/12))) for t in range(13)]
        obj=rope(rider,role,'hand_'+side,points,.065,mat,name_prefix+' '+side,head_bone=anchor_names[side])
        obj['peris_original_tack_bone']=anchor_names[side]
        created.append(obj.name)
    return {'operation':'actual mount-head motion baked into original tack anchor; distal rein rings rigid to each actual hand',
            'added_original_bones':list(anchor_names.values()),'existing_rest_bones_retained':True,
            'idle_skinning_rotation_matched_to_each_hand':True,
            'sampled_frames':list(range(1,26)),'source_strip_time_mapping_preserved':True,
            'created':created,'runtime_approved':False}


def sampled_curve_reins(mount,rider,role,mat,name_prefix='Cavalry rein'):
    """Original sampled tack curves, with each ring on its own tack bone.

    Avoid linear inverse blending of distant hand/head transforms. The actual
    muzzle and hand witnesses are sampled into coherent intermediate points
    for every integer frame in the existing three action slots.
    """
    arms=[mount,rider];baseline=fit.snapshot_pose_baseline(arms)
    fit.restore_and_sample(arms,role,{a.name:{'nla_track':role+'_idle'} for a in arms},1,baseline)
    head=next(b.name for b in mount.data.bones if 'head' in b.name.lower())
    head_matrix=mount.matrix_world@mount.pose.bones[head].matrix
    starts={side:head_matrix.inverted()@(head_matrix.translation+Vector((.6,(1 if side=='L' else -1)*.58,-.45))) for side in ['L','R']}
    rows,cols=13,8
    def path_points(side):
        head_world=mount.matrix_world@mount.pose.bones[head].matrix
        start=head_world@starts[side]
        grip=rider.matrix_world@rider.pose.bones['hand_'+side].matrix@Vector((0,.15,0))
        return [start.lerp(grip,i/(rows-1))+Vector((0,0,-.25*4*(i/(rows-1))*(1-i/(rows-1)))) for i in range(rows)]
    idle_paths={side:path_points(side) for side in ['L','R']}
    names={side:[f'peris_original_rein_{side}_{i:02d}' for i in range(rows)] for side in ['L','R']}
    def world_matrix(points,i):
        direction=(points[min(i+1,rows-1)]-points[max(i-1,0)]).normalized()
        return Matrix.LocRotScale(points[i],direction.to_track_quat('Y','Z'),Vector((1,1,1)))
    inv=rider.matrix_world.inverted()
    bpy.context.view_layer.objects.active=rider;bpy.ops.object.mode_set(mode='EDIT')
    for side in ['L','R']:
        for i,name in enumerate(names[side]):
            b=rider.data.edit_bones.new(name);b.matrix=inv@world_matrix(idle_paths[side],i);b.length=.2
    bpy.ops.object.mode_set(mode='OBJECT')
    for ns in names.values():
        for name in ns:rider.pose.bones[name].rotation_mode='QUATERNION'
    baseline=fit.snapshot_pose_baseline(arms);stored=[]
    for state in ['idle','walk','attack']:
        strip=rider.animation_data.nla_tracks[role+'_'+state].strips[0];samples=[]
        exact={a.name:{'nla_track':role+'_'+state} for a in arms}
        for frame in range(1,26):
            fit.restore_and_sample(arms,role,exact,frame,baseline)
            inv=rider.matrix_world.inverted();matrices={}
            for side in ['L','R']:
                points=path_points(side)
                for i,name in enumerate(names[side]):matrices[name]=_basis(rider,name,inv@world_matrix(points,i),{})
            time=strip.action_frame_start+(strip.action_frame_end-strip.action_frame_start)*(frame-1)/24
            samples.append((time,matrices))
        stored.append((strip,samples))
    fit.restore_pose_baseline(arms,baseline)
    all_names=names['L']+names['R']
    for strip,samples in stored:_key_matrices(rider,strip,samples,all_names)
    baseline=fit.snapshot_pose_baseline(arms)
    fit.restore_and_sample(arms,role,{a.name:{'nla_track':role+'_idle'} for a in arms},1,baseline)
    created=[]
    for side in ['L','R']:
        points=path_points(side);vertices=[];weights=[]
        for i,p in enumerate(points):
            matrix=world_matrix(points,i)
            for c in range(cols):
                angle=math.tau*c/cols
                vertices.append(matrix@Vector((.065*math.cos(angle),0,.065*math.sin(angle))))
                weights.append([(names[side][i],1)])
        faces=[tuple(range(cols-1,-1,-1)),tuple(range((rows-1)*cols,rows*cols))]
        faces += [(r*cols+c,r*cols+(c+1)%cols,(r+1)*cols+(c+1)%cols,(r+1)*cols+c) for r in range(rows-1) for c in range(cols)]
        old=bpy.data.objects.get(role+' '+name_prefix+' '+side)
        if old:bpy.data.objects.remove(old,do_unlink=True)
        obj=prop_mesh(name_prefix+' '+side,vertices,faces,rider,names[side][0],role,mat,weights)
        for i,v in enumerate(obj.data.vertices):v.co=_rest_from_world(rider,names[side][i//cols],vertices[i])
        obj['peris_original_sampled_tack_curve']=True;created.append(obj.name)
    return {'operation':'actual muzzle-to-hand path sampled into original ring controls in existing source action slots',
            'added_original_tack_bones':all_names,'existing_rest_bones_retained':True,'new_rig_or_clip':False,
            'sampled_frames':list(range(1,26)),'source_strip_time_mapping_preserved':True,
            'one_weight_per_cross_section':True,'created':created,'runtime_approved':False}
