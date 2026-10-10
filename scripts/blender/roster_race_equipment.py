"""Original racial clothing, armor and anatomy for the six non-Orc fantasies.

The licensed source skeleton, skin topology and its UVs remain editable. Imported
historical uniforms are replaced, so race identity is carried by anatomy and
construction rather than a recolored Greek or Persian outfit.
"""
import math
import bpy
import numpy as np
from mathutils import Vector, Matrix


def _bone(arm,name):
    found=arm.data.bones.get(name)
    if found:return found
    raise KeyError('Race equipment requires '+name)


def _parts(lib,arm,role):
    return [o for o in lib.groups.get(role,[]) if o.type=='MESH' and
            any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]


def _delete(lib,obj,role):
    lib.groups[role].remove(obj);bpy.data.objects.remove(obj,do_unlink=True)


def _material(lib,name,color,grain='cloth',metal=0,rough=.8):
    key=('peris_racial_surface',name)
    if key in lib.materials:return lib.materials[key]
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    size=256;yy,xx=np.mgrid[:size,:size]
    n=.86+.065*np.sin(xx*1.83+yy*.57)+.065*np.sin(xx*.091-yy*.073)
    if grain=='cloth':n+=.035*np.sin(xx*math.pi*.5)+.035*np.sin(yy*math.pi*.5)
    if grain=='wood':n=.72+.17*np.sin(xx*.18+np.sin(yy*.042))+.07*np.sin(xx*.87)
    if grain=='stone':n=.78+.14*np.sin(xx*.07+yy*.031)*np.sin(xx*.041-yy*.087)
    if grain=='fur':n=.80+.12*np.sin(xx*.071+np.sin(yy*.079))+.055*np.sin(xx*.77+yy*.23)
    pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=np.clip(n[:,:,None]*np.asarray(color),0,1)
    image=bpy.data.images.new(name+' surface',width=size,height=size,alpha=False)
    image.pixels.foreach_set(pixels.ravel());image.pack()
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    lib.materials[key]=m;return m


def _skin(lib,faction,color):
    key=('peris_racial_naked_skin',faction)
    if key in lib.materials:return lib.materials[key]
    source=lib.material({'textures':{'baseTex':'skeletal/gaul/naked_01.png'}},'peris/'+faction+' anatomical skin')
    mat=source.copy();mat.name='Peris '+faction+' exposed anatomy'
    p=mat.node_tree.nodes.get('Principled BSDF');tex=p.inputs['Base Color'].links[0].from_node
    image=tex.image.copy();a=np.empty(len(image.pixels),np.float32);image.pixels.foreach_get(a)
    a=a.reshape((-1,4));lum=a[:,:3].mean(axis=1)
    a[:,:3]=np.clip((.56+lum[:,None]*.66)*np.asarray(color),0,1);a[:,3]=1
    image.pixels.foreach_set(a.ravel());image.pack();tex.image=image;p.inputs['Roughness'].default_value=.88
    lib.materials[key]=mat;return mat


def _body(lib,arm,role,faction,mesh,skin,cloth):
    for obj in list(_parts(lib,arm,role)):
        path=obj.get('source_actor','')
        if path.startswith('units/') or any(s in path for s in ['/helmets/','/armor/','/greave','/boots/','/capes/']):
            _delete(lib,obj,role)
    objects=lib.dae('meshes/skeletal/new/'+mesh+'.dae')
    source=next(o for o in objects if o.type=='ARMATURE')
    for b in source.data.bones:
        target=arm.data.bones.get(b.name)
        if target and max(abs(b.matrix_local[r][c]-target.matrix_local[r][c]) for r in range(4) for c in range(4))>.05:
            raise ValueError('Racial body bind mismatch '+b.name)
    bodies=[]
    for obj in objects:
        if obj.type!='MESH':bpy.data.objects.remove(obj,do_unlink=True);continue
        for modifier in obj.modifiers:
            if modifier.type=='ARMATURE':modifier.object=arm
        obj.parent=arm;obj.name=role+' '+faction+' body'
        obj.data.materials.clear();obj.data.materials.append(cloth);obj.data.materials.append(skin)
        names={g.index:g.name for g in obj.vertex_groups}
        exposed=lambda n:n.startswith(('arm_','forearm_','hand_','finger','thumb'))
        for p in obj.data.polygons:
            weights={}
            for vi in p.vertices:
                for g in obj.data.vertices[vi].groups:weights[names[g.group]]=weights.get(names[g.group],0)+g.weight/len(p.vertices)
            p.material_index=1 if mesh=='m_naked' or sum(w for n,w in weights.items() if exposed(n))>.50 else 0
            p.use_smooth=True
        obj['peris_role']=role;obj['asset_license']='CC-BY-SA-3.0'
        obj['asset_author']='Wildfire Games; original Peris racial clothing and adaptation'
        obj['source_mesh']='skeletal/new/'+mesh+'.dae';obj['peris_race_uniform']=faction
        lib.groups[role].append(obj);bodies.append(obj)
    return bodies


