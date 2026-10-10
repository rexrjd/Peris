"""Separately credited head studies and original kit on copied fantasy rigs.

Only a caller-owned native clone is modified. Static head adaptation follows
existing prop-head; facial speech/expression animation is not supplied.
"""
import bpy,bmesh,json,hashlib,pathlib,math
import numpy as np
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
ROOT=pathlib.Path(__file__).resolve().parents[2]
_CACHE={}
_MATERIALS={}

def image(name,pixels,noncolor=False,alpha=False):
 h,w,_=pixels.shape;i=bpy.data.images.new(name,width=w,height=h,alpha=alpha)
 if noncolor:i.colorspace_settings.name='Non-Color'
 i.pixels.foreach_set(pixels.astype(np.float32).ravel());i.pack();return i

def material(name,color,metal=0,rough=.7,kind='metal'):
 if name in _MATERIALS:return _MATERIALS[name]
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 size=256;yy,xx=np.mgrid[:size,:size];rng=np.random.default_rng(sum(map(ord,name)));n=rng.normal(0,.016,(size,size))+.016*np.sin(xx*.19+yy*.11)
 if kind=='leather':n+=.025*np.sin(xx*.95)*np.sin(yy*.87)
 pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=np.clip(np.asarray(color)*(1+n[:,:,None]),0,1)
 tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image(name+' original grain albedo',pixels);m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
 if metal>0:
  scalar=np.ones_like(pixels);scalar[:,:,:3]=np.clip(rough+n[:,:,None]*1.8,.20,.95);tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image(name+' original roughness breakup',scalar,True);m.node_tree.links.new(tex.outputs['Color'],p.inputs['Roughness'])
 if metal>0 or (kind=='leather' and any(term in name.lower() for term in ['leather','woven','boots','gloves'])):
  height=.0020*np.sin(xx*.31)*np.sin(yy*.29) if metal>0 else .0030*np.sin(xx*.92)*np.sin(yy*.85)
  dy,dx=np.gradient(height);normal=np.stack((-dx*42,-dy*42,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2,keepdims=True);npixels=np.ones_like(pixels);npixels[:,:,:3]=normal*.5+.5
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image(name+' original hammered or woven tangent normal',npixels,True);node=m.node_tree.nodes.new('ShaderNodeNormalMap');m.node_tree.links.new(tex.outputs['Color'],node.inputs['Color']);m.node_tree.links.new(node.outputs['Normal'],p.inputs['Normal']);m['peris_original_surface']='Authored shallow tangent microrelief from deterministic height; no baked directional shadows or source normal replacement'
 _MATERIALS[name]=m
 return m

def mesh(name,verts,faces,arm,role,bone,mat,col,uv=None,smooth=True):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(role+' '+name,d);col.objects.link(o);o.parent=arm;o.matrix_basis=Matrix.Identity(4);o.matrix_parent_inverse=Matrix.Identity(4)
 mod=o.modifiers.new('Preserved real source rig','ARMATURE');mod.object=arm;g=o.vertex_groups.new(name=bone);g.add(list(range(len(verts))),1,'REPLACE');d.materials.append(mat);layer=d.uv_layers.new(name='PortraitUV')
 lo=Vector([min(v.co[i] for v in d.vertices) for i in range(3)]);hi=Vector([max(v.co[i] for v in d.vertices) for i in range(3)])
 for p in d.polygons:
  p.use_smooth=smooth
  axes=[i for i in range(3) if i!=max(range(3),key=lambda i:abs(p.normal[i]))];extent=max(hi[i]-lo[i] for i in axes)
  for li,vi in zip(p.loop_indices,p.vertices):
   v=d.vertices[vi].co;layer.data[li].uv=uv[vi] if uv else tuple(.5+(v[i]-(lo[i]+hi[i])*.5)/max(extent,1e-8)*.90 for i in axes)
 o['peris_dwarf_gnome_authored_uv']='Explicit eye UV' if uv else 'Bounded dominant-plane equipment projections; no source UV edits'
 o['peris_role']=role;o['asset_license']='CC-BY-SA-3.0';o['asset_author']='Peris original geometry; adapted Wildfire Games rig';o['original_peris_equipment']=True;o['runtime_approved']=False;o['peris_unit_finished']=False
 return o

def curve(name,points,radius,arm,role,bone,mat,col,sides=10):
 points=[Vector(p) for p in points];verts=[];faces=[]
 for j,p in enumerate(points):
  axis=(points[min(j+1,len(points)-1)]-points[max(j-1,0)]).normalized();a=axis.cross(Vector((0,0,1)) if abs(axis.z)<.9 else Vector((0,1,0))).normalized();b=axis.cross(a).normalized()
  for i in range(sides):verts.append(p+radius*(a*math.cos(i*math.tau/sides)+b*math.sin(i*math.tau/sides)))
 for j in range(len(points)-1):
  for i in range(sides):faces.append((j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i))
 faces.extend([tuple(range(sides-1,-1,-1)),tuple(range((len(points)-1)*sides,len(points)*sides))]);return mesh(name,verts,faces,arm,role,bone,mat,col)

def remove_head(body):
 names={g.index:g.name for g in body.vertex_groups}
 def key(p):return tuple(sorted(tuple(round(float(x),7) for x in body.data.vertices[i].co) for i in p.vertices))
 saved={key(p):{tuple(round(float(x),7) for x in body.data.vertices[vi].co):body.data.corner_normals[li].vector.copy() for li,vi in zip(p.loop_indices,p.vertices)} for p in body.data.polygons}
 bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active
 faces=[f for f in bm.faces if sum(sum(w for i,w in v[layer].items() if names.get(i) in ['head','prop-head']) for v in f.verts)/len(f.verts)>.55]
 count=len(faces);bmesh.ops.delete(bm,geom=faces,context='FACES');bm.to_mesh(body.data);bm.free();body.data.update()
 normals=[None]*len(body.data.loops)
 for p in body.data.polygons:
  own=saved[key(p)]
  for li,vi in zip(p.loop_indices,p.vertices):normals[li]=own[tuple(round(float(x),7) for x in body.data.vertices[vi].co)]
 if any(n is None for n in normals):raise ValueError('Source retained corner normal missing')
 body.data.normals_split_custom_set(normals);body.data.update();body['peris_retained_source_corner_normal_transport']='Exact retained face/vertex-coordinate matching after superseded head-only face removal'
 return count

def _crop(obj,test):
 bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.delete(bm,geom=[v for v in bm.verts if not test(v.co)],context='VERTS');bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000003);bm.to_mesh(obj.data);bm.free();obj.data.update()

