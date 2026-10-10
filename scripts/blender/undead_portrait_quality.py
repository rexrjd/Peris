"""Undead portrait pilot with separately credited anatomical skeleton component.

Source files remain immutable. New geometry follows the existing 0AD rig;
no additional bones/actions are introduced. CC BY 4.0 anatomy stays separate
from CC BY SA 3.0 equipment/source collection.
"""
import bpy,bmesh,math,json,pathlib,hashlib
import numpy as np
from mathutils import Vector,Matrix
import undead_contact_v4 as shapes
import undead_skeletal_grips as grip_shapes
ROOT=pathlib.Path(__file__).resolve().parents[2]
REFERENCE=ROOT/'assets/references/units/downloads/undead/animated-skeleton-anatomy/reference.glb'
REFERENCE_SHA='ed7d1fe4e971e3cb990a480b47e93aee39e4307fe4aa94ee4f5e04c9ade4ef96'

def textured(name,color,kind='metal',metal=.65,rough=.75):
 if bpy.data.materials.get(name):return bpy.data.materials[name]
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 size=256;yy,xx=np.mgrid[:size,:size];grain=.85+.08*np.sin(xx*.71+yy*.81)+.045*np.sin(xx*2.19-yy*.41);pixels=np.ones((size,size,4),np.float32)
 base=grain[:,:,None]*np.array(color)
 if kind=='metal':
  rust=(np.sin(xx*.083+np.sin(yy*.074)*2)+np.sin(yy*.103-xx*.061))>1.19;base[rust]=grain[rust,None]*np.array((.27,.14,.072))
 elif kind=='cloth':base*=((.91+.045*np.sin(xx*math.pi*.5)+.045*np.sin(yy*math.pi*.5))[:,:,None])
 pixels[:,:,:3]=np.clip(base,0,1);image=bpy.data.images.new(name+' baked grain',width=size,height=size,alpha=False);image.pixels.foreach_set(pixels.ravel());image.pack();tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color']);return m

def primitive_mesh(name,verts,faces,arm,role,bone,mat,col,smooth=False):
 o=shapes.mesh(name,verts,faces,arm,role,[{bone:1} for _ in verts],mat,col)
 for p in o.data.polygons:p.use_smooth=smooth
 return o

def band(name,points,radii,arm,role,bone,mat,col):return shapes.tube(name,points,radii,arm,role,bone,mat,col)

