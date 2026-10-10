"""Crude original Orc equipment fitted to the sculpted Orc anatomy.

Hide, rough iron and timber replace imported human uniforms.  Every attachment
keeps its source hand/body socket and is covered by the roster's shared atlas.
"""
import math
import pathlib
import bpy
import numpy as np
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree


INFANTRY_ROLES={'line_infantry','spear_guard','elite','archer'}


def _accepted_infantry(arm,role):
    """Use the accepted V19 construction only with an explicitly credited head."""
    return role in INFANTRY_ROLES and bool(arm.get('peris_licensed_head_credit'))


def fit_giant_wrap(lib,arm,role,mats,geometry):
    """Fit the giant's rough waist cloth outside its actual expanded body."""
    body=next(o for o in lib.groups[role] if o.get('source_mesh')=='skeletal/new/m_naked.dae')
    tree=BVHTree.FromPolygons([v.co.copy() for v in body.data.vertices],[tuple(p.vertices) for p in body.data.polygons])
    hip=arm.data.bones['hip'];center=hip.head_local.copy();count=32;rows=8;verts=[]
    for row in range(rows):
        t=row/(rows-1);z=center.z+.12-.68*t
        for col in range(count):
            angle=math.tau*col/count;direction=Vector((math.sin(angle),math.cos(angle),0))
            hit=tree.ray_cast(Vector((center.x,center.y,z)),direction,2)[0]
            minimum=1/math.sqrt((direction.x/.53)**2+(direction.y/.34)**2)
            radius=max(minimum,(hit-Vector((center.x,center.y,z))).length if hit else 0)+.032+.02*t
            p=Vector((center.x,center.y,z))+direction*radius
            if row==rows-1:p.z-=.035*(.5+.5*math.sin(col*2.39))
            verts.append(p)
    faces=[(r*count+i,r*count+(i+1)%count,(r+1)*count+(i+1)%count,(r+1)*count+i) for r in range(rows-1) for i in range(count)]
    cloth=_material('Orc giant coarse brown hide wrap',(.105,.052,.020),0,.92,'cloth')
    obj=_mesh('Boulder giant fitted ragged waist wrap',verts,faces,arm,role,hip.name,cloth,geometry)
    _loft_uv(obj,count,rows)
    for p in obj.data.polygons:p.use_smooth=True
    for old in list(lib.groups[role]):
        if old!=obj and 'Siege giant waist wrap' in old.name:
            lib.groups[role].remove(old);bpy.data.objects.remove(old,do_unlink=True)
    arm['peris_giant_wrap_fit']='Measured body radial surface plus .032 clearance; retained native hip articulation; original coarse hide'
    return obj


def _bone(arm,name):
    found=arm.data.bones.get(name)
    if found:return found
    raise KeyError('Orc equipment requires '+name)


def _material(name,color,metal=0,rough=.85,grain='leather'):
    existing=bpy.data.materials.get(name)
    if existing and existing.get('peris_orc_texture_family'):return existing
    m=bpy.data.materials.new(name);m.use_nodes=True
    m['peris_orc_texture_family']=grain
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    maps=pathlib.Path(__file__).resolve().parents[2]/'assets/source/battle/orc-materials-v1'
    kind='aged-bronze' if name=='Orc aged bronze trim' else 'dark-iron' if name=='Orc rusted hammered iron' else None
    if kind and all((maps/(kind+'-'+channel+'.png')).exists() for channel in ['albedo','normal','roughness']):
        nodes=m.node_tree.nodes;links=m.node_tree.links
        for channel in ['albedo','normal','roughness']:
            tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(maps/(kind+'-'+channel+'.png')),check_existing=True)
            tex.image.colorspace_settings.name='sRGB' if channel=='albedo' else 'Non-Color';tex.image.pack()
            if channel=='albedo':
                # The authored weathering is retained on charcoal metal;
                # raw full-range map values previously read as pale stone.
                tex.image=tex.image.copy()
                pixels=np.empty(len(tex.image.pixels),dtype=np.float32);tex.image.pixels.foreach_get(pixels)
                pixels=pixels.reshape((-1,4))
                pixels[:,:3]*=np.asarray((.18,.13,.09)) if kind=='dark-iron' else np.asarray((.65,.42,.25))
                tex.image.pixels.foreach_set(pixels.ravel());tex.image.pack()
                links.new(tex.outputs['Color'],p.inputs['Base Color'])
            elif channel=='normal':
                normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.25
                links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],p.inputs['Normal'])
            else:
                remap=nodes.new('ShaderNodeMapRange');remap.inputs['From Min'].default_value=0;remap.inputs['From Max'].default_value=1
                remap.inputs['To Min'].default_value=.30 if kind=='aged-bronze' else .64
                remap.inputs['To Max'].default_value=.66 if kind=='aged-bronze' else .90
                links.new(tex.outputs['Color'],remap.inputs['Value']);links.new(remap.outputs['Result'],p.inputs['Roughness'])
        m['peris_pbr_source']='Original generated Peris '+kind+' material maps, 1254px'
        m['peris_pbr_normal_strength']=.25
        return m
    size=512;yy,xx=np.mgrid[:size,:size];rng=np.random.default_rng(391)
    noise=.88+rng.normal(0,.031,(size,size))+.055*np.sin(xx*.052)*np.sin(yy*.077)
    if grain=='wood':noise=.70+.12*np.sin(xx*.22+np.sin(yy*.039))+.09*np.sin(xx*.63)
    if grain=='iron':
        rust=(np.sin(xx*.11+yy*.19)+np.sin(xx*.27-yy*.13))>1.24
        rgb=noise[:,:,None]*np.asarray(color)
        rgb[rust]=np.asarray((.22,.095,.035))*(noise[rust,None]+.12)
    elif grain=='cloth':
        noise=.88+.032*np.sin(xx*math.pi*.96)+.027*np.sin(yy*math.pi*.96)
        noise+=.046*np.sin(xx*.021)*np.sin(yy*.026)+rng.normal(0,.014,(size,size))
        rgb=noise[:,:,None]*np.asarray(color)
    elif grain=='fur':
        noise=.66+.22*np.sin(xx*.18+np.sin(yy*.07))+.09*np.sin(xx*.87+yy*.08)
        rgb=noise[:,:,None]*np.asarray(color)
    else:rgb=noise[:,:,None]*np.asarray(color)
    pixels=np.ones((size,size,4),dtype=np.float32);pixels[:,:,:3]=np.clip(rgb,0,1)
    image=bpy.data.images.new(name+' worn surface',width=size,height=size,alpha=False)
    image.pixels.foreach_set(pixels.ravel());image.pack()
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    # Tangent relief gives leather pores and woven fibers a material response
    # without interpreting coarse diagonal paint stripes as physical seams.
    dy,dx=np.gradient(noise*.025)
    normal=np.stack((-dx,-dy,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2)[:,:,None]
    rgba=np.ones((size,size,4),dtype=np.float32);rgba[:,:,:3]=normal*.5+.5
    image_n=bpy.data.images.new(name+' fine surface normal',width=size,height=size,alpha=False)
    image_n.colorspace_settings.name='Non-Color';image_n.pixels.foreach_set(rgba.ravel());image_n.pack()
    tex_n=m.node_tree.nodes.new('ShaderNodeTexImage');tex_n.image=image_n
    n=m.node_tree.nodes.new('ShaderNodeNormalMap');m.node_tree.links.new(tex_n.outputs['Color'],n.inputs['Color']);m.node_tree.links.new(n.outputs['Normal'],p.inputs['Normal'])
    return m


def _mesh(name,verts,faces,arm,role,bone,mat,geometry):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(obj)
    uv=data.uv_layers.new(name='OrcSurface')
    # Project each face independently to preserve grain on faceted attachments.
    for polygon in data.polygons:
        points=[Vector(verts[i]) for i in polygon.vertices]
        normal=polygon.normal;drop=max(range(3),key=lambda i:abs(normal[i]))
        axes=[i for i in range(3) if i!=drop]
        lo=[min(p[a] for p in points) for a in axes];hi=[max(p[a] for p in points) for a in axes]
        for loop,point in zip(polygon.loop_indices,points):
            uv.data[loop].uv=tuple((point[a]-lo[j])/max(hi[j]-lo[j],.001) for j,a in enumerate(axes))
    result=geometry['mesh_prop'](obj,arm,role,bone,mat)
    for polygon in data.polygons:polygon.use_smooth=False
    result['peris_orc_tribal_equipment']=True
    return result


def _loft_uv(obj,count,rows,wrapped=True):
    """One continuous material field over measured cloth/limb lofts."""
    uv=obj.data.uv_layers.active
    for polygon in obj.data.polygons:
        columns=[i%count for i in polygon.vertices]
        seam=wrapped and 0 in columns and count-1 in columns
        for loop,index in zip(polygon.loop_indices,polygon.vertices):
            col=index%count;row=index//count
            u=1 if seam and col==0 else col/(count if wrapped else count-1)
            uv.data[loop].uv=(u,row/(rows-1))


def _panel_uv(obj):
    points=[v.co for v in obj.data.vertices]
    left=min(p.x for p in points);right=max(p.x for p in points)
    bottom=min(p.z for p in points);top=max(p.z for p in points)
    uv=obj.data.uv_layers.active
    for polygon in obj.data.polygons:
        for loop in polygon.loop_indices:
            p=obj.data.vertices[obj.data.loops[loop].vertex_index].co
            uv.data[loop].uv=((p.x-left)/max(right-left,.001),(p.z-bottom)/max(top-bottom,.001))


def _swept_hair_material():
    """Directional painted fibers on the scalp clump, not generic fur noise."""
    name='Orc black swept hair directional fibers'
    if bpy.data.materials.get(name):return bpy.data.materials[name]
    material=bpy.data.materials.new(name);material.use_nodes=True
    p=material.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.72
    p.inputs['Specular IOR Level'].default_value=.045
    size=512;yy,xx=np.mgrid[:size,:size];u=xx/size;v=yy/size
    phase=u*math.tau*42+.16*np.sin(v*math.tau*2)+.09*np.sin(u*math.tau*9)
    fibers=.55+.45*np.cos(phase)
    rgb=np.zeros((size,size,4),dtype=np.float32);rgb[:,:,3]=1
    for i,value in enumerate((.005,.004,.0025)):rgb[:,:,i]=value*(.62+.38*fibers)
    image=bpy.data.images.new(name+' albedo',width=size,height=size,alpha=False);image.pixels.foreach_set(rgb.ravel());image.pack()
    tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;material.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    height=.014*fibers;dy,dx=np.gradient(height);normal=np.stack((-dx*20,-dy*20,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2)[:,:,None]
    rgb[:,:,:3]=normal*.5+.5
    image=bpy.data.images.new(name+' tangent normal',width=size,height=size,alpha=False);image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(rgb.ravel());image.pack()
    tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    n=material.node_tree.nodes.new('ShaderNodeNormalMap');material.node_tree.links.new(tex.outputs['Color'],n.inputs['Color']);material.node_tree.links.new(n.outputs['Normal'],p.inputs['Normal'])
    return material


def _harness(name,points,arm,role,mat,geometry,width=.070,rigid=False):
    verts=[]
    for i,p in enumerate(points):
        tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(i-1,0)])
        cross=Vector((tangent.z,0,-tangent.x)).normalized()*(width*.5)
        for front in [-.018,.018]:
            for side in [-1,1]:verts.append(Vector(p)+cross*side+Vector((0,front,0)))
    faces=[]
    for i in range(len(points)-1):
        j=i*4;k=j+4
        faces.extend([(j,j+1,k+1,k),(j+2,k+2,k+3,j+3),(j,k,k+2,j+2),(j+1,j+3,k+3,k+1)])
    faces.extend([(0,2,3,1),(len(verts)-4,len(verts)-3,len(verts)-1,len(verts)-2)])
    obj=_mesh(name,verts,faces,arm,role,'chest',mat,geometry)
    if rigid:return obj
    chest=obj.vertex_groups['chest'];hip=obj.vertex_groups.new(name='hip')
    for i in range(len(points)):
        amount=i/(len(points)-1);ids=list(range(i*4,i*4+4))
        chest.add(ids,1-amount,'REPLACE');hip.add(ids,amount,'REPLACE')
    return obj


def _clear(lib,role,parts):
    for obj in list(lib.groups[role]):
        if any(part in obj.get('source_actor','') for part in parts):
            lib.groups[role].remove(obj);bpy.data.objects.remove(obj,do_unlink=True)


