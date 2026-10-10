"""Build editable, textured nine-role rosters from licensed source rigs.

Original Peris race equipment is assembled onto verified 0 A.D. anatomy.
Each edition is new: existing .blend files are never overwritten.
"""
import argparse, pathlib, sys, math, json, runpy, shutil, datetime
import bpy
from mathutils import Vector, Matrix

ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import reference_roster_lib as lib
import roster_atlas
import roster_anatomy

parser=argparse.ArgumentParser()
parser.add_argument('--factions',nargs='+',default=['roman'])
parser.add_argument('--edition',default='roster-v3')
parser.add_argument('--checkpoint-refresh',action='store_true',help='Archive this agent-owned working edition before rebuilding it')
ALL_ROLES=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','ram','catapult']
parser.add_argument('--roles',nargs='+',choices=ALL_ROLES,default=ALL_ROLES,
                    help='Build only the selected roles in a new edition; the default builds all nine')
parser.add_argument('--orc-head-source',type=pathlib.Path,
                    help='Optional explicitly credited head-only GLB adaptation for an Orc pilot')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT=ROOT/'assets/source/battle'/args.edition
ROLES=list(dict.fromkeys(args.roles))
if args.checkpoint_refresh and ROLES!=ALL_ROLES:
    parser.error('A partial role build must use a new edition and cannot refresh a complete roster')
if args.orc_head_source and not args.orc_head_source.is_file():
    parser.error('The explicit head-only source does not exist: '+str(args.orc_head_source))

PROFILES={
 'roman':dict(cloth=(.38,.055,.04),size=(1,1,1),family='roman'),
 'spartan':dict(cloth=(.33,.035,.035),size=(1,1,1),family='spartan'),
 'persian':dict(cloth=(.055,.17,.32),size=(1,1,1),family='persian'),
 'egyptian':dict(cloth=(.75,.65,.37),size=(1,1,1),family='egyptian'),
 'orc':dict(cloth=(.26,.11,.045),size=(1.22,1.1,1.12),family='roman',skin=(.39,.48,.24)),
 'elf':dict(cloth=(.07,.27,.15),size=(.88,.9,1.1),family='spartan',skin=(.81,.74,.58)),
 'dwarf':dict(cloth=(.09,.17,.30),size=(1.19,1.15,.74),family='spartan',skin=(.63,.42,.28)),
 'gnome':dict(cloth=(.33,.045,.055),size=(.74,.78,.62),family='persian',skin=(.69,.47,.30)),
 'pandaren':dict(cloth=(.035,.25,.22),size=(1.22,1.20,.86),family='egyptian',skin=(.89,.87,.78)),
 'undead':dict(cloth=(.08,.17,.20),size=(.91,.90,1.02),family='roman',skin=(.70,.68,.54)),
 'demon':dict(cloth=(.27,.035,.09),size=(1.11,1.04,1.14),family='persian',skin=(.48,.13,.10)),
}
ACTORS={
 'roman':dict(line_infantry='units/romans/infantry_swordsman_e.xml',spear_guard='units/romans/infantry_spearman_e.xml',elite='units/romans/infantry_swordsman_c4.xml',archer='units/athenians/infantry_archer_e.xml',cav='units/romans/cavalry_javelinist_a',heavy='units/romans/cavalry_spearman_e'),
 'spartan':dict(line_infantry='units/spartans/infantry_spearman_e.xml',spear_guard='units/spartans/infantry_spearman_e.xml',elite='units/spartans/hero_infantry_spearman_leonidas.xml',archer='units/athenians/infantry_archer_e.xml',cav='units/spartans/cavalry_spearman_e',heavy='units/spartans/cavalry_spearman_e'),
 'persian':dict(line_infantry='units/persians/infantry_spearman_e.xml',spear_guard='units/persians/infantry_spearman_e.xml',elite='units/persians/infantry_spearman_e.xml',archer='units/persians/infantry_archer_e.xml',cav='units/persians/cavalry_archer_e',heavy='units/persians/cavalry_spearman_e'),
 'egyptian':dict(line_infantry='units/ptolemies/infantry_swordsman_e.xml',spear_guard='units/ptolemies/infantry_spearman_e.xml',elite='units/ptolemies/infantry_spearman_e.xml',archer='units/ptolemies/infantry_archer_e.xml',cav='units/ptolemies/cavalry_javelinist_e',heavy='units/ptolemies/cavalry_spearman_e'),
}

def solid(name,color,metal=0,rough=.65):
    material=bpy.data.materials.new(name);material.use_nodes=True
    p=material.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return material

def mesh_prop(obj,arm,role,bone,material):
    """Bake authored geometry in armature rest coordinates, preserving its bone."""
    for c in list(obj.users_collection):c.objects.unlink(obj)
    lib.collection.objects.link(obj)
    # Primitive operators and property assignment defer transform evaluation.
    # Refresh before baking scale/rotation into the rest-space attachment.
    bpy.context.view_layer.update()
    matrix=obj.matrix_world.copy();obj.parent=None;obj.matrix_world=Matrix.Identity(4)
    obj.data.transform(matrix)
    obj.data.materials.clear();obj.data.materials.append(material)
    group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    modifier=obj.modifiers.new('Original Peris attachment','ARMATURE');modifier.object=arm
    obj.parent=arm;obj.name=role+' '+obj.name
    obj['peris_role']=role;obj['asset_author']='Peris, adapted with Wildfire Games artwork'
    obj['asset_license']='CC-BY-SA-3.0';obj['original_peris_equipment']=True
    for p in obj.data.polygons:p.use_smooth=True
    lib.groups.setdefault(role,[]).append(obj)
    return obj

