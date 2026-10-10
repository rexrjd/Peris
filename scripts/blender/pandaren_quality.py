"""Original bear anatomy and jade military kit on the existing Peris rigs.

Downloaded bear studies and portraits inform proportions only; no reference
mesh is imported. Existing bones, actions, weapon sockets and mount bind remain.
"""
import bpy,bmesh,math,json,numpy as np
from mathutils import Vector,Matrix

def image(name,pixels,noncolor=False):
    h,w,_=pixels.shape;im=bpy.data.images.new(name,width=w,height=h,alpha=False)
    if noncolor:im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(np.asarray(pixels,dtype=np.float32).ravel());im.pack();return im

def material(name,color,kind='fur',metal=0):
    m=bpy.data.materials.get(name)
    if m:return m
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
    size=1024;yy,xx=np.mgrid[:size,:size];rng=np.random.default_rng(2711);grain=rng.random((size,size))-.5
    weave=(np.sin(xx*.77+np.sin(yy*.031)*2)*.05+np.sin(xx*1.83+yy*.16)*.025) if kind=='fur' else np.sin(xx*.28)*np.sin(yy*.31)*.023
    field=grain*.10+weave
    c=np.ones((size,size,4),dtype=np.float32);c[:,:,:3]=np.asarray(color)[None,None,:]*(1+field[:,:,None])
    norm=np.ones_like(c);dy,dx=np.gradient(field);normal=np.stack((-dx*1.1,-dy*1.1,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2)[:,:,None];norm[:,:,:3]=normal*.5+.5
    t=n.new('ShaderNodeTexImage');t.image=image(name+' original painted surface',c);l.new(t.outputs['Color'],p.inputs['Base Color'])
    t=n.new('ShaderNodeTexImage');t.image=image(name+' surface grain normal',norm,True);nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.32;l.new(t.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs['Normal'],p.inputs['Normal'])
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=.89 if kind=='fur' else .47 if metal else .81
    if kind=='fur':p.inputs['Specular IOR Level'].default_value=.18
    return m

class Gear:
    def __init__(self,collection,arm,role):self.collection=collection;self.arm=arm;self.role=role;self.parts=[]
    def attach(self,obj,bone,mat):
        bpy.context.view_layer.update();matrix=obj.matrix_world.copy();obj.parent=None;obj.matrix_world=Matrix.Identity(4);obj.data.transform(matrix)
        for c in list(obj.users_collection):c.objects.unlink(obj)
        self.collection.objects.link(obj);obj.parent=self.arm;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_basis=Matrix.Identity(4)
        obj.data.materials.clear();obj.data.materials.append(mat)
        group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
        mod=obj.modifiers.new('Preserved existing anatomical rig','ARMATURE');mod.object=self.arm
        obj.name=self.role+' '+obj.name;obj['peris_role']=self.role;obj['asset_license']='CC-BY-SA-3.0';obj['asset_author']='Peris original bear sculpt, hands and jade equipment; Wildfire Games retained rig'
        obj['peris_atlas_partition']='original-bear-detail';obj['runtime_approved']=False;obj['peris_unit_finished']=False
        for p in obj.data.polygons:p.use_smooth=True
        self.parts.append(obj);return obj
    def sphere(self,name,pos,size,bone,mat,segments=16,rings=10):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=pos);o=bpy.context.object;o.name=name;o.scale=size;return self.attach(o,bone,mat)
    def cube(self,name,pos,size,bone,mat,bevel=.02):
        bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        if bevel:
            mod=o.modifiers.new('Forged rounded edge','BEVEL');mod.width=bevel;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
        return self.attach(o,bone,mat)
    def curve(self,name,points,radius,bone,mat,resolution=5,handles='AUTO'):
        data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.bevel_depth=radius;data.bevel_resolution=1;data.resolution_u=resolution
        sp=data.splines.new('BEZIER');sp.bezier_points.add(len(points)-1)
        for p,co in zip(sp.bezier_points,points):p.co=co;p.handle_left_type=handles;p.handle_right_type=handles
        o=bpy.data.objects.new(name,data);self.collection.objects.link(o);bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');return self.attach(bpy.context.object,bone,mat)
    def ring(self,name,center,rx,ry,z,bone,mat,radius=.016):
        return self.curve(name,[center+Vector((math.sin(t)*rx,math.cos(t)*ry,z)) for t in np.linspace(0,math.tau,17)],radius,bone,mat)

def clear_face(body,arm):
    bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups}
    head_z=arm.data.bones['head'].head_local.z
    remove=[]
    for face in bm.faces:
        w=sum(sum(weight for i,weight in v[layer].items() if names.get(i) in ('head','prop-head')) for v in face.verts)/len(face.verts)
        if w>.85 and sum(v.co.z for v in face.verts)/len(face.verts)>head_z-.16:remove.append(face)
    count=len(remove);bmesh.ops.delete(bm,geom=remove,context='FACES');bm.to_mesh(body.data);bm.free();body.data.update();return count