def _mesh(name,verts,faces,arm,role,bone,mat,g,smooth=False):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(obj)
    uv=data.uv_layers.new(name='RaceSurface')
    for polygon in data.polygons:
        points=[Vector(verts[i]) for i in polygon.vertices]
        drop=max(range(3),key=lambda i:abs(polygon.normal[i]));axes=[i for i in range(3) if i!=drop]
        lo=[min(p[a] for p in points) for a in axes];hi=[max(p[a] for p in points) for a in axes]
        for loop,p in zip(polygon.loop_indices,points):uv.data[loop].uv=tuple((p[a]-lo[j])/max(.001,hi[j]-lo[j]) for j,a in enumerate(axes))
    obj=g['mesh_prop'](obj,arm,role,bone,mat)
    for p in obj.data.polygons:p.use_smooth=smooth
    return obj


def _leaf(name,c,w,h,depth,arm,role,bone,mat,g):
    # A domed pointed plate, rather than a square shoulder collar.
    offsets=[(0,0,-h*.55),(-w*.45,0,-h*.13),(-w*.5,0,h*.2),(0,0,h*.52),
             (w*.5,0,h*.2),(w*.45,0,-h*.13),(0,-depth,0)]
    verts=[Vector(c)+Vector(v) for v in offsets]
    return _mesh(name,verts,[(i,(i+1)%6,6) for i in range(6)],arm,role,bone,mat,g)


def _skirt(arm,role,center,rx,ry,length,mat,g,name='Overlapping robe wrap'):
    n=16;verts=[]
    for ring in range(2):
        for i in range(n):
            t=math.tau*i/n;f=1 if ring==0 else 1.14
            z=.14 if ring==0 else -length+(.035 if i%2 else 0)
            verts.append(Vector(center)+Vector((math.sin(t)*rx*f,math.cos(t)*ry*f,z)))
    return _mesh(name,verts,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],arm,role,'hip',mat,g)


def _cape(arm,role,chest,hip,mat,g):
    verts=[];n=6
    for row in range(n):
        t=row/(n-1);c=Vector(chest).lerp(Vector(hip)-Vector((0,0,.65)),t)
        width=.43+t*.17
        for col in range(5):
            x=(col-2)/2*width
            verts.append(c+Vector((x,.25+.12*t+.025*math.cos(col*2.4),.23*(1-t))))
    torn='undead' in mat.name.lower()
    faces=[(r*5+c,r*5+c+1,(r+1)*5+c+1,(r+1)*5+c) for r in range(n-1) for c in range(4)
           if not (torn and r>=n-2 and c in [0,2])]
    obj=_mesh('Flowing racial cloak',verts,faces,arm,role,'chest',mat,g,True)
    chestgroup=obj.vertex_groups['chest'];hipgroup=obj.vertex_groups.new(name='hip')
    for row in range(n):
        ids=list(range(row*5,row*5+5));t=row/(n-1)
        chestgroup.add(ids,1-t,'REPLACE');hipgroup.add(ids,t,'REPLACE')


def _belt(arm,role,hip,rx,ry,mat,trim,g):
    n=16;verts=[]
    for z in [-.02,.13]:
        for i in range(n):
            t=math.tau*i/n;verts.append(hip+Vector((math.sin(t)*rx,math.cos(t)*ry,z)))
    _mesh('Broad worked war belt',verts,[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],arm,role,'hip',mat,g)
    g['cube']('Belt worked buckle',hip+Vector((0,-ry-.025,.05)),(.19,.065,.16),arm,role,'hip',trim,.025)


def _boots(arm,role,mat,trim,g,large=1):
    for side in ['L','R']:
        foot=_bone(arm,'foot_'+side);leg=_bone(arm,'leg_'+side)
        center=foot.head_local+Vector((0,-.13,-.09))
        g['cube']('Enclosed racial heavy boot',center,(.25*large,.46*large,.24*large),arm,role,foot.name,mat,.06)
        g['cone']('Worked boot shaft',leg.tail_local+Vector((0,0,-.02)),leg.tail_local+Vector((0,0,.27)),.145*large,.13*large,arm,role,leg.name,mat)
        g['cone']('Boot upper binding',leg.tail_local+Vector((0,0,.20)),leg.tail_local+Vector((0,0,.26)),.151*large,.151*large,arm,role,leg.name,trim)