def cone(name,a,b,r1,r2,arm,role,bone,material):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=12,radius1=r1,radius2=r2,depth=(b-a).length,location=(a+b)*.5)
    obj=bpy.context.object;obj.name=name;obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return mesh_prop(obj,arm,role,bone,material)

def cube(name,position,size,arm,role,bone,material,bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1,location=position)
    obj=bpy.context.object;obj.name=name;obj.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=obj.modifiers.new('Worked edges','BEVEL');mod.width=bevel;mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return mesh_prop(obj,arm,role,bone,material)

def ellipsoid(name,position,size,arm,role,bone,material):
    skeletal=name.startswith(('Bone joint ','Mammoth joint','Mammoth vertebra','Horse skeletal joint')) or 'rivet' in name.lower()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12 if skeletal else 20,ring_count=8 if skeletal else 12,location=position)
    obj=bpy.context.object;obj.name=name;obj.scale=size
    return mesh_prop(obj,arm,role,bone,material)

def curved(name,points,radius,arm,role,bone,material):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.bevel_depth=radius;data.bevel_resolution=2
    if 'rib' in name.lower():data.resolution_u=5;data.bevel_resolution=1
    spline=data.splines.new('BEZIER');spline.bezier_points.add(len(points)-1)
    for p,xyz in zip(spline.bezier_points,points):p.co=xyz;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
    obj=bpy.data.objects.new(name,data);lib.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH')
    return mesh_prop(bpy.context.object,arm,role,bone,material)

def find_bone(arm,*terms):
    for term in terms:
        for b in arm.data.bones:
            if term.lower() in b.name.lower():return b
    raise KeyError('Missing anatomical attachment '+str(terms)+' on '+arm.name)

def head_equipment(arm,role,faction,mats):
    if faction in ['roman','spartan','persian','egyptian']:return
    head=find_bone(arm,'prop-head','prop_head','head');h=head.head_local.copy()
    # Source models face -Y before the shared +X conversion. Accessories are
    # authored in the same rest coordinates and weighted to the head socket.
    ivory=mats['ivory'];dark=mats['dark'];steel=mats['steel'];skin=mats['skin'];hair=mats['hair']
    for mesh in list(lib.groups[role]):
        path=mesh.get('source_actor','')
        if ('/helmets/' in path and (faction=='pandaren' or '/props/' in path)):
            lib.groups[role].remove(mesh);bpy.data.objects.remove(mesh,do_unlink=True)
    if faction=='orc':
        for mesh in lib.groups[role]:
            if '/heads/' in mesh.get('source_actor',''):
                for vertex in mesh.data.vertices:
                    vertex.co.x=h.x+(vertex.co.x-h.x)*1.20
                    if vertex.co.z<h.z+.14:vertex.co.y-=.045
        for s in [-1,1]:
            cone('Lower canine tusk',h+Vector((s*.16,-.28,-.05)),h+Vector((s*.21,-.33,.19)),.07,.008,arm,role,head.name,ivory)
            cone('Orc ear',h+Vector((s*.23,0,.10)),h+Vector((s*.47,.05,.26)),.12,.008,arm,role,head.name,skin)
        for side in [-1,1]:
            shoulder=find_bone(arm,'shoulder_'+('R' if side<0 else 'L'))
            p=shoulder.head_local+Vector((side*.23,0,0))
            cube('Riveted black shoulder armor',p,(.56,.55,.15),arm,role,shoulder.name,steel)
            for i in range(3):cone('Shoulder spike',p+Vector((-.18+i*.18,0,.08)),p+Vector((-.18+i*.18,0,.39)),.07,0,arm,role,shoulder.name,ivory)
    elif faction=='elf':
        for s in [-1,1]:cone('Long elven ear',h+Vector((s*.22,0,.10)),h+Vector((s*.46,.04,.31)),.09,0,arm,role,head.name,skin)
        if role in ['elite','heavy_cavalry']:
            for s in [-1,1]:
                curved('Antler crown',[h+Vector((s*.23,0,.35)),h+Vector((s*.35,.08,.65)),h+Vector((s*.43,.04,.91))],.045,arm,role,head.name,ivory)
                cone('Antler branch',h+Vector((s*.35,.08,.65)),h+Vector((s*.62,.04,.8)),.035,0,arm,role,head.name,ivory)
    elif faction in ['dwarf','gnome']:
        for i in range(7 if faction=='dwarf' else 3):
            x=(i-(3 if faction=='dwarf' else 1))*.09
            curved('Braided beard',[(h.x+x,h.y-.23,h.z-.05),(h.x+x*.8,h.y-.25,h.z-.35),(h.x+x*.4,h.y-.18,h.z-.72)],.07 if faction=='dwarf' else .05,arm,role,head.name,hair)
            cone('Beard bronze cuff',(h.x+x*.4,h.y-.18,h.z-.61),(h.x+x*.4,h.y-.18,h.z-.69),.078,.078,arm,role,head.name,mats['bronze'])
        if faction=='gnome':
            for s in [-1,1]:ellipsoid('Engineer lens',h+Vector((s*.12,-.24,.35)),(.115,.035,.115),arm,role,head.name,mats['bronze'])
    elif faction=='pandaren':
        h+=Vector((0,0,.15))
        # Rounded muzzle, broad brow, cheek volume and black eye patches form a
        # bear face over the retained anatomical head, rather than a human mask.
        ellipsoid('Panda white muzzle',h+Vector((0,-.22,-.06)),(.24,.16,.15),arm,role,head.name,skin)
        ellipsoid('Panda black nose',h+Vector((0,-.38,-.01)),(.1,.045,.07),arm,role,head.name,dark)
        for s in [-1,1]:
            ellipsoid('Panda ear',h+Vector((s*.24,.02,.3)),(.13,.07,.13),arm,role,head.name,dark)
            ellipsoid('Panda eye patch',h+Vector((s*.13,-.22,.14)),(.12,.03,.10),arm,role,head.name,dark)
            ellipsoid('Panda watchful eye',h+Vector((s*.13,-.253,.15)),(.041,.016,.023),arm,role,head.name,ivory)
            ellipsoid('Panda dark pupil',h+Vector((s*.13,-.27,.15)),(.019,.008,.020),arm,role,head.name,dark)
        for mesh in lib.groups[role]:
            if 'head' in mesh.get('source_actor',''):mesh.data.materials.clear();mesh.data.materials.append(skin)
    elif faction=='undead':
        for s in [-1,1]:ellipsoid('Hollow skull eye',h+Vector((s*.12,-.22,.12)),(.08,.025,.085),arm,role,head.name,dark)
        for i in range(8):cube('Exposed ivory tooth',h+Vector(((i-3.5)*.04,-.245,-.14)),(.032,.055,.07),arm,role,head.name,ivory,.008)
        for mesh in lib.groups[role]:
            if 'head' in mesh.get('source_actor',''):mesh.data.materials.clear();mesh.data.materials.append(ivory)
    elif faction=='demon':
        for s in [-1,1]:
            curved('Swept demon horn',[h+Vector((s*.19,.01,.28)),h+Vector((s*.36,.08,.49)),h+Vector((s*.45,.18,.72)),h+Vector((s*.34,.21,.85))],.085,arm,role,head.name,dark)
            cone('Demon chin spike',h+Vector((s*.16,-.16,-.18)),h+Vector((s*.19,-.24,-.35)),.07,0,arm,role,head.name,ivory)