def bear_head(g,mats,variation=0):
    arm=g.arm;h=arm.data.bones['head'].head_local.copy()+Vector((0,-.035,.14));bone='head';pieces=[]
    # Connected cheek, jaw, cranium and nape replace the stacked old primitives.
    for pos,size in [((0,.022,.105),(.335,.28,.335)),((0,-.13,-.075),(.285,.245,.245)),
                     ((-.135,-.235,-.045),(.175,.155,.155)),((.135,-.235,-.045),(.175,.155,.155)),
                     ((0,-.20,-.185),(.218,.165,.117)),((0,.065,-.235),(.235,.23,.265)),
                     ((-.155,-.16,.205),(.19,.115,.082)),((.155,-.16,.205),(.19,.115,.082))]:
        pieces.append(g.sphere('Original connected bear anatomy',h+Vector(pos),size,bone,mats['white']))
    g.parts=[o for o in g.parts if o not in pieces]
    bpy.ops.object.select_all(action='DESELECT')
    for o in pieces:o.select_set(True)
    bpy.context.view_layer.objects.active=pieces[0];bpy.ops.object.join();head=bpy.context.object
    for mod in list(head.modifiers):head.modifiers.remove(mod)
    mod=head.modifiers.new('Continuous sculpt union','REMESH');mod.mode='VOXEL';mod.voxel_size=.014;mod.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=mod.name)
    mod=head.modifiers.new('Sculpted cheek transitions','SMOOTH');mod.factor=.68;mod.iterations=5;bpy.ops.object.modifier_apply(modifier=mod.name)
    mod=head.modifiers.new('Organic sculpt topology budget','DECIMATE');mod.ratio=.40;bpy.ops.object.modifier_apply(modifier=mod.name)
    # Reattach the rigid facial sculpt to the unchanged animated head bone.
    head.vertex_groups.clear();group=head.vertex_groups.new(name=bone);group.add(list(range(len(head.data.vertices))),1,'REPLACE');mod=head.modifiers.new('Original animated head bone','ARMATURE');mod.object=arm
    head.name=g.role+' original sculpted bear head';head['peris_atlas_partition']='original-bear-detail'
    uv=head.data.uv_layers.active or head.data.uv_layers.new(name='UVMap')
    for poly in head.data.polygons:
        for index in poly.loop_indices:
            co=head.data.vertices[head.data.loops[index].vertex_index].co-h;uv.data[index].uv=(.5+math.atan2(co.x,-co.y)/math.tau,.5+math.atan2(co.z,math.hypot(co.x,co.y))/math.pi)
    # Original directional fur paint, with anatomical eye masks.
    mat=bpy.data.materials.get('Pandaren original anatomical white fur and black eye masks')
    fresh=mat is None
    if fresh:mat=mats['white'].copy();mat.name='Pandaren original anatomical white fur and black eye masks'
    node=mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].links[0].from_node;old=node.image
    pixels=np.empty(len(old.pixels),dtype=np.float32);old.pixels.foreach_get(pixels);pixels=pixels.reshape((old.size[1],old.size[0],4));yy,xx=np.mgrid[:old.size[1],:old.size[0]]
    theta=(xx/(old.size[0]-1)-.5)*math.tau;phi=(yy/(old.size[1]-1)-.5)*math.pi
    sx=np.sin(theta)*np.cos(phi)*.335;sz=np.sin(phi)*.335
    masks=np.zeros(theta.shape)
    for side in [-1,1]:
        mask=((sx-side*.154)/.105)**2+((sz-.128)/.118)**2
        masks=np.maximum(masks,np.clip((1.15-mask)*6,0,1)*(np.cos(theta)>.55))
    pixels[:,:,:3]=pixels[:,:,:3]*(1-masks[:,:,None])+np.asarray((.018,.019,.016))*masks[:,:,None]
    if fresh:node.image=image('Original bear fur and eye-mask diffuse',pixels)
    head.data.materials.clear();head.data.materials.append(mat)
    g.parts.append(head)
    for side in [-1,1]:
        g.sphere('Rounded black bear ear',h+Vector((side*.279,.025,.356)),(.125,.078,.133),bone,mats['black'])
        g.sphere('Bear inner ear skin',h+Vector((side*.28,-.038,.357)),(.083,.016,.083),bone,mats['inner'])
        # Eyes have lids, a visible iris and an inset pupil, not white balls.
        p=h+Vector((side*.154,-.244,.148))
        g.sphere('Inset almond bear eye',p,(.051,.028,.027),bone,mats['ivory'])
        g.sphere('Warm brown bear iris',p+Vector((-side*.005,-.025,-.002)),(.025,.009,.023),bone,mats['iris'])
        g.sphere('Bear pupil',p+Vector((-side*.006,-.031,-.002)),(.011,.004,.016),bone,mats['nose'])
        g.curve('Strong furry upper eye lid',[p+Vector((-side*.046,-.015,.005)),p+Vector((0,-.019,.026)),p+Vector((side*.049,-.006,.010))],.013,bone,mats['black'])
        g.curve('Lower bear eyelid',[p+Vector((-side*.041,-.012,-.009)),p+Vector((0,-.025,-.023)),p+Vector((side*.047,-.012,-.004))],.008,bone,mats['black'])
        for i in range(5):
            a=h+Vector((side*(.26-i*.012),.015,-.09-i*.031));g.curve('Short cheek fur break',[a,a+Vector((side*.065,-.025,-.03)),a+Vector((side*.066,-.027,-.064))],.022,bone,mats['white'],5)
    g.sphere('Broad moist bear nose',h+Vector((0,-.365,-.032)),(.098,.038,.056),bone,mats['nose'])
    for side in [-1,1]:g.sphere('Bear nostril',h+Vector((side*.05,-.397,-.023)),(.027,.008,.014),bone,mats['black'])
    g.curve('Bear philtrum',[h+Vector((0,-.385,-.075)),h+Vector((0,-.376,-.127))],.007,bone,mats['black'])
    g.curve('Closed stern bear mouth',[h+Vector((-.133,-.344,-.135)),h+Vector((-.062,-.375,-.147)),h+Vector((0,-.38,-.139)),h+Vector((.063,-.375,-.147)),h+Vector((.133,-.344,-.135))],.009,bone,mats['black'])
    return head,h

