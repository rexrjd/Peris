"""Race skin over exposed source anatomy, preserving painted cloth/armor.

UV face masks are limited by deform weights and warm skin albedo. Skeletal
units remove those exposed flesh faces and replace limbs with articulated bone.
"""
import bpy, numpy as np

TERMS=('arm_','forearm_','hand_','finger_','fingertip_','thigh_','leg_','foot_')
def _exposed(mesh,vertex):
    return sum(g.weight for g in vertex.groups if any(t in mesh.vertex_groups[g.group].name.lower() for t in TERMS))>.55
def _warm(rgb):
    r,g,b=rgb[...,0],rgb[...,1],rgb[...,2]
    return (r>.32)&(g>.16)&(b>.08)&(r>g*1.12)&(g>b*1.08)&(r<g*2.1)
def _fill(mask,triangle):
    height,width=mask.shape
    p=triangle*np.asarray((width-1,height-1))
    lo=np.maximum(0,np.floor(p.min(axis=0)).astype(int));hi=np.minimum((width-1,height-1),np.ceil(p.max(axis=0)).astype(int))
    if np.any(hi<lo):return
    xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1),np.arange(lo[1],hi[1]+1));point=np.stack((xx,yy),axis=-1)
    a,b,c=p
    cross=lambda x,y:x[...,0]*y[...,1]-x[...,1]*y[...,0]
    area=cross(b-a,c-a)
    if abs(area)<1e-6:return
    u=cross(b-point,c-point)/area;v=cross(c-point,a-point)/area;w=1-u-v
    mask[lo[1]:hi[1]+1,lo[0]:hi[0]+1] |= (u>=-.01)&(v>=-.01)&(w>=-.01)
def apply(lib,arm,role,faction,profile,mats,geometry):
    if not profile.get('skin'):return
    sources=[o for o in lib.groups[role] if o.get('source_actor','').startswith('units/') and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]
    for mesh in sources:
        material=mesh.data.materials[0];bs=material.node_tree.nodes.get('Principled BSDF')
        if not bs.inputs['Base Color'].is_linked:continue
        tex=bs.inputs['Base Color'].links[0].from_node
        if tex.type!='TEX_IMAGE':continue
        image=tex.image;width,height=image.size
        pixels=np.empty(width*height*4,dtype=np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape((height,width,4))
        mask=np.zeros((height,width),dtype=bool);uv=mesh.data.uv_layers.active
        if uv is None:continue
        exposed=[]
        for polygon in mesh.data.polygons:
            if sum(_exposed(mesh,mesh.data.vertices[i]) for i in polygon.vertices)<len(polygon.vertices)*.5:continue
            coords=np.asarray([tuple(uv.data[i].uv) for i in polygon.loop_indices]);coords=np.clip(coords,0,1)
            for i in range(1,len(coords)-1):_fill(mask,coords[[0,i,i+1]])
            sample=np.clip((coords.mean(axis=0)*np.asarray((width-1,height-1))).astype(int),0,(width-1,height-1))
            if bool(_warm(pixels[sample[1],sample[0],:3])):exposed.append(polygon.index)
        mask&=_warm(pixels[:,:,:3])
        luma=pixels[:,:,:3].mean(axis=2)
        tint=np.asarray((.07,.075,.07) if faction=='pandaren' else profile['skin'])
        pixels[:,:,:3][mask]=np.clip(luma[mask,None]*tint[None,:]*1.7,0,1)
        new=image.copy();new.name='Peris '+faction+' exposed skin '+image.name;new.pixels.foreach_set(pixels.ravel());new.pack()
        own=material.copy();own.name='Peris '+faction+' anatomical skin '+material.name
        own.node_tree.nodes.get(tex.name).image=new;mesh.data.materials[0]=own
        if faction=='undead' and exposed:
            import bmesh
            bm=bmesh.new();bm.from_mesh(mesh.data);bm.faces.ensure_lookup_table()
            bmesh.ops.delete(bm,geom=[bm.faces[i] for i in exposed],context='FACES');bm.to_mesh(mesh.data);bm.free()
    if faction=='undead':
        for bone in arm.data.bones:
            name=bone.name.lower()
            if not any(t in name for t in ('arm_','forearm_','thigh_','leg_','foot_')) or name.startswith('prop'):continue
            radius=.065 if 'arm' in name or 'leg' in name else .09
            geometry['cone']('Exposed articulated '+bone.name,bone.head_local,bone.tail_local,radius,radius*.7,arm,role,bone.name,mats['ivory'])
            geometry['ellipsoid']('Bone joint '+bone.name,bone.head_local,(radius*1.35,)*3,arm,role,bone.name,mats['ivory'])
    print('RACE_ANATOMY_APPLIED',faction,role,flush=True)
