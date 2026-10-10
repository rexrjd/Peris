"""Authored Orc silhouette on licensed, animated anatomical skin.

The naked source topology, UVs and deform weights remain intact. Rest anatomy
and all three motion clips are adapted together, so long arms and bowed legs
retain matching joints. The default head is original Peris geometry. The
explicit --orc-head-source pilot option uses a separately credited CC BY 4.0
Crazyon520 head adaptation with original Peris paint and equipment.
"""
import math,pathlib,json,hashlib
import bpy
import numpy as np
from mathutils import Matrix, Vector, Quaternion


def _bone(arm,*names):
    for name in names:
        if name in arm.data.bones:return arm.data.bones[name]
    raise ValueError('Orc anatomy bone missing '+str(names))


def _parts(lib,arm,role):
    return [o for o in lib.groups.get(role,[]) if o.type=='MESH' and
            any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]


def _mute(arm):
    arm.animation_data.action=None
    for t in arm.animation_data.nla_tracks:t.mute=True
    for p in arm.pose.bones:p.matrix_basis=Matrix.Identity(4)
    bpy.context.view_layer.update()


def _source_skin(lib,giant):
    key=('original_peris_orc_anatomical_skin',giant)
    if key in lib.materials:return lib.materials[key]
    base=lib.material({'textures':{'baseTex':'skeletal/gaul/naked_01.png'}},'peris/orc-anatomical-skin')
    own=base.copy();own.name='Peris olive Orc anatomical skin'
    p=own.node_tree.nodes.get('Principled BSDF')
    tex=p.inputs['Base Color'].links[0].from_node
    image=tex.image.copy();pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels)
    pixels=pixels.reshape((-1,4));luma=pixels[:,:3].mean(axis=1)
    tint=np.asarray((.185,.220,.085) if not giant else (.22,.27,.13))
    pixels[:,:3]=np.clip((.50+luma[:,None]*.80)*tint,0,1);pixels[:,3]=1
    image.name='Peris painted Orc olive skin';image.pixels.foreach_set(pixels.ravel());image.pack();tex.image=image
    p.inputs['Roughness'].default_value=.87
    lib.materials[key]=own
    return own


def _face_skin(lib):
    key=('original_peris_orc_facial_skin',False)
    if key in lib.materials:return lib.materials[key]
    mat=bpy.data.materials.new('Original Peris Orc face skin');mat.use_nodes=True
    size=1024;yy,xx=np.mgrid[:size,:size]
    rng=np.random.default_rng(419)
    grain=.91+rng.normal(0,.041,(size,size))+.065*np.sin(xx*.013)*np.sin(yy*.017)
    pixels=np.ones((size,size,4),dtype=np.float32)
    # Olive ochre skin in the portrait: warmer facial planes with darker
    # temples, rather than a uniform green plastic mask.
    u=xx/(size-1);v=yy/(size-1)
    face=np.exp(-((u-.5)/.24)**6)
    cheek=.035*face*np.exp(-((v-.45)/.18)**2)
    head_z=-.34+v*.67;angle=(u-.5)*math.tau
    width=np.interp(head_z,[-.34,-.25,-.14,.02,.17,.25,.33],[.10,.305,.325,.323,.307,.280,.035])
    head_x=width*np.sin(angle)
    warm=face*np.clip((v-.10)/.22,0,1)
    pixels[:,:,:3]=grain[:,:,None]*(np.asarray((.255,.29,.14))+warm[:,:,None]*np.asarray((.085,.060,.030)))
    pixels[:,:,0]+=cheek;pixels[:,:,1]+=cheek*.35
    orbital=np.exp(-((np.abs(head_x)-.155)/.084)**4-((head_z-.106)/.048)**4)*face
    cheek_fold=np.exp(-((np.abs(head_x)-.185)/.025)**2-((head_z+.058)/.09)**2)*face
    buccal=np.exp(-((np.abs(head_x)-.218)/.068)**4-((head_z+.075)/.091)**4)*face
    pixels[:,:,:3]*=(1-.19*orbital-.10*cheek_fold-.075*buccal)[:,:,None]
    mouth_z=-.104-.026*(np.abs(head_x)/.225)**1.2
    lower_lip=np.exp(-(head_x/.224)**8-((head_z-mouth_z+.031)/.025)**4)*face
    upper_lip=np.exp(-(head_x/.224)**8-((head_z-mouth_z-.020)/.018)**4)*face
    pixels[:,:,:3]*=(1-.17*lower_lip-.21*upper_lip)[:,:,None]
    # Hair grows directly on the authored surface; no floating rectangular
    # scalp card is visible in close portraits. Most side skin remains shaved.
    scalp=np.clip((.078-np.abs(head_x))/.020,0,1)*np.clip((head_z-.242)/.024,0,1)
    scalp*=np.clip((.6-np.cos(angle))/.2,0,1)+np.clip((head_z-.284)/.018,0,1)
    scalp=np.clip(scalp,0,1)
    pixels[:,:,:3]=pixels[:,:,:3]*(1-scalp[:,:,None])+scalp[:,:,None]*np.asarray((.026,.022,.014))
    image=bpy.data.images.new('Original olive Orc skin grain',width=size,height=size,alpha=False)
    image.pixels.foreach_set(pixels.ravel());image.pack()
    nodes=mat.node_tree.nodes;p=nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.73
    tex=nodes.new('ShaderNodeTexImage');tex.image=image;mat.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    height=rng.normal(0,.012,(size,size))+.005*np.sin(xx*.41)*np.sin(yy*.29)
    height+=scalp*.019*np.sin(xx*.48+yy*.085)
    dy,dx=np.gradient(height);normal=np.stack((-dx*2.6,-dy*2.6,np.ones_like(dx)),axis=2)
    normal/=np.linalg.norm(normal,axis=2)[:,:,None]
    rgba=np.ones((size,size,4),dtype=np.float32);rgba[:,:,:3]=normal*.5+.5
    normal_image=bpy.data.images.new('Original Orc skin pore normal',width=size,height=size,alpha=False)
    normal_image.colorspace_settings.name='Non-Color';normal_image.pixels.foreach_set(rgba.ravel());normal_image.pack()
    normal_tex=nodes.new('ShaderNodeTexImage');normal_tex.image=normal_image
    n=nodes.new('ShaderNodeNormalMap');mat.node_tree.links.new(normal_tex.outputs['Color'],n.inputs['Color']);mat.node_tree.links.new(n.outputs['Normal'],p.inputs['Normal'])
    lib.materials[key]=mat
    return mat


