"""Bounded original fantasy prototype repairs; existing core and rigs stay intact.

Call before atlas packing. These are geometry adaptations under CC-BY-SA-3.0,
and explicitly do not certify a unit as finished or runtime-approved.
"""
import bpy,math,json,hashlib
import numpy as np
from mathutils import Matrix,Vector

def _parts(lib,arm,role):
    return [o for o in lib.groups.get(role,[]) if o.type=='MESH' and
            any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]

def _delete(lib,obj,role):
    lib.groups[role].remove(obj);bpy.data.objects.remove(obj,do_unlink=True)

def _mesh(name,vertices,faces,arm,role,bone,material,geometry):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    uv=data.uv_layers.new(name='OriginalPrototypeSurface')
    for polygon in data.polygons:
        drop=max(range(3),key=lambda i:abs(polygon.normal[i]));axes=[i for i in range(3) if i!=drop]
        ps=[Vector(vertices[i]) for i in polygon.vertices];lo=[min(p[i] for p in ps) for i in axes];hi=[max(p[i] for p in ps) for i in axes]
        for loop,p in zip(polygon.loop_indices,ps):uv.data[loop].uv=tuple((p[i]-lo[j])/max(.001,hi[j]-lo[j]) for j,i in enumerate(axes))
    obj=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(obj)
    obj=geometry['mesh_prop'](obj,arm,role,bone,material)
    for polygon in obj.data.polygons:polygon.use_smooth=False
    obj['peris_original_prototype_repair']=True;obj['runtime_approved']=False;obj['peris_unit_finished']=False
    return obj

def _rig_hash(arm):
    value={'bones':[(b.name,b.parent.name if b.parent else None,[list(r) for r in b.matrix_local]) for b in arm.data.bones],
           'actions':[(t.name,[(s.action.name,[(c.data_path,c.array_index,[(list(k.co),list(k.handle_left),list(k.handle_right),k.interpolation) for k in c.keyframe_points]) for c in s.action.fcurves]) for s in t.strips]) for t in arm.animation_data.nla_tracks]}
    return hashlib.sha256(json.dumps(value,separators=(',',':')).encode()).hexdigest()

def _skin_topology_hash(obj):
    value={'uvs':[[list(v.uv) for v in layer.data] for layer in obj.data.uv_layers],
           'weights':[[[g.group,g.weight] for g in v.groups] for v in obj.data.vertices],
           'polygons':[list(p.vertices) for p in obj.data.polygons]}
    return hashlib.sha256(json.dumps(value,separators=(',',':')).encode()).hexdigest()

