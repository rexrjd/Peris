"""Connected, anatomical closed grips for the portrait's Orc line infantry.

Integration: build_portrait_closed_hands(lib, arm, role, skin, geometry) returns
two meshes registered by geometry['mesh_prop']. The caller owns source-hand
face removal. This module adds no bones, actions, equipment or source cuts.

Coordinates are hand-bone local: wrist along Y, shaft through (0, .15, 0)
parallel to Z. Four independently shaped C-shaped digits meet a broad palm;
the opposed thumb and wrist are fused into that same closed surface. The
construction union is baked before UV creation and existing hand-bone binding.
"""

import hashlib
import json
import math
import pathlib

import bpy
import bmesh
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree


GRIP_CENTER = (0.0, .15, 0.0)
HAFT_RADIUS = .053
GRIP_CLEARANCE = .0012
_VOXEL_SIZE = .0033
_TARGET_TRIANGLES = 12500
_ROOT = pathlib.Path(__file__).resolve().parents[2]


class _Solid:
    """Closed overlapping construction solids, subsequently fused once."""

    def __init__(self):
        self.vertices = []
        self.faces = []

    def add(self, vertices, faces):
        base = len(self.vertices)
        self.vertices.extend(Vector(v) for v in vertices)
        self.faces.extend(tuple(base + i for i in f) for f in faces)

    def loft(self, rows, sides=32):
        vertices = [(rx * math.cos(i / sides * math.tau), y,
                     z + rz * math.sin(i / sides * math.tau))
                    for y, rx, rz, z in rows for i in range(sides)]
        faces = [(r * sides + i, r * sides + (i + 1) % sides,
                  (r + 1) * sides + (i + 1) % sides, (r + 1) * sides + i)
                 for r in range(len(rows) - 1) for i in range(sides)]
        faces += [tuple(range(sides - 1, -1, -1)),
                  tuple(range((len(rows) - 1) * sides, len(rows) * sides))]
        self.add(vertices, faces)

    def ellipsoid(self, center, radii, sides=28, rings=20):
        center, radii = Vector(center), Vector(radii)
        vertices = [center + Vector((0, 0, -radii.z))]
        for r in range(1, rings):
            latitude = -math.pi / 2 + math.pi * r / rings
            for i in range(sides):
                angle = math.tau * i / sides
                vertices.append(center + Vector((math.cos(latitude) * math.cos(angle) * radii.x,
                                                  math.cos(latitude) * math.sin(angle) * radii.y,
                                                  math.sin(latitude) * radii.z)))
        top = len(vertices)
        vertices.append(center + Vector((0, 0, radii.z)))
        faces = [(0, 1 + (i + 1) % sides, 1 + i) for i in range(sides)]
        faces += [(1 + r * sides + i, 1 + r * sides + (i + 1) % sides,
                   1 + (r + 1) * sides + (i + 1) % sides, 1 + (r + 1) * sides + i)
                  for r in range(rings - 2) for i in range(sides)]
        faces += [(top, 1 + (rings - 2) * sides + i,
                   1 + (rings - 2) * sides + (i + 1) % sides) for i in range(sides)]
        self.add(vertices, faces)

    def digit(self, control, widths, depths, sides=18, steps=6):
        """A bent digit with tapered phalanges, knuckle fullness and a tip pad.

        Radii are not periodic: the finger ends after a distal phalanx rather
        than closing back around the shaft. Depth is across the finger rows.
        """
        points = [Vector(p) for p in control]
        samples = []
        for segment in range(len(points) - 1):
            a, b = points[max(segment - 1, 0)], points[segment]
            c, d = points[segment + 1], points[min(segment + 2, len(points) - 1)]
            for step in range(steps):
                t = step / steps
                point = .5 * ((2 * b) + (-a + c) * t +
                              (2 * a - 5 * b + 4 * c - d) * t * t +
                              (-a + 3 * b - 3 * c + d) * t * t * t)
                # Smooth interpolation preserves joint constrictions without
                # alternating ring ridges or disconnected sphere knuckles.
                u = t * t * (3 - 2 * t)
                samples.append((point, widths[segment] * (1 - u) + widths[segment + 1] * u,
                                 depths[segment] * (1 - u) + depths[segment + 1] * u))
        samples.append((points[-1], widths[-1], depths[-1]))
        vertices = []
        for r, (point, width, depth) in enumerate(samples):
            tangent = samples[min(r + 1, len(samples) - 1)][0] - samples[max(r - 1, 0)][0]
            tangent.normalize()
            across = Vector((0, 0, 1)) - tangent * tangent.z
            across.normalize()
            radial = tangent.cross(across).normalized()
            for i in range(sides):
                angle = math.tau * i / sides
                # A rounded rectangular phalanx section gives a broad dorsal
                # knuckle plane and flattened compressed pad, rather than a
                # circular hose. The joint widths below remain anatomical.
                cosine, sine = math.cos(angle), math.sin(angle)
                radial_factor = math.copysign(abs(cosine) ** .70, cosine)
                across_factor = math.copysign(abs(sine) ** .70, sine)
                vertices.append(point + radial * (radial_factor * width) +
                                 across * (across_factor * depth))
        faces = [(r * sides + i, r * sides + (i + 1) % sides,
                  (r + 1) * sides + (i + 1) % sides, (r + 1) * sides + i)
                 for r in range(len(samples) - 1) for i in range(sides)]
        faces += [tuple(range(sides - 1, -1, -1)),
                  tuple(range((len(samples) - 1) * sides, len(samples) * sides))]
        self.add(vertices, faces)