def _decimate(obj,target):
 obj.data.calc_loop_triangles();count=len(obj.data.loop_triangles)
 if count<=target:return
 bpy.context.view_layer.objects.active=obj;bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
 mod=obj.modifiers.new('Copied source head-only bounded reduction','DECIMATE');mod.ratio=target/count;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name);obj.select_set(False)

def _join(parts,name):
 bpy.ops.object.select_all(action='DESELECT')
 for o in parts:o.select_set(True)
 bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();o=parts[0];o.name=name;return o

def _templates(faction):
 if faction in _CACHE:return _CACHE[faction]
 slug='blacksmith-body-kit' if faction=='dwarf' else 'gnome-face-hair-sculpt';source=ROOT/f'assets/references/units/downloads/{faction}/{slug}/reference.glb';metadata=json.loads((source.parent/'SOURCE.json').read_text(encoding='utf-8-sig'))
 sha=hashlib.sha256(source.read_bytes()).hexdigest()
 if sha!=metadata['sha256']:raise ValueError('Cached credited source changed')
 old=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(source));imported=[o for o in bpy.data.objects if o not in old];parts=[]
 for o in imported:
  if o.type=='MESH':o.data=o.data.copy();o.data.transform(o.matrix_world);o.matrix_world=Matrix.Identity(4)
 if faction=='dwarf':
  terms=['Body_low','Eyes_low','Hair_low','Braid1_low','Braid2_low','Braid3_low','BraidEnds_low']
  for o in imported:
   if o.type!='MESH' or not any(o.name.startswith(t) for t in terms):continue
   if o.name.startswith('Body_low'):_crop(o,lambda v:v.z>1.485 and abs(v.x)<.16 and v.y<.205)
   _decimate(o,2000 if o.name.startswith('Body_low') else 1700);parts.append(o)
 else:
  skin=[o for o in imported if o.type=='MESH' and o.data.materials[0].name=='Material'];head=_join(skin,'Credited Gnome face source');_crop(head,lambda v:v.z>.31);_decimate(head,6500)
  # Preserve connected original skull/nose; warm paint uses new cylindrical UV.
  mat=material('Gnome warm face paint',(.47,.31,.20),rough=.76,kind='leather');head.data.materials.clear();head.data.materials.append(mat)
  for a in list(head.data.color_attributes):head.data.color_attributes.remove(a)
  uv=head.data.uv_layers.active or head.data.uv_layers.new(name='GnomeFaceUV')
  for p in head.data.polygons:
   p.use_smooth=True
   for li,vi in zip(p.loop_indices,p.vertices):
    v=head.data.vertices[vi].co;uv.data[li].uv=(.5+math.atan2(v.x,-v.y)/math.tau,(v.z-.31)/1.03)
  # Original short beard finish follows the actual connected jaw surface.
  # A former cropped source-hair fringe was rejected as severed geometry.
  size=1024;yy,xx=np.mgrid[:size,:size];u=(xx+.5)/size;v=(yy+.5)/size;z=.31+v*1.03;angle=(u-.5)*math.tau
  shade=1+.020*np.sin(xx*.31+yy*.27)+.008*np.sin(xx*2.33);pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=np.asarray((.47,.31,.20))*shade[:,:,None]
  front=np.abs(angle)<1.23;limit=.72+.08*np.abs(np.sin(angle));beard=front&(z<limit)&(z>.40)
  pixels[beard,:3]=np.asarray((.067,.037,.019))*(.87+.08*np.sin(xx[beard]*.61+yy[beard]*.07))[:,None]
  texture=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE');texture.image=image('Gnome source-coordinate fitted short beard paint',pixels)
  for vertex in head.data.vertices:
   p=vertex.co;frontness=max(0,min(1,(-p.y-.05)/.20));mass=sum(math.exp(-((p.x-side*.10)/.064)**2-((p.z-1.034)/.040)**2) for side in [-1,1]);p.y-=.020*mass*frontness
  head.data.update();parts.append(head)
 for o in list(bpy.data.objects):
  if o not in old and o not in parts:bpy.data.objects.remove(o,do_unlink=True)
 for o in parts:
  for col in list(o.users_collection):col.objects.unlink(o)
  o.hide_render=True
 credit={'author':metadata['creator'],'license':'CC-BY-4.0','licenseUrl':metadata['licenseUrl'],'sourceUrl':metadata['url'],'sourceFileSha256':sha,'changes':'Head-only crop, fitted to existing source prop-head; copied head surface reduction. Original Dwarf texture/UV maps retained. Gnome connected source skull/nose with modest original brow mass, generated UV and original warm face/short-beard paint; source floor-length hair excluded after actual review. No source rig or file edits.','runtimeApproved':False,'finishedUnitApproved':False}
 _CACHE[faction]=(parts,credit);return parts,credit

def apply_head(arm,role,body,col,faction):
 removed=remove_head(body);templates,credit=_templates(faction);h=arm.data.bones['head'].head_local.copy();parts=[]
 source_center=Vector((0,-.015,1.60)) if faction=='dwarf' else Vector((0,-.12,.95));scale=Vector((1.72,1.68,1.72)) if faction=='dwarf' else Vector((.88,.83,.85));center=h+Vector((0,-.025,.18))
 transform=Matrix.Translation(center)@Matrix.Diagonal((*scale,1))@Matrix.Translation(-source_center)
 for template in templates:
  o=bpy.data.objects.new(role+' '+faction+' adapted '+template.name,template.data.copy());col.objects.link(o);o.hide_render=False;o.data.transform(transform);o.parent=arm;o.matrix_basis=Matrix.Identity(4);o.matrix_parent_inverse=Matrix.Identity(4);o.vertex_groups.clear();g=o.vertex_groups.new(name='prop-head');g.add(list(range(len(o.data.vertices))),1,'REPLACE');mod=o.modifiers.new('Existing real source head','ARMATURE');mod.object=arm
  o['peris_role']=role;o['asset_license']='CC-BY-4.0';o['asset_author']=credit['author']+'; Peris head-only fitting';o['source_url']=credit['sourceUrl'];o['source_file_sha256']=credit['sourceFileSha256'];o['peris_component_credit']=json.dumps(credit);o['peris_atlas_partition']='licensed-'+faction+'-head';o['runtime_approved']=False;o['peris_unit_finished']=False;o['original_peris_equipment']=False;parts.append(o)
 arm['peris_licensed_head_credit']=json.dumps(credit);arm['peris_dwarf_gnome_head_fit']=json.dumps({'role':role,'faction':faction,'removedSupersededHeadFaces':removed,'transform':[list(r) for r in transform],'credit':credit})
 if faction=='gnome':
  _gnome_eyes(arm,role,col,templates[0],transform,parts[0].data.materials[0]);_gnome_facial_detail(arm,role,col,templates[0],transform)
 return {'parts':parts,'credit':credit,'removedFaces':removed,'center':center,'transform':transform}

