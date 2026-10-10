"""Render saved sources for geometry QA. Does not modify the saved .blend."""
import bpy, pathlib, argparse, sys
from mathutils import Vector
parser=argparse.ArgumentParser();parser.add_argument('--out',required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);out=pathlib.Path(args.out)
if not out.is_absolute():out=pathlib.Path(__file__).resolve().parents[2]/out
out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=900;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('QA world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.18,.2,.2,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
scene.view_settings.view_transform='AgX'
def aim(o,point):o.rotation_euler=(Vector(point)-o.location).to_track_quat('-Z','Y').to_euler()
for name,pos,power,size in [('Key',(8,-9,18),1900,8),('Fill',(-6,5,12),1200,10)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=pos;aim(light,(0,0,6))
data=bpy.data.cameras.new('QA camera');camera=bpy.data.objects.new('QA camera',data);scene.collection.objects.link(camera);scene.camera=camera;data.type='ORTHO'
bpy.ops.mesh.primitive_plane_add(size=100);floor=bpy.context.object;floor.name='QA floor';m=bpy.data.materials.new('QA stone');m.diffuse_color=(.09,.11,.105,1);floor.data.materials.append(m)
for role,position,target,span in [('line_infantry',(13,-19,12),(0,0,4),12),('heavy_cavalry',(18,-24,15),(0,0,7),19),('heavy_cavalry-side',(3,-27,12),(0,0,7),19)]:
    key=role.replace('-side','')
    for o in bpy.data.objects:
        if o.type=='MESH' and o!=floor:o.hide_render=o.get('peris_role')!=key
    camera.location=position;aim(camera,target);data.ortho_scale=span
    scene.render.filepath=str(out/(role+'.png'));bpy.ops.render.render(write_still=True)
print('UNIT_QA_RENDERS',str(out),flush=True)