def _bare_body(lib,arm,role,material):
    old_head=[]
    for obj in list(_parts(lib,arm,role)):
        path=obj.get('source_actor','')
        if '/heads/' in path:old_head.extend(v.co.copy() for v in obj.data.vertices)
        if path.startswith('units/') or any(t in path for t in ['/heads/','/hair/','/helmets/','/armor/','/greave','/boots/']):
            lib.groups[role].remove(obj);bpy.data.objects.remove(obj,do_unlink=True)
    objects=lib.dae('meshes/skeletal/new/m_naked.dae')
    source=next(o for o in objects if o.type=='ARMATURE')
    for bone in source.data.bones:
        target=arm.data.bones.get(bone.name)
        if target and max(abs(bone.matrix_local[r][c]-target.matrix_local[r][c]) for r in range(4) for c in range(4))>.05:
            raise ValueError('Orc anatomical source bind mismatch '+bone.name)
    bodies=[]
    for obj in objects:
        if obj.type=='MESH':
            for m in obj.modifiers:
                if m.type=='ARMATURE':m.object=arm
            obj.parent=arm;obj.name=role+' sculpted Orc anatomical body'
            obj.data.materials.clear();obj.data.materials.append(material)
            obj['peris_role']=role;obj['source_mesh']='skeletal/new/m_naked.dae'
            obj['peris_orc_original_anatomy']=True;obj['asset_license']='CC-BY-SA-3.0'
            obj['asset_author']='Wildfire Games; original Peris Orc anatomical adaptation'
            for p in obj.data.polygons:p.use_smooth=True
            # Refine the licensed low-poly anatomical surface before changing
            # its rest shape. Catmull-Clark interpolates the existing UVs and
            # skin weights while the source armature modifier stays live.
            bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
            bpy.context.view_layer.objects.active=obj
            refine=obj.modifiers.new('Orc anatomical surface refinement','SUBSURF')
            refine.subdivision_type='CATMULL_CLARK';refine.levels=2;refine.render_levels=2
            while obj.modifiers.find(refine.name)>0:bpy.ops.object.modifier_move_up(modifier=refine.name)
            bpy.ops.object.modifier_apply(modifier=refine.name)
            obj['peris_anatomical_surface_refinement']='two applied Catmull-Clark levels; preserved interpolated UVs and deform weights'
            obj.select_set(False)
            lib.groups[role].append(obj);bodies.append(obj)
        else:bpy.data.objects.remove(obj,do_unlink=True)
    return bodies,old_head


def _warp_function(arm,giant):
    hip=_bone(arm,'hip').head_local.z
    neck=_bone(arm,'neck','head','prop-head').head_local.z
    def smooth(value):value=max(0,min(1,value));return value*value*(3-2*value)
    def warp(point):
        p=Vector(point);upper=smooth((p.z-hip)/max(.4,neck-hip));head=smooth((p.z-neck+.16)/.5)
        # Broad shoulders, long lateral arm span, a rear upper-back hump and
        # the low projecting head create a true Orc profile before equipment.
        x=p.x*(1.12+(.38 if giant else .27)*upper)
        if abs(p.x)>.55:x+=math.copysign((abs(p.x)-.55)*(.13 if giant else .10),p.x)
        y=p.y*(1.04+.14*upper)+.14*upper-.20*head
        z=p.z-(.20 if giant else .16)*upper-.09*head
        if not giant:z-=min(p.z,hip)*.11
        if p.z<hip:
            bow=math.sin(max(0,min(1,p.z/hip))*math.pi)
            x+=math.copysign(.09*bow,p.x) if abs(p.x)>.10 else 0
        return Vector((x,y,z))
    return warp


def _basis_from_mapped_pose(matrix,rest,warp):
    point=matrix.translation;origin=warp(point)
    dirs=[warp(point+matrix.to_3x3().col[i])-origin for i in range(3)]
    old=rest.translation;baseline=[(warp(old+rest.to_3x3().col[i])-warp(old)).length for i in range(3)]
    y=dirs[1].normalized();z=(dirs[2]-y*dirs[2].dot(y)).normalized();x=y.cross(z).normalized()
    result=Matrix.Identity(4)
    for i,axis in enumerate([x,y,z]):
        result.col[i]=Vector((*axis*(dirs[i].length/max(.001,baseline[i])),0))
    result.translation=origin
    return result


def _reshape_rig_and_clips(arm,role,warp):
    """Adapt complete motion in the same shape space as the new bind skin."""
    original={b.name:b.matrix_local.copy() for b in arm.data.bones}
    endpoints={b.name:(b.head_local.copy(),b.tail_local.copy(),b.matrix_local.to_3x3().col[2].copy()) for b in arm.data.bones}
    sampled={}
    for state in ['idle','walk','attack']:
        track=next(t for t in arm.animation_data.nla_tracks if t.name==role+'_'+state)
        arm.animation_data.action=None
        for t in arm.animation_data.nla_tracks:t.mute=t!=track
        frames=[]
        for f in range(1,26):
            bpy.context.scene.frame_set(f);bpy.context.view_layer.update()
            frames.append({p.name:_basis_from_mapped_pose(p.matrix.copy(),original[p.name],warp) for p in arm.pose.bones})
        sampled[state]=frames
    _mute(arm);bpy.ops.object.select_all(action='DESELECT');arm.select_set(True)
    bpy.context.view_layer.objects.active=arm;bpy.ops.object.mode_set(mode='EDIT')
    for bone in arm.data.edit_bones:
        head,tail,z=endpoints[bone.name]
        bone.head=warp(head);bone.tail=warp(tail)
        bone.align_roll(warp(head+z*.2)-warp(head))
    bpy.ops.object.mode_set(mode='OBJECT');arm.select_set(False)
    def depth(b):return 0 if b.parent is None else depth(b.parent)+1
    bones=sorted(arm.data.bones,key=depth)
    for state,frames in sampled.items():
        track=next(t for t in arm.animation_data.nla_tracks if t.name==role+'_'+state)
        old_strip=track.strips[0];track.strips.remove(old_strip)
        action=bpy.data.actions.new(role+'_'+state+' original Orc anatomy')
        arm.animation_data.action=action
        for frame,desired in enumerate(frames,1):
            for bone in bones:
                pose=arm.pose.bones[bone.name];pose.rotation_mode='QUATERNION'
                kwargs={'parent_matrix':desired[bone.parent.name],'parent_matrix_local':bone.parent.matrix_local} if bone.parent else {}
                pose.matrix_basis=bone.convert_local_to_pose(desired[bone.name],bone.matrix_local,invert=True,**kwargs)
                if state=='idle':
                    # A deliberate ready stance replaces the source Roman
                    # swordsman's dangling shield and long relaxed arms.
                    # Equipment remains bound to the same hand/forearm bones.
                    pose.matrix_basis=Matrix.Identity(4)
                    angles={'arm_R':-.18,'forearm_R':-.56,'hand_R':-.10,
                            'arm_L':-.15,'forearm_L':-.43,'hand_L':.04,
                            'finger_R':1.10,'fingertip_R':1.15,'finger_L':1.10,'fingertip_L':1.15,
                            'thigh_L':-.025,'thigh_R':-.025,'leg_L':.035,'leg_R':.035}
                    angle=angles.get(bone.name,0)
                    if bone.name=='chest':angle=.009*math.sin((frame-1)/24*math.tau)
                    pose.rotation_quaternion=Quaternion((1,0,0),angle)
                for attr in ['location','rotation_quaternion','scale']:pose.keyframe_insert(attr,frame=frame,group=bone.name)
        arm.animation_data.action=None
        strip=track.strips.new(role+'_'+state,1,action);strip.action_frame_start=1;strip.action_frame_end=25;strip.scale=1
        track.mute=True
    arm['peris_orc_animation_bind_strategy']='original Orc rest anatomy and three motion clips adapted together from licensed humanoid motion'
    _mute(arm)
    return endpoints


def _reshape_skin(mesh,warp,endpoints):
    factors={'arm_':1.40,'forearm_':1.55,'hand_':1.50,'finger_':1.32,'fingertip_':1.32,
             'thigh_':1.46,'leg_':1.38,'foot_':1.18,'neck':1.90,'chest':1.16,'hip':1.10}
    for vertex in mesh.data.vertices:
        old=vertex.co.copy();new=warp(old);extra=Vector()
        for group in vertex.groups:
            name=mesh.vertex_groups[group.group].name
            factor=next((v for key,v in factors.items() if name.startswith(key)),1)
            if factor==1 or name not in endpoints:continue
            a,b,_=endpoints[name];d=b-a;t=max(0,min(1,(old-a).dot(d)/max(.001,d.length_squared)))
            centre=warp(a+d*t);extra+=(new-centre)*(factor-1)*group.weight
        vertex.co=new+extra
    mesh.data.update()


