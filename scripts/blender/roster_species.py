"""Original Peris fantasy species assembled on licensed 0 A.D. anatomy.

The imported animal's native rest coordinates and animation remain intact.
Equipment and seats use new child bones; riders retain their own source rig.
No proprietary game meshes are used. Derived artwork is CC-BY-SA-3.0.
"""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector


def _helper(geometry, name):
    return geometry[name] if isinstance(geometry, dict) else getattr(geometry, name)


def _bone(arm, *terms):
    for term in terms:
        found = next((b for b in arm.data.bones if b.name.lower() == term.lower()), None)
        if found:
            return found
    for term in terms:
        found = next((b for b in arm.data.bones if term.lower() in b.name.lower()), None)
        if found:
            return found
    raise ValueError('Missing anatomical bone ' + str(terms) + ' on ' + arm.name)


def _parts(lib, arm, role):
    return [o for o in lib.groups.get(role, []) if o.type == 'MESH' and
            any(m.type == 'ARMATURE' and m.object == arm for m in o.modifiers)]


def _remove_rig(lib, arm, role):
    for obj in _parts(lib, arm, role):
        lib.groups[role].remove(obj)
        bpy.data.objects.remove(obj, do_unlink=True)
    if arm in lib.rigs:
        lib.rigs.remove(arm)
    bpy.data.objects.remove(arm, do_unlink=True)


def _state(arm, state, frame=1):
    for track in arm.animation_data.nla_tracks:
        track.mute = track.name != state
    arm.animation_data.action = None
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def _mute(arm):
    for track in arm.animation_data.nla_tracks:
        track.mute = True
    arm.animation_data.action = None
    for pose in arm.pose.bones:
        pose.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def _animal_clips(lib, arm, spec, role):
    """Bake world-space motion relative to the source idle calibration pose.

    Some legacy animation files have an unrelated editor rest skeleton, while
    their animated world pose is in the game's correct logical coordinates.
    Calibration avoids applying their editor rest matrices to the mesh bind.
    Only weighted anatomy and its ancestors are used; editor IK controls and
    fixed prop sockets cannot leak invalid scales or coordinates into a skin.
    """
    arm.animation_data_create()
    native=arm.matrix_world.copy()
    names={o.vertex_groups[g.group].name for o in _parts(lib,arm,role)
           for v in o.data.vertices for g in v.groups if g.weight>0}
    names={n for n in names if not n.lower().startswith('prop')}
    for name in list(names):
        b=arm.data.bones.get(name)
        while b and b.parent:
            b=b.parent
            if not b.name.lower().startswith('prop'):names.add(b.name)
    bones=[b for b in arm.data.bones if b.name in names]
    def depth(bone):return 0 if bone.parent is None else 1+depth(bone.parent)
    bones.sort(key=depth)
    idle=next(spec['animations'][k] for k in ['Idle','idle'] if k in spec['animations'])
    def load(file):
        objects=lib.dae('animation/'+file)
        source=next(o for o in objects if o.type=='ARMATURE' and o.animation_data)
        action=source.animation_data.action
        fixed=source.matrix_world.copy()
        for curve in list(action.fcurves):
            if not curve.data_path.startswith('pose.bones['):action.fcurves.remove(curve)
        source.matrix_world=fixed
        return objects,source,action
    ref_objects,ref_source,ref_action=load(idle)
    start=ref_action.frame_range[0]
    bpy.context.scene.frame_set(int(start),subframe=start-int(start));bpy.context.view_layer.update()
    reference={b.name:ref_source.matrix_world @ ref_source.pose.bones[b.name].matrix for b in bones}
    for obj in ref_objects:bpy.data.objects.remove(obj,do_unlink=True)
    for state, keys in [('idle', ['Idle', 'idle']), ('walk', ['Walk', 'walk']),
                        ('attack', ['attack_melee', 'Attack', 'attack_ranged'])]:
        key = next((key for key in keys if key in spec['animations']), None)
        if key is None:
            raise ValueError('Missing animal ' + state + ': ' + str(spec))
        objects,source,action=load(spec['animations'][key])
        errors=[]
        for bone in bones:
            if bone.name.lower().startswith('prop'):
                continue
            other = source.data.bones.get(bone.name)
            if other is None:
                raise ValueError('Animal animation anatomy missing ' + bone.name)
            error = max(abs(bone.matrix_local[r][c] - other.matrix_local[r][c])
                        for r in range(4) for c in range(4))
            def anatomy_parent(value):
                p=value.parent
                while p and (p.name.lower().startswith('prop') or p.name not in {b.name for b in bones}):
                    p=p.parent
                return p.name if p else None
            if anatomy_parent(bone)!=anatomy_parent(other):
                raise ValueError('Animal animation hierarchy mismatch '+bone.name+': '+str(anatomy_parent(bone))+' / '+str(anatomy_parent(other)))
            errors.append(error)
        start, end = action.frame_range
        if end <= start:
            raise ValueError('Empty animal animation: ' + spec['animations'][key])
        baked=bpy.data.actions.new(role+'_'+state)
        arm.animation_data.action=baked
        for index in range(25):
            frame=start+(end-start)*index/24
            bpy.context.scene.frame_set(int(frame),subframe=frame-int(frame))
            bpy.context.view_layer.update()
            desired={}
            for b in bones:
                current=source.matrix_world @ source.pose.bones[b.name].matrix
                baseline=reference[b.name]
                if not all(math.isfinite(value) for row in current for value in row):
                    raise ValueError('Nonfinite source anatomical pose '+b.name)
                rest=native @ b.matrix_local
                position=rest.translation+current.translation-baseline.translation
                rotation=current.to_quaternion() @ baseline.to_quaternion().inverted() @ rest.to_quaternion()
                desired[b.name]=native.inverted() @ Matrix.LocRotScale(position,rotation,rest.to_scale())
            for bone in bones:
                pose=arm.pose.bones[bone.name]
                pose.rotation_mode='QUATERNION'
                # Convert analytically against the already computed parent
                # pose; thousands of dependency-graph updates per clip are
                # unnecessary and can make a complete roster build very slow.
                if bone.parent:
                    parent_pose=desired.get(bone.parent.name,bone.parent.matrix_local)
                    pose.matrix_basis=bone.convert_local_to_pose(
                        desired[bone.name],bone.matrix_local,
                        parent_matrix=parent_pose,parent_matrix_local=bone.parent.matrix_local,
                        invert=True)
                else:
                    pose.matrix_basis=bone.convert_local_to_pose(
                        desired[bone.name],bone.matrix_local,invert=True)
                pose.keyframe_insert('location',frame=index+1,group=bone.name)
                pose.keyframe_insert('rotation_quaternion',frame=index+1,group=bone.name)
                pose.keyframe_insert('scale',frame=index+1,group=bone.name)
        arm.animation_data.action=None
        track = arm.animation_data.nla_tracks.new()
        track.name = role + '_' + state
        strip = track.strips.new(track.name, 1, baked)
        strip.action_frame_start = 1
        strip.action_frame_end = 25
        strip.frame_start = 1
        strip.scale = 1
        track.mute = True
        source.animation_data.action = None
        for obj in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        arm['peris_animal_'+state+'_rest_error']=round(max(errors),6)
    arm['peris_animation_bind_strategy']='canonical world motion calibrated against source idle pose and target mesh rest'
    arm['peris_animal_weighted_anatomy_bones']=len(names)
    arm.animation_data.action = None


