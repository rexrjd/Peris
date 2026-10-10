"""Original portrait surface study on an unpacked Orc before atlas composition.

The geometry, UVs, source dense normal maps, ivory and component credits stay
intact. New copied skin/eye color images use explicit paint palettes; this is not
a blanket dark multiplier. Call only after head and hands, before atlas packing.
"""
import hashlib
import json
import pathlib
import bpy
import numpy as np
from mathutils import Matrix, Vector

_BASE=np.asarray((.212,.202,.062),dtype=float)
_BODY_SHADOW=np.asarray((.128,.124,.038),dtype=float)
_BODY_LIGHT=np.asarray((.265,.252,.080),dtype=float)
_HAND_BASE=(.186,.180,.055)


def _copy_material(obj,index,cache):
    old=obj.data.materials[index]
    if old not in cache:
        mat=old.copy();mat.name=old.name+' Peris portrait surface study'
        mat['peris_original_surface_paint']=True
        mat['runtime_approved']=False;mat['peris_unit_finished']=False
        cache[old]=mat
    obj.data.materials[index]=cache[old]
    return cache[old]


def _new_color(material,name,pixels):
    image=bpy.data.images.new(name,width=pixels.shape[1],height=pixels.shape[0],alpha=False)
    image.pixels.foreach_set(np.asarray(pixels,dtype=np.float32).ravel());image.pack()
    p=material.node_tree.nodes.get('Principled BSDF')
    if not p:raise ValueError('Expected Principled PBR material')
    for link in list(p.inputs['Base Color'].links):material.node_tree.links.remove(link)
    tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    material.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    p.inputs['Metallic'].default_value=0
    return image


def _face_image(obj,inverse_fit,size=1024):
    pixels=np.ones((size,size,4),dtype=np.float32);pixels[:,:,:3]=_BASE
    painted=np.zeros((size,size),dtype=bool)
    uv=obj.data.uv_layers.active
    if uv is None:raise ValueError('Adapted head source UV required')
    obj.data.calc_loop_triangles()
    points=np.asarray([list(inverse_fit@v.co) for v in obj.data.vertices])
    for triangle in obj.data.loop_triangles:
        coords=np.asarray([uv.data[i].uv[:] for i in triangle.loops],dtype=float)*(size-1)
        low=np.maximum(0,np.floor(coords.min(axis=0)).astype(int));high=np.minimum(size-1,np.ceil(coords.max(axis=0)).astype(int))
        if np.any(high<low):continue
        yy,xx=np.mgrid[low[1]:high[1]+1,low[0]:high[0]+1]
        delta=np.stack((xx-coords[0,0],yy-coords[0,1]),axis=-1)
        a,b=coords[1]-coords[0],coords[2]-coords[0];det=a[0]*b[1]-a[1]*b[0]
        if abs(det)<1e-9:continue
        w1=(delta[:,:,0]*b[1]-delta[:,:,1]*b[0])/det
        w2=(a[0]*delta[:,:,1]-a[1]*delta[:,:,0])/det;w0=1-w1-w2
        mask=(w0>=-.003)&(w1>=-.003)&(w2>=-.003)
        p=w0[:,:,None]*points[triangle.vertices[0]]+w1[:,:,None]*points[triangle.vertices[1]]+w2[:,:,None]*points[triangle.vertices[2]]
        x,y,z=[p[:,:,i] for i in range(3)];front=np.clip((-y-.012)/.026,0,1)
        color=np.empty((*x.shape,3));color[:]=_BASE
        center=front*np.exp(-((z-.226)/.058)**4)
        color+=center[:,:,None]*np.asarray((.033,.020,.005))
        orbit=front*np.exp(-((np.abs(x)-.019)/.010)**4-((z-.238)/.0075)**4)
        temple=front*np.exp(-((np.abs(x)-.044)/.012)**4-((z-.241)/.028)**4)
        cheek_fold=front*np.exp(-((np.abs(x)-.026)/.009)**4-((z-.216)/.013)**4)
        upper_lip=front*np.exp(-(x/.027)**8-((z-.211)/.0038)**4)
        lower_lip=front*np.exp(-(x/.031)**8-((z-.202)/.0048)**4)
        color*=(1-.28*orbit-.15*temple-.13*cheek_fold-.22*upper_lip-.18*lower_lip)[:,:,None]
        cheek_plane=front*np.exp(-((np.abs(x)-.037)/.012)**2-((z-.226)/.012)**2)
        brow_plane=front*np.exp(-((np.abs(x)-.018)/.018)**4-((z-.247)/.007)**4)
        color+=cheek_plane[:,:,None]*np.asarray((.020,.009,.001))+brow_plane[:,:,None]*np.asarray((.013,.010,.003))
        # Original mild skin mottling, anchored in source coordinates so UV seams
        # and animation do not change its location. Shape normals stay untouched.
        grain=.988+.014*np.sin(x*7600)*np.sin(z*7900)+.012*np.sin(x*330+y*290)*np.sin(z*270)
        color*=grain[:,:,None]
        ear=front*np.exp(-((np.abs(x)-.062)/.018)**2-((z-.245)/.025)**2)
        color+=ear[:,:,None]*np.asarray((.013,.002,-.001))
        scalp=np.clip((z-.267)/.012,0,1)*np.clip((.017-np.abs(x))/.005,0,1)*np.clip((y+.025)/.015,0,1)
        color=color*(1-scalp[:,:,None])+np.asarray((.025,.023,.016))*scalp[:,:,None]
        block=pixels[low[1]:high[1]+1,low[0]:high[0]+1]
        block[:,:,:3][mask]=np.clip(color[mask],0,1)
        painted[low[1]:high[1]+1,low[0]:high[0]+1]|=mask
    for _ in range(5):
        old=painted.copy()
        for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:
            shifted=np.roll(old,(dy,dx),(0,1));take=shifted&~painted
            pixels[take]=np.roll(pixels,(dy,dx),(0,1))[take];painted|=take
    return pixels


