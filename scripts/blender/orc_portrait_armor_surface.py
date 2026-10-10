"""Original Peris metal finishes on unchanged, unpacked portrait equipment.

Direct color/roughness/metal images are supported by the existing atlas sampler.
Existing normal pixels and strength, geometry, UVs, credits and clips stay intact.
"""
import json, math
import bpy
import numpy as np

_IRON='Orc rusted hammered iron'
_COPPER='Orc aged bronze trim'


def _pixels(image):
    data=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(data)
    return data.reshape((image.size[1],image.size[0],4))


def _source_image(material):
    p=material.node_tree.nodes.get('Principled BSDF')
    if not p or not p.inputs['Base Color'].links:raise ValueError('Authored source color map required')
    node=p.inputs['Base Color'].links[0].from_node
    if node.type!='TEX_IMAGE' or not node.image:raise ValueError('Direct source color image required')
    return node.image


def _image_link(material,socket_name,name,values,color=False):
    size=values.shape[:2];pixels=np.ones((*size,4),dtype=np.float32)
    pixels[:,:,:3]=values if values.ndim==3 else values[:,:,None]
    image=bpy.data.images.new(name,width=size[1],height=size[0],alpha=False)
    image.colorspace_settings.name='sRGB' if color else 'Non-Color'
    image.pixels.foreach_set(pixels.ravel());image.pack()
    p=material.node_tree.nodes.get('Principled BSDF');socket=p.inputs[socket_name]
    for link in list(socket.links):material.node_tree.links.remove(link)
    tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    material.node_tree.links.new(tex.outputs['Color'],socket)
    return image.name


def _finish(old,kind,edge=False):
    material=old.copy();material.name='Peris portrait '+kind+(' exposed bevel finish' if edge else ' worn field finish')
    pixels=_pixels(_source_image(old));luma=pixels[:,:,:3]@np.asarray((.2126,.7152,.0722))
    lo,hi=np.quantile(luma,[.04,.96]);t=np.clip((luma-lo)/max(1e-6,hi-lo),0,1)
    yy,xx=np.mgrid[:t.shape[0],:t.shape[1]];u=xx/t.shape[1];v=yy/t.shape[0]
    # No world-axis, camera or light terms: small original material variation.
    grain=.5+.19*np.sin(u*127+v*39)*np.sin(v*151-u*27)+.11*np.sin(u*419-v*331)
    scratch=np.exp(-(np.sin(u*263+np.sin(v*17))/.075)**2)*.045
    if kind=='charcoal iron':
        dark=np.asarray((.032,.035,.039));bright=np.asarray((.075,.081,.088))
        color=dark+(t[:,:,None]**.82)*(bright-dark)
        recovered=pixels[:,:,:3]/np.asarray((.18,.13,.09))
        rust=np.clip((recovered[:,:,0]-recovered[:,:,1]*1.12)*3,0,.22)
        color=color*(1-rust[:,:,None])+np.asarray((.084,.043,.020))*rust[:,:,None]
        rough=.64+.17*(1-t)+.040*(grain-.5)-scratch
        metal=.86-.27*rust
    else:
        dark=np.asarray((.170,.059,.018)) if not edge else np.asarray((.300,.115,.034))
        bright=np.asarray((.340,.142,.046)) if not edge else np.asarray((.490,.230,.082))
        color=dark+(t[:,:,None]**.80)*(bright-dark)
        # Low-amplitude original oxide freckles, not broad painted shadow.
        patina=np.clip((.32-t)*.10,0,.030)
        color=color*(1-patina[:,:,None])+np.asarray((.039,.050,.034))*patina[:,:,None]
        rough=(.47 if not edge else .34)+(.17 if not edge else .11)*(1-t)+.035*(grain-.5)-scratch
        metal=np.full_like(t,.90 if not edge else .96)
    color*=1+(.035*(grain-.5))[:,:,None]
    created=[_image_link(material,'Base Color',material.name+' original albedo',np.clip(color,0,1),True),
             _image_link(material,'Roughness',material.name+' original roughness',np.clip(rough,.27,.90)),
             _image_link(material,'Metallic',material.name+' original metallic',np.clip(metal,0,1))]
    material['peris_original_armor_finish']=json.dumps({'author':'Peris: original portrait metal palette, roughness and wear variation','sourceColorImage':_source_image(old).name,'sourceLumaQuantiles4_96':[float(lo),float(hi)],'normalPixelsAndStrengthPreserved':True,'kind':kind,'exposedBevel':edge})
    material['runtime_approved']=False;material['peris_unit_finished']=False
    return material,created


