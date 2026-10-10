"""Pack source PBR images into one shared atlas and join each anatomy rig.

UV islands keep their authored shape. A two-pixel gutter avoids bleeding.
"""
import bpy, math, pathlib, json
import numpy as np

def _principled(tree):
    return next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')

def _image(node_tree,input_name):
    p=_principled(node_tree);socket=p.inputs[input_name]
    if not socket.is_linked:return None
    node=socket.links[0].from_node
    if node.type=='NORMAL_MAP':
        node=node.inputs['Color'].links[0].from_node if node.inputs['Color'].is_linked else None
    return node.image if node and node.type=='TEX_IMAGE' else None

def _scalar(socket,size):
    """Sample a scalar map exactly as its supported material graph defines it."""
    if not socket.is_linked:return np.full((size,size),float(socket.default_value),dtype=np.float32)
    link=socket.links[0];node=link.from_node
    if node.type=='TEX_IMAGE':
        pixels=_pixels(node.image,size)
        if pixels is None:raise ValueError('Scalar material image is missing')
        if link.from_socket.name=='Alpha':return pixels[:,:,3]
        return pixels[:,:,:3] @ np.asarray((.2126,.7152,.0722),dtype=np.float32)
    if node.type=='MAP_RANGE' and node.data_type=='FLOAT' and node.interpolation_type=='LINEAR':
        value=_scalar(node.inputs['Value'],size)
        lo=float(node.inputs['From Min'].default_value);hi=float(node.inputs['From Max'].default_value)
        if abs(hi-lo)<1e-8:raise ValueError('Material map range has zero width')
        t=(value-lo)/(hi-lo)
        if node.clamp:t=np.clip(t,0,1)
        return float(node.inputs['To Min'].default_value)+t*(float(node.inputs['To Max'].default_value)-float(node.inputs['To Min'].default_value))
    if node.type=='MATH' and node.operation=='MULTIPLY':
        return _scalar(node.inputs[0],size)*_scalar(node.inputs[1],size)
    raise ValueError('Unsupported linked scalar material node: '+node.type)

def _normal_pixels(material,size):
    socket=_principled(material.node_tree).inputs['Normal']
    if not socket.is_linked:return None
    node=socket.links[0].from_node
    if node.type!='NORMAL_MAP' or node.space!='TANGENT':
        raise ValueError('Atlas requires a tangent-space normal map')
    pixels=_pixels(_image(material.node_tree,'Normal'),size)
    if pixels is None:return None
    strength=_scalar(node.inputs['Strength'],size)
    vector=pixels[:,:,:3]*2-1
    vector[:,:,:2]*=strength[:,:,None]
    length=np.linalg.norm(vector,axis=2,keepdims=True)
    vector=vector/np.maximum(length,1e-8)
    pixels[:,:,:3]=vector*.5+.5
    return pixels

def _pixels(image,size):
    if image is None:return None
    width,height=image.size
    data=np.empty(width*height*4,dtype=np.float32);image.pixels.foreach_get(data);data=data.reshape((height,width,4))
    # Bilinear resampling keeps source painted details without another decoder.
    xx=np.linspace(0,width-1,size);yy=np.linspace(0,height-1,size)
    x0=np.floor(xx).astype(int);x1=np.minimum(x0+1,width-1);tx=(xx-x0)[None,:,None]
    y0=np.floor(yy).astype(int);y1=np.minimum(y0+1,height-1);ty=(yy-y0)[:,None,None]
    top=data[y0[:,None],x0[None,:]]*(1-tx)+data[y0[:,None],x1[None,:]]*tx
    bottom=data[y1[:,None],x0[None,:]]*(1-tx)+data[y1[:,None],x1[None,:]]*tx
    return top*(1-ty)+bottom*ty