def _gnome_eyes(arm,role,col,source,transform,skin):
 tree=BVHTree.FromPolygons([v.co for v in source.data.vertices],[tuple(p.vertices) for p in source.data.polygons]);eye=material('Gnome continuous warm eye and brown iris',(.31,.26,.18),rough=.50);lid_skin=material('Gnome original warm orbital lid skin',(.47,.31,.20),rough=.76,kind='leather')
 if not eye.get('painted_iris'):
  size=512;yy,xx=np.mgrid[:size,:size];u=(xx+.5)/size;v=(yy+.5)/size;r=np.sqrt(((u-.5)*math.tau)**2+((v-.5)*math.pi)**2);pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=(.31,.26,.18);pixels[r<.48,:3]=(.11,.061,.023);pixels[r<.21,:3]=(.007,.009,.006)
  texture=next(n for n in eye.node_tree.nodes if n.type=='TEX_IMAGE');texture.image=image('Gnome iris in real eye UV',pixels);eye['painted_iris']=True
 for side in [-1,1]:
  hit=tree.ray_cast(Vector((side*.105,-2,.990)),Vector((0,1,0)),4)[0]
  if hit is None:raise ValueError('Measured Gnome eye surface missing')
  # The eye is mostly embedded in the measured skull, rather than a bead
  # placed in front of it. Only the shallow frontal cap is exposed.
  center=hit+Vector((0,.010,0));verts=[];faces=[];uv=[];n=32;rings=17
  for j in range(rings):
   lat=-math.pi/2+j/(rings-1)*math.pi
   for i in range(n):
    a=(i/n-.5)*math.tau;verts.append(transform@(center+Vector((math.sin(a)*math.cos(lat)*.046,-math.cos(a)*math.cos(lat)*.028,math.sin(lat)*.024))));uv.append((i/n,j/(rings-1)))
  for j in range(rings-1):
   for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
  mesh('Gnome measured seated eye '+str(side),verts,faces,arm,role,'prop-head',eye,col,uv)
  for upper in [True,False]:
   points=[]
   for t in np.linspace(-1,1,19):
    z=(.009*(1-t*t)+side*t*.004 if upper else -.009*(1-t*t));points.append(transform@(center+Vector((t*.048,-.029,z))))
   curve('Gnome actual orbital lid '+str(side)+' '+str(upper),points,.0048,arm,role,'prop-head',lid_skin,col)

def _gnome_facial_detail(arm,role,col,source,transform):
 tree=BVHTree.FromPolygons([v.co for v in source.data.vertices],[tuple(p.vertices) for p in source.data.polygons]);hair=material('Gnome original short worked brown beard',(.105,.057,.029),rough=.91,kind='leather');skin=material('Gnome original warm orbital lid skin',(.47,.31,.20),rough=.76,kind='leather')
 def surface(x,z):
  hit=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)),4)[0]
  return hit+Vector((0,-.003,0)) if hit else None
 for i in range(24):
  x=(i/23*2-1)*.145;z=.66+.045*abs(x/.145);points=[surface(x,z),surface(x*.96,z-.060),surface(x*.91,z-.105)]
  if all(p is not None for p in points):curve('Gnome fitted short individual beard strand',list(map(lambda p:transform@p,points)),.0060,arm,role,'prop-head',hair,col,6)
 for side in [-1,1]:
  points=[surface(side*(.068+.013*i),1.035+.009*math.sin(i/6*math.pi)) for i in range(7)]
  if all(p is not None for p in points):curve('Gnome original fitted expressive eyebrow',list(map(lambda p:transform@(p+Vector((0,-.003,0))),points)),.0075,arm,role,'prop-head',hair,col,8)
  # Original broad ears meet the measured source skull surface.
  root=tree.ray_cast(Vector((side*2,-.015,1.01)),Vector((-side,0,0)),4)[0]
  if root:
   profile=[Vector((0,0,-.055)),Vector((side*.09,-.025,-.035)),Vector((side*.135,-.005,.045)),Vector((side*.075,.015,.10)),Vector((0,.01,.065))];vs=[transform@(root+p) for p in profile]+[transform@(root+Vector((side*.045,-.038,.02)))];mesh('Gnome original broad connected ear '+str(side),vs,[(i,(i+1)%5,5) for i in range(5)],arm,role,'prop-head',skin,col)