def _primitive(name,point,size):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=16,location=point)
    obj=bpy.context.object;obj.name=name;obj.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return obj


def _bind(lib,obj,arm,role,bone,material,geometry):
    if 'mesh_prop' in geometry:return geometry['mesh_prop'](obj,arm,role,bone,material)
    bpy.context.view_layer.update();matrix=obj.matrix_world.copy();obj.parent=None;obj.matrix_world=Matrix.Identity(4);obj.data.transform(matrix)
    for c in list(obj.users_collection):c.objects.unlink(obj)
    lib.collection.objects.link(obj);obj.data.materials.clear();obj.data.materials.append(material)
    vg=obj.vertex_groups.new(name=bone);vg.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    mod=obj.modifiers.new('Orc facial socket deform','ARMATURE');mod.object=arm;obj.parent=arm
    obj.name=role+' '+obj.name;obj['peris_role']=role;obj['asset_author']='Original Peris Orc facial sculpture'
    obj['asset_license']='CC-BY-SA-3.0';lib.groups[role].append(obj)
    return obj


def _tusk(lib,arm,role,bone,points,material,geometry):
    radii=[.034*(1-i/(len(points)-1))**1.15+.001 for i in range(len(points))];vertices=[];faces=[];n=18
    for i,point in enumerate(points):
        direction=points[min(i+1,len(points)-1)]-points[max(i-1,0)]
        q=direction.to_track_quat('Z','Y')
        for j in range(n):
            angle=j/n*math.tau;vertices.append(point+q@Vector((math.cos(angle)*radii[i],math.sin(angle)*radii[i],0)))
    for i in range(len(points)-1):
        for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
    faces.extend([tuple(range(n-1,-1,-1)),tuple(range((len(points)-1)*n,len(points)*n))])
    mesh=bpy.data.meshes.new('Original tapered lower-jaw tusk');mesh.from_pydata(vertices,[],faces);mesh.update()
    uv=mesh.uv_layers.new(name='UVMap')
    for p in mesh.polygons:
        p.use_smooth=True
        for loop in p.loop_indices:
            index=mesh.loops[loop].vertex_index;uv.data[loop].uv=(index%n/n,index//n/(len(points)-1))
    obj=bpy.data.objects.new('Lower-lip upward tapered tusk',mesh);bpy.context.scene.collection.objects.link(obj)
    _bind(lib,obj,arm,role,bone,material,geometry)


def _sculpt_mesh(lib,arm,role,bone,name,vertices,faces,material,geometry,uvs=None,smooth=True):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    uv=mesh.uv_layers.new(name='UVMap')
    for polygon in mesh.polygons:
        polygon.use_smooth=smooth
        for loop in polygon.loop_indices:
            index=mesh.loops[loop].vertex_index
            uv.data[loop].uv=uvs[index] if uvs else (vertices[index].x*.7+.5,vertices[index].z*.7+.5)
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
    _bind(lib,obj,arm,role,bone,material,geometry)
    return obj


def _closed_hands(lib,arm,role,bodies,geometry):
    """Original closed hands replace the source's simple open finger paddles."""
    import bmesh
    hand_names={'hand_L','hand_R','finger_L','finger_R','fingertip_L','fingertip_R'}
    for obj in bodies:
        bm=bmesh.new();bm.from_mesh(obj.data);layer=bm.verts.layers.deform.active
        names={g.index:g.name for g in obj.vertex_groups}
        if layer is not None:
            remove=[f for f in bm.faces if sum(sum(weight for index,weight in v[layer].items() if names.get(index) in hand_names)
                      for v in f.verts)/len(f.verts)>.64]
            bmesh.ops.delete(bm,geom=remove,context='FACES_ONLY')
        bm.to_mesh(obj.data);bm.free();obj.data.update()
    skin=_face_constant(lib,'Original Orc hand olive skin',(.16,.195,.073),.87)
    for side in ['R','L']:
        hand=_bone(arm,'hand_'+side);m=hand.matrix_local.copy()
        center=Vector((0,.15,0));rings=33;count=40;vertices=[];faces=[];uv=[]
        # Each hand is one continuous closed grip surface with a shaft-sized
        # opening through its palm. Shallow longitudinal grooves separate the
        # knuckle pads without disconnected cube fingers.
        for inner in [False,True]:
            for ring in range(rings):
                z=-.125+ring/(rings-1)*.25
                pad=.006*math.cos((ring/(rings-1))*math.pi*8)
                for i in range(count):
                    angle=math.tau*i/count
                    # Finger creases belong to the curling front half. The
                    # back of the hand stays one broad connected palm, so the
                    # grip no longer reads as four stacked segmented loops.
                    finger_half=max(0,math.sin(angle))**.65
                    rx=.058 if inner else .138+pad*finger_half
                    ry=.058 if inner else .144+pad*finger_half
                    local=center+Vector((math.cos(angle)*rx,math.sin(angle)*ry,z))
                    vertices.append(m@local);uv.append((i/count,ring/(rings-1)))
        layer_size=rings*count
        for inner in [False,True]:
            base=layer_size if inner else 0
            for ring in range(rings-1):
                for i in range(count):
                    a=base+ring*count+i;b=base+ring*count+(i+1)%count
                    face=(a,b,b+count,a+count);faces.append(tuple(reversed(face)) if inner else face)
        for ring in [0,rings-1]:
            for i in range(count):
                a=ring*count+i;b=ring*count+(i+1)%count
                face=(a,a+layer_size,b+layer_size,b);faces.append(face if ring==0 else tuple(reversed(face)))
        obj=_sculpt_mesh(lib,arm,role,hand.name,'Original connected closed Orc grip hand',vertices,faces,skin,geometry,uv)
        obj['peris_closed_grip']='Continuous fitted palm/knuckle grip opening; original hand geometry, rigid hand weighting'
        # Thick thumb arches across the first knuckle instead of pointing
        # away from the weapon. Its root overlaps the connected wrist region.
        points=[m@Vector((x,y,z)) for x,y,z in [(.115,.015,-.065),(.155,.085,-.080),(.108,.19,-.105),(.030,.23,-.100)]]
        geometry['curved']('Original Orc closed thumb over grip',points,.048,arm,role,hand.name,skin)
        # A tapered wrist bridge closes the source skin boundary.
        wrist=[];wfaces=[]
        for row in range(4):
            t=row/3;y=-.050+.135*t;rx=.097+.027*t;rz=.093+.024*t
            for i in range(24):
                theta=math.tau*i/24;wrist.append(m@Vector((math.cos(theta)*rx,y,math.sin(theta)*rz)))
        for row in range(3):
            for i in range(24):wfaces.append((row*24+i,row*24+(i+1)%24,(row+1)*24+(i+1)%24,(row+1)*24+i))
        _sculpt_mesh(lib,arm,role,hand.name,'Original connected Orc wrist to palm bridge',wrist,wfaces,skin,geometry)
    arm['peris_original_closed_hands']=True


def _facial_profile(z):
    # Explicit portrait profile: squared forward chin/muzzle, compact sloped
    # forehead and broad flattened cheek planes. No component spheres remain.
    zs=[-.34,-.30,-.25,-.19,-.14,-.10,-.06,-.02,.02,.075,.12,.17,.21,.25,.285,.315,.33]
    widths=[.10,.245,.305,.32,.325,.325,.315,.305,.296,.285,.278,.266,.249,.235,.212,.153,.025]
    front=[.17,.29,.34,.365,.385,.385,.375,.355,.32,.275,.265,.292,.278,.255,.225,.15,.025]
    back=[.14,.21,.245,.27,.29,.29,.29,.29,.285,.28,.265,.245,.22,.19,.16,.105,.025]
    if not hasattr(_facial_profile,'tables'):
        tables=[]
        for values in [widths,front,back]:
            slopes=[(values[i+1]-values[i])/(zs[i+1]-zs[i]) for i in range(len(zs)-1)]
            tangents=[slopes[0]]
            for i in range(1,len(zs)-1):
                a,b=slopes[i-1],slopes[i]
                tangents.append(2*a*b/(a+b) if a*b>0 else 0)
            tangents.append(slopes[-1]);tables.append((values,tangents))
        _facial_profile.tables=tables
    index=max(0,min(len(zs)-2,int(np.searchsorted(zs,z)-1)))
    length=zs[index+1]-zs[index];t=max(0,min(1,(z-zs[index])/length))
    return tuple((2*t**3-3*t**2+1)*values[index]+(t**3-2*t**2+t)*length*slopes[index]+
                 (-2*t**3+3*t**2)*values[index+1]+(t**3-t**2)*length*slopes[index+1]
                 for values,slopes in _facial_profile.tables)


def _face_surface(x,z):
    width,front,_=_facial_profile(z)
    cos=math.sqrt(max(0,1-(x/max(.001,width))**2))
    y=-front*cos**.36
    def bump(cx,cz,sx,sz):return math.exp(-((x-cx)/sx)**2-((z-cz)/sz)**2)
    # Nose root, blunt flattened nose tip, projecting muzzle and chin.
    y-=.098*math.exp(-(x/.105)**4-((z-.023)/.060)**4)+.07*bump(0,.115,.060,.09)
    y-=.014*bump(0,-.23,.22,.085)
    for side in [-1,1]:
        # Depressed sockets are carved into the connected surface, underneath
        # angled, furrowed brows instead of black spheres on a smooth mask.
        y+=.075*bump(side*.155,.111,.075,.042)
        brow_z=.148+.20*(abs(x)-.05)
        y-=.061*bump(side*.154,brow_z,.118,.028)
        # The zygomatic arch projects over a sunken buccal plane. Strong jaw
        # masseters and the central forward chin are separate anatomical
        # masses rather than one broad smooth cheek wall.
        y-=.045*math.exp(-((x-side*.243)/.067)**4-((z-.023)/.064)**4)
        y+=.088*math.exp(-((x-side*.217)/.066)**4-((z+.079)/.083)**4)
        y-=.033*bump(side*.282,-.188,.040,.088)
        # Nasolabial grooves and brow creases remain actual geometry.
        path=side*(.108+max(0,.025-z)*.58)
        y+=.017*math.exp(-((x-path)/.011)**2)*math.exp(-((z+.046)/.085)**4)
        # Fine outer-eye folds remain integral to the sculpt.
        for tilt in [-.24,.08,.38]:
            crease=.104+tilt*(abs(x)-.209)
            y+=.008*math.exp(-((z-crease)/.005)**2)*math.exp(-((abs(x)-.245)/.041)**4)
        rel=(x-side*.153)/.070
        if abs(rel)<1:
            lid=.120+.017*math.sqrt(1-rel*rel)
            y-=.010*math.exp(-((z-lid)/.008)**2)*(1-rel*rel)
        # Carved nostril recesses hide the dark oral surface below the wing.
        y+=.022*bump(side*.069,-.015,.020,.013)
    y+=.022*bump(0,.206,.016,.068)
    for side in [-1,1]:y+=.014*bump(side*.037,.209,.009,.041)
    for dz in [.223,.246]:
        y+=.009*math.exp(-((z-dz-.025*(abs(x)/.22)**2)/.005)**2)*math.exp(-(x/.23)**6)
    # A shallow lower-lip seam and small chin folds break the lower mask.
    y+=.012*math.exp(-((z+.184+.03*(x/.24)**2)/.009)**2)*math.exp(-(x/.25)**6)
    mouth=-.104-.026*(abs(x)/.225)**1.2
    local=math.exp(-(x/.229)**8)
    y-=.026*math.exp(-((z-mouth+.027)/.020)**2)*local
    y-=.017*math.exp(-((z-mouth-.018)/.014)**2)*local
    y+=.023*math.exp(-((z-mouth)/.008)**2)*local
    y+=.022*math.exp(-((abs(x)-.261)/.038)**4)*math.exp(-((z+.035)/.11)**4)
    y-=.027*math.exp(-(x/.207)**6-((z+.254)/.065)**4)
    # A pronounced mandibular angle and the undercut beneath the lower lip
    # make the mouth, jaw and masseter one anatomical mass, not a smooth mask.
    y-=.032*math.exp(-((abs(x)-.261)/.045)**4-((z+.218)/.076)**4)
    y+=.028*math.exp(-(x/.18)**6-((z+.192)/.020)**4)
    return y


def _facial_strip(lib,arm,role,bone,name,h,xs,zs,ys,material,geometry):
    vertices=[];faces=[];uv=[]
    for i,x in enumerate(xs):
        for j,z in enumerate(zs[i]):
            vertices.append(h+Vector((x,ys[i][j],z)));uv.append((i/(len(xs)-1),j))
    for i in range(len(xs)-1):faces.append((i*2,i*2+1,(i+1)*2+1,(i+1)*2))
    return _sculpt_mesh(lib,arm,role,bone,name,vertices,faces,material,geometry,uv)


def _face_constant(lib,name,color,rough=.7):
    key=('original_orc_face_constant',name)
    if key in lib.materials:return lib.materials[key]
    material=bpy.data.materials.new(name);material.use_nodes=True
    p=material.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
    lib.materials[key]=material
    return material


def _face(lib,arm,role,center,mats,geometry,giant):
    h=Vector(center);bone=_bone(arm,'prop-head','prop_head','head').name
    previous=set(_parts(lib,arm,role))
    skin=_face_skin(lib);vertices=[];faces=[];uv=[];rings=113;segments=112
    for j in range(rings):
        z=-.34+j/(rings-1)*.67;width,front,back=_facial_profile(z)
        for i in range(segments):
            angle=(i/segments-.5)*math.tau;x=width*math.sin(angle);c=math.cos(angle)
            y=_face_surface(x,z) if c>=0 else back*(-c)**.75
            if c>=0:
                # Side planes meet the frontal sculpture continuously.
                y*=min(1,max(0,c)/.07)
            vertices.append(h+Vector((x,y,z)));uv.append((i/segments,j/(rings-1)))
    for j in range(rings-1):
        for i in range(segments):
            a=j*segments+i;b=j*segments+(i+1)%segments
            centre=(vertices[a]+vertices[b]+vertices[b+segments]+vertices[a+segments])*.25-h
            mouth=-.104-.026*(abs(centre.x)/.225)**1.2
            if centre.y<0 and abs(centre.x)<.204 and abs(centre.z-mouth)<.010:continue
            faces.append((a,b,b+segments,a+segments))
    faces.extend([tuple(range(segments-1,-1,-1)),tuple(range((rings-1)*segments,rings*segments))])
    # Place the actual mouth boundary on continuous curved contours. Leaving
    # the sampled grid at the cut would produce visible staircase pixels.
    edge_counts={}
    for face in faces:
        for a,b in zip(face,face[1:]+face[:1]):
            edge=tuple(sorted((a,b)));edge_counts[edge]=edge_counts.get(edge,0)+1
    mouth_boundary={v for edge,count in edge_counts.items() if count==1 for v in edge}
    for index in mouth_boundary:
        point=vertices[index]-h
        if point.y>=0 or abs(point.x)>.235:continue
        centre_z=-.104-.026*(abs(point.x)/.225)**1.2
        half=.010*math.sqrt(max(0,1-(point.x/.218)**2))+.001
        point.z=centre_z+(half if point.z>=centre_z else -half)
        point.y=_face_surface(point.x,point.z)
        vertices[index]=h+point
    head=_sculpt_mesh(lib,arm,role,bone,'Original portrait-sculpted Orc connected head',vertices,faces,skin,geometry,uv)
    head['peris_original_portrait_target']='orc.png tile 1; orc-characters.png infantry front and side'
    head['peris_head_topology']='connected authored skull, cheek, nose, brow, muzzle and mandible surface; recessed wrinkles and eyelids'
    # The lips are part of the connected sculpture. A small real opening
    # reveals a recessed oral cavity and irregular tooth edges, instead of a
    # flat lip sticker or a grinning row of white cubes over the face.
    xs=[-.205+i*.41/32 for i in range(33)];mouth=[];my=[]
    for x in xs:
        z=-.104-.026*(abs(x)/.225)**1.2
        mouth.append([z+.008,z-.008]);my.append([_face_surface(x,z)+.020]*2)
    recess=_face_constant(lib,'Orc matte recessed orbital and nasal shadow',(.004,.006,.003),1)
    _facial_strip(lib,arm,role,bone,'Orc visible recessed mouth opening',h,xs,mouth,my,recess,geometry)
    tooth=_face_constant(lib,'Orc aged warm lower-jaw ivory',(.47,.41,.29),.58)
    for i,x in enumerate([-.039,.018,.058]):
        z=-.108-.026*(abs(x)/.225)**1.2+(i%2)*.002
        geometry['cube']('Orc partly exposed uneven lower tooth',h+Vector((x,_face_surface(x,z)+.007,z)),(.023+(i%2)*.003,.013,.011),arm,role,bone,tooth,.003)
    amber=_face_constant(lib,'Orc deep amber iris',(.51,.30,.045),.30)
    sclera=_face_constant(lib,'Orc warm shadowed sclera',(.24,.23,.14),.46)
    for side in [-1,1]:
        # Almond sockets and overhanging eyelids produce an intent narrow gaze.
        eye_x=side*.153;eye_z=.105;eye_y=_face_surface(eye_x,eye_z)-.009
        geometry['ellipsoid']('Orc deep almond eye recess',h+Vector((eye_x,eye_y,eye_z)),(.064,.012,.015),arm,role,bone,recess)
        geometry['ellipsoid']('Orc narrow organic eye sclera',h+Vector((eye_x,eye_y-.009,eye_z)),(.044,.007,.010),arm,role,bone,sclera)
        geometry['ellipsoid']('Orc small recessed amber iris',h+Vector((eye_x,eye_y-.015,eye_z)),(.012,.005,.010),arm,role,bone,amber)
        geometry['ellipsoid']('Orc recessed round pupil',h+Vector((eye_x,eye_y-.019,eye_z)),(.006,.003,.008),arm,role,bone,mats['dark'])
        # A thick cartilage rim and recessed concha form a complete ear
        # surface with volume, instead of a triangular card and pipe edging.
        ev=[(side*.292,-.027,.10),(side*.34,-.01,.04),(side*.49,.049,.168),
            (side*.37,.034,.209),(side*.292,.019,.18),(side*.355,.028,.125)]
        outline=[Vector(p) for p in ev[:5]];centre=Vector(ev[5]);ear=[];efaces=[];ear_uv=[]
        contour=[]
        for segment in range(5):
            a,b,c,d=[outline[i%5] for i in [segment-1,segment,segment+1,segment+2]]
            for sample in range(8):
                t=sample/8
                # Preserve the elongated point while organic curves soften
                # the lobe/root rather than leaving a five-edge paper shape.
                p=b.lerp(c,t) if segment in [1,2] else .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)
                contour.append(p)
        n=len(contour);nr=9
        for layer in [0,1]:
            for ring in range(nr):
                radius=.04+ring/(nr-1)*.96
                for p in contour:
                    point=centre.lerp(p,radius)
                    if layer==0:point.y+=.041*(1-radius*radius)-.012*math.exp(-((radius-.83)/.13)**2)
                    else:point.y+=.040+.012*(1-radius*radius)
                    ear.append(h+point);ear_uv.append((.19 if side<0 else .81,.61+(point.z-.12)*.45))
        layer_size=n*nr
        for layer in [0,1]:
            for ring in range(nr-1):
                for i in range(n):
                    a=layer*layer_size+ring*n+i;b=layer*layer_size+ring*n+(i+1)%n
                    face=(a,b,b+n,a+n);efaces.append(face if layer==0 else tuple(reversed(face)))
            cap=tuple(range(layer*layer_size,layer*layer_size+n));efaces.append(tuple(reversed(cap)) if layer==0 else cap)
        for i in range(n):
            a=(nr-1)*n+i;b=(nr-1)*n+(i+1)%n
            efaces.append((a,a+layer_size,b+layer_size,b))
        if side<0:efaces=[tuple(reversed(face)) for face in efaces]
        _sculpt_mesh(lib,arm,role,bone,'Orc original sculpted pointed ear and concha',ear,efaces,skin,geometry,ear_uv)
        a=Vector((side*.181,-.407,-.148));b=Vector((side*.206,-.447,-.077));c=Vector((side*.199,-.443,-.009))
        if side<0:c.z-=.013;c.x-=.006
        _tusk(lib,arm,role,bone,[h+(1-t)**2*a+2*(1-t)*t*b+t*t*c for t in [i/8 for i in range(9)]],tooth,geometry)
        nx=side*.070;nz=-.014
        geometry['ellipsoid']('Orc recessed nostril cavity',h+Vector((nx,_face_surface(nx,nz)+.010,nz)),(.015,.005,.007),arm,role,bone,recess)
    # Slightly taller and narrower than the early square blockout, matching
    # the portrait's strong jaw without an oversized toy-like cranium.
    transform=Matrix.Translation(h) @ Matrix.Diagonal((.66,.84,.97,1)) @ Matrix.Translation(-h)
    for obj in _parts(lib,arm,role):
        if obj not in previous:obj.data.transform(transform)
    arm['peris_orc_head_center']=[round(v,6) for v in h]
    arm['peris_orc_face']='portrait-sculpted connected angular square jaw and muzzle, low sloped forehead, recessed wrinkled brows, broad flattened nose, prominent lips, small lower teeth and upward lower tusks'