def _source_anatomy(arm,role,col):
 if hashlib.sha256(REFERENCE.read_bytes()).hexdigest()!=REFERENCE_SHA:raise ValueError('Cached anatomical source changed')
 existing=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(REFERENCE));imported=set(bpy.data.objects)-existing;source=next(o for o in imported if o.type=='MESH' and o.vertex_groups and len(o.data.vertices)>4000);rig=next(o for o in imported if o.type=='ARMATURE')
 def bone(term):return next(b for b in rig.data.bones if term in b.name)
 refs={};mapping={};anchors={};transforms={}
 torso=[('Pelvis_','hip',arm.data.bones['hip'].head_local),('Spine_','spine',arm.data.bones['spine'].head_local),('Spine1_','spine1',arm.data.bones['spine1'].head_local),('Spine2_','chest',arm.data.bones['chest'].head_local),('Spine4_','chest',arm.data.bones['chest'].head_local.lerp(arm.data.bones['neck'].head_local,.75)),('Neck1_','neck',arm.data.bones['neck'].head_local),('Head1_','prop-head',arm.data.bones['prop-head'].head_local)]
 for term,target,anchor in torso:
  b=bone(term);mapping[b.name]=target;refs[b.name]=b.head_local;anchors[b.name]=anchor.copy();transforms[b.name]=Matrix.Diagonal((.049,.055,.062)).to_3x3()
  if term=='Head1_':transforms[b.name]=Matrix.Diagonal((.049,.049,.049)).to_3x3()
 for side in ['L','R']:
  chain=[('Clavicle','UpperArm','shoulder_'+side,'arm_'+side),('UpperArm','Forearm','arm_'+side,'forearm_'+side),('Forearm','Hand','forearm_'+side,'hand_'+side),('Thigh','Calf','thigh_'+side,'leg_'+side),('Calf','Foot','leg_'+side,'foot_'+side)]
  for start,end,target,targetEnd in chain:
   a=bone('_'+side+'_'+start+'_');b=bone('_'+side+'_'+end+'_');ta=arm.data.bones[target].head_local;tb=arm.data.bones[targetEnd].head_local;sv=b.head_local-a.head_local;tv=tb-ta;rot=sv.normalized().rotation_difference(tv.normalized()).to_matrix();scale=tv.length/sv.length
   mapping[a.name]=target;refs[a.name]=a.head_local.copy();anchors[a.name]=ta.copy();transforms[a.name]=rot@Matrix.Diagonal((scale,scale,scale)).to_3x3()
 # Keep the frozen contact hands/feet. Import only source anatomy up to those joints.
 groups={g.index:g.name for g in source.vertex_groups};excluded={i for i,n in groups.items() if any(t in n for t in ['_Hand_','_Finger','_Foot_','_Toe'])};selected=[]
 for p in source.data.polygons:
  mean=sum(sum(g.weight for g in source.data.vertices[i].groups if g.group in excluded) for i in p.vertices)/len(p.vertices)
  if mean<.34:selected.append(p)
 ids=sorted({i for p in selected for i in p.vertices});index={old:new for new,old in enumerate(ids)};verts=[];weights=[]
 for vi in ids:
  v=source.data.vertices[vi];contributions=[(groups[g.group],g.weight) for g in v.groups if groups[g.group] in mapping];total=sum(w for n,w in contributions)
  if total<1e-8:raise ValueError('Anatomy selected unsupported source influence')
  position=Vector();targetweights={}
  for name,w in contributions:
   amount=w/total;position+=(anchors[name]+transforms[name]@(v.co-refs[name]))*amount;targetweights[mapping[name]]=targetweights.get(mapping[name],0)+amount
  verts.append(position);weights.append(targetweights)
 data=bpy.data.meshes.new('Anatomical Undead skeleton CC BY 4.0');data.from_pydata(verts,[],[tuple(index[i] for i in p.vertices) for p in selected]);data.update();o=bpy.data.objects.new(role+' anatomical bone component CC BY 4.0',data);col.objects.link(o);o.parent=arm;o.matrix_basis=Matrix.Identity(4);o.matrix_parent_inverse=Matrix.Identity(4);mod=o.modifiers.new('Existing source rig anatomical weights','ARMATURE');mod.object=arm
 for name in {n for w in weights for n in w}:
  g=o.vertex_groups.new(name=name)
  for i,w in enumerate(weights):
   if w.get(name,0)>0:g.add([i],w[name],'REPLACE')
 data.materials.append(source.data.materials[0]);uv=data.uv_layers.new(name='SourceAnatomyUV');sourceuv=source.data.uv_layers.active
 for target,p in zip(data.polygons,selected):
  target.use_smooth=True
  for li,sli in zip(target.loop_indices,p.loop_indices):uv.data[li].uv=sourceuv.data[sli].uv
 # Remove the partial source hand roots inside the rigid wrist cuffs. The
 # imported source uses blended finger roots; influence-only clipping left
 # pointed sheets. A geometric cut remains proximal to the retained hand.
 cutstats=[]
 for side in ['L','R']:
  b=arm.data.bones['forearm_'+side];start=b.head_local;direction=(b.tail_local-start).normalized();plane=start.lerp(b.tail_local,.83);group=o.vertex_groups['forearm_'+side].index
  bm=bmesh.new();bm.from_mesh(data);layer=bm.verts.layers.deform.active
  region=[f for f in bm.faces if any(v[layer].get(group,0)>.45 and (v.co-start).dot(direction)>(b.tail_local-start).length*.65 for v in f.verts)]
  geom=list(set(region+[e for f in region for e in f.edges]+[v for f in region for v in f.verts]));before=len(bm.faces)
  bmesh.ops.bisect_plane(bm,geom=geom,dist=1e-7,plane_co=plane,plane_no=direction,clear_outer=True,clear_inner=False)
  bm.to_mesh(data);bm.free();data.update();cutstats.append({'side':side,'plane':list(plane),'normal':list(direction),'removedFaces':before-len(data.polygons),'fractionForearm':.83})
 o['peris_role']=role;o['asset_license']='CC-BY-4.0';o['asset_author']='danielmclogan; Peris rig and proportion adaptation';o['asset_source_url']='https://sketchfab.com/3d-models/skeleton-animated-9210377c7a514cf6b48a31b9d3991ff3';o['peris_source_sha256']=REFERENCE_SHA;o['peris_license_component']='Anatomical skeleton geometry and original UV texture only; separate from CC-BY-SA-3.0 rig/equipment';o['peris_unit_finished']=False;o['runtime_approved']=False
 o['source_url']=o['asset_source_url'];o['source_file_sha256']=REFERENCE_SHA;o['peris_atlas_partition']='licensed-undead-anatomy'
 o['peris_faction']='undead';o['peris_source_family']='rome';o['original_peris_equipment']=False
 o['peris_component_credit']=json.dumps({'author':'danielmclogan','license':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','sourceUrl':o['source_url'],'sourceSha256':REFERENCE_SHA,'sourceFileSha256':REFERENCE_SHA,'changes':'Source skeletal geometry and original UV texture adapted to existing Peris prototype proportions and source bone weights; no source clips imported. Separate from CC-BY-SA-3.0 rig and equipment.'})
 stats={'referenceSha256':REFERENCE_SHA,'sourceVertices':len(source.data.vertices),'adaptedVertices':len(data.vertices),'adaptedFaces':len(data.polygons),'mappedBones':mapping,'wristAnatomyCutsInsideCuff':cutstats,'retainedFrozenHandsAndFeet':True,'componentLicense':'CC-BY-4.0','creator':'danielmclogan','sourceUrl':o['asset_source_url']}
 for other in imported:bpy.data.objects.remove(other,do_unlink=True)
 return o,stats

def _remove_schematic_anatomy(source):
 data=source.data;groups={g.index:g.name for g in source.vertex_groups};uv=data.uv_layers.active;material=data.materials[0];p=material.node_tree.nodes.get('Principled BSDF');tex=p.inputs['Base Color'].links[0].from_node;image=tex.image;width,height=image.size;pixels=np.empty(width*height*4,np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape((height,width,4));remove=[]
 for f in data.polygons:
  influence={}
  for i in f.vertices:
   for g in data.vertices[i].groups:influence[groups[g.group]]=influence.get(groups[g.group],0)+g.weight/len(f.vertices)
  head=influence.get('prop-head',0)>.9;scabbard=influence.get('prop_sheath_01_R',0)>.9
  anatomy=sum(w for n,w in influence.items() if n.startswith(('arm_','forearm_','thigh_','leg_')) or n in ['chest','hip','neck'])>.8
  coord=sum((uv.data[i].uv for i in f.loop_indices),Vector((0,0)))/len(f.loop_indices);x=max(0,min(width-1,int(coord.x*(width-1))));y=max(0,min(height-1,int(coord.y*(height-1))));r,g,b=pixels[y,x,:3];bonecolor=r>.4 and g>.35 and b>.25 and r>b*1.08
  if head or scabbard or (anatomy and bonecolor):remove.append(f.index)
 bm=bmesh.new();bm.from_mesh(data);bm.faces.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.faces[i] for i in remove],context='FACES');bm.to_mesh(data);bm.free();data.update();return {'removedSchematicBoneHeadAndRomanScabbardFaces':len(remove),'sourceHandsFeetAndClothRetained':True}

def pauldrons(arm,role,mat,trim,col):
 objects=[]
 for side in ['L','R']:
  sign=1 if side=='L' else -1;b=arm.data.bones['arm_'+side];center=b.head_local.copy()
  for layer in range(3):
   verts=[];n=14
   # Curved overlapping iron lames have a front/back thickness and shaped rim.
   for wall in [0,1]:
    for row in [0,1]:
     for i in range(n):
      angle=-math.pi*.46+i/(n-1)*math.pi*.92;r=.29+layer*.024-wall*.025
      x=sign*(.04+math.cos(angle)*r);y=math.sin(angle)*r*.86;z=.18-layer*.095-row*.09-.055*abs(math.sin(angle));verts.append(center+Vector((x,y,z)))
   faces=[]
   for i in range(n-1):faces += [(i,i+1,n+i+1,n+i),(2*n+i,3*n+i,3*n+i+1,2*n+i+1)]
   for row in [0,1]:
    for i in range(n-1):a=row*n+i;faces.append((a,2*n+a,2*n+a+1,a+1))
   faces += [(0,n,3*n,2*n),(n-1,3*n-1,4*n-1,2*n-1)]
   objects.append(primitive_mesh(role+' corroded shoulder lame '+side+str(layer),verts,faces,arm,role,b.name,mat,col,True))
   rim=[center+Vector((sign*(.04+math.cos(a)*(.295+layer*.024)),math.sin(a)*(.295+layer*.024)*.86,.09-layer*.095-.055*abs(math.sin(a)))) for a in np.linspace(-math.pi*.46,math.pi*.46,14)]
   objects.append(band(role+' rolled shoulder rim '+side+str(layer),rim,[.012]*len(rim),arm,role,b.name,trim,col))
   for j in [1,4,7,10,12]:objects.append(shapes.sphere(role+' shoulder rivet '+side+str(layer)+'-'+str(j),rim[j]+Vector((0,0,.026)),(.018,)*3,arm,role,b.name,trim,col))
 return objects

def cowl(arm,role,cloth,col):
 center=arm.data.bones['neck'].head_local.copy();n=28;verts=[]
 for inner in [0,1]:
  for row in range(4):
   for i in range(n):
    a=math.tau*i/n;front=max(0,math.cos(a));side=abs(math.sin(a));rx=[.235,.30,.37,.43][row]-inner*.024;ry=[.21,.29,.36,.42][row]-inner*.024
    z=[-.045,-.095,-.155,-.215][row]-.035*front+.018*math.sin(a*5+row*.8)
    verts.append(center+Vector((math.sin(a)*rx,-math.cos(a)*ry,z)))
 faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(3) for i in range(n)]
 off=4*n;faces += [(off+j*n+i,off+(j+1)*n+i,off+(j+1)*n+(i+1)%n,off+j*n+(i+1)%n) for j in range(3) for i in range(n)]
 for row in [0,3]:
  for i in range(n):a=row*n+i;b=row*n+(i+1)%n;faces.append((a,a+off,b+off,b))
 # Open the cowl across the sternum rather than burying the clavicle in a bib.
 faces=[f for f in faces if sum(math.cos(math.tau*(v%n)/n) for v in f)/len(f)<.20]
 return primitive_mesh(role+' folded torn violet cowl',verts,faces,arm,role,'chest',cloth,col,True)