def _source_wrist(lib, arm, role, side):
    """Read the caller's already cut anatomical wrist; never modify its mesh.

    The cut is oblique and asymmetric, so a fixed circular tube cannot cover
    it. We retain that actual contour and the original deform weights for the
    overlap. The later clothing builder may remove enclosed skin separately.
    """
    inv = arm.data.bones['hand_' + side].matrix_local.inverted()
    contexts = []
    for obj in lib.groups.get(role, []):
        if obj.type != 'MESH' or obj.get('source_mesh') != 'skeletal/new/m_naked.dae':
            continue
        rest = arm.matrix_world.inverted() @ obj.matrix_world
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.normal_update()
        bm.verts.ensure_lookup_table()
        bm.verts.index_update()
        layer = bm.verts.layers.deform.active
        if layer is None:
            bm.free()
            continue
        names = {g.index: g.name for g in obj.vertex_groups}
        local = {v: inv @ rest @ v.co for v in bm.verts}
        def weights(vertex):
            return {names[index]: weight for index, weight in vertex[layer].items()
                    if names.get(index) in arm.data.bones and weight > 1e-6}
        edges = []
        for edge in bm.edges:
            if not edge.is_boundary:
                continue
            suitable = True
            for vertex in edge.verts:
                point = local[vertex]
                own = sum(weight for name, weight in weights(vertex).items()
                          if name in ('hand_' + side, 'forearm_' + side))
                if not (-.25 < point.y < .15 and point.x * point.x + point.z * point.z < .28 ** 2 and own > .55):
                    suitable = False
            if suitable:
                edges.append(edge)
        adjacent = {}
        for edge in edges:
            a, b = edge.verts
            adjacent.setdefault(a, []).append(b)
            adjacent.setdefault(b, []).append(a)
        pending = set(adjacent)
        while pending:
            todo = [pending.pop()]
            component = []
            while todo:
                vertex = todo.pop()
                component.append(vertex)
                for other in adjacent[vertex]:
                    if other in pending:
                        pending.remove(other)
                        todo.append(other)
            mean_hand = sum(weights(v).get('hand_' + side, 0) for v in component) / len(component)
            if len(component) < 12 or mean_hand < .45 or any(len(adjacent[v]) != 2 for v in component):
                continue
            # Follow the source edge cycle, preserving its nonplanar shape.
            ordered = [min(component, key=lambda v: v.index)]
            previous = None
            current = ordered[0]
            while True:
                following = min((v for v in adjacent[current] if v is not previous), key=lambda v: v.index)
                if following == ordered[0]:
                    break
                ordered.append(following)
                previous, current = current, following
                if len(ordered) > len(component):
                    raise RuntimeError('Source wrist contour did not form one closed cycle')
            if len(ordered) != len(component):
                continue
            # The connected source skin gives interpolation data on the overlap.
            surface = set(ordered)
            todo = list(ordered)
            while todo:
                vertex = todo.pop()
                for edge in vertex.link_edges:
                    other = edge.other_vert(vertex)
                    if other not in surface:
                        surface.add(other)
                        todo.append(other)
            samples = [(local[v].copy(), weights(v)) for v in sorted(surface, key=lambda v: v.index)
                       if -.32 < local[v].y < .13 and local[v].x ** 2 + local[v].z ** 2 < .30 ** 2]
            tree = KDTree(len(samples))
            for index, (point, weight) in enumerate(samples):
                tree.insert(point, index)
            tree.balance()
            points = [local[v].copy() for v in ordered]
            patch_faces = [face for face in bm.faces if all(v in surface and -.245 < local[v].y < .13 and
                                                            local[v].x ** 2 + local[v].z ** 2 < .32 ** 2
                                                            for v in face.verts)]
            patch_vertices = sorted({vertex for face in patch_faces for vertex in face.verts}, key=lambda v: v.index)
            patch_index = {vertex: index for index, vertex in enumerate(patch_vertices)}
            normal_matrix = (inv @ rest).to_3x3().inverted().transposed()
            patch_points = [local[v] + (normal_matrix @ v.normal).normalized() * .011 for v in patch_vertices]
            patch_polygons = [tuple(patch_index[v] for v in face.verts) for face in patch_faces]
            source_vertices = [local[v].copy() for v in patch_vertices]
            source_weights = [weights(v) for v in patch_vertices]
            source_triangles = []
            for face in patch_polygons:
                source_triangles.extend((face[0], face[i], face[i+1]) for i in range(1, len(face)-1))
            source_tree = BVHTree.FromPolygons(source_vertices, source_triangles, all_triangles=True)
            contexts.append({'points': points, 'samples': samples, 'tree': tree,
                             'patchVertices': patch_points, 'patchFaces': patch_polygons,
                             'sourceVertices': source_vertices, 'sourceWeights': source_weights,
                             'sourceTriangles': source_triangles, 'sourceTree': source_tree,
                             'report': {'sourceMesh': obj.name, 'contourVertices': len(points),
                                        'contourVertexIndices': [v.index for v in ordered],
                                        'contourBounds': [[min(p[a] for p in points) for a in range(3)],
                                                          [max(p[a] for p in points) for a in range(3)]],
                                        'averageHandWeight': mean_hand, 'sourceWeightSamples': len(samples),
                                        'adaptedSourceWristPatchFaces': len(patch_faces), 'sourceSurfaceOffset': .011}})
        bm.free()
    if not contexts:
        return None
    return max(contexts, key=lambda context: context['report']['contourVertices'])


