"""Original Axe Warrior weapons matched to the upper-left Peris Orc portrait.

Call apply_axe/apply_shield instead of the old line_infantry weapon builders.
These functions add geometry only: they do not remove objects, change the rig,
export an asset, modify shared materials, or approve a finished unit. Coordinates
are the builder's armature rest space (+Z up, front -Y). Rigid hand/socket binding
and the articulated shield grip retain the existing source skeleton.
"""
import hashlib
import math
import pathlib

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


_ROOT = pathlib.Path(__file__).resolve().parents[2]
_PORTRAIT = 'public/art/battle/roster/orc.png'
_PORTRAIT_SHA = None


def _portrait_sha():
    global _PORTRAIT_SHA
    if _PORTRAIT_SHA is None:
        _PORTRAIT_SHA = hashlib.sha256((_ROOT / _PORTRAIT).read_bytes()).hexdigest()
    return _PORTRAIT_SHA


def _bone(arm, name):
    bone = arm.data.bones.get(name)
    if bone is None:
        raise KeyError('Portrait-matched Orc weapons require ' + name)
    return bone


class _Maker:
    def __init__(self, arm, role, bone, geometry, component):
        self.arm = arm
        self.role = role
        self.bone = bone
        self.geometry = geometry
        self.component = component
        self.objects = []

    def mesh(self, name, vertices, faces, material, frame, smooth=False):
        local = [Vector(p) for p in vertices]
        data = bpy.data.meshes.new(name)
        data.from_pydata([frame @ p for p in local], [], faces)
        data.update()
        # Closed solids include mirrored rear decorations. Recalculate their
        # outward winding before UV creation rather than leaving reflected
        # copper relief with inverted lighting/culling.
        bm = bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(data)
        bm.free()
        # A continuous local projection keeps the entire front surface in one
        # weathering field instead of repeating a whole texture per triangle.
        uv = data.uv_layers.new(name='OrcPortraitWeaponSurface')
        lo = [min(p[i] for p in local) for i in range(3)]
        hi = [max(p[i] for p in local) for i in range(3)]
        for polygon in data.polygons:
            a, b, c = [local[i] for i in polygon.vertices[:3]]
            normal = (b - a).cross(c - a)
            drop = max(range(3), key=lambda i: abs(normal[i]))
            axes = [i for i in range(3) if i != drop]
            for loop, vertex in zip(polygon.loop_indices, polygon.vertices):
                uv.data[loop].uv = tuple((local[vertex][axis] - lo[axis]) /
                                         max(hi[axis] - lo[axis], 1e-6) for axis in axes)
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        obj = self.geometry['mesh_prop'](obj, self.arm, self.role, self.bone, material)
        for polygon in data.polygons:
            polygon.use_smooth = smooth
        obj['asset_author'] = 'Peris: original portrait-matched Orc weapon geometry'
        obj['asset_license'] = 'CC-BY-SA-3.0'
        obj['original_peris_equipment'] = True
        obj['peris_component_credit'] = ('Peris: original ' + self.component +
                                         ' geometry and assembly; source body/rig credits remain separate')
        obj['peris_portrait_weapon'] = self.component
        obj['peris_portrait_reference'] = _PORTRAIT + ': upper-left Axe Warrior'
        obj['peris_portrait_reference_sha256'] = _portrait_sha()
        obj['runtime_approved'] = False
        obj['peris_unit_finished'] = False
        self.objects.append(obj)
        return obj

    def lathe(self, name, profile, material, frame, sides=10, closed_profile=False):
        vertices = [(radius * math.cos(math.tau * i / sides),
                     radius * math.sin(math.tau * i / sides), z)
                    for z, radius in profile for i in range(sides)]
        rows = len(profile)
        faces = []
        for row in range(rows if closed_profile else rows - 1):
            nxt = (row + 1) % rows
            for i in range(sides):
                j = (i + 1) % sides
                faces.append((row * sides + i, row * sides + j,
                              nxt * sides + j, nxt * sides + i))
        if not closed_profile:
            faces.extend([tuple(range(sides - 1, -1, -1)),
                          tuple(range((rows - 1) * sides, rows * sides))])
        obj = self.mesh(name, vertices, faces, material, frame, smooth=True)
        if not closed_profile:
            obj.data.polygons[-1].use_smooth = False
            obj.data.polygons[-2].use_smooth = False
        return obj

    def ring(self, name, z, inner, outer, thickness, material, frame):
        bevel = min(.004, thickness * .20, (outer - inner) * .35)
        return self.lathe(name, [(z - thickness / 2, inner),
                                (z - thickness / 2, outer - bevel),
                                (z - thickness / 2 + bevel, outer),
                                (z + thickness / 2 - bevel, outer),
                                (z + thickness / 2, outer - bevel),
                                (z + thickness / 2, inner)], material, frame,
                          sides=10, closed_profile=True)

    def strip(self, name, points, width, height, material, frame, closed=False):
        """A solid beveled flat strip; no circular pipe ornament."""
        points = [Vector(p) for p in points]
        section = [(-.5, .002), (-.5, -.35 * height), (-.34, -height),
                   (.34, -height), (.5, -.35 * height), (.5, .002)]
        vertices = []
        for i, point in enumerate(points):
            previous = points[(i - 1) % len(points)] if closed or i else point
            following = points[(i + 1) % len(points)] if closed or i < len(points) - 1 else point
            tangent = following - previous
            tangent.y = 0
            if tangent.length < 1e-8:
                raise ValueError('Degenerate worked strip path: ' + name)
            across = Vector((-tangent.z, 0, tangent.x)).normalized()
            for sideways, depth in section:
                vertices.append(point + across * (sideways * width) + Vector((0, depth, 0)))
        faces = []
        for row in range(len(points) if closed else len(points) - 1):
            nxt = (row + 1) % len(points)
            for i in range(6):
                j = (i + 1) % 6
                faces.append((row * 6 + i, row * 6 + j, nxt * 6 + j, nxt * 6 + i))
        if not closed:
            faces += [tuple(range(5, -1, -1)), tuple(range((len(points) - 1) * 6, len(points) * 6))]
        return self.mesh(name, vertices, faces, material, frame)

    def stud(self, name, point, radius, material, frame):
        # Low polygon beveled domed head, seated on the plate; front is -Y.
        mount = frame @ Matrix.Translation(Vector(point)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
        return self.lathe(name, [(0, radius * .88), (.003, radius),
                                (.010, radius * .74), (.013, radius * .27)],
                          material, mount, sides=8)

    def thorn(self, name, point, radius, length, material, frame):
        mount = frame @ Matrix.Translation(Vector(point)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
        return self.lathe(name, [(0, radius), (.012, radius * .85),
                                (length, .0005)], material, mount, sides=4)


def _inset(outline, distance):
    """Small capped planar miter preserves the authored concave blade tips."""
    points = [Vector(p) for p in outline]
    area = sum(a.x * b.y - b.x * a.y for a, b in zip(points, points[1:] + points[:1]))
    sign = 1 if area > 0 else -1
    result = []
    for i, point in enumerate(points):
        first = (point - points[i - 1]).normalized()
        second = (points[(i + 1) % len(points)] - point).normalized()
        n1 = Vector((-first.y, first.x)) * sign
        n2 = Vector((-second.y, second.x)) * sign
        bisector = n1 + n2
        if bisector.length < 1e-8:
            bisector = n2
        bisector.normalize()
        denominator = max(.30, bisector.dot(n2))
        result.append(point + bisector * min(distance / denominator, distance * 2.6))
    return result


def _edge_material(iron):
    """One additional atlas material, derived without mutating shared iron."""
    name = 'Orc Axe Warrior honed iron cutting bevel'
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    material = iron.copy()
    material.name = name
    principled = material.node_tree.nodes.get('Principled BSDF')
    for key in ['Base Color', 'Metallic', 'Roughness']:
        for link in list(principled.inputs[key].links):
            material.node_tree.links.remove(link)
    principled.inputs['Base Color'].default_value = (.30, .29, .265, 1)
    principled.inputs['Metallic'].default_value = .88
    principled.inputs['Roughness'].default_value = .39
    material['peris_pbr_source'] = 'Original Peris honed edge factors; inherited fine iron normal'
    return material


def _axe_twist(arm, socket):
    """Measure the imported idle pose to show the blade and keep it outside.

    The socket's rest Z axis points forward, so assuming a fixed rest-space
    twist hid the tall blade edge-on in actual idle. This is an authoring fit;
    all animation state, frame and track mute settings are restored afterwards.
    """
    animation = arm.animation_data
    idle = next((track for track in animation.nla_tracks
                 if track.name.endswith('_idle') and track.strips), None) if animation else None
    if idle is None:
        arm['peris_portrait_axe_twist_method'] = 'Fallback source twist; no idle clip available; review required'
        return .52
    scene = bpy.context.scene
    original_frame, original_subframe = scene.frame_current, scene.frame_subframe
    action = animation.action
    mutes = [(track, track.mute) for track in animation.nla_tracks]
    try:
        animation.action = None
        for track, muted in mutes:
            track.mute = track != idle
        scene.frame_set(int(idle.strips[0].frame_start))
        bpy.context.view_layer.update()
        posed = arm.pose.bones[socket.name].matrix.to_3x3()
        facing = Vector((0, -1, 0))
        chest = arm.data.bones.get('chest')
        if chest:
            facing = (arm.pose.bones[chest.name].matrix @ chest.matrix_local.inverted()).to_3x3() @ facing
        local = posed.inverted() @ facing
        twist = math.atan2(local.x, -local.y)
        blade_out = posed @ Matrix.Rotation(twist, 3, 'Z') @ Vector((1, 0, 0))
        if blade_out.dot(Vector((-1, 0, 0))) < 0:
            twist += math.pi
        arm['peris_portrait_axe_twist_method'] = 'Imported idle chest-facing projection, blade extends outside right hand; animation restored'
        return twist
    finally:
        animation.action = action
        for track, muted in mutes:
            track.mute = muted
        scene.frame_set(original_frame, subframe=original_subframe)
        bpy.context.view_layer.update()


def apply_axe(lib, arm, role, iron, bronze, wood, leather, geometry, elite=False):
    """Add the tall swept asymmetrical portrait axe; return its created meshes."""
    socket = lib.socket(arm, 'weapon_R')
    hand = _bone(arm, 'hand_R')
    twist = _axe_twist(arm, socket)
    frame = socket.matrix_local @ Matrix.Rotation(twist, 4, 'Z')
    frame.translation = hand.matrix_local @ Vector((0, .15, 0))
    maker = _Maker(arm, role, socket.name, geometry, 'Axe Warrior axe')
    scale = 1.08 if elite else 1.0
    blade_width = .82
    # Tall swept leaf/cleaver profile with unequal barbs and deep lower taper.
    # The inner root runs into the forged socket rather than floating beside it.
    outline = [(.050, .575), (.012, .855), (-.060, 1.040), (-.120, 1.230),
               (.038, 1.166), (.088, 1.305), (.225, 1.030), (.340, .903),
               (.327, .816), (.415, .716), (.394, .629), (.465, .537),
               (.415, .417), (.346, .382), (.278, .112), (.205, .319),
               (.103, .452)]
    # Ensure the X/Z face loop is CCW so its front points toward -Y.
    if sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(outline, outline[1:] + outline[:1])) < 0:
        outline.reverse()
    outline = [(x * scale * blade_width, z * scale) for x, z in outline]
    bevel = .013 * scale
    inner = _inset(outline, bevel)
    n = len(outline)
    vertices = [(p[0], y, p[1]) for ring, y in
                [(inner, .037), (outline, .022), (outline, -.022), (inner, -.037)]
                for p in ring]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(3 * n, 4 * n))]
    faces += [(r * n + i, r * n + (i + 1) % n,
               (r + 1) * n + (i + 1) % n, (r + 1) * n + i)
              for r in range(3) for i in range(n)]
    blade = maker.mesh('Tall swept jagged asymmetrical forged axe blade', vertices, faces, iron, frame)
    blade.data.materials.append(_edge_material(iron))
    for polygon in blade.data.polygons:
        if 2 <= polygon.index < 2 + n or polygon.index >= 2 + n * 2:
            polygon.material_index = 1
    blade['peris_axe_profile_ratio'] = ((max(z for x, z in outline) - min(z for x, z in outline)) /
                                       (max(x for x, z in outline) - min(x for x, z in outline)))
    # Branching copper web is flat forged relief on both faces, following the
    # asymmetric blade rather than stamping a generic diamond on a square.
    web = [[(.055, 1.135), (.113, .954), (.163, .788), (.211, .576), (.272, .263)],
           [(.113, .954), (.216, 1.012)],
           [(.163, .788), (.292, .847), (.328, .812)],
           [(.163, .788), (.091, .780), (.036, .855)],
           [(.211, .576), (.344, .612), (.406, .553)],
           [(.211, .576), (.159, .487)],
           [(.243, .421), (.327, .424)]]
    for side in [-1, 1]:
        # strip projects toward -Y; mirror the complete side frame for the rear.
        side_frame = frame if side < 0 else frame @ Matrix.Scale(-1, 4, Vector((0, 1, 0)))
        for path in web:
            maker.strip('Axe branching flat copper web rib', [(x * scale * blade_width, -.039, z * scale) for x, z in path],
                        .013 * scale, .007, bronze, side_frame)
        for x, z in [(.113, .954), (.163, .788), (.211, .576)]:
            maker.stud('Axe seated copper web junction rivet', (x * scale * blade_width, -.047, z * scale), .016, bronze, side_frame)
    maker.lathe('Tapered ash axe haft through closed palm',
                [(-.365, .039), (-.30, .049), (-.10, .052), (.20, .047),
                 (.56, .043), (1.095 * scale, .038)], wood, frame)
    # Two opposed socket cheeks and a hollow ferrule give the blade a plausible
    # attachment around its shaft. Rings seat on the haft and keep visible wood.
    maker.ring('Axe broad closed forged iron eye ferrule', .883 * scale, .043, .075, .145, iron, frame)
    for z in [.804, .962]:
        maker.ring('Axe eye ferrule copper locking ring', z * scale, .042, .080, .030, bronze, frame)
    for z in [-.313, .178, .490, .682]:
        maker.ring('Axe segmented haft iron binding collar', z, .043, .061, .046, iron, frame)
        maker.ring('Axe copper collar bevel ring', z + .014, .043, .064, .013, bronze, frame)
    for z in [-.223, -.148, -.073, .002, .077]:
        maker.ring('Axe closed-palm leather grip wrap', z, .048, .061, .059, leather, frame)
    maker.lathe('Axe forged faceted butt cap', [(-.390, .016), (-.374, .050), (-.341, .054), (-.321, .047)], iron, frame, sides=8)
    arm['peris_portrait_axe_grip_rest'] = list(frame.translation)
    arm['peris_portrait_axe_socket'] = socket.name
    arm['peris_portrait_axe_twist_radians'] = twist
    arm['peris_portrait_axe_review'] = 'Original portrait-matched study; actual idle/walk/attack grip review required'
    return maker.objects


