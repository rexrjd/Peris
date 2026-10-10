"""Read-only low-cost whole-role and actual-grip source evidence."""
import bpy,pathlib,sys,json,hashlib,argparse,math
from mathutils import Vector
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from prototype_contact_floor import _snapshot,_pose,_restore
p=argparse.ArgumentParser();p.add_argument('--native',required=True);p.add_argument('--out',required=True);p.add_argument('--roles',nargs='+',default=['line_infantry','spear_guard','archer','elite','scout','light_cavalry','heavy_cavalry','ram','catapult']);p.add_argument('--frames',default='idle:1,walk:14,attack:7,attack:14');p.add_argument('--grips',action='store_true');p.add_argument('--size',type=int,default=448);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);S=pathlib.Path(a.native).resolve();D=pathlib.Path(a.out).resolve();D.mkdir(parents=True,exist_ok=True);bpy.ops.wm.open_mainfile(filepath=str(S),use_scripts=False);C=bpy.data.collections['PERIS_EXPORT'];objects=list(C.all_objects);arms,saved,oldframe=_snapshot(C);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();source_sha=sha(S);scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE_NEXT';scene.eevee.taa_render_samples=4;scene.render.resolution_x=a.size;scene.render.resolution_y=a.size;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX';scene.view_settings.exposure=.4;scene.world=bpy.data.worlds.new('Saved prototype evidence studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.27,.28,.27,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.8
camera=bpy.data.objects.new('Saved prototype evidence camera',bpy.data.cameras.new('Saved prototype evidence camera'));scene.collection.objects.link(camera);scene.camera=camera;camera.data.type='ORTHO';lights=[]
for name,pos,power in [('Key',(.6,-.8,1.5),95),('Fill',(-.9,-.2,.65),65),('Rim',(.5,.8,1.1),85)]:
 data=bpy.data.lights.new(name,'AREA');data.shape='DISK';obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);lights.append((obj,Vector(pos),power))
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.name='Read-only evidence floor';floor.location.z=0;mat=bpy.data.materials.new('Neutral evidence floor');mat.diffuse_color=(.20,.21,.20,1);floor.data.materials.append(mat)
def capture(role,state,frame,label,target,span,direction):
 camera.data.ortho_scale=span;camera.location=target+direction*span;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
 for light,offset,power in lights:light.location=target+offset*span;light.data.energy=power*span*span;light.data.size=.8*span;light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
 path=D/(role+'-'+state+str(frame)+'-'+label+'.png');scene.render.filepath=str(path)
 if not path.exists():bpy.ops.render.render(write_still=True)
 return {'role':role,'state':state,'frame':frame,'view':label,'path':str(path),'sha256':sha(path)}
rows=[]
for role in a.roles:
 meshes=[o for o in objects if o.type=='MESH' and o.get('peris_role')==role]
 for obj in objects:
  if obj.type=='MESH':obj.hide_render=obj not in meshes
 rig=next((m.object for o in meshes for m in o.modifiers if m.type=='ARMATURE' and 'hand_L' in m.object.data.bones),None)
 for pair in a.frames.split(','):
  state,f=pair.split(':');f=float(f);_pose(arms,saved,role,state,f);deps=bpy.context.evaluated_depsgraph_get();points=[]
  for obj in meshes:
   ev=obj.evaluated_get(deps);points.extend(ev.matrix_world@Vector(v) for v in ev.bound_box)
  lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)]);center=(lo+hi)*.5;span=max(hi-lo)*1.22;rows.append(capture(role,state,f,'hero',center,span,Vector((.95,-1.15,.42))))
  if a.grips and rig and state!='walk':
   for side in ['R','L']:
    H=rig.matrix_world@rig.pose.bones['hand_'+side].matrix;target=H@Vector((0,.13,0));scale=H.to_scale().length/math.sqrt(3);span=scale*.60;direction=Vector((1.05,-1.05,.34)) if side=='R' else (H.to_quaternion()@Vector((-.7,.95,.35)));rows.append(capture(role,state,f,side+'-grip',target,span,direction))
 print('SAVED_SOURCE_EVIDENCE_READY',role,flush=True)
_restore(arms,saved,oldframe);(D/'captures.json').write_text(json.dumps({'source':str(S),'sourceSha256':source_sha,'sourceUnchanged':sha(S)==source_sha,'savedObjectTRSAndBonePoseRestoredEachSample':True,'renderOnlyGroundZ':0,'captures':rows,'finishedArtApproved':False},indent=2))
