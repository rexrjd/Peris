"""Studio turntable views of one editable model for close source inspection."""
import argparse,pathlib,sys,bpy,math
from mathutils import Vector
parser=argparse.ArgumentParser()
parser.add_argument('--out',required=True);parser.add_argument('--role',default='line_infantry')
parser.add_argument('--size',type=int,default=1200)
parser.add_argument('--face-close-up',action='store_true')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=pathlib.Path(args.out)
if not out.is_absolute():out=pathlib.Path(__file__).resolve().parents[2]/out
out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene;scene.frame_set(1);scene.render.engine='BLENDER_EEVEE_NEXT'
scene.render.resolution_x=args.size;scene.render.resolution_y=args.size;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX';scene.view_settings.exposure=.7
scene.world=bpy.data.worlds.new('Hero soft neutral studio');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.27,.28,.27,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.9
deps=bpy.context.evaluated_depsgraph_get();points=[]
for obj in bpy.data.objects:
    if obj.type=='MESH':
        obj.hide_render=obj.get('peris_role')!=args.role
        if not obj.hide_render:
            ev=obj.evaluated_get(deps);points.extend(ev.matrix_world@Vector(v) for v in ev.bound_box)
if not points:raise ValueError('No matching hero '+args.role)
lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
center=(lo+hi)*.5;span=max(hi-lo)*1.25
def aim(obj,p):obj.rotation_euler=(Vector(p)-obj.location).to_track_quat('-Z','Y').to_euler()
for name,pos,power,size in [('Large softbox',(span*.6,-span*.8,span*1.5),5400,span*.8),
                            ('Fill',(-span*.9,-span*.2,span*.65),3200,span*.9),
                            ('Rim',(span*.5,span*.8,span*1.1),4200,span*.7)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=center+Vector(pos);aim(obj,center)
bpy.ops.mesh.primitive_plane_add(size=span*12,location=(0,0,lo.z-.012));floor=bpy.context.object
mat=bpy.data.materials.new('Neutral warm studio floor');mat.diffuse_color=(.20,.21,.20,1);floor.data.materials.append(mat)
data=bpy.data.cameras.new('Hero turntable');camera=bpy.data.objects.new('Hero turntable',data)
scene.collection.objects.link(camera);scene.camera=camera;data.type='ORTHO';data.ortho_scale=span
# The source is rotated +90 degrees into game +X forward.
views={'front_three_quarter':(.95,-1.15,.42),'front':(1.4,0,.19),'side':(0,-1.4,.19),'back':(-1.4,0,.19)}
for name,position in views.items():
    camera.location=center+Vector(position)*span;aim(camera,center)
    scene.render.filepath=str(out/(args.role+'-'+name+'.png'));bpy.ops.render.render(write_still=True)
    print('HERO_VIEW_RENDERED',name,str(scene.render.filepath),flush=True)
if args.face_close_up:
    rig=next(mod.object for obj in bpy.data.objects if obj.type=='MESH' and obj.get('peris_role')==args.role
             for mod in obj.modifiers if mod.type=='ARMATURE' and mod.object.get('peris_orc_face'))
    bone=rig.pose.bones.get('prop-head') or rig.pose.bones.get('head')
    if bone is None:raise ValueError('Hero closeup requires a head bone')
    target=rig.matrix_world@bone.matrix@bone.bone.matrix_local.inverted()@Vector(rig['peris_orc_head_center'])
    data.ortho_scale=2.30
    camera.location=target+Vector((4.0,-3.1,1.0));aim(camera,target)
    scene.render.filepath=str(out/(args.role+'-face-closeup.png'));bpy.ops.render.render(write_still=True)
    print('HERO_FACE_RENDERED',str(scene.render.filepath),flush=True)