def _anatomical_surface(lib,arm,role):
    """Measure the actual reshaped skin, including authored skin transforms."""
    bpy.context.view_layer.update();verts=[];faces=[];weighted={};weights=[]
    for obj in lib.groups[role]:
        if not obj.get('peris_orc_original_anatomy'):continue
        matrix=arm.matrix_world.inverted()@obj.matrix_world
        offset=len(verts);names={g.index:g.name for g in obj.vertex_groups}
        for vertex in obj.data.vertices:
            point=matrix@vertex.co;verts.append(point)
            weights.append({names[group.group]:group.weight for group in vertex.groups if group.weight>0})
            for group in vertex.groups:
                if group.weight>.10:weighted.setdefault(names[group.group],[]).append(point)
        faces.extend(tuple(offset+i for i in polygon.vertices) for polygon in obj.data.polygons)
    if not verts:raise ValueError('Orc gear requires measured anatomical skin')
    triangles=[(face[0],face[i],face[i+1]) for face in faces for i in range(1,len(face)-1)]
    torso_names={'hip','spine','chest','neck','shoulder_L','shoulder_R'}
    torso=[face for face in triangles if sum(sum(w for n,w in weights[i].items() if n in torso_names) for i in face)/3>.52]
    lower_names={'hip','thigh_L','thigh_R','leg_L','leg_R','foot_L','foot_R'}
    lower=[face for face in triangles if sum(sum(w for n,w in weights[i].items() if n in lower_names) for i in face)/3>.55]
    tree=BVHTree.FromPolygons(verts,triangles,all_triangles=True)
    torso_tree=BVHTree.FromPolygons(verts,torso,all_triangles=True)
    lower_tree=BVHTree.FromPolygons(verts,lower,all_triangles=True)
    def ray_front(x,z,clearance=.035,region='torso'):
        hit=(torso_tree if region=='torso' else tree).ray_cast(Vector((x,-20,z)),Vector((0,1,0)),40)[0]
        if hit is None:raise ValueError('Armor surface ray misses '+str((x,z)))
        return Vector((x,hit.y-clearance,z))
    return {'front':ray_front,'weighted':weighted,'vertices':verts,'faces':triangles,'weights':weights,'tree':tree,
            'torso_tree':torso_tree,'torso_faces':torso,'lower_tree':lower_tree}


def _skin_binding(obj,surface):
    """Retain body motion under overlapping flexible armor, not a rigid slab."""
    obj.vertex_groups.clear();groups={}
    for vertex in obj.data.vertices:
        nearest=surface['torso_tree'].find_nearest(vertex.co)
        if nearest[2] is None:raise ValueError('Missing anatomical armor binding')
        face=surface['torso_faces'][nearest[2]]
        a,b,c=[surface['vertices'][i] for i in face];q=nearest[0]
        u=b-a;v=c-a;delta=q-a;d00=u.dot(u);d01=u.dot(v);d11=v.dot(v)
        denom=d00*d11-d01*d01
        if abs(denom)<1e-10:blend=[1,0,0]
        else:
            w1=(d11*delta.dot(u)-d01*delta.dot(v))/denom
            w2=(d00*delta.dot(v)-d01*delta.dot(u))/denom
            blend=[max(0,1-w1-w2),max(0,w1),max(0,w2)]
        values={}
        for index,amount in zip(face,blend):
            for name,weight in surface['weights'][index].items():values[name]=values.get(name,0)+weight*amount
        values=dict(sorted(values.items(),key=lambda pair:pair[1],reverse=True)[:4]);total=sum(values.values())
        for name,weight in values.items():
            if name not in groups:groups[name]=obj.vertex_groups.new(name=name)
            groups[name].add([vertex.index],weight/total,'REPLACE')


def _finished_corslet_surface(obj,surface):
    """Attachments use the completed garment and its final weights."""
    vertices=[v.co.copy() for v in obj.data.vertices]
    triangles=[(p.vertices[0],p.vertices[i],p.vertices[i+1])
               for p in obj.data.polygons for i in range(1,len(p.vertices)-1)]
    names={g.index:g.name for g in obj.vertex_groups}
    weights=[{names[g.group]:g.weight for g in v.groups if g.weight>0} for v in obj.data.vertices]
    tree=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
    def front(x,z,clearance=.022,region='torso'):
        if region!='torso':return surface['front'](x,z,clearance,region)
        hit=tree.ray_cast(Vector((x,-20,z)),Vector((0,1,0)),40)[0]
        if hit is None:raise ValueError('Finished corslet ray misses '+str((x,z)))
        return Vector((x,hit.y-clearance,z))
    fitted=dict(surface)
    fitted.update(front=front,torso_tree=tree,torso_faces=triangles,vertices=vertices,weights=weights)
    return fitted


def _pilot_chest_outline(chest_z):
    return [(x,chest_z+z) for x,z in [(-.49,.55),(-.28,.66),(0,.48),(.28,.66),(.49,.55),
            (.51,.20),(.43,-.08),(0,-.18),(-.43,-.08),(-.51,.20)]]


def _pilot_fauld_outline(waist_z):
    return [(x,waist_z+z) for x,z in [(-.43,.39),(0,.30),(.43,.39),(.44,.15),
            (.22,.08),(0,.065),(-.22,.08),(-.44,.15)]]


def _bind_pilot_corslet_panels(obj,anchors):
    """Keep hidden garment support on the same hinge as its metal covering."""
    def inside(point,outline):
        value=False
        for (ax,az),(bx,bz) in zip(outline,outline[1:]+outline[:1]):
            if (az>point.z)!=(bz>point.z) and point.x<(bx-ax)*(point.z-az)/(bz-az)+ax:value=not value
        return value
    chest=_pilot_chest_outline(Vector(anchors['chest']).z)
    fauld=_pilot_fauld_outline(Vector(anchors['waist']).z)
    groups={name:obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name) for name in ['chest','hip']}
    counts={'chestSupport':0,'hipSupport':0,'legInfluencesRedirected':0}
    for vertex in obj.data.vertices:
        # Source anatomy nearest-neighbor binding included thigh influences
        # in a torso garment. A walking thigh must not drag the hide through
        # a fixed pelvis fauld; transfer only these inappropriate influences.
        redirect=0
        for value in list(vertex.groups):
            group=obj.vertex_groups[value.group]
            if group.name.startswith(('thigh_','leg_','foot_','toe_')):
                redirect+=value.weight;group.remove([vertex.index])
        if redirect:
            current=next((g.weight for g in vertex.groups if g.group==groups['hip'].index),0)
            groups['hip'].add([vertex.index],current+redirect,'REPLACE');counts['legInfluencesRedirected']+=1
        if vertex.co.y>=Vector(anchors['chest']).y+.03:continue
        owner='chest' if inside(vertex.co,chest) else 'hip' if inside(vertex.co,fauld) else None
        if owner:
            for value in list(vertex.groups):obj.vertex_groups[value.group].remove([vertex.index])
            groups[owner].add([vertex.index],1,'REPLACE');counts['chestSupport' if owner=='chest' else 'hipSupport']+=1
    obj['peris_panel_support_binding']=str(counts)
    return counts


def _corslet_base(surface,arm,role,anchors,leather,geometry):
    lower=Vector(anchors['waist']).z-.30;upper=Vector(anchors['neck']).z+.06
    # A measured continuous loft has exact garment edges. Copying a subset
    # of source triangles left serrated boundaries at the neck and armholes.
    verts=[];count=64;rows=25
    waist=Vector(anchors['waist']);chest=Vector(anchors['chest']);neck=Vector(anchors['neck'])
    for row in range(rows):
        z=lower+(upper-lower)*row/(rows-1)
        cy=float(np.interp(z,[waist.z,chest.z,neck.z],[waist.y,chest.y,neck.y]))
        center=Vector((0,cy,z));radii=[]
        for i in range(count):
            theta=math.tau*i/count;direction=Vector((math.sin(theta),math.cos(theta),0))
            hit=surface['torso_tree'].ray_cast(center,direction,2)[0]
            if hit is None:
                nearest=surface['torso_tree'].find_nearest(center+direction*.40)[0]
                radius=(nearest-center).length if nearest is not None else .3
            else:radius=(hit-center).length
            radii.append(radius)
        radii=np.asarray(radii)
        smooth=(np.roll(radii,-2)+np.roll(radii,-1)*2+radii*4+np.roll(radii,1)*2+np.roll(radii,2))/10
        # A sleeveless corslet narrows into the neck; upper-arm hits must not
        # create a rigid shoulder poncho that stretches during an axe swing.
        taper=max(0,min(1,(z-(neck.z-.34))/.40))
        limit=.66*(1-taper)+.29*taper
        smooth=np.minimum(smooth,limit)
        for i,radius in enumerate(smooth):
            theta=math.tau*i/count;direction=Vector((math.sin(theta),math.cos(theta),0))
            if z<waist.z+.20:
                radius=min(radius,1/math.sqrt((direction.x/.63)**2+(direction.y/.43)**2))
            verts.append(center+direction*(radius+.069))
    faces=[(r*count+i,r*count+(i+1)%count,(r+1)*count+(i+1)%count,(r+1)*count+i)
           for r in range(rows-1) for i in range(count)]
    obj=_mesh('Continuous fitted Orc hide under-corslet',verts,faces,arm,role,'chest',leather,geometry)
    _loft_uv(obj,count,rows)
    for polygon in obj.data.polygons:polygon.use_smooth=True
    _skin_binding(obj,surface)
    chest_group=obj.vertex_groups.get('chest') or obj.vertex_groups.new(name='chest')
    for vertex in obj.data.vertices:
        redirect=0
        for value in list(vertex.groups):
            group=obj.vertex_groups[value.group]
            if group.name.startswith(('arm_','forearm_','shoulder_')):
                redirect+=value.weight;group.remove([vertex.index])
        if redirect:
            old=next((g.weight for g in vertex.groups if g.group==chest_group.index),0)
            chest_group.add([vertex.index],old+redirect,'REPLACE')
    hip=obj.vertex_groups.get('hip') or obj.vertex_groups.new(name='hip')
    for vertex in obj.data.vertices:
        # Overlap stays on the pelvis during a forward torso bend, avoiding
        # the opening found in the actual attack13 contact render.
        pelvis=max(0,min(1,(Vector(anchors['waist']).z+.15-vertex.co.z)/.26))
        if pelvis<=0:continue
        old=list(vertex.groups)
        for value in old:obj.vertex_groups[value.group].add([vertex.index],value.weight*(1-pelvis),'REPLACE')
        current=next((g.weight for g in vertex.groups if g.group==hip.index),0)
        hip.add([vertex.index],current+pelvis,'REPLACE')
    if _accepted_infantry(arm,role):
        # Upper hide and metal form one fitted chest assembly. Source spine
        # blending moved the hide through the chest-rigid breastplate during
        # the actual attack14/walk14 review; the lower garment still blends
        # into the pelvis beneath the independently hinged belt fauld.
        for vertex in obj.data.vertices:
            t=max(0,min(1,(vertex.co.z-(chest.z-.36))/.22))
            amount=t*t*(3-2*t)
            if amount<=0:continue
            for value in list(vertex.groups):
                obj.vertex_groups[value.group].add([vertex.index],value.weight*(1-amount),'REPLACE')
            current=next((g.weight for g in vertex.groups if g.group==chest_group.index),0)
            chest_group.add([vertex.index],current+amount,'REPLACE')
        obj['peris_upper_corslet_binding']='Chest-rigid above chest-.14; smooth blend into existing lower pelvis garment'
        _bind_pilot_corslet_panels(obj,anchors)
    surface['finished_corslet']=_finished_corslet_surface(obj,surface)
    # A raised collar overlaps the rigid source head's exact closed neck edge.
    count=48;rows=5;verts=[]
    for row in range(rows):
        t=row/(rows-1)
        for i in range(count):
            angle=math.tau*i/count
            # Low fitted front opening, higher rear and shaped sides below
            # the ears; the former uniform tube obscured the jaw/neck pose.
            pilot=_accepted_infantry(arm,role)
            rise=(.16+.025*abs(math.sin(angle))+.055*math.cos(angle)) if pilot else (.29+.045*abs(math.sin(angle))+.025*math.cos(angle))
            z=neck.z-.075+rise*t
            rx=.37-(.055 if pilot else .03)*t;ry=.38-(.055 if pilot else .015)*t
            verts.append(Vector((neck.x+math.sin(angle)*rx,neck.y-(.025 if pilot else .055)*t+math.cos(angle)*ry,z)))
    n=len(verts);verts+=[p-Vector((p.x-neck.x,p.y-neck.y,0)).normalized()*.021 for p in verts]
    front=[(r*count+i,r*count+(i+1)%count,(r+1)*count+(i+1)%count,(r+1)*count+i) for r in range(rows-1) for i in range(count)]
    faces=front+[tuple(i+n for i in reversed(f)) for f in front]
    for row in [0,rows-1]:
        faces.extend((row*count+i,row*count+(i+1)%count,row*count+(i+1)%count+n,row*count+i+n) for i in range(count))
    collar=_mesh('Orc thick raised fitted leather gorget collar',verts,faces,arm,role,'neck',leather,geometry)
    _loft_uv(collar,count,rows)
    for polygon in collar.data.polygons:polygon.use_smooth=True


