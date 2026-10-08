"""Original Peris prototype geometry. Run in Blender 4.5, then use the explicit collection exporter.

All modeling happens in a new scene. This recipe never opens or overwrites an artist's source.
Units face +X; Blender Z up is converted by the glTF exporter. Materials and rigs are editable.
"""
import argparse
import math
import pathlib
import runpy
import sys
import bpy
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--factions', nargs='+', default=['orc', 'roman'])
parser.add_argument('--edition', default='')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
PROFILES = {
    'roman': ('8b2025', 'b6a181', 'a7833f', 'c6a486', 1, 'horse'),
    'spartan': ('792622', '706d64', 'b59b58', 'b99978', 1, 'horse'),
    'persian': ('224d69', 'acafaf', 'b39a51', 'b28d69', 1, 'horse'),
    'egyptian': ('d7cdb0', '87826c', 'bf9c44', 'a47c53', 1, 'horse'),
    'orc': ('69392b', '5b615b', 'a28249', '75805a', 1.12, 'mammoth'),
    'elf': ('355b47', 'b4bdb8', 'bdb475', 'd2bfa2', 1.04, 'elk'),
    'dwarf': ('35455e', '808987', 'bba464', 'bf9370', .79, 'boar'),
    'gnome': ('364e68', '827c67', 'c59c4d', 'c69d7c', .65, 'mechanical'),
    'pandaren': ('385e5c', '81867c', 'b6a252', 'ddd6c1', 1.03, 'mammoth'),
    'undead': ('40555c', '777e79', '9f9270', 'd5c7a3', .98, 'skeletal'),
    'demon': ('512936', '595364', '9f8555', '88534c', 1.1, 'beast'),
}
ROLES = ['line_infantry', 'spear_guard', 'archer', 'elite', 'scout', 'light_cavalry', 'heavy_cavalry', 'ram', 'catapult']
objects = []
collection = None
materials = {}

def mat(name, hexcolor, metal=0, rough=.55):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*tuple(int(hexcolor[i:i+2], 16) / 255 for i in (0, 2, 4)), 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = m.diffuse_color
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    return m

def register(obj, material, bone='spine'):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    collection.objects.link(obj)
    obj.data.materials.append(materials[material])
    for p in obj.data.polygons: p.use_smooth = True
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    objects.append(obj)
    return obj

