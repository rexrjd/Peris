"""Shared assembly helpers for textured licensed faction rosters.
Source rig rest transforms, UVs and attachment sockets are preserved.
"""
import bpy, pathlib, math, re, json, xml.etree.ElementTree as ET
from mathutils import Matrix, Vector
ROOT=pathlib.Path(__file__).resolve().parents[2]
ART=ROOT/'assets/references/units/0ad'
OUT=None
collection=None
images={}; materials={}; groups={}; rigs=[]; import_id=0
PROFILE={}
SOURCE_ACTORS={}
def init(output, profile):
    global OUT, PROFILE, collection, images, materials, groups, rigs, import_id, SOURCE_ACTORS
    OUT=output; PROFILE=profile
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collection=bpy.data.collections.new('PERIS_EXPORT'); bpy.context.scene.collection.children.link(collection)
    images={}; materials={}; groups={}; rigs=[]; import_id=0
    catalog=json.loads((ROOT/'assets/references/units/roster-sources-v3.json').read_text())
    SOURCE_ACTORS={a['actor']:a for actors in catalog['families'].values() for a in actors}
def appearance(path):
    root=ET.parse(ART/path).getroot();result={'textures':{},'props':[],'animations':{}}
    def merge(node):
        inherited=node.get('file')
        if inherited:merge(ET.parse(ART/'variants'/inherited).getroot())
        mesh=node.find('mesh')
        if mesh is not None:result['mesh']=mesh.text
        for texture in node.findall('textures/texture'):result['textures'][texture.get('name')]=texture.get('file')
        result['props'].extend((p.get('actor'),p.get('attachpoint')) for p in node.findall('props/prop') if p.get('actor'))
        for a in node.findall('animations/animation'):
            if a.get('name') in ['Idle','Walk','attack_melee','attack_ranged','Attack','walk','idle']:result['animations'].setdefault(a.get('name'),a.get('file'))
        for group in node.findall('group'):
            choices=group.findall('variant')
            chosen=next((v for v in choices if v.get('name') in PROFILE.get('preferred_variants', ['rome-muscled-cuirass'])),choices[0] if choices else None)
            if chosen is not None:merge(chosen)
    chosen=root
    if root.tag=='qualitylevels':
        chosen=root.find('inline')
        if chosen is None:
            choices=root.findall('actor');chosen=choices[-1] if choices else root
    merge(chosen)
    result['shader']=chosen.findtext('material','')
    # Combat clips often live in an independent state variant rather than the
    # first appearance choice. Read animations without activating its props.
    visited=set()
    def animation_states(node):
        inherited=node.get('file')
        if inherited and inherited not in visited and (ART/'variants'/inherited).exists():
            visited.add(inherited)
            animation_states(ET.parse(ART/'variants'/inherited).getroot())
        for a in node.findall('animations/animation'):
            if a.get('name') in ['Idle','Walk','attack_melee','attack_ranged','Attack','walk','idle']:
                result['animations'].setdefault(a.get('name'),a.get('file'))
        for child in node:
            if child.tag in ['group','variant','inline']:animation_states(child)
    animation_states(root)
    known=SOURCE_ACTORS.get(path.removeprefix('actors/'))
    if known:
        for state,file in known.get('animations',{}).items():
            key={'idle':'Idle','walk':'Walk'}.get(state,state)
            result['animations'][key]=file
    return result

def texture(file,color=True):
    key=(file,color)
    if key not in images:
        image_path=ROOT/'assets/source/battle/reference-textures/textures/skins'/pathlib.Path(file).with_suffix('.png') if file.lower().endswith('.dds') else ART/'textures/skins'/file
        if not image_path.exists(): raise FileNotFoundError(str(image_path))
        image=bpy.data.images.load(str(image_path),check_existing=False)
        image.colorspace_settings.name='sRGB' if color else 'Non-Color'
        # DDS cannot be embedded as a glTF texture. Convert the loaded pixels to
        # PNG in the new source folder, keeping original source bytes intact.
        if len(image.pixels)==0:raise ValueError('Texture did not decode: '+file)
        image.pack();images[key]=image
    return images[key]