def _socket(arm, name, canonical, native, parent):
    """A seat with canonical +Y/up axes, inside the source rig coordinates."""
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    bone = arm.data.edit_bones.new(name)
    inverse = native.inverted()
    bone.head = inverse @ Vector(canonical)
    bone.tail = bone.head + inverse.to_3x3() @ Vector((0, .2, 0))
    bone.align_roll(inverse.to_3x3() @ Vector((0, 0, 1)))
    bone.parent = arm.data.edit_bones[parent]
    bone.use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.select_set(False)
    return arm.data.bones[name]


class _Gear:
    """Create accessories in canonical animal coordinates, without rig edits."""
    def __init__(self, arm, role, native, geometry):
        self.arm, self.role, self.native = arm, role, native
        self.inverse = native.inverted()
        self.geometry = geometry

    def _finish(self, obj):
        # Shapes were authored in the animal's canonical world. Put vertices
        # into its native rig space after the shared helper baked their shape.
        obj.data.transform(self.inverse)
        obj['peris_species_equipment'] = True
        return obj

    def cone(self, name, a, b, r1, r2, bone, material):
        return self._finish(_helper(self.geometry, 'cone')(
            name, a, b, r1, r2, self.arm, self.role, bone, material))

    def cube(self, name, p, size, bone, material, bevel=.035):
        return self._finish(_helper(self.geometry, 'cube')(
            name, p, size, self.arm, self.role, bone, material, bevel))

    def ellipsoid(self, name, p, size, bone, material):
        return self._finish(_helper(self.geometry, 'ellipsoid')(
            name, p, size, self.arm, self.role, bone, material))

    def curved(self, name, points, radius, bone, material):
        return self._finish(_helper(self.geometry, 'curved')(
            name, points, radius, self.arm, self.role, bone, material))


def _solid(name, color, metallic=0, roughness=.7):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    p = material.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    return material


