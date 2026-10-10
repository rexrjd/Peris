"""Original bounded skeletal-beast/tack additions to immutable Undead prototypes.

Existing body support, tusks, rigs, binds and animation remain unchanged.
Museum mammoth images informed visual study; no reference geometry is copied.
"""
import bpy,bmesh,math
import numpy as np
from mathutils import Vector
import undead_portrait_quality as q

def islands(source,group):
 gi=source.vertex_groups[group].index
 ids={v.index for v in source.data.vertices if any(g.group==gi and g.weight>.99 for g in v.groups)}
 adjacent={i:set() for i in ids}
 for e in source.data.edges:
  a,b=e.vertices
  if a in ids and b in ids:adjacent[a].add(b);adjacent[b].add(a)
 result=[]
 while ids:
  todo=[ids.pop()];part=[]
  while todo:
   i=todo.pop();part.append(i)
   for j in adjacent[i]:
    if j in ids:ids.remove(j);todo.append(j)
  result.append(part)
 return result

def remove_ids(source,ids):
 bm=bmesh.new();bm.from_mesh(source.data);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.verts[i] for i in ids],context='VERTS');bm.to_mesh(source.data);bm.free();source.data.update()

def cube(name,c,size,arm,role,bone,mat,col):
 c=Vector(c);x,y,z=[a*.5 for a in size];v=[c+Vector((sx*x,sy*y,sz*z)) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
 return q.primitive_mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],arm,role,bone,mat,col)

def shell(name,rings,arm,role,bone,mat,col,opening):
 # Elliptical, deliberately faceted vault with actual nasal/orbital openings.
 n=20;verts=[]
 for inner in [False,True]:
  for row,(z,yc,rx,ry) in enumerate(rings):
   for i in range(n):
    a=math.tau*i/n;shrink=.075 if inner else 0
    verts.append(Vector((math.sin(a)*(rx-shrink),yc-math.cos(a)*(ry-shrink),z)))
 off=len(rings)*n;outer=[]
 for j in range(len(rings)-1):
  for i in range(n):
   a=math.tau*(i+.5)/n
   if opening(j,a):continue
   outer.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 outer += [tuple(range(n-1,-1,-1)),tuple(range((len(rings)-1)*n,len(rings)*n))]
 faces=list(outer)+[tuple(v+off for v in f[::-1]) for f in outer];edges={}
 for f in outer:
  for a,b in zip(f,f[1:]+f[:1]):edges[tuple(sorted((a,b)))]=edges.get(tuple(sorted((a,b))),0)+1
 for (a,b),count in edges.items():
  if count==1:faces.append((a,a+off,b+off,b))
 result=q.primitive_mesh(name,verts,faces,arm,role,bone,mat,col,True)
 return result

def equine_shell(name,rings,arm,role,bone,mat,col):
 n=24;verts=[]
 for inner in [False,True]:
  for y,zc,rx,rz in rings:
   for i in range(n):
    a=math.tau*i/n;shrink=.042 if inner else 0;verts.append(Vector((math.sin(a)*(rx-shrink),y,zc+math.cos(a)*(rz-shrink))))
 off=len(rings)*n;outer=[]
 for j in range(len(rings)-1):
  for i in range(n):
   a=math.tau*(i+.5)/n
   # Small paired orbit at the rear, distinct from the long nasal maxilla.
   if j==5 and abs(math.sin(a))>.86:continue
   if j==0 and math.cos(a)>.72:continue
   outer.append((j*n+i,(j+1)*n+i,(j+1)*n+(i+1)%n,j*n+(i+1)%n))
 outer += [tuple(range(n-1,-1,-1)),tuple(range((len(rings)-1)*n,len(rings)*n))]
 faces=list(outer)+[tuple(v+off for v in f[::-1]) for f in outer];edges={}
 for f in outer:
  for a,b in zip(f,f[1:]+f[:1]):edges[tuple(sorted((a,b)))]=edges.get(tuple(sorted((a,b))),0)+1
 for (a,b),count in edges.items():
  if count==1:faces.append((a,a+off,b+off,b))
 return q.primitive_mesh(name,verts,faces,arm,role,bone,mat,col,True)