def _covered_skin(lib,arm,role,anchors,surface):
    """Fit covered skin while retaining the pilot's connected moving shoulder.

    Other roles retain their semantic replacement cuts. The credited pilot
    uses its source torso/arm topology as the leather underlayer, rather than
    competing cuff and torso shells at the moving shoulder.
    """
    import bmesh
    waist=Vector(anchors['waist']).z;neck=Vector(anchors['neck']).z
    torso={'hip','spine','spine1','chest','neck'}
    arm_roots={'arm_L','arm_R','shoulder_L','shoulder_R','forearm_L','forearm_R'}
    garment=surface.get('finished_corslet')
    connected_pilot=_accepted_infantry(arm,role)
    def inside_garment(point):
        if not garment or not waist-.32<point.z<neck+.06:return False
        front=garment['torso_tree'].ray_cast(Vector((point.x,-20,point.z)),Vector((0,1,0)),40)[0]
        back=garment['torso_tree'].ray_cast(Vector((point.x,20,point.z)),Vector((0,-1,0)),40)[0]
        return front is not None and back is not None and front.y-.012<point.y<back.y+.012
    removed=0
    for obj in lib.groups[role]:
        if not obj.get('peris_orc_original_anatomy'):continue
        bm=bmesh.new();bm.from_mesh(obj.data);weights=bm.verts.layers.deform.active
        if weights is None:bm.free();continue
        names={g.index:g.name for g in obj.vertex_groups}
        faces=[]
        for f in bm.faces:
            p=f.calc_center_median()
            torso_weight=sum(sum(w for g,w in v[weights].items() if names.get(g) in torso) for v in f.verts)/len(f.verts)
            root_weight=sum(sum(w for g,w in v[weights].items() if names.get(g) in arm_roots) for v in f.verts)/len(f.verts)
            covered=waist-.16<p.z<neck+.035 and torso_weight>.66 and root_weight<.12
            garment_hidden=inside_garment(p)
            if connected_pilot and root_weight>.50:
                # The arm rests partly inside the garment volume, but those
                # inner-arm faces become visible when the arm lifts. Removing
                # them made a crescent cut run to arm t=.71 and left an empty
                # sleeve under the pauldron. Only the deliberate proximal cuff
                # cut below may remove this moving limb surface.
                garment_hidden=False
            covered=covered or garment_hidden
            # The separately fitted licensed nape replaces the old human neck.
            # It extends beyond the torso-deletion range and was poking through
            # both collar and head bridge in the actual v9 render.
            # Connected clothing must retain the upper-back yoke below the
            # collar. The old replacement cutoff at neck-.19 removed that
            # whole bridge and left an open black V in the actual back view.
            neck_cut=neck+.025 if connected_pilot else neck-.19
            old_neck=bool(arm.get('peris_licensed_head_credit')) and p.z>neck_cut and abs(p.x)<.60 and sum(sum(w for g,w in v[weights].items() if names.get(g)=='neck') for v in f.verts)/len(f.verts)>.025
            # Deliberate short armhole cuts lie inside the fitted rigid hide
            # cuff. Mixed torso/shoulder fragments otherwise become exposed
            # triangles when the axe arm lifts, despite being hidden at rest.
            armhole=False
            for side in ['L','R']:
                bone=_bone(arm,'arm_'+side);axis=bone.tail_local-bone.head_local
                t=(p-bone.head_local).dot(axis)/axis.length_squared
                own=sum(sum(w for g,w in v[weights].items() if names.get(g) in {'arm_'+side,'shoulder_'+side}) for v in f.verts)/len(f.verts)
                if (-.55<t<.18 if _accepted_infantry(arm,role) else -.10<t<.12) and own>.025:
                    armhole=True;break
            if connected_pilot:
                # A torso-volume mask cut into the moving inner upper arm.
                # Preserve its connected anatomical surface instead; hidden
                # torso support is fitted inside the garment below.
                covered=False;armhole=False
            # The enclosed hide kilt covers both upper thighs; deleting this
            # hidden region prevents rigid cloth/animated leg intersections.
            kilt=waist-.50<p.z<waist+.025 and abs(p.x)<.82 and abs(p.y-.02)<.58
            covered_limb=False
            for bone_name,start,end in [('leg_L',.11,.94),('leg_R',.11,.94),('forearm_L',.44,.88),('forearm_R',.44,.88)]:
                bone=_bone(arm,bone_name);axis=bone.tail_local-bone.head_local
                t=(p-bone.head_local).dot(axis)/axis.length_squared
                amount=sum(sum(w for g,w in v[weights].items() if names.get(g)==bone_name) for v in f.verts)/len(f.verts)
                if start<t<end and amount>.30:covered_limb=True;break
            if covered or kilt or old_neck or covered_limb or armhole:faces.append(f)
        removed+=len(faces);bmesh.ops.delete(bm,geom=faces,context='FACES_ONLY')
        bm.to_mesh(obj.data);bm.free();obj.data.update()
        if connected_pilot:
            _fit_hidden_pilot_torso(obj,garment,anchors)
        if _accepted_infantry(arm,role):
            # Retained upper-arm skin and the covering short cuff must share
            # the same proximal hinge. The diagnostic Attack7 projection
            # identified leaves with 30-40% chest/shoulder weight at arm t=.3;
            # those stayed on the torso while the cuff lifted with the arm.
            redirects=0
            for vertex in obj.data.vertices:
                values={obj.vertex_groups[g.group].name:g.weight for g in vertex.groups if g.weight>0}
                for side in ['L','R']:
                    bone=_bone(arm,'arm_'+side);axis=bone.tail_local-bone.head_local
                    t=(vertex.co-bone.head_local).dot(axis)/axis.length_squared
                    own=sum(values.get(name,0) for name in ['arm_'+side,'shoulder_'+side])
                    if not .10<t<.58 or own<.15:continue
                    amount=max(0,min(1,(.58-t)/.28));amount=amount*amount*(3-2*amount)
                    for group in list(vertex.groups):
                        obj.vertex_groups[group.group].add([vertex.index],group.weight*(1-amount),'REPLACE')
                    target=obj.vertex_groups.get(bone.name) or obj.vertex_groups.new(name=bone.name)
                    current=next((g.weight for g in vertex.groups if g.group==target.index),0)
                    target.add([vertex.index],current+amount,'REPLACE');redirects+=1;break
            obj['peris_proximal_arm_cuff_alignment_vertices']=redirects
        obj['peris_hidden_skin_removed']=True
    arm['peris_hidden_skin_removed_faces']=removed


def _connected_pilot_garment(lib,arm,role,anchors,leather):
    """One connected torso/sleeve surface, with an exact material-edge split.

    The finished corslet remains the authoring placement/weight reference for
    plates and hidden support. Its competing visible tube is removed after
    fitting; source UVs and body/arm continuity are retained. This is a scoped
    pilot construction, not a whole-roster change or an art approval.
    """
    import bmesh,json
    waist=Vector(anchors['waist']).z;neck=Vector(anchors['neck']).z;records=[]
    for obj in list(lib.groups[role]):
        if not obj.get('peris_orc_original_anatomy'):continue
        skin_index=next((i for i,m in enumerate(obj.data.materials) if m and 'skin' in m.name.lower()),0)
        if leather not in list(obj.data.materials):obj.data.materials.append(leather)
        leather_index=list(obj.data.materials).index(leather)
        bm=bmesh.new();bm.from_mesh(obj.data);weights=bm.verts.layers.deform.active
        names={g.index:g.name for g in obj.vertex_groups}
        for side in ['L','R']:
            bone=_bone(arm,'arm_'+side);axis=bone.tail_local-bone.head_local
            selected=[f for f in bm.faces if sum(sum(w for g,w in v[weights].items()
                if names.get(g) in {'arm_'+side,'shoulder_'+side}) for v in f.verts)/len(f.verts)>.20]
            geom=set(selected)
            for f in selected:geom.update(f.edges);geom.update(f.verts)
            bmesh.ops.bisect_plane(bm,geom=list(geom),plane_co=bone.head_local+axis*.235,
                plane_no=axis.normalized(),dist=.000001,clear_inner=False,clear_outer=False)
        clothed_count=0
        for face in bm.faces:
            point=face.calc_center_median();values={}
            for v in face.verts:
                for index,weight in v[weights].items():values[names[index]]=values.get(names[index],0)+weight/len(face.verts)
            clothed=waist-.17<point.z<neck+.1
            for side in ['L','R']:
                bone=_bone(arm,'arm_'+side);axis=bone.tail_local-bone.head_local
                t=(point-bone.head_local).dot(axis)/axis.length_squared
                own=sum(values.get(n,0) for n in ['arm_'+side,'shoulder_'+side,'forearm_'+side,'hand_'+side])
                if own>.20 and t>=.235:clothed=False
            face.material_index=leather_index if clothed else skin_index
            clothed_count+=int(clothed)
        bm.to_mesh(obj.data);bm.free();obj.data.update()
        obj['peris_connected_source_garment']='Retained source torso/upper arms; leather material on connected torso/proximal sleeve; exact arm t=.235 edge; competing cuff/tube omitted'
        records.append({'object':obj.name,'leatherFaces':clothed_count,'vertices':len(obj.data.vertices)})
    removed=[]
    for obj in list(lib.groups[role]):
        if 'Continuous fitted Orc hide under-corslet' in obj.name:
            removed.append(obj.name);lib.groups[role].remove(obj);bpy.data.objects.remove(obj,do_unlink=True)
    arm['peris_connected_pilot_garment']=json.dumps({'operation':'Connected source topology garment transition',
        'sleeveArmParameter':.235,'components':records,'removedCompetingShells':removed,
        'license':'CC-BY-SA-3.0','author':'Peris adaptation of credited Wildfire Games body',
        'runtimeApproved':False,'finishedUnitApproved':False})


def _fit_hidden_pilot_torso(obj,garment,anchors):
    """Keep connected source armholes while clothing owns hidden torso motion."""
    waist=Vector(anchors['waist']).z;neck=Vector(anchors['neck']).z
    torso={'hip','spine','spine1','chest','neck'};count=0
    for vertex in obj.data.vertices:
        values={obj.vertex_groups[g.group].name:g.weight for g in vertex.groups if g.weight>0}
        root=sum(w for n,w in values.items() if n.startswith(('arm_','forearm_','shoulder_')))
        if not waist-.16<vertex.co.z<neck-.16 or root>=.50 or sum(values.get(n,0) for n in torso)<.52:continue
        p=vertex.co
        front=garment['torso_tree'].ray_cast(Vector((p.x,-20,p.z)),Vector((0,1,0)),40)[0]
        back=garment['torso_tree'].ray_cast(Vector((p.x,20,p.z)),Vector((0,-1,0)),40)[0]
        if front is None or back is None:continue
        # Explicit finite separation prevents coplanar body/cloth surfaces.
        p.y=max(front.y+.040,min(back.y-.040,p.y))
        nearest=garment['torso_tree'].find_nearest(p)
        face=garment['torso_faces'][nearest[2]]
        a,b,c=[garment['vertices'][i] for i in face];q=nearest[0]
        u=b-a;v=c-a;delta=q-a;d00=u.dot(u);d01=u.dot(v);d11=v.dot(v);denom=d00*d11-d01*d01
        if abs(denom)<1e-10:blend=[1,0,0]
        else:
            w1=(d11*delta.dot(u)-d01*delta.dot(v))/denom
            w2=(d00*delta.dot(v)-d01*delta.dot(u))/denom
            blend=[max(0,1-w1-w2),max(0,w1),max(0,w2)]
        weights={}
        for i,t in zip(face,blend):
            for name,w in garment['weights'][i].items():weights[name]=weights.get(name,0)+w*t
        weights=dict(sorted(weights.items(),key=lambda item:item[1],reverse=True)[:4]);total=sum(weights.values())
        for value in list(vertex.groups):obj.vertex_groups[value.group].remove([vertex.index])
        for name,w in weights.items():
            group=obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
            group.add([vertex.index],w/total,'REPLACE')
        count+=1
    obj.data.update()
    obj['peris_connected_pilot_armholes']='Original connected torso/upper-arm surface retained; covered torso separated .040 from clothing and inherits measured garment weights'
    obj['peris_hidden_torso_support_vertices']=count