def _stone_surface(species,faction,color):
    """Original stochastic grain avoids directional stripes resembling fabric."""
    mat=species._solid('Original '+faction+' non-striped mineral surface',color,0,.93)
    size=256;rng=np.random.default_rng(831+sum(ord(c) for c in faction));grain=np.zeros((size,size),np.float32)
    for cells,amount in [(8,.09),(16,.045),(64,.025)]:
        values=rng.random((cells,cells)).astype(np.float32)-.5
        image=np.repeat(np.repeat(values,size//cells,axis=0),size//cells,axis=1)
        for _ in range(4):image=(image+np.roll(image,1,0)+np.roll(image,-1,0)+np.roll(image,1,1)+np.roll(image,-1,1))/5
        grain+=image*amount
    grain+=rng.normal(0,.009,(size,size));pixels=np.ones((size,size,4),np.float32)
    pixels[:,:,:3]=np.clip(np.asarray(color)*(1+grain[:,:,None]),0,1)
    image=bpy.data.images.new('Original '+faction+' stochastic mineral albedo',width=size,height=size,alpha=False)
    image.pixels.foreach_set(pixels.ravel());image.pack()
    p=mat.node_tree.nodes.get('Principled BSDF');tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    mat.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color']);return mat

def separate_infantry_roles(lib,arm,role,faction,mats,geometry,race):
    """Bounded kit differences, preserving healthy source sockets and clips."""
    if role not in ['line_infantry','spear_guard','elite','archer']:return
    before=_rig_hash(arm);g=geometry;hip=arm.data.bones['hip'].head_local.copy();chest=arm.data.bones['chest'].head_local.copy()
    colors={'elf':(.07,.19,.11),'dwarf':(.29,.075,.045),'gnome':(.31,.075,.035),'pandaren':(.27,.045,.03),'undead':(.14,.08,.18),'demon':(.13,.035,.025)}
    cloth=race._material(lib,faction+' role layered cloth',colors[faction],'cloth',rough=.91)
    leather=race._material(lib,faction+' role worked leather',tuple(c*.65+.025 for c in colors[faction]),'cloth',rough=.83)
    parts=_parts(lib,arm,role)
    metal=next((m for o in parts for m in o.data.materials if m and m.name==faction+' metal'),mats['steel'])
    accent=next((m for o in parts for m in o.data.materials if m and m.name==faction+' accent'),mats['bronze'])
    chest_names=['leaf corslet','iron cuirass','brass breast plate','jade bamboo armor','demon black chest carapace']
    shoulder_names=['leaf shoulder','Dwarven iron pauldron','shoulder inset rune','jade shoulder','rusted shoulder shard','obsidian shoulder','infernal armor spike','sentinel shaped brass shoulder','shoulder brass rivet']
    removed=[]
    if role in ['line_infantry','archer']:
        for obj in list(parts):
            if any(s in obj.name for s in chest_names+shoulder_names) or (role=='archer' and obj.name.startswith('Flowing racial cloak')):
                removed.append(obj.name);_delete(lib,obj,role)
        # Light torso lining deliberately leaves the race-specific arms visible.
        if faction!='undead':
            for col in range(3):
                race._leaf('Original '+faction+' '+role+' light hide torso panel',chest+Vector(((col-1)*.16,-(.37 if faction=='pandaren' else .30),.19)),.20,.57,.035,arm,role,'chest',leather,g)
        for side in [-1,1]:
            # Archer shoulder remains clear of draw arm; crossed back straps and
            # retained source quiver/bow carry the ranged role silhouette.
            a=chest+Vector((side*.26,-(.395 if faction=='pandaren' else .325),.41));b=chest+Vector((-side*.12,-(.395 if faction=='pandaren' else .325),-.16))
            g['curved']('Original light '+role+' fitted torso harness',[a,a.lerp(b,.5),b],.032,arm,role,'chest',leather)
        if role=='line_infantry':
            side=1;b=arm.data.bones['arm_L'];race._leaf('Original light infantry single leather shoulder',b.head_local+Vector((.10,-.12,.02)),.24,.27,.04,arm,role,'shoulder_L',leather,g)
    if role=='spear_guard':
        socket=lib.socket(arm,'shield');center=socket.matrix_local@Vector((0,0,.12));inv=socket.matrix_local.inverted()
        for obj in _parts(lib,arm,role):
            if 'distinctive worked shield' in obj.name or obj.name.startswith(('Racial shield','Shield engraved','Leaf shield')):
                for v in obj.data.vertices:
                    local=inv@v.co;local.x*=.95;local.z=.12+(local.z-.12)*1.25;v.co=socket.matrix_local@local
                obj.data.update()
        for side in [-1,1]:
            p=chest+Vector((side*.27,-(.39 if faction=='pandaren' else .31),.30))
            race._leaf('Original pole guard segmented throat armor',p,.18,.34,.03,arm,role,'chest',metal,g)
    if role=='elite':
        if not any(o.name.startswith('Flowing racial cloak') for o in _parts(lib,arm,role)):race._cape(arm,role,chest,hip,cloth,g)
        for side in [-1,1]:
            b=arm.data.bones['thigh_'+('L' if side>0 else 'R')]
            race._leaf('Original elite worked upper thigh defense',b.head_local+Vector((side*.07,-.25,-.14)),.23,.36,.035,arm,role,b.name,metal,g)
            p=chest+Vector((side*.27,-(.40 if faction=='pandaren' else .33),.44))
            race._leaf('Original elite mantle clasp and regalia',p,.15,.21,.045,arm,role,'chest',accent,g)
    # Short waist overlap covers the imported tunic's hip split. It is upper
    # pelvis coverage, not a long rigid skirt crossing both moving knees.
    rx=.54 if faction=='pandaren' else .385;ry=.37 if faction=='pandaren' else .29
    if faction!='undead':race._skirt(arm,role,hip,rx,ry,.27 if role!='elite' else .34,cloth,g,'Original layered '+role+' hip overlap')
    if _rig_hash(arm)!=before:raise ValueError('Role kit must preserve rig and clips')
    arm['peris_original_role_kit']=json.dumps({'role':role,'version':1,'removedHeavyParts':removed,'line':'Light leather coverage, single light shoulder','spear':'Tall shield and segmented throat armor; healthy source spear unchanged','elite':'Full racial armor plus mantle/regalia/thigh defenses','archer':'Heavy shoulders removed, fitted harness and healthy ranged source retained','hip':'Short upper pelvis layered overlap','rigActionHash':before,'runtimeApproved':False,'finishedUnitApproved':False})

def repair_skeletal_horse(lib,arm,role,mats,geometry,species):
    """Fill omitted anatomy by its actual source bones; create horse skull planes."""
    if role not in ['scout','light_cavalry']:raise ValueError('Only skeletal-horse source roles')
    before=_rig_hash(arm);gear=species._Gear(arm,role,Matrix.Identity(4),geometry);added=[]
    names=['Horse_Femur','Horse_Thigh','Horse_Shin','Horse_Hand','Horse_Foot','Horse_shoulder','Horse_upperarm']
    for bone in arm.data.bones:
        if any(bone.name.startswith(prefix+'_') for prefix in names) and 'IK' not in bone.name:
            obj=gear.cone('Completed skeletal horse '+bone.name,bone.head_local,bone.tail_local,.105,.080,bone.name,mats['ivory'])
            gear.ellipsoid('Overlapping skeletal horse joint '+bone.name,bone.head_local,(.135,)*3,bone.name,mats['ivory'])
            added.append({'bone':bone.name,'head':list(bone.head_local),'tail':list(bone.tail_local),'mesh':obj.name})
    for obj in list(_parts(lib,arm,role)):
        if any(term in obj.name for term in ['Skeletal horse skull','Horse hollow eye']):_delete(lib,obj,role)
    head=arm.data.bones['Horse_Head'];center=head.head_local
    rings=[(.12,.28,.33,.02),(-.22,.33,.36,-.06),(-.65,.26,.27,-.27),(-1.10,.20,.18,-.40)]
    vertices=[]
    for y,rx,rz,z in rings:
        for i in range(8):
            angle=math.tau*i/8;vertices.append(center+Vector((math.sin(angle)*rx,y,z+math.cos(angle)*rz)))
    faces=[tuple(range(7,-1,-1)),tuple(range(24,32))]
    for row in range(3):
        for i in range(8):faces.append((row*8+i,row*8+(i+1)%8,(row+1)*8+(i+1)%8,(row+1)*8+i))
    _mesh('Elongated angular skeletal horse cranium',vertices,faces,arm,role,head.name,mats['ivory'],geometry)
    for side in [-1,1]:
        # Recess-dark inset and raised orbital bone frame sit on the skull plane.
        p=center+Vector((side*.292,-.22,.01))
        gear.ellipsoid('Skeletal horse recessed orbit',p,(.036,.145,.13),head.name,mats['dark'])
        gear.curved('Skeletal horse orbital brow',[p+Vector((side*.015,.15,.06)),p+Vector((side*.033,.0,.14)),p+Vector((side*.012,-.15,.04))],.034,head.name,mats['ivory'])
        gear.curved('Skeletal horse open jaw bone',[center+Vector((side*.23,-.11,-.26)),center+Vector((side*.19,-.65,-.54)),center+Vector((side*.13,-1.12,-.49))],.055,head.name,mats['ivory'])
        for i in range(5):
            p=center+Vector((side*.14,-.63-i*.083,-.45))
            gear.cube('Skeletal horse molar',p,(.045,.058,.095),head.name,mats['ivory'],.009)
    if _rig_hash(arm)!=before:raise ValueError('Repair must preserve source rig and every action')
    arm['peris_skeletal_mount_repair']=json.dumps({'version':1,'cause':'Old selector omitted actual Femur/Thigh/Shin/Hand/Foot/shoulder/upperarm anatomy','addedSegments':added,'skull':'Original elongated faceted horse cranium, open mandible and orbital brows','rigActionHash':before,'rigAndAllClipsPreserved':True,'runtimeApproved':False,'finishedUnitApproved':False})
    return arm

def fit_verified_replacement_grips(lib,arm,role,faction):
    """Only visually verified replacement weapons; no prop-origin-only guess."""
    if (faction,role) not in [('elf','line_infantry'),('dwarf','line_infantry'),('dwarf','elite')]:return
    before=_rig_hash(arm);hand=arm.data.bones['hand_R'];prop=arm.data.bones['prop-weapon_R'];target=prop.matrix_local.copy();target.translation=hand.matrix_local@Vector((0,.15,0));transform=target@prop.matrix_local.inverted();changed=[]
    for obj in _parts(lib,arm,role):
        group=obj.vertex_groups.get(prop.name)
        if not group:continue
        ids=[v.index for v in obj.data.vertices if any(g.group==group.index and g.weight>.999 for g in v.groups)]
        if not ids:continue
        for i in ids:obj.data.vertices[i].co=transform@obj.data.vertices[i].co
        group.remove(ids);new=obj.vertex_groups.get(hand.name) or obj.vertex_groups.new(name=hand.name);new.add(ids,1,'REPLACE');obj.data.update();changed.append({'mesh':obj.name,'vertexIndices':ids})
    if not changed or _rig_hash(arm)!=before:raise ValueError('Verified replacement correction contract failed')
    arm['peris_detached_weapon_grip_correction']=json.dumps({'role':role,'faction':faction,'operation':'Visually verified detached replacement only: rest hilt fitted to actual hand_R closed palm and rigidly rebound. Healthy source spear/bow/mount untouched.','vertexSets':changed,'rigActionHash':before,'runtimeApproved':False,'finishedUnitApproved':False})

def _crag(name,a,b,rx,ry,arm,role,bone,material,g,seed=0):
    """Closed deliberately faceted stone volume, aligned to anatomical segment."""
    a,b=Vector(a),Vector(b);axis=(b-a).normalized();u=axis.cross(Vector((0,1,0)))
    if u.length<.01:u=axis.cross(Vector((1,0,0)))
    u.normalize();v=axis.cross(u).normalized();vertices=[];n=7
    for row,(phase,scale) in enumerate([(-.04,.65),(.20,1.04),(.73,1), (1.05,.63)]):
        center=a.lerp(b,phase)
        for i in range(n):
            angle=math.tau*i/n+.11*math.sin(seed+row);variation=1+.09*math.sin(i*2.33+seed)
            vertices.append(center+(u*math.cos(angle)*rx+v*math.sin(angle)*ry)*scale*variation)
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n*3,n*4))]
    for row in range(3):
        for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
    return _mesh(name,vertices,faces,arm,role,bone,material,g)