def add_role_gear(arm,role,faction,mats):
    if faction=='orc':
        import roster_orc_anatomy,roster_orc_equipment
        geometry={'cone':cone,'cube':cube,'ellipsoid':ellipsoid,'curved':curved,'mesh_prop':mesh_prop}
        roster_orc_anatomy.apply(lib,arm,role,mats,geometry)
        roster_orc_equipment.apply(lib,arm,role,mats,geometry,roster_orc_anatomy.anchors(arm))
        return
    if faction in ['elf','dwarf','gnome','pandaren','undead','demon']:
        import roster_race_equipment
        fantasy_equipment(arm,role,faction,mats)
        geometry={'cone':cone,'cube':cube,'ellipsoid':ellipsoid,'curved':curved,'mesh_prop':mesh_prop}
        roster_race_equipment.apply(lib,arm,role,faction,mats,geometry,PROFILES[faction])
        return
    if PROFILES[faction].get('skin'):
        roster_anatomy.apply(lib,arm,role,faction,PROFILES[faction],mats,{'cone':cone,'cube':cube,'ellipsoid':ellipsoid,'curved':curved})
    if faction not in ['roman','spartan','persian','egyptian']:
        fantasy_equipment(arm,role,faction,mats)
    elif faction=='egyptian' and role=='line_infantry':
        clear_equipment(role,'/weapons/');forge_khopesh(arm,role,mats)
    if faction in ['roman','spartan','persian','egyptian']:
        historical_equipment(arm,role,faction,mats)
    if role=='scout':
        for mesh in list(lib.groups[role]):
            path=mesh.get('source_actor','')
            if '/shields/' in path or ('/weapons/' in path and '/sheath_' not in path) or '/quiver' in path:
                lib.groups[role].remove(mesh);bpy.data.objects.remove(mesh,do_unlink=True)
        hip=find_bone(arm,'pelvis','hips','hip')
        cube('Scout map satchel',hip.head_local+Vector((.30,.10,-.10)),(.26,.13,.30),arm,role,hip.name,mats['leather'])
    if role=='spear_guard':
        # The polearm is visibly longer than the basic weapon, while retaining
        # the source hand socket and its complete source animation.
        for mesh in lib.groups[role]:
            if '/weapons/' in mesh.get('source_actor','') and ('spear' in mesh.get('source_actor','')):
                center=sum((v.co for v in mesh.data.vertices),Vector())/len(mesh.data.vertices)
                for v in mesh.data.vertices:v.co=center+(v.co-center)*Vector((1,1,1.25))
    if role in ['elite','heavy_cavalry']:
        if faction not in ['roman','spartan']:
            for side in [-1,1]:
                shoulder=find_bone(arm,'shoulder_'+('R' if side<0 else 'L'))
                cube('Layered elite shoulder plate',shoulder.head_local+Vector((side*.23,.01,.10)),(.50,.36,.13),arm,role,shoulder.name,mats['steel'])
                cube('Shoulder bronze edge',shoulder.head_local+Vector((side*.23,-.18,.10)),(.51,.045,.12),arm,role,shoulder.name,mats['bronze'])
    head_equipment(arm,role,faction,mats)

