"""Read-only actual static/motion evidence for a saved fantasy quality native."""
import argparse,hashlib,json,math,pathlib,sys
import bpy
from mathutils import Vector

parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);parser.add_argument('--roles',nargs='+',default=['line_infantry']);parser.add_argument('--size',type=int,default=800);parser.add_argument('--grips',action='store_true');parser.add_argument('--grip-roles',nargs='+',default=['line_infantry']);parser.add_argument('--grip-frames',default='idle:1,attack:7',help='Explicit state:artist-frame pairs for additional roles');parser.add_argument('--faces',action='store_true');parser.add_argument('--hero-only',action='store_true',help='One actual three-quarter hero per role; retain the full evidence mode by default')
parser.add_argument('--motion-frames',default=None,help='Optional explicit state:artist-frame pairs, including with --hero-only')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);out=pathlib.Path(args.out).resolve()
if out.exists():raise FileExistsError(str(out))
out.mkdir(parents=True)
native=pathlib.Path(bpy.data.filepath);native_hash=hashlib.sha256(native.read_bytes()).hexdigest()
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=args.size;scene.render.resolution_y=args.size;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=.7
scene.world=bpy.data.worlds.new('Fantasy neutral soft evidence');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.27,.28,.27,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.9
meshes=[o for o in scene.objects if o.type=='MESH'];arms=[o for o in scene.objects if o.type=='ARMATURE']
baseline={a.name:{b.name:b.matrix_basis.copy() for b in a.pose.bones} for a in arms}
def sample(state,frame):
 for arm in arms:
  arm.animation_data.action=None
  for name,matrix in baseline[arm.name].items():arm.pose.bones[name].matrix_basis=matrix.copy()
  for track in arm.animation_data.nla_tracks:track.mute=not track.name.endswith('_'+state)
 scene.frame_set(-1);scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update()
def aim(obj,p):obj.rotation_euler=(Vector(p)-obj.location).to_track_quat('-Z','Y').to_euler()
lights=[]
for name,pos,power,size in [('Key',(.6,-.8,1.5),5400,.8),('Fill',(-.9,-.2,.65),3200,.9),('Rim',(.5,.8,1.1),4200,.7)]:
 data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);lights.append((obj,pos,size))
camera=bpy.data.objects.new('Fantasy evidence camera',bpy.data.cameras.new('Fantasy evidence camera'));scene.collection.objects.link(camera);scene.camera=camera;camera.data.type='ORTHO'
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.name='Evidence neutral floor';mat=bpy.data.materials.new('Neutral floor');mat.diffuse_color=(.20,.21,.20,1);floor.data.materials.append(mat)
rows=[]
for role in args.roles:
 sample('idle',1)
 for obj in meshes:obj.hide_render=obj.get('peris_role')!=role
 deps=bpy.context.evaluated_depsgraph_get();points=[]
 for obj in meshes:
  if not obj.hide_render:
   ev=obj.evaluated_get(deps);points.extend(ev.matrix_world@Vector(v) for v in ev.bound_box)
 if not points:raise ValueError('No role '+role)
 lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)]);center=(lo+hi)*.5;span=max(hi-lo)*1.28;floor.location.z=lo.z-.012
 for light,pos,size in lights:light.location=center+Vector(pos)*span;light.data.size=size*span;aim(light,center)
 camera.data.ortho_scale=span
 views={'front_three_quarter':(.95,-1.15,.42),'front':(1.4,0,.19),'side':(0,-1.4,.19),'back':(-1.4,0,.19)}
 if args.hero_only:views={'front_three_quarter':views['front_three_quarter']}
 for label,view in views.items():
  camera.location=center+Vector(view)*span;aim(camera,center);path=out/(role+'-'+label+'.png');scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);rows.append({'role':role,'state':'idle','frame':1,'view':label,'file':str(path)})
 motion=[] if args.hero_only else [('walk',7),('walk',14),('attack',7),('attack',14),('attack',23)]
 if args.motion_frames:motion=[(pair.split(':')[0],float(pair.split(':')[1])) for pair in args.motion_frames.split(',')]
 for state,frame in motion:
  sample(state,frame);camera.location=center+Vector((.95,-1.15,.42))*span;aim(camera,center);path=out/(role+'-'+state+str(frame)+'.png');scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);rows.append({'role':role,'state':state,'frame':frame,'view':'front_three_quarter','file':str(path)})
 if args.grips and role in args.grip_roles:
  rig=next(m.object for o in meshes if o.get('peris_role')==role for m in o.modifiers if m.type=='ARMATURE' and 'hand_R' in m.object.pose.bones)
  camera.data.ortho_scale=.95
  pairs=[('idle',1),('walk',14),('attack',1),('attack',7),('attack',14)] if role=='line_infantry' else [(p.split(':')[0],int(p.split(':')[1])) for p in args.grip_frames.split(',')]
  for state,frame in pairs:
   sample(state,frame)
   for side in ['R','L']:
    target=rig.matrix_world@rig.pose.bones['hand_'+side].matrix@Vector((0,.13,0));camera.location=target+Vector((1.05,-1.05,.34));aim(camera,target);path=out/(role+'-'+side+'-grip-'+state+str(frame)+'.png');scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);rows.append({'role':role,'state':state,'frame':frame,'view':side+' actual grip closeup','file':str(path)})
 if args.faces:
  sample('idle',1);rig=next(m.object for o in meshes if o.get('peris_role')==role for m in o.modifiers if m.type=='ARMATURE')
  target=rig.matrix_world@rig.pose.bones['head'].matrix@Vector((0,.20,0));camera.data.ortho_scale=1.20
  for label,direction in [('face_front',(1.4,0,.13)),('face_three_quarter',(.95,-1.15,.22))]:
   camera.location=target+Vector(direction)*2;aim(camera,target);path=out/(role+'-'+label+'.png');scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);rows.append({'role':role,'state':'idle','frame':1,'view':label,'file':str(path)})
 print('FANTASY_ROLE_CAPTURED',role,flush=True)
(out/'capture-provenance.json').write_text(json.dumps({'native':str(native),'nativeSha256':native_hash,'nativeFileUnchanged':hashlib.sha256(native.read_bytes()).hexdigest()==native_hash,'evaluation':'Restore saved pose bases before each separately sampled existing NLA state, retaining unkeyed source channels. Artist frames1..25.','captures':rows,'runtimeApproved':False,'finishedUnitApproved':False},indent=2)+'\n')
