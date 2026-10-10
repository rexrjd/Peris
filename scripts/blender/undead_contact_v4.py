"""Bounded Undead contact derivative; preserves source rigs/actions and atlases."""
import bpy,bmesh,math,json,hashlib
from mathutils import Vector,Matrix

FOOT_ROLES=('line_infantry','spear_guard','elite','archer')
def material():
 m=bpy.data.materials.new('Undead V4 aged skeletal ivory');m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.62,.60,.47,1);p.inputs['Roughness'].default_value=.86
 return m

def mesh(name,verts,faces,arm,role,weights,mat,col):
 data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
 o=bpy.data.objects.new(name,data);col.objects.link(o);o.parent=arm;o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_basis=Matrix.Identity(4)
 mod=o.modifiers.new('Preserved source skeleton attachment','ARMATURE');mod.object=arm
 for bone in {n for w in weights for n in w}:
  g=o.vertex_groups.new(name=bone)
  for i,w in enumerate(weights):
   if w.get(bone,0)>0:g.add([i],w[bone],'REPLACE')
 data.materials.append(mat);uv=data.uv_layers.new(name='SkeletalSurface')
 for p in data.polygons:
  p.use_smooth=True
  for li in p.loop_indices:
   v=data.vertices[data.loops[li].vertex_index].co;uv.data[li].uv=(v.x*.7+.5,v.y*.7+.5)
 o['peris_role']=role;o['asset_license']='CC-BY-SA-3.0';o['asset_author']='Wildfire Games; original Peris skeletal continuity adaptation';o['peris_unit_finished']=False;o['runtime_approved']=False
 return o

def tube(name,points,radii,arm,role,bone,mat,col):
 pts=[Vector(p) for p in points];n=10;verts=[]
 for j,p in enumerate(pts):
  direction=(pts[min(j+1,len(pts)-1)]-pts[max(0,j-1)]).normalized();ref=Vector((1,0,0))
  if abs(direction.dot(ref))>.9:ref=Vector((0,1,0))
  x=direction.cross(ref).normalized();y=direction.cross(x).normalized()
  for i in range(n):a=math.tau*i/n;verts.append(p+(x*math.cos(a)+y*math.sin(a))*radii[j])
 faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(pts)-1) for i in range(n)]
 faces += [tuple(range(n-1,-1,-1)),tuple(range((len(pts)-1)*n,len(pts)*n))]
 return mesh(name,verts,faces,arm,role,[{bone:1} for _ in verts],mat,col)

def sphere(name,p,size,arm,role,bone,mat,col):
 p=Vector(p);n=12;rows=7;verts=[p+Vector((0,0,size[2]))]
 for j in range(1,rows):
  phi=math.pi*j/rows
  for i in range(n):a=math.tau*i/n;verts.append(p+Vector((math.sin(phi)*math.cos(a)*size[0],math.sin(phi)*math.sin(a)*size[1],math.cos(phi)*size[2])))
 bottom=len(verts);verts.append(p-Vector((0,0,size[2])))
 faces=[(0,1+i,1+(i+1)%n) for i in range(n)]
 faces += [(1+j*n+i,1+j*n+(i+1)%n,1+(j+1)*n+(i+1)%n,1+(j+1)*n+i) for j in range(rows-2) for i in range(n)]
 faces += [(bottom,1+(rows-2)*n+(i+1)%n,1+(rows-2)*n+i) for i in range(n)]
 return mesh(name,verts,faces,arm,role,[{bone:1} for _ in verts],mat,col)

def _join(source,objects):
 bpy.ops.object.select_all(action='DESELECT');source.select_set(True)
 for o in objects:o.select_set(True)
 bpy.context.view_layer.objects.active=source;bpy.ops.object.join()