def repair_living_siege(lib,arm,role,faction,mats,geometry,species):
    """Species-specific mass and head construction over continuous source skin."""
    if role!='catapult' or faction not in ['elf','dwarf','pandaren','undead','demon']:return arm
    before=_rig_hash(arm);gear=species._Gear(arm,role,Matrix.Identity(4),geometry)
    stone=faction in ['elf','dwarf','undead','pandaren']
    color={'elf':(.26,.31,.24),'dwarf':(.24,.26,.28),'undead':(.25,.23,.29),'pandaren':(.32,.33,.31),'demon':(.31,.07,.05)}[faction]
    surface=_stone_surface(species,faction,color)
    dark=mats['dark'];accent=species._solid('Original '+faction+' siege eye',(.16,.44,.22) if faction in ['elf','undead'] else (.64,.34,.08) if faction=='dwarf' else (.44,.12,.035),0,.5)
    removed=[]
    for obj in list(_parts(lib,arm,role)):
        if '/heads/' in obj.get('source_actor','') or any(t in obj.name for t in ['Carved anatomical stone slab','Tombstone tiny green eye','Div giant swept horn']):
            removed.append(obj.name);_delete(lib,obj,role)
    bodies=[o for o in _parts(lib,arm,role) if o.get('source_mesh')=='skeletal/new/m_naked.dae']
    if len(bodies)!=1:raise ValueError('One continuous licensed giant body required')
    body=bodies[0];topology_before=_skin_topology_hash(body);names={vg.index:vg.name for vg in body.vertex_groups};changed=0
    for vertex in body.data.vertices:
        original=vertex.co.copy();offset=Vector();total=0
        for weight in vertex.groups:
            name=names[weight.group];bone=arm.data.bones.get(name)
            if not bone or name.startswith('prop'):continue
            if name in ['chest','spine']:sx,sy=1.45,1.40
            elif name=='hip':sx,sy=1.20,1.24
            elif name.startswith(('arm_','forearm_','thigh_','leg_')):sx,sy=(1.6,1.55) if name.startswith(('arm_','forearm_')) else (1.35,1.33)
            elif name.startswith(('hand_','finger_','thumb_')):sx,sy=1.50,1.45
            else:continue
            center=bone.head_local;delta=original-center;offset+=Vector((delta.x*(sx-1),delta.y*(sy-1),0))*weight.weight;total+=weight.weight
        if total:vertex.co=original+offset;changed+=1
    body.data.materials.clear();body.data.materials.append(surface)
    for polygon in body.data.polygons:polygon.material_index=0;polygon.use_smooth=not stone
    # This newly reshaped continuous skin has no dense baked normal map; retain
    # UVs and weights, regenerate its own normals instead of stale source ones.
    if body.data.has_custom_normals:
        bpy.context.view_layer.objects.active=body;body.select_set(True);bpy.ops.mesh.customdata_custom_splitnormals_clear();body.select_set(False)
    body.data.update()
    for i,name in enumerate(['chest','arm_L','arm_R','forearm_L','forearm_R','thigh_L','thigh_R','leg_L','leg_R']):
        bone=arm.data.bones.get(name)
        if not bone:continue
        radius=(.43,.34) if name=='chest' else (.26,.23) if name.startswith('arm_') else (.24,.22) if name.startswith('forearm_') else (.29,.25) if name.startswith('thigh_') else (.23,.20)
        if stone:_crag('Original '+faction+' massive jointed crag '+name,bone.head_local,bone.tail_local,*radius,arm,role,name,surface,geometry,i)
    head=arm.data.bones.get('prop-head') or arm.data.bones.get('head');h=head.head_local
    widths={'elf':(.29,.25),'dwarf':(.41,.30),'undead':(.35,.28),'pandaren':(.39,.32),'demon':(.34,.28)}[faction]
    vertices=[];ring_values=[(-.20,.73),(.04,1),(.34,1.10),(.62,.83)]
    for row,(z,scale) in enumerate(ring_values):
        for i in range(8):
            angle=math.tau*i/8;vertices.append(h+Vector((math.sin(angle)*widths[0]*scale,math.cos(angle)*widths[1]*scale-.035,z)))
    faces=[tuple(range(7,-1,-1)),tuple(range(24,32))]
    for row in range(3):
        for i in range(8):faces.append((row*8+i,row*8+(i+1)%8,(row+1)*8+(i+1)%8,(row+1)*8+i))
    _mesh('Original '+faction+' massive angular siege face',vertices,faces,arm,role,head.name,surface,geometry)
    for side in [-1,1]:
        p=h+Vector((side*.14,-widths[1]-.031,.29))
        gear.cube('Deep '+faction+' monster eye recess',p,(.18,.06,.11),head.name,dark,.018)
        gear.cube('Narrow '+faction+' siege gaze',p+Vector((0,-.036,0)),(.10,.025,.035),head.name,accent,.009)
        gear.cube('Heavy '+faction+' orbital brow',p+Vector((side*.022,-.004,.083)),(.27,.13,.12),head.name,surface,.035)
    gear.cube('Original '+faction+' broad nose bridge',h+Vector((0,-widths[1]-.035,.14)),(.16,.15,.19),head.name,surface,.04)
    gear.curved('Original '+faction+' recessed mouth',[h+Vector((-.16,-widths[1]-.02,-.015)),h+Vector((0,-widths[1]-.05,-.04)),h+Vector((.16,-widths[1]-.02,-.015))],.017,head.name,dark)
    if faction=='elf':
        for side in [-1,1]:
            branch=[h+Vector((side*.25,.10,.39)),h+Vector((side*.47,.14,.80)),h+Vector((side*.42,.19,1.04))]
            for i in range(2):gear.cone('Original closed tapered rootstone crown branch',branch[i],branch[i+1],.060-i*.025,.035-i*.027,head.name,mats['wood'])
            roots=[arm.data.bones['hip'].head_local+Vector((side*.43,.13,-.05)),arm.data.bones['chest'].head_local+Vector((side*.48,-.20,.12)),arm.data.bones['chest'].tail_local+Vector((side*.28,-.29,.13))]
            for i in range(2):gear.cone('Original closed rootstone shoulder binding',roots[i],roots[i+1],.095,.080,'chest',mats['wood'])
    elif faction=='dwarf':
        gear.cube('Runestone monumental beard slab',h+Vector((0,-.22,-.20)),(.43,.34,.38),head.name,surface,.045)
        for side in [-1,1]:
            p=arm.data.bones['chest'].head_local+Vector((side*.25,-.43,.17))
            gear.curved('Original runestone copper sigil',[p,p+Vector((side*.10,0,.14)),p+Vector((side*.04,0,.25))],.025,'chest',mats['bronze'])
    elif faction=='undead':
        for side in [-1,1]:
            gear.cone('Original crypt colossus broken crown',h+Vector((side*.29,.05,.44)),h+Vector((side*.36,.10,.85)),.095,.045,head.name,surface)
            gear.cube('Original crypt cheek fissure',h+Vector((side*.20,-.30,.01)),(.05,.035,.20),head.name,dark,.009)
    elif faction=='pandaren':
        # Portrait mountain giant: heavy rock flesh and braided dark hair,
        # distinct from the smaller panda soldiers and their soft white fur.
        for i in range(9):
            x=(i-4)*.071;p=h+Vector((x,-.26,-.10));gear.curved('Original mountain giant braided beard',[p,p+Vector((x*.10,-.01,-.20)),p+Vector((x*.20,.08,-.49))],.052,head.name,mats['hair'])
        for side in [-1,1]:
            p=h+Vector((side*.29,.14,.40));gear.curved('Original mountain giant long braid',[p,p+Vector((side*.10,.07,-.35)),p+Vector((side*.14,.15,-.81))],.075,head.name,mats['hair'])
    else:
        for side in [-1,1]:
            gear.curved('Original Div massive swept horn',[h+Vector((side*.24,.02,.49)),h+Vector((side*.51,.13,.82)),h+Vector((side*.53,.27,1.13)),h+Vector((side*.37,.30,1.23))],.105,head.name,dark)
            gear.cone('Original Div lower canine',h+Vector((side*.16,-.32,-.08)),h+Vector((side*.21,-.36,.17)),.063,.009,head.name,mats['ivory'])
    if _skin_topology_hash(body)!=topology_before:raise ValueError('Species mass must preserve source UVs, topology and weights')
    if _rig_hash(arm)!=before:raise ValueError('Species repair must preserve source rig/actions')
    arm['peris_living_siege_repair']=json.dumps({'version':1,'species':arm.get('peris_siege_species'),'sourceBody':'Wildfire Games m_naked continuous licensed skin retained; existing UVs and weights exact; original vertex mass reshaped','bodyChangedVertices':changed,'sourceHeadRemoved':True,'head':'Original heavy angular face, narrowed recessed gaze and race-specific crown/hair','newSurface':'Original baked grain image; modified giant skin normals regenerated, no dense normal map substitution','removedObjects':removed,'rigActionHash':before,'rigAndAllClipsPreserved':True,'runtimeApproved':False,'finishedUnitApproved':False})
    return arm
