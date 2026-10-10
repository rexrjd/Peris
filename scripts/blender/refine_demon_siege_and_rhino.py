"""Original fitted demon barding and siege armor, on immutable saved rigs.

No source files, hand sockets, seated actions or rock-release channels change.
New world-space fittings are inverted through their actual idle owner bone.
"""
import argparse,hashlib,json,math,pathlib,sys,types
import bpy,bmesh,numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from fantasy_portrait_quality import image,mesh,curve,portrait_armor,fitted_limb_kit
from orc_mounted_prototypes import prop_mesh,rope,cushion
from roster_atlas import pack
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--edition',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=pathlib.Path(a.source).resolve();out=ROOT/'assets/source/battle'/a.edition
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();oldsha=sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);master=bpy.data.collections['PERIS_EXPORT']
new=bpy.data.collections.new('DEMON_RHINO_AND_DIV_REFINEMENT');bpy.context.scene.collection.children.link(new)
arms=[o for o in master.all_objects if o.type=='ARMATURE'];records=[]
for arm in arms:
 arm.animation_data.action=None
 for t in arm.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update()

def surface(name,color,kind,metal=0,rough=.75):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes['Principled BSDF'];size=1024;yy,xx=np.mgrid[:size,:size];rng=np.random.default_rng(int(hashlib.sha256(name.encode()).hexdigest()[:8],16))
 noise=rng.normal(0,.025,(size,size));broad=.11*np.sin(xx*.018+np.sin(yy*.014)*2)*np.sin(yy*.021)
 if kind=='hide':
  # Irregular polygonal hide cells; coarse cracked plates plus fine pores.
  u=xx/34+np.sin(yy*.018)*.35;v=yy/29+np.sin(xx*.013)*.25
  crack=np.exp(-np.minimum(np.abs(np.sin(u*math.pi)),np.abs(np.sin(v*math.pi)))**2/.012)
  height=.11*(1-crack)+noise*.6;shade=.76+.22*(1-crack)+broad+noise
 elif kind=='skin':
  scars=np.exp(-((xx-470-35*np.sin(yy*.024))/3.8)**2)*(yy>240)*(yy<650)
  height=noise*.3+scars*.045;shade=.94+broad+noise-scars*.32
 elif kind=='cloth':
  height=.013*np.sin(xx*1.55)+.013*np.sin(yy*1.55)+noise*.2;shade=.90+noise+broad*.55
 elif kind=='horn':
  bands=np.sin(yy*.11+np.sin(xx*.026));height=.045*bands+noise;shade=.87+.10*bands+broad
 else:
  scratch=(np.maximum(0,np.sin(xx*.63+np.sin(yy*.005)*9))**18)*.035
  hammer=.035*np.sin(xx*.10)*np.sin(yy*.13);height=hammer+noise*.3-scratch;shade=.90+broad+noise-scratch*2.5
 pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=np.clip(np.asarray(color)*shade[:,:,None],0,1)
 def texture(label,pixels,nc=False):
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=image(name+' '+label,pixels,nc);return t
 t=texture('original albedo',pixels);m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
 dy,dx=np.gradient(height);norm=np.stack((-dx*7,-dy*7,np.ones_like(dx)),axis=2);norm/=np.linalg.norm(norm,axis=2)[:,:,None];pixels=np.ones_like(pixels);pixels[:,:,:3]=norm*.5+.5
 t=texture('original surface relief',pixels,True);n=m.node_tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.65;m.node_tree.links.new(t.outputs['Color'],n.inputs['Color']);m.node_tree.links.new(n.outputs['Normal'],p.inputs['Normal'])
 pixels=np.ones_like(pixels);pixels[:,:,:3]=np.clip(rough+broad[:,:,None]*.6+noise[:,:,None],.24,.97);t=texture('original roughness',pixels,True);m.node_tree.links.new(t.outputs['Color'],p.inputs['Roughness']);p.inputs['Metallic'].default_value=metal
 return m