def _limb_wrap(name,arm,role,bone,surface,mat,geometry,start=.12,end=.92,clearance=.040):
    """A measured closed sleeve follows the limb rather than a front rectangle."""
    count=32;rows=5;verts=[];axis=(bone.tail_local-bone.head_local).normalized()
    cross=axis.cross(Vector((0,1,0))).normalized();other=axis.cross(cross).normalized()
    faces=[f for f in surface['faces'] if sum(surface['weights'][i].get(bone.name,0) for i in f)/3>.20]
    if not faces:raise ValueError('No semantic source skin for '+bone.name)
    tree=BVHTree.FromPolygons(surface['vertices'],faces,all_triangles=True)
    maximum=_radius(surface,bone)*1.12
    for row in range(rows):
        t=start+(end-start)*row/(rows-1);center=bone.head_local.lerp(bone.tail_local,t)
        directions=[];radii=[]
        for i in range(count):
            theta=i/count*math.tau;direction=cross*math.cos(theta)+other*math.sin(theta)
            hit=tree.ray_cast(center,direction,1.2)[0]
            directions.append(direction);radii.append((hit-center).length if hit is not None else np.nan)
        valid=[i for i,radius in enumerate(radii) if not math.isnan(radius)]
        if len(valid)>2:
            extended=valid+[i+count for i in valid]+[i-count for i in valid]
            extended.sort();values=[radii[i%count] for i in extended]
            radii=np.interp(np.arange(count),extended,values)
        else:radii=np.full(count,maximum)
        smooth=(np.roll(radii,-1)+radii*2+np.roll(radii,1))/4
        for direction,radius in zip(directions,smooth):verts.append(center+direction*(radius+clearance))
    obj=_mesh(name,verts,[(r*count+i,r*count+(i+1)%count,(r+1)*count+(i+1)%count,(r+1)*count+i)
                         for r in range(rows-1) for i in range(count)],arm,role,bone.name,mat,geometry)
    _loft_uv(obj,count,rows)
    for p in obj.data.polygons:p.use_smooth=True
    if ('hide' in name.lower() or 'lining' in name.lower()) and 'shoulder' not in name.lower():
        fitted=dict(surface);fitted.update(torso_tree=tree,torso_faces=faces)
        _skin_binding(obj,fitted)
    return obj


def _radius(surface,bone):
    points=surface['weighted'].get(bone.name,[])
    if not points:return .18
    a=bone.head_local;axis=(bone.tail_local-a).normalized()
    distances=[((p-a)-axis*(p-a).dot(axis)).length for p in points]
    return float(np.quantile(distances,.88))+.025


def _loincloth(arm,role,waist,mat,geometry,surface):
    count=32;verts=[];rings=5
    for ring in range(rings):
        for i in range(count):
            t=math.tau*i/count
            amount=ring/(rings-1);pleat=.013*math.cos(t*8)*(1+amount)
            rx=.64+.035*amount+pleat;ry=.45+.025*amount+pleat
            z=.06-.57*amount
            if ring==rings-1:z+=.037*math.sin(i*2.7)+.024*math.sin(i*1.3)
            point=waist+Vector((math.sin(t)*rx,math.cos(t)*ry,z))
            direction=Vector((math.sin(t),math.cos(t),0))
            origin=Vector((waist.x,waist.y,waist.z+z))+direction*3
            # Hidden naked-body protrusions and separate thigh islands cannot
            # dictate the continuous garment's outer silhouette.
            verts.append(point)
    faces=[(r*count+i,r*count+(i+1)%count,(r+1)*count+(i+1)%count,(r+1)*count+i)
           for r in range(rings-1) for i in range(count)]
    obj=_mesh('Pleated rough hide under-kilt with torn hem',verts,faces,arm,role,'hip',mat,geometry)
    _loft_uv(obj,count,rings)
    for p in obj.data.polygons:p.use_smooth=True


def _pauldron(arm,role,center,bone,side,iron,fur,geometry,heavy=False):
    """A solid angular shoulder dome with fitted stepped outer lames.

    All metal follows the same upper-arm hinge. Empty curved bands and mixed
    shoulder/arm ownership previously pulled the layers apart during attack.
    """
    bronze=_material('Orc aged bronze trim',(.43,.265,.10),.66,.56,'iron')
    arm_bone='arm_L' if side>0 else 'arm_R'
    cols=9;rows=5
    profile=[(-.12,.20,.27),(.07,.27,.31),(.22,.21,.34),(.34,.07,.31),(.41,-.105,.25)]
    def shell_point(row,u):
        x,z,width=profile[row]
        if role=='archer':x*=.78;z*=.72;width*=.82
        # Chamfered front/back corners and a forward V give an angular plate
        # perimeter, while the broad middle remains a closed metal field.
        x-=.045*abs(u)**4
        z-=.175*abs(u)**1.4
        return center+Vector((side*x,u*width,z))
    verts=[shell_point(row,col/(cols-1)*2-1) for row in range(rows) for col in range(cols)]
    top_faces=[(r*cols+i,r*cols+i+1,(r+1)*cols+i+1,(r+1)*cols+i)
               for r in range(rows-1) for i in range(cols-1)]
    perimeter=list(range(cols))+[r*cols+cols-1 for r in range(1,rows)]+list(range((rows-1)*cols+cols-2,(rows-1)*cols-1,-1))+[r*cols for r in range(rows-2,0,-1)]
    n=len(verts);verts+=[p-Vector((side*.016,0,.061)) for p in verts]
    faces=list(top_faces)+[tuple(i+n for i in reversed(face)) for face in top_faces]
    faces.extend((a,b,b+n,a+n) for a,b in zip(perimeter,perimeter[1:]+perimeter[:1]))
    if side<0:faces=[tuple(reversed(face)) for face in faces]
    obj=_mesh('Orc closed angular worked shoulder dome',verts,faces,arm,role,arm_bone,iron,geometry)
    _loft_uv(obj,cols,rows,False)
    for p in obj.data.polygons:p.use_smooth=False
    obj['peris_portrait_panel']='Closed angular shoulder dome; all armor rigid on upper-arm hinge'
    obj['peris_rigid_armor_bone']=arm_bone
    # A broad folded strip follows the entire measured perimeter, including
    # front and back returns. It has closed thickness and shares the hinge.
    outer=[verts[i]+Vector((0,0,.007)) for i in perimeter]
    mean=sum(outer,Vector())/len(outer)
    inner=[p.lerp(mean,.10)+Vector((0,0,.008)) for p in outer]
    count=len(outer);rim=outer+inner
    rim+=[p-Vector((0,0,.017)) for p in rim]
    rim_faces=[(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    rim_faces+=[tuple(i+2*count for i in reversed(f)) for f in list(rim_faces)]
    for offset in [0,count]:
        rim_faces.extend((offset+i,offset+(i+1)%count,offset+(i+1)%count+2*count,offset+i+2*count) for i in range(count))
    rim_obj=_mesh('Orc broad folded copper shoulder rim',rim,rim_faces,arm,role,arm_bone,bronze,geometry)
    _panel_uv(rim_obj)
    for i in range(0,count,2):
        p=outer[i].lerp(inner[i],.58)+Vector((0,0,.008))
        geometry['ellipsoid']('Shoulder grouped flush copper rivet',p,(.014,.014,.010),arm,role,arm_bone,bronze)
    # Two thick, partially overlapping outer lames descend from the main cap.
    # They are full closed fields, never isolated strips above an oval pad.
    for layer in range(2):
        row=3+layer;strip=[]
        for bottom in [False,True]:
            for col in range(cols):
                u=col/(cols-1)*2-1;p=shell_point(row,u)
                p.x+=side*(.033+.012*layer);p.z+=.024-layer*.012
                if bottom:p.x+=side*.047;p.z-=.135;p.y*=1.01
                strip.append(p)
        front=[(i,i+1,cols+i+1,cols+i) for i in range(cols-1)]
        n=len(strip);strip+=[p-Vector((side*.038,0,.018)) for p in strip]
        faces=list(front)+[tuple(i+n for i in reversed(f)) for f in front]
        edge=list(range(cols))+list(range(2*cols-1,cols-1,-1))
        faces.extend((a,b,b+n,a+n) for a,b in zip(edge,edge[1:]+edge[:1]))
        if side<0:faces=[tuple(reversed(f)) for f in faces]
        lame=_mesh('Orc solid stepped outer shoulder lame',strip,faces,arm,role,arm_bone,iron,geometry)
        lame.data.materials.append(bronze);_loft_uv(lame,cols,2,False)
        for p in lame.data.polygons:
            p.use_smooth=False
            if p.index>=len(front)*2:p.material_index=1
        for col in [1,4,7]:
            p=strip[cols+col]+Vector((side*.007,0,.006))
            geometry['ellipsoid']('Shoulder lame corner rivet',p,(.013,)*3,arm,role,arm_bone,bronze)
    # The target's boss/spikes are rooted in the plate, with clear socket rims.
    for i in range(3 if heavy else 2):
        row=1 if i<2 else 2;u=(-.48,.38,-.08)[i]
        root=shell_point(row,u)+Vector((0,0,.009))
        geometry['ellipsoid']('Shoulder iron spike seated socket',root,(.066,.063,.025),arm,role,arm_bone,bronze)
        tip=root+Vector((side*(.055+.022*i),-.020,.185+.026*i))
        geometry['cone']('Shoulder forged spike seated in solid cap',root,tip,.039,.001,arm,role,arm_bone,iron)


def _axe(lib,arm,role,iron,wood,leather,geometry,elite=False):
    socket=lib.socket(arm,'weapon_R');m=socket.matrix_local@Matrix.Rotation(.52,4,'Z')
    hand=_bone(arm,'hand_R');m.translation=hand.matrix_local@Vector((0,.15,0))
    length=1.10 if elite else .95
    geometry['cone']('Knotted timber axe haft',m@Vector((0,0,-.31)),m@Vector((0,0,length)),.052,.043,arm,role,socket.name,wood)
    outline=[(-.045,length-.29),(.16,length-.32),(.28,length-.49),(.40,length-.40),
             (.53,length-.61),(.64,length-.37),(.60,length-.25),(.81,length-.13),
             (.73,length+.075),(.62,length+.27),(.43,length+.20),(.28,length+.04),(-.045,length+.035)]
    outline=[(x*.94,length+(z-length)*.92) for x,z in outline]
    if elite:outline=[(x*1.25,z+.08) for x,z in outline]
    verts=[m@Vector((x,y,z)) for y in [-.052,.052] for x,z in outline]
    n=len(outline);faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]
    faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    _mesh('Chipped Orc cleaver axe',verts,faces,arm,role,socket.name,iron,geometry)
    bronze=_material('Orc aged bronze trim',(.43,.265,.10),.66,.56,'iron')
    for i in [0,1,9,10,11,12]:
        x,z=outline[i];nx,nz=outline[(i+1)%len(outline)]
        geometry['cone']('Axe blade aged bronze inlay',m@Vector((x,-.058,z)),m@Vector((nx,-.058,nz)),.008,.008,arm,role,socket.name,bronze)
    for depth in [-.058,.058]:
        points=[m@Vector((x,depth,z)) for x,z in [(.32,length-.07),(.45,length+.03),(.56,length-.07),(.45,length-.17),(.32,length-.07)]]
        for a,b in zip(points,points[1:]):geometry['cone']('Axe face straight forged bronze diamond edge',a,b,.012,.012,arm,role,socket.name,bronze)
    for z in [-.21,-.10,.01,.12]:
        geometry['cone']('Axe leather grip binding',m@Vector((0,0,z)),m@Vector((0,0,z+.07)),.061,.061,arm,role,socket.name,leather)
    geometry['cone']('Worked iron axe socket',m@Vector((0,0,length-.20)),m@Vector((0,0,length+.045)),.079,.074,arm,role,socket.name,iron)
    geometry['cone']('Axe opposing forged back spike',m@Vector((-.025,0,length-.035)),m@Vector((-.26,0,length+.08)),.063,.002,arm,role,socket.name,iron)


def _spear(lib,arm,role,iron,wood,geometry,heavy=False):
    socket=lib.socket(arm,'weapon_R');m=socket.matrix_local
    length=2.62 if role=='spear_guard' else 2.25 if heavy else 1.75
    geometry['cone']('Rough long spear shaft',m@Vector((0,0,-.30)),m@Vector((0,0,length)),.045,.035,arm,role,socket.name,wood)
    outline=[(-.045,length-.12),(-.22,length+.08),(-.08,length+.17),(0,length+.57),(.15,length+.16),(.08,length-.12)]
    verts=[m@Vector((x,y,z)) for y in [-.025,.025] for x,z in outline]
    n=len(outline);faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]
    faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    _mesh('Barbed Orc spear blade',verts,faces,arm,role,socket.name,iron,geometry)