def grip_hands(g,mats,body,remove_rigid=True):
    arm=g.arm;removed=0
    # Remove rigid spherical paws, retaining the blended source wrist bridge.
    bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;names={v.index:v.name for v in body.vertex_groups}
    hand_family={'hand_L','hand_R','finger_L','finger_R','fingertip_L','fingertip_R'}
    faces=[f for f in bm.faces if remove_rigid and sum(sum(w for i,w in v[layer].items() if names.get(i) in hand_family) for v in f.verts)/len(f.verts)>.95]
    removed=len(faces);bmesh.ops.delete(bm,geom=faces,context='FACES');bm.to_mesh(body.data);bm.free();body.data.update()
    for side in ['L','R']:
        hand=arm.data.bones['hand_'+side];finger=arm.data.bones['finger_'+side];tip=arm.data.bones['fingertip_'+side]
        direction=(finger.head_local-hand.head_local).normalized();cross=Vector((1,0,0));cross=(cross-direction*cross.dot(direction)).normalized()
        center=hand.head_local.lerp(finger.head_local,.42)
        palm=g.sphere('Broad fitted furry palm '+side,center,(.125,.115,.165),hand.name,mats['black'])
        # Four independently shaped fingers curl along the existing grip pose.
        for i in range(4):
            offset=cross*(i-1.5)*.055
            start=hand.head_local.lerp(finger.head_local,.73)+offset
            points=[start,finger.head_local+offset,tip.head_local+offset*.92,tip.tail_local+offset*.88]
            g.curve('Curled bear finger '+side+str(i),points,.034,hand.name,mats['black'],5)
            g.sphere('Rounded bear knuckle '+side+str(i),points[1],(.041,.044,.043),hand.name,mats['black'],16,10)
            g.sphere('Short worn bear claw '+side+str(i),points[-1],(.024,.029,.027),hand.name,mats['claw'],16,10)
        thumb=hand.head_local+cross*.135+direction*.09
        g.curve('Opposed bear thumb '+side,[thumb,thumb+direction*.11-cross*.015,finger.head_local+cross*.085],.046,hand.name,mats['black'],5)
    return removed

