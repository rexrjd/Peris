"""Separate credited Elf/Demon portrait pilots on immutable clean prototype rigs.

The caller supplies a copied saved native. Existing source bodies, clips and
functional attachments remain independent of these newly authored components.
"""
import bpy,bmesh,hashlib,json,math,pathlib
import numpy as np
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
ROOT=pathlib.Path(__file__).resolve().parents[2]


def image(name,pixels,noncolor=False):
 h,w,_=pixels.shape;i=bpy.data.images.new(name,width=w,height=h,alpha=False)
 if noncolor:i.colorspace_settings.name='Non-Color'
 i.pixels.foreach_set(np.asarray(pixels,dtype=np.float32).ravel());i.pack();return i


def material(name,color,metal=0,rough=.7,grain='metal'):
 existing=bpy.data.materials.get(name)
 if existing and existing.get('peris_fantasy_surface_signature')==json.dumps([list(color),metal,rough,grain]):return existing
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
 m['peris_fantasy_surface_signature']=json.dumps([list(color),metal,rough,grain])
 p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 size=512;rng=np.random.default_rng(sum(map(ord,name)));yy,xx=np.mgrid[:size,:size]
 n=rng.normal(0,.025,(size,size));n+=.022*np.sin(xx*.023+yy*.059)*np.sin(yy*.031)
 if grain=='cloth':n+=.015*np.sin(xx*math.pi*.5)+.015*np.sin(yy*math.pi*.5)
 if grain=='metal':
  n+=.055*np.sin(xx*.071)*np.sin(yy*.053)+.035*np.sin(xx*.17+yy*.13)
 col=np.ones((size,size,4),np.float32);col[:,:,:3]=np.clip(np.asarray(color)*(1+n[:,:,None]),0,1)
 tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image(name+' authored finish',col);m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
 roughpixels=np.ones_like(col);roughpixels[:,:,:3]=np.clip(rough+n[:,:,None]*1.7,.10,.98)
 tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image(name+' authored roughness variation',roughpixels,True);m.node_tree.links.new(tex.outputs['Color'],p.inputs['Roughness'])
 dy,dx=np.gradient(n);normal=np.stack((-dx*.3,-dy*.3,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2)[:,:,None]
 pixels=np.ones_like(col);pixels[:,:,:3]=normal*.5+.5
 tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image(name+' finish normal',pixels,True)
 node=m.node_tree.nodes.new('ShaderNodeNormalMap');node.inputs['Strength'].default_value=.25;m.node_tree.links.new(tex.outputs['Color'],node.inputs['Color']);m.node_tree.links.new(node.outputs['Normal'],p.inputs['Normal'])
 return m


def mesh(name,verts,faces,arm,role,bone,mat,collection,uv=None,smooth=False,license='CC-BY-SA-3.0'):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(role+' '+name,d);collection.objects.link(o)
 o.parent=arm;o.matrix_basis=Matrix.Identity(4);o.matrix_parent_inverse=Matrix.Identity(4)
 modifier=o.modifiers.new('Existing source skeleton','ARMATURE');modifier.object=arm
 group=o.vertex_groups.new(name=bone);group.add(list(range(len(d.vertices))),1,'REPLACE');d.materials.append(mat)
 layer=d.uv_layers.new(name='PortraitUV')
 lo=Vector([min(v.co[i] for v in d.vertices) for i in range(3)]);hi=Vector([max(v.co[i] for v in d.vertices) for i in range(3)])
 for p in d.polygons:
  p.use_smooth=smooth
  axes=[i for i in range(3) if i!=max(range(3),key=lambda i:abs(p.normal[i]))]
  for li,vi in zip(p.loop_indices,p.vertices):
   if uv:layer.data[li].uv=uv[vi]
   else:
    a=d.vertices[vi].co;layer.data[li].uv=tuple(.04+.92*(a[i]-lo[i])/max(hi[i]-lo[i],1e-5) for i in axes)
 o['peris_role']=role;o['asset_author']='Peris: original portrait equipment; adapted Wildfire Games rig';o['asset_license']=license
 o['runtime_approved']=False;o['peris_unit_finished']=False;o['original_peris_equipment']=True
 return o


def curve(name,points,width,arm,role,bone,mat,collection,depth=None):
 points=[Vector(p) for p in points];verts=[];faces=[];sides=10
 for j,p in enumerate(points):
  tangent=points[min(j+1,len(points)-1)]-points[max(j-1,0)];tangent.normalize()
  ref=Vector((0,1,0)) if abs(tangent.y)<.9 else Vector((1,0,0));a=tangent.cross(ref).normalized();b=tangent.cross(a).normalized()
  taper=min(1,(j+1)*.7,(len(points)-j)*.7)
  for i in range(sides):
   angle=math.tau*i/sides;verts.append(p+a*(width*math.cos(angle)*taper)+b*((depth or width)*math.sin(angle)*taper))
 for j in range(len(points)-1):
  for i in range(sides):faces.append((j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i))
 faces.extend([tuple(range(sides-1,-1,-1)),tuple(range((len(points)-1)*sides,len(points)*sides))])
 return mesh(name,verts,faces,arm,role,bone,mat,collection,smooth=True)


def remove_old_head(body,arm):
 bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups}
 selected=[f for f in bm.faces if sum(sum(w for index,w in v[layer].items() if names.get(index) in ['head','prop-head']) for v in f.verts)/len(f.verts)>.55]
 count=len(selected);bmesh.ops.delete(bm,geom=selected,context='FACES');bm.to_mesh(body.data);bm.free();body.data.update();return count


def remove_superseded_props(body,arm,role):
 bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups};pending=set(bm.verts);remove=[]
 while pending:
  seed=pending.pop();component={seed};todo=[seed]
  while todo:
   for edge in todo.pop().link_edges:
    for other in edge.verts:
     if other in pending:pending.remove(other);component.add(other);todo.append(other)
  weights={}
  for v in component:
   for i,w in v[layer].items():weights[names[i]]=weights.get(names[i],0)+w/len(component)
  dominant=max(weights,key=weights.get) if weights else ''
  small=len(component)<180
  if small and weights.get(dominant,0)>.999 and (dominant in ['chest','shoulder_L','shoulder_R','arm_L','arm_R'] or dominant.startswith('prop-shield')):remove.extend(component)
  elif role=='line_infantry' and dominant.startswith('prop-shield') and weights.get(dominant,0)>.999:remove.extend(component)
  elif role=='line_infantry' and weights.get('hand_R',0)>.999:remove.extend(component)
  elif role=='line_infantry' and dominant in ['prop-weapon_R','weapon_R'] and weights.get(dominant,0)>.999:remove.extend(component)
 count=len(remove);bmesh.ops.delete(bm,geom=list(set(remove)),context='VERTS');bm.to_mesh(body.data);bm.free();body.data.update();return count