def _paint_head(obj):
    """Original olive skin paint, rasterized onto the adapted head's own UVs."""
    size=1024;pixels=np.ones((size,size,4),dtype=np.float32)
    base_color=np.asarray((.180,.205,.079))
    pixels[:,:,:3]=base_color
    uv=obj.data.uv_layers.active
    obj.data.calc_loop_triangles()
    for triangle in obj.data.loop_triangles:
        coords=np.asarray([uv.data[i].uv[:] for i in triangle.loops],dtype=float)*(size-1)
        lo=np.maximum(0,np.floor(coords.min(axis=0)).astype(int));hi=np.minimum(size-1,np.ceil(coords.max(axis=0)).astype(int))
        if np.any(hi<lo):continue
        yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1];delta=np.stack((xx-coords[0,0],yy-coords[0,1]),axis=-1)
        a=coords[1]-coords[0];b=coords[2]-coords[0];det=a[0]*b[1]-a[1]*b[0]
        if abs(det)<1e-9:continue
        w1=(delta[:,:,0]*b[1]-delta[:,:,1]*b[0])/det
        w2=(a[0]*delta[:,:,1]-a[1]*delta[:,:,0])/det;w0=1-w1-w2
        mask=(w0>=-.003)&(w1>=-.003)&(w2>=-.003)
        points=np.asarray([obj.data.vertices[i].co[:] for i in triangle.vertices])
        p=w0[:,:,None]*points[0]+w1[:,:,None]*points[1]+w2[:,:,None]*points[2]
        x,y,z=[p[:,:,i] for i in range(3)]
        front=np.clip((-y-.014)/.025,0,1)
        warm=front*np.exp(-((z-.226)/.070)**4)
        color=np.empty((*x.shape,3));color[:]=base_color
        color+=warm[:,:,None]*np.asarray((.051,.034,.013))
        orbital=np.exp(-((np.abs(x)-.019)/.011)**4-((z-.237)/.007)**4)*front
        lips=np.exp(-(x/.032)**8-((z-.199)/.006)**4)*front
        upper_lip=np.exp(-(x/.026)**8-((z-.209)/.0035)**4)*front
        cheek=np.exp(-((np.abs(x)-.028)/.010)**4-((z-.218)/.017)**4)*front
        temple=np.exp(-((np.abs(x)-.052)/.013)**2-((z-.243)/.024)**2)
        brow_crease=np.exp(-(x/.029)**6-((z-.247)/.005)**4)*front
        color*=(1-.46*orbital-.28*lips-.31*upper_lip-.19*cheek-.12*temple-.12*brow_crease)[:,:,None]
        warm_cheek=np.exp(-((np.abs(x)-.037)/.014)**2-((z-.223)/.017)**2)*front
        color+=warm_cheek[:,:,None]*np.asarray((.033,.017,.005))
        cheek_highlight=np.exp(-((np.abs(x)-.040)/.008)**2-((z-.235)/.008)**2)*front
        color+=cheek_highlight[:,:,None]*np.asarray((.020,.019,.006))
        scalp=np.clip((z-.267)/.012,0,1)*np.clip((.017-np.abs(x))/.005,0,1)
        scalp*=np.clip((y+.025)/.015,0,1)
        color=color*(1-scalp[:,:,None])+np.asarray((.031,.028,.019))*scalp[:,:,None]
        # Coordinates are used only for original paint. Facial shape and its
        # normal texture remain the separately credited source adaptation.
        color*= (.97+.026*np.sin(x*7700)*np.sin(z*8100)+.025*np.sin(x*320)*np.sin(z*250))[:,:,None]
        block=pixels[lo[1]:hi[1]+1,lo[0]:hi[0]+1];block[:,:,:3][mask]=np.clip(color[mask],0,1)
    # Expand painted islands through a gutter to keep mip filtering stable.
    painted=np.any(np.abs(pixels[:,:,:3]-base_color)>.0001,axis=2)
    for step in range(4):
        old=painted.copy()
        for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:
            shifted=np.roll(old,(dy,dx),(0,1));take=shifted&~painted
            pixels[take]=np.roll(pixels,(dy,dx),(0,1))[take];painted|=take
    image=bpy.data.images.new('Peris original olive paint on Crazyon520 adapted head',width=size,height=size,alpha=False)
    image.pixels.foreach_set(pixels.ravel());image.pack()
    material=obj.data.materials[0];p=material.node_tree.nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value=.81;p.inputs['Metallic'].default_value=0
    tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    material.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    for color in list(obj.data.color_attributes):obj.data.color_attributes.remove(color)


