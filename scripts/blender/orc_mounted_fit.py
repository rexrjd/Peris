"""Transient, read-only source-study measurements for the three Orc mount roles.

No scaling, rest-bone edits, model saving or approval is performed here. Every
sample restores the actual saved pose bases before selecting explicitly named
NLA tracks/actions. Call restore_pose_baseline() when the study is finished.
Surface witnesses are evaluated mesh vertices; nearest-normal signs are only
local diagnostics, and BVH overlap does not detect complete containment.
"""
from contextlib import contextmanager
import math

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def _armatures(arms):
    result = list(arms)
    if len({a.name for a in result}) != len(result):
        raise ValueError('Duplicate armature in mounted study')
    for arm in result:
        if arm.type != 'ARMATURE':
            raise ValueError('Expected armature: ' + arm.name)
    return result


def snapshot_pose_baseline(arms):
    """Keep in-memory matrices, active actions and NLA flags, not a rest pose."""
    scene = bpy.context.scene
    result = {'scene': scene, 'frame': scene.frame_current,
              'subframe': scene.frame_subframe, 'arms': {}}
    for arm in _armatures(arms):
        ad = arm.animation_data
        result['arms'][arm.name] = {
            'object': arm,
            'basis': {b.name: b.matrix_basis.copy() for b in arm.pose.bones},
            'action': ad.action if ad else None,
            'action_slot': getattr(ad, 'action_slot', None) if ad else None,
            'use_nla': ad.use_nla if ad else None,
            'tracks': {t.name: (t.mute, t.is_solo) for t in ad.nla_tracks}
                      if ad else {},
        }
    return result


def restore_pose_baseline(arms, baseline):
    """Restore only state this helper changes; retain parenting and constraints."""
    for arm in _armatures(arms):
        saved = baseline['arms'].get(arm.name)
        if saved is None or saved['object'] != arm:
            raise ValueError('Missing exact saved baseline: ' + arm.name)
        if set(saved['basis']) != {b.name for b in arm.pose.bones}:
            raise ValueError('Armature topology changed after snapshot: ' + arm.name)
        ad = arm.animation_data
        if ad:
            ad.action = saved['action']
            if saved['action_slot'] is not None and ad.action:
                ad.action_slot = saved['action_slot']
            ad.use_nla = saved['use_nla']
            for track in ad.nla_tracks:
                if track.name not in saved['tracks']:
                    raise ValueError('NLA tracks changed after snapshot: ' + arm.name)
                track.mute, track.is_solo = saved['tracks'][track.name]
        for bone in arm.pose.bones:
            bone.matrix_basis = saved['basis'][bone.name].copy()
    baseline['scene'].frame_set(baseline['frame'], subframe=baseline['subframe'])
    bpy.context.view_layer.update()


def restore_and_sample(arms, role, state, frame, baseline):
    """Select exact per-arm targets, after restoring the saved source state.

    state must contain every arm.name, e.g. {mount.name: {'nla_track':
    'scout_walk'}, rider.name: {'nla_track': 'scout_walk'}}. Alternatively use
    {'action': exact_action_name, 'slot': exact_slot_identifier} per arm.
    No substring search or silent fallback to idle is allowed. Mount and rider
    sample the same scene frame; any retiming belongs in the authored source.
    """
    arms = _armatures(arms)
    if set(state) != {arm.name for arm in arms}:
        raise ValueError('Explicit animation target required for every armature')
    restore_pose_baseline(arms, baseline)
    chosen = []
    for arm in arms:
        spec = state[arm.name]
        ad = arm.animation_data
        if ad is None:
            raise ValueError('No animation data: ' + arm.name)
        if bool(spec.get('nla_track')) == bool(spec.get('action')):
            raise ValueError('Choose exactly one NLA track or action: ' + arm.name)
        ad.action = None
        for track in ad.nla_tracks:
            track.mute = True
            track.is_solo = False
        if spec.get('nla_track'):
            track = ad.nla_tracks.get(spec['nla_track'])
            if track is None or not track.strips:
                raise ValueError('Missing exact populated NLA track: ' + arm.name)
            track.mute = False
            ad.use_nla = True
            chosen.append({'armature': arm.name, 'track': track.name,
                           'actions': [s.action.name for s in track.strips if s.action]})
        else:
            action = bpy.data.actions.get(spec['action'])
            if action is None:
                raise ValueError('Missing exact action: ' + spec['action'])
            ad.use_nla = False
            ad.action = action
            slots = list(action.slots)
            if slots:
                matches = [s for s in slots if s.identifier == spec.get('slot')]
                if len(matches) != 1:
                    raise ValueError('Explicit exact action slot required: ' + arm.name)
                ad.action_slot = matches[0]
            chosen.append({'armature': arm.name, 'action': action.name,
                           'slot': getattr(ad.action_slot, 'identifier', None)})
        # Baseline restoration happens before NLA selection and evaluation.
        for bone in arm.pose.bones:
            bone.matrix_basis = baseline['arms'][arm.name]['basis'][bone.name].copy()
    scene = bpy.context.scene
    whole = math.floor(float(frame))
    subframe = float(frame) - whole
    scene.frame_set(whole - 1)
    scene.frame_set(whole, subframe=subframe)
    bpy.context.view_layer.update()
    return {'role': role, 'frame': float(frame), 'animation_targets': chosen,
            'saved_pose_bases_restored': True}