def _paint(material, name, tint, fur=False):
    """Bake original tint/fur detail into source diffuse pixels for the atlas."""
    result = material.copy()
    result.name = name
    nodes = result.node_tree.nodes
    p = nodes.get('Principled BSDF')
    tex = next((n for n in nodes if n.type == 'TEX_IMAGE' and n.image and
                n.image.colorspace_settings.name == 'sRGB'), None)
    if tex is None:
        p.inputs['Base Color'].default_value = (*tint, 1)
        return result
    image = tex.image.copy()
    w, h = image.size
    pixels = np.empty(w*h*4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape((h, w, 4))
    luma = pixels[:, :, :3].mean(axis=2)
    detail = .6 + luma * .85
    if fur:
        yy, xx = np.mgrid[:h, :w]
        strokes = np.sin(xx*.83 + 1.8*np.sin(yy*.018))
        strokes += .35*np.sin(xx*2.17 + yy*.026)
        detail *= .90 + .10*strokes
    pixels[:, :, :3] = np.clip(detail[:, :, None] * np.asarray(tint), 0, 1)
    pixels[:, :, 3] = 1
    image.name = name + ' painted diffuse'
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    tex.image = image
    p.inputs['Roughness'].default_value = .86 if fur else .68
    return result


def _rest_bounds(lib, arm, role, native):
    points = [native @ o.matrix_basis @ v.co for o in _parts(lib, arm, role)
              for v in o.data.vertices]
    return [Vector(tuple(min(p[i] for p in points) for i in range(3))),
            Vector(tuple(max(p[i] for p in points) for i in range(3)))]


def _mammoth(lib, arm, role, faction, mats, gear):
    skeletal = faction == 'undead'
    body = _bone(arm, 'Elephantidae_Vertebrae_Dorsal')
    head = _bone(arm, 'Elephantidae_Head')
    if skeletal:
        for obj in _parts(lib, arm, role):
            lib.groups[role].remove(obj)
            bpy.data.objects.remove(obj, do_unlink=True)
        # Bone geometry follows the real elephant leg/trunk chain rather than
        # carrying a solid pale body into the skeletal faction.
        for b in arm.data.bones:
            name = b.name
            if not name.startswith('Elephantidae_') or any(t in name for t in
                    ['Target', 'IK', 'Rotation', 'Belly', 'Ear', 'Vertebrae']):
                continue
            if any(t in name for t in ['Thigh', 'Leg_', 'Shin', 'Foot', 'Shouder_', 'Arm_', 'Forearm', 'Hand_', 'Trunk_', 'Tail_']):
                radius = .15 if 'Trunk' in name else .23
                gear.cone('Articulated mammoth bone', b.head_local, b.tail_local,
                          radius, radius*.78, name, mats['ivory'])
                gear.ellipsoid('Mammoth joint', b.head_local, (radius*1.3,)*3,
                               name, mats['ivory'])
        for i in range(9):
            y = -2.3 + i*.56
            for side in [-1, 1]:
                gear.curved('Open mammoth rib', [(0,y,6.55),(side*1.65,y,5.95),
                             (side*1.9,y,4.65),(side*.75,y,3.65)], .135,
                            body.name, mats['ivory'])
            gear.ellipsoid('Mammoth vertebra', (0,y,6.55), (.32,.2,.24),
                           body.name, mats['ivory'])
        gear.ellipsoid('Mammoth skull', (0,-4.7,6.5), (1.04,1.03,1.02), head.name, mats['ivory'])
        for side in [-1,1]:
            gear.ellipsoid('Mammoth skull socket', (side*.65,-5.36,6.6), (.30,.19,.32), head.name, mats['dark'])
        gear.ellipsoid('Mammoth pelvis', (0,2.1,5.7), (1.2,.53,.65),
                       _bone(arm, 'Elephantidae_Pelvis').name, mats['ivory'])
    else:
        # The source tusks share the elephant body mesh. Remove their outer
        # geometry before adding the two original curled tusks; tinting the
        # complete hide would otherwise leave a second brown pair underneath.
        removed=0
        for obj in _parts(lib,arm,role):
            bm=bmesh.new();bm.from_mesh(obj.data)
            original=[v for v in bm.verts if abs(v.co.x)>.40 and v.co.y<-5.05 and v.co.z<5.50]
            removed+=len(original)
            bmesh.ops.delete(bm,geom=original,context='VERTS')
            bm.to_mesh(obj.data);bm.free();obj.data.update()
        arm['peris_replaced_native_tusk_vertices']=removed
        for obj in _parts(lib, arm, role):
            for index, material in enumerate(obj.data.materials):
                obj.data.materials[index] = _paint(material, faction+' woolly hide',
                                                 (.30,.18,.095) if faction=='orc' else (.36,.25,.15), True)
        # A shaggy lower contour is geometry; the retained elephant face,
        # trunk, limbs and painted hide provide the complete animal anatomy.
        for side in [-1,1]:
            for i in range(22):
                y = -2.9 + i*.27
                x = side*(1.57 + .22*math.sin(i*.61))
                z = 4.95 + .23*math.sin(i*.49)
                gear.cone('Shaggy mammoth flank fur', (x,y,z),
                          (x+side*.13,y+.10,z-.68-.20*(i%3)), .18, .008,
                          body.name, mats['hair'])
            for i in range(7):
                x = side*(.55+i*.11)
                gear.cone('Mammoth forehead fur', (x,-4.4,7.4),
                          (x+side*.08,-4.65,6.94), .16, .008, head.name, mats['hair'])
    for side in [-1,1]:
        # Curled tusks remain attached to the real moving head.
        gear.curved('Curled mammoth ivory tusk',
                    [(side*.62,-5.05,5.1),(side*1.28,-6.2,4.70),
                     (side*1.68,-7.10,5.10),(side*1.66,-7.55,6.25)],
                    .21, head.name, mats['ivory'])
    plate = mats['steel'] if faction in ['orc','undead'] else mats['bronze']
    gear.ellipsoid('Forged mammoth forehead guard', (0,-4.74,7.2),
                   (.93,.28,.68), head.name, plate)
    if faction=='pandaren':
        jade=_solid('Mammoth jade forehead inlay',(.055,.26,.17),.18,.38)
        gear.ellipsoid('Jade forehead inlay',(0,-5.005,7.2),(.40,.055,.34),head.name,jade)
    elif faction=='undead':
        violet=_solid('Skeletal mammoth aged violet trim',(.18,.075,.24),.2,.68)
        gear.ellipsoid('Aged violet forehead inlay',(0,-5.005,7.2),(.40,.055,.34),head.name,violet)
    for side in [-1,1]:
        for i in range(3):
            gear.ellipsoid('Forehead rivet', (side*(.18+i*.22),-5.04,7.1),
                           (.07,.04,.07),head.name,mats['bronze'])
    return Vector((0,-.25,7.65)), body


def _boar(lib, arm, role, faction, mats, gear):
    body = _bone(arm, 'Boar_Body')
    head = _bone(arm, 'Boar_Head')
    if faction=='gnome':
        for obj in _parts(lib, arm, role):
            for index, material in enumerate(obj.data.materials):
                painted=_paint(material,'Brass boar articulated shell',(.53,.31,.09))
                p=painted.node_tree.nodes.get('Principled BSDF')
                p.inputs['Metallic'].default_value=.78;p.inputs['Roughness'].default_value=.35
                obj.data.materials[index]=painted
        for b in arm.data.bones:
            if any(t in b.name for t in ['Front_Leg_', 'Back_Leg_']):
                gear.cone('Brass piston leg', b.head_local,b.tail_local,.10,.08,b.name,mats['bronze'])
                gear.ellipsoid('Simple hinged knee',b.head_local,(.16,.16,.16),b.name,mats['steel'])
        for i in range(5):
            gear.cube('Overlapping brass back plate',(0,.20+i*.24,1.74),
                      (1.05,.32,.14),body.name,mats['bronze'],.055)
        for side in [-1,1]:
            gear.ellipsoid('Clockwork boar eye',(side*.27,-1.11,1.40),
                           (.065,.07,.065),head.name,mats['dark'])
            gear.cone('Boar exhaust stack',(side*.45,.96,1.48),(side*.45,1.03,2.08),
                      .10,.075,body.name,mats['steel'])
    else:
        for side in [-1,1]:
            gear.ellipsoid('Slate boar shoulder armor',(side*.45,-.13,1.25),
                           (.17,.62,.52),body.name,mats['steel'])
            for i in range(3):
                gear.cube('Copper armor edge',(side*.58,-.46+i*.28,1.26),
                          (.055,.09,.67),body.name,mats['bronze'],.012)
    for side in [-1,1]:
        gear.curved('Forged boar tusk',[(side*.28,-1.42,.78),
                    (side*.47,-1.69,.89),(side*.44,-1.72,1.20)],
                    .07,head.name,mats['ivory'])
    gear.ellipsoid('Boar snout guard',(0,-1.62,1.0),(.31,.16,.23),head.name,mats['bronze'])
    return Vector((0,.47,1.82)), body


def _elk(lib, arm, role, mats, gear, native):
    body = _bone(arm,'Deer01_Spine1')
    head = _bone(arm,'Deer01_Head')
    back = native @ body.head_local
    emerald=_solid('Elk emerald leaf enamel',(.055,.24,.13),.25,.42)
    # Body source axes are unusual; all armor positions are evaluated through
    # its native matrix. Source antlers and hoof anatomy remain untouched.
    for side in [-1,1]:
        gear.ellipsoid('Leaf-shaped elk flank barding', back+Vector((side*.38,.10,.08)),
                       (.12,.83,.37),body.name,mats['steel'])
        for i in range(4):
            gear.cone('Emerald leaf armor edge',back+Vector((side*.41,-.43+i*.25,.29)),
                      back+Vector((side*.47,-.56+i*.25,-.12)), .12,.02,
                      body.name,emerald)
    return back+Vector((0,.10,.58)), body


def _warg(lib,arm,role,mats,gear):
    body=_bone(arm,'Bone.003')
    head=_bone(arm,'Head')
    for obj in _parts(lib,arm,role):
        for index,material in enumerate(obj.data.materials):
            obj.data.materials[index]=_paint(material,'Orc warg charcoal fur',(.19,.16,.115),True)
    # Retain the complete wolf muzzle, ears, paws and tail. The sparse mane
    # and collar distinguish a war mount without hiding its animal anatomy.
    for i in range(7):
        y=-.60+i*.18
        gear.cone('Warg raised neck mane',(0,y,2.05),(0,y+.06,2.35+.12*math.sin(i)),
                  .10,.006,body.name,mats['hair'])
    for side in [-1,1]:
        gear.curved('Warg reinforced cheek strap',[(side*.25,-.96,2.08),
                    (side*.28,-1.35,1.88),(side*.24,-1.47,1.70)],.035,head.name,mats['leather'])
        gear.ellipsoid('Warg collar iron rivet',(side*.32,-.60,1.92),
                       (.04,.055,.04),body.name,mats['steel'])
    return Vector((0,.10,2.13)),body


def _rhino(lib, arm, role, mats, gear, native):
    body = _bone(arm,'spine','body','back')
    head = _bone(arm,'head')
    for obj in _parts(lib,arm,role):
        for index,material in enumerate(obj.data.materials):
            obj.data.materials[index]=_paint(material,'Charcoal-red horned beast hide',(.23,.09,.07))
    p=native@head.head_local
    for side in [-1,1]:
        gear.ellipsoid('Obsidian beast shoulder barding',p+Vector((side*.68,.85,-.10)),
                       (.22,.84,.67),body.name,mats['steel'])
        gear.cone('Copper barding rivet',p+Vector((side*.77,.70,.52)),
                  p+Vector((side*.79,.70,.71)),.10,.07,body.name,mats['bronze'])
    gear.cone('Swept beast forehead horn',p+Vector((0,-.75,.35)),
              p+Vector((0,-1.17,1.12)),.23,.008,head.name,mats['dark'])
    b=native@body.head_local
    return b+Vector((0,.20,.70)),body


def _skeletal_horse(lib,arm,role,mats,geometry):
    gear=_Gear(arm,role,Matrix.Identity(4),geometry)
    for obj in _parts(lib,arm,role):
        lib.groups[role].remove(obj);bpy.data.objects.remove(obj,do_unlink=True)
    for b in arm.data.bones:
        if b.name.startswith('Horse_') and any(t in b.name for t in
                ['Spine','Neck','Leg_','Foreleg','Arm_','Forearm','Hoof']):
            if 'IK' in b.name:continue
            gear.cone('Articulated horse bone',b.head_local,b.tail_local,
                      .095,.075,b.name,mats['ivory'])
            gear.ellipsoid('Horse skeletal joint',b.head_local,(.12,)*3,b.name,mats['ivory'])
    spine=_bone(arm,'Horse_Spine_1');head=_bone(arm,'Horse_Head')
    for i in range(7):
        y=-.8+i*.32
        for side in [-1,1]:
            gear.curved('Open horse rib',[(0,y,3.37),(side*.62,y,3.1),
                        (side*.63,y,2.39),(side*.15,y,2.05)],.065,spine.name,mats['ivory'])
    gear.ellipsoid('Skeletal horse skull',(0,-3.18,4.35),(.35,.52,.42),head.name,mats['ivory'])
    for side in [-1,1]:gear.ellipsoid('Horse hollow eye',(side*.32,-3.21,4.52),
                                     (.065,.10,.095),head.name,mats['dark'])
    seat=lib.socket(arm,'rider')
    gear.cube('Bone horse riding saddle',seat.head_local,(1.15,1.15,.13),
              seat.name,mats['leather'])
    return arm


def _fit_rider(mount,rider,role,seat_bone,mount_scale,profile):
    _state(rider,role+'_idle')
    hip=_bone(rider,'hip','pelvis')
    hip_local=rider.pose.bones[hip.name].head.copy()
    relative=Vector(tuple(2*value/mount_scale for value in profile['size']))
    scaled=Vector(tuple(hip_local[i]*relative[i] for i in range(3)))
    target=Vector((0,0,.18*relative.z))
    rider.parent=mount;rider.parent_type='BONE';rider.parent_bone=seat_bone.name
    rider.matrix_parent_inverse=Matrix.Translation((0,-seat_bone.length,0))
    rider.matrix_basis=Matrix.Translation(target-scaled) @ Matrix.Diagonal((*relative,1))
    bpy.context.view_layer.update()
    _state(mount,role+'_idle')
    expected=mount.matrix_world @ mount.pose.bones[seat_bone.name].matrix @ target
    measured=rider.matrix_world @ rider.pose.bones[hip.name].head
    error=(measured-expected).length
    if error>.005:raise ValueError('Rider seat fit failed '+str(error))
    rider['peris_seated_bind_pose']=True
    rider['peris_seat_attachment']=seat_bone.name
    rider['peris_seat_hip_world']=[round(v,6) for v in measured]
    rider['peris_seat_target_world']=[round(v,6) for v in expected]
    rider['peris_seat_fit_error']=round(error,8)
    rider['peris_seat_hip_clearance']=round(target.z*mount_scale,6)
    mount['peris_seated_bind_pose']=True
    mount['peris_seat_attachment']=seat_bone.name
    mount['peris_seat_fit_error']=round(error,8)
    _mute(mount);_mute(rider)


def _ground_mount(lib,mount,role):
    """Place the idle hoof/bone surface on the shared battlefield datum."""
    _state(mount,role+'_idle')
    deps=bpy.context.evaluated_depsgraph_get()
    lowest=math.inf
    for obj in _parts(lib,mount,role):
        evaluated=obj.evaluated_get(deps)
        mesh=evaluated.to_mesh()
        lowest=min(lowest,min((evaluated.matrix_world @ v.co).z for v in mesh.vertices))
        evaluated.to_mesh_clear()
    if not math.isfinite(lowest):raise ValueError('Missing mount ground geometry')
    mount.matrix_world=Matrix.Translation((0,0,-lowest)) @ mount.matrix_world
    mount['peris_idle_ground_offset']=round(-lowest,6)
    bpy.context.view_layer.update()
    _mute(mount)


def _seated_legs(rider,role):
    """Keep the animal rider's thighs seated and knees bent in every clip."""
    names=['thigh_L','thigh_R','leg_L','leg_R','foot_L','foot_R']
    for state in ['idle','walk','attack']:
        track=next(t for t in rider.animation_data.nla_tracks if t.name==role+'_'+state)
        strip=track.strips[0];action=strip.action;slot=strip.action_slot
        samples=[]
        for frame in range(1,26):
            _state(rider,track.name,frame)
            desired={}
            for side in ['L','R']:
                sign=1 if side=='L' else -1
                thigh=rider.data.bones['thigh_'+side]
                shin=rider.data.bones['leg_'+side]
                foot=rider.data.bones['foot_'+side]
                start=rider.pose.bones[thigh.name].head.copy()
                direction=Vector((sign*.40,-.92,-.025)).normalized()
                knee=start+direction*thigh.length
                ankle=knee+Vector((0,.035,-1)).normalized()*shin.length
                def aimed(bone,p,vector):
                    q=Vector(vector).to_track_quat('Y','Z')
                    return Matrix.LocRotScale(p,q,Vector((1,1,1)))
                desired[thigh.name]=aimed(thigh,start,knee-start)
                desired[shin.name]=aimed(shin,knee,ankle-knee)
                desired[foot.name]=aimed(foot,ankle,(0,-1,-.045))
            basis={}
            for name in names:
                bone=rider.data.bones[name]
                parent=desired.get(bone.parent.name,rider.pose.bones[bone.parent.name].matrix)
                basis[name]=bone.convert_local_to_pose(desired[name],bone.matrix_local,
                    parent_matrix=parent,parent_matrix_local=bone.parent.matrix_local,invert=True)
            time=strip.action_frame_start+(strip.action_frame_end-strip.action_frame_start)*(frame-1)/24
            samples.append((time,basis))
        for curve in list(action.fcurves):
            if any(curve.data_path.startswith('pose.bones["'+n+'"]') for n in names):action.fcurves.remove(curve)
        _mute(rider);rider.animation_data.action=action
        # Keep the NLA strip's original slot. Without this, Blender 4.5 creates
        # a second slot for imported rigs and the visible clip ignores edits.
        rider.animation_data.action_slot=slot
        for time,basis in samples:
            for name,matrix in basis.items():
                pose=rider.pose.bones[name];pose.rotation_mode='QUATERNION';pose.matrix_basis=matrix
                pose.keyframe_insert('location',frame=time,group=name)
                pose.keyframe_insert('rotation_quaternion',frame=time,group=name)
                pose.keyframe_insert('scale',frame=time,group=name)
        rider.animation_data.action=None
    rider['peris_seated_leg_pose']='horizontal forward thighs and bent knees baked into all three source clips'
    _mute(rider)


def replace_heavy_mount(lib,faction,role,horse,rider,mats,profile,geometry):
    """Return a distinctive source-rigged mount with a fitted seated rider."""
    if faction=='undead' and role!='heavy_cavalry':
        _skeletal_horse(lib,horse,role,mats,geometry)
        _ground_mount(lib,horse,role)
        _fit_rider(horse,rider,role,lib.socket(horse,'rider'),2,profile)
        horse['peris_mount_species']='skeletal horse'
        return horse,rider
    mapping={
        'orc':('fauna/elephant_asian.xml',2.0,'woolly war mammoth'),
        'pandaren':('fauna/elephant_asian.xml',2.0,'jade-armored woolly mammoth'),
        'undead':('fauna/elephant_asian.xml',2.0,'skeletal mammoth'),
        'elf':('fauna/deer.xml',2.8,'armored elk'),
        'dwarf':('fauna/boar.xml',3.8,'armored war boar'),
        'gnome':('fauna/boar.xml',3.6,'mechanical brass boar'),
        'demon':('fauna/rhino.xml',2.4,'horned rhinoceros beast'),
    }
    warg=faction=='orc' and role=='scout'
    if faction not in mapping or (role!='heavy_cavalry' and not warg):return horse,rider
    # Detach explicitly before deleting the old mount. Its rider and all rider
    # equipment keep their source bone coordinates and three animation tracks.
    rider.parent=None;rider.matrix_parent_inverse=Matrix.Identity(4)
    rider.matrix_basis=Matrix.Diagonal((*profile['size'],1))
    if faction in ['orc','pandaren','undead'] and not warg:_seated_legs(rider,role)
    _remove_rig(lib,horse,role)
    path,factor,species=('fauna/wolf.xml',3.7,'saddled war warg') if warg else mapping[faction]
    mount=lib.actor(path,role);mount.name=role+' '+species+' anatomy rig'
    native=mount.matrix_world.copy()
    if faction=='elf':
        # The legacy deer mesh is authored in canonical world coordinates,
        # with an inverse of its rotated armature as its parent inverse.
        # Reassigning the parent during generic actor assembly clears that
        # inverse; restore it for the source skin only, not arm-local props.
        for obj in _parts(lib,mount,role):
            if obj.get('source_actor')==path:obj.matrix_parent_inverse=native.inverted()
        bpy.context.view_layer.update()
    _animal_clips(lib,mount,lib.appearance('actors/'+path),role)
    _mute(mount)
    gear=_Gear(mount,role,native,geometry)
    if warg:base,parent=_warg(lib,mount,role,mats,gear)
    elif faction in ['orc','pandaren','undead']:base,parent=_mammoth(lib,mount,role,faction,mats,gear)
    elif faction in ['dwarf','gnome']:base,parent=_boar(lib,mount,role,faction,mats,gear)
    elif faction=='elf':base,parent=_elk(lib,mount,role,mats,gear,native)
    else:base,parent=_rhino(lib,mount,role,mats,gear,native)
    # Mammoths use a restrained narrow riding platform. Feet sit on the deck,
    # instead of intersecting the much wider animal's back.
    if faction in ['orc','pandaren','undead'] and not warg:
        floor=base+Vector((0,0,.34))
        gear.cube('Narrow mammoth riding deck',floor,(2.52,2.50,.20),parent.name,mats['leather'])
        for side in [-1,1]:
            gear.cube('Bronze riding deck edge',floor+Vector((side*1.24,0,.10)),
                      (.10,2.50,.14),parent.name,mats['bronze'])
        # The visible bench and bent-knee foot support keep this a seated
        # lancer on a small howdah, rather than an upright figure on a plank.
        seat_height=.34+.935*(2*profile['size'][2]/factor)
        seat=base+Vector((0,-.12,seat_height))
        gear.cube('Mounted lancer seat',seat-Vector((0,0,.12)),(1.42,1.36,.24),parent.name,mats['leather'])
        for side in [-1,1]:
            gear.cone('Saddle platform support',floor+Vector((side*.48,0,.05)),
                      seat+Vector((side*.48,0,-.15)),.12,.10,parent.name,mats['bronze'])
        gear.cube('Saddle back rest',seat+Vector((0,.62,.45)),(1.45,.18,1.15),parent.name,mats['bronze'])
        for side in [-1,1]:
            gear.cube('Visible mounted seat armrest',seat+Vector((side*.74,.08,.26)),
                      (.12,1.20,.12),parent.name,mats['bronze'])
    else:
        seat=base+Vector((0,0,.13))
        gear.cube('Fitted animal riding saddle',seat-Vector((0,0,.10)),
                  (1.05,1.15,.20),parent.name,mats['leather'])
        for side in [-1,1]:
            gear.curved('Saddle girth strap', [seat+Vector((side*.45,0,-.10)),
                        base+Vector((side*.58,0,-.53)),base+Vector((side*.28,0,-.8))],
                        .05,parent.name,mats['leather'])
    socket=_socket(mount,'peris_seated_rider',seat,native,parent.name)
    mount.matrix_world=Matrix.Rotation(math.pi/2,4,'Z') @ Matrix.Scale(factor,4) @ native
    if faction in ['dwarf','gnome','undead'] or warg:_ground_mount(lib,mount,role)
    mount['peris_mount_species']=species
    mount['peris_role']=role;rider['peris_role']=role
    mount['peris_species_source_actor']=path
    mount['asset_license']='CC-BY-SA-3.0'
    mount['asset_author']='Wildfire Games; original Peris fantasy anatomy adaptations'
    _fit_rider(mount,rider,role,socket,factor,profile)
    print('SPECIES_MOUNT_READY',faction,role,species,'seat error',rider['peris_seat_fit_error'],flush=True)
    return mount,rider


def _bare_body(lib,arm,role,material):
    # The source naked male is a complete authored anatomical surface, with
    # fingers, toes and UVs, and shares the source humanoid bind skeleton.
    for obj in list(_parts(lib,arm,role)):
        path=obj.get('source_actor','')
        if '/heads/' not in path:
            lib.groups[role].remove(obj);bpy.data.objects.remove(obj,do_unlink=True)
    objects=lib.dae('meshes/skeletal/new/m_naked.dae')
    source=next(o for o in objects if o.type=='ARMATURE')
    for bone in source.data.bones:
        other=arm.data.bones.get(bone.name)
        if other and max(abs(bone.matrix_local[r][c]-other.matrix_local[r][c])
                         for r in range(4) for c in range(4))>.05:
            raise ValueError('Bare anatomy bind mismatch '+bone.name)
    for obj in objects:
        if obj.type=='MESH':
            for modifier in obj.modifiers:
                if modifier.type=='ARMATURE':modifier.object=arm
            obj.parent=arm;obj.name=role+' original giant anatomy'
            obj.data.materials.clear();obj.data.materials.append(material)
            obj['peris_role']=role;obj['source_mesh']='skeletal/new/m_naked.dae'
            obj['asset_license']='CC-BY-SA-3.0';obj['asset_author']='Wildfire Games; original Peris giant adaptation'
            for p in obj.data.polygons:p.use_smooth=True
            lib.groups[role].append(obj)
        else:bpy.data.objects.remove(obj,do_unlink=True)


def _stone_material(name,color):
    material=_solid(name,color,0,.91)
    # Bake grain into image pixels, so runtime/export needs no procedural nodes.
    size=256;yy,xx=np.mgrid[:size,:size]
    grain=.85+.07*np.sin(xx*.71+yy*.43)+.05*np.sin(xx*.19-yy*.63)
    veins=np.abs(np.sin(xx*.036+yy*.053+np.sin(yy*.031)))<.065
    grain[veins]*=.59
    pixels=np.ones((size,size,4),dtype=np.float32)
    pixels[:,:,:3]=grain[:,:,None]*np.asarray(color)
    image=bpy.data.images.new(name+' stone grain',width=size,height=size,alpha=False)
    image.pixels.foreach_set(pixels.ravel());image.pack()
    tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
    material.node_tree.links.new(tex.outputs['Color'],material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    return material


def _carry_pose(arm,role):
    """Hold the boulder at the source throwing hand's highest wind-up pose."""
    hand=_bone(arm,'hand_R')
    best=None
    for frame in range(1,25):
        _state(arm,role+'_attack',frame)
        height=arm.pose.bones[hand.name].head.z
        if best is None or height>best[0]:
            best=(height,{b.name:b.matrix_basis.copy() for b in arm.pose.bones
                         if b.name in ['shoulder_R','arm_R','upperarm_R','forearm_R','hand_R','handIK_R']})
    for state in ['idle','walk']:
        track=next(t for t in arm.animation_data.nla_tracks if t.name==role+'_'+state)
        action=track.strips[0].action
        for curve in list(action.fcurves):
            if any(curve.data_path.startswith('pose.bones["'+name+'"]') for name in best[1]):
                action.fcurves.remove(curve)
        _mute(arm);arm.animation_data.action=action
        arm.animation_data.action_slot=track.strips[0].action_slot
        for name,matrix in best[1].items():
            b=arm.pose.bones[name];b.matrix_basis=matrix
            for frame in [1,25]:
                b.keyframe_insert('location',frame=frame)
                b.keyframe_insert('rotation_quaternion' if b.rotation_mode=='QUATERNION' else 'rotation_euler',frame=frame)
                b.keyframe_insert('scale',frame=frame)
        arm.animation_data.action=None
    _mute(arm)


def build_living_siege(lib,faction,role,mats,profile,geometry):
    """Living stonehurlers occupy the existing catapult visual role."""
    if role!='catapult' or faction not in ['orc','elf','dwarf','pandaren','undead','demon']:
        return None
    path='units/romans/infantry_javelinist_e.xml'
    arm=lib.actor(path,role);lib.clips(arm,lib.appearance('actors/'+path),role)
    stone=faction in ['elf','dwarf','undead']
    colors={'orc':(.33,.40,.28),'elf':(.30,.34,.27),'dwarf':(.23,.25,.27),
            'pandaren':(.46,.47,.43),'undead':(.24,.23,.27),'demon':(.29,.105,.075)}
    if stone:surface=_stone_material(faction+' stone anatomy',colors[faction])
    else:
        base=lib.material({'textures':{'baseTex':'skeletal/gaul/naked_01.png'}},'peris/giant-body')
        surface=_paint(base,faction+' giant anatomical skin',colors[faction])
    if faction=='orc':
        import roster_orc_anatomy
        roster_orc_anatomy.apply(lib,arm,role,mats,geometry,giant=True)
    else:_bare_body(lib,arm,role,surface)
    for obj in _parts(lib,arm,role):
        if '/heads/' in obj.get('source_actor',''):
            if stone:obj.data.materials.clear();obj.data.materials.append(surface)
            else:
                for i,material in enumerate(obj.data.materials):obj.data.materials[i]=_paint(material,faction+' giant face',colors[faction])
    gear=_Gear(arm,role,Matrix.Identity(4),geometry)
    hip=_bone(arm,'hip');chest=_bone(arm,'chest');head=_bone(arm,'prop-head','head')
    stone_gear=_stone_material(faction+' boulder granite',(.36,.37,.34))
    if stone:
        # Faceted plates follow real shoulders, elbows, knees and fingers.
        # The complete anatomical mesh under them keeps articulated gaps.
        for b in arm.data.bones:
            if b.name in ['chest','arm_L','arm_R','upperarm_L','upperarm_R','forearm_L','forearm_R','thigh_L','thigh_R','leg_L','leg_R']:
                p=(b.head_local+b.tail_local)*.5
                size=(.26,.25,.45) if 'arm' in b.name else (.34,.30,.51)
                if b.name=='chest':size=(.55,.34,.43)
                obj=gear.cube('Carved anatomical stone slab',p,size,b.name,surface,.055)
                for polygon in obj.data.polygons:polygon.use_smooth=False
        if faction=='elf':
            for side in [-1,1]:
                gear.curved('Living root binding',[hip.head_local+Vector((side*.34,.15,-.25)),
                            chest.head_local+Vector((side*.4,.19,-.1)),
                            chest.tail_local+Vector((side*.32,.12,.10))],.065,chest.name,mats['leather'])
        if faction=='dwarf':
            for name in ['forearm_L','forearm_R','leg_L','leg_R']:
                b=_bone(arm,name);gear.ellipsoid('Copper golem joint collar',b.head_local,
                                               (.29,.27,.15),b.name,mats['bronze'])
    else:
        for side in [-1,1]:
            wrist=_bone(arm,'forearm_'+('L' if side>0 else 'R'))
            a=wrist.head_local.lerp(wrist.tail_local,.55);b=wrist.head_local.lerp(wrist.tail_local,.91)
            gear.cone('Fitted giant wrist guard',a,b,.155,.125,wrist.name,
                      mats['bronze'] if faction=='pandaren' else mats['steel'])
    # Waist wrap covers the original anatomy while leaving its legs readable.
    wrap=mats.get('cloth',mats['leather'])
    if faction=='undead':wrap=_solid('Tombstone colossus violet cloth',(.19,.075,.25))
    for i in range(12):
        angle=i/12*math.tau
        p=hip.head_local+Vector((math.sin(angle)*.37,math.cos(angle)*.25,-.18))
        gear.cube('Siege giant waist wrap',p,(.18,.18,.45),hip.name,wrap,.03)
    if faction=='undead':
        eye=_solid('Tombstone restrained green eye',(.10,.40,.18),0,.4)
        for side in [-1,1]:gear.ellipsoid('Tombstone tiny green eye',
            head.head_local+Vector((side*.11,-.235,.12)),(.052,.021,.057),head.name,eye)
    if faction=='demon':
        for side in [-1,1]:gear.curved('Div giant swept horn',[
            head.head_local+Vector((side*.21,0,.28)),head.head_local+Vector((side*.43,.11,.60)),
            head.head_local+Vector((side*.34,.25,.86))],.105,head.name,mats['dark'])
    hand=_bone(arm,'hand_R')
    point=hand.matrix_local @ Vector((0,.18,0))
    boulder=gear.ellipsoid('Held siege boulder',point,(.43,.40,.43),hand.name,stone_gear)
    for polygon in boulder.data.polygons:polygon.use_smooth=False
    for v in boulder.data.vertices:
        v.co=point+(v.co-point)*(1+.045*math.sin(v.index*1.73))
    _carry_pose(arm,role)
    sizes={'orc':(4.0,3.6,3.6),'elf':(3.5,3.4,3.6),'dwarf':(4.1,3.9,3.0),
           'pandaren':(4.0,3.8,3.7),'undead':(3.7,3.5,3.7),'demon':(4.0,3.8,4.0)}
    arm.rotation_euler.z=math.pi/2;arm.scale=sizes[faction]
    arm.name=role+' '+faction+' living stonehurler anatomy rig'
    arm['peris_siege_species']={'orc':'boulder giant','elf':'rootstone golem','dwarf':'runestone golem',
        'pandaren':'mountain giant','undead':'tombstone colossus','demon':'Div stonehurler'}[faction]
    arm['peris_role']=role
    arm['peris_species_source_actor']=path;arm['peris_anatomy_source_mesh']='skeletal/new/m_naked.dae'
    arm['asset_license']='CC-BY-SA-3.0';arm['asset_author']='Wildfire Games; original Peris stonehurler adaptations'
    print('SPECIES_SIEGE_READY',faction,arm['peris_siege_species'],flush=True)
    return arm