def _source_patch_solid(solid, context, mirror):
    """Close an offset copy of real wrist skin with overlap under the cuff."""
    bm = bmesh.new()
    vertices = [bm.verts.new(Vector((p.x * mirror, p.y, p.z))) for p in context['patchVertices']]
    for polygon in context['patchFaces']:
        bm.faces.new([vertices[index] for index in polygon])
    boundaries = [edge for edge in bm.edges if edge.is_boundary]
    adjacent = {}
    for edge in boundaries:
        a, b = edge.verts
        adjacent.setdefault(a, []).append(b)
        adjacent.setdefault(b, []).append(a)
    pending = set(adjacent)
    cut_y = sum(p.y for p in context['points']) / len(context['points'])
    while pending:
        todo = [pending.pop()]
        component = []
        while todo:
            vertex = todo.pop()
            component.append(vertex)
            for other in adjacent[vertex]:
                if other in pending:
                    pending.remove(other)
                    todo.append(other)
        if any(len(adjacent[v]) != 2 for v in component):
            continue
        if sum(v.co.y for v in component) / len(component) >= cut_y - .018:
            continue
        ordered = [component[0]]
        previous = None
        current = component[0]
        while True:
            following = next(v for v in adjacent[current] if v is not previous)
            if following == ordered[0]:
                break
            ordered.append(following)
            previous, current = current, following
        # Extend the actual proximal outline beneath the retained bracer. This
        # replaces the source patch's open clothing crop with overlapping skin.
        extended = [bm.verts.new(v.co + Vector((0, -.065, 0))) for v in ordered]
        for i, vertex in enumerate(ordered):
            j = (i + 1) % len(ordered)
            bm.faces.new((vertex, ordered[j], extended[j], extended[i]))
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.verts.ensure_lookup_table()
    indices = {v: i for i, v in enumerate(bm.verts)}
    solid.add([v.co.copy() for v in bm.verts], [tuple(indices[v] for v in f.verts) for f in bm.faces])
    bm.free()


