"""Append bounded original coverage/support patches without changing old surfaces."""
import bpy,bmesh,numpy as np,math,json,hashlib
from mathutils import Vector

def _arrays(mesh,verts=None,loops=None,polys=None):
 nv=len(mesh.vertices) if verts is None else verts;nl=len(mesh.loops) if loops is None else loops;np_=len(mesh.polygons) if polys is None else polys
 return {'positions':[[*v.co] for v in list(mesh.vertices)[:nv]],'polygons':[list(p.vertices) for p in list(mesh.polygons)[:np_]],'uvs':[[*v.uv] for v in list(mesh.uv_layers.active.data)[:nl]],'weights':[[[g.group,g.weight] for g in v.groups] for v in list(mesh.vertices)[:nv]],'normals':[[*v.vector] for v in list(mesh.corner_normals)[:nl]]}

def _digest(data):return hashlib.sha256(json.dumps(data,separators=(',',':')).encode()).hexdigest()

def _atlas_uv(obj,color,filter_=None):
 mat=obj.data.materials[0];image=mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].links[0].from_node.image;width,height=image.size;pixels=np.empty(len(image.pixels),np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape((height,width,4));uv=obj.data.uv_layers.active;best=None
 for p in obj.data.polygons:
  if filter_ and not filter_(p):continue
  coord=sum((uv.data[i].uv for i in p.loop_indices),Vector((0,0)))/len(p.loop_indices);pixel=pixels[min(height-1,max(0,int(coord.y*height))),min(width-1,max(0,int(coord.x*width))),:3];error=float(np.sum((pixel-np.asarray(color))**2))
  if best is None or error<best[0]:best=(error,coord.copy(),pixel.copy())
 if best is None:raise ValueError('No actual source atlas surface sample')
 # Existing source colors are tiled; use a bounded neighborhood of the exact
 # material sample so original albedo/roughness/normal maps are retained.
 return best[1],best[2].tolist()

def _append(obj,vertices,faces,bone,uv,name):
 mesh=obj.data;nv,nl,np_=len(mesh.vertices),len(mesh.loops),len(mesh.polygons);before=_arrays(mesh);old=_digest(before);normals=np.asarray(before['normals'],np.float32)
 bones=bone if isinstance(bone,tuple) else (bone,);groups=[obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name) for name in bones]
 bm=bmesh.new();bm.from_mesh(mesh);layer=bm.verts.layers.deform.verify();uvlayer=bm.loops.layers.uv.active;added=[bm.verts.new(v) for v in vertices]
 for i,v in enumerate(added):v[layer][groups[min(len(groups)-1,i*len(groups)//len(added))].index]=1
 for face in faces:
  p=bm.faces.new([added[i] for i in face]);p.material_index=0;p.smooth=False
  for j,loop in enumerate(p.loops):loop[uvlayer].uv=uv+Vector(((j%2)*.001,(j//2%2)*.001))
 bm.to_mesh(mesh);bm.free();mesh.update();allnorm=np.asarray([v.vector[:] for v in mesh.corner_normals],np.float32);allnorm[:nl]=normals;mesh.update()
 after=_arrays(mesh,nv,nl,np_);checks={k:before[k]==after[k] for k in before if k!='normals'};normal_after=np.asarray(after['normals'],np.float32);normal_delta=float(np.max(np.abs(normal_after-normals)));valid=(np.linalg.norm(normals,axis=1)>.1)
 a=normal_after[valid].astype(np.float64);b=normals[valid].astype(np.float64);angle=float(np.max(np.degrees(np.arctan2(np.linalg.norm(np.cross(a,b),axis=1),np.sum(a*b,axis=1)))))
 checks['normals']=normal_delta<=2e-6 and angle<=.001
 print('NORMAL_TRANSPORT',name,normal_delta,angle,flush=True)
 if not all(checks.values()):raise ValueError('Original surface preservation failed '+json.dumps(checks))
 return {'operation':name,'mesh':obj.name,'bone':bone,'oldVertices':nv,'addedVertices':len(vertices),'addedPolygons':len(faces),'sourceSurfaceSha256':old,'checks':checks,'existingUVsWeightsPositionsAndPolygonsPreserved':True,'normalTransportMaxComponentDelta':normal_delta,'normalTransportMaxAngleDegrees':angle,'normalMapsUnchanged':True}

def apply_coverage_and_supports(collection,faction,rig_hash):
 arms=[o for o in collection.objects if o.type=='ARMATURE'];before={a.name:rig_hash(a) for a in arms};records=[]
 colors={'elf':(.055,.20,.115),'dwarf':(.28,.055,.035),'gnome':(.30,.055,.045),'pandaren':(.30,.045,.035),'demon':(.16,.035,.023)}
 if faction in colors:
  for role in ['line_infantry','spear_guard','elite','archer']:
   arm=next(a for a in arms if a.name.startswith(role+' anatomy'));obj=next(o for o in collection.objects if o.type=='MESH' and o.get('peris_role')==role and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers));h=arm.data.bones['hip'].head_local
   hipgroup=obj.vertex_groups['hip'].index
   def eligible(p):return all(any(w.group==hipgroup and w.weight>.999 for w in obj.data.vertices[i].groups) for i in p.vertices) and -.36<(sum((obj.data.vertices[i].co.z for i in p.vertices))/len(p.vertices)-h.z)<.14
   uv,pixel=_atlas_uv(obj,colors[faction],eligible);bodygroups={g.index for g in obj.vertex_groups if g.name in ['hip','spine','spine1','thigh_L','thigh_R']}
   band=[v.co-h for v in obj.data.vertices if -.36<(v.co-h).z<.16 and any(w.group in bodygroups and w.weight>.1 for w in v.groups)]
   rx=max(abs(v.x) for v in band)+.028;ry=max(abs(v.y) for v in band)+.028;n=20;verts=[]
   for z,s in [(-.34,1.02),(.16,.99)]:
    for i in range(n):t=math.tau*i/n;verts.append(h+Vector((math.sin(t)*rx*s,math.cos(t)*ry*s,z)))
   faces=[(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)]
   records.append(_append(obj,verts,faces,'hip',uv,'Original measured outer cloth overlap covers stepped source tunic waist seam'));records[-1]['atlasColorSample']=pixel;records[-1]['atlasUvSample']=list(uv)
 if faction=='undead':
  for role in ['scout','light_cavalry']:
   arm=next(a for a in arms if a.name.startswith(role+' mount'));obj=next(o for o in collection.objects if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers));seat=next(b for b in arm.data.bones if b.name in ['prop-rider','prop_rider','rider']);uv,pixel=_atlas_uv(obj,(.15,.09,.04));h=seat.head_local;n=12;verts=[]
   for z,rx,ry in [(3.40,.44,.38),(h.z-.065,.53,.52)]:
    for i in range(n):t=math.tau*i/n;verts.append(Vector((h.x+math.sin(t)*rx,h.y+math.cos(t)*ry,z)))
   faces=[tuple(range(n)),tuple(range(n*2-1,n-1,-1))]+[(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)]
   records.append(_append(obj,verts,faces,('Horse_Spine_1',seat.name),uv,'Original complete leather skeletal horse saddle bolster between real dorsal ribs and retained riding saddle'));records[-1]['atlasColorSample']=pixel
  arm=next(a for a in arms if a.get('peris_mount_species')=='skeletal mammoth');obj=next(o for o in collection.objects if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers));socket=arm.data.bones['peris_seated_rider'];m=socket.matrix_local;seat_z=7.65+.34+.935*1.02;uv,pixel=_atlas_uv(obj,(.49,.32,.12));verts=[];faces=[]
  # Source deck bottom7.89 was ~1.1 canonical units above real dorsal bones.
  # These body-bone supports overlap both rib/spine top and deck underside.
  for side in [-1,1]:
   for y in [-1.10,1.05]:
    a=m@Vector((side*.46,y+.37,6.55-seat_z));b=m@Vector((side*.83,y+.37,7.99-seat_z));axis=(b-a).normalized();u=axis.cross(Vector((0,1,0)))
    if u.length<.01:u=axis.cross(Vector((1,0,0)))
    u.normalize();v=axis.cross(u);offset=len(verts);n=8
    for c,r in [(a,.16),(b,.12)]:
     for i in range(n):t=math.tau*i/n;verts.append(c+(u*math.cos(t)+v*math.sin(t))*r)
    faces.extend([tuple(range(offset+n-1,offset-1,-1)),tuple(range(offset+n,offset+n*2))]);faces.extend([(offset+i,offset+(i+1)%n,offset+(i+1)%n+n,offset+i+n) for i in range(n)])
  records.append(_append(obj,verts,faces,'Elephantidae_Vertebrae_Dorsal',uv,'Original mammoth dorsal saddle supports connect actual rib/spine top to deck underside'));records[-1]['sourceDeckBottomZ']=7.89;records[-1]['sourceDorsalTopZ']=6.79;records[-1]['canonicalSeatZ']=seat_z;records[-1]['atlasColorSample']=pixel
 after={a.name:rig_hash(a) for a in arms}
 if before!=after:raise ValueError('Coverage support repair changed source rig or clips')
 return {'faction':faction,'patches':records,'rigActionHashes':before,'rigAndActionsPreserved':True,'runtimeApproved':False,'finishedUnitApproved':False}
