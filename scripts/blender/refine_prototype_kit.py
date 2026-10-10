"""Immutable shield/grip derivative of an existing approved visual prototype.

The original artist source remains intact. Carried shields grow around their
existing grip socket; the Panda correction removes superseded source fingers
under the newly authored bear grip. Rigs, binds and equipment weights remain.
"""
import argparse,bpy,bmesh,pathlib,sys,json,hashlib,runpy
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/blender'))
from prototype_shield_fit import fit_role_shield
from prototype_export_sampling import bake_saved_baseline_export,DEFAULT_ROLES
from prototype_glb_names import namespace_exported_glb_nodes
from prototype_contact_floor import normalize_role_ground
p=argparse.ArgumentParser();p.add_argument('--native',required=True);p.add_argument('--out',required=True);p.add_argument('--faction',required=True);p.add_argument('--fit-floor',action='store_true');p.add_argument('--native-only',action='store_true');a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
source=pathlib.Path(a.native).resolve();out=ROOT/'assets/source/battle'/a.out
if out.exists():raise FileExistsError(str(out))
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();source_hash=sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
collection=bpy.data.collections['PERIS_EXPORT'];hands=[];shields=[];contact=[]
if a.faction=='pandaren':
 for role in DEFAULT_ROLES:
  if role in ('ram','catapult'):continue
  candidates=[o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role and o.get('peris_atlas_partition')!='original-bear-detail' and any(m.type=='ARMATURE' and m.object.data.bones.get('hip') for m in o.modifiers)]
  if len(candidates)!=1:raise ValueError('Expected one original Panda body '+role+' '+str([o.name for o in candidates]))
  obj=candidates[0];bm=bmesh.new();bm.from_mesh(obj.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in obj.vertex_groups}
  family={'hand_L','hand_R','finger_L','finger_R','fingertip_L','fingertip_R'}
  faces=[f for f in bm.faces if sum(sum(w for i,w in v[layer].items() if names.get(i) in family) for v in f.verts)/len(f.verts)>.95]
  count=len(faces);bmesh.ops.delete(bm,geom=faces,context='FACES');bm.to_mesh(obj.data);bm.free();obj.data.update()
  hands.append({'role':role,'sourceMesh':obj.name,'removedSupersededSourceHandFaces':count,'newBearGripsUnchanged':True});print('SOURCE_HAND_CLEARANCE',role,count,flush=True)
for role in DEFAULT_ROLES:
 shields.append(fit_role_shield(collection,role,target_ratio=.775));print('SHIELD_SIZE_READY',role,flush=True)
 if a.fit_floor:
  roots=[o for o in collection.all_objects if o.type=='ARMATURE' and not o.parent and any(t.name==role+'_idle' for t in o.animation_data.nla_tracks)]
  if len(roots)!=1:raise ValueError('Expected one role root '+role)
  support=sorted({g.name for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role for g in o.vertex_groups if ('foot' in g.name.lower() or 'hoof' in g.name.lower() or g.name.startswith(('Elephantidae_Hand','Horse_Hand')))})
  if role=='ram':support=['l_mid','l_front','l_back','r_mid','r_front','r_back']
  contact.append(normalize_role_ground(collection,role,roots[0],support,sample_step=.5,clearance=.025,allow_lowering=role=='ram',edition=a.out));print('KIT_CONTACT_READY',role,flush=True)
for obj in collection.all_objects:
 if obj.type=='ARMATURE':
  obj.animation_data.action=None
  for t in obj.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update();out.mkdir(parents=True);bpy.ops.file.pack_all();native=out/('peris-'+a.faction+'-army.blend');bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
if a.native_only:
 if sha(source)!=source_hash:raise ValueError('Original artist source changed')
 report={'edition':a.out,'sourceNative':str(source),'sourceNativeSha256':source_hash,'sourceNativeUnchanged':True,'hands':hands,'shields':shields,'contact':contact,'native':{'path':str(native),'sha256':sha(native)},'runtimeApproved':False,'finishedUnitApproved':False}
 (out/'native-provenance.json').write_text(json.dumps(report,indent=2)+'\n');print('REFINED_KIT_NATIVE_READY',json.dumps(report['native']),flush=True);sys.exit(0)
bpy.ops.wm.open_mainfile(filepath=str(native),load_ui=False,use_scripts=False);sampling=bake_saved_baseline_export(bpy.data.collections['PERIS_EXPORT'])
raw=out/'exports'/(a.faction+'-roster.glb');source_names=raw.with_name(raw.stem+'-source-names.glb');sys.argv=['export_glb.py','--','--collection','PERIS_EXPORT','--animation-mode','NLA_TRACKS','--output',str(source_names)];runpy.run_path(str(ROOT/'scripts/blender/export_glb.py'),run_name='__main__');sampling['runtimeNodeNamespace']=namespace_exported_glb_nodes(source_names,raw)
if sha(source)!=source_hash:raise ValueError('Original artist source changed')
report={'edition':a.out,'sourceNative':str(source),'sourceNativeSha256':source_hash,'sourceNativeUnchanged':True,'hands':hands,'shields':shields,'contact':contact,'exportSampling':sampling,'native':{'path':str(native),'sha256':sha(native)},'raw':{'path':str(raw),'sha256':sha(raw)},'runtimeApproved':False,'finishedUnitApproved':False}
(out/'provenance.json').write_text(json.dumps(report,indent=2)+'\n');print('REFINED_KIT_READY',json.dumps(report['raw']),flush=True)