def clear_equipment(role,kind):
    for mesh in list(lib.groups[role]):
        path=mesh.get('source_actor','')
        if kind in path and (kind!='/weapons/' or '/sheath_' not in path):
            lib.groups[role].remove(mesh);bpy.data.objects.remove(mesh,do_unlink=True)

def historical_equipment(arm,role,faction,mats):
    if faction=='spartan' and role=='heavy_cavalry':
        clear_equipment(role,'/helmets/');clear_equipment(role,'/shields/')
        lib.actor('props/units/helmets/hele_illyrian_b1_crested.xml',role,arm,'helmet')
        before=set(lib.groups[role]);lib.actor('props/units/shields/aspis_lambda_01.xml',role,arm,'shield_arm')
        socket=lib.socket(arm,'shield_arm').matrix_local.translation
        for mesh in lib.groups[role]:
            if mesh not in before:
                for vertex in mesh.data.vertices:vertex.co=socket+(vertex.co-socket)*.67
    if faction=='persian' and role=='line_infantry':
        clear_equipment(role,'/weapons/');clear_equipment(role,'/shields/');clear_equipment(role,'/helmets/')
        lib.actor('props/units/weapons/gladius.xml',role,arm,'weapon_R')
        lib.actor('props/units/shields/pers_pelta_a_b_reverse.xml',role,arm,'shield')
        lib.actor('props/units/helmets/pers_conical_b1.xml',role,arm,'helmet')
    if role=='elite' and faction in ['persian','egyptian']:
        clear_equipment(role,'/helmets/')
        helmet='pers_pilos_crested' if faction=='persian' else 'ptol_romanized_crest'
        lib.actor('props/units/helmets/'+helmet+'.xml',role,arm,'helmet')
        chest=find_bone(arm,'chest');c=chest.head_local
        # Individually overlapping officer lamellae curve around the chest;
        # they retain the source torso animation instead of a rigid box shell.
        for row in range(6):
            for col in range(7):
                angle=(col-3)*.23
                p=c+Vector((math.sin(angle)*.43,-math.cos(angle)*.29-.10,.44-row*.105))
                cube('Overlapping officer bronze lamella',p,(.13,.055,.13),arm,role,chest.name,mats['bronze'],.020)
        for side in [-1,1]:
            upper=find_bone(arm,'arm_'+('L' if side>0 else 'R'))
            cone('Officer upper arm bronze cuff',upper.head_local,upper.head_local+Vector((side*.14,0,-.23)),.14,.13,arm,role,upper.name,mats['bronze'])

def forge_khopesh(arm,role,mats):
    bone=lib.socket(arm,'weapon_R');matrix=bone.matrix_local
    outline=[(-.045,.15),(.055,.15),(.08,.54),(.28,.65),(.40,.88),(.36,1.16),(.21,1.30),(.22,1.04),(.15,.84),(-.04,.69)]
    verts=[matrix@Vector((x,y,z)) for y in [-.025,.025] for x,z in outline]
    count=len(outline);faces=[tuple(range(count-1,-1,-1)),tuple(range(count,count*2))]
    faces += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    data=bpy.data.meshes.new('Forged Egyptian curved blade');data.from_pydata(verts,[],faces);data.update()
    obj=bpy.data.objects.new('Egyptian khopesh',data);lib.collection.objects.link(obj)
    mesh_prop(obj,arm,role,bone.name,mats['bronze'])
    cone('Khopesh leather hilt',matrix@Vector((0,0,-.23)),matrix@Vector((0,0,.15)),.065,.065,arm,role,bone.name,mats['leather'])