def _paint_adapted_eyes(obj):
    """Paint each source eye itself; no separate iris geometry can drift."""
    size=512;yy,xx=np.mgrid[:size,:size]
    x=(xx+.5)/size*.052-.026;z=(yy+.5)/size*.017+.230
    color=np.ones((size,size,4),dtype=np.float32)
    color[:,:,:3]=(.27,.255,.150)
    for cx,cz in [(-.016667,.238083),(.015745,.238083)]:
        dx=x-cx;dz=z-cz;radius=np.sqrt(dx*dx+dz*dz);angle=np.arctan2(dz,dx)
        iris=radius<.00185;pupil=radius<.00065
        radial=.88+.14*np.sin(angle*37+radius*9000)+.08*np.cos(angle*61-radius*11000)
        rgb=np.stack((.39*radial,.22*radial,.025*radial),axis=2)
        color[iris,:3]=rgb[iris]
        ring=(radius>.00165)&(radius<.00187)
        color[ring,:3]=(.054,.035,.010)
        color[pupil,:3]=(.003,.004,.001)
    image=bpy.data.images.new('Peris warm sclera amber iris and pupil on source eye islands',width=size,height=size,alpha=False)
    image.pixels.foreach_set(color.ravel());image.pack()
    uv=obj.data.uv_layers.new(name='AdaptedEyePaint')
    for polygon in obj.data.polygons:
        polygon.use_smooth=True
        for loop in polygon.loop_indices:
            point=obj.data.vertices[obj.data.loops[loop].vertex_index].co
            uv.data[loop].uv=((point.x+.026)/.052,(point.z-.230)/.017)
    material=obj.data.materials[0];p=material.node_tree.nodes.get('Principled BSDF')
    for link in list(p.inputs['Base Color'].links):material.node_tree.links.remove(link)
    tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    material.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    p.inputs['Roughness'].default_value=.35;p.inputs['Metallic'].default_value=0
    for color_attribute in list(obj.data.color_attributes):obj.data.color_attributes.remove(color_attribute)