def paint_uniform(body,arm):
    """Paint the actual torso UVs; no overlapping jacket shell is introduced."""
    from roster_anatomy import _fill
    name='Pandaren fitted source torso with original woven jade uniform'
    mat=bpy.data.materials.get(name)
    if mat:body.data.materials[0]=mat;return mat.get('peris_painted_torso_pixels',0)
    # The source atlas is shared by all bodies and animals. Paint only its
    # humanoid torso UV islands, retaining one shared texture rather than a
    # second complete 4K image for each role.
    mat=body.data.materials[0];mat.name=name
    p=mat.node_tree.nodes.get('Principled BSDF');tex=p.inputs['Base Color'].links[0].from_node;old=tex.image
    w,h=old.size;pixels=np.empty(w*h*4,dtype=np.float32);old.pixels.foreach_get(pixels);pixels=pixels.reshape((h,w,4));mask=np.zeros((h,w),dtype=bool)
    names={g.index:g.name for g in body.vertex_groups};uv=body.data.uv_layers.active;hip=arm.data.bones['hip'].head_local;chest=arm.data.bones['chest'].head_local
    for face in body.data.polygons:
        torso=sum(sum(g.weight for g in body.data.vertices[vi].groups if names[g.group] in ('hip','spine','chest')) for vi in face.vertices)/len(face.vertices)
        z=sum(body.data.vertices[vi].co.z for vi in face.vertices)/len(face.vertices)
        if torso<.55 or not hip.z-.10<z<chest.z+.54:continue
        coords=np.asarray([tuple(uv.data[li].uv) for li in face.loop_indices])
        for i in range(1,len(coords)-1):_fill(mask,coords[[0,i,i+1]])
    rgb=pixels[:,:,:3];white=(rgb.min(axis=2)>.32)&((rgb.max(axis=2)-rgb.min(axis=2))<.19);mask&=white
    yy,xx=np.mgrid[:h,:w];detail=.93+.055*np.sin(xx*.8)*np.sin(yy*.82);luma=rgb.mean(axis=2)
    rgb[mask]=np.clip(luma[mask,None]*np.asarray((.068,.19,.13))[None,:]*detail[mask,None],0,1)
    tex.image=image('Original source-fit Pandaren torso cloth UV paint',pixels);mat['peris_painted_torso_pixels']=int(mask.sum());body.data.materials[0]=mat;return int(mask.sum())

def paint_giant_fur(body):
    from roster_anatomy import _fill
    mat=body.data.materials[0];tex=mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].links[0].from_node
    old=tex.image;w,h=old.size;pixels=np.empty(w*h*4,dtype=np.float32);old.pixels.foreach_get(pixels);pixels=pixels.reshape((h,w,4))
    white=np.zeros((h,w),dtype=bool);black=np.zeros((h,w),dtype=bool);uv=body.data.uv_layers.active;names={g.index:g.name for g in body.vertex_groups}
    for face in body.data.polygons:
        weights={}
        for vi in face.vertices:
            for g in body.data.vertices[vi].groups:weights[names[g.group]]=weights.get(names[g.group],0)+g.weight/len(face.vertices)
        if sum(v for k,v in weights.items() if k.startswith('prop-'))>.5 or weights.get('hand_R',0)>.99 or weights.get('hand_L',0)>.99:continue
        limb=sum(v for k,v in weights.items() if k.startswith(('arm_','forearm_','thigh_','leg_','foot_','finger','fingertip')))
        target=black if limb>.5 else white
        coords=np.asarray([tuple(uv.data[li].uv) for li in face.loop_indices])
        for i in range(1,len(coords)-1):_fill(target,coords[[0,i,i+1]])
    rgb=pixels[:,:,:3];light=np.clip(rgb.mean(axis=2)*1.35+.2,.2,.96)
    rgb[white]=light[white,None]*np.asarray((.77,.74,.66));rgb[black]=light[black,None]*np.asarray((.029,.028,.024))
    tex.image=image('Original mountain bear giant fur on source UV islands',pixels);return {'whiteFurPixels':int(white.sum()),'blackFurPixels':int(black.sum())}