def portrait_hands(arm,role,body,collection,race,sides=('R','L')):
 from orc_mounted_hand_geometry_v11 import _make_local
 bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups}
 selected=[]
 for p in bm.faces:
  mean={}
  for v in p.verts:
   for i,w in v[layer].items():mean[names[i]]=mean.get(names[i],0)+w/len(p.verts)
  for side in sides:
   own=sum(w for n,w in mean.items() if n=='hand_'+side or (n.startswith(('finger','thumb')) and n.endswith('_'+side)))
   local=arm.data.bones['hand_'+side].matrix_local.inverted()@(sum((v.co for v in p.verts),Vector())/len(p.verts))
   if own>.55 and local.y>.015:selected.append(p);break
 bmesh.ops.delete(bm,geom=list(set(selected)),context='FACES');bm.to_mesh(body.data);bm.free();body.data.update()
 mat=material(race+' fitted anatomical grip skin',(.55,.43,.31) if race=='elf' else (.30,.047,.028),rough=.84)
 for side in sides:
  o,report=_make_local(side,None,.045);o.name=role+' '+race+' anatomical closed '+side+' grip'
  mirror=-1 if side=='L' else 1
  for vertex in o.data.vertices:
   x,y,z=vertex.co;r=math.hypot(x,y-.15)
   if race=='elf' and r>.076:
    new=.045+(r-.045)*.86;vertex.co.x=x*new/r;vertex.co.y=.15+(y-.15)*new/r
   vertex.co.z*=.92 if race=='elf' else 1
  # Fitted dorsal glove with separate curled skin pads, not four uniform bars.
  glove=material(race+' fitted dorsal grip glove',(.105,.060,.029) if race=='elf' else (.038,.030,.025),.05,.85,'cloth')
  o.data.materials.clear();o.data.materials.append(mat);o.data.materials.append(glove)
  for polygon in o.data.polygons:
   c=sum((o.data.vertices[i].co for i in polygon.vertices),Vector())/len(polygon.vertices)
   polygon.material_index=1 if c.y<.080 or (c.x*mirror>.090 and c.y<.163) else 0
  raw=[v.co.copy() for v in o.data.vertices]
  o.data.calc_loop_triangles();positions=np.asarray([tuple(p) for p in raw]);indices=np.asarray([tuple(t.vertices) for t in o.data.loop_triangles]);tri=positions[indices][:,:,:2].copy();tri[:,:,1]-=.15
  signs=np.cross(tri,np.roll(tri,-1,axis=1));inside=np.all(signs>=-1e-12,axis=1)|np.all(signs<=1e-12,axis=1)
  edges=np.roll(tri,-1,axis=1)-tri;t=np.clip(-np.sum(tri*edges,axis=2)/np.maximum(np.sum(edges*edges,axis=2),1e-15),0,1);dist=np.linalg.norm(tri+edges*t[:,:,None],axis=2).min(axis=1);dist[inside]=0
  if float(dist.min())<.043-1e-6:raise ValueError('Reject hand surface intersecting actual .043 shaft envelope')
  grip_surface_min=float(dist.min())
  for c in list(o.users_collection):c.objects.unlink(o)
  collection.objects.link(o);o.data.transform(arm.data.bones['hand_'+side].matrix_local);o.parent=arm;o.matrix_basis=Matrix.Identity(4);o.matrix_parent_inverse=Matrix.Identity(4)
  o.vertex_groups.clear();g=o.vertex_groups.new(name='hand_'+side);g.add(list(range(len(o.data.vertices))),1,'REPLACE')
  modifier=o.modifiers.new('Existing hand bone','ARMATURE');modifier.object=arm
  o['peris_role']=role;o['asset_author']='Peris: original connected palm, four curled digits and opposing thumb on adapted Wildfire Games rig';o['asset_license']='CC-BY-SA-3.0';o['runtime_approved']=False;o['peris_unit_finished']=False;o['peris_grip_reservation']=.045;o['peris_grip_center_hand_local']=[0,.15,0]
  o['peris_local_grip_min_radius']=min(math.hypot(v.x,v.y-.15) for v in raw)
  o['peris_grip_triangle_min_radius']=grip_surface_min;o['peris_grip_triangle_test']='Exact 2D projected triangle/edge distance to hand-local shaft axis; both shaft and glove remain rigid to the same existing hand bone in every pose. Retained original wrist is a separate review target.'
  metal=material(race+' worked grip knuckle guards',(.24,.18,.08) if race=='elf' else (.075,.064,.054),.55,.62)
  for index,z in enumerate([.089,.030,-.030,-.090]):
   z*=.92 if race=='elf' else 1;center=Vector((mirror*(.132 if race=='elf' else .145),.128,z));verts=[];faces=[];n=16;rings=9
   for row in range(rings):
    latitude=-math.pi/2+row/(rings-1)*math.pi
    for i in range(n):
     a=math.tau*i/n;local=center+Vector((math.sin(latitude)*.012,math.cos(latitude)*math.sin(a)*.031,math.cos(latitude)*math.cos(a)*(.026 if index<3 else .020)))
     verts.append(arm.data.bones['hand_'+side].matrix_local@local)
   for row in range(rings-1):
    for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
   mesh('Individual curved dorsal knuckle guard',verts,faces,arm,role,'hand_'+side,metal,collection,smooth=True)
 return len(selected)


def portrait_weapon(arm,role,collection,race):
 gold=material(race+' worked weapon copper gold',(.34,.25,.12) if race=='elf' else (.35,.13,.045),.8,.44)
 steel=material(race+' honed silver cutting metal',(.46,.49,.46),.82,.30)
 dark=material(race+' weapon leather and dark iron',(.045,.032,.020),.05,.80)
 hand=arm.data.bones['hand_R'];m=hand.matrix_local@Matrix.Translation((0,.15,0))
 bpy.context.view_layer.update();idle_axis=arm.matrix_world.to_3x3()@arm.pose.bones['hand_R'].matrix.to_3x3()@Vector((0,0,1))
 if idle_axis.z<0:m=m@Matrix.Rotation(math.pi,4,'Y')
 if race=='elf':outline=[(0,.15),(-.058,.32),(-.070,.83),(-.031,1.31),(0,1.52),(.031,1.31),(.070,.83),(.058,.32)]
 else:outline=[(-.04,.45),(-.12,.59),(-.26,.47),(-.31,.73),(-.37,1.08),(-.27,1.43),(-.07,1.62),(.03,1.53),(-.06,1.26),(.09,.96),(.08,.67)]
 if race=='demon':
  posed=arm.matrix_world@arm.pose.bones['hand_R'].matrix@hand.matrix_local.inverted()@m
  outward=posed.translation-(arm.matrix_world@arm.pose.bones['chest'].head)
  if (-posed.to_3x3().col[0]).dot(outward)<0:outline=[(-x,z) for x,z in outline]
 n=len(outline);verts=[m@Vector((x,y,z)) for y in [-.017,.017] for x,z in outline]
 faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 mesh('Elf honed leaf sword' if race=='elf' else 'Demon asymmetrical crescent war cleaver',verts,faces,arm,role,'hand_R',steel,collection)
 curve('Wrapped functional weapon haft',[m@Vector((0,0,-.23)),m@Vector((0,0,.14 if race=='elf' else .60))],.043,arm,role,'hand_R',dark,collection)
 curve('Forged swept leaf guard',[m@Vector((-.16,0,.11)),m@Vector((0,-.01,.14)),m@Vector((.16,0,.11))],.021,arm,role,'hand_R',gold,collection)
 for z in [-.17,-.10,-.03,.04]:curve('Hilt crossed leather binding',[m@Vector((-.035,-.018,z)),m@Vector((.035,-.018,z+.045))],.008,arm,role,'hand_R',gold,collection)
 # Keep the original shield skeleton/socket convention and healthy motion.
 shield=next((b for b in arm.data.bones if b.name.startswith('prop-shield') and 'arm' not in b.name),None)
 if not shield:return
 m=shield.matrix_local;outline=[(0,-.62),(-.29,-.30),(-.36,.18),(-.22,.48),(0,.65),(.22,.48),(.36,.18),(.29,-.30)] if race=='elf' else [(0,-.67),(-.40,-.27),(-.34,.36),(-.13,.53),(0,.70),(.13,.53),(.34,.36),(.40,-.27)]
 field=material(race+' shield worked field',(.13,.21,.15) if race=='elf' else (.055,.050,.043),.6,.66)
 n=len(outline);verts=[m@Vector((x,y,z+.12)) for y in [-.075,.025] for x,z in outline];center=m@Vector((0,-.13,.12));verts.append(center)
 faces=[(i,(i+1)%n,n*2) for i in range(n)]+[tuple(range(n,n*2))]+[(i,n+i,n+(i+1)%n,(i+1)%n) for i in range(n)]
 mesh('Portrait dimensional leaf shield',verts,faces,arm,role,shield.name,field,collection)
 curve('Shield broad closed sculpted rim',[m@Vector((x,-.080,z+.12)) for x,z in outline+[outline[0]]],.025,arm,role,shield.name,gold,collection)
 for side in [-1,1]:
  for z in [-.26,.05,.32]:curve('Shield branching precious leaf vein',[center+Vector((0,0,z)),m@Vector((side*.14,-.125,z+.23)),m@Vector((side*.26,-.085,z+.31))],.014,arm,role,shield.name,gold,collection)
 curve('Raised central shield keel',[m@Vector((0,-.09,-.39)),center,m@Vector((0,-.09,.70))],.022,arm,role,shield.name,gold,collection)
 handm=arm.data.bones['hand_L'].matrix_local
 curve('Actual hand closed rear shield grip',[handm@Vector((0,.15,-.15)),handm@Vector((0,.15,.15))],.043,arm,role,'hand_L',dark,collection)