def _portrait_polearm(lib,arm,role,iron,bronze,wood,leather,ochre,geometry,halberd=False):
    """Original portrait spear/halberd with the real rigid palm/socket frame."""
    from orc_portrait_weapons import _axe_twist
    socket=lib.socket(arm,'weapon_R');hand=_bone(arm,'hand_R')
    m=socket.matrix_local@Matrix.Rotation(_axe_twist(arm,socket),4,'Z')
    m.translation=hand.matrix_local@Vector((0,.15,0))
    # The guard holds a long shaft alongside the face. Its end is deliberately
    # distinct from the short Axe Warrior blade and its wrapped grip stays in
    # the same existing closed palm reservation.
    length=2.05 if not halberd else 1.78
    bone=socket.name
    geometry['cone']('Tusk Guard long ash halberd haft' if halberd else 'Pike Brute long ash spear shaft',
                     m@Vector((0,0,-.63)),m@Vector((0,0,length)),.049,.034,arm,role,bone,wood)
    for z in [-.235,-.155,-.075,.005,.085]:
        geometry['cone']('Polearm closed palm leather binding',m@Vector((0,0,z)),m@Vector((0,0,z+.064)),
                         .054,.054,arm,role,bone,leather)
    for z in [.49,1.05,length-.13]:
        geometry['cone']('Polearm thick forged collar',m@Vector((0,0,z)),m@Vector((0,0,z+.07)),.064,.064,arm,role,bone,iron)
        for dz in [0,.07]:geometry['cone']('Polearm copper collar edge',m@Vector((0,0,z+dz)),m@Vector((0,0,z+dz+.018)),.068,.068,arm,role,bone,bronze)
    if halberd:
        outline=[(-.075,length-.25),(.15,length-.34),(.25,length-.53),(.49,length-.45),
                 (.66,length-.66),(.76,length-.42),(.70,length-.29),(.86,length-.16),
                 (.72,length+.12),(.53,length+.31),(.43,length+.14),(.19,length-.035),(-.075,length+.02)]
        top=[(-.065,length+.03),(-.11,length+.22),(0,length+.60),(.11,length+.22),(.065,length+.03)]
        spike_a=m@Vector((-.075,0,length-.12));spike_b=m@Vector((-.40,0,length+.02))
        geometry['cone']('Tusk Guard opposing iron hook spike',spike_a,spike_b,.056,.001,arm,role,bone,iron)
    else:
        outline=[(-.055,length-.11),(-.205,length+.08),(-.13,length+.23),(0,length+.63),(.13,length+.23),(.205,length+.08),(.055,length-.11)]
        top=None
    for title,points in [('Tusk Guard jagged bearded halberd blade' if halberd else 'Pike Brute long diamond spearhead',outline),('Tusk Guard crown spear point',top)]:
        if not points:continue
        n=len(points);verts=[m@Vector((x,y,z)) for y in [-.029,.029] for x,z in points]
        faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        part=_mesh(title,verts,faces,arm,role,bone,iron,geometry);_panel_uv(part)
        # Copper central spine belongs to the spear; the larger halberd gets
        # several branching ribs, so the silhouettes and surface design differ.
        if not halberd:
            p=[m@Vector((x,-.034,z)) for x,z in [(-.012,length-.04),(0,length+.54),(.012,length-.04)]]
            _mesh('Pike Brute copper spear spine',p,[(0,1,2)],arm,role,bone,bronze,geometry)
        else:
            for a,b in [((.15,length-.25),(.54,length+.10)),((.15,length-.25),(.63,length-.36)),((.34,length-.12),(.74,length-.17))]:
                va=m@Vector((a[0],-.034,a[1]));vb=m@Vector((b[0],-.034,b[1]))
                geometry['cone']('Tusk Guard halberd branching copper rib',va,vb,.010,.010,arm,role,bone,bronze)
    # A split ochre pennon trails from below the blade; narrow fixed panels
    # remain clear of the fist and are explicitly decorative, not simulated.
    for side in [-1,1]:
        p=[m@Vector((side*x,-.044,z)) for x,z in [(.02,length-.12),(.14,length-.15),(.17,length-.77),(.09,length-.69),(.065,length-.89),(.018,length-.78)]]
        _mesh('Tusk Guard split rank banner' if halberd else 'Pike Brute ochre spear pennon',p,[(0,1,2,3,4,5)],arm,role,bone,ochre,geometry)
    arm['peris_distinct_polearm']='Portrait long halberd with crown spike and split rank banner' if halberd else 'Portrait long diamond spear with split ochre pennon'