def _head(lib,arm,role,faction,mats,g,palette):
    head=lib.socket(arm,'head');h=head.head_local.copy()
    skin=palette['skin'];metal=palette['metal'];dark=mats['dark'];hair=palette['hair']
    for obj in list(_parts(lib,arm,role)):
        if any(x in obj.get('source_actor','') for x in ['/helmets/','/hair/']):_delete(lib,obj,role)
    if faction=='elf':
        for side in [-1,1]:
            ear=[h+Vector((side*.20,-.005,.08)),h+Vector((side*.45,.055,.23)),h+Vector((side*.28,.06,-.04)),h+Vector((side*.26,-.028,.08))]
            _mesh('Visible pointed elven ear',ear,[(0,1,3),(1,2,3),(2,0,3)],arm,role,head.name,skin,g,True)
        # Thin open circlet stays behind the brows and leaves the face clear.
        points=[h+Vector((math.sin(t)*.24,-math.cos(t)*.22,.24)) for t in np.linspace(0,math.tau,13)]
        g['curved']('Open silver elven circlet',points,.026,arm,role,head.name,metal)
        _leaf('Circlet leaf jewel',h+Vector((0,-.248,.25)),.105,.18,.025,arm,role,head.name,palette['accent'],g)
        for i in range(13):
            t=math.pi*.36+i/(12)*math.pi*1.28
            p=h+Vector((math.sin(t)*.225,-math.cos(t)*.20,.20))
            g['curved']('Long flowing elven hair',[p,p+Vector((0,.035,-.22)),p+Vector((-.015,.07,-.54)),p+Vector((-.025,.09,-.70))],.037,arm,role,head.name,hair)
        if role in ['elite','heavy_cavalry']:
            for side in [-1,1]:
                a=h+Vector((side*.22,.055,.26))
                g['curved']('Elven living branch crown',[a,a+Vector((side*.12,.04,.26)),a+Vector((side*.10,.02,.46))],.025,arm,role,head.name,metal)
                _leaf('Crown silver leaf',a+Vector((side*.15,-.025,.28)),.14,.24,.035,arm,role,head.name,metal,g)
    elif faction=='dwarf':
        # Open iron cap with a nasal guard; heavy beard remains exposed below.
        verts=[];n=12
        for z,r in [(.22,.24),(.44,.18),(.51,.02)]:
            for i in range(n):
                t=math.tau*i/n;verts.append(h+Vector((math.sin(t)*r,math.cos(t)*r,z)))
        _mesh('Open ridged Dwarven iron helmet',verts,[(r*n+i,r*n+(i+1)%n,(r+1)*n+(i+1)%n,(r+1)*n+i) for r in range(2) for i in range(n)],arm,role,head.name,metal,g)
        g['cube']('Dwarf helmet brow rim',h+Vector((0,-.25,.24)),(.45,.045,.075),arm,role,head.name,palette['accent'],.015)
        g['cube']('Dwarf narrow nasal guard',h+Vector((0,-.26,.10)),(.055,.05,.27),arm,role,head.name,metal,.010)
        for i in range(9):
            x=(i-4)*.068;p=h+Vector((x,-.225,-.06))
            g['curved']('Long Dwarven braided beard',[p,p+Vector((x*.12,-.045,-.23)),h+Vector((x*.6,-.22,-.58))],.061,arm,role,head.name,hair)
            g['cone']('Dwarf beard rune ring',h+Vector((x*.6,-.22,-.49)),h+Vector((x*.6,-.22,-.57)),.068,.068,arm,role,head.name,palette['accent'])
    elif faction=='gnome':
        for obj in _parts(lib,arm,role):
            if '/heads/' in obj.get('source_actor',''):
                for v in obj.data.vertices:v.co=h+(v.co-h)*Vector((1.19,1.16,1.13))
        g['ellipsoid']('Gnome round exposed nose',h+Vector((0,-.27,.055)),(.094,.105,.083),arm,role,head.name,skin)
        # Low open leather cap, goggles and exposed round face.
        g['ellipsoid']('Low gnome engineer cap',h+Vector((0,.015,.32)),(.26,.225,.14),arm,role,head.name,palette['cloth'])
        for side in [-1,1]:
            p=h+Vector((side*.135,-.25,.20))
            g['ellipsoid']('Brass engineer goggle frame',p,(.123,.044,.096),arm,role,head.name,metal)
            g['ellipsoid']('Visible amber goggle lens',p+Vector((0,-.035,0)),(.092,.023,.065),arm,role,head.name,palette['accent'])
        g['cube']('Goggle bridge',h+Vector((0,-.28,.20)),(.072,.04,.04),arm,role,head.name,metal,.008)
        for i in range(3):
            x=(i-1)*.10
            g['curved']('Gnome short forked beard',[h+Vector((x,-.21,-.09)),h+Vector((x*.7,-.25,-.23)),h+Vector((x*.3,-.20,-.35))],.042,arm,role,head.name,hair)
    elif faction=='pandaren':
        # Retain the source head topology under a broad bear cranium/muzzle.
        for obj in _parts(lib,arm,role):
            if '/heads/' in obj.get('source_actor',''):
                obj.data.materials.clear();obj.data.materials.append(skin)
                for v in obj.data.vertices:v.co=h+(v.co-h)*Vector((1.24,1.17,1.12))
        h+=Vector((0,0,.12))
        g['ellipsoid']('Broad panda fur cranium',h+Vector((0,.025,.10)),(.29,.235,.30),arm,role,head.name,skin)
        g['ellipsoid']('Panda rounded muzzle',h+Vector((0,-.235,-.075)),(.255,.165,.15),arm,role,head.name,skin)
        g['ellipsoid']('Panda black nose',h+Vector((0,-.385,-.025)),(.095,.040,.063),arm,role,head.name,dark)
        for side in [-1,1]:
            g['ellipsoid']('Panda round black ear',h+Vector((side*.255,.02,.30)),(.125,.075,.125),arm,role,head.name,dark)
            g['ellipsoid']('Panda black eye fur patch',h+Vector((side*.13,-.215,.14)),(.11,.030,.097),arm,role,head.name,palette['fur'])
            g['ellipsoid']('Panda eye',h+Vector((side*.13,-.248,.15)),(.039,.012,.022),arm,role,head.name,mats['ivory'])
            g['ellipsoid']('Panda pupil',h+Vector((side*.13,-.261,.15)),(.018,.006,.019),arm,role,head.name,dark)
    elif faction=='undead':
        for obj in list(_parts(lib,arm,role)):
            if '/heads/' in obj.get('source_actor',''):_delete(lib,obj,role)
        ivory=palette['skin']
        g['ellipsoid']('Undead cranial skull vault',h+Vector((0,.028,.185)),(.23,.19,.24),arm,role,head.name,ivory)
        for side in [-1,1]:
            g['ellipsoid']('Deep empty skull eye socket',h+Vector((side*.102,-.164,.10)),(.081,.035,.073),arm,role,head.name,dark)
            g['curved']('Skull orbital bone rim',[h+Vector((side*.033,-.173,.17)),h+Vector((side*.105,-.192,.188)),h+Vector((side*.18,-.166,.12)),h+Vector((side*.16,-.169,.04))],.022,arm,role,head.name,ivory)
            g['cone']('Angular exposed skull cheekbone',h+Vector((side*.16,-.155,.045)),h+Vector((side*.205,-.12,-.025)),.048,.038,arm,role,head.name,ivory)
        _mesh('Triangular skull nasal cavity',[h+Vector((-.048,-.193,.046)),h+Vector((.048,-.193,.046)),h+Vector((0,-.208,-.044))],[(0,1,2)],arm,role,head.name,dark,g)
        g['curved']('Open skeletal mandible',[h+Vector((-.18,-.10,-.015)),h+Vector((-.15,-.185,-.16)),h+Vector((0,-.218,-.185)),h+Vector((.15,-.185,-.16)),h+Vector((.18,-.10,-.015))],.037,arm,role,head.name,ivory)
        for i in range(8):
            x=(i-3.5)*.036
            g['cube']('Individual exposed skull tooth',h+Vector((x,-.214,-.085)),(.030,.040,.069),arm,role,head.name,ivory,.005)
        if role in ['elite','heavy_cavalry']:
            for side in [-1,1]:g['cone']('Tarnished crown spike',h+Vector((side*.16,.025,.32)),h+Vector((side*.24,.02,.58)),.053,.006,arm,role,head.name,metal)
    elif faction=='demon':
        for obj in list(_parts(lib,arm,role)):
            if '/heads/' in obj.get('source_actor',''):_delete(lib,obj,role)
        # Fused cranium, muzzle, brow and jaw planes produce a continuous beast face.
        pieces=[]
        for pos,size in [((0,.015,.13),(.23,.20,.28)),((0,-.08,-.06),(.25,.19,.18)),
                         ((0,-.21,.06),(.15,.115,.13)),((-.13,-.14,.20),(.17,.085,.055)),
                         ((.13,-.14,.20),(.17,.085,.055)),((-.17,-.09,.025),(.11,.11,.12)),((.17,-.09,.025),(.11,.11,.12))]:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,location=h+Vector(pos))
            obj=bpy.context.object;obj.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);pieces.append(obj)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in pieces:obj.select_set(True)
        bpy.context.view_layer.objects.active=pieces[0];bpy.ops.object.join();face=pieces[0]
        remesh=face.modifiers.new('Continuous original demon face','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.030
        bpy.ops.object.modifier_apply(modifier=remesh.name)
        smooth=face.modifiers.new('Facial planes','SMOOTH');smooth.factor=.35;smooth.iterations=2;bpy.ops.object.modifier_apply(modifier=smooth.name)
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.025);bpy.ops.object.mode_set(mode='OBJECT')
        face.name='Original monstrous demon face';g['mesh_prop'](face,arm,role,head.name,skin)
        for side in [-1,1]:
            p=h+Vector((side*.105,-.195,.142))
            g['ellipsoid']('Demon hollow eye socket',p,(.077,.020,.045),arm,role,head.name,dark)
            g['ellipsoid']('Demon ember eye',p+Vector((0,-.02,0)),(.045,.011,.017),arm,role,head.name,palette['accent'])
            g['curved']('Swept infernal horn',[h+Vector((side*.18,.035,.31)),h+Vector((side*.35,.075,.46)),h+Vector((side*.40,.16,.71)),h+Vector((side*.30,.20,.86))],.075,arm,role,head.name,dark)
            g['cone']('Demon lower jaw fang',h+Vector((side*.13,-.235,-.08)),h+Vector((side*.17,-.25,.07)),.048,.003,arm,role,head.name,mats['ivory'])
        g['curved']('Demon deep mouth crease',[h+Vector((-.17,-.241,-.07)),h+Vector((0,-.268,-.095)),h+Vector((.17,-.241,-.07))],.012,arm,role,head.name,dark)