def giant_wrap(g,mats):
    hip=g.arm.data.bones['hip'].head_local;n=20;verts=[];faces=[]
    for row in range(3):
        for i in range(n):
            t=i/n*math.tau;r=1+.06*row
            verts.append(hip+Vector((math.cos(t)*.44*r,math.sin(t)*.32*r,-.06-row*.19-(.04*math.sin(i*1.7) if row==2 else 0))))
    for row in range(2):
        for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
    data=bpy.data.meshes.new('Mountain giant distinct full leather waist wrap');data.from_pydata(verts,[],faces);data.update();uv=data.uv_layers.new(name='UVMap')
    for f in data.polygons:
        for li in f.loop_indices:
            vi=data.loops[li].vertex_index;uv.data[li].uv=(vi%n/(n-1),vi//n/2)
    obj=bpy.data.objects.new('Mountain giant belted rough leather wrap',data);g.collection.objects.link(obj);g.attach(obj,'hip',mats['leather'])
    g.ring('Giant distinct jade waist belt',hip,.45,.335,-.03,'hip',mats['jade'],.05)
    for side in [-1,1]:g.cube('Mountain giant jade wrap buckle',hip+Vector((side*.25,-.30,-.09)),(.13,.045,.14),'hip',mats['gold'],.014)

def ram_details(collection,arm):
    body=next(o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')=='ram');g=Gear(collection,arm,'ram')
    jade=material('Peris mottled military jade',(.047,.19,.12),'iron',.35);gold=material('Peris worn copper-gold jade fittings',(.48,.30,.10),'iron',.8)
    points=np.asarray([tuple(v.co) for v in body.data.vertices]);lo=Vector(points.min(axis=0));hi=Vector(points.max(axis=0));center=(lo+hi)*.5;span=hi-lo
    bone=next((b.name for b in arm.data.bones if 'body' in b.name.lower()),arm.data.bones[0].name);axis=0 if span.x>span.y else 1
    for side in [-1,1]:
        p=center.copy();p[1-axis]+=side*span[1-axis]*.36;p.z=hi.z-.09
        size=Vector((.055,.055,.065));size[axis]=span[axis]*.73
        g.cube('Jade ram reinforced roof rail',p,size,bone,jade,.016)
        for i in range(7):
            q=p.copy();q[axis]=center[axis]+(i-3)*span[axis]*.10;q.z+=.05
            g.sphere('Jade ram individual copper roof fastener',q,(.026,.026,.019),bone,gold,12,8)
    arm['peris_pandaren_ram_detail']='Original fitted jade roof rails and copper fasteners; unchanged source beam, wheel and siege actions'
    return {'role':'ram','newParts':len(g.parts),'rigAndOperatingPartsUnchanged':True},g.parts

def shield_fittings(g,mats,body):
    names={vg.index:vg.name for vg in body.vertex_groups}
    bone=next((b for b in g.arm.data.bones if 'shield' in b.name.lower() and sum(sum(w.weight for w in v.groups if names[w.group]==b.name)>.99 for v in body.data.vertices)>20),None)
    if bone is None:return 0
    verts=[v.co.copy() for v in body.data.vertices if sum(w.weight for w in v.groups if names[w.group]==bone.name)>.99]
    if len(verts)<20:return 0
    # Match the actual authored shield contour in its own socket coordinates.
    # PCA also included the handle and boss and produced a detached trim hoop.
    m=bone.matrix_local;at=lambda x,z:m@Vector((x,-.084,z+.12))
    outline=[(-.36,-.42),(-.40,.31),(-.22,.51),(.22,.51),(.40,.31),(.36,-.42),(0,-.54)]
    rim=[at(x*.985,z*.985) for x,z in outline];rim.append(rim[0]);g.curve('Substantial copper border on original jade shield',rim,.016,bone.name,mats['gold'],5,handles='VECTOR')
    for sign in [-1,1]:
        g.curve('Embossed jade shield spiral device',[at(sign*.04,.34),at(sign*.23,.22),at(sign*.16,-.22),at(0,-.15)],.010,bone.name,mats['gold'],6)
        g.curve('Jade shield cloud knot',[at(sign*.04,.12),at(sign*.17,.02),at(sign*.05,-.08)],.009,bone.name,mats['gold'],5)
    for p in rim[:-1]:g.sphere('Individual shield border rivet',p,(.014,.014,.014),bone.name,mats['gold'],12,8)
    return len(verts)

def smooth_organic_limbs(body):
    """Add a bounded organic silhouette without moving feet or prop sockets."""
    bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups}
    selected={f for f in bm.faces if sum(sum(w for i,w in v[layer].items() if names.get(i,'').startswith(('arm_','forearm_','thigh_','leg_'))) for v in f.verts)/len(f.verts)>.65}
    edges=[e for e in bm.edges if e.link_faces and all(f in selected for f in e.link_faces)]
    if edges:bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,smooth=.55,use_grid_fill=True)
    bm.to_mesh(body.data);bm.free();body.data.update();return len(edges)