def apply_headgear(arm,role,col,faction,fit):
 h=fit['center'];iron=material(faction+' charcoal forged iron',(.07,.079,.085),.75,.64);trim=material(faction+' aged copper brass edges',(.34,.19,.075),.8,.43);cloth=material(faction+' burgundy leather',(.15,.027,.025),rough=.88,kind='leather')
 if faction=='dwarf':
  n=32;verts=[];faces=[]
  for z,r in [(.13,.23),(.27,.235),(.45,.16),(.49,.005)]:
   for i in range(n):
    a=i*math.tau/n;verts.append(h+Vector((math.sin(a)*r,math.cos(a)*r*.88,z)))
  for j in range(3):
   for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
  mesh('Open forged Dwarf helmet with continuous dome',verts,faces,arm,role,'prop-head',cloth if role in ['archer','scout'] else iron,col)
  curve('Dwarf substantial copper helmet brow',[h+Vector((math.sin(a)*.238,math.cos(a)*.210,.17)) for a in np.linspace(0,math.tau,49)],.016,arm,role,'prop-head',trim,col)
  curve('Dwarf swept top copper helmet ridge',[h+Vector((0,-.21,.18)),h+Vector((0,-.12,.43)),h+Vector((0,0,.50)),h+Vector((0,.12,.43)),h+Vector((0,.20,.18))],.013,arm,role,'prop-head',trim,col)
  c=h+Vector((0,-.228,.20));mesh('Dwarf raised angular brow rune',[c+Vector((0,-.01,.10)),c+Vector((-.045,0,0)),c+Vector((0,-.012,-.06)),c+Vector((.045,0,0)),c+Vector((0,-.030,.02))],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],arm,role,'prop-head',trim,col)
  if role=='elite':
   for x in [-.16,-.08,0,.08,.16]:
    c=h+Vector((x,-.20,.32));mesh('Dwarf elite angular copper crown tine',[c+Vector((-.038,0,0)),c+Vector((.038,0,0)),c+Vector((0,0,.16 if abs(x)<.01 else .11)),c+Vector((0,-.022,.04))],[(0,1,3),(1,2,3),(2,0,3),(2,1,0)],arm,role,'prop-head',trim,col,smooth=False)
  elif role=='heavy_cavalry':
   for side in [-1,1]:
    c=h+Vector((side*.20,-.01,.13));mesh('Dwarf mounted fitted helmet cheek guard',[c+Vector((0,-.08,0)),c+Vector((0,.08,0)),c+Vector((side*.025,.06,-.17)),c+Vector((side*.025,-.065,-.17))],[(0,1,2,3)],arm,role,'prop-head',iron,col,smooth=False)
 else:
  n=40;verts=[];faces=[]
  for z,rx,ry in [(.12,.255,.22),(.25,.28,.24),(.46,.20,.15),(.49,.015,.015)]:
   for i in range(n):a=i*math.tau/n;verts.append(h+Vector((math.sin(a)*rx+.035*max(0,z-.12),math.cos(a)*ry,z)))
  for j in range(3):
   for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
  mesh('Gnome fitted folded burgundy engineer cap',verts,faces,arm,role,'prop-head',cloth,col)
  curve('Gnome leather cap binding',[h+Vector((math.sin(a)*.258,math.cos(a)*.223,.145)) for a in np.linspace(0,math.tau,49)],.014,arm,role,'prop-head',trim,col)
  lens=material('Gnome seated pale blue glass',(.22,.36,.40),metal=.16,rough=.26)
  for side in [-1,1]:
   c=h+Vector((side*.115,-.285,.28));points=[c+Vector((math.sin(a)*.068,-.005,math.cos(a)*.067)) for a in np.linspace(0,math.tau,33)];curve('Gnome substantial circular brass goggle rim',points,.014,arm,role,'prop-head',trim,col)
   vs=[c+Vector((0,-.008,0))]+[c+Vector((math.sin(a)*.060,-.008,math.cos(a)*.060)) for a in np.linspace(0,math.tau,33)];mesh('Gnome continuous goggle glass lens',vs,[(0,i,i+1) for i in range(1,33)],arm,role,'prop-head',lens,col)
  curve('Gnome goggle leather bridge',[h+Vector((-.04,-.285,.28)),h+Vector((.04,-.285,.28))],.016,arm,role,'prop-head',trim,col)
  if role=='elite':
   curve('Gnome elite engineer cap brass protective crest',[h+Vector((0,-.22,.25)),h+Vector((0,-.11,.48)),h+Vector((0,.03,.52)),h+Vector((0,.17,.34))],.018,arm,role,'prop-head',trim,col)
 return {'originalHeadgear':faction,'shape':'Open fitted helmet/engineer cap, substantial rim and raised device; no Roman helmet retained','runtimeApproved':False}

def _delete_polygons(body,indices):
 def key(p):return tuple(sorted(tuple(round(float(x),7) for x in body.data.vertices[i].co) for i in p.vertices))
 saved={key(p):{tuple(round(float(x),7) for x in body.data.vertices[vi].co):body.data.corner_normals[li].vector.copy() for li,vi in zip(p.loop_indices,p.vertices)} for p in body.data.polygons if p.index not in indices}
 bm=bmesh.new();bm.from_mesh(body.data);bm.faces.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.faces[i] for i in indices],context='FACES');bm.to_mesh(body.data);bm.free();body.data.update();normals=[None]*len(body.data.loops)
 for p in body.data.polygons:
  own=saved[key(p)]
  for li,vi in zip(p.loop_indices,p.vertices):normals[li]=own[tuple(round(float(x),7) for x in body.data.vertices[vi].co)]
 body.data.normals_split_custom_set(normals);body.data.update()

def remove_superseded_kit(body,role):
 """Only complete isolated rigid kit islands; continuous source body stays."""
 names={g.index:g.name for g in body.vertex_groups};adj={i:set() for i in range(len(body.data.vertices))}
 for e in body.data.edges:a,b=e.vertices;adj[a].add(b);adj[b].add(a)
 pending=set(adj);remove=set();records=[]
 while pending:
  stack=[pending.pop()];ids=[]
  while stack:
   i=stack.pop();ids.append(i)
   for j in adj[i]:
    if j in pending:pending.remove(j);stack.append(j)
  weights={}
  for i in ids:
   for w in body.data.vertices[i].groups:weights[names[w.group]]=weights.get(names[w.group],0)+w.weight/len(ids)
  if not weights:continue
  bone,amount=max(weights.items(),key=lambda p:p[1]);selected=amount>.999 and len(ids)<400 and bone in ['chest','shoulder_L','shoulder_R','arm_L','arm_R','forearm_L','forearm_R']
  if role!='archer' and amount>.999 and bone in ['prop-weapon_R','prop-shield']:selected=True
  if selected:remove.update(ids);records.append({'vertices':len(ids),'bone':bone,'meanWeight':amount})
 indices={p.index for p in body.data.polygons if all(i in remove for i in p.vertices)};_delete_polygons(body,indices);return {'removedIsolatedRigidKit':records,'removedFaces':len(indices),'continuousMixedWeightBodyRemoved':False}