def fitted_limb_kit(arm,role,body,collection,race):
 metal=material(race+' contoured bracer and greave',(.13,.20,.145) if race=='elf' else (.055,.046,.041),.7,.57)
 trim=material(race+' limb gold copper edge',(.34,.26,.13) if race=='elf' else (.35,.135,.046),.76,.50)
 cloth=material(race+' fitted dark leg cloth',(.035,.072,.045) if race=='elf' else (.043,.021,.017),0,.90,'cloth')
 if race in ['demon','elf']:
  body.data.materials.append(cloth);slot=len(body.data.materials)-1;names={g.index:g.name for g in body.vertex_groups}
  for p in body.data.polygons:
   lower=sum(g.weight for i in p.vertices for g in body.data.vertices[i].groups if names[g.group].startswith(('thigh_','leg_')))/len(p.vertices)
   sleeve=sum(g.weight for i in p.vertices for g in body.data.vertices[i].groups if names[g.group].startswith(('arm_','forearm_')))/len(p.vertices)
   if lower>.50 or (race=='elf' and sleeve>.5):p.material_index=slot
 # Retain source foot skinning/sole planes, round authored rigid footwear edges.
 bm=bmesh.new();bm.from_mesh(body.data);deform=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups}
 chosen=[]
 for edge in bm.edges:
  if len(edge.link_faces)!=2:continue
  foot=all(sum(w for i,w in v[deform].items() if names[i] in ['foot_L','foot_R'])>.999 for v in edge.verts)
  if foot and edge.calc_face_angle(0)>.38:chosen.append(edge)
 if chosen:bmesh.ops.bevel(bm,geom=chosen,offset=.016,segments=3,affect='EDGES')
 bm.to_mesh(body.data);bm.free();body.data.update()
 for side in ['L','R']:
  for prefix,lo,hi,radius in [('forearm_',.18,.88,.125),('leg_',.10,.85,.145)]:
   b=arm.data.bones[prefix+side];length=b.length;verts=[];faces=[];n=32;rows=7
   for row in range(rows):
    t=row/(rows-1);y=length*(lo*(1-t)+hi*t);r=radius*(1-.14*t)
    for i in range(n):
     a=math.tau*i/n;verts.append(b.matrix_local@Vector((math.cos(a)*r,y,math.sin(a)*r)))
   for row in range(rows-1):
    for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
   plate=mesh('Anatomical fitted '+prefix+side,verts,faces,arm,role,b.name,metal,collection,smooth=True)
   mod=plate.modifiers.new('Closed forged cuff wall','SOLIDIFY');mod.thickness=.013;bpy.context.view_layer.objects.active=plate;plate.select_set(True);bpy.ops.object.modifier_move_up(modifier=mod.name);bpy.ops.object.modifier_apply(modifier=mod.name);plate.select_set(False)
   for row in [0,rows-1]:curve('Limb complete worked edge',verts[row*n:(row+1)*n]+[verts[row*n]],.011,arm,role,b.name,trim,collection)


def _head_skin(race='elf'):
 existing=bpy.data.materials.get('Peris '+race+' warm facial anatomy paint')
 if existing:return existing
 size=1024;yy,xx=np.mgrid[:size,:size];u=(xx+.5)/size;v=(yy+.5)/size
 angle=(u-.5)*math.tau;x=np.clip(.058*np.tan(angle),-.2,.2);z=1.68+v*.29;front=np.maximum(0,np.cos(angle))**2
 base=np.asarray((.62,.48,.34) if race=='elf' else (.37,.067,.044));col=np.ones((size,size,4),np.float32)
 shade=np.ones((size,size))*.96
 # Warm temple/cheek planes and muted closed lips are paint on the actual UV.
 for side in [-1,1]:
  shade-=.22*np.exp(-((x-side*.03)/.027)**2-((z-1.842)/.020)**2)*front
  shade+=.09*np.exp(-((x-side*.045)/.030)**2-((z-1.795)/.026)**2)*front
  shade-=.30*np.exp(-((x-side*.034)/.026)**4-((z-1.842)/.0055)**2)*front
 shade-=.18*np.exp(-(x/.031)**6-((z-1.750)/.012)**2)*front
 shade+=.07*np.exp(-(x/.017)**2-((z-1.81)/.040)**2)*front
 rng=np.random.default_rng(6123);shade+=rng.normal(0,.008,(size,size));col[:,:,:3]=np.clip(base*shade[:,:,None],0,1)
 mat=bpy.data.materials.new('Peris '+race+' warm facial anatomy paint');mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.74
 tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image(race+' source-coordinate facial paint',col);mat.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color']);return mat


