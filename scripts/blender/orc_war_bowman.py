"""Reproduce the user-reviewed War Bowman arrow, draw hand and bowstring.

Run once on an unpacked original Orc archer after canonical source clip ground
fitting, before palette/atlas packing. Exact source bow ownership is checked;
the calibrated bow-tip coordinates refer to 0 A.D. bow_short.xml only.
"""
import bpy, bmesh, json, math
from mathutils import Vector, Matrix
from roster_orc_equipment import _mesh


def apply_war_bowman(lib, arm, geometry, role='archer'):
    if role!='archer' or arm.get('peris_bowman_functional_contact'):
        raise ValueError('War Bowman correction requires a fresh unpacked archer')
    collection=lib.collection;scene=bpy.context.scene
    parts=[o for o in lib.groups[role] if any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]
    body=next(o for o in parts if o.get('peris_orc_original_anatomy'))
    bow=next(o for o in parts if o.get('source_actor')=='props/units/weapons/bow_short.xml')
    old=next(o for o in parts if o.get('source_actor')=='props/units/weapons/arrow_back.xml')
    owner=next(g.name for g in bow.vertex_groups if sum(a.weight for v in bow.data.vertices for a in v.groups if a.group==g.index)>len(bow.data.vertices)*.9)
    if owner!='prop-weapon_bow':raise ValueError('Unreviewed source bow ownership: '+owner)
    baseline={b.name:b.matrix_basis.copy() for b in arm.pose.bones}
    hand=arm.data.bones['hand_R'];prop=arm.data.bones['prop-weapon_R']
    hm=hand.matrix_local.copy();pm=prop.matrix_local.copy()
    skin_index=next(i for i,m in enumerate(body.data.materials) if 'skin' in m.name.lower());skin=body.data.materials[skin_index]
    names={g.index:g.name for g in body.vertex_groups}
    weights={v.index:{names[g.group]:g.weight for g in v.groups} for v in body.data.vertices}
    painted=[]
    for face in body.data.polygons:
        w=sum(sum(value for name,value in weights[i].items() if name.startswith(('hand_','finger_','fingertip_'))) for i in face.vertices)/len(face.vertices)
        if w>.32 and face.material_index!=skin_index:face.material_index=skin_index;painted.append(face.index)
    for side in ['L','R']:
        matrix=arm.data.bones['hand_'+side].matrix_local;inverse=matrix.inverted()
        for v in body.data.vertices:
            w=weights[v.index];finger=sum(w.get(name+'_'+side,0) for name in ['finger','fingertip'])
            if finger>.005:
                p=inverse@v.co;p.x*=1-.22*finger;p.z*=1-.16*finger;v.co=matrix@p
    bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active
    remove=[f for f in bm.faces if sum(sum(w for i,w in v[layer].items() if names.get(i) in ['hand_R','finger_R','fingertip_R']) for v in f.verts)/len(f.verts)>.64]
    removed=len(remove);bmesh.ops.delete(bm,geom=remove,context='FACES_ONLY');bm.to_mesh(body.data);bm.free();body.data.update()
    # Compact bare wrist; the reviewed retained source lip is not claimed welded.
    for obj in parts:
        if 'measured hide forearm wrap' not in obj.name:continue
        groups={g.index:g.name for g in obj.vertex_groups}
        side='R' if sum(g.weight for v in obj.data.vertices for g in v.groups if groups.get(g.group)=='forearm_R')>1 else 'L'
        bone=arm.data.bones['forearm_'+side];axis=(bone.tail_local-bone.head_local).normalized()
        for vertex in obj.data.vertices:
            t=(vertex.co-bone.head_local).dot(axis)/bone.length
            if t>.78:vertex.co-=axis*(t-.78)*bone.length
        obj.data.update()
    pieces=[]
    def ellipsoid(name,p,s):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,location=hm@Vector(p))
        obj=bpy.context.object;obj.name=name;obj.rotation_euler=hm.to_quaternion().to_euler();obj.scale=s
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);pieces.append(obj)
    def tube(name,points,radii):
        vertices=[];faces=[];count=12;points=[Vector(p) for p in points]
        for j,p in enumerate(points):
            tangent=(points[min(j+1,len(points)-1)]-points[max(j-1,0)]).normalized();a=tangent.cross(Vector((0,0,1)))
            if a.length<.1:a=tangent.cross(Vector((0,1,0)))
            a.normalize();b=tangent.cross(a).normalized()
            for i in range(count):vertices.append(hm@(p+(a*math.cos(i*math.tau/count)+b*math.sin(i*math.tau/count))*radii[j]))
        for j in range(len(points)-1):
            for i in range(count):faces.append((j*count+i,j*count+(i+1)%count,(j+1)*count+(i+1)%count,(j+1)*count+i))
        faces.extend([tuple(range(count-1,-1,-1)),tuple(range((len(points)-1)*count,len(points)*count))])
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
        obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj);pieces.append(obj)
    ellipsoid('Original Orc archer broad palm',(0,.09,0),(.091,.131,.084))
    ellipsoid('Original Orc archer wrist overlap',(0,-.022,0),(.095,.086,.093))
    grip=hm.inverted()@pm.translation;axis=(hm.inverted().to_3x3()@pm.to_3x3().col[1]).normalized()
    g=grip+axis*.005;radial=axis.cross(Vector((0,1,0)))
    if radial.length<.1:radial=axis.cross(Vector((0,0,1)))
    radial.normalize();other=axis.cross(radial).normalized()
    for i in range(2):
        p=g+axis*(-.012-i*.042);start=Vector((.026,.157-i*.018,.051-i*.052))
        path=[start,start.lerp(p+radial*.046,.65),p+radial*.035,p+radial*.020-other*.007]
        tube('Original War Bowman curled draw finger',path,[.031,.029,.024,.020]);ellipsoid('War Bowman rounded draw fingertip',path[-1],(.022,.022,.022))
    tube('Original War Bowman opposing nock thumb',[(-.06,.052,.035),(-.052,.116,.052),g-radial*.044,g-radial*.025],[.035,.032,.027,.021])
    ellipsoid('Original War Bowman padded thumb tip',g-radial*.025,(.022,.022,.022))
    for i in range(2):
        tube('Original War Bowman folded supporting finger',[(.016,.123,.002-i*.042),(.082,.16,-.005-i*.038),(.081,.12,-.04-i*.034),(.020,.10,-.038-i*.036)],[.029,.028,.024,.021])
    bpy.ops.object.select_all(action='DESELECT')
    for obj in pieces:obj.select_set(True)
    bpy.context.view_layer.objects.active=pieces[0];bpy.ops.object.join();new_hand=bpy.context.object
    new_hand.name='archer Original connected nock draw hand';bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    modifier=new_hand.modifiers.new('Original connected digit union','REMESH');modifier.mode='VOXEL';modifier.voxel_size=.0065;modifier.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    modifier=new_hand.modifiers.new('Soft palm fingertip finish','SMOOTH');modifier.factor=.38;modifier.iterations=3;bpy.ops.object.modifier_apply(modifier=modifier.name)
    for coll in list(new_hand.users_collection):coll.objects.unlink(new_hand)
    collection.objects.link(new_hand);new_hand.parent=arm;new_hand.matrix_parent_inverse=Matrix.Identity(4);new_hand.matrix_basis=Matrix.Identity(4)
    new_hand.vertex_groups.new(name='hand_R').add(list(range(len(new_hand.data.vertices))),1,'REPLACE')
    new_hand.modifiers.new('Draw hand inherited attachment','ARMATURE').object=arm;new_hand.data.materials.clear();new_hand.data.materials.append(skin)
    new_hand['peris_role']=role;new_hand['asset_license']='CC-BY-SA-3.0';new_hand['asset_author']='Peris original draw hand; adapted Wildfire Games rig'
    new_hand['runtime_approved']=False;new_hand['peris_unit_finished']=False;lib.groups[role].append(new_hand)
    bpy.context.view_layer.objects.active=new_hand;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT')
    for face in new_hand.data.polygons:face.use_smooth=True
    wood=bow.data.materials[0]
    # Fresh builds precede the charcoal surface pass; replayed derivatives
    # already carry that finish. Both use the same original iron geometry.
    iron=next(m for obj in parts for m in obj.data.materials if 'iron' in m.name.lower())
    feather=bpy.data.materials.new('War Bowman restrained ash-brown arrow feathers');feather.use_nodes=True
    shader=feather.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(.27,.245,.18,1);shader.inputs['Roughness'].default_value=.9
    # The source prop is the measured draw pinch; no melee center offset.
    original_grip=pm.inverted()@(hm@Vector((0,.15,0)));start=original_grip.y+.02;end=original_grip.y-1.20;count=12
    vertices=[pm@Vector((math.cos(i*math.tau/count)*.006,y,math.sin(i*math.tau/count)*.006)) for y in [start,end] for i in range(count)]
    faces=[tuple(range(count-1,-1,-1)),tuple(range(count,count*2))]+[(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    arrow=[_mesh('War Bowman hand-centered narrow arrow shaft',vertices,faces,arm,role,prop.name,wood,geometry)]
    for angle in [0,math.tau/3,math.tau*2/3]:
        direction=Vector((math.cos(angle),0,math.sin(angle)))
        def point(y,r):return pm@(Vector((0,y,0))+direction*r)
        arrow.append(_mesh('War Bowman short natural arrow feather',[point(start-.01,.006),point(start-.035,.030),point(start-.13,.022),point(start-.17,.006)],[(0,1,2,3)],arm,role,prop.name,feather,geometry))
    tip=[pm@Vector((x,end+y,z)) for x,y,z in [(0,-.102,0),(-.025,0,0),(0,-.018,.009),(.025,0,0),(0,-.018,-.009)]]
    arrow.append(_mesh('War Bowman compact steel arrow point',tip,[(0,1,2),(0,2,3),(0,3,4),(0,4,1),(1,4,3,2)],arm,role,prop.name,iron,geometry))
    old_name=old.name;lib.groups[role].remove(old);bpy.data.objects.remove(old,do_unlink=True)
    for obj in arrow:
        obj['peris_portrait_weapon']='War Bowman slim arrow';obj['asset_author']='Peris original arrow; adapted Wildfire Games bow rig';obj['runtime_approved']=False;obj['peris_unit_finished']=False
    def sample(state,frame):
        arm.animation_data.action=None
        for track in arm.animation_data.nla_tracks:track.mute=track.name!=role+'_'+state
        for name,matrix in baseline.items():arm.pose.bones[name].matrix_basis=matrix.copy()
        scene.frame_set(frame);bpy.context.view_layer.update()
    sample('attack',7);ready={b.name:(b.location.copy(),b.rotation_quaternion.copy(),b.scale.copy()) for b in arm.pose.bones}
    idle=next(t for t in arm.animation_data.nla_tracks if t.name==role+'_idle');prior_idle=idle.strips[0].action.name
    for track in arm.animation_data.nla_tracks:track.mute=True
    action=bpy.data.actions.new('War Bowman original nocked ready idle');arm.animation_data.action=action
    for frame in [1,25]:
        for bone in arm.pose.bones:
            bone.rotation_mode='QUATERNION';bone.location,bone.rotation_quaternion,bone.scale=ready[bone.name]
            for channel in ['location','rotation_quaternion','scale']:bone.keyframe_insert(channel,frame=frame,group=bone.name)
    arm.animation_data.action=None;idle.strips[0].action=action;idle.strips[0].action_frame_start=1;idle.strips[0].action_frame_end=25;idle.strips[0].frame_start=1;idle.strips[0].frame_end=25
    adjacency={v.index:set() for v in bow.data.vertices}
    for edge in bow.data.edges:adjacency[edge.vertices[0]].add(edge.vertices[1]);adjacency[edge.vertices[1]].add(edge.vertices[0])
    unseen=set(adjacency);string_ids=None
    while unseen:
        ids=[];todo=[unseen.pop()]
        while todo:
            index=todo.pop();ids.append(index)
            for other_index in adjacency[index]&unseen:unseen.remove(other_index);todo.append(other_index)
        if len(ids)==24:string_ids=ids
    if string_ids is None:raise ValueError('Reviewed fixed bow string component missing')
    bm=bmesh.new();bm.from_mesh(bow.data);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.verts[i] for i in string_ids],context='VERTS');bm.to_mesh(bow.data);bm.free();bow.data.update()
    tip_local=[Vector((-.04082491248846054,.2598787248134613,-1.423659086227417)),Vector((.0005068928003311157,.3203871250152588,1.505523443222046))]
    rest_tips=[arm.data.bones[owner].matrix_local@p for p in tip_local];nock=Vector((0,.03,0));rest_nock=pm@nock
    bpy.ops.object.select_all(action='DESELECT');arm.select_set(True);bpy.context.view_layer.objects.active=arm;bpy.ops.object.mode_set(mode='EDIT')
    for label,tip in zip(['upper','lower'],rest_tips):
        bone=arm.data.edit_bones.new('peris_bow_string_'+label);bone.head=tip;bone.tail=rest_nock;bone.use_deform=True
    bone=arm.data.edit_bones.new('peris_arrow_release');bone.head=rest_nock;bone.tail=rest_nock+pm.to_3x3().col[1]*.15;bone.parent=arm.data.edit_bones['prop-weapon_R'];bone.use_deform=True
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in arrow:
        obj.vertex_groups.clear();obj.vertex_groups.new(name='peris_arrow_release').add(list(range(len(obj.data.vertices))),1,'REPLACE')
    material=bpy.data.materials.new('War Bowman natural sinew string');material.use_nodes=True
    shader=material.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(.22,.17,.095,1);shader.inputs['Roughness'].default_value=.96
    for label in ['upper','lower']:
        bone=arm.data.bones['peris_bow_string_'+label];matrix=bone.matrix_local;count=8;radius=.0035
        vertices=[matrix@Vector((radius*math.cos(i*math.tau/count),y,radius*math.sin(i*math.tau/count))) for y in [0,bone.length] for i in range(count)]
        faces=[tuple(range(count-1,-1,-1)),tuple(range(count,count*2))]+[(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
        obj=_mesh('Measured bowstring '+label,vertices,faces,arm,role,bone.name,material,geometry)
        obj['asset_author']='Peris original endpoint-fitted bowstring';obj['runtime_approved']=False;obj['peris_unit_finished']=False
    samples={};relaxed_local=(tip_local[0]+tip_local[1])*.5
    for state in ['idle','walk','attack']:
        samples[state]=[]
        for frame in range(1,26):
            sample(state,frame);left=arm.pose.bones[owner].matrix;right=arm.pose.bones['prop-weapon_R'].matrix
            posed_nock=left@relaxed_local if state=='walk' or state=='attack' and 10<=frame<=18 else right@nock
            samples[state].append(([left@p for p in tip_local],posed_nock))
    for state in ['idle','walk','attack']:
        track=next(t for t in arm.animation_data.nla_tracks if t.name==role+'_'+state);action=track.strips[0].action.copy();action.name='War Bowman '+state+' exact bow socket string';track.strips[0].action=action
        for other_track in arm.animation_data.nla_tracks:other_track.mute=True
        arm.animation_data.action=action
        for frame,(tips,posed_nock) in enumerate(samples[state],1):
            for label,tip in zip(['upper','lower'],tips):
                bone=arm.pose.bones['peris_bow_string_'+label];bone.rotation_mode='QUATERNION';direction=posed_nock-tip
                target=direction.to_track_quat('Y','Z').to_matrix().to_4x4();target.translation=tip
                target=target@Matrix.Diagonal((1,direction.length/bone.bone.length,1,1));bone.matrix_basis=bone.bone.matrix_local.inverted()@target
                for channel in ['location','rotation_quaternion','scale']:bone.keyframe_insert(channel,frame=frame,group=bone.name)
            bone=arm.pose.bones['peris_arrow_release'];bone.scale=(.001,.001,.001) if state=='attack' and 10<=frame<=18 else (1,1,1);bone.keyframe_insert('scale',frame=frame,group=bone.name)
        arm.animation_data.action=None
    record={'version':1,'sourceBowActor':'props/units/weapons/bow_short.xml','actualBowBone':owner,'oldArrowRemoved':old_name,
            'originalRightHandFacesRemoved':removed,'skinMaterialCorrectedFaces':painted,'arrowRadius':.006,'arrowLength':start-end,
            'newRigBones':['peris_bow_string_upper','peris_bow_string_lower','peris_arrow_release'],'priorIdleAction':prior_idle,
            'nockPropCoordinates':list(nock),'tipLocal':list(map(list,tip_local)),'arrowHiddenAttackFrames':[10,18],
            'operations':['Original narrow arrow and connected curled draw hand','Nocked idle from source attack7 after canonical source sole fit','Explicit exact bow-owned endpoint string with relaxed walk/release states'],
            'remainingLimits':['Small retained source wrist lip overlap; no exact topology weld','Coarse source bow limbs','Runtime projectile timing requires separate review'],
            'runtimeApproved':False,'finishedUnitApproved':False}
    arm['peris_bowman_functional_contact']=json.dumps(record)
    for track in arm.animation_data.nla_tracks:track.mute=not track.name.endswith('_idle')
    scene.frame_set(1);bpy.context.view_layer.update()
    return record