iron=surface('Demon detailed hammered blackened plate',(.105,.097,.083),'metal',.78,.48)
copper=surface('Demon detailed worn bright copper edging',(.49,.245,.082),'metal',.76,.42)
hide=surface('Rhino charcoal cracked armored hide',(.105,.097,.088),'hide',0,.9)
horn=surface('Rhino worn ridged ivory keratin',(.38,.295,.175),'horn',0,.72)
red=surface('Demon siege mottled oxblood scarred skin',(.30,.045,.029),'skin',0,.83)
cloth=surface('Demon torn wine woven war cloth',(.16,.021,.018),'cloth',0,.91)
leather=surface('Rhino fitted dark saddle leather',(.054,.031,.018),'hide',0,.88)

def owns(o,arm):return o.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)
def body(role,humanoid=True):
 candidates=[o for o in master.all_objects if o.get('peris_role')==role and o.type=='MESH']
 return next(o for o in candidates if len(o.data.vertices)<2000 and ('hand_R' in next(m.object for m in o.modifiers if m.type=='ARMATURE').data.bones)==humanoid)
def rig(o):return next(m.object for m in o.modifiers if m.type=='ARMATURE')
def add(o):
 if o.name not in new.objects:new.objects.link(o)
 o['peris_atlas_partition']='demon-refined-fitted-kit';return o