def pack(lib,faction,output,size=4096):
    meshes=[o for o in lib.collection.objects if o.type=='MESH']
    source=[]
    for o in meshes:
        for m in o.data.materials:
            if m and m not in source:source.append(m)
    grid=math.ceil(math.sqrt(len(source)));tile=size//grid;gutter=3;inner=tile-2*gutter
    locations={m:(i%grid,i//grid) for i,m in enumerate(source)}
    output.mkdir(parents=True,exist_ok=True)
    images={}
    # The default remains the original three maps. A material that explicitly
    # varies dielectric reflection (e.g. black hair) adds an alpha scalar map.
    # Blender level .5 corresponds to glTF specularFactor 1, hence the factor2
    # in the image and compensating .5 in the supported shared shader graph.
    needs_specular=any(_principled(m.node_tree).inputs['Specular IOR Level'].is_linked or
                       abs(_principled(m.node_tree).inputs['Specular IOR Level'].default_value-.5)>1e-6 for m in source)
    channels=['color','normal','orm']+(['specular'] if needs_specular else [])
    for channel in channels:
        atlas=np.ones((size,size,4),dtype=np.float32)
        if channel=='normal':atlas[:,:,:3]=(.5,.5,1)
        elif channel=='orm':atlas[:,:,:3]=(1,.7,0)
        for m in source:
            col,row=locations[m];p=_principled(m.node_tree)
            input_name='Base Color' if channel=='color' else 'Normal'
            image=_image(m.node_tree,input_name) if channel not in ['orm','specular'] else None
            pixels=_normal_pixels(m,inner) if channel=='normal' else _pixels(image,inner)
            if pixels is None:
                pixels=np.ones((inner,inner,4),dtype=np.float32)
                if channel=='color':pixels[:,:,:]=tuple(p.inputs['Base Color'].default_value)
                elif channel=='normal':pixels[:,:,:3]=(.5,.5,1)
                else:pixels[:,:,:3]=(1,p.inputs['Roughness'].default_value,p.inputs['Metallic'].default_value)
            if channel=='orm':
                pixels[:,:,1]=np.clip(_scalar(p.inputs['Roughness'],inner),0,1)
                pixels[:,:,2]=np.clip(_scalar(p.inputs['Metallic'],inner),0,1)
            elif channel=='specular':
                level=_scalar(p.inputs['Specular IOR Level'],inner)
                if np.any(level>.5+1e-6) or np.any(level<0):
                    raise ValueError('Specular atlas supports authored IOR levels from 0 to .5')
                pixels[:,:,:3]=1;pixels[:,:,3]=np.clip(level*2,0,1)
            if channel=='color' and not p.inputs['Alpha'].is_linked:pixels[:,:,3]=1
            padded=np.pad(pixels,((gutter,gutter),(gutter,gutter),(0,0)),mode='edge')
            atlas[row*tile:(row+1)*tile,col*tile:(col+1)*tile]=padded
        image=bpy.data.images.new('Peris '+faction+' '+channel+' atlas',width=size,height=size,alpha=True,float_buffer=False)
        image.colorspace_settings.name='sRGB' if channel=='color' else 'Non-Color'
        image.pixels.foreach_set(atlas.ravel());image.filepath_raw=str(output/(faction+'-'+channel+'.png'));image.file_format='PNG';image.save();image.pack();images[channel]=image
        del atlas
    material=bpy.data.materials.new('Peris '+faction+' shared PBR atlas');material.use_nodes=True
    n=material.node_tree.nodes;l=material.node_tree.links;p=_principled(material.node_tree)
    for channel in images:
        t=n.new('ShaderNodeTexImage');t.image=images[channel];t.extension='EXTEND'
        if channel=='color':
            l.new(t.outputs['Color'],p.inputs['Base Color'])
            # Blender's exporter recognizes this node as standard glTF MASK.
            # Hair/crest cards retain cutouts without transparent crowd sorting.
            clip=n.new('ShaderNodeMath');clip.operation='GREATER_THAN';clip.inputs[1].default_value=.5
            l.new(t.outputs['Alpha'],clip.inputs[0]);l.new(clip.outputs[0],p.inputs['Alpha'])
        elif channel=='normal':
            normal=n.new('ShaderNodeNormalMap');l.new(t.outputs['Color'],normal.inputs['Color']);l.new(normal.outputs['Normal'],p.inputs['Normal'])
        elif channel=='orm':
            split=n.new('ShaderNodeSeparateColor');l.new(t.outputs['Color'],split.inputs['Color'])
            l.new(split.outputs['Green'],p.inputs['Roughness']);l.new(split.outputs['Blue'],p.inputs['Metallic'])
        else:
            factor=n.new('ShaderNodeMath');factor.operation='MULTIPLY';factor.inputs[1].default_value=.5
            l.new(t.outputs['Alpha'],factor.inputs[0]);l.new(factor.outputs[0],p.inputs['Specular IOR Level'])
            material['peris_specular_atlas']='Alpha holds glTF specularFactor=2*source Blender IOR level; native shader restores level with .5 multiplier'
    material.use_backface_culling=False
    for o in meshes:
        arm=next((modifier.object for modifier in o.modifiers if modifier.type=='ARMATURE'),None)
        if arm:
            deform={group.index:group for group in o.vertex_groups if group.name in arm.data.bones}
            for vertex in o.data.vertices:
                weights=sorted(((group.group,group.weight) for group in vertex.groups if group.group in deform and group.weight>0),
                               key=lambda pair:pair[1],reverse=True)
                if not weights:continue
                keep=weights[:4];total=sum(weight for index,weight in keep)
                for index,weight in weights:
                    if index not in {item[0] for item in keep}:deform[index].remove([vertex.index])
                for index,weight in keep:deform[index].add([vertex.index],weight/total,'REPLACE')
            o['peris_max_deform_influences']=4
            o['peris_deform_weight_strategy']='Four normalized influences in native scene and GLB; identical export deformation weights'
        uv=o.data.uv_layers.active or o.data.uv_layers.new(name='UVMap')
        # Blender joins UV layers by name, not by their active-layer status.
        # Give every body/helmet/weapon the same sole layer before merging.
        for layer in list(o.data.uv_layers):
            if layer!=uv:o.data.uv_layers.remove(layer)
        uv.name='PerisAtlas';uv.active_render=True;o.data.uv_layers.active=uv
        for polygon in o.data.polygons:
            m=o.data.materials[polygon.material_index];col,row=locations[m]
            for index in polygon.loop_indices:
                coord=uv.data[index].uv.copy()
                # Most source skins stay within [0,1]. Wrapping tiled equipment
                # retains its pattern inside the atlas instead of crossing cells.
                coord.x=max(0,min(1,coord.x))
                coord.y=max(0,min(1,coord.y))
                uv.data[index].uv=((col*tile+gutter+coord.x*inner)/size,(row*tile+gutter+coord.y*inner)/size)
            polygon.material_index=0
        o.data.materials.clear();o.data.materials.append(material)
    # A horse and seated rider retain independent skeletons. All equipment for
    # each skeleton joins into one draw without sharing incompatible bones.
    sets={}
    for o in meshes:
        arm=next((m.object for m in o.modifiers if m.type=='ARMATURE'),None)
        # The default still joins each role into one draw per skeleton. An
        # explicitly credited component can retain its own mesh extras while
        # sharing the same atlas and body skeleton.
        sets.setdefault((o.get('peris_role'),arm,o.get('peris_atlas_partition','')),[]).append(o)
    for (role,arm,partition),parts in sets.items():
        component_credit=next((o.get('peris_component_credit') for o in parts if o.get('peris_component_credit')),None)
        component_source=next((o.get('source_url') for o in parts if o.get('source_url')),None)
        component_hash=next((o.get('source_file_sha256') for o in parts if o.get('source_file_sha256')),None)
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:o.select_set(True)
        bpy.context.view_layer.objects.active=parts[0]
        bpy.ops.object.join();obj=bpy.context.object
        obj.name=role+' '+(partition if partition else 'mounted rider' if arm and arm.parent else 'textured anatomy')
        obj['peris_role']=role;obj['asset_author']='Wildfire Games; original Peris race equipment'
        obj['asset_license']='CC-BY-SA-3.0';obj['peris_source_family']=lib.PROFILE['family']
        obj['peris_faction']=faction
        if arm and arm.get('peris_licensed_head_credit'):
            obj['runtime_approved']=False;obj['peris_unit_finished']=False
        if partition.startswith('licensed-'):
            credit=json.loads(component_credit or '{}')
            author=credit.get('author') or credit.get('creator')
            if not author or not component_source or not component_hash:
                raise ValueError('Licensed atlas partition requires its author, source URL, source hash and component credit: '+partition)
            obj['peris_atlas_partition']=partition;obj['asset_author']=author+'; Peris component adaptation (see embedded credit)'
            obj['asset_license']='CC-BY-4.0';obj['peris_component_credit']=component_credit
            obj['source_url']=component_source;obj['source_file_sha256']=component_hash
            obj['original_peris_equipment']=False;obj['runtime_approved']=False;obj['peris_unit_finished']=False
        if role in ['scout','light_cavalry','heavy_cavalry']:
            obj['peris_seated_bind_pose']=True
            obj['peris_seat_attachment']=arm.get('peris_seat_attachment',arm.parent_bone if arm.parent_type=='BONE' else 'prop_rider')
            for key in ['peris_seat_fit_error','peris_seat_hip_world','peris_seat_target_world','peris_seat_hip_clearance','peris_mount_species','peris_species_source_actor']:
                if key in arm:obj[key]=arm[key]
                elif arm.parent and key in arm.parent:obj[key]=arm.parent[key]
        lib.groups[role]=[o for o in lib.collection.objects if o.type=='MESH' and o.get('peris_role')==role]
    print('ROSTER_ATLAS_PACKED',faction,len(source),'source materials',len(sets),'draw meshes',flush=True)