def horse(source,arm,role,col,bone,iron,trim,cloth,leather):
 parts=[];head='Horse_Head';before=len(source.data.vertices);remove_ids(source,[i for part in islands(source,head) for i in part])
 # Elongated nasal plate, cheek vault and lower jaw replace the cuboid mask.
 rings=[(-4.015,4.34,.105,.105),(-3.88,4.38,.16,.155),(-3.68,4.43,.175,.17),(-3.46,4.51,.205,.185),(-3.26,4.64,.275,.225),(-3.17,4.72,.305,.26),(-2.98,4.74,.315,.26),(-2.84,4.74,.26,.24),(-2.74,4.72,.12,.14)]
 parts.append(equine_shell(role+' anatomical elongated equine vault',rings,arm,role,head,bone,col))
 parts.append(q.band(role+' horse sagittal nasal ridge',[(0,-3.96,4.445),(0,-3.72,4.60),(0,-3.45,4.69),(0,-3.25,4.87),(0,-3.00,5.00),(0,-2.78,4.89)],[.016,.021,.023,.028,.026,.018],arm,role,head,bone,col))
 for s in [-1,1]:
  parts.append(q.band(role+' open horse zygomatic cheek '+str(s),[(s*.22,-2.82,4.64),(s*.365,-3.12,4.54),(s*.29,-3.48,4.41),(s*.19,-3.90,4.35)],[.070,.066,.058,.048],arm,role,head,bone,col))
  parts.append(q.band(role+' articulated horse mandible '+str(s),[(s*.20,-2.90,4.55),(s*.29,-3.07,4.20),(s*.17,-3.59,4.15),(s*.15,-3.93,4.18)],[.067,.065,.048,.043],arm,role,head,bone,col))
  for j in range(6):parts.append(cube(role+' horse cheek tooth '+str(s)+'-'+str(j),(s*.16,-3.38-j*.085,4.27),(.082,.071,.108),arm,role,head,bone,col))
  parts.append(q.band(role+' horse orbital bone rim '+str(s),[(s*.314,-3.075+math.cos(a)*.116,4.72+math.sin(a)*.117) for a in np.linspace(0,math.tau,21)],[.025]*21,arm,role,head,bone,col))
  parts.append(q.band(role+' horse long maxilla '+str(s),[(s*.255,-3.31,4.44),(s*.198,-3.60,4.36),(s*.148,-3.92,4.31)],[.050,.054,.042],arm,role,head,bone,col))
  parts.append(q.band(role+' fitted horse bridle cheek '+str(s),[(s*.28,-2.84,4.89),(s*.385,-3.11,4.65),(s*.27,-3.67,4.40)],[.021,.024,.021],arm,role,head,leather,col))
 parts.append(q.band(role+' horse nasal bridle',[(s*.255,-3.67,4.48) for s in [-1,-.5,0,.5,1]],[.024]*5,arm,role,head,leather,col))
 # Existing fitted bench and supports stay untouched; tack hugs the rib cage.
 spine='Horse_Spine_1';seat=arm.data.bones['prop_rider'].head_local.copy()
 for s in [-1,1]:
  pts=[seat+Vector((s*.60,y,z)) for y,z in [(-.53,-.03),(-.48,-.63),(0,-.78),(.49,-.60),(.53,-.03)]]
  parts.append(q.band(role+' rolled saddle blanket edge '+str(s),pts,[.025]*len(pts),arm,role,spine,trim,col))
  v=[seat+Vector((s*x,y,z)) for x,y,z in [(.59,-.53,-.04),(.60,.53,-.04),(.65,.47,-.58),(.68,.15,-.76),(.64,-.11,-.67),(.66,-.48,-.62)]]
  parts.append(q.primitive_mesh(role+' torn violet saddle panel '+str(s),v,[tuple(range(6))],arm,role,spine,cloth,col))
 for y in [-.53,.25]:
  pts=[(0,y,3.75),(.73,y,3.40),(.72,y,2.46),(0,y,2.12),(-.72,y,2.46),(-.73,y,3.40),(0,y,3.75)]
  parts.append(q.band(role+' skeletal horse girth '+str(y),pts,[.036]*len(pts),arm,role,spine,leather,col))
 return parts,{'removedOldHeadVertices':before-len(source.data.vertices),'newHead':'elongated open orbital/nasal shell, cheek arches, mandible and separate molars','bodySupportsAndHoovesPreserved':True}