def bracers(arm,role,mat,trim,col):
 parts=[]
 for side in ['L','R']:
  b=arm.data.bones['forearm_'+side];direction=(b.tail_local-b.head_local).normalized();start=b.head_local.lerp(b.tail_local,.48);end=b.head_local.lerp(b.tail_local,.91);ref=Vector((1,0,0));x=direction.cross(ref).normalized();y=direction.cross(x).normalized();n=14;verts=[]
  for wall in [0,1]:
   for row,point in enumerate([start,end]):
    r=(.105 if row==0 else .085)-wall*.016
    for i in range(n):a=math.tau*i/n;verts.append(point+(x*math.cos(a)+y*math.sin(a))*r)
  faces=[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[(2*n+i,3*n+i,3*n+(i+1)%n,2*n+(i+1)%n) for i in range(n)]
  for row in [0,1]:
   for i in range(n):a=row*n+i;bb=row*n+(i+1)%n;faces.append((a,a+2*n,bb+2*n,bb))
  parts.append(primitive_mesh(role+' enclosed weathered bracer '+side,verts,faces,arm,role,b.name,mat,col,True))
  for point,r in [(start,.111),(end,.091)]:
   pts=[point+(x*math.cos(a)+y*math.sin(a))*r for a in np.linspace(0,math.tau,17)];parts.append(band(role+' bracer rolled binding '+side,pts,[.008]*len(pts),arm,role,b.name,trim,col))
 return parts

def shield(source,arm,role,mat,trim,dark,col):
 group=source.vertex_groups['prop-shield'];bm=bmesh.new();bm.from_mesh(source.data);layer=bm.verts.layers.deform.active;bmesh.ops.delete(bm,geom=[v for v in bm.verts if v[layer].get(group.index,0)>.99],context='VERTS');bm.to_mesh(source.data);bm.free();source.data.update();bone=arm.data.bones['prop-shield'];m=bone.matrix_local;n=40;r=.555;verts=[]
 for y in [-.075,.018]:
  for i in range(n):a=math.tau*i/n;verts.append(m@Vector((math.cos(a)*r,y,math.sin(a)*r+.12)))
 front=len(verts);verts.append(m@Vector((0,-.13,.12)));back=len(verts);verts.append(m@Vector((0,.018,.12)))
 faces=[(front,(i+1)%n,i) for i in range(n)]+[(back,n+i,n+(i+1)%n) for i in range(n)]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)];parts=[primitive_mesh(role+' convex corroded round war shield',verts,faces,arm,role,bone.name,mat,col,True)]
 rim=[m@Vector((math.cos(a)*(r+.004),-.082,math.sin(a)*(r+.004)+.12)) for a in np.linspace(0,math.tau,41)];parts.append(band(role+' round shield rolled bronze rim',rim,[.014]*len(rim),arm,role,bone.name,trim,col));parts.append(shapes.sphere(role+' shield central forged boss',m@Vector((0,-.15,.12)),(.105,.048,.105),arm,role,bone.name,trim,col))
 for i in range(16):
  a=math.tau*i/16;parts.append(shapes.sphere(role+' shield rim rivet '+str(i),m@Vector((math.cos(a)*.505,-.108,math.sin(a)*.505+.12)),(.016,)*3,arm,role,bone.name,trim,col))
 for i in range(8):
  a=math.tau*i/8;v=[m@Vector((math.cos(a)*.095,-.145,math.sin(a)*.095+.12)),m@Vector((math.cos(a-.09)*.29,-.119,math.sin(a-.09)*.29+.12)),m@Vector((math.cos(a)*.405,-.101,math.sin(a)*.405+.12)),m@Vector((math.cos(a+.09)*.29,-.119,math.sin(a+.09)*.29+.12))];parts.append(primitive_mesh(role+' raised shield sun ray '+str(i),v,[(0,1,2,3)],arm,role,bone.name,trim,col))
 # Retained source hand is now visually connected to a real rear handle.
 hc=arm.data.bones['hand_L'].matrix_local@Vector((0,.11,0));ends=[m@Vector((-.11,.041,.12)),m@Vector((.11,.041,.12))];parts.append(band(role+' shield leather hand grip',[ends[0],hc,ends[1]],[.024,.030,.024],arm,role,'hand_L',dark,col))
 return parts

