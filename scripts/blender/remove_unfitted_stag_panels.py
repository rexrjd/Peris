"""Keep original fitted stag tack; remove the extra flat back-mounted panels.

Only the newly authored mount kit's Spine1 vertices are removed. Antlers,
original saddles, all source geometry, rigs and clips remain unchanged.
"""
import argparse,bpy,bmesh,hashlib,json,pathlib,sys
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=pathlib.Path(a.source).resolve();out=pathlib.Path(a.out).resolve()
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();oldsha=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);rows=[]
for o in bpy.data.collections['PERIS_EXPORT'].all_objects:
 if o.type!='MESH' or o.get('peris_atlas_partition')!='original-elf-mount':continue
 groups={g.index for g in o.vertex_groups if g.name=='Deer01_Spine1'};bm=bmesh.new();bm.from_mesh(o.data);layer=bm.verts.layers.deform.active
 remove=[v for v in bm.verts if sum(w for index,w in v[layer].items() if index in groups)>.999]
 rows.append({'mesh':o.name,'removedNewPanelVertices':len(remove),'originalFittedGreenTackRetained':True});bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(o.data);bm.free();o.data.update()
out.parent.mkdir(parents=True);bpy.ops.wm.save_as_mainfile(filepath=str(out),compress=True)
if sha(source)!=oldsha:raise ValueError('Source changed')
(out.parent/'barding-fit.json').write_text(json.dumps({'sourceNative':str(source),'sourceSha256':oldsha,'sourceUnchanged':True,'originalSourceGeometryWeightsRestAndClipsUnchanged':True,'operations':rows,'nativeSha256':sha(out),'finishedUnitApproved':False},indent=2)+'\n');print('STAG_TACK_FIT_READY',json.dumps(rows),flush=True)