def apply(collection,probe):
 mat=material();report={'feet':[],'lineGrip':None,'ramCrew':None};new=[]
 for role in FOOT_ROLES:
  source=next(o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role);arm=source.parent
  parts=[]
  for side in ('L','R'):
   foot=arm.data.bones['foot_'+side];ankle=foot.head_local.copy()
   parts.append(sphere(role+' connected ankle '+side,ankle,(.067,.070,.068),arm,role,foot.name,mat,collection))
   # Existing three source metatarsals start at this measured rest offset.
   for i in range(3):
    target=ankle+Vector(((i-1)*.065,-.06,-.06))
    parts.append(tube(role+' articulated tarsal '+side+str(i),[ankle+Vector(((i-1)*.020,0,-.012)),target,target+Vector((0,-.025,-.004))],[.024,.026,.021],arm,role,foot.name,mat,collection))
   # Three tapered toe phalanges lie within the original metatarsal bounds.
   # This retains original foot extents in every rigid foot pose.
   for i in range(3):
    p=ankle+Vector(((i-1)*.065,-.06,-.06));axis=Vector((0,-.18,-.025))
    parts.append(tube(role+' toe phalanx '+side+str(i),[p+axis*.68,p+axis*.84,p+axis*.98],[.016,.014,.008],arm,role,foot.name,mat,collection))
   report['feet'].append({'role':role,'side':side,'ankleRest':list(ankle),'bone':foot.name,'construction':'ankle joint, three separate tarsal links into actual source metatarsal starts and three tapered toe phalanges','sourceRestUnchanged':True})
  _join(source,parts)
 # Actual source shaft is two pointed diagonal parts rigid to prop-weapon_R.
 source=next(o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')=='line_infantry');arm=source.parent;hand=arm.data.bones['hand_R'];hm=hand.matrix_local
 group=source.vertex_groups['prop-weapon_R'];ids=[v.index for v in source.data.vertices if any(g.group==group.index and g.weight>.99 for g in v.groups)]
 shaft=[source.data.vertices[i].co.copy() for i in ids]
 # Direction from the actual shaft extremities; fit its closest centerline point to the hand center.
 a=min(shaft,key=lambda p:p.y);b=max(shaft,key=lambda p:p.y);axis=(b-a).normalized();center=sum(shaft,Vector())/len(shaft)
 target=hm@Vector((0,.115,0));closest=center+axis*(target-center).dot(axis);delta=target-closest
 handgroup=source.vertex_groups['hand_R']
 for i in ids:
  source.data.vertices[i].co+=delta
  for g in list(source.data.vertices[i].groups):source.vertex_groups[g.group].remove([i])
  handgroup.add([i],1,'REPLACE')
 # Source open metacarpal rods are the 96 rigid hand vertices. Remove only those four known primitive islands; replace with connected curled skeletal digits.
 bm=bmesh.new();bm.from_mesh(source.data);bm.verts.ensure_lookup_table();layer=bm.verts.layers.deform.active
 inverse=hm.inverted();remove=[]
 for v in bm.verts:
  p=inverse@v.co;w=v[layer]
  if w.get(handgroup.index,0)>.99 and v.index not in ids and -.12<p.x<.13 and -.04<p.y<.25 and abs(p.z)<.15:remove.append(v)
 bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(source.data);bm.free();source.data.update()
 localaxis=(hm.to_3x3().inverted()@axis).normalized();u=localaxis.cross(Vector((0,1,0))).normalized();v=localaxis.cross(u).normalized();parts=[]
 for digit in range(4):
  along=(digit-1.5)*.046;pts=[]
  for j,theta in enumerate([-.72,.05,.95,1.92,2.80]):
   r=.057;pts.append(target+axis*along+(hm.to_3x3()@u)*math.cos(theta)*r+(hm.to_3x3()@v)*math.sin(theta)*r)
  parts.append(tube('Undead distinct curled skeletal finger '+str(digit),pts,[.019,.021,.019,.016,.012],arm,'line_infantry','hand_R',mat,collection))
  parts.append(tube('Undead connecting palm metacarpal '+str(digit),[hm@Vector(((digit-1.5)*.038,.012,0)),pts[0]],[.021,.019],arm,'line_infantry','hand_R',mat,collection))
 thumb=[hm@Vector((.057,.03,-.01)),target+(hm.to_3x3()@u)*-.076,target+(hm.to_3x3()@u)*-.059+(hm.to_3x3()@v)*.037]
 parts.append(tube('Undead opposing skeletal thumb',thumb,[.023,.022,.014],arm,'line_infantry','hand_R',mat,collection));_join(source,parts)
 report['lineGrip']={'shaftVertexCount':len(ids),'removedSourceOpenMetacarpalVertices':len(remove),'restTranslation':list(delta),'actualHandCenterRest':list(target),'shaftAxisRest':list(axis),'newRigidBone':'hand_R','digitCount':4,'opposingThumb':True,'shaftRadiusApprox':.040,'fingerCenterRadius':.057}
 # Actual source front/rear/side views establish the ram was already crewless.
 # Scutum decoration was mistaken for living crew in the initial 3Q audit.
 # The two 200-vertex sixwheel islands are authored tusk crests, not heads.
 report['ramCrew']={'mode':'existing crewless siege visual study','removedVertices':0,'sourceGeometryPreservedExactly':True,'correction':'Withdraw earlier living-crew finding; actual front/rear/side source views show shields and tusk crests, no living crew.'}
 return report