def helmet(arm,role,steel,trim,col,crest=False):
 h=arm.data.bones['prop-head'].head_local;center=h+Vector((0,.02,.215));n=32;rows=9;verts=[]
 for inner in [0,1]:
  for j in range(rows):
   t=.03+1.45*j/(rows-1)
   for i in range(n):
    a=math.tau*i/n;verts.append(center+Vector((math.sin(a)*(.195-inner*.018)*math.sin(t),-math.cos(a)*(.237-inner*.018)*math.sin(t),(.22-inner*.016)*math.cos(t))))
 off=rows*n;faces=[]
 for j in range(rows-1):
  for i in range(n):a=j*n+i;b=j*n+(i+1)%n;faces.extend([(a,b,b+n,a+n),(a+off,a+n+off,b+n+off,b+off)])
 for row in [0,rows-1]:
  for i in range(n):a=row*n+i;b=row*n+(i+1)%n;faces.append((a,a+off,b+off,b))
 parts=[primitive_mesh(role+' riveted iron skull helmet',verts,faces,arm,role,'prop-head',steel,col,True)]
 rim=[center+Vector((math.sin(a)*.197,-math.cos(a)*.239,.020)) for a in np.linspace(0,math.tau,33)];parts.append(band(role+' helmet brow rolled band',rim,[.012]*len(rim),arm,role,'prop-head',trim,col))
 for i in range(16):
  a=math.tau*i/16;parts.append(shapes.sphere(role+' helmet rivet '+str(i),center+Vector((math.sin(a)*.199,-math.cos(a)*.242,.042)),(.012,)*3,arm,role,'prop-head',trim,col))
 v=[h+Vector((x,y,z)) for x,y,z in [(-.022,-.216,.235),(.022,-.216,.235),(.017,-.212,.082),(-.017,-.212,.082),(-.022,-.199,.235),(.022,-.199,.235),(.017,-.195,.082),(-.017,-.195,.082)]];parts.append(primitive_mesh(role+' forged nasal guard',v,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],arm,role,'prop-head',steel,col,True))
 if crest:
  pts=[h+Vector((0,y,.215+.22*math.sqrt(max(0,1-((y-.02)/.237)**2))+.027)) for y in np.linspace(-.17,.19,7)];parts.append(band(role+' heavy helmet raised spine',pts,[.032]*len(pts),arm,role,'prop-head',trim,col))
 return parts