def mammoth(source,arm,role,col,bone,iron,trim,cloth,leather):
 head='Elephantidae_Head';parts=[];removed=[];kept=[]
 for part in islands(source,head):
  center=sum((source.data.vertices[i].co for i in part),Vector())/len(part)
  if center.y> -5.8 and center.z>5.5:removed+=part
  else:kept+=part
 remove_ids(source,removed)
 rings=[(5.60,-4.71,.47,.31),(5.79,-4.72,.64,.39),(5.99,-4.72,.79,.50),(6.20,-4.71,.91,.60),(6.42,-4.69,.98,.67),(6.64,-4.66,1.025,.71),(6.87,-4.64,.99,.74),(7.09,-4.61,.93,.75),(7.29,-4.57,.83,.69),(7.48,-4.53,.67,.59),(7.64,-4.49,.48,.42),(7.72,-4.47,.21,.19)]
 parts.append(shell(role+' mammoth closed rear cranial vault',rings,arm,role,head,bone,col,lambda j,a:(j in [3,4,5] and math.cos(a)>.91) or (j==4 and abs(math.sin(a))>.91)))
 for s in [-1,1]:
  parts.append(q.band(role+' mammoth zygomatic arch '+str(s),[(s*.77,-4.45,6.93),(s*1.05,-4.93,6.58),(s*.86,-5.28,6.08),(s*.64,-5.22,5.72)],[.12,.13,.11,.12],arm,role,head,bone,col))
  parts.append(q.band(role+' mammoth deep mandible '+str(s),[(s*.78,-4.30,6.44),(s*.84,-4.48,5.96),(s*.57,-4.98,5.51),(s*.22,-5.48,5.46)],[.15,.16,.14,.12],arm,role,head,bone,col))
  parts.append(q.band(role+' mammoth tusk alveolus '+str(s),[(s*.53,-5.14,5.91),(s*.61,-5.12,5.44),(s*.62,-5.05,5.10)],[.25,.24,.205],arm,role,head,bone,col))
  for j in range(3):parts.append(cube(role+' mammoth ridged molar '+str(s)+'-'+str(j),(s*.42,-4.77-j*.17,5.83),(.24,.135,.13),arm,role,head,bone,col))
  parts.append(q.band(role+' mammoth orbital bone rim '+str(s),[(s*1.025,-4.66+math.cos(a)*.27,6.53+math.sin(a)*.18) for a in np.linspace(0,math.tau,25)],[.045]*25,arm,role,head,bone,col))
  parts.append(q.band(role+' mammoth maxillary facial bridge '+str(s),[(s*.72,-5.24,6.27),(s*.59,-5.24,6.03),(s*.53,-5.17,5.79)],[.14,.18,.21],arm,role,head,bone,col))
  parts.append(q.band(role+' mammoth cheek tack '+str(s),[(s*.65,-4.51,7.38),(s*1.095,-4.78,6.63),(s*.79,-5.18,5.81)],[.045,.050,.043],arm,role,head,leather,col))
 # Nasal rim remains an opening rather than two black spheres on a ball.
 for s in [-1,1]:parts.append(q.band(role+' mammoth nasal buttress '+str(s),[(s*.28,-5.29,7.09),(s*.30,-5.43,6.72),(s*.22,-5.34,6.30),(s*.20,-5.25,6.05)],[.09,.077,.085,.09],arm,role,head,bone,col))
 plate=[(-.51,-5.20,7.22),(.51,-5.20,7.22),(.47,-5.09,7.47),(0,-4.98,7.72),(-.47,-5.09,7.47)]
 parts.append(q.primitive_mesh(role+' faceted mammoth forehead iron',plate,[tuple(range(5))],arm,role,head,iron,col))
 parts.append(q.primitive_mesh(role+' violet mammoth forehead enamel',[(-.22,-5.212,7.25),(.22,-5.212,7.25),(0,-5.10,7.60)],[(0,1,2)],arm,role,head,cloth,col))
 dorsal='Elephantidae_Vertebrae_Dorsal'
 # Dark body girths and heraldic cloth are attached to the same existing back.
 for y in [-1.03,.87]:
  pts=[(0,y,7.63),(1.76,y,6.06),(1.98,y,4.68),(0,y,3.47),(-1.98,y,4.68),(-1.76,y,6.06),(0,y,7.63)]
  parts.append(q.band(role+' mammoth fitted leather girth '+str(y),pts,[.073]*len(pts),arm,role,dorsal,leather,col))
 for s in [-1,1]:
  verts=[(s*1.285,y,z) for y,z in [(-1.45,8.00),(.97,8.00),(.91,7.29),(.43,7.13),(-.17,7.26),(-.77,7.11),(-1.40,7.30)]]
  parts.append(q.primitive_mesh(role+' violet hanging howdah hide '+str(s),verts,[tuple(range(7))],arm,role,dorsal,cloth,col))
  rim=[(s*1.30,-1.45,8.095),(s*1.30,.98,8.095)];parts.append(q.band(role+' dark rolled howdah top rail '+str(s),rim,[.035,.035],arm,role,dorsal,leather,col))
  for y in np.linspace(-1.32,.84,10):parts.append(q.shapes.sphere(role+' howdah rail stud '+str(s)+'-'+str(y),(s*1.337,y,8.07),(.025,.029,.029),arm,role,dorsal,trim,col))
 return parts,{'removedRoundedCraniumArmorAndEyeVertices':len(removed),'preservedHeadGroupVerticesIncludingBothTusks':len(kept),'newHead':'angular vault with true nasal/lateral orbital openings, zygomatic arches, deep mandible, molars and tusk alveoli','existingTusksTrunkSupportSeatAndDeckPreserved':True}