def _guard_crown(lib,arm,role,iron,bronze,geometry):
    """Fit the elite open-face crown to the actual adapted head, not a sphere."""
    head=next(o for o in lib.groups[role] if o.get('peris_licensed_head_component')=='source-head-skin')
    eyes=next(o for o in lib.groups[role] if o.get('peris_licensed_head_component')=='source-head-eyes')
    verts=[v.co for v in head.data.vertices];lo=Vector([min(v[i] for v in verts) for i in range(3)]);hi=Vector([max(v[i] for v in verts) for i in range(3)])
    brow=max(v.co.z for v in eyes.data.vertices)+.053
    tree=BVHTree.FromPolygons(verts,[tuple(p.vertices) for p in head.data.polygons])
    cy=(lo.y+hi.y)*.5;cx=(lo.x+hi.x)*.5;count=36;rows=6;vertices=[]
    for row in range(rows):
        t=row/(rows-1);z=brow+(hi.z+.022-brow)*t
        for col in range(count):
            angle=math.tau*col/count;d=Vector((math.sin(angle),math.cos(angle),0))
            origin=Vector((cx,cy,min(z,hi.z-.006)));hit=tree.ray_cast(origin,d,2)[0]
            if hit is None:
                radius=max(.025,(hi.x-lo.x)*.50*math.sqrt(max(.005,1-t*t)))
                hit=origin+d*radius
            vertices.append(hit+d*.027+Vector((0,0,.012*t)))
    faces=[(r*count+i,r*count+(i+1)%count,(r+1)*count+(i+1)%count,(r+1)*count+i) for r in range(rows-1) for i in range(count)]
    bone=lib.socket(arm,'head').name
    obj=_mesh('Tusk Guard fitted open-face iron war crown',vertices,faces,arm,role,bone,iron,geometry)
    _loft_uv(obj,count,rows)
    # Broad raised brow edge and center ridge form the elite helmet identity.
    for col in range(count):
        a=vertices[col];b=vertices[(col+1)%count]
        geometry['cone']('Tusk Guard crown copper brow rim',a,b,.025,.025,arm,role,bone,bronze)
    ridge=[]
    for i in range(rows):ridge.append(vertices[i*count+count//2]+Vector((0,-.016,.01)))
    for a,b in zip(ridge,ridge[1:]):geometry['cone']('Tusk Guard crown raised iron nasal ridge',a,b,.043,.043,arm,role,bone,iron)
    for col in [0,9,18,27]:
        root=vertices[(rows-2)*count+col]
        direction=Vector((root.x-cx,root.y-cy,.20)).normalized()
        geometry['cone']('Tusk Guard crown rooted battle spike',root,root+direction*.26,.053,.001,arm,role,bone,iron)


def _guard_mantle(arm,role,anchors,fur,ochre,geometry,surface):
    """Elite fur-backed, ochre rank mantle with pelvis-safe flexible weights."""
    neck=Vector(anchors['neck']);waist=Vector(anchors['waist']);rows=10;cols=11;verts=[]
    for row in range(rows):
        t=row/(rows-1);width=.51+.11*math.sin(math.pi*t)
        for col in range(cols):
            u=col/(cols-1)*2-1
            z=neck.z-.13-(neck.z-waist.z+.51)*t
            y=neck.y+.37+.18*t+.04*math.cos(u*math.tau*2)*t
            if row==rows-1:z+=.095*math.sin(col*2.4)
            verts.append(Vector((neck.x+u*width,y,z)))
    faces=[(r*cols+i,r*cols+i+1,(r+1)*cols+i+1,(r+1)*cols+i) for r in range(rows-1) for i in range(cols-1)]
    obj=_mesh('Tusk Guard fur-backed rank mantle with ragged hem',verts,faces,arm,role,'chest',fur,geometry);_loft_uv(obj,cols,rows,False)
    # Rank stripe is a real additional cloth field on the outer back, keeping
    # the Tusk Guard distinguishable from the shorter Pike/Axe tabards.
    stripe=[]
    for row in range(rows):
        for col in [4,6]:stripe.append(verts[row*cols+col]+Vector((0,.018,0)))
    _mesh('Tusk Guard long ochre mantle rank stripe',stripe,[(r*2,r*2+1,r*2+3,r*2+2) for r in range(rows-1)],arm,role,'chest',ochre,geometry)


def _archer_identity(lib,arm,role,wood,leather,bronze,ochre,geometry):
    """Retain the licensed articulated bow and release fingers, upgrade its kit."""
    records=[]
    for obj in list(lib.groups[role]):
        path=obj.get('source_actor','')
        if '/weapons/bow_' in path:
            # The source bow meshes share their authored draw animation. Do
            # not replace them with a rigid decorative curve or move sockets.
            records.append({'object':obj.name,'sourceActor':path,'operation':'Retained authored articulated bow geometry/weights; new wood finish'})
            obj.data.materials.clear();obj.data.materials.append(wood)
            obj['peris_orc_bow_adaptation']='Retained licensed articulated bow, Peris wood/copper kit; source draw/release rig unchanged'
        if '/quiver' in path:
            obj['peris_orc_quiver_adaptation']='Licensed source quiver and arrows retained at actual source attachment'
            records.append({'object':obj.name,'sourceActor':path,'operation':'Retained quiver/arrow placement and weights'})
    # Visible ochre archer baldric and utility belt distinguish the ranged
    # silhouette without obstructing the string or the draw hand.
    chest=_bone(arm,'chest');hip=_bone(arm,'hip')
    for side in [-1,1]:
        geometry['cube']('War Bowman leather arrow maintenance pouch',hip.head_local+Vector((side*.54,.07,-.15)),(.19,.19,.26),arm,role,'hip',leather,.025)
    import json
    arm['peris_distinct_ranged_gear']=json.dumps({'role':role,'sourceParts':records,
        'unchanged':['Articulated bow rig','source draw/release hand pose','quiver attachment'],
        'runtimeApproved':False,'finishedUnitApproved':False})


def _shield(lib,arm,role,wood,iron,geometry,heavy=False):
    forearm=_bone(arm,'forearm_L');bone=forearm
    m=Matrix.Identity(4)
    m.translation=forearm.head_local.lerp(forearm.tail_local,.72)+Vector((.10,-.37,-.20))
    outline=[(0,-.84),(-.39,-.42),(-.46,.47),(-.28,.70),(.28,.70),(.46,.47),(.39,-.42)]
    factor=1.10 if heavy else 1;n=len(outline)
    verts=[m@Vector((x*factor,depth,z*factor+.16)) for depth in [-.07,.07] for x,z in outline]
    verts.append(m@Vector((0,-.135,.16)))
    faces=[(i,(i+1)%n,n*2) for i in range(n)]+[tuple(range(n,n*2))]
    faces.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
    _mesh('Battered angular Orc iron tower shield',verts,faces,arm,role,bone.name,iron,geometry)
    bronze=_material('Orc aged bronze trim',(.43,.265,.10),.66,.56,'iron')
    for i,(x,z) in enumerate(outline):
        a=m@Vector((x*factor,-.082,z*factor+.16));nx,nz=outline[(i+1)%n]
        b=m@Vector((nx*factor,-.082,nz*factor+.16))
        ca=m@Vector((x*factor*.89,-.087,z*factor*.89+.16));cb=m@Vector((nx*factor*.89,-.087,nz*factor*.89+.16))
        _mesh('Shield broad worked copper perimeter plate',[a,b,cb,ca],[(0,1,2,3)],arm,role,bone.name,bronze,geometry)
        geometry['ellipsoid']('Hammered shield bronze rivet',a,(.017,)*3,arm,role,bone.name,bronze)
        for dx,dz in [(-.018,.033),(.024,-.026)]:
            geometry['ellipsoid']('Shield grouped corner copper rivet',ca+Vector((dx,-.011,dz)),(.012,)*3,arm,role,bone.name,bronze)
    # The recognizable diamond device is constructed as an embossed border.
    for radius in [.19,.37]:
        points=[m@Vector((x,-.15,z+.16)) for x,z in [(0,radius),(radius*.63,0),(0,-radius),(-radius*.63,0),(0,radius)]]
        center=m@Vector((0,-.150,.16))
        for a,b in zip(points,points[1:]):
            ca=center+(a-center)*.80;cb=center+(b-center)*.80
            _mesh('Orc shield broad embossed copper diamond plate',[a,b,cb,ca],[(0,1,2,3)],arm,role,bone.name,bronze,geometry)
    for side in [-1,1]:
        geometry['cone']('Shield angular iron thorn',m@Vector((side*.37,-.08,.35)),m@Vector((side*.39,-.19,.40)),.045,.003,arm,role,bone.name,iron)
    hand=_bone(arm,'hand_L');hm=hand.matrix_local
    ends=[hm@Vector((0,.15,z)) for z in [-.17,.17]]
    leather=_material('Orc cracked hide leather',(.15,.075,.031),0,.91)
    geometry['cone']('Orc rear shield handle inside closed left palm',ends[0],ends[1],.052,.052,arm,role,hand.name,leather)
    for end in ends:
        local=m.inverted()@end;local.y=.078;local.x=max(-.30,min(.30,local.x));local.z=max(-.40,min(.52,local.z))
        anchor=m@local;vertices=[]
        for row in range(4):
            p=anchor.lerp(end,row/3);vertices.extend([p+Vector((-.045,0,0)),p+Vector((.045,0,0))])
        obj=_mesh('Orc articulated leather shield handle strap',vertices,[(r*2,r*2+1,r*2+3,r*2+2) for r in range(3)],arm,role,bone.name,leather,geometry)
        obj.vertex_groups.clear();fg=obj.vertex_groups.new(name=bone.name);hg=obj.vertex_groups.new(name=hand.name)
        for row in range(4):
            fg.add([row*2,row*2+1],1-row/3,'REPLACE');hg.add([row*2,row*2+1],row/3,'REPLACE')
        geometry['ellipsoid']('Shield rear strap anchor rivet',anchor,(.024,)*3,arm,role,bone.name,bronze)
    arm['peris_shield_grip_attachment']='Closed left palm grip with handle rigid to hand; leather anchors blend forearm/shield to hand; actual contact review required'


def _plate(name,center,width,height,arm,role,bone,iron,bronze,geometry,surface=None):
    # Faceted convex six-sided iron plate with a separately constructed rim.
    outline=[(-width*.49,-height*.43),(-width*.5,height*.25),(-width*.25,height*.49),
             (width*.25,height*.49),(width*.5,height*.25),(width*.49,-height*.43)]
    verts=[Vector(center)+Vector((x,.005,z)) for x,z in outline]
    if surface:
        for i,p in enumerate(verts):
            try:verts[i]=surface['front'](p.x,p.z,.024)
            except ValueError:pass
    boundary=[v.copy() for v in verts]
    # Several nested contours create a bulged worked plate, retaining its
    # angular outer silhouette with a smooth continuous central surface.
    side=surface.get('plate_side',-1) if surface else -1
    depths=[v.y for v in boundary]
    if surface:
        for x in np.linspace(-width*.42,width*.42,7):
            for z in np.linspace(-height*.34,height*.40,5):
                try:depths.append(surface['front'](center.x+x,center.z+z,.038).y)
                except ValueError:pass
    bulge_y=(min(depths) if side<0 else max(depths))+side*.012
    for t in [.94,.80,.60,.40,.20]:
        for edge in boundary:
            p=Vector(center)+(edge-Vector(center))*t
            p.y=edge.y*t**8+bulge_y*(1-t**8)
            if surface:
                try:
                    q=surface['front'](p.x,p.z,.022)
                    p.y=min(p.y,q.y) if side<0 else max(p.y,q.y)
                except ValueError:pass
            verts.append(p)
    peak=Vector(center);peak.y=bulge_y;verts.append(peak)
    faces=[(r*6+i,r*6+(i+1)%6,(r+1)*6+(i+1)%6,(r+1)*6+i) for r in range(5) for i in range(6)]
    faces.extend((30+i,30+(i+1)%6,36) for i in range(6))
    obj=_mesh(name,verts,faces,arm,role,bone,iron,geometry)
    _panel_uv(obj)
    obj.data.materials.append(bronze)
    for polygon in obj.data.polygons:
        polygon.use_smooth=True
        if polygon.index<6:polygon.material_index=1
    obj['peris_rigid_armor_bone']=bone
    for x in [-width*.30,width*.30]:
        p=Vector(center)+Vector((x,-.028,height*.21))
        if surface:
            try:p=surface['front'](p.x,p.z,.035);p.y=bulge_y+side*.010
            except ValueError:pass
        obj=geometry['ellipsoid']('Battered cuirass rivet',p,(.012,)*3,arm,role,bone,bronze)
        obj['peris_rigid_armor_bone']=bone


def _iron_panel(name,outline,arm,role,bone,iron,bronze,geometry,surface):
    """Closed angular cuirass panel following the finished flexible corslet."""
    side=surface.get('plate_side',-1)
    signed_area=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(outline,outline[1:]+outline[:1]))
    if signed_area*side>0:outline=list(reversed(outline))
    n=len(outline);cx=sum(p[0] for p in outline)/n;cz=sum(p[1] for p in outline)/n
    def fitted(x,z,offset):
        try:return surface['front'](x,z,offset)
        except ValueError:
            q=surface['torso_tree'].find_nearest(Vector((x,-1 if side<0 else 1,z)))[0]
            if q is None:raise ValueError('Cuirass panel has no fitted support')
            return Vector((x,q.y+side*offset,z))
    outer=[fitted(x,z,.026) for x,z in outline]
    peak=fitted(cx,cz,.066)
    depths=[p.y for p in outer]+[peak.y]
    bulge=(min(depths) if side<0 else max(depths))+side*.009
    verts=[]
    for t in [1,.89,.62,.30]:
        for x,z in outline:
            p=fitted(cx+(x-cx)*t,cz+(z-cz)*t,.027+.036*(1-t*t))
            verts.append(p)
    verts.append(fitted(cx,cz,.067));front_count=len(verts)
    faces=[(r*n+i,r*n+(i+1)%n,(r+1)*n+(i+1)%n,(r+1)*n+i) for r in range(3) for i in range(n)]
    faces.extend((3*n+i,3*n+(i+1)%n,4*n) for i in range(n))
    pilot=_accepted_infantry(arm,role)
    rim_faces=None;border=list(range(n))
    if pilot:
        # Fitting only the ten corners and nested contours left long planar
        # chords inside the curved hide, even with identical chest weights.
        # Subdivide the actual front topology before refitting every sample;
        # retain a continuous closed shell and the original angular outline.
        import bmesh
        bm=bmesh.new()
        bv=[bm.verts.new(p) for p in verts]
        for i,face in enumerate(faces):
            f=bm.faces.new([bv[j] for j in face]);f.material_index=1 if i<n else 0
        bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=7,use_grid_fill=True)
        for vertex in bm.verts:
            x,z=vertex.co.x,vertex.co.z
            distances=[]
            for a,b in zip(outline,outline[1:]+outline[:1]):
                ax,az=a;bx,bz=b;dx,dz=bx-ax,bz-az
                t=max(0,min(1,((x-ax)*dx+(z-az)*dz)/max(dx*dx+dz*dz,1e-10)))
                distances.append(math.hypot(x-ax-t*dx,z-az-t*dz))
            clearance=.029+.025*min(1,min(distances)/.11)
            vertex.co=fitted(x,z,clearance)
        bm.verts.index_update();bm.faces.index_update()
        verts=[v.co.copy() for v in bm.verts]
        faces=[tuple(v.index for v in f.verts) for f in bm.faces]
        rim_faces={f.index for f in bm.faces if f.material_index==1}
        boundary=[edge for edge in bm.edges if edge.is_boundary]
        adjacency={}
        for edge in boundary:
            a,b=[v.index for v in edge.verts]
            adjacency.setdefault(a,[]).append(b);adjacency.setdefault(b,[]).append(a)
        if any(len(nexts)!=2 for nexts in adjacency.values()):
            bm.free();raise ValueError('Pilot cuirass has an invalid open boundary')
        start=min(adjacency);border=[start];previous=None;current=start
        while True:
            candidates=adjacency[current]
            following=next(i for i in candidates if i!=previous)
            if following==start:break
            border.append(following);previous,current=current,following
            if len(border)>len(adjacency):
                bm.free();raise ValueError('Pilot cuirass boundary does not close')
        if len(border)!=len(adjacency):
            bm.free();raise ValueError('Pilot cuirass has more than one boundary loop')
        # Orient the skirt of the shell consistently with its front surface.
        area=sum(verts[a].x*verts[b].z-verts[b].x*verts[a].z
                 for a,b in zip(border,border[1:]+border[:1]))
        if area*side>0:border.reverse()
        bm.free()
    front_count=len(verts);front_faces=len(faces)
    verts+=[p-Vector((0,side*.024,0)) for p in verts]
    faces+=[tuple(i+front_count for i in reversed(face)) for face in list(faces)]
    faces.extend((a,b,b+front_count,a+front_count) for a,b in zip(border,border[1:]+border[:1]))
    obj=_mesh(name,verts,faces,arm,role,bone,iron,geometry);obj.data.materials.append(bronze);_panel_uv(obj)
    for polygon in obj.data.polygons:
        is_rim=polygon.index in rim_faces if rim_faces is not None else polygon.index<n
        polygon.use_smooth=polygon.index<front_faces and not is_rim
        if is_rim:polygon.material_index=1
    obj['peris_rigid_armor_bone']=bone;obj['peris_portrait_panel']='Overlapping chevron iron panel with closed thickness, bevel and fitted rim'
    if pilot:
        obj['peris_panel_front_face_count']=front_faces
        obj['peris_panel_front_vertex_count']=front_count
        obj['peris_panel_boundary_vertex_count']=len(border)
        obj['peris_panel_fit']='Every dense front sample ray-fitted to finished hide, clearance .029 to .054; rigid owner bone unchanged'
    for i,(a,b) in enumerate(zip(outer,outer[1:]+outer[:1])):
        count=max(1,int((b-a).length/.14))
        for j in range(count):
            t=(j+.5)/count;p=a.lerp(b,t)
            p.x=cx+(p.x-cx)*.935;p.z=cz+(p.z-cz)*.935
            p=fitted(p.x,p.z,.044)
            geometry['ellipsoid']('Cuirass grouped flush copper rivet',p,(.011,.009,.011),arm,role,bone,bronze)
    return obj