def material(spec,path):
    key=(tuple(sorted(spec['textures'].items())),path)
    if key in materials:return materials[key]
    m=bpy.data.materials.new(pathlib.Path(path).stem);m.use_nodes=True
    nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value=.65
    base=spec['textures'].get('baseTex')
    if base:
        tex=nodes.new('ShaderNodeTexImage');tex.image=texture(base)
        if '/heads/' in path and PROFILE.get('skin'):
            import numpy as np
            source=tex.image;pixels=np.empty(len(source.pixels),dtype=np.float32);source.pixels.foreach_get(pixels)
            pixels=pixels.reshape((-1,4));luma=pixels[:,:3].mean(axis=1)
            tint=np.asarray(PROFILE['skin'])
            # Keep the original pores, facial planes and painted eye detail.
            pixels[:,:3]=np.clip(luma[:,None]*tint[None,:]*1.5,0,1)
            tinted=source.copy();tinted.name='Peris race skin '+source.name;tinted.pixels.foreach_set(pixels.ravel())
            tinted.pack();tex.image=tinted
        # RTS faction-color masks use base alpha, not transparency. Bake the
        # faction tint into the image so runtime remains standard glTF PBR.
        if ('player' in path or 'player' in spec.get('shader','') or any(t in base for t in ['cuirass','scale_centurion','blanket','parma','scutum','hoplite','thorax','tunic','peltast','champion','spear','archer'])):
            tinted=tex.image.copy();tinted.name='Peris crimson '+tex.image.name
            import numpy as np
            pixels=np.empty(len(tinted.pixels),dtype=np.float32);tinted.pixels.foreach_get(pixels)
            pixels=pixels.reshape((-1,4));red=np.asarray(PROFILE.get('cloth',(.38,.055,.04)))
            alpha=pixels[:,3:4].copy();pixels[:,:3]*=alpha+(1-alpha)*red[None,:];pixels[:,3]=1
            tinted.pixels.foreach_set(pixels.ravel())
            dest=OUT/'textures'/('crimson_'+pathlib.Path(base).stem+'.png');dest.parent.mkdir(parents=True,exist_ok=True)
            tinted.filepath_raw=str(dest);tinted.file_format='PNG';tinted.save();tinted.pack();tex.image=tinted
        links.new(tex.outputs['Color'],p.inputs['Base Color'])
        if 'hair_' in path or (spec.get('shader','').startswith('basic_trans') and PROFILE.get('skin')):
            links.new(tex.outputs['Alpha'],p.inputs['Alpha']);m.surface_render_method='DITHERED'
    normal=spec['textures'].get('normTex')
    if normal and normal!='default_norm.png':
        tex=nodes.new('ShaderNodeTexImage');tex.image=texture(normal,False)
        n=nodes.new('ShaderNodeNormalMap');links.new(tex.outputs['Color'],n.inputs['Color']);links.new(n.outputs['Normal'],p.inputs['Normal'])
    # Explicit material response; 0 A.D.'s legacy specular maps are not roughness.
    if any(t in path for t in ['helmet','boss','gladius']):
        p.inputs['Metallic'].default_value=.7;p.inputs['Roughness'].default_value=.36
    m.use_backface_culling=False
    materials[key]=m;return m

def dae(file):
    global import_id
    import_id+=1
    cache=ROOT/'assets/source/battle/reference-import-cache-v4'/(file.replace('/','_')+'.blend')
    with bpy.data.libraries.load(str(cache),link=False) as (source,data):data.objects=source.objects
    result=[o for o in data.objects if o]
    # COLLADA's importer uses global node IDs to name bones; duplicate imports
    # acquire numeric suffixes even though the armatures are separate.
    for o in result:
        o['source_node_name']=re.sub(r'\.\d{3}$','',o.name)
        o.name=f'import{import_id}_{o.name}'
        if o.type in ['ARMATURE','MESH']:o.data.name=f'import{import_id}_{o.data.name}'
        if o.type=='ARMATURE':
            for b in o.data.bones:b.name=re.sub(r'\.\d{3}$','',b.name)
        if o.type=='MESH':
            for g in o.vertex_groups:g.name=re.sub(r'\.\d{3}$','',g.name)
    for o in result:
        for c in list(o.users_collection):c.objects.unlink(o)
        collection.objects.link(o)
    bpy.context.view_layer.update()
    unit=ET.parse(ART/file).getroot().find('{http://www.collada.org/2005/11/COLLADASchema}asset/{http://www.collada.org/2005/11/COLLADASchema}unit')
    factor=float(unit.get('meter','1')) if unit is not None else 1
    if factor!=1:
        # The game's art uses shared logical coordinates despite inconsistent
        # legacy unit metadata. Remove that global import factor, while keeping
        # genuine authored prop transforms (e.g. sheath .33, scutum 1.0222).
        for o in result:
            if o.parent not in result:o.matrix_world=Matrix.Scale(1/factor,4)@o.matrix_world
        bpy.context.view_layer.update()
    return result

def socket(arm,name):
    for n in ['prop-'+name,'prop_'+name,name]:
        if n in arm.data.bones:return arm.data.bones[n]
    canonical=lambda value:re.sub(r'^prop[-_.]','',value).removesuffix('-node')
    for b in arm.data.bones:
        if canonical(b.name)==canonical(name):return b
    if name=='loaded-projectile' and 'sling' in arm.data.bones:return arm.data.bones['sling']
    raise KeyError('Missing attachment socket '+name+' in '+str([b.name for b in arm.data.bones][:40]))