def _skeleton(arm,role,mat,g):
    for side in ['L','R']:
        for name in ['arm_'+side,'forearm_'+side,'thigh_'+side,'leg_'+side]:
            b=_bone(arm,name);a=b.head_local;bpoint=b.tail_local
            offset=Vector((.025 if side=='L' else -.025,0,0))
            g['cone']('Exposed anatomical long bone',a+offset,bpoint+offset,.055 if name.startswith(('thigh','arm')) else .038,.040,arm,role,b.name,mat)
            if name.startswith(('forearm','leg')):g['cone']('Paired anatomical narrow bone',a-offset,bpoint-offset,.026,.025,arm,role,b.name,mat)
            g['ellipsoid']('Bone joint '+name,a,(.065,)*3,arm,role,b.name,mat)
        hand=_bone(arm,'hand_'+side)
        for i in range(4):
            p=hand.head_local+Vector(((i-1.5)*.051,0,0))
            g['cone']('Skeletal hand metacarpal',p,p+Vector((0,-.17,-.10)),.022,.017,arm,role,hand.name,mat)
        foot=_bone(arm,'foot_'+side)
        for i in range(3):
            p=foot.head_local+Vector(((i-1)*.065,-.06,-.06))
            g['cone']('Skeletal foot metatarsal',p,p+Vector((0,-.18,-.025)),.022,.018,arm,role,foot.name,mat)
    hip=_bone(arm,'hip');chest=_bone(arm,'chest');neck=_bone(arm,'neck')
    g['cone']('Articulated exposed spinal column',hip.head_local,chest.head_local+Vector((0,0,.24)),.052,.045,arm,role,chest.name,mat)
    for i in range(7):
        c=chest.head_local+Vector((0,.035,.29-i*.095));width=.31-.012*abs(i-2)
        for side in [-1,1]:g['curved']('Anatomical rib '+str(i),[c,c+Vector((side*width,.03,-.018)),c+Vector((side*width,-.14,-.067)),c+Vector((side*.095,-.205,-.098))],.024,arm,role,chest.name,mat)
    for side in [-1,1]:
        g['curved']('Exposed clavicle',[neck.head_local+Vector((0,0,-.09)),chest.head_local+Vector((side*.28,-.045,.38)),_bone(arm,'arm_'+('L' if side>0 else 'R')).head_local],.037,arm,role,chest.name,mat)
        p=hip.head_local
        g['curved']('Skeletal pelvic ring',[p+Vector((side*.08,-.02,.11)),p+Vector((side*.28,.04,.05)),p+Vector((side*.31,-.035,-.10)),p+Vector((side*.11,-.07,-.17))],.045,arm,role,'hip',mat)