def _wrist_solid(solid, context, mirror):
    _source_patch_solid(solid, context, mirror)
    points = [Vector((p.x * mirror, p.y, p.z)) for p in context['points']]
    count = len(points)
    vertices = []
    for row in range(5):
        t = row / 4
        for source in points:
            angle = math.atan2(source.z, source.x)
            outward = Vector((math.cos(angle), 0, math.sin(angle)))
            # Three measured overlap contours cover the actual source lip.
            if row < 3:
                point = source + Vector((0, [-.012, .004, .014][row], 0))
                point += outward * [.006, .010, .011][row]
            else:
                target = Vector((math.cos(angle) * .108, .106, math.sin(angle) * .121))
                blend = .52 if row == 3 else 1.0
                point = (source + Vector((0, .014, 0)) + outward * .011).lerp(target, blend)
            vertices.append(point)
    faces = [(r * count + i, r * count + (i + 1) % count,
              (r + 1) * count + (i + 1) % count, (r + 1) * count + i)
             for r in range(4) for i in range(count)]
    # Triangular caps handle the genuinely nonplanar source contour.
    for row in (0, 4):
        center = sum(vertices[row * count:(row + 1) * count], Vector()) / count
        cap = len(vertices)
        vertices.append(center)
        for i in range(count):
            face = (cap, row * count + i, row * count + (i + 1) % count)
            faces.append(tuple(reversed(face)) if row == 0 else face)
    solid.add(vertices, faces)


def _construction(context=None, mirror=1):
    solid = _Solid()
    # Closed wrist overlaps the caller's original cut boundary. The broad palm
    # and metacarpal mass grow from it instead of forming a toroidal barrel.
    if context:
        _wrist_solid(solid, context, mirror)
    else:
        solid.loft([(-.066, .094, .091, 0), (-.040, .096, .094, 0),
                    (-.005, .099, .099, 0), (.028, .106, .109, 0),
                    (.058, .107, .112, 0), (.081, .100, .111, 0)])
    solid.ellipsoid((0, .038, 0), (.107, .060, .119))
    # Soft thenar/hypothenar volumes belong to the palm rather than separate
    # balls. Their union with the wrist and digit roots is baked below.
    solid.ellipsoid((-.058, .055, .046), (.060, .045, .065))
    solid.ellipsoid((-.035, .066, -.075), (.068, .040, .060))
    # Index, middle, ring and little finger. Different lengths, joint sizes and
    # slight axial slopes stop the fist reading as four identical stacked loops.
    fingers = [
        ('index', .089, 1.00, .000),
        ('middle', .030, 1.045, -.003),
        ('ring', -.030, .99, -.001),
        ('little', -.086, .86, .002),
    ]
    for name, z, scale, slant in fingers:
        control = [(.071, .061, z), (.108, .097, z),
                   (.112, .140, z + slant), (.095, .191, z + slant),
                   (.064, .221, z + slant), (.015, .224, z + slant),
                   (-.024, .212, z + slant), (-.043, .182, z + slant)]
        # The little finger has a shorter closing arc, not just a smaller pad.
        if name == 'little':
            control[-2] = (-.017, .212, z + slant)
            control[-1] = (-.032, .187, z + slant)
        widths = [v * scale for v in (.036, .041, .028, .038, .027, .029, .023, .019)]
        depths = [v * scale for v in (.027, .029, .023, .028, .022, .025, .020, .016)]
        solid.digit(control, widths, depths)
        # A closed, tapered capsule tip gives a real distal pulp pad instead of
        # the open end of a tube. It overlaps the final phalanx and is fused.
        tip = Vector(control[-1])
        tangent = (tip - Vector(control[-2])).normalized()
        solid.ellipsoid(tip + tangent * .005, (.021 * scale, .021 * scale, .018 * scale), sides=22, rings=14)
    # The thumb originates in the thenar eminence, crosses the index side and
    # opposes the curled pads. Its terminal pulp rests against the index finger.
    # It is part of the single union, never a floating curve or closed loop.
    solid.digit([(-.067, .029, .042), (-.109, .072, .089),
                 (-.112, .128, .105), (-.084, .190, .095),
                 (-.037, .219, .072), (-.016, .215, .059)],
                [.044, .039, .034, .035, .028, .019],
                [.040, .035, .031, .030, .025, .018], steps=7)
    solid.ellipsoid((-.014, .214, .056), (.021, .020, .020), sides=22, rings=14)
    return solid