def _fitted_boot(arm,role,foot,surface,leather,iron,bronze,geometry):
    points=surface['weighted'].get(foot.name)
    if not points:raise ValueError('No foot skin to fit enclosed Orc boot')
    lo=Vector([min(v[i] for v in points) for i in range(3)]);hi=Vector([max(v[i] for v in points) for i in range(3)])
    center=(hi+lo)*.5;width=(hi.x-lo.x)*.68+.024;depth=(hi.y-lo.y)*.65+.032
    # Rounded toe, shaped instep, heel and narrower ankle collar are separate
    # loft rings in one fitted boot surface; no enclosing rectangular block.
    verts=[];count=16
    for z,rx,ry,cy in [(lo.z-.02,width,depth,center.y),
                       (lo.z+.035,width*1.03,depth*1.025,center.y),
                       (lo.z+(hi.z-lo.z)*.70,width*.96,depth*.91,center.y+.025),
                       (hi.z+.035,width*.73,depth*.57,foot.head_local.y-.025)]:
        for i in range(count):
            theta=math.tau*i/count
            verts.append(Vector((center.x+math.cos(theta)*rx,cy+math.sin(theta)*ry,z)))
    faces=[tuple(range(count-1,-1,-1)),tuple(range(3*count,4*count))]
    faces.extend((r*count+i,r*count+(i+1)%count,(r+1)*count+(i+1)%count,(r+1)*count+i)
                 for r in range(3) for i in range(count))
    obj=_mesh('Orc shaped hide boot with rounded toe and ankle',verts,faces,arm,role,foot.name,leather,geometry)
    for polygon in obj.data.polygons:polygon.use_smooth=True
    # The solid toe cap is measured from the completed boot, closing the old
    # floating instep rim. Its silhouette follows the boot in every foot pose.
    boot_tree=BVHTree.FromPolygons(verts,[tuple(p.vertices) for p in obj.data.polygons])
    cap=[];rows=6;cols=13
    for row in range(rows):
        amount=row/(rows-1)
        for col in range(cols):
            u=col/(cols-1)*2-1
            y=center.y-depth*(.79-.47*amount)
            x=center.x+u*width*(.56+.29*amount)
            hit=boot_tree.ray_cast(Vector((x,y,hi.z+1)),Vector((0,0,-1)),2)[0]
            if hit is None:raise ValueError('Toe cap misses finished boot')
            cap.append(hit+Vector((0,0,.015)))
    faces=[(r*cols+i,r*cols+i+1,(r+1)*cols+i+1,(r+1)*cols+i) for r in range(rows-1) for i in range(cols-1)]
    n=len(cap);cap+=[p-Vector((0,0,.012)) for p in cap]
    faces+=[tuple(i+n for i in reversed(face)) for face in list(faces)]
    border=list(range(cols))+[r*cols+cols-1 for r in range(1,rows)]+list(range((rows-1)*cols+cols-2,(rows-1)*cols-1,-1))+[r*cols for r in range(rows-2,0,-1)]
    faces.extend((a,b,b+n,a+n) for a,b in zip(border,border[1:]+border[:1]))
    cap_obj=_mesh('Orc closed worked iron toe cap fitted on hide boot',cap,faces,arm,role,foot.name,iron,geometry)
    for p in cap_obj.data.polygons:p.use_smooth=True
    for i in [2,6,10]:geometry['ellipsoid']('Boot toe cap flush rivet',cap[i],(.012,)*3,arm,role,foot.name,bronze)


def _ragged_tabard(arm,role,waist,front,ochre,geometry,surface):
    for side in [-1,1]:
        cols=7;rows=11;verts=[]
        for row in range(rows):
            amount=row/(rows-1)
            for col in range(cols):
                u=col/(cols-1);x=side*(.018+u*(.19-.025*amount))
                y=front-.016-.026*math.sin(u*math.tau*1.5)*amount-.015*amount
                z=waist.z+.028-.88*amount
                if row==rows-1:z+=.047*math.sin(col*2.1+side)+.027*math.cos(col*1.7)
                try:y=min(y,surface['front'](x,z,.105,region='full').y)
                except ValueError:pass
                verts.append(Vector((x,y,z)))
        obj=_mesh('Separate folded ochre ragged tabard panel',verts,
                  [(r*cols+i,r*cols+i+1,(r+1)*cols+i+1,(r+1)*cols+i) for r in range(rows-1) for i in range(cols-1)],
                  arm,role,'hip',ochre,geometry)
        _loft_uv(obj,cols,rows,False)
        for polygon in obj.data.polygons:polygon.use_smooth=True


def _back_armor(arm,role,anchors,iron,bronze,leather,geometry,surface):
    chest=Vector(anchors['chest']);waist=Vector(anchors['waist'])
    def back(x,z,offset=.024):
        hit=surface['torso_tree'].ray_cast(Vector((x,20,z)),Vector((0,-1,0)),40)[0]
        return Vector((x,hit.y+offset,z)) if hit else Vector((x,.28+offset,z))
    for row in range(3):
        z=chest.z+.39-row*.27
        for side in [-1,1]:
            center=back(side*.24,z);width=.47;height=.35
            fitted=dict(surface);fitted['front']=back;fitted['plate_side']=1
            _plate('Orc convex overlapping worked back plate',center,width,height,arm,role,'chest',iron,bronze,geometry,fitted)
    for side in [-1,1]:
        points=[]
        for t in [0,.25,.50,.75,1]:
            x=side*(.42-.70*t);z=chest.z+.48+(waist.z+.10-chest.z-.48)*t
            points.append(back(x,z,.11))
        obj=_harness('Orc crossed fitted back harness',points,arm,role,leather,geometry);_skin_binding(obj,surface)


def _war_armor(arm,role,anchors,iron,bronze,leather,ochre,geometry,surface):
    waist=Vector(anchors['waist']);chest=Vector(anchors['chest'])
    light=role=='scout';elite=role in ['elite','heavy_cavalry']
    # Overlapping contoured plates cover the torso, leaving the large upper
    # arms exposed exactly as the approved portrait's armor silhouette does.
    if not light:
        fitted=surface.get('finished_corslet',surface)
        front_panels=[]
        if _accepted_infantry(arm,role):
            # The studded harness and its diamond follow this one breastplate.
            # Three separate spine hinges formerly crossed the X harness and
            # drove the lower plate through it during the real attack poses.
            front_panels.append(_iron_panel('Orc continuous chest-rigid angular breastplate',
                _pilot_chest_outline(chest.z),arm,role,'chest',iron,bronze,geometry,fitted))
            front_panels.append(_iron_panel('Orc pelvis-rigid fitted belt fauld',
                _pilot_fauld_outline(waist.z),arm,role,'hip',iron,bronze,geometry,fitted))
        else:
            panels=[('chest',[(-.49,.55),(-.28,.66),(0,.48),(.28,.66),(.49,.55),(.51,.20),(0,.055),(-.51,.20)]),
                    ('spine1',[(-.49,.19),(0,.035),(.49,.19),(.46,-.015),(0,-.185),(-.46,-.015)]),
                    ('spine',[(-.44,-.01),(0,-.165),(.44,-.01),(.41,-.24),(.20,-.34),(-.20,-.34),(-.41,-.24)])]
            for bone,outline in panels:
                front_panels.append(_iron_panel('Orc overlapping angular chevron cuirass',[(x,chest.z+z) for x,z in outline],arm,role,bone,iron,bronze,geometry,fitted))
        surface['front_armor_objects']=front_panels
        _back_armor(arm,role,anchors,iron,bronze,leather,geometry,fitted)
    # Iron tassets cover the hide skirt in separately animated hanging plates.
    for side in [-1,1]:
        for i in range(2 if light else 3):
            angle=side*(.31+i*.34);x=math.sin(angle)*.655
            front_y=waist.y-math.cos(angle)*.475
            p=Vector((x,front_y-.018,waist.z-.125-i*.018))
            _plate('Orc short overlapping fitted hip tasset',p,.245,.315,arm,role,'hip',iron,bronze,geometry)
    # Torn ochre front cloth is a major color cue, visible between the tassets.
    front=surface['front'](0,waist.z+.03,.12).y
    _ragged_tabard(arm,role,waist,front-.045,ochre,geometry,surface)
    buckle=Vector((0,front-.135,waist.z+.085))
    _plate('Orc structured worked belt buckle',buckle,.34,.29,arm,role,'hip',iron,bronze,geometry)
    badge=[buckle+Vector((x,-.035,z)) for x,z in [(0,.090),(.067,0),(0,-.090),(-.067,0)]]
    center=buckle+Vector((0,-.061,0))
    _mesh('Orc belt buckle raised diamond center',badge+[center],[(i,(i+1)%4,4) for i in range(4)],arm,role,'hip',bronze,geometry)
    for side in ['L','R']:
        leg=_bone(arm,'leg_'+side);foot=_bone(arm,'foot_'+side);forearm=_bone(arm,'forearm_'+side)
        thigh=_bone(arm,'thigh_'+side)
        _limb_wrap('Orc closed calf hide greave lining',arm,role,leg,surface,leather,geometry,.08,.95,.038)
        for a,b in [(.19,.25),(.53,.59),(.78,.84)]:
            _limb_wrap('Orc full calf copper fastener band',arm,role,leg,surface,bronze,geometry,a,b,.051)
        for t in [.61]:
            middle=thigh.head_local.lerp(thigh.tail_local,t)
            try:p=surface['front'](middle.x,middle.z,.065,region='full')
            except ValueError:continue
            _plate('Orc contoured overlapping thigh cuisse',p,.40,.35,arm,role,thigh.name,iron,bronze,geometry)
        length=(leg.tail_local-leg.head_local).length
        for t in [.27,.55,.79]:
            middle=leg.head_local.lerp(leg.tail_local,t)
            p=surface['front'](middle.x,middle.z,.028,region='full')
            _plate('Orc overlapping full length iron greave',p,.32,length*(.23 if t>.7 else .32),arm,role,leg.name,iron,bronze,geometry)
        p=surface['front'](leg.head_local.x,leg.head_local.z-.02,.03,region='full')
        _plate('Orc fitted iron knee plate',p,.27,.24,arm,role,leg.name,iron,bronze,geometry)
        # Large enclosed hide boots and metal toe caps avoid the old human
        # Roman sandals while accommodating the broadened original Orc feet.
        _fitted_boot(arm,role,foot,surface,leather,iron,bronze,geometry)
        radius=_radius(surface,forearm)
        _limb_wrap('Orc measured hide forearm wrap',arm,role,forearm,surface,leather,geometry,.40,.91,.045)
        for a,b in [(.46,.51),(.81,.86)]:
            _limb_wrap('Orc forearm copper fastener band',arm,role,forearm,surface,bronze,geometry,a,b,.060)
        p=forearm.head_local.lerp(forearm.tail_local,.65)
        try:p=surface['front'](p.x,p.z,.045,region='full')
        except ValueError:p+=Vector((0,-radius-.025,0))
        _plate('Orc strapped forearm iron plate',p,.24,.28,arm,role,forearm.name,iron,bronze,geometry)


def _fit_clip_ground(lib,arm,role):
    """Fit mapped pilot motion to the actual closed boot sole at every frame.

    The source stride rotations remain. Only the hip's global vertical offset
    changes, and the measured before/after contacts are retained for review.
    """
    import json
    boots=[o for o in lib.groups[role] if 'shaped hide boot' in o.name.lower()]
    if len(boots)!=2:raise ValueError('Ground fit requires the two complete fitted boots')
    scene=bpy.context.scene;animation=arm.animation_data
    if animation is None:raise ValueError('Ground fit requires mapped pilot clips')
    original_action=animation.action;original_frame=scene.frame_current;original_subframe=scene.frame_subframe
    track_state={track.name:track.mute for track in animation.nla_tracks}
    original_basis={bone.name:bone.matrix_basis.copy() for bone in arm.pose.bones}
    def sole():
        bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
        points=[]
        for obj in boots:
            evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh()
            points.extend((evaluated.matrix_world@v.co).z for v in mesh.vertices)
            evaluated.to_mesh_clear()
        return min(points)
    try:
        for track in animation.nla_tracks:track.mute=True
        animation.action=None
        for bone in arm.pose.bones:bone.matrix_basis=Matrix.Identity(4)
        scene.frame_set(1);rest_floor=sole();floor=0.;records=[]
        inverse=arm.matrix_world.to_3x3().inverted()
        for state in ['idle','walk','attack']:
            track=next(t for t in animation.nla_tracks if t.name==role+'_'+state)
            if len(track.strips)!=1:raise ValueError('Ground fit expects one mapped action per state')
            action=track.strips[0].action;animation.action=action
            if action.get('peris_fitted_boot_ground'):raise ValueError('Ground placement must be fitted once per fresh build')
            first=int(math.ceil(action.frame_range[0]));last=int(math.floor(action.frame_range[1]))
            samples=[]
            for frame in range(first,last+1):
                scene.frame_set(frame);before=sole()
                samples.append((frame,before,arm.pose.bones['hip'].matrix.copy()))
            state_records=[]
            for frame,before,matrix in samples:
                scene.frame_set(frame)
                shift=inverse@Vector((0,0,floor-before))
                arm.pose.bones['hip'].matrix=Matrix.Translation(shift)@matrix
                arm.pose.bones['hip'].keyframe_insert('location',frame=frame,group='hip')
                after=sole()
                state_records.append({'frame':frame,'soleWorldBefore':before,'soleWorldAfter':after,
                                      'worldVerticalHipCorrection':floor-before})
                if abs(after-floor)>.0001:raise ValueError('Fitted boot ground residual exceeds .0001')
            # Re-evaluate the completed action, after every new hip key has
            # been written; immediate assignment alone can hide curve drift.
            for record in state_records:
                scene.frame_set(record['frame']);finished=sole()
                record['completedActionSoleWorldZ']=finished
                if abs(finished-floor)>.0001:raise ValueError('Completed boot action residual exceeds .0001')
            action['peris_fitted_boot_ground']=True
            action['peris_ground_placement_edit']='Hip-only world vertical placement; original stride/attack rotations retained'
            records.append({'state':state,'action':action.name,'samples':state_records})
        arm['peris_ground_placement_review']=json.dumps({'baseline':'closed fitted boot soles in armature rest pose',
            'referenceRestFloorZ':rest_floor,'measuredRestToCanonicalPlaneOffset':-rest_floor,
            'fixedSoleWorldZ':floor,'placementSpace':'Final scaled/rotated armature world space; canonical terrain plane Z=0',
            'clips':records,'runtimeApproved':False,'finishedUnitApproved':False})
    finally:
        animation.action=original_action
        for track in animation.nla_tracks:track.mute=track_state[track.name]
        for bone in arm.pose.bones:bone.matrix_basis=original_basis[bone.name]
        scene.frame_set(original_frame,subframe=original_subframe);bpy.context.view_layer.update()