@contextmanager
def sampled_pose(arms, role, state, frame, baseline):
    """Restore the original source state even if measurement/rendering fails."""
    try:
        yield restore_and_sample(arms, role, state, frame, baseline)
    finally:
        restore_pose_baseline(arms, baseline)


def _evaluated_meshes(objects, deps):
    result = {}
    for obj in objects:
        if obj.type != 'MESH':
            raise ValueError('Surface target must be actual mesh: ' + obj.name)
        if obj.name in result:
            raise ValueError('Duplicate mesh target: ' + obj.name)
        evaluated = obj.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            result[obj.name] = {
                'vertices': [evaluated.matrix_world @ v.co for v in mesh.vertices],
                'triangles': [tuple(t.vertices) for t in mesh.loop_triangles],
                'base_vertex_count': len(obj.data.vertices),
            }
        finally:
            evaluated.to_mesh_clear()
    return result


def _combined(data):
    points, triangles = [], []
    for mesh in data.values():
        start = len(points)
        points.extend(mesh['vertices'])
        triangles.extend(tuple(start + i for i in tri) for tri in mesh['triangles'])
    if not points or not triangles:
        raise ValueError('Empty evaluated surface target')
    return points, triangles, BVHTree.FromPolygons(points, triangles,
                                                  all_triangles=True, epsilon=0.0)


def _surface_measurement(spec, deps):
    if not spec.get('name') or not spec.get('probe_objects') or not spec.get('target_objects'):
        raise ValueError('Named probe and target mesh sets are required')
    if {o.name for o in spec['probe_objects']} & {o.name for o in spec['target_objects']}:
        raise ValueError('A surface cannot be both probe and target')
    probes = _evaluated_meshes(spec['probe_objects'], deps)
    targets = _evaluated_meshes(spec['target_objects'], deps)
    _, _, target_bvh = _combined(targets)
    _, _, probe_bvh = _combined(probes)
    selections = spec.get('probe_vertex_indices')
    if selections is not None and set(selections) != set(probes):
        raise ValueError('Explicit probe vertex indices required for each probe mesh')
    distances, signed, nearest, violations = [], [], None, 0
    lo, hi = spec.get('min_distance'), spec.get('max_distance')
    for name, mesh in probes.items():
        if selections is not None and len(mesh['vertices']) != mesh['base_vertex_count']:
            raise ValueError('Selected base vertices need unchanged evaluated topology: ' + name)
        indices = selections[name] if selections is not None else range(len(mesh['vertices']))
        for index in indices:
            if index < 0 or index >= len(mesh['vertices']):
                raise ValueError('Invalid evaluated witness index: ' + name)
            point = mesh['vertices'][index]
            hit, normal, triangle, distance = target_bvh.find_nearest(point)
            if hit is None:
                raise ValueError('Missing nearest evaluated surface')
            distances.append(distance)
            signed.append((point - hit).dot(normal))
            if nearest is None or distance < nearest['distance']:
                nearest = {'probe_object': name, 'probe_vertex': index,
                           'point_world': list(point), 'target_world': list(hit),
                           'target_combined_triangle': triangle, 'distance': distance}
            violations += int((lo is not None and distance < lo) or
                              (hi is not None and distance > hi))
    if not distances:
        raise ValueError('No selected surface witnesses')
    overlaps = probe_bvh.overlap(target_bvh)
    return {'name': spec['name'], 'probe_objects': list(probes),
            'target_objects': list(targets), 'witness_count': len(distances),
            'witness_selection': 'explicit_evaluated_vertices' if selections is not None else 'all_evaluated_vertices',
            'nearest_distance_min': min(distances), 'nearest_distance_max': max(distances),
            'nearest_local_normal_signed_min': min(signed),
            'nearest_local_normal_signed_max': max(signed),
            'requested_distance_limits': [lo, hi], 'distance_limit_violations': violations,
            'nearest_witness': nearest,
            'surface_triangle_overlap_pairs': len(overlaps),
            'overlap_example_pairs': [list(p) for p in overlaps[:12]],
            'limitations': ['Nearest normal sign is local and not a solid containment test.',
                            'Triangle overlap omits wholly contained surfaces.',
                            'Distance limits do not establish anatomical or visual quality.']}


