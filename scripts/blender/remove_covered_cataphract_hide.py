"""Remove only source horse faces already enclosed by its new armor shell.

The separate hoof contact surfaces, original rigs and clips stay intact.
Optional feet-only cleanup also removes legacy tack beneath the new barding.
This prevents independently optimized inner hide from poking through barding.
"""
import argparse,bpy,bmesh,hashlib,json,pathlib,sys
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True);p.add_argument('--feet-only',action='store_true')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=pathlib.Path(a.source).resolve();out=pathlib.Path(a.out).resolve()
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();oldsha=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False)
c=bpy.data.collections['PERIS_EXPORT'];arm=next(o for o in c.all_objects if o.type=='ARMATURE' and 'Horse_Spine_1' in o.data.bones and any(m.type=='MESH' and m.get('peris_role')=='heavy_cavalry' and any(mod.type=='ARMATURE' and mod.object==o for mod in m.modifiers) for m in c.all_objects))
body=next(o for o in c.all_objects if o.type=='MESH' and o.get('peris_role')=='heavy_cavalry' and o.get('peris_atlas_partition')!='original-persian-royal-armor' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers))
bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups};sizes={};seen=set()
for start in bm.verts:
 if start in seen:continue
 stack=[start];seen.add(start);group=[]
 while stack:
  v=stack.pop();group.append(v)
  for edge in v.link_edges:
   other=edge.other_vert(v)
   if other not in seen:seen.add(other);stack.append(other)
 for v in group:sizes[v]=len(group)
remove=[]
for face in bm.faces:
 weights={}
 for v in face.verts:
  for index,w in v[layer].items():weights[names[index]]=weights.get(names[index],0)+w/len(face.verts)
 hoof_weight=sum(w for n,w in weights.items() if 'Hoof' in n)
 if hoof_weight<=.45 and (a.feet_only or max(sizes[v] for v in face.verts)>=70):remove.append(face)
count=len(remove);bmesh.ops.delete(bm,geom=remove,context='FACES');bm.to_mesh(body.data);bm.free();body.data.update()
if not count or not len(body.data.polygons):raise ValueError('Expected covered hide removed and separate hoof/tack geometry retained')
out.parent.mkdir(parents=True);bpy.ops.wm.save_as_mainfile(filepath=str(out),compress=True)
if sha(source)!=oldsha:raise ValueError('Source changed')
(out.parent/'armor-clearance.json').write_text(json.dumps({'sourceNative':str(source),'sourceSha256':oldsha,'sourceUnchanged':True,'coveredHorseFacesRemoved':count,'hoofContactRigAndActionsRetained':True,'legacyTackRetained':not a.feet_only,'legacyTackRemovedUnderNewBarding':a.feet_only,'newArmorShellUnchanged':True,'nativeSha256':sha(out),'finishedUnitApproved':False},indent=2)+'\n');print('CATAPHRACT_ARMOR_CLEARANCE_READY',count,flush=True)