def apply(lib,arm,role,mats,geometry,anchors):
    _clear(lib,role,['/helmets/','/armor/','/shields/','/capes/'])
    if role!='archer':_clear(lib,role,['/weapons/','/quiver'])
    iron=_material('Orc rusted hammered iron',(.11,.12,.11),.22,.82,'iron')
    leather=_material('Orc cracked hide leather',(.15,.075,.031),0,.91)
    wood=_material('Orc splintered ash timber',(.38,.25,.11),0,.87,'wood')
    fur=_material('Orc dark matted fur',(.20,.13,.075),0,.98,'fur')
    bronze=_material('Orc aged bronze trim',(.43,.265,.10),.66,.56,'iron')
    ochre=_material('Orc torn ochre clan cloth',(.59,.27,.035),0,.94,'cloth')
    waist=Vector(anchors['waist']);chest=Vector(anchors['chest'])
    surface=_anatomical_surface(lib,arm,role)
    if role!='scout':_corslet_base(surface,arm,role,anchors,leather,geometry)
    _loincloth(arm,role,waist,leather,geometry,surface)
    _war_armor(arm,role,anchors,iron,bronze,leather,ochre,geometry,surface)
    # Crossed studded leather sits on the actual completed iron cuirass.
    fitted=surface.get('finished_corslet',surface)
    armor_verts=[];armor_faces=[]
    for part in surface.get('front_armor_objects',[]):
        offset=len(armor_verts);armor_verts.extend(v.co.copy() for v in part.data.vertices)
        armor_faces.extend(tuple(offset+i for i in p.vertices) for p in part.data.polygons)
    armor_tree=BVHTree.FromPolygons(armor_verts,armor_faces) if armor_verts else None
    def harness_point(x,z):
        point=fitted['front'](x,z,.065)
        if armor_tree:
            hit=armor_tree.ray_cast(Vector((x,-20,z)),Vector((0,1,0)),40)[0]
            if hit is not None:point.y=min(point.y,hit.y-.028)
        return point
    rigid_harness=_accepted_infantry(arm,role)
    lower_harness_z=chest.z-.015 if rigid_harness else waist.z+.15
    for side in [-1,1]:
        a=harness_point(side*.43,chest.z+.42);b=harness_point(-side*.30,lower_harness_z)
        points=[]
        for t in np.linspace(0,1,19):
            p=a.lerp(b,t);points.append(harness_point(p.x,p.z))
        obj=_harness('Crossed fitted hide war harness',points,arm,role,leather,geometry,
                     .105 if role=='line_infantry' else .070,rigid=rigid_harness)
        if not rigid_harness:_skin_binding(obj,fitted)
        for index,p in enumerate(points):
            if index%2:continue
            rivet=geometry['ellipsoid']('Fitted crossed harness copper stud',p+Vector((0,-.022,0)),(.010,)*3,arm,role,'chest',bronze)
            if not rigid_harness:_skin_binding(rivet,fitted)
    if role!='scout':
        # A closed raised copper bezel, dark inset and embossed center sit
        # over the measured crossing, rather than a floating wire outline.
        t=.43/(.43+.30);badge_z=(chest.z+.42)*(1-t)+lower_harness_z*t
        outer=[(0,.205),(.161,0),(0,-.205),(-.161,0)]
        inner=[(0,.132),(.095,0),(0,-.132),(-.095,0)]
        front=[harness_point(x,badge_z+z)+Vector((0,-.034,0)) for x,z in outer+inner]
        n=len(front);verts=front+[p+Vector((0,.027,0)) for p in front]
        faces=[(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)]
        faces+=[tuple(i+n for i in reversed(f)) for f in list(faces)]
        for offset in [0,4]:faces.extend((offset+i,offset+(i+1)%4,offset+(i+1)%4+n,offset+i+n) for i in range(4))
        _mesh('Orc dimensional copper diamond harness bezel',verts,faces,arm,role,'chest',bronze,geometry)
        field=front[4:]+[harness_point(0,badge_z)+Vector((0,-.050,0))]
        _mesh('Orc dark embossed diamond harness center',field,[(i,(i+1)%4,4) for i in range(4)],arm,role,'chest',iron,geometry)
    if role!='scout':
        sides=[1,-1]
        for side in sides:
            label='L' if side>0 else 'R';bone='shoulder_'+label
            center=Vector(anchors.get(bone,_bone(arm,bone).head_local))+Vector((side*.15,0,.04))
            if not (_accepted_infantry(arm,role)):
                _limb_wrap('Orc fitted short shoulder hide cuff',arm,role,_bone(arm,'arm_'+label),surface,leather,geometry,.075,.22,.025)
            _pauldron(arm,role,center,bone,side,iron,fur,geometry,role in ['elite','heavy_cavalry'] or side<0)
    else:
        bone='shoulder_L';center=Vector(anchors.get(bone,_bone(arm,bone).head_local))
        geometry['ellipsoid']('Light scout fur shoulder pelt',center+Vector((.13,.06,0)),(.37,.32,.17),arm,role,bone,fur)
    if role=='scout':
        geometry['cube']('Scout hide map pouch',waist+Vector((.50,.05,-.12)),(.26,.16,.32),arm,role,'hip',leather,.04)
    elif role=='line_infantry':
        from orc_portrait_weapons import apply_axe,apply_shield
        apply_axe(lib,arm,role,iron,bronze,wood,leather,geometry)
        apply_shield(lib,arm,role,iron,bronze,wood,leather,geometry)
    elif role=='elite':
        if _accepted_infantry(arm,role):
            from orc_portrait_weapons import apply_shield
            _portrait_polearm(lib,arm,role,iron,bronze,wood,leather,ochre,geometry,halberd=True)
            parts=apply_shield(lib,arm,role,iron,bronze,wood,leather,geometry,elite=True)
            for obj in parts:
                obj['peris_portrait_weapon']='Tusk Guard shield'
                obj['peris_portrait_reference']='public/art/battle/roster/orc.png: row2 column1 Tusk Guard'
            _guard_crown(lib,arm,role,iron,bronze,geometry)
            _guard_mantle(arm,role,anchors,fur,ochre,geometry,surface)
        else:
            _axe(lib,arm,role,iron,wood,leather,geometry,role=='elite')
            _shield(lib,arm,role,wood,iron,geometry,role=='elite')
    elif role in ['spear_guard','light_cavalry','heavy_cavalry']:
        if role=='spear_guard' and _accepted_infantry(arm,role):
            from orc_portrait_weapons import apply_shield
            _portrait_polearm(lib,arm,role,iron,bronze,wood,leather,ochre,geometry)
            parts=apply_shield(lib,arm,role,iron,bronze,wood,leather,geometry)
            for obj in parts:
                obj['peris_portrait_weapon']='Pike Brute shield'
                obj['peris_portrait_reference']='public/art/battle/roster/orc.png: row1 column2 Pike Brute'
        else:
            _spear(lib,arm,role,iron,wood,geometry,role=='heavy_cavalry')
            _shield(lib,arm,role,wood,iron,geometry,role=='heavy_cavalry')
    elif role=='archer':
        _archer_identity(lib,arm,role,wood,leather,bronze,ochre,geometry)
    if role in ['elite','heavy_cavalry']:
        neck=Vector(anchors['neck']);head=Vector(anchors['head'])
        if not (role=='elite' and _accepted_infantry(arm,role)):
            geometry['curved']('Heavy iron brow guard',[head+Vector((-.28,-.27,.13)),head+Vector((0,-.32,.19)),head+Vector((.28,-.27,.13))],.045,arm,role,lib.socket(arm,'head').name,iron)
        for i in range(5):
            p=neck+Vector(((i-2)*.13,-.35,-.07))
            geometry['cone']('War trophy fang necklace',p,p+Vector((0,-.04,-.15)),.035,.002,arm,role,'chest',mats['ivory'])
    head=Vector(anchors['head']);socket=lib.socket(arm,'head').name
    scalp_z=arm.get('peris_orc_scalp_z',head.z+.275)
    scalp_offset=scalp_z-head.z
    hair=_swept_hair_material()
    import json
    clump=json.loads(arm.get('peris_adapted_scalp_clump','null'))
    if clump:
        cols=clump['cols'];rows=clump['rows'];verts=[Vector(p) for p in clump['vertices']]
        faces=[(r*cols+i,r*cols+i+1,(r+1)*cols+i+1,(r+1)*cols+i) for r in range(rows-1) for i in range(cols-1)]
        n=len(verts);verts+=[p-Vector((0,0,.003)) for p in verts]
        faces+=[tuple(i+n for i in reversed(face)) for face in list(faces)]
        edge=list(range(cols))+[r*cols+cols-1 for r in range(1,rows)]+list(range((rows-1)*cols+cols-2,(rows-1)*cols-1,-1))+[r*cols for r in range(rows-2,0,-1)]
        faces.extend((a,b,b+n,a+n) for a,b in zip(edge,edge[1:]+edge[:1]))
        obj=_mesh('Orc solid tapered swept scalp hair clump with fine streaks',verts,faces,arm,role,socket,hair,geometry)
        _loft_uv(obj,cols,rows,False)
        for p in obj.data.polygons:p.use_smooth=True
    # The pictures show a compact tied black topknot, not a bald green human.
    knot=Vector(arm.get('peris_adapted_hair_knot',head+Vector((0,.105,scalp_offset+.010))))
    # Tied brush tail: an irregular closed clump swept rearward, with a
    # tapered end, instead of an oval bun decorated with cylindrical tubes.
    rows=11;cols=20;verts=[]
    for row in range(rows):
        t=row/(rows-1);radius=.072*(1-.78*t**1.7)+.030*math.sin(math.pi*t)
        center=knot+Vector((.018*math.sin(math.pi*t),-.012+.190*t,.070*math.sin(math.pi*t)-.025*t))
        for col in range(cols):
            angle=col/cols*math.tau;r=radius*(1+.12*math.sin(angle*5+t*5))
            verts.append(center+Vector((math.cos(angle)*r,0,math.sin(angle)*r*.65)))
    faces=[tuple(range(cols-1,-1,-1)),tuple(range((rows-1)*cols,rows*cols))]
    faces.extend((r*cols+i,r*cols+(i+1)%cols,(r+1)*cols+(i+1)%cols,(r+1)*cols+i) for r in range(rows-1) for i in range(cols))
    tail=_mesh('Orc tied swept black brush tail with tapered clumps',verts,faces,arm,role,socket,hair,geometry)
    _loft_uv(tail,cols,rows)
    for polygon in tail.data.polygons:polygon.use_smooth=True
    geometry['cone']('Orc topknot leather tie',knot+Vector((-.063,.022,-.013)),knot+Vector((.063,.022,-.013)),.013,.013,arm,role,socket,leather)
    if role!='scout':_covered_skin(lib,arm,role,anchors,surface)
    if _accepted_infantry(arm,role):
        _connected_pilot_garment(lib,arm,role,anchors,leather)
    arm['peris_orc_equipment']='Original rough iron, hide, fur and timber; no human uniform'
    print('ORC_TRIBAL_EQUIPMENT_READY',role,flush=True)