def apply_closed_hands(arm,role,body,col,faction):
 import types,dwarf_gnome_hands as hands
 if role=='archer':return {'preservedArticulatedSourceBowHands':True}
 names={g.index:g.name for g in body.vertex_groups};indices=set()
 for p in body.data.polygons:
  weight=sum(w.weight for i in p.vertices for w in body.data.vertices[i].groups if names[w.group].startswith(('hand_','finger_','fingertip_','prop_glove_hand','prop_glove_finger')))/len(p.vertices)
  if weight>.58:indices.add(p.index)
 _delete_polygons(body,indices);body['peris_dwarf_gnome_source_body']=True
 glove=material(faction+' fitted dark worked leather gloves',(.077,.048,.030),rough=.88,kind='leather');lib=types.SimpleNamespace(groups={role:[body]},faction=faction)
 def register(obj,arm,role,bone,skin):
  for c in list(obj.users_collection):c.objects.unlink(obj)
  col.objects.link(obj);obj.name=role+' '+faction+' connected fitted '+bone+' glove';obj.parent=arm;obj.matrix_basis=Matrix.Identity(4);obj.matrix_parent_inverse=Matrix.Identity(4);mod=obj.modifiers.new('Real unchanged hand rig','ARMATURE');mod.object=arm;obj.data.materials.clear();obj.data.materials.append(skin);group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE');return obj
 created=hands.build_portrait_closed_hands(lib,arm,role,glove,{'mesh_prop':register},grip_radii={'R':.043 if faction=='gnome' else .053,'L':.043 if faction=='gnome' else .053})
 return {'removedSupersededHandFaces':len(indices),'originalGloves':[{'name':o.name,'report':json.loads(o['peris_hand_construction_report'])} for o in created],'sourceRigAndClipsChanged':False}