def hood(arm,role,cloth,col):
 h=arm.data.bones['prop-head'].head_local;center=h+Vector((0,.025,.13));n=36;rows=15;verts=[]
 for inner in [0,1]:
  for j in range(rows):
   t=.025+2.475*j/(rows-1)
   for i in range(n):
    a=math.tau*i/n;fold=1+.028*math.sin(a*9+j*.55);verts.append(center+Vector((math.sin(a)*(.222-inner*.021)*math.sin(t)*fold,-math.cos(a)*(.27-inner*.021)*math.sin(t)*fold,(.34-inner*.018)*math.cos(t))))
 off=n*rows;faces=[]
 for j in range(rows-1):
  for i in range(n):
   a=j*n+i;b=j*n+(i+1)%n
   if j>=4 and math.cos(math.tau*(i+.5)/n)>.55:continue
   faces.extend([(a,b,b+n,a+n),(a+off,a+n+off,b+n+off,b+off)])
 # Close every exposed cloth edge, including the face opening.
 edges={}
 for f in faces:
  if max(f)<off:
   for a,b in zip(f,f[1:]+f[:1]):edges[tuple(sorted((a,b)))]=edges.get(tuple(sorted((a,b))),0)+1
 for (a,b),count in edges.items():
  if count==1:faces.append((a,a+off,b+off,b))
 return [primitive_mesh(role+' folded open-face violet hood',verts,faces,arm,role,'prop-head',cloth,col,True)]