def match_nape_boundary_paint(arm,role='line_infantry'):
    """Continue the painted licensed head across its measured neck closure."""
    parts=[o for o in bpy.data.objects if o.type=='MESH' and o.get('peris_role')==role and
           any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]
    head=next(o for o in parts if o.name==role+' source-head-skin')
    cap=next(o for o in parts if 'Fitted derivative volumetric Orc nape bridge' in o.name)
    n=cap['peris_nape_boundary_count'];rows=cap['peris_nape_rows']
    hp=head.data.materials[0].node_tree.nodes.get('Principled BSDF')
    link=hp.inputs['Base Color'].links[0];image=link.from_node.image
    pixels=np.asarray(image.pixels[:],dtype=np.float32).reshape((image.size[1],image.size[0],4))
    uv_by_vertex={}
    for loop in head.data.loops:uv_by_vertex.setdefault(loop.vertex_index,[]).append(head.data.uv_layers.active.data[loop.index].uv.copy())
    samples=[];distances=[]
    for vertex in list(cap.data.vertices)[:n]:
        nearest=min(head.data.vertices,key=lambda p:(p.co-vertex.co).length_squared)
        distances.append((nearest.co-vertex.co).length)
        colors=[]
        for uv in uv_by_vertex[nearest.index]:
            x=(uv.x%1)*image.size[0]-.5;y=(uv.y%1)*image.size[1]-.5
            ix=math.floor(x);iy=math.floor(y);tx=x-ix;ty=y-iy
            colors.append(sum(pixels[(iy+dy)%image.size[1],(ix+dx)%image.size[0],:3]*wx*wy
                  for dx,wx in [(0,1-tx),(1,tx)] for dy,wy in [(0,1-ty),(1,ty)]))
        samples.append(np.mean(colors,axis=0))
    if max(distances)>.0001:raise ValueError('Nape paint boundary no longer matches source head')
    material=cap.data.materials[0];p=material.node_tree.nodes.get('Principled BSDF')
    if p.inputs['Base Color'].is_linked:raise ValueError('Nape seam paint must be applied once after the constant surface palette')
    body=np.asarray(p.inputs['Base Color'].default_value[:3],dtype=np.float32)
    width=1024;height=64;color=np.ones((height,width,4),dtype=np.float32)
    columns=np.arange(width)/width*n;indices=columns.astype(int);fraction=columns-indices
    samples=np.asarray(samples);edge=samples[indices%n]*(1-fraction[:,None])+samples[(indices+1)%n]*fraction[:,None]
    for row in range(height):
        t=row/(height-1);blend=t*t*(3-2*t)
        color[row,:,:3]=edge*(1-blend)+body*blend
    paint=bpy.data.images.new('Matched licensed head to nape olive boundary paint',width=width,height=height,alpha=False)
    paint.colorspace_settings.name=image.colorspace_settings.name
    paint.pixels.foreach_set(color.ravel());paint.pack()
    tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=paint;tex.extension='EXTEND'
    material.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    uv=cap.data.uv_layers.active
    for face in cap.data.polygons:
        columns=[i%n for i in face.vertices];seam=0 in columns and n-1 in columns
        for loop in face.loop_indices:
            index=cap.data.loops[loop].vertex_index;col=index%n
            uv.data[loop].uv=(1 if seam and col==0 else col/n,index//n/(rows-1))
    record={'sourceComponent':head.name,'closureComponent':cap.name,'boundarySamples':n,
            'maxBoundaryDistance':max(distances),'headBoundaryMeanAlbedo':samples.mean(axis=0).tolist(),
            'lowerBodyAlbedo':body.tolist(),'operation':'Actual head boundary UV color samples, continuous cap unwrap, smooth blend into lower body palette',
            'runtimeApproved':False,'finishedUnitApproved':False}
    arm['peris_nape_boundary_paint']=json.dumps(record)
    return record


def _adapted_head(lib,arm,role,center,geometry,path):
    """Evaluate an explicitly credited, head-only licensed adaptation."""
    h=Vector(center);bone=_bone(arm,'prop-head','head').name
    previous=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported=[o for o in bpy.data.objects if o not in previous]
    meshes=[o for o in imported if o.type=='MESH' and o.name.startswith('source-head-')]
    if len(meshes)!=4:raise ValueError('Expected the reviewed four-part head-only study, got '+str([o.name for o in meshes]))
    required={'asset_author','asset_license','source_url','source_file_sha256','adaptation_changes'}
    if any(not required.issubset(set(o.keys())) or o['asset_license']!='CC-BY-4.0' for o in meshes):
        raise ValueError('Head adaptation needs explicit verified CC-BY-4.0 source metadata')
    source_center=Vector((0,-.012,.215));fit=Matrix.Translation(h)@Matrix.Diagonal((5.5,5.0,5.7,1))@Matrix.Translation(-source_center)
    credit={'author':'Crazyon520','license':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/',
            'sourceUrl':meshes[0]['source_url'],'sourceFileSha256':meshes[0]['source_file_sha256'],
            'headStudySha256':hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest(),
            'changes':meshes[0]['adaptation_changes']+'; original Peris anatomy-aware olive paint; warm sclera amber iris and pupil painted on source eye islands; aged warm ivory tooth and tusk material; fit to body head socket; regenerated smooth seam normals; fitted volumetric posterior neck bridge with head-to-neck weights; conforming tapered solid scalp clump; rigid facial weights',
            'runtimeApproved':False,'finishedUnitApproved':False}
    for obj in meshes:
        bpy.context.view_layer.update();matrix=obj.matrix_world.copy();obj.parent=None;obj.data.transform(matrix);obj.matrix_world=Matrix.Identity(4)
        is_skin=obj.name=='source-head-skin'
        import bmesh
        bm=bmesh.new();bm.from_mesh(obj.data)
        # glTF splits vertices at UV seams. Rejoin identical positions before
        # regenerating the original smooth surface normals; UVs remain per loop.
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
        if is_skin and not obj.get('peris_stern_head_study'):
            bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                                  dist=.000001,plane_co=Vector((0,0,.165)),plane_no=Vector((0,0,1)),clear_inner=True)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
        for polygon in obj.data.polygons:polygon.use_smooth=True
        obj.data.normals_split_custom_set([(0,0,0)]*len(obj.data.loops))
        if is_skin:
            _paint_head(obj)
            # The adaptation's posterior crop is open. Close only its largest
            # neck boundary with a separately materialed derivative surface;
            # a mouth/eye opening must never be filled accidentally.
            probe=bmesh.new();probe.from_mesh(obj.data)
            edges={edge for edge in probe.edges if edge.is_boundary};loops=[]
            while edges:
                start=next(iter(edges));component={start};queue=[start]
                while queue:
                    edge=queue.pop()
                    for vertex in edge.verts:
                        for linked in vertex.link_edges:
                            if linked in edges and linked not in component:component.add(linked);queue.append(linked)
                edges-=component;loops.append(component)
            if loops:
                neck_edges=max(loops,key=len)
                if max(vertex.co.z for edge in neck_edges for vertex in edge.verts)<.242:
                    adjacent={}
                    for edge in neck_edges:
                        a,b=edge.verts;adjacent.setdefault(a,[]).append(b);adjacent.setdefault(b,[]).append(a)
                    first=min(adjacent,key=lambda v:v.co.z);ordered=[first];previous=None;current=first
                    while True:
                        choices=[v for v in adjacent[current] if v!=previous]
                        next_vertex=next((v for v in choices if v not in ordered),None)
                        if next_vertex is None:break
                        ordered.append(next_vertex);previous,current=current,next_vertex
                    cap_points=[fit@vertex.co for vertex in ordered]
                    if len(cap_points)>8:
                        # A skin tube follows the exact oblique boundary, then
                        # blends into the body neck. A planar fan left a dark
                        # sealing step and could never form a natural nape.
                        neck=_bone(arm,'neck').head_local.copy();rows=9;n=len(cap_points)
                        top_center=sum(cap_points,Vector())/n;vertices=[]
                        source_normals=[(fit.to_3x3().inverted().transposed()@v.normal).normalized() for v in ordered]
                        for row in range(rows):
                            t=row/(rows-1);blend=t*t*(3-2*t)
                            for point in cap_points:
                                # Keep the exact boundary order and relative
                                # coordinates. Angular remapping of the oblique
                                # jaw/neck cut folded the side into flat sheets.
                                delta=point-top_center
                                lower=neck+Vector((delta.x*.82,delta.y*.70,-.12))
                                p=point.lerp(lower,blend)
                                vertices.append(p)
                        faces=[(r*n+i,r*n+(i+1)%n,(r+1)*n+(i+1)%n,(r+1)*n+i) for r in range(rows-1) for i in range(n)]
                        faces.append(tuple(range((rows-1)*n,rows*n)))
                        # Boundary traversal can run either way. The old
                        # side faces wound inward, so blending source normals
                        # into raw tube normals produced a dark inverted band.
                        outward=0
                        for face in faces[:-1]:
                            a,b,c=[vertices[i] for i in face[:3]]
                            normal=(b-a).cross(c-a).normalized()
                            middle=sum((vertices[i] for i in face),Vector())/4
                            r=sum(i//n for i in face)/4/(rows-1)
                            blend=r*r*(3-2*r)
                            axis_center=top_center.lerp(neck+Vector((0,0,-.12)),blend)
                            radial=Vector((middle.x-axis_center.x,middle.y-axis_center.y,0)).normalized()
                            outward+=normal.dot(radial)
                        if outward<0:faces=[tuple(reversed(face)) for face in faces]
                        cap=_sculpt_mesh(lib,arm,role,bone,'Fitted derivative volumetric Orc nape bridge',vertices,faces,
                                         _face_constant(lib,'Adapted neck closure olive skin',(.180,.205,.079),.81),geometry)
                        cap.data.update()
                        normals=[]
                        for loop in cap.data.loops:
                            index=loop.vertex_index;row=index//n
                            normal=cap.data.vertices[index].normal
                            blend=max(0,1-row/3)
                            normals.append(tuple(normal.lerp(source_normals[index%n],blend).normalized()))
                        cap.data.normals_split_custom_set(normals)
                        cap.vertex_groups.clear();head_group=cap.vertex_groups.new(name=bone);neck_group=cap.vertex_groups.new(name='neck')
                        for row in range(rows):
                            t=row/(rows-1);ids=list(range(row*n,(row+1)*n))
                            head_group.add(ids,1-t,'REPLACE');neck_group.add(ids,t,'REPLACE')
                        cap['peris_atlas_partition']='licensed-head';cap['peris_component_credit']=json.dumps(credit)
                        cap['asset_author']='Crazyon520; Peris posterior neck closure adaptation';cap['asset_license']='CC-BY-4.0'
                        cap['source_url']=credit['sourceUrl'];cap['source_file_sha256']=credit['sourceFileSha256'];cap['original_peris_equipment']=False
                        cap['peris_nape_boundary_count']=n;cap['peris_nape_rows']=rows
                        cap['peris_nape_winding']='Measured outward radial side faces; top custom normals match source crop'
            probe.free()
            # Conforming geometry establishes swept scalp hair where paint
            # alone did not read from the game inspection distance.
            from mathutils.bvhtree import BVHTree
            tree=BVHTree.FromPolygons([v.co for v in obj.data.vertices],[tuple(p.vertices) for p in obj.data.polygons])
            rows=27;cols=21;clump=[]
            for row in range(rows):
                t=row/(rows-1);y=-.035+.084*t
                width=.026+.006*math.sin(math.pi*t)-.014*t**3
                for col in range(cols):
                    u=col/(cols-1)*2-1;x=u*width
                    hit,normal,face,distance=tree.ray_cast(Vector((x,y,.35)),Vector((0,0,-1)),.20)
                    if hit is None:
                        hit,normal,face,distance=tree.find_nearest(Vector((x,y,.290)))
                    if hit is None or hit.z<.250:raise ValueError('Swept scalp clump misses crown surface at '+str((row,col,x,y,list(hit) if hit else None)))
                    edge=max(0,1-abs(u)**8)*math.sin(math.pi*t)**.30
                    relief=.008+.067*edge+.011*edge*math.sin(u*math.pi*5+t*3)**2
                    p=fit@hit+(fit.to_3x3().inverted().transposed()@normal).normalized()*relief
                    clump.append(list(p))
            arm['peris_adapted_scalp_clump']=json.dumps({'vertices':clump,'rows':rows,'cols':cols})
            knot=tree.ray_cast(Vector((0,.045,.35)),Vector((0,0,-1)),.20)[0]
            arm['peris_adapted_hair_knot']=list(fit@knot+Vector((0,0,.029)))
        material=obj.data.materials[0]
        if obj.name in ['source-head-teeth','source-head-tusks']:
            p=material.node_tree.nodes.get('Principled BSDF')
            for link in list(p.inputs['Base Color'].links):material.node_tree.links.remove(link)
            p.inputs['Base Color'].default_value=(.54,.47,.32,1);p.inputs['Roughness'].default_value=.69
        if obj.name=='source-head-eyes':
            _paint_adapted_eyes(obj)
        obj.data.transform(fit)
        original_name=obj.name;_bind(lib,obj,arm,role,bone,material,geometry)
        obj['peris_atlas_partition']='licensed-head';obj['asset_author']='Crazyon520; original Peris head adaptation and skin paint'
        obj['asset_license']='CC-BY-4.0';obj['source_url']=credit['sourceUrl'];obj['source_file_sha256']=credit['sourceFileSha256']
        obj['peris_component_credit']=json.dumps(credit,ensure_ascii=False);obj['original_peris_equipment']=False
        obj['peris_licensed_head_component']=original_name;obj['runtime_approved']=False;obj['peris_unit_finished']=False
    for obj in imported:
        if obj.type!='MESH':bpy.data.objects.remove(obj,do_unlink=True)
    arm['peris_orc_head_center']=[round(v,6) for v in h]
    arm['peris_orc_scalp_z']=h.z+(.2912875-.215)*5.7
    arm['peris_orc_face']='Licensed Crazyon520 head-only adaptation, original Peris olive paint and topknot; static face, source facial shape and dense normal texture'
    arm['peris_licensed_head_credit']=json.dumps(credit,ensure_ascii=False)


def anchors(arm):
    result={key:_bone(arm,*names).head_local.copy() for key,names in {
        'waist':('hip',),'chest':('chest',),'neck':('neck','head'),
        'shoulder_L':('arm_L','shoulder_L'),'shoulder_R':('arm_R','shoulder_R'),
        'forearm_L':('forearm_L',),'forearm_R':('forearm_R',),'hand_L':('hand_L',),'hand_R':('hand_R',)}.items()}
    result['head']=Vector(arm['peris_orc_head_center'])
    return result


def apply(lib,arm,role,mats,geometry,giant=False):
    """Replace human armor/head, adapt rest skin and motion, then sculpt face."""
    if arm.get('peris_orc_original_anatomy'):return anchors(arm)
    material=_source_skin(lib,giant);bodies,old_head=_bare_body(lib,arm,role,material)
    if old_head:
        lo=Vector(tuple(min(p[i] for p in old_head) for i in range(3)))
        hi=Vector(tuple(max(p[i] for p in old_head) for i in range(3)))
        head_center=(lo+hi)*.5
    else:head_center=_bone(arm,'prop-head','head').head_local+Vector((0,0,.33))
    warp=_warp_function(arm,giant)
    endpoints=_reshape_rig_and_clips(arm,role,warp)
    for obj in _parts(lib,arm,role):
        if obj in bodies:_reshape_skin(obj,warp,endpoints)
        else:
            for v in obj.data.vertices:v.co=warp(v.co)
    if role in ['line_infantry','elite','spear_guard','light_cavalry','heavy_cavalry']:
        _closed_hands(lib,arm,role,bodies,geometry)
    if giant:
        for obj in list(_parts(lib,arm,role)):
            path=obj.get('source_actor','')
            if any(term in path for term in ['/weapons/','/shields/','/quiver','/capes/']):
                lib.groups[role].remove(obj);bpy.data.objects.remove(obj,do_unlink=True)
    if lib.PROFILE.get('orc_head_source') and not giant:
        _adapted_head(lib,arm,role,warp(head_center),geometry,lib.PROFILE['orc_head_source'])
    else:_face(lib,arm,role,warp(head_center),mats,geometry,giant)
    if role in ['line_infantry','spear_guard','elite'] and arm.get('peris_licensed_head_credit'):
        from orc_portrait_pose import apply_idle_guard
        apply_idle_guard(arm,role)
    arm['peris_orc_original_anatomy']=True
    arm['peris_anatomy_source_mesh']='skeletal/new/m_naked.dae'
    arm['peris_orc_silhouette']='broad hunched upper back; low projecting head; long heavy arms; large hands; bowed strong legs and bare toes'
    arm['asset_license']='CC-BY-SA-3.0'
    arm['asset_author']='Wildfire Games; original Peris Orc body and motion adaptation; separately credited Crazyon520 head component' if arm.get('peris_licensed_head_credit') else 'Wildfire Games; original Peris Orc anatomy and facial sculpture'
    print('ORC_ANATOMY_READY',role,'licensed head adaptation' if arm.get('peris_licensed_head_credit') else 'original face',
          'and adapted body/motion',flush=True)
    return anchors(arm)