def sphere(name, pos, scale, material, bone='spine', segments=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=10, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return register(obj, material, bone)

def box(name, pos, scale, material, bone='spine', bevel=.08):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Forged rounded edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('Weighted plate normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return register(obj, material, bone)

def rod(name, a, b, radius, material, bone='spine', tip=None, vertices=12):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=radius if tip is None else tip, depth=(b-a).length, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return register(obj, material, bone)

def curve(name, points, radius, material, bone='spine'):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.bevel_depth = radius
    data.bevel_resolution = 2
    data.resolution_u = 10
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for p, xyz in zip(spline.bezier_points, points):
        p.co = xyz
        p.handle_left_type = p.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return register(obj, material, bone)

def humanoid(faction, role, offset=0):
    skin = 'skin'
    head = (0, 0, 8.7+offset)
    sphere('Sculpted torso', (0,0,5.8+offset), (.7,1.02,1.45), skin)
    sphere('Hips', (0,0,4.25+offset), (.65,.84,.5), 'cloth', 'hips')
    for side in [-1, 1]:
        y = side*.52
        thigh = 'leg'+str(side)
        shin = 'shin'+str(side)
        if offset:
            knee=(1.15,y*1.75,3.7+offset); ankle=(.5,y*1.9,2.4+offset)
        else:
            knee=(.08,y,2.25); ankle=(.13,y,.75)
        rod('Trouser thigh', (0,y,4.3+offset), knee, .43, 'cloth', thigh, .32)
        sphere('Knee plate', knee, (.37,.4,.43), 'steel', shin)
        rod('Shin greave', knee, ankle, .3, 'steel', shin, .25)
        sphere('Leather boot', (ankle[0]+.26,ankle[1],ankle[2]-.38), (.61,.34,.36), 'leather', shin)
        shoulder=(0,side*1.08,6.75+offset); elbow=(.2,side*1.42,5.7+offset); hand=(.66,side*1.42,4.9+offset)
        arm='arm'+str(side); fore='fore'+str(side)
        rod('Upper arm', shoulder, elbow, .37, skin, arm, .29)
        rod('Forearm', elbow, hand, .3, skin, fore, .22)
        sphere('Gauntlet', hand, (.28,.26,.4), 'leather', fore)
        for finger in range(4): rod('Gloved fingers',(.82,side*(1.26+finger*.09),4.96+offset),(.89,side*(1.26+finger*.09),4.68+offset),.064,'leather',fore,.045,8)
        sphere('Thumb',(.5,side*1.38,4.85+offset),(.1,.12,.2),'leather',fore,12)
        sphere('Shoulder armor', shoulder, (.58,.52,.42), 'steel', arm)
        # Steel rims and hammered rivets remain legible in close inspection.
        for i in range(3): sphere('Shoulder rivet', (.37,side*(.85+i*.18),7+offset), (.08,.08,.08), 'gold', arm, 8)
    sphere('Neck', (0,0,7.7+offset), (.4,.4,.45), skin, 'head')
    sphere('Head anatomy', head, (.57,.6,.85), skin, 'head')
    sphere('Jaw', (.3,0,8.2+offset), (.4,.45,.32), skin, 'head')
    sphere('Nose bridge', (.54,0,8.73+offset), (.22,.14,.27), skin, 'head')
    for side in [-1,1]:
        sphere('Cheekbone',(.4,side*.35,8.6+offset),(.23,.21,.17),skin,'head')
        sphere('Nostril',(.66,side*.12,8.53+offset),(.035,.055,.035),'dark','head',8)
    for side in [-1,1]:
        sphere('Ear', (-.05,side*.57,8.65+offset), (.14,.16,.25), skin, 'head')
        sphere('Eye socket', (.48,side*.34,8.88+offset), (.14,.19,.11), 'leather', 'head', 12)
        sphere('Eye', (.59,side*.32,8.91+offset), (.07,.12,.055), 'ivory', 'head', 12)
        sphere('Pupil', (.642,side*.31,8.91+offset), (.045,.04,.043), 'dark', 'head', 8)
        rod('Brow', (.56,side*.18,9.06+offset), (.47,side*.49,9.03+offset), .075, skin, 'head')
        if faction in ['orc','demon']:
            curve('Original curved tusk', [(.51,side*.37,8.19+offset),(.76,side*.4,8.4+offset),(.74,side*.44,8.62+offset)], .085, 'ivory', 'head')
        if faction in ['elf','gnome']:
            rod('Pointed ear', (-.1,side*.56,8.7+offset),(-.28,side*.9,9.18+offset), .18, skin, 'head', 0)
    rod('Mouth', (.57,-.2,8.31+offset),(.57,.2,8.31+offset),.042,'dark','head')
    if faction in ['dwarf','persian','gnome']:
        sphere('Beard', (.37,0,8.04+offset),(.47,.47,.55),'hair','head')
        for y in [-.32,-.16,0,.16,.32]: rod('Beard braid',(.56,y,8.25+offset),(.52,y,7.6+offset),.075,'hair','head',.035)
    if faction=='pandaren':
        for side in [-1,1]: sphere('Bear ear',(-.05,side*.55,9.24+offset),(.26,.25,.28),'dark','head')
    # A layered cuirass with articulated lames and separate leather straps.
    for i in range(6):
        sphere('Overlapping cuirass lame', (.02,0,5.15+i*.3+offset),(.73,.99,.26),'steel')
        for y in [-.75,.75]: sphere('Cuirass rivet',(.61,y,5.2+i*.3+offset),(.075,.075,.075),'gold',segments=8)
    for side in [-1,1]:
        box('Chest strap', (.75,side*.51,6.2+offset),(.1,.18,1.63),'leather',bevel=.02)
        box('Tasset', (.61,side*.39,4.36+offset),(.16,.63,.92),'steel','hips')
    box('Belt',(.02,0,4.89+offset),(1.52,2.02,.25),'leather')
    box('Buckle',(.84,0,4.9+offset),(.12,.38,.3),'gold')
    sphere('Helmet dome',(-.05,0,9.12+offset),(.64,.66,.53),'steel','head')
    rod('Helmet rim',(-.09,-.67,8.98+offset),(-.09,.67,8.98+offset),.07,'gold','head')
    for side in [-1,1]: box('Cheek guard',(.22,side*.57,8.52+offset),(.43,.12,.72),'steel','head',.09)
    if role in ['elite','line_infantry','heavy_cavalry']:
        for i in range(10): sphere('Helmet crest',(-.47+i*.1,0,9.65+offset),(.11,.16,.31),'cloth','head',12)
    if faction=='demon':
        for side in [-1,1]: curve('Div horn',[(-.28,side*.47,9.36+offset),(-.8,side*.62,9.85+offset),(-.63,side*.77,10.45+offset)],.13,'ivory','head')
    # Cloth folds are geometry, not a flat image pasted behind the warrior.
    for i in range(9): rod('Cloak fold',(-.76,-.8+i*.2,7+offset),(-1.05,-1.05+i*.26,3.86+offset),.14,'cloth','spine',.19)
    if role=='archer':
        curve('Recurved bow',[(.9,-1.5,3.1+offset),(1.36,-1.5,4.3+offset),(1.55,-1.5,5+offset),(1.3,-1.5,6+offset),(.85,-1.5,6.9+offset)],.11,'wood','fore-1')
        rod('Bow string',(.9,-1.5,3.1+offset),(.85,-1.5,6.9+offset),.018,'ivory','fore-1')
        rod('Quiver',(-.98,.67,4.7+offset),(-.98,.67,6.8+offset),.33,'leather')
        for i in range(5):
            rod('Arrow shaft',(-1,.46+i*.1,6.2+offset),(-1,.46+i*.1,7.52+offset),.035,'wood')
            box('Arrow fletching',(-1,.46+i*.1,7.31+offset),(.18,.04,.3),'ivory',bevel=0)
    else:
        shieldpos=(.59,-1.72,5.35+offset)
        if faction=='roman' and role=='line_infantry':
            box('Scutum bronze rim',shieldpos,(.25,2.1,3.18),'gold','fore-1',.19)
            box('Scutum wood and paint',(.77,-1.72,5.35+offset),(.15,1.93,3.0),'cloth','fore-1',.16)
            for y in [-2.31,-1.13]: box('Shield lightning',(.87,y,5.35+offset),(.08,.13,2.3),'gold','fore-1',.01)
        else:
            rod('Round shield rim',(.53,-1.72,5.35+offset),(.72,-1.72,5.35+offset),1.34,'gold','fore-1',vertices=32)
            rod('Embossed shield',(.72,-1.72,5.35+offset),(.84,-1.72,5.35+offset),1.21,'cloth','fore-1',vertices=32)
            for i in range(12): sphere('Shield studs',(.86,-1.72+1.13*math.sin(i*math.tau/12),5.35+offset+1.13*math.cos(i*math.tau/12)),(.065,.065,.065),'gold','fore-1',8)
        sphere('Shield boss',(.9,-1.72,5.35+offset),(.2,.3,.3),'steel','fore-1')
        if role in ['spear_guard','light_cavalry','heavy_cavalry']:
            rod('Ash spear',(.69,1.42,2+offset),(.69,1.42,12+offset),.09,'wood','fore1')
            rod('Forged spear blade',(.69,1.42,12+offset),(.69,1.42,13.05+offset),.23,'steel','fore1',0)
        elif faction in ['orc','dwarf','demon']:
            rod('Axe haft',(.7,1.42,3.8+offset),(.7,1.42,7.9+offset),.13,'wood','fore1')
            blade=box('Forged axe head',(.7,1.42,7.3+offset),(.19,1.8,.93),'steel','fore1',.13)
            blade.rotation_euler.x=.18
        else:
            rod('Sword grip',(.7,1.42,4.4+offset),(.7,1.42,5.5+offset),.13,'leather','fore1')
            box('Sword guard',(.7,1.42,5.54+offset),(.15,.7,.16),'gold','fore1')
            rod('Sword blade',(.7,1.42,5.6+offset),(.7,1.42,8.2+offset),.16,'steel','fore1',0,4)

def mount(faction, role):
    kind=PROFILES[faction][5] if role=='heavy_cavalry' else ('wolf' if faction in ['orc','demon'] else 'elk' if faction=='elf' else 'horse')
    big=kind=='mammoth'
    s=1.35 if big else 1
    bodyz=3.15*s
    coat='hair' if kind not in ['skeletal','mechanical'] else 'ivory' if kind=='skeletal' else 'gold'
    sphere('Mount barrel',(-.7,0,bodyz),(2.35*s,.85*s,1.16*s),coat,'mount')
    sphere('Mount haunch',(-2.25*s,0,bodyz),(.9*s,.91*s,1.15*s),coat,'mount')
    sphere('Mount chest',(1.02*s,0,bodyz),(.83*s,.83*s,1.25*s),coat,'mount')
    for x in [-2.15*s,1.05*s]:
        for side in [-1,1]:
            bone='mountleg'+str(side)+('front' if x>0 else 'back')
            rod('Mount upper leg',(x,side*.62*s,bodyz),(x+.18,side*.67*s,1.6*s),.27*s,coat,bone,.2*s)
            rod('Mount lower leg',(x+.18,side*.67*s,1.6*s),(x+.27,side*.68*s,.35),.16*s,coat,bone,.12*s)
            sphere('Hoof',(x+.33,side*.68*s,.23),(.3*s,.25*s,.23),'dark',bone)
    sphere('Mount arched neck',(1.32*s,0,4.32*s),(.71*s,.61*s,1.53*s),coat,'mounthead')
    sphere('Mount skull',(2*s,0,5.3*s),(.83*s,.56*s,.71*s),coat,'mounthead')
    sphere('Mount muzzle',(2.65*s,0,4.93*s),(.71*s,.47*s,.46*s),coat,'mounthead')
    for side in [-1,1]:
        sphere('Mount eye',(2.2*s,side*.5*s,5.5*s),(.15,.075,.13),'dark','mounthead')
        rod('Mount ear',(1.62*s,side*.43*s,5.7*s),(1.55*s,side*.48*s,6.32*s),.22*s,coat,'mounthead',0)
        curve('Reins',[(2.9*s,side*.42*s,5*s),(1,side*.85,4.8*s),(.55,side*1.32,5.3*s)],.034,'leather','mount')
        if kind in ['mammoth','boar','beast']:
            curve('Great curved tusk',[(2.69*s,side*.39*s,4.9*s),(3.5*s,side*.65*s,3.8*s),(4.15*s,side*.83*s,4.3*s)],.18*s,'ivory','mounthead')
        if kind=='elk':
            curve('Antler',[ (1.77,side*.39,5.83),(1.8,side*.8,7.7),(2.3,side*1.14,8.4)],.1,'ivory','mounthead')
            for i in range(3): rod('Antler tine',(1.8,side*(.63+i*.15),6.5+i*.5),(2.3,side*(1+i*.15),7+i*.6),.07,'ivory','mounthead',0)
    if big:
        curve('Mammoth trunk',[(2.78*s,0,5.1*s),(3.3*s,0,3.8*s),(3.46*s,0,1.4*s),(3.9*s,0,1.1*s)],.36*s,coat,'mounthead')
        for side in [-1,1]: sphere('Broad mammoth ear',(1.75*s,side*.86*s,5.3*s),(.43*s,.25*s,.89*s),coat,'mounthead')
        for x in [-2,-1,0,1]:
            for side in [-1,1]:
                for z in [2.7,3.3]: rod('Fur tuft',(x*s,side*.82*s,z*s),(x*s-.25,side*1.01*s,(z-.9)*s),.17,coat,'mount',0,6)
    else:
        for i in range(12): sphere('Flowing mane',(.7+i*.08,0,4.55+i*.1),(.25,.28,.3),'dark','mounthead',8)
    curve('Tail',[(-2.76*s,0,3.6*s),(-3.28*s,0,2.8*s),(-3.4*s,0,1.2)],.12,'dark','mount')
    box('Woven saddle cloth',(-.54,0,4.27*s),(2.2,2.15,.15),'cloth','mount',.1)
    sphere('Leather saddle',(-.3,0,4.51*s),(1.08,.87,.3),'leather','mount')
    seat=4.51*s+.3
    offset=seat+.5-4.25
    for side in [-1,1]:
        # Strap, iron stirrup and rider boot share a fixed seated fit in bind pose.
        foot=(.76,side*.99,offset+2.02)
        rod('Stirrup leather',(-.2,side*.9,seat),(.46,side*.99,foot[2]),.055,'leather','mount')
        curve('Iron stirrup',[(foot[0]-.36,foot[1],foot[2]+.24),(foot[0]-.4,foot[1],foot[2]-.11),(foot[0]+.4,foot[1],foot[2]-.11),(foot[0]+.36,foot[1],foot[2]+.24)],.065,'steel','mount')
    if role=='heavy_cavalry':
        for x in [-2,-1,0,1]:
            for side in [-1,1]: sphere('Mount armor plate',(x*s,side*.86*s,3.65*s),(.66*s,.19,.61*s),'steel','mount')
    return offset

def siege(faction, role):
    if role=='catapult' and faction not in ['roman','spartan','persian','egyptian','gnome']:
        # Original living stonehurler, with chipped rock limbs and a boulder held at chest height.
        rocky=faction in ['dwarf','elf','undead']
        material='steel' if rocky else 'skin'
        for side in [-1,1]:
            sphere('Colossus foot',(.2,side*1.18,.7),(1.35,.78,.7),material,'shin'+str(side))
            rod('Colossus leg',(0,side*1.1,1),(0,side*1,5),.84,material,'leg'+str(side),1.05)
            rod('Colossus arm',(.2,side*2.2,8.5),(1.95,side*1.55,6.8),.76,material,'arm'+str(side),.68)
            sphere('Huge fingers',(2.1,side*1.1,6.8),(.63,.7,.75),material,'fore'+str(side))
        sphere('Colossus torso',(0,0,7.6),(1.6,2.15,2.75),material)
        sphere('Colossus head',(.17,0,11.1),(.95,1.02,1.35),material,'head')
        for side in [-1,1]: sphere('Colossus eyes',(.98,side*.52,11.4),(.16,.18,.11),'gold','head')
        sphere('Rough boulder',(2.2,0,7.37),(1.47,1.37,1.45),'stone',segments=12)
        for i in range(18):
            a=i*2.4
            sphere('Layered stone or muscle',(-.2+math.cos(a),math.sin(a)*1.75,5+i*.26),(.62,.66,.65),material)
        return
    for x in [-2.8,2.8]:
        for side in [-1,1]:
            rod('Iron wheel tire',(x,side*2.08,1.3),(x,side*2.35,1.3),1.2,'steel',vertices=24)
            rod('Wheel wooden hub',(x,side*2.35,1.3),(x,side*2.46,1.3),.28,'gold')
            for i in range(8):
                a=i*math.tau/8
                rod('Wheel spoke',(x,side*2.43,1.3),(x+math.sin(a),side*2.43,1.3+math.cos(a)),.075,'wood')
    for side in [-1,1]: box('Heavy chassis',(0,side*1.55,1.65),(7,.37,.5),'wood')
    if role=='ram':
        for x in [-2.6,2.6]:
            for side in [-1,1]: rod('Braced roof post',(x,side*1.55,1.65),(x,side*1.1,5.7),.18,'wood')
        for i in range(9):
            p=box('Armored pitched roof',(-3.2+i*.8,0,5.77),(.88,4.27,.25),'steel')
            p.rotation_euler.x=.08
        rod('Suspended ram',(-3.3,0,3.13),(4.1,0,3.13),.62,'wood')
        sphere('Bronze animal ram head',(4.15,0,3.13),(.85,.77,.72),'gold')
        for x in [-2,2]: rod('Suspension chain',(x,0,3.5),(x,0,5.7),.05,'steel')
    else:
        for side in [-1,1]:
            rod('Catapult A frame',(-2,side*1.4,1.7),(.1,side*1.4,5.25),.25,'wood')
            rod('Catapult A brace',(2,side*1.4,1.7),(.1,side*1.4,5.25),.25,'wood')
        rod('Throwing arm',(-2.9,0,2.45),(1.5,0,8.3),.24,'wood','arm1')
        sphere('Throwing bowl',(1.5,0,8.3),(.83,.8,.3),'steel','arm1')
        sphere('Stone ammunition',(1.5,0,8.7),(.59,.57,.59),'stone','arm1',12)
        rod('Axle',(.1,-1.8,4.8),(.1,1.8,4.8),.35,'wood')
        for i in range(12): rod('Torsion rope',(-.24+i*.055,-1.65,4.73),(-.24+i*.055,1.65,4.73),.033,'ivory')

def rig(role, offset=0):
    data=bpy.data.armatures.new(role+' skeleton')
    arm=bpy.data.objects.new(role+' rig',data)
    collection.objects.link(arm)
    bpy.context.view_layer.objects.active=arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    defs={'root':((0,0,0),(0,0,1),None),'hips':((0,0,4.25+offset),(0,0,4.8+offset),'mount' if offset else 'root'),
        'spine':((0,0,4.8+offset),(0,0,7.7+offset),'hips'),'head':((0,0,7.7+offset),(0,0,9.6+offset),'spine'),
        'mount':((0,0,2.4),(0,0,3.4),'root'),'mounthead':((1,0,3.8),(1.6,0,5.8),'mount')}
    for s in [-1,1]:
        defs['arm'+str(s)]=((0,s*1.08,6.75+offset),(.2,s*1.42,5.7+offset),'spine')
        defs['fore'+str(s)]=((.2,s*1.42,5.7+offset),(.66,s*1.42,4.9+offset),'arm'+str(s))
        knee=(1.15,s*.91,3.7+offset) if offset else (.08,s*.52,2.25)
        ankle=(.5,s*.99,2.4+offset) if offset else (.13,s*.52,.75)
        defs['leg'+str(s)]=((0,s*.52,4.25+offset),knee,'hips')
        defs['shin'+str(s)]=(knee,ankle,'leg'+str(s))
        for end,x in [('front',1.05),('back',-2.15)]: defs['mountleg'+str(s)+end]=((x,s*.62,3.2),(x,s*.62,.35),'mount')
    for name,(head,tail,parent) in defs.items():
        b=data.edit_bones.new(name); b.head=head; b.tail=tail
    for name,(head,tail,parent) in defs.items():
        if parent: data.edit_bones[name].parent=data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.select_set(False)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    mesh=bpy.context.object
    mesh.name=role+' geometry'
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    mod=mesh.modifiers.new('Peris deform rig','ARMATURE'); mod.object=arm
    mesh.parent=arm
    mesh['peris_role']=role
    if offset:
        mesh['peris_rider_hip_height']=4.25+offset
        mesh['peris_saddle_height']=4.25+offset-.5
        mesh['peris_seated_bind_pose']=True
    for clip in ['idle','walk','attack']:
        arm.animation_data_create()
        arm.animation_data.action=bpy.data.actions.new(role+'_'+clip)
        for frame in [1,7,13,19,25]:
            t=(frame-1)/24*math.tau
            for b in arm.pose.bones:
                b.rotation_mode='XYZ'
                amp=.025 if clip=='idle' else .32 if clip=='walk' else .18
                phase=0 if '-1' in b.name else math.pi
                b.rotation_euler=(0,0,0)
                if b.name.startswith(('leg','shin')): b.rotation_euler.z=0 if offset else math.sin(t+phase)*amp
                elif b.name.startswith('mountleg'): b.rotation_euler.z=math.sin(t+phase)*amp
                elif b.name.startswith(('arm','fore')): b.rotation_euler.z=math.sin(t+phase)*amp*(1.5 if clip=='attack' else .6)
                elif b.name=='spine': b.rotation_euler.x=math.sin(t)*amp*.16
                elif b.name=='head': b.rotation_euler.z=math.sin(t)*.025
                b.keyframe_insert('rotation_euler',frame=frame,group=b.name)
        track=arm.animation_data.nla_tracks.new(); track.name=role+'_'+clip
        track.strips.new(role+'_'+clip,1,arm.animation_data.action)
        track.mute=True
        arm.animation_data.action=None
    arm.scale=(PROFILES[faction][4],)*3 if role not in ['ram','catapult'] else (1,)*3
    bpy.ops.object.select_all(action='DESELECT')

for faction in args.factions:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cloth,steel,gold,skin,scale,animal=PROFILES[faction]
    materials={
        'cloth':mat('Dyed wool',cloth,0,.86),'steel':mat('Forged steel',steel,.78,.33),
        'gold':mat('Worked bronze',gold,.76,.4),'skin':mat('Skin',skin,0,.7),
        'leather':mat('Worn leather','30291f',0,.83),'wood':mat('Ash timber','73522c',0,.87),
        'ivory':mat('Ivory','d2c2a0',0,.61),'dark':mat('Dark detail','171912',0,.6),
        'hair':mat('Hair and mount coat','4d4131' if faction!='pandaren' else '242a25',0,.95),
        'stone':mat('Chipped stone','737c70',0,.95),
    }
    collection=bpy.data.collections.new('PERIS_EXPORT'); bpy.context.scene.collection.children.link(collection)
    bpy.context.scene.render.fps=24
    bpy.context.scene.frame_end=25
    for role in ROLES:
        objects=[]
        if role in ['ram','catapult']: siege(faction,role); offset=0
        else:
            offset=mount(faction,role) if role in ['scout','light_cavalry','heavy_cavalry'] else 0
            humanoid(faction,role,offset)
        rig(role,offset)
    bpy.context.scene.frame_set(1)
    source_root=ROOT/'assets'/'source'/'battle'
    if args.edition: source_root=source_root/args.edition
    source=source_root/('peris-'+faction+'-army.blend')
    raw=source_root/'exports'/(faction+'-army.raw.glb')
    source.parent.mkdir(parents=True,exist_ok=True)
    if source.exists() or raw.exists(): raise FileExistsError('Choose a new generation directory; source already exists.')
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    sys.argv=['export_glb.py','--','--collection','PERIS_EXPORT','--output',str(raw)]
    runpy.run_path(str(ROOT/'scripts'/'blender'/'export_glb.py'),run_name='__main__')
    print('PERIS_BUILT',faction,flush=True)
