"""Immutable Panda derivative: anatomical giant surface and measured root contact.

The saved source is retained. Equipment sockets, rest bones, mount/rider binds
and all non-root-height animation channels remain unchanged.
"""
import argparse,pathlib,sys,bpy,json,hashlib,runpy,math
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from prototype_contact_floor import normalize_role_ground
from prototype_export_sampling import bake_saved_baseline_export
from prototype_glb_names import namespace_exported_glb_nodes
from pandaren_quality import material
p=argparse.ArgumentParser();p.add_argument('--out',required=True);args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
OUT=ROOT/'assets/source/battle'/args.out
if OUT.exists():raise FileExistsError(str(OUT))
source=pathlib.Path(bpy.data.filepath);sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();before_hash=sha(source)
collection=bpy.data.collections['PERIS_EXPORT'];records=[]
giant=next(o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')=='catapult' and any(m.type=='ARMATURE' and m.object.data.bones.get('hip') for m in o.modifiers))
arm=next(m.object for m in giant.modifiers if m.type=='ARMATURE');names={g.index:g.name for g in giant.vertex_groups}
white=material('Original mountain bear off-white belly fur',(.66,.63,.56));giant.data.materials.append(white);slot=len(giant.data.materials)-1;belly=0
for face in giant.data.polygons:
    weights={}
    for i in face.vertices:
        for g in giant.data.vertices[i].groups:weights[names[g.group]]=weights.get(names[g.group],0)+g.weight/len(face.vertices)
    if sum(v for n,v in weights.items() if n in ['hip','spine','chest'])>.65:
        face.material_index=slot;belly+=1
# Rock is the large disconnected rigid hand-R island, not the palm/fingers.
rigid={v.index for v in giant.data.vertices if sum(g.weight for g in v.groups if names[g.group]=='hand_R')>.99};adj={i:set() for i in rigid}
for e in giant.data.edges:
    a,b=e.vertices
    if a in rigid and b in rigid:adj[a].add(b);adj[b].add(a)
components=[];pending=set(rigid)
while pending:
    seed=pending.pop();part={seed};front=[seed]
    while front:
        current=front.pop()
        for n in adj[current]&pending:pending.remove(n);part.add(n);front.append(n)
    components.append(part)
rock=max(components,key=lambda ids:max((giant.data.vertices[i].co-giant.data.vertices[j].co).length for i in ids for j in [next(iter(ids))]))
points=[giant.data.vertices[i].co.copy() for i in rock];center=sum(points,Vector())/len(points);radius=max((p-center).length for p in points)
if radius<.25:raise ValueError('No large rigid boulder island identified')
for i in rock:
    v=giant.data.vertices[i];d=v.co-center;factor=1+.07*math.sin(d.x*9+d.z*2)+.045*math.cos(d.y*12-d.x*3)
    v.co=center+Vector((d.x*factor,d.y*factor*.94,d.z*factor*1.03))
for face in giant.data.polygons:
    if all(i in rock for i in face.vertices):face.use_smooth=False
giant.data.update()
roles=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','catapult','ram']
for role in roles:
    roots=[o for o in collection.all_objects if o.type=='ARMATURE' and not o.parent and any(t.name==role+'_idle' for t in o.animation_data.nla_tracks)]
    if len(roots)!=1:raise ValueError('Ambiguous semantic root '+role)
    root=roots[0];supported={'foot_L','foot_R','Foot_L','Foot_R','Elephantidae_Foot_L','Elephantidae_Foot_R','Elephantidae_Hand_L','Elephantidae_Hand_R','Horse_Hoof_L','Horse_Hoof_R','Horse_Hoof_back_L','Horse_Hoof_back_R','Horse_Hand_L','Horse_Hand_R','Horse_Foot_L','Horse_Foot_R'}
    if role=='ram':supported={'l_mid','l_front','l_back','r_mid','r_front','r_back'}
    feet=sorted({g.name for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role for g in o.vertex_groups if g.name in supported})
    if not feet:raise ValueError('Explicit support bones missing: '+role)
    anchor='hip' if root.pose.bones.get('hip') else None
    record=normalize_role_ground(collection,role,root,feet,sample_step=.5,body_anchor=anchor,edition=args.out,allow_lowering=role=='ram');initial=record['before']
    records.append(record);print('PANDA_CONTACT',role,initial['minimumWorldZ'],record['after']['minimumWorldZ'],flush=True)
for a in [o for o in collection.all_objects if o.type=='ARMATURE']:
    for t in a.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update();OUT.mkdir(parents=True);bpy.ops.file.pack_all();native=OUT/'peris-pandaren-army.blend';bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
bpy.ops.wm.open_mainfile(filepath=str(native),load_ui=False,use_scripts=False)
collection=bpy.data.collections['PERIS_EXPORT'];sampling=bake_saved_baseline_export(collection)
raw=OUT/'exports/pandaren-roster.glb';source_names=raw.with_name('pandaren-roster-source-names.glb');sys.argv=['export_glb.py','--','--collection','PERIS_EXPORT','--animation-mode','NLA_TRACKS','--output',str(source_names)];runpy.run_path(str(ROOT/'scripts/blender/export_glb.py'),run_name='__main__');sampling['runtimeNodeNamespace']=namespace_exported_glb_nodes(source_names,raw)
report={'edition':args.out,'sourceNative':str(source),'sourceSha256Before':before_hash,'sourceSha256After':sha(source),'giantSurface':{'whiteTorsoFaces':belly,'rigidRockVertices':len(rock),'boulderOriginalRadius':radius,'sourceSocketAndWeightsUnchanged':True},'contact':records,'exportSampleRate':48,'exportFrames':[0,48],'nativeArtistFrames':[1,25],'exportSampling':sampling,'native':{'path':str(native),'sha256':sha(native)},'raw':{'path':str(raw),'sha256':sha(raw)},'runtimeApproved':False,'finishedUnitApproved':False}
(OUT/'provenance.json').write_text(json.dumps(report,indent=2)+'\n');print('PANDA_CONTACT_READY',json.dumps(report['raw']),flush=True)
