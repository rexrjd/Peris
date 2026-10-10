"""Portrait-led human kits, retaining licensed anatomy and animation rigs.

Each nation has its own armor construction, headwear and shield outline. Scout,
archer, line, spear, elite and mounted kits have different practical silhouettes.
This module is applied before atlas packing in a new source edition.
"""
import math
import hashlib
import bpy
import numpy as np
from mathutils import Vector, Matrix
import roster_race_equipment as race

SKIN = {'roman':(.68,.48,.33),'spartan':(.67,.44,.29),'persian':(.55,.34,.22),'egyptian':(.44,.27,.16)}


def _surface(lib,name,color,kind='cloth',metal=0,rough=.8):
    """Small, non-directional wear; metal does not inherit cloth-like stripes."""
    key=('peris_human_surface',name)
    if key in lib.materials:return lib.materials[key]
    material=race._material(lib,name,color,kind,metal,rough)
    p=material.node_tree.nodes.get('Principled BSDF')
    image=p.inputs['Base Color'].links[0].from_node.image
    size=image.size[0]
    rng=np.random.default_rng(int.from_bytes(hashlib.sha256(name.encode()).digest()[:4],'little'))
    noise=rng.normal(0,.011,(size,size))
    yy,xx=np.mgrid[:size,:size]
    if kind=='cloth':
        wear=.96+noise+.006*np.sin(xx*math.pi*.5)+.006*np.sin(yy*math.pi*.5)
    else:
        wear=.97+noise*.6
        # Sparse abrasions and small oxidized specks keep the broad metal plane.
        for _ in range(20):
            x=int(rng.integers(size));y=int(rng.integers(size));length=int(rng.integers(4,22))
            wear[y,min(x,size-1):min(x+length,size)]-=.028
    pixels=np.ones((size,size,4),np.float32)
    pixels[:,:,:3]=np.clip(wear[:,:,None]*np.asarray(color),0,1)
    image.pixels.foreach_set(pixels.ravel());image.pack()
    lib.materials[key]=material
    return material


def _remove(lib,arm,role,terms):
    for obj in list(race._parts(lib,arm,role)):
        if any(term in obj.get('source_actor','') for term in terms):race._delete(lib,obj,role)


def _arc_plate(arm,role,chest,z,material,g,name='Articulated torso band',width=.43,depth=.32,height=.12):
    n=20;verts=[]
    for dz in [-height*.5,height*.5]:
        for i in range(n+1):
            t=-math.pi*.83+i/n*math.pi*1.66
            verts.append(chest+Vector((math.sin(t)*width,-math.cos(t)*depth,z+dz)))
    return race._mesh(name,verts,[(i,i+1,i+n+2,i+n+1) for i in range(n)],arm,role,'chest',material,g,True)


def _crest(arm,role,head,color,trim,g,height=.34):
    # A curved brush fan follows the cap, with separate fibers at the silhouette.
    h=head.head_local
    for i in range(15):
        t=-.75+i/14*1.5
        a=h+Vector((0,math.sin(t)*.28,.47+math.cos(t)*.08))
        b=h+Vector((0,math.sin(t)*.40,.47+math.cos(t)*height))
        g['cone']('Portrait crest horsehair tuft',a,b,.025,.010,arm,role,head.name,color)
    g['curved']('Crest worked metal spine',[h+Vector((0,math.sin(t)*.28,.47+math.cos(t)*.075)) for t in [-.75,-.4,0,.4,.75]],.035,arm,role,head.name,trim)


def _scarf(arm,role,chest,cloth,g):
    for i in range(2):
        g['curved']('Folded faction shoulder scarf',[chest+Vector((-.39,-.15,.55-i*.025)),chest+Vector((0,-.35,.49-i*.028)),chest+Vector((.39,-.15,.55-i*.025))],.025,arm,role,'chest',cloth)