def _crossbow(lib,arm,role,wood,metal,g):
    for obj in list(_parts(lib,arm,role)):
        if any(s in obj.get('source_actor','') for s in ['/shields/','/quiver','/weapons/bow_']) or 'Crossbow ' in obj.name:_delete(lib,obj,role)
    bone=lib.socket(arm,'weapon_bow');m=bone.matrix_local
    # Socket of the archer's left hand: stock long axis, transverse steel limbs.
    p=lambda v:m@Vector(v)
    g['cube']('Crossbow carved substantial timber stock',p((0,.06,.01)),(.14,.89,.12),arm,role,bone.name,wood,.025)
    for side in [-1,1]:g['curved']('Crossbow transverse worked steel limb',[p((0,-.27,.03)),p((side*.28,-.32,.03)),p((side*.53,-.19,.015))],.035,arm,role,bone.name,metal)
    g['curved']('Crossbow taut bowstring',[p((-.53,-.19,.015)),p((0,.28,.025)),p((.53,-.19,.015))],.008,arm,role,bone.name,wood)
    g['cone']('Crossbow loaded visible bolt',p((0,-.39,.095)),p((0,.37,.095)),.012,.012,arm,role,bone.name,wood)
    g['cube']('Crossbow brass trigger lock',p((0,.19,-.055)),(.09,.11,.10),arm,role,bone.name,metal,.012)
    g['curved']('Crossbow loading stirrup',[p((-.10,-.45,.01)),p((-.10,-.57,.01)),p((.10,-.57,.01)),p((.10,-.45,.01))],.022,arm,role,bone.name,metal)
    hip=_bone(arm,'hip').head_local
    g['cube']('Crossbow leather bolt case',hip+Vector((.31,.07,-.19)),(.14,.16,.47),arm,role,'hip',wood,.035)


def _shield(lib,arm,role,faction,palette,g):
    if role not in ['line_infantry','spear_guard','elite','light_cavalry','heavy_cavalry']:return
    for obj in list(_parts(lib,arm,role)):
        if '/shields/' in obj.get('source_actor',''):_delete(lib,obj,role)
    bone=lib.socket(arm,'shield_arm' if role.endswith('cavalry') else 'shield');m=bone.matrix_local
    if faction=='elf':
        outline=[(0,-.60),(-.29,-.29),(-.34,.18),(-.22,.48),(0,.63),(.22,.48),(.34,.18),(.29,-.29)]
    elif faction=='dwarf':outline=[(-.44,-.43),(-.44,.35),(-.28,.53),(.28,.53),(.44,.35),(.44,-.43),(.26,-.54),(-.26,-.54)]
    elif faction=='pandaren':outline=[(-.36,-.42),(-.40,.31),(-.22,.51),(.22,.51),(.40,.31),(.36,-.42),(0,-.54)]
    elif faction=='gnome':outline=[(math.sin(i*math.tau/12)*.38,math.cos(i*math.tau/12)*.38) for i in range(12)]
    elif faction=='demon':outline=[(0,-.66),(-.45,-.28),(-.32,.39),(-.16,.18),(0,.66),(.16,.18),(.32,.39),(.45,-.28)]
    else:outline=[(-.34,-.48),(-.37,.36),(-.23,.52),(.12,.43),(.35,.49),(.32,-.48)]
    verts=[m@Vector((x,y,z+.12)) for y in [-.065,.025] for x,z in outline];n=len(outline)
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    _mesh(faction+' distinctive worked shield',verts,faces,arm,role,bone.name,palette['metal'],g)
    g['ellipsoid']('Racial shield worked boss',m@Vector((0,-.092,.14)),(.12,.04,.12),arm,role,bone.name,palette['accent'])
    if faction in ['dwarf','gnome']:
        for i in range(4):
            x=(i-1.5)*.11
            g['cube']('Shield engraved geometric rune',m@Vector((x,-.10,.13)),(.035,.027,.24 if i%2 else .15),arm,role,bone.name,palette['accent'],.008)
    elif faction=='elf':
        g['curved']('Leaf shield central silver vein',[m@Vector((0,-.105,-.39)),m@Vector((0,-.11,.15)),m@Vector((0,-.10,.65))],.019,arm,role,bone.name,palette['accent'])


