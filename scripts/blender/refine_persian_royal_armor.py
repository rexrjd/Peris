"""Original ornate Persian armor and a fully barded Cataphract derivative.

Source meshes, grips, rest bones and clips remain immutable. Fitted shells
reuse their source deformation weights, so they follow the actual anatomy.
"""
import argparse,bpy,hashlib,json,pathlib,sys,math,types,numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from roster_detail_surfaces import detail_material,gild_existing_metal
from fantasy_portrait_quality import image,mesh,curve
from orc_mounted_prototypes import prop_mesh,rope
from roster_atlas import pack
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--edition',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=pathlib.Path(a.source).resolve();out=ROOT/'assets/source/battle'/a.edition
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();oldsha=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False)
master=bpy.data.collections['PERIS_EXPORT'];new=bpy.data.collections.new('PERSIAN_ORIGINAL_ROYAL_ARMOR');bpy.context.scene.collection.children.link(new)
for arm in [o for o in master.all_objects if o.type=='ARMATURE']:
 arm.animation_data.action=None
 for t in arm.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
gilded=gild_existing_metal(master,'Persian royal worked gold',(.68,.45,.13));gold=detail_material('Persian engraved gold edging',(.68,.45,.13),'metal',.82,.32);navy=detail_material('Persian woven midnight royal silk',(.031,.061,.14),'cloth',0,.84);plum=detail_material('Persian woven royal plum silk',(.16,.026,.061),'cloth',0,.84);teal=detail_material('Persian turquoise inset gem',(.017,.30,.29),'metal',.22,.28);dark=detail_material('Persian dark steel mail',(.11,.135,.16),'metal',.76,.46)
lamellar=detail_material('Persian original gilt lamellar scale surface',(.70,.43,.095),'metal',.76,.37)
size=512;yy,xx=np.mgrid[:size,:size];row=(yy//32);u=(xx+(row%2)*16)%32;v=yy%32;edge=(u<2)|(u>29)|(v<2);rim=(u<4)|(u>27)|(v>27);rivet=((u-7)**2+(v-7)**2<3)|((u-25)**2+(v-7)**2<3);scroll=np.sin(u*.31+v*.09)*np.sin(v*.30);shade=.87+v/32*.22+scroll*.025;shade[edge]=.25;shade[rim&~edge]=.65;shade[rivet]=1.15
color=np.ones((size,size,4),np.float32);color[:,:,:3]=np.clip(np.asarray((.70,.43,.095))*shade[:,:,None],0,1)
pnode=lamellar.node_tree.nodes['Principled BSDF'];pnode.inputs['Base Color'].links[0].from_node.image=image('Persian original overlapping lamellar plates and rivets',color)
height=np.where(edge,-.07,np.where(rim,-.015,.025+v*.0007));dy,dx=np.gradient(height);normal=np.stack((-dx*7,-dy*7,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2)[:,:,None];pixels=np.ones_like(color);pixels[:,:,:3]=normal*.5+.5;pnode.inputs['Normal'].links[0].from_node.inputs['Color'].links[0].from_node.image=image('Persian original lamellar normal relief',pixels,True)
roles=['line_infantry','spear_guard','archer','elite','scout','light_cavalry','heavy_cavalry'];records=[]
def objects():return [o for o in master.all_objects if o is not None]
def owned(arm):return [o for o in objects() if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]
def add(o):
 if o.name not in new.objects:new.objects.link(o)
 o['peris_atlas_partition']='original-persian-royal-armor';return o
def components(body):
 neighbours={v.index:set() for v in body.data.vertices}
 for e in body.data.edges:neighbours[e.vertices[0]].add(e.vertices[1]);neighbours[e.vertices[1]].add(e.vertices[0])
 result={};seen=set()
 for start in neighbours:
  if start in seen:continue
  stack=[start];ids=[];seen.add(start)
  while stack:
   q=stack.pop();ids.append(q)
   for other in neighbours[q]:
    if other not in seen:seen.add(other);stack.append(other)
  for q in ids:result[q]=len(ids)
 return result
def shell(body,arm,role,bones,name,offset=.018,horse=False):
 names={g.index:g.name for g in body.vertex_groups};sizes=components(body);polygons=[]
 for face in body.data.polygons:
  if max(sizes[v] for v in face.vertices)<70:continue
  weights={}
  for vi in face.vertices:
   for g in body.data.vertices[vi].groups:weights[names[g.group]]=weights.get(names[g.group],0)+g.weight/len(face.vertices)
  if sum(w for n,w in weights.items() if n in bones)<.72:continue
  if horse and sum(w for n,w in weights.items() if 'Hoof' in n)>.45:continue
  polygons.append(face)
 if not polygons:raise ValueError('No fitted shell faces: '+name)
 ids=sorted({i for f in polygons for i in f.vertices});mapping={old:i for i,old in enumerate(ids)};verts=[body.data.vertices[i].co+body.data.vertices[i].normal*offset for i in ids];faces=[tuple(mapping[i] for i in f.vertices) for f in polygons]
 o=add(mesh(name,verts,faces,arm,role,next(iter(bones)),lamellar,new,smooth=True))
 for g in list(o.vertex_groups):o.vertex_groups.remove(g)
 for old,index in mapping.items():
  for g in body.data.vertices[old].groups:
   if g.weight>0:(o.vertex_groups.get(names[g.group]) or o.vertex_groups.new(name=names[g.group])).add([index],g.weight,'REPLACE')
 uv=o.data.uv_layers.active
 for face,original in zip(o.data.polygons,polygons):
  weights={}
  for vi in original.vertices:
   for g in body.data.vertices[vi].groups:weights[names[g.group]]=weights.get(names[g.group],0)+g.weight
  bn=max(weights,key=weights.get);b=arm.data.bones[bn]
  for li,vi in zip(face.loop_indices,face.vertices):
   point=b.matrix_local.inverted()@o.data.vertices[vi].co
   uv.data[li].uv=(.5+math.atan2(point.x,point.z)/math.tau,max(0,min(1,point.y/max(.18,b.length))))
 return {'sourceMesh':body.name,'shellFaces':len(faces),'sourceDeformationWeightsReused':True,'sourceGeometryAndGripUnchanged':True}
def world_point(arm,bone,point):return arm.matrix_world@arm.pose.bones[bone].matrix@arm.data.bones[bone].matrix_local.inverted()@point
def ellipsoid(name,c,radii,arm,bone,role,mat):
 verts=[];faces=[];n=24;rows=14
 for j in range(rows+1):
  phi=j*math.pi/rows
  for i in range(n):theta=i*math.tau/n;verts.append(c+Vector((math.cos(theta)*math.sin(phi)*radii.x,math.sin(theta)*math.sin(phi)*radii.y,math.cos(phi)*radii.z)))
 for j in range(rows):
  for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 o=add(prop_mesh(name,verts,faces,arm,bone,role,mat))
 for f in o.data.polygons:f.use_smooth=True
 return o
for role in roles:
 arm=next(o for o in objects() if o.type=='ARMATURE' and 'hip' in o.data.bones and any(m.get('peris_role')==role for m in owned(o)))
 body=max(owned(arm),key=lambda o:len(o.data.vertices));bones={n for n in arm.data.bones.keys() if n in ['hip','pelvis','chest','abdomen','waist','neck'] or n.startswith(('arm_','forearm_','thigh_','leg_'))}
 if role in ['archer','scout']:bones={n for n in bones if not n.startswith(('arm_','thigh_'))}
 if role=='heavy_cavalry':bones|={n for n in arm.data.bones.keys() if n.startswith(('hand_','finger','thumb'))}
 record={'role':role,'fittedArmor':shell(body,arm,role,bones,'Persian '+role+' fitted gilded articulated lamellar shell',.008 if role=='heavy_cavalry' else .016),'fullCoverage':role=='heavy_cavalry'}
 names={g.index:g.name for g in body.vertex_groups};faces=[tuple(f.vertices) for f in body.data.polygons if sum(sum(g.weight for g in body.data.vertices[i].groups if names[g.group] in ['chest','hip','abdomen','waist']) for i in f.vertices)/len(f.vertices)>.72];tree=BVHTree.FromPolygons([v.co for v in body.data.vertices],faces)
 hip=arm.data.bones['hip'].head_local;chest=arm.data.bones['chest'].head_local;neck=arm.data.bones['neck'].head_local;upper=neck.z-.18
 def fitted(x,z,padding=.055):
  hit=tree.ray_cast(Vector((x,-1.6,z)),Vector((0,1,0)),3.2)[0]
  return Vector((x,(hit.y if hit else -.30)-padding,z))
 # Separate role-specific ornamental borders and jewels sit on the skin's
 # actual chest surface. They do not replace the hand or weapon geometry.
 rows=3 if role in ['elite','heavy_cavalry'] else 2
 for row in range(rows):
  z=upper-row*.26;width=.30-row*.025;path=[fitted((i/16*2-1)*width,z-.055*math.sin(i/16*math.pi)) for i in range(17)]
  add(curve('Persian '+role+' curved engraved breast border',path,.013,arm,role,'chest',gold,new))
  if role in ['elite','heavy_cavalry','spear_guard']:
   center=world_point(arm,'chest',fitted(0,z-.075,.08));ellipsoid('Persian '+role+' raised turquoise rank jewel',center,Vector((.14,.06,.16)),arm,'chest',role,teal)
 belt=[fitted((i/16*2-1)*.36,hip.z+.20,.07) for i in range(17)];add(curve('Persian '+role+' gilt articulated belt',belt,.036,arm,role,'hip',gold,new))
 # A small embroidered front skirt is navy for guards and plum for cavalry.
 cloth=plum if role in ['elite','light_cavalry','heavy_cavalry'] else navy
 for side in [-1,1]:
  points=[fitted(side*.035,hip.z+.08,.10),fitted(side*.28,hip.z+.08,.10),Vector((side*.32,-.42,hip.z-.64)),Vector((side*.03,-.44,hip.z-.58))]
  add(mesh('Persian '+role+' royal silk belt tabard',points,[(0,1,2,3)],arm,role,'hip',cloth,new))
  add(curve('Persian '+role+' brocade tabard gilt hem',points+[points[0]],.016,arm,role,'hip',gold,new))
 if role in ['elite','heavy_cavalry']:
  for side in ['L','R']:
   shoulder=arm.data.bones['arm_'+side].head_local
   for row in range(3):
    c=shoulder+Vector((0,0,.09-row*.10));path=[c+Vector((math.cos(i*math.pi/16)*.27,-math.sin(i*math.pi/16)*.33,.12*math.sin(i*math.pi/16))) for i in range(17)]
    add(curve('Persian layered royal shoulder gold relief',path,.032,arm,role,'arm_'+side,gold,new))
 if role=='heavy_cavalry':
  # Enclosed helmet with a narrow horizontal eye opening. All added pieces
  # follow the original head and leave the held lance and hands unchanged.
  head=arm.matrix_world@arm.pose.bones['head'].head;tail=arm.matrix_world@arm.pose.bones['head'].tail;c=head.lerp(tail,.58)
  ellipsoid('Cataphract complete gilded helmet crown',c+Vector((0,0,.32)),Vector((.49,.47,.48)),arm,'head',role,gold)
  for zlow,zhigh in [(-.48,.035),(.15,.43)]:
   border=[c+Vector((.52,-.42,zlow)),c+Vector((.62,0,zlow-.08)),c+Vector((.52,.42,zlow)),c+Vector((.52,.42,zhigh)),c+Vector((.62,0,zhigh+.045)),c+Vector((.52,-.42,zhigh))]
   add(prop_mesh('Cataphract closed engraved face visor around eye slot',border,[(0,1,2,3,4,5)],arm,'head',role,dark));add(rope(arm,role,'head',border+[border[0]],.037,gold,'Cataphract visor gilt border'))
  mount=next(o for o in objects() if o.type=='ARMATURE' and 'Horse_Spine_1' in o.data.bones and any(m.get('peris_role')==role for m in owned(o)))
  animal=max(owned(mount),key=lambda o:len(o.data.vertices));deform={g.name for g in animal.vertex_groups if g.name in mount.data.bones};record['horseBarding']=shell(animal,mount,role,deform,'Cataphract continuous articulated neck flank rump and leg barding',.019,True)
  record['headAndHandProtection']='Closed visor and fitted articulated glove shells; original grasping geometry and lance sockets retained';record['mountCoverage']='Fitted neck, trunk, head, rump and moving limb shell. Hoof contact surfaces are left clear.'
  h=mount.matrix_world@mount.pose.bones['Horse_Head'].head
  for sign in [-1,1]:ellipsoid('Cataphract horse dark narrow ocular opening',h+Vector((.42,sign*.50,-.37)),Vector((.21,.075,.12)),mount,'Horse_Head',role,dark)
 records.append(record)
for o in new.all_objects:
 if o.name not in master.objects:master.objects.link(o)
out.mkdir(parents=True);editable=out/'editable-persian-study.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(editable),compress=True)
lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in roles},PROFILE={'family':'persian'});pack(lib,'persian-royal-armor',out/'textures',4096)
for o in new.all_objects:
 if o.name not in master.objects:master.objects.link(o)
native=out/'peris-persian-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
if sha(source)!=oldsha:raise ValueError('Source native changed')
(out/'provenance.json').write_text(json.dumps({'sourceNative':str(source),'sourceSha256':oldsha,'sourceUnchanged':True,'originalRestBonesActionsGripsShieldsUnchanged':True,'gildedExistingMetal':gilded,'operations':records,'runtimeApproved':False,'finishedUnitApproved':False,'files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in [editable,native]}},indent=2)+'\n');print('PERSIAN_ROYAL_ARMOR_READY',len(records),flush=True)