def _nemes(arm,role,head,cloth,metal,g):
    """Egyptian linen crown cap; keep the original bare face visible."""
    h=head.head_local;columns=32;rows=7;points=[]
    for row in range(rows):
        theta=.025+row/(rows-1)*(math.pi*.5-.025)
        for col in range(columns):
            phi=col/columns*math.tau
            points.append(h+Vector((math.sin(theta)*math.sin(phi)*.30,math.sin(theta)*math.cos(phi)*.29+.02,.24+math.cos(theta)*.29)))
    faces=[(r*columns+c,r*columns+(c+1)%columns,(r+1)*columns+(c+1)%columns,(r+1)*columns+c) for r in range(rows-1) for c in range(columns)]
    race._mesh('Egyptian fitted blue linen crown cap',points,faces,arm,role,head.name,cloth,g,True)
    for theta in [.55,.85,1.15,1.5]:
        points=[h+Vector((math.sin(theta)*math.sin(i/32*math.tau)*.305,math.sin(theta)*math.cos(i/32*math.tau)*.295+.02,.24+math.cos(theta)*.295)) for i in range(33)]
        g['curved']('Egyptian narrow gold linen cap band',points,.009 if role in ['scout','archer'] else .014,arm,role,head.name,metal)
    if role in ['elite','heavy_cavalry']:
        g['curved']('Egyptian original raised cobra brow crest',[h+Vector((0,-.282,.24)),h+Vector((0,-.34,.39)),h+Vector((0,-.315,.49))],.030,arm,role,head.name,metal)
        g['ellipsoid']('Egyptian cobra broad worked hood',h+Vector((0,-.32,.43)),(.052,.019,.075),arm,role,head.name,metal)


def _weapon(arm,role,material,leather,g,style):
    hand=arm.data.bones['hand_R'];socket=next((b for b in arm.data.bones if b.name in ['prop-weapon_R','prop_weapon_R','weapon_R']),hand)
    m=socket.matrix_local.copy()
    m.translation=hand.matrix_local@Vector((0,hand.length*.58,.025))
    if style=='straight':outline=[(-.045,.14),(-.075,.85),(0,1.04),(.075,.85),(.045,.14)]
    elif style=='curved':outline=[(-.045,.14),(-.025,.55),(.03,.89),(.14,1.14),(.22,1.28),(.20,.95),(.13,.62),(.075,.14)]
    elif style=='khopesh':outline=[(-.04,.15),(.045,.15),(.07,.53),(.28,.65),(.39,.85),(.35,1.1),(.22,1.24),(.23,1.0),(.15,.81),(-.035,.66)]
    else:raise ValueError(style)
    n=len(outline);verts=[m@Vector((x,y,z)) for y in [-.017,.017] for x,z in outline]
    race._mesh('Portrait '+style+' forged blade',verts,[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],arm,role,hand.name,material,g)
    g['cone']('Hand fitted wrapped sword grip',m@Vector((0,0,-.16)),m@Vector((0,0,.14)),.040,.040,arm,role,hand.name,leather)
    g['cube']('Forged sword guard',m@Vector((0,0,.13)),(.22,.055,.045),arm,role,hand.name,material,.014)
    g['ellipsoid']('Sword metal pommel',m@Vector((0,0,-.18)),(.057,.042,.042),arm,role,hand.name,material)