def recolor_bone(source,bone):
 # Assign the bone surface only to actual cream atlas faces, leaving old wood.
 cache={};changed=0;mi=len(source.data.materials);source.data.materials.append(bone);uv=source.data.uv_layers.active
 for f in source.data.polygons:
  if f.material_index==mi:continue
  mat=source.data.materials[f.material_index]
  if mat.name not in cache:
   p=mat.node_tree.nodes.get('Principled BSDF');links=p.inputs['Base Color'].links if p else [];tex=links[0].from_node if links else None
   if not tex or tex.type!='TEX_IMAGE':cache[mat.name]=None
   else:
    image=tex.image;w,h=image.size;data=np.empty(w*h*4,np.float32);image.pixels.foreach_get(data);cache[mat.name]=(w,h,data.reshape(h,w,4))
  sampled=cache[mat.name]
  if not sampled:continue
  w,h,data=sampled;c=sum((uv.data[i].uv for i in f.loop_indices),Vector((0,0)))/len(f.loop_indices);r,g,b=data[min(h-1,max(0,int(c.y*(h-1)))),min(w-1,max(0,int(c.x*(w-1)))),:3]
  if r>.50 and g>.45 and b>.32 and r<b*1.8 and g>b*.97:f.material_index=mi;changed+=1
 return changed

