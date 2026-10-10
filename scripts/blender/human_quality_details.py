"""Reference-led human kit details, on existing licensed bodies and rigs.

Called before atlas packing. Original meshes/actions remain in older editions.
All added equipment uses existing joints; no game rules are changed.
"""
import math, json, bpy, bmesh, numpy as np
from mathutils import Vector, Matrix
import roster_race_equipment as race
import prototype_shield_fit as shield_fit
import orc_portrait_hands as closed

_GRIPS = {}

def _surface_detail(material, kind):
    p = material.node_tree.nodes.get('Principled BSDF')
    if not p or p.inputs['Normal'].is_linked: return
    size = 256
    yy, xx = np.mgrid[:size, :size]
    rng = np.random.default_rng(sum(map(ord, material.name)))
    h = rng.normal(0, .18, (size, size))
    if kind == 'cloth': h += .34 * np.sin(xx * 2.1) * np.sin(yy * 2.1)
    else: h += .14 * np.sin(xx * .17 + yy * .07)
    dy, dx = np.gradient(h)
    normal = np.stack((-dx * .14, -dy * .14, np.ones_like(dx)), axis=2)
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    pixels = np.ones((size, size, 4), dtype=np.float32); pixels[:, :, :3] = normal * .5 + .5
    image = bpy.data.images.new(material.name + ' original shallow surface', width=size, height=size)
    image.colorspace_settings.name = 'Non-Color'; image.pixels.foreach_set(pixels.ravel()); image.pack()
    tex = material.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = image
    node = material.node_tree.nodes.new('ShaderNodeNormalMap')
    material.node_tree.links.new(tex.outputs['Color'], node.inputs['Color'])
    material.node_tree.links.new(node.outputs['Normal'], p.inputs['Normal'])
    if kind == 'metal': p.inputs['Roughness'].default_value = .47

def _panel(arm, role, name, center, width, length, material, g, bone='hip'):
    rows = 8; columns = 7; points = []
    for r in range(rows):
        t = r / (rows - 1)
        for c in range(columns):
            x = (c / (columns - 1) - .5) * width
            points.append(center + Vector((x, -.025 * math.sin(c * 1.9) + .10 * t, -length * t)))
    faces = [(r * columns + c, r * columns + c + 1, (r + 1) * columns + c + 1, (r + 1) * columns + c) for r in range(rows - 1) for c in range(columns - 1)]
    return race._mesh(name, points, faces, arm, role, bone, material, g, True)

def _grip(lib, arm, role, side, material, g):
    # Reuse the validated connected four-finger/opposed-thumb construction.
    if side in _GRIPS:
        try: _GRIPS[side][0].name
        except ReferenceError: del _GRIPS[side]
    if side not in _GRIPS:
        before = closed._TARGET_TRIANGLES; closed._TARGET_TRIANGLES = 3200
        try: obj, record = closed._make_local(side, None, .040)
        finally: closed._TARGET_TRIANGLES = before
        _GRIPS[side] = (obj.data.copy(), record)
        _GRIPS[side][0].use_fake_user = True
        bpy.data.objects.remove(obj, do_unlink=True)
    data, record = _GRIPS[side]
    obj = bpy.data.objects.new(role + ' connected human ' + side + ' gripping glove', data.copy())
    bpy.context.scene.collection.objects.link(obj)
    obj.data.transform(arm.data.bones['hand_' + side].matrix_local)
    g['mesh_prop'](obj, arm, role, 'hand_' + side, material)
    obj['peris_closed_grip_topology'] = json.dumps(record)
    return obj

def _closed_melee(lib, arm, role, leather, g):
    if role in ('archer',): return
    parts = list(race._parts(lib, arm, role))
    sword_role = role == 'line_infantry' or (role == 'elite' and arm.get('peris_human_portrait_kit') == 'roman elite')
    # Line swords are already authored on hand_R. Move their whole assembly
    # into the same existing palm socket, retaining blade proportions/UVs.
    if sword_role:
        hand = arm.data.bones['hand_R']; inv = hand.matrix_local.inverted()
        grip = next((o for o in parts if 'Hand fitted wrapped sword grip' in o.name), None)
        if grip:
            local = [inv @ v.co for v in grip.data.vertices]
            center = (min(local, key=lambda v: v.z) + max(local, key=lambda v: v.z)) * .5
            axis = (max(local, key=lambda v: v.z) - min(local, key=lambda v: v.z)).normalized()
            rotation = axis.rotation_difference(Vector((0, 0, 1))).to_matrix()
            terms = ['forged blade', 'wrapped sword grip', 'Forged sword guard', 'Sword metal pommel']
            for obj in parts:
                if any(term in obj.name for term in terms):
                    for v in obj.data.vertices: v.co = hand.matrix_local @ (Vector((0, .15, 0)) + rotation @ (inv @ v.co - center))
                    obj.data.update()
    # Existing source polearms remain their original shapes. Their hand must
    # be inspected before substituting a fixed grip; leave those source digits.
    if not sword_role: return
    family = {'hand_R', 'finger_R', 'fingertip_R'}
    for obj in parts:
        if obj.get('peris_race_uniform') is None: continue
        bm = bmesh.new(); bm.from_mesh(obj.data); layer = bm.verts.layers.deform.active
        if layer:
            names = {v.index: v.name for v in obj.vertex_groups}
            faces = [f for f in bm.faces if sum(sum(w for i, w in v[layer].items() if names.get(i) in family) for v in f.verts) / len(f.verts) > .64]
            bmesh.ops.delete(bm, geom=faces, context='FACES')
        bm.to_mesh(obj.data); bm.free(); obj.data.update()
    _grip(lib, arm, role, 'R', leather, g)