def elf_head(arm,role,collection,race='elf'):
 source=ROOT/'assets/references/units/downloads/elf/layered-elf-spearman-sculpt/reference.glb';sha=hashlib.sha256(source.read_bytes()).hexdigest()
 template=globals().get('_HEAD_CROP_TEMPLATE')
 if template is None:
  old=set(bpy.data.objects);old_meshes=set(bpy.data.meshes);bpy.ops.import_scene.gltf(filepath=str(source));imported=[o for o in bpy.data.objects if o not in old];imported_meshes=set(bpy.data.meshes)-old_meshes
  head=next(o for o in imported if o.name.startswith('Body_Body2_0'))
  head.data=head.data.copy();head.data.transform(head.matrix_world);head.matrix_world=Matrix.Identity(4)
  bm=bmesh.new();bm.from_mesh(head.data);bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z<1.68],context='VERTS');bm.to_mesh(head.data);bm.free()
  # Cache the exact neutral cropped geometry, before any role fit or Demon
  # adaptation. Each role receives its own data copy; the source stays intact.
  globals()['_HEAD_CROP_TEMPLATE']=head.data.copy()
 else:
  head=bpy.data.objects.new('Cached identical Seifert neutral head crop',template.copy());collection.objects.link(head)
  imported=[head];imported_meshes=set()
 h=arm.data.bones['head'].head_local.copy();center=h+Vector((0,-.045,.17))
 raw=[v.co.copy() for v in head.data.vertices]
 if race=='demon':
  # A different cranial silhouette, with broad temple planes and a pointed chin.
  for v in head.data.vertices:
   upper=max(0,min(1,(v.co.z-1.82)/.07));chin=max(0,min(1,(1.77-v.co.z)/.075))
   v.co.x*=1.18+.16*upper-.36*chin
   v.co.y-=.009*upper*max(0,min(1,(-v.co.y-.025)/.04))
  center=h+Vector((0,-.050,.14))
 transform=Matrix.Translation(center)@Matrix.Diagonal((2.35,2.00,2.00,1))@Matrix.Translation(-Vector((0,-.015,1.82)))
 head.data.transform(transform);head.data.update();head.name=role+' Seifert adapted connected Elf head'
 for c in list(head.users_collection):c.objects.unlink(head)
 collection.objects.link(head);head.parent=arm;head.matrix_basis=Matrix.Identity(4);head.matrix_parent_inverse=Matrix.Identity(4)
 head.data.materials.clear();head.data.materials.append(_head_skin(race));head.vertex_groups.clear();group=head.vertex_groups.new(name='prop-head');group.add(list(range(len(head.data.vertices))),1,'REPLACE')
 mod=head.modifiers.new('Existing real head bone','ARMATURE');mod.object=arm
 uv=head.data.uv_layers.new(name='ElfHeadUV')
 for p in head.data.polygons:
  p.use_smooth=True
  for li,vi in zip(p.loop_indices,p.vertices):
   x,y,z=raw[vi];uv.data[li].uv=(.5+math.atan2(x,-y)/math.tau,max(0,min(1,(z-1.68)/.29)))
 credit={'author':'Seifert','license':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','sourceUrl':'https://sketchfab.com/3d-models/stylized-elf-warrior-sculpt-7dd1ff28b7944c4face76d1adbea063e','sourceFileSha256':sha,
  'changes':'Head-only Body2 crop at source Z1.68, moderate width/depth/height fit to existing rig, generated UV and original warm facial paint; original Peris eyes, ears and hair separately authored','runtimeApproved':False,'finishedUnitApproved':False}
 head['peris_role']=role;head['asset_author']='Seifert; Peris head-only fit and facial paint';head['asset_license']='CC-BY-4.0';head['source_url']=credit['sourceUrl'];head['source_file_sha256']=sha;head['peris_component_credit']=json.dumps(credit);head['runtime_approved']=False;head['peris_unit_finished']=False;head['peris_atlas_partition']='licensed-elf-head';head['original_peris_equipment']=False
 if race=='demon':
  credit['changes']+='; distinct Demon adaptation: widened brow/temple planes, tapered angular chin, rooted swept horns, short ears, red facial paint and amber gaze; no Elf hair'
  head.name=role+' Seifert distinct angular Demon head';head['peris_atlas_partition']='licensed-demon-head';head['peris_component_credit']=json.dumps(credit)
 for o in imported:
  if o!=head:bpy.data.objects.remove(o,do_unlink=True)
 for data in imported_meshes:
  if data.users==0:bpy.data.meshes.remove(data)
 skin=head.data.materials[0];eye=material('Elf cream eye with teal gaze',(.56,.52,.38),rough=.65)
 # Actual connected source orbital surface fixes the placement of each eye.
 for side in [-1,1]:
  # Direct source-plane probe: lower opening Z1.820..1.824 lies near Y-.066;
  # upper lid at Z1.828 projects to Y-.076. Keep original source depth with
  # a narrow visible eye inside that opening; moving above it hides the eye.
  c=transform@Vector((side*.028*(1.185 if race=='demon' else 1),-.058,1.824));verts=[];faces=[];coords=[];n=32;rings=17
  for j in range(rings):
   lat=-math.pi/2+j/(rings-1)*math.pi
   for i in range(n):
    angle=(i/n-.5)*math.tau;verts.append(c+Vector((math.sin(angle)*math.cos(lat)*.031,-math.cos(angle)*math.cos(lat)*.026,math.sin(lat)*.012)))
    coords.append((i/n,j/(rings-1)))
  for j in range(rings-1):
   for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
  eye_obj=mesh('Elf seated eye '+str(side),verts,faces,arm,role,'prop-head',eye,collection,coords,True)
  # Single painted texture, no floating pupil shells.
 size=512;yy,xx=np.mgrid[:size,:size];u=(xx+.5)/size;v=(yy+.5)/size;r=np.sqrt(((u-.5)*math.tau)**2+((v-.5)*math.pi)**2)
 col=np.ones((size,size,4),np.float32);col[:,:,:3]=(.56,.52,.38);col[r<.30,:3]=(.085,.23,.18) if race=='elf' else (.65,.24,.025);col[r<.12,:3]=(.007,.010,.008)
 tex=eye.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image('Elf iris seated in actual eye UV',col);eye.node_tree.links.new(tex.outputs['Color'],eye.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
 # Original ears grow from the temporal attachment rather than a floating cone.
 for side in [-1,1]:
  root=center+Vector((side*(.17 if race=='elf' else .21),.0,.01));verts=[root+Vector((0,-.015,-.075)),root+Vector((0,-.030,.085)),root+Vector((side*(.25 if race=='elf' else .12),.045,.14)),root+Vector((side*.07,-.065,.005)),root+Vector((side*.07,.010,.005))]
  mesh('Rooted pointed Elf ear',verts,[(0,1,3),(1,2,3),(2,0,3),(1,0,4),(2,1,4),(0,2,4)],arm,role,'prop-head',skin,collection,smooth=True)
 if race=='demon':return credit,center
 hair=material('Elf swept warm golden hair',(.45,.33,.18),rough=.84,grain='cloth');hair.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value=.16
 # Solid fitted scalp with a curved, asymmetrical swept hairline.
 verts=[];faces=[];n=64;rows=19
 for row in range(rows):
  t=row/(rows-1)
  for i in range(n):
   angle=(i/n-.5)*math.tau;front=max(0,math.cos(angle));bottom=-.44+front*1.03
   latitude=bottom+(math.pi/2-bottom)*t
   radius=math.cos(latitude)
   verts.append(center+Vector((math.sin(angle)*radius*.232,-math.cos(angle)*radius*.20,.04+math.sin(latitude)*.282)))
 for row in range(rows-1):
  for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
 scalp=mesh('Fitted swept Elf scalp mass',verts,faces,arm,role,'prop-head',hair,collection,smooth=True)
 for side in [-1,1]:
  for i in range(5):
   x=side*(.04+i*.037);controls=[center+Vector((x,-.070,.245)),center+Vector((x*.9,.02,.285)),center+Vector((side*(.19+i*.007),.14,.12)),center+Vector((side*(.205+i*.008),.19,-.15)),center+Vector((side*(.24+i*.010),.15,-.52))]
   points=[]
   for segment in range(len(controls)-1):
    a,b=controls[max(segment-1,0)],controls[segment];c,d=controls[segment+1],controls[min(segment+2,len(controls)-1)]
    for j in range(8):
     t=j/8;points.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
   points.append(controls[-1]);curve('Broad curved tapered golden hair lock',points,.030,arm,role,'prop-head',hair,collection,.010)
 return credit


def chest_surface(body,arm):
 inv=arm.matrix_world.inverted();matrix=inv@body.matrix_world
 verts=[matrix@v.co for v in body.data.vertices];names={g.index:g.name for g in body.vertex_groups}
 # Packed props are disconnected; use the largest original garment component.
 neighbours={i:set() for i in range(len(body.data.vertices))}
 for p in body.data.polygons:
  for a,b in zip(p.vertices,list(p.vertices[1:])+[p.vertices[0]]):neighbours[a].add(b);neighbours[b].add(a)
 pending=set(neighbours);components=[]
 while pending:
  seed=pending.pop();component={seed};todo=[seed]
  while todo:
   for other in neighbours[todo.pop()]:
    if other in pending:pending.remove(other);component.add(other);todo.append(other)
  components.append(component)
 largest=max(components,key=len)
 faces=[tuple(p.vertices) for p in body.data.polygons if p.vertices[0] in largest and sum(g.weight for i in p.vertices for g in body.data.vertices[i].groups if names[g.group] in ['chest','spine','hip'])/len(p.vertices)>.4]
 return BVHTree.FromPolygons(verts,faces)


def portrait_armor(arm,role,body,collection,race='elf'):
 heavy=role in ['elite','heavy_cavalry'];gold=material(race+' aged warm precious trim',(.32,.24,.125) if race=='elf' else (.34,.13,.045),.75,.48)
 plate=material(race+' worked green silver' if race=='elf' else 'Demon scorched black iron',(.15,.22,.165) if race=='elf' else (.072,.060,.054),.68,.55)
 leather=material(race+' fitted crossed leather',(.075,.049,.030),0,.88,'cloth');tree=chest_surface(body,arm);chest=arm.data.bones['chest'].head_local;hip=arm.data.bones['hip'].head_local
 def at(x,z,extra=0):
  p=Vector((x,-1.3,z));hit=tree.ray_cast(p,Vector((0,1,0)),2.6)[0]
  y=min(-.22,hit.y if hit else -.24)-.035-extra
  return Vector((x,y,z))
 # Conforming broad plate with coherent center ridge, fine thick border.
 ztop=min(arm.data.bones['neck'].head_local.z-.13,chest.z+.64);zbottom=hip.z+.22;rows=11;cols=15;verts=[]
 for j in range(rows):
  t=j/(rows-1);z=ztop*(1-t)+zbottom*t;width=.36-.045*math.cos(t*math.pi)
  for i in range(cols):
   x=(i/(cols-1)*2-1)*width;verts.append(at(x,z,.02*(1-(x/width)**2)))
 faces=[(j*cols+i,j*cols+i+1,(j+1)*cols+i+1,(j+1)*cols+i) for j in range(rows-1) for i in range(cols-1)]
 o=mesh('Portrait fitted anatomical cuirass',verts,faces,arm,role,'chest',plate,collection,smooth=True)
 solid=o.modifiers.new('Forged plate edge thickness','SOLIDIFY');solid.thickness=.022;bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.modifier_move_up(modifier=solid.name);bpy.ops.object.modifier_apply(modifier=solid.name);o.select_set(False)
 # The back is a fitted companion shell, not exposed unprotected skin.
 back=[]
 for j in range(rows):
  t=j/(rows-1);z=ztop*(1-t)+zbottom*t;width=.35-.035*math.cos(t*math.pi)
  for i in range(cols):
   x=(i/(cols-1)*2-1)*width;hit=tree.ray_cast(Vector((x,1.3,z)),Vector((0,-1,0)),2.6)[0]
   back.append(Vector((x,max(.20,hit.y if hit else .22)+.035,z)))
 backfaces=[tuple(reversed(f)) for f in faces]
 rear=mesh('Portrait fitted companion backplate',back,backfaces,arm,role,'chest',plate,collection,smooth=True)
 wall=rear.modifiers.new('Forged backplate thickness','SOLIDIFY');wall.thickness=.020;bpy.context.view_layer.objects.active=rear;rear.select_set(True);bpy.ops.object.modifier_move_up(modifier=wall.name);bpy.ops.object.modifier_apply(modifier=wall.name);rear.select_set(False)
 for side in [-1,1]:
  curve('Backplate substantial closed rim',[back[j*cols+(0 if side<0 else cols-1)] for j in range(rows)],.013,arm,role,'chest',gold,collection)
  sideverts=[];sidecols=13
  for row in range(rows):
   edge=0 if side<0 else cols-1;front=verts[row*cols+edge];rear=back[row*cols+edge]
   for col in range(sidecols):
    t=col/(sidecols-1);p=front.lerp(rear,t);hit=tree.ray_cast(Vector((side*1.3,p.y,p.z)),Vector((-side,0,0)),2.6)[0]
    p.x=side*(max(abs(p.x),abs(hit.x)+.035 if hit else abs(p.x))+.015*math.sin(t*math.pi));sideverts.append(p)
  sidefaces=[(j*sidecols+i,j*sidecols+i+1,(j+1)*sidecols+i+1,(j+1)*sidecols+i) for j in range(rows-1) for i in range(sidecols-1)]
  if side>0:sidefaces=[tuple(reversed(f)) for f in sidefaces]
  wall=mesh('Fitted continuous side corslet',sideverts,sidefaces,arm,role,'chest',plate,collection,smooth=True)
  thick=wall.modifiers.new('Worked sidewall thickness','SOLIDIFY');thick.thickness=.015;bpy.context.view_layer.objects.active=wall;wall.select_set(True);bpy.ops.object.modifier_move_up(modifier=thick.name);bpy.ops.object.modifier_apply(modifier=thick.name);wall.select_set(False)
 for side in [-1,1]:
  for j in range(3):
   z=ztop-.11-j*.23;outline=[at(side*.02,z+.12,.045),at(side*.19,z+.055,.045),at(side*.32,z-.025,.045)]
   curve('Worked leaf chevron engraved trim',outline,.009,arm,role,'chest',gold,collection)
 if race=='elf':
  for side in [-1,1]:
   for row in range(2):
    z=ztop-.22-row*.34;x=side*.165
    outline=[(x,z+.22),(x-side*.15,z+.075),(x-side*.14,z-.14),(x+side*.005,z-.25),(x+side*.15,z-.065),(x+side*.15,z+.075)]
    border=[at(px,pz,.065) for px,pz in outline];ridge=at(x,z,.083);n=len(border)
    vertices=border+[ridge]+[p+Vector((0,.018,0)) for p in border]
    panels=[(i,(i+1)%n,n) for i in range(n)]+[tuple(range(n+1,n*2+1))]+[(i,n+1+i,n+1+(i+1)%n,(i+1)%n) for i in range(n)]
    mesh('Overlapping forged pointed leaf lamella',vertices,panels,arm,role,'chest',plate,collection,smooth=True)
    curve('Lamella fine raised precious border',border+[border[0]],.008,arm,role,'chest',gold,collection)
    curve('Lamella dimensional central leaf vein',[border[0],ridge,border[3]],.006,arm,role,'chest',gold,collection)
 for side in [-1,1]:
  curve('Cuirass curved closed outer rim',[verts[j*cols+(0 if side<0 else cols-1)] for j in range(rows)],.015,arm,role,'chest',gold,collection)
 for side in [-1,1]:
  points=[at(side*(.28-.53*i/18),ztop-.02-(ztop-zbottom-.03)*i/18,.055) for i in range(19)]
  curve('Fitted diagonal leather harness',points,.030,arm,role,'chest',leather,collection,.014)
 # Dimensional leaf device and an honest belt buckle, attached to the same plate.
 c=at(0,(ztop+zbottom)*.5,.11);verts2=[c+Vector((0,0,.15)),c+Vector((-.09,0,0)),c+Vector((0,-.024,-.15)),c+Vector((.09,0,0)),c+Vector((0,-.05,0))]
 mesh('Dimensional central leaf device',verts2,[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],arm,role,'chest',gold,collection)
 # Curved overlapping pauldrons follow the actual shoulder body axis.
 for side in [-1,1]:
  name='arm_'+('L' if side>0 else 'R');bone=arm.data.bones[name];center=bone.head_local
  count=3 if heavy else (1 if role in ['scout','archer'] else 2)
  for layer in range(count):
   verts=[];faces=[];n=28;rings=9
   boundary=[(0,-.27),(-.17,-.18),(-.21,.045),(-.07,.22),(.15,.21),(.30,.035),(.22,-.17)]
   for row in range(rings):
    t=.035+row/(rings-1)*.965;z=.18*(1-t*t)-layer*.095
    for i in range(n):
     k=i//4;blend=(i%4)/4;a=boundary[k];b=boundary[(k+1)%len(boundary)]
     x=a[0]*(1-blend)+b[0]*blend;y=a[1]*(1-blend)+b[1]*blend
     verts.append(center+Vector((side*(.035+layer*.015+x*t),y*t,z)))
   for row in range(rings-1):
    for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
   faces.append(tuple(range(n-1,-1,-1)))
   p=mesh('Layered fitted leaf shoulder plate',verts,faces,arm,role,name,plate,collection,smooth=True)
   modifier=p.modifiers.new('Worked shell thickness','SOLIDIFY');modifier.thickness=.018;bpy.context.view_layer.objects.active=p;p.select_set(True);bpy.ops.object.modifier_move_up(modifier=modifier.name);bpy.ops.object.modifier_apply(modifier=modifier.name);p.select_set(False)
   curve('Pauldron substantial precious rim',verts[-n:]+[verts[-n]],.013,arm,role,name,gold,collection)
 return {'construction':'Ray-fitted broad curved cuirass with central raised device, closed thick edges, crossed fitted leather and overlapping shoulder shells','race':race,'role':role,'runtimeApproved':False,'finishedUnitApproved':False}


def apply_elf_quality(arm,role,body,collection):
 removed=remove_old_head(body,arm);props=remove_superseded_props(body,arm,role);credit=elf_head(arm,role,collection);armor=portrait_armor(arm,role,body,collection,'elf')
 hands=portrait_hands(arm,role,body,collection,'elf') if role=='line_infantry' else 0
 if role=='line_infantry':portrait_weapon(arm,role,collection,'elf')
 fitted_limb_kit(arm,role,body,collection,'elf');soft_cloth_kit(arm,role,body,collection,'elf');role_identity(arm,role,body,collection,'elf')
 record={'role':role,'removedSupersededHeadFaces':removed,'removedSupersededPropVertices':props,'replacedHandFaces':hands,'headCredit':credit,'armor':armor,'rigRestBonesActionsChanged':False,'weaponGeometry':'Original portrait weapon and shield on existing hand/shield bones; existing functional role clips retained','runtimeApproved':False,'finishedUnitApproved':False}
 arm['peris_fantasy_portrait_quality']=json.dumps(record);arm['peris_licensed_head_credit']=json.dumps(credit);return record


def demon_head(arm,role,collection):
 credit,center=elf_head(arm,role,collection,'demon')
 hornmat=material('Demon ridged scorched keratin',(.027,.021,.020),.18,.77);ridge=material('Demon worn horn ridges',(.115,.079,.045),.25,.75)
 for side in [-1,1]:
  controls=[center+Vector((side*.22,.015,.22)),center+Vector((side*.31,.025,.36)),center+Vector((side*.42,.13,.48)),center+Vector((side*.41,.23,.67)),center+Vector((side*.31,.26,.81))]
  points=[]
  for segment in range(4):
   a,b=controls[max(0,segment-1)],controls[segment];c,d=controls[segment+1],controls[min(4,segment+2)]
   for step in range(10):
    t=step/10;points.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
  points.append(controls[-1]);verts=[];faces=[];n=18
  for row,p in enumerate(points):
   t=row/(len(points)-1);tangent=(points[min(row+1,len(points)-1)]-points[max(0,row-1)]).normalized();a=tangent.cross(Vector((0,1,0))).normalized();b=tangent.cross(a).normalized();radius=.108*(1-t)**.72+.002
   radius*=1+.07*math.sin(row*math.pi*.65)
   for i in range(n):angle=math.tau*i/n;verts.append(p+(a*math.cos(angle)+b*math.sin(angle))*radius)
  for row in range(len(points)-1):
   for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
  faces.extend([tuple(range(n-1,-1,-1)),tuple(range((len(points)-1)*n,len(points)*n))])
  mesh('Rooted swept ridged Demon horn',verts,faces,arm,role,'prop-head',hornmat,collection,smooth=True)
 # A narrow cranial ridge changes the silhouette without a human helmet.
 # The actual source brow remains anatomical; no separate stripe over the nose.
 return credit


def apply_demon_quality(arm,role,body,collection):
 removed=remove_old_head(body,arm);props=remove_superseded_props(body,arm,role);credit=demon_head(arm,role,collection);armor=portrait_armor(arm,role,body,collection,'demon')
 hands=portrait_hands(arm,role,body,collection,'demon') if role=='line_infantry' else 0
 if role=='line_infantry':portrait_weapon(arm,role,collection,'demon')
 fitted_limb_kit(arm,role,body,collection,'demon');demon_cloven_hooves(arm,role,body,collection);paint_demon_body_skin(arm,body);soft_cloth_kit(arm,role,body,collection,'demon');role_identity(arm,role,body,collection,'demon')
 record={'role':role,'removedSupersededHeadFaces':removed,'removedSupersededPropVertices':props,'replacedHandFaces':hands,'headCredit':credit,'armor':armor,'rigRestBonesActionsChanged':False,'weaponGeometry':'Original crescent cleaver and shield on existing hand/shield bones; existing functional role clips retained','runtimeApproved':False,'finishedUnitApproved':False}
 arm['peris_fantasy_portrait_quality']=json.dumps(record);arm['peris_licensed_head_credit']=json.dumps(credit);return record


def demon_cloven_hooves(arm,role,body,collection):
 names={g.index:g.name for g in body.vertex_groups};matrix=arm.matrix_world.inverted()@body.matrix_world;bounds={}
 for side in ['L','R']:
  points=[matrix@v.co for v in body.data.vertices if sum(g.weight for g in v.groups if names[g.group] in ['foot_'+side,'toe_'+side])>.55]
  bounds[side]=([min(v[i] for v in points) for i in range(3)],[max(v[i] for v in points) for i in range(3)])
 bm=bmesh.new();bm.from_mesh(body.data);deform=bm.verts.layers.deform.active
 remove=[f for f in bm.faces if sum(sum(w for i,w in v[deform].items() if names[i].startswith(('foot_','toe_'))) for v in f.verts)/len(f.verts)>.55]
 bmesh.ops.delete(bm,geom=remove,context='FACES');bm.to_mesh(body.data);bm.free();body.data.update()
 mat=material('Demon dark striated keratin hoof',(.036,.025,.021),.08,.86,'cloth')
 for side in ['L','R']:
  bone=arm.data.bones['foot_'+side];lo,hi=bounds[side];bottom=lo[2];cx=bone.head_local.x;cy=(lo[1]+hi[1])/2
  for split in [-1,1]:
   verts=[];faces=[];uv=[];n=28;profiles=[(0,.085,.215),(.022,.093,.224),(.16,.078,.185),(.265,.053,.137)]
   for row,(height,rx,ry) in enumerate(profiles):
    for i in range(n):
     a=math.tau*i/n;verts.append(Vector((cx+split*.098+math.sin(a)*rx,cy-math.cos(a)*ry,bottom+height)));uv.append((i/n,row/(len(profiles)-1)))
   for row in range(len(profiles)-1):
    for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
   faces.extend([tuple(range(n-1,-1,-1)),tuple(range((len(profiles)-1)*n,len(profiles)*n))])
   hoof=mesh('Anatomical paired cloven keratin hoof',verts,faces,arm,role,bone.name,mat,collection,uv=uv,smooth=True)
   # Cap faces need planar UVs. A collapsed ring-at-V=1 makes the tangent
   # normal map undefined and produced the white top strips in the V6 render.
   for poly in list(hoof.data.polygons)[-2:]:
    poly.use_smooth=False
    for li,vi in zip(poly.loop_indices,poly.vertices):
     a=math.tau*(vi%n)/n;hoof.data.uv_layers.active.data[li].uv=(.5+.45*math.sin(a),.5+.45*math.cos(a))
   hoof['peris_hoof_original_floor_rest_z']=bottom;hoof['peris_hoof_reference']='Original two-digit dark keratin anatomy with measured source foot sole datum; human red toes removed, existing foot bone retained'


def paint_demon_body_skin(arm,body):
 name='Demon authored anatomical body recess paint';mat=bpy.data.materials.get(name)
 if mat is None:
  mat=material(name,(.34,.055,.038),0,.87);size=1024;yy,xx=np.mgrid[:size,:size];x=((xx+.5)/size-.5)*3;z=(yy+.5)/size*4.2
  shade=np.ones((size,size),np.float32)*.95
  for side in [-1,1]:
   shade-=.24*np.exp(-((x-side*.46)/.12)**2-((z-3.02)/.18)**2)
   shade+=.07*np.exp(-((x-side*.23)/.19)**2-((z-3.20)/.24)**2)
   shade-=.14*np.exp(-((x-side*.80)/.13)**2-((z-2.42)/.18)**2)
  shade-=.14*np.exp(-(x/.07)**2-((z-2.88)/.40)**2)
  pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=np.clip(np.asarray((.34,.055,.038))*shade[:,:,None],0,1)
  p=mat.node_tree.nodes['Principled BSDF'];node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image(name,pixels);mat.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color'])
 body.data.materials.append(mat);slot=len(body.data.materials)-1;names={g.index:g.name for g in body.vertex_groups};uv=body.data.uv_layers.active;matrix=arm.matrix_world.inverted()@body.matrix_world
 for polygon in body.data.polygons:
  weight=sum(g.weight for i in polygon.vertices for g in body.data.vertices[i].groups if names[g.group] in ['chest','spine','neck','arm_L','arm_R','forearm_L','forearm_R'])/len(polygon.vertices)
  if weight>.50:
   polygon.material_index=slot
   for li,vi in zip(polygon.loop_indices,polygon.vertices):
    co=matrix@body.data.vertices[vi].co;uv.data[li].uv=(.5+co.x/3,co.z/4.2)
 body['peris_source_skin_surface_changes']='Selected exposed torso/upperarm/forearm skin faces receive original anatomy-coordinate red recess paint and roughness variation; their UV loops changed, source file retained'


def apply_faction_giant_quality(arm,role,body,collection,race):
 """Reuse the approved faction face on the existing large living siege rig."""
 if role!='catapult':raise ValueError('Explicit living siege role required')
 removed=remove_old_head(body,arm)
 if race=='demon':
  credit=demon_head(arm,role,collection);paint_demon_body_skin(arm,body)
  demon_cloven_hooves(arm,role,body,collection);soft_cloth_kit(arm,role,body,collection,race)
 else:
  credit=elf_head(arm,role,collection)
  # A carved stone face belongs to the rootstone form; no living blond wig.
  for obj in list(collection.objects):
   if obj.get('peris_role')==role and ('golden hair lock' in obj.name or 'Elf scalp' in obj.name):bpy.data.objects.remove(obj,do_unlink=True)
 from orc_giant_refinement import _stone_material
 stone=material('Shared natural siege granite',(.19,.20,.18),0,.94,'stone')
 # Use the tested non-periodic mineral finish, with finite spherical UVs.
 existing=bpy.data.materials.get('Faction siege natural mineral granite')
 if existing is None:existing=_stone_material();existing.name='Faction siege natural mineral granite'
 stone=existing
 if race=='elf':
  for obj in collection.objects:
   if obj.get('peris_role')==role and ('adapted connected Elf head' in obj.name or 'Rooted pointed Elf ear' in obj.name):obj.data.materials.clear();obj.data.materials.append(stone)
  credit['changes']+='; rootstone siege adaptation: same angular faction head rendered as carved mineral stone, original living-root body/bindings retained, no hair'
 else:credit['changes']+='; Div siege adaptation on the existing enlarged body/throw rig, red anatomy paint, separate short cloth wrap and cloven hooves'
 for obj in collection.objects:
  if obj.get('peris_role')==role and obj.get('asset_license')=='CC-BY-4.0':obj['peris_component_credit']=json.dumps(credit)
 # Extract only the measured, pure-hand spherical held rock from packed source.
 bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups};pending=set(bm.verts);rocks=[]
 while pending:
  seed=pending.pop();component={seed};todo=[seed]
  while todo:
   for edge in todo.pop().link_edges:
    for other in edge.verts:
     if other in pending:pending.remove(other);component.add(other);todo.append(other)
  if len(component)<40:continue
  weight=sum(sum(w for i,w in v[layer].items() if names[i]=='hand_R') for v in component)/len(component)
  span=[max(v.co[i] for v in component)-min(v.co[i] for v in component) for i in range(3)]
  if weight>.999 and all(.65<s<1.2 for s in span):rocks.append(component)
 if len(rocks)!=1:bm.free();raise ValueError('Expected one measured held boulder component, found '+str(len(rocks)))
 comp=rocks[0];ordered=list(comp);idx={v:i for i,v in enumerate(ordered)};verts=[v.co.copy() for v in ordered];faces=[tuple(idx[v] for v in f.verts) for f in {f for v in comp for f in v.link_faces}];center=sum(verts,Vector())/len(verts)
 uv=[]
 for co in verts:
  d=(co-center).normalized();uv.append((.5+math.atan2(d.x,-d.y)/math.tau,.5+math.asin(max(-1,min(1,d.z)))/math.pi))
 rock=mesh('Held siege boulder refined natural mineral',verts,faces,arm,role,'hand_R',stone,collection,uv=uv,smooth=False)
 bmesh.ops.delete(bm,geom=ordered,context='VERTS');bm.to_mesh(body.data);bm.free();body.data.update()
 from orc_giant_throw import apply_giant_throw
 throw=apply_giant_throw(arm,[rock],role)
 record={'role':role,'headCredit':credit,'removedSupersededHeadFaces':removed,'method':'Approved faction head/anatomy on original enlarged living siege rig; distinct waist wrap or retained stone/root body; original planted throw with visible held-rock release', 'throw':throw,'runtimeApproved':False,'finishedUnitApproved':False}
 arm['peris_fantasy_giant_quality']=json.dumps(record);arm['peris_licensed_head_credit']=json.dumps(credit);return record