def apply_armor(arm,role,body,col,faction):
 iron=material(faction+' worked charcoal iron plate',(.092,.105,.113) if faction=='dwarf' else (.11,.09,.055),.78,.61);trim=material(faction+' exposed worked copper brass',(.38,.22,.091) if faction=='dwarf' else (.42,.28,.10),.8,.43);leather=material(faction+' layered black quilted leather',(.059,.036,.024),rough=.88,kind='leather')
 heavy=role in ['elite','heavy_cavalry'];light=role in ['archer','scout'];names={g.index:g.name for g in body.vertex_groups};matrix=arm.matrix_world.inverted()@body.matrix_world
 # Refinish the retained source garment and boot faces, selected by real
 # skin groups. Their UVs, topology, custom normals and weights stay intact.
 garment=material(faction+' retained source dark woven garment',(.075,.045,.029) if faction=='dwarf' else (.11,.038,.028),rough=.91,kind='leather');body.data.materials.append(garment);gi=len(body.data.materials)-1
 boot=material(faction+' retained source worked leather boots',(.047,.031,.025),rough=.89,kind='leather');body.data.materials.append(boot);bi=len(body.data.materials)-1
 for p in body.data.polygons:
  totals={}
  for vi in p.vertices:
   for w in body.data.vertices[vi].groups:totals[names[w.group]]=totals.get(names[w.group],0)+w.weight/len(p.vertices)
  if sum(w for n,w in totals.items() if n.startswith('foot_'))>.60:p.material_index=bi
  elif sum(w for n,w in totals.items() if n in ['chest','spine','spine1','hip'] or n.startswith(('leg_','thigh_')))>.60:p.material_index=gi
 verts=[matrix@v.co for v in body.data.vertices];faces=[tuple(p.vertices) for p in body.data.polygons if sum(w.weight for i in p.vertices for w in body.data.vertices[i].groups if names[w.group] in ['chest','spine','spine1','hip'])/len(p.vertices)>.45];tree=BVHTree.FromPolygons(verts,faces)
 neck=arm.data.bones['neck'].head_local;hip=arm.data.bones['hip'].head_local;top=neck.z-.17;bottom=hip.z+.32;width=.42 if faction=='dwarf' else .33
 def at(x,z,extra=0):
  hit=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)),4)[0];return Vector((x,(hit.y if hit else -.28)-.035-extra,z))
 # One continuous quilted under-vest, with fitted overlapping forged lames.
 rows=13;cols=15;vs=[at((i/(cols-1)*2-1)*width,top+(bottom-top)*j/(rows-1)) for j in range(rows) for i in range(cols)];fs=[(j*cols+i,j*cols+i+1,(j+1)*cols+i+1,(j+1)*cols+i) for j in range(rows-1) for i in range(cols-1)];mesh('Fitted continuous quilted under-vest',vs,fs,arm,role,'chest',leather,col)
 if not light:
  count=5 if heavy else 4 if faction=='dwarf' else 3
  for row in range(count):
   z0=top+(bottom-top)*row/count;z1=top+(bottom-top)*(row+1)/count-.025;w=width*(.94 if faction=='dwarf' else .86);vs=[at((i/12*2-1)*w,z0+(z1-z0)*j/3,.027) for j in range(4) for i in range(13)];fs=[(j*13+i,j*13+i+1,(j+1)*13+i+1,(j+1)*13+i) for j in range(3) for i in range(12)]
   o=mesh('Overlapping forged portrait chest lame '+str(row),vs,fs,arm,role,'chest',iron,col,smooth=False);solid=o.modifiers.new('Closed genuine forged thickness','SOLIDIFY');solid.thickness=.022;bpy.context.view_layer.objects.active=o;while_index=list(o.modifiers).index(solid)
   for _ in range(while_index):bpy.ops.object.modifier_move_up(modifier=solid.name)
   bpy.ops.object.modifier_apply(modifier=solid.name);curve('Chest lame exposed copper lower bevel',vs[-13:],.009,arm,role,'chest',trim,col)
 else:
  for side in [-1,1]:curve('Light crossed quilted leather harness',[at(side*width*.8,top,.025),at(0,(top+bottom)*.5,.035),at(-side*width*.8,bottom,.025)],.030,arm,role,'chest',trim,col)
 for side in [-1,1]:
  points=[at(side*width,top,.015),at(side*width*.98,(top+bottom)*.5,.015),at(side*width*.94,bottom,.015)];curve('Substantial fitted vest edge binding',points,.014,arm,role,'chest',trim,col)
  if not light:
   bone='arm_'+('L' if side>0 else 'R');c=arm.data.bones[bone].head_local;vs=[];fs=[];n=12
   for j in range(6):
    phi=j/5*math.pi*.60;r=max(.004,math.sin(phi)*(.22 if faction=='dwarf' else .18));z=math.cos(phi)*.18
    for i in range(n):a=i/n*math.tau;vs.append(c+Vector((math.cos(a)*r+side*.02,math.sin(a)*r,z)))
   for j in range(5):
    for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
   fs.append(tuple(range(n-1,-1,-1)))
   o=mesh('Closed fitted angular forged shoulder shell',vs,fs,arm,role,bone,iron,col,smooth=False);solid=o.modifiers.new('Closed forged shoulder thickness','SOLIDIFY');solid.thickness=.022;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_move_up(modifier=solid.name);bpy.ops.object.modifier_apply(modifier=solid.name);curve('Shoulder substantial copper outer rim',vs[-n:]+[vs[-n]],.014,arm,role,bone,trim,col)
  fore=arm.data.bones['forearm_'+('L' if side>0 else 'R')];axis=(fore.tail_local-fore.head_local).normalized();a=axis.cross(Vector((0,0,1)) if abs(axis.z)<.9 else Vector((0,1,0))).normalized();b=axis.cross(a).normalized();vs=[];fs=[];n=20
  for j,t in enumerate([.46,.53,.80,.94]):
   c=fore.head_local.lerp(fore.tail_local,t);r=[.147,.155,.140,.132][j]
   for i in range(n):ang=i/n*math.tau;vs.append(c+(a*math.cos(ang)+b*math.sin(ang))*r)
  for j in range(3):
   for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
  mesh('Fitted worked anatomical forearm bracer',vs,fs,arm,role,fore.name,leather if light else iron,col);curve('Bracer copper wrist binding',vs[-n:]+[vs[-n]],.009,arm,role,fore.name,trim,col)
 # A genuine closed belt and separate thigh-mounted tassets cover the waist
 # without turning the retained flexible pants into a rigid skirt tube.
 n=28;vs=[];fs=[];rx=width*1.06;ry=.255 if faction=='dwarf' else .225
 for z in [.17,.28]:
  for i in range(n):a=i/n*math.tau;vs.append(hip+Vector((math.sin(a)*rx,math.cos(a)*ry,z)))
 for i in range(n):fs.append((i,(i+1)%n,n+(i+1)%n,n+i))
 mesh('Closed substantial worked waist belt',vs,fs,arm,role,'hip',leather,col)
 curve('Waist belt exposed copper upper binding',vs[n:]+[vs[n]],.012,arm,role,'hip',trim,col)
 c=hip+Vector((0,-ry-.012,.225));mesh('Dimensional angular clan belt buckle',[c+Vector((-.075,0,0)),c+Vector((0,0,.065)),c+Vector((.075,0,0)),c+Vector((0,0,-.065)),c+Vector((0,-.025,0))],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],arm,role,'hip',trim,col,smooth=False)
 if not light:
  for side in [-1,1]:
   thigh=arm.data.bones['thigh_'+('L' if side>0 else 'R')];c=thigh.head_local+Vector((side*.06,-.21,-.14));w=.13 if faction=='dwarf' else .10
   vs=[c+Vector((x,y,z)) for y in [0,-.026] for x,z in [(-w,.18),(-w*.88,-.18),(0,-.23),(w*.88,-.18),(w,.18)]];mesh('Separate articulated angular thigh tasset',vs,[(4,3,2,1,0),(5,6,7,8,9)]+[(i,(i+1)%5,(i+1)%5+5,i+5) for i in range(5)],arm,role,thigh.name,iron,col,smooth=False)
   curve('Thigh tasset copper lower edge',[vs[6],vs[7],vs[8]],.008,arm,role,thigh.name,trim,col)
  # Shin surfaces are ray-fitted to the retained source pants and stop before
  # the ankle joint, leaving the independent foot deformation intact.
  alltree=BVHTree.FromPolygons(verts,[tuple(p.vertices) for p in body.data.polygons])
  for side in [-1,1]:
   leg=arm.data.bones['leg_'+('L' if side>0 else 'R')];vs=[];fs=[];n=7
   for j,t in enumerate([.30,.38,.68,.86]):
    c=leg.head_local.lerp(leg.tail_local,t);w=(.15 if faction=='dwarf' else .095)*[.93,1,.86,.72][j]
    for i in range(n):
     x=c.x+(i/(n-1)*2-1)*w;hit=alltree.ray_cast(Vector((x,-2,c.z)),Vector((0,1,0)),4)[0];vs.append(Vector((x,(hit.y if hit else c.y-.16)-.027-.008*(1-abs(i/(n-1)*2-1)),c.z)))
   for j in range(3):
    for i in range(n-1):fs.append((j*n+i,j*n+i+1,(j+1)*n+i+1,(j+1)*n+i))
   o=mesh('Ray-fitted shaped iron shin plate',vs,fs,arm,role,leg.name,iron,col,smooth=False);solid=o.modifiers.new('Genuine shin plate thickness','SOLIDIFY');solid.thickness=.016;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_move_up(modifier=solid.name);bpy.ops.object.modifier_apply(modifier=solid.name);curve('Shin plate substantial exposed copper toe edge',vs[-n:],.008,arm,role,leg.name,trim,col)
 # Small raised fitted clan marks add actual metalwork instead of painted light.
 if faction=='dwarf' and not light:
  z=(top+bottom)*.51
  for side in [-1,1]:
   x=side*width*.40;curve('Dwarf geometric engraved copper chest rune',[at(x-.032,z+.070,.061),at(x,z+.030,.061),at(x+.032,z+.070,.061),at(x,z+.030,.061),at(x,z-.065,.061)],.005,arm,role,'chest',trim,col,6)
 elif faction=='gnome' and not light:
  c=at(0,(top+bottom)*.54,.061);points=[]
  for i in range(49):a=i/48*math.tau;r=.064 if i%4 in [0,1] else .053;points.append(c+Vector((math.sin(a)*r,-.003,math.cos(a)*r)))
  curve('Gnome actual dimensional guild gear chest device',points,.006,arm,role,'chest',trim,col,6)
 return {'race':faction,'role':role,'coverage':'Ray-fitted continuous under-vest, role-dependent thick lames/shoulders, fitted forearm shells; healthy continuous source body retained','heavy':heavy,'light':light}

def _hand_space(arm,side):return arm.data.bones['hand_'+side].matrix_local