def _eyes_image(size=512):
    yy,xx=np.mgrid[:size,:size];x=(xx+.5)/size*.052-.026;z=(yy+.5)/size*.017+.230
    pixels=np.ones((size,size,4),dtype=np.float32);pixels[:,:,:3]=(.275,.255,.150)
    for cx,cz in [(-.016667,.238083),(.015745,.238083)]:
        dx,dz=x-cx,z-cz;radius=np.sqrt(dx*dx+dz*dz);angle=np.arctan2(dz,dx)
        iris=radius<.00185;pupil=radius<.00065
        radial=.90+.13*np.sin(angle*37+radius*9000)+.07*np.cos(angle*61-radius*11000)
        pixels[iris,:3]=np.stack((.430*radial,.235*radial,.028*radial),axis=2)[iris]
        pixels[(radius>.00165)&(radius<.00187),:3]=(.058,.038,.009)
        pixels[pupil,:3]=(.002,.003,.001)
    return pixels


def apply_portrait_surface(arm,role='line_infantry'):
    """Copy color surfaces before packing, without changing source UV or shape."""
    if role not in {'line_infantry','spear_guard','elite','archer'}:raise ValueError('Unsupported Orc portrait infantry role')
    if role!='line_infantry' and not arm.get('peris_licensed_head_credit'):
        raise ValueError('Additional Orc roles require explicit licensed-head component provenance')
    if arm.get('peris_portrait_surface_study'):raise ValueError('Surface pass already applied')
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('peris_role')==role
             and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]
    head=next((o for o in objects if 'source-head-skin' in o.name),None)
    eyes=next((o for o in objects if 'source-head-eyes' in o.name),None)
    if head is None or eyes is None:raise ValueError('Apply to unpacked credited adapted head/eyes before atlas')
    if any('PerisAtlas'==uv.name for uv in head.data.uv_layers):raise ValueError('Already packed head; preserve original source UV and apply before atlas')
    center=Vector(arm['peris_orc_head_center']);source_center=Vector((0,-.012,.215))
    inverse_fit=(Matrix.Translation(center)@Matrix.Diagonal((5.5,5.0,5.7,1))@Matrix.Translation(-source_center)).inverted()
    cache={};created=[]
    mat=_copy_material(head,0,cache)
    created.append(_new_color(mat,'Peris original warm portrait olive head UV paint',_face_image(head,inverse_fit)).name)
    mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.74
    mat=_copy_material(eyes,0,cache)
    created.append(_new_color(mat,'Peris original amber iris on preserved source eye UV',_eyes_image()).name)
    mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.34
    handled=set(cache.values());body_stats=[]
    for obj in objects:
        if obj in [head,eyes] or any(term in obj.name for term in ['source-head-teeth','source-head-tusks']):continue
        for index,old in enumerate(list(obj.data.materials)):
            if not old or 'skin' not in old.name.lower():continue
            mat=_copy_material(obj,index,cache)
            if mat in handled:continue
            handled.add(mat)
            p=mat.node_tree.nodes.get('Principled BSDF')
            tex=p.inputs['Base Color'].links[0].from_node if p.inputs['Base Color'].links else None
            if tex and tex.type=='TEX_IMAGE' and tex.image:
                image=tex.image;pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels)
                pixels=pixels.reshape((image.size[1],image.size[0],4));luma=pixels[:,:,:3]@np.asarray((.2126,.7152,.0722))
                low,high=np.quantile(luma,[.05,.95]);t=np.clip((luma-low)/max(.02,high-low),0,1)
                # Retain anatomy from source luminance, with a deliberate new
                # shadow/highlight ramp that matches exposed arms and face.
                pixels[:,:,:3]=_BODY_SHADOW+(t[:,:,None]**.80)*(_BODY_LIGHT-_BODY_SHADOW)
                created.append(_new_color(mat,'Peris original warm body paint preserving source anatomy luma',pixels).name)
                body_stats.append({'sourceMaterial':old.name,'lumaQuantiles5_95':[float(low),float(high)],'newPalette':[_BODY_SHADOW.tolist(),_BODY_LIGHT.tolist()]})
            else:
                for link in list(p.inputs['Base Color'].links):mat.node_tree.links.remove(link)
                p.inputs['Base Color'].default_value=(*_HAND_BASE,1)
            p.inputs['Roughness'].default_value=.82;p.inputs['Metallic'].default_value=0
    record={'author':'Peris: original portrait palette and anatomical UV color paint','reference':'public/art/battle/roster/orc.png upper-left Axe Warrior',
            'operations':['Explicit warmer olive facial palette with source-coordinate brow/cheek/lip paint','Original amber iris paint on existing eye UV','Body texture luminance retained into a coherent olive shadow/highlight palette','Coherent hand/nape color, preserved source dense normals and ivory'],
            'createdImages':created,'bodyLumaRemap':body_stats,'paletteVersion':3,'faceBaseLinearRgb':_BASE.tolist(),'handBaseLinearRgb':list(_HAND_BASE),'geometryChanged':False,'uvChanged':False,'denseNormalMapsChanged':False,
            'runtimeApproved':False,'finishedUnitApproved':False}
    record['role']=role
    if role!='line_infantry':
        record['sharedOrcReference']=record['reference']
        record['roleSpecificPortraitApproved']=False
    arm['peris_portrait_surface_study']=json.dumps(record)
    return record