def _bevel_faces(obj,copper_slots):
    """Small convex border faces on semantic trim, never a light-facing mask."""
    if not any(word in obj.name.lower() for word in ['rim','trim','web','band','collar','chevron','diamond']):return []
    polygons=list(obj.data.polygons)
    if len(polygons)>300:return []
    areas=[p.area for p in polygons if p.material_index in copper_slots]
    if not areas:return []
    threshold=float(np.quantile([p.area for p in polygons],.90))*.45
    adjacent={}
    for p in polygons:
        ids=list(p.vertices)
        for a,b in zip(ids,ids[1:]+ids[:1]):adjacent.setdefault(tuple(sorted((a,b))),[]).append(p)
    selected=[]
    for p in polygons:
        if p.material_index not in copper_slots or p.area>threshold or p.area<1e-10:continue
        ids=list(p.vertices);perimeter=sum((obj.data.vertices[a].co-obj.data.vertices[b].co).length for a,b in zip(ids,ids[1:]+ids[:1]))
        if perimeter*perimeter/(4*math.pi*p.area)<2.4:continue
        convex=False
        for a,b in zip(ids,ids[1:]+ids[:1]):
            neighbors=adjacent[tuple(sorted((a,b)))]
            if len(neighbors)!=2:continue
            q=neighbors[0] if neighbors[1]==p else neighbors[1]
            if p.normal.dot(q.normal)>.94:continue
            # Both outward face planes see the opposite face inside their solid.
            if p.normal.dot(q.center-p.center)<-1e-6 and q.normal.dot(p.center-q.center)<-1e-6:
                convex=True;break
        if convex:selected.append(p.index)
    return selected


def apply_portrait_armor_surface(arm,role='line_infantry'):
    """Apply once after equipment, before atlas; only two original metal fields."""
    if role not in {'line_infantry','spear_guard','elite','archer'}:raise ValueError('Unsupported Orc portrait infantry role')
    if role!='line_infantry' and not arm.get('peris_licensed_head_credit'):
        raise ValueError('Additional Orc roles require explicit licensed-head component provenance')
    if arm.get('peris_portrait_armor_surface'):raise ValueError('Armor finish already applied')
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('peris_role')==role
             and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]
    if any(uv.name=='PerisAtlas' for o in objects for uv in o.data.uv_layers):raise ValueError('Apply before atlas packing')
    used=set(m for o in objects for m in o.data.materials if m)
    iron=next((m for m in used if m.name==_IRON),None);copper=next((m for m in used if m.name==_COPPER),None)
    if iron is None or copper is None:raise ValueError('Expected original portrait iron and copper materials')
    if len(used)+1>16:raise ValueError('Preserve 4x4 atlas detail; this finish requires one spare material tile')
    iron_new,images=_finish(iron,'charcoal iron');copper_new,new_images=_finish(copper,'copper');images+=new_images
    copper_edge,new_images=_finish(copper,'copper',True);images+=new_images
    assignments=[]
    for obj in objects:
        copper_slots={i for i,m in enumerate(obj.data.materials) if m==copper}
        bevels=_bevel_faces(obj,copper_slots)
        for i,m in enumerate(list(obj.data.materials)):
            if m==iron:obj.data.materials[i]=iron_new
            elif m==copper:obj.data.materials[i]=copper_new
        if bevels:
            index=len(obj.data.materials);obj.data.materials.append(copper_edge)
            for face in bevels:obj.data.polygons[face].material_index=index
            assignments.append({'mesh':obj.name,'faceIndices':bevels})
    count=len(set(m for o in objects for m in o.data.materials if m))
    record={'author':'Peris: original portrait metal finish and geometric edge wear assignment','reference':'public/art/battle/roster/orc.png upper-left Axe Warrior','createdImages':images,'paletteVersion':1,'usedMaterialsBefore':len(used),'usedMaterialsAfter':count,'exposedCopperBevelFaces':assignments,'exposedCopperBevelFaceCount':sum(len(a['faceIndices']) for a in assignments),'operations':['Replace iron/copper color and roughness with explicit worn material palettes retaining source small luminance variation','Metallic image describes predominantly metal with a small retained oxide fraction','Brighter/lower-roughness copper on small convex physical trim borders only; no light-facing mask'],'sourceTangentNormalPixelsAndStrengthPreserved':True,'geometryChanged':False,'uvChanged':False,'animationChanged':False,'runtimeApproved':False,'finishedUnitApproved':False}
    record['role']=role
    if role!='line_infantry':
        record['sharedOrcReference']=record['reference']
        record['roleSpecificPortraitApproved']=False
    arm['peris_portrait_armor_surface']=json.dumps(record)
    return record