def crown(arm,role,steel,trim,col):
 h=arm.data.bones['prop-head'].head_local;pts=[h+Vector((math.sin(a)*.181,-math.cos(a)*.212,.273)) for a in np.linspace(0,math.tau,33)];parts=[band(role+' tarnished iron crown band',pts,[.022]*len(pts),arm,role,'prop-head',trim,col)]
 for i in range(8):
  a=math.tau*i/8;c=h+Vector((math.sin(a)*.178,-math.cos(a)*.207,.277));tip=c+Vector((math.sin(a)*.022,-math.cos(a)*.022,.15 if i%2 else .24));v=[c+Vector((math.cos(t)*.028,math.sin(t)*.028,0)) for t in np.linspace(0,math.tau,9)[:-1]]+[tip];faces=[tuple(range(7,-1,-1))]+[(j,(j+1)%8,8) for j in range(8)];parts.append(primitive_mesh(role+' jagged crown tine '+str(i),v,faces,arm,role,'prop-head',steel,col,True))
 return parts

def apply(collection,role='line_infantry'):
 source=next(o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role and o.parent and o.parent.type=='ARMATURE' and 'hand_R' in o.parent.data.bones);arm=source.parent;removed=_remove_schematic_anatomy(source);anatomy,stats=_source_anatomy(arm,role,collection)
 steel=textured('Undead pitted blue-black corroded iron',(.19,.22,.235),'metal',.72,.74);trim=textured('Undead worn tarnished bronze',(.35,.255,.115),'metal',.62,.71);cloth=textured('Undead layered frayed violet cloth',(.15,.085,.23),'cloth',0,.93);leather=textured('Undead dry dark grip leather',(.072,.049,.035),'leather',0,.95)
 created=pauldrons(arm,role,steel,trim,collection)+[cowl(arm,role,cloth,collection)]+bracers(arm,role,steel,trim,collection)
 if role not in ['archer','scout'] and source.vertex_groups.get('prop-shield'):created+=shield(source,arm,role,steel,trim,leather,collection)
 if role in ['spear_guard','light_cavalry','heavy_cavalry']:created+=helmet(arm,role,steel,trim,collection,role=='heavy_cavalry')
 if role in ['archer','scout']:created+=hood(arm,role,cloth,collection)
 if role=='elite':created+=crown(arm,role,steel,trim,collection)
 # Tiny restrained green eyes are original Peris additions, inside skull sockets.
 eye=textured('Undead restrained green eye',(.035,.28,.09),'eye',0,.48);p=eye.node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(.04,.48,.14,1);p.inputs['Emission Strength'].default_value=.8
 h=arm.data.bones['prop-head'].head_local
 for side in [-1,1]:created.append(shapes.sphere(role+' small green skull eye '+str(side),h+Vector((side*.078,-.114,.145)),(.018,.015,.019),arm,role,'prop-head',eye,collection))
 # Existing contact geometry keeps its shape and weights, with a matching
 # mottled bone surface rather than the prototype's untextured bright white.
 bone=textured('Undead retained contact bone patina',(.67,.62,.52),'bone',0,.93);mi=len(source.data.materials);source.data.materials.append(bone);contact={g.index for g in source.vertex_groups if g.name in ['hand_L','hand_R','foot_L','foot_R']}
 for f in source.data.polygons:
  points=[source.data.vertices[i].co for i in f.vertices]
  local_contact=any(all((p-arm.data.bones[n].head_local).length<(.38 if n.startswith('foot_') else .32) for p in points) for n in ['hand_L','hand_R','foot_L','foot_R'])
  if local_contact and all(sum(g.weight for g in source.data.vertices[i].groups if g.group in contact)>.9 for i in f.vertices):f.material_index=mi
 grips,gripstats=grip_shapes.apply(source,arm,role,bone,leather,collection,steel);created+=grips
 return {'role':role,'schematicRemoval':removed,'anatomicalComponent':stats,'originalEquipmentObjects':len(created),'skeletalGrasps':gripstats,'newBones':0,'newActions':0,'sourceContactFeetAndLineRightGraspPreserved':True,'prototype':True,'runtimeApproved':False,'finishedUnitApproved':False}