def fantasy_equipment(arm,role,faction,mats):
    # Arms match the named race roles. Source props supply authored socket
    # orientation, while new equipment stays visibly separate from the body.
    weapons={
      'orc':{'line_infantry':'axe_single','elite':'axe_double'},
      'elf':{'line_infantry':'gladius','elite':'spear_hoplite'},
      'dwarf':{'line_infantry':'kush_nubian_mace','elite':'axe_double'},
      'gnome':{'line_infantry':'mace_mauryan','elite':'axe_single'},
      'pandaren':{'line_infantry':'gladius','elite':'axe_twohanded_mauryan'},
      'undead':{'line_infantry':'spear','elite':'axe_double'},
      'demon':{'line_infantry':'axe_double','elite':'axe_twohanded_mauryan'},
    }
    if role in weapons[faction]:
        clear_equipment(role,'/weapons/')
        weapon=weapons[faction][role]
        lib.actor('props/units/weapons/'+weapon+'.xml',role,arm,'weapon_R')
        if faction=='dwarf' and role=='line_infantry':
            bone=lib.socket(arm,'weapon_R');m=bone.matrix_local
            bpy.ops.mesh.primitive_cube_add(size=1)
            obj=bpy.context.object;obj.name='Dwarven forged hammer head'
            obj.matrix_world=m@Matrix.Translation((0,0,1.22))@Matrix.Diagonal((.62,.25,.30,1))
            mesh_prop(obj,arm,role,bone.name,mats['steel'])
    if role in ['line_infantry','spear_guard','elite','light_cavalry','heavy_cavalry']:
        clear_equipment(role,'/shields/')
        if faction in ['orc','demon','undead']:
            path='props/units/shields/pelte_round_wood.xml'
        elif faction in ['dwarf','gnome']:path='props/units/shields/celt_round_swirl.xml'
        else:path='props/units/shields/pelte_round_wood.xml'
        lib.actor(path,role,arm,'shield_arm' if role in ['light_cavalry','heavy_cavalry'] else 'shield')
    if role=='archer' and faction in ['dwarf','gnome']:
        # A stock and iron stirrup make the retained articulated bow read as a
        # crossbow. It follows the same verified ranged hand socket.
        bone=lib.socket(arm,'weapon_bow');m=bone.matrix_local
        rotate=Matrix.Rotation(math.pi/2,4,'Y')
        for obj in lib.groups[role]:
            if '/weapons/bow_' in obj.get('source_actor',''):
                for vertex in obj.data.vertices:vertex.co=m@rotate@m.inverted()@vertex.co
        a=m@Vector((0,-.65,0));b=m@Vector((0,.55,0))
        cone('Crossbow timber stock',a,b,.07,.055,arm,role,bone.name,mats['leather'])
        cube('Crossbow brass trigger',m@Vector((0,.14,.06)),(.13,.10,.12),arm,role,bone.name,mats['bronze'])

def root_arm(role):
    data=bpy.data.armatures.new(role+' original skeleton');arm=bpy.data.objects.new(role+' original rig',data)
    lib.collection.objects.link(arm);bpy.context.view_layer.objects.active=arm;arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bone=data.edit_bones.new('root');bone.head=(0,0,0);bone.tail=(0,0,1)
    bpy.ops.object.mode_set(mode='OBJECT');arm.select_set(False);lib.rigs.append(arm)
    return arm

def original_clips(arm,role,amplitude=.02):
    arm.animation_data_create()
    for state in ['idle','walk','attack']:
        action=bpy.data.actions.new(role+'_'+state);arm.animation_data.action=action
        for frame in [1,7,13,19,25]:
            phase=(frame-1)/24*math.tau
            for bone in arm.pose.bones:
                bone.rotation_mode='XYZ';bone.rotation_euler=(0,0,math.sin(phase)*(amplitude if state!='idle' else amplitude*.1))
                bone.keyframe_insert('rotation_euler',frame=frame,group=bone.name)
        track=arm.animation_data.nla_tracks.new();track.name=role+'_'+state;track.strips.new(track.name,1,action);track.mute=True
        arm.animation_data.action=None

def human(path,role,faction,mats):
    arm=lib.actor(path,role);arm.name=role+' anatomy rig'
    lib.clips(arm,lib.appearance('actors/'+path),role)
    add_role_gear(arm,role,faction,mats)
    arm.rotation_euler.z=math.pi/2;arm.scale=tuple(2*x for x in PROFILES[faction]['size'])
    bpy.context.view_layer.update()
    if faction=='orc' and role in ['line_infantry','spear_guard','elite','archer'] and arm.get('peris_licensed_head_credit'):
        from roster_orc_equipment import _fit_clip_ground
        from orc_portrait_surface import apply_portrait_surface
        from orc_portrait_armor_surface import apply_portrait_armor_surface
        from orc_portrait_face_refinement import apply_portrait_face_refinement
        from roster_orc_anatomy import match_nape_boundary_paint
        from orc_portrait_attack import apply_axe_attack
        if role=='line_infantry':apply_axe_attack(arm,role)
        _fit_clip_ground(lib,arm,role)
        if role=='archer':
            from orc_war_bowman import apply_war_bowman
            geometry={'cone':cone,'cube':cube,'ellipsoid':ellipsoid,'curved':curved,'mesh_prop':mesh_prop}
            apply_war_bowman(lib,arm,geometry,role)
        apply_portrait_surface(arm,role)
        apply_portrait_face_refinement(arm,role)
        match_nape_boundary_paint(arm,role)
        apply_portrait_armor_surface(arm,role)
    return arm

def fit_scaled_source_rider(horse,rider,role,profile):
    """Keep the proven source hip contact when adapting a race's proportions."""
    for arm in [horse,rider]:
        for track in arm.animation_data.nla_tracks:track.mute=track.name!=role+'_idle'
    bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
    hip=find_bone(rider,'hip','pelvis');local=rider.pose.bones[hip.name].head.copy()
    scale=profile['size'];unscaled=Vector(tuple(local[i]/scale[i] for i in range(3)))
    # matrix_world already contains the profile scale; undo it only for the
    # reference target, then compensate the hip's local scaled displacement.
    expected=rider.matrix_world @ unscaled
    correction=Vector(tuple(local[i]*(1-scale[i]) for i in range(3)))
    rider.matrix_basis=Matrix.Translation(correction) @ Matrix.Diagonal((*scale,1))
    bpy.context.view_layer.update()
    measured=rider.matrix_world @ rider.pose.bones[hip.name].head
    error=(measured-expected).length
    if error>.005:raise ValueError('Scaled source rider seat drift '+str(error))
    rider['peris_seat_hip_world']=[round(v,6) for v in measured]
    rider['peris_seat_target_world']=[round(v,6) for v in expected]
    rider['peris_seat_fit_error']=round(error,8)
    rider['peris_seat_reference']='Original licensed mounted idle hip contact'
    for arm in [horse,rider]:
        for track in arm.animation_data.nla_tracks:track.mute=True
        for pose in arm.pose.bones:pose.matrix_basis=Matrix.Identity(4)
    bpy.context.view_layer.update()