def shoulder_cap(g,mats,side,layer):
    b=g.arm.data.bones['arm_'+side];sign=1 if side=='L' else -1
    center=b.head_local+Vector((sign*(.035+layer*.075),-.008,.01-layer*.043))
    verts=[];faces=[];n=20;rings=7
    for j in range(rings):
        theta=.06+j/(rings-1)*1.64
        for i in range(n):
            phi=i/n*math.tau
            verts.append(center+Vector((math.sin(theta)*math.cos(phi)*.275,math.sin(theta)*math.sin(phi)*.263,math.cos(theta)*.21)))
    for j in range(rings-1):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    data=bpy.data.meshes.new('Connected shaped shoulder cap');data.from_pydata(verts,[],faces);data.update()
    uv=data.uv_layers.new(name='UVMap')
    for f in data.polygons:
        for li in f.loop_indices:
            vi=data.loops[li].vertex_index;uv.data[li].uv=(vi%n/(n-1),vi//n/(rings-1))
    obj=bpy.data.objects.new('Curved fitted jade shoulder cap',data);g.collection.objects.link(obj);g.attach(obj,'shoulder_'+side,mats['jade'])
    rim=verts[-n:]+[verts[-n]];g.curve('Copper-bound connected shoulder edge',rim,.014,'shoulder_'+side,mats['gold'],5)

def role_regalia(g,mats,h):
    role=g.role
    if role=='scout':
        # Broad woven travel hat: the scout's silhouette is intentionally light.
        n=32;verts=[h+Vector((math.cos(t)*.55,math.sin(t)*.50,.29)) for t in np.linspace(0,math.tau,n,endpoint=False)]
        verts += [h+Vector((math.cos(t)*.09,math.sin(t)*.09,.61)) for t in np.linspace(0,math.tau,n,endpoint=False)]
        data=bpy.data.meshes.new('Woven broad scout hat');data.from_pydata(verts,[],[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]+[tuple(range(n,n*2))]);data.update()
        uv=data.uv_layers.new(name='UVMap')
        for f in data.polygons:
            for li in f.loop_indices:
                co=data.vertices[data.loops[li].vertex_index].co-h;uv.data[li].uv=(co.x+.55,co.y+.5)
        obj=bpy.data.objects.new('Scout woven travel hat',data);g.collection.objects.link(obj);g.attach(obj,'head',mats['leather'])
        g.curve('Copper-bound woven scout hat brim',verts[:n]+[verts[0]],.014,'head',mats['gold'],5)
        for i in range(12):
            t=i/12*math.tau;g.curve('Travel hat bamboo weave rib',[h+Vector((math.cos(t)*.53,math.sin(t)*.48,.294)),h+Vector((math.cos(t)*.28,math.sin(t)*.26,.45)),h+Vector((math.cos(t)*.09,math.sin(t)*.09,.61))],.005,'head',mats['gold'],3)
    elif role=='archer':
        g.ring('War bowman tied crimson brow band',h+Vector((0,0,.22)),.33,.278,0,'head',mats['cloth'],.023)
        g.curve('Bowman short tied cloth tails',[h+Vector((.30,.07,.20)),h+Vector((.34,.12,.05)),h+Vector((.35,.14,-.16))],.032,'head',mats['cloth'],5)
    elif role in ('spear_guard','light_cavalry'):
        fitted_bear_helmet(g,mats,h,mats['steel'])
        # An open brow preserves the muzzle and eyes; ears have real cutouts.
        g.ring('Open military crown copper edge',h+Vector((0,.035,.23)),.325,.27,0,'head',mats['gold'],.020)
        for side in [-1,1]:
            g.curve('Open military crown steel arc',[h+Vector((side*.315,.02,.22)),h+Vector((side*.19,.018,.39)),h+Vector((0,.018,.46))],.036,'head',mats['steel'],5)
        if role=='spear_guard':
            g.sphere('Jade spear guard crown seal',h+Vector((0,-.24,.27)),(.095,.022,.075),'head',mats['jade'])
            neck=g.arm.data.bones['neck'].head_local
            for i in range(5):g.cube('Spear guard segmented jade throat plate',neck+Vector(((i-2)*.094,-.205,.13)),(.086,.045,.15),'neck',mats['jade'],.011)
    elif role in ('elite','heavy_cavalry'):
        fitted_bear_helmet(g,mats,h,mats['jade'])
        # Distinct officer regalia; heavy rider receives a reinforced rear crown.
        for side in [-1,1]:
            g.curve('Officer swept jade temple crest',[h+Vector((side*.27,.015,.23)),h+Vector((side*.32,.10,.46)),h+Vector((side*.22,.14,.64))],.040,'head',mats['jade'],5)
            g.curve('Officer gold crest border',[h+Vector((side*.285,.0,.23)),h+Vector((side*.335,.095,.46)),h+Vector((side*.23,.135,.65))],.012,'head',mats['gold'],5)
        if role=='heavy_cavalry':
            for i in range(4):g.cube('Heavy rider layered nape guard',h+Vector((0,.26,-.01-i*.087)),(.39,.063,.105),'head',mats['jade'],.02)

def fitted_bear_helmet(g,mats,h,metal):
    """Connected metal skull cap with open brow and anatomical ear cutouts."""
    n=28;rings=8;verts=[];faces=[]
    for row in range(rings):
        phi=row/(rings-1)*math.pi/2
        for i in range(n):
            theta=i/n*math.tau
            verts.append(h+Vector((math.cos(theta)*.355*math.cos(phi),.025+math.sin(theta)*.303*math.cos(phi),.213+math.sin(phi)*.268)))
    for row in range(rings-1):
        for i in range(n):
            face=(row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i);c=sum((verts[j]-h for j in face),Vector())/4
            # Each side opening occupies the volume of the actual black ear.
            if any(((c.x-side*.279)/.151)**2+((c.y-.025)/.128)**2+((c.z-.356)/.149)**2<1 for side in [-1,1]):continue
            faces.append(face)
    data=bpy.data.meshes.new('Original fitted bear military helmet with ear clearance');data.from_pydata(verts,[],faces);data.update();uv=data.uv_layers.new(name='UVMap')
    for face in data.polygons:
        for li in face.loop_indices:
            vi=data.loops[li].vertex_index;uv.data[li].uv=(vi%n/(n-1),vi//n/(rings-1))
    obj=bpy.data.objects.new('Fitted connected military skull cap',data);g.collection.objects.link(obj);g.attach(obj,'head',metal)
    brow=[h+Vector((math.sin(t)*.355,.025+math.cos(t)*.303,.215)) for t in np.linspace(math.pi/2,math.pi*1.5,15)]
    g.curve('Bound open helmet brow above the eyes',brow,.017,'head',mats['gold'],5)
    for side in [-1,1]:
        g.cube('Fitted helmet temple fastening',h+Vector((side*.320,-.135,.238)),(.050,.045,.067),'head',mats['gold'],.009)

def steel_weapon(g,mats,body):
    if g.role not in ('line_infantry','elite'):return 0
    names={vg.index:vg.name for vg in body.vertex_groups};bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active
    wanted=[f for f in bm.faces if sum(sum(w for i,w in v[layer].items() if names.get(i)=='prop-weapon_R') for v in f.verts)/len(f.verts)>.999]
    if not wanted:bm.free();return 0
    # Separate the healthy blade/hilt without changing its geometry or socket.
    bm.faces.index_update();wanted_ids={f.index for f in wanted};copy=bm.copy();copy.faces.ensure_lookup_table()
    bmesh.ops.delete(copy,geom=[f for f in copy.faces if f.index not in wanted_ids],context='FACES');data=bpy.data.meshes.new('Original healthy weapon at its unchanged grip');copy.to_mesh(data);copy.free()
    bmesh.ops.delete(bm,geom=wanted,context='FACES');bm.to_mesh(body.data);bm.free();body.data.update()
    obj=bpy.data.objects.new('Steel blade with retained original hand socket',data);g.collection.objects.link(obj);obj=g.attach(obj,'prop-weapon_R',mats['steel']);obj.data.materials.append(mats['gold'])
    grip=g.arm.data.bones['prop-weapon_R'].head_local
    for face in obj.data.polygons:
        center=sum((obj.data.vertices[i].co for i in face.vertices),Vector())/len(face.vertices);face.material_index=1 if (center-grip).length<.30 else 0
    return len(wanted_ids)

def kit(g,mats):
    arm=g.arm;role=g.role;chest=arm.data.bones['chest'].head_local;hip=arm.data.bones['hip'].head_local
    heavy=role in ['elite','heavy_cavalry'];light=role in ['archer','scout']
    for side in [-1,1]:g.curve('Jacket stitched front seam',[Vector((side*.31,chest.y-.35,hip.z+.05)),Vector((side*.28,chest.y-.38,chest.z+.10)),Vector((side*.27,chest.y-.34,chest.z+.43))],.013,'chest',mats['gold'])
    rows=0 if role=='catapult' else 2 if light else 4 if heavy else 3
    for row in range(rows):
        for col in range(5):
            angle=(col-2)*.24;c=chest+Vector((math.sin(angle)*.48,-math.cos(angle)*.39-.038,.37-row*.15))
            if role=='line_infantry' and row==2 and abs(col-2)>1:continue
            g.cube('Individually bordered jade lamella',c,(.165,.063,.19),'chest',mats['gold'],.022)
            g.cube('Weathered inset jade armor plate',c+Vector((0,-.043,.012)),(.128,.023,.14),'chest',mats['jade'],.016)
            for x in [-.046,.046]:g.sphere('Copper lamella rivet',c+Vector((x,-.061,.067)),(.013,.009,.013),'chest',mats['gold'],12,8)
    # Fitted crimson collar/scarf lies across the chest, not over the muzzle.
    g.curve('Thick layered crimson scarf',[chest+Vector((-.40,-.18,.48)),chest+Vector((-.22,-.34,.48)),chest+Vector((.0,-.41,.43)),chest+Vector((.26,-.34,.48)),chest+Vector((.40,-.18,.49))],.070,'chest',mats['cloth'])
    g.curve('Worked leather chest cross strap',[chest+Vector((-.35,-.21,.37)),chest+Vector((-.20,-.44,.10)),chest+Vector((.09,-.43,-.22)),chest+Vector((.30,-.32,-.39))],.035,'chest',mats['leather'])
    g.ring('Wide red waist sash',hip,.52,.37,.015,'hip',mats['cloth'],.055)
    g.sphere('Embossed gold sash buckle',hip+Vector((0,-.432,-.017)),(.12,.029,.12),'hip',mats['gold'])
    g.sphere('Buckle jade inset',hip+Vector((0,-.460,-.017)),(.077,.012,.077),'hip',mats['jade'])
    for side in ['L','R']:
        b=arm.data.bones['forearm_'+side];p=b.head_local.lerp(b.tail_local,.7)
        g.curve('Bound jade forearm cuff '+side,[b.head_local.lerp(b.tail_local,.42),p,b.head_local.lerp(b.tail_local,.88)],.13,b.name,mats['leather'])
        for i in range(3):g.sphere('Bracer jade panel '+side+str(i),p+Vector(((i-1)*.083,-.104,.025)),(.064,.026,.104),b.name,mats['jade'])
        shoulder=arm.data.bones['arm_'+side];sign=1 if side=='L' else -1
        if not light:
            for i in range(1 if role=='line_infantry' else 2 if not heavy else 3):shoulder_cap(g,mats,side,i)
    if heavy:
        head=arm.data.bones['head'].head_local
        g.ring('Officer open jade circlet',head+Vector((0,-.03,.24)),.335,.276,.14,'head',mats['gold'],.025)
        for i in range(3):g.sphere('Officer jade forehead seal',head+Vector(((i-1)*.092,-.305,.39)),(.066,.025,.078),'head',mats['jade'])

def apply(collection,arm,role):
    body=next(o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers))
    g=Gear(collection,arm,role)
    smoothed=smooth_organic_limbs(body)
    mats={'white':material('Peris off-white directional bear fur',(.74,.715,.66)),
          'black':material('Peris charcoal directional bear fur',(.014,.016,.013)),
          'inner':material('Peris bear inner ear',(.12,.11,.10)),
          'nose':material('Peris bear moist black nose',(.01,.01,.008),'leather'),
          'iris':material('Peris brown amber bear iris',(.25,.14,.055),'leather'),
          'ivory':material('Peris muted eye ivory',(.62,.59,.49),'leather'),
          'claw':material('Peris short gray bear claws',(.22,.215,.18),'leather'),
          'jade':material('Peris mottled military jade',(.047,.19,.12),'iron',.35),
          'steel':material('Peris brushed silver military blade',(.32,.35,.33),'iron',.82),
          'gold':material('Peris worn copper-gold jade fittings',(.48,.30,.10),'iron',.8),
          'cloth':material('Peris crimson military scarf weave',(.24,.021,.014),'cloth'),
          'jacket':material('Peris deep jade military jacket weave',(.025,.068,.048),'cloth'),
          'leather':material('Peris dark stitched military leather',(.052,.025,.013),'leather')}
    # Smooth the organic body only; preserve the original hard equipment edges.
    names={vg.index:vg.name for vg in body.vertex_groups}
    for face in body.data.polygons:
        rigid=sum(sum(w.weight for w in body.data.vertices[i].groups if names[w.group].startswith('prop-')) for i in face.vertices)/len(face.vertices)
        if rigid<.5:face.use_smooth=True
    bpy.context.view_layer.objects.active=body
    if body.data.has_custom_normals:bpy.ops.mesh.customdata_custom_splitnormals_clear()
    removed=clear_face(body,arm);head,h=bear_head(g,mats)
    scale={'line_infantry':(1,1,1),'spear_guard':(.96,1.06,1.05),'archer':(.91,1.06,.97),'elite':(1.08,1,1.05),'scout':(.93,.93,.96),'light_cavalry':(1.02,.99,1),'heavy_cavalry':(1.1,1.05,1.05),'catapult':(1.18,1.10,1.04)}[role]
    fit=Matrix.Translation(h)@Matrix.Diagonal((*scale,1))@Matrix.Translation(-h)
    for obj in g.parts:obj.data.transform(fit)
    giant=role=='catapult'
    hands=grip_hands(g,mats,body,remove_rigid=not giant);painted=paint_giant_fur(body) if giant else paint_uniform(body,arm)
    if giant:
        mats=dict(mats);mats['cloth']=mats['leather'];giant_wrap(g,mats)
    kit(g,mats)
    if not giant:role_regalia(g,mats,h)
    shield=shield_fittings(g,mats,body);weapon=steel_weapon(g,mats,body)
    record={'version':1,'role':role,'removedSupersededFaceFaces':removed,'removedRigidPawnFaces':hands,'newParts':len(g.parts),
            'references':['Peris Pandaren portrait sheet','Qian Shopkeeper Panda, tvanbreda, CC BY4: proportions only; no source mesh used','Blizzard Pandaren race overview: broad bear morphology'],
            'face':'Original connected voxel sculpt with nape/jaw/cheek/muzzle, directional fur paint, anatomical black eye masks, eyelids, amber irises and moist nose',
            'hands':'Four curved digits plus opposed thumb fitted to unchanged source hand/finger/tip rest coordinates',
            'kit':'Jade lamellar plates with copper edges/rivets, cloth scarf/sash, fitted shoulder layers and bracers; source role equipment retained',
            'bonesActionsMountBindChanged':False,'runtimeApproved':False,'finishedUnitApproved':False}
    record['sourceTorsoUniformPaintedPixels']=painted
    record['boundedOrganicLimbEdges']=smoothed
    record['headRoleProportions']=list(scale);record['shieldFittingsRetainSourceGeometry']=shield
    record['steelWeaponFacesAtUnchangedSocket']=weapon
    arm['peris_pandaren_quality']=json.dumps(record);return record,g.parts
