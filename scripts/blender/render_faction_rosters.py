"""Render every completed source role for shape, seating and materials review."""
import bpy, pathlib, argparse, sys
from mathutils import Vector
parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);parser.add_argument('--roles',nargs='+')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=pathlib.Path(args.out)
if not out.is_absolute():out=pathlib.Path(__file__).resolve().parents[2]/out
out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene;scene.frame_set(1);scene.render.engine='BLENDER_EEVEE_NEXT'
scene.render.resolution_x=800;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
scene.world=bpy.data.worlds.new('Roster QA world');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.19,.18,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
for name,pos,power,size in [('Key',(12,-14,25),2600,12),('Fill',(-14,5,16),1700,14)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=pos;aim(o,(0,0,7))
data=bpy.data.cameras.new('Roster QA camera');camera=bpy.data.objects.new('Roster QA camera',data)
scene.collection.objects.link(camera);scene.camera=camera;data.type='ORTHO'
bpy.ops.mesh.primitive_plane_add(size=120);floor=bpy.context.object;floor.name='QA floor'
mat=bpy.data.materials.new('QA floor');mat.diffuse_color=(.075,.095,.08,1);floor.data.materials.append(mat)
roles=args.roles or ['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','ram','catapult']
deps=bpy.context.evaluated_depsgraph_get()
for role in roles:
    points=[]
    for o in bpy.data.objects:
        if o.type=='MESH' and o!=floor:
            o.hide_render=o.get('peris_role')!=role
            if not o.hide_render:
                evaluated=o.evaluated_get(deps)
                points.extend(evaluated.matrix_world@Vector(v) for v in evaluated.bound_box)
    if not points:raise ValueError('Missing completed role '+role)
    lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
    center=(lo+hi)*.5;span=max(hi-lo)*1.55
    camera.location=center+Vector((span*.85,-span*1.2,span*.60));aim(camera,center)
    data.ortho_scale=span;scene.render.filepath=str(out/(role+'.png'));bpy.ops.render.render(write_still=True)
    print('ROSTER_ROLE_RENDERED',role,str(out/(role+'.png')),flush=True)