def cavalry(prefix,role,faction,mats):
    mount_path=prefix+'_m.xml';rider_path=prefix+'_r.xml'
    horse=lib.actor(mount_path,role);horse.name=role+' mount rig'
    rider=lib.actor(rider_path,role);rider.name=role+' seated rider rig'
    rider.parent=horse;rider.parent_type='BONE';rider.parent_bone=lib.socket(horse,'rider').name
    rider.matrix_parent_inverse=Matrix.Translation((0,-horse.data.bones[rider.parent_bone].length,0));rider.matrix_basis=Matrix.Identity(4)
    lib.clips(horse,lib.appearance('actors/'+mount_path),role);lib.clips(rider,lib.appearance('actors/'+rider_path),role)
    add_role_gear(rider,role,faction,mats)
    if faction=='persian' and role=='scout':
        for mesh in list(lib.groups[role]):
            if 'cav_peytral_' in mesh.get('source_actor',''):
                lib.groups[role].remove(mesh);bpy.data.objects.remove(mesh,do_unlink=True)
    if role=='heavy_cavalry' and faction in ['roman','spartan','persian','egyptian']:
        head=find_bone(horse,'Horse_Head')
        cube('Articulated bronze chanfron',head.head_local+Vector((0,-.07,.14)),(.40,.72,.10),horse,role,head.name,mats['bronze'])
        for name in ['Horse_Neck','Horse_Neck_1','Horse_Neck_2']:
            bone=horse.data.bones.get(name)
            if bone:
                cube('Overlapping horse neck lamella',bone.head_local+Vector((0,0,.20)),(.64,.52,.10),horse,role,bone.name,mats['steel'])
        for side in [-1,1]:
            bone=find_bone(horse,'Horse_Spine_1')
            cube('Riveted breast barding',bone.head_local+Vector((side*.61,-.20,-.40)),(.10,1.15,.85),horse,role,bone.name,mats['steel'])
    rider.scale=PROFILES[faction]['size']
    horse.rotation_euler.z=math.pi/2;horse.scale=(2,2,2)
    rider['peris_seated_bind_pose']=True;rider['peris_seat_attachment']=rider.parent_bone
    custom=(role=='heavy_cavalry' or faction=='undead' or (faction=='orc' and role=='scout'))
    if faction not in ['roman','spartan','persian','egyptian'] and not custom:
        fit_scaled_source_rider(horse,rider,role,PROFILES[faction])
    if faction not in ['roman','spartan','persian','egyptian'] and custom:
        import roster_species
        geometry={'cone':cone,'cube':cube,'ellipsoid':ellipsoid,'curved':curved,'mesh_prop':mesh_prop}
        horse,rider=roster_species.replace_heavy_mount(lib,faction,role,horse,rider,mats,PROFILES[faction],geometry)
    return horse,rider

def siege(role,faction,mats):
    if faction not in ['roman','spartan','persian','egyptian']:
        import roster_species
        geometry={'cone':cone,'cube':cube,'ellipsoid':ellipsoid,'curved':curved,'mesh_prop':mesh_prop}
        living=roster_species.build_living_siege(lib,faction,role,mats,PROFILES[faction],geometry)
        if living is not None:
            if faction=='orc':
                from roster_orc_equipment import fit_giant_wrap
                fit_giant_wrap(lib,living,role,mats,geometry)
                from orc_giant_throw import fit_giant_ground,apply_giant_throw
                giant_parts=[o for o in lib.groups[role] if any(m.type=='ARMATURE' and m.object==living for m in o.modifiers)]
                fit_giant_ground(living,giant_parts,role)
                apply_giant_throw(living,giant_parts,role)
            return living
    path='units/romans/siege_'+('ram' if role=='ram' else 'onager')+'.xml'
    spec=lib.appearance('actors/'+path)
    # Static siege parts get an explicit weighted root. Articulated source
    # actors retain their own rig and action when available.
    arm=lib.actor(path,role);arm.name=role+' siege engineering rig'
    lib.clips(arm,spec,role,stationary=role=='catapult')
    if faction not in ['roman','spartan','persian','egyptian']:
        decorate_machine(arm,role,faction,mats)
    arm.rotation_euler.z=math.pi/2;arm.scale=(2,2,2)
    return arm

