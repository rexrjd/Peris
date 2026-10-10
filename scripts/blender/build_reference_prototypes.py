"""Assemble two licensed RTS prototypes from pinned 0 A.D. sources.

Editable output is separate from the original procedural armies. Rigs, sockets,
UVs and animation clips are retained; exports use the explicit Peris exporter.
The adapted assets are CC BY-SA 3.0, credited to Wildfire Games.
"""
import bpy, pathlib, json, math, runpy, sys, re, argparse, xml.etree.ElementTree as ET
from mathutils import Matrix, Vector
ROOT=pathlib.Path(__file__).resolve().parents[2]
ART=ROOT/'assets/references/units/0ad'
parser=argparse.ArgumentParser();parser.add_argument('--edition',default='reference-v2')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if not re.fullmatch(r'[a-z0-9-]+',args.edition):raise ValueError('Use a simple edition directory name')
OUT=ROOT/'assets/source/battle'/args.edition
if (OUT/'peris-reference-prototypes.blend').exists():raise FileExistsError('Preserve existing source; choose a new edition')
bpy.ops.wm.read_factory_settings(use_empty=True)
collection=bpy.data.collections.new('PERIS_EXPORT');bpy.context.scene.collection.children.link(collection)
images={}; materials={}; groups={}; rigs=[];import_id=0

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
            if a.get('name') in ['Idle','Walk','attack_melee']:result['animations'].setdefault(a.get('name'),a.get('file'))
        for group in node.findall('group'):
            choices=group.findall('variant')
            chosen=next((v for v in choices if v.get('name')=='rome-muscled-cuirass'),choices[0] if choices else None)
            if chosen is not None:merge(chosen)
    merge(root.find('inline') if root.tag=='qualitylevels' else root)
    return result

def texture(file,color=True):
    key=(file,color)
    if key not in images:
        image_path=ROOT/'assets/source/battle/reference-textures/textures/skins'/pathlib.Path(file).with_suffix('.png') if file.lower().endswith('.dds') else ART/'textures/skins'/file
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
        # RTS faction-color masks use base alpha, not transparency. Bake the
        # faction tint into the image so runtime remains standard glTF PBR.
        if 'player' in path or any(t in base for t in ['cuirass','scale_centurion','blanket_rome','rome_parma','scutum']):
            tinted=tex.image.copy();tinted.name='Peris crimson '+tex.image.name
            pixels=list(tinted.pixels[:]);red=(.38,.055,.04)
            for i in range(0,len(pixels),4):
                a=pixels[i+3]
                for c in range(3):pixels[i+c]*=a+(1-a)*red[c]
                pixels[i+3]=1
            tinted.pixels[:]=pixels
            dest=OUT/'textures'/('crimson_'+pathlib.Path(base).stem+'.png');dest.parent.mkdir(parents=True,exist_ok=True)
            tinted.filepath_raw=str(dest);tinted.file_format='PNG';tinted.save();tinted.pack();tex.image=tinted
        links.new(tex.outputs['Color'],p.inputs['Base Color'])
        if 'hair_' in path:
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
    raise KeyError('Missing attachment socket '+name+' in '+str([b.name for b in arm.data.bones][:40]))