def role_identity(arm,role,body,collection,race):
 gold=material(race+' aged warm precious trim',(.32,.24,.125) if race=='elf' else (.34,.13,.045),.75,.48)
 cloth=material(race+' role cloak woven cloth',(.045,.105,.063) if race=='elf' else (.17,.028,.020),0,.89,'cloth')
 h=arm.data.bones['head'].head_local+Vector((0,-.045,.17));chest=arm.data.bones['chest'].head_local
 if role in ['elite','heavy_cavalry'] and race=='elf':
  for side in [-1,1]:
   curve('Role-specific precious brow circlet',[h+Vector((side*.01,-.20,.16)),h+Vector((side*.14,-.19,.21)),h+Vector((side*.23,-.08,.23)),h+Vector((side*.23,.12,.18))],.014,arm,role,'prop-head',gold,collection)
   outline=[h+Vector((side*.15,-.14,.22)),h+Vector((side*.25,-.08,.41)),h+Vector((side*.26,-.07,.24))]
   mesh('Elite pointed leaf coronet',outline+ [p+Vector((0,.014,0)) for p in outline],[(0,1,2),(3,5,4),(0,3,4,1),(1,4,5,2),(2,5,3,0)],arm,role,'prop-head',gold,collection)
 if role in ['elite','heavy_cavalry'] and race=='demon':
  iron=material('Demon horn-clear worked warhelm',(.045,.035,.030),.78,.64)
  skull=next(o for o in collection.objects if o.get('peris_role')==role and o.get('peris_atlas_partition')=='licensed-demon-head')
  skull_tree=BVHTree.FromPolygons([v.co for v in skull.data.vertices],[tuple(p.vertices) for p in skull.data.polygons])
  skull_top=max(v.co.z for v in skull.data.vertices)
  def fit_helm(point):
   point=point.copy();point.z=min(point.z,skull_top-.016)
   hit=skull_tree.ray_cast(Vector((point.x,h.y-1.1,point.z)),Vector((0,1,0)),2.2)[0]
   if hit is not None:point.y=hit.y-.030
   return point
  # Open forehead/cheek shell leaves both rooted horn bases and ears free.
  outline=[h+Vector((-.22,-.20,.14)),h+Vector((-.16,-.20,.26)),h+Vector((0,-.23,.32)),h+Vector((.16,-.20,.26)),h+Vector((.22,-.20,.14)),h+Vector((0,-.24,.16))]
  outline=[fit_helm(p) for p in outline]
  o=mesh('Elite open horn-clear warhelm brow',outline+[p+Vector((0,.018,0)) for p in outline],[(0,1,2,3,4,5),(11,10,9,8,7,6)]+[(i,(i+1)%6,(i+1)%6+6,i+6) for i in range(6)],arm,role,'prop-head',iron,collection)
  o['peris_helmet_fit']='Open horn-root/ear cutouts; fitted forehead and cheek plates. Face/gaze remain exposed.'
  curve('Horn-clear helm substantial copper brow',[outline[0],outline[5],outline[4]],.012,arm,role,'prop-head',gold,collection)
  for side in [-1,1]:
   points=[h+Vector((side*.20,-.16,.15)),h+Vector((side*.24,-.08,.07)),h+Vector((side*.20,-.10,-.07)),h+Vector((side*.15,-.17,.00))]
   points=[fit_helm(p) for p in points]
   mesh('Demon warhelm fitted cheek guard',points+[p+Vector((0,.015,0)) for p in points],[(0,1,2,3),(7,6,5,4)]+[(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)],arm,role,'prop-head',iron,collection)
 if role=='scout':
  n=40;rows=16;verts=[];faces=[]
  for row in range(rows):
   latitude=-.68+row/(rows-1)*2.18
   for i in range(n):
    a=.74+i/(n-1)*(math.tau-1.48)
    verts.append(h+Vector((math.sin(a)*math.cos(latitude)*.30,-math.cos(a)*math.cos(latitude)*.28,.06+math.sin(latitude)*.36)))
  for row in range(rows-1):
   for i in range(n-1):faces.append((row*n+i,row*n+i+1,(row+1)*n+i+1,(row+1)*n+i))
  hood=mesh('Scout open fitted hood',verts,faces,arm,role,'prop-head',cloth,collection,smooth=True)
  wall=hood.modifiers.new('Woven hood thickness','SOLIDIFY');wall.thickness=.014;bpy.context.view_layer.objects.active=hood;hood.select_set(True);bpy.ops.object.modifier_move_up(modifier=wall.name);bpy.ops.object.modifier_apply(modifier=wall.name);hood.select_set(False)
  for side in [0,n-1]:curve('Hood sewn open face seam',[verts[row*n+side] for row in range(rows)],.009,arm,role,'prop-head',gold,collection)
 if role in []:
  width=.43 if role!='scout' else .35;top=chest.z+.34;bottom=chest.z-(.91 if role!='heavy_cavalry' else .70)
  verts=[Vector((x,.30+(.16 if z==bottom else 0),z)) for z in [top,bottom] for x in [-width,width]]
  cape=mesh('Distinct role split flowing mantle',verts,[(0,1,3,2)],arm,role,'chest',cloth,collection)
  thick=cape.modifiers.new('Woven mantle edge','SOLIDIFY');thick.thickness=.012;bpy.context.view_layer.objects.active=cape;cape.select_set(True);bpy.ops.object.modifier_move_up(modifier=thick.name);bpy.ops.object.modifier_apply(modifier=thick.name);cape.select_set(False)
  for side in [-1,1]:curve('Mantle precious sewn edge',[Vector((side*width,.30,top)),Vector((side*width,.46,bottom))],.008,arm,role,'chest',gold,collection)