def decorate_machine(arm,role,faction,mats):
    root=arm.data.bones[0]
    points=[v.co for o in lib.groups[role] for v in o.data.vertices]
    lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
    center=(lo+hi)*.5
    if faction=='gnome':
        radius=max(.66,min(1.05,(hi.z-lo.z)*.30))
        for side in [-1,1]:
            p=center+Vector((side*((hi.x-lo.x)*.50+.10),0,-(hi.z-lo.z)*.03))
            bpy.ops.mesh.primitive_torus_add(major_segments=20,minor_segments=8,major_radius=radius*.72,minor_radius=.075,location=p,rotation=(0,math.pi/2,0))
            bpy.context.object.name='Large geared brass drive wheel'
            mesh_prop(bpy.context.object,arm,role,root.name,mats['bronze'])
            for i in range(16):
                angle=i*math.tau/16;q=p+Vector((0,math.cos(angle)*radius*.78,math.sin(angle)*radius*.78))
                cube('Visible large brass drivetrain tooth',q,(.19,.19,.19),arm,role,root.name,mats['bronze'],.012)
            for i in range(6):
                angle=i*math.tau/6
                cone('Brass gear structural spoke',p,p+Vector((0,math.cos(angle)*radius*.68,math.sin(angle)*radius*.68)),.040,.040,arm,role,root.name,mats['bronze'])
            cone('Steel full width drive axle',p,p+Vector((side*.37,0,0)),.12,.12,arm,role,root.name,mats['steel'])
            q=p+Vector((side*.25,radius*.32,0))
            cube('Engineer geared bearing block',q,(.25,.38,.36),arm,role,root.name,mats['steel'],.040)
            cone('Mechanical brass crank lever',q,q+Vector((0,0,radius*.47)),.065,.065,arm,role,root.name,mats['bronze'])
            cone('Crank hand grip',q+Vector((0,0,radius*.47)),q+Vector((side*.25,0,radius*.47)),.065,.065,arm,role,root.name,mats['leather'])
        # Long engineered reinforcement straps make the drive construction
        # readable even while the throwing arm is raised.
        for side in [-1,1]:
            p=center+Vector((side*(hi.x-lo.x)*.36,0,(hi.z-lo.z)*.12))
            cube('Brass reinforced catapult frame',p,(.13,(hi.y-lo.y)*.66,.20),arm,role,root.name,mats['bronze'],.025)
    if role=='ram' and faction in ['orc','undead']:
        for side in [-1,1]:
            a=center+Vector((side*.7,-(hi.y-lo.y)*.35,0))
            curved('Ram carved tusk crest',[a,a+Vector((side*.18,-.45,.05)),a+Vector((side*.20,-.50,.44))],.10,arm,role,root.name,mats['ivory'])
    if faction in ['elf','pandaren']:
        for side in [-1,1]:
            p=center+Vector((side*(hi.x-lo.x)*.32,0,(hi.z-lo.z)*.30))
            cube('Faction metal roof trim',p,(.12,(hi.y-lo.y)*.8,.13),arm,role,root.name,mats['bronze'])