def _blade(lib,arm,role,faction,palette,g):
    if role!='line_infantry' or faction not in ['elf','pandaren']:return
    for obj in list(_parts(lib,arm,role)):
        if '/weapons/' in obj.get('source_actor',''):_delete(lib,obj,role)
    bone=lib.socket(arm,'weapon_R');m=bone.matrix_local
    if faction=='elf':outline=[(-.035,.10),(-.057,.65),(-.025,1.18),(.055,1.41),(.15,1.22),(.12,.64),(.07,.10)]
    else:outline=[(-.04,.08),(-.04,.59),(.09,.96),(.23,1.20),(.31,1.14),(.23,.87),(.10,.56),(.06,.08)]
    verts=[m@Vector((x,y,z)) for y in [-.025,.025] for x,z in outline];n=len(outline)
    _mesh('Elven graceful leaf blade' if faction=='elf' else 'Panda curved jade guard dao',verts,
          [tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],arm,role,bone.name,palette['metal'],g)
    g['cone']('Racial sword wrapped hilt',m@Vector((0,0,-.22)),m@Vector((0,0,.12)),.045,.045,arm,role,bone.name,palette['cloth'])
    g['cube']('Racial shaped sword guard',m@Vector((0,0,.11)),(.27,.065,.045),arm,role,bone.name,palette['accent'],.012)