def _active(obj):
    for selected in list(bpy.context.selected_objects):
        selected.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _apply(obj, modifier):
    _active(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def _recalculate(mesh, triangulate=False):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    if triangulate:
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def _topology(mesh):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    pending = set(bm.verts)
    components = []
    while pending:
        todo = [pending.pop()]
        size = 0
        while todo:
            vertex = todo.pop()
            size += 1
            for edge in vertex.link_edges:
                other = edge.other_vert(vertex)
                if other in pending:
                    pending.remove(other)
                    todo.append(other)
        components.append(size)
    report = {'vertices': len(bm.verts), 'faces': len(bm.faces),
              'triangles': sum(len(f.verts) - 2 for f in bm.faces),
              'connectedComponents': len(components),
              'componentVertexCounts': components,
              'boundaryEdges': sum(e.is_boundary for e in bm.edges),
              'nonManifoldEdges': sum(not e.is_manifold for e in bm.edges),
              'nonManifoldDetail': [{'vertices': [list(v.co) for v in e.verts],
                                     'faceAreas': [f.calc_area() for f in e.link_faces]}
                                    for e in bm.edges if not e.is_manifold],
              'signedVolume': bm.calc_volume(signed=True)}
    bm.free()
    return report


def _remove_boolean_residue(mesh):
    """Remove only zero-volume triangle islands left by exact subtraction."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-6)
    # Boolean/triangulation can leave opposite coincident triangles on a zero
    # thickness ridge. Remove only exact duplicate vertex triples, then still
    # require the resulting surface to be closed and manifold below.
    bm.verts.index_update()
    bm.normal_update()
    by_vertices = {}
    for face in bm.faces:
        by_vertices.setdefault(tuple(sorted(v.index for v in face.verts)), []).append(face)
    duplicates = []
    for faces in by_vertices.values():
        if len(faces) == 2 and faces[0].normal.dot(faces[1].normal) < -.999:
            duplicates.extend(faces)
        elif len(faces) > 1:
            duplicates.extend(faces[1:])
    if duplicates:
        bmesh.ops.delete(bm, geom=duplicates, context='FACES_ONLY')
        loose = [v for v in bm.verts if not v.link_faces]
        if loose: bmesh.ops.delete(bm, geom=loose, context='VERTS')
    pending = set(bm.verts)
    remove = []
    islands = 0
    while pending:
        todo = [pending.pop()]
        vertices = []
        while todo:
            vertex = todo.pop()
            vertices.append(vertex)
            for edge in vertex.link_edges:
                other = edge.other_vert(vertex)
                if other in pending:
                    pending.remove(other)
                    todo.append(other)
        if len(vertices) > 4:
            continue
        faces = {face for vertex in vertices for face in vertex.link_faces}
        volume = sum(face.verts[0].co.dot(face.verts[1].co.cross(face.verts[2].co)) / 6
                     for face in faces if len(face.verts) == 3)
        if len(faces) <= 4 and abs(volume) < 1e-10:
            remove.extend(vertices)
            islands += 1
    if remove:
        bmesh.ops.delete(bm, geom=remove, context='VERTS')
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return islands


def _grip_cutter(haft_radius):
    # Polygon circumscribes the desired clearance cylinder. Mid-edge radius is
    # exactly HAFT_RADIUS + GRIP_CLEARANCE, avoiding chord penetration.
    sides = 96
    radius = (haft_radius + GRIP_CLEARANCE) / math.cos(math.pi / sides)
    vertices = [(math.cos(i / sides * math.tau) * radius,
                 GRIP_CENTER[1] + math.sin(i / sides * math.tau) * radius, z)
                for z in (-.35, .35) for i in range(sides)]
    faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i)
             for i in range(sides)]
    faces += [tuple(range(sides - 1, -1, -1)), tuple(range(sides, 2 * sides))]
    data = bpy.data.meshes.new('Temporary exact hand-shaft clearance cutter')
    data.from_pydata(vertices, [], faces)
    data.update()
    _recalculate(data)
    obj = bpy.data.objects.new(data.name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _uv(mesh):
    # Continuous anatomical box projection: each orientation uses a consistent
    # scale over the whole hand rather than repeating a texture on every face.
    layer = mesh.uv_layers.new(name='OrcPortraitHandSurface')
    low = [min(v.co[a] for v in mesh.vertices) for a in range(3)]
    high = [max(v.co[a] for v in mesh.vertices) for a in range(3)]
    for polygon in mesh.polygons:
        drop = max(range(3), key=lambda axis: abs(polygon.normal[axis]))
        axes = [axis for axis in range(3) if axis != drop]
        for loop in polygon.loop_indices:
            co = mesh.vertices[mesh.loops[loop].vertex_index].co
            layer.data[loop].uv = tuple(.02 + .96 * (co[a] - low[a]) /
                                        max(high[a] - low[a], 1e-8) for a in axes)
        polygon.use_smooth = True


def _make_local(side, context=None, haft_radius=HAFT_RADIUS):
    # The source bones use parallel local X and Z axes, so a reflection of X
    # gives the left hand anatomical opposition to the right hand. The thumb
    # stays on the index (+Z) side of the grip in both hand-bone frames.
    mirror = -1 if side == 'L' else 1
    solid = _construction(context, mirror)
    data = bpy.data.meshes.new('Connected anatomical Orc ' + side + ' hand')
    data.from_pydata([(p.x * mirror, p.y, p.z) for p in solid.vertices], [], solid.faces)
    data.update()
    _recalculate(data)
    obj = bpy.data.objects.new(data.name, data)
    bpy.context.scene.collection.objects.link(obj)
    union = obj.modifiers.new('Bake connected palm wrist digits and opposing thumb', 'REMESH')
    union.mode = 'VOXEL'
    union.voxel_size = _VOXEL_SIZE
    union.use_smooth_shade = True
    _apply(obj, union)
    phases = {'afterUnion': _topology(obj.data)}
    smooth = obj.modifiers.new('Soften anatomical union seams', 'SMOOTH')
    smooth.factor = .23
    smooth.iterations = 2
    _apply(obj, smooth)
    obj.data.calc_loop_triangles()
    count = len(obj.data.loop_triangles)
    if count > _TARGET_TRIANGLES:
        reduction = obj.modifiers.new('Bound isolated hand topology', 'DECIMATE')
        reduction.ratio = _TARGET_TRIANGLES / count
        _apply(obj, reduction)
    phases['beforeShaftClearance'] = _topology(obj.data)
    cutter = _grip_cutter(haft_radius)
    try:
        clearance = obj.modifiers.new('Bake shaft clearance with contact patches', 'BOOLEAN')
        clearance.operation = 'DIFFERENCE'
        clearance.solver = 'EXACT'
        clearance.object = cutter
        _apply(obj, clearance)
    finally:
        cutter_mesh = cutter.data
        bpy.data.objects.remove(cutter, do_unlink=True)
        if cutter_mesh.users == 0:
            bpy.data.meshes.remove(cutter_mesh)
    _recalculate(obj.data, triangulate=True)
    residue = _remove_boolean_residue(obj.data)
    report = _topology(obj.data)
    report['constructionPhaseTopology'] = phases
    report['removedZeroVolumeBooleanTriangleIslands'] = residue
    if report['connectedComponents'] != 1 or report['nonManifoldEdges']:
        raise RuntimeError('Hand construction is not one closed connected surface: ' + json.dumps(report))
    radii = [math.hypot(v.co.x, v.co.y - GRIP_CENTER[1]) for v in obj.data.vertices]
    report['reservedHaftRadius'] = haft_radius
    report['minimumShaftRadialClearance'] = min(radii) - haft_radius
    report['verticesWithinContactBand'] = sum(r - haft_radius <= GRIP_CLEARANCE + .002 for r in radii)
    if report['minimumShaftRadialClearance'] < GRIP_CLEARANCE - .00004:
        raise RuntimeError('Hand enters its reserved haft cylinder: ' + json.dumps(report))
    _uv(obj.data)
    return obj, report


def _surface_weights(context, point):
    hit, normal, index, distance = context['sourceTree'].find_nearest(point)
    if index is None:
        nearest, sample, distance = context['tree'].find(point)
        return context['samples'][sample][1], distance
    triangle = context['sourceTriangles'][index]
    a, b, c = [context['sourceVertices'][i] for i in triangle]
    u, v, p = b-a, c-a, hit-a
    d00, d01, d11, d20, d21 = u.dot(u), u.dot(v), v.dot(v), p.dot(u), p.dot(v)
    denominator = d00*d11-d01*d01
    if abs(denominator) < 1e-14:
        bary = [1, 0, 0]
    else:
        second = (d11*d20-d01*d21)/denominator
        third = (d00*d21-d01*d20)/denominator
        bary = [1-second-third, second, third]
    weights = {}
    for vertex, factor in zip(triangle, bary):
        for name, value in context['sourceWeights'][vertex].items():
            weights[name] = weights.get(name, 0) + max(0, factor)*value
    total = sum(weights.values())
    return {name:value/total for name,value in weights.items()}, distance


def _wrist_weights(obj, arm, side, context, haft_radius):
    """Source-weighted overlap becomes rigid hand before shaft-contact pads."""
    if not context:
        return {'fit': 'fallback fixed wrist; source contour unavailable', 'sourceBlendedVertices': 0}
    inv = arm.data.bones['hand_' + side].matrix_local.inverted()
    ring = context['points']
    hand_name = 'hand_' + side
    assignments = []
    blended = 0
    source_distances = []
    for vertex in obj.data.vertices:
        point = inv @ vertex.co
        radial = math.hypot(point.x, point.y - GRIP_CENTER[1])
        nearest_ring = min(ring, key=lambda p: (p.x - point.x) ** 2 + (p.z - point.z) ** 2)
        delta = point.y - nearest_ring.y
        # The measured oblique source lip keeps its original triangle weights.
        # Only the actual clearance surface and the distal palm are hand-rigid.
        rigid = (point.y >= .095 or
                 (radial < haft_radius + .062 and point.y > .040) or
                 delta >= .072)
        if rigid:
            assignments.append({hand_name: 1.0})
            continue
        source, distance = _surface_weights(context, point)
        t = max(0, min(1, (delta - .014) / .058))
        t = t * t * (3 - 2 * t)
        weights = {name: weight * (1 - t) for name, weight in source.items()}
        weights[hand_name] = weights.get(hand_name, 0) + t
        weights = {name: value for name, value in weights.items() if value > 1e-5}
        total = sum(weights.values())
        assignments.append({name: value / total for name, value in weights.items()})
        if assignments[-1].get(hand_name, 0) < .99999:
            blended += 1
            source_distances.append(distance)
    obj.vertex_groups.clear()
    groups = {name: obj.vertex_groups.new(name=name) for name in sorted({name for weights in assignments for name in weights})}
    for index, weights in enumerate(assignments):
        for name, weight in weights.items():
            groups[name].add([index], weight, 'REPLACE')
    return {'fit': 'Actual source cut contour and source deform weights on overlapped wrist; grip contacts rigid to hand',
            'sourceBlendedVertices': blended,
            'maximumInfluences': max(len(weights) for weights in assignments),
            'maximumWeightNormalizationError': max(abs(sum(weights.values()) - 1) for weights in assignments),
            'maximumBlendedVertexNearestSourceDistance': max(source_distances) if source_distances else 0,
            'sourceContour': context['report']}


def build_portrait_closed_hands(lib, arm, role, skin, geometry, *, grip_radii=None):
    """Add two connected fists to the existing line infantry hand bones.

    `geometry['mesh_prop'](obj, arm, role, bone_name, skin)` is the builder's
    normal role/collection/material/atlas registration callback. Mesh vertices
    are transformed to armature rest coordinates before that callback. Source
    face removal, source credit and animated attachments remain caller-owned.
    """
    if role != 'line_infantry':
        raise ValueError('Portrait hand module is scoped to line_infantry only')
    if 'mesh_prop' not in geometry:
        raise KeyError("Portrait hands require geometry['mesh_prop']")
    for name in ('hand_R', 'hand_L'):
        if arm.data.bones.get(name) is None:
            raise KeyError('Portrait hands require existing bone ' + name)
    selection = list(bpy.context.selected_objects)
    active = bpy.context.view_layer.objects.active
    objects = []
    radii = {'R': HAFT_RADIUS, 'L': HAFT_RADIUS}
    if grip_radii is not None:
        if any(side not in radii for side in grip_radii):
            raise ValueError('grip_radii may name only R and L')
        radii.update(grip_radii)
    if any(not isinstance(radius, (int, float)) or not .025 <= radius <= .080 for radius in radii.values()):
        raise ValueError('Measured grip radii must be .025 through .080 hand-local units')
    portrait_sha = hashlib.sha256((_ROOT / 'public/art/battle/roster/orc.png').read_bytes()).hexdigest()
    try:
        for side in ('R', 'L'):
            bone = arm.data.bones['hand_' + side]
            context = _source_wrist(lib, arm, role, side)
            obj, report = _make_local(side, context, radii[side])
            obj.data.transform(bone.matrix_local)
            obj.data.update()
            obj = geometry['mesh_prop'](obj, arm, role, bone.name, skin)
            report['wristBinding'] = _wrist_weights(obj, arm, side, context, radii[side])
            obj['peris_role'] = role
            obj['asset_author'] = 'Peris: original portrait-matched palms/digits/thumb; Wildfire Games wrist surface adapted to the existing source rig'
            obj['asset_license'] = 'CC-BY-SA-3.0'
            obj['peris_component_credit'] = 'Peris: original connected palm, four curled digits and opposing thumb; adapted Wildfire Games anatomical wrist surface, existing source hand/forearm bones and transferred wrist deformation; CC-BY-SA-3.0'
            obj['peris_portrait_reference'] = 'public/art/battle/roster/orc.png: upper-left Axe Warrior'
            obj['peris_portrait_reference_sha256'] = portrait_sha
            obj['peris_portrait_hand'] = side
            obj['peris_closed_grip'] = 'Single connected anatomical palm/wrist; four open-ended curling digits, distinct knuckles/pulp pads, opposing fused thumb'
            obj['peris_grip_center_hand_local'] = list(GRIP_CENTER)
            obj['peris_grip_axis_hand_local'] = [0, 0, 1]
            obj['peris_grip_reserved_haft_radius'] = radii[side]
            obj['peris_grip_clearance_units'] = GRIP_CLEARANCE
            obj['peris_hand_construction_report'] = json.dumps(report, sort_keys=True)
            obj['original_peris_equipment'] = True
            obj['runtime_approved'] = False
            obj['peris_unit_finished'] = False
            objects.append(obj)
    finally:
        for selected in list(bpy.context.selected_objects):
            selected.select_set(False)
        for selected in selection:
            if selected.name in bpy.context.view_layer.objects:
                selected.select_set(True)
        if active and active.name in bpy.context.view_layer.objects:
            bpy.context.view_layer.objects.active = active
    return objects