def siege(col,bone,iron,trim,cloth):
 # Ram is proven crewless: retain every original primitive and all six wheels.
 ram=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')=='ram');changed=0;mi=len(ram.data.materials);ram.data.materials.append(cloth)
 original=ram.data.materials[0];p=original.node_tree.nodes.get('Principled BSDF');tex=p.inputs['Base Color'].links[0].from_node;w,h=tex.image.size;pixels=np.empty(w*h*4,np.float32);tex.image.pixels.foreach_get(pixels);pixels=pixels.reshape(h,w,4);uv=ram.data.uv_layers.active
 for f in ram.data.polygons:
  if sum(ram.data.vertices[i].co.z for i in f.vertices)/len(f.vertices)<4:continue
  c=sum((uv.data[i].uv for i in f.loop_indices),Vector((0,0)))/len(f.loop_indices);r,g,b=pixels[min(h-1,max(0,int(c.y*(h-1)))),min(w-1,max(0,int(c.x*(w-1)))),:3]
  if r>.60 and g>.56 and b>.42 and r<b*1.6:f.material_index=mi;changed+=1
 # Reuse actual faction skeleton on the existing large throw rig. Hands/feet,
 # held boulder and their original bindings survive the torso/limb replacement.
 giant=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')=='catapult');arm=giant.parent;groups={g.index:g.name for g in giant.vertex_groups};remove=[]
 for f in giant.data.polygons:
  weights={}
  for i in f.vertices:
   for g in giant.data.vertices[i].groups:weights[groups[g.group]]=weights.get(groups[g.group],0)+g.weight/len(f.vertices)
  protect=sum(w for n,w in weights.items() if n.startswith(('foot_','hand_','prop-weapon','prop-ammo','finger')))
  body=sum(w for n,w in weights.items() if n in ['hip','spine','spine1','chest','neck','head','prop-head'] or n.startswith(('thigh_','leg_','arm_','shoulder_','forearm_')))
  if body>.75 and protect<.10:remove.append(f.index)
 bm=bmesh.new();bm.from_mesh(giant.data);bm.faces.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.faces[i] for i in remove],context='FACES');bm.to_mesh(giant.data);bm.free();giant.data.update()
 skull,credit=q._source_anatomy(arm,'catapult',col);anchor=arm.data.bones['prop-head'].head_local;gi=skull.vertex_groups['prop-head'].index
 for v in skull.data.vertices:
  if any(g.group==gi and g.weight>.9 for g in v.groups):v.co=anchor+(v.co-anchor)*1.38
 skull.data.update();skull['peris_license_component']='Anatomical skull, ribs and limb geometry and original UV texture only; separate from CC-BY-SA-3.0 colossus rig/equipment'
 eyes=q.textured('Undead restrained green eye',(.035,.28,.09),'eye',0,.48);leather=q.textured('Undead dry dark grip leather',(.072,.049,.035),'leather',0,.95);parts=q.pauldrons(arm,'catapult',iron,trim,col)+q.bracers(arm,'catapult',iron,trim,col)+[q.cowl(arm,'catapult',cloth,col)]
 hip=arm.data.bones['hip'].head_local
 for s in [-1,1]:
  pts=[hip+Vector((s*x,y,z)) for x,y,z in [(.45,-.30,.07),(.50,.24,.07),(.48,.28,-.61),(.41,.04,-.87),(.50,-.29,-.68)]];parts.append(q.primitive_mesh('catapult torn grave mantle '+str(s),pts,[tuple(range(5))],arm,'catapult','hip',cloth,col,True))
 chest=arm.data.bones['chest'].head_local
 for s in [-1,1]:parts.append(q.band('catapult diagonal graveplate rib '+str(s),[chest+Vector((s*.08,-.24,.28)),chest+Vector((s*.22,-.31,-.04)),chest+Vector((s*.14,-.27,-.36))],[.053,.064,.042],arm,'catapult','chest',iron,col))
 parts.append(cube('catapult riveted graveplate sternum',chest+Vector((0,-.32,.02)),(.20,.09,.59),arm,'catapult','chest',iron,col))
 for z in [-.22,0,.22]:parts.append(q.shapes.sphere('catapult graveplate stud '+str(z),chest+Vector((0,-.377,z)),(.023,.018,.023),arm,'catapult','chest',trim,col))
 for s in [-1,1]:parts.append(q.shapes.sphere('catapult green eye '+str(s),anchor+Vector((s*.078,-.114,.145))*1.38,(.024,.021,.026),arm,'catapult','prop-head',eyes,col))
 return parts,{'ram':{'originalGeometryAndCrestsPreserved':True,'violetRoofFaces':changed,'crewless':True},'catapult':{'replacedPrimitiveStoneBodyAndHeadFaces':len(remove),'newCreditedSkeletonVertices':len(skull.data.vertices),'skeletonComponent':credit,'sourceHandsFeetRockAndRigPreserved':True,'originalGraveplateMantleAndWeatheredEquipment':True}}

def apply(col):
 bone=q.textured('Undead beast weathered porous bone',(.62,.58,.47),'bone',0,.94);iron=q.textured('Undead pitted blue-black corroded iron',(.19,.22,.235),'metal',.72,.74);trim=q.textured('Undead worn tarnished bronze',(.35,.255,.115),'metal',.62,.71);cloth=q.textured('Undead layered frayed violet cloth',(.15,.085,.23),'cloth',0,.93);leather=q.textured('Undead dry dark grip leather',(.072,.049,.035),'leather',0,.95)
 records=[];created=[]
 for role in ['scout','light_cavalry','heavy_cavalry']:
  source=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and o.parent and 'hand_R' not in o.parent.data.bones);arm=source.parent
  parts,stats=(mammoth if role=='heavy_cavalry' else horse)(source,arm,role,col,bone,iron,trim,cloth,leather);stats['role']=role;stats['creamBoneFacesTextured']=recolor_bone(source,bone);records.append(stats);created+=parts
 # Light cavalry has a shield plus lance; remove only redundant spare ammo.
 body=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')=='light_cavalry' and o.parent and 'hand_R' in o.parent.data.bones and o.get('asset_license')!='CC-BY-4.0')
 group=body.vertex_groups.get('prop-ammo');ids=[v.index for v in body.data.vertices if group and any(g.group==group.index and g.weight>.99 for g in v.groups)];remove_ids(body,ids);records.append({'role':'light_cavalry','removedUnusedShieldCrossingAmmoVertices':len(ids),'heldLanceAndShieldPreserved':True})
 siegeparts,siegestats=siege(col,bone,iron,trim,cloth);created+=siegeparts
 return created,{'originalBeastGeometryAndTack':records,'siege':siegestats,'newBones':0,'newActions':0,'mountSupportRestAndOriginalHoovesPreserved':True,'prototype':True,'runtimeApproved':False,'finishedUnitApproved':False}