def _shield(lib,arm,role,faction,cloth,metal,accent,g):
    if role in ['scout','archer']:return
    _remove(lib,arm,role,['/shields/'])
    socket=lib.socket(arm,'shield_arm' if role in ['light_cavalry','heavy_cavalry'] else 'shield');m=socket.matrix_local
    # Shapes are authored in the source prop's local plane, retaining its arm grip.
    if faction=='roman' and role not in ['light_cavalry','heavy_cavalry']:
        width=.33 if role=='spear_guard' else .43
        height=.67 if role=='spear_guard' else .56
        outline=[(-width*.86,-height),(-width,-height*.77),(-width,height*.77),(-width*.86,height),(width*.86,height),(width,height*.77),(width,-height*.77),(width*.86,-height)]
    else:
        rx=.46 if faction=='spartan' else .35;rz=.48 if faction=='spartan' else .58
        outline=[(math.sin(i*math.tau/24)*rx,math.cos(i*math.tau/24)*rz) for i in range(24)]
    n=len(outline);verts=[m@Vector((x,y,z)) for y in [-.065,.035] for x,z in outline]
    race._mesh('Portrait '+faction+' shield face',verts,[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],arm,role,socket.name,cloth,g)
    # A narrow metal rim and boss keep the painted shield readable at battle scale.
    points=[m@Vector((x,-.075,z)) for x,z in outline]+[m@Vector((*outline[0][:1],-.075,outline[0][1]))]
    g['curved']('Worked shield metal rim',points,.022,arm,role,socket.name,metal)
    g['ellipsoid']('Raised worked shield boss',m@Vector((0,-.11,0)),(.12,.060,.12),arm,role,socket.name,metal)
    if faction=='spartan':
        for a,b in [((-.23,-.07,-.28),(0,-.07,.28)),((0,-.07,.28),(.23,-.07,-.28))]:g['cone']('Original painted lambda shield mark',m@Vector(a),m@Vector(b),.021,.021,arm,role,socket.name,accent)
    elif faction=='egyptian':
        for angle in [-.9,-.6,-.3,.3,.6,.9]:
            g['cone']('Sun ray shield motif',m@Vector((math.sin(angle)*.19,-.08,math.cos(angle)*.14)),m@Vector((math.sin(angle)*.29,-.08,math.cos(angle)*.40)),.011,.011,arm,role,socket.name,metal)
    else:
        for side in [-1,1]:
            for i in range(4):g['cone']('Wing shield insignia',m@Vector((side*.08,-.08,.20-i*.03)),m@Vector((side*(.18+i*.04),-.08,.35-i*.11)),.016,.008,arm,role,socket.name,metal)
    # Inner leather grip is attached to the same source shield socket.
    g['cone']('Shield rear leather hand grip',m@Vector((-.10,.07,0)),m@Vector((.10,.07,0)),.034,.034,arm,role,socket.name,accent)