def soft_cloth_kit(arm,role,body,collection,race):
 """Replace measured source garment regions, preserving limbs and source rig."""
 hip=arm.data.bones['hip'].head_local;chest=arm.data.bones['chest'].head_local
 bm=bmesh.new();bm.from_mesh(body.data);deform=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups};pending=set(bm.verts);remove=[]
 while pending:
  seed=pending.pop();component={seed};todo=[seed]
  while todo:
   for edge in todo.pop().link_edges:
    for other in edge.verts:
     if other in pending:pending.remove(other);component.add(other);todo.append(other)
  weights={}
  for v in component:
   for index,w in v[deform].items():weights[names[index]]=weights.get(names[index],0)+w/len(component)
  lo=Vector([min(v.co[i] for v in component) for i in range(3)]);hi=Vector([max(v.co[i] for v in component) for i in range(3)])
  skirt=len(component)<180 and weights.get('hip',0)>.999 and lo.z<hip.z-.22 and hi.z<hip.z+.22
  cape=len(component)<180 and weights.get('hip',0)+weights.get('chest',0)>.999 and lo.y>.08 and hi.z-lo.z>.55
  if skirt or cape:remove.extend(component)
 bmesh.ops.delete(bm,geom=remove,context='VERTS')
 # The original source tunic is part of the connected body, not a separate prop.
 # Restrict replacement to lower torso cloth, excluding every thigh/leg influence.
 garment=[]
 for f in bm.faces:
  p=f.calc_center_median();torso=sum(sum(w for index,w in v[deform].items() if names.get(index) in ['hip','spine','chest']) for v in f.verts)/len(f.verts)
  legs=sum(sum(w for index,w in v[deform].items() if names.get(index,'').startswith(('thigh','leg','foot','toe'))) for v in f.verts)/len(f.verts)
  if torso>.65 and legs<.15 and hip.z-.86<p.z<hip.z+.12 and abs(p.x)<.57:garment.append(f)
 count=len(garment);bmesh.ops.delete(bm,geom=garment,context='FACES');bm.to_mesh(body.data);bm.free();body.data.update()
 body['peris_replaced_lower_tunic_faces']=count
 color=(.047,.095,.055) if race=='elf' else (.165,.024,.018);cloth=material(race+' fitted draped folded woven cloth',color,0,.91,'cloth')
 gold=material(race+' sewn garment precious threads',(.26,.20,.10) if race=='elf' else (.24,.095,.035),.30,.74)
 n=96;rows=18;verts=[];uv=[];faces=[];length=.71 if race=='elf' else .47
 for row in range(rows):
  t=row/(rows-1);z=hip.z+.13-length*t
  for i in range(n):
   # Source long tunic is thigh-weighted, and its actual lower envelope reaches
   # X .53 / Y .425. Fit the outer coat beyond that retained surface.
   a=math.tau*i/n;fold=(.008+.027*t)*math.sin(a*12+.22*math.sin(t*math.pi));rx=.435+.170*t;ry=.370+.150*t
   verts.append(hip+Vector((math.sin(a)*(rx+fold),-math.cos(a)*(ry+fold),z-hip.z+.012*t*math.cos(a*5))))
   uv.append((i/n,t))
 for row in range(rows-1):
  for i in range(n):
   angle=(i+.5)/n*math.tau;front=min(angle,math.tau-angle)
   # Continuous overlapping front cloth prevents the older thigh-weighted
   # tunic from appearing through a false open coat slit.
   faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
 robe=mesh('Soft folded split role coat',verts,faces,arm,role,'hip',cloth,collection,uv=uv,smooth=True)
 thick=robe.modifiers.new('Real cloth hem thickness','SOLIDIFY');thick.thickness=.009;bpy.context.view_layer.objects.active=robe;robe.select_set(True);bpy.ops.object.modifier_move_up(modifier=thick.name);bpy.ops.object.modifier_apply(modifier=thick.name);robe.select_set(False)
 for offset in [.016,.045]:
  points=[Vector(p)+Vector((0,0,offset)) for p in verts[-n:]]
  curve('Double sewn cloth hem line',points+[points[0]],.0023,arm,role,'hip',gold,collection)
 if role=='catapult':
  body['peris_garment_changes']='Original folded waist wrap replaces old rigid blocks; torso and throwing arms remain exposed on the larger faction giant'
  return
 # Dense, softly folded mantle with chest-to-hip skin weights, not a rigid sheet.
 width=.40 if race=='elf' else .36;rows=22;cols=32;verts=[];uv=[];faces=[]
 for row in range(rows):
  t=row/(rows-1);z=chest.z+.22-(chest.z-hip.z+.84)*t;w=width+.12*t
  for i in range(cols):
   x=(i/(cols-1)*2-1)*w;fold=.025*math.sin(i/(cols-1)*math.pi*10+.4*t)*(.3+.7*t)
   verts.append(Vector((x,.28+.18*t+fold,z+.014*t*math.sin(i/(cols-1)*math.pi*6))));uv.append((i/(cols-1),t))
 for row in range(rows-1):
  for i in range(cols-1):faces.append((row*cols+i,row*cols+i+1,(row+1)*cols+i+1,(row+1)*cols+i))
 cape=mesh('Anatomically draped folded mantle',verts,faces,arm,role,'chest',cloth,collection,uv=uv,smooth=True)
 pelvis=cape.vertex_groups.new(name='hip');upper=cape.vertex_groups['chest']
 for row in range(rows):
  ids=list(range(row*cols,(row+1)*cols));t=row/(rows-1);upper.add(ids,1-t,'REPLACE');pelvis.add(ids,t,'REPLACE')
 thick=cape.modifiers.new('Woven mantle thickness','SOLIDIFY');thick.thickness=.009;bpy.context.view_layer.objects.active=cape;cape.select_set(True);bpy.ops.object.modifier_move_up(modifier=thick.name);bpy.ops.object.modifier_apply(modifier=thick.name);cape.select_set(False)
 for i in [0,cols-1]:curve('Mantle tailored hem stitch',[verts[row*cols+i] for row in range(rows)],.0025,arm,role,'chest',gold,collection)
 body['peris_garment_changes']='Measured rigid source skirt/cape and semantic lower torso tunic faces replaced with original UV-mapped folded coat/mantle; source limbs, rig and original file preserved'