def apply_siege_finish(col,faction):
 """Bounded faction kit on the preserved siege rigs and control clips."""
 operations=[]
 if faction=='dwarf':
  role='catapult';body=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role);arm=next(m.object for m in body.modifiers if m.type=='ARMATURE');fit=apply_head(arm,role,body,col,faction);copies={}
  for o in fit['parts']:
   if o.name.endswith('Eyes_low_M_Skin_0'):
    eye=material('Dwarf carved statue restrained amber eye',(.30,.13,.026),rough=.64);o.data.materials.clear();o.data.materials.append(eye);continue
   for i,source in enumerate(list(o.data.materials)):
    if source not in copies:
     mat=source.copy();mat.name='Dwarf runestone '+source.name;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Metallic'].default_value=0
     for link in list(p.inputs['Metallic'].links):mat.node_tree.links.remove(link)
     for link in list(p.inputs['Roughness'].links):mat.node_tree.links.remove(link)
     p.inputs['Roughness'].default_value=.88
     tex=p.inputs['Base Color'].links[0].from_node if p.inputs['Base Color'].is_linked else None
     if tex and tex.type=='TEX_IMAGE':
      w,h=tex.image.size;pixels=np.empty(w*h*4,np.float32);tex.image.pixels.foreach_get(pixels);pixels=pixels.reshape(h,w,4);luma=pixels[:,:,:3]@np.asarray((.2126,.7152,.0722));pixels[:,:,:3]=np.clip(np.asarray((.25,.28,.30))*(.50+1.10*luma[:,:,None]),0,1);tex.image=image('Dwarf original runestone adaptation '+source.name,pixels,alpha=True)
     else:p.inputs['Base Color'].default_value=(.25,.28,.30,1)
     copies[source]=mat
    o.data.materials[i]=copies[source]
   credit=json.loads(o['peris_component_credit']);credit['changes']+=' Runestone colossus derivative: original source skin/beard albedo converted to worn granite while retaining source UV and tangent normal detail; rough nonmetal statue surface, restrained amber source eye surface.';o['peris_component_credit']=json.dumps(credit)
  arm['peris_licensed_head_credit']=fit['parts'][0]['peris_component_credit'];trim=material('dwarf exposed worked copper brass',(.38,.22,.091),.8,.43);hide=material('dwarf layered black quilted leather',(.059,.036,.024),rough=.88,kind='leather');hip=arm.data.bones['hip'].head_local;chest=arm.data.bones['chest'].head_local
  for side in [-1,1]:
   x=side*.22;curve('Runestone colossus raised angular clan chest rune',[chest+Vector((x-.07,-.38,.26)),chest+Vector((x,-.39,.17)),chest+Vector((x+.07,-.38,.26)),chest+Vector((x,-.39,.17)),chest+Vector((x,-.38,-.12))],.018,arm,role,'chest',trim,col,8)
  n=16;vs=[];fs=[]
  for z,r in [(.09,.39),(-.12,.44),(-.40,.43)]:
   for i in range(n):a=i/n*math.tau;vs.append(hip+Vector((math.sin(a)*r,math.cos(a)*r*.76,z)))
  for j in range(2):
   for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
  mesh('Runestone distinct continuous aged leather waist wrap',vs,fs,arm,role,'hip',hide,col)
  operations.append({'role':role,'headCredit':json.loads(arm['peris_licensed_head_credit']),'kit':'Detailed source Dwarf statue face/braids, carved copper clan runes, continuous aged waist wrap; preserved existing rock/hand support and three source clips','sourceBonesActionsAndRockBindingChanged':False})
 # Refinish actual siege structural faces selected by stable source bone
 # ownership. Existing wheel/throw/grip topology and bindings are retained.
 for role in ['ram','catapult']:
  if role=='catapult' and faction=='dwarf':continue
  body=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role);arm=next(m.object for m in body.modifiers if m.type=='ARMATURE');names={g.index:g.name for g in body.vertex_groups};trim=material(faction+' exposed worked copper brass',(.38,.22,.091) if faction=='dwarf' else (.42,.28,.10),.8,.43);count=0;body.data.materials.append(trim);mi=len(body.data.materials)-1
  for p in body.data.polygons:
   wheel=sum(w.weight for i in p.vertices for w in body.data.vertices[i].groups if 'wheel' in names[w.group].lower())/len(p.vertices)
   if wheel>.95:p.material_index=mi;count+=1
  operations.append({'role':role,'kit':'Worked faction copper/brass finish on actual wheel-owned structural faces, source wood/hide frame and machine geometry preserved','actualWheelPolygonsRefinished':count,'sourceBonesAndActionsChanged':False})
 return operations