for faction in args.factions:
    if faction not in PROFILES:raise ValueError(faction)
    source=OUT/('peris-'+faction+'-army.blend');raw=OUT/'exports'/(faction+'-roster.glb')
    if source.exists() or raw.exists():
        if not args.checkpoint_refresh:raise FileExistsError('Preserve the existing edition; choose a new one: '+str(source))
        if args.edition!='roster-v3':raise ValueError('Refresh applies only to the current working roster-v3 edition')
        checkpoint=OUT/'history'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S')/faction
        checkpoint.mkdir(parents=True,exist_ok=True)
        for file in [source,raw]:
            if file.exists():shutil.move(str(file),str(checkpoint/file.name))
    profile=dict(PROFILES[faction])
    if faction=='orc' and args.orc_head_source:profile['orc_head_source']=str(args.orc_head_source.resolve())
    lib.init(OUT,profile)
    mats={
      'skin':solid('Peris '+faction+' skin',profile.get('skin',(.70,.52,.36))),
      'steel':solid('Peris dark worked steel',(.19,.23,.25),.8,.38),
      'bronze':solid('Peris worked bronze',(.49,.32,.12),.7,.4),
      'ivory':solid('Peris ivory',(.76,.72,.57),0,.68),
      'dark':solid('Peris dark detail',(.025,.026,.019),0,.74),
      'hair':solid('Peris braided hair',(.20,.11,.055),0,.82),
      'leather':solid('Peris worn leather',(.13,.075,.04),0,.86),
      'cloth':solid('Peris faction cloth',profile['cloth'],0,.9),
      'wood':solid('Peris ash timber',(.28,.16,.075),0,.88),
      'stone':solid('Peris chipped granite',(.30,.34,.32),0,.94),
    }
    actors=ACTORS[profile['family']]
    for role in ROLES:
        if role in ['ram','catapult']:siege(role,faction,mats)
        elif role in ['scout','light_cavalry','heavy_cavalry']:
            cavalry(actors['heavy'] if role=='heavy_cavalry' else actors['cav'],role,faction,mats)
        else:human(actors[role],role,faction,mats)
        print('ROSTER_ROLE_READY',faction,role,flush=True)
    roster_atlas.pack(lib,faction,OUT/'textures'/faction)
    scene=bpy.context.scene;scene.render.fps=24;scene.frame_end=25;scene.frame_set(1)
    scene['peris_source_license']='CC-BY-SA-3.0';scene['peris_source_author']='Wildfire Games, with original Peris race equipment'
    scene['peris_roster_roles']=','.join(ROLES)
    head_credits=[arm.get('peris_licensed_head_credit') for arm in lib.rigs if arm.get('peris_licensed_head_credit')]
    if head_credits:
        scene['peris_source_license']='Mixed components: CC-BY-SA-3.0 body/rig and equipment; CC-BY-4.0 licensed head'
        scene['peris_source_author']='Wildfire Games; Crazyon520; original Peris anatomical adaptation, paint and equipment (see peris_source_credits)'
        motion_edits=[{'role':arm.get('peris_role',arm.name),
                       'idle_guard':json.loads(arm['peris_original_idle_guard_pose']) if arm.get('peris_original_idle_guard_pose') else None,
                       'axe_attack':json.loads(arm['peris_original_axe_attack']) if arm.get('peris_original_axe_attack') else None,
                       'sole_placement':json.loads(arm['peris_ground_placement_review']) if arm.get('peris_ground_placement_review') else None}
                      for arm in lib.rigs if arm.get('peris_original_idle_guard_pose') or arm.get('peris_ground_placement_review')]
        surface_edits=[json.loads(arm['peris_portrait_surface_study']) for arm in lib.rigs if arm.get('peris_portrait_surface_study')]
        armor_surface_edits=[json.loads(arm['peris_portrait_armor_surface']) for arm in lib.rigs if arm.get('peris_portrait_armor_surface')]
        face_edits=[json.loads(arm['peris_portrait_face_refinement']) for arm in lib.rigs if arm.get('peris_portrait_face_refinement')]
        nape_edits=[json.loads(arm['peris_nape_boundary_paint']) for arm in lib.rigs if arm.get('peris_nape_boundary_paint')]
        garment_edits=[json.loads(arm['peris_connected_pilot_garment']) for arm in lib.rigs if arm.get('peris_connected_pilot_garment')]
        bowman_contact_edits=[json.loads(arm['peris_bowman_functional_contact']) for arm in lib.rigs if arm.get('peris_bowman_functional_contact')]
        export_timing={'nativeFrames':[1,25],'nativeFps':24,'exportFrames':[0,24],
                       'exportSeconds':[0,1],'operation':'After saving native: shift pilot NLA strips by -1 frame, preserve source action frames and keys',
                       'scope':'Explicit Orc prototype roles; original native timing retained','runtimeApproved':False} if faction=='orc' else None
        scene['peris_source_credits']=json.dumps({'body':{'author':'Wildfire Games','license':'CC-BY-SA-3.0',
                                                'changes':'Peris original Orc body proportions, fitted clothing cuts, rig and motion adaptation'},
                                                'head_components':[json.loads(value) for value in head_credits],
                                                'equipment':{'author':'Original Peris equipment','license':'CC-BY-SA-3.0'},
                                                'motion_edits':motion_edits,'surface_edits':surface_edits,
                                                'armor_surface_edits':armor_surface_edits,
                                                'face_edits':face_edits,'nape_edits':nape_edits,'garment_edits':garment_edits,
                                                'bowman_contact_edits':bowman_contact_edits,
                                                'pilot_export_timing':export_timing},ensure_ascii=False)
        source_record={'edition':args.edition,'roles':ROLES,'credits':json.loads(scene['peris_source_credits']),
                       'runtimeApproved':False,'finishedUnitApproved':False}
        OUT.mkdir(parents=True,exist_ok=True)
        (OUT/'provenance.json').write_text(json.dumps(source_record,indent=2,ensure_ascii=False),encoding='utf-8')
    for arm in lib.rigs:
        if arm.animation_data and arm.animation_data.nla_tracks:arm.animation_data.nla_tracks[0].mute=False
    # Library imports leave unused meshes, materials and source actions behind.
    # Keep only the editable assembled collection and its packed atlas/rig data.
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    OUT.mkdir(parents=True,exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
    # Native source retains artist-facing action/NLA frames 1..25. Only this
    # unsaved pilot export uses 0..24: the game samples clip duration at 24
    # equally spaced phases and needs its first key at time zero.
    shifted=[]
    if faction=='orc':
        for arm in lib.rigs:
            for track in arm.animation_data.nla_tracks:
                for strip in track.strips:
                    old=(strip.frame_start,strip.frame_end,strip.action_frame_start,strip.action_frame_end,strip.scale)
                    if abs(old[0]-1)>1e-5 or abs(old[1]-25)>1e-5:
                        raise ValueError('Pilot export timing requires native 1..25 strips')
                    strip.frame_start=0
                    if abs(strip.frame_end-24)>1e-5:strip.frame_end=24
                    if (abs(strip.action_frame_start-old[2])>1e-5 or abs(strip.action_frame_end-old[3])>1e-5
                            or abs(strip.scale-old[4])>1e-5):
                        raise ValueError('NLA export shift changed action time or scale')
                    shifted.append((strip,old))
        scene.frame_start=0;scene.frame_end=24;scene.frame_set(0)
    for arm in lib.rigs:
        if arm.animation_data:
            for track in arm.animation_data.nla_tracks:track.mute=True
    sys.argv=['export_glb.py','--','--collection','PERIS_EXPORT','--animation-mode','NLA_TRACKS','--output',str(raw)]
    try:
        runpy.run_path(str(ROOT/'scripts/blender/export_glb.py'),run_name='__main__')
    finally:
        # Retain native timing in memory too; the saved file is never resaved.
        for strip,old in shifted:
            strip.frame_start=old[0]
            if abs(strip.frame_end-old[1])>1e-5:strip.frame_end=old[1]
        if shifted:scene.frame_start=1;scene.frame_end=25;scene.frame_set(1)
    print('FACTION_ROSTER_BUILT',faction,str(source),flush=True)