def actor(path,role,arm=None,attach=None,transform=None):
    spec=appearance('actors/'+path)
    if 'mesh' not in spec:return []
    objects=dae('meshes/'+spec['mesh']);own=next((o for o in objects if o.type=='ARMATURE' and len(o.data.bones)>0),None)
    print('ASSEMBLING_ACTOR',path,flush=True)
    target=arm or own;meshes=[o for o in objects if o.type=='MESH'];static=own is None
    weighted_names={mesh.vertex_groups[g.group].name for mesh in meshes for v in mesh.data.vertices for g in v.groups if g.weight>0}
    foreign=bool(own and arm and not weighted_names.issubset(set(b.name for b in arm.data.bones)))
    if foreign:
        if not attach:raise ValueError('Incompatible prop rig needs an explicit socket: '+path)
        # Bow strings use their own tiny skeleton. Retain the authored rest
        # shape and bind the complete bow to its hand socket; its source bones
        # must not be silently redirected into unrelated humanoid joints.
        for mesh in meshes:
            for modifier in list(mesh.modifiers):
                if modifier.type=='ARMATURE':mesh.modifiers.remove(modifier)
            mesh.vertex_groups.clear()
        static=True
    if target is None:raise ValueError('Actor needs an armature')
    if own and arm and own!=arm and not foreign:
        for mesh in meshes:
            for modifier in mesh.modifiers:
                if modifier.type=='ARMATURE':modifier.object=arm
            mesh.parent=arm
    local=Matrix.Identity(4)
    if attach and static and transform is None:
        bone=socket(target,attach);local=bone.matrix_local
    if transform is not None:local=transform
    # Save static prop attachment matrices before removing their helper empties.
    sockets={o['source_node_name'].removeprefix('prop-').removeprefix('prop_').removeprefix('prop.'):local@o.matrix_world.copy() for o in objects if o.type=='EMPTY'}
    for mesh in meshes:
        mesh.name=role+' '+pathlib.Path(spec['mesh']).stem
        mesh.data.materials.clear();mesh.data.materials.append(material(spec,path))
        if static:
            matrix=local@mesh.matrix_world
            mesh.parent=None;mesh.matrix_world=Matrix.Identity(4);mesh.data.transform(matrix)
            group=mesh.vertex_groups.new(name=socket(target,attach).name if attach else target.data.bones[0].name)
            group.add(list(range(len(mesh.data.vertices))),1,'REPLACE')
            mod=mesh.modifiers.new('Socket deform','ARMATURE');mod.object=target
        mesh.parent=target
        mesh['peris_role']=role;mesh['asset_author']='Wildfire Games';mesh['asset_license']='CC-BY-SA-3.0'; mesh['source_actor']=path
        for p in mesh.data.polygons:p.use_smooth=True
        groups.setdefault(role,[]).append(mesh)
    for child,point in spec['props']:
        if child.endswith('_r.xml'):continue # rider is assembled explicitly below
        if point in ['root','hair']:
            actor(child,role,target,attach if static else None,local if static else None)
        elif point in sockets:
            bind=attach if static else point
            if not static and not any(n in target.data.bones for n in ['prop-'+point,'prop_'+point,point]):
                bind=min(target.data.bones,key=lambda b:(b.head_local-sockets[point].translation).length).name
            actor(child,role,target,bind,sockets[point])
        elif own:
            actor(child,role,target,point)
        else:raise KeyError(f'Unknown prop socket {path}: {point}, available {list(sockets)}')
    for o in objects:
        if o.type=='EMPTY' or (o.type=='ARMATURE' and o!=target):bpy.data.objects.remove(o,do_unlink=True)
    if not arm:rigs.append(target)
    return target

def import_action(file,target):
    objects=dae('animation/'+file)
    source=next(o for o in objects if o.type=='ARMATURE' and len(o.data.bones)>0)
    action=source.animation_data.action
    # Both source files were authored against the same rig; verify bone names.
    missing=set(b.name for b in target.data.bones)-set(b.name for b in source.data.bones)
    if missing:raise ValueError('Animation rig mismatch '+file+': '+str(sorted(missing)))
    for bone in target.data.bones:
        other=source.data.bones[bone.name]
        if max(abs(bone.matrix_local[r][c]-other.matrix_local[r][c]) for r in range(4) for c in range(4))>.05:
            raise ValueError('Animation bind pose mismatch '+file+': '+bone.name)
    # Root placement and scale belong to the formation renderer. Imported
    # object transforms would overwrite the model's explicit shared scale.
    for curve in list(action.fcurves):
        if not curve.data_path.startswith('pose.bones['):action.fcurves.remove(curve)
    source.animation_data.action=None
    for o in objects:bpy.data.objects.remove(o,do_unlink=True)
    return action

def clips(arm,spec,role,stationary=False):
    arm.animation_data_create()
    for state,key in [('idle','Idle'),('walk','Walk'),('attack','attack_melee')]:
        choices=[key,key.lower()] if state!='attack' else ['attack_ranged','attack_melee','Attack']
        if state=='walk' and stationary:choices+=['Idle','idle']
        chosen=next((k for k in choices if k in spec['animations']),None)
        if chosen is None: raise ValueError('Missing '+state+' clip for '+role+': '+str(spec['animations']))
        action=import_action(spec['animations'][chosen],arm);action.name=role+'_'+state
        start,end=action.frame_range
        track=arm.animation_data.nla_tracks.new();track.name=role+'_'+state
        strip=track.strips.new(role+'_'+state,1,action);strip.action_frame_start=start;strip.action_frame_end=end
        # Uniform one-second loops align mount/rider phases when baked in-game.
        strip.frame_start=1;strip.scale=24/(end-start);track.mute=True
    arm.animation_data.action=None