def worldmesh(name,verts,faces,arm,bone,role,mat):return add(prop_mesh(name,verts,faces,arm,bone,role,mat))
def cord(name,points,radius,arm,bone,role,mat):return add(rope(arm,role,bone,points,radius,mat,name))
def cap(name,center,radius,arm,bone,role,mat):return add(cushion(arm,bone,role,center,radius*2,radius*2,radius*1.5,mat,name))
def panel(name,border,arm,bone,role,mat=iron,raised=.06,normal=Vector((0,1,0))):
 center=sum(border,Vector())/len(border)+normal*raised;n=len(border);back=[v-normal*.028 for v in border]
 verts=border+[center]+back;faces=[(i,(i+1)%n,n) for i in range(n)]+[tuple(range(n+1,2*n+1))]+[(i,n+1+i,n+1+(i+1)%n,(i+1)%n) for i in range(n)]
 o=worldmesh(name,verts,faces,arm,bone,role,mat)
 for poly in o.data.polygons:poly.use_smooth=False
 cord(name+' complete copper border',border+[border[0]],.025,arm,bone,role,copper)
 for v in [border[0],border[len(border)//2]]:cap(name+' seated rivet',v+normal*.035,.048,arm,bone,role,copper)
 return o
def tree_for(o):
 ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();verts=[ev.matrix_world@v.co for v in me.vertices];faces=[tuple(f.vertices) for f in me.polygons];tree=BVHTree.FromPolygons(verts,faces);ev.to_mesh_clear();return tree,verts

# The main connected source animal retains every skin weight and clip. Remove
# only the four crude disconnected original side shields and rigid horn cones.
rhino=body('heavy_cavalry',False);mount=rig(rhino);bm=bmesh.new();bm.from_mesh(rhino.data);bm.verts.ensure_lookup_table();d=bm.verts.layers.deform.active;names={g.index:g.name for g in rhino.vertex_groups};pending=set(bm.verts);parts=[]
while pending:
 seed=pending.pop();component={seed};todo=[seed]
 while todo:
  for e in todo.pop().link_edges:
   for v in e.verts:
    if v in pending:pending.remove(v);component.add(v);todo.append(v)
 parts.append(component)
largest=max(parts,key=len);removed=[]
for component in parts:
 if component is largest:continue
 avg={}
 for v in component:
  for i,w in v[d].items():avg[names[i]]=avg.get(names[i],0)+w/len(component)
 owner=max(avg,key=avg.get) if avg else ''
 if owner in ['spine1','spine2','neck','head'] and len(component)<250:
  removed.append({'vertices':len(component),'owner':owner});bmesh.ops.delete(bm,geom=list(component),context='VERTS')
bm.to_mesh(rhino.data);bm.free();rhino.data.update()
rhino.data.materials.append(hide);rhino.data.materials.append(horn);hide_slot=len(rhino.data.materials)-2;horn_slot=hide_slot+1;uv=rhino.data.uv_layers.active;names={g.index:g.name for g in rhino.vertex_groups}
for f in rhino.data.polygons:
 f.material_index=hide_slot;f.use_smooth=True
 # World aligned source anatomy gives each flank broad visible hide cells.
 for li,vi in zip(f.loop_indices,f.vertices):
  v=rhino.data.vertices[vi].co;uv.data[li].uv=((v.y*.12)%1,(v.z*.14)%1)
tree,pts=tree_for(rhino);lo=Vector([min(v[i] for v in pts) for i in range(3)]);hi=Vector([max(v[i] for v in pts) for i in range(3)]);size=hi-lo
def flank(x,z,side,offset=.09):
 hit=tree.ray_cast(Vector((x,side*12,z)),Vector((0,-side,0)),24)[0]
 return hit+Vector((0,side*offset,0)) if hit else None

for side in [-1,1]:
 # Overlapping separate plates wrap the massive torso, with exposed hide
 # joints and articulated shoulders instead of an oval glued to each flank.
 for row in range(2):
  for col in range(5):
   x=-4.0+col*1.42;z=5.75-row*1.25
   border=[flank(x+dx,z+dz,side) for dx,dz in [(-.67,.57),(.55,.54),(.73,-.29),(.06,-.73),(-.57,-.40)]]
   if any(v is None for v in border):continue
   bone='spine1' if x<-.4 else 'spine2' if x<2.5 else 'neck'
   panel('Rhino layered angular torso bard '+str(row)+' '+str(col),border,mount,bone,'heavy_cavalry',normal=Vector((0,side,0)))
   c=sum(border,Vector())/len(border)+Vector((0,side*.08,0))
   cord('Barding angular inset device',[c+Vector((-.18,0,0)),c+Vector((0,side*.02,.28)),c+Vector((.18,0,0)),c+Vector((0,side*.02,-.28)),c+Vector((-.18,0,0))],.017,mount,bone,'heavy_cavalry',copper)
 for row in range(3):
  x=4.8+row*.65;z=5.8-row*.48
  border=[flank(x+dx,z+dz,side,.12) for dx,dz in [(-.48,.35),(.45,.30),(.50,-.34),(-.35,-.48)]]
  if all(v is not None for v in border):panel('Rhino articulated head cheek guard',border,mount,'head','heavy_cavalry',normal=Vector((0,side,0)))
 # Saddle girth and front breast straps fitted to the body surface.
 for x in [-2.1,.1]:
  points=[flank(x,6.9-j*.52,side,.045) for j in range(8)];points=[v for v in points if v is not None]
  if len(points)>2:cord('Rhino fitted leather girth',points,.075,mount,'spine1','heavy_cavalry',leather)
for x in [1.7,3.1,4.5]:
 h=tree.ray_cast(Vector((x,0,12)),Vector((0,0,-1)),15)[0]
 if h is None:continue
 border=[h+Vector((-.44,-.65,.075)),h+Vector((.39,-.56,.075)),h+Vector((.54,.56,.075)),h+Vector((-.44,.65,.075))]
 panel('Rhino sculpted spinal ridge plate',border,mount,'neck' if x>2.5 else 'spine2','heavy_cavalry',raised=.32,normal=Vector((0,0,1)))
 # An original tapering sweep, not a cone hanging off the forehead.
 points=[h+Vector((0,0,.30)),h+Vector((.10,0,.58)),h+Vector((.32,0,.84)),h+Vector((.57,0,1.02))]
 cord('Rhino swept dorsal armor spike',points,.11,mount,'neck' if x>2.5 else 'spine2','heavy_cavalry',horn)
for side in [-1,1]:
 for bone in ['leg_upper_'+('L' if side>0 else 'R'),'leg_back_'+('L' if side>0 else 'R')]:
  center=mount.matrix_world@mount.pose.bones[bone].head
  border=[flank(center.x+dx,center.z+dz,side,.13) for dx,dz in [(-.45,.40),(.46,.42),(.48,-.54),(0,-.77),(-.46,-.50)]]
  if all(v is not None for v in border):panel('Rhino hinged knee and haunch guard',border,mount,bone,'heavy_cavalry',normal=Vector((0,side,0)))
seat=mount.matrix_world@mount.pose.bones['peris_seated_rider'].matrix.translation
add(cushion(mount,'spine1','heavy_cavalry',seat+Vector((0,0,-.11)),2.0,1.5,.30,leather,'Rhino shaped raised pommel saddle cushion'))
records.append({'role':'heavy_cavalry','removedCrudeRigidSourceProps':removed,'sourceAnimalBounds':[list(lo),list(hi)],'newKit':'Layered ray-fitted blackened plate, copper raised rims and devices, articulated head/haunch guards, fitted leather girths and saddle','riderSeatAndAnimalClipsUnchanged':True})

# Giant proportions and release remain intact. A distinct asymmetric siege kit
# covers its chest, hanging hip panels, wrists and shins, leaving muscle visible.
giant=body('catapult');arm=rig(giant)
portrait_armor(arm,'catapult',giant,new,'demon');fitted_limb_kit(arm,'catapult',giant,new,'demon')
giant.data.materials.append(red);slot=len(giant.data.materials)-1;names={g.index:g.name for g in giant.vertex_groups};uv=giant.data.uv_layers.active
for f in giant.data.polygons:
 weight=sum(g.weight for i in f.vertices for g in giant.data.vertices[i].groups if names[g.group] in ['chest','spine','spine1','neck','arm_L','arm_R','forearm_L','forearm_R','thigh_L','thigh_R','leg_L','leg_R'])/len(f.vertices)
 if weight>.5:
  f.material_index=slot;f.use_smooth=True
  for li,vi in zip(f.loop_indices,f.vertices):
   co=giant.data.vertices[vi].co;uv.data[li].uv=(.5+co.x/3,co.z/4.2)
hip=arm.data.bones['hip'].head_local
for side in [-1,1]:
 for col in range(3):
  x=side*(.15+col*.23);z=hip.z+.05;border=[Vector((x-.105,-.37,z)),Vector((x+.105,-.37,z)),Vector((x+.13,-.39,z-.62)),Vector((x,-.41,z-.76)),Vector((x-.13,-.39,z-.62))]
  mesh('Div hanging overlapping forged waist scale',border+[sum(border,Vector())/5+Vector((0,-.05,0))],[(i,(i+1)%5,5) for i in range(5)],arm,'catapult','hip',iron,new)
  curve('Div scale copper worked edge',border+[border[0]],.012,arm,'catapult','hip',copper,new)
 for row in range(3):
  b=arm.data.bones['arm_'+('L' if side>0 else 'R')];c=b.head_local+Vector((side*(.14+row*.05),0,.12-row*.10));points=[c,c+Vector((side*.09,0,.16)),c+Vector((side*.23,0,.27))]
  curve('Div asymmetric siege pauldron swept spike',points,.05,arm,'catapult',b.name,horn,new)
# Add visible hammering, copper repair bands and cloth weave to the new shell.
for o in new.objects:
 if o.get('peris_role')=='catapult':
  for i,m in enumerate(o.data.materials):
   if 'black iron' in m.name:o.data.materials[i]=iron
   elif 'precious trim' in m.name:o.data.materials[i]=copper
 o['peris_atlas_partition']='demon-refined-fitted-kit'
records.append({'role':'catapult','newKit':'Fitted chest and back corslet, asymmetric spiked shoulders, overlapping hanging hip scales, articulated bracers and shin guards, original scarred oxblood skin','heldBoulderAndHandWeightsAndThrowActionsUnchanged':True})
out.mkdir(parents=True);editable=out/'editable-demon-study.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(editable),compress=True)
lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in ['heavy_cavalry','catapult']},PROFILE={'family':'spartan'});pack(lib,'demon-refined-siege-and-rhino',out/'textures',4096)
for o in new.all_objects:
 if o.name not in master.objects:master.objects.link(o)
native=out/'peris-demon-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
if sha(source)!=oldsha:raise ValueError('Immutable native source changed')
record={'edition':a.edition,'sourceNative':str(source),'sourceSha256':oldsha,'sourceUnchanged':True,'operations':records,'sourceRigRestBonesAndNativeClipsUnchanged':True,'shields60PercentUnchanged':True,'runtimeApproved':False,'finishedUnitApproved':False,'files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in [editable,native]}}
(out/'provenance.json').write_text(json.dumps(record,indent=2)+'\n');print('DEMON_REFINEMENT_NATIVE_READY',json.dumps(record['files']),flush=True)