def measure_mounted_fit(mount_arm, rider_arm, mount_meshes, rider_meshes, *,
                        seat_bone, pelvis_bone, surface_targets, floor_z):
    """Measure explicit semantics in the currently evaluated pose, in world units.

    surface_targets is a list of named dictionaries with probe_objects,
    target_objects, optional probe_vertex_indices {object.name:[indices]}, and
    optional min_distance/max_distance. Select actual buttock/thigh/boot/hand
    witnesses, not whole body vertex sets, when specifying contact gap limits.
    """
    _armatures([mount_arm, rider_arm])
    if seat_bone not in mount_arm.pose.bones or pelvis_bone not in rider_arm.pose.bones:
        raise ValueError('Exact semantic seat and pelvis bones are required')
    if not math.isfinite(float(floor_z)):
        raise ValueError('An explicit finite world-space floor datum is required')
    deps = bpy.context.evaluated_depsgraph_get()
    mount = _evaluated_meshes(mount_meshes, deps)
    rider = _evaluated_meshes(rider_meshes, deps)
    mp, mt, _ = _combined(mount)
    rp, rt, _ = _combined(rider)
    em, er = mount_arm.evaluated_get(deps), rider_arm.evaluated_get(deps)
    seat = em.matrix_world @ em.pose.bones[seat_bone].head
    pelvis = er.matrix_world @ er.pose.bones[pelvis_bone].head
    return {'measurement_only': True, 'art_approved': False,
            'frame': bpy.context.scene.frame_current + bpy.context.scene.frame_subframe,
            'mount_armature': mount_arm.name, 'rider_armature': rider_arm.name,
            'seat_bone': seat_bone, 'pelvis_bone': pelvis_bone,
            'seat_head_world': list(seat), 'pelvis_head_world': list(pelvis),
            'pelvis_to_seat_head_vector': list(pelvis - seat),
            'pelvis_to_seat_head_distance': (pelvis - seat).length,
            'socket_metric_limit': 'Bone-head correspondence only; no skin-seat fit approval.',
            'world_floor_z': float(floor_z),
            'mount_min_floor_clearance': min(p.z for p in mp) - floor_z,
            'rider_min_floor_clearance': min(p.z for p in rp) - floor_z,
            'evaluated_geometry': {'mount_vertices': len(mp), 'mount_triangles': len(mt),
                                   'rider_vertices': len(rp), 'rider_triangles': len(rt)},
            'surfaces': [_surface_measurement(s, deps) for s in surface_targets],
            'requires_visual_review': ['seat and thigh compression', 'knees/boots/tack',
                                       'hand/rein or weapon contact', 'moving fur and armor',
                                       'continuous gait and loop seam']}
