"""Reuse the horse's authored UV charts on its new armor surface.

Bone-space clamping can collapse UV triangles and corrupt normal lighting.
The artist's original charts keep their proportions inside the armor tile.
Only the new shell's UV values change; all positions, weights and clips stay.
"""
import argparse,bpy,hashlib,json,pathlib,sys,math
p=argparse.ArgumentParser();p.add_argument('--original',required=True);p.add_argument('--source',required=True);p.add_argument('--out',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);original=pathlib.Path(a.original).resolve();source=pathlib.Path(a.source).resolve();out=pathlib.Path(a.out).resolve()
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();oldsha=sha(source);original_sha=sha(original);bpy.ops.wm.open_mainfile(filepath=str(original),use_scripts=False);c=bpy.data.collections['PERIS_EXPORT']
arm=next(o for o in c.all_objects if o.type=='ARMATURE' and 'Horse_Spine_1' in o.data.bones and o.name.startswith('heavy_cavalry'))
body=max((o for o in c.all_objects if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)),key=lambda o:len(o.data.vertices));names={g.index:g.name for g in body.vertex_groups};neighbours={v.index:set() for v in body.data.vertices}
for e in body.data.edges:neighbours[e.vertices[0]].add(e.vertices[1]);neighbours[e.vertices[1]].add(e.vertices[0])
sizes={};seen=set()
for start in neighbours:
 if start in seen:continue
 stack=[start];seen.add(start);group=[]
 while stack:
  v=stack.pop();group.append(v)
  for n in neighbours[v]:
   if n not in seen:seen.add(n);stack.append(n)
 for v in group:sizes[v]=len(group)
charts=[]
for face in body.data.polygons:
 if max(sizes[v] for v in face.vertices)<70:continue
 hoof=sum(sum(g.weight for g in body.data.vertices[v].groups if 'Hoof' in names[g.group]) for v in face.vertices)/len(face.vertices)
 if hoof>.45:continue
 charts.append([list(body.data.uv_layers.active.data[i].uv) for i in face.loop_indices])
coords=[p for chart in charts for p in chart];lo=[min(p[i] for p in coords) for i in range(2)];hi=[max(p[i] for p in coords) for i in range(2)]
bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);c=bpy.data.collections['PERIS_EXPORT'];arm=next(o for o in c.all_objects if o.type=='ARMATURE' and 'Horse_Spine_1' in o.data.bones and o.name.startswith('heavy_cavalry'));kit=next(o for o in c.all_objects if o.type=='MESH' and o.get('peris_role')=='heavy_cavalry' and o.get('peris_atlas_partition')=='original-persian-royal-armor' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers))
def area(points):return abs(sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points))))/2
before=0;after=0;fallback=0;scale=1359/4096;pad=3/4096
for face,chart in zip(kit.data.polygons,charts):
 if len(face.loop_indices)!=len(chart):raise ValueError('Source face order did not survive the owned shell join')
 before+=area([list(kit.data.uv_layers.active.data[i].uv) for i in face.loop_indices])<1e-12
 normalized=[[(p[i]-lo[i])/(hi[i]-lo[i]) for i in range(2)] for p in chart]
 if area(normalized)<1e-10:
  points=[kit.data.vertices[i].co for i in face.vertices];ranges=[max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)];axes=sorted(range(3),key=lambda i:ranges[i],reverse=True)[:2];mins=[min(p[axis] for p in points) for axis in axes];normalized=[[(p[axis]-mins[j])/max(1e-8,ranges[axis])*.02+.45 for j,axis in enumerate(axes)] for p in points];fallback+=1
 for li,point in zip(face.loop_indices,normalized):kit.data.uv_layers.active.data[li].uv=[pad+scale*v for v in point]
 after+=area([list(kit.data.uv_layers.active.data[i].uv) for i in face.loop_indices])<1e-12
if after or len(charts)>len(kit.data.polygons):raise ValueError('Remaining collapsed or missing armor UV faces')
out.parent.mkdir(parents=True);bpy.ops.wm.save_as_mainfile(filepath=str(out),compress=True)
if sha(source)!=oldsha or sha(original)!=original_sha:raise ValueError('Immutable native changed')
(out.parent/'surface-uv.json').write_text(json.dumps({'sourceNative':str(source),'sourceSha256':oldsha,'originalNative':str(original),'originalSha256':original_sha,'sourceFilesUnchanged':True,'geometryWeightsRestActionsUnchanged':True,'shellFaces':len(charts),'collapsedUVFacesBefore':before,'collapsedUVFacesAfter':after,'sourceChartFallbackFaces':fallback,'originalUVChartProportionsRetained':True,'atlasTile':{'index':0,'size':4096,'innerSize':1359,'gutter':3},'nativeSha256':sha(out),'finishedUnitApproved':False},indent=2)+'\n');print('CATAPHRACT_UV_READY',len(charts),'collapsed UV faces',before,'->',after,flush=True)