def apply_shield(lib, arm, role, iron, bronze, wood, leather, geometry, elite=False):
    """Add convex angular shield with dimensional rim, device and real rear grip."""
    forearm = _bone(arm, 'forearm_L')
    hand = _bone(arm, 'hand_L')
    frame = Matrix.Identity(4)
    frame.translation = forearm.head_local.lerp(forearm.tail_local, .72) + Vector((.10, -.37, -.20))
    maker = _Maker(arm, role, forearm.name, geometry, 'Axe Warrior shield')
    factor = 1.08 if elite else 1.0
    outline = [(-.455, .560), (-.373, .705), (.340, .788), (.473, .650),
               (.399, -.488), (.085, -.813), (-.365, -.596)]
    outline = [(x * factor, z * factor + .16) for x, z in outline]
    center = Vector((0, 0, .17))
    rings = [1.0, .965, .85, .59, .27]
    depths = [-.041, -.067, -.103, -.151, -.179]
    n = len(outline)
    front = [Vector((x * t, depth, center.z + (z - center.z) * t))
             for t, depth in zip(rings, depths) for x, z in outline]
    front.append(Vector((0, -.184, center.z)))
    vertices = front + [p + Vector((0, .034, 0)) for p in front]
    faces = [(r * n + i, r * n + (i + 1) % n,
              (r + 1) * n + (i + 1) % n, (r + 1) * n + i)
             for r in range(len(rings) - 1) for i in range(n)]
    peak = len(front) - 1
    faces += [((len(rings) - 1) * n + i, (len(rings) - 1) * n + (i + 1) % n, peak) for i in range(n)]
    # Front/back winding follows the actual authored loop, with closed sides.
    if sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(outline, outline[1:] + outline[:1])) < 0:
        faces = [tuple(reversed(face)) for face in faces]
    faces += [tuple(i + len(front) for i in reversed(face)) for face in list(faces)]
    faces += [(i, (i + 1) % n, (i + 1) % n + len(front), i + len(front)) for i in range(n)]
    shield = maker.mesh('Convex angular hammered dark iron shield field', vertices, faces, iron, frame)
    shield['peris_shield_constructed_thickness'] = .034
    # A continuous stepped convex rim is bent plate with actual thickness and
    # catches light along both bevels. It is not a thin outline on a flat slab.
    rim = [(x * .973, -.060, center.z + (z - center.z) * .973) for x, z in outline]
    maker.strip('Shield broad bent copper perimeter rim', rim, .057, .015, bronze, frame, closed=True)
    inner_rim = [(x * .897, -.094, center.z + (z - center.z) * .897) for x, z in outline]
    maker.strip('Shield narrow inset worked copper border', inner_rim, .019, .007, bronze, frame, closed=True)
    for i, (x, z) in enumerate(outline):
        a = Vector((x * .973, -.075, center.z + (z - center.z) * .973))
        nx, nz = outline[(i + 1) % n]
        b = Vector((nx * .973, -.075, center.z + (nz - center.z) * .973))
        for t in [0, .32, .66]:
            maker.stud('Shield flush copper perimeter rivet', a.lerp(b, t), .018, bronze, frame)
    shield_tree = BVHTree.FromPolygons(vertices, faces)
    def surface_y(x, z, rear=False):
        start = Vector((x, 2 if rear else -2, z))
        direction = Vector((0, -1 if rear else 1, 0))
        hit = shield_tree.ray_cast(start, direction, 4)[0]
        if hit is None:
            raise ValueError('Portrait shield attachment misses the worked field: ' + str((x, z)))
        return hit.y
    def fitted_loop(corners, clearance):
        result = []
        for a, b in zip(corners, corners[1:] + corners[:1]):
            for t in [0, .25, .5, .75]:
                x = a[0] * (1 - t) + b[0] * t
                z = a[1] * (1 - t) + b[1] * t
                result.append((x, surface_y(x, z) - clearance, z))
        return result
    device = fitted_loop([(0, .17 + .370 * factor), (.224 * factor, .17),
                          (0, .17 - .370 * factor), (-.224 * factor, .17)], .006)
    maker.strip('Shield raised open copper clan diamond', device, .053, .020, bronze, frame, closed=True)
    small = fitted_loop([(0, .17 + .154), (.092, .17),
                         (0, .17 - .154), (-.092, .17)], .006)
    maker.strip('Shield inner angular copper diamond device', small, .024, .009, bronze, frame, closed=True)
    for x, z in [(-.288, .393), (.299, .394), (-.308, -.073), (.292, -.147), (0, .705), (0, -.491)]:
        maker.thorn('Shield short faceted copper diamond thorn', (x, surface_y(x, z) - .001, z), .041, .061, bronze, frame)
    # A crossed timber backing is hidden behind the iron shell, but makes the
    # handle and straps mechanically intelligible when the shield is rotated.
    for z in [-.24, .51]:
        path = [(x, surface_y(x, z, rear=True) + .031, z)
                for x in [-.30, -.20, -.10, 0, .10, .20, .29]]
        maker.strip('Shield rear timber brace fitted to convex field', path, .075, .031, wood, frame)
    # Keep the actual hand-local grip point from the existing closed palm API.
    hand_frame = hand.matrix_local
    handle_frame = hand_frame.copy()
    handle_frame.translation = hand_frame @ Vector((0, .15, 0))
    hand_maker = _Maker(arm, role, hand.name, geometry, 'Axe Warrior shield grip')
    hand_maker.lathe('Shield rear leather grip seated inside closed left palm',
                     [(-.175, .046), (-.149, .053), (.149, .053), (.175, .046)], leather, handle_frame)
    endpoints = [hand_frame @ Vector((0, .15, z)) for z in [-.16, .16]]
    for end in endpoints:
        local = frame.inverted() @ end
        local.x = max(-.30, min(.30, local.x))
        local.z = max(-.34, min(.57, local.z))
        local.y = surface_y(local.x, local.z, rear=True) + .025
        anchor = frame @ local
        vertices = []
        for row in range(5):
            t = row / 4
            point = anchor.lerp(end, t) + Vector((0, .021 * math.sin(t * math.pi), 0))
            tangent = (end - anchor + Vector((0, .021 * math.pi * math.cos(t * math.pi), 0))).normalized()
            across = Vector((1, 0, 0)) - tangent * tangent.x
            if across.length < 1e-6:
                across = Vector((0, 0, 1)) - tangent * tangent.z
            across.normalize()
            thickness = tangent.cross(across).normalized()
            for x, y in [(-.033, -.009), (.033, -.009), (.033, .009), (-.033, .009)]:
                vertices.append(point + across * x + thickness * y)
        faces = [(r * 4 + i, r * 4 + (i + 1) % 4,
                  (r + 1) * 4 + (i + 1) % 4, (r + 1) * 4 + i)
                 for r in range(4) for i in range(4)]
        faces += [(3, 2, 1, 0), (16, 17, 18, 19)]
        strap = maker.mesh('Shield thick articulated rear leather grip strap', vertices, faces, leather, Matrix.Identity(4))
        strap.vertex_groups.clear()
        shield_group = strap.vertex_groups.new(name=forearm.name)
        hand_group = strap.vertex_groups.new(name=hand.name)
        for row in range(5):
            t = row / 4
            indices = list(range(row * 4, row * 4 + 4))
            if t < 1:
                shield_group.add(indices, 1 - t, 'REPLACE')
            if t > 0:
                hand_group.add(indices, t, 'REPLACE')
        maker.stud('Shield rear strap seated bronze anchor', (0, 0, 0), .025, bronze,
                   frame @ Matrix.Translation(local) @ Matrix.Rotation(math.pi, 4, 'X'))
    maker.objects += hand_maker.objects
    arm['peris_portrait_shield_grip_rest'] = list(handle_frame.translation)
    arm['peris_portrait_shield_review'] = ('Closed left palm handle; articulated thick straps blend forearm/hand; '
                                          'actual idle/walk/attack contact review required')
    return maker.objects
