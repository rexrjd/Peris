"""Inspect the licensed study meshes without changing their source files."""
import bpy, json, pathlib
root=pathlib.Path(__file__).resolve().parents[2]
art=root/'assets/references/units/0ad'
report=[]
for relative in ['meshes/skeletal/new/m_armor_tunic_long.dae','meshes/skeletal/horse_lusitano.dae','animation/biped/rider/cavalry/generic/idle_shield_relax_01.dae']:
    file=art/relative
    if not file.exists():continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.collada_import(filepath=str(file))
    objects=[]
    for o in bpy.data.objects:
        item={'name':o.name,'type':o.type,'parent':o.parent.name if o.parent else None,'matrix':[list(r) for r in o.matrix_world]}
        if o.type=='MESH':item.update(vertices=len(o.data.vertices),faces=len(o.data.polygons),bounds=[list(v) for v in o.bound_box],groups=[g.name for g in o.vertex_groups])
        if o.type=='ARMATURE':item.update(bones=[{'name':b.name,'parent':b.parent.name if b.parent else None,'matrix':[list(r) for r in b.matrix_local]} for b in o.data.bones])
        if o.animation_data and o.animation_data.action:item['action']={'name':o.animation_data.action.name,'frames':list(o.animation_data.action.frame_range)}
        objects.append(item)
    report.append({'file':relative,'objects':objects,'fps':bpy.context.scene.render.fps})
out=root/'artifacts/battle-preview/reference-rigs.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2))
print('RIG_INSPECTION',str(out),flush=True)