def apply(lib,arm,role,faction,mats,g,profile):
    colors={
      'elf':dict(cloth=(.055,.20,.115),metal=(.48,.61,.55),accent=(.20,.44,.24),hair=(.62,.54,.31),skin=(.77,.70,.57)),
      'dwarf':dict(cloth=(.28,.055,.035),metal=(.16,.20,.22),accent=(.47,.30,.11),hair=(.37,.17,.065),skin=(.64,.43,.29)),
      'gnome':dict(cloth=(.30,.055,.045),metal=(.53,.35,.13),accent=(.16,.35,.36),hair=(.31,.17,.09),skin=(.71,.49,.32)),
      'pandaren':dict(cloth=(.30,.045,.035),metal=(.10,.29,.22),accent=(.59,.43,.18),hair=(.035,.035,.029),skin=(.89,.86,.76)),
      'undead':dict(cloth=(.15,.095,.21),metal=(.12,.145,.13),accent=(.36,.31,.17),hair=(.05,.065,.055),skin=(.66,.63,.48)),
      'demon':dict(cloth=(.16,.035,.023),metal=(.13,.10,.11),accent=(.88,.23,.04),hair=(.035,.024,.02),skin=(.43,.095,.067)),
    }[faction]
    palette={name:_material(lib,faction+' '+name,c,'fur' if name=='hair' else 'cloth' if name=='cloth' else 'stone' if name=='skin' and faction=='undead' else 'iron',.7 if name=='metal' else 0,.5 if name=='metal' else .87) for name,c in colors.items()}
    palette['skin']=_skin(lib,faction,colors['skin']) if faction!='undead' else palette['skin']
    palette['fur']=_material(lib,faction+' dark fur',(.022,.024,.020),'fur',rough=.96)
    mesh='m_tunic_long' if faction=='elf' else 'm_pants' if faction=='dwarf' else 'm_tunic_short' if faction=='gnome' else 'm_naked'
    bodies=_body(lib,arm,role,faction,mesh,palette['skin'],palette['cloth'])
    if role=='archer':
        for obj in list(_parts(lib,arm,role)):
            if '/shields/' in obj.get('source_actor',''):_delete(lib,obj,role)
    hip=_bone(arm,'hip').head_local.copy();chest=_bone(arm,'chest').head_local.copy()
    if faction=='undead':
        for obj in bodies:_delete(lib,obj,role)
        _skeleton(arm,role,palette['skin'],g)
    if faction=='pandaren':
        # Broad fur-covered barrel mass and enlarged paws, with bone weights intact.
        for obj in bodies:
            obj.data.materials.append(palette['fur']);names={vg.index:vg.name for vg in obj.vertex_groups}
            for vertex in obj.data.vertices:
                weights={names[w.group]:w.weight for w in vertex.groups}
                torso=sum(w for n,w in weights.items() if n in ['chest','spine','hip'])
                vertex.co.x*=1+torso*.22;vertex.co.y*=1+torso*.30
            for polygon in obj.data.polygons:
                limb=0
                for vi in polygon.vertices:
                    limb+=sum(w.weight for w in obj.data.vertices[vi].groups if names[w.group].startswith(('arm_','forearm_','hand_','thigh_','leg_','foot_')))/len(polygon.vertices)
                polygon.material_index=2 if limb>.46 else 1
        for side in ['L','R']:
            hand=_bone(arm,'hand_'+side);foot=_bone(arm,'foot_'+side)
            g['ellipsoid']('Panda broad furry paw hand',hand.head_local+Vector((0,-.10,-.055)),(.16,.21,.13),arm,role,hand.name,palette['fur'])
            g['ellipsoid']('Panda sturdy furry paw foot',foot.head_local+Vector((0,-.16,-.09)),(.17,.27,.14),arm,role,foot.name,palette['fur'])
        _skirt(arm,role,hip,.53,.36,.60,palette['cloth'],g,'Panda broad jade robe wrap')
    if faction=='demon':
        for obj in bodies:
            names={vg.index:vg.name for vg in obj.vertex_groups}
            for vertex in obj.data.vertices:
                weights={names[w.group]:w.weight for w in vertex.groups}
                torso=sum(w for n,w in weights.items() if n in ['chest','spine'])
                vertex.co.x*=1+torso*.13;vertex.co.y*=1+torso*.12
        _skirt(arm,role,hip,.37,.27,.48,palette['cloth'],g,'Infernal torn waist wrap')
        for side in ['L','R']:
            hand=_bone(arm,'hand_'+side);foot=_bone(arm,'foot_'+side)
            for i in range(3):
                p=hand.head_local+Vector(((i-1)*.085,-.06,-.025))
                g['curved']('Demon hooked hand talon',[p,p+Vector((0,-.15,-.03)),p+Vector((0,-.23,-.11))],.030,arm,role,hand.name,mats['ivory'])
            for split in [-1,1]:g['cube']('Demon cloven anatomical hoof',foot.head_local+Vector((split*.095,-.15,-.09)),(.16,.40,.26),arm,role,foot.name,mats['dark'],.045)
    if faction in ['elf','dwarf','gnome']:_boots(arm,role,palette['cloth'],palette['metal'],g,1.14 if faction=='dwarf' else 1)
    if faction in ['dwarf','gnome']:
        for side in ['L','R']:
            hand=_bone(arm,'hand_'+side);forearm=_bone(arm,'forearm_'+side)
            g['ellipsoid']('Practical racial worked glove',hand.head_local+Vector((0,-.085,-.035)),(.115,.17,.10),arm,role,hand.name,palette['cloth'])
            g['cone']('Worked iron or brass forearm bracer',forearm.head_local.lerp(forearm.tail_local,.48),forearm.head_local.lerp(forearm.tail_local,.90),.135,.115,arm,role,forearm.name,palette['metal'])
    _head(lib,arm,role,faction,mats,g,palette)
    _belt(arm,role,hip,.52 if faction=='pandaren' else .37,.34 if faction=='pandaren' else .28,palette['cloth'],palette['accent'],g)
    heavy=role in ['elite','heavy_cavalry'];light=role in ['scout','archer']
    if faction=='elf':
        for row in range(4 if heavy else 3):
            for col in range(3 if heavy else 2):
                x=(col-((2 if heavy else 1)/2))*.18;c=chest+Vector((x,-.30,.36-row*.17))
                _leaf('Overlapping silver-green leaf corslet',c,.23,.31,.045,arm,role,'chest',palette['metal'] if (row+col)%2 else palette['accent'],g)
        for side in [-1,1]:
            b=_bone(arm,'arm_'+('L' if side>0 else 'R'))
            _leaf('Elven shaped leaf shoulder',b.head_local+Vector((side*.12,-.13,.03)),.30,.35,.055,arm,role,'shoulder_'+('L' if side>0 else 'R'),palette['metal'],g)
        _cape(arm,role,chest,hip,palette['cloth'],g)
    elif faction=='dwarf':
        for row in range(4 if heavy else 2 if light else 3):
            for col in range(5):
                angle=(col-2)*.27;c=chest+Vector((math.sin(angle)*.42,-math.cos(angle)*.29-.035,.38-row*.17))
                g['cube']('Dwarven overlapping iron cuirass',c,(.16,.07,.21),arm,role,'chest',palette['metal'],.020)
        for side in [-1,1]:
            b=_bone(arm,'arm_'+('L' if side>0 else 'R'));p=b.head_local+Vector((side*.15,-.015,.055))
            verts=[p+Vector((side*x,y,z)) for x,y,z in [(-.24,-.27,-.05),(.32,-.22,-.08),(.33,.21,-.06),(-.19,.24,-.04),(-.14,-.20,.18),(.20,-.16,.20),(.22,.17,.17),(-.12,.18,.17)]]
            _mesh('Broad angular Dwarven iron pauldron',verts,[(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],arm,role,'shoulder_'+('L' if side>0 else 'R'),palette['metal'],g)
            g['cube']('Dwarven shoulder inset rune',p+Vector((side*.06,-.27,.01)),(.11,.025,.16),arm,role,'shoulder_'+('L' if side>0 else 'R'),palette['accent'],.008)
    elif faction=='gnome':
        _skirt(arm,role,hip,.35,.28,.43,palette['cloth'],g,'Short tinker leather apron')
        for row in range(3 if heavy else 2):
            for col in range(3):g['cube']('Gnome segmented brass breast plate',chest+Vector(((col-1)*.19,-.315,.34-row*.18)),(.18,.065,.21),arm,role,'chest',palette['metal'],.025)
        for side in [-1,1]:
            p=hip+Vector((side*.38,-.02,-.12));g['cube']('Gnome belt tool pouch',p,(.20,.15,.27),arm,role,'hip',palette['cloth'],.025)
            g['cone']('Visible engineer spanner shaft',p+Vector((0,-.10,-.06)),p+Vector((0,-.10,.29)),.025,.025,arm,role,'hip',palette['metal'])
            g['cube']('Engineer spanner open jaw',p+Vector((0,-.10,.27)),(.13,.055,.075),arm,role,'hip',palette['metal'],.010)
        if heavy:
            for side in [-1,1]:
                p=_bone(arm,'arm_'+('L' if side>0 else 'R')).head_local+Vector((side*.11,-.025,.03))
                _leaf('Clockwork sentinel shaped brass shoulder',p,.34,.37,.07,arm,role,'shoulder_'+('L' if side>0 else 'R'),palette['metal'],g)
                for i in range(3):g['ellipsoid']('Clockwork shoulder brass rivet',p+Vector(((i-1)*.09,-.09,.015)),(.025,)*3,arm,role,'shoulder_'+('L' if side>0 else 'R'),palette['accent'])
    elif faction=='pandaren':
        for row in range(4 if heavy else 2 if light else 3):
            for col in range(5):
                angle=(col-2)*.25;c=chest+Vector((math.sin(angle)*.48,-math.cos(angle)*.38-.025,.38-row*.15))
                _leaf('Panda overlapping jade bamboo armor',c,.18,.23,.035,arm,role,'chest',palette['metal'] if col%2 else palette['accent'],g)
        for side in [-1,1]:
            b=_bone(arm,'arm_'+('L' if side>0 else 'R'))
            for i in range(3):
                p=b.head_local+Vector((side*(.02+i*.11),-.02,.09-i*.035))
                g['ellipsoid']('Panda curved overlapping jade shoulder',p,(.28,.26,.09),arm,role,'shoulder_'+('L' if side>0 else 'R'),palette['metal'])
        if heavy:
            _cape(arm,role,chest,hip,palette['cloth'],g)
            for side in [-1,1]:
                h=lib.socket(arm,'head').head_local
                _leaf('Panda officer open jade brow crest',h+Vector((side*.19,.03,.44)),.14,.29,.03,arm,role,lib.socket(arm,'head').name,palette['metal'],g)
    elif faction=='undead':
        if not light:
            for side in [-1,1]:
                p=_bone(arm,'arm_'+('L' if side>0 else 'R')).head_local+Vector((side*.13,0,.03))
                _leaf('Undead battered rusted shoulder shard',p,.37,.38,.065,arm,role,'shoulder_'+('L' if side>0 else 'R'),palette['metal'],g)
        _cape(arm,role,chest,hip,palette['cloth'],g)
        _skirt(arm,role,hip,.32,.22,.34,palette['cloth'],g,'Decayed ragged crypt waist shroud')
    elif faction=='demon':
        for side in [-1,1]:
            p=_bone(arm,'arm_'+('L' if side>0 else 'R')).head_local+Vector((side*.13,-.035,.03))
            _leaf('Infernal pointed obsidian shoulder',p,.42,.48,.095,arm,role,'shoulder_'+('L' if side>0 else 'R'),palette['metal'],g)
            for i in range(2 if light else 3):g['cone']('Obsidian infernal armor spike',p+Vector((side*(-.11+i*.12),0,.12)),p+Vector((side*(-.10+i*.14),.03,.42)),.055,.003,arm,role,'shoulder_'+('L' if side>0 else 'R'),mats['dark'])
        for row in range(3 if heavy else 2):_leaf('Angular demon black chest carapace',chest+Vector((0,-.30,.32-row*.20)),.52,.29,.065,arm,role,'chest',palette['metal'],g)
        g['curved']('Infernal ember chest seam',[chest+Vector((0,-.37,.40)),chest+Vector((0,-.38,.04)),chest+Vector((0,-.36,-.16))],.013,arm,role,'chest',palette['accent'])
    _shield(lib,arm,role,faction,palette,g)
    _blade(lib,arm,role,faction,palette,g)
    if faction in ['dwarf','gnome'] and role=='archer':_crossbow(lib,arm,role,palette['cloth'],palette['metal'],g)
    arm['peris_racial_equipment']=faction+' original anatomy, uniform, headgear and constructed armor'
    arm['peris_historical_uniform_removed']=True
    print('RACIAL_EQUIPMENT_READY',faction,role,flush=True)