def _shield_detail(lib, arm, role, faction, gold, leather, g):
    face = next((o for o in race._parts(lib, arm, role) if 'Portrait ' + faction + ' shield face' in o.name), None)
    if not face: return
    names = [v.name for v in face.vertex_groups]
    if len(names) != 1: raise ValueError('Explicit rigid human shield field required')
    bone = names[0]; basis = arm.data.bones[bone].matrix_local; inv = basis.inverted()
    points = [inv @ v.co for v in face.data.vertices]
    height = max(v.z for v in points) - min(v.z for v in points)
    body = shield_fit.standing_body_height(lib.collection, role, arm)
    anatomy = [v.co for o in race._parts(lib, arm, role) if o.get('peris_race_uniform') == faction for v in o.data.vertices]
    if not anatomy: raise ValueError('Actual human source body required for shield height')
    for obj in race._parts(lib, arm, role):
        if '/heads/' in obj.get('source_actor', ''):
            transform = arm.matrix_world.inverted() @ obj.matrix_world
            anatomy.extend(transform @ v.co for v in obj.data.vertices)
    body_height = max(p.z for p in anatomy) - min(p.z for p in anatomy)
    body['measuredBareBodyMeshRestHeight'] = body_height
    scale = body_height * .60 / height
    original_width = max(p.x for p in points) - min(p.x for p in points)
    aspect = .43 if faction == 'roman' and role not in ('light_cavalry', 'heavy_cavalry') else .72 if faction == 'spartan' else .56
    width_scale = body_height * .60 * aspect / original_width
    selected = [o for o in race._parts(lib, arm, role) if 'shield' in o.name.lower()]
    for obj in list(selected):
        if 'rear leather hand grip' in obj.name or 'shield metal rim' in obj.name:
            selected.remove(obj); race._delete(lib, obj, role)
    for obj in selected:
        for v in obj.data.vertices:
            p = inv @ v.co; p.x *= width_scale; p.z *= scale; v.co = basis @ p
        obj.data.update()
    rz = height * scale * .5; rx = original_width * width_scale * .5
    # Explicit board edges avoid the source Bezier rim's overshoot at corners.
    outline = [inv @ v.co for v in face.data.vertices[:len(face.data.vertices)//2]]
    for i, a in enumerate(outline):
        b = outline[(i + 1) % len(outline)]
        a.y = b.y = -.078
        g['cone']('Shield fitted metal perimeter edge', basis @ a, basis @ b, .018, .018, arm, role, bone, gold)
    if faction == 'roman':
        for sign in (-1, 1):
            for i in range(7):
                a = Vector((sign * .055, -.091, .16 - i * .046))
                b = Vector((sign * (rx * .68 - i * .018), -.091, .32 - i * .103))
                g['cone']('Original Roman eagle wing feather', basis @ a, basis @ b, .014, .008, arm, role, bone, gold)
        g['cone']('Original Roman shield central eagle', basis @ Vector((0, -.096, -.23)), basis @ Vector((0, -.096, .29)), .020, .030, arm, role, bone, gold)
    elif faction == 'persian':
        for i in range(12):
            t = i * math.tau / 12
            a = basis @ Vector((math.sin(t) * rx * .55, -.09, math.cos(t) * rz * .55))
            b = basis @ Vector((math.sin(t + .10) * rx * .80, -.09, math.cos(t + .10) * rz * .80))
            g['cone']('Persian original radial inlaid rosette', a, b, .012, .012, arm, role, bone, gold)
    for i in range(16):
        t = i * math.tau / 16
        g['ellipsoid']('Shield forged perimeter rivet', basis @ Vector((math.sin(t) * rx * .92, -.09, math.cos(t) * rz * .92)), (.019, .014, .019), arm, role, bone, gold)
    # Field and original socket rotate relative to the palm. Rebind the entire
    # resized field/details to hand_L, retaining their armature rest coordinates.
    for obj in race._parts(lib, arm, role):
        if bone in obj.vertex_groups and all(sum(w.weight for w in v.groups if obj.vertex_groups[w.group].name == bone) > .99 for v in obj.data.vertices):
            for vg in list(obj.vertex_groups): obj.vertex_groups.remove(vg)
            vg = obj.vertex_groups.new(name='hand_L'); vg.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    hand = arm.data.bones['hand_L']; socket = Vector((0, .15, 0))
    handle_points = [hand.matrix_local @ (socket + Vector((0, 0, z))) for z in (-.15, .15)]
    g['cone']('Shield actual palm leather hilt', *handle_points, .040, .040, arm, role, 'hand_L', leather)
    for z, a in zip((-.15, .15), handle_points):
        target = basis @ Vector((0, .045, z))
        g['cone']('Shield functional rear iron bracket', a, target, .020, .020, arm, role, 'hand_L', gold)
    family = {'hand_L', 'finger_L', 'fingertip_L'}
    for obj in race._parts(lib, arm, role):
        if obj.get('peris_race_uniform') != faction: continue
        bm = bmesh.new(); bm.from_mesh(obj.data); layer = bm.verts.layers.deform.active
        if layer:
            groups = {v.index: v.name for v in obj.vertex_groups}
            faces = [f for f in bm.faces if sum(sum(w for i, w in v[layer].items() if groups.get(i) in family) for v in f.verts)/len(f.verts) > .64]
            bmesh.ops.delete(bm, geom=faces, context='FACES')
        bm.to_mesh(obj.data); bm.free(); obj.data.update()
    _grip(lib, arm, role, 'L', leather, g)
    arm['peris_human_shield_size'] = json.dumps({'standingBody': body, 'targetRatio': .60, 'fieldAndDetailsSameHandBinding': True, 'requiresActualPoseReview': True})

def apply(lib, arm, role, faction, palette, cream, leather, skin, g):
    chest = arm.data.bones['chest'].head_local; hip = arm.data.bones['hip'].head_local
    cloth, metal, gold = palette['cloth'], palette['metal'], palette['accent']
    light = role in ('scout', 'archer'); mounted = role in ('scout', 'light_cavalry', 'heavy_cavalry')
    for m in (cloth, cream, leather, metal, gold): _surface_detail(m, 'metal' if m in (metal, gold) else 'cloth')
    if faction in ('roman', 'spartan'):
        if role != 'scout':
            _panel(arm, role, 'Broad folded crimson shoulder mantle', chest + Vector((0, .28, .53)), .83, .70 if light else 1.1, cloth, g, 'chest')
        if not light:
            for row in range(5):
                for sign in (-1, 1):
                    p = chest + Vector((sign * .31, -.365, .53 - row * .14))
                    g['cube']('Torso leather articulated plate fastening', p, (.080, .024, .110), arm, role, 'chest', leather, .006)
                    g['ellipsoid']('Torso bronze plate fastening rivet', p + Vector((0, -.018, .03)), (.020, .012, .020), arm, role, 'chest', gold)
            for side in ('L', 'R'):
                leg = arm.data.bones['leg_' + side]
                for t in (.22, .73):
                    a = leg.head_local.lerp(leg.tail_local, t)
                    g['curved']('Greave functional leather rear binding', [a + Vector((-.12, .10, 0)), a + Vector((0, .15, -.02)), a + Vector((.12, .10, 0))], .019, arm, role, leg.name, leather)
    elif faction == 'persian':
        for sign in (-1, 1):
            _panel(arm, role, 'Teal split embroidered coat panel', hip + Vector((sign * .26, -.40, .13)), .34, .76 if mounted else .97, cloth, g)
            for row in range(6):
                p = hip + Vector((sign * .26, -.427, .09 - row * .13))
                g['cube']('Persian gold coat border stitch', p + Vector((sign * .13, 0, 0)), (.029, .014, .081), arm, role, 'hip', gold, .003)
        if role != 'scout': race._cape(arm, role, chest, hip, cloth, g)
        if not light:
            for row in range(5):
                for col in range(8):
                    t = (col - 3.5) * .21
                    p = chest + Vector((math.sin(t) * .45, -math.cos(t) * .36, .43 - row * .125))
                    race._leaf('Persian layered shoulder-to-waist metal scale', p, .135, .16, .018, arm, role, 'chest', metal, g)
    elif faction == 'egyptian':
        head = lib.socket(arm, 'head').head_local
        for sign in (-1, 1):
            _panel(arm, role, 'Lapis fitted nemes side drape', head + Vector((sign * .24, .12, .24)), .17, .66, cloth, g, lib.socket(arm, 'head').name)
        _panel(arm, role, 'Lapis royal linen waist tabard', hip + Vector((0, -.42, .13)), .30, .76 if mounted else 1.0, cloth, g)
        for i in range(17):
            t = -math.pi * .64 + i / 16 * math.pi * 1.28
            p = chest + Vector((math.sin(t) * .42, -math.cos(t) * .30, .51))
            g['cube']('Egyptian broad lapis-and-bronze collar tile', p, (.09, .055, .11), arm, role, 'chest', gold if i % 3 == 0 else cloth, .009)
    _closed_melee(lib, arm, role, leather, g)
    _shield_detail(lib, arm, role, faction, gold, leather, g)
    arm['peris_human_reference_detail_pass'] = json.dumps({'faction': faction, 'role': role, 'reference': 'Local faction character and expanded role sheets', 'changes': 'Original nation-specific cloth layering, material relief, armor fittings and shield paint; connected line sword grip', 'rigAndActionsUnchanged': True, 'finalArtApproved': False})