def actor(path,role,arm=None,attach=None,transform=None):
    spec=appearance('actors/'+path)
    if 'mesh' not in spec:return []
    objects=dae('meshes/'+spec['mesh']);own=next((o for o in objects if o.type=='ARMATURE' and len(o.data.bones)>0),None)
    print('ACTOR_RIG',path,[(o.name,len(o.data.bones)) for o in objects if o.type=='ARMATURE'],flush=True)
    target=arm or own;meshes=[o for o in objects if o.type=='MESH'];static=own is None
    if target is None:raise ValueError('Actor needs an armature')
    if own and arm and own!=arm:
        for mesh in meshes:
            for modifier in mesh.modifiers:
                if modifier.type=='ARMATURE':modifier.object=arm
            mesh.parent=arm
    local=Matrix.Identity(4)
    if attach and static and transform is None:
        bone=socket(target,attach);local=bone.matrix_local
    if transform is not None:local=transform
    # Save static prop attachment matrices before removing their helper empties.
    sockets={o['source_node_name'].removeprefix('prop-').removeprefix('prop_'):local@o.matrix_world.copy() for o in objects if o.type=='EMPTY'}
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
        mesh['peris_role']=role;mesh['asset_author']='Wildfire Games';mesh['asset_license']='CC-BY-SA-3.0'
        for p in mesh.data.polygons:p.use_smooth=True
        groups.setdefault(role,[]).append(mesh)
    for child,point in spec['props']:
        if child.endswith('_r.xml'):continue # rider is assembled explicitly below
        if point in ['root','hair']:
            actor(child,role,target,attach if static else None,local if static else None)
        elif point in sockets:
            actor(child,role,target,attach if static else point,sockets[point] if static else None)
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

def clips(arm,spec,role):
    arm.animation_data_create()
    for state,key in [('idle','Idle'),('walk','Walk'),('attack','attack_melee')]:
        action=import_action(spec['animations'][key],arm);action.name=role+'_'+state
        start,end=action.frame_range
        track=arm.animation_data.nla_tracks.new();track.name=role+'_'+state
        strip=track.strips.new(role+'_'+state,1,action);strip.action_frame_start=start;strip.action_frame_end=end
        # Uniform one-second loops align mount/rider phases when baked in-game.
        strip.frame_start=1;strip.scale=24/(end-start);track.mute=True
    arm.animation_data.action=None

inf_path='units/romans/infantry_swordsman_c4.xml';cav_path='units/romans/cavalry_spearman_e_m.xml';rider_path='units/romans/cavalry_spearman_e_r.xml'
inf=actor(inf_path,'line_infantry');inf.name='line_infantry rig'
horse=actor(cav_path,'heavy_cavalry');horse.name='heavy_cavalry horse rig'
rider=actor(rider_path,'heavy_cavalry');rider.name='heavy_cavalry rider rig'
# Match the original game's mount socket. Rider clips are already seated relative
# to this point, with bent hips/knees; no standing-pelvis offset is invented.
rider.parent=horse;rider.parent_type='BONE';rider.parent_bone='prop_rider'
# Blender bone parenting includes a tail translation. Cancel it explicitly.
rider.matrix_parent_inverse=Matrix.Translation((0,-horse.data.bones['prop_rider'].length,0))
rider.matrix_basis=Matrix.Identity(4)
clips(inf,appearance('actors/'+inf_path),'line_infantry')
clips(horse,appearance('actors/'+cav_path),'heavy_cavalry')
clips(rider,appearance('actors/'+rider_path),'heavy_cavalry')
# Rotate source forward (-Y) to Peris forward (+X), preserving shared scale.
for arm in [inf,horse]:arm.rotation_euler.z=math.pi/2;arm.scale=(2,2,2)
scene=bpy.context.scene;scene.render.fps=24;scene.frame_end=25
scene.frame_set(1)
for arm in rigs:
    if arm.animation_data and arm.animation_data.nla_tracks:
        arm.animation_data.nla_tracks[0].mute=False
OUT.mkdir(parents=True,exist_ok=True)
source=OUT/'peris-reference-prototypes.blend';bpy.ops.wm.save_as_mainfile(filepath=str(source))
# Sources open in the valid idle pose; muted track state is adjusted for export.
for arm in rigs:
    for track in arm.animation_data.nla_tracks:track.mute=True
sys.argv=['export_glb.py','--','--collection','PERIS_EXPORT','--animation-mode','NLA_TRACKS','--output',str(OUT/'exports/reference-prototypes.raw.glb')]
runpy.run_path(str(ROOT/'scripts/blender/export_glb.py'),run_name='__main__')
print('REFERENCE_PROTOTYPES_BUILT',flush=True)