def apply(lib,arm,role,faction,mats,g,profile):
    if faction not in SKIN:raise ValueError(faction)
    light=role in ['archer','scout'];heavy=role in ['elite','heavy_cavalry'];mounted=role in ['scout','light_cavalry','heavy_cavalry']
    colors={'roman':dict(cloth=(.36,.045,.027),metal=(.57,.60,.63),accent=(.55,.37,.14)),
            'spartan':dict(cloth=(.32,.028,.025),metal=(.49,.31,.105),accent=(.72,.56,.26)),
            'persian':dict(cloth=(.035,.18,.23),metal=(.46,.31,.13),accent=(.04,.29,.33)),
            'egyptian':dict(cloth=(.035,.105,.23),metal=(.57,.38,.13),accent=(.72,.64,.44))}[faction]
    palette={name:_surface(lib,faction+' portrait '+name,value,'cloth' if name=='cloth' else 'metal',.88 if name=='metal' else .65 if name=='accent' else 0,.34 if name=='metal' else .43 if name=='accent' else .86) for name,value in colors.items()}
    cream=_surface(lib,faction+' woven ivory linen',(.66,.58,.43),'cloth',rough=.92)
    leather=_surface(lib,faction+' worn brown leather',(.16,.08,.038),'leather',rough=.9)
    skin=race._skin(lib,faction,SKIN[faction]);cloth=palette['cloth'];metal=palette['metal'];accent=palette['accent']
    chest=arm.data.bones['chest'].head_local;hip=arm.data.bones['hip'].head_local;head=lib.socket(arm,'head')
    mesh='m_tunic_short' if faction in ['roman','spartan','egyptian'] else 'm_tunic_long'
    bodies=race._body(lib,arm,role,faction,mesh,skin,cream if faction in ['persian','egyptian'] else cloth)
    # Short tunic meshes include uncovered legs and feet. Assign skin by the
    # actual deformation groups; long Persian trousers keep their linen.
    if faction in ['roman','spartan','egyptian']:
        for body in bodies:
            names={group.index:group.name for group in body.vertex_groups}
            for polygon in body.data.polygons:
                exposed=sum(group.weight for index in polygon.vertices for group in body.data.vertices[index].groups
                            if names[group.group].startswith(('thigh_','leg_','foot_')))/len(polygon.vertices)
                if exposed>.62 and polygon.center.z<hip.z-.70:polygon.material_index=1
    # Recreate purposeful headwear after removal of inherited historical props.
    if faction=='roman':helmet='celt_helmet_coolus_01' if light else 'rome_apulo_corinthian_e1' if heavy else 'hele_attic_r1' if role=='spear_guard' else 'rome_gallic_type_h_cent_transversal'
    elif faction=='spartan':helmet='hele_pilos' if light else 'hele_corinthian_leonidas' if heavy else 'hele_attic_e1' if role=='line_infantry' else 'hele_corinthian_e1'
    elif faction=='persian':helmet='pers_kidaris_loose' if light or role=='spear_guard' else 'pers_pilos_crested' if heavy else 'pers_conical_b1'
    else:helmet='pers_kidaris_loose' if light or role=='spear_guard' else 'pers_pilos_crested' if heavy else 'ptol_romanized_crest'
    if faction=='egyptian':_nemes(arm,role,head,cloth,metal,g)
    else:lib.actor('props/units/helmets/'+helmet+'.xml',role,arm,'helmet')
    if faction in ['roman','spartan','persian']:_scarf(arm,role,chest,cloth,g)
    if heavy or faction=='spartan' and not light:race._cape(arm,role,chest,hip,cloth,g)
    race._belt(arm,role,hip,.52,.38,leather,accent,g)
    if not mounted:race._skirt(arm,role,hip,.54,.41,.64,cream if faction in ['persian','egyptian'] else cloth,g,'Overlapping human tunic hem')
    # Economy scouts have leather, archers have light torsos, elite units retain
    # recognizable nation construction with more coverage and unique regalia.
    if faction=='roman' and not light:
        if role=='spear_guard':
            # Pole guard uses bronze scale construction and a tall scutum.
            for row in range(5):
                for col in range(7):
                    angle=(col-3)*.24
                    p=chest+Vector((math.sin(angle)*.46,-math.cos(angle)*.35,.46-row*.12))
                    race._leaf('Roman pole guard bronze scale',p,.15,.18,.025,arm,role,'chest',accent,g)
        elif heavy:
            for side in [-1,1]:g['ellipsoid']('Roman elite embossed bronze chest',chest+Vector((side*.18,-.30,.29)),(.23,.09,.27),arm,role,'chest',accent)
            for row in range(3):_arc_plate(arm,role,chest,.02-row*.13,metal,g,'Roman elite lower articulated plates',width=.48,depth=.37,height=.11)
        else:
            for row in range(5):_arc_plate(arm,role,chest,.55-row*.14,metal,g,'Roman curved segmented torso band',width=.48,depth=.37,height=.115)
        for side in [-1,1]:
            shoulder=arm.data.bones['shoulder_'+('L' if side>0 else 'R')]
            for row in range(4 if heavy else 3):g['cube']('Roman overlapping shoulder strip',shoulder.head_local.lerp(shoulder.tail_local,.35+row*.22)+Vector((side*.04,-.01,.07-row*.025)),(.15,.38,.075),arm,role,shoulder.name,metal,.025)
    elif faction=='spartan' and not light:
        if role=='spear_guard':
            _arc_plate(arm,role,chest,.18,cream,g,'Spartan layered linen thorax',width=.43,depth=.34,height=.76)
            for side in [-1,1]:g['cube']('Spartan linen shoulder yoke',chest+Vector((side*.28,-.08,.52)),(.16,.47,.09),arm,role,'chest',cream,.025)
            _arc_plate(arm,role,chest,-.18,metal,g,'Spartan thorax bronze lower binding',width=.44,depth=.35,height=.08)
        else:
            # Domed hammered bronze; elite gets mantle, regalia and a closed mask.
            for side in [-1,1]:
                g['ellipsoid']('Spartan hammered bronze pectoral',chest+Vector((side*.18,-.28,.26)),(.22,.095,.24),arm,role,'chest',metal)
                for row in range(2):g['ellipsoid']('Spartan shaped bronze abdominal plate',chest+Vector((side*.115,-.275,-.02-row*.14)),(.13,.065,.11),arm,role,'chest',metal)
    elif faction in ['persian','egyptian'] and not light:
        for row in range(6 if heavy else 2 if role=='spear_guard' else 4):
            for col in range(5):
                angle=(col-2)*.26;p=chest+Vector((math.sin(angle)*.39,-math.cos(angle)*.29-.035,.38-row*.12))
                race._leaf('Portrait overlapping '+faction+' scale',p,.15,.18,.027,arm,role,'chest',metal,g)
        if role=='spear_guard':
            _arc_plate(arm,role,chest,.0,cream,g,'Pole guard layered linen corselet',width=.42,depth=.34,height=.48)
        if faction=='egyptian':
            for i in range(9):
                angle=(i-4)*.18;p=chest+Vector((math.sin(angle)*.35,-math.cos(angle)*.29,.46))
                g['cube']('Egyptian blue and gold broad collar',p,(.12,.065,.17),arm,role,'chest',metal if i%3==0 else cloth,.010)
    else:
        for side in [-1,1]:g['cone']('Light leather diagonal shoulder harness',chest+Vector((side*.30,-.27,.42)),hip+Vector((-side*.23,-.29,.09)),.040,.040,arm,role,'chest',leather)
    if role=='scout':
        _remove(lib,arm,role,['/shields/','/weapons/','/quiver'])
        g['cube']('Scout independent map case',hip+Vector((.36,.01,-.18)),(.26,.13,.31),arm,role,'hip',leather,.030)
    elif role=='line_infantry' or (faction=='roman' and role=='elite'):
        _remove(lib,arm,role,['/weapons/'])
        _weapon(arm,role,metal,leather,g,'khopesh' if faction=='egyptian' else 'curved' if faction=='persian' else 'straight')
    _shield(lib,arm,role,faction,cloth,metal,accent,g)
    if heavy:
        g['ellipsoid']('Elite worked breast medallion',chest+Vector((0,-.35,.28)),(.105,.032,.105),arm,role,'chest',metal)
        for side in [-1,1]:g['ellipsoid']('Elite cloak worked brooch',chest+Vector((side*.31,-.245,.45)),(.075,.032,.075),arm,role,'chest',metal)
    for side in ['L','R']:
        forearm=arm.data.bones['forearm_'+side]
        if not (faction=='egyptian' and role=='scout'):g['cone']('Fitted forearm leather or metal bracer',forearm.head_local.lerp(forearm.tail_local,.55),forearm.head_local.lerp(forearm.tail_local,.88),.12,.10,arm,role,forearm.name,metal if heavy else leather)
        foot=arm.data.bones['foot_'+side];leg=arm.data.bones['leg_'+side]
        if faction in ['roman','spartan','egyptian']:
            g['cube']('Fitted leather sandal sole',foot.head_local+Vector((0,-.14,-.10)),(.24,.43,.085),arm,role,foot.name,leather,.020)
            for offset in [-.02,-.18]:g['curved']('Sandal leather foot strap',[foot.head_local+Vector((-.115,offset,-.02)),foot.head_local+Vector((0,offset,.055)),foot.head_local+Vector((.115,offset,-.02))],.025,arm,role,foot.name,leather)
            if not light and faction!='egyptian':
                before=set(race._parts(lib,arm,role))
                lib.actor('props/units/armor/greave_07_bronze_'+side.lower()+'.xml',role,arm,'leg_'+side)
                for item in set(race._parts(lib,arm,role))-before:
                    item.data.materials.clear();item.data.materials.append(metal)
        else:
            g['cube']('Persian rider soft leather shoe',foot.head_local+Vector((0,-.13,-.055)),(.25,.44,.15),arm,role,foot.name,leather,.055)
    arm['peris_human_portrait_kit']=faction+' '+role
    arm['peris_human_kit_scope']='Original portrait-led clothing/equipment prototype, licensed anatomy and source animation retained'
    import human_quality_details
    human_quality_details.apply(lib,arm,role,faction,palette,cream,leather,skin,g)