def apply_weapons(arm,role,col,faction):
 if role=='archer':return {'preservedHealthySourceArticulatedBowQuiverAndArrow':True}
 iron=material(faction+' worked charcoal iron plate',(.092,.105,.113) if faction=='dwarf' else (.11,.09,.055),.78,.61);trim=material(faction+' exposed worked copper brass',(.38,.22,.091) if faction=='dwarf' else (.42,.28,.10),.8,.43);wood=material(faction+' dark ash haft and shield field',(.13,.066,.033),rough=.84,kind='leather');leather=material(faction+' fitted dark worked leather gloves',(.077,.048,.030),rough=.88,kind='leather');m=_hand_space(arm,'R');c=Vector((0,.15,0));radius=.043 if faction=='gnome' else .053
 # Calibrate the axial direction from the saved actual idle, rotating about
 # the fixed hand socket. This keeps a proper rotation, not a mirrored mesh.
 axial_up=((arm.matrix_world@arm.pose.bones['hand_R'].matrix).to_3x3()@Vector((0,0,1))).z
 if axial_up<0:m=m@Matrix.Translation(c)@Matrix.Rotation(math.pi,4,'X')@Matrix.Translation(-c)
 curve('Continuous real-palm seated worked haft',[m@(c+Vector((0,0,-.22))),m@(c+Vector((0,0,.34)))],radius,arm,role,'hand_R',leather,col,24)
 pole=role in ['spear_guard','light_cavalry','heavy_cavalry','elite']
 if pole:
  length=1.35 if role!='elite' else 1.0;curve('Actual closed-hand spear shaft',[m@(c+Vector((0,0,-.45))),m@(c+Vector((0,0,length)))],radius*.76,arm,role,'hand_R',wood,col,24)
  profile=[(-.075,length-.05),(-.09,length+.09),(0,length+.39),(.09,length+.09),(.075,length-.05)];vs=[m@(c+Vector((x,y,z))) for y in [-.022,.022] for x,z in profile];n=len(profile);fs=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)];mesh('Forged long purposeful spear point',vs,fs,arm,role,'hand_R',iron,col,smooth=False)
  if role=='elite':
   for side in [-1,1]:
    vs=[m@(c+Vector((side*x,y,z))) for y in [-.028,.028] for x,z in [(0,.52),(.16,.61),(.34,.97),(.21,1.09),(.05,.93)]];mesh('Elite broad swept poleaxe cutting wing',vs,[(0,1,2,3,4),(9,8,7,6,5)]+[(i,(i+1)%5,(i+1)%5+5,i+5) for i in range(5)],arm,role,'hand_R',iron,col,smooth=False)
 elif faction=='dwarf' and role!='scout':
  curve('Heavy ash hammer full continuous shaft',[m@(c+Vector((0,0,.10))),m@(c+Vector((0,0,.98)))],radius*.82,arm,role,'hand_R',wood,col,24)
  vs=[m@(c+Vector((x,y,z))) for y in [-.11,.11] for x,z in [(-.31,.89),(-.35,.94),(-.35,1.12),(-.29,1.17),(.29,1.17),(.35,1.12),(.35,.94),(.29,.89)]];mesh('Dwarf genuine chamfered massive dark iron hammer head',vs,[tuple(range(7,-1,-1)),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)],arm,role,'hand_R',iron,col,smooth=False)
  for y in [-.115,.115]:curve('Hammer raised substantial copper face rim',[m@(c+Vector((x,y,z))) for x,z in [(-.31,.90),(-.34,.95),(-.34,1.11),(-.28,1.16),(.28,1.16),(.34,1.11),(.34,.95),(.28,.90),(-.31,.90)]],.012,arm,role,'hand_R',trim,col)
 elif faction=='dwarf':
  vs=[m@(c+Vector((x,y,z))) for y in [-.020,.020] for x,z in [(0,.22),(-.11,.31),(-.24,.59),(-.16,.73),(0,.62),(.03,.40)]];mesh('Dwarf scout compact hooked boarding axe',vs,[tuple(range(5,-1,-1)),tuple(range(6,12))]+[(i,(i+1)%6,(i+1)%6+6,i+6) for i in range(6)],arm,role,'hand_R',iron,col,smooth=False);curve('Scout axe short ash upper shaft',[m@(c+Vector((0,0,.12))),m@(c+Vector((0,0,.65)))],radius*.8,arm,role,'hand_R',wood,col)
 else:
  vs=[m@(c+Vector((x,y,z))) for y in [-.012,.012] for x,z in [(-.075,.31),(-.065,.71),(0,1.02),(.065,.71),(.075,.31)]];mesh('Gnome individually shaped pointed short sword blade',vs,[(4,3,2,1,0),(5,6,7,8,9)]+[(i,(i+1)%5,(i+1)%5+5,i+5) for i in range(5)],arm,role,'hand_R',iron,col,smooth=False);curve('Short sword substantial brass crossguard',[m@(c+Vector((-.14,0,.27))),m@(c+Vector((.14,0,.27)))],.025,arm,role,'hand_R',trim,col)
 if role=='scout':return {'actualHandRigBinding':'hand_R','gripCenterHandLocal':[0,.15,0],'roleKit':'Short scout weapon; existing animal/rein controls unchanged'}
 # Shield field orientation is calibrated from the actual saved idle hand pose.
 m=_hand_space(arm,'L');pose=(arm.matrix_world@arm.pose.bones['hand_L'].matrix).to_3x3();up=(pose.inverted()@Vector((0,0,1))).normalized();front=(pose.inverted()@Vector((1,0,0))).normalized();across=up.cross(front).normalized();front=across.cross(up).normalized();c=Vector((0,.15,0))
 glove=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and 'connected fitted hand_L glove' in o.name);inverse=m.inverted();extent=max(((inverse@v.co)-c).dot(front) for v in glove.data.vertices);shield_offset=max(.095,extent+.060);center=c+front*shield_offset;w=.35 if faction=='dwarf' else .32;h=.55 if role=='spear_guard' else .43
 profile=[(-w*.72,-h),(-w,-h*.45),(-w,h*.72),(0,h),(w,h*.72),(w,-h*.45),(w*.72,-h)] if faction=='dwarf' else [(math.sin(a)*w,math.cos(a)*h) for a in np.linspace(0,math.tau,33)[:-1]]
 vs=[m@(center+front*.035)]+[m@(center+across*x+up*z) for x,z in profile]+[m@(center-front*.026)]+[m@(center+across*x+up*z-front*.026) for x,z in profile];n=len(profile);fs=[(0,i+1,(i+1)%n+1) for i in range(n)]+[(n+1,n+2+(i+1)%n,n+2+i) for i in range(n)]+[(i+1,(i+1)%n+1,n+2+(i+1)%n,n+2+i) for i in range(n)];mesh('Convex thick portrait shield continuous field',vs,fs,arm,role,'hand_L',iron if faction=='dwarf' else wood,col,smooth=False)
 curve('Shield substantial exposed bent copper rim',[m@(center+across*x+up*z+front*.006) for x,z in profile+[profile[0]]],.018,arm,role,'hand_L',trim,col)
 curve('Shield actual closed-palm rear shaft grip',[m@(c+Vector((0,0,-.18))),m@(c+Vector((0,0,.18)))],radius,arm,role,'hand_L',leather,col,24)
 for z in [-.15,.15]:curve('Shield real rear grip support bracket',[m@(c+Vector((0,0,z))),m@(center+up*z-front*.026)],.014,arm,role,'hand_L',trim,col)
 device=[(0,.18),(-.10,0),(0,-.18),(.10,0)];dv=[m@(center+front*.05+across*x+up*z) for x,z in device]+[m@(center+front*.09)];mesh('Raised dimensional shield clan diamond',dv,[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],arm,role,'hand_L',trim,col,smooth=False)
 return {'actualHandRigBinding':['hand_R','hand_L'],'gripCentersHandLocal':[0,.15,0],'shaftRadii':radius,'weaponAxialIdleUp':float(axial_up),'shieldGloveFrontExtent':float(extent),'shieldFieldOffset':float(shield_offset),'shieldRearPlaneGloveClearance':float(shield_offset-.026-extent),'shieldOrientation':'Measured actual idle hand matrix and actual glove bounds; field/rear closed grip share unchanged hand bone','sourceBonesAndControlActionsChanged':False}
